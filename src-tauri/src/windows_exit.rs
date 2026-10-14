//! Windows-only graceful exit; notification work never blocks the UI/storage worker.
#[cfg(windows)]
use std::sync::Mutex;

#[cfg(windows)]
#[derive(Default)]
pub struct ExitState(Mutex<Attempt>);
#[derive(Default)]
struct Attempt {
    next: u64,
    running: Option<u64>,
    phase: Phase,
}
#[derive(Default, PartialEq, Debug)]
enum Phase {
    #[default]
    Idle,
    Checking(u64),
    Failed(u64, String),
    Ready,
}
impl Attempt {
    fn begin(&mut self) -> Option<u64> {
        if !matches!(self.phase, Phase::Idle) {
            return None;
        }
        if let Some(id) = self.running {
            self.phase = Phase::Failed(id, "上一轮提醒检查仍在进行，请稍后重试。".into());
            return None;
        }
        self.next += 1;
        self.running = Some(self.next);
        self.phase = Phase::Checking(self.next);
        Some(self.next)
    }
    fn complete(&mut self, id: u64, result: std::result::Result<(), String>) -> bool {
        if self.running != Some(id) {
            return false;
        }
        self.running = None;
        if self.phase != Phase::Checking(id) {
            return false;
        }
        self.phase = match result {
            Ok(()) => Phase::Ready,
            Err(message) => Phase::Failed(id, message),
        };
        true
    }
    fn timeout(&mut self, id: u64) -> bool {
        if self.phase != Phase::Checking(id) {
            return false;
        }
        self.phase = Phase::Failed(id, "提醒检查超过 5 秒，尚未确认排期。".into());
        true
    }
    fn cancel(&mut self) {
        self.phase = Phase::Idle;
    }
    fn confirm(&mut self) -> bool {
        if matches!(self.phase, Phase::Failed(_, _)) {
            self.phase = Phase::Ready;
            true
        } else {
            false
        }
    }
    fn take_permit(&mut self) -> bool {
        if self.phase == Phase::Ready {
            self.phase = Phase::Idle;
            true
        } else {
            false
        }
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use tauri::{Emitter, Manager};
    #[derive(Clone, serde::Serialize)]
    struct Notice {
        pending: bool,
        message: String,
    }
    // Publish on the main event thread and re-read state there. Cancelled or
    // timed-out attempts can never act on a stale successful worker callback.
    fn publish(app: &tauri::AppHandle) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = handle.state::<ExitState>();
            let attempt = state.0.lock().unwrap();
            let notice = match &attempt.phase {
                Phase::Checking(_) => Some(Notice {
                    pending: true,
                    message: String::new(),
                }),
                Phase::Failed(_, message) => Some(Notice {
                    pending: false,
                    message: message.clone(),
                }),
                _ => None,
            };
            let ready = attempt.phase == Phase::Ready;
            drop(attempt);
            if ready {
                handle.exit(0); // Keep the modal until ExitRequested rechecks guards.
            } else {
                let _ = handle.emit("windows-exit-reminders", notice);
            }
        });
    }
    pub fn begin(app: &tauri::AppHandle) {
        let id = app.state::<ExitState>().0.lock().unwrap().begin();
        publish(app);
        let Some(id) = id else {
            return;
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let worker = app.state::<crate::worker::Worker>().inner().clone();
        let handle = app.clone();
        let (done, finished) = std::sync::mpsc::sync_channel(1);
        // The timeout covers snapshot acquisition as well as native scheduling.
        tauri::async_runtime::spawn_blocking(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                worker
                    .reminder_snapshot()
                    .and_then(crate::reminders::flush_for_exit)
                    .map_err(|error| error.message)
            }))
            .unwrap_or_else(|_| Err("提醒检查未能完成，请返回应用后重试。".into()));
            let state = handle.state::<ExitState>();
            let mut attempt = state.0.lock().unwrap();
            let expired = std::time::Instant::now() >= deadline && attempt.timeout(id);
            let completed = attempt.complete(id, result);
            drop(attempt);
            let changed = expired || completed;
            let _ = done.send(());
            if changed {
                publish(&handle);
            }
        });
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if finished
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .is_err()
                && handle.state::<ExitState>().0.lock().unwrap().timeout(id)
            {
                publish(&handle);
            }
        });
    }
    pub fn take_permit(app: &tauri::AppHandle) -> bool {
        app.state::<ExitState>().0.lock().unwrap().take_permit()
    }
    pub fn cancel(app: &tauri::AppHandle) {
        app.state::<ExitState>().0.lock().unwrap().cancel();
        publish(app);
    }
    pub fn choose(app: &tauri::AppHandle, exit: bool) {
        if exit {
            app.state::<ExitState>().0.lock().unwrap().confirm();
        } else {
            app.state::<ExitState>().0.lock().unwrap().cancel();
        }
        publish(app);
    }
}
#[cfg(windows)]
pub use native::{begin, cancel, choose, take_permit};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_close_waits_for_one_completion_and_exit_permit_is_once_only() {
        let mut state = Attempt::default();
        let id = state.begin().unwrap();
        assert_eq!(state.begin(), None);
        assert!(!state.take_permit());
        assert!(state.complete(id, Ok(())));
        assert!(state.take_permit());
        assert!(!state.take_permit());
    }
    #[test]
    fn cancel_and_timeout_never_allow_late_completion_to_exit_or_spawn_another_task() {
        for timeout in [false, true] {
            let mut state = Attempt::default();
            let id = state.begin().unwrap();
            if timeout {
                assert!(state.timeout(id));
            } else {
                state.cancel();
            }
            assert!(!state.take_permit());
            assert_eq!(state.begin(), None);
            assert_eq!(state.running, Some(id));
            assert!(!state.complete(id, Ok(())));
            assert!(!state.take_permit());
            state.cancel();
            assert!(state.begin().is_some());
        }
    }
    #[test]
    fn stale_timeout_cannot_change_a_fresh_close_attempt() {
        let mut state = Attempt::default();
        let old = state.begin().unwrap();
        state.cancel();
        assert!(!state.complete(old, Ok(())));
        let current = state.begin().unwrap();
        assert!(!state.timeout(old));
        assert!(!state.complete(old, Err("old failure".into())));
        assert_eq!(state.running, Some(current));
        assert!(state.complete(current, Ok(())));
        assert!(state.take_permit());
    }
    #[test]
    fn failure_needs_explicit_confirmation_and_new_guard_cancels_the_permit() {
        let mut state = Attempt::default();
        let id = state.begin().unwrap();
        assert!(!state.confirm());
        assert!(state.complete(id, Err("disabled".into())));
        assert!(!state.take_permit());
        assert!(state.confirm());
        state.cancel(); // Native guard takes priority even after a confirmation.
        assert!(!state.take_permit());
        let next = state.begin().unwrap();
        assert!(!state.complete(id, Ok(())));
        assert!(state.timeout(next));
        assert!(state.confirm());
        assert!(state.take_permit());
    }
}
