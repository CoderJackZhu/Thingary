use crate::{
    backup_crypto::{self, RecipientKey},
    domain::Result,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[cfg(windows)]
mod windows_staging;

/// Machine-local encryption policy. Lives beside `auto-backup.json`, never in
/// the library database and never inside a `.thingary` backup. Only public,
/// non-secret material is persisted.
pub const POLICY_FILE: &str = "backup-security.json";
pub const POLICY_FORMAT_VERSION: u32 = 1;
/// Idle lifetime of an in-memory key or restore session.
pub const SESSION_IDLE: Duration = Duration::from_secs(10 * 60);
/// Key-setup states a policy file may hold. `changing` is runtime-only.
pub const STATE_UNCONFIGURED: &str = "unconfigured";
pub const STATE_DISABLED: &str = "disabled";
pub const STATE_ENABLED: &str = "enabled";
pub const STATE_NEEDS_ATTENTION: &str = "needs_attention";
pub const STATE_RESTORE_REVIEW: &str = "restore_review_required";

pub fn policy_path(root: &Path) -> PathBuf {
    root.join(POLICY_FILE)
}

/// Outcome of the first automatic backup under the current key, shown next to
/// "加密已开启"; enabling or rotating resets it to `waiting`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, tag = "state", rename_all = "snake_case")]
pub enum FirstBackup {
    Waiting,
    Running,
    Success { at: String },
    Failed { at: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub format_version: u32,
    pub state: String,
    pub policy_epoch: String,
    #[serde(default)]
    pub recipient: Option<String>,
    #[serde(default)]
    pub recipient_id: Option<String>,
    #[serde(default)]
    pub verified_at: Option<String>,
    #[serde(default)]
    pub changed_at: Option<String>,
    #[serde(default)]
    pub first_backup: Option<FirstBackup>,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            format_version: POLICY_FORMAT_VERSION,
            state: STATE_UNCONFIGURED.into(),
            policy_epoch: crate::storage::uid(),
            recipient: None,
            recipient_id: None,
            verified_at: None,
            changed_at: None,
            first_backup: None,
        }
    }
}

/// A policy that failed to load. `needs_attention` keeps whatever is wrong on
/// disk untouched; it never falls back to plaintext behavior.
#[derive(Debug, Clone)]
pub struct LoadError {
    pub policy: Policy,
    pub reason: String,
}

/// What the settings page shows. Derived from the policy file plus in-memory
/// session hints; no secrets ever appear here.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SecurityStatus {
    pub state: String,
    pub reason: Option<String>,
    /// True when automatic and extra-location backups are paused.
    pub paused: bool,
    /// Full SHA-256 of the canonical recipient; comparisons use this.
    pub recipient_id: Option<String>,
    /// Short non-authoritative display form of `recipient_id`.
    pub recipient_short: Option<String>,
    pub verified_at: Option<String>,
    pub changed_at: Option<String>,
    pub first_backup: Option<FirstBackup>,
    /// A key-setup session is active (the UI may resume or let it expire).
    pub setup_active: bool,
}

pub fn status_from_policy(
    policy: &Policy,
    reason: Option<String>,
    setup_active: bool,
) -> SecurityStatus {
    let recipient_short = policy
        .recipient_id
        .as_deref()
        .map(|id| id.chars().take(8).collect());
    SecurityStatus {
        paused: !policy.active(),
        state: policy.state.clone(),
        reason,
        recipient_id: policy.recipient_id.clone(),
        recipient_short,
        verified_at: policy.verified_at.clone(),
        changed_at: policy.changed_at.clone(),
        first_backup: policy.first_backup.clone(),
        setup_active,
    }
}

