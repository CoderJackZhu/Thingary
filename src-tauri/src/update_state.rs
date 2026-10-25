//! Update discovery state (D5): the user's opt-in choice, one automatic round
//! per process, a 24-hour interval between attempts, in-flight deduplication,
//! cancel epochs and a dated candidate cache.
//!
//! Everything lives in two machine-local files beside the other app
//! preferences (`update-preferences.json`, `update-cache.json`); nothing here
//! enters the library database, a backup or the financial schema. The network
//! lookup itself stays in `update_check`; this module only decides when it is
//! allowed and what to remember about it.
//!
//! The service is process-wide: the automatic budget (`auto_used`) is spent at
//! most once per process run no matter how often the window closes or the
//! front end remounts. Locks are held for file reads/writes and state
//! decisions only, never across the network call.
use crate::{
    domain::{Error, Result},
    update_check::{self, Source},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
};

const PREFERENCES_FILE: &str = "update-preferences.json";
const CACHE_FILE: &str = "update-cache.json";
const FORMAT_VERSION: u32 = 1;
/// How long a confirmed candidate may keep its unread dot (7 × 24 h).
const FRESH_FOR_SECS: i64 = 7 * 24 * 60 * 60;
/// Minimum spacing between two network attempts, successful or not.
const RETRY_AFTER_SECS: i64 = 24 * 60 * 60;

