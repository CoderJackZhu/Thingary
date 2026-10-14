use serde_json::{json, Value};
use thingary_planning_engine::{dispatch, evaluate_bytes, MAX_INPUT_BYTES};

fn plan(n: i64, target: i64) -> Value {
    json!({
        "now_months":0,"horizon_months":n,"target_months":target,"search_cap_months":n,
        "mode":"fire","input_mode":"basic","assets_cents":0,"saving_cents":0,
        "saving_growth_hundredths":0,"r_before_hundredths":0,"r_after_hundredths":0,
        "inflation_hundredths":0,"volatility_hundredths":0,"items":[],"incomes":[],
        "spends":[],"pensions":[{"monthly_cents":0,"lump_cents":0,
        "unlock_age_months":0,"income_start_age_months":null}]
    })
}
fn expense(amount: f64) -> Value {
    json!({"id":"living","label":"虚构日常支出","monthly_cents":amount,
        "start_age":null,"end_age":null,"inflation_hundredths":null,"essential":true})
}
fn flow(amount: f64) -> Value {
    json!({"source_id":"fixed","label":"虚构固定款项","from_month":0,"to_month":null,
        "cents":amount,"nominal":false,"essential":true,"timing":"start"})
}
fn future(amount: &str, start: &str, end: Option<&str>) -> Value {
    json!({"id":"future","name":"虚构后续收入","role":"custom","included":true,
        "monthly_cents":amount,"start_month":start,"end_month":end,"basis":"start_month",
        "basis_month":null,"growth":"constant_purchasing_power"})
}
fn call(op: &str, p: &Value, mut args: Value) -> Value {
    args["op"] = json!(op);
    args["plan"] = p.clone();
    dispatch(args).unwrap()
}
fn solve(p: &Value, limit: i64) -> Value {
    call("solve_contribution", p, json!({"search_limit_cents":limit}))
}
fn number(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= 1e-6, "{a} != {b}");
}
fn conservation(q: &Value) {
    for r in q["rows"].as_array().unwrap() {
        close(
            number(&r["end"]),
            number(&r["start"])
                + number(&r["contribution"])
                + number(&r["unlock"])
                + number(&r["income"])
                - number(&r["spend"])
                + number(&r["unfunded"])
                - number(&r["oneoff"]),
        );
    }
}

#[test]
fn contribution_zero_and_positive_integer_minimum() {
    let mut p = plan(5, 2);
    p["items"] = json!([expense(39.)]);
    p["assets_cents"] = json!(11);
    let original = p.clone();
    assert_eq!(
        solve(&p, 53),
        json!({"status":"found","monthly_cents":"53"})
    );
    assert_eq!(
        solve(&p, 52),
        json!({"status":"search_not_found","search_limit_cents":"52"})
    );
    // A large caller limit must not prevent finding a small valid minimum.
    assert_eq!(solve(&p, 9_000_000_000_000_000), solve(&p, 53));
    assert_eq!(p, original);
    p["mode"] = json!("traditional");
    for (c, expected) in [(53, true), (52, false)] {
        p["saving_cents"] = json!(c);
        let q = call("project", &p, json!({}));
        assert_eq!(q["retire_month"], json!(2));
        assert_eq!(
            call("outcome", &p, json!({"projection":q}))["success"],
            json!(expected)
        );
    }
    p["saving_cents"] = json!(0);
    p["assets_cents"] = json!(117);
    assert_eq!(
        solve(&p, 1),
        json!({"status":"no_positive_contribution","monthly_cents":"0"})
    );
    p["target_months"] = json!(0);
    p["assets_cents"] = json!(195);
    assert_eq!(solve(&p, 1)["status"], json!("no_positive_contribution"));
}

#[test]
fn contribution_fractional_first_month_and_fixed_target() {
    let mut p = plan(4, 2);
    p["first_month_fraction"] = json!(0.5);
    p["assets_cents"] = json!(5);
    p["items"] = json!([expense(49.)]);
    assert_eq!(
        solve(&p, 100),
        json!({"status":"found","monthly_cents":"62"})
    );
    p["saving_cents"] = json!(62);
    p["mode"] = json!("traditional");
    let q = call("project", &p, json!({}));
    close(number(&q["assets"][2]), 98.);
    assert_eq!(q["retire_month"], json!(2));
    assert_eq!(
        call("outcome", &p, json!({"projection":q}))["success"],
        json!(true)
    );
    p["saving_cents"] = json!(0);
    p["assets_cents"] = json!(196);
    // Earlier FI does not change the hypothetical actual retirement date.
    let zero = call("project", &p, json!({}));
    assert_eq!(zero["fi_month"], json!(0));
    assert_eq!(zero["retire_month"], json!(2));
    assert_eq!(solve(&p, 100)["status"], json!("no_positive_contribution"));
}

