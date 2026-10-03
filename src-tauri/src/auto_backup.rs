use crate::{
    domain::{Error, Result},
    storage::{sync_dir, Store},
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf};

/// Automatic backups keep this many dated archives per location (D20 rule 4).
pub const KEEP: usize = 7;
/// Archive extension for both manual and automatic backups.
pub const EXT: &str = ".thingary";
/// `^物谱自动备份-\d{4}-\d{2}-\d{2}\.thingary$`; only these are listed,
/// pruned or restorable, so cleanup can never remove a user's own files.
pub fn is_auto_backup_name(name: &str) -> bool {
    date_of(name).is_some()
}
/// The local calendar day encoded in an archive name, if the name is ours.
pub fn date_of(name: &str) -> Option<&str> {
    let date = name.strip_prefix("物谱自动备份-")?;
    let date = date.strip_suffix(EXT)?;
    let b = date.as_bytes();
    let expected = |i: usize| matches!(i, 4 | 7);
    if b.len() != 10
        || !b.iter().enumerate().all(|(i, &c)| {
            if expected(i) {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
    {
        return None;
    }
    Some(date)
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
pub fn run(store: &Store, dir: &Path, date: &str) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    // A force-quit can only leave dot-prefixed temporaries behind; they are
    // worthless and are cleared before anything new is written.
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') && entry.metadata().is_ok_and(|m| m.is_file()) {
            fs::remove_file(entry.path())?;
        }
    }
    let final_path = dir.join(format!("物谱自动备份-{date}{EXT}"));
    let partial = dir.join(format!(".物谱自动备份-{date}.partial"));
    if partial.exists() {
        fs::remove_file(&partial)?;
    }
    match store.backup(Some(&partial)) {
        Ok(_) => {
            fs::rename(&partial, &final_path)?;
            sync_dir(dir)?;
            Ok(final_path)
        }
        Err(error) => {
            // The old dated archive, if any, was never touched.
            if partial.exists() {
                let _ = fs::remove_file(&partial);
            }
            Err(error)
        }
    }
}
/// Keeps the newest `KEEP` dated archives; every other file stays untouched.
pub fn prune(dir: &Path) -> Result<()> {
    let mut names: Vec<String> = fs::read_dir(dir)?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            (is_auto_backup_name(&name) && entry.metadata().ok()?.is_file()).then_some(name)
        })
        .collect();
    names.sort_unstable();
    for name in names.into_iter().rev().skip(KEEP) {
        fs::remove_file(dir.join(name))?;
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize)]
pub struct Item {
    pub name: String,
    pub date: String,
    pub size: u64,
}
pub fn list(dir: &Path) -> Vec<Item> {
    let mut items: Vec<Item> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            let date = date_of(&name)?.to_string();
            let size = entry.metadata().ok()?.len();
            Some(Item { name, date, size })
        })
        .collect();
    items.sort_unstable_by(|a, b| b.date.cmp(&a.date).then(b.name.cmp(&a.name)));
    items
}
/// Copies one published archive into the extra location via a same-directory
/// temporary, then prunes that location. Run outside the worker thread: it
/// only reads a finished archive and must never block the interface. A
/// vanished location (unmounted disk) is an error, never recreated here.
pub fn copy_extra(source: &Path, extra_dir: &Path) -> Result<()> {
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
        fs::remove_file(&partial)?;
    }
    // fs::copy keeps the archive's owner-only permissions.
    let copy = |target: &Path| -> Result<()> {
        fs::copy(source, target)?;
        fs::File::open(target)?.sync_all()?;
        Ok(())
    };
    match copy(&partial) {
        Ok(()) => {
            let final_path = extra_dir.join(name);
            fs::rename(&partial, &final_path)?;
            sync_dir(extra_dir)?;
            prune(extra_dir)?;
            Ok(())
        }
        Err(error) => {
            if partial.exists() {
                let _ = fs::remove_file(&partial);
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
