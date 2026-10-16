use crate::{
    backup_security::{
        self, FirstBackup, Inspection, Inspections, KeySetups, Policy as SecurityPolicy, Snapshot,
    },
    domain::{Error, Result},
    storage::Store,
};
use std::{
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::mpsc::{self, SyncSender},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
#[derive(serde::Serialize)]
pub struct DemoStatus {
    pub active: bool,
    pub available: bool,
    pub started: bool,
}
/// Thresholds the timer passes to each tick; tests inject their own so
/// nothing in the suite ever sleeps to observe a schedule.
#[derive(Debug, Clone)]
pub struct Policy {
    pub idle: Duration,
    pub backoff: Duration,
    pub today: String,
}
impl Policy {
    pub fn production() -> Self {
        Self {
            idle: Duration::from_secs(120),
            backoff: Duration::from_secs(30 * 60),
            today: chrono::Local::now().format("%Y-%m-%d").to_string(),
        }
    }
}
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum TickOutcome {
    Disabled,
    NoMarker,
    NotIdle,
    Backoff,
    EmptyLibrary,
    /// Automatic and extra-location backups are paused until the user picks a
    /// backup-security policy. Nothing is written, pruned or copied.
    Paused(String),
    /// The archive was published; the caller may copy it to the extra
    /// location off the worker thread.
    BackedUp(PathBuf),
    /// Retry only the extra copy of an already verified current-policy archive.
    ExtraPending(PathBuf),
}
#[derive(Clone)]
struct PublishedBackup {
    path: PathBuf,
    epoch: String,
    hash: String,
    extra: Option<String>,
    copied: bool,
    failed_at: Option<Instant>,
}
struct BackupWork {
    running: crate::backup_jobs::Running,
    prepared: crate::backup::PreparedBackup,
    snapshot: Snapshot,
    destination: PathBuf,
    automatic: bool,
    changes: u64,
}
enum BackupStart {
    Early(TickOutcome),
    Ready(Box<BackupWork>),
}
struct ExtraCopyGuard(Arc<AtomicUsize>);
impl Drop for ExtraCopyGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

struct Libraries {
    real: Store,
    demo: Option<Store>,
    demo_mode: bool,
    started: bool,
    /// Library, dataset and write count last used to plan reminders.
    reminder_key: Option<(bool, String, u64)>,
    /// Real library only: generation plus write count last seen by the
    /// automatic-backup tracker.
    backup_key: Option<(String, u64)>,
    /// When the real library last changed; `None` until the first change.
    last_change: Option<Instant>,
    /// When an automatic backup last failed; in memory only, so a restart
    /// always gets one immediate retry.
    backup_failed_at: Option<Instant>,
    /// In-memory key setup sessions; the private key never leaves these.
    key_setups: KeySetups,
    /// The single active inspection/restore session, if any.
    inspections: Inspections,
    inspection_task: Option<String>,
    /// Extra-location copies currently running off the worker; policy changes
    /// wait for these to drain before committing.
    extra_copies: Arc<AtomicUsize>,
    /// Identifies the worker process run that wrote the change marker; write
    /// counts are only comparable within one session.
    session: String,
    published: Option<PublishedBackup>,
    jobs: crate::backup_jobs::Jobs,
}
impl Libraries {
    /// Re-plans reminders only after something was written or the active
    /// library changed; reads such as previews skip the query entirely.
    fn sync_reminders(&mut self) {
        // Viewing or editing fictional records must never replace real reminders.
        let active = &self.real;
        let Ok(conn) = active.conn() else {
            return;
        };
        let key = (false, active.generation(), conn.total_changes());
        if self.reminder_key.as_ref() == Some(&key) {
            return;
        }
        if let Ok(snapshot) = crate::reminders::snapshot(active) {
            self.reminder_key = Some(key);
            crate::reminders::schedule(snapshot);
        }
    }
    /// Marks the real library as changed for the automatic backup. Sample
    /// writes never reach here because the key only watches `real`.
    fn track_backup_changes(&mut self) {
        let Ok(conn) = self.real.conn() else {
            eprintln!("自动备份未能读取资料库");
            return;
        };
        let key = (self.real.generation(), conn.total_changes());
        if self.backup_key.as_ref() == Some(&key) {
            return;
        }
        // The first observation only records the baseline.
        if self.backup_key.is_none() {
            self.backup_key = Some(key);
            return;
        }
        if self.backup_key.as_ref() == Some(&key) {
            return;
        }
        self.backup_key = Some(key.clone());
        self.last_change = Some(Instant::now());
        // The marker records the session and write count it covers, so a
        // backup that snapshotted earlier cannot clear later changes.
        if let Err(error) = crate::auto_backup::write_marker(&self.real.root, &self.session, key.1)
        {
            eprintln!("自动备份标记未写入：{error}");
        }
    }
    fn record_started(&mut self) -> Result<()> {
        if !self.started {
            self.started = has_personal_records(&self.real)?;
        }
        if self.started && !self.real.root.join("personal-started").exists() {
            crate::storage::atomic_write(&self.real.root.join("personal-started"), b"1")?;
        }
        Ok(())
    }
}

fn has_personal_records(store: &Store) -> Result<bool> {
    // Include deleted rows. Appearance settings and taxonomy are not business records.
    Ok(store.conn()?.query_row(
        "SELECT EXISTS(SELECT 1 FROM assets) OR EXISTS(SELECT 1 FROM wishlist_items)
         OR EXISTS(SELECT 1 FROM fin_accounts) OR EXISTS(SELECT 1 FROM fin_snapshots)
         OR EXISTS(SELECT 1 FROM expenses) OR EXISTS(SELECT 1 FROM recurring_plans)
         OR EXISTS(SELECT 1 FROM plan_payments) OR EXISTS(SELECT 1 FROM virtual_assets)
         OR EXISTS(SELECT 1 FROM plan_profile) OR EXISTS(SELECT 1 FROM plan_income)
         OR EXISTS(SELECT 1 FROM cash_movements)",
        [],
        |r| r.get(0),
    )?)
}
/// Whether a manual export will be encrypted, or why it is blocked.
#[derive(serde::Serialize)]
pub struct ExportPlan {
    pub encrypted: bool,
    pub blocked_reason: Option<String>,
}

type Job = Box<dyn FnOnce(&mut Libraries) + Send>;
#[derive(Clone)]
pub struct Worker {
    sender: SyncSender<Job>,
    extra_copies: Arc<AtomicUsize>,
    jobs: crate::backup_jobs::Jobs,
    #[cfg(test)]
    thread: std::sync::Arc<thread::JoinHandle<()>>,
}
impl Worker {
    pub fn start(root: PathBuf) -> Result<Self> {
        let (tx, rx) = mpsc::sync_channel::<Job>(32);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let extra_copies = Arc::new(AtomicUsize::new(0));
        let libraries_copies = Arc::clone(&extra_copies);
        let jobs = crate::backup_jobs::Jobs::default();
        let libraries_jobs = jobs.clone();
        let storage_thread = thread::Builder::new()
            .name("thingary-storage".into())
            .spawn(move || {
                match (|| -> Result<Libraries> {
                    let real = Store::open(&root)?;
                    // App-level preferences are initialized from the real identity,
                    // before any queued consumer can read a runtime snapshot.
                    crate::modules::initialize_runtime(&real.root);
                    let has_records = has_personal_records(&real)?;
                    let started = root.join("personal-started").exists() || has_records;
                    // The sample is the default for every empty personal
                    // library; deleted rows still count as records, but a
                    // latched onboarding marker alone must not hide it.
                    let demo = if !has_records {
                        let attempt = crate::demo::open(
                            &root,
                            &chrono::Local::now().format("%Y-%m-%d").to_string(),
                        );
                        match attempt {
                            Ok(store) => Some(store),
                            Err(error) => {
                                eprintln!("样例库暂不可用：{error}");
                                None
                            }
                        }
                    } else {
                        None
                    };
                    let demo_mode = demo.is_some();
                    // Restart cleanup: staging holds at most interrupted
                    // plaintext builds; sessions themselves die with memory.
                    backup_security::clean_staging(&real.root);
                    // A first run or an upgrade keeps plaintext automatic backups
                    // running, as before; the user may turn encryption on later.
                    // Writing the choice down means a policy file that goes
                    // missing afterwards is never mistaken for it: that case
                    // still reads as unconfigured and pauses backups. If the
                    // write fails, the file stays missing and backups stay paused.
                    // The default applies only to a library that has never produced
                    // an encrypted backup: a policy file lost while the app was
                    // closed must not turn existing encryption into plaintext.
                    let had_encrypted =
                        crate::auto_backup::list(&crate::auto_backup::backup_dir(&real.root))
                            .iter()
                            .any(|item| item.name.ends_with(crate::auto_backup::EXT_AGE));
                    if !backup_security::policy_path(&real.root).exists() && !had_encrypted {
                        let initial = backup_security::Policy {
                            state: backup_security::STATE_DISABLED.into(),
                            ..backup_security::Policy::default()
                        };
                        let _ = initial.save(&real.root);
                    }
                    Ok(Libraries {
                        real,
                        demo,
                        demo_mode,
                        started,
                        reminder_key: None,
                        backup_key: None,
                        last_change: None,
                        backup_failed_at: None,
                        key_setups: KeySetups::default(),
                        inspections: Inspections::default(),
                        inspection_task: None,
                        extra_copies: libraries_copies,
                        session: crate::storage::uid(),
                        published: None,
                        jobs: libraries_jobs,
                    })
                })() {
                    Ok(mut libraries) => {
                        if let Err(error) = libraries.record_started() {
                            eprintln!("首次使用状态暂未保存：{error}");
                        }
                        // Baseline the change key before any job runs, so the
                        // first write of this session is counted as a change.
                        libraries.track_backup_changes();
                        let settings = crate::auto_backup::Settings::load(&libraries.real.root);
                        if settings.enabled
                            && settings.extra_dir.is_some()
                            && SecurityPolicy::load(&libraries.real.root).is_ok_and(|p| p.active())
                        {
                            let changes = libraries
                                .real
                                .conn()
                                .map(|c| c.total_changes())
                                .unwrap_or_default();
                            let _ = crate::auto_backup::write_marker(
                                &libraries.real.root,
                                &libraries.session,
                                changes,
                            );
                        }
                        let _ = ready_tx.send(Ok(()));
                        loop {
                            let job = match rx.recv_timeout(Duration::from_secs(30)) {
                                Ok(job) => job,
                                Err(mpsc::RecvTimeoutError::Timeout) => {
                                    libraries.key_setups.sweep();
                                    libraries.inspections.sweep();
                                    continue;
                                }
                                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                            };
                            libraries.key_setups.sweep();
                            libraries.inspections.sweep();
                            // A panicking job drops its reply channel, so only that
                            // caller sees an error; the library stays available.
                            // Open transactions roll back while unwinding.
                            if panic::catch_unwind(AssertUnwindSafe(|| job(&mut libraries)))
                                .is_err()
                            {
                                eprintln!("存储任务异常中止，已保持资料库可用");
                            }
                        }
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })?;
        ready_rx
            .recv()
            .map_err(|_| Error::new("WORKER", "存储未能启动"))??;
        #[cfg(not(test))]
        drop(storage_thread);
        Ok(Self {
            sender: tx,
            extra_copies,
            jobs,
            #[cfg(test)]
            thread: std::sync::Arc::new(storage_thread),
        })
    }
    /// Restart tests must wait for both libraries and all thread-local resources
    /// to be dropped, rather than assuming a detached worker exits in two seconds.
    #[cfg(test)]
    pub(crate) fn stop_and_join(self) {
        let Self {
            sender,
            thread,
            extra_copies: _,
            jobs: _,
        } = self;
        // No remaining Worker clone may keep the job channel connected.
        let thread = std::sync::Arc::try_unwrap(thread)
            .expect("stop_and_join requires the last Worker clone");
        drop(sender);
        thread.join().expect("storage worker exits without panic");
    }
    pub fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.with_state(move |state| {
            if state.demo_mode {
                f(state
                    .demo
                    .as_mut()
                    .ok_or_else(|| Error::new("DEMO", "样例库尚未准备好"))?)
            } else {
                f(&mut state.real)
            }
        })
    }
    /// Samples real app preferences and active library in one queued operation.
    /// The sample library never supplies app-level capability preferences.
    pub fn call_with_runtime_modules<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Store, crate::modules::RuntimeModules) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.with_state(move |state| {
            let modules = crate::modules::read_runtime(&state.real.root);
            let store = if state.demo_mode {
                state
                    .demo
                    .as_mut()
                    .ok_or_else(|| Error::new("DEMO", "样例库尚未准备好"))?
            } else {
                &mut state.real
            };
            f(store, modules)
        })
    }

    pub fn plan_income_list(&self) -> Result<crate::plan_income::List> {
        self.call_with_runtime_modules(|s, m| s.plan_income_list_with_enabled(m.incomes))
    }

    pub fn plan_income_defaults(&self) -> Result<crate::plan_income::Defaults> {
        self.call_with_runtime_modules(|s, m| s.plan_income_defaults_with_enabled(m.incomes))
    }

    pub fn plan_income(&self, id: String) -> Result<Option<crate::plan_income::Income>> {
        self.call_with_runtime_modules(move |s, m| s.plan_income_with_enabled(&id, m.incomes))
    }

    pub fn plan_income_save(
        &self,
        input: crate::plan_income::Save,
        today: String,
    ) -> Result<crate::plan_income::Income> {
        self.call_with_runtime_modules(move |s, m| {
            s.plan_income_save_with_enabled(&input, &today, m.incomes)
        })
    }

    pub fn wealth_trash(&self, input: crate::wealth::TrashChange) -> Result<()> {
        self.call_with_runtime_modules(move |s, m| s.wealth_trash_with_incomes(&input, m.incomes))
    }

    /// Module switches and active library are sampled in the same worker turn.
    pub fn planning_overview(
        &self,
        year: Option<i32>,
        planning: bool,
        today: String,
    ) -> Result<crate::review::Overview> {
        self.call_with_runtime_modules(move |store, mut modules| {
            modules.modules.planning &= planning;
            store.review_overview_with_runtime_modules(year, &today, &modules)
        })
    }
    pub fn finance_sources(
        &self,
        period: crate::expenses::Period,
    ) -> Result<crate::finance_sources::FinanceSources> {
        self.finance_sources_view(period, false)
    }
    pub fn finance_sources_view(
        &self,
        period: crate::expenses::Period,
        annual: bool,
    ) -> Result<crate::finance_sources::FinanceSources> {
        self.call_with_runtime_modules(move |store, modules| {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            store.finance_sources_with_view(&period, &modules, &today, annual)
        })
    }
    pub fn planning_sources(
        &self,
        planning: bool,
        wealth: bool,
        today: String,
    ) -> Result<crate::review::PlanningSources> {
        self.call_with_runtime_modules(move |store, mut modules| {
            modules.modules.planning &= planning;
            modules.modules.wealth &= wealth;
            store.planning_sources_with_runtime_modules(&modules, &today)
        })
    }
    pub fn call_personal<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.with_state(move |state| {
            if state.demo_mode {
                return Err(Error::new(
                    "DEMO_LIBRARY",
                    "请先切换到我的资料，再管理备份或导出",
                ));
            }
            f(&mut state.real)
        })
    }
    pub fn require_personal(&self) -> Result<()> {
        self.with_state(|state| {
            if state.demo_mode {
                Err(Error::new(
                    "DEMO_LIBRARY",
                    "请先切换到我的资料，再管理备份或导出",
                ))
            } else {
                Ok(())
            }
        })
    }
    fn with_state<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Libraries) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.sender
            .send(Box::new(move |state| {
                let result = f(state);
                // A command can commit successfully and still lose its response.
                // Detect facts even when the command reports an error.
                if let Err(error) = state.record_started() {
                    eprintln!("首次使用状态暂未保存：{error}");
                }
                // The pending marker must exist before the reply leaves: a
                // force-quit right after the call can never lose the fact
                // that the change is unbacked. Reminder planning can lag.
                state.track_backup_changes();
                let _ = tx.send(result);
                state.sync_reminders();
            }))
            .map_err(|_| Error::new("WORKER", "存储服务已停止"))?;
        rx.recv()
            .map_err(|_| Error::new("WORKER", "未收到存储结果，请重试"))?
    }
    pub fn demo_status(&self) -> Result<DemoStatus> {
        self.with_state(|state| {
            Ok(DemoStatus {
                active: state.demo_mode,
                available: true,
                started: state.started || has_personal_records(&state.real)?,
            })
        })
    }
    pub fn modules(&self) -> Result<crate::modules::RuntimeModules> {
        self.with_state(|state| Ok(crate::modules::initialize_runtime(&state.real.root)))
    }
    /// Saving forgets the last reminder plan so the switch takes effect at once.
    pub fn set_modules(
        &self,
        modules: crate::modules::Modules,
    ) -> Result<crate::modules::RuntimeModules> {
        self.set_modules_with_finance(modules, crate::modules::FinanceUpdate::default())
    }
    pub fn set_modules_with_finance(
        &self,
        modules: crate::modules::Modules,
        update: crate::modules::FinanceUpdate,
    ) -> Result<crate::modules::RuntimeModules> {
        self.with_state(move |state| {
            let result = crate::modules::write_runtime(&state.real.root, modules, update);
            state.reminder_key = None;
            result
        })
    }
    pub fn checkin_reminder_status(&self) -> Result<crate::checkin_reminder::Status> {
        self.with_state(|state| state.real.checkin_reminder_status())
    }
    /// Saving forgets the last reminder plan so the change takes effect at once.
    pub fn checkin_reminder_set(&self, months: u32) -> Result<crate::checkin_reminder::Status> {
        self.with_state(move |state| {
            crate::checkin_reminder::Settings { months }.save(&state.real.root)?;
            state.reminder_key = None;
            state.real.checkin_reminder_status()
        })
    }
    pub fn reminder_snapshot(&self) -> Result<crate::reminders::Snapshot> {
        self.with_state(|state| crate::reminders::snapshot(&state.real))
    }
    /// Restore the owner of a durable unknown-result receipt before the UI mounts.
    pub fn resume_library(&self, generation: String) -> Result<()> {
        self.with_state(move |state| {
            if state.real.generation() == generation {
                state.demo_mode = false;
                return Ok(());
            }
            if state.demo.is_none() {
                state.demo = Some(crate::demo::open(
                    &state.real.root,
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                )?);
            }
            if state
                .demo
                .as_ref()
                .is_some_and(|s| s.generation() == generation)
            {
                state.demo_mode = true;
            }
            Ok(())
        })
    }
    pub fn reset_demo(&self, request_id: String) -> Result<DemoStatus> {
        self.with_state(move |state| {
            if let Some(next) = crate::demo::reset(
                &state.real,
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
                &request_id,
            )? {
                state.demo = Some(next);
            } else {
                state.demo.take();
                state.demo = Some(crate::demo::open(
                    &state.real.root,
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                )?);
            }
            state.demo_mode = true;
            Ok(DemoStatus {
                active: true,
                available: true,
                started: state.started,
            })
        })
    }
    pub fn switch_demo(&self, demo: bool) -> Result<DemoStatus> {
        self.with_state(move |state| {
            if demo && state.demo.is_none() {
                state.demo = Some(crate::demo::open(
                    &state.real.root,
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                )?);
            }
            state.jobs.cancel_all_except(None);
            state.demo_mode = demo;
            Ok(DemoStatus {
                active: state.demo_mode,
                available: true,
                started: state.started || has_personal_records(&state.real)?,
            })
        })
    }
    pub fn backup_task_begin(&self) -> Result<String> {
        self.with_state(|state| state.jobs.begin(state.real.generation()))
    }
    pub fn backup_task_cancel(&self, id: &str) -> Result<bool> {
        self.jobs.cancel(id)
    }
    fn check_task(state: &Libraries, task: &crate::backup_jobs::Task) -> Result<()> {
        task.cancel.check()?;
        if state.demo_mode || state.real.generation() != task.generation {
            return Err(Error::new("GENERATION", "资料库已经切换，请重新操作"));
        }
        Ok(())
    }
    fn finish_archive(&self, mut work: BackupWork) -> Result<PathBuf> {
        let cancel = work.running.task.cancel.clone();
        let output = (|| {
            let zip = work.prepared.pack(&cancel)?;
            match &work.snapshot.mode {
                backup_security::Mode::Plaintext => {
                    crate::backup::stage_plaintext(zip.path(), &work.destination, &cancel)
                }
                backup_security::Mode::Encrypted(key) => crate::backup_crypto::encrypt_staged(
                    &key.recipient,
                    zip.path(),
                    &work.destination,
                    &cancel,
                ),
            }
        })();
        let staged = match output {
            Ok(temp) => temp,
            Err(e) => {
                work.running.stop_io();
                return Err(e);
            }
        };
        let hash = match crate::backup::file_digest_with_cancel(
            staged.path(),
            crate::backup::MAX_ARCHIVE_FILE + crate::backup_crypto::MAX_CIPHER_OVERHEAD,
            &cancel,
        ) {
            Ok((_, hash)) => hash,
            Err(e) => {
                drop(staged);
                work.running.stop_io();
                return Err(e);
            }
        };
        work.running.task.stage(staged)?;
        work.running.stop_io();
        let task = work.running.task.clone();
        let destination = work.destination;
        let snapshot = work.snapshot;
        self.with_state(move |state| {
            task.cancel.check()?;
            if state.real.generation() != task.generation || (!work.automatic && state.demo_mode) {
                return Err(Error::new("GENERATION", "资料库已经切换，请重新操作"));
            }
            let current = SecurityPolicy::load(&state.real.root)
                .map_err(|_| Error::new("SECURITY_POLICY", "备份安全配置已变化"))?;
            if !current.active() || current.policy_epoch != snapshot.epoch {
                return Err(Error::new("SECURITY_EPOCH", "备份安全设置已变化，请重试"));
            }
            task.publish(|| {
                state.real.hit("backup.before_publish")?;
                crate::backup::publish_staged(task.take_staged()?, &destination)
            })?;
            if work.automatic {
                crate::auto_backup::prune_after_publish(
                    &crate::auto_backup::backup_dir(&state.real.root),
                    &destination,
                )?;
                state.published = Some(PublishedBackup {
                    path: destination.clone(),
                    epoch: snapshot.epoch,
                    hash,
                    extra: crate::auto_backup::Settings::load(&state.real.root).extra_dir,
                    copied: false,
                    failed_at: None,
                });
                let _ = crate::auto_backup::clear_marker_if_covered(
                    &state.real.root,
                    &state.session,
                    work.changes,
                );
                let mut settings = crate::auto_backup::Settings::load(&state.real.root);
                settings.last_success_at = Some(crate::auto_backup::now_local());
                settings.last_error = None;
                let _ = settings.save(&state.real.root);
                state.backup_failed_at = None;
                if matches!(snapshot.mode, backup_security::Mode::Encrypted(_)) {
                    Self::record_first_backup(
                        &state.real.root,
                        FirstBackup::Success {
                            at: crate::auto_backup::now_local(),
                        },
                    );
                }
            }
            Ok(destination)
        })
    }
    /// One automatic-backup attempt. The worker freezes facts and publishes;
    /// packing, verification and encryption run on the caller's thread. The
    /// extra copy is left to the caller via `TickOutcome::BackedUp`. A missing,
    /// damaged or unconfirmed backup-security policy pauses everything.
    pub fn auto_backup_tick(&self, policy: &Policy) -> Result<TickOutcome> {
        self.auto_backup_tick_task(policy, None, false)
    }
    fn auto_backup_tick_task(
        &self,
        policy: &Policy,
        task_id: Option<String>,
        force: bool,
    ) -> Result<TickOutcome> {
        let policy = policy.clone();
        let started = self.with_state(move |state| {
            let root = state.real.root.clone();
            let settings = crate::auto_backup::Settings::load(&root);
            if !settings.enabled && !force {
                return Ok(BackupStart::Early(TickOutcome::Disabled));
            }
            let loaded = SecurityPolicy::load(&root);
            let security = match &loaded {
                Ok(security) => security,
                Err(error) => &error.policy,
            };
            if !security.active() {
                return Ok(BackupStart::Early(TickOutcome::Paused(
                    Snapshot::pause_reason(security).unwrap_or_else(|| "自动备份已暂停".into()),
                )));
            }
            let snapshot = Snapshot::from_policy(security);
            let marker = crate::auto_backup::marker_path(&root);
            // A library that already holds records but has no automatic
            // backup yet (an upgrade, or all archives deleted by hand) gets
            // its first one without waiting for a change. A newly enabled or
            // rotated policy also forces one even without data changes.
            let awaiting_first =
                matches!(snapshot.mode, crate::backup_security::Mode::Encrypted(_))
                    && matches!(
                        security.first_backup,
                        Some(FirstBackup::Waiting)
                            | Some(FirstBackup::Running)
                            | Some(FirstBackup::Failed { .. })
                    );
            let first_backup = (!marker.exists()
                && crate::auto_backup::list(&crate::auto_backup::backup_dir(&root)).is_empty()
                && has_personal_records(&state.real)?)
                || awaiting_first;
            if !marker.exists() && !first_backup {
                if let Some(published) = state.published.as_ref() {
                    if !published.copied
                        && published.extra.is_some()
                        && published.extra == settings.extra_dir
                        && published.epoch == security.policy_epoch
                        && published
                            .failed_at
                            .is_none_or(|at| at.elapsed() >= policy.backoff)
                    {
                        return Ok(BackupStart::Early(TickOutcome::ExtraPending(
                            published.path.clone(),
                        )));
                    }
                }
                return Ok(BackupStart::Early(TickOutcome::NoMarker));
            }
            // No change this session counts as already idle, so a marker left
            // by a force-quit is made up on the first tick after launch.
            if !force
                && state
                    .last_change
                    .is_some_and(|at| at.elapsed() < policy.idle)
            {
                return Ok(BackupStart::Early(TickOutcome::NotIdle));
            }
            let new_change_since_failure = state
                .last_change
                .is_some_and(|at| state.backup_failed_at.is_some_and(|f| at > f));
            if !force
                && state
                    .backup_failed_at
                    .is_some_and(|at| at.elapsed() < policy.backoff && !new_change_since_failure)
            {
                return Ok(BackupStart::Early(TickOutcome::Backoff));
            }
            if !force && !has_personal_records(&state.real)? {
                let _ = crate::storage::remove_file_retry(&marker);
                return Ok(BackupStart::Early(TickOutcome::EmptyLibrary));
            }

            if state.jobs.io.load(Ordering::SeqCst) > 0 {
                return Ok(BackupStart::Early(TickOutcome::Backoff));
            }
            let changes = state.real.conn()?.total_changes();
            let running = state.jobs.claim(task_id, state.real.generation())?;
            let staging = backup_security::ensure_staging(&root)?;
            let prepared = state.real.prepare_backup(&staging, &running.task.cancel)?;
            let dir = crate::auto_backup::backup_dir(&root);
            std::fs::create_dir_all(&dir)?;
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with(".物谱自动备份-")
                    && name.ends_with(".partial")
                    && entry.file_type()?.is_file()
                {
                    crate::storage::remove_file_retry(entry.path())?;
                }
            }
            let encrypted = matches!(snapshot.mode, backup_security::Mode::Encrypted(_));
            let destination = dir.join(crate::auto_backup::unique_name(&policy.today, encrypted));
            Ok(BackupStart::Ready(Box::new(BackupWork {
                running,
                prepared,
                snapshot,
                destination,
                automatic: true,
                changes,
            })))
        })?;
        let work = match started {
            BackupStart::Early(outcome) => return Ok(outcome),
            BackupStart::Ready(work) => *work,
        };
        let epoch = work.snapshot.epoch.clone();
        match self.finish_archive(work) {
            Ok(path) => Ok(TickOutcome::BackedUp(path)),
            Err(error) => {
                let message = error.message.clone();
                let _ = self.with_state(move |state| {
                    if SecurityPolicy::load(&state.real.root).is_ok_and(|p| p.policy_epoch == epoch)
                    {
                        state.backup_failed_at = Some(Instant::now());
                        let mut settings = crate::auto_backup::Settings::load(&state.real.root);
                        settings.last_error = Some(crate::auto_backup::Failure {
                            at: crate::auto_backup::now_local(),
                            message: message.clone(),
                        });
                        let _ = settings.save(&state.real.root);
                        Self::record_first_backup(
                            &state.real.root,
                            FirstBackup::Failed {
                                at: crate::auto_backup::now_local(),
                                message,
                            },
                        );
                    }
                    Ok(())
                });
                Err(error)
            }
        }
    }

    /// Best-effort first-encrypted-backup outcome bookkeeping; the policy
    /// stays valid even when the update cannot be written.
    fn record_first_backup(root: &Path, outcome: FirstBackup) {
        let mut policy = match SecurityPolicy::load(root) {
            Ok(policy) => policy,
            Err(error) => error.policy,
        };
        // Only record outcomes for the current epoch's key.
        if matches!(
            policy.first_backup,
            Some(FirstBackup::Waiting)
                | Some(FirstBackup::Running)
                | Some(FirstBackup::Failed { .. })
        ) {
            policy.first_backup = Some(outcome);
            if let Err(error) = policy.save(root) {
                eprintln!("首份加密备份状态未保存：{error}");
            }
        }
    }
    /// Copies a published archive to the configured extra location. The heavy
    /// copy runs on the calling thread (timer or command), never the worker.
    /// A policy epoch change while the copy runs aborts the publication: a
    /// rotated or disabled policy must not gain stale extra copies.
    pub fn auto_backup_extra_now(&self, source: &Path) {
        self.copy_extra_with_hook(source, || {});
    }

    fn copy_latest_publication(&self) {
        if let Ok(Some(path)) =
            self.with_state(|state| Ok(state.published.as_ref().map(|p| p.path.clone())))
        {
            self.auto_backup_extra_now(&path);
        }
    }

    fn copy_extra_with_hook(&self, source: &Path, before_publish: impl Fn()) {
        let source = source.to_owned();
        // Registration and increment run in the same worker job, before any
        // policy/directory change can start draining. Never relabel an old
        // archive with the epoch current at copy time.
        let job = self.with_state(move |state| {
            let settings = crate::auto_backup::Settings::load(&state.real.root);
            let policy = SecurityPolicy::load(&state.real.root)
                .map_err(|_| Error::new("SECURITY_POLICY", "备份安全配置异常，额外复制已暂停"))?;
            let published = state
                .published
                .as_ref()
                .filter(|p| {
                    state.extra_copies.load(Ordering::SeqCst) == 0
                        && p.path == source
                        && p.epoch == policy.policy_epoch
                        && p.extra.is_some()
                        && p.extra == settings.extra_dir
                        && policy.active()
                })
                .cloned();
            Ok(published.map(|p| {
                state.extra_copies.fetch_add(1, Ordering::SeqCst);
                (state.real.root.clone(), p)
            }))
        });
        let Ok(Some((root, published))) = job else {
            return;
        };
        let guard = ExtraCopyGuard(Arc::clone(&self.extra_copies));
        let extra = published.extra.clone().expect("validated extra location");
        let partial = Path::new(&extra).join(format!(
            ".{}.partial",
            published
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        let outcome = crate::auto_backup::copy_extra(&published.path, Path::new(&extra), || {
            before_publish();
            // Direct configuration reads cannot queue behind a worker that is
            // waiting for this copy. That worker cannot commit a change until
            // the guard has drained, so check + rename are one policy epoch.
            SecurityPolicy::load(&root)
                .is_ok_and(|p| p.active() && p.policy_epoch == published.epoch)
                && crate::auto_backup::Settings::load(&root)
                    .extra_dir
                    .as_deref()
                    == Some(extra.as_str())
                && crate::backup::archive_hash(&partial).is_ok_and(|hash| hash == published.hash)
        });
        let source_changed = !published.path.is_file()
            || (outcome.as_ref().is_err_and(|e| e.code == "SECURITY_EPOCH")
                && crate::backup::archive_hash(&published.path)
                    .is_ok_and(|hash| hash != published.hash));
        drop(guard);
        let _ = self.with_state(move |state| {
            let mut settings = crate::auto_backup::Settings::load(&state.real.root);
            let current = SecurityPolicy::load(&state.real.root).ok();
            if settings.extra_dir.as_deref() != Some(extra.as_str())
                || current
                    .as_ref()
                    .is_none_or(|p| !p.active() || p.policy_epoch != published.epoch)
            {
                return Ok(());
            }
            if let Some(record) = state
                .published
                .as_mut()
                .filter(|p| p.path == published.path && p.epoch == published.epoch)
            {
                record.copied = outcome.is_ok();
                record.failed_at = outcome.as_ref().err().map(|_| Instant::now());
            }
            if source_changed
                && state
                    .published
                    .as_ref()
                    .is_some_and(|p| p.path == published.path && p.epoch == published.epoch)
            {
                state.published = None;
                let changes = state.real.conn()?.total_changes();
                crate::auto_backup::write_marker(&state.real.root, &state.session, changes)?;
            }
            match outcome {
                Ok(()) => {
                    settings.extra_last_at = Some(crate::auto_backup::now_local());
                    settings.extra_last_error = None;
                }
                Err(error) => {
                    settings.extra_last_error = Some(crate::auto_backup::Failure {
                        at: crate::auto_backup::now_local(),
                        message: error.message,
                    });
                }
            }
            settings.save(&state.real.root)
        });
    }
    pub fn auto_backup_status(&self) -> Result<crate::auto_backup::Status> {
        self.with_state(|state| Ok(crate::auto_backup::status(&state.real.root)))
    }
    pub fn auto_backup_set_enabled(&self, enabled: bool) -> Result<crate::auto_backup::Status> {
        self.with_state(move |state| {
            let root = state.real.root.clone();
            let mut settings = crate::auto_backup::Settings::load(&root);
            settings.enabled = enabled;
            settings.save(&root)?;
            Ok(crate::auto_backup::status(&root))
        })
    }
    pub fn auto_backup_set_extra(&self, extra: PathBuf) -> Result<crate::auto_backup::Status> {
        self.with_state(move |state| {
            let root = state.real.root.clone();
            let mut settings = crate::auto_backup::Settings::load(&root);
            Self::wait_extra_drain_on_state(state)?;
            state.published = None;
            settings.extra_dir = Some(extra.display().to_string());
            settings.extra_last_at = None;
            settings.extra_last_error = None;
            settings.save(&root)?;
            let changes = state.real.conn()?.total_changes();
            crate::auto_backup::write_marker(&root, &state.session, changes)?;
            Ok(crate::auto_backup::status(&root))
        })
    }
    pub fn auto_backup_clear_extra(&self) -> Result<crate::auto_backup::Status> {
        self.with_state(|state| {
            let root = state.real.root.clone();
            let mut settings = crate::auto_backup::Settings::load(&root);
            Self::wait_extra_drain_on_state(state)?;
            state.published = None;
            // The chosen folder keeps its files; only the association ends.
            settings.extra_dir = None;
            settings.extra_last_at = None;
            settings.extra_last_error = None;
            settings.save(&root)?;
            Ok(crate::auto_backup::status(&root))
        })
    }
    /// The automatic backup folder, created if missing, for the settings page.
    pub fn auto_backup_folder(&self) -> Result<PathBuf> {
        self.with_state(|state| {
            let dir = crate::auto_backup::backup_dir(&state.real.root);
            std::fs::create_dir_all(&dir)?;
            Ok(dir)
        })
    }
    fn load_policy(root: &Path) -> (SecurityPolicy, Option<String>) {
        match SecurityPolicy::load(root) {
            Ok(policy) => (policy, None),
            Err(error) => (error.policy, Some(error.reason)),
        }
    }

    pub fn backup_security_status(&self) -> Result<backup_security::SecurityStatus> {
        self.with_state(|state| {
            let (policy, reason) = Self::load_policy(&state.real.root);
            Ok(backup_security::status_from_policy(
                &policy,
                reason,
                state.key_setups.active_id().is_some(),
            ))
        })
    }

    /// The explicit "continue with plaintext" choice, and the only repair
    /// path out of `needs_attention` / `restore_review_required`.
    pub fn backup_security_choose_plaintext(&self) -> Result<backup_security::SecurityStatus> {
        self.with_state(move |state| {
            Self::commit_policy(state, |policy| {
                policy.state = backup_security::STATE_DISABLED.into();
                policy.recipient = None;
                policy.recipient_id = None;
                policy.verified_at = None;
                policy.first_backup = None;
            })
        })
    }

    /// Starts (or restarts) key generation. The recovery key string is handed
    /// out exactly once; the private half lives only in the session.
    pub fn backup_security_begin_setup(&self) -> Result<backup_security::KeySetupStarted> {
        self.with_state(|state| {
            let session = state.key_setups.begin();
            Ok(backup_security::KeySetupStarted {
                session_id: session.id.clone(),
                recipient: session.key.text.clone(),
                recipient_id: session.key.id.clone(),
                recovery_key: session.recovery_key_text(),
            })
        })
    }

    pub fn backup_security_cancel_setup(&self, session_id: String) -> Result<()> {
        self.with_state(move |state| {
            state.key_setups.cancel(&session_id);
            Ok(())
        })
    }

    /// Writes the session's recovery key to a user-chosen file in the
    /// standard age identity format; the key itself does not round-trip
    /// through the frontend.
    pub fn backup_security_write_key(
        &self,
        session_id: String,
        destination: PathBuf,
    ) -> Result<()> {
        self.with_state(move |state| {
            let session = state
                .key_setups
                .get(&session_id)
                .ok_or_else(|| Error::new("SESSION", "密钥设置已过期，请重新开始"))?;
            let text = session.identity_file_text();
            crate::storage::atomic_write(&destination, text.as_bytes())
        })
    }

    /// Verifies the re-entered recovery key against the generated recipient
    /// with a random challenge, then commits the enabled policy and produces
    /// the first encrypted backup right away — even with no data changes.
    pub fn backup_security_confirm_setup(
        &self,
        session_id: String,
        key_text: String,
    ) -> Result<backup_security::SecurityStatus> {
        self.backup_security_confirm_setup_task(session_id, key_text, None)
    }
    pub fn backup_security_confirm_setup_task(
        &self,
        session_id: String,
        key_text: String,
        task_id: Option<String>,
    ) -> Result<backup_security::SecurityStatus> {
        let task_id = match task_id {
            Some(id) => id,
            None => self.backup_task_begin()?,
        };
        let current_task = task_id.clone();
        let status = self.with_state(move |state| {
            state
                .jobs
                .check_ready(&current_task, &state.real.generation())?;
            let recipient = {
                let session = state
                    .key_setups
                    .get(&session_id)
                    .ok_or_else(|| Error::new("SESSION", "密钥设置已过期，请重新开始"))?;
                session.key.recipient.clone()
            };
            let identity = crate::backup_crypto::parse_recovery_key(&key_text)?;
            if identity.to_public().to_string() != recipient.to_string() {
                return Err(Error::new(
                    "CRYPTO_KEY",
                    "重新输入的恢复密钥与本次生成的公钥不匹配",
                ));
            }
            if !crate::backup_crypto::challenge_roundtrip(&recipient, &identity)? {
                return Err(Error::new("CRYPTO_KEY", "恢复密钥验证失败"));
            }
            let recipient_text = recipient.to_string();
            let recipient_id = crate::backup_crypto::RecipientKey::from_recipient(recipient).id;
            state.key_setups.clear();
            let status = Self::commit_policy_except(state, Some(&current_task), |policy| {
                policy.state = backup_security::STATE_ENABLED.into();
                policy.recipient = Some(recipient_text);
                policy.recipient_id = Some(recipient_id);
                policy.verified_at = Some(crate::auto_backup::now_local());
                policy.first_backup = Some(FirstBackup::Waiting);
            })?;
            Ok(status)
        })?;
        if let Err(error) = self.run_first_backup_task(Some(task_id)) {
            if error.code == "CANCELLED" {
                return Err(error);
            }
        }
        Ok(status)
    }

    /// Turns encryption off. Existing ciphertexts and recovery keys are left
    /// untouched; the automatic-backup switch keeps its own value.
    pub fn backup_security_disable(&self) -> Result<backup_security::SecurityStatus> {
        self.with_state(move |state| {
            Self::commit_policy(state, |policy| {
                policy.state = backup_security::STATE_DISABLED.into();
                policy.recipient = None;
                policy.recipient_id = None;
                policy.verified_at = None;
                policy.first_backup = None;
            })
        })
    }

    /// Enables encryption from a recovery key the user re-enters (for
    /// example right after an encrypted restore). The key itself is never
    /// retained afterwards.
    pub fn backup_security_enable_from_key(
        &self,
        key_text: String,
    ) -> Result<backup_security::SecurityStatus> {
        self.backup_security_enable_from_key_task(key_text, None)
    }
    pub fn backup_security_enable_from_key_task(
        &self,
        key_text: String,
        task_id: Option<String>,
    ) -> Result<backup_security::SecurityStatus> {
        let task_id = match task_id {
            Some(id) => id,
            None => self.backup_task_begin()?,
        };
        let current_task = task_id.clone();
        let status = self.with_state(move |state| {
            state
                .jobs
                .check_ready(&current_task, &state.real.generation())?;
            let identity = crate::backup_crypto::parse_recovery_key(&key_text)?;
            let key = crate::backup_crypto::RecipientKey::from_recipient(identity.to_public());
            if !crate::backup_crypto::challenge_roundtrip(&key.recipient, &identity)? {
                return Err(Error::new("CRYPTO_KEY", "恢复密钥验证失败"));
            }
            let recipient_text = key.text.clone();
            let recipient_id = key.id.clone();
            let status = Self::commit_policy_except(state, Some(&current_task), |policy| {
                policy.state = backup_security::STATE_ENABLED.into();
                policy.recipient = Some(recipient_text);
                policy.recipient_id = Some(recipient_id);
                policy.verified_at = Some(crate::auto_backup::now_local());
                policy.first_backup = Some(FirstBackup::Waiting);
            })?;
            Ok(status)
        })?;
        if let Err(error) = self.run_first_backup_task(Some(task_id)) {
            if error.code == "CANCELLED" {
                return Err(error);
            }
        }
        Ok(status)
    }

    fn run_first_backup_task(&self, task_id: Option<String>) -> Result<()> {
        let id = task_id.clone();
        let epoch = self.with_state(move |state| {
            if let Some(id) = id {
                state.jobs.check_ready(&id, &state.real.generation())?;
            }
            let changes = state.real.conn()?.total_changes();
            crate::auto_backup::write_marker(&state.real.root, &state.session, changes)?;
            Self::set_first_backup(state, FirstBackup::Waiting);
            Ok(Self::load_policy(&state.real.root).0.policy_epoch)
        })?;
        let policy = Policy {
            idle: Duration::ZERO,
            backoff: Duration::ZERO,
            today: chrono::Local::now().format("%Y-%m-%d").to_string(),
        };
        if let Err(error) = self.auto_backup_tick_task(&policy, task_id, true) {
            let message = error.message.clone();
            let _ = self.with_state(move |state| {
                if SecurityPolicy::load(&state.real.root).is_ok_and(|p| p.policy_epoch == epoch) {
                    Self::set_first_backup(
                        state,
                        FirstBackup::Failed {
                            at: crate::auto_backup::now_local(),
                            message,
                        },
                    );
                }
                Ok(())
            });
            return Err(error);
        }
        self.copy_latest_publication();
        Ok(())
    }

    fn set_first_backup(state: &mut Libraries, outcome: FirstBackup) {
        let root = state.real.root.clone();
        let (mut policy, _) = Self::load_policy(&root);
        if matches!(
            policy.first_backup,
            Some(FirstBackup::Waiting)
                | Some(FirstBackup::Running)
                | Some(FirstBackup::Failed { .. })
        ) || matches!(outcome, FirstBackup::Success { .. })
        {
            policy.first_backup = Some(outcome);
            if let Err(error) = policy.save(&root) {
                eprintln!("首份加密备份状态未保存：{error}");
            }
        }
    }

    /// Atomically writes a new policy epoch; bumps in-memory session invalidation.
    fn commit_policy(
        state: &mut Libraries,
        change: impl FnOnce(&mut SecurityPolicy),
    ) -> Result<backup_security::SecurityStatus> {
        Self::commit_policy_except(state, None, change)
    }
    fn commit_policy_except(
        state: &mut Libraries,
        except: Option<&str>,
        change: impl FnOnce(&mut SecurityPolicy),
    ) -> Result<backup_security::SecurityStatus> {
        state.jobs.cancel_all_except(except);
        Self::wait_extra_drain_on_state(state)?;
        let root = state.real.root.clone();
        let (mut policy, _) = Self::load_policy(&root);
        change(&mut policy);
        policy.policy_epoch = crate::storage::uid();
        policy.changed_at = Some(crate::auto_backup::now_local());
        policy.save(&root)?;
        state.published = None;
        Ok(backup_security::status_from_policy(
            &policy,
            None,
            state.key_setups.active_id().is_some(),
        ))
    }

    fn wait_extra_drain_on_state(state: &Libraries) -> Result<()> {
        // The counter lives outside the worker job queue; copy threads
        // decrement it before queuing their bookkeeping, so no deadlock.
        for _ in 0..200 {
            if state.extra_copies.load(Ordering::SeqCst) == 0
                && state.jobs.io.load(Ordering::SeqCst) == 0
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err(Error::new(
            "SECURITY_BUSY",
            "额外备份复制仍在进行，请稍后再试",
        ))
    }

    /// Starts a controlled inspection of a chosen backup file. The original
    /// bytes are frozen immediately; a later unlock or restore only consumes
    /// the frozen copy.
    pub fn backup_inspect_begin(
        &self,
        path: PathBuf,
    ) -> Result<backup_security::InspectionStarted> {
        self.backup_inspect_begin_task(path, None)
    }
    pub fn backup_inspect_begin_task(
        &self,
        path: PathBuf,
        task_id: Option<String>,
    ) -> Result<backup_security::InspectionStarted> {
        let (mut running, root) = self.with_state(move |state| {
            if state.demo_mode {
                return Err(Error::new("DEMO_LIBRARY", "请先切换到我的资料"));
            }
            let running = state.jobs.claim(task_id, state.real.generation())?;
            if let Some(old) = state.inspection_task.replace(running.task.id.clone()) {
                state.jobs.cancel(&old)?;
            }
            state.inspections.clear();
            Ok((running, state.real.root.clone()))
        })?;
        let task = running.task.clone();
        let envelope = crate::backup_crypto::sniff(&path)?;
        let encrypted = matches!(envelope, crate::backup_crypto::Envelope::Age);
        let max = crate::backup::MAX_ARCHIVE_FILE
            + if encrypted {
                crate::backup_crypto::MAX_CIPHER_OVERHEAD
            } else {
                0
            };
        let frozen = crate::backup::freeze_with_cancel(&path, &root, max, &task.cancel)?;
        let summary = if encrypted {
            None
        } else {
            Some(crate::backup::inspect_frozen_with(
                frozen.path(),
                &root,
                &task.cancel,
            )?)
        };
        let digest = match &summary {
            Some(s) => s.hash.clone(),
            None => crate::backup::file_digest_with_cancel(frozen.path(), max, &task.cancel)?.1,
        };
        task.stage((frozen, summary, digest))?;
        running.stop_io();
        self.with_state(move |state| {
            Self::check_task(state, &task)?;
            if state.inspection_task.as_deref() != Some(task.id.as_str()) {
                return Err(Error::new("SESSION", "已有新的备份检查"));
            }
            task.publish(|| {
                let (frozen, summary, digest): (
                    tempfile::NamedTempFile,
                    Option<crate::backup::Summary>,
                    String,
                ) = task.take_staged()?;
                let token = crate::storage::uid();
                let source = path.display().to_string();
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                let session = if encrypted {
                    Inspection::new_encrypted(
                        token.clone(),
                        source,
                        frozen,
                        digest.clone(),
                        task.generation.clone(),
                    )
                } else {
                    Inspection::new_plain(
                        token.clone(),
                        source,
                        frozen,
                        digest.clone(),
                        task.generation.clone(),
                    )
                };
                state.inspections.begin(session);
                if !encrypted {
                    state
                        .inspections
                        .get(&token)
                        .expect("new inspection")
                        .adopt_frozen_as_plain();
                }
                Ok(backup_security::InspectionStarted {
                    token,
                    name,
                    encrypted,
                    summary,
                    hash: if encrypted { None } else { Some(digest) },
                })
            })
        })
    }

    /// Decrypts a frozen encrypted backup with the user's recovery key and
    /// runs the full content inspection. Only fully authenticated output is
    /// ever unpacked; the key is dropped when the job ends.
    pub fn backup_session_unlock(
        &self,
        token: String,
        key_text: String,
    ) -> Result<backup_security::InspectionUnlocked> {
        self.backup_session_unlock_task(token, key_text, None)
    }
    pub fn backup_session_unlock_task(
        &self,
        token: String,
        key_text: String,
        task_id: Option<String>,
    ) -> Result<backup_security::InspectionUnlocked> {
        let identity = crate::backup_crypto::parse_recovery_key(&key_text)?;
        let (mut running, root, frozen, busy) = self.with_state({
            let token = token.clone();
            move |state| {
                if state.demo_mode {
                    return Err(Error::new("DEMO_LIBRARY", "请先切换到我的资料"));
                }
                let running = state.jobs.claim(task_id, state.real.generation())?;
                let task = running.task.clone();
                let session = state
                    .inspections
                    .get(&token)
                    .ok_or_else(|| Error::new("SESSION", "检查会话已过期"))?;
                if !session.encrypted
                    || session.restored.is_some()
                    || session.generation != task.generation
                {
                    return Err(Error::new("SESSION", "检查会话状态不支持解锁"));
                }
                let frozen = session
                    .frozen_handle()
                    .ok_or_else(|| Error::new("SESSION", "检查会话已过期"))?;
                Ok((running, state.real.root.clone(), frozen, session.hold()))
            }
        })?;
        let task = running.task.clone();
        let staging = backup_security::ensure_staging(&root)?;
        let session_dir = crate::storage::temp_dir_in(&staging)?;
        let plain = session_dir.path().join("backup.thingary");
        crate::backup_crypto::decrypt_to_cancel(&identity, frozen.path(), &plain, &task.cancel)?;
        let summary = crate::backup::inspect_frozen_with(&plain, &root, &task.cancel)?;
        let digest = summary.hash.clone();
        drop(identity);
        drop(frozen);
        drop(busy);
        task.stage((plain, digest, session_dir, summary))?;
        running.stop_io();
        self.with_state(move |state| {
            Self::check_task(state, &task)?;
            task.publish(|| {
                let (plain, digest, session_dir, summary): (
                    PathBuf,
                    String,
                    tempfile::TempDir,
                    crate::backup::Summary,
                ) = task.take_staged()?;
                let session = state
                    .inspections
                    .get(&token)
                    .ok_or_else(|| Error::new("SESSION", "检查会话已过期"))?;
                if session.generation != task.generation || session.restored.is_some() {
                    return Err(Error::new("SESSION", "检查会话已失效"));
                }
                session.set_decrypted(plain, digest.clone(), session_dir);
                Ok(backup_security::InspectionUnlocked {
                    token,
                    summary,
                    hash: digest,
                })
            })
        })
    }

    pub fn backup_session_cancel(&self, token: String) -> Result<()> {
        self.with_state(move |state| {
            state.inspections.cancel(&token);
            Ok(())
        })
    }

    pub fn backup_session_result(&self, token: String) -> Result<Option<String>> {
        self.with_state(move |state| {
            let generation = state.real.generation();
            let session = state
                .inspections
                .get(&token)
                .ok_or_else(|| Error::new("SESSION", "恢复会话已失效，结果仍需核对"))?;
            if let Some(result) = session.restored.as_ref() {
                return Ok(Some(result.clone()));
            }
            if session.restore_attempted || session.generation != generation {
                return Err(Error::new(
                    "RESTORE_UNKNOWN",
                    "尚不能确认恢复结果，请保留会话并核对资料",
                ));
            }
            Ok(None)
        })
    }

    /// Confirms the restore of a checked session. The token is consumed once;
    /// a repeated call returns the recorded outcome. Encrypted restores gate
    /// the local policy first: without a valid enabled key the machine is put
    /// into `restore_review_required` before any data is replaced.
    pub fn backup_session_restore(&self, token: String) -> Result<String> {
        self.with_state(move |state| {
            if state.demo_mode {
                return Err(Error::new(
                    "DEMO_LIBRARY",
                    "请先切换到“我的资料”，再管理备份或导出",
                ));
            }
            let existing = {
                let session = state
                    .inspections
                    .get(&token)
                    .ok_or_else(|| Error::new("SESSION", "检查会话已过期，请重新检查备份"))?;
                session.restored.clone()
            };
            if let Some(generation) = existing {
                return Ok(generation);
            }
            let (plain, expected_hash, encrypted, generation) = {
                let session = state
                    .inspections
                    .get(&token)
                    .ok_or_else(|| Error::new("SESSION", "检查会话已过期，请重新检查备份"))?;
                let plain = session
                    .plain_zip()
                    .map(|p| p.to_path_buf())
                    .ok_or_else(|| Error::new("SESSION", "备份尚未解锁"))?;
                let expected = session
                    .plain_digest
                    .clone()
                    .ok_or_else(|| Error::new("SESSION", "备份尚未解锁"))?;
                (
                    plain,
                    expected,
                    session.encrypted,
                    session.generation.clone(),
                )
            };
            state.jobs.cancel_all_except(None);
            Self::wait_extra_drain_on_state(state)?;
            // The staged plaintext must still be exactly the checked bytes.
            let (_, actual) = crate::backup::file_digest(&plain, crate::backup::MAX_ARCHIVE_FILE)?;
            if actual != expected_hash {
                return Err(Error::new("BACKUP_CHANGED", "备份已经变化，请重新检查"));
            }
            if encrypted {
                let root = state.real.root.clone();
                match SecurityPolicy::load(&root) {
                    Ok(mut policy) => {
                        if policy.state != backup_security::STATE_ENABLED {
                            policy.state = backup_security::STATE_RESTORE_REVIEW.into();
                            policy.changed_at = Some(crate::auto_backup::now_local());
                            // A policy that cannot be persisted blocks the
                            // restore; plaintext auto-backup must not resume.
                            policy.save(&root)?;
                        }
                    }
                    Err(_) => {
                        // A damaged policy already blocks everything; leave it
                        // untouched rather than overwriting diagnostics.
                    }
                }
            }
            state
                .inspections
                .get(&token)
                .ok_or_else(|| Error::new("SESSION", "恢复会话已过期"))?
                .restore_attempted = true;
            let generation_result = state.real.restore(&plain, &expected_hash, &generation)?;
            let session = state
                .inspections
                .get(&token)
                .ok_or_else(|| Error::new("SESSION", "检查会话已过期，请重新检查备份"))?;
            session.restored = Some(generation_result.clone());
            // The restore switched datasets; release controlled files but keep
            // the session record so a repeated confirm is idempotent.
            session.release_files();
            Ok(generation_result)
        })
    }

    /// Validates an automatic backup file name against the real library root.
    /// Manual export mode follows the persisted policy: encrypted when
    /// enabled, plaintext when disabled, blocked until the user has made an
    /// explicit security choice. `force_plaintext` models the one-off
    /// "export an unencrypted copy" exception, which still requires a chosen
    /// policy.
    pub fn backup_export_plan(&self, force_plaintext: bool) -> Result<ExportPlan> {
        self.with_state(move |state| {
            let (policy, _reason) = Self::load_policy(&state.real.root);
            if !policy.active() {
                return Ok(ExportPlan {
                    encrypted: false,
                    blocked_reason: Some(
                        Snapshot::pause_reason(&policy)
                            .unwrap_or_else(|| "请先完成备份安全选择".into()),
                    ),
                });
            }
            Ok(ExportPlan {
                encrypted: policy.state == backup_security::STATE_ENABLED && !force_plaintext,
                blocked_reason: None,
            })
        })
    }

    /// Runs a manual export to a user-chosen destination.
    pub fn create_backup_file(
        &self,
        destination: PathBuf,
        force_plaintext: bool,
    ) -> Result<Option<String>> {
        self.create_backup_file_task(destination, force_plaintext, None)
    }
    pub fn create_backup_file_task(
        &self,
        destination: PathBuf,
        force_plaintext: bool,
        task_id: Option<String>,
    ) -> Result<Option<String>> {
        let work = self.with_state(move |state| {
            if state.demo_mode {
                return Err(Error::new("DEMO_LIBRARY", "请先切换到我的资料"));
            }
            let policy = SecurityPolicy::load(&state.real.root)
                .map_err(|_| Error::new("SECURITY_POLICY", "备份安全配置异常"))?;
            if !policy.active() {
                return Err(Error::new("SECURITY_POLICY", "请先完成备份安全选择"));
            }
            let mut snapshot = Snapshot::from_policy(&policy);
            if force_plaintext {
                snapshot.mode = backup_security::Mode::Plaintext;
            }
            let running = state.jobs.claim(task_id, state.real.generation())?;
            let staging = backup_security::ensure_staging(&state.real.root)?;
            let prepared = state.real.prepare_backup(&staging, &running.task.cancel)?;
            Ok(BackupWork {
                running,
                prepared,
                snapshot,
                destination,
                automatic: false,
                changes: 0,
            })
        })?;
        let path = self.finish_archive(work)?;
        Ok(Some(
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        ))
    }

    pub fn auto_backup_resolve(&self, name: &str) -> Result<PathBuf> {
        let name = name.to_owned();
        self.with_state(move |state| crate::auto_backup::resolve(&state.real.root, &name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        catalog::{Details, Query, SaveAsset},
        domain::Save,
    };

    #[test]
    fn first_real_asset_exits_an_isolated_editable_demo() {
        // The sample is dated from the real clock, so "today" must be real too.
        let today: &'static str = Box::leak(
            chrono::Local::now()
                .format("%Y-%m-%d")
                .to_string()
                .into_boxed_str(),
        );
        let tmp = tempfile::tempdir().unwrap();
        let worker = Worker::start(tmp.path().join("library")).unwrap();
        assert!(worker.demo_status().unwrap().active);
        let query = Query {
            search: String::new(),
            filter: "all".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
            category: Default::default(),
            warranty: "all".into(),
            label: None,
        };
        let demo_page = worker
            .call({
                let q = query.clone();
                move |s| s.query_assets(&q, today)
            })
            .unwrap();
        assert_eq!(demo_page.total, 10);
        let original = &demo_page.items[0];
        let edited = worker
            .call({
                let id = original.asset.id.clone();
                let revision = original.asset.revision;
                let price_cents = original.asset.price_cents.clone();
                let purchase_date = original.asset.purchase_date.clone();
                let details = original.details.clone();
                let generation = demo_page.generation.clone();
                move |s| {
                    s.save_asset(
                        &SaveAsset {
                            options: None,
                            base: Save {
                                request_id: uuid::Uuid::new_v4().to_string(),
                                generation,
                                asset_id: Some(id),
                                expected_revision: Some(revision),
                                name: "已编辑的虚构样例".into(),
                                price_cents,
                                purchase_date,
                            },
                            details,
                            photos: None,
                            classification: None,
                        },
                        today,
                    )
                }
            })
            .unwrap();
        assert_eq!(edited.asset.name, "已编辑的虚构样例");
        assert!(worker.call_personal(|s| s.has_any_asset()).is_err());
        worker.switch_demo(false).unwrap();
        assert!(!worker.call(|s| s.has_any_asset()).unwrap());
        worker.switch_demo(true).unwrap();
        let demo_edit = worker
            .call(move |s| s.record(&edited.asset.id))
            .unwrap()
            .unwrap();
        assert_eq!(demo_edit.asset.name, "已编辑的虚构样例");
        worker.switch_demo(false).unwrap();
        let generation = worker.call(|s| Ok(s.generation())).unwrap();
        worker
            .call(move |s| {
                s.save_asset(
                    &SaveAsset {
                        options: None,
                        base: Save {
                            request_id: uuid::Uuid::new_v4().to_string(),
                            generation,
                            asset_id: None,
                            expected_revision: None,
                            name: "真实库测试物品".into(),
                            price_cents: None,
                            purchase_date: None,
                        },
                        details: Details::default(),
                        photos: None,
                        classification: None,
                    },
                    today,
                )
            })
            .unwrap();
        assert!(worker.demo_status().unwrap().started);
        assert!(worker.switch_demo(true).unwrap().active);
        worker.switch_demo(false).unwrap();
        let real_page = worker.call(move |s| s.query_assets(&query, today)).unwrap();
        assert_eq!(real_page.total, 1);
        assert_eq!(real_page.items[0].asset.name, "真实库测试物品");
        assert_ne!(real_page.generation, demo_page.generation);
    }

    fn example_account(s: &mut Store) -> crate::wealth::Account {
        s.wealth_account_save(
            &crate::wealth::AccountSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: crate::wealth::AccountFields {
                    name: "虚构储蓄卡".into(),
                    institution: "虚构银行".into(),
                    side: "asset".into(),
                    kind: "cash".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                    purchase_cents: None,
                    purchased_on: None,
                    group_id: None,
                },
            },
            "2026-09-28",
        )
        .unwrap()
    }

    #[test]
    fn pending_receipt_resumes_its_library_after_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        let worker = Worker::start(root.clone()).unwrap();
        let demo_generation = worker.call(|s| Ok(s.generation())).unwrap();
        worker.switch_demo(false).unwrap();
        worker
            .call(|s| {
                example_account(s);
                Ok(())
            })
            .unwrap();
        let real_generation = worker.call(|s| Ok(s.generation())).unwrap();
        worker.stop_and_join();
        let restarted = Worker::start(root.clone()).unwrap();
        assert!(!restarted.demo_status().unwrap().active);
        restarted.resume_library(demo_generation.clone()).unwrap();
        assert!(restarted.demo_status().unwrap().active);
        assert_eq!(
            restarted.call(|s| Ok(s.generation())).unwrap(),
            demo_generation
        );
        assert!(restarted.reminder_snapshot().is_ok());
        restarted.resume_library(real_generation.clone()).unwrap();
        assert!(!restarted.demo_status().unwrap().active);
        assert_eq!(
            restarted.call(|s| Ok(s.generation())).unwrap(),
            real_generation
        );
        restarted.stop_and_join();
    }

    #[test]
    fn a_saved_basic_plan_is_a_personal_record_on_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("fictional-library");
        {
            let mut s = Store::open(&root).unwrap();
            let mut input: crate::plan_basic::Update = serde_json::from_str(include_str!(
                "../../tests/fixtures/planning-basic/update.json"
            ))
            .unwrap();
            input.generation = s.generation();
            s.plan_profile_update(&input, "2026-10-07").unwrap();
        }
        let worker = Worker::start(root.clone()).unwrap();
        let status = worker.demo_status().unwrap();
        assert!(status.started);
        assert!(!status.active);
        assert!(root.join("personal-started").exists());
    }

    #[test]
    fn existing_nonphysical_records_and_deleted_records_skip_automatic_demo() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        {
            let mut s = Store::open(&root).unwrap();
            let a = example_account(&mut s);
            s.wealth_trash(&crate::wealth::TrashChange {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                kind: "account".into(),
                id: a.id,
                expected_revision: 1,
                deleted: true,
            })
            .unwrap();
        }
        let worker = Worker::start(root.clone()).unwrap();
        let status = worker.demo_status().unwrap();
        assert!(status.started);
        assert!(!status.active);
        assert!(root.join("personal-started").exists());
    }

    #[test]
    fn first_account_latches_even_after_error_response_and_empty_dataset() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        // Unavailable sample is deliberately tolerated; no native image service needed here.
        std::fs::write(tmp.path().join("demo-library"), b"unavailable").unwrap();
        let worker = Worker::start(root.clone()).unwrap();
        assert!(!worker.demo_status().unwrap().started);
        let failed: Result<()> = worker.call(|_| Err(Error::new("TEST", "未保存")));
        assert!(failed.is_err());
        assert!(!worker.demo_status().unwrap().started);
        let lost: Result<()> = worker.call(|s| {
            example_account(s);
            Err(Error::new("TEST", "已提交但回包丢失"))
        });
        assert!(lost.is_err());
        assert!(worker.demo_status().unwrap().started);
        worker
            .call(|s| {
                s.conn()?.execute("DELETE FROM fin_accounts", [])?;
                Ok(())
            })
            .unwrap();
        assert!(worker.demo_status().unwrap().started);
        assert!(root.join("personal-started").exists());
        // A new worker over an empty dataset with the persisted onboarding marker.
        let other = tmp.path().join("empty-library");
        std::fs::create_dir(&other).unwrap();
        std::fs::copy(
            root.join("personal-started"),
            other.join("personal-started"),
        )
        .unwrap();
        let restarted = Worker::start(other).unwrap();
        assert!(!restarted.demo_status().unwrap().active);
        assert!(restarted.demo_status().unwrap().started);
    }

    #[test]
    fn empty_personal_library_reopens_the_sample_despite_latched_onboarding() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        let worker = Worker::start(root.clone()).unwrap();
        assert!(worker.demo_status().unwrap().active);
        worker.switch_demo(false).unwrap();
        // A marker latched before the library was emptied must not keep an
        // empty library out of the sample on a later launch.
        std::fs::write(root.join("personal-started"), b"1").unwrap();
        drop(worker);
        // The old worker thread releases the library and sample locks
        // asynchronously; keep retrying until a restart can open the sample.
        let restarted = (0..100)
            .find_map(|_| match Worker::start(root.clone()) {
                Ok(worker) if worker.demo_status().unwrap().active => Some(worker),
                Ok(_) | Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    None
                }
            })
            .expect("old worker released library lock and reopened the sample");
        let status = restarted.demo_status().unwrap();
        assert!(status.active);
        assert!(status.started);
    }

    #[test]
    fn a_panicking_job_fails_alone_and_the_worker_keeps_serving() {
        let tmp = tempfile::tempdir().unwrap();
        let worker = Worker::start(tmp.path().join("library")).unwrap();
        worker.switch_demo(false).unwrap();
        let failed = worker.call(|_| -> Result<()> { panic!("injected job failure") });
        assert_eq!(failed.unwrap_err().code, "WORKER");
        assert!(!worker.call(|s| s.has_any_asset()).unwrap());
        assert!(!worker.demo_status().unwrap().active);
    }

    #[test]
    fn damaged_demo_does_not_block_an_empty_personal_library() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("demo-library"), b"blocked demo directory").unwrap();
        let worker = Worker::start(tmp.path().join("library")).unwrap();
        let status = worker.demo_status().unwrap();
        assert!(!status.active);
        assert!(status.available);
        assert!(!worker.call(|store| store.has_any_asset()).unwrap());
    }
}

