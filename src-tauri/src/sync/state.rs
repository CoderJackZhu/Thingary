use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{Error, Result};

use super::manifest::Manifest;

const PASSPHRASE_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PendingPush {
    pub previous_remote_version: u64,
    pub manifest: Manifest,
    pub fingerprint: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct SyncConfig {
    pub enabled: bool,
    pub base_url: String,
    pub username: String,
    pub password: String,
    pub base_path: String,
    pub library_id: Option<String>,
    pub device_id: String,
    pub device_name: String,
    pub last_synced_remote_version: Option<u64>,
    pub last_synced_fingerprint: Option<String>,
    pub last_synced_at: Option<String>,
    pub pending_push: Option<PendingPush>,
    /// Kept next to the application password (same private file) so a person is not asked for
    /// the passphrase on every sync; the server still only ever sees encrypted data.
    pub remembered_passphrase: Option<String>,
    /// Look at the cloud when the app opens or changes foreground (read-only; uploads plain
    /// fast-forwards when the passphrase is remembered; never replaces local data by itself).
    pub auto_check: bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            username: String::new(),
            password: String::new(),
            base_path: String::new(),
            library_id: None,
            device_id: Uuid::new_v4().to_string(),
            device_name: default_device_name(),
            last_synced_remote_version: None,
            last_synced_fingerprint: None,
            last_synced_at: None,
            pending_push: None,
            remembered_passphrase: None,
            auto_check: true,
        }
    }
}

impl std::fmt::Debug for SyncConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SyncConfig")
            .field("enabled", &self.enabled)
            .field("base_url", &self.base_url)
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .field("base_path", &self.base_path)
            .field("library_id", &self.library_id)
            .field("device_id", &self.device_id)
            .field("device_name", &self.device_name)
            .field(
                "last_synced_remote_version",
                &self.last_synced_remote_version,
            )
            .field("last_synced_at", &self.last_synced_at)
            .field("pending_push", &self.pending_push)
            .field(
                "remembered_passphrase",
                &self.remembered_passphrase.as_ref().map(|_| "<redacted>"),
            )
            .field("auto_check", &self.auto_check)
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PublicConfig {
    pub enabled: bool,
    pub base_url: String,
    pub username: String,
    pub base_path: String,
    pub device_id: String,
    pub device_name: String,
    pub has_password: bool,
    pub last_synced_remote_version: Option<u64>,
    pub last_synced_at: Option<String>,
    pub has_pending_push: bool,
    pub has_remembered_passphrase: bool,
    pub auto_check: bool,
}

impl SyncConfig {
    pub fn public_view(&self) -> PublicConfig {
        PublicConfig {
            enabled: self.enabled,
            base_url: self.base_url.clone(),
            username: self.username.clone(),
            base_path: self.base_path.clone(),
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            has_password: !self.password.is_empty(),
            last_synced_remote_version: self.last_synced_remote_version,
            last_synced_at: self.last_synced_at.clone(),
            has_pending_push: self.pending_push.is_some(),
            has_remembered_passphrase: self.remembered_passphrase.is_some(),
            auto_check: self.auto_check,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ConfigStore {
    root: PathBuf,
}

impl ConfigStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn path(&self) -> PathBuf {
        self.root.join("sync.json")
    }

    pub fn load(&self) -> Result<SyncConfig> {
        let path = self.path();
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| Error::new("SYNC_CONFIG", "同步设置无法读取")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SyncConfig::default()),
            Err(_) => Err(Error::new("SYNC_CONFIG", "同步设置无法读取")),
        }
    }

    pub fn save(&self, config: &SyncConfig) -> Result<()> {
        fs::create_dir_all(&self.root)
            .map_err(|_| Error::new("SYNC_CONFIG", "无法保存同步设置"))?;
        let bytes = serde_json::to_vec_pretty(config)
            .map_err(|_| Error::new("SYNC_CONFIG", "无法保存同步设置"))?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|_| Error::new("SYNC_CONFIG", "无法保存同步设置"))?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| Error::new("SYNC_CONFIG", "无法保存同步设置"))?;
        set_private_permissions(temporary.path())?;
        temporary
            .persist(self.path())
            .map_err(|_| Error::new("SYNC_CONFIG", "无法保存同步设置"))?;
        set_private_permissions(&self.path())?;
        sync_parent(&self.root)?;
        Ok(())
    }
}

#[derive(Debug)]
pub struct PassphraseSession {
    ttl: Duration,
    value: Mutex<Option<(String, Instant)>>,
}

impl Default for PassphraseSession {
    fn default() -> Self {
        Self::with_ttl(PASSPHRASE_TTL)
    }
}

impl PassphraseSession {
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            ttl,
            value: Mutex::new(None),
        }
    }

    pub fn unlock(&self, passphrase: String) -> Result<()> {
        if passphrase.is_empty() {
            return Err(Error::new("SYNC_PASSPHRASE", "同步口令不能为空"));
        }
        let mut value = self
            .value
            .lock()
            .map_err(|_| Error::new("SYNC_LOCKED", "同步口令暂不可用"))?;
        *value = Some((passphrase, Instant::now()));
        Ok(())
    }

    pub fn get(&self) -> Result<String> {
        let mut value = self
            .value
            .lock()
            .map_err(|_| Error::new("SYNC_LOCKED", "同步口令暂不可用"))?;
        match value.as_ref() {
            Some((passphrase, unlocked_at)) if unlocked_at.elapsed() < self.ttl => {
                Ok(passphrase.clone())
            }
            _ => {
                *value = None;
                Err(Error::new("SYNC_LOCKED", "请先解锁同步口令"))
            }
        }
    }

    pub fn clear(&self) {
        if let Ok(mut value) = self.value.lock() {
            *value = None;
        }
    }
}

fn default_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "此设备".into())
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| Error::new("SYNC_CONFIG", "无法保护同步设置"))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

fn sync_parent(path: &Path) -> Result<()> {
    let directory =
        fs::File::open(path).map_err(|_| Error::new("SYNC_CONFIG", "无法完成同步设置保存"))?;
    directory
        .sync_all()
        .map_err(|_| Error::new("SYNC_CONFIG", "无法完成同步设置保存"))
}
