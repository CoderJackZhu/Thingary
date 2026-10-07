//! Personal profile for the pension estimate (PLANNING_DESIGN §5.1). Holds
//! inputs and the user's assumptions only; results are computed in the front
//! end and never stored. Sensitive: never logged, fictional fixtures only.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assumptions {
    pub inflation_hundredths: i32,
    pub wage_growth_hundredths: i32,
    pub pp_return_hundredths: i32,
}

/// The user's edits of the built-in regional table; absent means built-in.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Overrides {
    pub avg_wage_cents: Option<String>,
    pub base_lower_cents: Option<String>,
    pub base_upper_cents: Option<String>,
    pub notional_rate_hundredths: Option<i32>,
    pub hpf_rate_hundredths: Option<i32>,
}

/// One retirement spending bucket besides the main budget in `Retire::spend_cents`.
/// Amounts are monthly, in today's money; a missing start means "from retiring".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpendItem {
    pub id: String,
    pub label: String,
    pub monthly_cents: String,
    pub start_age: Option<u32>,
    pub end_age: Option<u32>,
    /// Own yearly inflation; absent follows the general inflation assumption.
    pub inflation_hundredths: Option<i32>,
    pub essential: bool,
}

/// One retirement income stream besides the state pension (which the pension
/// calculator derives): after-tax, monthly, today's money.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IncomeItem {
    pub id: String,
    pub label: String,
    pub monthly_cents: String,
    pub start_age: u32,
    pub end_age: Option<u32>,
    /// Rises with inflation; otherwise a fixed nominal amount that loses value.
    pub indexed: bool,
}

/// One stretch of the saving timeline: from this age (in months) on, the user
/// saves this much per month, in today's money. Negative means drawing down
/// savings (a stretch without a job). Phases are ordered by start; the first one
/// applies from today on.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavingPhase {
    pub id: String,
    pub label: String,
    pub from_age_months: u32,
    pub monthly_cents: i64,
}

/// A big plan on the timeline (house, car, other): one purchase month, cash
/// outlay, optional loan, running costs. All amounts are today's money in cents
/// as strings; the front end turns them into one-off outlays and monthly flows
/// inside the same retirement ledger.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LifeEvent {
    pub id: String,
    pub label: String,
    /// `house`, `car` or `other`.
    pub kind: String,
    /// Planned purchase month, `YYYY-MM`.
    pub date: String,
    /// Counted in the plan; off keeps it for comparison.
    pub included: bool,
    pub price_cents: String,
    pub down_cents: String,
    pub extra_cents: String,
    pub loan_rate_hundredths: i32,
    pub loan_years: u32,
    pub holding_cents: String,
    pub rent_saved_cents: String,
    pub cycle_years: Option<u32>,
    pub until_age: Option<u32>,
    pub resale_cents: String,
}

fn is_false(v: &bool) -> bool {
    !*v
}

const MAX_ITEMS: usize = 20;
const MAX_PHASES: usize = 30;
const MAX_SAVING_CENTS: i64 = 100_000_000;

