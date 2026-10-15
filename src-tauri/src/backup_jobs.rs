use crate::{
    backup_task::Cancellation,
    domain::{Error, Result},
};
use std::{
    any::Any,
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
#[derive(Default, Clone)]
pub(crate) struct Jobs {
    tasks: Arc<Mutex<HashMap<String, Arc<Task>>>>,
    pub io: Arc<AtomicUsize>,
}
pub(crate) struct Task {
    pub id: String,
    pub generation: String,
    pub cancel: Cancellation,
    phase: Mutex<u8>,
    pending: Mutex<Option<Box<dyn Any + Send>>>,
    created: Instant,
}
pub(crate) struct Running {
    pub task: Arc<Task>,
    io: Option<Arc<AtomicUsize>>,
}
impl Jobs {
    pub fn begin(&self, generation: String) -> Result<String> {
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|_| Error::new("WORKER", "任务状态不可用"))?;
        tasks.retain(|_, t| {
            let phase = *t.phase.lock().unwrap_or_else(|e| e.into_inner());
            phase == 1
                || (phase == 0
                    && t.cancel.check().is_ok()
                    && t.created.elapsed() < Duration::from_secs(300))
        });
        if tasks.len() >= 64 {
            return Err(Error::new("BACKUP_BUSY", "备份任务过多，请稍后再试"));
        }
        let id = crate::storage::uid();
        tasks.insert(
            id.clone(),
            Arc::new(Task {
                id: id.clone(),
                generation,
                cancel: Cancellation::default(),
                phase: Mutex::new(0),
                pending: Mutex::new(None),
                created: Instant::now(),
            }),
        );
        Ok(id)
    }
    pub fn claim(&self, id: Option<String>, generation: String) -> Result<Running> {
        let id = match id {
            Some(id) => id,
            None => self.begin(generation.clone())?,
        };
        let t = self
            .tasks
            .lock()
            .map_err(|_| Error::new("WORKER", "任务状态不可用"))?
            .get(&id)
            .cloned()
            .ok_or_else(|| Error::new("SESSION", "备份任务已过期"))?;
        {
            let mut phase = t.phase.lock().unwrap_or_else(|e| e.into_inner());
            if *phase != 0 || t.generation != generation {
                return Err(Error::new("SESSION", "备份任务已失效"));
            }
            t.cancel.check()?;
            *phase = 1;
        }
        self.io.fetch_add(1, Ordering::SeqCst);
        Ok(Running {
            task: t,
            io: Some(self.io.clone()),
        })
    }
    pub fn check_ready(&self, id: &str, generation: &str) -> Result<()> {
        let task = self
            .tasks
            .lock()
            .map_err(|_| Error::new("WORKER", "任务状态不可用"))?
            .get(id)
            .cloned()
            .ok_or_else(|| Error::new("SESSION", "备份任务已过期"))?;
        if task.generation != generation
            || *task.phase.lock().unwrap_or_else(|e| e.into_inner()) != 0
        {
            return Err(Error::new("SESSION", "备份任务已失效"));
        }
        task.cancel.check()
    }
    pub fn cancel(&self, id: &str) -> Result<bool> {
        let t = self
            .tasks
            .lock()
            .map_err(|_| Error::new("WORKER", "任务状态不可用"))?
            .get(id)
            .cloned();
        Ok(t.is_some_and(|t| {
            let phase = t.phase.lock().unwrap_or_else(|e| e.into_inner());
            if *phase >= 2 {
                false
            } else {
                t.cancel.cancel();
                t.pending.lock().unwrap_or_else(|e| e.into_inner()).take();
                true
            }
        }))
    }
    pub fn cancel_all_except(&self, except: Option<&str>) {
        let tasks: Vec<_> = self
            .tasks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        for t in tasks {
            if Some(t.id.as_str()) != except {
                let phase = t.phase.lock().unwrap_or_else(|e| e.into_inner());
                if *phase < 2 {
                    t.cancel.cancel();
                    t.pending.lock().unwrap_or_else(|e| e.into_inner()).take();
                }
            }
        }
    }
}
impl Task {
    pub fn stage<T: Send + 'static>(&self, value: T) -> Result<()> {
        let phase = self.phase.lock().unwrap_or_else(|e| e.into_inner());
        self.cancel.check()?;
        if *phase != 1 {
            return Err(Error::new("SESSION", "备份任务已失效"));
        }
        *self.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(value));
        Ok(())
    }
    /// Called only inside publish's phase lock, which also guards cancellation.
    pub fn take_staged<T: Send + 'static>(&self) -> Result<T> {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .and_then(|v| v.downcast::<T>().ok())
            .map(|v| *v)
            .ok_or_else(|| Error::new("SESSION", "备份任务暂存已失效"))
    }

    pub fn publish<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        let mut phase = self.phase.lock().unwrap_or_else(|e| e.into_inner());
        self.cancel.check()?;
        if *phase != 1 {
            return Err(Error::new("SESSION", "备份任务已失效"));
        }
        let result = f()?;
        *phase = 2;
        Ok(result)
    }
}
impl Running {
    pub fn stop_io(&mut self) {
        if let Some(io) = self.io.take() {
            io.fetch_sub(1, Ordering::SeqCst);
        }
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        let mut phase = self.task.phase.lock().unwrap_or_else(|e| e.into_inner());
        self.task
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        *phase = 3;
        drop(phase);
        self.stop_io();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_task_scoped_and_publish_linearizes_late_cancel() {
        let jobs = Jobs::default();
        let id = jobs.begin("g".into()).unwrap();
        let mut run = jobs.claim(Some(id.clone()), "g".into()).unwrap();
        assert_eq!(jobs.io.load(Ordering::SeqCst), 1);
        assert!(jobs.cancel(&id).unwrap());
        assert_eq!(run.task.publish(|| Ok(())).unwrap_err().code, "CANCELLED");
        run.stop_io();
        assert_eq!(jobs.io.load(Ordering::SeqCst), 0);
        drop(run);
        let next = jobs.begin("g".into()).unwrap();
        let run = jobs.claim(Some(next.clone()), "g".into()).unwrap();
        assert!(!jobs.cancel(&id).unwrap());
        run.task.publish(|| Ok(())).unwrap();
        assert!(!jobs.cancel(&next).unwrap());
        drop(run);
        assert_eq!(jobs.io.load(Ordering::SeqCst), 0);
    }
    #[test]
    fn policy_cancellation_exempts_only_its_own_setup() {
        let jobs = Jobs::default();
        let own = jobs.begin("g".into()).unwrap();
        let other = jobs.begin("g".into()).unwrap();
        jobs.cancel_all_except(Some(&own));
        jobs.check_ready(&own, "g").unwrap();
        assert_eq!(jobs.check_ready(&other, "g").unwrap_err().code, "CANCELLED");
        assert!(jobs
            .claim(Some(own.clone()), "other-generation".into())
            .is_err());
        let run = jobs.claim(Some(own.clone()), "g".into()).unwrap();
        assert!(jobs.claim(Some(own), "g".into()).is_err());
        drop(run);
    }
    #[test]
    fn finished_tasks_do_not_exhaust_registry() {
        let jobs = Jobs::default();
        for _ in 0..100 {
            let id = jobs.begin("g".into()).unwrap();
            let run = jobs.claim(Some(id), "g".into()).unwrap();
            drop(run);
        }
        assert!(jobs.begin("g".into()).is_ok());
    }

    #[test]
    fn cancellation_cleans_ready_outputs_before_a_queued_final_can_run() {
        let jobs = Jobs::default();
        let id = jobs.begin("g".into()).unwrap();
        let mut run = jobs.claim(Some(id.clone()), "g".into()).unwrap();
        let temp = tempfile::NamedTempFile::new().unwrap();
        let path = temp.path().to_path_buf();
        run.task.stage(temp).unwrap();
        run.stop_io();
        assert_eq!(jobs.io.load(Ordering::SeqCst), 0);
        assert!(path.exists());
        assert!(jobs.cancel(&id).unwrap());
        assert!(
            !path.exists(),
            "cancel clears ready plaintext without a worker job"
        );
        assert_eq!(run.task.publish(|| Ok(())).unwrap_err().code, "CANCELLED");
        assert!(run.task.pending.lock().unwrap().is_none());
    }

    #[test]
    fn policy_cancel_cleans_old_ready_files_and_preserves_only_its_own_task() {
        let jobs = Jobs::default();
        let old = jobs.begin("g".into()).unwrap();
        let mut old_run = jobs.claim(Some(old.clone()), "g".into()).unwrap();
        let old_dir = tempfile::tempdir().unwrap();
        let old_path = old_dir.path().to_path_buf();
        std::fs::write(old_path.join("plaintext"), b"fictional private bytes").unwrap();
        old_run.task.stage(old_dir).unwrap();
        old_run.stop_io();
        let own = jobs.begin("g".into()).unwrap();
        let mut own_run = jobs.claim(Some(own.clone()), "g".into()).unwrap();
        let own_temp = tempfile::NamedTempFile::new().unwrap();
        let own_path = own_temp.path().to_path_buf();
        own_run.task.stage(own_temp).unwrap();
        own_run.stop_io();
        jobs.cancel_all_except(Some(&own));
        assert!(!old_path.exists());
        assert!(own_path.exists());
        assert!(own_run.task.cancel.check().is_ok());
        drop(old_run);
        assert!(!jobs.cancel(&old).unwrap());
        assert!(
            own_path.exists(),
            "a late old task cancel does not affect this output"
        );
        drop(own_run);
        assert!(!own_path.exists());
    }

    #[test]
    fn late_stage_after_cancel_drops_its_file_before_io_can_drain() {
        let jobs = Jobs::default();
        let id = jobs.begin("g".into()).unwrap();
        let run = jobs.claim(Some(id.clone()), "g".into()).unwrap();
        assert!(jobs.cancel(&id).unwrap());
        let temp = tempfile::NamedTempFile::new().unwrap();
        let path = temp.path().to_path_buf();
        assert_eq!(run.task.stage(temp).unwrap_err().code, "CANCELLED");
        assert!(!path.exists());
        assert_eq!(jobs.io.load(Ordering::SeqCst), 1);
        drop(run);
        assert_eq!(jobs.io.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn cancellation_during_atomic_publication_returns_too_late() {
        let jobs = Jobs::default();
        let id = jobs.begin("g".into()).unwrap();
        let mut run = jobs.claim(Some(id.clone()), "g".into()).unwrap();
        let root = tempfile::tempdir().unwrap();
        let temp = tempfile::NamedTempFile::new_in(root.path()).unwrap();
        std::fs::write(temp.path(), b"fictional committed backup").unwrap();
        run.task.stage(temp).unwrap();
        run.stop_io();
        let destination = root.path().join("complete.thingary");
        let final_path = destination.clone();
        let task = run.task.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
        let publish = std::thread::spawn(move || {
            task.publish(|| {
                let temp = task.take_staged()?;
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                crate::backup::publish_staged(temp, &destination)
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let cancel_jobs = jobs.clone();
        let (cancel_tx, cancel_rx) = std::sync::mpsc::sync_channel(1);
        let cancel = std::thread::spawn(move || cancel_tx.send(cancel_jobs.cancel(&id)).unwrap());
        let before_commit = cancel_rx.recv_timeout(Duration::from_millis(20));
        release_tx.send(()).unwrap();
        publish.join().unwrap().unwrap();
        assert!(matches!(
            before_commit,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        assert!(!cancel_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap());
        cancel.join().unwrap();
        assert_eq!(
            std::fs::read(final_path).unwrap(),
            b"fictional committed backup"
        );
    }
}
