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

/// Retirement / FIRE inputs (PLANNING_DESIGN §6). Every field has a default so
/// a stage-2 profile without them still loads unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Retire {
    /// Monthly spending after retiring, in today's money; `None` uses the
    /// median spending derived from the check-ins.
    pub spend_cents: Option<String>,
    /// Real (after inflation) yearly return before and after retiring.
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    /// Planning horizon (age) and the emergency fund line in months of spending.
    pub horizon_age: u32,
    pub emergency_months: u32,
}
impl Default for Retire {
    fn default() -> Self {
        Self {
            spend_cents: None,
            real_return_before_hundredths: 0,
            real_return_after_hundredths: 0,
            horizon_age: 90,
            emergency_months: 6,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    /// `YYYY-MM`.
    pub birth_month: String,
    /// `male`, `female_cadre` or `female_worker`.
    pub worker: String,
    pub region: String,
    pub paid_months: u32,
    pub account_balance_cents: String,
    pub base_cents: String,
    pub past_index_hundredths: Option<i32>,
    pub flex_months: i32,
    pub personal_pension_annual_cents: String,
    pub marginal_tax_hundredths: i32,
    pub assumptions: Assumptions,
    #[serde(default)]
    pub overrides: Overrides,
    #[serde(default)]
    pub retire: Retire,
}

#[derive(Clone, Debug, Serialize)]
pub struct Saved {
    pub profile: Profile,
    pub revision: i64,
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

impl Profile {
    pub fn validate(&self, today: &str) -> Result<()> {
        let birth = date(&format!("{}-01", self.birth_month))
            .map_err(|_| bad("PROFILE_BIRTH", "出生年月格式应为 YYYY-MM"))?;
        if self.birth_month.len() != 7
            || self.birth_month.as_str() >= &today[..7.min(today.len())]
            || birth.format("%Y-%m").to_string() != self.birth_month
        {
            return Err(bad("PROFILE_BIRTH", "出生年月须早于本月"));
        }
        if !["male", "female_cadre", "female_worker"].contains(&self.worker.as_str()) {
            return Err(bad("PROFILE_WORKER", "请选择性别与职工类型"));
        }
        if self.region != "beijing" {
            return Err(bad("PROFILE_REGION", "目前只支持北京的参数表"));
        }
        if self.paid_months > 1200 {
            return Err(bad("PROFILE_MONTHS", "累计缴费月数不能超过 1200"));
        }
        money(&self.account_balance_cents, false, "个人账户余额")?;
        money(&self.base_cents, false, "缴费基数")?;
        if let Some(v) = self.past_index_hundredths {
            if !(1..=1000).contains(&v) {
                return Err(bad("PROFILE_INDEX", "历史平均缴费指数须在 0.01 到 10 之间"));
            }
        }
        if !(-36..=36).contains(&self.flex_months) {
            return Err(bad("PROFILE_FLEX", "弹性提前或延后最多 36 个月"));
        }
        if money(
            &self.personal_pension_annual_cents,
            false,
            "个人养老金年缴额",
        )? > PENSION_CAP_CENTS
        {
            return Err(bad("PROFILE_PENSION", "个人养老金每年最多缴 12000 元"));
        }
        rate(self.marginal_tax_hundredths, 0, 4500, "边际税率")?;
        let a = &self.assumptions;
        rate(a.inflation_hundredths, -1000, 2000, "通胀率")?;
        rate(a.wage_growth_hundredths, -1000, 2000, "工资增长率")?;
        rate(a.pp_return_hundredths, -1000, 3000, "个人养老金收益率")?;
        let r = &self.retire;
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

fn read(c: &Connection) -> Result<Option<Saved>> {
    let row: Option<(String, i64)> = c
        .query_row(
            "SELECT payload,revision FROM plan_profile WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    row.map(|(payload, revision)| {
        Ok(Saved {
            profile: serde_json::from_str(&payload)
                .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?,
            revision,
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
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("plan_profile", input))?);
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
            return read(&tx)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到个人资料"));
        }
        input.profile.validate(today)?;
        let old = read(&tx)?;
        if old.as_ref().map(|s| s.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "个人资料已变化，请重新读取",
            ));
        }
        let payload = serde_json::to_string(&input.profile)?;
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
            params![input.request_id, fingerprint, "profile"],
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
    }
    let stamp: Option<String> = c
        .query_row("SELECT updated_at FROM plan_profile", [], |r| r.get(0))
        .optional()?;
    if let Some(s) = stamp {
        chrono::DateTime::parse_from_rfc3339(&s).map_err(|_| bad())?;
    }
    Ok(())
}
