//! Independent planning cash-flow kernel. All amounts are unrounded real cents.
mod comparisons;
mod ledger;
mod model;
mod simulation;
#[cfg(any(target_arch = "wasm32", test))]
mod wasm;
use ledger::*;
use model::*;
use serde_json::{json, Value};
fn serialize<T: serde::Serialize>(x: T) -> Res<Value> {
    serde_json::to_value(x).map_err(|e| e.to_string())
}
fn required_num(v: &Value, key: &str) -> Res<f64> {
    let x = v
        .get(key)
        .ok_or_else(|| format!("{key} required"))?
        .as_f64()
        .ok_or_else(|| format!("{key} must be number"))?;
    if !x.is_finite() {
        return err("nonfinite argument");
    }
    Ok(x)
}
/// Maximum UTF-8 request size for both native byte transport and the WASM ABI.
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
fn finite_json(v: &Value) -> Res<()> {
    match v {
        Value::Number(x) => {
            let n = x.as_f64().ok_or("invalid JSON number")?;
            if !n.is_finite() {
                return err("nonfinite output number");
            }
        }
        Value::Array(a) => {
            for x in a {
                finite_json(x)?
            }
        }
        Value::Object(o) => {
            for x in o.values() {
                finite_json(x)?
            }
        }
        _ => {}
    }
    Ok(())
}
/// Dispatch a data-only request; validation errors are descriptive strings.
pub fn dispatch(request: Value) -> Result<Value, String> {
    let op = request
        .get("op")
        .and_then(Value::as_str)
        .ok_or("request op must be a string")?;
    let result = if op == "retirement_step" {
        let balance = required_num(&request, "balance")?;
        let growth = required_num(&request, "growth")?;
        let lump = required_num(&request, "lump")?;
        let spend = required_num(&request, "spend")?;
        let income = required_num(&request, "income")?;
        serialize(step(balance, growth, lump, spend, income)?)?
    } else if op == "sensitivity_severity" {
        let baseline =
            comparisons::parse_outcome(request.get("baseline").ok_or("baseline required")?)?;
        let stressed =
            comparisons::parse_outcome(request.get("stressed").ok_or("stressed required")?)?;
        json!(comparisons::severity(&baseline, &stressed))
    } else if op == "summarize_paths" {
        let s = serde_json::from_value(request.get("samples").ok_or("samples required")?.clone())
            .map_err(|e| format!("invalid samples: {e}"))?;
        simulation::summarize(s)?
    } else {
        let p = Plan::parse(request.get("plan").ok_or("plan required")?)?;
        if op == "nominal_factor" {
            let m = arg_int(&request, "month", p.now_months)?;
            pos(m)?;
            if m < p.now_months || m > p.horizon_months {
                return err("nominal_factor month outside plan");
            }
            json!(p.nominal((m - p.now_months) as usize)?)
        } else if op == "sensitivity_parameters" {
            comparisons::parameters(&p)
        } else {
            let s = Schedule::compile(&p)?;
            match op {
                "tables" => s.tables(),
                "required" => {
                    let from = arg_int(&request, "from", p.now_months)?;
                    let retire = arg_int(&request, "retire", from)?;
                    pos(from)?;
                    pos(retire)?;
                    if from < p.horizon_months
                        && (retire < p.now_months || retire > p.horizon_months)
                    {
                        return err("retire outside plan");
                    };
                    let pen = if let Some(v) = request.get("pension") {
                        parse_pension(v)?
                    } else {
                        p.pension(retire)
                    };
                    json!(required(&p, &s, from, retire, &pen)?)
                }
                "required_series" => json!(requirements(&p, &s)?),
                "coast" => {
                    let from = arg_int(&request, "from", p.now_months)?;
                    pos(from)?;
                    json!(coast(&p, &s, from, false)?)
                }
                "matrix" => comparisons::matrix(&p, &request)?,
                "sensitivity" => comparisons::sensitivity(&p, &request)?,
                "solve_contribution" => comparisons::solve_contribution(&p, &s, &request)?,
                "project" | "outcome" | "glide" | "coverage_at" | "simulate" | "simulate_paths"
                | "sequence" => {
                    let req = requirements(&p, &s)?;
                    match op {
                        "project" => {
                            serialize(project(&p, &s, &req, &Options::parse(&request, &p)?)?)?
                        }
                        "simulate_paths" => {
                            serialize(simulation::simulate_paths(&p, &s, &req, &request)?)?
                        }
                        "simulate" => simulation::summarize(simulation::simulate_paths(
                            &p, &s, &req, &request,
                        )?)?,
                        "sequence" => simulation::sequence(&p, &s, &req, &request)?,
                        _ => {
                            let q = projection_arg(&request, &p, &s, &req)?;
                            match op {
                                "outcome" => serialize(outcome(&p, &s, &req, &q)?)?,
                                "glide" => {
                                    let r = q
                                        .rows
                                        .iter()
                                        .map(|row| {
                                            let m = row.start_month;
                                            if let Some(retire) = q.retire_month.filter(|r| *r <= m)
                                            {
                                                required(
                                                    &p,
                                                    &s,
                                                    m,
                                                    retire,
                                                    &q.pension
                                                        .clone()
                                                        .unwrap_or_else(|| p.pension(retire)),
                                                )
                                            } else if m < p.target_months {
                                                coast(&p, &s, m, true)
                                            } else {
                                                required(&p, &s, m, m, &p.pension(m))
                                            }
                                        })
                                        .collect::<Res<Vec<_>>>()?;
                                    json!(r)
                                }
                                "coverage_at" => {
                                    let m = arg_int(&request, "month", p.now_months)?;
                                    if m < p.now_months || m >= p.horizon_months {
                                        return err("coverage_at requires a recurring month");
                                    };
                                    let i = (m - p.now_months) as usize;
                                    let retired = q.retire_month.is_some_and(|r| r <= m);
                                    let items = s
                                        .income_items
                                        .iter()
                                        .map(|x| x.at(i, retired))
                                        .chain(s.future_items.iter().map(|x| x.at(i, true)))
                                        .collect::<Vec<_>>();
                                    json!( {
                                        "spend":if retired {
                                            s.spend[i]
                                        }
                                        else {
                                            0.
                                        },
                                        "essential":if retired {
                                            s.essential[i]
                                        }
                                        else {
                                            0.
                                        },
                                        "items":items,
                                        "expense_items":s.expense_items.iter().map(|x|x.at(i, retired)).collect::<Vec<_>>(),
                                        "flow_items":s.flow_items.iter().map(|x|x.at(i, retired)).collect::<Vec<_>>(),
                                        "pension":if retired {
                                            pension_income(&p, &q.pension.clone().unwrap_or_else(||p.pension(m)), m)
                                        }
                                        else {
                                            0.
                                        },
                                        "withdrawal":q.withdrawn[i],
                                        "unfunded":q.unfunded[i]
                                    })
                                }
                                _ => return err("unknown operation"),
                            }
                        }
                    }
                }
                _ => return err("unknown operation"),
            }
        }
    };
    finite_json(&result)?;
    Ok(result)
}
/// UTF-8 JSON ABI payload, also used to verify the native and WASM shared dispatch.
pub fn evaluate_bytes(input: &[u8]) -> Vec<u8> {
    let result = if input.len() > MAX_INPUT_BYTES {
        err("input exceeds 64 MiB transport limit")
    } else {
        serde_json::from_slice(input)
            .map_err(|e| format!("invalid JSON: {e}"))
            .and_then(dispatch)
    };
    let wrapper = match result {
        Ok(value) => json!( {
            "ok":true,
            "value":value
        }),
        Err(error) => json!( {
            "ok":false,
            "error":error
        }),
    };
    serde_json::to_vec(&wrapper)
        .unwrap_or_else(|_| b"{\"ok\":false,\"error\":\"serialization error\"}".to_vec())
}
