//! Fictional, isolated libraries only. Real aggregation and worker capabilities.
use thingary_lib::{
    expenses::Period,
    finance_sources::Read,
    modules::{FinanceStatus, FinanceUpdate, Modules, RuntimeModules},
    plan_income::{Fields, Save},
    storage::Store,
    worker::Worker,
};
const TODAY: &str = "2026-12-31";
fn modules() -> RuntimeModules {
    RuntimeModules {
        modules: Modules {
            planning: false,
            ..Default::default()
        },
        incomes: true,
        movements: true,
        finance_status: FinanceStatus::Ready,
        finance_revision: 1,
    }
}
fn ready<T>(read: Read<T>) -> T {
    match read {
        Read::Ready { value } => value,
        other => panic!(
            "Expected ready, got {}",
            match other {
                Read::Disabled { .. } => "disabled",
                _ => "error",
            }
        ),
    }
}
fn income(store: &mut Store, day: &str) {
    store
        .plan_income_save(
            &Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    date: day.into(),
                    net_cents: "1200000".into(),
                    hpf_cents: None,
                    notes: "虚构收入".into(),
                    category: "non_investment".into(),
                    source_account_id: None,
                    destination: None,
                    receiving_account_id: None,
                },
            },
            TODAY,
        )
        .unwrap();
}

fn fictional_store(root: &std::path::Path) -> Store {
    use thingary_lib::wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave};
    let mut store = Store::open(&root.join("library")).unwrap();
    let account = store
        .wealth_account_save(
            &AccountSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: "虚构账户".into(),
                    institution: "虚构平台".into(),
                    side: "asset".into(),
                    kind: "investment".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    for (day, amount) in [("2026-09-01", "10000000"), ("2026-09-30", "9700000")] {
        store
            .wealth_snapshot_save(
                &SnapshotSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    id: None,
                    expected_revision: None,
                    date: day.into(),
                    notes: "虚构盘点".into(),
                    entries: vec![EntryInput {
                        account_id: account.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(amount.into()),
                    }],
                },
                TODAY,
            )
            .unwrap();
    }
    income(&mut store, "2026-09-20");
    store
        .save(
            &thingary_lib::domain::Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: store.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构电脑".into(),
                price_cents: Some("1200000".into()),
                purchase_date: Some("2026-09-20".into()),
            },
            TODAY,
        )
        .unwrap();
    store
}

#[test]
fn period_boundaries_wire_identity_and_read_only() {
    let root = tempfile::tempdir().unwrap();
    let mut store = Store::open(&root.path().join("library")).unwrap();
    for day in [
        "2025-12-31",
        "2026-01-01",
        "2026-01-02",
        "2026-01-31",
        "2026-02-01",
    ] {
        income(&mut store, day);
    }
    let cases = [
        (Period::All, 5),
        (Period::Year { year: 2026 }, 4),
        (
            Period::Month {
                month: "2026-01".into(),
            },
            3,
        ),
        (
            Period::Range {
                from: "2026-01-01".into(),
                to: "2026-01-31".into(),
                include_from: false,
            },
            2,
        ),
        (
            Period::Range {
                from: "2026-01-01".into(),
                to: "2026-01-01".into(),
                include_from: true,
            },
            1,
        ),
    ];
    let changes = store.conn_for_test().unwrap().total_changes();
    for (period, count) in cases {
        let result = store.finance_sources(&period, &modules(), TODAY).unwrap();
        assert_eq!(result.generation, store.generation());
        assert_eq!(result.write_version, changes);
        assert_eq!(result.period, period);
        assert_eq!(result.modules, modules());
        let rows = ready(result.incomes);
        assert_eq!(rows.len(), count);
        assert!(rows.iter().all(|r| r.fields.hpf_cents.is_none()));
        let json = serde_json::to_value(store.finance_sources(&period, &modules(), TODAY).unwrap())
            .unwrap();
        assert_eq!(json["asset_review"]["status"], "ready");
        assert!(json.get("profile").is_none());
        assert!(json.get("writeVersion").is_none());
    }
    for period in [
        Period::Year { year: 0 },
        Period::Month {
            month: "2026-13".into(),
        },
        Period::Range {
            from: "2026-01-01".into(),
            to: "2026-01-01".into(),
            include_from: false,
        },
    ] {
        assert!(store.finance_sources(&period, &modules(), TODAY).is_err());
    }
    assert!(store
        .finance_sources(&Period::All, &modules(), "invalid")
        .is_err());
    assert_eq!(store.conn_for_test().unwrap().total_changes(), changes);
    assert!(store.conn_for_test().unwrap().is_autocommit());
    income(&mut store, "2026-03-01");
    let later = store
        .finance_sources(&Period::All, &modules(), TODAY)
        .unwrap();
    assert!(later.write_version > changes);
    assert_eq!(later.generation, store.generation());
    let other = tempfile::tempdir().unwrap();
    let other_store = Store::open(&other.path().join("library")).unwrap();
    assert_ne!(
        other_store
            .finance_sources(&Period::All, &modules(), TODAY)
            .unwrap()
            .generation,
        later.generation
    );
}

