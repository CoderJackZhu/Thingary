use crate::{
    backup_task::Cancellation,
    domain::{Error, Result},
    files::validate_file_name,
    storage::{
        check_db, is_link, persist_retry, reject_links, sync_dir, temp_dir_in, temp_file_in, Store,
        SCHEMA, SCHEMA_VERSION,
    },
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
/// Total payload a backup may carry. Archives are streamed, so this bounds
/// disk use when restoring an untrusted file, not memory.
pub(crate) const MAX_ARCHIVE: u64 = 32 * 1024 * 1024 * 1024;
/// Payload plus zip headers and the manifest.
pub(crate) const MAX_ARCHIVE_FILE: u64 = MAX_ARCHIVE + 256 * 1024 * 1024;
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
    file_digest_with_cancel(path, max, &Cancellation::default())
}

pub fn file_digest_with_cancel(
    path: &Path,
    max: u64,
    cancel: &Cancellation,
) -> Result<(u64, String)> {
    cancel.check()?;
    reject_links(path)?;
    let meta = fs::symlink_metadata(path)?;
    if is_link(&meta, path)? || !meta.is_file() || meta.len() > max {
        return Err(Error::new("BACKUP_LIMIT", "备份文件类型或大小超出限制"));
    }
    let mut hasher = Sha256::new();
    let size = cancel.copy(&mut File::open(path)?.take(max + 1), &mut hasher)?;
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
    validate_dataset_with_cancel(dir, allow_legacy, &Cancellation::default())
}

