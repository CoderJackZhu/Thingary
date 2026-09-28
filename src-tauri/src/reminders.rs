use crate::{
    domain::{Error, Result},
    storage::Store,
};
use serde::Serialize;
use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Mutex, OnceLock,
    },
};
static ENABLED: AtomicBool = AtomicBool::new(false);
static AUTH_PENDING: AtomicUsize = AtomicUsize::new(0);
static LAST: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));
extern "C" {
    fn possio_notifications(json: *const c_char, ask: i32) -> *mut c_char;
    fn possio_free(ptr: *mut c_void);
}
#[derive(Serialize)]
pub struct Plan {
    pub id: String,
    pub date: String,
    pub title: String,
    pub body: String,
}
impl Store {
    pub fn reminder_plans(&self) -> Result<Vec<Plan>> {
        let c = self.conn()?;
        let sql="SELECT r.id,r.date,a.name,r.notes,'保障到期提醒' FROM reminders r JOIN assets a ON a.id=r.entity_id JOIN warranties w ON w.id=r.source_id AND w.asset_id=a.id WHERE r.kind='warranty' AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND r.date<=w.end_date UNION ALL SELECT r.id,r.date,w.name,r.notes,'心愿到期提醒' FROM reminders r JOIN wishlist_items w ON w.id=r.entity_id WHERE r.kind='wishlist' AND w.status='ongoing' AND w.deleted_at IS NULL ORDER BY 1";
        let plans = c
            .prepare(sql)?
            .query_map([], |r| {
                Ok(Plan {
                    id: format!("possio-{}", r.get::<_, String>(0)?),
                    date: r.get(1)?,
                    title: format!("{} · {}", r.get::<_, String>(4)?, r.get::<_, String>(2)?),
                    body: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(plans)
    }
}
pub fn enable() {
    ENABLED.store(true, Ordering::Relaxed);
}
/// Unit tests record plans instead of reaching the notification center.
#[cfg(test)]
static NATIVE_CALLS: Mutex<Vec<String>> = Mutex::new(Vec::new());
fn native(json: &str, ask: bool) -> Result<()> {
    #[cfg(test)]
    if !ask {
        NATIVE_CALLS.lock().unwrap().push(json.to_owned());
        return Ok(());
    }
    let json = CString::new(json).map_err(|_| Error::new("REMINDER", "提醒内容无效"))?;
    let ptr = unsafe { possio_notifications(json.as_ptr(), i32::from(ask)) };
    if ptr.is_null() {
        return Err(Error::new("REMINDER", "通知服务不可用"));
    }
    let message = unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { possio_free(ptr.cast()) };
    if message.is_empty() {
        Ok(())
    } else {
        Err(Error::new("REMINDER", &message))
    }
}
pub fn request_permission() -> Result<()> {
    AUTH_PENDING.fetch_add(1, Ordering::AcqRel);
    let result = native("[]", true);
    AUTH_PENDING.fetch_sub(1, Ordering::AcqRel);
    result
}
/// A reminder plan read on the storage worker. Sequence numbers are taken in
/// the same job as the read, and the worker runs jobs one at a time, so a
/// higher number always reflects a later state of the library.
pub struct Snapshot {
    seq: u64,
    json: String,
}
static SEQ: AtomicU64 = AtomicU64::new(0);
impl Snapshot {
    fn new(json: String) -> Self {
        Self {
            seq: SEQ.fetch_add(1, Ordering::SeqCst) + 1,
            json,
        }
    }
}
/// Call only inside a storage worker job; see [`Snapshot`].
pub fn snapshot(store: &Store) -> Result<Snapshot> {
    Ok(Snapshot::new(serde_json::to_string(
        &store.reminder_plans()?,
    )?))
}
struct Request {
    snapshot: Snapshot,
    force: bool,
    done: Option<mpsc::SyncSender<()>>,
}
/// Every plan reaches the notification center through this one thread. The
/// center can take seconds to answer, so it never runs on the storage worker,
/// and a snapshot older than one already seen is never applied.
fn enqueue(request: Request) -> bool {
    static QUEUE: OnceLock<Mutex<mpsc::Sender<Request>>> = OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Request>();
        let spawned = std::thread::Builder::new()
            .name("possio-reminders".into())
            .spawn(move || {
                let mut latest: Option<Snapshot> = None;
                while let Ok(first) = rx.recv() {
                    let mut force = false;
                    let mut waiting = Vec::new();
                    for request in std::iter::once(first).chain(rx.try_iter()) {
                        if latest.as_ref().is_none_or(|l| request.snapshot.seq > l.seq) {
                            latest = Some(request.snapshot);
                        }
                        force |= request.force;
                        waiting.extend(request.done);
                    }
                    // A permission prompt is open; schedule once it is answered.
                    while AUTH_PENDING.load(Ordering::Acquire) != 0 {
                        std::thread::sleep(std::time::Duration::from_millis(200));
                    }
                    if let Some(plan) = &latest {
                        apply(&plan.json, force);
                    }
                    for done in waiting {
                        let _ = done.send(());
                    }
                }
            });
        if spawned.is_err() {
            if let Ok(mut last) = LAST.lock() {
                last.1 = "提醒服务未能启动，请重启物志".into();
            }
        }
        Mutex::new(tx)
    });
    queue.lock().is_ok_and(|tx| tx.send(request).is_ok())
}
/// Queues a plan after a write; returns immediately.
pub fn schedule(snapshot: Snapshot) {
    if ENABLED.load(Ordering::Relaxed) {
        enqueue(Request {
            snapshot,
            force: false,
            done: None,
        });
    }
}
/// Re-applies the newest known plan (never an older `snapshot`) even when it
/// is unchanged, and waits until the notification center has answered.
pub fn refresh(snapshot: Snapshot) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let (done, finished) = mpsc::sync_channel(1);
    if enqueue(Request {
        snapshot,
        force: true,
        done: Some(done),
    }) {
        let _ = finished.recv();
    }
}
/// Synchronises macOS pending notifications with `json`. Unchanged plans are
/// skipped unless `force`. Runs only on the reminder thread.
fn apply(json: &str, force: bool) {
    let Ok(mut last) = LAST.lock() else {
        return;
    };
    if !force && last.0 == json {
        return;
    }
    last.0 = json.to_owned();
    last.1 = match native(json, false) {
        Ok(()) => String::new(),
        Err(e) => e.message,
    };
}
pub fn status() -> String {
    LAST.lock()
        .map(|l| l.1.clone())
        .unwrap_or_else(|_| "提醒状态不可用".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A status check reads its plan, then a write cancels the reminder and is
    /// applied, and only then does the status check reach the queue. The stale
    /// plan must not reschedule the cancelled reminder.
    #[test]
    fn a_late_status_check_never_reapplies_a_stale_plan() {
        enable();
        let stale_json = r#"[{"id":"possio-cancelled","date":"2099-01-01","title":"t","body":""}]"#;
        let stale = Snapshot::new(stale_json.into());
        let newer = Snapshot::new("[]".into());
        schedule(newer);
        refresh(stale);
        let calls = NATIVE_CALLS.lock().unwrap();
        assert!(!calls.is_empty());
        assert!(!calls.iter().any(|c| c == stale_json));
        assert_eq!(LAST.lock().unwrap().0, "[]");
    }
}
