use crate::{
    domain::{Error, Result},
    storage::Store,
};
use std::{
    panic::{self, AssertUnwindSafe},
    path::PathBuf,
    sync::mpsc::{self, SyncSender},
    thread,
};
#[derive(serde::Serialize)]
pub struct DemoStatus {
    pub active: bool,
    pub available: bool,
    pub started: bool,
}
struct Libraries {
    real: Store,
    demo: Option<Store>,
    demo_mode: bool,
    started: bool,
    /// Library, dataset and write count last used to plan reminders.
    reminder_key: Option<(bool, String, u64)>,
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
                    let started =
                        root.join("personal-started").exists() || has_personal_records(&real)?;
                    let demo = if !started {
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
                    })
                })() {
                    Ok(mut libraries) => {
                        if let Err(error) = libraries.record_started() {
                            eprintln!("首次使用状态暂未保存：{error}");
                        }
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
                // Answer first; reminder bookkeeping must not delay the caller.
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
        };
        let demo_page = worker
            .call({
                let q = query.clone();
                move |s| s.query_assets(&q, "2026-09-27")
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
                        "2026-09-27",
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
                    "2026-09-27",
                )
            })
            .unwrap();
        assert!(worker.demo_status().unwrap().started);
        assert!(worker.switch_demo(true).unwrap().active);
        worker.switch_demo(false).unwrap();
        let real_page = worker
            .call(move |s| s.query_assets(&query, "2026-09-27"))
            .unwrap();
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
