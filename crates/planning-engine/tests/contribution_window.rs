use serde_json::{json, Value};
use thingary_planning_engine::dispatch;

fn plan() -> Value {
    json!({
        "now_months":0,"horizon_months":6,"target_months":4,"search_cap_months":6,
        "mode":"fire","input_mode":"basic","assets_cents":100,"saving_cents":0,
        "saving_growth_hundredths":0,"r_before_hundredths":0,"r_after_hundredths":0,
        "inflation_hundredths":0,"volatility_hundredths":0,"incomes":[],"spends":[],
        "items":[{"id":"budget","label":"Independent living budget","monthly_cents":100,
            "start_age":null,"end_age":null,"inflation_hundredths":null,"essential":true}],
        "pensions":[{"monthly_cents":0,"lump_cents":0,"unlock_age_months":0,
            "income_start_age_months":null}]
    })
}

fn prefix(p: &mut Value, cents: i64, from: i64) {
    p["saving_phases"] = json!([
        {"from_month":p["now_months"],"cents":cents},
        {"from_month":from,"cents":0}
    ]);
}

fn request(p: &Value, from: Value, limit: i64) -> Value {
    json!({"op":"solve_contribution","plan":p,"contribution_from_month":from,
        "search_limit_cents":limit})
}

fn solve(p: &Value, from: i64, limit: i64) -> Value {
    dispatch(request(p, json!(from), limit)).unwrap()
}

fn call(op: &str, p: &Value, mut args: Value) -> Value {
    args["op"] = json!(op);
    args["plan"] = p.clone();
    dispatch(args).unwrap()
}

fn flow(cents: i64, from: i64, to: i64, timing: &str) -> Value {
    json!({"label":"Independent fixed flow","from_month":from,"to_month":to,
        "cents":cents,"nominal":false,"essential":true,"timing":timing})
}

fn close(value: &Value, expected: f64) {
    let actual = value.as_f64().unwrap();
    assert!((actual - expected).abs() <= 1e-6, "{actual} != {expected}");
}

