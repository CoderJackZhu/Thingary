//! General planning scoped updates, using the existing profile transaction.
use crate::domain::{date, Error, Result};
use crate::plan_core::{Core, DebtRepayment, FundRelease, FundRule, Occurrence};
use crate::plan_profile::{Assumptions, LifeEvent, Profile, Retire, SpendItem};
use crate::plan_simplified::Fields;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Start {
    Live,
    Simulation {
        id: String,
        available_cents: Option<String>,
        date: Option<String>,
        notes: String,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contribution {
    pub id: String,
    pub monthly_cents: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CostScope {
    pub source_id: String,
    pub treatment: String,
    pub reference_cents: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Basic {
    pub contract_version: u32,
    pub start: Start,
    pub contribution: Contribution,
    pub contribution_costs: Vec<CostScope>,
    pub retirement_costs: Vec<CostScope>,
}
fn bad(message: &str) -> Error {
    Error::new("PLANNING_BASIC", message)
}
impl Basic {
    pub fn validate(&self, r: &Retire) -> Result<()> {
        if self.contract_version != 1
            || self.contribution.id.is_empty()
            || self.contribution.id.len() > 120
        {
            return Err(bad("通用规划版本/标识无效"));
        }
        if let Some(s) = &self.contribution.monthly_cents {
            let n = s.parse::<i64>().map_err(|_| bad("投入金额无效"))?;
            if n.to_string() != *s || n.unsigned_abs() > 100_000_000 {
                return Err(bad("投入金额超出范围"));
            }
        }
        if let Start::Simulation {
            id,
            available_cents,
            date: d,
            notes,
        } = &self.start
        {
            if id.is_empty() || id.len() > 120 || notes.chars().count() > 10000 {
                return Err(bad("模拟资料无效"));
            }
            if let Some(v) = available_cents {
                crate::domain::cents(Some(v))?;
            }
            if let Some(v) = d {
                date(v)?;
            }
        }
        for scopes in [&self.contribution_costs, &self.retirement_costs] {
            if scopes.len() > 100 {
                return Err(bad("费用作用域过多"));
            }
            let mut ids = HashSet::new();
            for c in scopes {
                if c.source_id.is_empty()
                    || c.source_id.len() > 120
                    || !ids.insert(&c.source_id)
                    || !["included", "extra", "excluded"].contains(&c.treatment.as_str())
                    || [
                        "personal_pension",
                        "social_insurance",
                        "state_pension_estimate",
                        "beijing_state_pension",
                    ]
                    .contains(&c.source_id.as_str())
                {
                    return Err(bad("费用来源/作用域无效"));
                }
                if c.treatment == "excluded" && c.source_id.ends_with(":loan") {
                    return Err(bad("贷款付款不可排除"));
                }
                if c.treatment == "included" {
                    let v = c
                        .reference_cents
                        .as_ref()
                        .ok_or_else(|| bad("已含费用缺参考额"))?;
                    crate::domain::cents(Some(v))?;
                } else if c.reference_cents.is_some() {
                    return Err(bad("费用参考额无效"));
                }
            }
        }
        let refs: i64 = self
            .retirement_costs
            .iter()
            .filter(|c| {
                c.treatment == "included"
                    && !r.life_events.iter().any(|e| {
                        c.source_id.starts_with(&format!("event:{}:", e.id))
                            && (!e.included
                                && !r.core.as_ref().is_some_and(|core| {
                                    core.occurrences
                                        .iter()
                                        .any(|o| o.event_id == e.id && o.status == "occurred")
                                }))
                    })
            })
            .filter_map(|c| c.reference_cents.as_ref()?.parse::<i64>().ok())
            .sum();
        if r.spend_cents
            .as_ref()
            .is_some_and(|s| refs > s.parse::<i64>().unwrap_or(0))
        {
            return Err(bad("已含参考额超过完整预算"));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BasicFields {
    pub spend_cents: Option<String>,
    pub mode: String,
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    pub volatility_hundredths: i32,
    pub emergency_months: u32,
    pub inflation_hundredths: i32,
    pub monetary_basis_date: String,
    pub basic: Basic,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FundsFields {
    pub monetary_basis_date: String,
    pub fund_rules: Vec<FundRule>,
    pub releases: Vec<FundRelease>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventsFields {
    pub life_events: Vec<LifeEvent>,
    pub occurrences: Vec<Occurrence>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetFields {
    pub spend_items: Vec<SpendItem>,
    pub rent_cents: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupFields {
    pub basic: BasicFields,
    pub budget: Option<BudgetFields>,
    pub funds: Option<FundsFields>,
    pub simplified: Fields,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "section",
    content = "fields",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Section {
    Setup(Box<SetupFields>),
    Basic(BasicFields),
    Simplified(Fields),
    Funds(FundsFields),
    Events(EventsFields),
    Budget(BudgetFields),
    DebtRepayments(DebtRepaymentsFields),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DebtRepaymentsFields {
    pub updates: Vec<DebtRepayment>,
    pub remove: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Update {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    #[serde(flatten)]
    pub section: Section,
}
pub fn empty_profile() -> Profile {
    Profile {
        assumptions: Assumptions {
            inflation_hundredths: 0,
        },
        retire: Retire::default(),
    }
}
fn core<'a>(p: &'a mut Profile, basis: &str) -> Result<&'a mut Core> {
    date(basis)?;
    if p.retire
        .core
        .as_ref()
        .is_some_and(|c| c.monetary_basis_date != basis)
    {
        return Err(Error::new("PLANNING_BASIS", "已有金额基准固定"));
    }
    Ok(p.retire.core.get_or_insert_with(|| Core {
        contract_version: 1,
        monetary_basis_date: basis.into(),
        fund_rules: vec![],
        releases: vec![],
        occurrences: vec![],
        debt_repayments: vec![],
    }))
}
impl Update {
    pub(crate) fn merge(&self, old: Option<&Profile>) -> Result<Profile> {
        let mut p = old.cloned().unwrap_or_else(empty_profile);
        match &self.section {
            Section::Setup(f) => {
                let apply = |section: Section, old: Option<&Profile>| {
                    Update {
                        request_id: self.request_id.clone(),
                        generation: self.generation.clone(),
                        expected_revision: self.expected_revision,
                        section,
                    }
                    .merge(old)
                };
                p = apply(Section::Basic(f.basic.clone()), old)?;
                if let Some(v) = &f.budget {
                    p = apply(Section::Budget(v.clone()), Some(&p))?;
                }
                if let Some(v) = &f.funds {
                    p = apply(Section::Funds(v.clone()), Some(&p))?;
                }
                p.retire.simplified = f.simplified.clone();
            }
            Section::Simplified(f) => {
                p.retire.simplified = f.clone();
            }
            Section::Basic(f) => {
                if old.is_some_and(|o| {
                    o.retire
                        .basic
                        .as_ref()
                        .is_some_and(|b| b.contribution.id != f.basic.contribution.id)
                }) {
                    return Err(bad("投入稳定ID不能替换"));
                }
                core(&mut p, &f.monetary_basis_date)?;
                p.assumptions.inflation_hundredths = f.inflation_hundredths;
                let r = &mut p.retire;
                r.basic = Some(f.basic.clone());
                r.spend_cents = f.spend_cents.clone();
                r.mode = f.mode.clone();
                r.real_return_before_hundredths = f.real_return_before_hundredths;
                r.real_return_after_hundredths = f.real_return_after_hundredths;
                r.volatility_hundredths = f.volatility_hundredths;
                r.emergency_months = f.emergency_months;
                r.setup_completed = true;
            }
            Section::Funds(f) => {
                let c = core(&mut p, &f.monetary_basis_date)?;
                c.fund_rules = f.fund_rules.clone();
                c.releases = f.releases.clone();
            }
            Section::Budget(f) => {
                p.retire.spend_items = f.spend_items.clone();
                p.retire.rent_cents = f.rent_cents.clone();
            }
            Section::Events(f) => {
                p.retire.life_events = f.life_events.clone();
                p.retire
                    .core
                    .as_mut()
                    .ok_or_else(|| bad("先确认资金起点"))?
                    .occurrences = f.occurrences.clone();
            }
            Section::DebtRepayments(f) => {
                if f.updates.len() > 500 || f.remove.len() > 500 {
                    return Err(bad("还款安排过多"));
                }
                let mut ids = HashSet::new();
                let mut removed = HashSet::new();
                for id in &f.remove {
                    if uuid::Uuid::parse_str(id).is_err() || !removed.insert(id) {
                        return Err(bad("移除账户重复或无效"));
                    }
                }
                for d in &f.updates {
                    if !ids.insert(&d.account_id) || f.remove.contains(&d.account_id) {
                        return Err(bad("账户重复处理"));
                    }
                }
                let c = p
                    .retire
                    .core
                    .as_mut()
                    .ok_or_else(|| bad("先确认资金起点"))?;
                c.debt_repayments
                    .retain(|d| !ids.contains(&d.account_id) && !f.remove.contains(&d.account_id));
                c.debt_repayments.extend(f.updates.clone());
            }
        }
        Ok(p)
    }
}