#[test]
fn broken_wealth_or_expenses_are_local_errors_and_top_level_failure_releases_transaction() {
    let root = tempfile::tempdir().unwrap();
    let mut store = fictional_store(root.path());
    store
        .conn_for_test()
        .unwrap()
        .execute_batch("PRAGMA foreign_keys=OFF; DROP TABLE fin_snapshots; DROP TABLE expenses")
        .unwrap();
    let result = store
        .finance_sources(&Period::All, &modules(), TODAY)
        .unwrap();
    assert!(matches!(result.wealth, Read::Error { .. }));
    assert!(matches!(result.asset_review, Read::Error { .. }));
    assert!(matches!(result.history, Read::Error { .. }));
    assert!(matches!(result.expenses, Read::Error { .. }));
    assert_eq!(ready(result.incomes).len(), 1);
    assert!(store.conn_for_test().unwrap().is_autocommit());
    store.set_hook(|point| {
        if point == "finance_sources.after_wealth" {
            Err(thingary_lib::domain::Error::new(
                "TEST",
                "injected top-level failure",
            ))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        store
            .finance_sources(&Period::All, &modules(), TODAY)
            .unwrap_err()
            .code,
        "TEST"
    );
    assert!(store.conn_for_test().unwrap().is_autocommit());
}

#[test]
fn disabled_bad_tables_are_skipped_and_item_facts_survive_all_finance_switches() {
    let root = tempfile::tempdir().unwrap();
    let store = fictional_store(root.path());
    store.conn_for_test().unwrap().execute_batch("PRAGMA foreign_keys=OFF; DROP TABLE plan_profile; DROP TABLE plan_income; DROP TABLE plan_baseline_marks; DROP TABLE fin_accounts; DROP TABLE fin_snapshots; DROP TABLE expenses; DROP TABLE recurring_plans; DROP TABLE virtual_assets;").unwrap();
    let mut m = modules();
    m.incomes = false;
    m.modules.wealth = false;
    m.modules.expenses = false;
    m.modules.recurring = false;
    m.modules.virtual_assets = false;
    let result = store.finance_sources(&Period::All, &m, TODAY).unwrap();
    assert!(matches!(result.wealth, Read::Disabled { .. }));
    assert!(matches!(result.accounts, Read::Disabled { .. }));
    assert!(matches!(result.incomes, Read::Disabled { .. }));
    assert!(matches!(result.asset_review, Read::Disabled { .. }));
    assert!(matches!(result.history, Read::Disabled { .. }));
    let expenses = ready(result.expenses);
    assert!(!expenses.lines.is_empty());
    assert!(expenses
        .lines
        .iter()
        .all(|r| matches!(r.source.as_str(), "purchase" | "maintenance" | "sale")));
}

#[test]
fn goals_never_read_and_bad_income_does_not_break_asset_facts() {
    let root = tempfile::tempdir().unwrap();
    let store = fictional_store(root.path());
    let expected = serde_json::to_value(store.plan_review().unwrap()).unwrap();
    store
        .conn_for_test()
        .unwrap()
        .execute_batch("DROP TABLE plan_profile")
        .unwrap();
    let result = store
        .finance_sources(&Period::All, &modules(), TODAY)
        .unwrap();
    assert_eq!(
        serde_json::to_value(ready(result.history)).unwrap(),
        expected
    );
    assert!(!ready(result.incomes).is_empty());
    assert!(!ready(result.asset_review).intervals.is_empty());
    let mut m = modules();
    m.modules.planning = true;
    assert!(matches!(
        store
            .finance_sources(&Period::All, &m, TODAY)
            .unwrap()
            .history,
        Read::Ready { .. }
    ));
    store
        .conn_for_test()
        .unwrap()
        .execute_batch("DROP TABLE plan_income")
        .unwrap();
    let result = store.finance_sources(&Period::All, &m, TODAY).unwrap();
    assert!(matches!(result.incomes, Read::Error { .. }));
    assert!(matches!(result.history, Read::Error { .. }));
    assert!(!ready(result.wealth).points.is_empty());
    assert!(!ready(result.asset_review).intervals.is_empty());
    ready(result.expenses);
    assert!(store.conn_for_test().unwrap().is_autocommit());
}

#[test]
fn external_write_mid_read_cannot_split_sources() {
    let root = tempfile::tempdir().unwrap();
    let mut store = fictional_store(root.path());
    let before = serde_json::to_value(
        store
            .finance_sources(&Period::All, &modules(), TODAY)
            .unwrap(),
    )
    .unwrap();
    let path = root.path().join("library/datasets");
    let db = std::fs::read_dir(path)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
        .join("data.sqlite");
    store.set_hook(move |point| {
        if point == "finance_sources.after_wealth" {
            let connection = rusqlite::Connection::open(&db)?;
            connection.execute_batch("UPDATE plan_income SET net_cents=1; UPDATE fin_snapshot_entries SET amount_cents=1 WHERE amount_cents IS NOT NULL; UPDATE assets SET price_cents=1 WHERE price_cents IS NOT NULL")?;
        }
        Ok(())
    });
    let during = serde_json::to_value(
        store
            .finance_sources(&Period::All, &modules(), TODAY)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(during, before);
    store.set_hook(|_| Ok(()));
    let after = serde_json::to_value(
        store
            .finance_sources(&Period::All, &modules(), TODAY)
            .unwrap(),
    )
    .unwrap();
    for key in ["wealth", "incomes", "expenses", "asset_review", "history"] {
        assert_ne!(
            after[key], before[key],
            "{key} must observe external writes on the next read"
        );
    }
    assert_eq!(after["write_version"], before["write_version"]); // per-connection counter, not an external change token
    assert!(store.conn_for_test().unwrap().is_autocommit());
}

#[test]
fn worker_samples_actual_capabilities_and_native_day_in_one_job() {
    let root = tempfile::tempdir().unwrap();
    let worker = Worker::start(root.path().join("library")).unwrap();
    let m = worker
        .set_modules_with_finance(
            Modules {
                planning: false,
                wealth: false,
                ..Default::default()
            },
            FinanceUpdate {
                incomes: Some(true),
                movements: Some(false),
                repair: false,
            },
        )
        .unwrap();
    let result = worker.finance_sources(Period::All).unwrap();
    assert_eq!(result.modules, m);
    assert_eq!(
        result.today,
        chrono::Local::now().format("%Y-%m-%d").to_string()
    );
    assert!(matches!(result.wealth, Read::Disabled { .. }));
    assert!(matches!(result.incomes, Read::Ready { .. }));
    worker
        .set_modules_with_finance(
            m.modules,
            FinanceUpdate {
                incomes: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(matches!(
        worker.finance_sources(Period::All).unwrap().incomes,
        Read::Disabled { .. }
    ));
}