// Independently materialize a candidate as ordinary saving phases, so the public
// project/outcome operations check the solver against the same ledger contract.
fn projected_candidate(p: &Value, from: i64, cents: i64) -> (Value, Value) {
    let mut candidate = p.clone();
    candidate["mode"] = json!("traditional");
    let mut phases = p
        .get("saving_phases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|x| x["from_month"].as_i64().unwrap() < from)
        .cloned()
        .collect::<Vec<_>>();
    phases.push(json!({"from_month":from,"cents":cents}));
    phases.push(json!({"from_month":p["target_months"],"cents":0}));
    candidate["saving_phases"] = json!(phases);
    let projection = call("project", &candidate, json!({}));
    let outcome = call("outcome", &candidate, json!({"projection":projection}));
    (projection, outcome)
}

fn minimum(p: &Value, from: i64, cents: i64) -> Value {
    assert_eq!(
        solve(p, from, cents),
        json!({"status":"found","monthly_cents":cents.to_string()})
    );
    if cents > 1 {
        assert_eq!(
            solve(p, from, cents - 1),
            json!({"status":"search_not_found","search_limit_cents":(cents-1).to_string()})
        );
    }
    let (q, outcome) = projected_candidate(p, from, cents);
    assert_eq!(outcome["success"], true);
    assert_eq!(outcome["funded_at_goal"], true);
    assert_eq!(q["retire_month"], p["target_months"]);
    let (_, predecessor) = projected_candidate(p, from, cents - 1);
    assert!(predecessor["success"] == false || predecessor["funded_at_goal"] == false);
    q
}

#[test]
fn specified_prefix_deposits_need_forty_and_preserve_input() {
    let mut p = plan();
    prefix(&mut p, 10, 2);
    let original = p.clone();
    let q = minimum(&p, 2, 40);
    assert_eq!(q["assets"], json!([100., 110., 120., 160., 200., 100., 0.]));
    assert_eq!(p, original);
    assert_eq!(solve(&p, 2, 9_000_000_000_000_000), solve(&p, 2, 40));
}

#[test]
fn specified_negative_prefix_needs_sixty() {
    let mut p = plan();
    prefix(&mut p, -10, 2);
    let q = minimum(&p, 2, 60);
    assert_eq!(q["assets"], json!([100., 90., 80., 140., 200., 100., 0.]));
}

#[test]
fn specified_fifty_prefix_already_covers_the_horizon() {
    let mut p = plan();
    prefix(&mut p, 50, 2);
    assert_eq!(
        solve(&p, 2, 1),
        json!({"status":"no_positive_contribution","monthly_cents":"0"})
    );
    let (q, outcome) = projected_candidate(&p, 2, 0);
    assert_eq!(q["assets"], json!([100., 150., 200., 200., 200., 100., 0.]));
    assert_eq!(outcome["success"], true);
}

#[test]
fn fractional_origin_scales_only_the_origin_prefix_deposit() {
    for (fraction, expected, boundary) in [(0.5, 43, 115.), (0., 45, 110.)] {
        let mut p = plan();
        prefix(&mut p, 10, 2);
        p["first_month_fraction"] = json!(fraction);
        let q = minimum(&p, 2, expected);
        close(&q["assets"][2], boundary);
        close(&q["assets"][6], if fraction == 0.5 { 1. } else { 0. });
    }
}

#[test]
fn explicit_origin_window_prorates_its_first_candidate() {
    let mut p = plan();
    p["target_months"] = json!(2);
    p["horizon_months"] = json!(4);
    p["first_month_fraction"] = json!(0.5);
    p["assets_cents"] = json!(5);
    p["items"][0]["monthly_cents"] = json!(49);
    let q = minimum(&p, 0, 62);
    close(&q["assets"][1], 36.);
    close(&q["assets"][2], 98.);
}

#[test]
fn growth_uses_original_elapsed_axis_across_window_and_phase_changes() {
    let mut p = plan();
    p["now_months"] = json!(5);
    p["target_months"] = json!(19);
    p["horizon_months"] = json!(21);
    p["search_cap_months"] = json!(21);
    p["first_month_fraction"] = json!(0.5);
    p["saving_growth_hundredths"] = json!(10000);
    p["items"][0]["monthly_cents"] = json!(150);
    prefix(&mut p, 10, 16);
    // Prefix .5*10 + 10*10 = 105. Window weights 1,1,2, so 4*C >= 95.
    let q = minimum(&p, 16, 24);
    close(&q["assets"][11], 205.);
    close(&q["assets"][12], 229.);
    close(&q["assets"][13], 253.);
    close(&q["assets"][14], 301.);
    // Now the prefix itself includes the first doubled deposit at absolute 18.
    p["target_months"] = json!(21);
    p["horizon_months"] = json!(23);
    p["search_cap_months"] = json!(23);
    prefix(&mut p, 10, 19);
    // Prefix .5*10 + 12*10 + 20 = 145; two doubled candidates: 4*C >= 55.
    let q = minimum(&p, 19, 14);
    close(&q["assets"][14], 245.);
    close(&q["assets"][16], 301.);
}

#[test]
fn positive_balance_returns_are_shared_with_the_candidate_projection() {
    let mut p = plan();
    prefix(&mut p, 10, 2);
    // Annual gross 4096 gives monthly gross 2. Prefix leaves 430, and
    // target balance is 1720+3*C. Two 2400 expenses need starting funds 1800.
    p["r_before_hundredths"] = json!(40_950_000);
    p["r_after_hundredths"] = json!(40_950_000);
    p["items"][0]["monthly_cents"] = json!(2400);
    let q = minimum(&p, 2, 27);
    close(&q["assets"][2], 430.);
    close(&q["assets"][4], 1801.);
    close(&q["assets"][6], 4.);
}

#[test]
fn fixed_flows_oneoffs_income_and_releases_remain_included() {
    let mut p = plan();
    p["assets_cents"] = json!(70);
    prefix(&mut p, 8, 2);
    p["saving_flows"] = json!([flow(3, 0, 4, "end")]);
    p["spend_flows"] = json!([flow(10, 4, 6, "end")]);
    p["spends"] = json!([
        {"offset_months":0,"cents":2},{"offset_months":4,"cents":12},
        {"offset_months":6,"cents":7}
    ]);
    p["transfers"] = json!([
        {"id":"prefix","account_id":"a","month":1,"cents":9},
        {"id":"boundary","account_id":"a","month":2,"cents":13},
        {"id":"retired","account_id":"a","month":5,"cents":11}
    ]);
    p["anchor_date"] = json!("2035-01");
    p["monetary_basis_date"] = json!("2035-01");
    p["future_incomes"] = json!([{
        "id":"generic","name":"Independent income","role":"custom","included":true,
        "monthly_cents":"5","start_month":"2035-01","end_month":"2035-06",
        "basis":"start_month","basis_month":null,"growth":"constant_purchasing_power"
    }]);
    // Target: 70-2+16+12+20+9+13-12+2*C = 126+2*C.
    // Requirement: 220-10+7-11 = 206. Hence C=40.
    let q = minimum(&p, 2, 40);
    close(&q["assets"][4], 206.);
    close(&q["assets"][6], 0.);
    let row = &q["rows"][0];
    close(&row["contribution"], 108.);
    close(&row["income"], 30.);
    close(&row["unlock"], 33.);
    close(&row["oneoff"], 21.);
    p["incomes"] = json!([{"id":"legacy","label":"Independent retirement income",
        "monthly_cents":4,"start_age":0,"end_age":null,"indexed":true}]);
    p["pensions"][0]["lump_cents"] = json!(8);
    p["pensions"][0]["unlock_age_months"] = json!(3);
    p["pensions"][0]["monthly_cents"] = json!(2);
    p["pensions"][0]["income_start_age_months"] = json!(4);
    // Eight cents of prefix release and twelve of retirement income reduce C by 10.
    let q = minimum(&p, 2, 30);
    close(&q["assets"][6], 0.);
}

#[test]
fn every_zero_phase_in_the_window_is_replaced() {
    let mut p = plan();
    // Input order is irrelevant; a later zero phase must not turn candidates off.
    p["saving_phases"] = json!([
        {"from_month":3,"cents":0},{"from_month":2,"cents":0},
        {"from_month":0,"cents":10},{"from_month":6,"cents":0}
    ]);
    minimum(&p, 2, 40);
}

#[test]
fn known_boundary_payment_cannot_be_repaired_by_candidate_or_receipts() {
    let mut p = plan();
    prefix(&mut p, 10, 2);
    p["saving_flows"] = json!([flow(-121, 2, 3, "start")]);
    assert_eq!(solve(&p, 2, 10000), json!({"status":"payment_constraint"}));
    p["transfers"] = json!([{"id":"late","account_id":"a","month":2,"cents":1000}]);
    assert_eq!(solve(&p, 2, 10000), json!({"status":"payment_constraint"}));
    p["anchor_date"] = json!("2035-01");
    p["monetary_basis_date"] = json!("2035-01");
    p["future_incomes"] = json!([{
        "id":"receipt","name":"Boundary receipt","role":"custom","included":true,
        "monthly_cents":"1000","start_month":"2035-03","end_month":"2035-03",
        "basis":"start_month","basis_month":null,"growth":"constant_purchasing_power"
    }]);
    assert_eq!(solve(&p, 2, 10000), json!({"status":"payment_constraint"}));
}

#[test]
fn earlier_failures_survive_prefix_recovery_and_boundary_releases() {
    let mut p = plan();
    prefix(&mut p, 10, 2);
    for position in [1, 2] {
        let payment = if position == 1 { 111 } else { 121 };
        p["spends"] = json!([{"offset_months":position,"cents":payment}]);
        p["transfers"] = json!([{"id":"late","account_id":"a","month":position,"cents":1000}]);
        assert_eq!(solve(&p, 2, 10000), json!({"status":"payment_constraint"}));
    }
    p["spends"] = json!([]);
    p["assets_cents"] = json!(0);
    prefix(&mut p, -10, 2);
    p["transfers"] = json!([{"id":"late","account_id":"a","month":1,"cents":1000}]);
    assert_eq!(solve(&p, 2, 10000), json!({"status":"payment_constraint"}));
    p["assets_cents"] = json!(100);
    prefix(&mut p, 10, 2);
    p["saving_flows"] = json!([flow(-111, 1, 2, "start")]);
    assert_eq!(solve(&p, 2, 10000), json!({"status":"payment_constraint"}));
}

#[test]
fn zero_boundary_balance_without_unpaid_obligation_is_allowed() {
    let mut p = plan();
    prefix(&mut p, -50, 2);
    let q = minimum(&p, 2, 100);
    close(&q["assets"][2], 0.);
    prefix(&mut p, 10, 2);
    p["saving_flows"] = json!([flow(-120, 2, 3, "start")]);
    minimum(&p, 2, 100);
    p["saving_flows"][0]["cents"] = json!(-120. - 0.5e-6);
    assert_eq!(solve(&p, 2, 100)["status"], "found");
    p["saving_flows"][0]["cents"] = json!(-121);
    assert_eq!(solve(&p, 2, 100), json!({"status":"payment_constraint"}));
}

#[test]
fn repairable_end_payment_and_later_upfront_payment_are_searchable() {
    let mut p = plan();
    prefix(&mut p, 10, 2);
    for (position, timing) in [(2, "end"), (3, "start")] {
        p["saving_flows"] = json!([flow(-121, position, position + 1, timing)]);
        // 120 + 2*C - 121 >= 200; the candidate can meet either timing here.
        minimum(&p, 2, 101);
    }
}

#[test]
fn no_variable_interval_reports_target_requirement_with_status_precedence() {
    let mut p = plan();
    prefix(&mut p, 10, 4);
    p["spends"] = json!([{"offset_months":4,"cents":10}]);
    assert_eq!(
        solve(&p, 4, 1000),
        json!({"status":"not_applicable","required_now":200.})
    );
    let mut retired = p.clone();
    retired["mode"] = json!("traditional");
    assert_eq!(
        call("required", &retired, json!({"from":4})),
        solve(&p, 4, 1)["required_now"]
    );
    p["assets_cents"] = json!(1000);
    assert_eq!(solve(&p, 4, 1)["status"], "no_positive_contribution");
    p["assets_cents"] = json!(100);
    p["spend_flows"] = json!([flow(131, 4, 5, "start")]);
    assert_eq!(solve(&p, 4, 1000), json!({"status":"payment_constraint"}));
    // End spending has no payment constraint before the first nonexistent deposit.
    p["spend_flows"][0]["timing"] = json!("end");
    assert_eq!(
        solve(&p, 4, 1000),
        json!({"status":"not_applicable","required_now":331.})
    );
}

#[test]
fn horizon_and_zero_length_boundaries_have_no_variable_interval() {
    let mut p = plan();
    p["target_months"] = json!(6);
    assert_eq!(
        solve(&p, 6, 1),
        json!({"status":"not_applicable","required_now":0.})
    );
    p["spends"] = json!([{"offset_months":6,"cents":101}]);
    p["transfers"] = json!([{"id":"endpoint","account_id":"a","month":6,"cents":1000}]);
    assert_eq!(solve(&p, 6, 1000), json!({"status":"payment_constraint"}));
    let mut empty = plan();
    empty["horizon_months"] = json!(0);
    empty["target_months"] = json!(0);
    assert_eq!(
        solve(&empty, 0, 1),
        json!({"status":"not_applicable","required_now":0.})
    );
    empty["spends"] = json!([{"offset_months":0,"cents":101}]);
    assert_eq!(solve(&empty, 0, 1), json!({"status":"payment_constraint"}));
    // A nonempty recovery window ending at horizon still cannot create retirement.
    p["spends"] = json!([]);
    p["transfers"] = json!([]);
    assert_eq!(
        solve(&p, 2, 1),
        json!({"status":"search_not_found","search_limit_cents":"1"})
    );
}

#[test]
fn invalid_start_bounds_and_nonzero_variable_phases_are_rejected() {
    let p = plan();
    for from in [
        json!(-1),
        json!(5),
        json!(120001),
        json!(2.5),
        json!("2"),
        Value::Null,
    ] {
        assert!(dispatch(request(&p, from, 100)).is_err());
    }
    let mut shifted = p.clone();
    shifted["now_months"] = json!(1);
    assert!(dispatch(request(&shifted, json!(0), 100)).is_err());
    for phases in [
        json!([{"from_month":0,"cents":10}]),
        json!([{"from_month":0,"cents":-10},{"from_month":3,"cents":0}]),
        json!([{"from_month":2,"cents":1}]),
        json!([{"from_month":2,"cents":0},{"from_month":3,"cents":-1}]),
        json!([{"from_month":4,"cents":1}]),
        json!([{"from_month":6,"cents":1}]),
        json!([{"from_month":7,"cents":1}]),
        json!([{"from_month":2,"cents":0},{"from_month":2,"cents":0}]),
    ] {
        let mut invalid = p.clone();
        invalid["saving_phases"] = phases;
        assert!(dispatch(request(&invalid, json!(2), 100)).is_err());
    }
    for (key, value) in [
        ("saving_cents", json!(1)),
        ("saving_cents", json!(-1)),
        ("input_mode", json!("legacy")),
    ] {
        let mut invalid = p.clone();
        invalid[key] = value;
        assert!(dispatch(request(&invalid, json!(2), 100)).is_err());
    }
    for limit in [
        json!(0),
        json!(-1),
        json!(1.5),
        json!("100"),
        json!(9_000_000_000_000_001i64),
        Value::Null,
    ] {
        let mut invalid = request(&p, json!(2), 100);
        invalid["search_limit_cents"] = limit;
        assert!(dispatch(invalid).is_err());
    }
}

#[test]
fn omitted_option_preserves_ordinary_solver_and_rejects_all_phases() {
    let mut p = plan();
    for (assets, expected) in [
        (100, json!({"status":"found","monthly_cents":"25"})),
        (
            200,
            json!({"status":"no_positive_contribution","monthly_cents":"0"}),
        ),
    ] {
        p["assets_cents"] = json!(assets);
        let ordinary = call("solve_contribution", &p, json!({"search_limit_cents":100}));
        assert_eq!(ordinary, expected);
        assert_eq!(solve(&p, 0, 100), ordinary);
    }
    p["saving_phases"] = json!([{"from_month":0,"cents":0}]);
    assert!(
        dispatch(json!({"op":"solve_contribution","plan":p,"search_limit_cents":100})).is_err()
    );
    assert_eq!(solve(&p, 0, 100)["status"], "no_positive_contribution");
    p["saving_phases"] = json!([]);
    p["target_months"] = json!(6);
    assert_eq!(
        call("solve_contribution", &p, json!({"search_limit_cents":100}))["status"],
        "search_not_found"
    );
    p["target_months"] = json!(0);
    p["assets_cents"] = json!(100);
    assert_eq!(
        call("solve_contribution", &p, json!({"search_limit_cents":100})),
        json!({"status":"not_applicable","required_now":600.})
    );
}
