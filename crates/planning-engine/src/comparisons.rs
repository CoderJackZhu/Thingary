use crate::ledger::*;
use crate::model::*;
use serde_json::{json, Value};
fn run(p: &Plan, o: &Options) -> Res<Outcome> {
    let s = Schedule::compile(p)?;
    let r = requirements(p, &s)?;
    let q = project(p, &s, &r, o)?;
    outcome(p, &s, &r, &q)
}
fn budget(p: &Plan) -> f64 {
    p.items.iter().map(|x| x.monthly_cents).sum()
}
fn set_budget(p: &mut Plan, cents: f64) -> Res<()> {
    amount(cents, true)?;
    let base = budget(p);
    if base > 0. {
        for x in &mut p.items {
            x.monthly_cents = bounded(x.monthly_cents * cents / base)?;
        }
    } else if cents > 0. {
        let mut id = "hypothetical_budget".to_owned();
        while p.items.iter().any(|x| x.id == id) {
            id.push('_')
        }
        p.items.push(Item {
            id,
            label: "假设生活预算".into(),
            monthly_cents: cents,
            start_age: None,
            end_age: None,
            inflation_hundredths: None,
            essential: true,
        });
    }
    Ok(())
}
fn contribution_reference(p: &Plan) -> f64 {
    if p.saving_phases.is_empty() {
        p.saving_cents.max(0.)
    } else {
        p.saving_phases
            .iter()
            .find(|x| x.cents > 0.)
            .map_or(0., |x| x.cents)
    }
}
fn set_contribution(p: &mut Plan, cents: f64) -> Res<()> {
    amount(cents, true)?;
    let reference = contribution_reference(p);
    // Preserve the exact baseline, including zero and negative phase values.
    if cents == reference {
        return Ok(());
    }
    let adjust = |value: f64| -> Res<f64> {
        if value < 0. {
            Ok(value)
        } else if reference == 0. {
            Ok(cents)
        } else if value > 0. {
            bounded(value / reference * cents)
        } else {
            Ok(0.)
        }
    };
    p.saving_cents = adjust(p.saving_cents)?;
    for x in &mut p.saving_phases {
        x.cents = adjust(x.cents)?;
    }
    Ok(())
}
fn axis(v: &Value, key: &str, defaults: Vec<f64>, check: impl Fn(f64) -> Res<()>) -> Res<Vec<f64>> {
    let mut a = if let Some(x) = v.get(key) {
        let xs = x.as_array().ok_or("matrix axis must be array")?;
        if xs.is_empty() || xs.len() > 11 {
            return err("matrix axis needs 1..11 values");
        };
        xs.iter()
            .map(|x| x.as_f64().ok_or("axis values must be numeric".into()))
            .collect::<Res<Vec<_>>>()?
    } else {
        defaults
    };
    for x in &a {
        check(*x)?
    }
    a.sort_by(f64::total_cmp);
    a.dedup();
    if a.is_empty() || a.len() > 11 {
        return err("matrix axis needs 1..11 distinct entries");
    }
    Ok(a)
}
fn cell(out: Outcome) -> Value {
    json!( {
        "fi_month":out.fi_month,
        "retire_month":out.retire_month,
        "funded_at_goal":out.funded_at_goal,
        "shortfall_at_goal":out.shortfall_at_goal,
        "at_horizon":out.at_horizon,
        "failed":out.failure_month.is_some()||out.shortfall_month.is_some()
    })
}
pub fn matrix(p: &Plan, v: &Value) -> Res<Value> {
    let kind = v
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("matrix kind required")?;
    let o = Options {
        year: arg_int(v, "year", 0)?,
        ..Options::default()
    };
    let (rows, cols, br, bc) = match kind {
        "contribution_return" => {
            let defaults = [-100., 0., 100.]
                .into_iter()
                .filter(|d| {
                    p.r_before_hundredths + d > -10000. && p.r_after_hundredths + d > -10000.
                })
                .collect();
            let r = axis(v, "rows", defaults, |x| {
                rate(p.r_before_hundredths + x)?;
                rate(p.r_after_hundredths + x)
            })?;
            let b = contribution_reference(p);
            let step = (b / 12.).max(100.);
            let c = axis(
                v,
                "cols",
                vec![(b - step).max(0.), b, (b + step).min(LIMIT)],
                |x| amount(x, true),
            )?;
            (r, c, 0., b)
        }
        "target_spending" => {
            let b = budget(p);
            amount(b, true)?;
            let step = (b / 30.).max(100.);
            let r = axis(
                v,
                "rows",
                vec![(b - step).max(0.), b, (b + step).min(LIMIT)],
                |x| amount(x, true),
            )?;
            let t = p.target_months;
            let c = axis(
                v,
                "cols",
                vec![
                    (t - 12).max(0) as f64,
                    t as f64,
                    (t + 12).min(p.horizon_months) as f64,
                ],
                |x| {
                    if !x.is_finite() || x.fract() != 0. || x < 0. || x > p.horizon_months as f64 {
                        return err("invalid target axis");
                    }
                    Ok(())
                },
            )?;
            (r, c, b, t as f64)
        }
        _ => return err("unknown matrix kind"),
    };
    let mut cells = Vec::new();
    if kind == "contribution_return" {
        let schedules = cols
            .iter()
            .map(|c| {
                let mut pp = p.clone();
                set_contribution(&mut pp, *c)?;
                let s = Schedule::compile(&pp)?;
                Ok((pp, s))
            })
            .collect::<Res<Vec<_>>>()?;
        for r in &rows {
            let mut rp = p.clone();
            rp.r_before_hundredths += r;
            rp.r_after_hundredths += r;
            let req = requirements(&rp, &schedules[0].1)?;
            let mut line = Vec::new();
            for (pp, s) in &schedules {
                let mut pp = pp.clone();
                pp.r_before_hundredths = rp.r_before_hundredths;
                pp.r_after_hundredths = rp.r_after_hundredths;
                let q = project(&pp, s, &req, &o)?;
                line.push(cell(outcome(&pp, s, &req, &q)?));
            }
            cells.push(line);
        }
    } else {
        for r in &rows {
            let mut pp = p.clone();
            set_budget(&mut pp, *r)?;
            let s = Schedule::compile(&pp)?;
            let req = requirements(&pp, &s)?;
            let mut line = Vec::new();
            for c in &cols {
                pp.target_months = *c as i64;
                let q = project(&pp, &s, &req, &o)?;
                line.push(cell(outcome(&pp, &s, &req, &q)?));
            }
            cells.push(line);
        }
    }
    let mut out = json!( {
        "rows":rows,
        "cols":cols,
        "cells":cells,
        "base_row":rows.iter().position(|x|*x==br),
        "base_col":cols.iter().position(|x|*x==bc)
    });
    if kind == "target_spending" {
        out["column_kind"] = json!("month");
        out["column_labels"] = json!(cols
            .iter()
            .map(|m| p.calendar(*m as i64))
            .collect::<Vec<_>>());
    }
    Ok(out)
}
pub fn parameters(p: &Plan) -> Value {
    let necessary: f64 = p
        .items
        .iter()
        .filter(|x| x.essential)
        .map(|x| x.monthly_cents)
        .sum();
    json!( {
        "saving_reduction_cents":(contribution_reference(p)/12.).max(100.),
        "necessary_increase_cents":(necessary/30.).max(100.),
        "return_reduction_hundredths":100f64.min((p.r_before_hundredths+10000.)/2.).min((p.r_after_hundredths+10000.)/2.),
        "inflation_increase_hundredths":100.,
        "target_delay_months":12,
        "adverse_return":(1.+p.r_after_hundredths/10000.)*0.9-1.
    })
}
pub fn severity(a: &Outcome, b: &Outcome) -> &'static str {
    let earlier =
        |old: Option<i64>, new: Option<i64>| new.is_some() && (old.is_none() || new < old);
    if (a.success && !b.success)
        || (a.funded_at_goal && !b.funded_at_goal)
        || (a.fi_month.is_some() && b.fi_month.is_none())
        || earlier(a.failure_month, b.failure_month)
        || earlier(a.shortfall_month, b.shortfall_month)
    {
        "high"
    } else if b.shortfall_at_goal > a.shortfall_at_goal + EPS
        || b.at_horizon < a.at_horizon - EPS
        || a.fi_month.zip(b.fi_month).is_some_and(|(x, y)| y > x)
    {
        "medium"
    } else {
        "low"
    }
}
pub fn parse_outcome(v: &Value) -> Res<Outcome> {
    // Nullable fields must be explicitly present, just like required scalar fields.
    for key in [
        "fi_month",
        "retire_month",
        "assets_at_goal",
        "required_at_goal",
        "funded_at_goal",
        "shortfall_at_goal",
        "at_horizon",
        "failure_month",
        "shortfall_month",
        "success",
    ] {
        if v.get(key).is_none() {
            return err("incomplete Outcome");
        }
    }
    let out: Outcome =
        serde_json::from_value(v.clone()).map_err(|e| format!("invalid Outcome: {e}"))?;
    for x in [out.assets_at_goal, out.at_horizon] {
        amount(x, false)?;
    }
    for x in [out.required_at_goal, out.shortfall_at_goal] {
        amount(x, true)?;
    }
    for m in [
        out.fi_month,
        out.retire_month,
        out.failure_month,
        out.shortfall_month,
    ]
    .into_iter()
    .flatten()
    {
        pos(m)?;
    }
    Ok(out)
}

