//! 职业变化试算的隔离原生验收夹具（只允许路径含 local.thingary.career.acceptance.*）：通过真实 Store
//! 建立虚构的账户、盘点、收入、完整北京社保资料和一份已保存的基础退休计划（目标 55 岁、退休后每月 6000 元、
//! 每月能存 3000 元、不计退休收入）；不触碰正式库。
use std::path::PathBuf;
use thingary_lib::{
    plan_basic::Update,
    plan_income::{Fields, Save},
    plan_profile::{Assumptions, Overrides, Profile, ProfileSave, Retire},
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};
fn rid(n: u32) -> String {
    format!("20000000-0000-4000-8000-{n:012}")
}
fn main() {
    let root: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: career_trial_fixture <library-root>")
        .parse()
        .unwrap();
    assert!(
        root.components().any(|c| c
            .as_os_str()
            .to_string_lossy()
            .starts_with("local.thingary.career.acceptance.")),
        "refusing non-isolated path"
    );
    assert!(!root.exists(), "fresh isolated identity required");
    std::fs::create_dir_all(&root).unwrap();
    let mut s = Store::open(&root).unwrap();
    let today = "2026-10-07";
    let mk = |s: &mut Store, n: u32, name: &str, kind: &str| {
        s.wealth_account_save(
            &AccountSave {
                request_id: rid(n),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: name.into(),
                    institution: "虚构平台".into(),
                    side: "asset".into(),
                    kind: kind.into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: "虚构验收，不是真实账户".into(),
                },
            },
            today,
        )
        .unwrap()
    };
    let cash = mk(&mut s, 1, "虚构银行卡", "cash");
    let stock = mk(&mut s, 2, "虚构证券账户", "investment");
    // Five check-ins, four intervals. Cash grows ~3 000/month; the securities account moves by a few yuan.
    let rows = [
        ("2026-05-31", "30000000", "5000000"),
        ("2026-06-30", "30300000", "5000500"),
        ("2026-07-31", "30550000", "5000800"),
        ("2026-08-31", "30900000", "5001000"),
        ("2026-09-30", "31100000", "5001100"),
    ];
    for (i, (date, c, k)) in rows.iter().enumerate() {
        s.wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(10 + i as u32),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: (*date).into(),
                notes: "虚构验收盘点".into(),
                entries: vec![
                    EntryInput {
                        account_id: cash.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some((*c).into()),
                    },
                    EntryInput {
                        account_id: stock.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some((*k).into()),
                    },
                ],
            },
            today,
        )
        .unwrap();
    }
    for m in 6..=9 {
        s.plan_income_save(
            &Save {
                request_id: rid(30 + m),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    date: format!("2026-{m:02}-15"),
                    net_cents: "2200000".into(),
                    hpf_cents: "0".into(),
                    notes: "虚构月收入".into(),
                },
            },
            today,
        )
        .unwrap();
    }
    let profile = Profile {
        birth_month: Some("1994-10".into()),
        worker: Some("male".into()),
        region: Some("beijing".into()),
        paid_months: Some(96),
        account_balance_cents: Some("20000000".into()),
        base_cents: Some("2000000".into()),
        past_index_hundredths: Some(100),
        flex_months: Some(0),
        personal_pension_annual_cents: Some("0".into()),
        marginal_tax_hundredths: Some(1000),
        assumptions: Assumptions {
            inflation_hundredths: 200,
            wage_growth_hundredths: 200,
            pp_return_hundredths: 200,
        },
        overrides: Overrides::default(),
        retire: Retire::default(),
    };
    let saved = s
        .plan_profile_save(
            &ProfileSave {
                request_id: rid(50),
                generation: s.generation(),
                expected_revision: None,
                profile,
            },
            today,
        )
        .unwrap();
    // One saved basic plan: retire at 55, 6 000/month afterwards, 3 000/month saved now, no retirement income counted.
    let mut update: Update = serde_json::from_value(serde_json::json!({
        "request_id": rid(51), "generation": s.generation(), "expected_revision": saved.revision, "section": "basic",
        "fields": {
            "birth_month": "1994-10", "spend_cents": "600000", "target_age": 55, "horizon_age": 90, "mode": "traditional",
            "real_return_before_hundredths": 0, "real_return_after_hundredths": 0, "volatility_hundredths": 500,
            "emergency_months": 0, "inflation_hundredths": 0, "monetary_basis_date": "2026-09-30", "confirm_legacy_replacement": false,
            "basic": { "contract_version": 1,
                "start": { "kind": "simulation", "id": "career-trial-simulation", "available_cents": "31100000", "date": "2026-09-30", "notes": "虚构验收，不是真实资金" },
                "contribution": { "id": "career-trial-contribution", "monthly_cents": "300000" },
                "retirement_income": { "mode": "excluded", "selected": [] },
                "pension_contributions": { "start_month": null, "stop_month": null, "base_cents": null },
                "contribution_costs": [], "retirement_costs": [] }
        }
    }))
    .unwrap();
    update.generation = s.generation();
    s.plan_profile_update(&update, today).unwrap();
    println!("Fictional fixture: 2 accounts, 5 check-ins, 4 incomes, Beijing pension profile, saved basic plan (55, 6000/month, saves 3000/month)");
}
