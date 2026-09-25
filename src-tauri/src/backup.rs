use crate::{
    domain::{Error, Result},
    files::{copy_synced, validate_file_name},
    storage::{check_db, digest, sync_dir, Store, SCHEMA},
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::Path,
    time::Duration,
};
const MAX_ARCHIVE: u64 = 100 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry {
    pub size: u64,
    pub hash: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Manifest {
    pub format: u32,
    pub schema: u32,
    pub created_at: String,
    pub entries: BTreeMap<String, Entry>,
}
impl From<zip::result::ZipError> for Error {
    fn from(_: zip::result::ZipError) -> Self {
        Self::new("ARCHIVE", "备份无法读取或写入")
    }
}
fn regular_bytes(path: &Path, max: u64) -> Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.len() > max {
        return Err(Error::new("BACKUP_LIMIT", "备份文件类型或大小超出限制"));
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(max + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(Error::new("BACKUP_LIMIT", "备份超出限制"));
    }
    Ok(bytes)
}
pub(crate) fn safe_entry(name: &str) -> Result<()> {
    if name == "data.sqlite" || name == "manifest.json" {
        return Ok(());
    }
    if let Some(file) = name.strip_prefix("files/") {
        validate_file_name(file)
    } else {
        Err(Error::new("ARCHIVE_PATH", "备份含非预期路径"))
    }
}
fn definitions(db: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut q=db.prepare("SELECT type,name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")?;
    let rows = q
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub(crate) fn validate_dataset(dir: &Path, allow_legacy: bool) -> Result<()> {
    let db = Connection::open_with_flags(
        dir.join("data.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;")?;
    let v: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v != 11 && !(allow_legacy && [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].contains(&v)) {
        return Err(Error::new("SCHEMA_VERSION", "不支持此备份的数据库版本"));
    }
    let canonical = Connection::open_in_memory()?;
    canonical.execute_batch(SCHEMA)?;
    crate::storage::migrate_to(&canonical, v, &|_| Ok(()))?;
    if v == 11 {
        check_db(&db)?;
    } else {
        let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        let app: i64 = db.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        if integrity != "ok" || app != 1347375955 {
            return Err(Error::new("DATABASE_FORMAT", "旧备份数据损坏"));
        }
    }
    if definitions(&db)? != definitions(&canonical)? {
        return Err(Error::new("DATABASE_SCHEMA", "备份结构不符合已知版本"));
    }
    let mut foreign = db.prepare("PRAGMA foreign_key_check")?;
    if foreign.query([])?.next()?.is_some() {
        return Err(Error::new("REFERENCE", "备份存在断开的资料引用"));
    }
    let mut assets = db.prepare("SELECT id,name,price_cents,purchase_date,revision FROM assets")?;
    let mut rows = assets.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let name: String = r.get(1)?;
        let price: Option<i64> = r.get(2)?;
        let date: Option<String> = r.get(3)?;
        let rev: i64 = r.get(4)?;
        if uuid::Uuid::parse_str(&id).is_err()
            || name.trim().is_empty()
            || name.chars().count() > 200
            || price.is_some_and(|v| !(0..=crate::domain::MAX_CENTS).contains(&v))
            || rev < 1
        {
            return Err(Error::new("DATA_CONSTRAINT", "备份含非法资产资料"));
        }
        if let Some(d) = date {
            crate::domain::date(&d)?;
        }
    }
    if v >= 3 {
        let mut stmt = db.prepare(
            "SELECT brand,model,serial_number,notes,created_at,updated_at FROM asset_profiles",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            crate::catalog::Details {
                brand: row.get(0)?,
                model: row.get(1)?,
                serial_number: row.get(2)?,
                notes: row.get(3)?,
            }
            .validate()?;
            for index in [4, 5] {
                if let Some(timestamp) = row.get::<_, Option<String>>(index)? {
                    chrono::DateTime::parse_from_rfc3339(&timestamp)
                        .map_err(|_| Error::new("DATA_CONSTRAINT", "建档或修改时间不合法"))?;
                }
            }
        }
    }
    if v >= 8 {
        crate::maintenance::validate_dataset(&db)?;
    }
    if v >= 10 {
        crate::warranty::validate_dataset(&db)?;
    }
    if v >= 11 {
        crate::wishlist::validate_dataset(&db)?;
    }
    if v >= 9 {
        let mut stmt = db.prepare("SELECT id,name,hash,size,created_at FROM materials")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (id, name, hash, size, created_at) in rows {
            if uuid::Uuid::parse_str(&id).is_err()
                || name.trim().is_empty()
                || name.chars().count() > 255
                || size <= 0
                || size > crate::files::MAX_IMAGE_BYTES as i64
                || chrono::DateTime::parse_from_rfc3339(&created_at).is_err()
            {
                return Err(Error::new("DATA_CONSTRAINT", "备份含非法素材资料"));
            }
            validate_file_name(&hash)?;
            let bytes = regular_bytes(
                &dir.join("files").join(&hash),
                crate::files::MAX_IMAGE_BYTES as u64,
            )?;
            if bytes.len() as i64 != size || digest(&bytes) != hash {
                return Err(Error::new("ATTACHMENT", "素材文件缺失或校验失败"));
            }
        }
    }
    if v >= 7 {
        crate::sales::validate_dataset(&db)?;
    }
    if v >= 6 {
        crate::lifecycle::validate_dataset(&db)?;
    }
    if v >= 5 {
        crate::taxonomy::validate_dataset(&db)?;
    }
    if v >= 4 {
        let invalid: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM asset_photos p JOIN attachments a ON a.id=p.attachment_id WHERE a.asset_id!=p.asset_id) OR EXISTS(SELECT 1 FROM asset_media m WHERE m.cover_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_photos p WHERE p.asset_id=m.asset_id AND p.attachment_id=m.cover_id))", [], |r| r.get(0))?;
        if invalid {
            return Err(Error::new("REFERENCE", "图片或封面不属于该资产"));
        }
    }
    if v >= 2 {
        let files_sql = if v >= 11 {
            "SELECT file,hash,size FROM attachments UNION ALL SELECT file,hash,size FROM wishlist_attachments"
        } else {
            "SELECT file,hash,size FROM attachments"
        };
        let mut stmt = db.prepare(files_sql)?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (file, hash, size) = row?;
            validate_file_name(&file)?;
            let bytes = regular_bytes(
                &dir.join("files").join(&file),
                crate::files::MAX_IMAGE_BYTES as u64,
            )?;
            if hash != file || bytes.len() as i64 != size || digest(&bytes) != hash {
                return Err(Error::new("ATTACHMENT", "备份附件缺失或校验失败"));
            }
        }
    }
    Ok(())
}
impl Store {
    pub fn backup(&self, destination: Option<&Path>) -> Result<Option<String>> {
        let Some(destination) = destination else {
            return Ok(None);
        };
        if destination.exists() {
            return Err(Error::new("EXISTS", "目标备份已存在，请另选文件名"));
        }
        let parent = destination
            .parent()
            .ok_or_else(|| Error::new("PATH", "备份位置无效"))?;
        let stage = tempfile::tempdir_in(&self.root)?;
        fs::create_dir(stage.path().join("files"))?;
        self.hit("backup.before_snapshot")?;
        {
            let mut target = Connection::open(stage.path().join("data.sqlite"))?;
            rusqlite::backup::Backup::new(self.conn()?, &mut target)?.run_to_completion(
                128,
                Duration::from_millis(1),
                None,
            )?;
        }
        self.hit("backup.after_snapshot")?;
        let mut entries = BTreeMap::new();
        let mut stmt = self.conn()?.prepare(
            "SELECT DISTINCT file FROM attachments UNION SELECT hash FROM materials UNION SELECT file FROM wishlist_attachments ORDER BY file",
        )?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for name in names {
            validate_file_name(&name)?;
            copy_synced(
                &self.dataset().join("files").join(&name),
                &stage.path().join("files").join(&name),
            )?;
            let b = regular_bytes(
                &stage.path().join("files").join(&name),
                crate::files::MAX_IMAGE_BYTES as u64,
            )?;
            entries.insert(
                format!("files/{name}"),
                Entry {
                    size: b.len() as u64,
                    hash: digest(&b),
                },
            );
        }
        let b = regular_bytes(&stage.path().join("data.sqlite"), MAX_ARCHIVE)?;
        entries.insert(
            "data.sqlite".into(),
            Entry {
                size: b.len() as u64,
                hash: digest(&b),
            },
        );
        validate_dataset(stage.path(), false)?;
        if entries.values().map(|e| e.size).sum::<u64>() > MAX_ARCHIVE || entries.len() > 1023 {
            return Err(Error::new(
                "BACKUP_LIMIT",
                "验证备份限 100 MiB 和 1023 个文件",
            ));
        }
        let manifest = Manifest {
            format: 1,
            schema: 11,
            created_at: chrono::Utc::now().to_rfc3339(),
            entries,
        };
        let mut archive = tempfile::NamedTempFile::new_in(parent)?;
        {
            let mut zip = zip::ZipWriter::new(archive.as_file_mut());
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("manifest.json", options)?;
            zip.write_all(&serde_json::to_vec(&manifest)?)?;
            for name in manifest.entries.keys() {
                zip.start_file(name, options)?;
                std::io::copy(&mut File::open(stage.path().join(name))?, &mut zip)?;
            }
            zip.finish()?;
        }
        archive.as_file().sync_all()?;
        // Validate the actual archive, not only the pre-archive snapshot.
        let verify = tempfile::tempdir_in(&self.root)?;
        unpack(archive.path(), verify.path())?;
        self.hit("backup.before_publish")?;
        archive
            .persist_noclobber(destination)
            .map_err(|e| e.error)?;
        sync_dir(parent)?;
        Ok(Some(
            destination
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
        ))
    }
}
pub fn archive_hash(path: &Path) -> Result<String> {
    Ok(digest(&regular_bytes(path, MAX_ARCHIVE + 1024 * 1024)?))
}
pub(crate) fn unpack(path: &Path, dir: &Path) -> Result<Manifest> {
    let bytes = regular_bytes(path, MAX_ARCHIVE + 1024 * 1024)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))?;
    if archive.len() > 1024 {
        return Err(Error::new("BACKUP_LIMIT", "备份条目过多"));
    }
    let mut observed = BTreeMap::new();
    let mut total = 0u64;
    let mut manifest_bytes = None;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i)?;
        let name = f.name().to_owned();
        safe_entry(&name)?;
        if f.is_dir()
            || f.unix_mode()
                .is_some_and(|m| m & 0o170000 != 0 && m & 0o170000 != 0o100000)
            || observed.contains_key(&name)
        {
            return Err(Error::new("ARCHIVE_PATH", "备份含链接、目录或重复条目"));
        }
        total = total
            .checked_add(f.size())
            .ok_or_else(|| Error::new("BACKUP_LIMIT", "备份超出限制"))?;
        if total > MAX_ARCHIVE + 1024 * 1024
            || f.size() > MAX_ARCHIVE
            || name == "manifest.json" && f.size() > 1024 * 1024
        {
            return Err(Error::new("BACKUP_LIMIT", "备份超出解压限制"));
        }
        let size = f.size();
        let mut b = Vec::new();
        f.by_ref().take(size + 1).read_to_end(&mut b)?;
        if b.len() as u64 != size {
            return Err(Error::new("ARCHIVE_SIZE", "备份条目大小不符"));
        }
        observed.insert(
            name.clone(),
            Entry {
                size,
                hash: digest(&b),
            },
        );
        if name == "manifest.json" {
            manifest_bytes = Some(b);
        } else {
            let dest = dir.join(&name);
            fs::create_dir_all(dest.parent().unwrap())?;
            let mut file = File::create(dest)?;
            file.write_all(&b)?;
            file.sync_all()?;
        }
    }
    let manifest: Manifest = serde_json::from_slice(
        &manifest_bytes.ok_or_else(|| Error::new("MANIFEST", "备份缺少清单"))?,
    )?;
    if manifest.format != 1 || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].contains(&manifest.schema) {
        return Err(Error::new("BACKUP_VERSION", "备份版本暂不支持"));
    }
    observed.remove("manifest.json");
    if manifest.entries.len() != observed.len() || !manifest.entries.contains_key("data.sqlite") {
        return Err(Error::new("MANIFEST", "备份清单不完整"));
    }
    for (name, entry) in &manifest.entries {
        safe_entry(name)?;
        let got = observed
            .get(name)
            .ok_or_else(|| Error::new("MANIFEST", "备份缺少文件"))?;
        if entry.size != got.size || entry.hash != got.hash {
            return Err(Error::new("CHECKSUM", "备份校验失败"));
        }
    }
    validate_dataset(dir, true)?;
    let db = Connection::open_with_flags(
        dir.join("data.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let v: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v != manifest.schema {
        return Err(Error::new("MANIFEST", "清单与数据库版本不一致"));
    }
    sync_dir(dir)?;
    Ok(manifest)
}
