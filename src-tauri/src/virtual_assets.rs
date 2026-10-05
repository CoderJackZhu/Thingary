//! Virtual assets (ADR-001 §21 + VIRTUAL_ASSET_BILLING_DESIGN): licenses,
//! domains, subscriptions and stored-value accounts. Status and validity are
//! derived on read (X-D14). A linked recurring plan is the source of confirmed
//! cost, service arrangement and paid coverage; topup facts are the only spend
//! source of a stored-value account. Billing modes (`single`, `subscription`,
//! `topup`) are independent of the legacy `kind` business type.
use crate::{
    domain::{cents, date, Error, Result},
    recurring::{
        enrich_plan, period_ends, plan, receipt, save_plan, save_special_end, Plan, PlanFields,
    },
    storage::{digest, uid, Store},
};
use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const KINDS: [&str; 4] = ["license", "domain", "subscription", "general"];
pub const BILLINGS: [&str; 3] = ["single", "subscription", "topup"];
/// Manually entered expiry: warn a month ahead. A linked plan already tracks
/// its renewal, so it uses the recurring page's seven days (X-D11); a monthly
/// subscription would otherwise always read as expiring.
const EXPIRING_DAYS: i64 = 30;
const LINKED_EXPIRING_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fields {
    pub name: String,
    /// Legacy business type; `general` for archives created since schema 22.
    pub kind: String,
    /// How spend is counted: `single`, `subscription` or `topup`.
    pub billing: String,
    /// One optional virtual label; the ID lives in `named_choices`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_id: Option<String>,
    /// Optional payment-method remark; never a payment account (design §1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pay_method: Option<String>,
    /// `true` marks a single purchase explicitly valid forever; an empty
    /// expiry without it stays "not set" (design §3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perpetual: Option<bool>,
    pub provider: String,
    pub purchase_date: Option<String>,
    /// One-time price; only in `single` billing.
    pub price_cents: Option<String>,
    /// Valid until / stored-value expiry; only without a linked plan.
    /// Empty on a license = perpetual; empty on a topup = not set.
    pub expires: Option<String>,
    pub plan_id: Option<String>,
    pub url: String,
    pub notes: String,
    pub stopped_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedPlanSave {
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: PlanFields,
}

/// First topup of a new stored-value account, saved in the same transaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopupFields {
    pub topup_date: Option<String>,
    pub paid_cents: Option<String>,
    pub gift_cents: Option<String>,
    pub credit_cents: Option<String>,
    pub pay_method: String,
    pub notes: String,
}

/// Special coverage end of one period, named by its actual start (design §4.5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialEnd {
    pub period_start: String,
    /// `None` removes the override for that period.
    pub coverage_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Save {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<LinkedPlanSave>,
    /// Future renewal price segment; `Some(empty)` clears pending future rates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renewal_price_cents: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renewal_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub special_end: Option<SpecialEnd>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_topup: Option<TopupFields>,
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
}

