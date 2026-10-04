//! Recurring costs (ADR-001 §19). A plan only describes future periods; each
//! confirmed or skipped period is its own record and is the history (X-D12).
//! Nothing is created by time passing: due periods are derived on read.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use chrono::{Datelike, Months, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const CATEGORIES: [&str; 6] = [
    "rent",
    "subscription",
    "utilities",
    "insurance",
    "membership",
    "other",
];
const UPCOMING_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanFields {
    /// None preserves legacy payment-date scheduling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage_start: Option<String>,
    pub name: String,
    pub category: String,
    pub amount_cents: String,
    pub interval_months: u32,
    pub first_due: String,
    pub end_date: Option<String>,
    pub paused: bool,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanSave {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: PlanFields,
}

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub monthly_cents: Option<String>,
    pub contract_cents: Option<String>,
    pub estimated_cents: Option<String>,
    pub paid_cents: Option<String>,
    pub next_coverage: Option<(String, String)>,
    pub id: String,
    pub fields: PlanFields,
    pub revision: i64,
    /// Periods before this date are never asked for (set when a pause ends).
    pub active_from: String,
    /// First scheduled date after today without a record, if any.
    pub next_due: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentSave {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub plan_id: String,
    pub due_date: String,
    /// `paid` or `skipped`.
    pub state: String,
    pub paid_date: Option<String>,
    pub amount_cents: Option<String>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Payment {
    pub coverage_start: Option<String>,
    pub coverage_end: Option<String>,
    pub id: String,
    pub plan_id: String,
    pub plan_name: String,
    pub due_date: String,
    pub state: String,
    pub paid_date: Option<String>,
    pub amount_cents: Option<String>,
    pub notes: String,
    pub revision: i64,
    /// The plan was edited so this period is no longer on its schedule.
    pub off_schedule: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Due {
    pub coverage_start: Option<String>,
    pub coverage_end: Option<String>,
    pub plan_id: String,
    pub plan_name: String,
    pub category: String,
    pub due_date: String,
    /// The plan amount, only a suggestion for the actual payment.
    pub amount_cents: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub generation: String,
    pub today: String,
    /// Due on or before today and not yet confirmed or skipped.
    pub due: Vec<Due>,
    /// Due within the next seven days.
    pub upcoming: Vec<Due>,
    pub annual_cents: String,
    pub monthly_cents: String,
    pub next12_cents: String,
    pub plans: Vec<Plan>,
    /// Live records, newest period first.
    pub payments: Vec<Payment>,
}

/// The k-th scheduled date, always counted from the anchor so a month-end
/// anchor never drifts (Jan 31 → Feb 28 → Mar 31).
pub(crate) fn nth(first: NaiveDate, interval: u32, k: u32) -> Option<NaiveDate> {
    first.checked_add_months(Months::new(interval.checked_mul(k)?))
}

/// Scheduled dates in `[from, to]`, respecting the plan end.
pub(crate) fn period(f: &PlanFields, d: NaiveDate) -> Result<Option<(String, String)>> {
    let Some(anchor) = f.coverage_start.as_deref() else {
        return Ok(None);
    };
    let first = date(&f.first_due)?;
    let months = (d.year() - first.year()) * 12 + d.month() as i32 - first.month() as i32;
    if months % f.interval_months as i32 != 0 || shift(first, months) != Some(d) {
        return Ok(None);
    }
    let start = shift(date(anchor)?, months).ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
    let finish = shift(date(anchor)?, months + f.interval_months as i32)
        .and_then(|x| x.pred_opt())
        .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
    let finish = f
        .end_date
        .as_deref()
        .map(date)
        .transpose()?
        .map_or(finish, |e| finish.min(e));
    Ok(Some((start.to_string(), finish.to_string())))
}
fn shift(first: NaiveDate, months: i32) -> Option<NaiveDate> {
    if months >= 0 {
        first.checked_add_months(Months::new(months as u32))
    } else {
        first.checked_sub_months(Months::new(months.unsigned_abs()))
    }
}
/// Includes historical periods only when explicitly requested for backfill.
pub(crate) fn schedule(f: &PlanFields, from: NaiveDate, to: NaiveDate) -> Result<Vec<NaiveDate>> {
    let first = date(&f.first_due)?;
    let end = f.end_date.as_deref().map(date).transpose()?;
    let service = f.service_start.as_deref().map(date).transpose()?;
    let months = (from.year() - first.year()) * 12 + from.month() as i32 - first.month() as i32;
    let mut k = (months.div_euclid(f.interval_months as i32) - 1).min(0);
    if service.is_none() {
        k = k.max(0);
    }
    let mut out = Vec::new();
    loop {
        let Some(d) = shift(first, f.interval_months as i32 * k) else {
            k += 1;
            if k > 0 {
                break;
            }
            continue;
        };
        if d > to {
            break;
        }
        let covers = period(f, d)?;
        let within = match &covers {
            Some((start, _)) => {
                service.as_ref().is_none_or(|s| start >= &s.to_string())
                    && end.as_ref().is_none_or(|e| start <= &e.to_string())
            }
            None => end.is_none_or(|e| d <= e),
        };
        if d >= from && within {
            out.push(d);
        }
        k += 1;
    }
    Ok(out)
}
fn on_schedule(f: &PlanFields, d: NaiveDate) -> Result<bool> {
    Ok(!schedule(f, d, d)?.is_empty())
}

fn positive(v: &str, code: &str, message: &str) -> Result<i64> {
    cents(Some(v))
        .map_err(|_| Error::new(code, message))?
        .filter(|v| *v > 0)
        .ok_or_else(|| Error::new(code, message))
}

fn validate(f: &PlanFields) -> Result<i64> {
    let name = f.name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.contains('\0') {
        return Err(Error::new("PLAN_NAME", "名称须为 1–80 字"));
    }
    if f.notes.chars().count() > 10000 || f.notes.contains('\0') {
        return Err(Error::new(
            "PLAN_NOTES",
            "备注最多 10000 字，且不能含空字符",
        ));
    }
    if !CATEGORIES.contains(&f.category.as_str()) {
        return Err(Error::new("PLAN_CATEGORY", "请选择分类"));
    }
    if ![1, 3, 6, 12].contains(&f.interval_months) {
        return Err(Error::new(
            "PLAN_INTERVAL",
            "周期须为每月、每季、每半年或每年",
        ));
    }
    date(&f.first_due)?;
    if f.service_start.is_some() != f.coverage_start.is_some() {
        return Err(Error::new("PLAN_SERVICE", "请填写开始日期与本期服务开始日"));
    }
    if let (Some(start), Some(coverage)) = (&f.service_start, &f.coverage_start) {
        date(start)?;
        date(coverage)?;
        if coverage < start {
            return Err(Error::new(
                "PLAN_SERVICE",
                "本期服务开始不能早于开始使用日期",
            ));
        }
    }
    if let Some(e) = &f.end_date {
        date(e)?;
        if e < &f.first_due
            || e < f.service_start.as_ref().unwrap_or(&f.first_due)
            || f.coverage_start.as_ref().is_some_and(|c| e < c)
        {
            return Err(Error::new(
                "PLAN_END",
                "结束日期不能早于开始日期或本期服务开始日",
            ));
        }
    }
    positive(&f.amount_cents, "PLAN_AMOUNT", "每期金额须为正数")
}

const PLAN_COLUMNS: &str =
    "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from,service_start,coverage_start";
fn plan_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: r.get(0)?,
        fields: PlanFields {
            service_start: r.get(11)?,
            coverage_start: r.get(12)?,
            name: r.get(1)?,
            category: r.get(2)?,
            amount_cents: r.get::<_, i64>(3)?.to_string(),
            interval_months: r.get(4)?,
            first_due: r.get(5)?,
            end_date: r.get(6)?,
            paused: r.get(7)?,
            notes: r.get(8)?,
        },
        revision: r.get(9)?,
        active_from: r.get(10)?,
        next_due: None,
        monthly_cents: None,
        contract_cents: None,
        estimated_cents: None,
        paid_cents: None,
        next_coverage: None,
    })
}

