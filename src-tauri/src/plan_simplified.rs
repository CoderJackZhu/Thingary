//! Strict current general time/income DTO, no policy calculation.
use crate::domain::{date, Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reference {
    pub month: String,
    pub age_months: u32,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Time {
    #[serde(deserialize_with = "required_option")]
    pub reference: Option<Reference>,
    #[serde(deserialize_with = "required_option")]
    pub target_month: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub horizon_month: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FutureIncome {
    pub id: String,
    pub name: String,
    pub role: String,
    pub included: bool,
    #[serde(deserialize_with = "required_option")]
    pub monthly_cents: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub start_month: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub end_month: Option<String>,
    pub basis: String,
    #[serde(deserialize_with = "required_option")]
    pub basis_month: Option<String>,
    pub growth: String,
    #[serde(deserialize_with = "required_option")]
    pub source: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub source_checked_on: Option<String>,
    pub notes: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub contract_version: u32,
    pub time: Time,
    pub income_mode: String,
    pub future_incomes: Vec<FutureIncome>,
}
impl Default for Fields {
    fn default() -> Self {
        Self {
            contract_version: 1,
            time: Time::default(),
            income_mode: "unconfirmed".into(),
            future_incomes: vec![],
        }
    }
}
fn bad(message: &str) -> Error {
    Error::new("PLANNING_SIMPLIFIED", message)
}
pub(crate) fn month(v: &Option<String>) -> Result<()> {
    if let Some(s) = v {
        if s.len() != 7
            || !s.is_ascii()
            || s[..4]
                .parse::<u32>()
                .map_or(true, |y| !(1900..=9999).contains(&y))
            || date(&format!("{s}-01")).is_err()
        {
            return Err(bad("月份须为 YYYY-MM"));
        }
    }
    Ok(())
}
impl Fields {
    pub fn validate(&self, today: &str) -> Result<()> {
        if self.contract_version != 1
            || !["unconfirmed", "excluded", "manual"].contains(&self.income_mode.as_str())
            || self.future_incomes.len() > 20
        {
            return Err(bad("版本、收入选择或条数无效"));
        }
        month(&self.time.target_month)?;
        month(&self.time.horizon_month)?;
        if let Some(r) = &self.time.reference {
            month(&Some(r.month.clone()))?;
            if r.age_months > 1440 || r.month.as_str() > &today[..7] {
                return Err(bad("年龄参考无效"));
            }
        }
        if matches!((&self.time.target_month,&self.time.horizon_month),(Some(a),Some(b)) if b<=a) {
            return Err(bad("终点须晚于目标月"));
        }
        let mut ids = HashSet::new();
        for i in &self.future_incomes {
            if i.id.trim().is_empty()
                || i.id.len() > 120
                || !ids.insert(&i.id)
                || i.name.trim().is_empty()
                || i.name.chars().count() > 120
                || !["pension", "other"].contains(&i.role.as_str())
                || i.notes.chars().count() > 10000
                || i.source.as_ref().is_some_and(|s| s.chars().count() > 10000)
            {
                return Err(bad("收入身份或文字无效"));
            }
            if let Some(v) = &i.monthly_cents {
                let n = v.parse::<i64>().map_err(|_| bad("金额无效"))?;
                if n.to_string() != *v || !(0..=crate::domain::MAX_CENTS).contains(&n) {
                    return Err(bad("月金额须为0到99999999999的规范整数分"));
                }
            }
            month(&i.start_month)?;
            month(&i.end_month)?;
            month(&i.basis_month)?;
            if matches!((&i.start_month,&i.end_month),(Some(a),Some(b)) if b<a) {
                return Err(bad("收入结束早于开始"));
            }
            match i.basis.as_str() {
                "reference_month" if i.basis_month.is_some() => {}
                "start_month" if i.basis_month.is_none() => {}
                _ => return Err(bad("金额基准无效")),
            }
            if !["fixed_nominal", "constant_purchasing_power"].contains(&i.growth.as_str()) {
                return Err(bad("增长假设无效"));
            }
            if let Some(d) = &i.source_checked_on {
                date(d)?;
                if d.as_str() > today {
                    return Err(bad("来源日期晚于今天"));
                }
            }
        }
        Ok(())
    }
}

fn required_option<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}
