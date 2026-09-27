use crate::{
    domain::{Error, Result},
    storage::{atomic_write, digest, sync_dir, uid, Store},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Write},
};
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub asset_id: String,
    pub file: String,
    pub hash: String,
    pub size: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attach {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub expected_revision: i64,
}
pub fn validate_image(bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(Error::new("IMAGE_SIZE", "图片不能超过 20 MiB"));
    }
    let format = match image::guess_format(bytes) {
        Ok(format) => format,
        Err(_) => {
            crate::native_images::preview(bytes)?;
            return Ok(());
        }
    };
    if !matches!(
        format,
        image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP
    ) {
        return Err(Error::new("IMAGE_FORMAT", "图片格式暂不支持"));
    }
    let (w, h) = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| Error::new("IMAGE_CORRUPT", "图片无法读取"))?;
    if w == 0 || h == 0 || w > 12000 || h > 12000 || u64::from(w) * u64::from(h) > 40_000_000 {
        return Err(Error::new(
            "IMAGE_DIMENSIONS",
            "图片最长边限 12000 像素，总像素限 4000 万",
        ));
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(12000);
    limits.max_image_height = Some(12000);
    limits.max_alloc = Some(192 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| Error::new("IMAGE_CORRUPT", "图片损坏或解码超出限制"))?;
    Ok(())
}
impl Store {
    pub fn attach(&mut self, input: &Attach, bytes: &[u8]) -> Result<Attachment> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已恢复，请重新打开档案"));
        }
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        uuid::Uuid::parse_str(&input.asset_id).map_err(|_| Error::new("ID", "档案标识无效"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(Error::new("IMAGE_SIZE", "图片不能超过 20 MiB"));
        }
        let hash = digest(bytes);
        let fingerprint = digest(&serde_json::to_vec(&(input, &hash))?);
        let prior: Option<(String, String)> = self
            .conn()?
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((f, result)) = prior {
            if f != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        let live:bool=self.conn()?.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND revision=?2 AND deleted_at IS NULL)",params![input.asset_id,input.expected_revision],|r|r.get(0))?;
        if !live {
            return Err(Error::new("REVISION_CONFLICT", "所属资产已更改或删除"));
        }
        validate_image(bytes)?;
        let dir = self.dataset();
        fs::create_dir_all(dir.join("staging"))?;
        fs::create_dir_all(dir.join("files"))?;
        let pending = dir
            .join("staging")
            .join(format!("{}.json", input.request_id));
        atomic_write(&pending, &serde_json::to_vec(&(input, &hash))?)?;
        let mut staged = tempfile::NamedTempFile::new_in(dir.join("staging"))?;
        self.hit("image.before_write")?;
        staged.write_all(bytes)?;
        staged.as_file().sync_all()?;
        self.hit("image.after_stage")?;
        let target = dir.join("files").join(&hash);
        if target.exists() {
            if digest(&fs::read(&target)?) != hash {
                return Err(Error::new("IMAGE_CORRUPT", "已托管图片损坏，停止提交"));
            }
        } else {
            staged.persist_noclobber(&target).map_err(|e| e.error)?;
            sync_dir(&dir.join("files"))?;
        }
        self.hit("image.after_place")?;
        let result = Attachment {
            id: uid(),
            asset_id: input.asset_id.clone(),
            file: hash.clone(),
            hash: hash.clone(),
            size: bytes.len() as u64,
        };
        let tx = self.conn()?.unchecked_transaction()?;
        if tx.execute("UPDATE assets SET revision=revision+1 WHERE id=?1 AND revision=?2 AND deleted_at IS NULL",params![input.asset_id,input.expected_revision])?!=1{return Err(Error::new("REVISION_CONFLICT","资产已更改"));}
        tx.execute(
            "INSERT INTO attachments(id,asset_id,file,hash,size) VALUES(?1,?2,?3,?4,?5)",
            params![
                result.id,
                result.asset_id,
                result.file,
                result.hash,
                result.size as i64
            ],
        )?;
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&result)?
            ],
        )?;
        self.hit("image.before_commit")?;
        tx.commit()?;
        self.hit("image.after_commit")?;
        // Retain the operation manifest for diagnosis; CP0 never garbage-collects originals.
        Ok(result)
    }
    pub fn image_bytes(&self, id: &str) -> Result<Vec<u8>> {
        let (file, hash): (String, String) =
            self.conn()?
                .query_row("SELECT file,hash FROM attachments WHERE id=?1", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?;
        validate_file_name(&file)?;
        let bytes = fs::read(self.dataset().join("files").join(file))?;
        if digest(&bytes) != hash {
            return Err(Error::new("IMAGE_CORRUPT", "托管图片校验失败"));
        }
        Ok(bytes)
    }
}
pub(crate) fn validate_file_name(name: &str) -> Result<()> {
    if name.len() != 64
        || !name
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(Error::new("PATH", "附件路径无效"));
    }
    Ok(())
}