impl Policy {
    /// Loading distinguishes "not configured yet" (a fresh install or an
    /// upgrade — both require an explicit choice) from a damaged file.
    #[allow(clippy::result_large_err)] // one-shot config load; boxing buys nothing
    pub fn load(root: &Path) -> std::result::Result<Self, LoadError> {
        let path = policy_path(root);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => {
                return Err(LoadError {
                    policy: Self::attention(),
                    reason: "安全配置无法读取".into(),
                })
            }
        };
        let policy: Policy = match serde_json::from_slice(&bytes) {
            Ok(policy) => policy,
            Err(_) => {
                return Err(LoadError {
                    policy: Self::attention(),
                    reason: "安全配置不是有效的格式".into(),
                })
            }
        };
        if policy.format_version != POLICY_FORMAT_VERSION {
            return Err(LoadError {
                policy: Self::attention(),
                reason: "安全配置版本未知".into(),
            });
        }
        let known = [
            STATE_UNCONFIGURED,
            STATE_DISABLED,
            STATE_ENABLED,
            STATE_NEEDS_ATTENTION,
            STATE_RESTORE_REVIEW,
        ];
        if !known.contains(&policy.state.as_str()) {
            return Err(LoadError {
                policy: Self::attention(),
                reason: "安全配置状态未知".into(),
            });
        }
        if policy.state == STATE_ENABLED {
            let broken = policy
                .recipient
                .as_deref()
                .and_then(|text| backup_crypto::RecipientKey::parse(text).ok())
                .is_none_or(|key| policy.recipient_id.as_deref() != Some(key.id.as_str()));
            if broken {
                return Err(LoadError {
                    policy: Self::attention(),
                    reason: "已启用加密但公钥不可用".into(),
                });
            }
        }
        if policy.state == STATE_UNCONFIGURED && policy.recipient.is_some() {
            return Err(LoadError {
                policy: Self::attention(),
                reason: "安全配置内容与状态不一致".into(),
            });
        }
        Ok(policy)
    }

    fn attention() -> Self {
        Self {
            state: STATE_NEEDS_ATTENTION.into(),
            ..Self::default()
        }
    }

    pub fn save(&self, root: &Path) -> Result<()> {
        crate::storage::atomic_write(&policy_path(root), &serde_json::to_vec(self)?)
    }

    /// True only when automatic and extra-location backups may run.
    pub fn active(&self) -> bool {
        self.state == STATE_DISABLED || self.state == STATE_ENABLED
    }

    pub fn key(&self) -> Option<RecipientKey> {
        if self.state != STATE_ENABLED {
            return None;
        }
        self.recipient
            .as_deref()
            .and_then(|text| backup_crypto::RecipientKey::parse(text).ok())
    }
}

/// Immutable view of the policy captured by one backup task. A task may only
/// publish while the epoch still matches the live policy.
#[derive(Debug, Clone, PartialEq)]
pub enum Mode {
    Plaintext,
    Encrypted(RecipientKey),
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub epoch: String,
    pub mode: Mode,
}

impl Snapshot {
    pub fn from_policy(policy: &Policy) -> Self {
        let mode = match policy.key() {
            Some(key) => Mode::Encrypted(key),
            None => Mode::Plaintext,
        };
        Self {
            epoch: policy.policy_epoch.clone(),
            mode,
        }
    }
    /// Reason automatic and extra-location backups are paused, if they are.
    pub fn pause_reason(policy: &Policy) -> Option<String> {
        match policy.state.as_str() {
            STATE_UNCONFIGURED => Some("自动备份等待备份安全设置确认".into()),
            STATE_NEEDS_ATTENTION => Some("备份安全配置异常，自动备份已暂停".into()),
            STATE_RESTORE_REVIEW => Some("刚从加密备份恢复，需先确认本机备份策略".into()),
            _ => None,
        }
    }
}

/// One in-memory key setup (enable or rotation). The private key lives only
/// here and in the one string handed to the user; it is never persisted.
pub struct KeySetup {
    pub id: String,
    identity: age::x25519::Identity,
    pub key: RecipientKey,
    pub expires_at: Instant,
}

