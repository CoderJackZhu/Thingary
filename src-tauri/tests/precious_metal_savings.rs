//! Fictional holdings and income in temporary stores; valuation is not cash saving.
use serde_json::json;
use thingary_lib::{
    plan_income::{Fields, Save},
    storage::Store,
    wealth::{Account, AccountSave, Snapshot, SnapshotSave},
};

const TODAY: &str = "2026-10-17";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn account(s: &mut Store, kind: &str, counted: bool) -> Account {
    let input: AccountSave = serde_json::from_value(json!({
        "request_id": id(), "generation": s.generation(), "id": null,
        "expected_revision": null,
        "fields": {"name": format!("虚构{kind}"), "institution": "虚构平台",
            "side": "asset", "kind": kind, "counted": counted,
            "opened_on": "2026-01-01", "closed_on": null, "notes": "",
            "holding_mode": kind == "precious_metal",
            "holding_unit": if kind == "precious_metal" { Some("克") } else { None }}
    }))
    .unwrap();
    s.wealth_account_save(&input, TODAY).unwrap()
}
fn snapshot(s: &mut Store, day: &str, cash: &Account, gold: &Account, value: i64) -> Snapshot {
    // The same 100 grams at a changed price: there was no purchase, sale or cash flow.
    let input: SnapshotSave = serde_json::from_value(json!({
        "request_id": id(), "generation": s.generation(), "id": null,
        "expected_revision": null, "date": day, "notes": "虚构贵金属估值",
        "entries": [
            {"account_id": cash.id, "state": "entered", "amount_cents": "10000000"},
            {"account_id": gold.id, "state": "entered", "amount_cents": value.to_string(),
                "quantity_e8": "10000000000", "unit_price_e6": (value * 100).to_string()}
        ]
    }))
    .unwrap();
    s.wealth_snapshot_save(&input, TODAY).unwrap()
}

#[test]
fn precious_metal_price_changes_do_not_become_cash_saving_or_spending() {
    for counted in [true, false] {
        for closing in [11_000_000, 9_000_000] {
            let dir = tempfile::tempdir().unwrap();
            thingary_lib::modules::initialize_runtime(dir.path());
            let mut s = Store::open(dir.path()).unwrap();
            let cash = account(&mut s, "cash", true);
            let gold = account(&mut s, "precious_metal", counted);
            let first = snapshot(&mut s, "2026-09-01", &cash, &gold, 10_000_000);
            let last = snapshot(&mut s, "2026-10-02", &cash, &gold, closing);
            s.plan_income_save(
                &Save {
                    request_id: id(),
                    generation: s.generation(),
                    id: None,
                    expected_revision: None,
                    fields: Fields {
                        date: "2026-09-15".into(),
                        net_cents: "2000000".into(),
                        hpf_cents: Some("0".into()),
                        notes: "虚构非投资收入；现金余额未增加".into(),
                        category: "non_investment".into(),
                        ..Fields::default()
                    },
                },
                TODAY,
            )
            .unwrap();
            let summary = s.wealth_summary().unwrap();
            let expected_change = counted.then(|| (closing - 10_000_000).to_string());
            assert_eq!(summary.points[1].market_change_cents, expected_change);
            assert_eq!(
                summary.points[1].invested_cents,
                Some(if counted { closing } else { 0 }.to_string())
            );
            let review = s.plan_review().unwrap();
            let interval = &review.intervals[0];
            assert_eq!(interval.status, "ok");
            assert_eq!(interval.monthly_cash_saving_cents.as_deref(), Some("0"));
            // The entire 20,000 income was consumed, normalized over this 31-day interval.
            assert_eq!(
                interval.monthly_cash_spend_cents.as_deref(),
                Some("1963710")
            );

            // Cash estimation and the independent investment-review scope are distinct.
            let investment = s
                .investment_review_read(&s.generation(), &first.id, &last.id)
                .unwrap();
            assert_eq!(investment.input["from"]["members"], json!([]));
            assert_eq!(investment.input["to"]["members"], json!([]));

            // Later account edits must not reclassify or exclude the saved gold facts.
            let mut fields = gold.fields.clone();
            fields.kind = "cash".into();
            fields.counted = false;
            fields.holding_mode = false;
            fields.holding_unit = None;
            s.wealth_account_save(
                &AccountSave {
                    request_id: id(),
                    generation: s.generation(),
                    id: Some(gold.id),
                    expected_revision: Some(gold.revision),
                    fields,
                },
                TODAY,
            )
            .unwrap();
            let reread = s.wealth_summary().unwrap();
            assert_eq!(reread.points[1].market_change_cents, expected_change);
            let reread = s.plan_review().unwrap();
            assert_eq!(
                reread.intervals[0].monthly_cash_saving_cents,
                interval.monthly_cash_saving_cents
            );
            assert_eq!(
                reread.intervals[0].monthly_cash_spend_cents,
                interval.monthly_cash_spend_cents
            );
        }
    }
}