fn plans(c: &Connection) -> Result<Vec<Plan>> {
    let mut q = c.prepare(&format!(
        "SELECT {PLAN_COLUMNS} FROM recurring_plans WHERE deleted_at IS NULL ORDER BY name,id"
    ))?;
    let rows = q
        .query_map([], plan_row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub(crate) fn plan(c: &Connection, id: &str) -> Result<Option<Plan>> {
    Ok(c.query_row(
        &format!("SELECT {PLAN_COLUMNS} FROM recurring_plans WHERE id=?1 AND deleted_at IS NULL"),
        [id],
        plan_row,
    )
    .optional()?)
}

fn payments(c: &Connection, id: Option<&str>) -> Result<Vec<Payment>> {
    let mut q = c.prepare("SELECT p.id,p.plan_id,r.name,p.due_date,p.state,p.paid_date,p.amount_cents,p.notes,p.revision,p.coverage_start,p.coverage_end FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND (?1 IS NULL OR p.id=?1) ORDER BY p.due_date DESC,r.name,p.id")?;
    let mut rows = q
        .query_map([id], |r| {
            Ok(Payment {
                id: r.get(0)?,
                plan_id: r.get(1)?,
                plan_name: r.get(2)?,
                due_date: r.get(3)?,
                state: r.get(4)?,
                paid_date: r.get(5)?,
                amount_cents: r.get::<_, Option<i64>>(6)?.map(|v| v.to_string()),
                notes: r.get(7)?,
                revision: r.get(8)?,
                off_schedule: false,
                coverage_start: r.get(9)?,
                coverage_end: r.get(10)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for p in &mut rows {
        if let Some(pl) = plan(c, &p.plan_id)? {
            p.off_schedule = !on_schedule(&pl.fields, date(&p.due_date)?)?;
        }
    }
    Ok(rows)
}

pub(crate) fn receipt(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match prior {
        Some((f, _)) if f != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"))
        }
        Some((_, result)) => Ok(Some(result)),
        None => Ok(None),
    }
}

/// Shared transactional plan save: virtual + plan form one write and one receipt.
pub(crate) fn save_plan(
    c: &Connection,
    id: &str,
    revision: Option<i64>,
    f: &PlanFields,
    editing: bool,
    today: &str,
) -> Result<()> {
    let amount = validate(f)?;
    let old = if editing {
        Some(plan(c, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?)
    } else {
        None
    };
    if old.as_ref().map(|p| p.revision) != revision {
        return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
    }
    let active = match &old {
        Some(o) if o.fields.paused && !f.paused => today.to_owned(),
        Some(o) => o.active_from.clone(),
        None if f.service_start.is_some() => today.max(f.first_due.as_str()).to_owned(),
        None => f.first_due.clone(),
    };
    let now = chrono::Utc::now().to_rfc3339();
    if old.is_some() {
        c.execute("UPDATE recurring_plans SET name=?2,category=?3,amount_cents=?4,interval_months=?5,first_due=?6,end_date=?7,paused=?8,active_from=?9,notes=?10,updated_at=?11,service_start=?12,coverage_start=?13,revision=revision+1 WHERE id=?1", params![id,f.name.trim(),f.category,amount,f.interval_months,f.first_due,f.end_date,f.paused,active,f.notes,now,f.service_start,f.coverage_start])?;
    } else {
        c.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,end_date,paused,active_from,notes,created_at,updated_at,service_start,coverage_start,revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12,?13,1)",params![id,f.name.trim(),f.category,amount,f.interval_months,f.first_due,f.end_date,f.paused,active,f.notes,now,f.service_start,f.coverage_start])?;
    }
    if let Some(start) = &f.service_start {
        let changed = old
            .as_ref()
            .is_none_or(|o| o.fields.amount_cents != f.amount_cents);
        if changed {
            let effective = if old.is_none() { start.as_str() } else { today };
            c.execute("INSERT INTO plan_rates VALUES(?1,?2,?3) ON CONFLICT(plan_id,effective_date) DO UPDATE SET amount_cents=excluded.amount_cents",params![id,effective,amount])?;
        }
    }
    Ok(())
}
pub(crate) fn enrich_plan(c: &Connection, p: &mut Plan, today: &str) -> Result<()> {
    let f = &p.fields;
    let amount: i128 = f
        .amount_cents
        .parse()
        .map_err(|_| Error::new("FORMAT", "金额格式错误"))?;
    p.monthly_cents =
        Some(((amount + f.interval_months as i128 / 2) / f.interval_months as i128).to_string());
    let paid: i64 = c.query_row("SELECT coalesce(sum(amount_cents),0) FROM plan_payments WHERE plan_id=?1 AND deleted_at IS NULL AND state='paid'",[&p.id],|r|r.get(0))?;
    p.paid_cents = Some(paid.to_string());
    if let Some(d) = &p.next_due {
        p.next_coverage = period(f, date(d)?)?;
    }
    if let Some(start) = &f.service_start {
        // Service periods use the service anchor, not the prepayment day.
        let anchor = date(f.coverage_start.as_deref().unwrap())?;
        let start = date(start)?;
        let now = date(today)?;
        let months =
            (start.year() - anchor.year()) * 12 + start.month() as i32 - anchor.month() as i32;
        let mut k = months.div_euclid(f.interval_months as i32) - 1;
        let stop = f.end_date.as_deref().map(date).transpose()?;
        let limit = stop.unwrap_or(now).max(now);
        let mut estimate = 0i128;
        let mut contract = 0i128;
        loop {
            let Some(d) = shift(anchor, k * f.interval_months as i32) else {
                k += 1;
                if k > 0 {
                    break;
                }
                continue;
            };
            if d > limit {
                break;
            }
            if d >= start && stop.is_none_or(|e| d <= e) {
                let rate: Option<i64> = c.query_row("SELECT amount_cents FROM plan_rates WHERE plan_id=?1 AND effective_date<=?2 ORDER BY effective_date DESC LIMIT 1",params![p.id,d.to_string()],|r|r.get(0)).optional()?;
                if d <= now {
                    estimate += rate.map_or(amount, i128::from);
                }
                contract += if d <= now {
                    rate.map_or(amount, i128::from)
                } else {
                    amount
                };
            }
            k += 1;
        }
        p.estimated_cents = Some(estimate.to_string());
        p.contract_cents = stop.map(|_| contract.to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRangeSave {
    pub request_id: String,
    pub generation: String,
    pub plan_id: String,
    pub expected_revision: i64,
    pub from_due: String,
    pub to_due: String,
    pub amount_cents: String,
    pub confirmed: bool,
}

impl Store {
    pub fn recurring_plan_save(&mut self, input: &PlanSave, today: &str) -> Result<Plan> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("recurring_plan", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return plan(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        save_plan(
            &tx,
            &id,
            input.expected_revision,
            &input.fields,
            input.id.is_some(),
            today,
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = plan(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        self.hit("recurring_plan.before_commit")?;
        tx.commit()?;
        Ok(result)
    }

    /// Confirms, skips or corrects one period. A new record must name a
    /// scheduled date; a correction keeps its period and may change the rest.
    pub fn recurring_payment_save(&mut self, input: &PaymentSave, today: &str) -> Result<Payment> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("recurring_payment", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let read = |c: &Connection, id: &str| -> Result<Payment> {
            payments(c, Some(id))?
                .pop()
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次付款"))
        };
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return read(&tx, &id);
        }
        let pl =
            plan(&tx, &input.plan_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        let due = date(&input.due_date)?;
        if input.notes.chars().count() > 10000 || input.notes.contains('\0') {
            return Err(Error::new(
                "PAYMENT_NOTES",
                "备注最多 10000 字，且不能含空字符",
            ));
        }
        let amount = match input.state.as_str() {
            "paid" => {
                let day = input
                    .paid_date
                    .as_deref()
                    .ok_or_else(|| Error::new("PAYMENT_DATE", "请填写实付日期"))?;
                date(day)?;
                if day > today {
                    return Err(Error::new("PAYMENT_DATE", "实付日期不能晚于今天"));
                }
                Some(positive(
                    input.amount_cents.as_deref().unwrap_or(""),
                    "PAYMENT_AMOUNT",
                    "实付金额须为正数",
                )?)
            }
            "skipped" => {
                if input.paid_date.is_some() || input.amount_cents.is_some() {
                    return Err(Error::new("PAYMENT_STATE", "本期不付时不填写金额和日期"));
                }
                None
            }
            _ => return Err(Error::new("PAYMENT_STATE", "请选择已付或本期不付")),
        };
        let old = input.id.as_deref().map(|id| read(&tx, id)).transpose()?;
        if old.as_ref().map(|p| p.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "付款记录已变化，请重新读取",
            ));
        }
        match &old {
            Some(o) if o.plan_id != input.plan_id || o.due_date != input.due_date => {
                return Err(Error::new("PAYMENT_PERIOD", "付款所属的期不能更改"));
            }
            Some(_) => {}
            None => {
                if !on_schedule(&pl.fields, due)? {
                    return Err(Error::new("PAYMENT_PERIOD", "这一天不是该计划的付款日"));
                }
                let taken: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM plan_payments WHERE plan_id=?1 AND due_date=?2 AND deleted_at IS NULL)",
                    params![input.plan_id, input.due_date],
                    |r| r.get(0),
                )?;
                if taken {
                    return Err(Error::new(
                        "PAYMENT_EXISTS",
                        "这一期已经记录过，请打开原记录更正",
                    ));
                }
            }
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE plan_payments SET state=?2,paid_date=?3,amount_cents=?4,notes=?5,revision=revision+1,updated_at=?6 WHERE id=?1",
                params![id, input.state, input.paid_date, amount, input.notes, now])?;
        } else {
            let coverage = period(&pl.fields, due)?;
            tx.execute("INSERT INTO plan_payments(id,plan_id,due_date,state,paid_date,amount_cents,notes,revision,created_at,updated_at,coverage_start,coverage_end) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?8,?9,?10)",
                params![id, input.plan_id, input.due_date, input.state, input.paid_date, amount, input.notes, now, coverage.as_ref().map(|x| &x.0), coverage.as_ref().map(|x| &x.1)])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = read(&tx, &id)?;
        self.hit("recurring_payment.before_commit")?;
        tx.commit()?;
        self.hit("recurring_payment.after_commit")?;
        Ok(result)
    }

    pub fn recurring_payment_range_save(
        &mut self,
        input: &PaymentRangeSave,
        today: &str,
    ) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("recurring_payment_range", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(id);
        }
        let p =
            plan(&tx, &input.plan_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划"))?;
        if p.revision != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
        }
        let from = date(&input.from_due)?;
        let to = date(&input.to_due)?;
        if !input.confirmed
            || from > to
            || input.to_due.as_str() > today
            || !on_schedule(&p.fields, from)?
            || !on_schedule(&p.fields, to)?
        {
            return Err(Error::new(
                "PAYMENT_RANGE",
                "请明确确认有效的往期付款范围，不能晚于今天",
            ));
        }
        let amount = positive(&input.amount_cents, "PAYMENT_AMOUNT", "每期实付须为正数")?;
        let dates = schedule(&p.fields, from, to)?;
        if dates.len() > 600 {
            return Err(Error::new("PAYMENT_RANGE", "一次最多补记 600 期"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        for d in dates {
            let exists: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM plan_payments WHERE plan_id=?1 AND due_date=?2 AND deleted_at IS NULL)",params![p.id,d.to_string()],|r|r.get(0))?;
            if exists {
                continue;
            }
            let coverage = period(&p.fields, d)?;
            tx.execute("INSERT INTO plan_payments(id,plan_id,due_date,state,paid_date,amount_cents,notes,revision,created_at,updated_at,coverage_start,coverage_end) VALUES(?1,?2,?3,'paid',?3,?4,'用户确认范围补记；实付日按付款日记录',1,?5,?5,?6,?7)",params![uid(),p.id,d.to_string(),amount,now,coverage.as_ref().map(|x|&x.0),coverage.as_ref().map(|x|&x.1)])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, p.id],
        )?;
        self.hit("recurring_range.before_commit")?;
        tx.commit()?;
        self.hit("recurring_range.after_commit")?;
        Ok(p.id)
    }

    pub fn recurring_overview(&self, today: &str) -> Result<Overview> {
        let c = self.conn()?;
        let now = date(today)?;
        let soon = now + chrono::Duration::days(UPCOMING_DAYS);
        let year = now
            .checked_add_months(Months::new(12))
            .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
        let mut all = plans(c)?;
        let records = payments(c, None)?;
        let recorded: BTreeSet<(&str, &str)> = records
            .iter()
            .map(|p| (p.plan_id.as_str(), p.due_date.as_str()))
            .collect();
        let (mut due, mut upcoming) = (Vec::new(), Vec::new());
        let (mut annual, mut next12) = (0i128, 0i128);
        for p in &mut all {
            let (pid, f) = (p.id.clone(), p.fields.clone());
            let f = &f;
            let amount: i128 = f
                .amount_cents
                .parse()
                .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?;
            let free = |d: &NaiveDate| {
                !recorded.contains(&(pid.as_str(), d.format("%Y-%m-%d").to_string().as_str()))
            };
            let item = |d: NaiveDate| Due {
                coverage_start: period(f, d).ok().flatten().map(|x| x.0),
                coverage_end: period(f, d).ok().flatten().map(|x| x.1),
                plan_id: pid.clone(),
                plan_name: f.name.clone(),
                category: f.category.clone(),
                due_date: d.format("%Y-%m-%d").to_string(),
                amount_cents: f.amount_cents.clone(),
            };
            p.next_due = schedule(f, now.max(date(&p.active_from)?), year)?
                .into_iter()
                .find(|d| free(d))
                .map(|d| d.format("%Y-%m-%d").to_string());
            enrich_plan(c, p, today)?;
            if f.paused {
                p.next_due = None;
                p.next_coverage = None;
                continue;
            }
            let from = date(&p.active_from)?;
            due.extend(
                schedule(f, from, now)?
                    .into_iter()
                    .filter(|d| free(d))
                    .map(item),
            );
            upcoming.extend(
                schedule(f, now.succ_opt().unwrap_or(now), soon)?
                    .into_iter()
                    .filter(|d| free(d))
                    .map(item),
            );
            // Periods already recorded early are not expected again.
            let ahead = schedule(f, now.succ_opt().unwrap_or(now), year)?;
            next12 += amount * ahead.iter().filter(|d| free(d)).count() as i128;
            if f.end_date.as_deref().is_none_or(|e| e >= today) {
                annual += amount * 12 / f.interval_months as i128;
            }
        }
        due.sort_by(|a, b| {
            a.due_date
                .cmp(&b.due_date)
                .then_with(|| a.plan_name.cmp(&b.plan_name))
        });
        upcoming.sort_by(|a, b| {
            a.due_date
                .cmp(&b.due_date)
                .then_with(|| a.plan_name.cmp(&b.plan_name))
        });
        // Monthly average rounds once, at the end (half away from zero).
        let monthly = (annual + 6) / 12;
        Ok(Overview {
            generation: self.generation(),
            today: today.into(),
            due,
            upcoming,
            annual_cents: annual.to_string(),
            monthly_cents: monthly.to_string(),
            next12_cents: next12.to_string(),
            plans: all,
            payments: records,
        })
    }
}

/// Backup validation for schema 17 data beyond what SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法周期费用资料");
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let columns = if version < 21 {
        "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from,NULL,NULL"
    } else {
        PLAN_COLUMNS
    };
    let mut q = c.prepare(&format!("SELECT {columns} FROM recurring_plans"))?;
    let rows = q
        .query_map([], plan_row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for p in rows {
        if uuid::Uuid::parse_str(&p.id).is_err() || p.revision < 1 || date(&p.active_from).is_err()
        {
            return Err(bad());
        }
        validate(&p.fields).map_err(|_| bad())?;
    }
    let mut q = c.prepare("SELECT id,due_date,paid_date,notes,revision FROM plan_payments")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let due: String = r.get(1)?;
        let paid: Option<String> = r.get(2)?;
        let notes: String = r.get(3)?;
        if uuid::Uuid::parse_str(&id).is_err()
            || date(&due).is_err()
            || paid.as_deref().is_some_and(|d| date(d).is_err())
            || notes.contains('\0')
            || r.get::<_, i64>(4)? < 1
        {
            return Err(bad());
        }
    }
    if version >= 21 {
        let mut q = c.prepare("SELECT coverage_start,coverage_end FROM plan_payments")?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let start: Option<String> = r.get(0)?;
            let end: Option<String> = r.get(1)?;
            if start.is_some() != end.is_some()
                || start.as_deref().is_some_and(|d| date(d).is_err())
                || end.as_deref().is_some_and(|d| date(d).is_err())
                || start.as_ref().zip(end.as_ref()).is_some_and(|(a, b)| a > b)
            {
                return Err(bad());
            }
        }
        let mut q = c.prepare("SELECT effective_date,amount_cents FROM plan_rates")?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let d: String = r.get(0)?;
            if date(&d).is_err() || r.get::<_, i64>(1)? <= 0 {
                return Err(bad());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn month_end_anchor_never_drifts() {
        let f = PlanFields {
            service_start: None,
            coverage_start: None,
            name: "x".into(),
            category: "rent".into(),
            amount_cents: "1".into(),
            interval_months: 1,
            first_due: "2026-01-31".into(),
            end_date: None,
            paused: false,
            notes: String::new(),
        };
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        let got: Vec<_> = schedule(&f, d("2026-01-01"), d("2026-05-31"))
            .unwrap()
            .into_iter()
            .map(|x| x.to_string())
            .collect();
        assert_eq!(
            got,
            [
                "2026-01-31",
                "2026-02-28",
                "2026-03-31",
                "2026-04-30",
                "2026-05-31"
            ]
        );
        assert!(on_schedule(&f, d("2026-02-28")).unwrap());
        assert!(!on_schedule(&f, d("2026-03-28")).unwrap());
    }
}
