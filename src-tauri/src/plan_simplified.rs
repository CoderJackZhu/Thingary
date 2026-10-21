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
pub struct Partner {
    pub birth_month: String,
    #[serde(deserialize_with = "required_option")]
    pub stop_age_months: Option<u32>,
    #[serde(deserialize_with = "required_option")]
    pub monthly_cents: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Household {
    pub mode: String,
    #[serde(deserialize_with = "required_option")]
    pub partner: Option<Partner>,
}
impl Default for Household {
    fn default() -> Self {
        Self {
            mode: "single".into(),
            partner: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub contract_version: u32,
    pub time: Time,
    pub income_mode: String,
    pub future_incomes: Vec<FutureIncome>,
    #[serde(default)]
    pub household: Household,
}
impl Default for Fields {
    fn default() -> Self {
        Self {
            contract_version: 1,
            time: Time::default(),
            income_mode: "unconfirmed".into(),
            future_incomes: vec![],
            household: Household::default(),
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
    fn validate_household(&self, today: &str) -> Result<()> {
        let h = &self.household;
        let this_month = &today[..7];
        match (h.mode.as_str(), &h.partner) {
            ("single", None) => return Ok(()),
            ("couple", Some(_)) => {}
            ("single", Some(_)) => return Err(bad("单人规划不应填写伴侣")),
            ("couple", None) => return Err(bad("请填写伴侣信息")),
            _ => return Err(bad("家庭类型无效")),
        }
        let p = h.partner.as_ref().expect("checked above");
        if month(&Some(p.birth_month.clone())).is_err() || p.birth_month.as_str() > this_month {
            return Err(bad("伴侣出生年月无效"));
        }
        let Some(age) = p.stop_age_months else {
            if p.monthly_cents.is_some() {
                return Err(bad("「跟我同时」时不填伴侣存款"));
            }
            return Ok(());
        };
        let idx = |m: &str| -> i64 {
            m[..4].parse::<i64>().unwrap_or(0) * 12 + m[5..7].parse::<i64>().unwrap_or(1) - 1
        };
        if age > 1440 {
            return Err(bad("伴侣停工年龄须为 0 到 1440 个整月"));
        }
        if idx(&p.birth_month) + i64::from(age) <= idx(this_month) {
            return Err(bad("伴侣停工年龄须晚于现在"));
        }
        if let Some(v) = &p.monthly_cents {
            let ok = v
                .parse::<i64>()
                .is_ok_and(|n| n.to_string() == *v && (0..=crate::domain::MAX_CENTS).contains(&n));
            if !ok {
                return Err(bad("伴侣每月存款须为规范整数分"));
            }
        }
        Ok(())
    }
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
        self.validate_household(today)?;
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

#[cfg(test)]
mod household_tests {
    use super::*;
    const TODAY: &str = "2026-10-21";
    fn couple(birth: &str, stop: Option<u32>, cents: Option<&str>) -> Fields {
        Fields {
            household: Household {
                mode: "couple".into(),
                partner: Some(Partner {
                    birth_month: birth.into(),
                    stop_age_months: stop,
                    monthly_cents: cents.map(Into::into),
                }),
            },
            ..Fields::default()
        }
    }
    #[test]
    fn old_json_without_household_reads_as_single() {
        let mut j = serde_json::to_value(Fields::default()).unwrap();
        j.as_object_mut().unwrap().remove("household");
        let f: Fields = serde_json::from_value(j).unwrap();
        assert_eq!(f.household, Household::default());
        assert!(f.validate(TODAY).is_ok());
    }
    #[test]
    fn unknown_or_missing_keys_in_household_are_rejected() {
        let mut j = serde_json::to_value(couple("1990-01", Some(600), None)).unwrap();
        j["household"]["extra"] = serde_json::json!(1);
        assert!(serde_json::from_value::<Fields>(j.clone()).is_err());
        j["household"].as_object_mut().unwrap().remove("extra");
        j["household"]["partner"]["extra"] = serde_json::json!(1);
        assert!(serde_json::from_value::<Fields>(j.clone()).is_err());
        j["household"]["partner"]
            .as_object_mut()
            .unwrap()
            .remove("extra");
        j["household"]["partner"]
            .as_object_mut()
            .unwrap()
            .remove("monthly_cents");
        assert!(serde_json::from_value::<Fields>(j).is_err());
    }
    #[test]
    fn household_rules() {
        let ok = |f: Fields| f.validate(TODAY).is_ok();
        assert!(ok(couple("1990-01", Some(600), None)));
        assert!(ok(couple("1990-01", Some(600), Some("0"))));
        assert!(ok(couple("1990-01", Some(600), Some("99999999999"))));
        assert!(ok(couple("1990-01", None, None)));
        assert!(ok(couple("2026-10", Some(1), None)));
        // mode and partner pairing
        let mut f = couple("1990-01", None, None);
        f.household.mode = "single".into();
        assert!(!ok(f));
        let mut f = Fields::default();
        f.household.mode = "couple".into();
        assert!(!ok(f));
        let mut f = couple("1990-01", None, None);
        f.household.mode = "other".into();
        assert!(!ok(f));
        // birth month
        assert!(!ok(couple("2026-11", None, None)));
        assert!(!ok(couple("1990-13", None, None)));
        assert!(!ok(couple("90-01", None, None)));
        // stop age
        assert!(!ok(couple("1990-01", Some(1441), None)));
        assert!(!ok(couple("1990-01", Some(432), None))); // 2026-01, past
        assert!(!ok(couple("1990-01", Some(441), None))); // 2026-10 == today
        assert!(ok(couple("1990-01", Some(442), None)));
        // cents
        assert!(!ok(couple("1990-01", None, Some("100"))));
        for bad_cents in ["01", "-1", "100000000000", "1.5", ""] {
            assert!(
                !ok(couple("1990-01", Some(600), Some(bad_cents))),
                "{bad_cents}"
            );
        }
    }
    #[test]
    fn couple_household_roundtrips() {
        let f = couple("1990-01", Some(600), Some("120000"));
        let back: Fields = serde_json::from_str(&serde_json::to_string(&f).unwrap()).unwrap();
        assert_eq!(back, f);
        let j = serde_json::to_value(&Fields::default()).unwrap();
        assert_eq!(
            j["household"],
            serde_json::json!({"mode":"single","partner":null})
        );
    }
}
