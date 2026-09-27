//! Recurring costs (ADR-001 §19). A plan only describes future periods; each
//! confirmed or skipped period is its own record and is the history (X-D12).
//! Nothing is created by time passing: due periods are derived on read.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use chrono::{Months, NaiveDate};
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
fn nth(first: NaiveDate, interval: u32, k: u32) -> Option<NaiveDate> {
    first.checked_add_months(Months::new(interval.checked_mul(k)?))
}

/// Scheduled dates in `[from, to]`, respecting the plan end.
fn schedule(f: &PlanFields, from: NaiveDate, to: NaiveDate) -> Result<Vec<NaiveDate>> {
    let first = date(&f.first_due)?;
    let end = f.end_date.as_deref().map(date).transpose()?;
    let mut out = Vec::new();
    for k in 0.. {
        let Some(d) = nth(first, f.interval_months, k) else {
            break;
        };
        if d > to || end.is_some_and(|e| d > e) {
            break;
        }
        if d >= from {
            out.push(d);
        }
    }
    Ok(out)
}

fn on_schedule(f: &PlanFields, day: NaiveDate) -> Result<bool> {
    Ok(schedule(f, day, day)?.contains(&day))
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
    if let Some(e) = &f.end_date {
        date(e)?;
        if e < &f.first_due {
            return Err(Error::new("PLAN_END", "结束日期不能早于首次付款日"));
        }
    }
    positive(&f.amount_cents, "PLAN_AMOUNT", "每期金额须为正数")
}

const PLAN_COLUMNS: &str =
    "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from";
fn plan_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: r.get(0)?,
        fields: PlanFields {
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

fn plan(c: &Connection, id: &str) -> Result<Option<Plan>> {
    Ok(c.query_row(
        &format!("SELECT {PLAN_COLUMNS} FROM recurring_plans WHERE id=?1 AND deleted_at IS NULL"),
        [id],
        plan_row,
    )
    .optional()?)
}

fn payments(c: &Connection, id: Option<&str>) -> Result<Vec<Payment>> {
    let mut q = c.prepare("SELECT p.id,p.plan_id,r.name,p.due_date,p.state,p.paid_date,p.amount_cents,p.notes,p.revision FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND (?1 IS NULL OR p.id=?1) ORDER BY p.due_date DESC,r.name,p.id")?;
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

fn receipt(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
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
        let f = &input.fields;
        let amount = validate(f)?;
        let old = input
            .id
            .as_deref()
            .map(|id| plan(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这项计划")))
            .transpose()?;
        if old.as_ref().map(|p| p.revision) != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "计划已变化，请重新读取"));
        }
        // Resuming never recalls the periods that fell due while paused.
        let active_from = match &old {
            Some(o) if o.fields.paused && !f.paused => today.to_owned(),
            Some(o) => o.active_from.clone(),
            None => f.first_due.clone(),
        };
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE recurring_plans SET name=?2,category=?3,amount_cents=?4,interval_months=?5,first_due=?6,end_date=?7,paused=?8,active_from=?9,notes=?10,revision=revision+1,updated_at=?11 WHERE id=?1",
                params![id, f.name.trim(), f.category, amount, f.interval_months, f.first_due, f.end_date, f.paused, active_from, f.notes, now])?;
        } else {
            tx.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,end_date,paused,active_from,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11)",
                params![id, f.name.trim(), f.category, amount, f.interval_months, f.first_due, f.end_date, f.paused, active_from, f.notes, now])?;
        }
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
            tx.execute("INSERT INTO plan_payments(id,plan_id,due_date,state,paid_date,amount_cents,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?8)",
                params![id, input.plan_id, input.due_date, input.state, input.paid_date, amount, input.notes, now])?;
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
                plan_id: pid.clone(),
                plan_name: f.name.clone(),
                category: f.category.clone(),
                due_date: d.format("%Y-%m-%d").to_string(),
                amount_cents: f.amount_cents.clone(),
            };
            p.next_due = schedule(f, now.succ_opt().unwrap_or(now), year)?
                .into_iter()
                .find(|d| free(d))
                .map(|d| d.format("%Y-%m-%d").to_string());
            if f.paused {
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
    let mut q = c.prepare(&format!("SELECT {PLAN_COLUMNS} FROM recurring_plans"))?;
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn month_end_anchor_never_drifts() {
        let f = PlanFields {
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
