//! History of the goal conclusion, one point per complete check-in.
//!
//! The browser computes the conclusion (the planning engine lives there); this
//! module only validates and keeps it. A point is written once per snapshot
//! revision and keeps the conditions of that day, so later changes to the goal
//! never rewrite history. Unknown stays unknown: every figure may be absent.
use crate::{
    domain::{date, Error, Result},
    storage::Store,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Most recent points returned; older ones stay stored.
const LIST_LIMIT: usize = 24;
const MAX_ABS_CENTS: i64 = 999_999_999_999;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    /// "fire" or "traditional", as the goal was set that day.
    pub mode: String,
    pub target_month: Option<String>,
    /// Funds counted as available at that check-in.
    pub available_cents: Option<String>,
    /// Fixed-target saving needed per month.
    pub required_monthly_cents: Option<String>,
    /// The user's own monthly estimate on that day.
    pub entered_monthly_cents: Option<String>,
    /// Whether the saved estimate covered the plan; absent without an estimate.
    pub success: Option<bool>,
    pub shortfall_at_goal_cents: Option<String>,
    pub predicted_retire_month: Option<String>,
    /// Conditions were still unconfirmed or missing on that day.
    pub has_open_items: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub generation: String,
    pub snapshot_id: String,
    pub snapshot_revision: i64,
    pub point: Point,
}

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub snapshot_id: String,
    pub date: String,
    pub recorded_on: String,
    pub point: Point,
}

fn signed_cents(value: &Option<String>) -> Result<()> {
    let Some(v) = value else {
        return Ok(());
    };
    match v.parse::<i64>() {
        Ok(n) if n.abs() <= MAX_ABS_CENTS && v == &n.to_string() => Ok(()),
        _ => Err(Error::new("GOAL_PROGRESS", "进度金额须为整数分")),
    }
}
fn month(value: &Option<String>) -> Result<()> {
    let Some(v) = value else {
        return Ok(());
    };
    date(&format!("{v}-01"))
        .map(|_| ())
        .map_err(|_| Error::new("GOAL_PROGRESS", "进度月份须为 YYYY-MM"))
}
impl Point {
    fn validate(&self) -> Result<()> {
        if !["fire", "traditional"].contains(&self.mode.as_str()) {
            return Err(Error::new("GOAL_PROGRESS", "目标类型无效"));
        }
        month(&self.target_month)?;
        month(&self.predicted_retire_month)?;
        for v in [
            &self.available_cents,
            &self.required_monthly_cents,
            &self.entered_monthly_cents,
            &self.shortfall_at_goal_cents,
        ] {
            signed_cents(v)?;
        }
        Ok(())
    }
}

impl Store {
    /// Filter the year before selecting records; the recent-24 UI window must
    /// never erase older years from an annual review.
    pub(crate) fn goal_progress_year(&self, year: i32) -> Result<Vec<Entry>> {
        if !(1..=9999).contains(&year) {
            return Err(Error::new("YEAR", "年份须为1–9999"));
        }
        let c = self.conn()?;
        let mut q = c.prepare("SELECT p.snapshot_id,s.date,p.recorded_on,p.payload FROM goal_progress p JOIN fin_snapshots s ON s.id=p.snapshot_id WHERE s.deleted_at IS NULL AND s.revision=p.snapshot_revision AND s.date>=?1 AND s.date<=?2 ORDER BY s.date,s.id")?;
        let rows = q
            .query_map(
                [format!("{year:04}-01-01"), format!("{year:04}-12-31")],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for (snapshot_id, date, recorded_on, payload) in rows {
            if self
                .wealth_snapshot(&snapshot_id)?
                .is_some_and(|s| s.missing.is_empty())
            {
                out.push(Entry {
                    snapshot_id,
                    date,
                    recorded_on,
                    point: serde_json::from_str(&payload)?,
                });
            }
        }
        Ok(out)
    }
    /// Keeps the first conclusion for a snapshot revision; a newer revision of a
    /// corrected check-in replaces the stale point. Incomplete, deleted or
    /// outdated check-ins are refused, so the history only holds comparable days.
    pub fn goal_progress_record(&self, input: &Record, today: &str) -> Result<()> {
        self.check_generation(&input.generation)?;
        date(today)?;
        input.point.validate()?;
        let complete = self
            .wealth_summary()?
            .points
            .iter()
            .any(|p| p.snapshot_id == input.snapshot_id && p.complete);
        let tx = self.conn()?.unchecked_transaction()?;
        let current: Option<(i64, Option<String>)> = tx
            .query_row(
                "SELECT revision,deleted_at FROM fin_snapshots WHERE id=?1",
                [&input.snapshot_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match current {
            Some((revision, None)) if revision == input.snapshot_revision && complete => {}
            Some((revision, None)) if revision != input.snapshot_revision => {
                return Err(Error::new("STALE_REVISION", "这次盘点已被更正，请重新读取"))
            }
            _ => {
                return Err(Error::new(
                    "GOAL_PROGRESS",
                    "只有完整且未删除的盘点才记录目标进度",
                ))
            }
        }
        tx.execute(
            "INSERT INTO goal_progress(snapshot_id,snapshot_revision,recorded_on,payload,created_at) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(snapshot_id) DO UPDATE SET snapshot_revision=excluded.snapshot_revision,recorded_on=excluded.recorded_on,payload=excluded.payload,created_at=excluded.created_at
             WHERE goal_progress.snapshot_revision<excluded.snapshot_revision",
            params![
                input.snapshot_id,
                input.snapshot_revision,
                today,
                serde_json::to_string(&input.point)?,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        self.hit("goal_progress.before_commit")?;
        tx.commit()?;
        Ok(())
    }

    /// Oldest first. Points of deleted or since-corrected check-ins are hidden.
    pub fn goal_progress_list(&self) -> Result<Vec<Entry>> {
        let c = self.conn()?;
        let mut q = c.prepare(
            "SELECT p.snapshot_id,s.date,p.recorded_on,p.payload FROM goal_progress p
             JOIN fin_snapshots s ON s.id=p.snapshot_id
             WHERE s.deleted_at IS NULL AND s.revision=p.snapshot_revision
             ORDER BY s.date DESC,s.id DESC LIMIT ?1",
        )?;
        let mut rows = q
            .query_map([LIST_LIMIT as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(snapshot_id, date, recorded_on, payload)| {
                Ok(Entry {
                    snapshot_id,
                    date,
                    recorded_on,
                    point: serde_json::from_str(&payload)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        rows.reverse();
        Ok(rows)
    }
}