#[test]
fn contribution_no_accumulation_reports_requirement_not_gap() {
    let mut p = plan(4, 0);
    p["assets_cents"] = json!(20);
    p["items"] = json!([expense(50.)]);
    p["spends"] = json!([{"offset_months":0,"cents":5}]);
    assert_eq!(
        solve(&p, 100),
        json!({"status":"not_applicable","required_now":200.})
    );
    assert_eq!(
        call("required", &p, json!({})),
        solve(&p, 100)["required_now"]
    );
    p["now_months"] = json!(1);
    p["target_months"] = json!(0);
    assert_eq!(
        solve(&p, 100),
        json!({"status":"not_applicable","required_now":150.})
    );
}

#[test]
fn contribution_payment_constraint_uses_actual_phase_and_precedes_other_statuses() {
    let mut p = plan(2, 1);
    p["assets_cents"] = json!(60);
    p["spends"] = json!([{"offset_months":0,"cents":2}]);
    p["saving_flows"] = json!([flow(-59.)]);
    p["transfers"] = json!([{"id":"pool","account_id":"account","month":0,"cents":1000}]);
    assert_eq!(solve(&p, 1000), json!({"status":"payment_constraint"}));
    // At target=origin basic spend flows determine upfront retirement payment.
    p["target_months"] = json!(0);
    assert_eq!(solve(&p, 1)["status"], json!("no_positive_contribution"));
    p["spend_flows"] = json!([flow(59.)]);
    assert_eq!(solve(&p, 1000)["status"], json!("payment_constraint"));
    p["first_month_fraction"] = json!(0);
    assert_ne!(solve(&p, 1000)["status"], json!("payment_constraint"));
    p["first_month_fraction"] = json!(0.5);
    p["spend_flows"][0]["prorate_first"] = json!(true);
    assert_ne!(solve(&p, 1000)["status"], json!("payment_constraint"));
    // The tolerance is absolute: sub-microcent noise is tolerated; one cent is not.
    p["spends"] = json!([]);
    p["first_month_fraction"] = json!(1);
    p["spend_flows"][0]["prorate_first"] = json!(false);
    p["assets_cents"] = json!(59. - 0.5e-6);
    assert_ne!(solve(&p, 1)["status"], json!("payment_constraint"));
    p["assets_cents"] = json!(58);
    assert_eq!(solve(&p, 1)["status"], json!("payment_constraint"));
}

#[test]
fn contribution_limit_and_plan_shapes_are_validated() {
    let p = plan(2, 1);
    for limit in [
        json!(0),
        json!(-1),
        json!(1.5),
        json!("10"),
        json!(9_000_000_000_000_001i64),
        Value::Null,
    ] {
        assert!(
            dispatch(json!({"op":"solve_contribution","plan":p,"search_limit_cents":limit}))
                .is_err()
        );
    }
    assert!(dispatch(json!({"op":"solve_contribution","plan":p})).is_err());
    for (key, value) in [
        ("input_mode", json!("legacy")),
        ("saving_cents", json!(1)),
        ("saving_phases", json!([{"from_month":1,"cents":0}])),
    ] {
        let mut invalid = p.clone();
        invalid[key] = value;
        assert!(dispatch(
            json!({"op":"solve_contribution","plan":invalid,"search_limit_cents":100})
        )
        .is_err());
    }
}

#[test]
fn contribution_uses_generic_income_and_releases_in_both_phases() {
    let mut p = plan(4, 2);
    p["anchor_date"] = json!("2030-01");
    p["monetary_basis_date"] = json!("2030-01");
    p["future_incomes"] = json!([future("12", "2030-01", Some("2030-04"))]);
    p["transfers"] = json!([{"id":"pool","account_id":"a","month":1,"cents":18}]);
    p["pensions"][0]["lump_cents"] = json!(10);
    p["pensions"][0]["unlock_age_months"] = json!(3);
    p["items"] = json!([expense(50.)]);
    assert_eq!(
        solve(&p, 12),
        json!({"status":"found","monthly_cents":"12"})
    );
    assert_eq!(solve(&p, 11)["status"], json!("search_not_found"));
    p["saving_cents"] = json!(12);
    p["mode"] = json!("traditional");
    let q = call("project", &p, json!({}));
    close(number(&q["assets"][2]), 66.);
    close(number(&q["assets"][4]), 0.);
    conservation(&q);
}