impl Default for KeySetup {
    fn default() -> Self {
        Self::new()
    }
}

impl KeySetup {
    pub fn new() -> Self {
        let identity = age::x25519::Identity::generate();
        let key = RecipientKey::from_recipient(identity.to_public());
        Self {
            id: crate::storage::uid(),
            identity,
            key,
            expires_at: Instant::now() + SESSION_IDLE,
        }
    }
    /// The recovery key in its standard single-line form, for one-time display.
    pub fn recovery_key_text(&self) -> String {
        use age::secrecy::ExposeSecret;
        self.identity.to_string().expose_secret().to_string()
    }
    /// The full standard identity file, comments included.
    pub fn identity_file_text(&self) -> String {
        backup_crypto::recovery_key_file_text(&self.identity)
    }
    fn expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }
    fn touch(&mut self) {
        self.expires_at = Instant::now() + SESSION_IDLE;
    }
}

/// Result of starting a key setup: the secret is handed out exactly once.
#[derive(Debug, Clone, Serialize)]
pub struct KeySetupStarted {
    pub session_id: String,
    pub recipient: String,
    pub recipient_id: String,
    pub recovery_key: String,
}

/// Result of beginning a backup inspection.
#[derive(Debug, Clone, Serialize)]
pub struct InspectionStarted {
    pub token: String,
    pub name: String,
    pub encrypted: bool,
    pub summary: Option<crate::backup::Summary>,
    pub hash: Option<String>,
}

/// Result of unlocking an encrypted inspection session.
#[derive(Debug, Clone, Serialize)]
pub struct InspectionUnlocked {
    pub token: String,
    pub summary: crate::backup::Summary,
    pub hash: String,
}

/// Registry of the single active key setup. Cancel, expiry and completion all
/// drop the private key from memory.
#[derive(Default)]
pub struct KeySetups {
    session: Option<KeySetup>,
}

impl KeySetups {
    pub(crate) fn sweep(&mut self) {
        if self.session.as_ref().is_some_and(|s| s.expired()) {
            self.session = None;
        }
    }
    pub fn begin(&mut self) -> &KeySetup {
        self.session = Some(KeySetup::new());
        self.session.as_ref().expect("just set")
    }
    pub fn get(&mut self, id: &str) -> Option<&mut KeySetup> {
        self.sweep();
        let session = self.session.as_mut()?;
        if session.id != id {
            return None;
        }
        session.touch();
        Some(session)
    }
    pub fn cancel(&mut self, id: &str) -> bool {
        self.sweep();
        if self
            .session
            .as_ref()
            .is_some_and(|session| session.id == id)
        {
            self.session = None;
            true
        } else {
            false
        }
    }
    pub fn clear(&mut self) {
        self.session = None;
    }
    pub fn active_id(&self) -> Option<&str> {
        self.session.as_ref().map(|s| s.id.as_str())
    }
}

/// The staging area under the app-private root where plaintext ZIPs are built,
/// validated and decrypted. Never user-configurable, never an extra location.
pub fn staging_root(root: &Path) -> PathBuf {
    root.join("backup-staging")
}

/// Creates the staging root with owner-only permissions. `tempfile` directory
/// creation is 0755 on macOS, so the mode is set explicitly.
pub fn ensure_staging(root: &Path) -> Result<PathBuf> {
    let dir = staging_root(root);
    crate::storage::reject_links(&dir)?;
    #[cfg(windows)]
    {
        // Only staging gets a protected DACL; do not change the library's permissions.
        fs::create_dir_all(root)?;
        windows_staging::ensure(&dir).map_err(|_| {
            crate::domain::Error::new("BACKUP_PRIVATE_DIR", "无法确认备份暂存目录的私有权限")
        })?;
    }
    #[cfg(not(windows))]
    let mut builder = fs::DirBuilder::new();
    #[cfg(not(windows))]
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    #[cfg(not(windows))]
    builder.create(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // A surviving directory may predate this policy or have had its mode
        // changed. DirBuilder's mode applies only when creating a directory.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        if fs::metadata(&dir)?.permissions().mode() & 0o777 != 0o700 {
            return Err(crate::domain::Error::new(
                "BACKUP_PRIVATE_DIR",
                "无法确认备份暂存目录的私有权限",
            ));
        }
    }
    Ok(dir)
}