#[cfg(test)]
mod extra_copy_concurrency_tests {
    use super::*;

    #[test]
    fn policy_change_drains_copy_without_waiting_on_its_own_worker_queue() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        let extra = tmp.path().join("extra");
        std::fs::create_dir(&extra).unwrap();
        let worker = Worker::start(root.clone()).unwrap();
        worker.switch_demo(false).unwrap();
        worker.backup_security_choose_plaintext().unwrap();
        worker.auto_backup_set_extra(extra.clone()).unwrap();
        worker
            .call(|store| {
                store
                    .save(
                        &crate::domain::Save {
                            request_id: crate::storage::uid(),
                            generation: store.generation(),
                            asset_id: None,
                            expected_revision: None,
                            name: "虚构并发备份".into(),
                            price_cents: None,
                            purchase_date: None,
                        },
                        &chrono::Local::now().format("%Y-%m-%d").to_string(),
                    )
                    .map(|_| ())
            })
            .unwrap();
        let policy = Policy {
            idle: Duration::ZERO,
            backoff: Duration::ZERO,
            today: chrono::Local::now().format("%Y-%m-%d").to_string(),
        };
        let TickOutcome::BackedUp(source) = worker.auto_backup_tick(&policy).unwrap() else {
            panic!("expected archive");
        };
        let (arrived_tx, arrived_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let copier = worker.clone();
        let copy_source = source.clone();
        let copy = thread::spawn(move || {
            copier.copy_extra_with_hook(&copy_source, || {
                arrived_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            })
        });
        arrived_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        // A duplicate caller must not touch the active copy's partial file.
        worker.auto_backup_extra_now(&source);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let changer = worker.clone();
        let change = thread::spawn(move || {
            let result = changer.with_state(move |state| {
                entered_tx.send(()).unwrap();
                Worker::commit_policy(state, |_| {})
            });
            finished_tx.send(result).unwrap();
        });
        entered_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        release_tx.send(()).unwrap();
        // Previously the copy queued an epoch read behind commit_policy's
        // drain and every change hit a 10s SECURITY_BUSY cycle.
        assert!(finished_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .is_ok());
        change.join().unwrap();
        copy.join().unwrap();
        assert!(extra.join(source.file_name().unwrap()).is_file());
        assert_eq!(worker.extra_copies.load(Ordering::SeqCst), 0);
        worker.stop_and_join();
    }
}
