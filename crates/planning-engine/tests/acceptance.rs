use serde_json::{json, Value};
use thingary_planning_engine::{dispatch, evaluate_bytes};
fn plan(n: i64) -> Value {
    json!( {
        "now_months":0,
        "horizon_months":n,
        "target_months":0,
        "search_cap_months":n,
        "mode":"traditional",
        "input_mode":"basic",
        "assets_cents":0,
        "saving_cents":0,
        "saving_growth_hundredths":0,
        "r_before_hundredths":0,
        "r_after_hundredths":0,
        "inflation_hundredths":0,
        "volatility_hundredths":0,
        "items":[],
        "incomes":[],
        "spends":[],
        "pensions":[ {
            "monthly_cents":0,
            "lump_cents":0,
            "unlock_age_months":0,
            "income_start_age_months":null
        }]
    })
}
fn call(op: &str, p: &Value, args: Value) -> Value {
    let mut v = args;
    v["op"] = json!(op);
    v["plan"] = p.clone();
    dispatch(v).unwrap()
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}
fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= 1e-6, "{a} != {b}")
}
fn item(c: f64, essential: bool) -> Value {
    json!( {
        "id":"food",
        "label":"生活",
        "monthly_cents":c,
        "start_age":null,
        "end_age":null,
        "inflation_hundredths":null,
        "essential":essential
    })
}
fn income(c: f64) -> Value {
    json!( {
        "id":"pay",
        "label":"收入",
        "monthly_cents":c,
        "start_age":0,
        "end_age":null,
        "indexed":true
    })
}
fn flow(c: f64, essential: bool) -> Value {
    json!( {
        "label":"约定付款",
        "from_month":0,
        "to_month":null,
        "cents":c,
        "nominal":false,
        "essential":essential,
        "timing":"start"
    })
}
fn pension(lump: f64, unlock: i64) -> Value {
    json!( {
        "monthly_cents":0,
        "lump_cents":lump,
        "unlock_age_months":unlock,
        "income_start_age_months":null
    })
}
#[test]
fn twelve_month_cash_oracle() {
    for (month, min) in [(0, 3200000.), (5, 4200000.)] {
        let mut p = plan(12);
        p["assets_cents"] = json!(8000000);
        p["spend_flows"] = json!([flow(800000., true)]);
        p["incomes"] = json!([income(1000000.)]);
        p["spends"] = json!([ {
            "offset_months":month,
            "cents":4000000
        }]);
        let q = call("project", &p, json!({}));
        let minimum = q["audit"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| f(&a["after_payments_cents"]))
            .fold(f64::INFINITY, f64::min);
        close(minimum, min);
        close(f(&q["assets"][12]), 6400000.);
        assert_eq!(q["failure_month"], Value::Null);
        let r = &q["rows"][0];
        close(
            f(&r["start"]) + f(&r["income"]) + f(&r["unlock"]) + f(&r["contribution"])
                - f(&r["spend"])
                - f(&r["oneoff"]),
            f(&r["end"]),
        );
    }
}
#[test]
fn required_liquidity_exact_and_one_cent() {
    let mut p = plan(2);
    p["spend_flows"] = json!([flow(100., true)]);
    p["incomes"] = json!([income(200.)]);
    let r = f(&call(
        "required",
        &p,
        json!( {
            "from":0
        }),
    ));
    close(r, 100.);
    for (a, success) in [(r, true), (r - 1., false)] {
        p["assets_cents"] = json!(a);
        let q = call("outcome", &p, json!({}));
        assert_eq!(q["success"], json!(success));
        if !success {
            assert_eq!(q["failure_month"], json!(0));
            assert_eq!(q["shortfall_month"], json!(0));
        }
    }
}
#[test]
fn later_release_cannot_pay_upfront() {
    let mut p = plan(1);
    p["spend_flows"] = json!([flow(100., true)]);
    p["transfers"] = json!([ {
        "id":"pool",
        "account_id":"account",
        "month":0,
        "cents":200
    }]);
    close(f(&call("required", &p, json!({}))), 100.);
    let q = call("project", &p, json!({}));
    close(f(&q["audit"][0]["after_payments_cents"]), -100.);
    close(f(&q["assets"][1]), 100.);
    assert_eq!(q["failure_month"], json!(0));
    close(f(&q["unfunded"][0]), 100.);
}
#[test]
fn basic_and_legacy_release_dates() {
    let mut p = plan(4);
    p["target_months"] = json!(2);
    p["pensions"] = json!([pension(100., 0)]);
    for (mode, month) in [("basic", 0), ("legacy", 2)] {
        p["input_mode"] = json!(mode);
        let q = call("project", &p, json!({}));
        for i in 0..4 {
            close(
                f(&q["audit"][i]["after_unlock_cents"]) - f(&q["audit"][i]["after_payments_cents"]),
                if i == month { 100. } else { 0. },
            );
        }
    }
}
#[test]
fn basic_release_not_reused_in_requirement_glide() {
    let mut p = plan(24);
    p["pensions"] = json!([pension(240., 0)]);
    p["items"] = json!([item(10., true)]);
    close(
        f(&call(
            "required",
            &p,
            json!( {
                "from":0
            }),
        )),
        0.,
    );
    close(
        f(&call(
            "required",
            &p,
            json!( {
                "from":12
            }),
        )),
        120.,
    );
    let g = call("glide", &p, json!({}));
    close(f(&g[1]), 120.);
}
#[test]
fn legacy_upfront_is_not_additional_expense() {
    let mut p = plan(2);
    p["input_mode"] = json!("legacy");
    p["assets_cents"] = json!(300);
    p["items"] = json!([item(100., true)]);
    p["saving_flows"] = json!([flow(-60., true)]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][2]), 100.);
    close(f(&q["rows"][0]["spend"]), 200.);
    close(f(&call("required", &p, json!({}))), 200.);
}
#[test]
fn accumulation_upfront_is_counted_once() {
    let mut p = plan(2);
    p["target_months"] = json!(2);
    p["assets_cents"] = json!(500);
    p["saving_cents"] = json!(100);
    p["saving_flows"] = json!([flow(-80., true)]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][2]), 540.);
    close(f(&q["rows"][0]["contribution"]), 40.);
}
#[test]
fn partial_month_proration_and_geometric_growth() {
    let mut p = plan(2);
    p["assets_cents"] = json!(1000);
    p["items"] = json!([item(100., true)]);
    p["incomes"] = json!([income(20.)]);
    p["first_month_fraction"] = json!(0.5);
    p["r_after_hundredths"] = json!(1200);
    p["spend_flows"] = json!([flow(10., true)]);
    let q = call("project", &p, json!({}));
    let expected = (1000. - 10.) * 1.12f64.powf(0.5 / 12.) + 10. - 50.;
    close(f(&q["assets"][1]), expected);
    let t = call("tables", &p, json!({}));
    close(f(&t["spend"][0]), 60.);
    close(f(&t["start_retired"][0]), 10.);
    p["spend_flows"][0]["prorate_first"] = json!(true);
    close(f(&call("tables", &p, json!({}))["start_retired"][0]), 5.);
}
#[test]
fn fraction_zero_disables_all_recurrence_not_events() {
    let mut p = plan(1);
    p["first_month_fraction"] = json!(0);
    p["assets_cents"] = json!(500);
    p["spend_flows"] = json!([flow(100., true)]);
    p["items"] = json!([item(100., true)]);
    p["incomes"] = json!([income(20.)]);
    p["transfers"] = json!([ {
        "id":"x",
        "account_id":"a",
        "month":0,
        "cents":30
    }]);
    p["spends"] = json!([ {
        "offset_months":0,
        "cents":50
    }]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][0]), 450.);
    close(f(&q["assets"][1]), 480.);
    close(f(&q["rows"][0]["spend"]), 0.);
}
#[test]
fn debt_earns_no_return_and_failure_is_sticky() {
    let mut p = plan(2);
    p["assets_cents"] = json!(-100);
    p["r_after_hundredths"] = json!(10000);
    p["incomes"] = json!([income(60.)]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][1]), -40.);
    close(f(&q["assets"][2]), 20.);
    assert_eq!(q["failure_month"], json!(0));
    let x = dispatch(json!( {
        "op":"retirement_step",
        "balance":-100,
        "growth":2,
        "lump":0,
        "spend":10,
        "income":20
    }))
    .unwrap();
    close(f(&x["a"]), -80.);
    close(f(&x["gap"]), 10.);
}
#[test]
fn regular_shortfall_is_not_invested_debt() {
    let mut p = plan(3);
    p["assets_cents"] = json!(50);
    p["items"] = json!([item(100., true)]);
    let q = call("project", &p, json!({}));
    assert_eq!(q["assets"], json!([50., 0., 0., 0.]));
    assert_eq!(q["unfunded"], json!([50., 100., 100.]));
    assert_eq!(q["failure_month"], json!(0));
    assert_eq!(q["shortfall_month"], json!(0));
}
#[test]
fn necessary_expense_has_priority() {
    let mut p = plan(1);
    p["assets_cents"] = json!(70);
    let mut optional = item(40., false);
    optional["id"] = json!("optional");
    p["items"] = json!([item(60., true), optional]);
    let q = call("project", &p, json!({}));
    assert_eq!(q["failure_month"], json!(0));
    assert_eq!(q["shortfall_month"], Value::Null);
    close(f(&q["rows"][0]["essential_unfunded"]), 0.);
}
#[test]
fn endpoint_oneoff_belongs_to_ending_period() {
    let mut p = plan(25);
    p["assets_cents"] = json!(1000);
    p["spends"] = json!([ {
        "offset_months":0,
        "cents":10
    }, {
        "offset_months":12,
        "cents":20
    }, {
        "offset_months":24,
        "cents":30
    }, {
        "offset_months":25,
        "cents":40
    }, {
        "offset_months":-1,
        "cents":900
    }]);
    let q = call(
        "project",
        &p,
        json!( {
            "year":2030
        }),
    );
    assert_eq!(q["assets"].as_array().unwrap().len(), 26);
    assert_eq!(q["rows"].as_array().unwrap().len(), 3);
    for (i, start, end, oneoff) in [
        (0, 1000., 970., 30.),
        (1, 970., 940., 30.),
        (2, 940., 900., 40.),
    ] {
        let r = &q["rows"][i];
        close(f(&r["start"]), start);
        close(f(&r["end"]), end);
        close(f(&r["oneoff"]), oneoff);
        close(start - oneoff, end);
        assert_eq!(r["year"], json!(2030 + i));
    }
}
#[test]
fn endpoint_release_cannot_rescue_endpoint_failure() {
    let mut p = plan(1);
    p["spends"] = json!([ {
        "offset_months":1,
        "cents":100
    }]);
    p["transfers"] = json!([ {
        "id":"x",
        "account_id":"a",
        "month":1,
        "cents":200
    }]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][1]), 100.);
    assert_eq!(q["failure_month"], json!(1));
    close(f(&call("required", &p, json!({}))), 100.);
}
#[test]
fn negative_saving_phase_and_anniversary_growth() {
    let mut p = plan(25);
    p["target_months"] = json!(25);
    p["assets_cents"] = json!(10000);
    p["saving_cents"] = json!(10);
    p["saving_growth_hundredths"] = json!(10000);
    p["saving_phases"] = json!([ {
        "from_month":13,
        "cents":-20
    }]);
    let t = call("tables", &p, json!({}));
    close(f(&t["saving"][12]), 20.);
    close(f(&t["saving"][13]), -40.);
    close(f(&t["saving"][24]), -80.);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][25]), 10000. + 120. + 20. - 440. - 80.);
}
#[test]
fn contribution_monotonicity_fixed_retirement() {
    let mut p = plan(24);
    p["target_months"] = json!(12);
    p["assets_cents"] = json!(10000);
    p["items"] = json!([item(100., true)]);
    let mut previous = f64::NEG_INFINITY;
    for saving in [0, 10, 100, 200] {
        p["saving_cents"] = json!(saving);
        let q = call("project", &p, json!({}));
        assert_eq!(q["retire_month"], json!(12));
        let final_a = f(&q["assets"][24]);
        assert!(final_a >= previous);
        previous = final_a;
    }
}
fn calendar_plan() -> Value {
    let mut p = plan(3);
    p["anchor_date"] = json!("2030-01-15");
    p["monetary_basis_date"] = json!("2030-01-01");
    p
}
fn future(growth: &str) -> Value {
    json!( {
        "id":"future",
        "name":"收入",
        "role":"generic",
        "included":true,
        "monthly_cents":"100",
        "start_month":"2030-01",
        "end_month":"2030-02",
        "basis":"reference_month",
        "basis_month":"2030-01",
        "growth":growth
    })
}
#[test]
fn inclusive_income_end_and_exclusive_item_end() {
    let mut p = calendar_plan();
    let mut x = item(10., true);
    x["end_age"] = json!(2. / 12.);
    p["items"] = json!([x]);
    p["future_incomes"] = json!([future("constant_purchasing_power")]);
    let t = call("tables", &p, json!({}));
    assert_eq!(t["income"], json!([100., 100., 0.]));
    assert_eq!(t["spend"], json!([10., 10., 0.]));
}
#[test]
fn future_income_denomination_math() {
    let mut p = calendar_plan();
    p["inflation_hundredths"] = json!(10000);
    let mut x = future("constant_purchasing_power");
    x["basis_month"] = json!("2029-01");
    x["end_month"] = Value::Null;
    p["future_incomes"] = json!([x]);
    let t = call("tables", &p, json!({}));
    for i in 0..3 {
        close(f(&t["income"][i]), 200.);
    }
    p["future_incomes"][0]["growth"] = json!("fixed_nominal");
    let t = call("tables", &p, json!({}));
    for i in 0..3 {
        close(f(&t["income"][i]), 200. / 2f64.powf(i as f64 / 12.));
    }
}
#[test]
fn start_basis_and_generic_accumulation() {
    let mut p = calendar_plan();
    p["target_months"] = json!(3);
    p["inflation_hundredths"] = json!(10000);
    p["first_month_fraction"] = json!(0.5);
    let mut x = future("constant_purchasing_power");
    x["basis"] = json!("start_month");
    x["start_month"] = json!("2030-02");
    x["end_month"] = json!("2030-03");
    p["future_incomes"] = json!([x]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][3]), 200. / 2f64.powf(1. / 12.));
}
#[test]
fn invalid_incomes_and_ignored_excluded() {
    let p = calendar_plan();
    for bad in [
        json!( {
            "growth":"unknown"
        }),
        json!( {
            "monthly_cents":"1.5"
        }),
        json!( {
            "monthly_cents":null
        }),
        json!( {
            "basis":"other"
        }),
        json!( {
            "start_month":"2030-13"
        }),
        json!( {
            "end_month":"2029-12"
        }),
    ] {
        let mut pp = p.clone();
        let mut x = future("fixed_nominal");
        for (k, v) in bad.as_object().unwrap() {
            x[k] = v.clone()
        }
        pp["future_incomes"] = json!([x]);
        assert!(dispatch(json!( {
            "op":"tables",
            "plan":pp
        }))
        .is_err());
    }
    let mut p = p;
    p["future_incomes"] = json!([ {
        "included":false,
        "monthly_cents": {
        },
        "growth":[],
        "unknown":true
    }]);
    assert!(dispatch(json!( {
        "op":"tables",
        "plan":p
    }))
    .is_ok());
}
#[test]
fn zero_length_plan() {
    let mut p = plan(0);
    p["assets_cents"] = json!(100);
    p["spends"] = json!([ {
        "offset_months":0,
        "cents":20
    }]);
    let t = call("tables", &p, json!({}));
    assert_eq!(t["spend"], json!([]));
    assert_eq!(t["oneoffs"], json!([20.]));
    assert_eq!(t["debt"], json!([0.]));
    let q = call("project", &p, json!({}));
    assert_eq!(q["assets"], json!([80.]));
    assert_eq!(q["rows"], json!([]));
    assert_eq!(q["retire_month"], Value::Null);
    assert_eq!(call("outcome", &p, json!({}))["success"], json!(false));
    close(
        f(&call(
            "required",
            &p,
            json!( {
                "from":0
            }),
        )),
        0.,
    );
    assert!(dispatch(json!( {
        "op":"coverage_at",
        "plan":p,
        "month":0
    }))
    .is_err());
}
#[test]
fn overflow_and_invalid_shapes_rejected() {
    let p = plan(2);
    for bad in [
        json!( {
            "assets_cents":9e15+1.
        }),
        json!( {
            "r_after_hundredths":-10000
        }),
        json!( {
            "volatility_hundredths":-1
        }),
        json!( {
            "horizon_months":1441
        }),
        json!( {
            "target_months":3
        }),
        json!( {
            "first_month_fraction":1.1
        }),
        json!( {
            "now_months":0.5
        }),
        json!( {
            "basis_factor":0
        }),
        json!( {
            "saving_phases":[ {
                "from_month":0,
                "cents":1
            }, {
                "from_month":0,
                "cents":2
            }]
        }),
        json!( {
            "spends":[ {
                "offset_months":-9223372036854775808i64,
                "cents":0
            }]
        }),
        json!( {
            "incomes":[ {
                "id":"x",
                "label":"a",
                "monthly_cents":-1,
                "start_age":0,
                "indexed":true
            }]
        }),
        json!( {
            "items":[ {
                "id":"x",
                "label":"a",
                "monthly_cents":1,
                "start_age":0.1,
                "essential":true
            }]
        }),
    ] {
        let mut pp = p.clone();
        for (k, v) in bad.as_object().unwrap() {
            pp[k] = v.clone()
        }
        assert!(
            dispatch(json!( {
                "op":"project",
                "plan":pp
            }))
            .is_err(),
            "{bad}"
        );
    }
    let mut pp = p.clone();
    pp["assets_cents"] = json!(9e15);
    pp["r_after_hundredths"] = json!(1e9);
    assert!(dispatch(json!( {
        "op":"project",
        "plan":pp
    }))
    .is_err());
    assert!(dispatch(json!( {
        "op":"project",
        "plan":p,
        "returns_after":[0]
    }))
    .is_err());
    let x: Value = serde_json::from_slice(&evaluate_bytes(
        b"{\"op\":\"retirement_step\",\"balance\":1e999}",
    ))
    .unwrap();
    assert_eq!(x["ok"], json!(false));
}
#[test]
fn duplicate_ids_and_basic_pension_inconsistency() {
    let mut p = plan(1);
    p["transfers"] = json!([ {
        "id":"x",
        "account_id":"a",
        "month":0,
        "cents":1
    }, {
        "id":"x",
        "account_id":"b",
        "month":1,
        "cents":1
    }]);
    assert!(dispatch(json!( {
        "op":"tables",
        "plan":p
    }))
    .is_err());
    let mut p = plan(1);
    p["items"] = json!([item(1., true), item(2., true)]);
    assert!(dispatch(json!( {
        "op":"tables",
        "plan":p
    }))
    .is_err());
    let mut p = plan(1);
    p["pensions"] = json!([pension(10., 0), pension(20., 0)]);
    assert!(dispatch(json!( {
        "op":"tables",
        "plan":p
    }))
    .is_err());
}
#[test]
fn loan_schedule_and_no_double_payment() {
    let mut p = plan(4);
    p["assets_cents"] = json!(1000);
    p["target_months"] = json!(4);
    p["saving_flows"] = json!([flow(-100., true)]);
    p["loans"] = json!([ {
        "id":"loan",
        "from_offset":0,
        "principal_cents":500,
        "rate_hundredths":0,
        "months":2,
        "payment_cents":100,
        "existing":true
    }]);
    let q = call("project", &p, json!({}));
    assert_eq!(q["debt"], json!([500., 400., 300., 300., 300.]));
    close(f(&q["assets"][4]), 600.);
    p["first_month_fraction"] = json!(0);
    let t = call("tables", &p, json!({}));
    assert_eq!(t["debt"], json!([500., 500., 400., 300., 300.]));
}
#[test]
fn future_loan_origin_and_simple_interest() {
    let mut p = plan(3);
    p["loans"] = json!([ {
        "id":"l",
        "from_offset":1,
        "principal_cents":1200,
        "rate_hundredths":1200,
        "months":1,
        "payment_cents":112
    }]);
    let t = call("tables", &p, json!({}));
    assert_eq!(t["debt"], json!([0., 1200., 1100., 1111.]));
}
#[test]
fn nominal_factor_fraction_and_calendar_transfer() {
    let mut p = calendar_plan();
    p["first_month_fraction"] = json!(0.5);
    p["basis_factor"] = json!(2);
    p["inflation_hundredths"] = json!(10000);
    close(
        f(&call(
            "nominal_factor",
            &p,
            json!( {
                "month":0
            }),
        )),
        2.,
    );
    close(
        f(&call(
            "nominal_factor",
            &p,
            json!( {
                "month":1
            }),
        )),
        2. * 2f64.powf(0.5 / 12.),
    );
    p["transfers"] = json!([ {
        "id":"t",
        "account_id":"a",
        "month":1,
        "cents":0,
        "nominal_cents":100
    }]);
    close(
        f(&call("tables", &p, json!({}))["transfers"][1]),
        100. / 2f64.powf(1. / 12.),
    );
}
#[test]
fn absolute_axis_age_mapping_and_display() {
    let mut p = plan(123);
    p["input_mode"] = json!("legacy");
    p["now_months"] = json!(120);
    p["target_months"] = json!(120);
    p["anchor_date"] = json!("2030-01");
    p["age_reference"] = json!( {
        "month":"2029-01",
        "age_months":480
    });
    p["assets_cents"] = json!(1000);
    let mut x = item(10., true);
    x["start_age"] = json!(41);
    p["items"] = json!([x]);
    let q = call(
        "project",
        &p,
        json!( {
            "year":2050
        }),
    );
    assert_eq!(q["rows"][0]["age"], json!(41));
    assert_eq!(q["rows"][0]["start_month"], json!(120));
    assert_eq!(q["rows"][0]["calendar_month"], json!("2030-01"));
    assert_eq!(q["retire_month"], json!(120));
    assert_eq!(q["fi_month"], json!(120));
    p["age_reference"] = Value::Null;
    let q = call("project", &p, json!({}));
    assert_eq!(q["rows"][0]["age"], Value::Null);
}
#[test]
fn coast_retains_outgoing_and_generic_release() {
    let mut p = plan(3);
    p["target_months"] = json!(2);
    p["saving_cents"] = json!(100);
    p["saving_flows"] = json!([flow(-10., true)]);
    p["items"] = json!([item(20., true)]);
    close(f(&call("coast", &p, json!({}))), 40.);
    p["saving_phases"] = json!([ {
        "from_month":1,
        "cents":-30
    }]);
    close(f(&call("coast", &p, json!({}))), 70.);
    p["transfers"] = json!([ {
        "id":"t",
        "account_id":"a",
        "month":1,
        "cents":50
    }]);
    close(f(&call("coast", &p, json!({}))), 20.);
    close(
        f(&call(
            "coast",
            &p,
            json!( {
                "from":2
            }),
        )),
        20.,
    );
}
#[test]
fn fire_waits_target_and_funding_traditional_forces() {
    let mut p = plan(4);
    p["mode"] = json!("fire");
    p["target_months"] = json!(1);
    p["saving_cents"] = json!(100);
    p["items"] = json!([item(50., true)]);
    let q = call("project", &p, json!({}));
    assert_eq!(q["retire_month"], json!(2));
    assert_eq!(q["reason"], json!("funded"));
    p["mode"] = json!("traditional");
    let q = call("project", &p, json!({}));
    assert_eq!(q["retire_month"], json!(1));
    assert_eq!(q["reason"], json!("target_forced"));
}
#[test]
fn early_fi_is_preserved_until_target() {
    let mut p = plan(4);
    p["mode"] = json!("fire");
    p["assets_cents"] = json!(1000);
    p["target_months"] = json!(2);
    let q = call("project", &p, json!({}));
    assert_eq!(q["fi_month"], json!(0));
    assert_eq!(q["retire_month"], json!(2));
}
#[test]
fn zero_volatility_matches_deterministic() {
    let mut p = plan(25);
    p["assets_cents"] = json!(10000);
    p["r_after_hundredths"] = json!(500);
    p["items"] = json!([item(100., true)]);
    let q = call("project", &p, json!({}));
    let samples = call(
        "simulate_paths",
        &p,
        json!( {
            "paths":3,
            "seed":4
        }),
    );
    assert_eq!(samples["months"], json!([0, 12, 24, 25]));
    for path in samples["paths"].as_array().unwrap() {
        for (i, m) in [0, 12, 24, 25].iter().enumerate() {
            close(f(&path["assets"][i]), f(&q["assets"][*m]));
        }
        assert_eq!(path["fi_month"], q["fi_month"]);
    }
    let summary = call(
        "simulate",
        &p,
        json!( {
            "paths":3,
            "seed":4
        }),
    );
    for key in ["p10", "p25", "p50", "p75", "p90"] {
        assert_eq!(summary["bands"][key], samples["paths"][0]["assets"]);
    }
}
#[test]
fn reproducible_indexed_paths_and_cancellation_batches() {
    let mut p = plan(25);
    p["assets_cents"] = json!(100000);
    p["volatility_hundredths"] = json!(2000);
    let whole = call(
        "simulate_paths",
        &p,
        json!( {
            "paths":7,
            "seed":77,
            "start_index":10
        }),
    );
    let a = call(
        "simulate_paths",
        &p,
        json!( {
            "paths":3,
            "seed":77,
            "start_index":10
        }),
    );
    let b = call(
        "simulate_paths",
        &p,
        json!( {
            "paths":4,
            "seed":77,
            "start_index":13
        }),
    );
    let mut combined = a.clone();
    combined["paths"]
        .as_array_mut()
        .unwrap()
        .extend(b["paths"].as_array().unwrap().iter().cloned());
    assert_eq!(whole, combined);
    let summary = dispatch(json!( {
        "op":"summarize_paths",
        "samples":combined
    }))
    .unwrap();
    assert_eq!(
        summary,
        call(
            "simulate",
            &p,
            json!( {
                "paths":7,
                "seed":77,
                "start_index":10
            })
        )
    );
    assert_eq!(
        whole,
        call(
            "simulate_paths",
            &p,
            json!( {
                "paths":7,
                "seed":77,
                "start_index":10
            })
        )
    );
}
#[test]
fn quantile_interpolation_and_conditional_fi_median() {
    let samples = json!( {
        "months":[0, 12],
        "ages":[null, null],
        "calendar_months":["0 years", "1 years"],
        "paths":[ {
            "index":0,
            "assets":[-4, 0],
            "fi_month":null,
            "success":false
        }, {
            "index":1,
            "assets":[0, 10],
            "fi_month":2,
            "success":true
        }, {
            "index":2,
            "assets":[4, 20],
            "fi_month":4,
            "success":true
        }, {
            "index":3,
            "assets":[8, 30],
            "fi_month":null,
            "success":false
        }]
    });
    let q = dispatch(json!( {
        "op":"summarize_paths",
        "samples":samples
    }))
    .unwrap();
    close(f(&q["bands"]["p25"][0]), -1.);
    close(f(&q["final"]["p50"]), 15.);
    assert_eq!(q["median_fi_month"], json!(4));
    let mut samples = samples;
    samples["paths"][2]["fi_month"] = Value::Null;
    assert_eq!(
        dispatch(json!( {
            "op":"summarize_paths",
            "samples":samples
        }))
        .unwrap()["median_fi_month"],
        Value::Null
    );
}
#[test]
fn sequence_compounding_equal_partial_duration() {
    let mut p = plan(30);
    p["assets_cents"] = json!(100000);
    p["first_month_fraction"] = json!(0.3);
    p["r_after_hundredths"] = json!(600);
    p["age_reference"] = Value::Null;
    let q = call(
        "sequence",
        &p,
        json!( {
            "shock":-0.2
        }),
    );
    close(f(&q[1]["final"]), f(&q[2]["final"]));
    close(
        f(&q[1]["final"]),
        100000. * 0.8 * 1.06f64.powf((29. + 0.3) / 12. - 1.),
    );
    assert_eq!(q[1]["months"], json!([0, 12, 24, 30]));
    assert_eq!(q[1]["failure_age"], Value::Null);
    let mut p = plan(7);
    p["assets_cents"] = json!(1000);
    let q = call("sequence", &p, json!({}));
    assert_eq!(q[1]["path"], q[2]["path"]);
}
#[test]
fn sequence_same_ledger_and_fixed_retirement() {
    let mut p = plan(36);
    p["assets_cents"] = json!(5000);
    p["target_months"] = json!(12);
    p["saving_cents"] = json!(100);
    p["items"] = json!([item(200., true)]);
    let q = call(
        "sequence",
        &p,
        json!( {
            "shock":-0.8
        }),
    );
    assert_eq!(q[0]["months"][0], json!(12));
    assert!(f(&q[1]["final"]) <= f(&q[2]["final"]));
    let baseline = call("project", &p, json!({}));
    close(f(&q[0]["final"]), f(&baseline["assets"][36]));
}
#[test]
fn coverage_and_cached_projection_outcome() {
    let mut p = plan(2);
    p["assets_cents"] = json!(100);
    p["items"] = json!([item(80., true)]);
    let q = call("project", &p, json!({}));
    let a = call(
        "outcome",
        &p,
        json!( {
            "projection":q
        }),
    );
    assert_eq!(a, call("outcome", &p, json!({})));
    let c = call(
        "coverage_at",
        &p,
        json!( {
            "projection":q,
            "month":1
        }),
    );
    close(f(&c["spend"]), 80.);
    close(f(&c["withdrawal"]), 20.);
    close(f(&c["unfunded"]), 60.);
    assert!(dispatch(json!( {
        "op":"coverage_at",
        "plan":p,
        "month":2
    }))
    .is_err());
}
#[test]
fn sensitivity_inspectable_and_full_outcomes() {
    let mut p = plan(12);
    p["assets_cents"] = json!(1200);
    p["items"] = json!([item(100., true)]);
    let params = call("sensitivity_parameters", &p, json!({}));
    assert_eq!(params["target_delay_months"], json!(12));
    let q = call("sensitivity", &p, json!({}));
    assert_eq!(q.as_array().unwrap().len(), 6);
    for x in q.as_array().unwrap() {
        assert!(x["baseline"]["success"].is_boolean());
        assert!(x["stressed"]["required_at_goal"].is_number());
        assert!(matches!(
            x["severity"].as_str(),
            Some("low" | "medium" | "high")
        ));
    }
    assert_eq!(q[1]["severity"], json!("high"));
}
#[test]
fn matrix_baseline_bounded_axes_and_fixed_flows() {
    let mut p = plan(12);
    p["assets_cents"] = json!(2000);
    p["saving_cents"] = json!(1234);
    p["items"] = json!([item(80., true)]);
    p["spend_flows"] = json!([flow(20., true)]);
    let q = call(
        "matrix",
        &p,
        json!( {
            "kind":"target_spending",
            "rows":[0, 80],
            "cols":[0]
        }),
    );
    assert_eq!(q["column_kind"], json!("month"));
    close(f(&q["cells"][0][0]["at_horizon"]), 1760.);
    let q = call(
        "matrix",
        &p,
        json!( {
            "kind":"contribution_return"
        }),
    );
    assert_eq!(
        q["rows"][q["base_row"].as_u64().unwrap() as usize],
        json!(0.)
    );
    assert_eq!(
        q["cols"][q["base_col"].as_u64().unwrap() as usize],
        json!(1234.)
    );
    assert!(dispatch(json!( {
        "op":"matrix",
        "plan":p,
        "kind":"contribution_return",
        "cols":[]
    }))
    .is_err());
    let mut p = plan(1);
    p["assets_cents"] = json!(100);
    let q = call(
        "matrix",
        &p,
        json!( {
            "kind":"target_spending",
            "rows":[0, 50],
            "cols":[0]
        }),
    );
    close(f(&q["cells"][1][0]["at_horizon"]), 50.);
}
#[test]
fn sampled_returns_do_not_change_expected_requirement() {
    let mut p = plan(2);
    p["assets_cents"] = json!(200);
    p["items"] = json!([item(100., true)]);
    let q = call(
        "project",
        &p,
        json!( {
            "returns_after":[-0.99, -0.99]
        }),
    );
    assert_eq!(q["funded_at_retire"], json!(true));
    assert_eq!(q["failure_month"], json!(1));
}
#[test]
fn deterministic_requirements_satisfy_random_small_cash_ledgers() {
    // Independent algebra check of backwards requirements against forward payment balances.
    for n in 1..9 {
        for seed in 0..12 {
            let mut p = plan(n);
            p["r_after_hundredths"] = json!(seed * 43);
            p["items"] = json!([item(31. + seed as f64, true)]);
            p["incomes"] = json!([income((seed % 4) as f64 * 8.)]);
            p["spend_flows"] = json!([flow(7., true)]);
            p["transfers"] = json!([ {
                "id":"x",
                "account_id":"a",
                "month":n/2,
                "cents":seed*3
            }]);
            p["spends"] = json!([ {
                "offset_months":n,
                "cents":17
            }]);
            let r = f(&call("required", &p, json!({})));
            p["assets_cents"] = json!(r);
            assert_eq!(
                call("outcome", &p, json!({}))["success"],
                json!(true),
                "n {n} seed {seed} r {r}"
            );
            p["assets_cents"] = json!(r - 1.);
            assert_eq!(call("outcome", &p, json!({}))["success"], json!(false));
        }
    }
}
#[test]
fn abi_payload_valid_json_and_errors() {
    let p = plan(1);
    let request = serde_json::to_vec(&json!( {
        "op":"project",
        "plan":p
    }))
    .unwrap();
    let wrapped: Value = serde_json::from_slice(&evaluate_bytes(&request)).unwrap();
    assert_eq!(wrapped["ok"], json!(true));
    assert_eq!(wrapped["value"], call("project", &p, json!({})));
    for bytes in [
        b"{".as_slice(),
        b"null",
        b"{\"op\":\"unknown\"}",
        b"{\"op\":\"retirement_step\",\"growth\":-1}",
    ] {
        let x: Value = serde_json::from_slice(&evaluate_bytes(bytes)).unwrap();
        assert_eq!(x["ok"], json!(false));
        assert!(x["error"].is_string());
    }
}
#[test]
fn nominal_flows_and_legacy_income_use_basis_factor() {
    let mut p = plan(1);
    p["basis_factor"] = json!(2);
    p["saving_flows"] = json!([ {
        "label":"固定名义付款",
        "from_month":0,
        "cents":-100,
        "nominal":true,
        "essential":true
    }]);
    p["incomes"] = json!([ {
        "id":"x",
        "label":"名义收入",
        "monthly_cents":100,
        "start_age":0,
        "indexed":false
    }]);
    let t = call("tables", &p, json!({}));
    close(f(&t["saving"][0]), -50.);
    close(f(&t["income"][0]), 50.);
}
#[test]
fn required_after_horizon_is_zero() {
    let p = plan(2);
    close(
        f(&call(
            "required",
            &p,
            json!( {
                "from":3
            }),
        )),
        0.,
    );
}
#[test]
fn terminal_zero_is_success_and_tiny_error_is_tolerated() {
    let mut p = plan(3);
    p["assets_cents"] = json!(0.3);
    p["items"] = json!([item(0.1, true)]);
    let o = call("outcome", &p, json!({}));
    close(f(&o["at_horizon"]), 0.);
    assert_eq!(o["success"], json!(true));
}
#[test]
fn annual_overrides_month_index_and_retirement_year_index() {
    let mut p = plan(14);
    p["target_months"] = json!(1);
    p["assets_cents"] = json!(1000);
    let after = vec![1.; 14];
    let before = vec![0.; 14];
    let q = call(
        "project",
        &p,
        json!( {
            "returns_before":before,
            "returns_after":after,
            "retirement_returns":[0., 3.]
        }),
    );
    close(f(&q["assets"][13]), 1000.);
    close(f(&q["assets"][14]), 1000. * 4f64.powf(1. / 12.));
}
#[test]
fn pension_start_omitted_vs_explicit_null() {
    let mut p = plan(2);
    p["pensions"] = json!([ {
        "monthly_cents":50,
        "lump_cents":10,
        "unlock_age_months":0
    }]);
    close(f(&call("project", &p, json!({}))["assets"][2]), 110.);
    p["pensions"][0]["income_start_age_months"] = Value::Null;
    close(f(&call("project", &p, json!({}))["assets"][2]), 10.);
}
#[test]
fn zero_return_multirow_conservation_mixed_phase() {
    let mut p = plan(26);
    p["target_months"] = json!(15);
    p["assets_cents"] = json!(5000);
    p["saving_cents"] = json!(100);
    p["saving_flows"] = json!([flow(-20., true)]);
    p["items"] = json!([item(50., true)]);
    p["incomes"] = json!([income(10.)]);
    p["spend_flows"] = json!([flow(20., true)]);
    p["transfers"] = json!([ {
        "id":"x",
        "account_id":"a",
        "month":13,
        "cents":200
    }]);
    p["spends"] = json!([ {
        "offset_months":12,
        "cents":30
    }, {
        "offset_months":26,
        "cents":40
    }]);
    let q = call("project", &p, json!({}));
    for row in q["rows"].as_array().unwrap() {
        close(
            f(&row["start"]) + f(&row["contribution"]) + f(&row["income"]) + f(&row["unlock"])
                - f(&row["spend"])
                - f(&row["oneoff"]),
            f(&row["end"]),
        );
    }
    assert_eq!(q["rows"][1]["phase"], json!("retired"));
}
#[test]
fn large_long_requirement_exact_funding() {
    for c in [1e4, 1e6, 1e8, 1e10, 1e12, 3e13] {
        let mut p = plan(720);
        p["items"] = json!([item(c, true)]);
        p["r_after_hundredths"] = json!(400);
        let r = f(&call("required", &p, json!({})));
        p["assets_cents"] = json!(r);
        assert_eq!(
            call("outcome", &p, json!({}))["success"],
            json!(true),
            "c {c} r {r}"
        );
        p["assets_cents"] = json!(r - 1.);
        assert_eq!(
            call("outcome", &p, json!({}))["success"],
            json!(false),
            "one cent c {c} r {r}"
        );
    }
}
#[test]
fn upfront_unpaid_row_conserves_persistent_liability() {
    let mut p = plan(1);
    p["spend_flows"] = json!([flow(100., true)]);
    p["incomes"] = json!([income(200.)]);
    let q = call("project", &p, json!({}));
    let row = &q["rows"][0];
    close(
        f(&row["start"]) + f(&row["income"]) + f(&row["unlock"]) + f(&row["contribution"])
            - f(&row["spend"])
            - f(&row["oneoff"])
            + f(&row["unfunded"]),
        f(&row["end"]),
    );
}
#[test]
fn end_timed_necessary_accumulation_obligation() {
    let mut p = plan(1);
    p["target_months"] = json!(1);
    p["saving_flows"] = json!([ {
        "label":"必要付款",
        "from_month":0,
        "cents":-100,
        "nominal":false,
        "essential":true,
        "timing":"end"
    }]);
    let q = call("project", &p, json!({}));
    close(f(&q["assets"][1]), -100.);
    assert_eq!(q["failure_month"], json!(0));
    assert_eq!(q["shortfall_month"], json!(0));
    close(f(&q["rows"][0]["essential_unfunded"]), 100.);
    close(f(&q["unfunded"][0]), 100.);
}
#[test]
fn extreme_display_year_and_last_global_path_index_do_not_panic() {
    let p = plan(1);
    assert!(dispatch(json!( {
        "op":"project",
        "plan":p,
        "year":i64::MAX
    }))
    .is_err());
    let q = call(
        "simulate_paths",
        &p,
        json!( {
            "paths":1,
            "start_index":u32::MAX
        }),
    );
    assert_eq!(q["paths"][0]["index"], json!(u32::MAX));
    assert!(dispatch(json!( {
        "op":"simulate_paths",
        "plan":p,
        "paths":2,
        "start_index":u32::MAX
    }))
    .is_err());
}
#[test]
fn lognormal_gross_remains_positive_for_tiny_median() {
    let mut p = plan(1);
    p["assets_cents"] = json!(9e15);
    p["r_after_hundredths"] = json!(-9999.99999999999f64);
    p["volatility_hundredths"] = json!(10000);
    let samples = call(
        "simulate_paths",
        &p,
        json!( {
            "paths":100,
            "seed":17
        }),
    );
    for path in samples["paths"].as_array().unwrap() {
        assert!(f(&path["assets"][1]) > 0.);
    }
}
#[test]
fn negative_simple_loan_rate_and_zero_payments() {
    let mut p = plan(2);
    p["loans"] = json!([ {
        "id":"l",
        "from_offset":0,
        "principal_cents":1000,
        "rate_hundredths":-1200,
        "months":0,
        "payment_cents":500
    }]);
    let t = call("tables", &p, json!({}));
    assert_eq!(t["debt"], json!([1000., 990., 980.1]));
}
#[test]
fn denomination_overflow_is_rejected_and_large_finite_factor_allowed() {
    let mut p = calendar_plan();
    p["inflation_hundredths"] = json!(1e308);
    let mut x = future("fixed_nominal");
    x["basis"] = json!("start_month");
    x["start_month"] = json!("2030-02");
    x["end_month"] = Value::Null;
    p["monetary_basis_date"] = json!("1900-01");
    p["future_incomes"] = json!([x]);
    assert!(dispatch(json!( {
        "op":"tables",
        "plan":p
    }))
    .is_err());
    let mut p = plan(1);
    p["basis_factor"] = json!(1e20);
    close(
        f(&call(
            "nominal_factor",
            &p,
            json!( {
                "month":0
            }),
        )),
        1e20,
    );
}
#[test]
fn retirement_return_missing_year_uses_configured_base() {
    let mut p = plan(14);
    p["assets_cents"] = json!(1000);
    let q = call(
        "project",
        &p,
        json!( {
            "retirement_returns":[0.],
            "returns_after":vec![3.;14]
        }),
    );
    close(f(&q["assets"][14]), 1000.);
}
#[test]
fn default_growth_stress_keeps_valid_near_minus_one_rates() {
    let mut p = plan(1);
    p["assets_cents"] = json!(1000);
    p["r_before_hundredths"] = json!(-9999);
    p["r_after_hundredths"] = json!(-9999);
    let params = call("sensitivity_parameters", &p, json!({}));
    close(f(&params["return_reduction_hundredths"]), 0.5);
    assert!(dispatch(json!( {
        "op":"sensitivity",
        "plan":p
    }))
    .is_ok());
}
