//! Draft originals are durable before save; asset, selection and cover commit together.
use crate::{
    domain::{Error, Result},
    files::{validate_file_name, validate_image, MAX_IMAGE_BYTES},
    storage::{atomic_write, digest, uid, Store},
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Read, path::Path};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Photo {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub ids: Vec<String>,
    pub cover_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Staged {
    id: String,
    name: String,
    hash: String,
    size: u64,
}
fn reject_warranty_reference(tx: &Transaction<'_>, id: &str) -> Result<()> {
    let owned: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM warranty_photos WHERE attachment_id=?1)",
        [id],
        |r| r.get(0),
    )?;
    if owned {
        return Err(Error::new(
            "IMAGE_OWNER",
            "图片属于保障记录，请重新选择图片",
        ));
    }
    Ok(())
}
impl Store {
    pub(crate) fn check_generation(&self, generation: &str) -> Result<()> {
        if generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新打开档案"));
        }
        Ok(())
    }
    pub fn stage_photo_path(
        &self,
        path: &Path,
        generation: &str,
        repair: Option<&str>,
    ) -> Result<Photo> {
        let meta = fs::metadata(path)?;
        if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES as u64 {
            return Err(Error::new("IMAGE_SIZE", "请选择不超过 20 MiB 的图片文件"));
        }
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take(MAX_IMAGE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        self.stage_photo(
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_ref(),
            &bytes,
            generation,
            repair,
        )
    }
    pub fn stage_photo(
        &self,
        name: &str,
        bytes: &[u8],
        generation: &str,
        repair: Option<&str>,
    ) -> Result<Photo> {
        self.check_generation(generation)?;
        validate_image(bytes)?;
        // Require a displayable preview before the user can submit this selection.
        let preview = crate::native_images::preview(bytes)?;
        let hash = digest(bytes);
        let mut staged = Staged {
            id: uid(),
            name: name.chars().filter(|c| !c.is_control()).take(255).collect(),
            hash: hash.clone(),
            size: bytes.len() as u64,
        };
        if let Some(id) = repair {
            let (expected, name) = self.photo_source(id)?;
            if hash != expected {
                return Err(Error::new(
                    "REPAIR_MISMATCH",
                    "这不是同一张原图。请选择原文件；要换图，请在编辑资料中添加新图。",
                ));
            }
            staged.id = id.to_owned();
            staged.name = name;
        }
        let dir = self.dataset();
        for folder in ["files", "staging", "cache"] {
            fs::create_dir_all(dir.join(folder))?;
        }
        self.hit("photo.before_place")?;
        // Identical hash replacement also repairs missing/corrupt originals, without changing references.
        atomic_write(&dir.join("files").join(&hash), bytes)?;
        self.hit("photo.after_place")?;
        atomic_write(&dir.join("cache").join(format!("{hash}.png")), &preview)?;
        if repair.is_none() {
            atomic_write(
                &dir.join("staging")
                    .join(format!("photo-{}.json", staged.id)),
                &serde_json::to_vec(&staged)?,
            )?;
        }
        Ok(Photo {
            id: staged.id,
            name: staged.name,
        })
    }
    fn staged(&self, id: &str) -> Result<Staged> {
        uuid::Uuid::parse_str(id).map_err(|_| Error::new("IMAGE_ID", "图片标识无效"))?;
        let p = self
            .dataset()
            .join("staging")
            .join(format!("photo-{id}.json"));
        let mut bytes = Vec::new();
        fs::File::open(p)?.take(4097).read_to_end(&mut bytes)?;
        if bytes.len() > 4096 {
            return Err(Error::new("IMAGE_DRAFT", "图片草稿损坏，请重新选择"));
        }
        let s: Staged = serde_json::from_slice(&bytes)?;
        validate_file_name(&s.hash)?;
        if s.id != id
            || s.size == 0
            || s.size > MAX_IMAGE_BYTES as u64
            || s.name.chars().count() > 255
        {
            return Err(Error::new("IMAGE_DRAFT", "图片草稿损坏，请重新选择"));
        }
        Ok(s)
    }
    pub(crate) fn original(&self, hash: &str) -> Result<Vec<u8>> {
        validate_file_name(hash)?;
        let mut bytes = Vec::new();
        let file = fs::File::open(self.dataset().join("files").join(hash))
            .map_err(|_| Error::new("IMAGE_MISSING", "原图缺失，请重新选择原文件修复"))?;
        file.take(MAX_IMAGE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_IMAGE_BYTES || digest(&bytes) != hash {
            return Err(Error::new(
                "IMAGE_CORRUPT",
                "原图校验失败，请重新选择原文件修复",
            ));
        }
        Ok(bytes)
    }
    fn photo_source(&self, id: &str) -> Result<(String, String)> {
        let known = self.conn()?.query_row("SELECT a.hash,coalesce(p.name,'图片') FROM attachments a LEFT JOIN asset_photos p ON p.attachment_id=a.id WHERE a.id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        match known {
            Some(row) => Ok(row),
            None => {
                let s = self.staged(id)?;
                Ok((s.hash, s.name))
            }
        }
    }
    pub(crate) fn preview_by_hash(&self, hash: &str) -> Result<Vec<u8>> {
        // Always verify the original: a cached preview must never conceal missing data.
        let bytes = self.original(hash)?;
        let cache = self.dataset().join("cache");
        let path = cache.join(format!("{hash}.png"));
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() <= 4 * 1024 * 1024 {
                let cached = fs::read(&path)?;
                if crate::files::validate_image(&cached).is_ok() {
                    return Ok(cached);
                }
            }
        }
        let png = crate::native_images::preview(&bytes)?;
        fs::create_dir_all(cache)?;
        atomic_write(&path, &png)?;
        Ok(png)
    }
    pub fn photo_preview(&self, id: &str, generation: &str) -> Result<Vec<u8>> {
        self.check_generation(generation)?;
        let (hash, _) = self.photo_source(id)?;
        self.preview_by_hash(&hash)
    }
    pub(crate) fn commit_photos(
        &self,
        tx: &Transaction<'_>,
        asset_id: &str,
        selection: &Selection,
    ) -> Result<()> {
        if selection.ids.len() > 20
            || selection.ids.iter().collect::<HashSet<_>>().len() != selection.ids.len()
        {
            return Err(Error::new(
                "IMAGE_SELECTION",
                "每件物品最多 20 张图片，不能重复选择",
            ));
        }
        if selection
            .cover_id
            .as_ref()
            .is_some_and(|id| !selection.ids.contains(id))
        {
            return Err(Error::new("IMAGE_COVER", "封面必须是当前选择的图片"));
        }
        let mut prepared = Vec::new();
        for id in &selection.ids {
            reject_warranty_reference(tx, id)?;
            let known: Option<(String,String,i64,String)> = tx.query_row("SELECT a.asset_id,a.hash,a.size,coalesce(p.name,'图片') FROM attachments a LEFT JOIN asset_photos p ON p.attachment_id=a.id WHERE a.id=?1", [id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
            let (hash, size, name, new) = if let Some((owner, hash, size, name)) = known {
                if owner != asset_id {
                    return Err(Error::new("IMAGE_OWNER", "图片不属于这件物品"));
                }
                (hash, size, name, false)
            } else {
                let s = self.staged(id)?;
                (s.hash, s.size as i64, s.name, true)
            };
            if self.original(&hash)?.len() as i64 != size {
                return Err(Error::new("IMAGE_CORRUPT", "图片大小校验失败"));
            }
            prepared.push((id, hash, size, name, new));
        }
        tx.execute("DELETE FROM asset_photos WHERE asset_id=?1", [asset_id])?;
        for (position, (id, hash, size, name, new)) in prepared.iter().enumerate() {
            if *new {
                tx.execute(
                    "INSERT INTO attachments(id,asset_id,file,hash,size) VALUES(?1,?2,?3,?3,?4)",
                    params![id, asset_id, hash, size],
                )?;
            }
            tx.execute(
                "INSERT INTO asset_photos VALUES(?1,?2,?3,?4)",
                params![asset_id, id, position as i64, name],
            )?;
        }
        tx.execute("INSERT INTO asset_media(asset_id,cover_id) VALUES(?1,?2) ON CONFLICT(asset_id) DO UPDATE SET cover_id=excluded.cover_id",params![asset_id,selection.cover_id])?;
        Ok(())
    }
    pub(crate) fn commit_maintenance_photos(
        &self,
        tx: &Transaction<'_>,
        asset_id: &str,
        maintenance_id: &str,
        selection: &Selection,
    ) -> Result<()> {
        if selection.cover_id.is_some()
            || selection.ids.len() > 20
            || selection.ids.iter().collect::<HashSet<_>>().len() != selection.ids.len()
        {
            return Err(Error::new(
                "IMAGE_SELECTION",
                "维护记录最多 20 张图片，不能重复选择且不单独设置封面",
            ));
        }
        let mut prepared = Vec::new();
        for id in &selection.ids {
            reject_warranty_reference(tx, id)?;
            let known: Option<(String, String, i64, String)> = tx
                .query_row(
                    "SELECT a.asset_id,a.hash,a.size,coalesce(mp.name,ap.name,'图片') FROM attachments a LEFT JOIN maintenance_photos mp ON mp.attachment_id=a.id LEFT JOIN asset_photos ap ON ap.attachment_id=a.id WHERE a.id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            let (hash, size, name, new) = if let Some((owner, hash, size, name)) = known {
                if owner != asset_id {
                    return Err(Error::new("IMAGE_OWNER", "图片不属于这件物品"));
                }
                (hash, size, name, false)
            } else {
                let staged = self.staged(id)?;
                (staged.hash, staged.size as i64, staged.name, true)
            };
            if self.original(&hash)?.len() as i64 != size {
                return Err(Error::new("IMAGE_CORRUPT", "图片大小校验失败"));
            }
            prepared.push((id, hash, size, name, new));
        }
        tx.execute(
            "DELETE FROM maintenance_photos WHERE maintenance_id=?1",
            [maintenance_id],
        )?;
        for (position, (id, hash, size, name, new)) in prepared.iter().enumerate() {
            if *new {
                tx.execute(
                    "INSERT INTO attachments(id,asset_id,file,hash,size) VALUES(?1,?2,?3,?3,?4)",
                    params![id, asset_id, hash, size],
                )?;
            }
            tx.execute(
                "INSERT INTO maintenance_photos VALUES(?1,?2,?3,?4)",
                params![maintenance_id, id, position as i64, name],
            )?;
        }
        Ok(())
    }
    pub(crate) fn commit_warranty_photos(
        &self,
        tx: &Transaction<'_>,
        asset_id: &str,
        warranty_id: &str,
        selection: &Selection,
    ) -> Result<()> {
        if selection.cover_id.is_some()
            || selection.ids.len() > 20
            || selection.ids.iter().collect::<HashSet<_>>().len() != selection.ids.len()
        {
            return Err(Error::new(
                "IMAGE_SELECTION",
                "保障记录最多 20 张图片，不能重复选择且不单独设置封面",
            ));
        }
        let mut prepared = Vec::new();
        for id in &selection.ids {
            // Persisted IDs may only be retained by their current warranty.
            // A fresh selection gets a fresh ID even when its bytes are shared.
            let foreign_relation: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM attachments a WHERE a.id=?1 AND (
                   NOT EXISTS(SELECT 1 FROM warranty_photos w WHERE w.attachment_id=a.id AND w.warranty_id=?2)
                   OR EXISTS(SELECT 1 FROM asset_photos p WHERE p.attachment_id=a.id)
                   OR EXISTS(SELECT 1 FROM maintenance_photos m WHERE m.attachment_id=a.id)))",
                params![id, warranty_id], |r| r.get(0),
            )?;
            if foreign_relation {
                return Err(Error::new(
                    "IMAGE_OWNER",
                    "图片不属于这份保障，请重新选择图片",
                ));
            }
            let known: Option<(String, String, i64, String)> = tx
                .query_row(
                    "SELECT a.asset_id,a.hash,a.size,coalesce(wp.name,mp.name,ap.name,'图片') FROM attachments a LEFT JOIN warranty_photos wp ON wp.attachment_id=a.id LEFT JOIN maintenance_photos mp ON mp.attachment_id=a.id LEFT JOIN asset_photos ap ON ap.attachment_id=a.id WHERE a.id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            let (hash, size, name, new) = if let Some((owner, hash, size, name)) = known {
                if owner != asset_id {
                    return Err(Error::new("IMAGE_OWNER", "图片不属于这件物品"));
                }
                (hash, size, name, false)
            } else {
                let staged = self.staged(id)?;
                (staged.hash, staged.size as i64, staged.name, true)
            };
            if self.original(&hash)?.len() as i64 != size {
                return Err(Error::new("IMAGE_CORRUPT", "图片大小校验失败"));
            }
            prepared.push((id, hash, size, name, new));
        }
        tx.execute(
            "DELETE FROM warranty_photos WHERE warranty_id=?1",
            [warranty_id],
        )?;
        for (position, (id, hash, size, name, new)) in prepared.iter().enumerate() {
            if *new {
                tx.execute(
                    "INSERT INTO attachments(id,asset_id,file,hash,size) VALUES(?1,?2,?3,?3,?4)",
                    params![id, asset_id, hash, size],
                )?;
            }
            tx.execute(
                "INSERT INTO warranty_photos VALUES(?1,?2,?3,?4)",
                params![warranty_id, id, position as i64, name],
            )?;
        }
        Ok(())
    }
    pub fn photos(&self, id: &str) -> Result<Vec<Photo>> {
        let mut stmt=self.conn()?.prepare("SELECT attachment_id,name FROM asset_photos WHERE asset_id=?1 ORDER BY position,attachment_id")?;
        let rows = stmt
            .query_map([id], |r| {
                Ok(Photo {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
    pub fn cover(&self, id: &str) -> Result<Option<String>> {
        Ok(self
            .conn()?
            .query_row(
                "SELECT cover_id FROM asset_media WHERE asset_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }
}
