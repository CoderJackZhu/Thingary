use crate::{
    domain::{Error, Result},
    storage::Store,
};
use serde::Serialize;
use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
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
        let sql="SELECT r.id,r.date,a.name,r.notes,'保障到期提醒' FROM reminders r JOIN assets a ON a.id=r.entity_id JOIN warranties w ON w.id=r.source_id AND w.asset_id=a.id WHERE r.kind='warranty' AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND r.date<=w.end_date UNION ALL SELECT r.id,r.date,w.name,r.notes,'心愿到期提醒' FROM reminders r JOIN wishlist_items w ON w.id=r.entity_id WHERE r.kind='wishlist' AND w.status='ongoing' ORDER BY 1";
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
fn native(json: &str, ask: bool) -> Result<()> {
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
pub fn plans_json(store: &Store) -> Result<String> {
    Ok(serde_json::to_string(&store.reminder_plans()?)?)
}
/// Hands the latest plan to a dedicated thread. The notification center can
/// take seconds to answer, so it must never run on the serial storage worker.
pub fn schedule(json: String) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    static QUEUE: OnceLock<Mutex<mpsc::Sender<String>>> = OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<String>();
        let spawned = std::thread::Builder::new()
            .name("possio-reminders".into())
            .spawn(move || {
                while let Ok(mut json) = rx.recv() {
                    // Only the newest plan matters.
                    while let Ok(newer) = rx.try_recv() {
                        json = newer;
                    }
                    // A permission prompt is open; schedule once it is answered.
                    while AUTH_PENDING.load(Ordering::Acquire) != 0 {
                        std::thread::sleep(std::time::Duration::from_millis(200));
                    }
                    apply(&json, false);
                }
            });
        if spawned.is_err() {
            if let Ok(mut last) = LAST.lock() {
                last.1 = "提醒服务未能启动，请重启物志".into();
            }
        }
        Mutex::new(tx)
    });
    if let Ok(tx) = queue.lock() {
        let _ = tx.send(json);
    }
}
/// Synchronises macOS pending notifications with `json`. Unchanged plans are
/// skipped unless `force`. Callers must not hold the storage worker.
pub fn apply(json: &str, force: bool) {
    if !ENABLED.load(Ordering::Relaxed) || AUTH_PENDING.load(Ordering::Acquire) != 0 {
        return;
    }
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
