//! Shared strict basic-planning input and scoped update contract. No parallel fact store.
use crate::domain::{date, Error, Result};
use crate::plan_core::{Core, CostRule, DebtRepayment, FundRule, Occurrence};
use crate::plan_profile::{
    Assumptions, IncomeItem, LifeEvent, Overrides, Profile, Retire, SavingPhase, SpendItem,
};
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
pub struct IncomeSelection {
    pub id: String,
    pub source_id: String,
    pub role: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetirementIncome {
    pub mode: Option<String>,
    pub selected: Vec<IncomeSelection>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PensionContributions {
    pub start_month: Option<String>,
    pub stop_month: Option<String>,
    pub base_cents: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Basic {
    pub contract_version: u32,
    pub start: Start,
    pub contribution: Contribution,
    pub retirement_income: RetirementIncome,
    pub pension_contributions: PensionContributions,
    pub contribution_costs: Vec<CostScope>,
    pub retirement_costs: Vec<CostScope>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LegacyDefinition {
    pub contract_version: u32,
    pub recorded_at: String,
    pub birth_month: Option<String>,
    pub monetary_basis_date: Option<String>,
    pub assumptions: Assumptions,
    pub spend_cents: Option<String>,
    pub target_age: Option<u32>,
    pub horizon_age: u32,
    pub mode: String,
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    pub volatility_hundredths: i32,
    pub emergency_months: u32,
    pub saving_phases: Vec<SavingPhase>,
    pub route_id: Option<String>,
    pub route_from_age: u32,
    pub gap_share_hundredths: i32,
    pub gap_keeps_paying: bool,
    pub spend_items: Vec<SpendItem>,
    pub income_items: Vec<IncomeItem>,
    pub event_ids: Vec<String>,
    pub costs: Vec<CostRule>,
    pub keep_paying_until_age: Option<u32>,
    pub keep_paying_monthly_cents: String,
    pub keep_paying_base_cents: String,
    pub rent_cents: String,
}

fn bad(message: &str) -> Error {
    Error::new("PLANNING_BASIC", message)
}
fn valid_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 120 {
        Err(bad("规划来源标识无效"))
    } else {
        Ok(())
    }
}
fn month(v: &Option<String>) -> Result<()> {
    if let Some(s) = v {
        if s.len() != 7 || date(&format!("{s}-01")).is_err() {
            return Err(bad("月份须为 YYYY-MM"));
        }
    }
    Ok(())
}
fn amount(v: &Option<String>, signed: bool) -> Result<()> {
    if let Some(s) = v {
        let n = s.parse::<i64>().map_err(|_| bad("金额须为整数分"))?;
        if s != &n.to_string() || n.unsigned_abs() > 100_000_000 || (!signed && n < 0) {
            return Err(bad("金额超出范围或不是规范整数分"));
        }
    }
    Ok(())
}
impl Basic {
    pub fn validate(&self, r: &Retire) -> Result<()> {
        if self.contract_version != 1 {
            return Err(bad("基础契约版本不支持"));
        }
        valid_id(&self.contribution.id)?;
        amount(&self.contribution.monthly_cents, true)?;
        if let Start::Simulation {
            id,
            available_cents,
            date: d,
            notes,
        } = &self.start
        {
            valid_id(id)?;
            if let Some(v) = available_cents {
                crate::domain::cents(Some(v))?;
            }
            if let Some(v) = d {
                date(v)?;
            }
            if notes.chars().count() > 10000 {
                return Err(bad("模拟备注最多 10000 字"));
            }
        }
        let ri = &self.retirement_income;
        if ri
            .mode
            .as_ref()
            .is_some_and(|m| !["excluded", "manual", "beijing"].contains(&m.as_str()))
        {
            return Err(bad("退休收入模式无效"));
        }
        let mut ids = HashSet::new();
        let mut sources = HashSet::new();
        for i in &ri.selected {
            valid_id(&i.source_id)?;
            if !r.income_items.iter().any(|v| v.id == i.id)
                || !ids.insert(&i.id)
                || !sources.insert(&i.source_id)
                || !["state_pension", "other"].contains(&i.role.as_str())
            {
                return Err(bad("退休收入的来源/角色须唯一且有定义"));
            }
            if ri.mode.as_deref() == Some("beijing")
                && (i.role == "state_pension" || i.source_id == "beijing_state_pension")
            {
                return Err(bad("北京估算不能重复计同一国家养老金"));
            }
        }
        if (ri.mode.is_none() || ri.mode.as_deref() == Some("excluded")) && !ri.selected.is_empty()
        {
            return Err(bad("未选择/本次不计收入不能有纳入来源"));
        }
        let pc = &self.pension_contributions;
        month(&pc.start_month)?;
        month(&pc.stop_month)?;
        amount(&pc.base_cents, false)?;
        if matches!((&pc.start_month,&pc.stop_month),(Some(a),Some(b)) if a>b) {
            return Err(bad("缴费结束月份不能早于开始"));
        }
        for scopes in [&self.contribution_costs, &self.retirement_costs] {
            if scopes.len() > 100 {
                return Err(bad("费用作用域过多"));
            }
            let mut ids = HashSet::new();
            for c in scopes {
                valid_id(&c.source_id)?;
                if !ids.insert(&c.source_id)
                    || !["included", "extra", "excluded"].contains(&c.treatment.as_str())
                {
                    return Err(bad("费用作用域无效或重复"));
                }
                if c.treatment == "excluded"
                    && (c.source_id.ends_with(":loan") || c.source_id == "personal_pension")
                {
                    return Err(bad("已纳入的债务付款/养老金现金转入不能从完整账本排除"));
                }
                if c.treatment == "included" {
                    if c.reference_cents.is_none() {
                        return Err(bad("已含费用须有参考额"));
                    }
                    amount(&c.reference_cents, false)?;
                } else if c.reference_cents.is_some() {
                    return Err(bad("额外/排除费用不携带参考额"));
                }
            }
        }
        if let Some(s) = &r.spend_cents {
            let refs: i64 = self
                .retirement_costs
                .iter()
                .filter(|c| {
                    c.treatment == "included"
                        && !r.life_events.iter().any(|e| {
                            c.source_id.starts_with(&format!("event:{}:", e.id))
                                && (r.core.as_ref().is_some_and(|core| {
                                    core.occurrences
                                        .iter()
                                        .any(|o| o.event_id == e.id && o.status == "cancelled")
                                }) || (!e.included
                                    && !r.core.as_ref().is_some_and(|core| {
                                        core.occurrences
                                            .iter()
                                            .any(|o| o.event_id == e.id && o.status == "occurred")
                                    })))
                        })
                })
                .map(|c| {
                    c.reference_cents
                        .as_ref()
                        .and_then(|v| v.parse::<i64>().ok())
                        .unwrap_or(0)
                })
                .sum();
            if refs > s.parse::<i64>().unwrap_or(0) {
                return Err(bad("退休已含参考额不能超过总预算"));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BasicFields {
    pub birth_month: Option<String>,
    pub spend_cents: Option<String>,
    pub target_age: Option<u32>,
    pub horizon_age: u32,
    pub mode: String,
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    pub volatility_hundredths: i32,
    pub emergency_months: u32,
    pub inflation_hundredths: i32,
    pub monetary_basis_date: String,
    pub basic: Basic,
    // Kept only for exact replay fingerprints of historical scoped requests.
    #[serde(default)]
    pub confirm_legacy_replacement: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PensionFields {
    pub birth_month: Option<String>,
    pub worker: Option<String>,
    pub region: Option<String>,
    pub paid_months: Option<u32>,
    pub account_balance_cents: Option<String>,
    pub base_cents: Option<String>,
    pub past_index_hundredths: Option<i32>,
    pub flex_months: Option<i32>,
    pub personal_pension_annual_cents: Option<String>,
    pub marginal_tax_hundredths: Option<i32>,
    pub wage_growth_hundredths: i32,
    pub pp_return_hundredths: i32,
    pub overrides: Overrides,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FundsFields {
    pub monetary_basis_date: String,
    pub fund_rules: Vec<FundRule>,
    pub hpf_monthly_cents: Option<String>,
    pub personal_pension_account_id: Option<String>,
    pub personal_pension_balance_confirmed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventsFields {
    pub life_events: Vec<LifeEvent>,
    pub occurrences: Vec<Occurrence>,
    // Preserve old request serialization for receipt lookup, reject fresh writes.
    #[serde(
        default,
        rename = "costs",
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_legacy_costs"
    )]
    pub legacy_costs: Option<Vec<CostRule>>,
}
fn deserialize_legacy_costs<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Vec<CostRule>>, D::Error> {
    Vec::deserialize(deserializer).map(Some)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetFields {
    pub spend_items: Vec<SpendItem>,
    pub income_items: Vec<IncomeItem>,
    pub rent_cents: String,
    pub keep_paying_until_age: Option<u32>,
    pub keep_paying_monthly_cents: String,
    pub keep_paying_base_cents: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetupFields {
    pub basic: BasicFields,
    pub budget: Option<BudgetFields>,
    pub funds: Option<FundsFields>,
    pub pension: Option<PensionFields>,
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
    Pension(PensionFields),
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
/// Omitted facts are unknown. These are neutral assumptions only, not pension facts.
pub fn empty_profile() -> Profile {
    Profile {
        birth_month: None,
        worker: None,
        region: None,
        paid_months: None,
        account_balance_cents: None,
        base_cents: None,
        past_index_hundredths: None,
        flex_months: None,
        personal_pension_annual_cents: None,
        marginal_tax_hundredths: None,
        assumptions: Assumptions {
            inflation_hundredths: 0,
            wage_growth_hundredths: 0,
            pp_return_hundredths: 0,
        },
        overrides: Overrides::default(),
        retire: Retire {
            target_age: None,
            ..Retire::default()
        },
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
        hpf_monthly_cents: None,
        personal_pension_account_id: None,
        personal_pension_balance_confirmed: false,
        costs: vec![],
        occurrences: vec![],
        debt_repayments: vec![],
    }))
}
impl Update {
    pub(crate) fn merge(&self, old: Option<&Profile>) -> Result<Profile> {
        let mut p = old.cloned().unwrap_or_else(empty_profile);
        match &self.section {
            Section::DebtRepayments(f) => {
                if f.updates.len() > 500 || f.remove.len() > 500 {
                    return Err(bad("还款安排过多"));
                }
                let mut ids = HashSet::new();
                let mut removed = HashSet::new();
                for account_id in &f.remove {
                    if uuid::Uuid::parse_str(account_id).is_err() || !removed.insert(account_id) {
                        return Err(bad("移除的账户不能重复或无效"));
                    }
                }
                for d in &f.updates {
                    if !ids.insert(&d.account_id) || f.remove.contains(&d.account_id) {
                        return Err(bad("同一账户不能重复处理"));
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
            Section::Setup(f) => {
                // Apply the general goal and supporting sections in one transaction.
                // Validate/persist only the final profile in the caller's single transaction.
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
                if let Some(v) = &f.pension {
                    if v.birth_month != f.basic.birth_month {
                        return Err(bad("目标与养老金出生年月须一致"));
                    }
                    p = apply(Section::Pension(v.clone()), Some(&p))?;
                }
            }
            Section::Basic(f) => {
                if let Some(o) = old {
                    if o.retire
                        .basic
                        .as_ref()
                        .is_some_and(|b| b.contribution.id != f.basic.contribution.id)
                    {
                        return Err(bad("投入稳定ID不能替换"));
                    }
                }
                core(&mut p, &f.monetary_basis_date)?;
                p.birth_month = f.birth_month.clone();
                p.assumptions.inflation_hundredths = f.inflation_hundredths;
                let r = &mut p.retire;
                r.basic = Some(f.basic.clone());
                r.spend_cents = f.spend_cents.clone();
                r.target_age = f.target_age;
                r.horizon_age = f.horizon_age;
                r.mode = f.mode.clone();
                r.real_return_before_hundredths = f.real_return_before_hundredths;
                r.real_return_after_hundredths = f.real_return_after_hundredths;
                r.volatility_hundredths = f.volatility_hundredths;
                r.emergency_months = f.emergency_months;
                r.setup_completed = true;
            }
            Section::Pension(f) => {
                p.birth_month = f.birth_month.clone();
                p.worker = f.worker.clone();
                p.region = f.region.clone();
                p.paid_months = f.paid_months;
                p.account_balance_cents = f.account_balance_cents.clone();
                p.base_cents = f.base_cents.clone();
                p.past_index_hundredths = f.past_index_hundredths;
                p.flex_months = f.flex_months;
                p.personal_pension_annual_cents = f.personal_pension_annual_cents.clone();
                p.marginal_tax_hundredths = f.marginal_tax_hundredths;
                p.assumptions.wage_growth_hundredths = f.wage_growth_hundredths;
                p.assumptions.pp_return_hundredths = f.pp_return_hundredths;
                p.overrides = f.overrides.clone();
            }
            Section::Funds(f) => {
                let c = core(&mut p, &f.monetary_basis_date)?;
                c.fund_rules = f.fund_rules.clone();
                c.hpf_monthly_cents = f.hpf_monthly_cents.clone();
                c.personal_pension_account_id = f.personal_pension_account_id.clone();
                c.personal_pension_balance_confirmed = f.personal_pension_balance_confirmed;
            }
            Section::Events(f) => {
                if f.legacy_costs.is_some() {
                    return Err(bad("旧阶段费用不能保存，请重新读取后核对通用费用"));
                }
                p.retire.life_events = f.life_events.clone();
                let c = p
                    .retire
                    .core
                    .as_mut()
                    .ok_or_else(|| bad("先确认金额基准"))?;
                c.occurrences = f.occurrences.clone();
            }
            Section::Budget(f) => {
                let r = &mut p.retire;
                r.spend_items = f.spend_items.clone();
                r.income_items = f.income_items.clone();
                r.rent_cents = f.rent_cents.clone();
                r.keep_paying_until_age = f.keep_paying_until_age;
                r.keep_paying_monthly_cents = f.keep_paying_monthly_cents.clone();
                r.keep_paying_base_cents = f.keep_paying_base_cents.clone();
            }
        }
        Ok(p)
    }
}
