use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    backup::Summary,
    domain::{Error, Result},
    storage::SCHEMA_VERSION,
    worker::Worker,
};

use super::{
    engine::{
        decide, decrypt_snapshot, encrypt_snapshot, reconcile_pending, sha256_hex, verify_snapshot,
        DecisionInput, PendingResolution, SyncDecision,
    },
    fingerprint::{fingerprint, Fingerprint},
    manifest::Manifest,
    state::{ConfigStore, PassphraseSession, PendingPush, PublicConfig, SyncConfig},
    webdav::{DavResponse, PutCondition, UreqWebDav, WebDav},
};

const SLOW_SYNC_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Clone, Debug)]
struct PendingPull {
    token: String,
    manifest: Manifest,
}

pub struct SyncRuntime {
    config_store: ConfigStore,
    config: Mutex<SyncConfig>,
    passphrase: PassphraseSession,
    staging: PathBuf,
    pending_pull: Mutex<Option<PendingPull>>,
}

impl SyncRuntime {
    pub fn new(config_root: PathBuf, staging: PathBuf) -> Result<Self> {
        let config_store = ConfigStore::new(config_root);
        let config = config_store.load()?;
        Ok(Self {
            config_store,
            config: Mutex::new(config),
            passphrase: PassphraseSession::default(),
            staging,
            pending_pull: Mutex::new(None),
        })
    }

    fn config(&self) -> Result<SyncConfig> {
        self.config
            .lock()
            .map(|config| config.clone())
            .map_err(|_| Error::new("SYNC_STATE", "同步状态暂不可用"))
    }

    fn save_config(&self, next: SyncConfig) -> Result<()> {
        self.config_store.save(&next)?;
        let mut config = self
            .config
            .lock()
            .map_err(|_| Error::new("SYNC_STATE", "同步状态暂不可用"))?;
        *config = next;
        Ok(())
    }

