//! General planning inputs. No social-insurance policy state or results.
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
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpendItem {
    pub id: String,
    pub label: String,
    pub monthly_cents: String,
    pub start_month: Option<String>,
    pub end_month: Option<String>,
    pub inflation_hundredths: Option<i32>,
    pub essential: bool,
    pub time_unconfirmed: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LifeEvent {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub date: String,
    pub included: bool,
    pub price_cents: String,
    pub down_cents: String,
    pub extra_cents: String,
    pub loan_rate_hundredths: i32,
    pub loan_years: u32,
    pub holding_cents: String,
    pub rent_saved_cents: String,
    pub cycle_years: Option<u32>,
    pub until_month: Option<String>,
    pub time_unconfirmed: bool,
    pub resale_cents: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Retire {
    pub setup_completed: bool,
    pub basic: Option<crate::plan_basic::Basic>,
    pub simplified: crate::plan_simplified::Fields,
    pub core: Option<crate::plan_core::Core>,
    pub spend_cents: Option<String>,
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    pub emergency_months: u32,
    pub mode: String,
    pub volatility_hundredths: i32,
    pub spend_items: Vec<SpendItem>,
    pub life_events: Vec<LifeEvent>,
    pub rent_cents: String,
}
impl Default for Retire {
    fn default() -> Self {
        Self {
            setup_completed: false,
            basic: None,
            simplified: crate::plan_simplified::Fields::default(),
            core: None,
            spend_cents: None,
            real_return_before_hundredths: 0,
            real_return_after_hundredths: 0,
            emergency_months: 6,
            mode: "fire".into(),
            volatility_hundredths: 500,
            spend_items: vec![],
            life_events: vec![],
            rent_cents: "0".into(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub assumptions: Assumptions,
    pub retire: Retire,
}
#[derive(Clone, Debug, Serialize)]
pub struct Saved {
    pub reference_issues: Vec<String>,
    pub profile: Profile,
    pub revision: i64,
    pub updated_at: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct State {
    pub generation: String,
    pub saved: Option<Saved>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileSave {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub profile: Profile,
}
fn bad(code: &'static str, message: &str) -> Error {
    Error::new(code, message)
}
fn rate(v: i32, lo: i32, hi: i32, label: &str) -> Result<()> {
    if !(lo..=hi).contains(&v) {
        return Err(bad("PROFILE_RATE", &format!("{label}超出范围")));
    }
    Ok(())
}
fn money(v: &str, positive: bool, label: &str) -> Result<i64> {
    cents(Some(v))?
        .filter(|n| v == n.to_string() && (!positive || *n > 0))
        .ok_or_else(|| bad("PROFILE_AMOUNT", &format!("{label}金额无效")))
}
impl Retire {
    fn validate_items(&self) -> Result<()> {
        if self.spend_items.len() > 20 || self.life_events.len() > 20 {
            return Err(bad("PROFILE_RETIRE", "安排最多20项"));
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
            crate::plan_simplified::month(&e.until_month)?;
            rate(e.loan_rate_hundredths, 0, 2000, "贷款利率")?;
            if !(1..=40).contains(&e.loan_years)
                || e.cycle_years.is_some_and(|y| !(1..=40).contains(&y))
            {
                return Err(bad("PROFILE_RETIRE", "贷款年限、换车周期须在 1 到 40 年"));
            }
        }
        let mut ids = std::collections::HashSet::new();
        for it in &self.spend_items {
            if it.id.is_empty()
                || it.id.len() > 40
                || !ids.insert(&it.id)
                || it.label.trim().is_empty()
                || it.label.chars().count() > 40
            {
                return Err(bad("PROFILE_RETIRE", "费用标识/名称无效"));
            }
            money(&it.monthly_cents, true, "费用")?;
            crate::plan_simplified::month(&it.start_month)?;
            crate::plan_simplified::month(&it.end_month)?;
            if matches!((&it.start_month,&it.end_month),(Some(a),Some(b)) if a>b) {
                return Err(bad("PROFILE_RETIRE", "费用时间顺序无效"));
            }
            if let Some(v) = it.inflation_hundredths {
                rate(v, -1000, 2000, "费用通胀")?;
            }
        }
        Ok(())
    }
}
impl Profile {
    pub fn validate(&self, today: &str) -> Result<()> {
        validate_retire(&self.retire, &self.assumptions, today)
    }
}
pub(crate) fn validate_retire(r: &Retire, a: &Assumptions, today: &str) -> Result<()> {
    rate(a.inflation_hundredths, 0, 2000, "通胀")?;
    if let Some(c) = &r.core {
        c.validate(r, today)?;
    }
    if let Some(v) = &r.spend_cents {
        money(v, false, "完整预算")?;
    }
    rate(r.real_return_before_hundredths, -1000, 2000, "积累收益")?;
    rate(r.real_return_after_hundredths, -1000, 2000, "动用资金收益")?;
    rate(r.volatility_hundredths, 0, 6000, "波动")?;
    if r.emergency_months > 36 || !["fire", "traditional"].contains(&r.mode.as_str()) {
        return Err(bad("PROFILE_RETIRE", "规划条件无效"));
    }
    money(&r.rent_cents, false, "房租")?;
    r.validate_items()?;
    r.simplified.validate(today)?;
    if let Some(b) = &r.basic {
        b.validate(r)?;
    }
    Ok(())
}
fn active_profile_value(p: &Profile) -> Result<serde_json::Value> {
    Ok(serde_json::to_value(p)?)
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
    pub fn plan_profile_save(&mut self, _input: &ProfileSave, _today: &str) -> Result<Saved> {
        Err(Error::new("PLANNING_SCOPED", "请使用通用规划分区保存"))
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
            |old| input.merge(old).map(|p| (p, None)),
        )
    }

    pub(crate) fn save_profile_request(
        &mut self,
        request_id: &str,
        generation: &str,
        expected_revision: Option<i64>,
        today: &str,
        fingerprints: &[String],
        merge: impl FnOnce(Option<&Profile>) -> Result<(Profile, Option<bool>)>,
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
        let (profile, confirmation) = merge(old.as_ref().map(|s| &s.profile))?;
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
                    && o.has_facts()
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
        let payload = serde_json::to_string(&active_profile_value(&profile)?)?;
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
        crate::plan_assumptions::sync(
            &tx,
            old.as_ref().map(|s| &s.profile),
            &profile,
            confirmation,
        )?;
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