/// Startup cleanup: removes the whole staging tree without following links.
pub fn clean_staging(root: &Path) {
    let dir = staging_root(root);
    if dir.exists() {
        if let Err(error) = crate::storage::remove_dir_all_retry(&dir) {
            eprintln!("备份暂存目录清理未完成：{error}");
        }
    }
}

/// One controlled inspection/restore session. The original file is frozen on
/// first inspection; later steps only consume the frozen bytes. Held temp
/// handles mean even a panic cleans the frozen copy up.
pub struct Inspection {
    pub token: String,
    pub encrypted: bool,
    pub source: String,
    frozen: Option<std::sync::Arc<tempfile::NamedTempFile>>,
    pub cipher_digest: Option<String>,
    plain_zip: Option<PathBuf>,
    /// The staging directory owned by this session, if any. Only this exact
    /// directory is ever removed; parent directories are never touched.
    plain_dir: Option<tempfile::TempDir>,
    pub plain_digest: Option<String>,
    pub generation: String,
    pub expires_at: Instant,
    /// Set when the restore already ran, so a repeated confirm returns the
    /// same outcome instead of restoring twice.
    pub restored: Option<String>,
    /// The storage restore was entered; a failed reply can require a dataset
    /// check before the caller knows whether the pointer switch committed.
    pub restore_attempted: bool,
    activity: std::sync::Arc<InspectionActivity>,
}

#[derive(Default)]
struct InspectionActivity {
    running: std::sync::atomic::AtomicUsize,
    finished_at: std::sync::Mutex<Option<Instant>>,
}

/// Pins idle expiry while background decryption or inspection is running.
/// Cancellation may still remove its session; the guard owns no session files.
pub struct InspectionBusy(std::sync::Arc<InspectionActivity>);