#[derive(PartialEq)]
enum Candidate {
    Failed,
    Funded,
    AboveBound,
}
pub fn solve_contribution(p: &Plan, schedule: &Schedule, v: &Value) -> Res<Value> {
    if !p.basic() || p.saving_cents != 0. {
        return err("solve_contribution needs a basic plan with zero base saving");
    }
    let window = v.get("contribution_from_month").is_some();
    let from = arg_int(v, "contribution_from_month", p.now_months)?;
    if window {
        if from < p.now_months || from > p.target_months {
            return err("contribution_from_month must be between origin and target");
        }
        let boundary = p
            .saving_phases
            .iter()
            .take_while(|x| x.from_month <= from)
            .last()
            .map_or(0., |x| x.cents);
        if boundary != 0.
            || p.saving_phases
                .iter()
                .any(|x| x.from_month > from && x.cents != 0.)
        {
            return err("saving phases must be zero at and after contribution_from_month");
        }
    } else if !p.saving_phases.is_empty() {
        return err("solve_contribution without contribution_from_month requires no saving phases");
    }
    let limit = arg_int(v, "search_limit_cents", 0)?;
    if limit <= 0 || limit > LIMIT as i64 {
        return err("search_limit_cents must be a positive integer at most 9e15");
    }
    let mut plan = p.clone();
    plan.mode = "traditional".into();
    let origin_retired = p.target_months <= p.now_months && p.n() > 0;
    let upfront = if p.n() == 0 {
        0.
    } else if origin_retired {
        schedule.start_r[0]
    } else {
        schedule.start_a[0]
    };
    let available = bounded(p.assets_cents - schedule.oneoffs[0])?;
    if available + EPS < upfront {
        return Ok(json!({"status":"payment_constraint"}));
    }
    let req = requirements(&plan, schedule)?;
    let options = Options::default();
    let zero = project(&plan, schedule, &req, &options)?;
    if window {
        // The zero projection has the same immutable prefix as every candidate.
        // Its audit balance is after dated and known start payments, before any
        // release, growth, income or candidate deposit at the boundary.
        let prefix_failed = zero.failure_month.is_some_and(|m| m < from)
            || zero.shortfall_month.is_some_and(|m| m < from);
        let boundary_failed = if from < p.horizon_months {
            zero.audit[(from - p.now_months) as usize].after_payments_cents < -EPS
        } else {
            // Endpoint releases can recover the balance but never erase failure
            // of its preceding dated payment. There is no recurring audit here.
            zero.failure_month.is_some_and(|m| m == from)
        };
        if prefix_failed || boundary_failed {
            return Ok(json!({"status":"payment_constraint"}));
        }
    }
    let meets = |q: &Projection| -> bool {
        let goal = (plan.target_months.max(plan.now_months) - plan.now_months) as usize;
        q.retire_month.is_some()
            && q.failure_month.is_none()
            && q.shortfall_month.is_none()
            && q.assets[goal] + EPS >= req[goal]
    };
    if meets(&zero) {
        return Ok(json!({"status":"no_positive_contribution","monthly_cents":"0"}));
    }
    if p.target_months <= from {
        let goal = p.target_months.max(p.now_months);
        let now = required(&plan, schedule, goal, goal, &plan.pension(goal))?;
        return Ok(json!({"status":"not_applicable","required_now":now}));
    }
    // Only the base contribution schedule changes. Requirements, dates and source
    // details are compiled once; fixed retirement makes financial coverage monotone.
    // Retain the original no-option schedule behavior. With an explicit window,
    // only its zero base entries are substituted; prefix phases remain intact.
    let end = if window {
        p.target_months
    } else {
        p.horizon_months
    };
    let weights = ((from - p.now_months) as usize..(end - p.now_months) as usize)
        .map(|i| (i, p.saving_weight(i)))
        .collect::<Vec<_>>();
    let mut candidate_schedule = schedule.clone();
    let check = |c: i64, s: &mut Schedule| -> Res<Candidate> {
        // Upper monetary overflow is a search boundary, never a funded result.
        // Zero's valid projection establishes that increasing this sole positive
        // cash flow cannot introduce a lower-bound overflow.
        let mut evaluate = || -> Res<Candidate> {
            for &(i, weight) in &weights {
                s.base[i] = bounded(c as f64 * weight)?;
                s.saving[i] = bounded(schedule.saving[i] + s.base[i])?;
            }
            let q = project(&plan, s, &req, &options)?;
            Ok(if meets(&q) {
                Candidate::Funded
            } else {
                Candidate::Failed
            })
        };
        match evaluate() {
            Err(e) if e == "nonfinite or out-of-bound amount/intermediate" => {
                Ok(Candidate::AboveBound)
            }
            result => result,
        }
    };
    let not_found = || json!({"status":"search_not_found","search_limit_cents":limit.to_string()});
    if check(limit, &mut candidate_schedule)? == Candidate::Failed {
        return Ok(not_found());
    }
    let (mut low, mut high) = (0, limit);
    while high - low > 1 {
        let mid = low + (high - low) / 2;
        if check(mid, &mut candidate_schedule)? == Candidate::Failed {
            low = mid
        } else {
            high = mid
        }
    }
    if check(high, &mut candidate_schedule)? != Candidate::Funded {
        return Ok(not_found());
    }
    if check(high - 1, &mut candidate_schedule)? != Candidate::Failed {
        return err("contribution minimum verification failed");
    }
    Ok(json!({"status":"found","monthly_cents":high.to_string()}))
}
pub fn sensitivity(p: &Plan, v: &Value) -> Res<Value> {
    let mut params = parameters(p);
    if let Some(x) = v.get("parameters") {
        let o = x
            .as_object()
            .ok_or("sensitivity parameters must be object")?;
        for (key, value) in o {
            if params.get(key).is_none() {
                return err("unknown sensitivity parameter");
            }
            let n = value
                .as_f64()
                .ok_or("sensitivity parameter must be numeric")?;
            if !n.is_finite() {
                return err("nonfinite sensitivity parameter");
            }
            params[key] = value.clone();
        }
    }
    let saving = arg_num(&params, "saving_reduction_cents", 0.)?;
    let necessary = arg_num(&params, "necessary_increase_cents", 0.)?;
    let rr = arg_num(&params, "return_reduction_hundredths", 0.)?;
    let inf = arg_num(&params, "inflation_increase_hundredths", 0.)?;
    let delay = arg_int(&params, "target_delay_months", 12)?;
    let shock = arg_num(&params, "adverse_return", -0.1)?;
    for x in [saving, necessary, rr, inf] {
        amount(x, true)?
    }
    if !(0..=1440).contains(&delay) || !(-1. ..=LIMIT).contains(&shock) {
        return err("invalid sensitivity timing/shock");
    };
    let options = Options {
        year: arg_int(v, "year", 0)?,
        ..Options::default()
    };
    let baseline = run(p, &options)?;
    let mut out = Vec::new();
    for (id, label, description) in [
        (
            "saving",
            "每月可存金额减少",
            "假设每月正储蓄减少指定金额（分），保留负储蓄和约定现金流。",
        ),
        (
            "necessary",
            "必要生活开支增加",
            "假设必要生活项目的每月参考金额增加指定金额（分）。",
        ),
        (
            "return",
            "实际回报降低",
            "积累期和退休期的年实际回报都降低指定百分点。",
        ),
        (
            "inflation",
            "购买力下降加快",
            "提高一般通胀，重新换算固定名义收入和现金流。",
        ),
        (
            "timing",
            "退休目标后移",
            "把退休目标推迟指定月数，最多到计划终点。",
        ),
        (
            "market",
            "一年市场回报受挫",
            "实际退休起始年度采用指定假设年回报；尚未退休时从原点开始。",
        ),
    ] {
        let mut pp = p.clone();
        let mut o = Options {
            year: options.year,
            ..Options::default()
        };
        match id {
            "saving" => {
                let cents = (contribution_reference(&pp) - saving).max(0.);
                set_contribution(&mut pp, cents)?;
            }
            "necessary" => {
                let sum: f64 = pp
                    .items
                    .iter()
                    .filter(|x| x.essential)
                    .map(|x| x.monthly_cents)
                    .sum();
                if sum > 0. {
                    for x in &mut pp.items {
                        if x.essential {
                            x.monthly_cents = bounded(x.monthly_cents * (sum + necessary) / sum)?
                        }
                    }
                } else if necessary > 0. {
                    let mut id = "hypothetical_necessary".to_owned();
                    while pp.items.iter().any(|x| x.id == id) {
                        id.push('_')
                    }
                    pp.items.push(Item {
                        id,
                        label: "假设必要支出".into(),
                        monthly_cents: necessary,
                        start_age: None,
                        end_age: None,
                        inflation_hundredths: None,
                        essential: true,
                    });
                }
            }
            "return" => {
                pp.r_before_hundredths -= rr;
                pp.r_after_hundredths -= rr;
                rate(pp.r_before_hundredths)?;
                rate(pp.r_after_hundredths)?
            }
            "inflation" => {
                pp.inflation_hundredths += inf;
                rate(pp.inflation_hundredths)?
            }
            "timing" => pp.target_months = (pp.target_months + delay).min(pp.horizon_months),
            "market" => {
                let start = baseline.retire_month.unwrap_or(p.now_months);
                let mut a = vec![p.r_after_hundredths / 10000.; p.n()];
                let mut b = vec![p.r_before_hundredths / 10000.; p.n()];
                for i in (start - p.now_months) as usize
                    ..((start - p.now_months) as usize + 12).min(p.n())
                {
                    a[i] = shock;
                    b[i] = shock;
                }
                o.after = Some(a);
                o.before = Some(b);
            }
            _ => unreachable!(),
        }
        let stressed = run(&pp, &o)?;
        out.push(json!( {
            "id":id,
            "label":label,
            "description":description,
            "baseline":baseline,
            "stressed":stressed,
            "fi_delay_months":baseline.fi_month.zip(stressed.fi_month).map(|(a, b)|b-a),
            "shortfall_delta":bounded(stressed.shortfall_at_goal-baseline.shortfall_at_goal)?,
            "horizon_delta":bounded(stressed.at_horizon-baseline.at_horizon)?,
            "severity":severity(&baseline, &stressed)
        }));
    }
    // The operation stays an array; inspectable defaults are a separate operation.
    Ok(Value::Array(out))
}
