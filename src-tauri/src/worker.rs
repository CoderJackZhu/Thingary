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
}
struct Libraries {
    real: Store,
    demo: Option<Store>,
    demo_mode: bool,
    /// Library, dataset and write count last used to plan reminders.
    reminder_key: Option<(bool, String, u64)>,
}
impl Libraries {
    /// Re-plans reminders only after something was written or the active
    /// library changed; reads such as previews skip the query entirely.
    fn sync_reminders(&mut self) {
        let active = if self.demo_mode {
            self.demo.as_ref().unwrap_or(&self.real)
        } else {
            &self.real
        };
        let Ok(conn) = active.conn() else {
            return;
        };
        let key = (self.demo_mode, active.generation(), conn.total_changes());
        if self.reminder_key.as_ref() == Some(&key) {
            return;
        }
        if let Ok(json) = crate::reminders::plans_json(active) {
            self.reminder_key = Some(key);
            crate::reminders::schedule(json);
        }
    }
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
                    let demo = if !real.has_any_asset()? {
                        let attempt = (|| {
                            let mut store = Store::open(&root.with_file_name("demo-library"))?;
                            crate::demo::import(
                                &mut store,
                                &chrono::Local::now().format("%Y-%m-%d").to_string(),
                            )?;
                            Ok::<Store, Error>(store)
                        })();
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
                        reminder_key: None,
                    })
                })() {
                    Ok(mut libraries) => {
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
                available: !state.real.has_any_asset()?,
            })
        })
    }
    pub fn switch_demo(&self, demo: bool) -> Result<DemoStatus> {
        self.with_state(move |state| {
            if demo && state.real.has_any_asset()? {
                return Err(Error::new(
                    "DEMO_COMPLETE",
                    "已经开始记录真实资产，样例展示已结束",
                ));
            }
            if demo && state.demo.is_none() {
                let mut store = Store::open(&state.real.root.with_file_name("demo-library"))?;
                crate::demo::import(
                    &mut store,
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                )?;
                state.demo = Some(store);
            }
            state.demo_mode = demo;
            Ok(DemoStatus {
                active: state.demo_mode,
                available: !state.real.has_any_asset()?,
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
        assert_eq!(demo_page.total, 8);
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
        assert!(!worker.demo_status().unwrap().available);
        assert!(worker.switch_demo(true).is_err());
        let real_page = worker
            .call(move |s| s.query_assets(&query, "2026-09-27"))
            .unwrap();
        assert_eq!(real_page.total, 1);
        assert_eq!(real_page.items[0].asset.name, "真实库测试物品");
        assert_ne!(real_page.generation, demo_page.generation);
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
