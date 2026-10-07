//! Savings per check-in interval (PLANNING_DESIGN §4). Facts only: everything
//! here is integer cents and integer arithmetic; assumptions and projections
//! belong to the front end.
//!
//! An interval runs between two consecutive complete check-ins, exactly the
//! pairs `wealth_summary` compares, so comparability (incomplete check-ins,
//! changed account scope) is decided in one place. Saving is the net-worth
//! change minus the change of the housing fund accounts (so deposits that were
//! later withdrawn into cash count as cash, not as spending); without a counted
//! housing fund account the deposits never entered the net worth and nothing is
//! subtracted. Spending is take-home pay plus deposits minus the net-worth
//! change, i.e. everything that was actually consumed.
use crate::{
    domain::{date, Error, Result},
    expenses::{Line, LINES},
    modules,
    storage::{digest, Store},
    wealth::Point,
};
use chrono::{Months, NaiveDate};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// 365.25 / 12 days per month, as the exact fraction 487/16.
const MONTH_NUM: i128 = 487;
const MONTH_DEN: i128 = 16;
/// Fewer comparable intervals than this are flagged as a small sample.
const MIN_SAMPLE: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct IncomeRow {
    pub date: String,
    pub net_cents: i64,
    pub hpf_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Interval {
    /// The check-in that ends the interval; also the key of its baseline mark.
    pub snapshot_id: String,
    pub from: String,
    pub to: String,
    pub days: i64,
    /// `ok`, `scope_changed` or `no_income`; only `ok` carries figures.
    pub status: &'static str,
    pub income_cents: String,
    pub hpf_cents: String,
    /// Change of the housing fund accounts' balance over the interval, when tracked.
    pub hpf_change_cents: Option<String>,
    /// Housing fund money that left the account (deposits − balance change, so
    /// interest counts as negative); an estimate, when tracked.
    pub hpf_out_cents: Option<String>,
    pub income_records: usize,
    pub delta_nw_cents: Option<String>,
    pub saving_cents: Option<String>,
    pub spend_cents: Option<String>,
    pub monthly_saving_cents: Option<String>,
    pub monthly_spend_cents: Option<String>,
    /// Saving ÷ after-tax income in hundredths of a percent; income must be > 0.
    pub rate_hundredths: Option<i64>,
    /// Fewer income rows than whole months in the interval.
    pub income_possibly_missing: bool,
    /// Marked as a one-off: shown, but kept out of the usual figures.
    pub excluded: bool,
    /// Ends within the last 12 months before the latest complete check-in.
    pub in_window: bool,
    /// Far from the usual monthly saving; worth a note on that check-in.
    pub anomaly: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Stats {
    /// Comparable, unmarked intervals inside the window.
    pub count: usize,
    pub change_count: usize,
    pub low_sample: bool,
    pub median_monthly_saving_cents: Option<String>,
    /// Weighted by interval length: total saving over total months.
    pub mean_monthly_saving_cents: Option<String>,
    pub median_monthly_spend_cents: Option<String>,
    pub median_monthly_change_cents: Option<String>,
    pub mean_monthly_change_cents: Option<String>,
    pub window_from: Option<String>,
    pub latest_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Review {
    pub generation: String,
    /// Oldest first.
    pub intervals: Vec<Interval>,
    pub stats: Stats,
    /// Check-ins that could not end an interval because they are incomplete.
    pub incomplete_count: usize,
}

/// Division rounded half away from zero.
fn round_div(n: i128, d: i128) -> i128 {
    let (q, r) = (n / d, n % d);
    if 2 * r.abs() >= d.abs() {
        q + n.signum() * d.signum()
    } else {
        q
    }
}

fn monthly(amount: i128, days: i64) -> i128 {
    round_div(amount * MONTH_NUM, MONTH_DEN * days as i128)
}

fn median(values: &mut [i128]) -> Option<i128> {
    values.sort_unstable();
    let n = values.len();
    match n {
        0 => None,
        _ if n % 2 == 1 => Some(values[n / 2]),
        _ => Some(round_div(values[n / 2 - 1] + values[n / 2], 2)),
    }
}

fn parse(d: &str) -> Result<NaiveDate> {
    date(d)
}

pub fn compute(
    points: &[Point],
    incomes: &[IncomeRow],
    marks: &BTreeSet<String>,
) -> Result<(Vec<Interval>, Stats, usize)> {
    let corrupt = || Error::new("FORMAT", "资料格式不兼容或损坏");
    let incomplete = points.iter().filter(|p| !p.complete).count();
    let latest = points
        .iter()
        .rev()
        .find(|p| p.complete)
        .map(|p| p.date.clone());
    let cutoff = match &latest {
        Some(d) => Some(
            parse(d)?
                .checked_sub_months(Months::new(12))
                .ok_or_else(corrupt)?
                .format("%Y-%m-%d")
                .to_string(),
        ),
        None => None,
    };
    let mut out = Vec::new();
    for p in points {
        let Some(from) = p.compared_to.clone().filter(|_| p.complete) else {
            continue;
        };
        let days = (parse(&p.date)? - parse(&from)?).num_days();
        if days < 1 {
            return Err(corrupt());
        }
        let rows: Vec<&IncomeRow> = incomes
            .iter()
            .filter(|i| i.date > from && i.date <= p.date)
            .collect();
        let income: i128 = rows.iter().map(|i| i.net_cents as i128).sum();
        let hpf: i128 = rows.iter().map(|i| i.hpf_cents as i128).sum();
        let mut interval = Interval {
            snapshot_id: p.snapshot_id.clone(),
            from,
            to: p.date.clone(),
            days,
            status: "ok",
            income_cents: income.to_string(),
            hpf_cents: hpf.to_string(),
            hpf_change_cents: None,
            hpf_out_cents: None,
            income_records: rows.len(),
            delta_nw_cents: None,
            saving_cents: None,
            spend_cents: None,
            monthly_saving_cents: None,
            monthly_spend_cents: None,
            rate_hundredths: None,
            income_possibly_missing: true,
            excluded: marks.contains(&p.snapshot_id),
            in_window: cutoff
                .as_ref()
                .is_some_and(|c| p.date.as_str() > c.as_str()),
            anomaly: false,
        };
        if p.scope_changed {
            interval.status = "scope_changed";
        } else if rows.is_empty() {
            interval.status = "no_income";
        } else {
            let delta: i128 = p
                .change_cents
                .as_deref()
                .ok_or_else(corrupt)?
                .parse()
                .map_err(|_| corrupt())?;
            let dh: Option<i128> = p
                .hpf_change_cents
                .as_deref()
                .map(|v| v.parse().map_err(|_| corrupt()))
                .transpose()?;
            // Tracked housing fund: only its balance change is set aside; what was
            // withdrawn into cash is cash. Untracked: deposits never entered the net worth.
            let (saving, spend, out) = match dh {
                Some(dh) => (delta - dh, income + hpf - delta, Some(hpf - dh)),
                None => (delta, income - delta, None),
            };
            interval.delta_nw_cents = Some(delta.to_string());
            interval.hpf_change_cents = dh.map(|v| v.to_string());
            interval.hpf_out_cents = out.map(|v| v.to_string());
            interval.saving_cents = Some(saving.to_string());
            interval.spend_cents = Some(spend.to_string());
            interval.monthly_saving_cents = Some(monthly(saving, days).to_string());
            interval.monthly_spend_cents = Some(monthly(spend, days).to_string());
            // The rate is measured against everything that could be saved: take-home pay
            // plus housing fund money that came out as cash.
            let base = income + out.unwrap_or(0).max(0);
            if base > 0 {
                interval.rate_hundredths = Some(round_div(saving * 10000, base) as i64);
            }
        }
        // Asset facts survive absent income. Income row count never confirms coverage.
        if !p.scope_changed {
            interval.delta_nw_cents = p.change_cents.clone();
            interval.hpf_change_cents = p.hpf_change_cents.clone();
        }
        out.push(interval);
    }

    // The usual figures: comparable, unmarked, inside the 12-month window.
    let usual: Vec<usize> = (0..out.len())
        .filter(|&i| out[i].status == "ok" && !out[i].excluded && out[i].in_window)
        .collect();
    let num = |s: &Option<String>| -> Result<i128> {
        s.as_deref()
            .ok_or_else(corrupt)?
            .parse()
            .map_err(|_| corrupt())
    };
    let mut savings = Vec::new();
    let mut spends = Vec::new();
    let (mut total_saving, mut total_income, mut total_days) = (0i128, 0i128, 0i128);
    for &i in &usual {
        savings.push(num(&out[i].monthly_saving_cents)?);
        spends.push(num(&out[i].monthly_spend_cents)?);
        total_saving += num(&out[i].saving_cents)?;
        total_income += out[i].income_cents.parse::<i128>().map_err(|_| corrupt())?;
        total_days += out[i].days as i128;
    }
    let mut stats = Stats {
        count: usual.len(),
        change_count: 0,
        low_sample: usual.len() < MIN_SAMPLE,
        window_from: cutoff,
        latest_date: latest,
        ..Stats::default()
    };
    let usual_saving = median(&mut savings.clone());
    if let Some(m) = usual_saving {
        stats.median_monthly_saving_cents = Some(m.to_string());
        stats.mean_monthly_saving_cents =
            Some(round_div(total_saving * MONTH_NUM, MONTH_DEN * total_days).to_string());
        stats.median_monthly_spend_cents = median(&mut spends).map(|v| v.to_string());
        if usual.len() >= MIN_SAMPLE {
            let income_month = round_div(total_income * MONTH_NUM, MONTH_DEN * total_days);
            let scale = m.abs().max(income_month / 10);
            for (&i, v) in usual.iter().zip(&savings) {
                out[i].anomaly = (v - m).abs() > 3 * scale;
            }
        }
    }
    let comparable: Vec<_> = out
        .iter()
        .filter(|i| i.delta_nw_cents.is_some() && !i.excluded && i.in_window)
        .collect();
    let mut changes: Vec<i128> = comparable
        .iter()
        .map(|i| Ok(monthly(num(&i.delta_nw_cents)?, i.days)))
        .collect::<Result<_>>()?;
    stats.change_count = comparable.len();
    stats.median_monthly_change_cents = median(&mut changes).map(|v| v.to_string());
    if !comparable.is_empty() {
        let total = comparable
            .iter()
            .try_fold(0i128, |s, i| Ok::<_, Error>(s + num(&i.delta_nw_cents)?))?;
        let days = comparable.iter().map(|i| i.days).sum();
        stats.mean_monthly_change_cents = Some(monthly(total, days).to_string());
    }
    Ok((out, stats, incomplete))
}

#[derive(Debug, Clone, Serialize)]
pub struct Reasons {
    pub generation: String,
    pub snapshot_id: String,
    pub from: String,
    pub to: String,
    pub notes: String,
    /// Dated lines inside the interval, newest first. Explanation only: they
    /// never adjust the figures.
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mark {
    pub request_id: String,
    pub generation: String,
    pub snapshot_id: String,
    pub excluded: bool,
}

impl Store {
    pub fn plan_review(&self) -> Result<Review> {
        let tx = self.conn()?.unchecked_transaction()?;
        let result = self.plan_review_in_transaction();
        tx.commit()?;
        result
    }

    /// Called only inside an already pinned read transaction (including the homepage).
    pub(crate) fn plan_review_in_transaction(&self) -> Result<Review> {
        let conn = self.conn()?;
        let summary = self.wealth_summary()?;
        let incomes = incomes(conn)?;
        let marks: BTreeSet<String> = conn
            .prepare("SELECT snapshot_id FROM plan_baseline_marks")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let (intervals, stats, incomplete_count) = compute(&summary.points, &incomes, &marks)?;
        Ok(Review {
            generation: self.generation(),
            intervals,
            stats,
            incomplete_count,
        })
    }

    /// What happened in one interval, for the "why" part of the review.
    pub fn plan_interval_reasons(&self, snapshot_id: &str) -> Result<Reasons> {
        let summary = self.wealth_summary()?;
        let point = summary
            .points
            .iter()
            .find(|p| p.snapshot_id == snapshot_id && p.complete)
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"))?;
        let from = point
            .compared_to
            .clone()
            .ok_or_else(|| Error::new("NOT_FOUND", "这次盘点没有可比较的上一次完整盘点"))?;
        let m = modules::read(&self.root);
        let c = self.conn()?;
        let mut q = c.prepare(LINES)?;
        let mut lines = q
            .query_map([], |r| {
                Ok(Line {
                    source: r.get(0)?,
                    id: r.get(1)?,
                    asset_id: r.get(2)?,
                    title: r.get(3)?,
                    category: r.get(4)?,
                    date: r.get(5)?,
                    amount_cents: r.get::<_, Option<i64>>(6)?.map(|v| v.to_string()),
                    notes: r.get(7)?,
                    plan_id: r.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        lines.retain(|l| {
            let in_range = l
                .date
                .as_deref()
                .is_some_and(|d| d > from.as_str() && d <= point.date.as_str());
            let enabled = match l.source.as_str() {
                "expense" | "linked" | "refund" => m.expenses,
                "payment" => m.recurring,
                "virtual" | "topup" => m.virtual_assets,
                _ => true,
            };
            in_range && enabled && l.amount_cents.is_some()
        });
        lines.sort_by(|a, b| {
            b.date
                .cmp(&a.date)
                .then_with(|| a.source.cmp(&b.source))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(Reasons {
            generation: self.generation(),
            snapshot_id: snapshot_id.to_owned(),
            from,
            to: point.date.clone(),
            notes: point.notes.clone(),
            lines,
        })
    }

    pub fn plan_baseline_mark(&mut self, input: &Mark) -> Result<()> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("plan_mark", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let prior: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM feature_requests WHERE id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(f) = prior {
            if f != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
            }
            return Ok(());
        }
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM fin_snapshots WHERE id=?1 AND deleted_at IS NULL)",
            [&input.snapshot_id],
            |r| r.get(0),
        )?;
        if !live {
            return Err(Error::new("NOT_FOUND", "找不到这次盘点"));
        }
        if input.excluded {
            tx.execute(
                "INSERT OR IGNORE INTO plan_baseline_marks(snapshot_id) VALUES(?1)",
                [&input.snapshot_id],
            )?;
        } else {
            tx.execute(
                "DELETE FROM plan_baseline_marks WHERE snapshot_id=?1",
                [&input.snapshot_id],
            )?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.snapshot_id],
        )?;
        self.hit("plan_mark.before_commit")?;
        tx.commit()?;
        self.hit("plan_mark.after_commit")?;
        Ok(())
    }
}

fn incomes(c: &rusqlite::Connection) -> Result<Vec<IncomeRow>> {
    let mut q = c.prepare(
        "SELECT date,net_cents,hpf_cents FROM plan_income WHERE deleted_at IS NULL ORDER BY date,id",
    )?;
    let rows = q
        .query_map([], |r| {
            Ok(IncomeRow {
                date: r.get(0)?,
                net_cents: r.get(1)?,
                hpf_cents: r.get(2)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(id: &str, day: &str, prev: Option<&str>, change: Option<i64>) -> Point {
        Point {
            snapshot_id: id.into(),
            date: day.into(),
            notes: String::new(),
            assets_cents: "0".into(),
            liabilities_cents: "0".into(),
            net_cents: "0".into(),
            complete: true,
            missing: 0,
            compared_to: prev.map(Into::into),
            scope_changed: false,
            change_cents: change.map(|c| c.to_string()),
            hpf_change_cents: None,
            change_rate_hundredths: None,
        }
    }
    /// The same point with the housing fund balance change known (tracked account).
    fn tracked(mut p: Point, hpf_change: i64) -> Point {
        p.hpf_change_cents = Some(hpf_change.to_string());
        p
    }
    fn pay(day: &str, net: i64, hpf: i64) -> IncomeRow {
        IncomeRow {
            date: day.into(),
            net_cents: net,
            hpf_cents: hpf,
        }
    }
    fn none() -> BTreeSet<String> {
        BTreeSet::new()
    }

    #[test]
    fn saving_removes_housing_fund_deposits_and_spending_is_the_rest() {
        // Two months: pay 20 000 + deposit 3 000 each; net worth up 25 000.
        let points = [
            point("a", "2026-01-31", None, None),
            tracked(
                point("b", "2026-03-31", Some("2026-01-31"), Some(2_500_000)),
                600_000,
            ),
        ];
        let incomes = [
            pay("2026-02-15", 2_000_000, 300_000),
            pay("2026-03-15", 2_000_000, 300_000),
        ];
        let (v, _, _) = compute(&points, &incomes, &none()).unwrap();
        assert_eq!(v.len(), 1);
        let i = &v[0];
        assert_eq!(i.status, "ok");
        // saving = 25 000 − 6 000; spending = 40 000 + 6 000 − 25 000.
        assert_eq!(i.saving_cents.as_deref(), Some("1900000"));
        assert_eq!(i.spend_cents.as_deref(), Some("2100000"));
        // 59 days → 1 900 000 × 487/16 ÷ 59 = 980 190.7… rounded.
        assert_eq!(i.days, 59);
        assert_eq!(i.monthly_saving_cents.as_deref(), Some("980191"));
        // 1 900 000 ÷ 4 000 000 = 47.5 %.
        assert_eq!(i.rate_hundredths, Some(4750));
        assert!(i.income_possibly_missing);
    }

    #[test]
    fn housing_fund_money_withdrawn_into_cash_counts_as_cash_saving() {
        // Deposits 6 000 over two months, 2 000 withdrawn: the account grew by 4 000.
        let points = [
            point("a", "2026-01-31", None, None),
            tracked(
                point("b", "2026-03-31", Some("2026-01-31"), Some(2_500_000)),
                400_000,
            ),
        ];
        let incomes = [
            pay("2026-02-15", 2_000_000, 300_000),
            pay("2026-03-15", 2_000_000, 300_000),
        ];
        let i = &compute(&points, &incomes, &none()).unwrap().0[0];
        assert_eq!(i.hpf_change_cents.as_deref(), Some("400000"));
        assert_eq!(i.hpf_out_cents.as_deref(), Some("200000"));
        // saving = 25 000 − 4 000 (the cash side); spending is unchanged: 40 000 + 6 000 − 25 000.
        assert_eq!(i.saving_cents.as_deref(), Some("2100000"));
        assert_eq!(i.spend_cents.as_deref(), Some("2100000"));
        // rate against take-home pay plus the 2 000 that came out as cash.
        assert_eq!(i.rate_hundredths, Some(5000));
        // Interest makes the balance grow more than the deposits: no negative withdrawal in the base.
        let grown = [
            point("a", "2026-01-31", None, None),
            tracked(
                point("b", "2026-03-31", Some("2026-01-31"), Some(2_500_000)),
                610_000,
            ),
        ];
        let g = &compute(&grown, &incomes, &none()).unwrap().0[0];
        assert_eq!(g.hpf_out_cents.as_deref(), Some("-10000"));
        assert_eq!(
            g.rate_hundredths,
            Some(round_div(1_890_000 * 10000, 4_000_000) as i64)
        );
    }

    #[test]
    fn deposits_without_a_counted_housing_fund_account_are_not_taken_out_of_saving() {
        let points = [
            point("a", "2026-01-31", None, None),
            point("b", "2026-03-31", Some("2026-01-31"), Some(2_500_000)),
        ];
        let incomes = [
            pay("2026-02-15", 2_000_000, 300_000),
            pay("2026-03-15", 2_000_000, 300_000),
        ];
        let i = &compute(&points, &incomes, &none()).unwrap().0[0];
        assert_eq!(i.hpf_change_cents, None);
        assert_eq!(i.hpf_out_cents, None);
        assert_eq!(i.saving_cents.as_deref(), Some("2500000"));
        assert_eq!(i.spend_cents.as_deref(), Some("1500000"));
    }

    #[test]
    fn a_withdrawal_between_accounts_does_not_change_the_result() {
        // Net worth is unchanged by moving fund money to cash, so the same
        // inputs give the same answer; this pins the formula to net worth.
        let points = [
            point("a", "2026-01-01", None, None),
            point("b", "2026-02-01", Some("2026-01-01"), Some(1_000_000)),
        ];
        let incomes = [pay("2026-01-15", 1_500_000, 0)];
        let (v, _, _) = compute(&points, &incomes, &none()).unwrap();
        assert_eq!(v[0].saving_cents.as_deref(), Some("1000000"));
        assert_eq!(v[0].spend_cents.as_deref(), Some("500000"));
    }

    #[test]
    fn saving_and_spending_can_be_negative() {
        let points = [
            point("a", "2026-01-01", None, None),
            point("b", "2026-02-01", Some("2026-01-01"), Some(-300_000)),
        ];
        let (v, _, _) = compute(&points, &[pay("2026-01-20", 100_000, 0)], &none()).unwrap();
        assert_eq!(v[0].saving_cents.as_deref(), Some("-300000"));
        assert_eq!(v[0].spend_cents.as_deref(), Some("400000"));
        assert_eq!(v[0].rate_hundredths, Some(-30000));
    }

    #[test]
    fn interval_without_income_or_with_changed_scope_has_no_figures() {
        let mut changed = point("c", "2026-03-01", Some("2026-02-01"), None);
        changed.scope_changed = true;
        let points = [
            point("a", "2026-01-01", None, None),
            point("b", "2026-02-01", Some("2026-01-01"), Some(10)),
            changed,
        ];
        let (v, stats, _) = compute(&points, &[], &none()).unwrap();
        assert_eq!(v[0].status, "no_income");
        assert_eq!(v[0].saving_cents, None);
        assert_eq!(v[1].status, "scope_changed");
        assert_eq!(stats.count, 0);
        assert_eq!(stats.median_monthly_saving_cents, None);
    }

    #[test]
    fn income_on_the_start_date_belongs_to_the_earlier_interval() {
        let points = [
            point("a", "2026-01-15", None, None),
            point("b", "2026-02-15", Some("2026-01-15"), Some(0)),
        ];
        // 01-15 is the start (excluded), 02-15 the end (included).
        let incomes = [pay("2026-01-15", 111, 0), pay("2026-02-15", 222, 0)];
        let (v, _, _) = compute(&points, &incomes, &none()).unwrap();
        assert_eq!(v[0].income_cents, "222");
        assert_eq!(v[0].income_records, 1);
    }

    #[test]
    fn unequal_gaps_are_normalised_to_months() {
        let points = [
            point("a", "2026-01-01", None, None),
            point("b", "2026-02-01", Some("2026-01-01"), Some(100_000)), // 31 days
            point("c", "2026-05-02", Some("2026-02-01"), Some(300_000)), // 90 days
        ];
        let incomes = [pay("2026-01-20", 1, 0), pay("2026-03-20", 1, 0)];
        let (v, _, _) = compute(&points, &incomes, &none()).unwrap();
        // Each is S − 0 over its own length: 100 000 ×487/16/31 and 300 000 ×487/16/90.
        assert_eq!(v[0].monthly_saving_cents.as_deref(), Some("98185"));
        assert_eq!(v[1].monthly_saving_cents.as_deref(), Some("101458"));
    }

    #[test]
    fn missing_income_months_are_flagged_but_still_computed() {
        let points = [
            point("a", "2026-01-01", None, None),
            point("b", "2026-04-01", Some("2026-01-01"), Some(0)), // 90 days ≈ 2.96 months
        ];
        let (v, _, _) = compute(&points, &[pay("2026-02-10", 5, 0)], &none()).unwrap();
        assert!(v[0].income_possibly_missing);
        assert_eq!(v[0].status, "ok");
        let full = [pay("2026-02-10", 5, 0), pay("2026-03-10", 5, 0)];
        let (v, _, _) = compute(&points, &full, &none()).unwrap();
        assert!(v[0].income_possibly_missing);
    }

    #[test]
    fn rolling_figures_use_median_weighted_mean_and_skip_marked_intervals() {
        // Four 30-day-ish intervals ending inside the window; one marked.
        let points = [
            point("p0", "2026-01-01", None, None),
            point("p1", "2026-02-01", Some("2026-01-01"), Some(100_000)),
            point("p2", "2026-03-01", Some("2026-02-01"), Some(300_000)),
            point("p3", "2026-04-01", Some("2026-03-01"), Some(200_000)),
            point("p4", "2026-05-01", Some("2026-04-01"), Some(9_000_000)),
        ];
        let incomes: Vec<IncomeRow> = ["01-15", "02-15", "03-15", "04-15"]
            .iter()
            .map(|d| pay(&format!("2026-{d}"), 1_000_000, 0))
            .collect();
        let marks: BTreeSet<String> = ["p4".to_string()].into();
        let (v, stats, _) = compute(&points, &incomes, &marks).unwrap();
        assert!(v[3].excluded);
        assert_eq!(stats.count, 3);
        assert!(!stats.low_sample);
        // Monthly values of the three unmarked: 100k, 300k, 200k over 31/28/31 days.
        let months: Vec<i64> = v[..3]
            .iter()
            .map(|i| i.monthly_saving_cents.as_deref().unwrap().parse().unwrap())
            .collect();
        let mut sorted = months.clone();
        sorted.sort_unstable();
        assert_eq!(
            stats.median_monthly_saving_cents.as_deref(),
            Some(sorted[1].to_string().as_str())
        );
        // Weighted mean = 600 000 × 487/16 ÷ 90 days.
        assert_eq!(stats.mean_monthly_saving_cents.as_deref(), Some("202917"));
        assert!(
            v.iter().all(|i| !i.anomaly),
            "marked interval is never flagged"
        );
    }

    #[test]
    fn an_interval_far_from_the_median_is_flagged_only_with_enough_samples() {
        let mk = |changes: &[i64]| {
            let mut points = vec![point("p0", "2026-01-01", None, None)];
            let mut incomes = Vec::new();
            for (n, c) in changes.iter().enumerate() {
                let (prev, day) = (
                    format!("2026-{:02}-01", n + 1),
                    format!("2026-{:02}-01", n + 2),
                );
                points.push(point(&format!("p{}", n + 1), &day, Some(&prev), Some(*c)));
                incomes.push(pay(&format!("2026-{:02}-15", n + 1), 1_000_000, 0));
            }
            compute(&points, &incomes, &none()).unwrap().0
        };
        let v = mk(&[300_000, 310_000, 290_000, 4_000_000]);
        assert!(v[3].anomaly);
        assert!(v[..3].iter().all(|i| !i.anomaly));
        let few = mk(&[300_000, 4_000_000]);
        assert!(few.iter().all(|i| !i.anomaly));
    }

    #[test]
    fn small_samples_are_flagged_and_old_intervals_leave_the_window() {
        let points = [
            point("p0", "2024-01-01", None, None),
            point("p1", "2024-02-01", Some("2024-01-01"), Some(100)),
            point("p2", "2026-01-01", Some("2024-02-01"), Some(200)),
            point("p3", "2026-02-01", Some("2026-01-01"), Some(300)),
        ];
        let incomes = [
            pay("2024-01-15", 1, 0),
            pay("2025-06-15", 1, 0),
            pay("2026-01-15", 1, 0),
        ];
        let (v, stats, _) = compute(&points, &incomes, &none()).unwrap();
        assert!(
            !v[0].in_window,
            "ended more than 12 months before the latest"
        );
        assert!(v[1].in_window && v[2].in_window);
        assert_eq!(stats.count, 2);
        assert!(stats.low_sample);
        assert_eq!(stats.latest_date.as_deref(), Some("2026-02-01"));
        assert_eq!(stats.window_from.as_deref(), Some("2025-02-01"));
    }

    #[test]
    fn incomplete_checkins_are_counted_and_never_end_an_interval() {
        let mut gap = point("g", "2026-02-01", None, None);
        gap.complete = false;
        gap.missing = 1;
        let points = [
            point("a", "2026-01-01", None, None),
            gap,
            point("b", "2026-03-01", Some("2026-01-01"), Some(10)),
        ];
        let (v, _, incomplete) = compute(&points, &[pay("2026-02-10", 1, 0)], &none()).unwrap();
        assert_eq!(incomplete, 1);
        assert_eq!(v.len(), 1);
        assert_eq!(
            (v[0].from.as_str(), v[0].to.as_str()),
            ("2026-01-01", "2026-03-01")
        );
    }

    #[test]
    fn rounding_is_half_away_from_zero() {
        assert_eq!(round_div(5, 2), 3);
        assert_eq!(round_div(-5, 2), -3);
        assert_eq!(round_div(4, 3), 1);
        assert_eq!(round_div(-4, 3), -1);
        assert_eq!(median(&mut [1, 2]), Some(2));
        assert_eq!(median(&mut [-1, -2]), Some(-2));
    }
}
