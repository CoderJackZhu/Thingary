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
    #[serde(default = "renewal_default")]
    pub auto_renew: bool,
    /// None preserves legacy payment-date scheduling.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage_start: Option<String>,
    /// Fixed-day period length; when set it takes precedence over months.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_days: Option<u32>,
    /// Free trial in days, counted from the service start (design §4.4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial_days: Option<u32>,
    pub name: String,
    pub category: String,
    pub amount_cents: String,
    pub interval_months: u32,
    pub first_due: String,
    pub end_date: Option<String>,
    pub paused: bool,
    pub notes: String,
}

fn renewal_default() -> bool {
    true
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
    pub rules: Vec<ScheduleRule>,
    pub period_ends: std::collections::BTreeMap<String, String>,
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
    /// Pending future renewal price (design §4.5), if any.
    pub renewal_cents: Option<String>,
    pub renewal_from: Option<String>,
    /// The period that covers today, by original start, and its special end.
    pub special_start: Option<String>,
    pub special_end: Option<String>,
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

/// One step of the plan's period length, either calendar months or fixed days.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Step {
    Months(u32),
    Days(u32),
}

impl Step {
    fn of(f: &PlanFields) -> Self {
        match f.interval_days {
            Some(n) => Step::Days(n),
            None => Step::Months(f.interval_months),
        }
    }
    fn shift(self, d: NaiveDate, k: i64) -> Option<NaiveDate> {
        match self {
            Step::Months(n) => {
                if k >= 0 {
                    d.checked_add_months(Months::new(u32::try_from(k).ok()?.checked_mul(n)?))
                } else {
                    d.checked_sub_months(Months::new(
                        u32::try_from(k.checked_mul(-1)?).ok()?.checked_mul(n)?,
                    ))
                }
            }
            Step::Days(n) => {
                let days = i64::from(n).checked_mul(k)?;
                if days >= 0 {
                    d.checked_add_days(chrono::Days::new(days as u64))
                } else {
                    d.checked_sub_days(chrono::Days::new(days.unsigned_abs()))
                }
            }
        }
    }
}

/// Special coverage ends per period, keyed by the period's original start.
pub(crate) type PeriodEnds = std::collections::BTreeMap<NaiveDate, NaiveDate>;