#[test]
fn contribution_cannot_fix_a_future_payment_before_first_available_saving() {
    let mut p = plan(2, 1);
    p["first_month_fraction"] = json!(0);
    p["spends"] = json!([{"offset_months":1,"cents":1}]);
    p["transfers"] = json!([{"id":"late","account_id":"a","month":1,"cents":100}]);
    assert_eq!(
        solve(&p, 100),
        json!({"status":"search_not_found","search_limit_cents":"100"})
    );
}

#[test]
fn endpoint_fi_never_manufactures_retirement_or_success() {
    for mode in ["fire", "traditional"] {
        let mut p = plan(3, 3);
        p["mode"] = json!(mode);
        p["items"] = json!([expense(10.)]);
        let q = call("project", &p, json!({}));
        assert_eq!(q["fi_month"], json!(3));
        assert_eq!(q["retire_month"], Value::Null);
        assert_eq!(q["pension"], Value::Null);
        assert_eq!(q["reason"], Value::Null);
        assert_eq!(
            call("outcome", &p, json!({"projection":q}))["success"],
            json!(false)
        );
        let samples = call("simulate_paths", &p, json!({"paths":1}));
        assert_eq!(samples["paths"][0]["success"], json!(false));
        assert_eq!(call("sequence", &p, json!({})), Value::Null);
        assert_eq!(solve(&p, 100)["status"], json!("search_not_found"));
    }
    let p = plan(0, 0);
    assert_eq!(
        solve(&p, 1),
        json!({"status":"not_applicable","required_now":0.})
    );
}

#[test]
fn coverage_lists_scheduled_income_and_separate_expenses_and_fixed_flows() {
    let mut p = plan(14, 5);
    p["mode"] = json!("traditional");
    p["assets_cents"] = json!(10000);
    p["first_month_fraction"] = json!(0.25);
    p["anchor_date"] = json!("2030-01");
    p["monetary_basis_date"] = json!("2030-01");
    p["inflation_hundredths"] = json!(10000);
    p["basis_factor"] = json!(2);
    let mut adjustable = expense(40.);
    adjustable["start_age"] = json!(1);
    adjustable["end_age"] = json!(14. / 12.);
    p["items"] = json!([adjustable]);
    p["incomes"] = json!([
        {"id":"legacy_nominal","label":"虚构名义收入","monthly_cents":120,"start_age":0,"end_age":null,"indexed":false},
        {"id":"legacy_real","label":"虚构实际收入","monthly_cents":70,"start_age":0,"end_age":null,"indexed":true},
        {"id":"later","label":"虚构未开始收入","monthly_cents":50,"start_age":2,"end_age":null,"indexed":true}
    ]);
    let mut generic = future("80", "2030-01", Some("2031-01"));
    generic["growth"] = json!("fixed_nominal");
    p["future_incomes"] = json!([generic, {"included":false}]);
    let mut fixed = flow(10.);
    fixed["nominal"] = json!(true);
    p["spend_flows"] = json!([fixed]);
    p["pensions"][0]["monthly_cents"] = json!(9);
    p["pensions"][0]["income_start_age_months"] = json!(12);
    let q = call("project", &p, json!({}));
    let origin = call("coverage_at", &p, json!({"month":0,"projection":q}));
    assert_eq!(origin["items"].as_array().unwrap().len(), 4);
    assert_eq!(origin["items"][0]["active"], json!(false));
    close(number(&origin["items"][0]["monthly"]), 0.);
    close(number(&origin["items"][3]["monthly"]), 20.);
    assert_eq!(origin["items"][3]["active"], json!(true));
    assert_eq!(origin["expense_items"][0]["active"], json!(false));
    assert_eq!(origin["flow_items"][0]["active"], json!(false));
    close(number(&origin["spend"]), 0.);
    let c = call("coverage_at", &p, json!({"month":12,"projection":q}));
    // Origin fraction shortens elapsed nominal growth, whereas calendar income
    // denomination uses the specified payment month and monetary basis month.
    let legacy = 120. / (2. * 2f64.powf(11.25 / 12.));
    close(number(&c["items"][0]["monthly"]), legacy);
    close(number(&c["items"][1]["monthly"]), 70.);
    assert_eq!(c["items"][2]["active"], json!(false));
    assert_eq!(c["items"][3]["id"], json!("future"));
    close(number(&c["items"][3]["monthly"]), 40.);
    let fixed = 10. / (2. * 2f64.powf(11.25 / 12.));
    close(number(&c["expense_items"][0]["monthly"]), 40.);
    close(number(&c["flow_items"][0]["monthly"]), fixed);
    assert_eq!(c["flow_items"][0]["id"], json!("fixed"));
    close(number(&c["spend"]), 40. + fixed);
    close(number(&c["essential"]), 40. + fixed);
    close(number(&c["pension"]), 9.);
    close(
        number(&q["audit"][12]["end_cents"]),
        number(&q["assets"][12]) + legacy + 70. + 40. + 9. - 40. - fixed,
    );
    let end = call("coverage_at", &p, json!({"month":13}));
    assert_eq!(end["items"][3]["active"], json!(false));
    close(number(&end["items"][3]["monthly"]), 0.);
    assert_eq!(
        end,
        call("coverage_at", &p, json!({"month":13,"projection":q}))
    );
}

