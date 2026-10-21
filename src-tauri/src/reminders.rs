use crate::{
    domain::{Error, Result},
    storage::Store,
};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    mpsc, Mutex, OnceLock,
};
static ENABLED: AtomicBool = AtomicBool::new(false);
static AUTH_PENDING: AtomicUsize = AtomicUsize::new(0);
static LAST: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));
#[cfg(target_os = "macos")]
extern "C" {
    fn thingary_notifications(json: *const c_char, ask: i32) -> *mut c_char;
    fn thingary_free(ptr: *mut c_void);
}
#[derive(Deserialize, Serialize)]
pub struct Plan {
    pub id: String,
    pub date: String,
    pub title: String,
    pub body: String,
}
impl Store {
    pub fn reminder_plans(&self) -> Result<Vec<Plan>> {
        self.reminder_plans_for(&chrono::Local::now().format("%Y-%m-%d").to_string())
    }
    pub fn reminder_plans_for(&self, today: &str) -> Result<Vec<Plan>> {
        crate::domain::date(today)?;
        let c = self.conn()?;
        let modules = crate::modules::read(&self.root);
        let sql="SELECT r.id,r.date,a.name,r.notes,'保障到期提醒' FROM reminders r JOIN assets a ON a.id=r.entity_id JOIN warranties w ON w.id=r.source_id AND w.asset_id=a.id WHERE r.kind='warranty' AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND r.date<=w.end_date UNION ALL SELECT r.id,r.date,w.name,r.notes,'心愿到期提醒' FROM reminders r JOIN wishlist_items w ON w.id=r.entity_id WHERE r.kind='wishlist' AND ?1 AND w.decision_state='considering' AND w.deleted_at IS NULL UNION ALL SELECT r.id,r.date,v.name,r.notes,'订阅续期提醒' FROM reminders r JOIN virtual_assets v ON v.id=r.entity_id WHERE r.kind='renewal' AND r.repeat_every_period=0 AND ?2 AND v.deleted_at IS NULL AND v.stopped_on IS NULL AND COALESCE((SELECT p.end_date FROM recurring_plans p WHERE p.id=v.plan_id AND p.deleted_at IS NULL),v.expires,'9999-12-31') >= r.date ORDER BY 1";
        let mut plans = c
            .prepare(sql)?
            // A switched-off wishlist or virtual module pauses its reminders;
            // warranties always stay.
            .query_map(
                rusqlite::params![modules.wishlist, modules.virtual_assets],
                |r| {
                    Ok(Plan {
                        id: format!("thingary-{}", r.get::<_, String>(0)?),
                        date: r.get(1)?,
                        title: format!("{} · {}", r.get::<_, String>(4)?, r.get::<_, String>(2)?),
                        body: r.get(3)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if modules.virtual_assets {
            for asset in self.virtual_overview(today)?.items {
                let Some(reminder) = &asset.reminder else {
                    continue;
                };
                let Some(p) = &asset.plan else {
                    continue;
                };
                if !reminder.repeat_every_period
                    || asset.fields.stopped_on.is_some()
                    || asset.fields.billing != "subscription"
                    || !p.fields.auto_renew
                {
                    continue;
                }
                let id: String = c.query_row(
                    "SELECT id FROM reminders WHERE kind='renewal' AND entity_id=?1",
                    [&asset.id],
                    |r| r.get(0),
                )?;
                for due in crate::recurring::subscription_payment_candidates(c, p, today)? {
                    let day = crate::domain::date(&due.due_date)?
                        .checked_sub_days(chrono::Days::new(u64::from(reminder.lead_days)))
                        .ok_or_else(|| Error::new("DATE", "提醒日期超出范围"))?;
                    plans.push(Plan {
                        id: format!("thingary-{id}-{}", due.due_date),
                        date: day.to_string(),
                        title: format!("订阅备款提醒 · {}", asset.fields.name),
                        body: format!(
                            "{} 将于 {} 扣款，请提前备足余额；扣款后在物谱确认已付。{}",
                            asset.fields.name, due.due_date, reminder.notes
                        ),
                    });
                }
            }
        }
        if modules.wealth {
            plans.extend(self.checkin_reminder_plans()?);
        }
        plans.sort_by(|a, b| a.id.cmp(&b.id));
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
    #[cfg(target_os = "macos")]
    {
        let json = CString::new(json).map_err(|_| Error::new("REMINDER", "提醒内容无效"))?;
        let ptr = unsafe { thingary_notifications(json.as_ptr(), i32::from(ask)) };
        if ptr.is_null() {
            return Err(Error::new("REMINDER", "通知服务不可用"));
        }
        let message = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { thingary_free(ptr.cast()) };
        if message.is_empty() {
            Ok(())
        } else {
            Err(Error::new("REMINDER", &message))
        }
    }
    #[cfg(windows)]
    {
        let identifier = APP_IDENTIFIER
            .get()
            .ok_or_else(|| Error::new("REMINDER", "当前应用身份无法使用系统通知"))?;
        windows_native(identifier, json, ask)
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (json, ask);
        Ok(())
    }
}
#[cfg(windows)]
static APP_IDENTIFIER: OnceLock<String> = OnceLock::new();
/// The installed Start menu shortcut and the notifier must share this identity.
/// Set from the actual Tauri configuration before enabling the reminder worker.
#[cfg(windows)]
pub fn set_app_identifier(identifier: &str) -> Result<()> {
    if identifier.is_empty()
        || identifier.encode_utf16().count() > 128
        || identifier.chars().any(char::is_whitespace)
        || identifier.contains('\0')
    {
        return Err(Error::new("REMINDER", "当前应用身份无法使用系统通知"));
    }
    if let Some(current) = APP_IDENTIFIER.get() {
        if current == identifier {
            return Ok(());
        }
        return Err(Error::new("REMINDER", "通知应用身份已经设置"));
    }
    APP_IDENTIFIER
        .set(identifier.to_owned())
        .map_err(|_| Error::new("REMINDER", "通知应用身份已经设置"))
}

#[cfg(any(windows, test))]
fn scheduled_key(id: &str) -> Result<String> {
    use sha2::{Digest, Sha256};
    if !id.starts_with("thingary-") || id.len() <= "thingary-".len() || id.contains('\0') {
        return Err(Error::new("REMINDER", "提醒标识无效"));
    }
    // Stay below the documented 16-character Id ceiling: Windows 11 build
    // 26200 rejected a 16-character ASCII Id with WPN_E_DEV_ID_SIZE. Keep all
    // 56 digest bits and retain the complete business ID in the toast XML.
    // https://learn.microsoft.com/uwp/api/windows.ui.notifications.scheduledtoastnotification.id
    let hash = Sha256::digest(id.as_bytes());
    Ok(format!(
        "t{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6]
    ))
}

/// Short-delay acceptance reminders keep their first deadline throughout this
/// process, including after delivery. Status polling must not postpone or rearm
/// an unchanged plan. A new process starts a new explicit acceptance session;
/// the read-only driver `inspect` never calls this clock or changes the queue.
#[cfg(any(test, all(windows, feature = "fault-injection")))]
#[derive(Default)]
struct AcceptanceDeadlines {
    plans: std::collections::BTreeMap<String, (String, i64, i64)>,
}
#[cfg(any(test, all(windows, feature = "fault-injection")))]
impl AcceptanceDeadlines {
    fn reconcile(
        &mut self,
        plans: &[Plan],
        seconds: i64,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<std::collections::BTreeMap<String, i64>> {
        if !(10..=600).contains(&seconds) {
            return Err(Error::new("REMINDER", "验收提醒秒数必须在 10 至 600 之间"));
        }
        let mut next = std::collections::BTreeMap::new();
        let mut deadlines = std::collections::BTreeMap::new();
        for plan in plans {
            let fingerprint = serde_json::to_string(plan)?;
            let deadline = match self.plans.get(&plan.id) {
                Some((previous, delay, deadline))
                    if previous == &fingerprint && *delay == seconds =>
                {
                    *deadline
                }
                _ => filetime(now + chrono::Duration::seconds(seconds))?,
            };
            deadlines.insert(plan.id.clone(), deadline);
            next.insert(plan.id.clone(), (fingerprint, seconds, deadline));
        }
        // Removing a reminder also removes its deadline, so a later re-add is new.
        self.plans = next;
        Ok(deadlines)
    }
}
#[cfg(all(windows, feature = "fault-injection"))]
static ACCEPTANCE_DEADLINES: Mutex<AcceptanceDeadlines> = Mutex::new(AcceptanceDeadlines {
    plans: std::collections::BTreeMap::new(),
});

#[cfg(any(windows, test))]
fn xml_text(text: &str) -> Result<String> {
    let mut result = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '\"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            '\t' | '\n' | '\r' => result.push(c),
            c if c >= '\u{20}' && c != '\u{fffe}' && c != '\u{ffff}' => result.push(c),
            _ => return Err(Error::new("REMINDER", "提醒内容含有无效字符")),
        }
    }
    Ok(result)
}

#[cfg(any(windows, test))]
fn toast_xml(plan: &Plan) -> Result<String> {
    Ok(format!(
        "<toast launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        xml_text(&plan.id)?, xml_text(&plan.title)?, xml_text(&plan.body)?
    ))
}

#[cfg(any(windows, test))]
fn filetime(utc: chrono::DateTime<chrono::Utc>) -> Result<i64> {
    // WinRT DateTime uses signed 100 ns intervals since 1601-01-01 UTC.
    utc.timestamp()
        .checked_add(11_644_473_600)
        .and_then(|seconds| seconds.checked_mul(10_000_000))
        .and_then(|ticks| ticks.checked_add(i64::from(utc.timestamp_subsec_nanos() / 100)))
        .filter(|ticks| *ticks >= 0)
        .ok_or_else(|| Error::new("REMINDER", "提醒日期超出系统范围"))
}

#[cfg(any(windows, test))]
fn local_nine<T: chrono::TimeZone>(date: &str, timezone: &T) -> Result<i64> {
    use chrono::Datelike;
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .filter(|day| {
            day.format("%Y-%m-%d").to_string() == date && (1601..=9999).contains(&day.year())
        })
        .ok_or_else(|| Error::new("REMINDER", "提醒日期无效"))?;
    // Resolve the local calendar time for this date, so the date's DST offset
    // is used instead of today's offset. Reject nonexistent/ambiguous times.
    let utc = timezone
        .from_local_datetime(&day.and_hms_opt(9, 0, 0).unwrap())
        .single()
        .ok_or_else(|| Error::new("REMINDER", "提醒日期在本地时区无效或存在歧义"))?
        .with_timezone(&chrono::Utc);
    filetime(utc)
}

#[cfg(any(windows, test))]
fn reminder_keys(plans: &[Plan]) -> Result<std::collections::BTreeMap<String, &Plan>> {
    let mut keys = std::collections::BTreeMap::new();
    for plan in plans {
        let key = scheduled_key(&plan.id)?;
        if keys.insert(key, plan).is_some() {
            return Err(Error::new("REMINDER", "提醒标识重复或系统短标识冲突"));
        }
    }
    Ok(keys)
}

#[cfg(any(windows, test))]
fn keep_scheduled(
    group: &str,
    id: &str,
    time: i64,
    xml: &str,
    wanted: &std::collections::BTreeMap<String, (i64, String)>,
    kept: &mut std::collections::BTreeSet<String>,
) -> bool {
    group != "thingary"
        || (wanted.get(id).is_some_and(|(t, x)| *t == time && x == xml)
            && kept.insert(id.to_owned()))
}

#[cfg(windows)]
struct NotificationApartment(String);
#[cfg(windows)]
thread_local! {
    // Activation factories cached by windows-core outlive an individual call.
    // Keep WinRT initialized for the actual notification worker, CLI or test
    // thread, balancing initialization only when that thread terminates.
    static NOTIFICATION_APARTMENT: std::cell::RefCell<Option<NotificationApartment>> = const {
        std::cell::RefCell::new(None)
    };
}
#[cfg(windows)]
impl NotificationApartment {
    fn ensure(identifier: &str) -> Result<()> {
        NOTIFICATION_APARTMENT.with(|slot| {
            let mut apartment = slot.borrow_mut();
            if apartment.is_some() {
                notification_trace(identifier, "RoInitialize reuse thread apartment");
                return Ok(());
            }
            notification_trace(identifier, "RoInitialize begin");
            unsafe {
                windows::Win32::System::WinRT::RoInitialize(
                    windows::Win32::System::WinRT::RO_INIT_MULTITHREADED,
                )
            }
            .map_err(|_| Error::new("REMINDER", "无法初始化 Windows 通知服务"))?;
            *apartment = Some(Self(identifier.to_owned()));
            notification_trace(
                identifier,
                "RoInitialize complete; retained for thread lifetime",
            );
            Ok(())
        })
    }
}
#[cfg(windows)]
impl Drop for NotificationApartment {
    fn drop(&mut self) {
        // RoUninitialize unloads thread DLLs and closes RPC connections. Never
        // perform it between uses of a cached WinRT activation factory.
        // https://learn.microsoft.com/windows/win32/api/roapi/nf-roapi-rouninitialize
        notification_trace(&self.0, "thread ending; RoUninitialize begin");
        unsafe { windows::Win32::System::WinRT::RoUninitialize() };
        notification_trace(&self.0, "thread ending; RoUninitialize complete");
    }
}

#[cfg(windows)]
fn notification_trace(_identifier: &str, _stage: &str) {
    #[cfg(feature = "fault-injection")]
    if is_windows_acceptance_identity(_identifier) {
        // Only fictional acceptance emits API boundaries. In particular, this
        // leaves the last completed call visible when the OS terminates the
        // process with a native exception instead of returning an HRESULT.
        eprintln!("[thingary notification acceptance] {_stage}");
    }
}

#[cfg(windows)]
fn notification_error(error: windows::core::Error) -> Error {
    Error::new(
        "REMINDER",
        &format!(
            "提醒尚未安排成功（Windows {:08X}）；请确认已安装物谱并重试",
            error.code().0 as u32
        ),
    )
}

#[cfg(windows)]
fn notification_stage(stage: &str, error: windows::core::Error) -> Error {
    // Preserve a useful boundary in CI and diagnostic stderr without exposing
    // internal API names in the user-facing reminder notice.
    eprintln!("[thingary notifications] {stage}: {error}");
    notification_error(error)
}

#[cfg(windows)]
fn windows_notifier(
    identifier: &str,
) -> Result<(
    windows::UI::Notifications::ToastNotifier,
    windows::UI::Notifications::NotificationSetting,
)> {
    use windows::{core::HSTRING, UI::Notifications::ToastNotificationManager};
    notification_trace(identifier, "CreateToastNotifierWithId begin");
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(identifier))
        .map_err(|error| notification_stage("CreateToastNotifierWithId", error))?;
    notification_trace(
        identifier,
        "CreateToastNotifierWithId complete; Setting begin",
    );
    let setting = match notifier.Setting() {
        Ok(setting) => setting,
        Err(error) if error.code().0 as u32 == 0x80070490 => {
            // Unpackaged Win32 apps must send once before Setting/scheduling.
            // Follow Microsoft's suppressed, expiring bootstrap pattern; the
            // installed shortcut supplies the actual application's AUMID.
            // https://github.com/CommunityToolkit/WindowsCommunityToolkit/blob/41c9964cf90f53317e55218fb3a275a3ae98365c/Microsoft.Toolkit.Uwp.Notifications/Toasts/Compat/ToastNotificationManagerCompat.cs#L576-L594
            initialize_notification_identity(identifier, &notifier)?;
            notifier
                .Setting()
                .map_err(|error| notification_stage("Setting after bootstrap", error))?
        }
        Err(error) => return Err(notification_stage("Setting", error)),
    };
    notification_trace(identifier, "Setting complete");
    Ok((notifier, setting))
}

#[cfg(windows)]
fn windows_scheduled(
    identifier: &str,
    notifier: &windows::UI::Notifications::ToastNotifier,
) -> Result<Vec<windows::UI::Notifications::ScheduledToastNotification>> {
    notification_trace(identifier, "GetScheduledToastNotifications begin");
    let items = match notifier.GetScheduledToastNotifications() {
        Ok(items) => items,
        Err(error) if error.code().0 as u32 == 0x80070490 => {
            // First-use state may be absent for the schedule even if Setting
            // succeeded. Initialize only for that HRESULT, then retry once.
            initialize_notification_identity(identifier, notifier)?;
            notifier.GetScheduledToastNotifications().map_err(|error| {
                notification_stage("GetScheduledToastNotifications after bootstrap", error)
            })?
        }
        Err(error) => {
            return Err(notification_stage("GetScheduledToastNotifications", error));
        }
    };
    notification_trace(
        identifier,
        "GetScheduledToastNotifications complete; enumerate begin",
    );
    let result = items.into_iter().collect();
    notification_trace(identifier, "schedule enumerate complete");
    Ok(result)
}

#[cfg(windows)]
fn initialize_notification_identity(
    identifier: &str,
    notifier: &windows::UI::Notifications::ToastNotifier,
) -> Result<()> {
    use windows::{
        core::{Interface, HSTRING},
        Data::Xml::Dom::XmlDocument,
        Foundation::{DateTime, IReference, PropertyValue},
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    notification_trace(identifier, "bootstrap begin");
    const TAG: &str = "tgbootstrap";
    const GROUP: &str = "thingary-init";
    let document =
        XmlDocument::new().map_err(|error| notification_stage("bootstrap XmlDocument", error))?;
    document
        .LoadXml(&HSTRING::from(
            "<toast><visual><binding template=\"ToastGeneric\"><text>物谱通知服务</text></binding></visual><audio silent=\"true\"/></toast>",
        ))
        .map_err(|error| notification_stage("bootstrap LoadXml", error))?;
    let toast = ToastNotification::CreateToastNotification(&document)
        .map_err(|error| notification_stage("bootstrap CreateToastNotification", error))?;
    toast
        .SetSuppressPopup(true)
        .map_err(|error| notification_stage("bootstrap SetSuppressPopup", error))?;
    toast
        .SetTag(&HSTRING::from(TAG))
        .map_err(|error| notification_stage("bootstrap SetTag", error))?;
    toast
        .SetGroup(&HSTRING::from(GROUP))
        .map_err(|error| notification_stage("bootstrap SetGroup", error))?;
    let expiry = PropertyValue::CreateDateTime(DateTime {
        UniversalTime: filetime(chrono::Utc::now() + chrono::Duration::seconds(15))?,
    })
    .and_then(|value| value.cast::<IReference<DateTime>>())
    .map_err(|error| notification_stage("bootstrap expiration value", error))?;
    toast
        .SetExpirationTime(&expiry)
        .map_err(|error| notification_stage("bootstrap SetExpirationTime", error))?;
    notification_trace(identifier, "bootstrap Show begin");
    notifier
        .Show(&toast)
        .map_err(|error| notification_stage("bootstrap Show", error))?;
    notification_trace(identifier, "bootstrap Show complete; history cleanup begin");
    // Delete only this short-lived bootstrap entry, never any user's reminders.
    ToastNotificationManager::History()
        .map_err(|error| notification_stage("bootstrap History", error))?
        .RemoveGroupedTagWithId(
            &HSTRING::from(TAG),
            &HSTRING::from(GROUP),
            &HSTRING::from(identifier),
        )
        .map_err(|error| notification_stage("bootstrap RemoveGroupedTagWithId", error))?;
    Ok(())
}

#[cfg(windows)]
fn windows_native(identifier: &str, json: &str, ask: bool) -> Result<()> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Foundation::DateTime,
        UI::Notifications::{NotificationSetting, ScheduledToastNotification},
    };
    NotificationApartment::ensure(identifier)?;
    let (notifier, setting) = windows_notifier(identifier)?;
    let enabled = setting == NotificationSetting::Enabled;
    let disabled = || {
        Error::new(
            "REMINDER",
            "通知未开启；提醒日期已保存，请在 Windows 设置 › 系统 › 通知 中允许物谱通知",
        )
    };
    if ask {
        return if enabled { Ok(()) } else { Err(disabled()) };
    }
    let plans: Vec<Plan> =
        serde_json::from_str(json).map_err(|_| Error::new("REMINDER", "提醒计划无效"))?;
    let keys = reminder_keys(&plans)?;
    let now = chrono::Utc::now();
    let now_ticks = filetime(now)?;
    #[cfg(feature = "fault-injection")]
    let acceptance_deadlines = if is_windows_acceptance_identity(identifier) {
        match std::env::var("THINGARY_REMINDER_TEST_SECONDS") {
            Ok(seconds) => {
                let seconds = seconds
                    .parse::<i64>()
                    .ok()
                    .filter(|s| (10..=600).contains(s))
                    .ok_or_else(|| Error::new("REMINDER", "验收提醒秒数必须在 10 至 600 之间"))?;
                Some(
                    ACCEPTANCE_DEADLINES
                        .lock()
                        .map_err(|_| {
                            Error::new("REMINDER", "Acceptance reminder clock unavailable")
                        })?
                        .reconcile(&plans, seconds, now)?,
                )
            }
            Err(_) => None,
        }
    } else {
        None
    };
    let mut wanted = std::collections::BTreeMap::new();
    for (key, plan) in keys {
        notification_trace(identifier, "local_nine begin");
        let ticks = local_nine(&plan.date, &chrono::Local)?;
        notification_trace(identifier, "local_nine complete");
        #[cfg(feature = "fault-injection")]
        let ticks = acceptance_deadlines
            .as_ref()
            .and_then(|deadlines| deadlines.get(&plan.id))
            .copied()
            .unwrap_or(ticks);
        if ticks <= now_ticks {
            continue;
        }
        notification_trace(identifier, "plan XmlDocument begin");
        let document = XmlDocument::new().map_err(notification_error)?;
        notification_trace(identifier, "plan XmlDocument complete; LoadXml begin");
        document
            .LoadXml(&HSTRING::from(toast_xml(plan)?))
            .map_err(notification_error)?;
        notification_trace(identifier, "plan LoadXml complete; GetXml begin");
        // Compare the DOM's canonical serialization on both sides.
        wanted.insert(
            key,
            (
                ticks,
                document.GetXml().map_err(notification_error)?.to_string(),
            ),
        );
    }
    notification_trace(identifier, "wanted plans serialized");
    let mut kept = std::collections::BTreeSet::new();
    let existing = windows_scheduled(identifier, &notifier)?;
    for item in existing {
        notification_trace(identifier, "existing schedule properties begin");
        let group = item.Group().map_err(notification_error)?.to_string();
        if group != "thingary" {
            continue;
        }
        let id = item.Id().map_err(notification_error)?.to_string();
        let time = item
            .DeliveryTime()
            .map_err(notification_error)?
            .UniversalTime;
        let xml = item
            .Content()
            .map_err(notification_error)?
            .GetXml()
            .map_err(notification_error)?
            .to_string();
        notification_trace(identifier, "existing schedule properties complete");
        if !keep_scheduled(&group, &id, time, &xml, &wanted, &mut kept) {
            notification_trace(identifier, "RemoveFromSchedule begin");
            notifier
                .RemoveFromSchedule(&item)
                .map_err(notification_error)?;
        }
    }
    // Reconciliation still removes cancelled/changed/past entries when
    // notifications are disabled. The stored dates are never modified.
    if !enabled && !plans.is_empty() {
        return Err(disabled());
    }
    for (id, (ticks, xml)) in wanted {
        if kept.contains(&id) {
            continue;
        }
        notification_trace(identifier, "scheduled XmlDocument begin");
        let document = XmlDocument::new().map_err(notification_error)?;
        notification_trace(identifier, "scheduled XmlDocument complete; LoadXml begin");
        document
            .LoadXml(&HSTRING::from(xml))
            .map_err(notification_error)?;
        notification_trace(
            identifier,
            "scheduled LoadXml complete; CreateScheduledToastNotification begin",
        );
        let notification = ScheduledToastNotification::CreateScheduledToastNotification(
            &document,
            DateTime {
                UniversalTime: ticks,
            },
        )
        .map_err(notification_error)?;
        notification_trace(
            identifier,
            "CreateScheduledToastNotification complete; SetId begin",
        );
        notification
            .SetId(&HSTRING::from(id.as_str()))
            .map_err(notification_error)?;
        notification_trace(identifier, "SetId complete; SetGroup begin");
        notification
            .SetGroup(&HSTRING::from("thingary"))
            .map_err(notification_error)?;
        notification_trace(identifier, "SetGroup complete; SetTag begin");
        // Use the same stable identity for pending and delivered notifications.
        // Acceptance exercises this exact production scheduling path.
        notification
            .SetTag(&HSTRING::from(id))
            .map_err(notification_error)?;
        notification_trace(identifier, "SetTag complete; AddToSchedule begin");
        notifier
            .AddToSchedule(&notification)
            .map_err(|error| notification_stage("AddToSchedule", error))?;
        notification_trace(
            identifier,
            "AddToSchedule complete; scheduled objects drop next",
        );
    }
    notification_trace(identifier, "reconciliation complete; COM objects drop next");
    Ok(())
}

#[cfg(all(windows, feature = "fault-injection"))]
fn is_windows_acceptance_identity(identifier: &str) -> bool {
    const BASE: &str = "local.thingary.win.acceptance";
    if identifier == BASE {
        return true;
    }
    identifier
        .strip_prefix(BASE)
        .and_then(|s| s.strip_prefix('.'))
        .is_some_and(|suffix| {
            let first = suffix.as_bytes().first();
            (1..=32).contains(&suffix.len())
                && first.is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                && suffix
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}

/// A narrow isolated-identity driver for installed Windows acceptance builds.
/// Ordinary builds expose neither this API nor the short-delay override.
#[cfg(all(windows, feature = "fault-injection"))]
pub fn windows_notification_acceptance(action: &str, json: &str) -> Result<String> {
    use windows::{core::HSTRING, UI::Notifications::ToastNotificationManager};
    let identity = std::env::var("THINGARY_WINDOWS_ACCEPTANCE_IDENTITY")
        .unwrap_or_else(|_| "local.thingary.win.acceptance".to_owned());
    if !is_windows_acceptance_identity(&identity) {
        return Err(Error::new("REMINDER", "通知验收身份无效"));
    }
    let id = identity.as_str();
    const GROUP: &str = "thingary";
    notification_trace(id, &format!("acceptance action {action} begin"));
    let fixture_tag = scheduled_key("thingary-windows-acceptance")?;
    match action {
        "reconcile" => windows_native(id, json, false)?,
        "permission" => windows_native(id, "[]", true)?,
        "clear" => windows_native(id, "[]", false)?,
        "inspect" => {}
        _ => return Err(Error::new("REMINDER", "未知的通知验收动作")),
    }
    NotificationApartment::ensure(id)?;
    let application_id = HSTRING::from(id);
    let (notifier, _) = windows_notifier(id)?;
    notification_trace(id, "acceptance History begin");
    let history = ToastNotificationManager::History()
        .map_err(|error| notification_stage("acceptance History", error))?;
    if action == "clear" {
        // Never clear all notification history or another application's group.
        // These are the driver and ignored test's two fixed fictional fixtures.
        for fixture in [
            "thingary-windows-acceptance",
            "thingary-windows-acceptance-test",
        ] {
            history
                .RemoveGroupedTagWithId(
                    &HSTRING::from(scheduled_key(fixture)?),
                    &HSTRING::from(GROUP),
                    &application_id,
                )
                .map_err(|error| notification_stage("acceptance RemoveGroupedTagWithId", error))?;
        }
    }
    let mut items = Vec::new();
    for item in windows_scheduled(id, &notifier)? {
        items.push(serde_json::json!({
            "id": item.Id().map_err(notification_error)?.to_string(),
            "tag": item.Tag().map_err(notification_error)?.to_string(),
            "group": item.Group().map_err(notification_error)?.to_string(),
            "ticks": item.DeliveryTime().map_err(notification_error)?.UniversalTime,
            "delivery_utc": chrono::DateTime::from_timestamp(
                item.DeliveryTime().map_err(notification_error)?.UniversalTime.div_euclid(10_000_000) - 11_644_473_600,
                (item.DeliveryTime().map_err(notification_error)?.UniversalTime.rem_euclid(10_000_000) * 100) as u32,
            ).map(|time| time.to_rfc3339()),
            "xml": item.Content().map_err(notification_error)?.GetXml().map_err(notification_error)?.to_string(),
        }));
    }
    notification_trace(id, "acceptance schedule inspected; GetHistoryWithId begin");
    let mut delivered = Vec::new();
    let mut owned_history = Vec::new();
    for item in history
        .GetHistoryWithId(&application_id)
        .map_err(|error| notification_stage("acceptance GetHistoryWithId", error))?
    {
        let group = item.Group().map_err(notification_error)?.to_string();
        let tag = item.Tag().map_err(notification_error)?.to_string();
        if group == GROUP {
            let entry = serde_json::json!({
                "tag": tag,
                "group": group,
                "xml": item.Content().map_err(notification_error)?
                    .GetXml().map_err(notification_error)?.to_string(),
            });
            if tag == fixture_tag {
                delivered.push(entry.clone());
            }
            owned_history.push(entry);
        }
    }
    notification_trace(id, "acceptance history inspected; COM objects drop next");
    Ok(serde_json::json!({
        "identifier": id,
        "fixture_group": GROUP,
        "fixture_tag": fixture_tag,
        "observed_at": chrono::Utc::now().to_rfc3339(),
        "scheduled": items,
        "history": delivered,
        "owned_history": owned_history,
        "visible_desktop_toast_verified": false,
    })
    .to_string())
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
    done: Option<mpsc::SyncSender<std::result::Result<(), String>>>,
}
/// Every plan reaches the notification center through this one thread. The
/// center can take seconds to answer, so it never runs on the storage worker,
/// and a snapshot older than one already seen is never applied.
fn enqueue(request: Request) -> bool {
    static QUEUE: OnceLock<Mutex<mpsc::Sender<Request>>> = OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Request>();
        let spawned = std::thread::Builder::new()
            .name("thingary-reminders".into())
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
                    let result = latest
                        .as_ref()
                        .map_or(Ok(()), |plan| apply(&plan.json, force));
                    for done in waiting {
                        let _ = done.send(result.clone());
                    }
                }
            });
        if spawned.is_err() {
            if let Ok(mut last) = LAST.lock() {
                last.1 = "提醒服务未能启动，请重启物谱".into();
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
/// Waits outside the storage/UI threads for this request's actual result.
/// The exit coordinator owns the bounded wait and cancellation policy.
#[cfg(any(windows, test))]
pub fn flush_for_exit(snapshot: Snapshot) -> Result<()> {
    let (done, finished) = mpsc::sync_channel(1);
    if !enqueue(Request {
        snapshot,
        force: true,
        done: Some(done),
    }) {
        return Err(Error::new("REMINDER", "提醒服务未能接收退出检查"));
    }
    finished
        .recv()
        .map_err(|_| Error::new("REMINDER", "提醒检查未完成"))?
        .map_err(|message| Error::new("REMINDER", &message))
}
/// The returned result belongs to this batch, never to a later global status read.
fn apply(json: &str, force: bool) -> std::result::Result<(), String> {
    let mut last = LAST.lock().map_err(|_| "提醒状态不可用".to_owned())?;
    apply_result(&mut last, json, force, |json| native(json, false))
}
fn apply_result(
    last: &mut (String, String),
    json: &str,
    force: bool,
    native: impl FnOnce(&str) -> Result<()>,
) -> std::result::Result<(), String> {
    if !force && last.0 == json {
        return Ok(());
    }
    match native(json) {
        Ok(()) => {
            last.0 = json.to_owned();
            last.1.clear();
            Ok(())
        }
        Err(error) => {
            last.0.clear();
            last.1 = error.message.clone();
            Err(error.message)
        }
    }
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
        let stale_json =
            r#"[{"id":"thingary-cancelled","date":"2099-01-01","title":"t","body":""}]"#;
        let stale = Snapshot::new(stale_json.into());
        let newer = Snapshot::new("[]".into());
        schedule(newer);
        refresh(stale);
        flush_for_exit(Snapshot::new("[]".into())).unwrap();
        let calls = NATIVE_CALLS.lock().unwrap();
        assert!(!calls.is_empty());
        assert!(!calls.iter().any(|c| c == stale_json));
        assert_eq!(LAST.lock().unwrap().0, "[]");
    }
    #[test]
    fn exit_ack_preserves_native_failure_and_unchanged_success_does_not_call_native() {
        let mut last = (String::new(), String::new());
        let result = apply_result(&mut last, "new", false, |_| {
            Err(Error::new("REMINDER", "disabled"))
        });
        assert_eq!(result, Err("disabled".into()));
        assert!(last.0.is_empty());
        assert_eq!(apply_result(&mut last, "new", false, |_| Ok(())), Ok(()));
        assert_eq!(
            apply_result(&mut last, "new", false, |_| panic!("already scheduled")),
            Ok(())
        );
        assert_eq!(
            result,
            Err("disabled".into()),
            "later success cannot overwrite earlier ack"
        );
        assert_eq!(
            apply_result(&mut last, "new", true, |_| Err(Error::new(
                "REMINDER",
                "permission changed"
            ))),
            Err("permission changed".into()),
            "exit flush must check even unchanged plans"
        );
    }
    fn plan(id: &str) -> Plan {
        Plan {
            id: id.into(),
            date: "2099-01-01".into(),
            title: "提醒 & <物谱>".into(),
            body: "\"余额\" '未知' 🧾".into(),
        }
    }

    #[test]
    fn acceptance_status_polls_preserve_deadline_even_after_delivery() {
        let now = chrono::DateTime::from_timestamp(1_800_000_000, 0).unwrap();
        let mut clock = AcceptanceDeadlines::default();
        let plans = [plan("thingary-poll")];
        let deadline = filetime(now + chrono::Duration::seconds(120)).unwrap();
        for elapsed in [0, 60, 119, 121, 180, 600] {
            let observation = now + chrono::Duration::seconds(elapsed);
            let deadlines = clock.reconcile(&plans, 120, observation).unwrap();
            assert_eq!(deadlines[&plans[0].id], deadline);
            // windows_native schedules only deadlines strictly after now.
            assert_eq!(deadline > filetime(observation).unwrap(), elapsed < 120);
        }
    }

    #[test]
    fn acceptance_edits_reset_only_changed_plans_and_cancellation_removes_deadline() {
        let now = chrono::DateTime::from_timestamp(1_800_000_000, 0).unwrap();
        let later = now + chrono::Duration::seconds(60);
        let mut clock = AcceptanceDeadlines::default();
        let mut plans = [plan("thingary-edit"), plan("thingary-unchanged")];
        let first = clock.reconcile(&plans, 120, now).unwrap();
        plans[0].body.push_str(" changed");
        let second = clock.reconcile(&plans, 120, later).unwrap();
        assert_eq!(
            second[&plans[0].id],
            filetime(later + chrono::Duration::seconds(120)).unwrap()
        );
        assert_eq!(second[&plans[1].id], first[&plans[1].id]);
        plans[0].date = "2099-01-02".into();
        let latest = later + chrono::Duration::seconds(60);
        let third = clock.reconcile(&plans, 120, latest).unwrap();
        assert_eq!(
            third[&plans[0].id],
            filetime(latest + chrono::Duration::seconds(120)).unwrap()
        );
        assert_eq!(third[&plans[1].id], first[&plans[1].id]);
        clock.reconcile(&plans[1..], 120, latest).unwrap();
        assert!(!clock.plans.contains_key(&plans[0].id));
        let readded_at = latest + chrono::Duration::seconds(30);
        let readded = clock.reconcile(&plans, 120, readded_at).unwrap();
        assert_eq!(
            readded[&plans[0].id],
            filetime(readded_at + chrono::Duration::seconds(120)).unwrap()
        );
        assert_eq!(readded[&plans[1].id], first[&plans[1].id]);
        let changed_delay = clock.reconcile(&plans, 20, latest).unwrap();
        assert_eq!(
            changed_delay[&plans[0].id],
            filetime(latest + chrono::Duration::seconds(20)).unwrap()
        );
        assert!(clock.reconcile(&plans, 9, latest).is_err());
        assert!(clock.reconcile(&plans, 601, latest).is_err());
        assert!(clock.reconcile(&[], 120, latest).unwrap().is_empty());
        assert!(clock.plans.is_empty());
    }

    #[test]
    fn scheduled_ids_are_stable_short_and_unique_for_business_ids() {
        let ids = [
            "thingary-00000000-0000-0000-0000-000000000000",
            "thingary-00000000-0000-0000-0000-000000000000-2099-01-01",
            "thingary-checkin-2099-01-01",
        ];
        let plans: Vec<_> = ids.iter().map(|id| plan(id)).collect();
        assert_eq!(reminder_keys(&plans).unwrap().len(), 3);
        for p in plans {
            let key = scheduled_key(&p.id).unwrap();
            assert_eq!(key.len(), 15);
            assert!(key.starts_with('t'));
            assert!(key.bytes().all(|byte| byte.is_ascii_alphanumeric()));
            assert_eq!(scheduled_key(&p.id).unwrap(), key);
        }
        assert!(reminder_keys(&[plan(ids[0]), plan(ids[0])]).is_err());
        assert!(scheduled_key("unowned").is_err());
        assert_eq!(
            scheduled_key(&format!("thingary-{}", "x".repeat(129)))
                .unwrap()
                .len(),
            15
        );
        assert!(scheduled_key("thingary-").is_err());
    }

    #[test]
    fn toast_text_is_xml_escaped_and_invalid_controls_are_rejected() {
        let p = plan("thingary-test");
        let xml = toast_xml(&p).unwrap();
        assert!(xml.contains("提醒 &amp; &lt;物谱&gt;"));
        assert!(xml.contains("&quot;余额&quot; &apos;未知&apos; 🧾"));
        assert!(xml.contains("launch=\"thingary-test\""));
        assert!(xml_text("bad\0text").is_err());
        assert!(xml_text("bad\u{b}text").is_err());
        assert!(xml_text("bad\u{fffe}text").is_err());
        assert_eq!(xml_text("\t\n\r").unwrap(), "\t\n\r");
    }

    #[test]
    fn calendar_dates_and_filetime_use_local_nine_and_validate_range() {
        use chrono::{FixedOffset, TimeZone, Utc};
        let zone = FixedOffset::east_opt(8 * 3600).unwrap();
        let expected = Utc.with_ymd_and_hms(2028, 2, 29, 1, 0, 0).unwrap();
        assert_eq!(
            local_nine("2028-02-29", &zone).unwrap(),
            filetime(expected).unwrap()
        );
        for day in [
            "2027-02-29",
            "2028-13-01",
            "2028-02-30",
            "2028-2-29",
            "2028-02-29junk",
            "1600-01-01",
            "10000-01-01",
        ] {
            assert!(local_nine(day, &zone).is_err(), "{day}");
        }
        assert_eq!(
            filetime(Utc.with_ymd_and_hms(1601, 1, 1, 0, 0, 0).unwrap()).unwrap(),
            0
        );
        assert_eq!(
            filetime(Utc.with_ymd_and_hms(1970, 1, 1, 0, 0, 0).unwrap()).unwrap(),
            116_444_736_000_000_000
        );
        assert!(filetime(Utc.with_ymd_and_hms(1600, 12, 31, 23, 59, 59).unwrap()).is_err());
    }

    #[test]
    fn local_calendar_conversion_observes_date_offsets_and_rejects_dst_gaps_or_overlap() {
        use chrono::{Datelike, FixedOffset, LocalResult, NaiveDate, NaiveDateTime, TimeZone};
        #[derive(Clone)]
        struct SeasonalZone;
        impl TimeZone for SeasonalZone {
            type Offset = FixedOffset;
            fn from_offset(_: &Self::Offset) -> Self {
                Self
            }
            fn offset_from_local_date(&self, day: &NaiveDate) -> LocalResult<Self::Offset> {
                let winter = FixedOffset::west_opt(5 * 3600).unwrap();
                let summer = FixedOffset::west_opt(4 * 3600).unwrap();
                match day.month() {
                    3 => LocalResult::None,
                    11 => LocalResult::Ambiguous(summer, winter),
                    4..=10 => LocalResult::Single(summer),
                    _ => LocalResult::Single(winter),
                }
            }
            fn offset_from_local_datetime(
                &self,
                date: &NaiveDateTime,
            ) -> LocalResult<Self::Offset> {
                self.offset_from_local_date(&date.date())
            }
            fn offset_from_utc_date(&self, _: &NaiveDate) -> Self::Offset {
                FixedOffset::west_opt(5 * 3600).unwrap()
            }
            fn offset_from_utc_datetime(&self, _: &NaiveDateTime) -> Self::Offset {
                FixedOffset::west_opt(5 * 3600).unwrap()
            }
        }
        let winter = local_nine("2028-01-01", &SeasonalZone).unwrap();
        let summer = local_nine("2028-07-01", &SeasonalZone).unwrap();
        let utc = chrono::Utc;
        assert_eq!(
            winter - local_nine("2028-01-01", &utc).unwrap(),
            5 * 3600 * 10_000_000
        );
        assert_eq!(
            summer - local_nine("2028-07-01", &utc).unwrap(),
            4 * 3600 * 10_000_000
        );
        assert!(local_nine("2028-03-01", &SeasonalZone).is_err());
        assert!(local_nine("2028-11-01", &SeasonalZone).is_err());
    }

    #[test]
    fn reconciliation_keeps_one_matching_item_and_removes_stale_changed_or_duplicate_items() {
        let wanted =
            std::collections::BTreeMap::from([("tg00000000000000".into(), (123, "xml".into()))]);
        let mut kept = std::collections::BTreeSet::new();
        assert!(keep_scheduled(
            "another-app",
            "anything",
            1,
            "",
            &wanted,
            &mut kept
        ));
        assert!(kept.is_empty());
        assert!(!keep_scheduled(
            "thingary", "stale", 1, "", &wanted, &mut kept
        ));
        assert!(!keep_scheduled(
            "thingary",
            "tg00000000000000",
            122,
            "xml",
            &wanted,
            &mut kept
        ));
        assert!(!keep_scheduled(
            "thingary",
            "tg00000000000000",
            123,
            "changed",
            &wanted,
            &mut kept
        ));
        assert!(keep_scheduled(
            "thingary",
            "tg00000000000000",
            123,
            "xml",
            &wanted,
            &mut kept
        ));
        assert!(!keep_scheduled(
            "thingary",
            "tg00000000000000",
            123,
            "xml",
            &wanted,
            &mut kept
        ));
    }

    #[cfg(all(windows, feature = "fault-injection"))]
    #[test]
    #[ignore = "requires the installed local.thingary.win.acceptance shortcut; uses its real system schedule"]
    fn installed_windows_identity_reconciles_system_schedule() {
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = windows_notification_acceptance("clear", "[]");
            }
        }
        windows_notification_acceptance("permission", "[]").unwrap();
        windows_notification_acceptance("clear", "[]").unwrap();
        let _cleanup = Cleanup;
        let day = chrono::Local::now()
            .date_naive()
            .checked_add_days(chrono::Days::new(1))
            .unwrap();
        let mut fixture = plan("thingary-windows-acceptance-test");
        fixture.date = day.to_string();
        // Observe the actual setter boundary without scheduling probe toasts.
        // Do not require 16 to fail: a later Windows build may fix its ceiling.
        {
            use windows::{
                core::HSTRING, Data::Xml::Dom::XmlDocument, Foundation::DateTime,
                UI::Notifications::ScheduledToastNotification,
            };
            let document = XmlDocument::new().unwrap();
            document
                .LoadXml(&HSTRING::from(toast_xml(&fixture).unwrap()))
                .unwrap();
            for length in [15, 16] {
                let notification = ScheduledToastNotification::CreateScheduledToastNotification(
                    &document,
                    DateTime {
                        UniversalTime: local_nine(&fixture.date, &chrono::Local).unwrap(),
                    },
                )
                .unwrap();
                let result = notification.SetId(&HSTRING::from("t".repeat(length)));
                eprintln!("[thingary notification acceptance] SetId ASCII boundary length={length} HRESULT={:08X}",
                    result.as_ref().err().map_or(0, |error| error.code().0 as u32));
                if length == 15 {
                    result.unwrap();
                }
            }
        }
        let json = serde_json::to_string(&vec![fixture]).unwrap();
        let count = |result: String| {
            let value: serde_json::Value = serde_json::from_str(&result).unwrap();
            assert_eq!(
                value["identifier"],
                std::env::var("THINGARY_WINDOWS_ACCEPTANCE_IDENTITY")
                    .unwrap_or_else(|_| "local.thingary.win.acceptance".to_owned())
            );
            let owned: Vec<_> = value["scheduled"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|item| item["group"] == "thingary")
                .collect();
            for item in &owned {
                assert_eq!(item["tag"], item["id"], "FI schedule/history correlation");
            }
            owned.len()
        };
        struct DelayEnvironment(Option<std::ffi::OsString>);
        impl Drop for DelayEnvironment {
            fn drop(&mut self) {
                match &self.0 {
                    Some(value) => std::env::set_var("THINGARY_REMINDER_TEST_SECONDS", value),
                    None => std::env::remove_var("THINGARY_REMINDER_TEST_SECONDS"),
                }
            }
        }
        let _delay = DelayEnvironment(std::env::var_os("THINGARY_REMINDER_TEST_SECONDS"));
        std::env::set_var("THINGARY_REMINDER_TEST_SECONDS", "120");
        let first = windows_notification_acceptance("reconcile", &json).unwrap();
        let repeated = windows_notification_acceptance("reconcile", &json).unwrap();
        assert_eq!(count(first.clone()), 1);
        assert_eq!(count(repeated.clone()), 1);
        let first: serde_json::Value = serde_json::from_str(&first).unwrap();
        let repeated: serde_json::Value = serde_json::from_str(&repeated).unwrap();
        let fixture_key = scheduled_key("thingary-windows-acceptance-test").unwrap();
        let fixture_deadline = |value: &serde_json::Value| {
            let matching: Vec<_> = value["scheduled"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|item| {
                    item["group"] == "thingary"
                        && item["id"] == fixture_key
                        && item["tag"] == fixture_key
                })
                .collect();
            assert_eq!(
                matching.len(),
                1,
                "exact installed fixture must be present once"
            );
            matching[0]["ticks"].as_i64().unwrap()
        };
        assert_eq!(
            fixture_deadline(&first),
            fixture_deadline(&repeated),
            "status refresh must not postpone the short-delay reminder"
        );
        assert_eq!(
            count(windows_notification_acceptance("inspect", "[]").unwrap()),
            1
        );
        assert_eq!(
            count(windows_notification_acceptance("clear", "[]").unwrap()),
            0
        );
    }
}

#[cfg(all(test, windows, feature = "fault-injection"))]
#[test]
fn windows_acceptance_identity_rejects_nonisolated_and_malformed_ids() {
    for id in [
        "local.thingary.win.acceptance",
        "local.thingary.win.acceptance.run-20261016a",
    ] {
        assert!(is_windows_acceptance_identity(id));
    }
    for id in [
        "local.thingary.main",
        "local.thingary.preview",
        "local.thingary.win.acceptance.",
        "local.thingary.win.acceptance.A",
        "local.thingary.win.acceptance.a.b",
        "local.thingary.win.acceptance.-a",
        "local.thingary.win.acceptance.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ] {
        assert!(!is_windows_acceptance_identity(id));
    }
}
