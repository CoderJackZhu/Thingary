use serde_json::json;
use std::time::Instant;
use thingary_planning_engine::dispatch;
fn main() {
    let plan = json!( {
        "now_months":0,
        "horizon_months":720,
        "target_months":240,
        "search_cap_months":720,
        "mode":"fire",
        "input_mode":"basic",
        "assets_cents":5000000,
        "saving_cents":50000,
        "saving_growth_hundredths":100,
        "r_before_hundredths":400,
        "r_after_hundredths":300,
        "inflation_hundredths":200,
        "volatility_hundredths":1500,
        "items":[ {
            "id":"living",
            "label":"虚构生活费",
            "monthly_cents":70000,
            "start_age":null,
            "end_age":null,
            "inflation_hundredths":null,
            "essential":true
        }],
        "incomes":[],
        "spends":[ {
            "offset_months":360,
            "cents":1000000
        }],
        "pensions":[ {
            "monthly_cents":0,
            "lump_cents":0,
            "unlock_age_months":0,
            "income_start_age_months":null
        }]
    });
    let start = Instant::now();
    let value = dispatch(json!( {
        "op":"simulate",
        "plan":plan,
        "paths":1000,
        "seed":1729
    }))
    .expect("benchmark request valid");
    println!(
        "720 months, 1000 paths, seed 1729: {:.3} ms; n={}; success_rate={}",
        start.elapsed().as_secs_f64() * 1000.,
        value["n"],
        value["success_rate"]
    );
}
