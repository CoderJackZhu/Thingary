//! One-way removal at the schema boundary. No old DTO, calculator or replay path.
use crate::{
    domain::{Error, Result},
    plan_profile::Profile,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

fn bad() -> Error {
    Error::new("PLANNING_MIGRATION", "旧规划格式或保全资料损坏，转换已停止")
}
fn object(v: &Value) -> Result<&serde_json::Map<String, Value>> {
    v.as_object().ok_or_else(bad)
}
fn copy(src: &Value, dst: &mut Value, fields: &[&str]) -> Result<()> {
    let src = object(src)?;
    for key in fields {
        if let Some(v) = src.get(*key) {
            dst[*key] = v.clone();
        }
    }
    Ok(())
}
fn array<'a>(src: &'a Value, key: &str) -> Result<&'a [Value]> {
    match src.get(key) {
        None => Ok(&[]),
        Some(v) => v.as_array().map(Vec::as_slice).ok_or_else(bad),
    }
}
/// Only independently interpretable general values cross this boundary.
fn convert(old: &Value) -> Result<Profile> {
    // Isolated development checkpoints may already have current data in schema35.
    if let Ok(p) = serde_json::from_value::<Profile>(old.clone()) {
        return Ok(p);
    }
    object(old)?;
    if old
        .get("retire")
        .and_then(|r| r.get("simplified"))
        .is_some()
    {
        return Err(bad());
    }
    let mut new = serde_json::to_value(crate::plan_basic::empty_profile())?;
    if let Some(a) = old.get("assumptions") {
        copy(a, &mut new["assumptions"], &["inflation_hundredths"])?;
    }
    let Some(r) = old.get("retire") else {
        return Ok(serde_json::from_value(new)?);
    };
    object(r)?;
    let n = &mut new["retire"];
    copy(
        r,
        n,
        &[
            "spend_cents",
            "real_return_before_hundredths",
            "real_return_after_hundredths",
            "emergency_months",
            "mode",
            "volatility_hundredths",
            "rent_cents",
        ],
    )?;
    // No implicit reconfirmation of age, old income choice, future deposits or unlocks.
    n["setup_completed"] = json!(false);
    if let Some(c) = r.get("core").filter(|v| !v.is_null()) {
        let mut core = json!({"contract_version":1,"monetary_basis_date":null,"fund_rules":[],"releases":[],"occurrences":[],"debt_repayments":[]});
        copy(
            c,
            &mut core,
            &[
                "contract_version",
                "monetary_basis_date",
                "fund_rules",
                "occurrences",
                "debt_repayments",
            ],
        )?;
        n["core"] = core;
    }
    if let Some(b) = r.get("basic").filter(|v| !v.is_null()) {
        let mut basic = json!({"contract_version":1,"start":null,"contribution":null,"contribution_costs":[],"retirement_costs":[]});
        copy(
            b,
            &mut basic,
            &["contract_version", "start", "contribution"],
        )?;
        for key in ["contribution_costs", "retirement_costs"] {
            let mut scopes = vec![];
            for s in array(b, key)? {
                let id = object(s)?
                    .get("source_id")
                    .and_then(Value::as_str)
                    .ok_or_else(bad)?;
                if ![
                    "personal_pension",
                    "social_insurance",
                    "state_pension_estimate",
                    "beijing_state_pension",
                ]
                .contains(&id)
                {
                    scopes.push(s.clone());
                }
            }
            basic[key] = json!(scopes);
        }
        n["basic"] = basic;
    }
    for s in array(r, "spend_items")? {
        let mut item = json!({"id":null,"label":null,"monthly_cents":null,"start_month":null,"end_month":null,"inflation_hundredths":null,"essential":false,"time_unconfirmed":false});
        copy(
            s,
            &mut item,
            &[
                "id",
                "label",
                "monthly_cents",
                "inflation_hundredths",
                "essential",
            ],
        )?;
        item["time_unconfirmed"] = json!(
            s.get("start_age").is_some_and(|v| !v.is_null())
                || s.get("end_age").is_some_and(|v| !v.is_null())
        );
        n["spend_items"].as_array_mut().ok_or_else(bad)?.push(item);
    }
    for e in array(r, "life_events")? {
        let mut event = json!({"id":null,"label":null,"kind":null,"date":null,"included":false,"price_cents":null,"down_cents":null,"extra_cents":null,"loan_rate_hundredths":0,"loan_years":0,"holding_cents":null,"rent_saved_cents":null,"cycle_years":null,"until_month":null,"time_unconfirmed":false,"resale_cents":null});
        copy(
            e,
            &mut event,
            &[
                "id",
                "label",
                "kind",
                "date",
                "included",
                "price_cents",
                "down_cents",
                "extra_cents",
                "loan_rate_hundredths",
                "loan_years",
                "holding_cents",
                "rent_saved_cents",
                "cycle_years",
                "resale_cents",
            ],
        )?;
        event["time_unconfirmed"] = json!(e.get("until_age").is_some_and(|v| !v.is_null()));
        n["life_events"].as_array_mut().ok_or_else(bad)?.push(event);
    }
    let selected = r
        .get("basic")
        .and_then(|b| b.get("retirement_income"))
        .and_then(|i| i.get("selected"));
    let selected = match selected {
        None => &[][..],
        Some(v) => v.as_array().map(Vec::as_slice).ok_or_else(bad)?,
    };
    for i in array(r, "income_items")? {
        let id = object(i)?
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(bad)?;
        // The special state-pension manual replacement was still a policy input.
        if selected.iter().any(|s| {
            s.get("id").and_then(Value::as_str) == Some(id)
                && (s.get("role").and_then(Value::as_str) == Some("state_pension")
                    || s.get("source_id").and_then(Value::as_str) == Some("state_pension_estimate"))
        }) {
            continue;
        }
        let indexed = i.get("indexed").and_then(Value::as_bool).ok_or_else(bad)?;
        let basis_month = n["core"]
            .get("monetary_basis_date")
            .and_then(Value::as_str)
            .and_then(|d| d.get(..7))
            .map(str::to_owned);
        let flow = json!({"id":id,"name":i.get("label").ok_or_else(bad)?,"role":"other","included":true,"monthly_cents":i.get("monthly_cents").ok_or_else(bad)?,"start_month":null,"end_month":null,"basis":if basis_month.is_some(){"reference_month"}else{"start_month"},"basis_month":basis_month,"growth":if indexed{"constant_purchasing_power"}else{"fixed_nominal"},"source":null,"source_checked_on":null,"notes":""});
        n["simplified"]["future_incomes"]
            .as_array_mut()
            .ok_or_else(bad)?
            .push(flow);
    }
    serde_json::from_value(new).map_err(|_| bad())
}
fn checked(c: &Connection, payload: &str, stamp: &str) -> Result<Profile> {
    chrono::DateTime::parse_from_rfc3339(stamp).map_err(|_| bad())?;
    let p = convert(&serde_json::from_str(payload).map_err(|_| bad())?)?;
    p.validate("9999-12-31")?;
    if let Some(core) = &p.retire.core {
        core.validate_references(c, false)?;
    }
    Ok(p)
}
/// Legacy archives are checked read-only with the identical converter; all other
/// dataset, schema, archive, attachment and FK checks stay in backup.rs.
pub(crate) fn validate_legacy(c: &Connection) -> Result<()> {
    let row: Option<(String, String)> = c
        .query_row(
            "SELECT payload,updated_at FROM plan_profile WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((payload, stamp)) = row {
        checked(c, &payload, &stamp)?;
    }
    Ok(())
}
/// Called inside the existing schema transaction, after facts have been upgraded.
pub(crate) fn migrate(c: &Connection, hook: &dyn Fn(&str) -> Result<()>) -> Result<()> {
    let row: Option<(String, String)> = c
        .query_row(
            "SELECT payload,updated_at FROM plan_profile WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((old, stamp)) = row {
        let p = checked(c, &old, &stamp)?;
        let value = serde_json::to_value(p)?;
        if value != serde_json::from_str::<Value>(&old)? {
            c.execute(
                "UPDATE plan_profile SET payload=?1,revision=revision+1 WHERE id=1",
                params![serde_json::to_string(&value)?],
            )?;
        }
    }
    // feature_requests contains id/fingerprint/result, never policy payload.
    // Preserve every receipt, including mixed factual writes. No replay adapter.
    hook("migration.planning.converted")?;
    Ok(())
}

pub(crate) fn requires_reset(c: &Connection) -> Result<bool> {
    let payload: Option<String> = c
        .query_row("SELECT payload FROM plan_profile WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(payload.is_some_and(|p| serde_json::from_str::<Profile>(&p).is_err()))
}
