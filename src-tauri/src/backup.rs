use crate::{
    domain::{Error, Result},
    files::validate_file_name,
    storage::{check_db, sync_dir, Store, SCHEMA},
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    time::Duration,
};
/// Total payload a backup may carry. Archives are streamed, so this bounds
/// disk use when restoring an untrusted file, not memory.
pub(crate) const MAX_ARCHIVE: u64 = 32 * 1024 * 1024 * 1024;
/// Payload plus zip headers and the manifest.
const MAX_ARCHIVE_FILE: u64 = MAX_ARCHIVE + 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
const MAX_MANIFEST: u64 = 64 * 1024 * 1024;
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
/// Streams one regular (non-link) file through SHA-256 without buffering it.
pub(crate) fn file_digest(path: &Path, max: u64) -> Result<(u64, String)> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.len() > max {
        return Err(Error::new("BACKUP_LIMIT", "备份文件类型或大小超出限制"));
    }
    let mut hasher = Sha256::new();
    let size = std::io::copy(&mut File::open(path)?.take(max + 1), &mut hasher)?;
    if size > max {
        return Err(Error::new("BACKUP_LIMIT", "备份超出限制"));
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}
/// Hashes everything written through it, so each entry is read exactly once.
struct Tee<W: Write> {
    inner: W,
    hasher: Sha256,
}
impl<W: Write> Write for Tee<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}
fn entry_limit(name: &str) -> u64 {
    match name {
        "manifest.json" => MAX_MANIFEST,
        "data.sqlite" => MAX_ARCHIVE,
        _ => crate::files::MAX_IMAGE_BYTES as u64,
    }
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
    if v != 14 && !(allow_legacy && (1..=14).contains(&v)) {
        return Err(Error::new("SCHEMA_VERSION", "不支持此备份的数据库版本"));
    }
    let canonical = Connection::open_in_memory()?;
    canonical.execute_batch(SCHEMA)?;
    crate::storage::migrate_to(&canonical, v, &|_| Ok(()))?;
    if v == 14 {
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
        crate::wishlist::validate_dataset(&db, v)?;
    }
    if v >= 13 {
        crate::preferences::validate_dataset(&db)?;
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
            let (got_size, got_hash) = file_digest(
                &dir.join("files").join(&hash),
                crate::files::MAX_IMAGE_BYTES as u64,
            )?;
            if got_size as i64 != size || got_hash != hash {
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
            let (got_size, got_hash) = file_digest(
                &dir.join("files").join(&file),
                crate::files::MAX_IMAGE_BYTES as u64,
            )?;
            if hash != file || got_size as i64 != size || got_hash != hash {
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
        let mut stmt = self.conn()?.prepare(
            "SELECT DISTINCT file FROM attachments UNION SELECT hash FROM materials UNION SELECT file FROM wishlist_attachments ORDER BY file",
        )?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        if names.len() + 1 > MAX_ENTRIES {
            return Err(Error::new(
                "BACKUP_LIMIT",
                "图片数量超过备份上限（10 万个文件）",
            ));
        }
        // Originals are content-addressed and never rewritten with other bytes,
        // so they stream straight from the library; each hash is checked against
        // its name while writing, and the finished archive is re-validated below.
        let mut archive = tempfile::NamedTempFile::new_in(parent)?;
        let mut entries = BTreeMap::new();
        let mut total = 0u64;
        {
            let mut zip = zip::ZipWriter::new(archive.as_file_mut()).set_auto_large_file();
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            let mut add = |zip: &mut zip::ZipWriter<&mut File>, entry: String, source: &Path| {
                let limit = entry_limit(&entry);
                let meta = fs::symlink_metadata(source)?;
                if !meta.is_file() || meta.len() > limit {
                    return Err(Error::new("BACKUP_LIMIT", "备份文件类型或大小超出限制"));
                }
                zip.start_file(
                    entry.as_str(),
                    options.large_file(meta.len() >= u64::from(u32::MAX)),
                )?;
                let mut tee = Tee {
                    inner: &mut *zip,
                    hasher: Sha256::new(),
                };
                let size = std::io::copy(&mut File::open(source)?.take(limit + 1), &mut tee)?;
                let hash = format!("{:x}", tee.hasher.finalize());
                if size > limit {
                    return Err(Error::new("BACKUP_LIMIT", "备份文件大小超出限制"));
                }
                total += size;
                if total > MAX_ARCHIVE {
                    return Err(Error::new("BACKUP_LIMIT", "资料超过 32 GiB 备份上限"));
                }
                entries.insert(
                    entry,
                    Entry {
                        size,
                        hash: hash.clone(),
                    },
                );
                Ok(hash)
            };
            for name in &names {
                validate_file_name(name)?;
                let source = self.dataset().join("files").join(name);
                if !source.exists() {
                    return Err(Error::new(
                        "IMAGE_MISSING",
                        "有图片原图缺失，无法完成完整备份",
                    ));
                }
                if add(&mut zip, format!("files/{name}"), &source)? != *name {
                    return Err(Error::new(
                        "IMAGE_CORRUPT",
                        "有图片原图校验失败，无法完成完整备份",
                    ));
                }
            }
            add(
                &mut zip,
                "data.sqlite".into(),
                &stage.path().join("data.sqlite"),
            )?;
            let manifest = Manifest {
                format: 1,
                schema: 14,
                created_at: chrono::Utc::now().to_rfc3339(),
                entries: std::mem::take(&mut entries),
            };
            // Readers locate entries by name, so the manifest may come last.
            zip.start_file("manifest.json", options)?;
            zip.write_all(&serde_json::to_vec(&manifest)?)?;
            zip.finish()?;
        }
        archive.as_file().sync_all()?;
        drop(stage);
        // Validate the actual archive, not only the pre-archive snapshot.
        let verify = tempfile::tempdir_in(&self.root)?;
        unpack(archive.path(), verify.path())?;
        drop(verify);
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
    Ok(file_digest(path, MAX_ARCHIVE_FILE)?.1)
}
/// Copies an archive into `root` so later checks and restore read bytes that
/// cannot change underneath them.
pub(crate) fn freeze(archive: &Path, root: &Path) -> Result<tempfile::NamedTempFile> {
    let frozen = tempfile::NamedTempFile::new_in(root)?;
    let copied = std::io::copy(
        &mut File::open(archive)?.take(MAX_ARCHIVE_FILE + 1),
        &mut frozen.as_file(),
    )?;
    if copied > MAX_ARCHIVE_FILE {
        return Err(Error::new("BACKUP_LIMIT", "备份超出限制"));
    }
    frozen.as_file().sync_all()?;
    Ok(frozen)
}
pub(crate) fn unpack(path: &Path, dir: &Path) -> Result<Manifest> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() || meta.len() > MAX_ARCHIVE_FILE {
        return Err(Error::new("BACKUP_LIMIT", "备份文件类型或大小超出限制"));
    }
    let mut archive = zip::ZipArchive::new(File::open(path)?)?;
    if archive.len() > MAX_ENTRIES + 1 {
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
        let size = f.size();
        total = total
            .checked_add(size)
            .ok_or_else(|| Error::new("BACKUP_LIMIT", "备份超出限制"))?;
        if total > MAX_ARCHIVE + MAX_MANIFEST || size > entry_limit(&name) {
            return Err(Error::new("BACKUP_LIMIT", "备份超出解压限制"));
        }
        let (got, hash) = if name == "manifest.json" {
            let mut b = Vec::new();
            f.by_ref().take(size + 1).read_to_end(&mut b)?;
            let hash = format!("{:x}", Sha256::digest(&b));
            let got = b.len() as u64;
            manifest_bytes = Some(b);
            (got, hash)
        } else {
            let dest = dir.join(&name);
            fs::create_dir_all(dest.parent().unwrap())?;
            let mut tee = Tee {
                inner: File::create(&dest)?,
                hasher: Sha256::new(),
            };
            let got = std::io::copy(&mut f.by_ref().take(size + 1), &mut tee)?;
            tee.inner.sync_all()?;
            (got, format!("{:x}", tee.hasher.finalize()))
        };
        if got != size {
            return Err(Error::new("ARCHIVE_SIZE", "备份条目大小不符"));
        }
        observed.insert(name, Entry { size, hash });
    }
    let manifest: Manifest = serde_json::from_slice(
        &manifest_bytes.ok_or_else(|| Error::new("MANIFEST", "备份缺少清单"))?,
    )?;
    if manifest.format != 1 || !(1..=14).contains(&manifest.schema) {
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
    if dir.join("files").exists() {
        sync_dir(&dir.join("files"))?;
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

/// What a chosen backup contains, shown before the user confirms replacement.
/// The hash binds the later restore to exactly these checked bytes.
#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub hash: String,
    pub created_at: String,
    pub schema: u32,
    pub assets: i64,
    pub deleted_assets: i64,
    pub wishes: i64,
    pub maintenances: i64,
    pub warranties: i64,
    pub files: usize,
}

impl Store {
    /// Fully unpacks and validates into a scratch folder; the current library is untouched.
    pub fn inspect_backup(&self, archive: &Path) -> Result<Summary> {
        let frozen = freeze(archive, &self.root)?;
        let hash = archive_hash(frozen.path())?;
        let stage = tempfile::tempdir_in(&self.root)?;
        let manifest = unpack(frozen.path(), stage.path())?;
        let db = Connection::open_with_flags(
            stage.path().join("data.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let count = |sql: &str| -> Result<i64> { Ok(db.query_row(sql, [], |r| r.get(0))?) };
        let v = manifest.schema;
        Ok(Summary {
            hash,
            created_at: manifest.created_at.clone(),
            schema: v,
            assets: count("SELECT count(*) FROM assets")?,
            deleted_assets: if v >= 2 {
                count("SELECT count(*) FROM assets WHERE deleted_at IS NOT NULL")?
            } else {
                0
            },
            wishes: if v >= 11 {
                count("SELECT count(*) FROM wishlist_items")?
            } else {
                0
            },
            maintenances: if v >= 8 {
                count("SELECT count(*) FROM maintenances")?
            } else {
                0
            },
            warranties: if v >= 10 {
                count("SELECT count(*) FROM warranties")?
            } else {
                0
            },
            files: manifest
                .entries
                .keys()
                .filter(|k| k.starts_with("files/"))
                .count(),
        })
    }
}