fn future_format(path: &Path) -> bool {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("format_version").and_then(|v| v.as_u64()))
        .is_some_and(|version| version > u64::from(FORMAT_VERSION))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Consent {
    /// No choice recorded yet: never network, but the one-time ask is allowed.
    #[default]
    Unset,
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Preferences {
    pub format_version: u32,
    pub consent: Consent,
    /// Monotonic local revision; stale front-end writes must not overwrite a
    /// newer choice.
    pub preference_revision: u32,
    /// Highest regular version the user actually saw (compared numerically).
    pub highest_seen_version: Option<String>,
    /// The one version the user chose to ignore; not "turn auto checks off".
    pub ignored_version: Option<String>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            format_version: FORMAT_VERSION,
            consent: Consent::Unset,
            preference_revision: 0,
            highest_seen_version: None,
            ignored_version: None,
        }
    }
}
impl Preferences {
    fn load(root: &Path) -> std::result::Result<Self, String> {
        let path = root.join(PREFERENCES_FILE);
        if !path.exists() {
            // A first run is "no choice yet", not damage.
            return Ok(Preferences::default());
        }
        let bytes = fs::read(path).map_err(|e| format!("读取失败：{e}"))?;
        let parsed: Preferences =
            serde_json::from_slice(&bytes).map_err(|e| format!("内容无法识别：{e}"))?;
        if parsed.format_version != FORMAT_VERSION {
            return Err(format!(
                "偏好由更新版本的物谱写入（格式 {}），请升级后再试",
                parsed.format_version
            ));
        }
        Ok(parsed)
    }
    fn save(&self, root: &Path) -> Result<()> {
        crate::storage::atomic_write(&root.join(PREFERENCES_FILE), &serde_json::to_vec(self)?)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CachedDownload {
    pub source: String,
    pub name: String,
    pub label: String,
    pub size: Option<u64>,
}
/// A discovery with the moment a mirror last confirmed it exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CachedRelease {
    pub version: String,
    pub published_at: String,
    pub notes: String,
    pub sources: Vec<String>,
    pub downloads: Vec<CachedDownload>,
    pub confirmed_at: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CacheContext {
    pub os: String,
    pub arch: String,
    pub app_version: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cache {
    pub format_version: u32,
    /// Last time any network attempt actually started, success or failure.
    pub last_attempt_at: Option<String>,
    /// Last time at least one source was read and parsed.
    pub last_success_at: Option<String>,
    pub candidate: Option<CachedRelease>,
    /// A higher release exists but has no compatible installer here.
    pub newer_unavailable: Option<CachedRelease>,
    /// Mirrors the last applied round could not read; disclosed, never fatal.
    #[serde(default)]
    pub last_unreachable: Vec<String>,
    pub context: Option<CacheContext>,
}
impl Default for Cache {
    fn default() -> Self {
        Self {
            format_version: FORMAT_VERSION,
            last_attempt_at: None,
            last_success_at: None,
            candidate: None,
            newer_unavailable: None,
            last_unreachable: Vec::new(),
            context: None,
        }
    }
}
impl Cache {
    /// A missing, damaged or future-format file is ignored and rebuilt; a
    /// broken cache never resets a valid consent.
    fn load(root: &Path) -> Self {
        fs::read(root.join(CACHE_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Cache>(&bytes).ok())
            .filter(|c| c.format_version == FORMAT_VERSION)
            .unwrap_or_default()
    }
    fn save(&self, root: &Path) -> Result<()> {
        if future_format(&root.join(CACHE_FILE)) {
            return Err(Error::new(
                "UPDATE_CACHE_FORMAT",
                "更新缓存来自较新版本，保留原文件，请升级后再试",
            ));
        }
        crate::storage::atomic_write(&root.join(CACHE_FILE), &serde_json::to_vec(self)?)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Automatic,
    Manual,
}
impl Origin {
    fn name(self) -> &'static str {
        match self {
            Origin::Automatic => "automatic",
            Origin::Manual => "manual",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "automatic" => Some(Self::Automatic),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }
}

/// What a `request` decided before any waiting happens.
#[derive(Debug)]
pub enum Begin {
    /// This caller started the round and the runner thread is already going.
    Started(Arc<TaskShared>),
    /// Another call is already in flight; wait for the very same task.
    Joined(Arc<TaskShared>),
    /// Nothing network-bound may happen. The reason is diagnostic only.
    Skipped(&'static str),
}

/// The finished round as each waiting caller sees it.
#[derive(Debug, Clone, Serialize)]
pub struct TaskResult {
    pub origin: &'static str,
    /// The attempt (and any successful result) reached the local state.
    pub applied: bool,
    /// The automatic switch was turned off mid-round; nothing was saved.
    pub cancelled: bool,
    /// A readable failure for the manual surface; automatic rounds stay quiet.
    pub error: Option<String>,
}

#[derive(Default, Debug)]
pub struct TaskShared {
    done: Mutex<Option<TaskResult>>,
    signal: Condvar,
}
impl TaskShared {
    fn publish(&self, result: TaskResult) {
        let mut done = self.done.lock().unwrap();
        *done = Some(result);
        self.signal.notify_all();
    }
    /// Blocks until the round finished; call from a blocking task.
    pub fn wait(&self) -> TaskResult {
        let mut done = self.done.lock().unwrap();
        while done.is_none() {
            done = self.signal.wait(done).unwrap();
        }
        done.clone().unwrap()
    }
}

struct InFlight {
    id: String,
    origin: Origin,
    /// Cancel epoch when the round started; an automatic round stops applying
    /// once the epoch moves (the user turned auto checks off).
    epoch: u64,
    shared: Arc<TaskShared>,
}

#[derive(Default)]
struct Inner {
    snapshot_revision: u64,
    auto_used: bool,
    cancel_epoch: u64,
    task: Option<Arc<InFlight>>,
    /// A manual result that could not be written down; shown for this
    /// session only, so the manual surface never lies about a lost state.
    unsaved: Option<Cache>,
}

type Clock = Box<dyn Fn() -> DateTime<Utc> + Send + Sync>;
type Fetch = Box<dyn Fn(Source) -> Result<String> + Send + Sync>;

pub struct UpdateState {
    inner: Mutex<Inner>,
    root: PathBuf,
    version: String,
    platform: update_check::Platform,
    clock: Clock,
    fetch: Fetch,
}

fn parse_stamp(value: Option<&str>) -> Option<DateTime<Utc>> {
    value
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|t| t.with_timezone(&Utc))
}

fn newer(a: &str, b: &str) -> bool {
    match (
        update_check::parse_version(a),
        update_check::parse_version(b),
    ) {
        (Some(x), Some(y)) => x > y,
        _ => false,
    }
}

fn cached_release(release: &update_check::Release, confirmed_at: &str) -> CachedRelease {
    CachedRelease {
        version: release.version.clone(),
        published_at: release.published_at.clone(),
        notes: release.notes.clone(),
        sources: release
            .sources
            .iter()
            .map(|s| s.name().to_owned())
            .collect(),
        downloads: release
            .downloads
            .iter()
            .map(|d| CachedDownload {
                source: d.source.name().to_owned(),
                name: d.name.clone(),
                label: d.label.clone(),
                size: d.size,
            })
            .collect(),
        confirmed_at: confirmed_at.to_owned(),
    }
}

impl UpdateState {
    pub fn new(root: PathBuf) -> Self {
        Self::with_hooks(
            root,
            env!("CARGO_PKG_VERSION").to_owned(),
            update_check::Platform::current(),
            Box::new(Utc::now),
            Box::new(update_check::fetch_public),
        )
    }
    pub fn with_hooks(
        root: PathBuf,
        version: String,
        platform: update_check::Platform,
        clock: Clock,
        fetch: Fetch,
    ) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            root,
            version,
            platform,
            clock,
            fetch,
        }
    }

    fn now(&self) -> DateTime<Utc> {
        (self.clock)()
    }

    /// Preferences with a damage marker; a damaged file never authorizes the
    /// network, but an explicit choice in settings may repair it.
    fn preferences(&self) -> (Preferences, Option<String>) {
        match Preferences::load(&self.root) {
            Ok(p) => (p, None),
            Err(reason) => (Preferences::default(), Some(reason)),
        }
    }
    fn cache(&self) -> Cache {
        Cache::load(&self.root)
    }
    fn read_cache_for_view(&self, inner: &Inner) -> (Cache, bool) {
        let unsaved = inner.unsaved.clone();
        match unsaved {
            Some(cache) => (cache, true),
            None => (self.cache(), false),
        }
    }

    fn epoch_alive(&self, epoch: u64) -> bool {
        self.inner.lock().unwrap().cancel_epoch == epoch
    }

    /// Phase 1: decide under the state lock whether a round may run. The
    /// runner thread is spawned by `spawn_round`; `begin` itself never
    /// touches the network. `run_round` is the synchronous test path.
    pub fn begin(&self, mode: Origin) -> Begin {
        let mut inner = self.inner.lock().unwrap();
        let (preferences, damage) = self.preferences();
        if damage.is_some() && mode == Origin::Automatic {
            return Begin::Skipped("preferences_damaged");
        }
        if mode == Origin::Automatic && preferences.consent != Consent::Enabled {
            return Begin::Skipped("not_enabled");
        }
        if let Some(task) = inner.task.clone() {
            // Joining never spends the automatic budget and never changes the
            // running task's origin: one round, one set of requests.
            return Begin::Joined(task.shared.clone());
        }
        if mode == Origin::Automatic {
            if inner.auto_used {
                return Begin::Skipped("already_ran_this_process");
            }
            let cache = self.cache();
            // A future stamp means the clock moved back: rebuild the base by
            // allowing this one round instead of skipping forever.
            let rollback = parse_stamp(cache.last_attempt_at.as_deref())
                .is_some_and(|at| self.now().timestamp() + 3600 < at.timestamp());
            if !rollback
                && parse_stamp(cache.last_attempt_at.as_deref()).is_some_and(|at| {
                    let age = self.now().timestamp() - at.timestamp();
                    (0..RETRY_AFTER_SECS).contains(&age)
                })
            {
                return Begin::Skipped("interval");
            }
        }
        // The attempt time is durable before any request leaves; an automatic
        // round that cannot record it does not start at all.
        let mut cache = inner.unsaved.clone().unwrap_or_else(|| self.cache());
        cache.format_version = FORMAT_VERSION;
        cache.last_attempt_at = Some(self.now().to_rfc3339());
        let persisted = cache.save(&self.root);
        if persisted.is_err() && mode == Origin::Automatic {
            return Begin::Skipped("attempt_not_recorded");
        }
        inner.unsaved = if persisted.is_err() {
            Some(cache)
        } else {
            None
        };
        let shared = Arc::new(TaskShared::default());
        let id = crate::storage::uid();
        let epoch = inner.cancel_epoch;
        inner.task = Some(Arc::new(InFlight {
            id,
            origin: mode,
            epoch,
            shared: shared.clone(),
        }));
        if mode == Origin::Automatic {
            inner.auto_used = true;
        }
        Begin::Started(shared)
    }

    /// The task identity for the round that `begin` just accepted.
    fn started_task(&self) -> (String, Origin, u64, Arc<TaskShared>) {
        let inner = self.inner.lock().unwrap();
        let task = inner.task.as_ref().expect("begin accepted the round");
        (
            task.id.clone(),
            task.origin,
            task.epoch,
            task.shared.clone(),
        )
    }

    /// The runner body: one dual-source lookup through the injected fetch,
    /// then the result is applied to the cache unless the round was
    /// cancelled. An automatic round re-checks the cancel epoch before every
    /// source (including the first) and before anything is persisted.
    fn execute(&self, task_id: &str, origin: Origin, epoch: u64) -> TaskResult {
        let mut fetch = |source: Source| -> Result<String> {
            if origin == Origin::Automatic && !self.epoch_alive(epoch) {
                return Err(Error::new("UPDATE_CANCELLED", "自动检查已关闭"));
            }
            (self.fetch)(source)
        };
        let outcome = update_check::check_for_platform(&self.version, self.platform, &mut fetch);
        let mut inner = self.inner.lock().unwrap();
        let still_current = inner
            .task
            .as_ref()
            .is_some_and(|t| t.id == task_id && t.epoch == epoch && t.origin == origin);
        let cancelled = origin == Origin::Automatic && inner.cancel_epoch != epoch;
        if !still_current {
            return TaskResult {
                origin: origin.name(),
                applied: false,
                cancelled,
                error: Some("已有新一轮检查，本次结果不再适用".into()),
            };
        }
        if cancelled {
            return TaskResult {
                origin: origin.name(),
                applied: false,
                cancelled: true,
                error: Some("自动检查已关闭，本次结果未保存".into()),
            };
        }
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                // Every source failed: keep the dated discovery and never
                // claim "already up to date". The attempt time is saved and
                // both mirrors are disclosed as unreachable.
                let mut cache = inner.unsaved.clone().unwrap_or_else(|| self.cache());
                cache.last_unreachable = Source::ALL.iter().map(|s| s.name().to_owned()).collect();
                if cache.save(&self.root).is_err() {
                    inner.unsaved = Some(cache);
                } else {
                    inner.unsaved = None;
                }
                return TaskResult {
                    origin: origin.name(),
                    applied: true,
                    cancelled: false,
                    error: Some(error.message.clone()),
                };
            }
        };
        let now = self.now();
        let mut cache = inner.unsaved.clone().unwrap_or_else(|| self.cache());
        if cache.context.as_ref().is_some_and(|context| {
            context.os != self.platform.os || context.arch != self.platform.arch
        }) {
            cache.candidate = None;
            cache.newer_unavailable = None;
        }
        cache.format_version = FORMAT_VERSION;
        cache.last_success_at = Some(now.to_rfc3339());
        let full_success = outcome.unreachable.is_empty();
        let incoming = if outcome.update_available {
            outcome.latest.as_ref()
        } else {
            None
        };
        // A partial answer may only raise the bar: one reachable mirror
        // listing nothing newer must not erase a higher candidate another
        // mirror confirmed before, nor refresh its confirmation date.
        let incoming_raises = incoming.is_some_and(|latest| {
            cache
                .candidate
                .as_ref()
                .map(|c| !newer(&c.version, &latest.version))
                .unwrap_or(true)
        });
        if full_success || incoming_raises || cache.candidate.is_none() {
            cache.candidate = incoming.map(|latest| cached_release(latest, &now.to_rfc3339()));
        }
        if full_success
            || outcome
                .newer_unavailable
                .as_ref()
                .is_some_and(|newer_release| {
                    cache
                        .newer_unavailable
                        .as_ref()
                        .is_none_or(|old| !newer(&old.version, &newer_release.version))
                })
        {
            cache.newer_unavailable = outcome
                .newer_unavailable
                .as_ref()
                .filter(|r| newer(&r.version, &self.version))
                .map(|r| cached_release(r, &now.to_rfc3339()));
        }
        // The app itself moved on: an at-or-below candidate is not an update.
        if cache
            .candidate
            .as_ref()
            .is_some_and(|c| !newer(&c.version, &self.version))
        {
            cache.candidate = None;
        }
        if cache.newer_unavailable.as_ref().is_some_and(|c| {
            !newer(&c.version, &self.version)
                || cache
                    .candidate
                    .as_ref()
                    .is_some_and(|ready| !newer(&c.version, &ready.version))
        }) {
            cache.newer_unavailable = None;
        }
        cache.last_unreachable = outcome
            .unreachable
            .iter()
            .map(|s| s.name().to_owned())
            .collect();
        cache.context = Some(CacheContext {
            os: self.platform.os.to_owned(),
            arch: self.platform.arch.to_owned(),
            app_version: self.version.clone(),
        });
        let write = cache.save(&self.root);
        inner.unsaved = match &write {
            Ok(()) => None,
            Err(_) => Some(cache),
        };
        TaskResult {
            origin: origin.name(),
            applied: write.is_ok(),
            cancelled: false,
            error: write
                .err()
                .map(|e| format!("本次检查完成，但结果暂时无法保存（{e}）；下次启动可能不记得。")),
        }
    }

    /// Frees the in-flight slot once the round finished.
    fn finish(&self, task_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner.task.as_ref().is_some_and(|t| t.id == task_id) {
            inner.task = None;
        }
    }

    /// Sets the opt-in choice. `expected_revision` guards a stale front-end
    /// write; the explicit save also repairs a damaged preferences file (the
    /// unreadable original is kept beside it for inspection).
    pub fn set_consent(&self, enabled: bool, expected_revision: u32) -> Result<StateView> {
        let mut inner = self.inner.lock().unwrap();
        let (mut preferences, damage) = self.preferences();
        if future_format(&self.root.join(PREFERENCES_FILE)) {
            return Err(Error::new(
                "UPDATE_PREFERENCES_FORMAT",
                "设置来自较新版本，已保留原文件，请升级后再试",
            ));
        }
        if preferences.preference_revision != expected_revision {
            return Err(Error::new(
                "UPDATE_PREFERENCES_CONFLICT",
                "自动检查的选择已变化，请重新读取后再设置",
            ));
        }
        if damage.is_some() {
            let broken = self.root.join(PREFERENCES_FILE);
            let original_backup = self.root.join("update-preferences.invalid.json");
            let backup = if original_backup.exists() {
                self.root.join(format!(
                    "update-preferences.invalid-{}.json",
                    crate::storage::uid()
                ))
            } else {
                original_backup
            };
            fs::copy(&broken, backup).map_err(|_| {
                Error::new(
                    "UPDATE_PREFERENCES_BACKUP",
                    "无法保留损坏设置的原文件，本次没有重建，请检查目录权限后重试",
                )
            })?;
        }
        preferences.consent = if enabled {
            Consent::Enabled
        } else {
            Consent::Disabled
        };
        preferences.preference_revision += 1;
        preferences.format_version = FORMAT_VERSION;
        preferences.save(&self.root)?;
        if !enabled {
            // Automatic rounds already running stop at the next source and
            // never apply their late result.
            inner.cancel_epoch += 1;
        }
        drop(inner);
        Ok(self.view())
    }

    /// Marks one version as actually seen (about page card visible).
    pub fn mark_seen(&self, version: &str) -> Result<StateView> {
        if update_check::parse_version(version).is_none() {
            return Err(Error::new("UPDATE_VERSION", "版本号无效"));
        }
        let inner = self.inner.lock().unwrap();
        let mut preferences = Preferences::load(&self.root)
            .map_err(|reason| Error::new("UPDATE_PREFERENCES", &reason))?;
        let should_raise = preferences
            .highest_seen_version
            .as_deref()
            .map(|seen| newer(version, seen))
            .unwrap_or(true);
        if should_raise {
            preferences.highest_seen_version = Some(version.to_owned());
            preferences.preference_revision += 1;
            preferences.save(&self.root)?;
        }
        drop(inner);
        Ok(self.view())
    }

    /// Ignores exactly one version; consent and other versions stay as they
    /// are.
    pub fn ignore_version(&self, version: &str) -> Result<StateView> {
        if update_check::parse_version(version).is_none() {
            return Err(Error::new("UPDATE_VERSION", "版本号无效"));
        }
        let inner = self.inner.lock().unwrap();
        let mut preferences = Preferences::load(&self.root)
            .map_err(|reason| Error::new("UPDATE_PREFERENCES", &reason))?;
        preferences.ignored_version = Some(version.to_owned());
        preferences.preference_revision += 1;
        preferences.save(&self.root)?;
        drop(inner);
        Ok(self.view())
    }

    /// Everything the surfaces render; no network, no library data.
    pub fn view(&self) -> StateView {
        let mut inner = self.inner.lock().unwrap();
        inner.snapshot_revision += 1;
        let store_managed = update_check::store_managed();
        let (preferences, preferences_problem) = self.preferences();
        let (mut cache, cache_unsaved) = self.read_cache_for_view(&inner);
        let context_matches = cache.context.as_ref().is_some_and(|c| {
            c.os == self.platform.os
                && c.arch == self.platform.arch
                && c.app_version == self.version
        });
        if !context_matches {
            // A cache from another platform, architecture or app version is
            // history, not a compatible discovery.
            cache.candidate = None;
            cache.newer_unavailable = None;
        }
        let candidate = cache.candidate.clone();
        let update_available = candidate
            .as_ref()
            .is_some_and(|c| newer(&c.version, &self.version));
        let candidate_fresh = candidate.as_ref().is_some_and(|c| {
            parse_stamp(Some(c.confirmed_at.as_str())).is_some_and(|at| {
                let age = self.now().timestamp() - at.timestamp();
                (0..=FRESH_FOR_SECS).contains(&age)
            })
        });
        let unread = update_available
            && candidate_fresh
            && candidate.as_ref().is_some_and(|c| {
                preferences
                    .highest_seen_version
                    .as_deref()
                    .map(|seen| newer(&c.version, seen))
                    .unwrap_or(true)
                    && preferences.ignored_version.as_deref() != Some(c.version.as_str())
            });
        StateView {
            snapshot_revision: inner.snapshot_revision,
            current_version: self.version.clone(),
            platform_label: self.platform.label(),
            consent: match preferences.consent {
                Consent::Unset => "unset".into(),
                Consent::Enabled => "enabled".into(),
                Consent::Disabled => "disabled".into(),
            },
            preferences_status: if preferences_problem.is_some() {
                "damaged".into()
            } else {
                "ok".into()
            },
            preferences_problem,
            preferences_repairable: !future_format(&self.root.join(PREFERENCES_FILE)),
            preference_revision: preferences.preference_revision,
            highest_seen_version: preferences.highest_seen_version,
            ignored_version: preferences.ignored_version,
            last_attempt_at: cache.last_attempt_at,
            last_success_at: cache.last_success_at,
            candidate: if update_available && !store_managed {
                candidate
            } else {
                None
            },
            newer_unavailable: if store_managed {
                None
            } else {
                cache.newer_unavailable
            },
            last_unreachable: cache.last_unreachable,
            cache_applicable: context_matches,
            cache_unsaved,
            update_available: update_available && !store_managed,
            candidate_fresh: candidate_fresh && !store_managed,
            unread: unread && !store_managed,
            store_managed,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StateView {
    /// Orders complete IPC snapshots, even when a damaged file resets its
    /// preference revision. Older responses cannot undo a repair in the UI.
    pub snapshot_revision: u64,
    pub current_version: String,
    /// Display text like "Mac · Apple Silicon", for the download button only.
    pub platform_label: String,
    pub consent: String,
    pub preferences_status: String,
    pub preferences_problem: Option<String>,
    pub preferences_repairable: bool,
    pub preference_revision: u32,
    pub highest_seen_version: Option<String>,
    pub ignored_version: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub candidate: Option<CachedRelease>,
    pub newer_unavailable: Option<CachedRelease>,
    /// Mirrors the last applied round could not read.
    pub last_unreachable: Vec<String>,
    pub cache_applicable: bool,
    /// The last manual result could not be written down; this view is
    /// session-only.
    pub cache_unsaved: bool,
    pub update_available: bool,
    pub candidate_fresh: bool,
    pub unread: bool,
    /// The Microsoft Store owns updates for this build; all other update
    /// fields are informational and the surfaces hide their actions.
    pub store_managed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RequestView {
    /// started / joined / skipped; a skip is never a user-visible error.
    pub decision: String,
    pub task: Option<TaskResult>,
    pub state: StateView,
}

/// Spawns the runner thread for a round; the shared slot is what every caller
/// (starter or joiner) waits on, so a dropped command future never strands
/// later callers on a task that does not run.
pub fn spawn_round(service: &Arc<UpdateState>, mode: Origin) -> Begin {
    match service.begin(mode) {
        Begin::Skipped(reason) => Begin::Skipped(reason),
        Begin::Joined(shared) => Begin::Joined(shared),
        Begin::Started(_) => {
            let (id, origin, epoch, shared) = service.started_task();
            let worker = Arc::clone(service);
            let runner_id = id.clone();
            let publish = Arc::clone(&shared);
            match std::thread::Builder::new()
                .name("thingary-update-check".into())
                .spawn(move || {
                    let result = worker.execute(&runner_id, origin, epoch);
                    worker.finish(&runner_id);
                    publish.publish(result);
                }) {
                Ok(_) => Begin::Started(shared),
                Err(_) => {
                    service.finish(&id);
                    shared.publish(TaskResult {
                        origin: origin.name(),
                        applied: false,
                        cancelled: false,
                        error: Some("无法启动更新检查，请稍后再试".into()),
                    });
                    Begin::Skipped("thread_spawn_failed")
                }
            }
        }
    }
}

/// Synchronous round used by the tests; production goes through
/// `spawn_round` plus a blocking wait on the shared slot.
#[cfg(test)]
fn run_round(service: &Arc<UpdateState>, mode: Origin) -> (Begin, Option<TaskResult>) {
    match service.begin(mode) {
        Begin::Skipped(reason) => (Begin::Skipped(reason), None),
        Begin::Joined(_) => unreachable!("no test leaves a round in flight"),
        Begin::Started(shared) => {
            let (id, origin, epoch, _) = service.started_task();
            let result = service.execute(&id, origin, epoch);
            service.finish(&id);
            shared.publish(result.clone());
            (Begin::Started(shared), Some(result))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, time::Duration};

    #[test]
    fn damaged_preferences_still_allow_an_explicit_manual_lookup() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(PREFERENCES_FILE), b"{broken").unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.9"), err()]);
        let (begin, result) = run_round(&service, Origin::Manual);
        assert!(matches!(begin, Begin::Started(_)));
        assert!(result.unwrap().applied);
        assert!(service.view().update_available);
        assert_eq!(
            fs::read(dir.path().join(PREFERENCES_FILE)).unwrap(),
            b"{broken"
        );
    }

    #[test]
    fn future_preferences_are_not_repaired_by_any_action() {
        let dir = tempfile::tempdir().unwrap();
        let future = Preferences {
            format_version: FORMAT_VERSION + 1,
            ..Preferences::default()
        };
        fs::write(
            dir.path().join(PREFERENCES_FILE),
            serde_json::to_vec(&future).unwrap(),
        )
        .unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        assert!(service.set_consent(true, 0).is_err());
        assert!(service.mark_seen("0.0.9").is_err());
        assert!(service.ignore_version("0.0.9").is_err());
        assert_eq!(
            fs::read(dir.path().join(PREFERENCES_FILE)).unwrap(),
            serde_json::to_vec(&future).unwrap()
        );
    }

    #[test]
    fn consent_writes_with_one_revision_accept_only_one_concurrent_choice() {
        let dir = tempfile::tempdir().unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let workers: Vec<_> = (0..8)
            .map(|i| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    service.set_consent(i % 2 == 0, 0).is_ok()
                })
            })
            .collect();
        let successes = workers
            .into_iter()
            .filter_map(|w| w.join().ok())
            .filter(|ok| *ok)
            .count();
        assert_eq!(
            successes, 1,
            "a stale choice cannot overwrite another successful write"
        );
    }

    #[test]
    fn concurrent_seen_and_ignore_preserve_consent_and_the_highest_seen_version() {
        let dir = tempfile::tempdir().unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        service.set_consent(false, 0).unwrap();
        let workers: Vec<_> = (8..16)
            .map(|patch| {
                let service = Arc::clone(&service);
                std::thread::spawn(move || {
                    service.mark_seen(&format!("0.0.{patch}")).unwrap();
                    service.ignore_version(&format!("0.0.{patch}")).unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let view = service.view();
        assert_eq!(view.consent, "disabled");
        assert_eq!(view.highest_seen_version.as_deref(), Some("0.0.15"));
    }

    #[test]
    fn a_future_cache_blocks_automatic_writes_but_manual_results_remain_ephemeral() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.9"), err()]);
        service.set_consent(true, 0).unwrap();
        let future = br#"{"format_version":2,"new_data":"keep"}"#;
        fs::write(dir.path().join(CACHE_FILE), future).unwrap();
        assert!(matches!(
            service.begin(Origin::Automatic),
            Begin::Skipped("attempt_not_recorded")
        ));
        let (_, result) = run_round(&service, Origin::Manual);
        assert!(!result.unwrap().applied);
        assert!(service.view().update_available && service.view().cache_unsaved);
        assert_eq!(fs::read(dir.path().join(CACHE_FILE)).unwrap(), future);
    }

    #[test]
    fn a_partial_lookup_cannot_relabel_another_platforms_cached_installer() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let mac = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.9"), err()]);
        run_round(&mac, Origin::Manual);
        let answers = Mutex::new(VecDeque::from(vec![Ok("[]".into()), err()]));
        let windows = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            update_check::Platform {
                os: "windows",
                arch: "x86_64",
            },
            Box::new(Utc::now),
            Box::new(move |_| answers.lock().unwrap().pop_front().unwrap()),
        ));
        run_round(&windows, Origin::Manual);
        assert!(!windows.view().update_available);
        assert!(windows.view().candidate.is_none());
    }

    #[test]
    fn a_partial_source_can_explain_a_release_without_a_compatible_package() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![Ok(r#"[{"tag_name":"v0.0.9","assets":[]}]"#.into()), err()],
        );
        run_round(&service, Origin::Manual);
        let view = service.view();
        assert!(!view.unread);
        assert_eq!(view.newer_unavailable.unwrap().version, "0.0.9");
    }

    #[test]
    fn disabling_before_the_first_fetch_prevents_all_network_and_cache_results() {
        let dir = tempfile::tempdir().unwrap();
        let calls = Arc::new(Mutex::new(0));
        let count = Arc::clone(&calls);
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(Utc::now),
            Box::new(move |_| {
                *count.lock().unwrap() += 1;
                err()
            }),
        ));
        service.set_consent(true, 0).unwrap();
        assert!(matches!(
            service.begin(Origin::Automatic),
            Begin::Started(_)
        ));
        let (id, origin, epoch, _) = service.started_task();
        service.set_consent(false, 1).unwrap();
        let result = service.execute(&id, origin, epoch);
        service.finish(&id);
        assert_eq!(*calls.lock().unwrap(), 0);
        assert!(result.cancelled && !result.applied);
        assert!(
            service.view().last_unreachable.is_empty(),
            "a cancelled failure cannot update cache metadata"
        );
    }

    const MAC: update_check::Platform = update_check::Platform {
        os: "macos",
        arch: "aarch64",
    };

    fn fixed_clock(
        at: &str,
    ) -> (
        Arc<Mutex<DateTime<Utc>>>,
        impl Fn() -> DateTime<Utc> + Send + Sync + 'static,
    ) {
        let now = Arc::new(Mutex::new(
            DateTime::parse_from_rfc3339(at)
                .unwrap()
                .with_timezone(&Utc),
        ));
        let handle = Arc::clone(&now);
        (now, move || *handle.lock().unwrap())
    }

    type Answer = std::result::Result<String, Error>;
    fn err() -> Answer {
        Err(Error::new("UPDATE_CHECK", "离线"))
    }

    fn with_answers(
        root: &Path,
        version: &str,
        clock: impl Fn() -> DateTime<Utc> + Send + Sync + 'static,
        answers: Vec<Answer>,
    ) -> Arc<UpdateState> {
        let queue = Arc::new(Mutex::new(VecDeque::from(answers)));
        Arc::new(UpdateState::with_hooks(
            root.to_owned(),
            version.to_owned(),
            MAC,
            Box::new(clock),
            Box::new(move |_| {
                queue
                    .lock()
                    .unwrap()
                    .pop_front()
                    .expect("answer queue empty")
            }),
        ))
    }

    fn offline_service(root: &Path, version: &str) -> Arc<UpdateState> {
        Arc::new(UpdateState::with_hooks(
            root.to_owned(),
            version.to_owned(),
            MAC,
            Box::new(Utc::now),
            Box::new(|_| Err(Error::new("UPDATE_CHECK", "离线"))),
        ))
    }

    fn release_json(source: &str, version: &str) -> String {
        let name = format!("Thingary-{version}-universal.dmg");
        let repo = match source {
            "github" => "https://github.com/CoderJackZhu/Thingary",
            _ => "https://gitee.com/CoderJackZhu/thingary",
        };
        let url = format!("{repo}/releases/download/v{version}/{name}");
        format!(
            r#"[{{"tag_name":"v{version}","created_at":"2026-10-01T00:00:00Z","body":"notes {version}","assets":[{{"name":"{name}","browser_download_url":"{url}","size":10}}]}}]"#
        )
    }
    fn gitee(version: &str) -> Answer {
        Ok(release_json("gitee", version))
    }
    fn github(version: &str) -> Answer {
        Ok(release_json("github", version))
    }
    #[test]
    fn missing_preferences_read_as_unset_and_no_round_runs() {
        let dir = tempfile::tempdir().unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        let view = service.view();
        assert_eq!(view.consent, "unset");
        assert_eq!(view.preferences_status, "ok");
        assert!(!view.update_available && !view.unread);
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("not_enabled"), _)
        ));
    }

    #[test]
    fn damaged_preferences_block_automatic_but_an_explicit_choice_repairs() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(PREFERENCES_FILE), b"{broken").unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        assert_eq!(service.view().preferences_status, "damaged");
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("preferences_damaged"), _)
        ));
        service.set_consent(false, 0).unwrap();
        let view = service.view();
        assert_eq!(view.preferences_status, "ok");
        assert_eq!(view.consent, "disabled");
        // The unreadable original is kept for inspection.
        assert!(dir.path().join("update-preferences.invalid.json").exists());
    }

    #[test]
    fn a_future_preferences_format_is_never_silently_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(PREFERENCES_FILE),
            br#"{"format_version":2,"consent":"enabled","preference_revision":1,"highest_seen_version":null,"ignored_version":null}"#,
        )
        .unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        assert_eq!(service.view().preferences_status, "damaged");
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("preferences_damaged"), _)
        ));
        assert!(
            fs::read_to_string(dir.path().join(PREFERENCES_FILE))
                .unwrap()
                .contains("\"format_version\":2"),
            "the future-format file survives untouched"
        );
    }

    #[test]
    fn enabled_runs_one_round_per_process_and_failures_throttle_for_a_day() {
        let dir = tempfile::tempdir().unwrap();
        let (now, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![err(), err()])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers")),
        ));
        service.set_consent(true, 0).unwrap();
        let (begin, result) = run_round(&service, Origin::Automatic);
        assert!(matches!(begin, Begin::Started(_)));
        let result = result.unwrap();
        assert!(result.applied, "a failed round still counts as an attempt");
        assert!(result.error.is_some());
        // A restart (fresh process budget) within the day is still throttled.
        let (_, clock2) = fixed_clock("2026-10-17T20:00:00Z");
        let restarted = with_answers(dir.path(), "0.0.7", clock2, vec![err(), err()]);
        assert!(matches!(
            run_round(&restarted, Origin::Automatic),
            (Begin::Skipped("interval"), _)
        ));
        *now.lock().unwrap() += chrono::Duration::seconds(24 * 60 * 60);
        let (_, clock3) = fixed_clock("2026-10-18T08:00:01Z");
        let restarted = with_answers(dir.path(), "0.0.7", clock3, vec![err(), err()]);
        assert!(matches!(
            run_round(&restarted, Origin::Automatic),
            (Begin::Started(_), _)
        ));
        // The original process never gets a second automatic round.
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("already_ran_this_process"), _)
        ));
    }

    #[test]
    fn manual_bypasses_the_interval_and_records_the_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.8"), err()]);
        let (begin, result) = run_round(&service, Origin::Manual);
        assert!(matches!(begin, Begin::Started(_)));
        assert!(result.unwrap().applied);
        let view = service.view();
        assert!(view.update_available && view.unread && view.candidate_fresh);
        assert_eq!(view.candidate.as_ref().unwrap().version, "0.0.8");
        assert_eq!(view.candidate.as_ref().unwrap().sources, ["gitee"]);
        // The manual attempt now throttles the automatic round; enabling
        // first so the consent gate is not the reason for the skip.
        service.set_consent(true, 0).unwrap();
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("interval"), _)
        ));
    }

    #[test]
    fn a_reachable_lower_mirror_never_erases_a_higher_cached_find() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.9"), err()]);
        run_round(&service, Origin::Manual);
        let first = service.view().candidate.unwrap();
        assert_eq!(first.version, "0.0.9");
        // Later: one mirror still unreachable, the other only knows 0.0.8.
        let (_, clock) = fixed_clock("2026-10-18T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.8"), err()]);
        run_round(&service, Origin::Manual);
        let kept = service.view().candidate.unwrap();
        assert_eq!(kept.version, "0.0.9");
        assert_eq!(
            kept.confirmed_at, first.confirmed_at,
            "a partial answer does not refresh the old confirmation date"
        );
    }

    #[test]
    fn both_sources_retiring_the_candidate_clears_it_but_total_failure_keeps_it() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![gitee("0.0.9"), github("0.0.9")],
        );
        run_round(&service, Origin::Manual);
        assert!(service.view().update_available);
        // Both sources now agree there is nothing new: the old find retires.
        let (_, clock) = fixed_clock("2026-10-17T08:30:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![Ok("[]".into()), Ok("[]".into())],
        );
        run_round(&service, Origin::Manual);
        assert!(!service.view().update_available);
        // Total failure later must not claim "already latest": the attempt is
        // recorded and the dated cache survives.
        let (_, clock) = fixed_clock("2026-10-18T08:00:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![gitee("0.0.9"), github("0.0.9")],
        );
        run_round(&service, Origin::Manual);
        let (_, clock) = fixed_clock("2026-10-19T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![err(), err()]);
        let (_, result) = run_round(&service, Origin::Manual);
        assert!(
            result.unwrap().error.is_some(),
            "failure surfaces to manual"
        );
        assert!(service.view().update_available, "cache survives");
    }

    #[test]
    fn turning_auto_off_cancels_the_round_and_late_results_never_apply() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        // First source answers; the second is only reached when still alive.
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![gitee("0.0.9")])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            {
                let queue = Arc::clone(&queue);
                Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers"))
            },
        ));
        service.set_consent(true, 0).unwrap();
        assert!(matches!(
            service.begin(Origin::Automatic),
            Begin::Started(_)
        ));
        // Toggle off before the second source would be read.
        service.set_consent(false, 1).unwrap();
        let (id, origin, epoch, shared) = service.started_task();
        let result = service.execute(&id, origin, epoch);
        service.finish(&id);
        shared.publish(result.clone());
        assert!(result.cancelled && !result.applied);
        assert!(!service.view().update_available);
        // Re-enabling does not resurrect the cancelled round.
        service.set_consent(true, 2).unwrap();
        assert!(!service.view().update_available);
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("already_ran_this_process"), _)
        ));
    }

    #[test]
    fn seen_and_ignore_clear_the_dot_without_touching_consent() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![gitee("0.0.9"), github("0.0.9")],
        );
        run_round(&service, Origin::Manual);
        assert!(service.view().unread);
        service.mark_seen("0.0.9").unwrap();
        assert!(!service.view().unread, "seen clears the dot");
        assert!(service.view().update_available, "still updatable");
        // A same-version re-confirmation does not relight a seen version.
        let (_, clock) = fixed_clock("2026-10-18T08:00:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![gitee("0.0.9"), github("0.0.9")],
        );
        run_round(&service, Origin::Manual);
        assert!(!service.view().unread);
        // An even newer release lights it again; ignoring only hides that one.
        let (_, clock) = fixed_clock("2026-10-19T08:00:00Z");
        let service = with_answers(
            dir.path(),
            "0.0.7",
            clock,
            vec![gitee("0.0.10"), github("0.0.10")],
        );
        run_round(&service, Origin::Manual);
        assert!(service.view().unread, "0.0.10 > highest seen 0.0.9");
        service.ignore_version("0.0.10").unwrap();
        assert!(!service.view().unread);
        assert_eq!(service.view().consent, "unset", "ignore is not consent");
        assert!(service.view().update_available, "download stays reachable");
        assert!(service.mark_seen("1.2").is_err(), "versions stay strict");
    }

    #[test]
    fn a_stale_consent_write_conflicts_instead_of_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        assert!(service.set_consent(true, 0).is_ok());
        assert!(
            service.set_consent(false, 0).is_err(),
            "old revision rejected"
        );
        assert_eq!(service.view().consent, "enabled");
        assert!(service.set_consent(false, 1).is_ok());
    }

    #[test]
    fn upgrading_past_the_candidate_clears_the_update_state() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.9"), err()]);
        run_round(&service, Origin::Manual);
        assert!(service.view().update_available);
        // After "installing" 0.0.9, the same cache is not an update anymore.
        let upgraded = offline_service(dir.path(), "0.0.9");
        let view = upgraded.view();
        assert!(!view.update_available && !view.unread && !view.cache_applicable);
    }

    #[test]
    fn expired_candidates_lose_the_dot_but_keep_the_dated_find() {
        let dir = tempfile::tempdir().unwrap();
        let (now, clock) = fixed_clock("2026-10-01T08:00:00Z");
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![gitee("0.0.9"), err()])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers")),
        ));
        run_round(&service, Origin::Manual);
        assert!(service.view().unread);
        *now.lock().unwrap() += chrono::Duration::seconds(8 * 24 * 60 * 60);
        let view = service.view();
        assert!(!view.unread && !view.candidate_fresh, "eight days old");
        assert!(view.candidate.is_some(), "the dated find itself stays");
    }

    #[test]
    fn the_day_boundary_is_exact() {
        let dir = tempfile::tempdir().unwrap();
        let (now, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![err(), err(), err(), err()])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers")),
        ));
        service.set_consent(true, 0).unwrap();
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Started(_), _)
        ));
        // T+23:59:59 still throttles, T+24:00:00 allows a new round.
        for (stamp, expect_skip) in [
            ("2026-10-18T07:59:59Z", true),
            ("2026-10-18T08:00:00Z", false),
        ] {
            *now.lock().unwrap() = DateTime::parse_from_rfc3339(stamp)
                .unwrap()
                .with_timezone(&Utc);
            let restarted = {
                let handle = Arc::clone(&now);
                Arc::new(UpdateState::with_hooks(
                    dir.path().to_owned(),
                    "0.0.7".into(),
                    MAC,
                    Box::new(move || *handle.lock().unwrap()),
                    Box::new(|_| Err(Error::new("UPDATE_CHECK", "离线"))),
                ))
            };
            let skipped = matches!(
                run_round(&restarted, Origin::Automatic),
                (Begin::Skipped("interval"), _)
            );
            assert_eq!(skipped, expect_skip, "{stamp}");
            if !expect_skip {
                break;
            }
        }
    }

    #[test]
    fn concurrent_callers_join_one_round_and_a_stale_round_never_applies() {
        let dir = tempfile::tempdir().unwrap();
        let fetches = Arc::new(Mutex::new(0u32));
        let release = Arc::new(Mutex::new(false));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(Utc::now),
            {
                let fetches = Arc::clone(&fetches);
                let release = Arc::clone(&release);
                Box::new(move |_| {
                    let mine = {
                        let mut count = fetches.lock().unwrap();
                        *count += 1;
                        *count
                    };
                    // The first source read parks until the test lets the
                    // round finish, giving the second caller time to join.
                    if mine == 1 {
                        while !*release.lock().unwrap() {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    }
                    Ok(release_json("gitee", "0.0.9"))
                })
            },
        ));
        service.set_consent(true, 0).unwrap();
        let first = Arc::clone(&service);
        let second = Arc::clone(&service);
        let starter = std::thread::spawn(move || run_round(&first, Origin::Automatic).1.unwrap());
        // Wait until the round is truly in flight (its first source read is
        // parked on the gate), so the second caller must join it.
        for _ in 0..200 {
            if *fetches.lock().unwrap() >= 1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(*fetches.lock().unwrap(), 1, "the first round is parked");
        let joiner = std::thread::spawn(move || match second.begin(Origin::Manual) {
            Begin::Joined(shared) => Some(shared.wait()),
            other => panic!("expected to join, got {other:?}"),
        });
        std::thread::sleep(Duration::from_millis(100));
        // Both callers are now waiting on the same round; let it finish.
        *release.lock().unwrap() = true;
        let started = starter.join().unwrap();
        assert!(started.applied);
        let joined = joiner.join().unwrap().unwrap();
        assert_eq!(
            joined.origin, "automatic",
            "the join keeps the original origin"
        );
        assert_eq!(
            *fetches.lock().unwrap(),
            2,
            "one round means one read per mirror"
        );
        // A finished round is gone: the next caller starts fresh, and an
        // execute() from the old task id is rejected as stale.
        assert!(matches!(
            run_round(&Arc::clone(&service), Origin::Automatic),
            (Begin::Skipped("already_ran_this_process"), _)
        ));
    }

    #[test]
    fn an_explicit_manual_round_is_never_cancelled_by_the_switch() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![gitee("0.0.9"), err()])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers")),
        ));
        assert!(matches!(service.begin(Origin::Manual), Begin::Started(_)));
        // Turning auto checks off while the manual round runs must not kill it.
        service.set_consent(false, 0).unwrap();
        let (id, origin, epoch, shared) = service.started_task();
        let result = service.execute(&id, origin, epoch);
        service.finish(&id);
        shared.publish(result.clone());
        assert!(
            !result.cancelled && result.applied,
            "manual rounds keep their own authority"
        );
        assert!(service.view().update_available);
    }

    #[test]
    fn a_clock_rollback_rebuilds_the_base_once_per_process() {
        let dir = tempfile::tempdir().unwrap();
        let future = DateTime::parse_from_rfc3339("2027-01-01T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        // A previous attempt was stamped in the future (clock skew).
        let cache = Cache {
            last_attempt_at: Some(future.to_rfc3339()),
            ..Cache::default()
        };
        cache.save(dir.path()).unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![gitee("0.0.9"), err()])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers")),
        ));
        service.set_consent(true, 0).unwrap();
        let (begin, result) = run_round(&service, Origin::Automatic);
        assert!(
            matches!(begin, Begin::Started(_)),
            "a future stamp is not a permanent block"
        );
        assert!(result.unwrap().applied);
        assert!(
            matches!(
                run_round(&service, Origin::Automatic),
                (Begin::Skipped("already_ran_this_process"), _)
            ),
            "but the session does not loop either"
        );
    }

    #[test]
    fn a_damaged_cache_is_ignored_without_touching_valid_consent() {
        let dir = tempfile::tempdir().unwrap();
        let service = offline_service(dir.path(), "0.0.7");
        service.set_consent(true, 0).unwrap();
        fs::write(dir.path().join(CACHE_FILE), b"{broken").unwrap();
        let view = service.view();
        assert_eq!(view.consent, "enabled", "cache damage never resets consent");
        assert!(!view.update_available);
    }

    #[test]
    fn an_attempt_that_cannot_be_recorded_never_reaches_the_network() {
        let dir = tempfile::tempdir().unwrap();
        // Make the cache path a directory so the atomic write must fail.
        fs::create_dir_all(dir.path().join(CACHE_FILE)).unwrap();
        let asked = Arc::new(Mutex::new(0));
        let service = {
            let asked = Arc::clone(&asked);
            Arc::new(UpdateState::with_hooks(
                dir.path().to_owned(),
                "0.0.7".into(),
                MAC,
                Box::new(Utc::now),
                Box::new(move |_| {
                    *asked.lock().unwrap() += 1;
                    Ok("[]".into())
                }),
            ))
        };
        service.set_consent(true, 0).unwrap();
        assert!(matches!(
            run_round(&service, Origin::Automatic),
            (Begin::Skipped("attempt_not_recorded"), _)
        ));
        assert_eq!(*asked.lock().unwrap(), 0);
    }

    #[test]
    fn a_manual_round_that_cannot_save_still_shows_for_this_session() {
        let dir = tempfile::tempdir().unwrap();
        let (_, clock) = fixed_clock("2026-10-17T08:00:00Z");
        let service = with_answers(dir.path(), "0.0.7", clock, vec![gitee("0.0.9"), err()]);
        // Write the cache after the round so the save fails but the session
        // keeps the unsaved copy.
        let (begin, result) = run_round(&service, Origin::Manual);
        assert!(matches!(begin, Begin::Started(_)));
        let result = result.unwrap();
        assert!(result.applied && result.error.is_none());
        // Now break persistence and run again: the session still shows it.
        let cache_path = dir.path().join(CACHE_FILE);
        fs::remove_file(&cache_path).unwrap();
        fs::create_dir_all(&cache_path).unwrap();
        let (_, clock) = fixed_clock("2026-10-18T08:00:00Z");
        let queue = Arc::new(Mutex::new(VecDeque::from(vec![gitee("0.0.10"), err()])));
        let service = Arc::new(UpdateState::with_hooks(
            dir.path().to_owned(),
            "0.0.7".into(),
            MAC,
            Box::new(clock),
            Box::new(move |_| queue.lock().unwrap().pop_front().expect("answers")),
        ));
        let (_, result) = run_round(&service, Origin::Manual);
        let result = result.unwrap();
        assert!(!result.applied, "the write failed");
        assert!(result.error.as_deref().unwrap().contains("无法保存"));
        let view = service.view();
        assert!(view.update_available, "the manual surface still shows it");
        assert!(view.cache_unsaved);
    }
}