#[test]
fn coverage_zero_fraction_and_zero_amount_activity() {
    let mut p = plan(2, 0);
    p["mode"] = json!("traditional");
    p["first_month_fraction"] = json!(0);
    p["items"] = json!([expense(0.)]);
    p["spend_flows"] = json!([flow(0.)]);
    p["incomes"] =
        json!([{"id":"z","label":"零金额收入","monthly_cents":0,"start_age":0,"indexed":true}]);
    let origin = call("coverage_at", &p, json!({"month":0}));
    assert_eq!(origin["items"][0]["active"], json!(false));
    assert_eq!(origin["expense_items"][0]["active"], json!(false));
    assert_eq!(origin["flow_items"][0]["active"], json!(false));
    let later = call("coverage_at", &p, json!({"month":1}));
    assert_eq!(later["items"][0]["active"], json!(true));
    assert_eq!(later["expense_items"][0]["active"], json!(true));
    assert_eq!(later["flow_items"][0]["active"], json!(true));
}

#[test]
fn phase_comparisons_use_first_positive_reference_and_proportional_changes() {
    let mut p = plan(6, 5);
    p["mode"] = json!("traditional");
    p["assets_cents"] = json!(100);
    p["saving_cents"] = json!(999);
    p["saving_phases"] = json!([
        {"from_month":3,"cents":180},{"from_month":0,"cents":-7},
        {"from_month":2,"cents":60},{"from_month":1,"cents":0}
    ]);
    p["saving_flows"] = json!([flow(-3.)]);
    let original = p.clone();
    let matrix = call(
        "matrix",
        &p,
        json!({"kind":"contribution_return","rows":[0],"cols":[0,30,60]}),
    );
    assert_eq!(matrix["base_col"], json!(2));
    let baseline = call("outcome", &p, json!({}));
    close(
        number(&matrix["cells"][0][2]["at_horizon"]),
        number(&baseline["at_horizon"]),
    );
    // Negative phase and all contracted flows stay fixed: 100-7-5*3=78.
    close(number(&matrix["cells"][0][0]["at_horizon"]), 78.);
    // Positive phases: 60+180+180 -> half: 30+90+90.
    close(number(&matrix["cells"][0][1]["at_horizon"]), 288.);
    assert_eq!(p, original);
    let generated = call("matrix", &p, json!({"kind":"contribution_return"}));
    assert_eq!(
        generated["cols"][generated["base_col"].as_u64().unwrap() as usize],
        json!(60.)
    );
    let sensitivity = call(
        "sensitivity",
        &p,
        json!({"parameters":{"saving_reduction_cents":30}}),
    );
    close(number(&sensitivity[0]["stressed"]["at_horizon"]), 288.);
    let params = call("sensitivity_parameters", &p, json!({}));
    close(number(&params["saving_reduction_cents"]), 100.);
    p["saving_phases"][2]["cents"] = json!(2400);
    close(
        number(&call("sensitivity_parameters", &p, json!({}))["saving_reduction_cents"]),
        200.,
    );
}

#[test]
fn zero_phase_reference_preserves_baseline_and_allows_positive_hypothesis() {
    let mut p = plan(4, 3);
    p["mode"] = json!("traditional");
    p["assets_cents"] = json!(100);
    p["saving_cents"] = json!(50);
    p["saving_phases"] = json!([{"from_month":1,"cents":-10},{"from_month":2,"cents":0}]);
    let m = call(
        "matrix",
        &p,
        json!({"kind":"contribution_return","rows":[0],"cols":[0,20]}),
    );
    assert_eq!(m["base_col"], json!(0));
    close(number(&m["cells"][0][0]["at_horizon"]), 140.);
    close(number(&m["cells"][0][1]["at_horizon"]), 130.);
    close(
        number(&call("sensitivity", &p, json!({}))[0]["stressed"]["at_horizon"]),
        140.,
    );
}