    /// Establishes the in-memory passphrase session, the same step performed by
    /// `sync_unlock` before a Tauri command enters its blocking worker.
    pub fn unlock(&self, passphrase: &str) -> Result<()> {
        self.passphrase.unlock(passphrase.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInput {
    pub base_url: String,
    pub username: String,
    pub password: Option<String>,
    pub base_path: String,
    pub device_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisableInput {
    pub forget_credentials: bool,
}

#[derive(Debug, Deserialize)]
pub struct UnlockInput {
    pub passphrase: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct StatusInput {
    pub passphrase: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictChoice {
    KeepLocal,
    UseRemote,
}

#[derive(Debug, Deserialize)]
pub struct ConflictInput {
    pub choice: ConflictChoice,
}

#[derive(Debug, Serialize)]
pub struct ConnectionTest {
    pub ok: bool,
    pub supports_etag: bool,
    pub free_space: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LocalStatus {
    pub changed: bool,
    pub schema: u32,
    pub empty: bool,
    pub table_counts: std::collections::BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub version: u64,
    pub device_name: String,
    pub created_at: String,
    pub schema_version: u32,
    pub snapshot_bytes: u64,
    pub slow_sync_warning: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct StatusResult {
    pub state: &'static str,
    pub local: LocalStatus,
    pub remote: Option<RemoteStatus>,
}

#[derive(Debug, Serialize)]
pub struct PushResult {
    pub version: u64,
}

#[derive(Debug, Serialize)]
pub struct PullInspection {
    pub token: String,
    pub summary: Option<Summary>,
    pub version: u64,
    pub device_name: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ConflictResult {
    Push(PushResult),
    Pull(Box<PullInspection>),
}

#[tauri::command]
pub fn sync_config_get(runtime: tauri::State<'_, Arc<SyncRuntime>>) -> Result<PublicConfig> {
    Ok(runtime.config()?.public_view())
}

#[tauri::command]
pub fn sync_config_set(
    input: ConfigInput,
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<()> {
    let base_url = input.base_url.trim().trim_end_matches('/').to_string();
    let username = input.username.trim().to_string();
    let base_path = normalize_base_path(&input.base_path)?;
    let device_name = input.device_name.trim().to_string();
    if base_url.is_empty() || username.is_empty() || device_name.is_empty() {
        return Err(Error::new("SYNC_CONFIG", "请完整填写 WebDAV 同步设置"));
    }
    // Construction validates the URL and TLS scheme but performs no I/O.
    let password_for_validation = input.password.clone().unwrap_or_default();
    UreqWebDav::new(base_url.clone(), username.clone(), password_for_validation)?;

    let mut config = runtime.config()?;
    let endpoint_changed =
        config.base_url != base_url || config.username != username || config.base_path != base_path;
    config.enabled = true;
    config.base_url = base_url;
    config.username = username;
    config.base_path = base_path;
    config.device_name = device_name;
    if let Some(password) = input.password {
        if password.is_empty() {
            return Err(Error::new("SYNC_CONFIG", "应用密码不能为空"));
        }
        config.password = password;
    }
    if config.password.is_empty() {
        return Err(Error::new("SYNC_CONFIG", "请填写 WebDAV 应用密码"));
    }
    if endpoint_changed {
        config.library_id = None;
        config.last_synced_remote_version = None;
        config.last_synced_fingerprint = None;
        config.last_synced_at = None;
        config.pending_push = None;
    }
    runtime.save_config(config)
}

/// Connection check: reachable, authorised and writable. ETags belong to files, not to a
/// collection listing, so support is probed with a tiny file (written, read back if the write
/// reply carried no ETag, then removed). A PROPFIND reply says nothing about it.
pub fn test_connection(runtime: &SyncRuntime) -> Result<ConnectionTest> {
    let config = require_configured(runtime)?;
    let client = client(&config)?;
    let folder = join_path(&config.base_path, "Thingary");
    ensure_collections(&client, &folder)?;
    client.propfind(&folder, 0)?;
    let probe = join_path(&folder, ".connection-probe");
    let written = client.put(&probe, b"thingary", PutCondition::None)?;
    let etag = written
        .etag
        .or_else(|| client.get(&probe).ok().and_then(|reply| reply.etag));
    let _ = client.delete(&probe);
    Ok(ConnectionTest {
        ok: true,
        supports_etag: etag.is_some(),
        free_space: None,
    })
}

#[tauri::command]
pub async fn sync_test_connection(
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<ConnectionTest> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || test_connection(&runtime))
        .await
        .map_err(|_| Error::new("SYNC_TASK", "连接测试未完成"))?
}

#[tauri::command]
pub fn sync_disable(
    input: DisableInput,
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<()> {
    let mut config = runtime.config()?;
    config.enabled = false;
    config.pending_push = None;
    if input.forget_credentials {
        let device_id = config.device_id.clone();
        let device_name = config.device_name.clone();
        config = SyncConfig::default();
        config.device_id = device_id;
        config.device_name = device_name;
    }
    runtime.passphrase.clear();
    runtime.save_config(config)
}

#[tauri::command]
pub fn sync_unlock(input: UnlockInput, runtime: tauri::State<'_, Arc<SyncRuntime>>) -> Result<()> {
    runtime.passphrase.unlock(input.passphrase)
}

#[tauri::command]
pub async fn sync_status(
    input: Option<StatusInput>,
    worker: tauri::State<'_, Worker>,
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<StatusResult> {
    let worker = worker.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(passphrase) = input.and_then(|value| value.passphrase) {
            runtime.passphrase.unlock(passphrase)?;
        }
        finalize_pending_pull(&worker, &runtime)?;
        status(&worker, &runtime)
    })
    .await
    .map_err(|_| Error::new("SYNC_TASK", "同步状态检查未完成"))?
}

#[tauri::command]
pub async fn sync_push(
    worker: tauri::State<'_, Worker>,
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<PushResult> {
    let worker = worker.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || push(&worker, &runtime, false))
        .await
        .map_err(|_| Error::new("SYNC_TASK", "同步推送未完成"))?
}

#[tauri::command]
pub async fn sync_reconcile(
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<ReconcileResult> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reconcile(&runtime))
        .await
        .map_err(|_| Error::new("SYNC_TASK", "同步核对未完成"))?
}

#[tauri::command]
pub async fn sync_pull_inspect(
    worker: tauri::State<'_, Worker>,
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<PullInspection> {
    let worker = worker.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || pull_inspect(&worker, &runtime, false))
        .await
        .map_err(|_| Error::new("SYNC_TASK", "同步拉取未完成"))?
}

#[tauri::command]
pub async fn sync_resolve_conflict(
    input: ConflictInput,
    worker: tauri::State<'_, Worker>,
    runtime: tauri::State<'_, Arc<SyncRuntime>>,
) -> Result<ConflictResult> {
    let worker = worker.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match input.choice {
        ConflictChoice::KeepLocal => push(&worker, &runtime, true).map(ConflictResult::Push),
        ConflictChoice::UseRemote => pull_inspect(&worker, &runtime, true)
            .map(|inspection| ConflictResult::Pull(Box::new(inspection))),
    })
    .await
    .map_err(|_| Error::new("SYNC_TASK", "同步冲突处理未完成"))?
}

pub fn status(worker: &Worker, runtime: &SyncRuntime) -> Result<StatusResult> {
    let config = runtime.config()?;
    if !is_configured(&config) {
        return Ok(StatusResult {
            state: "unconfigured",
            local: LocalStatus {
                changed: false,
                schema: SCHEMA_VERSION as u32,
                empty: true,
                table_counts: Default::default(),
            },
            remote: None,
        });
    }
    let local = local_fingerprint(worker)?;
    let client = client(&config)?;
    let (remote, _) = resolve_remote(&client, &config)?;
    let local_changed = config
        .last_synced_fingerprint
        .as_ref()
        .is_none_or(|baseline| baseline != &local.digest);
    let remote_changed = match (&remote, config.last_synced_remote_version) {
        (None, None) => false,
        (Some(remote), Some(version)) => remote.version != version,
        (Some(_), None) | (None, Some(_)) => true,
    };
    let decision = decide(&DecisionInput {
        configured: true,
        local_changed,
        remote_changed,
        local_empty: local.empty,
        remote: remote.clone(),
        local_schema: local.schema_version,
        has_sync_baseline: config.last_synced_fingerprint.is_some()
            && config.last_synced_remote_version.is_some(),
    })?;
    Ok(StatusResult {
        state: match decision {
            SyncDecision::Disabled => "unconfigured",
            SyncDecision::UpToDate => "up_to_date",
            SyncDecision::EmptyRemote => "empty_remote",
            SyncDecision::Push => "local_ahead",
            SyncDecision::Pull => "remote_ahead",
            SyncDecision::Conflict => "conflict",
        },
        local: LocalStatus {
            changed: local_changed,
            schema: local.schema_version,
            empty: local.empty,
            table_counts: local.table_counts,
        },
        remote: remote.as_ref().map(remote_status),
    })
}

pub fn push(worker: &Worker, runtime: &SyncRuntime, force: bool) -> Result<PushResult> {
    let mut config = require_configured(runtime)?;
    let client = client(&config)?;
    let (remote, etag) = resolve_remote(&client, &config)?;

    match reconcile_pending(&config, remote.as_ref())? {
        PendingResolution::None => {}
        PendingResolution::Committed => {
            let pending = config.pending_push.take().expect("pending push exists");
            commit_push(runtime, config, &pending.manifest, &pending.fingerprint)?;
            return Ok(PushResult {
                version: pending.manifest.version,
            });
        }
        PendingResolution::Retryable => {
            let pending = config.pending_push.clone().expect("pending push exists");
            return retry_pending_manifest(runtime, config, &client, remote, etag, pending);
        }
        PendingResolution::Conflict => {
            return Err(Error::new(
                "SYNC_RESULT_UNKNOWN",
                "上次推送结果无法确认，且远端已改变，请先核对冲突",
            ));
        }
    }

    let local = local_fingerprint(worker)?;
    if remote
        .as_ref()
        .is_some_and(|manifest| manifest.schema_version > local.schema_version)
    {
        return Err(Error::new(
            "SYNC_SCHEMA_NEWER",
            "远端资料由较新版本的物谱创建，请先升级应用",
        ));
    }
    if !force {
        let local_changed = config
            .last_synced_fingerprint
            .as_ref()
            .is_none_or(|baseline| baseline != &local.digest);
        let remote_changed = match (&remote, config.last_synced_remote_version) {
            (None, None) => false,
            (Some(remote), Some(version)) => remote.version != version,
            (Some(_), None) | (None, Some(_)) => true,
        };
        let decision = decide(&DecisionInput {
            configured: true,
            local_changed,
            remote_changed,
            local_empty: local.empty,
            remote: remote.clone(),
            local_schema: local.schema_version,
            has_sync_baseline: config.last_synced_fingerprint.is_some()
                && config.last_synced_remote_version.is_some(),
        })?;
        if !matches!(decision, SyncDecision::Push | SyncDecision::EmptyRemote) {
            return Err(Error::new(
                "SYNC_DIRECTION",
                "当前同步状态不能直接推送，请先处理远端变化",
            ));
        }
    }

    let passphrase = runtime.passphrase.get()?;
    let library_id = match config.library_id.clone() {
        Some(library_id) => library_id,
        None if remote.is_none() => {
            let library_id = Uuid::new_v4().to_string();
            config.library_id = Some(library_id.clone());
            library_id
        }
        None => return Err(Error::new("SYNC_LIBRARY", "无法确定远端同步资料库")),
    };
    let remote_root = library_root(&config.base_path, &library_id);
    ensure_collections(&client, &join_path(&remote_root, "snapshots"))?;

    fs::create_dir_all(&runtime.staging)
        .map_err(|_| Error::new("SYNC_STAGING", "无法准备同步暂存目录"))?;
    let temporary = tempfile::tempdir_in(&runtime.staging)
        .map_err(|_| Error::new("SYNC_STAGING", "无法准备同步暂存目录"))?;
    let archive = temporary.path().join("complete.thingary");
    let archive_for_worker = archive.clone();
    let (archive_path, measured) = worker.call_personal(move |store| {
        store.backup(Some(&archive_for_worker))?;
        let measured = fingerprint(store)?;
        Ok((archive_for_worker, measured))
    })?;
    let plaintext =
        fs::read(&archive_path).map_err(|_| Error::new("SYNC_STAGING", "无法读取完整备份快照"))?;
    let ciphertext = encrypt_snapshot(&plaintext, &passphrase)?;
    let version = remote.as_ref().map_or(1, |manifest| manifest.version + 1);
    let created_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let snapshot_name = format!(
        "{}-{}.thingary.age",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        device_short(&config.device_id)
    );
    let snapshot_relative = format!("snapshots/{snapshot_name}");
    let snapshot_path = join_path(&remote_root, &snapshot_relative);
    client.put(&snapshot_path, &ciphertext, PutCondition::None)?;
    let uploaded = client.get(&snapshot_path)?;
    let manifest = Manifest {
        format: 1,
        library_id,
        version,
        snapshot: snapshot_relative,
        snapshot_sha256: sha256_hex(&ciphertext),
        snapshot_bytes: ciphertext.len() as u64,
        schema_version: local.schema_version,
        app_version: env!("CARGO_PKG_VERSION").into(),
        device_id: config.device_id.clone(),
        device_name: config.device_name.clone(),
        created_at,
    };
    verify_snapshot(&manifest, &uploaded.body)?;

    config.pending_push = Some(PendingPush {
        previous_remote_version: remote.as_ref().map_or(0, |manifest| manifest.version),
        manifest: manifest.clone(),
        fingerprint: measured.digest.clone(),
    });
    runtime.save_config(config.clone())?;

    let condition = manifest_condition(&client, &remote_root, remote.as_ref(), etag.as_deref())?;
    let manifest_path = join_path(&remote_root, "manifest.json");
    match client.put(&manifest_path, &manifest.to_json()?, condition) {
        Ok(_) => {}
        Err(error) if error.code == "SYNC_PRECONDITION" => {
            config.pending_push = None;
            runtime.save_config(config)?;
            return Err(error);
        }
        Err(_) => match fetch_manifest(&client, &remote_root)? {
            (Some(observed), _) if observed == manifest => {}
            _ => {
                return Err(Error::new(
                    "SYNC_RESULT_UNKNOWN",
                    "远端可能已经接收同步清单；下次同步会先核对结果",
                ));
            }
        },
    }
    commit_push(runtime, config, &manifest, &measured.digest)?;
    prune_snapshots(&client, &remote_root, &manifest.snapshot);
    Ok(PushResult { version })
}

fn retry_pending_manifest(
    runtime: &SyncRuntime,
    mut config: SyncConfig,
    client: &UreqWebDav,
    remote: Option<Manifest>,
    etag: Option<String>,
    pending: PendingPush,
) -> Result<PushResult> {
    let library_id = config
        .library_id
        .clone()
        .ok_or_else(|| Error::new("SYNC_LIBRARY", "同步资料库标识缺失"))?;
    let root = library_root(&config.base_path, &library_id);
    let condition = manifest_condition(client, &root, remote.as_ref(), etag.as_deref())?;
    match client.put(
        &join_path(&root, "manifest.json"),
        &pending.manifest.to_json()?,
        condition,
    ) {
        Ok(_) => commit_push(runtime, config, &pending.manifest, &pending.fingerprint)?,
        Err(error) if error.code == "SYNC_PRECONDITION" => {
            config.pending_push = None;
            runtime.save_config(config)?;
            return Err(error);
        }
        Err(_) => {
            return Err(Error::new(
                "SYNC_RESULT_UNKNOWN",
                "远端可能已经接收同步清单；下次同步会先核对结果",
            ));
        }
    }
    Ok(PushResult {
        version: pending.manifest.version,
    })
}

/// What a read-only look at the cloud found out about an unconfirmed push.
#[derive(Debug, Serialize)]
pub struct ReconcileResult {
    /// `nothing_pending`, `landed` (the manifest did reach the cloud), `not_landed`
    /// (the cloud is unchanged) or `remote_changed` (another device wrote since).
    pub outcome: &'static str,
    pub version: Option<u64>,
}

/// Read-only: reads the remote manifest, never writes to the cloud or the library.
/// It only settles this device's own bookkeeping (`pending_push`), so the next
/// `status` is truthful: `landed` records the push as synced; the other two forget
/// the unconfirmed attempt, leaving the ordinary local/remote comparison to decide
/// between pushing again and asking the user about a conflict.
pub fn reconcile(runtime: &SyncRuntime) -> Result<ReconcileResult> {
    let mut config = require_configured(runtime)?;
    if config.pending_push.is_none() {
        return Ok(ReconcileResult {
            outcome: "nothing_pending",
            version: None,
        });
    }
    let client = client(&config)?;
    let (remote, _) = resolve_remote(&client, &config)?;
    match reconcile_pending(&config, remote.as_ref())? {
        PendingResolution::None => Ok(ReconcileResult {
            outcome: "nothing_pending",
            version: None,
        }),
        PendingResolution::Committed => {
            let pending = config.pending_push.take().expect("pending push exists");
            let version = pending.manifest.version;
            commit_push(runtime, config, &pending.manifest, &pending.fingerprint)?;
            Ok(ReconcileResult {
                outcome: "landed",
                version: Some(version),
            })
        }
        resolution => {
            config.pending_push = None;
            runtime.save_config(config)?;
            Ok(ReconcileResult {
                outcome: if matches!(resolution, PendingResolution::Retryable) {
                    "not_landed"
                } else {
                    "remote_changed"
                },
                version: remote.map(|manifest| manifest.version),
            })
        }
    }
}

pub fn pull_inspect(worker: &Worker, runtime: &SyncRuntime, force: bool) -> Result<PullInspection> {
    let config = require_configured(runtime)?;
    let client = client(&config)?;
    let (remote, _) = resolve_remote(&client, &config)?;
    let remote = remote.ok_or_else(|| Error::new("SYNC_EMPTY_REMOTE", "远端没有可拉取的快照"))?;
    if remote.schema_version > SCHEMA_VERSION as u32 {
        return Err(Error::new(
            "SYNC_SCHEMA_NEWER",
            "远端资料由较新版本的物谱创建，请先升级应用",
        ));
    }
    if !force {
        let checked = status(worker, runtime)?;
        if checked.state != "remote_ahead" {
            return Err(Error::new(
                "SYNC_DIRECTION",
                "当前同步状态不能直接拉取，请先处理本机变化",
            ));
        }
    }
    let library_id = remote.library_id.clone();
    let root = library_root(&config.base_path, &library_id);
    let encrypted = client.get(&join_path(&root, &remote.snapshot))?.body;
    verify_snapshot(&remote, &encrypted)?;
    let plaintext = decrypt_snapshot(&encrypted, &runtime.passphrase.get()?)?;
    fs::create_dir_all(&runtime.staging)
        .map_err(|_| Error::new("SYNC_STAGING", "无法准备同步暂存目录"))?;
    let mut archive = tempfile::NamedTempFile::new_in(&runtime.staging)
        .map_err(|_| Error::new("SYNC_STAGING", "无法准备同步暂存目录"))?;
    archive
        .write_all(&plaintext)
        .and_then(|_| archive.as_file().sync_all())
        .map_err(|_| Error::new("SYNC_STAGING", "无法写入同步暂存快照"))?;
    let started = worker.backup_inspect_begin(archive.path().to_path_buf())?;
    if started.encrypted || started.summary.is_none() {
        return Err(Error::new("SYNC_RESTORE", "同步快照未通过现有恢复检查"));
    }
    let result = PullInspection {
        token: started.token.clone(),
        summary: started.summary,
        version: remote.version,
        device_name: remote.device_name.clone(),
        created_at: remote.created_at.clone(),
    };
    let mut pending = runtime
        .pending_pull
        .lock()
        .map_err(|_| Error::new("SYNC_STATE", "同步状态暂不可用"))?;
    *pending = Some(PendingPull {
        token: started.token,
        manifest: remote,
    });
    Ok(result)
}

pub fn finalize_pending_pull(worker: &Worker, runtime: &SyncRuntime) -> Result<()> {
    let pending = runtime
        .pending_pull
        .lock()
        .map_err(|_| Error::new("SYNC_STATE", "同步状态暂不可用"))?
        .clone();
    let Some(pending) = pending else {
        return Ok(());
    };
    if worker
        .backup_session_result(pending.token.clone())?
        .is_none()
    {
        return Ok(());
    }
    let measured = local_fingerprint(worker)?;
    let mut config = runtime.config()?;
    config.library_id = Some(pending.manifest.library_id);
    config.last_synced_remote_version = Some(pending.manifest.version);
    config.last_synced_fingerprint = Some(measured.digest);
    config.last_synced_at = Some(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    config.pending_push = None;
    runtime.save_config(config)?;
    *runtime
        .pending_pull
        .lock()
        .map_err(|_| Error::new("SYNC_STATE", "同步状态暂不可用"))? = None;
    Ok(())
}

fn local_fingerprint(worker: &Worker) -> Result<Fingerprint> {
    let demo = worker.demo_status()?;
    if demo.active {
        if !demo.started {
            return Ok(Fingerprint {
                digest: sha256_hex(b"thingary-empty-personal-library"),
                schema_version: SCHEMA_VERSION as u32,
                table_counts: Default::default(),
                managed_files: 0,
                empty: true,
            });
        }
        return Err(Error::new(
            "SYNC_SAMPLE",
            "请先退出样例资料，再同步个人资料库",
        ));
    }
    worker.call_personal(|store| fingerprint(store))
}

fn require_configured(runtime: &SyncRuntime) -> Result<SyncConfig> {
    let config = runtime.config()?;
    if !is_configured(&config) {
        return Err(Error::new("SYNC_UNCONFIGURED", "请先配置 WebDAV 同步"));
    }
    Ok(config)
}

fn is_configured(config: &SyncConfig) -> bool {
    config.enabled
        && !config.base_url.is_empty()
        && !config.username.is_empty()
        && !config.password.is_empty()
}

fn client(config: &SyncConfig) -> Result<UreqWebDav> {
    UreqWebDav::new(
        config.base_url.clone(),
        config.username.clone(),
        config.password.clone(),
    )
}

fn resolve_remote(
    client: &UreqWebDav,
    config: &SyncConfig,
) -> Result<(Option<Manifest>, Option<String>)> {
    if let Some(library_id) = config.library_id.as_ref() {
        return fetch_manifest(client, &library_root(&config.base_path, library_id));
    }
    let thingary = join_path(&config.base_path, "Thingary");
    let listing = match client.propfind(&thingary, 1) {
        Ok(listing) => listing,
        Err(error) if error.code == "SYNC_NOT_FOUND" => return Ok((None, None)),
        Err(error) => return Err(error),
    };
    let mut libraries = listing
        .hrefs
        .iter()
        .filter_map(|href| href.trim_end_matches('/').rsplit('/').next())
        .filter(|part| Uuid::parse_str(part).is_ok())
        .map(str::to_string)
        .collect::<Vec<_>>();
    libraries.sort();
    libraries.dedup();
    match libraries.as_slice() {
        [] => Ok((None, None)),
        [library_id] => fetch_manifest(client, &library_root(&config.base_path, library_id)),
        _ => Err(Error::new(
            "SYNC_LIBRARY_CHOICE",
            "远端包含多个物谱资料库，当前版本无法自动选择",
        )),
    }
}

fn fetch_manifest(
    client: &UreqWebDav,
    remote_root: &str,
) -> Result<(Option<Manifest>, Option<String>)> {
    match client.get_optional(&join_path(remote_root, "manifest.json"))? {
        None => Ok((None, None)),
        Some(DavResponse { body, etag }) => Ok((Some(Manifest::parse(&body)?), etag)),
    }
}

fn manifest_condition(
    client: &UreqWebDav,
    remote_root: &str,
    expected: Option<&Manifest>,
    etag: Option<&str>,
) -> Result<PutCondition> {
    if let Some(etag) = etag {
        return Ok(PutCondition::Match(etag.to_string()));
    }
    let (observed, _) = fetch_manifest(client, remote_root)?;
    if observed.as_ref() != expected {
        return Err(Error::new(
            "SYNC_PRECONDITION",
            "远端同步清单已被其他设备更新",
        ));
    }
    Ok(if expected.is_none() {
        PutCondition::Missing
    } else {
        PutCondition::None
    })
}

fn commit_push(
    runtime: &SyncRuntime,
    mut config: SyncConfig,
    manifest: &Manifest,
    fingerprint: &str,
) -> Result<()> {
    config.library_id = Some(manifest.library_id.clone());
    config.last_synced_remote_version = Some(manifest.version);
    config.last_synced_fingerprint = Some(fingerprint.to_string());
    config.last_synced_at = Some(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    config.pending_push = None;
    runtime.save_config(config)
}

fn remote_status(manifest: &Manifest) -> RemoteStatus {
    RemoteStatus {
        version: manifest.version,
        device_name: manifest.device_name.clone(),
        created_at: manifest.created_at.clone(),
        schema_version: manifest.schema_version,
        snapshot_bytes: manifest.snapshot_bytes,
        slow_sync_warning: manifest.snapshot_bytes > SLOW_SYNC_BYTES,
    }
}

fn ensure_collections(client: &UreqWebDav, path: &str) -> Result<()> {
    let mut current = String::new();
    for component in path.split('/') {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(component);
        client.mkcol(&current)?;
    }
    Ok(())
}

fn prune_snapshots(client: &UreqWebDav, remote_root: &str, current: &str) {
    let snapshots_root = join_path(remote_root, "snapshots");
    let Ok(listing) = client.propfind(&snapshots_root, 1) else {
        return;
    };
    let mut names = listing
        .hrefs
        .iter()
        .filter_map(|href| href.trim_end_matches('/').rsplit('/').next())
        .filter(|name| name.ends_with(".thingary.age"))
        .map(str::to_string)
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    while names.len() > 5 {
        let name = names.remove(0);
        if current.ends_with(&name) {
            names.push(name);
            names.sort();
            continue;
        }
        let _ = client.delete(&join_path(&snapshots_root, &name));
    }
}

fn normalize_base_path(path: &str) -> Result<String> {
    let path = path.trim().trim_matches('/');
    if path.is_empty() {
        return Ok(String::new());
    }
    if path
        .split('/')
        .any(|component| component.is_empty() || matches!(component, "." | ".."))
    {
        return Err(Error::new("SYNC_PATH", "WebDAV 基础路径无效"));
    }
    Ok(path.to_string())
}

fn join_path(left: &str, right: &str) -> String {
    match (left.trim_matches('/'), right.trim_matches('/')) {
        ("", right) => right.to_string(),
        (left, "") => left.to_string(),
        (left, right) => format!("{left}/{right}"),
    }
}

fn library_root(base_path: &str, library_id: &str) -> String {
    join_path(&join_path(base_path, "Thingary"), library_id)
}

fn device_short(device_id: &str) -> String {
    let short = device_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();
    if short.is_empty() {
        "device".into()
    } else {
        short
    }
}