impl Drop for InspectionBusy {
    fn drop(&mut self) {
        *self.0.finished_at.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        self.0
            .running
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

impl Inspection {
    /// An encrypted backup awaiting its recovery key.
    pub fn new_encrypted(
        token: String,
        source: String,
        frozen: tempfile::NamedTempFile,
        cipher_digest: String,
        generation: String,
    ) -> Self {
        Self {
            token,
            encrypted: true,
            source,
            frozen: Some(std::sync::Arc::new(frozen)),
            cipher_digest: Some(cipher_digest),
            plain_zip: None,
            plain_dir: None,
            plain_digest: None,
            generation,
            expires_at: Instant::now() + SESSION_IDLE,
            restored: None,
            restore_attempted: false,
            activity: std::sync::Arc::default(),
        }
    }
    /// A plaintext backup whose frozen copy is already the checked ZIP.
    pub fn new_plain(
        token: String,
        source: String,
        frozen: tempfile::NamedTempFile,
        plain_digest: String,
        generation: String,
    ) -> Self {
        Self {
            token,
            encrypted: false,
            source,
            frozen: Some(std::sync::Arc::new(frozen)),
            cipher_digest: None,
            plain_zip: None,
            plain_dir: None,
            plain_digest: Some(plain_digest),
            generation,
            expires_at: Instant::now() + SESSION_IDLE,
            restored: None,
            restore_attempted: false,
            activity: std::sync::Arc::default(),
        }
    }
    fn expired(&self) -> bool {
        if self
            .activity
            .running
            .load(std::sync::atomic::Ordering::SeqCst)
            > 0
        {
            return false;
        }
        let completed_idle = self
            .activity
            .finished_at
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        Instant::now() >= self.expires_at
            && completed_idle.is_none_or(|at| at.elapsed() >= SESSION_IDLE)
    }
    fn touch(&mut self) {
        self.expires_at = Instant::now() + SESSION_IDLE;
    }
    pub fn frozen_path(&self) -> Option<&Path> {
        self.frozen.as_ref().map(|f| f.path())
    }
    pub fn frozen_handle(&self) -> Option<std::sync::Arc<tempfile::NamedTempFile>> {
        self.frozen.clone()
    }
    pub fn hold(&self) -> InspectionBusy {
        self.activity
            .running
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        InspectionBusy(self.activity.clone())
    }
    pub fn plain_zip(&self) -> Option<&Path> {
        self.plain_zip.as_deref()
    }
    /// For plaintext sessions: the frozen file itself is the checked ZIP.
    pub fn adopt_frozen_as_plain(&mut self) {
        if let Some(frozen) = &self.frozen {
            self.plain_zip = Some(frozen.path().to_path_buf());
        }
    }
    /// Records the decrypted plaintext ZIP produced by an unlock, together
    /// with the staging directory that owns it.
    pub fn set_decrypted(&mut self, path: PathBuf, digest: String, dir: tempfile::TempDir) {
        self.plain_dir = Some(dir);
        self.plain_zip = Some(path);
        self.plain_digest = Some(digest);
    }
    /// Drops this session's controlled files while keeping its record.
    pub fn release_files(&mut self) {
        self.frozen.take();
        if let Some(dir) = self.plain_dir.take() {
            let _ = crate::storage::remove_dir_all_retry(dir.path());
        }
        self.plain_zip = None;
    }
}

#[derive(Default)]
pub struct Inspections {
    session: Option<Inspection>,
}

impl Inspections {
    fn release(session: &mut Option<Inspection>) {
        if let Some(session) = session.as_mut() {
            session.release_files();
        }
    }
    pub(crate) fn sweep(&mut self) {
        // Sweeps only run between worker jobs; a synchronous restore can never
        // observe its own session as idle-expired.
        if self
            .session
            .as_ref()
            .is_some_and(|s| s.expired() && s.restored.is_none())
        {
            Self::release(&mut self.session);
            self.session = None;
        }
    }
    pub fn begin(&mut self, session: Inspection) {
        Self::release(&mut self.session);
        self.session = Some(session);
    }
    pub fn get(&mut self, token: &str) -> Option<&mut Inspection> {
        self.sweep();
        let session = self.session.as_mut()?;
        if session.token != token {
            return None;
        }
        session.touch();
        Some(session)
    }
    pub fn cancel(&mut self, token: &str) -> bool {
        self.sweep();
        match self.session.as_mut() {
            Some(session) if session.token == token => {
                Self::release(&mut self.session);
                self.session = None;
                true
            }
            _ => false,
        }
    }
    pub fn clear(&mut self) {
        Self::release(&mut self.session);
        self.session = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy_json(state: &str, recipient: Option<&str>) -> String {
        serde_json::to_string(&Policy {
            format_version: POLICY_FORMAT_VERSION,
            state: state.into(),
            policy_epoch: "epoch-1".into(),
            recipient: recipient.map(str::to_string),
            recipient_id: recipient.map(|text| RecipientKey::parse(text).unwrap().id),
            verified_at: None,
            changed_at: None,
            first_backup: None,
        })
        .unwrap()
    }

    #[test]
    fn missing_file_is_unconfigured_not_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let policy = Policy::load(dir.path()).unwrap();
        assert_eq!(policy.state, STATE_UNCONFIGURED);
        assert!(!policy.active());
        assert!(Snapshot::pause_reason(&policy).is_some());
    }

    #[test]
    fn damaged_or_unknown_files_need_attention() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(policy_path(dir.path()), b"{ not json").unwrap();
        let err = Policy::load(dir.path()).unwrap_err();
        assert_eq!(err.policy.state, STATE_NEEDS_ATTENTION);

        let key = age::x25519::Identity::generate();
        let bad = serde_json::json!({
            "format_version": 99,
            "state": "disabled",
            "policy_epoch": "e",
        });
        fs::write(policy_path(dir.path()), serde_json::to_vec(&bad).unwrap()).unwrap();
        assert_eq!(
            Policy::load(dir.path()).unwrap_err().policy.state,
            STATE_NEEDS_ATTENTION
        );

        let key_text = key.to_public().to_string();
        let enabled_no_key = serde_json::json!({
            "format_version": POLICY_FORMAT_VERSION,
            "state": "enabled",
            "policy_epoch": "e",
        });
        fs::write(
            policy_path(dir.path()),
            serde_json::to_vec(&enabled_no_key).unwrap(),
        )
        .unwrap();
        assert_eq!(
            Policy::load(dir.path()).unwrap_err().policy.state,
            STATE_NEEDS_ATTENTION
        );

        let unknown_state = serde_json::json!({
            "format_version": POLICY_FORMAT_VERSION,
            "state": "party",
            "policy_epoch": "e",
            "recipient": key_text,
            "recipient_id": "abc",
        });
        fs::write(
            policy_path(dir.path()),
            serde_json::to_vec(&unknown_state).unwrap(),
        )
        .unwrap();
        assert_eq!(
            Policy::load(dir.path()).unwrap_err().policy.state,
            STATE_NEEDS_ATTENTION
        );
    }

    #[test]
    fn valid_disabled_and_enabled_policies_load() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(policy_path(dir.path()), policy_json(STATE_DISABLED, None)).unwrap();
        let policy = Policy::load(dir.path()).unwrap();
        assert!(policy.active());
        assert!(matches!(
            Snapshot::from_policy(&policy).mode,
            Mode::Plaintext
        ));

        let key = age::x25519::Identity::generate();
        fs::write(
            policy_path(dir.path()),
            policy_json(STATE_ENABLED, Some(&key.to_public().to_string())),
        )
        .unwrap();
        let policy = Policy::load(dir.path()).unwrap();
        assert!(policy.active());
        assert!(matches!(
            Snapshot::from_policy(&policy).mode,
            Mode::Encrypted(_)
        ));
    }

