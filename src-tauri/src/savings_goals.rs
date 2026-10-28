//! Ordinary reference goals. Balances always come from one complete check-in.
use crate::{
    domain::{date, Error, Result},
    modules::RuntimeModules,
    storage::{digest, uid, Store},
    wealth::{Account, Snapshot},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub name: String,
    pub target_cents: String,
    pub target_date: Option<String>,
    pub notes: String,
}
impl Fields {
    fn validate(&self) -> Result<i64> {
        if self.name.trim().is_empty()
            || self.name.trim().chars().count() > 60
            || self.notes.chars().count() > 500
            || self.name.contains('\0')
            || self.notes.contains('\0')
        {
            return Err(Error::new(
                "GOAL_FIELDS",
                "名称须为1–60字，备注最多500字，不能含空字符",
            ));
        }
        let amount = self
            .target_cents
            .parse::<i64>()
            .ok()
            .filter(|n| (1..=99_999_999_999).contains(n) && n.to_string() == self.target_cents)
            .ok_or_else(|| Error::new("GOAL_AMOUNT", "目标金额须为正的整数分，且不超过金额上限"))?;
        if let Some(day) = &self.target_date {
            date(day)?;
        }
        Ok(amount)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
    pub account_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trash {
    pub request_id: String,
    pub generation: String,
    pub id: String,
    pub expected_revision: i64,
    pub deleted: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct Goal {
    pub id: String,
    pub fields: Fields,
    pub account_ids: Vec<String>,
    pub position: i64,
    pub revision: i64,
    pub created_on: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Observation {
    pub account_id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub amount_cents: Option<String>,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Basis {
    pub snapshot_id: String,
    pub date: String,
    pub revision: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct HistoryPoint {
    pub basis: Basis,
    pub observations: Vec<Observation>,
}
#[derive(Clone, Debug, Serialize)]
pub struct GoalView {
    pub goal: Goal,
    pub observations: Vec<Observation>,
    pub shared_account_ids: Vec<String>,
    pub planning_overlap: Option<bool>,
    pub history: Vec<HistoryPoint>,
}
#[derive(Debug, Serialize)]
pub struct Read {
    pub generation: String,
    pub write_version: u64,
    pub today: String,
    pub year: i32,
    pub years: Vec<i32>,
    pub basis: Option<Basis>,
    pub newer_incomplete: bool,
    pub accounts: Vec<Account>,
    pub goals: Vec<GoalView>,
}
fn enabled(value: bool) -> Result<()> {
    if !value {
        return Err(Error::new(
            "MODULE_DISABLED",
            "账户与盘点已关闭，本次未读取或修改目标",
        ));
    }
    Ok(())
}
fn request(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
    uuid::Uuid::parse_str(id).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match prior {
        Some((old, _)) if old != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"))
        }
        Some((_, result)) => Ok(Some(result)),
        None => Ok(None),
    }
}
pub(crate) fn list(c: &Connection, include_deleted: bool) -> Result<Vec<Goal>> {
    let mut q=c.prepare("SELECT id,name,target_cents,target_date,notes,position,revision,created_on,created_at,updated_at,deleted_at FROM savings_goals WHERE (?1 OR deleted_at IS NULL) ORDER BY position,id")?;
    let mut goals = q
        .query_map([include_deleted], |r| {
            Ok(Goal {
                id: r.get(0)?,
                fields: Fields {
                    name: r.get(1)?,
                    target_cents: r.get::<_, i64>(2)?.to_string(),
                    target_date: r.get(3)?,
                    notes: r.get(4)?,
                },
                account_ids: vec![],
                position: r.get(5)?,
                revision: r.get(6)?,
                created_on: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
                deleted_at: r.get(10)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut links = c.prepare(
        "SELECT account_id FROM savings_goal_accounts WHERE goal_id=?1 ORDER BY account_id",
    )?;
    for g in &mut goals {
        g.account_ids = links
            .query_map([&g.id], |r| r.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
    }
    Ok(goals)
}
fn goal(c: &Connection, id: &str) -> Result<Goal> {
    list(c, true)?
        .into_iter()
        .find(|g| g.id == id)
        .ok_or_else(|| Error::new("NOT_FOUND", "找不到存钱目标"))
}
fn basis(s: &Snapshot) -> Basis {
    Basis {
        snapshot_id: s.id.clone(),
        date: s.date.clone(),
        revision: s.revision,
    }
}

fn observations(
    c: &Connection,
    g: &Goal,
    s: Option<&Snapshot>,
    today: &str,
    current: bool,
) -> Result<Vec<Observation>> {
    g.account_ids
        .iter()
        .map(|id| {
            let (name, kind, side, closed, deleted): (
                String,
                String,
                String,
                Option<String>,
                Option<String>,
            ) = c.query_row(
                "SELECT name,kind,side,closed_on,deleted_at FROM fin_accounts WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )?;
            let e = s.and_then(|s| s.entries.iter().find(|e| e.account_id == *id));
            let invalid_current = current
                && (deleted.is_some()
                    || closed.as_deref().is_some_and(|d| d <= today)
                    || side != "asset"
                    || kind == "property");
            let invalid_basis = e.is_some_and(|e| e.side != "asset" || e.kind == "property");
            let (status, amount, reason) = if invalid_current || invalid_basis {
                (
                    "unavailable",
                    None,
                    "关联账户已停用、删除或不符合该次资产口径，请处理关系",
                )
            } else if let Some(e) = e.filter(|e| e.amount_cents.is_some()) {
                ("known", e.amount_cents.clone(), "")
            } else {
                ("missing", None, "该次完整盘点没有此账户的已知余额")
            };
            Ok(Observation {
                account_id: id.clone(),
                name,
                kind: e.map_or(kind, |e| e.kind.clone()),
                status: status.into(),
                amount_cents: amount,
                reason: reason.into(),
            })
        })
        .collect()
}

impl Store {
    pub fn savings_goals_save(
        &mut self,
        input: &Save,
        today: &str,
        wealth_enabled: bool,
    ) -> Result<Goal> {
        self.check_generation(&input.generation)?;
        enabled(wealth_enabled)?;
        date(today)?;
        let fingerprint = digest(&serde_json::to_vec(&("savings_goals_save", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = request(&tx, &input.request_id, &fingerprint)? {
            return goal(&tx, &id);
        }
        let amount = input.fields.validate()?;
        let old = input.id.as_deref().map(|id| goal(&tx, id)).transpose()?;
        if old.as_ref().map(|g| g.revision) != input.expected_revision
            || old.as_ref().is_some_and(|g| g.deleted_at.is_some())
        {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "目标已变化或已删除，请重新读取",
            ));
        }
        let ids: BTreeSet<_> = input.account_ids.iter().collect();
        if ids.is_empty() || ids.len() != input.account_ids.len() {
            return Err(Error::new(
                "GOAL_ACCOUNTS",
                "请选择至少一个账户，同一目标不能重复选择账户",
            ));
        }
        for id in &ids {
            uuid::Uuid::parse_str(id).map_err(|_| Error::new("GOAL_ACCOUNTS", "账户标识无效"))?;
            let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM fin_accounts WHERE id=?1 AND side='asset' AND kind<>'property' AND deleted_at IS NULL AND (closed_on IS NULL OR closed_on>?2))",params![id,today],|r|r.get(0))?;
            if !valid && !old.as_ref().is_some_and(|g| g.account_ids.contains(id)) {
                return Err(Error::new(
                    "GOAL_ACCOUNTS",
                    "新关联须为未删除、未停用的非房产资产账户",
                ));
            }
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE savings_goals SET name=?2,target_cents=?3,target_date=?4,notes=?5,revision=revision+1,updated_at=?6 WHERE id=?1",params![id,input.fields.name.trim(),amount,input.fields.target_date,input.fields.notes,now])?;
            tx.execute("DELETE FROM savings_goal_accounts WHERE goal_id=?1", [&id])?;
        } else {
            let pos: i64 = tx.query_row(
                "SELECT coalesce(max(position)+1,0) FROM savings_goals",
                [],
                |r| r.get(0),
            )?;
            tx.execute("INSERT INTO savings_goals(id,name,target_cents,target_date,notes,position,revision,created_on,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?8,?8)",params![id,input.fields.name.trim(),amount,input.fields.target_date,input.fields.notes,pos,today,now])?;
        }
        for account in ids {
            tx.execute(
                "INSERT INTO savings_goal_accounts VALUES(?1,?2)",
                params![id, account],
            )?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        self.hit("savings_goals.before_commit")?;
        let result = goal(&tx, &id)?;
        tx.commit()?;
        self.hit("savings_goals.after_commit")?;
        Ok(result)
    }
    pub fn savings_goals_trash(&mut self, input: &Trash, wealth_enabled: bool) -> Result<()> {
        self.check_generation(&input.generation)?;
        enabled(wealth_enabled)?;
        let fingerprint = digest(&serde_json::to_vec(&("savings_goals_trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if request(&tx, &input.request_id, &fingerprint)?.is_some() {
            return Ok(());
        }
        let old = goal(&tx, &input.id)?;
        if old.revision != input.expected_revision || old.deleted_at.is_some() == input.deleted {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "目标状态已变化，请重新读取",
            ));
        }
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE savings_goals SET deleted_at=?2,updated_at=?3,revision=revision+1 WHERE id=?1",
            params![input.id, input.deleted.then_some(&now), now],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.id],
        )?;
        self.hit("savings_goals.before_commit")?;
        tx.commit()?;
        self.hit("savings_goals.after_commit")?;
        Ok(())
    }
    pub fn savings_goals_read(
        &self,
        generation: &str,
        year: Option<i32>,
        today: &str,
        modules: &RuntimeModules,
    ) -> Result<Read> {
        self.check_generation(generation)?;
        enabled(modules.modules.wealth)?;
        date(today)?;
        let tx = self.conn()?.unchecked_transaction()?;
        let result = self.savings_goals_in_transaction(year, today, modules)?;
        tx.commit()?;
        Ok(result)
    }
    pub(crate) fn savings_goals_in_transaction(
        &self,
        year: Option<i32>,
        today: &str,
        modules: &RuntimeModules,
    ) -> Result<Read> {
        enabled(modules.modules.wealth)?;
        let year = year.unwrap_or_else(|| today[..4].parse().unwrap_or(1));
        if !(1..=9999).contains(&year) {
            return Err(Error::new("YEAR", "年份须为1–9999"));
        }
        let c = self.conn()?;
        let goals = list(c, false)?;
        let summary = self.wealth_summary()?;
        let latest = summary.points.iter().rev().find(|p| p.complete);
        let latest_snapshot = latest
            .map(|p| self.wealth_snapshot(&p.snapshot_id))
            .transpose()?
            .flatten();
        let newer_incomplete = summary.points.last().is_some_and(|p| !p.complete);
        let start = format!("{year:04}-01-01");
        let end = format!("{year:04}-12-31");
        let prior = summary
            .points
            .iter()
            .rev()
            .find(|p| p.complete && p.date < start);
        let history = summary
            .points
            .iter()
            .filter(|p| {
                p.complete
                    && ((p.date >= start && p.date <= end)
                        || prior.is_some_and(|b| b.snapshot_id == p.snapshot_id))
            })
            .map(|p| {
                self.wealth_snapshot(&p.snapshot_id)?
                    .ok_or_else(|| Error::new("STALE_BASIS", "盘点已变化"))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut use_count: BTreeMap<&str, usize> = BTreeMap::new();
        for g in &goals {
            for id in &g.account_ids {
                *use_count.entry(id).or_default() += 1;
            }
        }
        let planning = if modules.modules.planning {
            crate::plan_profile::read(c)
                .map(|p| {
                    p.and_then(|p| p.profile.retire.core)
                        .map(|c| {
                            c.fund_rules
                                .into_iter()
                                .filter(|r| r.availability == "available" && r.share_hundredths > 0)
                                .map(|r| r.account_id)
                                .collect::<BTreeSet<_>>()
                        })
                        .unwrap_or_default()
                })
                .ok()
        } else {
            None
        };
        let mut views = Vec::new();
        for g in &goals {
            let observations = observations(c, g, latest_snapshot.as_ref(), today, true)?;
            let planning_overlap = planning.as_ref().map(|ids| {
                g.account_ids.iter().any(|id| {
                    ids.contains(id)
                        && latest_snapshot.as_ref().is_some_and(|s| {
                            s.entries.iter().any(|e| e.account_id == *id && e.counted)
                        })
                })
            });
            let history = history
                .iter()
                .filter(|s| s.date >= g.created_on)
                .map(|s| {
                    Ok(HistoryPoint {
                        basis: basis(s),
                        observations: observations_for_history(c, g, s, today)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            views.push(GoalView {
                goal: g.clone(),
                observations,
                shared_account_ids: g
                    .account_ids
                    .iter()
                    .filter(|id| use_count.get(id.as_str()).copied().unwrap_or(0) > 1)
                    .cloned()
                    .collect(),
                planning_overlap,
                history,
            });
        }
        let mut years = BTreeSet::from([today[..4].parse::<i32>().unwrap_or(year)]);
        for p in &summary.points {
            if let Ok(y) = p.date[..4].parse() {
                years.insert(y);
            }
        }
        for g in &goals {
            if let Ok(y) = g.created_on[..4].parse() {
                years.insert(y);
            }
        }
        Ok(Read {
            generation: self.generation(),
            write_version: c.total_changes(),
            today: today.into(),
            year,
            years: years.into_iter().collect(),
            basis: latest_snapshot.as_ref().map(basis),
            newer_incomplete,
            accounts: self.wealth_accounts()?,
            goals: views,
        })
    }
}
fn observations_for_history(
    c: &Connection,
    g: &Goal,
    s: &Snapshot,
    today: &str,
) -> Result<Vec<Observation>> {
    observations(c, g, Some(s), today, false)
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    for g in list(c, true)? {
        g.fields.validate()?;
        date(&g.created_on)?;
        if uuid::Uuid::parse_str(&g.id).is_err() || g.account_ids.is_empty() {
            return Err(Error::new("DATA_CONSTRAINT", "目标标识或账户关系无效"));
        }
        for id in &g.account_ids {
            uuid::Uuid::parse_str(id)
                .map_err(|_| Error::new("DATA_CONSTRAINT", "目标账户标识无效"))?;
        }
        for stamp in [&g.created_at, &g.updated_at]
            .into_iter()
            .chain(g.deleted_at.as_ref())
        {
            chrono::DateTime::parse_from_rfc3339(stamp)
                .map_err(|_| Error::new("DATA_CONSTRAINT", "目标时间戳无效"))?;
        }
    }
    Ok(())
}

pub(crate) fn protect_purge(c: &Connection, id: &str) -> Result<()> {
    if c.query_row(
        "SELECT EXISTS(SELECT 1 FROM savings_goal_accounts WHERE account_id=?1)",
        [id],
        |r| r.get::<_, bool>(0),
    )? {
        return Err(Error::new(
            "PLANNING_DEPENDENCY",
            "账户仍被存钱目标引用（包括已删除目标），请先解除关联或永久删除对应目标",
        ));
    }
    Ok(())
}
