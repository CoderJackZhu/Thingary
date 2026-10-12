//! Independent assumption partition. Legacy profile payloads and request hashes stay unchanged.
use crate::{
    domain::{Error, Result},
    plan_profile::{Profile, Saved},
    storage::{digest, Store},
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Values {
    pub real_return_before_hundredths: i32,
    pub real_return_after_hundredths: i32,
    pub inflation_hundredths: i32,
    pub volatility_hundredths: i32,
}
impl Default for Values {
    fn default() -> Self {
        Self {
            real_return_before_hundredths: 0,
            real_return_after_hundredths: 0,
            inflation_hundredths: 200,
            volatility_hundredths: 500,
        }
    }
}
impl Values {
    pub fn of(p: &Profile) -> Self {
        Self {
            real_return_before_hundredths: p.retire.real_return_before_hundredths,
            real_return_after_hundredths: p.retire.real_return_after_hundredths,
            inflation_hundredths: p.assumptions.inflation_hundredths,
            volatility_hundredths: p.retire.volatility_hundredths,
        }
    }
    fn validate(&self) -> Result<()> {
        for (v, lo, hi) in [
            (self.real_return_before_hundredths, -1000, 2000),
            (self.real_return_after_hundredths, -1000, 2000),
            (self.inflation_hundredths, 0, 2000),
            (self.volatility_hundredths, 0, 6000),
        ] {
            if !(lo..=hi).contains(&v) {
                return Err(Error::new("INVALID_INPUT", "收益、通胀或波动超出范围"));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub values: Values,
    pub confirm: bool,
}
#[derive(Debug, Serialize)]
pub struct Read {
    pub generation: String,
    pub revision: Option<i64>,
    pub values: Values,
    pub confirmation: String,
    pub confirmed_values: Option<Values>,
}
fn check(c: &Connection) -> Result<Option<(Values, bool)>> {
    let raw: Option<(String, bool)> = c
        .query_row(
            "SELECT confirmed_values,needs_review FROM plan_assumption_checks WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    raw.map(|(v, b)| Ok((serde_json::from_str(&v)?, b)))
        .transpose()
}
pub(crate) fn sync(
    c: &Connection,
    old: Option<&Profile>,
    new: &Profile,
    confirm: Option<bool>,
) -> Result<()> {
    let values = Values::of(new);
    if confirm == Some(true) {
        c.execute("INSERT INTO plan_assumption_checks VALUES(1,?1,0) ON CONFLICT(id) DO UPDATE SET confirmed_values=excluded.confirmed_values,needs_review=0",[serde_json::to_string(&values)?])?;
    } else if old.is_some_and(|p| Values::of(p) != values) {
        c.execute(
            "UPDATE plan_assumption_checks SET needs_review=1 WHERE id=1",
            [],
        )?;
    }
    Ok(())
}
impl Store {
    pub fn plan_assumptions_read(&self, generation: &str) -> Result<Read> {
        self.check_generation(generation)?;
        if !crate::modules::read(&self.root).planning {
            return Err(Error::new("MODULE_DISABLED", "规划模块已关闭"));
        }
        let saved = self.plan_profile()?.saved;
        let check = check(self.conn()?)?;
        let values = saved
            .as_ref()
            .map_or_else(Values::default, |s| Values::of(&s.profile));
        let confirmation = match &check {
            None => "unconfirmed",
            Some((v, false)) if *v == values => "confirmed",
            Some(_) => "needs_review",
        }
        .into();
        Ok(Read {
            generation: self.generation(),
            revision: saved.as_ref().map(|s| s.revision),
            values,
            confirmation,
            confirmed_values: check.map(|(v, _)| v),
        })
    }
    pub fn plan_assumptions_save(&mut self, input: &Save, today: &str) -> Result<Saved> {
        if !crate::modules::read(&self.root).planning {
            return Err(Error::new("MODULE_DISABLED", "规划模块已关闭"));
        }
        let fingerprint = digest(&serde_json::to_vec(&("plan_assumptions_save", input))?);
        self.save_profile_request(
            &input.request_id,
            &input.generation,
            input.expected_revision,
            today,
            &[fingerprint],
            |old| {
                input.values.validate()?;
                let mut p = old
                    .filter(|p| p.retire.basic.is_some())
                    .cloned()
                    .ok_or_else(|| Error::new("PROFILE_REQUIRED", "请先保存规划，再核对假设"))?;
                p.retire.real_return_before_hundredths = input.values.real_return_before_hundredths;
                p.retire.real_return_after_hundredths = input.values.real_return_after_hundredths;
                p.retire.volatility_hundredths = input.values.volatility_hundredths;
                p.assumptions.inflation_hundredths = input.values.inflation_hundredths;
                Ok((p, Some(input.confirm)))
            },
        )
    }
}
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    if let Some((v, _)) = check(c)? {
        v.validate()?;
    }
    Ok(())
}

pub(crate) fn export_value(c: &Connection) -> Result<Option<serde_json::Value>> {
    let Some(saved) = crate::plan_profile::read(c)? else {
        return Ok(None);
    };
    let values = Values::of(&saved.profile);
    let checks = check(c)?;
    let confirmation = match &checks {
        None => "unconfirmed",
        Some((v, false)) if *v == values => "confirmed",
        Some(_) => "needs_review",
    };
    Ok(Some(
        serde_json::json!({"revision":saved.revision,"values":values,"confirmation":confirmation,"confirmed_values":checks.map(|(v,_)|v)}),
    ))
}
