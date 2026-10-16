use crate::{
    backup_security::{Mode, Snapshot},
    domain::{Error, Result},
    storage::{is_link, reject_links, remove_file_retry, rename_retry, sync_dir, Store},
};
use chrono::Timelike;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    path::PathBuf,
    sync::atomic::{AtomicI64, Ordering},
};

/// Automatic backups keep this many dated archives per location (D20 rule 4).
pub const KEEP: usize = 7;
/// Archive extension for both manual and automatic backups.
pub const EXT: &str = ".thingary";
/// Extension of encrypted automatic backups.
pub const EXT_AGE: &str = ".thingary.age";
/// `^物谱自动备份-\d{4}-\d{2}-\d{2}\.thingary$` (legacy) or the unique
/// `物谱自动备份-YYYY-MM-DD-HHMM[SSnnnnnnnnn]-hex6.thingary[.age]`.
/// New names include seconds/nanoseconds; the minute-only names remain valid.
/// Same-day names never overwrite during key rotation. Only these
/// are listed, pruned or restorable, so cleanup can never remove a user's own
/// files; random temporaries never match.
pub fn is_auto_backup_name(name: &str) -> bool {
    date_of(name).is_some()
}
/// The local calendar day encoded in an archive name, if the name is ours.
pub fn date_of(name: &str) -> Option<&str> {
    let date = name.strip_prefix("物谱自动备份-")?;
    let date = date
        .strip_suffix(EXT_AGE)
        .or_else(|| date.strip_suffix(EXT))?;
    let b = date.as_bytes();
    if !matches!(b.len(), 10 | 22 | 33) {
        return None;
    }
    let day_ok = |b: &[u8]| {
        b.len() == 10
            && b.iter().enumerate().all(|(i, &c)| {
                if matches!(i, 4 | 7) {
                    c == b'-'
                } else {
                    c.is_ascii_digit()
                }
            })
    };
    if !day_ok(&b[..10]) {
        return None;
    }
    if b.len() != 10 {
        let digits = if b.len() == 22 { 4 } else { 15 };
        let tail = &b[10..];
        let time_ok = tail[0] == b'-'
            && tail[1..=digits].iter().all(u8::is_ascii_digit)
            && tail[digits + 1] == b'-';
        let suffix_ok = tail[digits + 2..]
            .iter()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
        if !time_ok || !suffix_ok {
            return None;
        }
    }
    Some(&date[..10])
}
pub fn settings_path(root: &Path) -> PathBuf {
    root.join("auto-backup.json")
}
pub fn marker_path(root: &Path) -> PathBuf {
    root.join("auto-backup-pending")
}
pub fn backup_dir(root: &Path) -> PathBuf {
    root.join("auto-backups")
}
/// Writes the change marker recording the worker session and library write
/// count it covers. A backup success may only clear the marker when its
/// frozen snapshot already covers that count, so writes landing after the
/// snapshot stay pending.
pub fn write_marker(root: &Path, session: &str, changes: u64) -> Result<()> {
    crate::storage::atomic_write(
        &marker_path(root),
        &serde_json::to_vec(&serde_json::json!({ "session": session, "changes": changes }))?,
    )
}
/// Removes the marker only when the completed backup's snapshot covers every
/// pending change. A marker left by an earlier worker session is always
/// covered: any fresh full snapshot includes those changes. Legacy
/// content-less markers clear as before.
pub fn clear_marker_if_covered(
    root: &Path,
    current_session: &str,
    snapshot_changes: u64,
) -> Result<()> {
    let marker = marker_path(root);
    let Ok(bytes) = fs::read(&marker) else {
        return Ok(());
    };
    let value = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
    let covered = match value
        .as_ref()
        .and_then(|v| v.get("session"))
        .and_then(|s| s.as_str())
    {
        Some(session) if session == current_session => value
            .as_ref()
            .and_then(|v| v.get("changes"))
            .and_then(|c| c.as_u64())
            .map(|pending| pending <= snapshot_changes)
            .unwrap_or(true),
        Some(_) => true,
        None => true,
    };
    if covered {
        remove_file_retry(&marker)?;
    }
    Ok(())
}
/// A unique automatic backup name for today. Unique names mean a rotation or a
/// same-day retry never overwrites the previous good archive.
pub fn unique_name(date: &str, encrypted: bool) -> String {
    // A coarse host clock may return the same instant more than once. Keep
    // names strictly increasing within this process, independently of UUIDs.
    static LAST_NANOS: AtomicI64 = AtomicI64::new(0);
    let tick = chrono::Local::now()
        .timestamp_nanos_opt()
        .unwrap_or_default();
    let previous = LAST_NANOS
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |last| {
            Some(tick.max(last.saturating_add(1)))
        })
        .unwrap();
    let instant = chrono::DateTime::from_timestamp_nanos(tick.max(previous.saturating_add(1)))
        .with_timezone(&chrono::Local);
    let now = instant.format("%H%M%S%f");
    let suffix: String = (0..6)
        .map(|_| {
            let n = uuid::Uuid::new_v4().as_simple().to_string();
            n.chars().next().unwrap_or('0')
        })
        .collect();
    let ext = if encrypted { EXT_AGE } else { EXT };
    format!("物谱自动备份-{date}-{now}-{suffix}{ext}")
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Failure {
    pub at: String,
    pub message: String,
}
/// Machine-local settings and outcome state; a damaged or missing file reads
/// as the defaults (enabled), never as a reason to stop backing up.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub extra_dir: Option<String>,
    #[serde(default)]
    pub last_success_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<Failure>,
    #[serde(default)]
    pub extra_last_at: Option<String>,
    #[serde(default)]
    pub extra_last_error: Option<Failure>,
}
fn default_enabled() -> bool {
    true
}
impl Settings {
    pub fn load(root: &Path) -> Self {
        fs::read(settings_path(root))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(|| Self {
                enabled: true,
                ..Self::default()
            })
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        crate::storage::atomic_write(&settings_path(root), &serde_json::to_vec(self)?)
    }
}
/// Turns `name` into a path inside the automatic backup directory, rejecting
/// anything that is not exactly one of our archive names.
pub fn resolve(root: &Path, name: &str) -> Result<PathBuf> {
    if !is_auto_backup_name(name) {
        return Err(Error::new("AUTO_BACKUP_NAME", "不是有效的自动备份文件名"));
    }
    Ok(backup_dir(root).join(name))
}
/// ponytail: the whole archive is built on the worker thread, so with a large
/// library other requests queue for a few seconds; each archive is also a full
/// copy, so disk use grows to roughly library size × 7. Split snapshot/pack or
/// deduplicate photos only if that ever hurts in practice.
/// Since encrypted backups every archive gets a unique name and is built in
/// private staging; the destination only receives the finished artifact.
pub fn run(store: &Store, dir: &Path, date: &str, snapshot: &Snapshot) -> Result<PathBuf> {
    reject_links(dir)?;
    fs::create_dir_all(dir)?;
    // A force-quit can only leave dot-prefixed temporaries behind; they are
    // worthless and are cleared before anything new is written.
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.')
            && fs::symlink_metadata(entry.path())
                .is_ok_and(|m| m.is_file() && is_link(&m, &entry.path()).is_ok_and(|link| !link))
        {
            remove_file_retry(entry.path())?;
        }
    }
    let final_path = dir.join(unique_name(
        date,
        matches!(snapshot.mode, Mode::Encrypted(_)),
    ));
    match &snapshot.mode {
        Mode::Encrypted(key) => store.backup_encrypted(&key.recipient, &final_path),
        Mode::Plaintext => store.backup(Some(&final_path)),
    }?;
    sync_dir(dir)?;
    Ok(final_path)
}
#[derive(Debug, Clone, Serialize)]
pub struct Item {
    pub name: String,
    pub date: String,
    pub size: u64,
}
struct Archive {
    item: Item,
    minute: Option<u16>,
    within_minute: Option<u64>,
}
impl Archive {
    fn coarse(&self) -> (&str, Option<u16>) {
        (&self.item.date, self.minute)
    }
}
fn archive(path: &Path, name: String) -> Result<Option<Archive>> {
    let Some(date) = date_of(&name) else {
        return Ok(None);
    };
    let meta = fs::symlink_metadata(path)?;
    if is_link(&meta, path)? || !meta.is_file() {
        return Ok(None);
    }
    let core = name.strip_prefix("物谱自动备份-").unwrap();
    let core = core
        .strip_suffix(EXT_AGE)
        .or_else(|| core.strip_suffix(EXT))
        .unwrap();
    let (minute, within_minute) = if core.len() == 10 {
        (None, Some(0))
    } else {
        let minute = Some(core[11..15].parse::<u16>().unwrap());
        let fine = if core.len() == 33 {
            Some(core[15..26].parse::<u64>().unwrap())
        } else {
            // Copies/cloud tools may rewrite mtime. Only use it when it
            // agrees with the immutable date/minute in the legacy name.
            meta.modified().ok().and_then(|modified| {
                let at: chrono::DateTime<chrono::Local> = modified.into();
                (at.format("%Y-%m-%d-%H%M").to_string() == core[..15])
                    .then_some(u64::from(at.second()) * 1_000_000_000 + u64::from(at.nanosecond()))
            })
        };
        (minute, fine)
    };
    Ok(Some(Archive {
        item: Item {
            name: name.clone(),
            date: date.to_owned(),
            size: meta.len(),
        },
        minute,
        within_minute,
    }))
}
fn newest_first(items: &mut [Archive]) {
    items.sort_unstable_by(|a, b| {
        b.coarse()
            .cmp(&a.coarse())
            .then_with(|| b.within_minute.cmp(&a.within_minute))
            // Display only: random names never decide a destructive cutoff.
            .then_with(|| b.item.name.cmp(&a.item.name))
    });
}
/// Keeps the newest KEEP archives; uncertain cutoff times stop deletion.
pub fn prune(dir: &Path) -> Result<()> {
    prune_inner(dir, None)
}
/// Always retain the archive just published, even after a clock adjustment.
pub fn prune_after_publish(dir: &Path, published: &Path) -> Result<()> {
    let name = published
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|name| published.parent() == Some(dir) && is_auto_backup_name(name))
        .ok_or_else(|| Error::new("AUTO_BACKUP_NAME", "新备份不在本次自动备份目录内"))?;
    prune_inner(dir, Some(name))
}
fn prune_inner(dir: &Path, published: Option<&str>) -> Result<()> {
    reject_links(dir)?;
    // Finish every read and validate the whole deletion plan before removing
    // anything. Unreadable metadata is not permission to guess an order.
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if let Some(item) = archive(&entry.path(), name)? {
            entries.push(item);
        }
    }
    let mut slots = KEEP;
    if let Some(name) = published {
        let index = entries
            .iter()
            .position(|a| a.item.name == name)
            .ok_or_else(|| {
                Error::new(
                    "AUTO_BACKUP_MISSING",
                    "新发布的自动备份已不在目录中，未清理旧备份",
                )
            })?;
        entries.remove(index);
        slots -= 1;
    }
    newest_first(&mut entries);
    let mut remove = Vec::new();
    let mut start = 0;
    while start < entries.len() {
        let end = start
            + entries[start..]
                .iter()
                .take_while(|a| a.coarse() == entries[start].coarse())
                .count();
        let group = &entries[start..end];
        if group.len() <= slots {
            slots -= group.len();
        } else {
            if slots > 0
                && (group.iter().any(|a| a.within_minute.is_none())
                    || group[slots - 1].within_minute == group[slots].within_minute)
            {
                return Err(Error::new(
                    "AUTO_BACKUP_ORDER",
                    "无法确定同一时刻旧备份的先后，已保留所有文件；请核对备份文件时间后重试",
                ));
            }
            remove.extend(group[slots..].iter().map(|a| dir.join(&a.item.name)));
            slots = 0;
        }
        start = end;
    }
    for path in remove {
        remove_file_retry(path)?;
    }
    Ok(())
}
pub fn list(dir: &Path) -> Vec<Item> {
    if reject_links(dir).is_err() {
        return Vec::new();
    }
    let mut items: Vec<Archive> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            archive(&entry.path(), name).ok().flatten()
        })
        .collect();
    newest_first(&mut items);
    items.into_iter().map(|a| a.item).collect()
}
/// Copies one published archive into the extra location via a same-directory
/// temporary, then prunes that location. Run outside the worker thread: it
/// only reads a finished archive and must never block the interface. A
/// vanished location (unmounted disk) is an error, never recreated here.
/// `may_publish` is checked right before the atomic rename; a policy epoch
/// that changed during the copy drops the temporary instead of publishing.
pub fn copy_extra(source: &Path, extra_dir: &Path, may_publish: impl Fn() -> bool) -> Result<()> {
    reject_links(source)?;
    reject_links(extra_dir)?;
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| Error::new("AUTO_BACKUP_NAME", "自动备份文件名无效"))?;
    if !is_auto_backup_name(name) {
        return Err(Error::new("AUTO_BACKUP_NAME", "不是有效的自动备份文件名"));
    }
    if !extra_dir.is_dir() {
        return Err(Error::new(
            "EXTRA_MISSING",
            "找不到额外备份位置，可能是外接盘未连接或文件夹已移动",
        ));
    }
    let partial = extra_dir.join(format!(".{name}.partial"));
    if partial.exists() {
        remove_file_retry(&partial)?;
    }
    reject_links(&partial)?;
    // fs::copy keeps the archive's owner-only permissions.
    let copy = |target: &Path| -> Result<()> {
        let modified = fs::metadata(source)?.modified()?;
        fs::copy(source, target)?;
        fs::OpenOptions::new()
            .write(true)
            .open(target)?
            .set_times(fs::FileTimes::new().set_modified(modified))?;
        crate::storage::sync_file(target)?;
        Ok(())
    };
    match copy(&partial) {
        Ok(()) => {
            if !may_publish() {
                let _ = remove_file_retry(&partial);
                return Err(Error::new(
                    "SECURITY_EPOCH",
                    "备份安全设置已变化，本次额外复制已取消",
                ));
            }
            let final_path = extra_dir.join(name);
            rename_retry(&partial, &final_path)?;
            sync_dir(extra_dir)?;
            prune_after_publish(extra_dir, &final_path)?;
            Ok(())
        }
        Err(error) => {
            if partial.exists() {
                let _ = remove_file_retry(&partial);
            }
            Err(error)
        }
    }
}
/// What `auto_backup_status` reports to the settings page.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub enabled: bool,
    pub folder: String,
    pub last_success_at: Option<String>,
    pub last_error: Option<Failure>,
    pub items: Vec<Item>,
    pub total_size: u64,
    pub extra_dir: Option<String>,
    pub extra_last_at: Option<String>,
    pub extra_last_error: Option<Failure>,
}
pub fn status(root: &Path) -> Status {
    let settings = Settings::load(root);
    let items = list(&backup_dir(root));
    Status {
        enabled: settings.enabled,
        folder: backup_dir(root).display().to_string(),
        last_success_at: settings.last_success_at,
        last_error: settings.last_error,
        total_size: items.iter().map(|i| i.size).sum(),
        items,
        extra_dir: settings.extra_dir,
        extra_last_at: settings.extra_last_at,
        extra_last_error: settings.extra_last_error,
    }
}
pub fn now_local() -> String {
    chrono::Local::now().to_rfc3339()
}