fn validate_dataset_with_cancel(
    dir: &Path,
    allow_legacy: bool,
    cancel: &Cancellation,
) -> Result<()> {
    cancel.check()?;
    reject_links(dir)?;
    for name in ["files", "data.sqlite", "data.sqlite-wal", "data.sqlite-shm"] {
        reject_links(&dir.join(name))?;
    }
    let db = Connection::open_with_flags(
        dir.join("data.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;")?;
    let v: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v != SCHEMA_VERSION && !(allow_legacy && (1..=SCHEMA_VERSION).contains(&v)) {
        return Err(Error::new("SCHEMA_VERSION", "不支持此备份的数据库版本"));
    }
    let canonical = Connection::open_in_memory()?;
    canonical.execute_batch(SCHEMA)?;
    crate::storage::migrate_to(&canonical, v, &|_| Ok(()))?;
    let linked_schema = v >= 32 && crate::storage::has_link_trash_schema(&db)?;
    if v == 32 && linked_schema {
        // The unpublished subscription branch also used 32. Accept only its
        // exact canonical definitions, alongside main's table-free version.
        canonical.execute_batch(include_str!("x09.sql"))?;
        canonical.execute_batch("PRAGMA user_version=32;")?;
    }
    if v == SCHEMA_VERSION {
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
        cancel.check()?;
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
            return Err(Error::new("DATA_CONSTRAINT", "备份含非法物品资料"));
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
            cancel.check()?;
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
    if v >= 15 {
        crate::wealth::validate_dataset(&db)?;
    }
    if v >= 16 {
        crate::expenses::validate_dataset(&db)?;
        if v >= 29 {
            crate::plan_income::validate_dataset(&db)?;
        }
        if v >= 36 {
            crate::plan_profile::validate_dataset(&db)?;
        } else if v >= 30 {
            crate::plan_migration::validate_legacy(&db)?;
        }
    }
    if v >= 39 {
        crate::cash_movement::validate_dataset(&db)?;
        crate::planning_flow_review::validate_dataset(&db)?;
    }
    if v >= 42 {
        crate::savings_goals::validate_dataset(&db)?;
    }
    if v >= 38 {
        crate::plan_assumptions::validate_dataset(&db)?;
    }
    if v >= 37 {
        crate::investment_review::validate_dataset(&db)?;
    }
    if v >= 17 {
        crate::recurring::validate_dataset(&db)?;
    }
    if v >= 19 {
        crate::virtual_assets::validate_dataset(&db)?;
    }
    if v >= 34 {
        crate::financial_import::validate_dataset(&db)?;
    }
    if linked_schema {
        crate::link::validate_dataset(&db)?;
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
            cancel.check()?;
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
            let (got_size, got_hash) = file_digest_with_cancel(
                &dir.join("files").join(&hash),
                crate::files::MAX_IMAGE_BYTES as u64,
                cancel,
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
            return Err(Error::new("REFERENCE", "图片或封面不属于该物品"));
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
            cancel.check()?;
            let (file, hash, size) = row?;
            validate_file_name(&file)?;
            let (got_size, got_hash) = file_digest_with_cancel(
                &dir.join("files").join(&file),
                crate::files::MAX_IMAGE_BYTES as u64,
                cancel,
            )?;
            if hash != file || got_size as i64 != size || got_hash != hash {
                return Err(Error::new("ATTACHMENT", "备份附件缺失或校验失败"));
            }
        }
    }
    cancel.check()?;
    Ok(())
}
/// Owns a frozen SQLite snapshot and hard-linked immutable images. No live
/// Store or SQLite connection crosses into the packing thread.
pub struct PreparedBackup {
    stage: tempfile::TempDir,
    output_parent: PathBuf,
    names: Vec<String>,
}

fn private_temp_dir(parent: &Path) -> Result<tempfile::TempDir> {
    reject_links(parent)?;
    let dir = temp_dir_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir)
}

impl Store {
    /// Freeze only the SQLite database and image references while serialized.
    /// A failed hard link fails this attempt; live image paths are never used
    /// by the later packing phase and large files are never copied here.
    pub fn prepare_backup(&self, staging: &Path, cancel: &Cancellation) -> Result<PreparedBackup> {
        cancel.check()?;
        reject_links(staging)?;
        reject_links(&self.dataset())?;
        reject_links(&self.dataset().join("files"))?;
        let stage = private_temp_dir(staging)?;
        self.hit("backup.before_snapshot")?;
        {
            let mut target = Connection::open(stage.path().join("data.sqlite"))?;
            let backup = rusqlite::backup::Backup::new(self.conn()?, &mut target)?;
            loop {
                cancel.check()?;
                match backup.step(128)? {
                    rusqlite::backup::StepResult::Done => break,
                    rusqlite::backup::StepResult::More => {}
                    _ => std::thread::sleep(Duration::from_millis(1)),
                }
            }
        }
        cancel.check()?;
        self.hit("backup.after_snapshot")?;
        let snapshot = Connection::open_with_flags(
            stage.path().join("data.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let mut stmt = snapshot.prepare(
            "SELECT DISTINCT file FROM attachments UNION SELECT hash FROM materials UNION SELECT file FROM wishlist_attachments ORDER BY file",
        )?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if names.len() + 1 > MAX_ENTRIES {
            return Err(Error::new(
                "BACKUP_LIMIT",
                "图片数量超过备份上限（10 万个文件）",
            ));
        }
        let files = stage.path().join("files");
        fs::create_dir(&files)?;
        for name in &names {
            cancel.check()?;
            validate_file_name(name)?;
            let source = self.dataset().join("files").join(name);
            reject_links(&source)?;
            let meta = fs::symlink_metadata(&source)
                .map_err(|_| Error::new("IMAGE_MISSING", "有图片原图缺失，无法完成完整备份"))?;
            if is_link(&meta, &source)?
                || !meta.is_file()
                || meta.len() > crate::files::MAX_IMAGE_BYTES as u64
            {
                return Err(Error::new("BACKUP_LIMIT", "图片文件类型或大小超出限制"));
            }
            pin_original(&source, &files.join(name), meta.len(), |from, to| {
                fs::hard_link(from, to)
            })?;
        }
        cancel.check()?;
        Ok(PreparedBackup {
            stage,
            output_parent: staging.to_owned(),
            names,
        })
    }

    /// Compatibility wrapper for internal serialized restore protection and tests.
    pub fn build_backup(&self, staging: &Path) -> Result<tempfile::NamedTempFile> {
        let cancel = Cancellation::default();
        self.prepare_backup(staging, &cancel)?.pack(&cancel)
    }

    fn publish_plaintext(&self, staged: &Path, destination: &Path) -> Result<()> {
        let temp = stage_plaintext(staged, destination, &Cancellation::default())?;
        self.hit("backup.before_publish")?;
        publish_staged(temp, destination)
    }

    /// The plaintext export path: build and validate in private staging, then
    /// publish. Kept for the pre-restore protection copy and tests.
    pub fn backup(&self, destination: Option<&Path>) -> Result<Option<String>> {
        let Some(destination) = destination else {
            return Ok(None);
        };
        if destination.exists() {
            return Err(Error::new("EXISTS", "目标备份已存在，请另选文件名"));
        }
        let staging = crate::backup_security::ensure_staging(&self.root)?;
        let session = crate::storage::temp_dir_in(&staging)?;
        let result = (|| {
            let archive = self.build_backup(session.path())?;
            self.publish_plaintext(archive.path(), destination)?;
            Ok(Some(
                destination
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
            ))
        })();
        drop(session);
        result
    }

    /// The encrypted export path: the plaintext ZIP exists only inside private
    /// staging; the destination directory only ever sees ciphertext temporary
    /// files and the finished `.age` artifact.
    pub fn backup_encrypted(
        &self,
        recipient: &age::x25519::Recipient,
        destination: &Path,
    ) -> Result<Option<String>> {
        if destination.exists() {
            return Err(Error::new("EXISTS", "目标备份已存在，请另选文件名"));
        }
        let staging = crate::backup_security::ensure_staging(&self.root)?;
        let session = crate::storage::temp_dir_in(&staging)?;
        let result = (|| {
            let archive = self.build_backup(session.path())?;
            self.hit("backup.before_publish")?;
            crate::backup_crypto::encrypt_to(recipient, archive.path(), destination)?;
            Ok(Some(
                destination
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
            ))
        })();
        drop(session);
        result
    }
}
impl PreparedBackup {
    /// May run on a blocking background thread; all inputs are independently pinned.
    pub fn pack(self, cancel: &Cancellation) -> Result<tempfile::NamedTempFile> {
        cancel.check()?;
        let mut archive = temp_file_in(&self.output_parent)?;
        let archive_path = archive.path().to_path_buf();
        let mut entries = BTreeMap::new();
        let mut total = 0u64;
        {
            let mut zip = zip::ZipWriter::new(archive.as_file_mut()).set_auto_large_file();
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            let mut add = |zip: &mut zip::ZipWriter<&mut File>, entry: String, source: &Path| {
                cancel.check()?;
                let limit = entry_limit(&entry);
                reject_links(source)?;
                let meta = fs::symlink_metadata(source)?;
                if is_link(&meta, source)? || !meta.is_file() || meta.len() > limit {
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
                let size = cancel.copy(&mut File::open(source)?.take(limit + 1), &mut tee)?;
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
            for name in &self.names {
                cancel.check()?;
                validate_file_name(name)?;
                let source = self.stage.path().join("files").join(name);
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
                &self.stage.path().join("data.sqlite"),
            )?;
            let manifest = Manifest {
                format: 1,
                schema: SCHEMA_VERSION as u32,
                created_at: chrono::Utc::now().to_rfc3339(),
                entries: std::mem::take(&mut entries),
            };
            // Readers locate entries by name, so the manifest may come last.
            zip.start_file("manifest.json", options)?;
            zip.write_all(&serde_json::to_vec(&manifest)?)?;
            cancel.check()?;
            zip.finish()?;
        }
        cancel.check()?;
        archive.as_file().sync_all()?;
        // Validate the actual archive, not only the pre-archive snapshot.
        let verify = private_temp_dir(&self.output_parent)?;
        unpack_with_cancel(&archive_path, verify.path(), cancel)?;
        drop(verify);
        Ok(archive)
    }
}

/// Write a same-directory temporary only; publication is a separate guarded step.
pub fn stage_plaintext(
    staged: &Path,
    destination: &Path,
    cancel: &Cancellation,
) -> Result<tempfile::NamedTempFile> {
    cancel.check()?;
    reject_links(staged)?;
    reject_links(destination)?;
    let parent = destination
        .parent()
        .ok_or_else(|| Error::new("PATH", "备份位置无效"))?;
    reject_links(parent)?;
    if destination.exists() {
        return Err(Error::new("EXISTS", "目标备份已存在，请另选文件名"));
    }
    let mut temp = temp_file_in(parent)?;
    cancel.copy(&mut File::open(staged)?, temp.as_file_mut())?;
    temp.as_file().sync_all()?;
    cancel.check()?;
    Ok(temp)
}

/// The caller linearizes cancellation and policy checks before this short step.
pub fn publish_staged(temp: tempfile::NamedTempFile, destination: &Path) -> Result<()> {
    reject_links(destination)?;
    let parent = destination
        .parent()
        .ok_or_else(|| Error::new("PATH", "备份位置无效"))?;
    reject_links(parent)?;
    persist_retry(temp, destination, true)?;
    sync_dir(parent)?;
    Ok(())
}

pub fn archive_hash(path: &Path) -> Result<String> {
    Ok(file_digest(
        path,
        MAX_ARCHIVE_FILE + crate::backup_crypto::MAX_CIPHER_OVERHEAD,
    )?
    .1)
}
/// Copies an archive into `root` so later checks and restore read bytes that
/// cannot change underneath them. `max` bounds the accepted size.
/// Pins one managed original for the backup: a hard link where the platform allows it,
/// otherwise a byte copy. Android's SELinux policy denies `link` on app data, and some file
/// systems have no hard links at all. Originals are named by the SHA-256 of their bytes and
/// never rewritten, so a copy pins exactly the same content; its size is checked against the
/// length validated just before.
/// ponytail: the copy path doubles the temporary disk use of the images while a backup runs.
fn pin_original(
    source: &Path,
    target: &Path,
    expected_len: u64,
    link: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<()> {
    let failed = || {
        Error::new(
            "BACKUP_PREPARE",
            "无法安全固定图片原图，请检查本机资料目录权限与文件系统后重试",
        )
    };
    if link(source, target).is_ok() {
        return Ok(());
    }
    fs::copy(source, target).map_err(|_| failed())?;
    if fs::metadata(target).map(|meta| meta.len()).ok() != Some(expected_len) {
        let _ = fs::remove_file(target);
        return Err(failed());
    }
    Ok(())
}

pub(crate) fn freeze_with(
    archive: &Path,
    root: &Path,
    max: u64,
) -> Result<tempfile::NamedTempFile> {
    freeze_with_cancel(archive, root, max, &Cancellation::default())
}

pub fn freeze_with_cancel(
    archive: &Path,
    root: &Path,
    max: u64,
    cancel: &Cancellation,
) -> Result<tempfile::NamedTempFile> {
    cancel.check()?;
    reject_links(archive)?;
    reject_links(root)?;
    let staging = crate::backup_security::ensure_staging(root)?;
    let frozen = temp_file_in(&staging)?;
    let copied = cancel.copy(
        &mut File::open(archive)?.take(max + 1),
        &mut frozen.as_file(),
    )?;
    if copied > max {
        return Err(Error::new("BACKUP_LIMIT", "备份超出限制"));
    }
    frozen.as_file().sync_all()?;
    cancel.check()?;
    Ok(frozen)
}

/// Freezes a plaintext archive with the standard ZIP limits.
pub(crate) fn freeze(archive: &Path, root: &Path) -> Result<tempfile::NamedTempFile> {
    freeze_with(archive, root, MAX_ARCHIVE_FILE)
}
pub(crate) fn unpack(path: &Path, dir: &Path) -> Result<Manifest> {
    unpack_with_cancel(path, dir, &Cancellation::default())
}

fn unpack_with_cancel(path: &Path, dir: &Path, cancel: &Cancellation) -> Result<Manifest> {
    cancel.check()?;
    reject_links(dir)?;
    reject_links(path)?;
    let meta = fs::symlink_metadata(path)?;
    if is_link(&meta, path)? || !meta.is_file() || meta.len() > MAX_ARCHIVE_FILE {
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
        cancel.check()?;
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
            let mut tee = Tee {
                inner: Vec::new(),
                hasher: Sha256::new(),
            };
            let got = cancel.copy(&mut f.by_ref().take(size + 1), &mut tee)?;
            let hash = format!("{:x}", tee.hasher.finalize());
            manifest_bytes = Some(tee.inner);
            (got, hash)
        } else {
            let dest = dir.join(&name);
            reject_links(dest.parent().unwrap())?;
            reject_links(&dest)?;
            fs::create_dir_all(dest.parent().unwrap())?;
            let mut tee = Tee {
                inner: File::create(&dest)?,
                hasher: Sha256::new(),
            };
            let got = cancel.copy(&mut f.by_ref().take(size + 1), &mut tee)?;
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
    if manifest.format != 1 || !(1..=SCHEMA_VERSION as u32).contains(&manifest.schema) {
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
    validate_dataset_with_cancel(dir, true, cancel)?;
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
    pub accounts: i64,
    pub savings_goals: i64,
    pub snapshots: i64,
    pub expenses: i64,
    pub plans: i64,
    pub payments: i64,
    pub virtual_assets: i64,
    /// Stored-value facts (schema 22 and newer); zero on older backups.
    pub virtual_topups: i64,
    /// Linked-subscription trash groups (schema 33, or the unpublished 32).
    pub link_groups: i64,
    pub cash_movements: i64,
    pub investment_reviews: i64,
    pub assumption_checks: i64,
    pub import_mappings: i64,
    pub import_receipts: i64,
    pub files: usize,
    /// Facts are preserved; legacy planning time and future income require new confirmation.
    pub planning_conditions_reset: bool,
}

impl Store {
    /// Fully unpacks and validates into a scratch folder; the current library is untouched.
    pub fn inspect_backup(&self, archive: &Path) -> Result<Summary> {
        let frozen = freeze(archive, &self.root)?;
        self.inspect_frozen(frozen.path())
    }

    /// Inspects an already-frozen archive. The caller owns the frozen file and
    /// its lifecycle; the hash binds later restore steps to these exact bytes.
    pub fn inspect_frozen(&self, frozen: &Path) -> Result<Summary> {
        inspect_frozen_with(frozen, &self.root, &Cancellation::default())
    }
}

pub fn inspect_frozen_with(frozen: &Path, root: &Path, cancel: &Cancellation) -> Result<Summary> {
    cancel.check()?;
    let hash = file_digest_with_cancel(frozen, MAX_ARCHIVE_FILE, cancel)?.1;
    let staging = crate::backup_security::ensure_staging(root)?;
    let stage = private_temp_dir(&staging)?;
    let manifest = unpack_with_cancel(frozen, stage.path(), cancel)?;
    let db = Connection::open_with_flags(
        stage.path().join("data.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let count = |sql: &str| -> Result<i64> {
        cancel.check()?;
        Ok(db.query_row(sql, [], |r| r.get(0))?)
    };
    let v = manifest.schema;
    Ok(Summary {
        hash,
        created_at: manifest.created_at.clone(),
        schema: v,
        savings_goals: if v >= 42 {
            count("SELECT count(*) FROM savings_goals")?
        } else {
            0
        },
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
        accounts: if v >= 15 {
            count("SELECT count(*) FROM fin_accounts")?
        } else {
            0
        },
        snapshots: if v >= 15 {
            count("SELECT count(*) FROM fin_snapshots")?
        } else {
            0
        },
        expenses: if v >= 16 {
            count("SELECT count(*) FROM expenses")?
        } else {
            0
        },
        plans: if v >= 17 {
            count("SELECT count(*) FROM recurring_plans")?
        } else {
            0
        },
        payments: if v >= 17 {
            count("SELECT count(*) FROM plan_payments")?
        } else {
            0
        },
        virtual_assets: if v >= 19 {
            count("SELECT count(*) FROM virtual_assets")?
        } else {
            0
        },
        virtual_topups: if v >= 22 {
            count("SELECT count(*) FROM virtual_topups")?
        } else {
            0
        },
        import_mappings: if v >= 34 {
            count("SELECT count(*) FROM import_external_key")?
        } else {
            0
        },
        import_receipts: if v >= 34 {
            count("SELECT count(*) FROM import_receipt")?
        } else {
            0
        },
        cash_movements: if v >= 39 {
            db.query_row("SELECT COUNT(*) FROM cash_movements", [], |r| r.get(0))?
        } else {
            0
        },
        investment_reviews: if v >= 37 {
            db.query_row("SELECT COUNT(*) FROM investment_flows", [], |r| r.get(0))?
        } else {
            0
        },
        assumption_checks: if v >= 38 {
            db.query_row("SELECT COUNT(*) FROM plan_assumption_checks", [], |r| {
                r.get(0)
            })?
        } else {
            0
        },
        link_groups: if v >= 32 && crate::storage::has_link_trash_schema(&db)? {
            count("SELECT count(*) FROM link_trash_groups")?
        } else {
            0
        },
        planning_conditions_reset: (30..36).contains(&v)
            && crate::plan_migration::requires_reset(&db)?,
        files: manifest
            .entries
            .keys()
            .filter(|k| k.starts_with("files/"))
            .count(),
    })
}

#[cfg(test)]
mod v3_roundtrip_tests {
    use super::*;
    #[test]
    fn staged_backup_inspect_and_restore_roundtrip() {
        let root = tempfile::tempdir().unwrap();
        let mut store = Store::open(root.path()).unwrap();
        store
            .save(
                &crate::domain::Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构物品".into(),
                    price_cents: None,
                    purchase_date: None,
                },
                "2026-10-15",
            )
            .unwrap();
        let dest = root.path().join("out.thingary");
        let name = store.backup(Some(&dest)).unwrap();
        assert!(name.is_some());
        assert!(dest.exists());
        let info = store.inspect_backup(&dest).unwrap();
        store
            .restore(&dest, &info.hash, &store.generation())
            .unwrap();
    }
}

#[cfg(test)]
mod pin_original_tests {
    use super::*;

    #[test]
    fn falls_back_to_a_copy_when_hard_links_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let (source, target) = (dir.path().join("source"), dir.path().join("target"));
        fs::write(&source, b"fictional original").unwrap();
        pin_original(&source, &target, 18, |_, _| {
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
        })
        .unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"fictional original");
    }

    #[test]
    fn prefers_the_hard_link_and_rejects_a_copy_of_the_wrong_size() {
        let dir = tempfile::tempdir().unwrap();
        let (source, target) = (dir.path().join("source"), dir.path().join("target"));
        fs::write(&source, b"fictional original").unwrap();
        pin_original(&source, &target, 18, |from, to| fs::hard_link(from, to)).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"fictional original");
        let other = dir.path().join("other");
        let refused = |_: &Path, _: &Path| Err(std::io::Error::from(std::io::ErrorKind::Other));
        assert_eq!(
            pin_original(&source, &other, 99, refused).unwrap_err().code,
            "BACKUP_PREPARE"
        );
        assert!(
            !other.exists(),
            "a wrong-sized copy must not be left behind"
        );
    }
}