#[test]
fn row_unfunded_corrects_only_forgiven_expense_and_preserves_early_failure() {
    let mut p = plan(1, 0);
    p["mode"] = json!("traditional");
    p["assets_cents"] = json!(37);
    p["spend_flows"] = json!([flow(81.)]);
    p["incomes"] =
        json!([{"id":"pay","label":"虚构收入","monthly_cents":109,"start_age":0,"indexed":true}]);
    let q = call("project", &p, json!({}));
    close(number(&q["assets"][1]), 65.);
    close(number(&q["unfunded"][0]), 44.);
    close(number(&q["rows"][0]["unfunded"]), 0.);
    assert_eq!(q["failure_month"], json!(0));
    assert_eq!(q["shortfall_month"], json!(0));
    conservation(&q);
    // Add end living expense: this part is unpaid without being carried as debt.
    p["items"] = json!([expense(100.)]);
    let q = call("project", &p, json!({}));
    close(number(&q["rows"][0]["unfunded"]), 35.);
    close(number(&q["unfunded"][0]), 79.);
    conservation(&q);
    // Unpaid accumulation cash flows are all carried, so row correction stays 0.
    p["target_months"] = json!(1);
    p["saving_flows"] = json!([flow(-81.)]);
    let q = call("project", &p, json!({}));
    close(number(&q["assets"][1]), -44.);
    close(number(&q["rows"][0]["unfunded"]), 0.);
    conservation(&q);
}

#[test]
fn basic_age_metadata_does_not_change_item_or_pension_cash_dates() {
    let mut p = plan(24, 0);
    p["mode"] = json!("traditional");
    p["assets_cents"] = json!(400);
    p["anchor_date"] = json!("2037-03");
    let mut x = expense(40.);
    x["start_age"] = json!(1);
    x["end_age"] = json!(2);
    p["items"] = json!([x]);
    p["pensions"][0]["lump_cents"] = json!(50);
    p["pensions"][0]["unlock_age_months"] = json!(12);
    p["pensions"][0]["monthly_cents"] = json!(4);
    p["pensions"][0]["income_start_age_months"] = json!(13);
    let baseline = call("project", &p, json!({}));
    let tables = call("tables", &p, json!({}));
    let req = call("required_series", &p, json!({}));
    for reference in [
        Value::Null,
        json!({"month":"2037-03","age_months":444}),
        json!({"month":"2036-01","age_months":301}),
    ] {
        p["age_reference"] = reference;
        assert_eq!(call("tables", &p, json!({})), tables);
        assert_eq!(call("required_series", &p, json!({})), req);
        let q = call("project", &p, json!({}));
        for field in [
            "assets",
            "audit",
            "fi_month",
            "retire_month",
            "failure_month",
        ] {
            assert_eq!(q[field], baseline[field]);
        }
        close(
            number(&q["audit"][12]["after_unlock_cents"])
                - number(&q["audit"][12]["after_payments_cents"]),
            50.,
        );
    }
}

#[test]
fn basic_negative_item_bounds_are_integral_bounded_and_end_exclusive() {
    let mut p = plan(15, 0);
    p["mode"] = json!("traditional");
    p["assets_cents"] = json!(1000);
    let mut x = expense(3.);
    x["start_age"] = json!(-1);
    x["end_age"] = json!(1);
    let mut past = expense(99.);
    past["id"] = json!("past");
    past["start_age"] = json!(-2);
    past["end_age"] = json!(-1);
    p["items"] = json!([x, past]);
    let t = call("tables", &p, json!({}));
    assert_eq!(&t["spend"].as_array().unwrap()[..12], &vec![json!(3.); 12]);
    assert_eq!(&t["spend"].as_array().unwrap()[12..], &vec![json!(0.); 3]);
    close(number(&call("required", &p, json!({}))), 36.);
    for age in [-10000.1, -0.01] {
        p["items"][0]["start_age"] = json!(age);
        assert!(dispatch(json!({"op":"tables","plan":p})).is_err());
    }
    p["items"][0]["start_age"] = json!(-10000);
    assert!(dispatch(json!({"op":"tables","plan":p})).is_ok());
    p["input_mode"] = json!("legacy");
    assert!(dispatch(json!({"op":"tables","plan":p})).is_err());
}