pub(crate) fn period_ends(c: &Connection, plan_id: &str) -> Result<PeriodEnds> {
    let mut q =
        c.prepare("SELECT period_start,coverage_end FROM plan_period_ends WHERE plan_id=?1")?;
    let rows = q
        .query_map([plan_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(s, e)| Ok((date(&s)?, date(&e)?)))
        .collect()
}

/// One effective coverage rule (review R4): from `effective` on, periods run
/// from `anchor` with this length. The first segment mirrors the original
/// single-rule behaviour; later segments only steer periods from their date.
#[derive(Clone, Debug)]
pub(crate) struct RuleSeg {
    pub due: NaiveDate,
    pub service: Option<NaiveDate>,
    pub trial: Option<u32>,
    pub effective: NaiveDate,
    pub anchor: NaiveDate,
    pub(crate) step: Step,
}

pub(crate) fn rule_segments(c: &Connection, plan_id: &str) -> Result<Vec<RuleSeg>> {
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 23 {
        return Ok(Vec::new());
    }
    let mut q = c.prepare(
        "SELECT effective_date,anchor,interval_months,interval_days,first_due,service_start,trial_days FROM plan_rules WHERE plan_id=?1 ORDER BY effective_date",
    )?;
    let rows = q
        .query_map([plan_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u32>(2)?,
                r.get::<_, Option<u32>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<u32>>(6)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(e, a, months, days, due, service, trial)| {
            Ok(RuleSeg {
                due: date(&due)?,
                service: service.as_deref().map(date).transpose()?,
                trial,
                effective: date(&e)?,
                anchor: date(&a)?,
                step: match days {
                    Some(n) => Step::Days(n),
                    None => Step::Months(months),
                },
            })
        })
        .collect()
}

/// Periods for a plan: stored rule segments when the library has them
/// (schema 23+), otherwise the current fields as a single rule.
pub(crate) fn periods_for(
    c: &Connection,
    f: &PlanFields,
    plan_id: &str,
    ends: PeriodEnds,
) -> Result<Periods> {
    let segments = rule_segments(c, plan_id)?;
    if segments.is_empty() {
        Periods::new(f, ends)
    } else {
        Periods::with_segments(segments, ends)
    }
}

/// Effective service periods of one plan. Periods walk a chain: each rule
/// segment re-anchors at its own date, periods under a rule sit on that rule's
/// grid (a month-end anchor never drifts, Jan 31 → Feb 28 → Mar 31), and a
/// special end shifts the chain forward from that period on (design §4.5).
pub(crate) struct Periods {
    cache: std::cell::RefCell<Vec<ChainNode>>,
    segs: Vec<RuleSeg>,
    ends: PeriodEnds,
}

/// One walked period of the chain: grid position, actual start and end.
#[derive(Clone, Copy)]
struct ChainNode {
    due: NaiveDate,
    rule: usize,
    local: i64,
    original: NaiveDate,
    start: NaiveDate,
    end: NaiveDate,
}

impl Periods {
    pub(crate) fn new(f: &PlanFields, ends: PeriodEnds) -> Result<Self> {
        let anchor = f
            .coverage_start
            .as_deref()
            .map(date)
            .transpose()?
            .ok_or_else(|| Error::new("PLAN_SERVICE", "请填写开始日期与本期服务开始日"))?;
        Ok(Self {
            cache: Default::default(),
            segs: vec![RuleSeg {
                due: date(&f.first_due)?,
                service: f.service_start.as_deref().map(date).transpose()?,
                trial: f.trial_days,
                effective: anchor,
                anchor,
                step: Step::of(f),
            }],
            ends,
        })
    }

    pub(crate) fn with_segments(segs: Vec<RuleSeg>, ends: PeriodEnds) -> Result<Self> {
        if segs.is_empty() {
            return Err(Error::new("PLAN_SERVICE", "计划缺少生效规则"));
        }
        Ok(Self {
            segs,
            ends,
            cache: Default::default(),
        })
    }

    /// The first rule's anchor — the plan's original billing anchor.
    pub(crate) fn anchor(&self) -> NaiveDate {
        self.segs[0].anchor
    }

    /// Walks periods 0..=k through rules and special ends. Each rule segment
    /// re-anchors at its effective date; under one rule, periods sit on the
    /// rule's grid so a month-end anchor never drifts (Jan 31 → Feb 28 →
    /// Mar 31, so the Feb 28 period covers through Mar 30); a special end
    /// shifts the chain forward from that period on (design §4.5).
    fn walk(&self, k: i64) -> Result<Option<ChainNode>> {
        if k < 0 {
            let seg = &self.segs[0];
            let Some(start) = seg.step.shift(seg.anchor, k) else {
                return Ok(None);
            };
            let Some(end) = seg.step.shift(seg.anchor, k + 1).and_then(|d| d.pred_opt()) else {
                return Ok(None);
            };
            let Some(due) = seg.step.shift(seg.due, k) else {
                return Ok(None);
            };
            return Ok(Some(ChainNode {
                original: start,
                start,
                end,
                due,
                rule: 0,
                local: k,
            }));
        }
        let mut cache = self.cache.borrow_mut();
        while cache.len() <= k as usize {
            let previous = cache.last().copied();
            let candidate = previous
                .and_then(|p| p.end.succ_opt())
                .unwrap_or(self.segs[0].anchor);
            let mut rule = previous.map_or(0, |p| p.rule);
            let mut local = previous.map_or(0, |p| p.local + 1);
            while rule + 1 < self.segs.len() && self.segs[rule + 1].effective <= candidate {
                rule += 1;
                local = 0;
            }
            let seg = &self.segs[rule];
            let Some(original) = Self::grid(seg, local) else {
                return Ok(None);
            };
            let start = candidate.max(original);
            let end = if let Some(special) = self.ends.get(&original) {
                *special
            } else if start > original {
                seg.step
                    .shift(start, 1)
                    .and_then(|d| d.pred_opt())
                    .ok_or_else(|| Error::new("DATE", "日期超出范围"))?
            } else {
                Self::grid(seg, local + 1)
                    .and_then(|d| d.pred_opt())
                    .ok_or_else(|| Error::new("DATE", "日期超出范围"))?
            };
            let Some(due) = seg.step.shift(seg.due, local) else {
                return Ok(None);
            };
            cache.push(ChainNode {
                original,
                start,
                end,
                due,
                rule,
                local,
            });
        }
        Ok(cache.get(k as usize).copied())
    }

    fn first_index(&self) -> i64 {
        let seg = &self.segs[0];
        match (seg.step, seg.service, seg.trial) {
            (Step::Months(n), Some(start), None) => {
                let months = i64::from(start.year() - seg.anchor.year()) * 12
                    + i64::from(start.month())
                    - i64::from(seg.anchor.month());
                (months.div_euclid(i64::from(n)) - 1).min(0)
            }
            _ => 0,
        }
    }

    fn due_at(&self, k: i64) -> Result<Option<NaiveDate>> {
        Ok(self.walk(k)?.map(|n| n.due))
    }

    fn scheduled(&self, f: &PlanFields, from: NaiveDate, to: NaiveDate) -> Result<Vec<NaiveDate>> {
        let end = f.end_date.as_deref().map(date).transpose()?;
        let mut out = Vec::new();
        for k in self.first_index()..120000 {
            let Some(n) = self.walk(k)? else { break };
            if n.due > to {
                break;
            }
            let seg = &self.segs[n.rule];
            if n.due >= from
                && seg.service.is_none_or(|s| n.start >= s)
                && end.is_none_or(|e| n.start <= e)
                && !(seg.trial.is_some() && n.start < seg.anchor)
            {
                out.push(n.due);
            }
        }
        Ok(out)
    }

    /// Grid position of period `local` under `rule`'s anchor.
    fn grid(rule: &RuleSeg, local: i64) -> Option<NaiveDate> {
        rule.step.shift(rule.anchor, local)
    }

    /// Actual `(start, end)` of period k. Negative k is the legacy pre-anchor
    /// history under the first rule (no special ends apply there).
    pub(crate) fn span(&self, k: i64) -> Result<Option<(NaiveDate, NaiveDate)>> {
        Ok(self.walk(k)?.map(|n| (n.start, n.end)))
    }

    /// The grid position special ends are keyed by.
    pub(crate) fn original_start(&self, k: i64) -> Option<NaiveDate> {
        self.walk(k).ok().flatten().map(|n| n.original)
    }

    /// Coverage `(start, end)` of the period a payment due at `d` belongs to.
    pub(crate) fn period_of_due(
        &self,
        f: &PlanFields,
        d: NaiveDate,
    ) -> Result<Option<(String, String)>> {
        for k in self.first_index()..120000 {
            let Some(node) = self.walk(k)? else { break };
            if node.due > d {
                break;
            }
            if node.due == d {
                let end = f
                    .end_date
                    .as_deref()
                    .map(date)
                    .transpose()?
                    .map_or(node.end, |e| node.end.min(e));
                return Ok(Some((node.start.to_string(), end.to_string())));
            }
        }
        Ok(None)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ScheduleRule {
    pub effective_date: String,
    pub anchor: String,
    pub first_due: String,
    pub service_start: Option<String>,
    pub interval_months: u32,
    pub interval_days: Option<u32>,
    pub trial_days: Option<u32>,
}

fn schedule_for(
    c: &Connection,
    f: &PlanFields,
    id: &str,
    ends: &PeriodEnds,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NaiveDate>> {
    if f.coverage_start.is_none() {
        return schedule(f, ends, from, to);
    }
    periods_for(c, f, id, ends.clone())?.scheduled(f, from, to)
}

/// Scheduled payment dates in `[from, to]`, respecting the plan end. Historical
/// periods (k < 0) are enumerated only for legacy month-based plans without a
/// trial, so old libraries can still backfill before the anchor; a modern
/// trial plan never offers its free window as payment candidates (review R3).
pub(crate) fn schedule(
    f: &PlanFields,
    ends: &PeriodEnds,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<NaiveDate>> {
    let first = date(&f.first_due)?;
    let end = f.end_date.as_deref().map(date).transpose()?;
    let service = f.service_start.as_deref().map(date).transpose()?;
    let billing = f.coverage_start.as_deref().map(date).transpose()?;
    let step = Step::of(f);
    let mut k = match (step, service, f.trial_days) {
        (Step::Months(n), Some(_), None) => {
            let months = i64::from(from.year() - first.year()) * 12 + i64::from(from.month())
                - i64::from(first.month());
            (months.div_euclid(i64::from(n)) - 1).min(0)
        }
        _ => 0,
    };
    let periods = f
        .coverage_start
        .is_some()
        .then(|| Periods::new(f, ends.clone()))
        .transpose()?;
    let mut out = Vec::new();
    loop {
        let Some(d) = step.shift(first, k) else {
            k += 1;
            if k > 0 {
                break;
            }
            continue;
        };
        if d > to {
            break;
        }
        let within = match &periods {
            Some(p) => match p.period_of_due(f, d)? {
                Some((start, _)) => {
                    let start = date(start.as_str())?;
                    service.as_ref().is_none_or(|s| start >= *s)
                        && end.as_ref().is_none_or(|e| start <= *e)
                        // 试用计划：计费锚点之前都是免费期，不是付款候选。
                        && !(f.trial_days.is_some() && billing.is_some_and(|b| start < b))
                }
                None => end.is_none_or(|e| d <= e),
            },
            None => end.is_none_or(|e| d <= e),
        };
        if d >= from && within {
            out.push(d);
        }
        k += 1;
    }
    Ok(out)
}

/// Whether `d` sits on the payment grid counted from `first_due` alone
/// (works for legacy plans without a coverage anchor too).
#[cfg(test)]
fn due_member(f: &PlanFields, d: NaiveDate) -> bool {
    let Ok(first) = date(&f.first_due) else {
        return false;
    };
    let step = Step::of(f);
    match step {
        Step::Months(n) => {
            let months = i64::from(d.year() - first.year()) * 12 + i64::from(d.month())
                - i64::from(first.month());
            months % i64::from(n) == 0
                && step.shift(first, months.div_euclid(i64::from(n))) == Some(d)
        }
        Step::Days(n) => {
            let days = (d - first).num_days();
            days >= 0 && days % i64::from(n) == 0
        }
    }
}

/// Whether `d` is a schedulable payment date: on the payment grid, inside the
/// service window, and never inside a free trial (review R3).
#[cfg(test)]
fn on_schedule(f: &PlanFields, ends: &PeriodEnds, d: NaiveDate) -> Result<bool> {
    if !due_member(f, d) {
        return Ok(false);
    }
    let end = f.end_date.as_deref().map(date).transpose()?;
    let service = f.service_start.as_deref().map(date).transpose()?;
    let billing = f.coverage_start.as_deref().map(date).transpose()?;
    if f.trial_days.is_some() && billing.is_some_and(|b| d < b) {
        return Ok(false);
    }
    if f.coverage_start.is_some() {
        // Pre-anchor legacy dues and trial-window dues are decided above; the
        // coverage window itself only needs the single-rule grid here.
        let Some((start, _)) = Periods::new(f, ends.clone())?.period_of_due(f, d)? else {
            return Ok(false);
        };
        let start = date(&start)?;
        return Ok(service.is_none_or(|s| start >= s) && end.is_none_or(|e| start <= e));
    }
    Ok(end.is_none_or(|e| d <= e))
}

pub(crate) fn positive(v: &str, code: &str, message: &str) -> Result<i64> {
    cents(Some(v))
        .map_err(|_| Error::new(code, message))?
        .filter(|v| *v > 0)
        .ok_or_else(|| Error::new(code, message))
}

pub(crate) use positive as positive_amount;

/// Calendar-month shift shared with the virtual asset derive paths; never
/// drifts a month-end anchor (Jan 31 → Feb 28 → Mar 31).
pub(crate) fn shift_months(d: NaiveDate, months: i64) -> Option<NaiveDate> {
    Step::Months(1).shift(d, months)
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
    if let Some(n) = f.interval_days {
        if !(1..=3650).contains(&n) {
            return Err(Error::new("PLAN_INTERVAL", "固定天数须为 1–3650 天"));
        }
    }
    if let Some(n) = f.trial_days {
        if !(1..=3650).contains(&n) {
            return Err(Error::new("PLAN_TRIAL", "试用天数须为 1–3650 天"));
        }
        if f.service_start.is_none() || f.coverage_start.is_none() {
            return Err(Error::new("PLAN_TRIAL", "免费试用需要开始使用日期"));
        }
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
        // A free trial pushes billing after the trial's last day (design §4.4).
        if let Some(n) = f.trial_days {
            let billing = date(start)?
                .checked_add_days(chrono::Days::new(u64::from(n)))
                .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
            if date(coverage)? < billing {
                return Err(Error::new("PLAN_TRIAL", "计费开始不能早于试用结束的次日"));
            }
        }
    }
    if !f.auto_renew && f.end_date.is_none() {
        return Err(Error::new("PLAN_END", "关闭自动续费时请确认最后使用日期"));
    }
    if let Some(e) = &f.end_date {
        date(e)?;
        // 服务起止是合法性下界：试用内结束是零费用已结束记录（review R2）；
        // 旧计划（无 service_start）沿用付款锚点下界。
        let lower = f.service_start.as_ref().unwrap_or(&f.first_due);
        if e < lower {
            return Err(Error::new("PLAN_END", "结束日期不能早于开始使用日期"));
        }
    }
    positive(&f.amount_cents, "PLAN_AMOUNT", "每期金额须为正数")
}

const PLAN_COLUMNS: &str =
    "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from,service_start,coverage_start,interval_days,trial_days,auto_renew";
fn plan_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        rules: Vec::new(),
        period_ends: Default::default(),
        id: r.get(0)?,
        fields: PlanFields {
            auto_renew: r.get(15)?,
            service_start: r.get(11)?,
            coverage_start: r.get(12)?,
            interval_days: r.get(13)?,
            trial_days: r.get(14)?,
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
        renewal_cents: None,
        renewal_from: None,
        special_start: None,
        special_end: None,
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
            let ends = period_ends(c, &pl.id)?;
            p.off_schedule = !schedule_for(
                c,
                &pl.fields,
                &pl.id,
                &ends,
                date(&p.due_date)?,
                date(&p.due_date)?,
            )?
            .contains(&date(&p.due_date)?);
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
        c.execute("UPDATE recurring_plans SET name=?2,category=?3,amount_cents=?4,interval_months=?5,first_due=?6,end_date=?7,paused=?8,active_from=?9,notes=?10,updated_at=?11,service_start=?12,coverage_start=?13,interval_days=?14,trial_days=?15,auto_renew=?16,revision=revision+1 WHERE id=?1", params![id,f.name.trim(),f.category,amount,f.interval_months,f.first_due,f.end_date,f.paused,active,f.notes,now,f.service_start,f.coverage_start,f.interval_days,f.trial_days,f.auto_renew])?;
    } else {
        c.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,end_date,paused,active_from,notes,created_at,updated_at,service_start,coverage_start,interval_days,trial_days,auto_renew,revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12,?13,?14,?15,?16,1)",params![id,f.name.trim(),f.category,amount,f.interval_months,f.first_due,f.end_date,f.paused,active,f.notes,now,f.service_start,f.coverage_start,f.interval_days,f.trial_days,f.auto_renew])?;
    }
    let rule_changed = old.as_ref().is_some_and(|o| {
        o.fields.interval_months != f.interval_months
            || o.fields.interval_days != f.interval_days
            || o.fields.coverage_start != f.coverage_start
            || o.fields.first_due != f.first_due
            || o.fields.service_start != f.service_start
            || o.fields.trial_days != f.trial_days
    });
    let seg_exists: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM plan_rules WHERE plan_id=?1)",
        [id],
        |r| r.get(0),
    )?;
    if !seg_exists || rule_changed {
        let mut anchor = f
            .coverage_start
            .clone()
            .unwrap_or_else(|| f.first_due.clone());
        let mut due = f.first_due.clone();
        if let Some(o) = &old {
            if o.fields.coverage_start == f.coverage_start && o.fields.first_due == f.first_due {
                let previous = periods_for(c, &o.fields, id, period_ends(c, id)?)?;
                for k in previous.first_index()..120000 {
                    let Some(n) = previous.walk(k)? else { break };
                    if n.start >= date(today)? {
                        anchor = n.start.to_string();
                        due = n.due.to_string();
                        break;
                    }
                }
            } else {
                for k in 0..120000 {
                    let Some(start) = Step::of(f).shift(date(&anchor)?, k) else {
                        break;
                    };
                    if start >= date(today)? {
                        due = Step::of(f)
                            .shift(date(&due)?, k)
                            .ok_or_else(|| Error::new("DATE", "日期超出范围"))?
                            .to_string();
                        anchor = start.to_string();
                        break;
                    }
                }
            }
        }
        let effective = if old.is_none() {
            f.service_start.as_deref().unwrap_or(&f.first_due)
        } else {
            today
        };
        c.execute("INSERT INTO plan_rules(plan_id,effective_date,anchor,interval_months,interval_days,first_due,service_start,trial_days) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(plan_id,effective_date) DO UPDATE SET anchor=excluded.anchor,interval_months=excluded.interval_months,interval_days=excluded.interval_days,first_due=excluded.first_due,service_start=excluded.service_start,trial_days=excluded.trial_days", params![id,effective,anchor,f.interval_months,f.interval_days,due,f.service_start,f.trial_days])?;
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

/// Applies one special coverage end to an unconfirmed period (design §4.5).
/// `period_start` identifies the target by its original start; `end = None`
/// removes the override. Confirmed coverage, the final end date and the next
/// period's original start bound what is accepted.
pub(crate) fn save_special_end(
    c: &Connection,
    plan_id: &str,
    f: &PlanFields,
    period_start: &str,
    end: Option<&str>,
    _today: &str,
) -> Result<()> {
    let start = date(period_start)?;
    match end {
        None => {
            c.execute(
                "DELETE FROM plan_period_ends WHERE plan_id=?1 AND period_start=?2",
                params![plan_id, period_start],
            )?;
        }
        Some(end) => {
            let finish = date(end)?;
            let periods = periods_for(c, f, plan_id, period_ends(c, plan_id)?)?;
            // The target is named by the period's actual start; store the
            // override under its original start so derivation finds it again
            // even when earlier special ends shifted this period.
            let k = (0..=4000)
                .find(|k| {
                    periods.span(*k).ok().flatten().is_some_and(|(s, _)| {
                        s == start || periods.original_start(*k) == Some(start)
                    })
                })
                .ok_or_else(|| Error::new("PERIOD_END", "这一天不是该计划的服务期开始日"))?;
            let original = periods
                .original_start(k)
                .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
            let actual_start = periods
                .span(k)?
                .ok_or_else(|| Error::new("DATE", "日期超出范围"))?
                .0;
            if finish < actual_start {
                return Err(Error::new("PERIOD_END", "特殊到期不能早于本期开始"));
            }
            if let Some(e) = &f.end_date {
                if finish > date(e)? {
                    return Err(Error::new("PERIOD_END", "特殊到期不能晚于最终结束日期"));
                }
            }
            // A confirmed payment owns its coverage; never rewrite it.
            let target_due = periods
                .due_at(k)?
                .ok_or_else(|| Error::new("DATE", "日期超出范围"))?;
            let confirmed: bool = c.query_row(
                "SELECT EXISTS(SELECT 1 FROM plan_payments WHERE plan_id=?1 AND due_date=?2 AND deleted_at IS NULL AND state='paid')",
                params![plan_id, target_due.to_string()],
                |r| r.get(0),
            )?;
            if confirmed {
                return Err(Error::new(
                    "PERIOD_END",
                    "这一期已确认付款，覆盖期不能再调整",
                ));
            }
            // Extending may not swallow the period after next: the special end
            // stays below the original start two periods ahead.
            if let Some((next, _)) = periods.span(k + 2)? {
                if finish >= next {
                    return Err(Error::new(
                        "PERIOD_END",
                        "特殊到期与后续期间重叠，请缩短本期调整",
                    ));
                }
            }
            c.execute(
                "INSERT INTO plan_period_ends(plan_id,period_start,coverage_end) VALUES(?1,?2,?3) ON CONFLICT(plan_id,period_start) DO UPDATE SET coverage_end=excluded.coverage_end",
                params![plan_id, original.to_string(), end],
            )?;
        }
    }
    Ok(())
}
pub(crate) fn enrich_plan(c: &Connection, p: &mut Plan, today: &str) -> Result<()> {
    p.rules = rule_segments(c, &p.id)?
        .into_iter()
        .map(|r| ScheduleRule {
            effective_date: r.effective.to_string(),
            anchor: r.anchor.to_string(),
            first_due: r.due.to_string(),
            service_start: r.service.map(|d| d.to_string()),
            trial_days: r.trial,
            interval_months: match r.step {
                Step::Months(n) => n,
                _ => 1,
            },
            interval_days: match r.step {
                Step::Days(n) => Some(n),
                _ => None,
            },
        })
        .collect();
    p.period_ends = period_ends(c, &p.id)?
        .into_iter()
        .map(|(s, e)| (s.to_string(), e.to_string()))
        .collect();
    let f = &p.fields;
    let amount: i128 = f
        .amount_cents
        .parse()
        .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?;
    let ends = period_ends(c, &p.id)?;
    let rate_at = |d: NaiveDate| -> Result<i64> {
        let rate: Option<i64> = c
            .query_row(
                "SELECT amount_cents FROM plan_rates WHERE plan_id=?1 AND effective_date<=?2 ORDER BY effective_date DESC LIMIT 1",
                params![p.id, d.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        Ok(rate.unwrap_or(amount as i64).max(0))
    };
    let paid: i64 = c.query_row("SELECT coalesce(sum(amount_cents),0) FROM plan_payments WHERE plan_id=?1 AND deleted_at IS NULL AND state='paid'",[&p.id],|r|r.get(0))?;
    p.paid_cents = Some(paid.to_string());
    if let Some(d) = &p.next_due {
        p.next_coverage = if f.coverage_start.is_some() {
            periods_for(c, f, &p.id, ends.clone())?.period_of_due(f, date(d)?)?
        } else {
            None
        };
    }
    // 当前负担按今天生效的价格折算（review R7）；固定天数按 365 天一次舍入。
    let now = date(today)?;
    let current =
        if f.trial_days.is_some() && f.coverage_start.as_deref().is_some_and(|d| d > today) {
            0
        } else {
            i128::from(rate_at(now)?)
        };
    p.monthly_cents = Some(match f.interval_days {
        Some(n) => {
            let annual = (current * 365 + i128::from(n) / 2) / i128::from(n);
            ((annual + 6) / 12).to_string()
        }
        None => ((current + i128::from(f.interval_months) / 2) / i128::from(f.interval_months))
            .to_string(),
    });
    if let Some(start) = &f.service_start {
        let start = rule_segments(c, &p.id)?
            .first()
            .and_then(|s| s.service)
            .unwrap_or(date(start)?);
        // 估算沿生效规则分段行走：历史期用所属时段的规则与价格，新规则
        // 只影响其生效日之后的期（review R4）。
        let segments = rule_segments(c, &p.id)?;
        let periods = if segments.is_empty() {
            Periods::new(f, ends.clone())?
        } else {
            Periods::with_segments(segments, ends.clone())?
        };
        let legacy_backfill =
            periods.segs[0].trial.is_none() && matches!(periods.segs[0].step, Step::Months(_));
        let mut k: i64 = if legacy_backfill {
            let months = i64::from(start.year() - periods.anchor().year()) * 12
                + i64::from(start.month())
                - i64::from(periods.anchor().month());
            months.div_euclid(match periods.segs[0].step {
                Step::Months(n) => i64::from(n),
                _ => 1,
            }) - 1
        } else {
            0
        };
        let stop = f.end_date.as_deref().map(date).transpose()?;
        let limit = stop.unwrap_or(now).max(now);
        let mut estimate = 0i128;
        let mut contract = 0i128;
        while let Some((d, end)) = periods.span(k)? {
            if d > limit {
                break;
            }
            if d >= start && stop.is_none_or(|e| d <= e) {
                let price = i128::from(rate_at(d)?);
                if d <= now {
                    estimate += price;
                    contract += price;
                } else {
                    contract += price;
                }
            }
            // 本期 = 覆盖今天的服务期；其原始期始日与特殊到期供高级区展示。
            if d <= now && end >= now {
                p.special_start = periods.original_start(k).map(|d| d.to_string());
                p.special_end = p
                    .special_start
                    .as_ref()
                    .and_then(|s| date(s).ok())
                    .and_then(|s| ends.get(&s).map(|e| e.to_string()));
            }
            k += 1;
        }
        p.estimated_cents = Some(estimate.to_string());
        p.contract_cents = stop.map(|_| contract.to_string());
    }
    // 尚未生效的未来价格段显示在高级区（设计 §4.5）。
    if let Some((from, cents)) = c
        .query_row(
            "SELECT effective_date,amount_cents FROM plan_rates WHERE plan_id=?1 AND effective_date>?2 ORDER BY effective_date LIMIT 1",
            params![p.id, today],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?.to_string())),
        )
        .optional()?
    {
        p.renewal_cents = Some(cents);
        p.renewal_from = Some(from);
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
                let ends = period_ends(&tx, &pl.id)?;
                if schedule_for(&tx, &pl.fields, &pl.id, &ends, due, due)?.is_empty() {
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
            let coverage = if pl.fields.coverage_start.is_some() {
                periods_for(&tx, &pl.fields, &pl.id, period_ends(&tx, &pl.id)?)?
                    .period_of_due(&pl.fields, due)?
            } else {
                None
            };
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
        let ends = period_ends(&tx, &p.id)?;
        if !input.confirmed
            || from > to
            || input.to_due.as_str() > today
            || schedule_for(&tx, &p.fields, &p.id, &ends, from, from)?.is_empty()
            || schedule_for(&tx, &p.fields, &p.id, &ends, to, to)?.is_empty()
        {
            return Err(Error::new(
                "PAYMENT_RANGE",
                "请明确确认有效的往期付款范围，不能晚于今天",
            ));
        }
        let amount = positive(&input.amount_cents, "PAYMENT_AMOUNT", "每期实付须为正数")?;
        let dates = schedule_for(&tx, &p.fields, &p.id, &ends, from, to)?;
        if dates.len() > 600 {
            return Err(Error::new("PAYMENT_RANGE", "一次最多补记 600 期"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        for d in dates {
            let exists: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM plan_payments WHERE plan_id=?1 AND due_date=?2 AND deleted_at IS NULL)",params![p.id,d.to_string()],|r|r.get(0))?;
            if exists {
                continue;
            }
            let coverage = if p.fields.coverage_start.is_some() {
                periods_for(&tx, &p.fields, &p.id, ends.clone())?.period_of_due(&p.fields, d)?
            } else {
                None
            };
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
            let ends = period_ends(c, &pid)?;
            let periods = f
                .coverage_start
                .is_some()
                .then(|| periods_for(c, f, &pid, ends.clone()))
                .transpose()?;
            // 待付款与预测按各期生效价格（review R7）。
            let rate_at = |d: NaiveDate| -> Result<i128> {
                let rate: Option<i64> = c
                    .query_row(
                        "SELECT amount_cents FROM plan_rates WHERE plan_id=?1 AND effective_date<=?2 ORDER BY effective_date DESC LIMIT 1",
                        params![pid, d.to_string()],
                        |r| r.get(0),
                    )
                    .optional()?;
                Ok(i128::from(rate.unwrap_or(amount as i64).max(0)))
            };
            let coverage = |d: NaiveDate| -> Option<(String, String)> {
                match &periods {
                    Some(p) => p.period_of_due(f, d).ok().flatten(),
                    None => None,
                }
            };
            let period_rate = |d: NaiveDate| -> Result<i128> {
                rate_at(coverage(d).map(|v| date(&v.0)).transpose()?.unwrap_or(d))
            };
            let item = |d: NaiveDate| Due {
                coverage_start: coverage(d).as_ref().map(|x| x.0.clone()),
                coverage_end: coverage(d).map(|x| x.1),
                plan_id: pid.clone(),
                plan_name: f.name.clone(),
                category: f.category.clone(),
                due_date: d.format("%Y-%m-%d").to_string(),
                amount_cents: period_rate(d).unwrap_or(amount).to_string(),
            };
            p.next_due = schedule_for(c, f, &pid, &ends, now.max(date(&p.active_from)?), year)?
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
                schedule_for(c, f, &pid, &ends, from, now)?
                    .into_iter()
                    .filter(|d| free(d))
                    .map(item),
            );
            upcoming.extend(
                schedule_for(c, f, &pid, &ends, now.succ_opt().unwrap_or(now), soon)?
                    .into_iter()
                    .filter(|d| free(d))
                    .map(item),
            );
            // 未来 12 个月预测逐期按实际日期与生效价格累计（设计 §5）。
            for d in schedule_for(c, f, &pid, &ends, now.succ_opt().unwrap_or(now), year)? {
                if free(&d) {
                    next12 += period_rate(d)?;
                }
            }
            if f.end_date.as_deref().is_none_or(|e| e >= today) {
                // 年化按今天生效的当前负担；固定天数按 365 天一次舍入。
                let current = if f.trial_days.is_some()
                    && f.coverage_start.as_deref().is_some_and(|d| d > today)
                {
                    0
                } else {
                    rate_at(now)?
                };
                annual += match f.interval_days {
                    Some(n) => (current * 365 + i128::from(n) / 2) / i128::from(n),
                    None => current * 12 / i128::from(f.interval_months),
                };
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
        "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from,NULL,NULL,NULL,NULL,1"
    } else if version < 22 {
        "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from,service_start,coverage_start,NULL,NULL,1"
    } else if version < 24 {
        "id,name,category,amount_cents,interval_months,first_due,end_date,paused,notes,revision,active_from,service_start,coverage_start,interval_days,trial_days,1"
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
    if version >= 23 {
        let mut q = c.prepare(
            "SELECT plan_id,effective_date,anchor,interval_months,interval_days FROM plan_rules",
        )?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let plan: String = r.get(0)?;
            let effective: String = r.get(1)?;
            let anchor: String = r.get(2)?;
            let months: i64 = r.get(3)?;
            let days: Option<i64> = r.get(4)?;
            let plan_ok: bool = c.query_row(
                "SELECT EXISTS(SELECT 1 FROM recurring_plans WHERE id=?1)",
                [&plan],
                |x| x.get(0),
            )?;
            if !plan_ok
                || date(&effective).is_err()
                || date(&anchor).is_err()
                || ![1, 3, 6, 12].contains(&months)
                || days.is_some_and(|d| !(1..=3650).contains(&d))
                || (days.is_some() && months != 1)
            {
                return Err(bad());
            }
        }
    }
    if version >= 24 {
        let mut q = c.prepare("SELECT first_due,service_start,trial_days FROM plan_rules")?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let due: Option<String> = r.get(0)?;
            let start: Option<String> = r.get(1)?;
            let trial: Option<u32> = r.get(2)?;
            if due.as_deref().is_none_or(|d| date(d).is_err())
                || start.as_deref().is_some_and(|d| date(d).is_err())
                || (trial.is_some() && start.is_none())
            {
                return Err(bad());
            }
        }
    }
    if version >= 22 {
        let mut q = c.prepare("SELECT period_start,coverage_end FROM plan_period_ends")?;
        let mut rows = q.query([])?;
        while let Some(r) = rows.next()? {
            let start: String = r.get(0)?;
            let end: String = r.get(1)?;
            if date(&start).is_err() || date(&end).is_err() || end < start {
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
            auto_renew: true,
            service_start: None,
            coverage_start: None,
            interval_days: None,
            trial_days: None,
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
        let got: Vec<_> = schedule(&f, &Default::default(), d("2026-01-01"), d("2026-05-31"))
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
        assert!(on_schedule(&f, &Default::default(), d("2026-02-28")).unwrap());
        assert!(!on_schedule(&f, &Default::default(), d("2026-03-28")).unwrap());
    }
}
