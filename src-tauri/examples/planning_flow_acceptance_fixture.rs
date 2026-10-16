//! C3 fictional fixture. Refuses every identity except this task's fresh isolated library.
use serde_json::json;
use std::path::PathBuf;
use thingary_lib::{
    plan_basic::Update,
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};
const IDENTITY: &str = "local.thingary.planningflow.acceptance.20261012";
const TODAY: &str = "2026-10-12";
fn rid(n: u32) -> String {
    format!("31000000-0000-4000-8000-{n:012}")
}
fn main() {
    let root: PathBuf = std::env::args()
        .nth(1)
        .expect("usage: planning_flow_acceptance_fixture <isolated-identity/library> [--inspect]")
        .into();
    assert!(
        root.is_absolute()
            && root.file_name().is_some_and(|n| n == "library")
            && root
                .parent()
                .and_then(|p| p.file_name())
                .is_some_and(|n| n == IDENTITY),
        "refusing non-isolated path"
    );
    assert!(
        !root
            .components()
            .any(|p| p.as_os_str() == "local.thingary.main"
                || p.as_os_str() == "local.thingary.preview"),
        "refusing normal library"
    );
    // Refuse aliases before touching any library. This tool must never reach a normal library through a symlink.
    for p in root.ancestors() {
        if let Ok(m) = std::fs::symlink_metadata(p) {
            assert!(!m.file_type().is_symlink(), "refusing aliased library path");
        }
    }
    if std::env::args().nth(2).as_deref() == Some("--inspect") {
        assert!(
            root.join("active.json").is_file(),
            "existing isolated dataset required"
        );
        let s = Store::open(&root).unwrap();
        let g = s.generation();
        let summary = s.wealth_summary().unwrap();
        let pairs = summary
            .points
            .windows(2)
            .map(|p| thingary_lib::planning_flow_review::Pair {
                from_snapshot_id: p[0].snapshot_id.clone(),
                to_snapshot_id: p[1].snapshot_id.clone(),
            })
            .collect::<Vec<_>>();
        let reviews = pairs
            .iter()
            .map(|p| s.followup_review_read(p, &g).unwrap())
            .collect::<Vec<_>>();
        println!(
            "{}",
            json!({"identity":IDENTITY,"schema":thingary_lib::storage::SCHEMA_VERSION,"assumptions":s.plan_assumptions_read(&g).unwrap(),"movements":s.movement_list(&thingary_lib::cash_movement::Query{from_date:None,to_date:None,account_id:None,deleted:"all".into(),cursor:None},&g).unwrap(),"reviews":reviews})
        );
        return;
    }
    assert!(
        !root.exists(),
        "fresh isolated identity required; no overwrite"
    );
    let mut s = Store::open(&root).unwrap();
    let mut accounts = vec![];
    for (i, name, kind) in [(1, "虚构银行卡", "cash"), (2, "虚构投资账户", "investment")]
    {
        accounts.push(
            s.wealth_account_save(
                &AccountSave {
                    request_id: rid(i),
                    generation: s.generation(),
                    id: None,
                    expected_revision: None,
                    fields: AccountFields {
                        name: name.into(),
                        institution: "虚构验收平台".into(),
                        side: "asset".into(),
                        kind: kind.into(),
                        counted: true,
                        opened_on: "2026-01-01".into(),
                        closed_on: None,
                        notes: "仅供隔离验收，不是真实资料".into(),
                        purchase_cents: None,
                        purchased_on: None,
                        group_id: None,
                    },
                },
                TODAY,
            )
            .unwrap(),
        );
    }
    for (i, date, investment) in [(10, "2026-10-01", "10000000"), (11, TODAY, "9700000")] {
        s.wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(i),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: date.into(),
                notes: "虚构完整盘点".into(),
                entries: vec![
                    EntryInput {
                        account_id: accounts[0].id.clone(),
                        state: "entered".into(),
                        amount_cents: Some("5000000".into()),
                    },
                    EntryInput {
                        account_id: accounts[1].id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(investment.into()),
                    },
                ],
            },
            TODAY,
        )
        .unwrap();
    }
    let setup:Update=serde_json::from_value(json!({"request_id":rid(20),"generation":s.generation(),"expected_revision":null,"section":"setup","fields":{"basic":{"spend_cents":"500000","mode":"traditional","real_return_before_hundredths":0,"real_return_after_hundredths":0,"volatility_hundredths":500,"emergency_months":0,"inflation_hundredths":200,"monetary_basis_date":"2026-10-01","basic":{"contract_version":1,"start":{"kind":"simulation","id":"flow-acceptance-simulation","available_cents":"15000000","date":"2026-10-01","notes":"虚构起点"},"contribution":{"id":"flow-acceptance-contribution","monthly_cents":"300000"},"contribution_costs":[],"retirement_costs":[]}},"budget":null,"funds":null,"simplified":{"contract_version":1,"time":{"reference":null,"target_month":"2036-10","horizon_month":"2066-10"},"income_mode":"excluded","future_incomes":[]}}})).unwrap();
    s.plan_profile_update(&setup, TODAY).unwrap();
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: rid(30),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: "虚构生活支付 8000 元".into(),
                date: "2026-10-11".into(),
                amount_cents: "800000".into(),
                category: "other".into(),
                notes: "可与投资账户直接支付关联，整笔同额同日".into(),
                refund_cents: None,
                refund_date: None,
                asset_id: None,
            },
        },
        TODAY,
    )
    .unwrap();
    s.plan_income_save(
        &thingary_lib::plan_income::Save {
            request_id: rid(31),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::plan_income::Fields {
                date: "2026-10-10".into(),
                net_cents: "2000000".into(),
                hpf_cents: Some("0".into()),
                notes: "虚构实际到账".into(),
                category: "non_investment".into(),
                source_account_id: None,
                destination: None,
                receiving_account_id: None,
            },
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "unconfirmed"
    );
    println!(
        "{}",
        json!({"identity":IDENTITY,"root":root,"accounts":accounts.iter().map(|a|json!({"id":a.id,"name":a.fields.name})).collect::<Vec<_>>(),"expected":{"opening_cents":"10000000","closing_cents":"9700000","outflow_cents":"800000","profit_cents":"500000"},"assumptions":"unconfirmed","movements":0})
    );
}
