//! Minimal confirmed planning context, persisted with the existing profile transaction.
use crate::{
    domain::{cents, date, Error, Result},
    plan_profile::Retire,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FundRule {
    pub account_id: String,
    pub availability: String,
    pub share_hundredths: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Payment {
    pub id: String,
    pub date: String,
    pub amount_cents: Option<String>,
    pub account_id: Option<String>,
    pub absorbed_snapshot_id: Option<String>,
    pub absorbed_revision: Option<i64>,
    pub source_kind: Option<String>,
    pub source_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Loan {
    pub account_id: String,
    pub as_of: String,
    pub principal_cents: String,
    pub remaining_months: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Occurrence {
    pub id: String,
    pub event_id: String,
    pub status: String,
    pub actual_date: String,
    pub payments_complete: bool,
    pub payments: Vec<Payment>,
    pub loan: Option<Loan>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CostRule {
    pub phase_id: String,
    pub source_id: String,
    pub included: bool,
    pub reference_cents: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Core {
    pub contract_version: u32,
    pub monetary_basis_date: String,
    pub fund_rules: Vec<FundRule>,
    pub hpf_monthly_cents: Option<String>,
    #[serde(default)]
    pub personal_pension_account_id: Option<String>,
    #[serde(default)]
    pub personal_pension_balance_confirmed: bool,
    // Historical profile bytes only; never an active cost-input path.
    #[serde(default)]
    pub costs: Vec<CostRule>,
    pub occurrences: Vec<Occurrence>,
}
impl Occurrence {
    /// Only a blank saved occurrence can be retracted. Zero amounts are actual facts.
    pub fn has_facts(&self) -> bool {
        self.loan.is_some()
            || self.payments.iter().any(|p| {
                p.amount_cents.is_some()
                    || p.account_id.is_some()
                    || p.absorbed_snapshot_id.is_some()
                    || p.absorbed_revision.is_some()
                    || p.source_kind.is_some()
                    || p.source_id.is_some()
            })
    }
}
fn bad() -> Error {
    Error::new("PLANNING_CORE", "规划资金、费用或发生核对资料无效")
}
fn id(v: &str) -> Result<()> {
    uuid::Uuid::parse_str(v).map(|_| ()).map_err(|_| bad())
}
fn amount(v: &str) -> Result<()> {
    cents(Some(v)).and_then(|n| n.ok_or_else(bad)).map(|_| ())
}
impl Core {
    pub fn validate(&self, r: &Retire, today: &str) -> Result<()> {
        if self.contract_version != 1 {
            return Err(Error::new("PLANNING_VERSION", "不支持的规划契约版本"));
        }
        date(&self.monetary_basis_date)?;
        if self.fund_rules.len() > 500 || self.occurrences.len() > 20 || !self.costs.is_empty() {
            return Err(bad());
        }
        if let Some(v) = &self.hpf_monthly_cents {
            amount(v)?;
        }
        if let Some(v) = &self.personal_pension_account_id {
            id(v)?;
        }
        let mut funds = HashSet::new();
        for f in &self.fund_rules {
            id(&f.account_id)?;
            if !funds.insert(&f.account_id)
                || f.share_hundredths > 10000
                || !["available", "restricted", "excluded"].contains(&f.availability.as_str())
            {
                return Err(bad());
            }
        }
        let mut occurrences = HashSet::new();
        let mut intents = HashSet::new();
        let mut payment_ids = HashSet::new();
        let mut source_ids = HashSet::new();
        let mut loan_ids = HashSet::new();
        for o in &self.occurrences {
            id(&o.id)?;
            date(&o.actual_date)?;
            if o.actual_date.as_str() > today
                || !occurrences.insert(&o.id)
                || !intents.insert(&o.event_id)
                || !r.life_events.iter().any(|e| e.id == o.event_id)
                || !["occurred", "cancelled"].contains(&o.status.as_str())
                || o.payments.len() > 50
            {
                return Err(bad());
            }
            if o.status == "cancelled" && (!o.payments.is_empty() || o.loan.is_some()) {
                return Err(bad());
            }
            for p in &o.payments {
                id(&p.id)?;
                date(&p.date)?;
                if !payment_ids.insert(&p.id) {
                    return Err(bad());
                }
                if let Some(v) = &p.amount_cents {
                    amount(v)?;
                }
                if let Some(v) = &p.account_id {
                    id(v)?;
                }
                if p.absorbed_snapshot_id.is_some() != p.absorbed_revision.is_some()
                    || p.absorbed_revision.is_some_and(|v| v < 1)
                {
                    return Err(bad());
                }
                if let Some(v) = &p.absorbed_snapshot_id {
                    id(v)?;
                }
                match (&p.source_kind, &p.source_id) {
                    (None, None) => {}
                    (Some(k), Some(v)) if ["asset", "expense", "wish"].contains(&k.as_str()) => {
                        id(v)?;
                        if !source_ids.insert((k, v)) {
                            return Err(bad());
                        }
                    }
                    _ => return Err(bad()),
                }
            }
            if let Some(l) = &o.loan {
                id(&l.account_id)?;
                date(&l.as_of)?;
                amount(&l.principal_cents)?;
                if !loan_ids.insert(&l.account_id)
                    || l.as_of.as_str() > today
                    || l.remaining_months > 480
                    || (l.principal_cents != "0" && l.remaining_months == 0)
                {
                    return Err(bad());
                }
            }
        }
        Ok(())
    }
    pub fn references(&self) -> Vec<(&str, &str)> {
        let mut refs = Vec::new();
        if let Some(v) = &self.personal_pension_account_id {
            refs.push(("account", v.as_str()));
        }
        for f in &self.fund_rules {
            refs.push(("account", f.account_id.as_str()));
        }
        for o in &self.occurrences {
            for p in &o.payments {
                if let Some(v) = &p.account_id {
                    refs.push(("account", v.as_str()));
                }
                if let Some(v) = &p.absorbed_snapshot_id {
                    refs.push(("snapshot", v.as_str()));
                }
                if let (Some(k), Some(v)) = (&p.source_kind, &p.source_id) {
                    refs.push((k.as_str(), v.as_str()));
                }
            }
            if let Some(l) = &o.loan {
                refs.push(("account", l.account_id.as_str()));
            }
        }
        refs
    }
    pub fn validate_references(&self, c: &Connection, live: bool) -> Result<()> {
        for (kind, key) in self.references() {
            let table = match kind {
                "account" => "fin_accounts",
                "snapshot" => "fin_snapshots",
                "asset" => "assets",
                "expense" => "expenses",
                "wish" => "wishlist_items",
                _ => return Err(bad()),
            };
            let sql = format!(
                "SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1{})",
                if live { " AND deleted_at IS NULL" } else { "" }
            );
            if !c.query_row(&sql, [key], |r| r.get::<_, bool>(0))? {
                return Err(Error::new(
                    "PLANNING_REFERENCE",
                    "规划引用来源已删除或不存在，请核对并解除关联",
                ));
            }
        }
        if live {
            // Resolve aliases by factual identity, never by matching date/amount/name.
            // Historical backups retain their payload; live reads flag legacy duplicates.
            let mut factual_sources = HashSet::new();
            for o in &self.occurrences {
                for p in &o.payments {
                    if let (Some(kind), Some(key)) = (&p.source_kind, &p.source_id) {
                        let source: (Option<String>, Option<i64>, String, String) = match kind.as_str() {
                        "asset" => c.query_row("SELECT purchase_date,price_cents,'asset',id FROM assets WHERE id=?1 AND deleted_at IS NULL", [key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?,
                        "expense" => c.query_row("SELECT date,amount_cents,CASE WHEN asset_id IS NULL THEN 'expense' ELSE 'asset' END,COALESCE(asset_id,id) FROM expenses WHERE id=?1 AND deleted_at IS NULL", [key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?,
                        "wish" => c.query_row("SELECT a.purchase_date,a.price_cents,'asset',a.id FROM wishlist_items w JOIN assets a ON a.id=w.converted_asset_id WHERE w.id=?1 AND w.decision_state='purchased' AND w.deleted_at IS NULL AND a.deleted_at IS NULL", [key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()?.ok_or_else(|| Error::new("PLANNING_SOURCE", "关联愿望尚未确认购买或其物品已删除"))?,
                        _ => return Err(bad()),
                    };
                        if !factual_sources.insert((source.2, source.3)) {
                            return Err(Error::new(
                                "PLANNING_SOURCE_DUPLICATE",
                                "同一实际付款被重复关联，请核对物品、已购愿望或关联支出",
                            ));
                        }
                        if source.0.as_ref() != Some(&p.date)
                            || source.1.map(|v| v.to_string()) != p.amount_cents
                            || p.amount_cents.is_none()
                        {
                            return Err(Error::new(
                                "PLANNING_SOURCE",
                                "规划付款与关联来源日期或金额不同，需重新核对",
                            ));
                        }
                    }
                }
            }
        }
        for o in &self.occurrences {
            for p in &o.payments {
                if let Some(s) = &p.absorbed_snapshot_id {
                    let (when, rev): (String, i64) = c.query_row(
                        "SELECT date,revision FROM fin_snapshots WHERE id=?1",
                        [s],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )?;
                    // A later correction keeps the original link but forces calculation-time review.
                    if live && (p.date > when || Some(rev) != p.absorbed_revision) {
                        return Err(Error::new(
                            "PLANNING_ABSORPTION",
                            "付款吸收关系与盘点日期或修订不一致",
                        ));
                    }
                    let complete: bool = c.query_row("SELECT NOT EXISTS(SELECT 1 FROM fin_snapshot_entries WHERE snapshot_id=?1 AND state='missing')", [s], |r| r.get(0))?;
                    if !complete || p.account_id.is_none() {
                        return Err(bad());
                    }
                    let included: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM fin_snapshot_entries WHERE snapshot_id=?1 AND account_id=?2 AND side='asset' AND counted=1)", rusqlite::params![s,p.account_id], |r| r.get(0))?;
                    if !included {
                        return Err(Error::new(
                            "PLANNING_ABSORPTION",
                            "付款来源不属于吸收盘点的资产范围",
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}
/// Referenced facts cannot be deleted behind a confirmed occurrence. Unlink in the planning editor first.
pub(crate) fn protect_reference(c: &Connection, kind: &str, key: &str) -> Result<()> {
    let payload: Option<String> = c
        .query_row("SELECT payload FROM plan_profile WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()?;
    if let Some(payload) = payload {
        let p: crate::plan_profile::Profile = serde_json::from_str(&payload).map_err(|_| bad())?;
        if p.retire
            .core
            .as_ref()
            .is_some_and(|core| core.references().contains(&(kind, key)))
        {
            return Err(Error::new(
                "PLANNING_DEPENDENCY",
                "该来源被规划核对引用，请先在规划中解除关联",
            ));
        }
    }
    Ok(())
}