    #[test]
    fn staging_dir_is_owner_only_on_unix() {
        let dir = tempfile::tempdir().unwrap();
        let staging = ensure_staging(dir.path()).unwrap();
        assert!(staging.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&staging).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        clean_staging(dir.path());
        assert!(!staging.exists());
    }

    #[test]
    fn key_setup_sessions_expire_and_cancel() {
        let mut setups = KeySetups::default();
        let id = setups.begin().id.clone();
        assert!(setups.get(&id).is_some());
        let other_id = setups.begin().id.clone();
        assert_ne!(other_id, id);
        assert!(setups.get(&id).is_none(), "a new session replaces the old");
        assert!(
            !setups.cancel(&id),
            "a late cancel cannot remove the new key"
        );
        assert_eq!(setups.active_id(), Some(other_id.as_str()));
        assert!(setups.cancel(&other_id));
        assert!(setups.active_id().is_none());

        let expired_id = setups.begin().id.clone();
        setups.session.as_mut().unwrap().expires_at = Instant::now() - Duration::from_secs(1);
        setups.sweep();
        assert!(setups.active_id().is_none());
        assert!(setups.get(&expired_id).is_none());
    }

    #[test]
    fn enabled_policy_requires_the_full_canonical_recipient_digest() {
        let dir = tempfile::tempdir().unwrap();
        let identity = age::x25519::Identity::generate();
        let key = RecipientKey::from_recipient(identity.to_public());
        let valid = policy_json(STATE_ENABLED, Some(&key.text));
        let value: serde_json::Value = serde_json::from_str(&valid).unwrap();
        for bad_digest in ["".to_string(), key.short_id(), "0".repeat(64)] {
            let mut damaged = value.clone();
            damaged["recipient_id"] = bad_digest.into();
            fs::write(
                policy_path(dir.path()),
                serde_json::to_vec(&damaged).unwrap(),
            )
            .unwrap();
            assert_eq!(
                Policy::load(dir.path()).unwrap_err().policy.state,
                STATE_NEEDS_ATTENTION
            );
        }
        fs::write(policy_path(dir.path()), valid).unwrap();
        assert!(Policy::load(dir.path()).unwrap().active());
    }