#[derive(Debug, Clone, Serialize)]
pub struct VirtualAsset {
    /// Number of recorded paid periods; estimates never create payment facts.
    pub paid_count: i64,
    pub paid_until: Option<String>,
    pub plan: Option<Plan>,
    pub id: String,
    pub fields: Fields,
    pub revision: i64,
    /// Name of the linked plan while it is live.
    pub plan_name: Option<String>,
    /// Linked plan is in Recently Deleted: no validity or cost from it.
    pub plan_deleted: bool,
    pub valid_until: Option<String>,
    /// `stopped`, `perpetual`, `unknown`, `expired`, `expiring`, `active`,
    /// `ongoing`, `paused` or `future` (service starts after today).
    pub status: String,
    /// Confirmed spending; `None` when the price is unknown.
    pub spent_cents: Option<String>,
    /// Display name of the virtual label, when set.
    pub label_name: Option<String>,
    /// The opt-in renewal reminder settings, when set.
    pub reminder: Option<ReminderState>,
    /// Explicit payment confirmation is independent of service validity.
    pub payment_due: Option<crate::recurring::Due>,
    /// Stored-value facts (topup billing only).
    pub topup_count: i64,
    /// Every live topup, newest first (maintenance list, review R13).
    pub topups: Vec<TopupRecord>,
    /// Known paid topups unknown in date or amount are counted, not summed.
    pub topup_unknown_paid: i64,
    pub topup_known_cents: Option<String>,
    pub topup_credit_cents: Option<String>,
    /// Newest live manual balance record, if any.
    pub balance: Option<BalanceRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReminderState {
    pub date: String,
    pub notes: String,
    pub repeat_every_period: bool,
    pub lead_days: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BalanceRecord {
    pub id: String,
    pub asset_id: String,
    pub balance_cents: String,
    pub recorded_on: String,
    pub notes: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopupRecord {
    pub id: String,
    pub asset_id: String,
    pub fields: TopupFields,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlanChoice {
    pub id: String,
    pub name: String,
    pub interval_months: u32,
    /// The virtual asset already linked to this plan, if any.
    pub linked_to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub generation: String,
    pub today: String,
    pub items: Vec<VirtualAsset>,
    /// Not stopped.
    pub in_use: i64,
    pub expiring: i64,
    pub expired: i64,
    pub spent_cents: String,
    pub unknown_price: i64,
    pub plans: Vec<PlanChoice>,
}

fn text(v: &str, max: usize, code: &str, message: &str) -> Result<()> {
    if v.chars().count() > max || v.contains('\0') {
        return Err(Error::new(code, message));
    }
    Ok(())
}

fn non_negative(v: Option<&str>, code: &str, message: &str) -> Result<Option<i64>> {
    if v.is_none_or(str::is_empty) {
        return Ok(None);
    }
    cents(Some(v.unwrap()))
        .map_err(|_| Error::new(code, message))?
        .map(Some)
        .ok_or_else(|| Error::new(code, message))
}

fn validate_topup(f: &TopupFields, today: &str) -> Result<(Option<i64>, Option<i64>, Option<i64>)> {
    let paid = non_negative(
        f.paid_cents.as_deref(),
        "TOPUP_PAID",
        "实付金额须为 0 或正数",
    )?;
    let gift = non_negative(
        f.gift_cents.as_deref(),
        "TOPUP_GIFT",
        "赠送金额须为 0 或正数",
    )?;
    let credit = non_negative(
        f.credit_cents.as_deref(),
        "TOPUP_CREDIT",
        "到账额度须为 0 或正数",
    )?;
    if paid.is_none() && gift.is_none() && credit.is_none() {
        return Err(Error::new(
            "TOPUP_EMPTY",
            "请至少填写实付、赠送或到账额度中的一项",
        ));
    }
    text(&f.pay_method, 80, "TOPUP_METHOD", "支付方式最多 80 字")?;
    text(
        &f.notes,
        10000,
        "TOPUP_NOTES",
        "备注最多 10000 字，且不能含空字符",
    )?;
    if let Some(d) = &f.topup_date {
        date(d)?;
        if d.as_str() > today {
            return Err(Error::new("TOPUP_DATE", "充值日期不能晚于今天"));
        }
    }
    let credit = credit.or_else(|| {
        (paid.is_some() || gift.is_some()).then(|| paid.unwrap_or(0) + gift.unwrap_or(0))
    });
    if credit.is_some_and(|v| v > 99999999999) {
        return Err(Error::new("TOPUP_CREDIT", "到账额度超出范围"));
    }
    Ok((paid, gift, credit))
}

fn validate(f: &Fields, today: &str) -> Result<Option<i64>> {
    let name = f.name.trim();
    if name.is_empty() {
        return Err(Error::new("VIRTUAL_NAME", "名称须为 1–80 字"));
    }
    text(name, 80, "VIRTUAL_NAME", "名称须为 1–80 字")?;
    text(&f.provider, 80, "VIRTUAL_PROVIDER", "提供方最多 80 字")?;
    text(&f.url, 2000, "VIRTUAL_URL", "链接最多 2000 字")?;
    text(
        &f.notes,
        10000,
        "VIRTUAL_NOTES",
        "备注最多 10000 字，且不能含空字符",
    )?;
    if !KINDS.contains(&f.kind.as_str()) {
        return Err(Error::new("VIRTUAL_KIND", "请选择类型"));
    }
    if !BILLINGS.contains(&f.billing.as_str()) {
        return Err(Error::new("VIRTUAL_BILLING", "请选择计费方式"));
    }
    for d in [&f.purchase_date, &f.expires, &f.stopped_on]
        .into_iter()
        .flatten()
    {
        date(d)?;
    }
    if f.purchase_date.as_deref().is_some_and(|d| d > today) {
        return Err(Error::new("VIRTUAL_DATE", "购买日期不能晚于今天"));
    }
    if let Some(s) = f.stopped_on.as_deref() {
        if s > today {
            return Err(Error::new("VIRTUAL_STOP", "停用日期不能晚于今天"));
        }
        if f.purchase_date.as_deref().is_some_and(|p| s < p) {
            return Err(Error::new("VIRTUAL_STOP", "停用日期不能早于购买日期"));
        }
    }
    if f.plan_id.is_some() {
        if f.billing != "subscription" {
            return Err(Error::new("VIRTUAL_PLAN", "只有订阅计费方式可关联周期计划"));
        }
        if f.kind == "license" {
            return Err(Error::new("VIRTUAL_PLAN", "买断软件不关联周期计划"));
        }
        if f.price_cents.is_some() || f.expires.is_some() {
            return Err(Error::new(
                "VIRTUAL_PLAN",
                "关联计划后，价格和有效期由计划的付款推算，无需填写",
            ));
        }
    }
    if f.billing == "subscription" && f.plan_id.is_none() {
        return Err(Error::new("VIRTUAL_BILLING", "订阅计费需要关联付款计划"));
    }
    if f.billing == "topup" && (f.price_cents.is_some() || f.plan_id.is_some()) {
        return Err(Error::new(
            "VIRTUAL_BILLING",
            "储值档案的价格来自充值记录，不单独填写",
        ));
    }
    if f.perpetual.unwrap_or(false) && (f.billing != "single" || f.expires.is_some()) {
        return Err(Error::new(
            "VIRTUAL_PERPETUAL",
            "永久有效仅用于单次购买且不填写到期日",
        ));
    }
    text(
        f.pay_method.as_deref().unwrap_or(""),
        80,
        "VIRTUAL_METHOD",
        "支付方式最多 80 字",
    )?;
    cents(f.price_cents.as_deref()).map_err(|_| Error::new("VIRTUAL_PRICE", "价格须为金额或留空"))
}

const COLUMNS: &str = "v.id,v.name,v.kind,v.provider,v.purchase_date,v.price_cents,v.expires,v.plan_id,v.url,v.notes,v.stopped_on,v.revision,r.name,r.deleted_at IS NOT NULL,r.interval_months";

struct Row {
    item: VirtualAsset,
    interval: Option<u32>,
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        item: VirtualAsset {
            paid_count: 0,
            id: r.get(0)?,
            fields: Fields {
                name: r.get(1)?,
                kind: r.get(2)?,
                billing: String::new(),
                label_id: None,
                pay_method: None,
                perpetual: None,
                provider: r.get(3)?,
                purchase_date: r.get(4)?,
                price_cents: r.get::<_, Option<i64>>(5)?.map(|v| v.to_string()),
                expires: r.get(6)?,
                plan_id: r.get(7)?,
                url: r.get(8)?,
                notes: r.get(9)?,
                stopped_on: r.get(10)?,
            },
            revision: r.get(11)?,
            plan_name: r.get(12)?,
            plan_deleted: r.get::<_, Option<bool>>(13)?.unwrap_or(false),
            valid_until: None,
            paid_until: None,
            status: String::new(),
            spent_cents: None,
            label_name: None,
            reminder: None,
            payment_due: None,
            topup_count: 0,
            topups: Vec::new(),
            topup_unknown_paid: 0,
            topup_known_cents: None,
            topup_credit_cents: None,
            balance: None,
            plan: None,
        },
        interval: r.get(14)?,
    })
}

/// Fills the derived fields: validity, status and spending.
fn derive(c: &Connection, row: Row, today: NaiveDate) -> Result<VirtualAsset> {
    let mut v = row.item;
    let now = today.format("%Y-%m-%d").to_string();
    // Schema-22 columns live outside the shared COLUMNS projection.
    let (billing, label_id, pay_method, perpetual): (String, Option<String>, String, i64) = c
        .query_row(
            "SELECT billing,label_id,pay_method,perpetual FROM virtual_assets WHERE id=?1",
            [&v.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
    v.fields.billing = billing;
    v.fields.label_id = label_id;
    v.fields.pay_method = Some(pay_method);
    v.fields.perpetual = Some(perpetual != 0);
    let label_name: Option<String> = match &v.fields.label_id {
        Some(l) => c
            .query_row("SELECT name FROM named_choices WHERE id=?1", [l], |r| {
                r.get(0)
            })
            .optional()?
            .flatten(),
        None => None,
    };
    v.label_name = label_name;
    v.reminder = c
        .query_row(
            "SELECT date,notes,repeat_every_period,lead_days FROM reminders WHERE kind='renewal' AND entity_id=?1",
            [&v.id],
            |r| {
                Ok(Some(ReminderState {
                    date: r.get(0)?,
                    notes: r.get(1)?,
                    repeat_every_period: r.get(2)?,
                    lead_days: r.get(3)?,
                }))
            },
        )
        .optional()?
        .flatten();
    let linked = v.fields.plan_id.clone().filter(|_| !v.plan_deleted);
    if v.plan_deleted {
        v.plan_name = None;
    }
    if let (Some(plan_id), Some(_interval)) = (&linked, row.interval) {
        let (last, covered, sum, count): (Option<String>, Option<String>, Option<i64>, i64) = c.query_row(
            "SELECT max(due_date),max(coverage_end),sum(amount_cents),count(*) FROM plan_payments WHERE plan_id=?1 AND state='paid' AND deleted_at IS NULL",
            [plan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        v.paid_count = count;
        let p = plan(c, plan_id)?;
        if let Some(plan) = &p {
            let ends = period_ends(c, plan_id)?;
            let interval = match plan.fields.interval_days {
                Some(n) => n,
                None => plan.fields.interval_months,
            };
            v.valid_until = if covered.is_some() {
                covered
            } else {
                last.map(|d| -> Result<String> {
                    let step = if plan.fields.interval_days.is_some() {
                        NaiveDate::checked_add_days(
                            date(&d)?,
                            chrono::Days::new(u64::from(interval)),
                        )
                    } else {
                        crate::recurring::shift_months(date(&d)?, i64::from(interval))
                    };
                    let end = step
                        .and_then(|x| x.pred_opt())
                        .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
                    Ok(end.format("%Y-%m-%d").to_string())
                })
                .transpose()?
            };
            v.paid_until = v.valid_until.clone();
            let mut plan = plan.clone();
            let today_s = today.to_string();
            let overview_next = crate::recurring::schedule(
                &plan.fields,
                &ends,
                date(&today_s)?.max(date(&plan.active_from)?),
                date(&today_s)?
                    .checked_add_months(chrono::Months::new(12))
                    .unwrap_or(date(&today_s)?),
            )?;
            plan.next_due = None;
            if !plan.fields.paused {
                for due in overview_next {
                    let recorded: bool = c.query_row(
                        "SELECT EXISTS(SELECT 1 FROM plan_payments WHERE plan_id=?1 AND due_date=?2 AND deleted_at IS NULL)",
                        params![plan.id, due.to_string()],
                        |r| r.get(0),
                    )?;
                    if !recorded {
                        plan.next_due = Some(due.to_string());
                        break;
                    }
                }
            }
            enrich_plan(c, &mut plan, &today_s)?;
            // Trial display state rides on the plan fields; nothing to derive.
            v.plan = Some(plan);
        }
        v.spent_cents = Some(sum.unwrap_or(0).to_string());
    } else if v.fields.plan_id.is_none() {
        v.valid_until = v.fields.expires.clone();
        v.spent_cents = v.fields.price_cents.clone();
    }
    if v.fields.billing == "topup" {
        // Topup facts are the only spend source; the legacy price stays empty.
        let (count, unknown, known, credit): (i64, i64, Option<i64>, Option<i64>) = {
            // 到账默认实付＋赠送（R11）：NULL credit 的旧行按默认口径合计。
            let mut q = c.prepare(
                "SELECT paid_cents,gift_cents,credit_cents FROM virtual_topups WHERE asset_id=?1 AND deleted_at IS NULL",
            )?;
            let rows = q
                .query_map([&v.id], |r| {
                    Ok((
                        r.get::<_, Option<i64>>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, Option<i64>>(2)?,
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let mut count = 0i64;
            let mut unknown = 0i64;
            let mut known: Option<i64> = None;
            let mut credit: Option<i64> = None;
            for (paid, gift, cred) in rows {
                count += 1;
                if let Some(p) = paid {
                    known = Some(known.unwrap_or(0).checked_add(p).unwrap_or(i64::MAX));
                } else {
                    unknown += 1;
                }
                let effective = cred.or_else(|| match (paid, gift) {
                    (Some(p), Some(g)) => p.checked_add(g),
                    (Some(p), None) => Some(p),
                    (None, Some(g)) => Some(g),
                    _ => None,
                });
                if let Some(e) = effective {
                    credit = Some(credit.unwrap_or(0).checked_add(e).unwrap_or(i64::MAX));
                }
            }
            (count, unknown, known, credit)
        };
        v.topup_count = count;
        v.topups = topup_records(c, &v.id)?;
        v.topup_unknown_paid = unknown;
        v.topup_known_cents = known.map(|n| n.to_string());
        v.topup_credit_cents = credit.map(|n| n.to_string());
        v.spent_cents = v.topup_known_cents.clone();
        let latest: Option<(String, String, String, String, i64)> = c
            .query_row(
                "SELECT id,balance_cents,recorded_on,notes,revision FROM virtual_balances WHERE asset_id=?1 AND deleted_at IS NULL ORDER BY recorded_on DESC,id DESC LIMIT 1",
                [&v.id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)?.to_string(), r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        v.balance = latest.map(
            |(id, balance_cents, recorded_on, notes, revision)| BalanceRecord {
                id,
                asset_id: v.id.clone(),
                balance_cents,
                recorded_on,
                notes,
                revision,
            },
        );
    }
    if let Some(p) = &v.plan {
        if (p.fields.service_start.is_some() || v.fields.kind == "subscription")
            && p.fields.end_date.is_some()
        {
            v.valid_until = p.fields.end_date.clone();
        }
    }
    let window = if linked.is_some() {
        LINKED_EXPIRING_DAYS
    } else {
        EXPIRING_DAYS
    };
    let soon = (today + Duration::days(window))
        .format("%Y-%m-%d")
        .to_string();
    let not_started = v
        .plan
        .as_ref()
        .and_then(|p| p.fields.service_start.clone())
        .is_some_and(|s| s > now);
    v.status = if not_started && v.fields.stopped_on.is_none() {
        "future".into()
    } else {
        match (&v.fields.stopped_on, &v.valid_until) {
            (Some(_), _) => "stopped",
            (None, None)
                if v.fields.billing == "single"
                    && v.fields.plan_id.is_none()
                    && (v.fields.perpetual.unwrap_or(false) || v.fields.kind == "license") =>
            {
                "perpetual"
            }
            (None, None) if v.fields.kind == "subscription" && v.fields.plan_id.is_none() => {
                "ongoing"
            }
            (None, _)
                if v.plan.as_ref().is_some_and(|p| {
                    (p.fields.service_start.is_some() || v.fields.kind == "subscription")
                        && !p.fields.paused
                        && p.fields.end_date.is_none()
                }) =>
            {
                "ongoing"
            }
            (None, _)
                if v.plan.as_ref().is_some_and(|p| {
                    (p.fields.service_start.is_some() || v.fields.kind == "subscription")
                        && p.fields.paused
                        && p.fields
                            .end_date
                            .as_deref()
                            .is_none_or(|e| e >= now.as_str())
                }) =>
            {
                "paused"
            }
            (None, None) => "unknown",
            (None, Some(u)) if *u < now => "expired",
            (None, Some(u)) if *u <= soon => "expiring",
            _ => "active",
        }
        .into()
    };
    if v.fields.billing == "subscription" && v.fields.stopped_on.is_none() {
        if let Some(p) = &v.plan {
            v.payment_due = crate::recurring::subscription_payment_candidates(c, p, &now)?
                .into_iter()
                .next();
        }
    }
    if let (Some(reminder), Some(due)) = (&mut v.reminder, &v.payment_due) {
        if reminder.repeat_every_period {
            reminder.date = date(&due.due_date)?
                .checked_sub_days(chrono::Days::new(u64::from(reminder.lead_days)))
                .ok_or_else(|| Error::new("DATE", "提醒日期超出范围"))?
                .to_string();
        }
    }
    Ok(v)
}

fn read(c: &Connection, id: Option<&str>, today: NaiveDate) -> Result<Vec<VirtualAsset>> {
    let mut q = c.prepare(&format!("SELECT {COLUMNS} FROM virtual_assets v LEFT JOIN recurring_plans r ON r.id=v.plan_id WHERE v.deleted_at IS NULL AND (?1 IS NULL OR v.id=?1) ORDER BY v.name,v.id"))?;
    let rows = q
        .query_map([id], row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter().map(|r| derive(c, r, today)).collect()
}

fn label_available(c: &Connection, label: &str) -> Result<bool> {
    Ok(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM named_choices WHERE id=?1 AND kind='label')",
        [label],
        |r| r.get(0),
    )?)
}

/// Whether the label may be picked for a virtual asset: its scope must be
/// `virtual` or `both`. Existing labels keep working; the scope table was
/// filled with `physical` by the migration.
fn validate_label_scope(c: &Connection, label: &str) -> Result<()> {
    let scope: Option<String> = c
        .query_row(
            "SELECT scope FROM label_scopes WHERE label_id=?1",
            [label],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    match scope.as_deref() {
        Some("virtual") | Some("both") => Ok(()),
        Some("physical") => Err(Error::new(
            "LABEL_SCOPE",
            "此标签仅用于实物，请在标签管理中改为通用后再选择",
        )),
        _ => Err(Error::new("LABEL", "标签已不可用，请重新选择")),
    }
}

impl Store {
    pub fn virtual_save(&mut self, input: &Save, today: &str) -> Result<VirtualAsset> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let now_day = date(today)?;
        let fingerprint = digest(&serde_json::to_vec(&("virtual_asset", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let one = |c: &Connection, id: &str| -> Result<VirtualAsset> {
            read(c, Some(id), now_day)?
                .pop()
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))
        };
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return one(&tx, &id);
        }
        let mut fields = input.fields.clone();
        let old = input.id.as_deref().map(|id| one(&tx, id)).transpose()?;
        if old.as_ref().map(|v| v.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "这项虚拟资产已变化，请重新读取",
            ));
        }
        // Cross-mode conversion of facts is out of scope (design §8): an
        // existing archive keeps its billing unless the change drops nothing.
        if let Some(o) = &old {
            if o.fields.billing != fields.billing {
                let had_facts = match o.fields.billing.as_str() {
                    "topup" => o.topup_count > 0,
                    "subscription" => o.fields.plan_id.is_some(),
                    _ => o.fields.price_cents.is_some(),
                };
                if had_facts {
                    return Err(Error::new(
                        "VIRTUAL_BILLING",
                        "已有付款或充值事实的档案不能更换计费方式；请保留原方式或新建档案",
                    ));
                }
            }
        }
        let id = input.id.clone().unwrap_or_else(uid);
        if let Some(p) = &input.plan {
            // 新建订阅需要现代服务日期；编辑旧计划按原语义透传，缺
            // service_start 不再阻断档案编辑（review R8）。
            if fields.billing != "subscription"
                || p.fields.category != "subscription"
                || (p.id.is_none() && p.fields.service_start.is_none())
            {
                return Err(Error::new("VIRTUAL_PLAN", "订阅计划需要开始使用日期"));
            }
            if let Some(pid) = &p.id {
                if old.as_ref().and_then(|o| o.fields.plan_id.as_ref()) != Some(pid)
                    && fields.plan_id.as_ref() != Some(pid)
                {
                    return Err(Error::new("VIRTUAL_PLAN", "关联的计划已经变化"));
                }
                let taken: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM virtual_assets WHERE plan_id=?1 AND id!=?2 AND deleted_at IS NULL)",params![pid,id],|r|r.get(0))?;
                if taken {
                    return Err(Error::new("VIRTUAL_PLAN_TAKEN", "此计划已关联其他虚拟资产"));
                }
            }
            let pid = p.id.clone().unwrap_or_else(uid);
            save_plan(
                &tx,
                &pid,
                p.expected_revision,
                &p.fields,
                p.id.is_some(),
                today,
            )?;
            fields.plan_id = Some(pid);
            fields.price_cents = None;
            fields.expires = None;
        }
        let f = &fields;
        let price = validate(f, today)?;
        if let Some(plan_id) = &f.plan_id {
            let live: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM recurring_plans WHERE id=?1 AND deleted_at IS NULL)",
                [plan_id],
                |r| r.get(0),
            )?;
            // A link to a plan now in Recently Deleted may stay as it was.
            let kept = old
                .as_ref()
                .is_some_and(|o| o.fields.plan_id.as_ref() == Some(plan_id));
            if !live && !kept {
                return Err(Error::new("VIRTUAL_PLAN", "找不到这项周期计划"));
            }
            let taken: Option<String> = tx
                .query_row(
                    "SELECT name FROM virtual_assets WHERE plan_id=?1 AND id!=?2 AND deleted_at IS NULL",
                    params![plan_id, id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(name) = taken {
                return Err(Error::new(
                    "VIRTUAL_PLAN_TAKEN",
                    &format!("这项计划已关联「{name}」"),
                ));
            }
        }
        if let Some(label) = &f.label_id {
            if !label_available(&tx, label)? {
                return Err(Error::new("LABEL", "标签已不可用，请重新选择"));
            }
            validate_label_scope(&tx, label)?;
        }
        // Future renewal price: a segment in plan_rates, never a rewrite of
        // history (design §4.5). Empty string clears pending future rates.
        if let Some(plan_id) = f.plan_id.as_deref() {
            if let Some(renewal) = &input.renewal_price_cents {
                if renewal.is_empty() {
                    tx.execute(
                        "DELETE FROM plan_rates WHERE plan_id=?1 AND effective_date>?2",
                        params![plan_id, today],
                    )?;
                } else {
                    let amount = crate::recurring::positive_amount(
                        renewal,
                        "RENEWAL_AMOUNT",
                        "后续续费价格须为正数",
                    )?;
                    let from = input
                        .renewal_from
                        .as_deref()
                        .filter(|d| !d.is_empty())
                        .ok_or_else(|| Error::new("RENEWAL_AMOUNT", "请填写后续价格的生效期"))?;
                    let from = date(from)?;
                    if from <= now_day {
                        return Err(Error::new(
                            "RENEWAL_AMOUNT",
                            "后续价格生效期须晚于今天；本期调价请直接修改每期价格",
                        ));
                    }
                    // The effective date must start a service period of the plan.
                    if let Some(p) = &input.plan {
                        let periods = crate::recurring::periods_for(
                            &tx,
                            &p.fields,
                            plan_id,
                            crate::recurring::period_ends(&tx, plan_id)?,
                        )?;
                        let on_period = (0..=4000)
                            .map(|k| periods.span(k))
                            .take_while(|s| !matches!(s, Ok(None) | Err(_)))
                            .filter_map(|s| s.ok().flatten().map(|(s, _)| s))
                            .take_while(|s| *s <= from)
                            .any(|s| s == from);
                        if !on_period {
                            return Err(Error::new(
                                "RENEWAL_AMOUNT",
                                "生效期须为某一项服务期的开始日",
                            ));
                        }
                    }
                    tx.execute(
                        "INSERT INTO plan_rates(plan_id,effective_date,amount_cents) VALUES(?1,?2,?3) ON CONFLICT(plan_id,effective_date) DO UPDATE SET amount_cents=excluded.amount_cents",
                        params![plan_id, from.to_string(), amount],
                    )?;
                }
            }
        }
        // Special coverage end of one period (design §4.5), same transaction.
        if let Some(special) = &input.special_end {
            if let Some(plan_id) = f.plan_id.as_deref() {
                if let Some(p) = &input.plan {
                    save_special_end(
                        &tx,
                        plan_id,
                        &p.fields,
                        &special.period_start,
                        special.coverage_end.as_deref(),
                        today,
                    )?;
                }
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        let perpetual =
            if f.billing == "single" && f.perpetual.unwrap_or(false) && f.expires.is_none() {
                1
            } else {
                0
            };
        let values = params![
            id,
            f.name.trim(),
            f.kind,
            f.billing,
            f.label_id,
            f.pay_method.as_deref().unwrap_or(""),
            f.provider.trim(),
            f.purchase_date,
            price,
            f.expires,
            f.plan_id,
            f.url.trim(),
            f.notes,
            f.stopped_on,
            perpetual,
            now
        ];
        if old.is_some() {
            tx.execute("UPDATE virtual_assets SET name=?2,kind=?3,billing=?4,label_id=?5,pay_method=?6,provider=?7,purchase_date=?8,price_cents=?9,expires=?10,plan_id=?11,url=?12,notes=?13,stopped_on=?14,perpetual=?15,revision=revision+1,updated_at=?16 WHERE id=?1", values)?;
        } else {
            tx.execute("INSERT INTO virtual_assets(id,name,kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,1,?16,?16)", values)?;
        }
        // First topup rides the same transaction and receipt (design §9).
        if let Some(topup) = &input.first_topup {
            if f.billing != "topup" {
                return Err(Error::new(
                    "VIRTUAL_BILLING",
                    "只有储值档案可以记录首次充值",
                ));
            }
            let (paid, gift, credit) = validate_topup(topup, today)?;
            tx.execute("INSERT INTO virtual_topups(id,asset_id,topup_date,paid_cents,gift_cents,credit_cents,pay_method,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?9)",
                params![uid(), id, topup.topup_date, paid, gift, credit, topup.pay_method.trim(), topup.notes, now])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = one(&tx, &id)?;
        self.hit("virtual.before_commit")?;
        tx.commit()?;
        self.hit("virtual.after_commit")?;
        Ok(result)
    }

    /// Creates or corrects one topup fact. Each topup is its own stable spend
    /// source; the parent archive must be live.
    pub fn virtual_topup_save(&mut self, input: &TopupSave, today: &str) -> Result<TopupRecord> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("virtual_topup", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let read = |c: &Connection, id: &str| -> Result<TopupRecord> {
            topup_records(c, &input.asset_id)?
                .into_iter()
                .find(|t| t.id == id)
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这笔充值"))
        };
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return read(&tx, &id);
        }
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM virtual_assets WHERE id=?1 AND deleted_at IS NULL)",
            [&input.asset_id],
            |r| r.get(0),
        )?;
        if !live {
            return Err(Error::new("NOT_FOUND", "找不到这项虚拟资产"));
        }
        let billing: String = tx.query_row(
            "SELECT billing FROM virtual_assets WHERE id=?1",
            [&input.asset_id],
            |r| r.get(0),
        )?;
        if billing != "topup" {
            return Err(Error::new(
                "VIRTUAL_BILLING",
                "只有储值档案可以记录充值和余额",
            ));
        }

        let old = input.id.as_deref().map(|id| read(&tx, id)).transpose()?;
        if old.as_ref().map(|t| t.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "充值记录已变化，请重新读取",
            ));
        }
        let (paid, gift, credit) = validate_topup(&input.fields, today)?;
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE virtual_topups SET topup_date=?2,paid_cents=?3,gift_cents=?4,credit_cents=?5,pay_method=?6,notes=?7,revision=revision+1,updated_at=?8 WHERE id=?1 AND asset_id=?9",
                params![id, input.fields.topup_date, paid, gift, credit, input.fields.pay_method.trim(), input.fields.notes, now, input.asset_id])?;
        } else {
            tx.execute("INSERT INTO virtual_topups(id,asset_id,topup_date,paid_cents,gift_cents,credit_cents,pay_method,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?9)",
                params![id, input.asset_id, input.fields.topup_date, paid, gift, credit, input.fields.pay_method.trim(), input.fields.notes, now])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = read(&tx, &id)?;
        self.hit("virtual_topup.before_commit")?;
        tx.commit()?;
        self.hit("virtual_topup.after_commit")?;
        Ok(result)
    }

    /// Manual balance check-in (design §6): a dated observation, never derived
    /// from topups and never a spend.
    pub fn virtual_balance_save(
        &mut self,
        input: &BalanceSave,
        today: &str,
    ) -> Result<BalanceRecord> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("virtual_balance", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let read = |c: &Connection, id: &str| -> Result<BalanceRecord> {
            balance_records(c, &input.asset_id)?
                .into_iter()
                .find(|b| b.id == id)
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条余额记录"))
        };
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return read(&tx, &id);
        }
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM virtual_assets WHERE id=?1 AND deleted_at IS NULL)",
            [&input.asset_id],
            |r| r.get(0),
        )?;
        if !live {
            return Err(Error::new("NOT_FOUND", "找不到这项虚拟资产"));
        }
        let billing: String = tx.query_row(
            "SELECT billing FROM virtual_assets WHERE id=?1",
            [&input.asset_id],
            |r| r.get(0),
        )?;
        if billing != "topup" {
            return Err(Error::new(
                "VIRTUAL_BILLING",
                "只有储值档案可以记录充值和余额",
            ));
        }

        let amount = non_negative(
            Some(&input.balance_cents),
            "BALANCE_AMOUNT",
            "剩余额度须为 0 或正数",
        )?
        .ok_or_else(|| Error::new("BALANCE_AMOUNT", "请填写剩余额度"))?;
        date(&input.recorded_on)?;
        if input.recorded_on.as_str() > today {
            return Err(Error::new("BALANCE_DATE", "记录日期不能晚于今天"));
        }
        text(&input.notes, 10000, "BALANCE_NOTES", "备注最多 10000 字")?;
        let old = input.id.as_deref().map(|id| read(&tx, id)).transpose()?;
        if old.as_ref().map(|b| b.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "余额记录已变化，请重新读取",
            ));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE virtual_balances SET balance_cents=?2,recorded_on=?3,notes=?4,revision=revision+1,updated_at=?5 WHERE id=?1 AND asset_id=?6",
                params![id, amount, input.recorded_on, input.notes, now, input.asset_id])?;
        } else {
            tx.execute("INSERT INTO virtual_balances(id,asset_id,balance_cents,recorded_on,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)",
                params![id, input.asset_id, amount, input.recorded_on, input.notes, now])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = read(&tx, &id)?;
        self.hit("virtual_balance.before_commit")?;
        tx.commit()?;
        self.hit("virtual_balance.after_commit")?;
        Ok(result)
    }

    pub fn virtual_reminder_save(
        &mut self,
        input: &ReminderSave,
        today: &str,
    ) -> Result<VirtualAsset> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let now_day = date(today)?;
        let fingerprint = digest(&serde_json::to_vec(&("virtual_reminder", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let one = |c: &Connection, id: &str| -> Result<VirtualAsset> {
            read(c, Some(id), now_day)?
                .pop()
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这项虚拟资产"))
        };
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return one(&tx, &id);
        }
        let asset = one(&tx, &input.asset_id)?;
        if asset.revision != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "这项虚拟资产已变化，请重新读取",
            ));
        }
        if let Some(r) = &input.reminder {
            r.validate()?;
            if input.lead_days > 30 {
                return Err(Error::new("REMINDER", "提前天数须为 0–30 天"));
            }
            if input.repeat_every_period
                && (asset.fields.billing != "subscription"
                    || asset
                        .plan
                        .as_ref()
                        .is_none_or(|p| p.fields.service_start.is_none()))
            {
                return Err(Error::new("REMINDER", "每期备款提醒需要关联订阅计划"));
            }
        }
        tx.execute(
            "DELETE FROM reminders WHERE kind='renewal' AND entity_id=?1",
            [&input.asset_id],
        )?;
        if let Some(r) = &input.reminder {
            tx.execute(
                "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes,repeat_every_period,lead_days) VALUES(?1,'renewal',?2,NULL,?3,?4,?5,?6)",
                params![uid(), input.asset_id, r.date, r.notes, input.repeat_every_period, input.lead_days],
            )?;
        }
        // The reminder state rides the asset revision so stale editors fail.
        tx.execute(
            "UPDATE virtual_assets SET revision=revision+1 WHERE id=?1",
            [&input.asset_id],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.asset_id],
        )?;
        let result = one(&tx, &input.asset_id)?;
        self.hit("virtual_reminder.before_commit")?;
        tx.commit()?;
        self.hit("virtual_reminder.after_commit")?;
        Ok(result)
    }

    pub fn virtual_overview(&self, today: &str) -> Result<Overview> {
        let c = self.conn()?;
        let items = read(c, None, date(today)?)?;
        let count = |s: &str| items.iter().filter(|v| v.status == s).count() as i64;
        let mut spent: i64 = 0;
        for v in &items {
            if let Some(x) = &v.spent_cents {
                spent = spent
                    .checked_add(
                        x.parse()
                            .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?,
                    )
                    .ok_or_else(|| Error::new("VIRTUAL_OVERFLOW", "金额合计超出范围"))?;
            }
        }
        let mut q = c.prepare("SELECT r.id,r.name,r.interval_months,(SELECT v.name FROM virtual_assets v WHERE v.plan_id=r.id AND v.deleted_at IS NULL) FROM recurring_plans r WHERE r.deleted_at IS NULL ORDER BY r.name,r.id")?;
        let plans = q
            .query_map([], |r| {
                Ok(PlanChoice {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    interval_months: r.get(2)?,
                    linked_to: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Overview {
            generation: self.generation(),
            today: today.into(),
            in_use: items
                .iter()
                .filter(|v| v.status != "stopped" && v.status != "expired")
                .count() as i64,
            expiring: count("expiring"),
            expired: count("expired"),
            unknown_price: items.iter().filter(|v| v.spent_cents.is_none()).count() as i64,
            spent_cents: spent.to_string(),
            items,
            plans,
        })
    }
}

fn topup_records(c: &Connection, asset_id: &str) -> Result<Vec<TopupRecord>> {
    let mut q = c.prepare("SELECT id,asset_id,topup_date,paid_cents,gift_cents,credit_cents,pay_method,notes,revision FROM virtual_topups WHERE asset_id=?1 AND deleted_at IS NULL ORDER BY topup_date DESC,id DESC")?;
    let rows = q
        .query_map([asset_id], |r| {
            Ok(TopupRecord {
                id: r.get(0)?,
                asset_id: r.get(1)?,
                fields: TopupFields {
                    topup_date: r.get(2)?,
                    paid_cents: r.get::<_, Option<i64>>(3)?.map(|v| v.to_string()),
                    gift_cents: r.get::<_, Option<i64>>(4)?.map(|v| v.to_string()),
                    credit_cents: r.get::<_, Option<i64>>(5)?.map(|v| v.to_string()),
                    pay_method: r.get(6)?,
                    notes: r.get(7)?,
                },
                revision: r.get(8)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn balance_records(c: &Connection, asset_id: &str) -> Result<Vec<BalanceRecord>> {
    let mut q = c.prepare("SELECT id,asset_id,balance_cents,recorded_on,notes,revision FROM virtual_balances WHERE asset_id=?1 AND deleted_at IS NULL ORDER BY recorded_on DESC,id DESC")?;
    let rows = q
        .query_map([asset_id], |r| {
            Ok(BalanceRecord {
                id: r.get(0)?,
                asset_id: r.get(1)?,
                balance_cents: r.get::<_, i64>(2)?.to_string(),
                recorded_on: r.get(3)?,
                notes: r.get(4)?,
                revision: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopupSave {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: TopupFields,
}

/// Opt-in one-shot renewal reminder (design §7): one row per asset; `None`
/// withdraws it. Stopping, ending, deleting or switching the library cancels
/// the pending notification through the derived reminder plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderSave {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub expected_revision: i64,
    pub reminder: Option<crate::preferences::Reminder>,
    #[serde(default, skip_serializing_if = "reminder_is_single")]
    pub repeat_every_period: bool,
    #[serde(
        default = "reminder_lead_default",
        skip_serializing_if = "reminder_lead_is_default"
    )]
    pub lead_days: u32,
}

// Preserve fingerprints of pre-upgrade pending one-shot requests.
fn reminder_is_single(repeat: &bool) -> bool {
    !repeat
}
fn reminder_lead_is_default(days: &u32) -> bool {
    *days == reminder_lead_default()
}
fn reminder_lead_default() -> u32 {
    3
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceSave {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub balance_cents: String,
    pub recorded_on: String,
    pub notes: String,
}

/// Backup validation for schema 19 data beyond what SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法虚拟资产资料");
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let mut q = c.prepare(&format!(
        "SELECT {COLUMNS} FROM virtual_assets v LEFT JOIN recurring_plans r ON r.id=v.plan_id"
    ))?;
    let rows = q
        .query_map([], row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for r in rows {
        let mut v = r.item;
        if version >= 22 {
            let (billing, label, method, perp): (String, Option<String>, String, i64) = c
                .query_row(
                    "SELECT billing,label_id,pay_method,perpetual FROM virtual_assets WHERE id=?1",
                    [&v.id],
                    |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?, x.get(3)?)),
                )?;
            v.fields.billing = billing;
            v.fields.label_id = label;
            v.fields.pay_method = Some(method);
            v.fields.perpetual = Some(perp != 0);
        } else {
            v.fields.billing = if v.fields.plan_id.is_some() {
                "subscription".into()
            } else {
                "single".into()
            };
        }
        if uuid::Uuid::parse_str(&v.id).is_err()
            || v.revision < 1
            || (v.fields.plan_id.is_some() && r.interval.is_none())
        {
            return Err(bad());
        }
        validate(&v.fields, "9999-12-31").map_err(|_| bad())?;
        if let Some(label) = &v.fields.label_id {
            if !label_available(c, label)? {
                return Err(bad());
            }
        }
    }
    if version >= 22 {
        let mut q = c.prepare("SELECT id,asset_id,topup_date,paid_cents,gift_cents,credit_cents,pay_method,notes,revision FROM virtual_topups")?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let id: String = r.get(0)?;
            let asset: String = r.get(1)?;
            let f = TopupFields {
                topup_date: r.get(2)?,
                paid_cents: r.get::<_, Option<i64>>(3)?.map(|v| v.to_string()),
                gift_cents: r.get::<_, Option<i64>>(4)?.map(|v| v.to_string()),
                credit_cents: r.get::<_, Option<i64>>(5)?.map(|v| v.to_string()),
                pay_method: r.get(6)?,
                notes: r.get(7)?,
            };
            if uuid::Uuid::parse_str(&id).is_err()
                || uuid::Uuid::parse_str(&asset).is_err()
                || r.get::<_, i64>(8)? < 1
            {
                return Err(bad());
            }
            if validate_topup(&f, "9999-12-31").is_err() {
                return Err(bad());
            }
        }
        let mut q = c.prepare(
            "SELECT id,asset_id,balance_cents,recorded_on,notes,revision FROM virtual_balances",
        )?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let id: String = r.get(0)?;
            let asset: String = r.get(1)?;
            if uuid::Uuid::parse_str(&id).is_err()
                || uuid::Uuid::parse_str(&asset).is_err()
                || r.get::<_, i64>(2)? < 0
                || date(&r.get::<_, String>(3)?).is_err()
                || r.get::<_, String>(4)?.contains('\0')
                || r.get::<_, i64>(5)? < 1
            {
                return Err(bad());
            }
        }
        let orphan: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM virtual_topups t LEFT JOIN virtual_assets v ON v.id=t.asset_id WHERE v.id IS NULL) OR EXISTS(SELECT 1 FROM virtual_balances b LEFT JOIN virtual_assets v ON v.id=b.asset_id WHERE v.id IS NULL) OR EXISTS(SELECT 1 FROM label_scopes s LEFT JOIN named_choices n ON n.id=s.label_id WHERE n.id IS NULL)",
            [],
            |r| r.get(0),
        )?;
        if orphan {
            return Err(bad());
        }
    }
    Ok(())
}