fn samples(months: Vec<i64>) -> Value {
    let len = months.len();
    json!({"months":months,"ages":vec![Value::Null;len],"calendar_months":vec!["display";len],
        "paths":[{"index":0,"assets":vec![0.;len],"fi_month":null,"success":false}]})
}
#[test]
fn standalone_summary_enforces_span_and_sample_count_at_boundaries() {
    let run = |s| dispatch(json!({"op":"summarize_paths","samples":s}));
    assert!(run(samples(vec![0, 120000])).is_err());
    assert!(run(samples(vec![100, 1541])).is_err());
    assert!(run(samples(vec![100, 1540])).is_ok());
    assert!(run(samples((0..=1440).step_by(12).collect())).is_ok());
    assert!(run(samples((0..122).collect())).is_err());
    assert!(run(samples(vec![120000])).is_ok());
}

fn outcome() -> Value {
    json!({"fi_month":3,"retire_month":4,"assets_at_goal":100,"required_at_goal":90,
        "funded_at_goal":true,"shortfall_at_goal":0,"at_horizon":10,
        "failure_month":null,"shortfall_month":null,"success":true})
}
fn severity(a: &Value, b: &Value) -> Value {
    dispatch(json!({"op":"sensitivity_severity","baseline":a,"stressed":b})).unwrap()
}
#[test]
fn standalone_severity_uses_shared_coverage_rules_without_plan() {
    let a = outcome();
    assert_eq!(severity(&a, &a), json!("low"));
    for (field, value) in [
        ("success", json!(false)),
        ("funded_at_goal", json!(false)),
        ("fi_month", Value::Null),
        ("failure_month", json!(7)),
        ("shortfall_month", json!(7)),
    ] {
        let mut b = a.clone();
        b[field] = value;
        assert_eq!(severity(&a, &b), json!("high"));
    }
    for (field, value) in [
        ("shortfall_at_goal", json!(1)),
        ("at_horizon", json!(9)),
        ("fi_month", json!(4)),
    ] {
        let mut b = a.clone();
        b[field] = value;
        assert_eq!(severity(&a, &b), json!("medium"));
    }
    let mut a = a;
    a["success"] = json!(false);
    a["failure_month"] = json!(9);
    let mut b = a.clone();
    b["failure_month"] = json!(8);
    assert_eq!(severity(&a, &b), json!("high"));
    b["failure_month"] = json!(10);
    assert_eq!(severity(&a, &b), json!("low"));
    let mut p = plan(3, 0);
    p["assets_cents"] = json!(60);
    p["items"] = json!([expense(20.)]);
    for s in call("sensitivity", &p, json!({})).as_array().unwrap() {
        assert_eq!(severity(&s["baseline"], &s["stressed"]), s["severity"]);
    }
}

#[test]
fn standalone_severity_rejects_missing_or_invalid_outcome_fields() {
    let a = outcome();
    for key in a.as_object().unwrap().keys() {
        let mut b = a.clone();
        b.as_object_mut().unwrap().remove(key);
        assert!(dispatch(json!({"op":"sensitivity_severity","baseline":a,"stressed":b})).is_err());
    }
    for (field, value) in [
        ("at_horizon", json!("10")),
        ("required_at_goal", Value::Null),
        ("funded_at_goal", json!(1)),
        ("fi_month", json!(0.5)),
        ("failure_month", json!(-1)),
        ("shortfall_at_goal", json!(-1)),
        ("assets_at_goal", json!(9.1e15)),
    ] {
        let mut b = a.clone();
        b[field] = value;
        assert!(dispatch(json!({"op":"sensitivity_severity","baseline":b,"stressed":a})).is_err());
    }
    let bytes = br#"{"op":"sensitivity_severity","baseline":{"at_horizon":1e400}}"#;
    assert_eq!(
        serde_json::from_slice::<Value>(&evaluate_bytes(bytes)).unwrap()["ok"],
        json!(false)
    );
}

#[test]
fn native_transport_rejects_more_than_64_mib_before_json_processing() {
    assert_eq!(MAX_INPUT_BYTES, 64 * 1024 * 1024);
    let input = vec![b' '; MAX_INPUT_BYTES + 1];
    let error: Value = serde_json::from_slice(&evaluate_bytes(&input)).unwrap();
    assert_eq!(error["ok"], json!(false));
    assert_eq!(
        error["error"],
        json!("input exceeds 64 MiB transport limit")
    );
}