    #[test]
    fn idle_inspection_sweep_releases_its_files_without_touching_other_jobs() {
        let root = tempfile::tempdir().unwrap();
        let staging = ensure_staging(root.path()).unwrap();
        let unrelated = staging.join("other-job");
        fs::create_dir(&unrelated).unwrap();
        let frozen = tempfile::NamedTempFile::new_in(root.path()).unwrap();
        let frozen_path = frozen.path().to_path_buf();
        let mut inspection = Inspection::new_encrypted(
            "expired-token".into(),
            "fictional.age".into(),
            frozen,
            "cipher-digest".into(),
            "generation".into(),
        );
        let plain_dir = tempfile::tempdir_in(&staging).unwrap();
        let plain_path = plain_dir.path().join("backup.thingary");
        fs::write(&plain_path, b"fictional plaintext").unwrap();
        inspection.set_decrypted(plain_path.clone(), "digest".into(), plain_dir);
        inspection.expires_at = Instant::now() - Duration::from_secs(1);
        let mut inspections = Inspections::default();
        inspections.begin(inspection);
        inspections.sweep();
        assert!(inspections.session.is_none());
        assert!(!frozen_path.exists());
        assert!(!plain_path.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn background_inspection_is_not_idle_and_completion_restarts_its_idle_clock() {
        let root = tempfile::tempdir().unwrap();
        let frozen = tempfile::NamedTempFile::new_in(root.path()).unwrap();
        let mut inspection = Inspection::new_encrypted(
            "busy-token".into(),
            "fictional.age".into(),
            frozen,
            "digest".into(),
            "generation".into(),
        );
        inspection.expires_at = Instant::now() - SESSION_IDLE;
        let activity = inspection.activity.clone();
        let first = inspection.hold();
        let second = inspection.hold();
        let mut sessions = Inspections::default();
        sessions.begin(inspection);
        sessions.sweep();
        assert!(sessions.session.is_some(), "running time is not idle time");
        drop(first);
        sessions.sweep();
        assert!(
            sessions.session.is_some(),
            "another background reader still runs"
        );
        drop(second);
        sessions.sweep();
        assert!(
            sessions.session.is_some(),
            "completion starts a fresh idle interval"
        );
        *activity.finished_at.lock().unwrap() = Some(Instant::now() - SESSION_IDLE);
        sessions.sweep();
        assert!(sessions.session.is_none());
    }

    #[test]
    fn busy_guard_does_not_block_explicit_cancel_or_affect_a_replacement_session() {
        let root = tempfile::tempdir().unwrap();
        let inspection = Inspection::new_encrypted(
            "old".into(),
            "fictional.age".into(),
            tempfile::NamedTempFile::new_in(root.path()).unwrap(),
            "digest".into(),
            "generation".into(),
        );
        let old_busy = inspection.hold();
        let mut sessions = Inspections::default();
        sessions.begin(inspection);
        assert!(sessions.cancel("old"));
        let mut replacement = Inspection::new_encrypted(
            "new".into(),
            "fictional.age".into(),
            tempfile::NamedTempFile::new_in(root.path()).unwrap(),
            "digest".into(),
            "generation".into(),
        );
        replacement.expires_at = Instant::now() - SESSION_IDLE;
        sessions.begin(replacement);
        drop(old_busy);
        sessions.sweep();
        assert!(
            sessions.session.is_none(),
            "old completion cannot extend a new session"
        );
    }
}