/// Retirement / FIRE inputs (PLANNING_DESIGN §6). Every field has a default so
/// a profile saved before a field existed still loads unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Retire {
    /// Explicit first-use configuration; old records remain unconfirmed.
    #[serde(skip_serializing_if = "is_false")]
    pub setup_completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub basic: Option<crate::plan_basic::Basic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_definition: Option<crate::plan_basic::LegacyDefinition>,
    pub core: Option<crate::plan_core::Core>,
    /// Monthly spending after retiring, in today's money: the essential
    /// "daily living" bucket. `None` means not filled in yet.
    pub spend_cents: Option<String>,
    /// Real (after inflation) yearly return before and after retiring.
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    /// Planning horizon (age) and the emergency fund line in months of spending.
    pub horizon_age: u32,
    pub emergency_months: u32,
    /// `fire` finds the earliest sustainable age; `traditional` retires at `target_age`.
    pub mode: String,
    /// Desired retirement / independence age.
    pub target_age: Option<u32>,
    /// Yearly volatility of the real return, for the market-path simulation.
    pub volatility_hundredths: i32,
    pub spend_items: Vec<SpendItem>,
    pub income_items: Vec<IncomeItem>,
    /// Saving timeline before retiring; empty uses the measured usual saving throughout.
    pub saving_phases: Vec<SavingPhase>,
    /// Average share of working time without income (job changes, layoffs), in
    /// hundredths of a percent; the plan weighs positive phases by it.
    pub gap_share_hundredths: i32,
    /// Big plans: house, car, other.
    pub life_events: Vec<LifeEvent>,
    /// The career route from `route_from_age` on (ids live in the front end); `None` keeps the saving phases as they are.
    pub route_id: Option<String>,
    pub route_from_age: u32,
    /// After you stop working, keep paying social insurance yourself until this age; `None` stops paying when you stop.
    pub keep_paying_until_age: Option<u32>,
    /// What that costs per month (pension, medical and so on), today's money; `"0"` is none.
    pub keep_paying_monthly_cents: String,
    /// The base you pay on while paying yourself; `"0"` uses the base in the profile.
    pub keep_paying_base_cents: String,
    /// Gap months (negative saving phases, the average gap share) still count as contribution months when true.
    pub gap_keeps_paying: bool,
    /// Rent you pay each month while retired, until a planned house purchase takes it over; today's money, `"0"` is none.
    pub rent_cents: String,
}
impl Default for Retire {
    fn default() -> Self {
        Self {
            core: None,
            setup_completed: false,
            basic: None,
            legacy_definition: None,
            spend_cents: None,
            real_return_before_hundredths: 0,
            real_return_after_hundredths: 0,
            horizon_age: 90,
            emergency_months: 6,
            mode: "fire".into(),
            target_age: Some(50),
            volatility_hundredths: 500,
            spend_items: Vec::new(),
            income_items: Vec::new(),
            saving_phases: Vec::new(),
            gap_share_hundredths: 0,
            life_events: Vec::new(),
            route_id: None,
            route_from_age: 35,
            keep_paying_until_age: None,
            keep_paying_monthly_cents: "0".into(),
            keep_paying_base_cents: "0".into(),
            gap_keeps_paying: false,
            rent_cents: "0".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    /// `YYYY-MM`.
    pub birth_month: Option<String>,
    /// `male`, `female_cadre` or `female_worker`.
    pub worker: Option<String>,
    pub region: Option<String>,
    pub paid_months: Option<u32>,
    pub account_balance_cents: Option<String>,
    pub base_cents: Option<String>,
    pub past_index_hundredths: Option<i32>,
    pub flex_months: Option<i32>,
    pub personal_pension_annual_cents: Option<String>,
    pub marginal_tax_hundredths: Option<i32>,
    pub assumptions: Assumptions,
    #[serde(default)]
    pub overrides: Overrides,
    #[serde(default)]
    pub retire: Retire,
}

#[derive(Clone, Debug, Serialize)]
pub struct Saved {
    pub reference_issues: Vec<String>,
    pub profile: Profile,
    pub revision: i64,
    /// RFC 3339 time of the last save; the page uses it to remind the user to refresh the figures.
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct State {
    pub generation: String,
    pub saved: Option<Saved>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProfileSave {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub profile: Profile,
}

/// Personal pension deposits above the national yearly cap are refused here.
const PENSION_CAP_CENTS: i64 = 1_200_000;

fn bad(code: &'static str, message: &str) -> Error {
    Error::new(code, message)
}

fn rate(v: i32, lo: i32, hi: i32, label: &str) -> Result<()> {
    if !(lo..=hi).contains(&v) {
        return Err(bad(
            "PROFILE_RATE",
            &format!(
                "{label}须在 {:.2}% 到 {:.2}% 之间",
                lo as f64 / 100.0,
                hi as f64 / 100.0
            ),
        ));
    }
    Ok(())
}

fn money(value: &str, positive: bool, label: &str) -> Result<i64> {
    cents(Some(value))
        .ok()
        .flatten()
        .filter(|v| !positive || *v > 0)
        .ok_or_else(|| {
            bad(
                "PROFILE_AMOUNT",
                &format!(
                    "{label}须为{}金额",
                    if positive {
                        "大于 0 的"
                    } else {
                        "不小于 0 的"
                    }
                ),
            )
        })
}

impl Retire {
    pub(crate) fn has_legacy_plan(&self) -> bool {
        self.setup_completed
            || !self.saving_phases.is_empty()
            || self.route_id.is_some()
            || self.spend_cents.is_some()
            || !self.spend_items.is_empty()
            || !self.income_items.is_empty()
            || !self.life_events.is_empty()
    }
    fn validate_items(&self) -> Result<()> {
        if self.spend_items.len() > MAX_ITEMS || self.income_items.len() > MAX_ITEMS {
            return Err(bad("PROFILE_RETIRE", "支出项与收入项各最多 20 个"));
        }
        if self.saving_phases.len() > MAX_PHASES {
            return Err(bad("PROFILE_RETIRE", "储蓄阶段最多 30 段"));
        }
        if self.life_events.len() > MAX_ITEMS {
            return Err(bad("PROFILE_RETIRE", "大额计划最多 20 个"));
        }
        let mut event_ids = std::collections::HashSet::new();
        for e in &self.life_events {
            if e.id.is_empty()
                || e.id.len() > 40
                || e.label.trim().is_empty()
                || e.label.chars().count() > 40
            {
                return Err(bad("PROFILE_RETIRE", "大额计划须有名称（不超过 40 字）"));
            }
            if !event_ids.insert(e.id.as_str()) {
                return Err(bad("PROFILE_RETIRE", "大额计划的标识不能重复"));
            }
            if !["house", "car", "other"].contains(&e.kind.as_str()) {
                return Err(bad("PROFILE_RETIRE", "大额计划类型须是买房、买车或其他"));
            }
            if e.date.len() != 7
                || date(&format!("{}-01", e.date))
                    .map(|d| d.format("%Y-%m").to_string() != e.date)
                    .unwrap_or(true)
            {
                return Err(bad("PROFILE_RETIRE", "大额计划的日期格式应为 YYYY-MM"));
            }
            let price = money(&e.price_cents, true, "大额计划总价")?;
            if money(&e.down_cents, false, "首付")? > price {
                return Err(bad("PROFILE_AMOUNT", "首付不能高于总价"));
            }
            money(&e.extra_cents, false, "杂费")?;
            money(&e.holding_cents, false, "每月持有成本")?;
            money(&e.rent_saved_cents, false, "省下的月房租")?;
            money(&e.resale_cents, false, "卖旧车回收")?;
            rate(e.loan_rate_hundredths, 0, 2000, "贷款利率")?;
            if !(1..=40).contains(&e.loan_years)
                || e.cycle_years.is_some_and(|y| !(1..=40).contains(&y))
                || e.until_age.is_some_and(|a| a > 120)
            {
                return Err(bad(
                    "PROFILE_RETIRE",
                    "贷款年限、换车周期须在 1 到 40 年，截止年龄不超过 120 岁",
                ));
            }
        }
        let mut phase_ids = std::collections::HashSet::new();
        let mut previous: Option<u32> = None;
        for p in &self.saving_phases {
            if p.id.is_empty()
                || p.id.len() > 40
                || p.label.trim().is_empty()
                || p.label.chars().count() > 40
            {
                return Err(bad("PROFILE_RETIRE", "储蓄阶段须有名称（不超过 40 字）"));
            }
            if !phase_ids.insert(p.id.as_str()) {
                return Err(bad("PROFILE_RETIRE", "储蓄阶段的标识不能重复"));
            }
            if p.from_age_months > 1440 || previous.is_some_and(|q| p.from_age_months <= q) {
                return Err(bad(
                    "PROFILE_RETIRE",
                    "储蓄阶段的起始年龄须按先后递增，且不超过 120 岁",
                ));
            }
            if p.monthly_cents.abs() > MAX_SAVING_CENTS {
                return Err(bad("PROFILE_AMOUNT", "储蓄阶段的月金额超出范围"));
            }
            previous = Some(p.from_age_months);
        }
        let mut ids = std::collections::HashSet::new();
        let span = |start: Option<u32>, end: Option<u32>| {
            let ok = start.is_none_or(|v| v <= 120)
                && end.is_none_or(|v| v <= 120)
                && match (start, end) {
                    (Some(a), Some(b)) => a < b,
                    _ => true,
                };
            if ok {
                Ok(())
            } else {
                Err(bad(
                    "PROFILE_RETIRE",
                    "起止年龄须在 0 到 120 岁之间，且结束晚于开始",
                ))
            }
        };
        let label = |id: &str, name: &str| {
            if id.is_empty() || id.len() > 40 || name.trim().is_empty() || name.chars().count() > 40
            {
                return Err(bad(
                    "PROFILE_RETIRE",
                    "支出项与收入项须有名称（不超过 40 字）",
                ));
            }
            Ok(())
        };
        for it in &self.spend_items {
            label(&it.id, &it.label)?;
            if !ids.insert(it.id.as_str()) {
                return Err(bad("PROFILE_RETIRE", "支出项与收入项的标识不能重复"));
            }
            money(&it.monthly_cents, true, "支出项月金额")?;
            span(it.start_age, it.end_age)?;
            if let Some(v) = it.inflation_hundredths {
                rate(v, -1000, 2000, "支出项通胀率")?;
            }
        }
        for it in &self.income_items {
            label(&it.id, &it.label)?;
            if !ids.insert(it.id.as_str()) {
                return Err(bad("PROFILE_RETIRE", "支出项与收入项的标识不能重复"));
            }
            money(&it.monthly_cents, true, "收入项月金额")?;
            span(Some(it.start_age), it.end_age)?;
        }
        Ok(())
    }
}

impl Profile {
    pub fn validate(&self, today: &str) -> Result<()> {
        let basic = self.retire.basic.is_some();
        if !basic
            && self.retire.has_legacy_plan()
            && [
                self.birth_month.is_none(),
                self.worker.is_none(),
                self.region.is_none(),
                self.paid_months.is_none(),
                self.account_balance_cents.is_none(),
                self.base_cents.is_none(),
                self.flex_months.is_none(),
                self.personal_pension_annual_cents.is_none(),
                self.marginal_tax_hundredths.is_none(),
            ]
            .contains(&true)
        {
            return Err(bad(
                "PROFILE_REQUIRED",
                "原规划需要完整个人资料；未知资料请使用通用基础保存",
            ));
        }
        if let Some(ym) = &self.birth_month {
            let birth = date(&format!("{ym}-01"))
                .map_err(|_| bad("PROFILE_BIRTH", "出生年月格式应为 YYYY-MM"))?;
            if ym.len() != 7
                || ym.as_str() >= &today[..7.min(today.len())]
                || birth.format("%Y-%m").to_string() != *ym
            {
                return Err(bad("PROFILE_BIRTH", "出生年月须早于本月"));
            }
        }
        if self
            .worker
            .as_ref()
            .is_some_and(|v| !["male", "female_cadre", "female_worker"].contains(&v.as_str()))
        {
            return Err(bad("PROFILE_WORKER", "请选择性别与职工类型"));
        }
        if self.region.as_ref().is_some_and(|v| v != "beijing") {
            return Err(bad("PROFILE_REGION", "目前只支持北京的参数表"));
        }
        if self.paid_months.is_some_and(|v| v > 1200) {
            return Err(bad("PROFILE_MONTHS", "累计缴费月数不能超过 1200"));
        }
        if let Some(v) = &self.account_balance_cents {
            money(v, false, "个人账户余额")?;
        }
        if let Some(v) = &self.base_cents {
            money(v, false, "缴费基数")?;
        }
        if self
            .past_index_hundredths
            .is_some_and(|v| !(1..=1000).contains(&v))
        {
            return Err(bad("PROFILE_INDEX", "历史平均缴费指数须在 0.01 到 10 之间"));
        }
        if self.flex_months.is_some_and(|v| !(-36..=36).contains(&v)) {
            return Err(bad("PROFILE_FLEX", "弹性提前或延后最多 36 个月"));
        }
        if let Some(v) = &self.personal_pension_annual_cents {
            if money(v, false, "个人养老金年缴额")? > PENSION_CAP_CENTS {
                return Err(bad("PROFILE_PENSION", "个人养老金每年最多缴 12000 元"));
            }
        }
        if let Some(v) = self.marginal_tax_hundredths {
            rate(v, 0, 4500, "边际税率")?;
        }
        validate_retire(&self.retire, &self.assumptions, today)?;
        let o = &self.overrides;
        for (value, label) in [
            (&o.avg_wage_cents, "上年度月平均工资"),
            (&o.base_lower_cents, "缴费基数下限"),
            (&o.base_upper_cents, "缴费基数上限"),
        ] {
            if let Some(v) = value {
                money(v, true, label)?;
            }
        }
        for (value, label) in [
            (o.notional_rate_hundredths, "记账利率"),
            (o.hpf_rate_hundredths, "公积金利率"),
        ] {
            if let Some(v) = value {
                rate(v, -1000, 3000, label)?;
            }
        }
        if let (Some(lo), Some(hi)) = (&o.base_lower_cents, &o.base_upper_cents) {
            if money(lo, true, "缴费基数下限")? > money(hi, true, "缴费基数上限")? {
                return Err(bad("PROFILE_AMOUNT", "缴费基数下限不能高于上限"));
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_retire(r: &Retire, a: &Assumptions, today: &str) -> Result<()> {
    let basic = r.basic.is_some();
    rate(a.inflation_hundredths, -1000, 2000, "通胀率")?;
    rate(a.wage_growth_hundredths, -1000, 2000, "工资增长率")?;
    rate(a.pp_return_hundredths, -1000, 3000, "个人养老金收益率")?;
    if let Some(core) = &r.core {
        core.validate(r, today)?;
    }
    if let Some(v) = &r.spend_cents {
        money(v, true, "退休后月支出")?;
    }
    rate(
        r.real_return_before_hundredths,
        -1000,
        2000,
        "退休前实际收益率",
    )?;
    rate(
        r.real_return_after_hundredths,
        -1000,
        2000,
        "退休后实际收益率",
    )?;
    if !(70..=110).contains(&r.horizon_age) || r.emergency_months > 36 {
        return Err(bad(
            "PROFILE_RETIRE",
            "规划终点年龄须在 70 到 110 岁之间，应急金不超过 36 个月",
        ));
    }
    if !["fire", "traditional"].contains(&r.mode.as_str()) {
        return Err(bad("PROFILE_RETIRE", "计划类型须是 FIRE 或传统"));
    }
    if r.target_age
        .is_some_and(|v| !(20..r.horizon_age).contains(&v))
        || (!basic && r.has_legacy_plan() && r.target_age.is_none())
    {
        return Err(bad(
            "PROFILE_RETIRE",
            "期望退休年龄须在 20 岁与规划终点之间",
        ));
    }
    rate(r.volatility_hundredths, 0, 6000, "年度波动率")?;
    rate(r.gap_share_hundredths, 0, 5000, "平均空窗比例")?;
    if r.route_id
        .as_ref()
        .is_some_and(|id| id.is_empty() || id.len() > 40)
        || !(20..=70).contains(&r.route_from_age)
    {
        return Err(bad("PROFILE_RETIRE", "路线换成的年龄须在 20 到 70 岁之间"));
    }
    for (value, label) in [
        (&r.keep_paying_monthly_cents, "续缴社保每月花费"),
        (&r.keep_paying_base_cents, "续缴缴费基数"),
        (&r.rent_cents, "退休后月房租"),
    ] {
        money(value, false, label)?;
    }
    if r.keep_paying_until_age
        .is_some_and(|age| !(20..=70).contains(&age))
    {
        return Err(bad(
            "PROFILE_RETIRE",
            "续缴社保到的年龄须在 20 到 70 岁之间",
        ));
    }
    r.validate_items()?;
    if let Some(b) = &r.basic {
        b.validate(r)?;
    }
    if let Some(old) = &r.legacy_definition {
        old.validate()?;
    }
    Ok(())
}

fn read(c: &Connection) -> Result<Option<Saved>> {
    let row: Option<(String, i64, String)> = c
        .query_row(
            "SELECT payload,revision,updated_at FROM plan_profile WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    row.map(|(payload, revision, updated_at)| {
        let profile: Profile = serde_json::from_str(&payload)
            .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?;
        let reference_issues = profile
            .retire
            .core
            .as_ref()
            .and_then(|core| core.validate_references(c, true).err())
            .map(|e| vec![e.message])
            .unwrap_or_default();
        Ok(Saved {
            profile,
            reference_issues,
            revision,
            updated_at,
        })
    })
    .transpose()
}

impl Store {
    pub fn plan_profile(&self) -> Result<State> {
        Ok(State {
            generation: self.generation(),
            saved: read(self.conn()?)?,
        })
    }

    pub fn plan_profile_save(&mut self, input: &ProfileSave, today: &str) -> Result<Saved> {
        let bytes = serde_json::to_string(&("plan_profile", input))?;
        let mut fingerprints = vec![digest(bytes.as_bytes())];
        // The setup-fix build emitted false as the first retirement field.
        // Accept only that exact alternate serialization of an otherwise legacy
        // request. No field is removed; new basic/archive or true conditions
        // cannot borrow an older receipt.
        if !input.profile.retire.setup_completed
            && input.profile.retire.basic.is_none()
            && input.profile.retire.legacy_definition.is_none()
        {
            fingerprints.push(digest(
                bytes
                    .replacen("\"retire\":{", "\"retire\":{\"setup_completed\":false,", 1)
                    .as_bytes(),
            ));
        }
        self.save_profile_request(
            &input.request_id,
            &input.generation,
            input.expected_revision,
            today,
            &fingerprints,
            |old| {
                if input.profile.retire.basic.is_some()
                    || input.profile.retire.legacy_definition.is_some()
                {
                    return Err(Error::new(
                        "PLANNING_SCOPED",
                        "新基础与原假设保全须通过分区更新",
                    ));
                }
                if let Some(old) = old {
                    if old.retire.basic.is_some() {
                        return Err(Error::new(
                            "PLANNING_SCOPED",
                            "基础条件须通过分区更新，旧完整请求不能替换",
                        ));
                    }
                    if old.retire.legacy_definition != input.profile.retire.legacy_definition {
                        return Err(Error::new("PLANNING_SCOPED", "原假设只读定义不能改写"));
                    }
                }
                Ok(input.profile.clone())
            },
        )
    }

    pub fn plan_profile_update(
        &mut self,
        input: &crate::plan_basic::Update,
        today: &str,
    ) -> Result<Saved> {
        let fingerprint = digest(&serde_json::to_vec(&("plan_profile_update", input))?);
        self.save_profile_request(
            &input.request_id,
            &input.generation,
            input.expected_revision,
            today,
            &[fingerprint],
            |old| input.merge(old, today),
        )
    }

    fn save_profile_request(
        &mut self,
        request_id: &str,
        generation: &str,
        expected_revision: Option<i64>,
        today: &str,
        fingerprints: &[String],
        merge: impl FnOnce(Option<&Profile>) -> Result<Profile>,
    ) -> Result<Saved> {
        let fingerprint = &fingerprints[0];
        self.check_generation(generation)?;
        uuid::Uuid::parse_str(request_id).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let tx = self.conn()?.unchecked_transaction()?;
        let prior: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM feature_requests WHERE id=?1",
                [request_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(f) = prior {
            if !fingerprints.contains(&f) {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
            }
            return read(&tx)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到个人资料"));
        }
        let old = read(&tx)?;
        if old.as_ref().map(|s| s.revision) != expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "个人资料已变化，请重新读取",
            ));
        }
        let profile = merge(old.as_ref().map(|s| &s.profile))?;
        profile.validate(today)?;
        if let Some(core) = &profile.retire.core {
            core.validate_references(&tx, true)?;
        }
        if let Some(old_core) = old.as_ref().and_then(|s| s.profile.retire.core.as_ref()) {
            if profile
                .retire
                .core
                .as_ref()
                .is_some_and(|core| core.monetary_basis_date != old_core.monetary_basis_date)
            {
                return Err(Error::new(
                    "PLANNING_BASIS",
                    "已有金额基准日期固定；变更需要独立换算流程",
                ));
            }
            for o in &old_core.occurrences {
                if o.status == "occurred"
                    && !profile.retire.core.as_ref().is_some_and(|core| {
                        core.occurrences.iter().any(|n| {
                            n.id == o.id && n.event_id == o.event_id && n.status == "occurred"
                        })
                    })
                {
                    return Err(Error::new(
                        "PLANNING_OCCURRENCE",
                        "已发生事实不能通过删除计划或纳入开关撤销；请在原来源核对更正",
                    ));
                }
            }
        }
        let payload = serde_json::to_string(&profile)?;
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute(
                "UPDATE plan_profile SET payload=?1,revision=revision+1,updated_at=?2 WHERE id=1",
                params![payload, now],
            )?;
        } else {
            tx.execute(
                "INSERT INTO plan_profile(id,payload,revision,updated_at) VALUES(1,?1,1,?2)",
                params![payload, now],
            )?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![request_id, fingerprint, "profile"],
        )?;
        let result = read(&tx)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到个人资料"))?;
        self.hit("plan_profile.before_commit")?;
        tx.commit()?;
        self.hit("plan_profile.after_commit")?;
        Ok(result)
    }
}

/// Backup validation: the payload must parse strictly and pass the same checks.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法个人资料");
    if let Some(saved) = read(c).map_err(|_| bad())? {
        saved.profile.validate("9999-12-31").map_err(|_| bad())?;
        if let Some(core) = &saved.profile.retire.core {
            core.validate_references(c, false)?;
        }
    }
    let stamp: Option<String> = c
        .query_row("SELECT updated_at FROM plan_profile", [], |r| r.get(0))
        .optional()?;
    if let Some(s) = stamp {
        chrono::DateTime::parse_from_rfc3339(&s).map_err(|_| bad())?;
    }
    Ok(())
}
