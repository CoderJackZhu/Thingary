use crate::{
    domain::{Error, Result},
    storage::Store,
};
use std::{
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::mpsc::{self, SyncSender},
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
    /// The archive was published; the caller may copy it to the extra
    /// location off the worker thread.
    BackedUp(PathBuf),
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
        self.backup_key = Some(key);
        self.last_change = Some(Instant::now());
        let marker = crate::auto_backup::marker_path(&self.real.root);
        if !marker.exists() {
            if let Err(error) = std::fs::write(&marker, b"1") {
                eprintln!("自动备份标记未写入：{error}");
            }
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
         OR EXISTS(SELECT 1 FROM plan_payments) OR EXISTS(SELECT 1 FROM virtual_assets)",
        [],
        |r| r.get(0),
    )?)
}
type Job = Box<dyn FnOnce(&mut Libraries) + Send>;
#[derive(Clone)]
pub struct Worker {
    sender: SyncSender<Job>,
}
impl Worker {
    pub fn start(root: PathBuf) -> Result<Self> {
        let (tx, rx) = mpsc::sync_channel::<Job>(32);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("possio-storage".into())
            .spawn(move || {
                match (|| -> Result<Libraries> {
                    let real = Store::open(&root)?;
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
                    Ok(Libraries {
                        real,
                        demo,
                        demo_mode,
                        started,
                        reminder_key: None,
                        backup_key: None,
                        last_change: None,
                        backup_failed_at: None,
                    })
                })() {
                    Ok(mut libraries) => {
                        if let Err(error) = libraries.record_started() {
                            eprintln!("首次使用状态暂未保存：{error}");
                        }
                        // Baseline the change key before any job runs, so the
                        // first write of this session is counted as a change.
                        libraries.track_backup_changes();
                        let _ = ready_tx.send(Ok(()));
                        while let Ok(job) = rx.recv() {
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
        Ok(Self { sender: tx })
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
    pub fn modules(&self) -> Result<crate::modules::Modules> {
        self.with_state(|state| Ok(crate::modules::read(&state.real.root)))
    }
    /// Saving forgets the last reminder plan so the switch takes effect at once.
    pub fn set_modules(&self, modules: crate::modules::Modules) -> Result<crate::modules::Modules> {
        self.with_state(move |state| {
            crate::modules::write(&state.real.root, &modules)?;
            state.reminder_key = None;
            Ok(modules)
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
            state.demo_mode = demo;
            Ok(DemoStatus {
                active: state.demo_mode,
                available: true,
                started: state.started || has_personal_records(&state.real)?,
            })
        })
    }
    /// One automatic-backup attempt. Runs on the worker thread like every
    /// storage task, so the snapshot sees no concurrent writes; the extra
    /// copy is left to the caller via `TickOutcome::BackedUp`.
    pub fn auto_backup_tick(&self, policy: &Policy) -> Result<TickOutcome> {
        let policy = policy.clone();
        self.with_state(move |state| {
            let root = state.real.root.clone();
            let mut settings = crate::auto_backup::Settings::load(&root);
            if !settings.enabled {
                return Ok(TickOutcome::Disabled);
            }
            let marker = crate::auto_backup::marker_path(&root);
            // A library that already holds records but has no automatic
            // backup yet (an upgrade, or all archives deleted by hand) gets
            // its first one without waiting for a change.
            let first_backup = !marker.exists()
                && crate::auto_backup::list(&crate::auto_backup::backup_dir(&root)).is_empty()
                && has_personal_records(&state.real)?;
            if !marker.exists() && !first_backup {
                return Ok(TickOutcome::NoMarker);
            }
            // No change this session counts as already idle, so a marker left
            // by a force-quit is made up on the first tick after launch.
            if state
                .last_change
                .is_some_and(|at| at.elapsed() < policy.idle)
            {
                return Ok(TickOutcome::NotIdle);
            }
            let new_change_since_failure = state
                .last_change
                .is_some_and(|at| state.backup_failed_at.is_some_and(|f| at > f));
            if state
                .backup_failed_at
                .is_some_and(|at| at.elapsed() < policy.backoff && !new_change_since_failure)
            {
                return Ok(TickOutcome::Backoff);
            }
            if !has_personal_records(&state.real)? {
                let _ = std::fs::remove_file(&marker);
                return Ok(TickOutcome::EmptyLibrary);
            }
            let dir = crate::auto_backup::backup_dir(&root);
            match crate::auto_backup::run(&state.real, &dir, &policy.today) {
                Ok(published) => {
                    let _ = std::fs::remove_file(&marker);
                    state.backup_failed_at = None;
                    settings.last_success_at = Some(crate::auto_backup::now_local());
                    settings.last_error = None;
                    if let Err(error) = settings.save(&root) {
                        eprintln!("自动备份状态未保存：{error}");
                    }
                    if let Err(error) = crate::auto_backup::prune(&dir) {
                        eprintln!("自动备份清理未完成：{error}");
                    }
                    Ok(TickOutcome::BackedUp(published))
                }
                Err(error) => {
                    state.backup_failed_at = Some(Instant::now());
                    settings.last_error = Some(crate::auto_backup::Failure {
                        at: crate::auto_backup::now_local(),
                        message: error.message.clone(),
                    });
                    if let Err(save_error) = settings.save(&root) {
                        eprintln!("自动备份失败状态未保存：{save_error}");
                    }
                    Err(error)
                }
            }
        })
    }
    /// Copies a published archive to the configured extra location. The heavy
    /// copy runs on the calling thread (timer or command), never the worker.
    pub fn auto_backup_extra_now(&self, source: &Path) {
        let extra = match self
            .with_state(|state| Ok(crate::auto_backup::Settings::load(&state.real.root).extra_dir))
        {
            Ok(extra) => extra,
            Err(_) => return,
        };
        let Some(extra) = extra else {
            return;
        };
        let outcome = crate::auto_backup::copy_extra(source, Path::new(&extra));
        let failure = outcome.err().map(|error| crate::auto_backup::Failure {
            at: crate::auto_backup::now_local(),
            message: error.message.clone(),
        });
        let _ = self.with_state(|state| {
            let mut settings = crate::auto_backup::Settings::load(&state.real.root);
            match failure {
                None => {
                    settings.extra_last_at = Some(crate::auto_backup::now_local());
                    settings.extra_last_error = None;
                }
                Some(failure) => settings.extra_last_error = Some(failure),
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
            settings.extra_dir = Some(extra.display().to_string());
            settings.extra_last_at = None;
            settings.extra_last_error = None;
            settings.save(&root)?;
            Ok(crate::auto_backup::status(&root))
        })
    }
    pub fn auto_backup_clear_extra(&self) -> Result<crate::auto_backup::Status> {
        self.with_state(|state| {
            let root = state.real.root.clone();
            let mut settings = crate::auto_backup::Settings::load(&root);
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
    /// Validates an automatic backup file name against the real library root.
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
        assert_eq!(demo_page.total, 9);
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
        drop(worker);
        let restarted = (0..100)
            .find_map(|_| match Worker::start(root.clone()) {
                Ok(worker) => Some(worker),
                Err(error) if error.code == "LOCKED" => {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    None
                }
                Err(error) => panic!("unexpected restart failure: {error}"),
            })
            .expect("old worker released library lock");
        assert!(!restarted.demo_status().unwrap().active);
        // The dying worker thread may still hold the sample lock when the
        // library lock is already free; retry the resume briefly.
        (0..100)
            .find_map(
                |_| match restarted.resume_library(demo_generation.clone()) {
                    Ok(()) => Some(()),
                    Err(error) if error.code == "LOCKED" => {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                        None
                    }
                    Err(error) => panic!("unexpected resume failure: {error}"),
                },
            )
            .expect("sample library lock released");
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
