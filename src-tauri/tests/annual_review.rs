//! Annual projections: fictional facts, temporary libraries, no application launch.
use std::io::Read as IoRead;
use thingary_lib::{
    expenses::Period,
    finance_sources::{FinanceSources, Read},
    goal_progress::{Point, Record},
    modules::{FinanceStatus, Modules, RuntimeModules},
    storage::Store,
    wealth::{
        Account, AccountFields, AccountSave, EntryInput, Snapshot, SnapshotSave, TrashChange,
    },
};

const TODAY: &str = "2026-12-31";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn modules() -> RuntimeModules {
    RuntimeModules {
        modules: Modules {
            wealth: true,
            planning: true,
            ..Default::default()
        },
        incomes: true,
        movements: true,
        finance_status: FinanceStatus::Ready,
        finance_revision: 1,
    }
}
fn ready<T: std::fmt::Debug>(value: Read<T>) -> T {
    match value {
        Read::Ready { value } => value,
        other => panic!("Expected ready: {other:?}"),
    }
}
fn annual(s: &Store, year: i32) -> FinanceSources {
    s.finance_sources_with_view(&Period::Year { year }, &modules(), TODAY, true)
        .unwrap()
}
fn account(s: &mut Store, opened: &str) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: "虚构储蓄账户".into(),
                institution: "虚构机构".into(),
                side: "asset".into(),
                kind: "cash".into(),
                counted: true,
                opened_on: opened.into(),
                closed_on: None,
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
                currency: "CNY".into(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn snapshot(
    s: &mut Store,
    day: &str,
    accounts: &[(&Account, &str)],
    old: Option<&Snapshot>,
) -> Snapshot {
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: id(),
            generation: s.generation(),
            id: old.map(|s| s.id.clone()),
            expected_revision: old.map(|s| s.revision),
            date: day.into(),
            notes: "虚构盘点".into(),
            entries: accounts
                .iter()
                .map(|(a, amount)| EntryInput {
                    account_id: a.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some((*amount).into()),
                    original_minor: None,
                    fx_rate_micro: None,
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap()
}
fn point() -> Point {
    Point {
        mode: "traditional".into(),
        target_month: Some("2046-10".into()),
        available_cents: Some("100000".into()),
        required_monthly_cents: None,
        entered_monthly_cents: None,
        success: None,
        shortfall_at_goal_cents: None,
        predicted_retire_month: None,
        has_open_items: true,
    }
}
fn record(s: &Store, snapshot: &Snapshot, on: &str) {
    s.goal_progress_record(
        &Record {
            generation: s.generation(),
            snapshot_id: snapshot.id.clone(),
            snapshot_revision: snapshot.revision,
            point: point(),
        },
        on,
    )
    .unwrap();
}
fn income(s: &mut Store, day: &str, amount: &str) {
    s.plan_income_save(
        &thingary_lib::plan_income::Save {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::plan_income::Fields {
                date: day.into(),
                net_cents: amount.into(),
                hpf_cents: None,
                notes: "虚构收入".into(),
                category: "non_investment".into(),
                ..Default::default()
            },
        },
        TODAY,
    )
    .unwrap();
}
fn goal(s: &mut Store, a: &Account, created_on: &str) {
    s.savings_goals_save(
        &thingary_lib::savings_goals::Save {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::savings_goals::Fields {
                name: "虚构存钱目标".into(),
                target_cents: "200000".into(),
                target_date: None,
                notes: String::new(),
            },
            account_ids: vec![a.id.clone()],
        },
        created_on,
        true,
    )
    .unwrap();
}
fn archive_entries(path: &std::path::Path) -> serde_json::Value {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut manifest = String::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    serde_json::from_str::<serde_json::Value>(&manifest).unwrap()["entries"].clone()
}

#[test]
fn prior_december_and_one_in_year_point_are_comparable_but_standard_view_stays_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2025-01-01");
    let b = snapshot(&mut s, "2025-12-31", &[(&a, "100000")], None);
    let e = snapshot(&mut s, "2026-06-30", &[(&a, "125000")], None);
    let standard = s
        .finance_sources(&Period::Year { year: 2026 }, &modules(), TODAY)
        .unwrap();
    assert!(standard.annual.is_none());
    let r = annual(&s, 2026);
    assert_eq!(
        ready(r.wealth)
            .points
            .iter()
            .filter(|p| p.date.starts_with("2026"))
            .count(),
        1
    );
    let a = r.annual.unwrap();
    assert!(!a.scope_changed);
    let compare = ready(a.comparison).unwrap();
    assert_eq!(compare.from.snapshot_id, b.id);
    assert_eq!(compare.to.snapshot_id, e.id);
    assert_eq!(compare.from.date, "2025-12-31");
    assert_eq!(compare.to.date, "2026-06-30");
    assert!(compare.reconciled);
    assert_eq!(compare.net_change_cents.as_deref(), Some("25000"));
}

#[test]
fn income_only_years_and_single_snapshot_remain_readable_without_fabricating_comparisons() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    income(&mut s, "2024-01-01", "0");
    income(&mut s, "2024-12-31", "120000");
    income(&mut s, "2025-01-01", "999999");
    let r = annual(&s, 2024);
    let rows = ready(r.incomes);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows.iter()
            .map(|r| r.fields.net_cents.parse::<i64>().unwrap())
            .sum::<i64>(),
        120000
    );
    assert!(ready(r.wealth).points.is_empty());
    let a = r.annual.unwrap();
    assert_eq!(ready(a.years), vec![2024, 2025, 2026]);
    assert!(ready(a.comparison).is_none());
    let cash = account(&mut s, "2026-01-01");
    snapshot(&mut s, "2026-06-30", &[(&cash, "100")], None);
    let r = annual(&s, 2026);
    assert_eq!(ready(r.wealth).points.len(), 1);
    assert!(ready(r.annual.unwrap().comparison).is_none());
}

#[test]
fn middle_scope_change_is_retained_even_when_endpoint_settings_match() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut cash = account(&mut s, "2025-01-01");
    snapshot(&mut s, "2025-12-31", &[(&cash, "100000")], None);
    let mut fields = cash.fields.clone();
    fields.counted = false;
    cash = s
        .wealth_account_save(
            &AccountSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(cash.id.clone()),
                expected_revision: Some(cash.revision),
                fields,
            },
            TODAY,
        )
        .unwrap();
    snapshot(&mut s, "2026-06-30", &[(&cash, "125000")], None);
    let mut fields = cash.fields.clone();
    fields.counted = true;
    cash = s
        .wealth_account_save(
            &AccountSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(cash.id.clone()),
                expected_revision: Some(cash.revision),
                fields,
            },
            TODAY,
        )
        .unwrap();
    snapshot(&mut s, "2026-12-31", &[(&cash, "150000")], None);
    let ranged = range_review(&s, "2026-01-01", "2026-12-31", true)
        .annual
        .unwrap();
    assert!(
        ranged.scope_changed,
        "Range review must retain intervening scope changes"
    );
    let a = annual(&s, 2026).annual.unwrap();
    assert!(
        a.scope_changed,
        "The annual contract must retain intervening scope changes"
    );
    let endpoints = ready(a.comparison).unwrap();
    assert!(
        endpoints.reconciled,
        "Endpoint comparison alone does not know about the middle point"
    );
    assert_eq!(endpoints.net_change_cents.as_deref(), Some("50000"));
}

#[test]
fn old_planning_year_survives_forty_newer_records_and_preserves_later_recorded_date() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2024-01-01");
    let first = snapshot(&mut s, "2024-01-31", &[(&a, "100000")], None);
    let last = snapshot(&mut s, "2024-12-31", &[(&a, "150000")], None);
    record(&s, &first, "2025-02-01");
    record(&s, &last, "2025-02-02");
    let start = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    for i in 0..40 {
        let day = (start + chrono::Duration::days(i))
            .format("%Y-%m-%d")
            .to_string();
        let snap = snapshot(&mut s, &day, &[(&a, "160000")], None);
        record(&s, &snap, TODAY);
    }
    let recent = s.goal_progress_list().unwrap();
    assert_eq!(recent.len(), 24);
    assert!(recent.iter().all(|p| p.date.starts_with("2026")));
    let a = annual(&s, 2024).annual.unwrap();
    let planning = ready(a.planning);
    assert_eq!(planning.len(), 2);
    assert_eq!(planning[0].snapshot_id, first.id);
    assert_eq!(planning[1].snapshot_id, last.id);
    assert_eq!(planning[0].recorded_on, "2025-02-01");
    assert_eq!(planning[1].recorded_on, "2025-02-02");
    assert_eq!(planning[0].point, point());
}

#[test]
fn planning_filters_corrected_deleted_and_now_incomplete_points_without_recomputing_them() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2024-01-01");
    let corrected = snapshot(&mut s, "2024-02-01", &[(&a, "100")], None);
    let deleted = snapshot(&mut s, "2024-04-01", &[(&a, "200")], None);
    let incomplete = snapshot(&mut s, "2024-09-01", &[(&a, "300")], None);
    for snap in [&corrected, &deleted, &incomplete] {
        record(&s, snap, "2025-01-01");
    }
    snapshot(&mut s, &corrected.date, &[(&a, "150")], Some(&corrected));
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "snapshot".into(),
        id: deleted.id.clone(),
        expected_revision: deleted.revision,
        deleted: true,
    })
    .unwrap();
    let b = account(&mut s, "2024-09-01");
    assert!(ready(annual(&s, 2024).annual.unwrap().planning).is_empty());
    assert!(ready(
        range_review(&s, "2024-01-01", "2024-12-31", true)
            .annual
            .unwrap()
            .planning
    )
    .is_empty());
    let repaired = snapshot(
        &mut s,
        &incomplete.date,
        &[(&a, "300"), (&b, "0")],
        Some(&incomplete),
    );
    assert!(
        ready(annual(&s, 2024).annual.unwrap().planning).is_empty(),
        "Correcting facts must not manufacture a planning conclusion"
    );
    record(&s, &repaired, "2026-12-15");
    let records = ready(annual(&s, 2024).annual.unwrap().planning);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].snapshot_id, repaired.id);
    assert_eq!(records[0].recorded_on, "2026-12-15");
    let ranged = ready(
        range_review(&s, "2024-01-01", "2024-12-31", true)
            .annual
            .unwrap()
            .planning,
    );
    assert_eq!(ranged.len(), 1);
    assert_eq!(ranged[0].snapshot_id, repaired.id);
}

#[test]
fn savings_history_never_adopts_a_net_worth_start_before_the_goal_existed() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2024-01-01");
    let old = snapshot(&mut s, "2024-12-31", &[(&a, "100000")], None);
    goal(&mut s, &a, "2025-06-01");
    let end = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    let annual = annual(&s, 2026).annual.unwrap();
    assert_eq!(ready(annual.comparison).unwrap().from.snapshot_id, old.id);
    let goals = ready(annual.savings);
    assert_eq!(goals.goals[0].history.len(), 1);
    assert_eq!(goals.goals[0].history[0].basis.snapshot_id, end.id);
    assert_eq!(goals.goals[0].goal.created_on, "2025-06-01");
}

#[test]
fn disabled_income_and_planning_are_not_read_and_item_expense_source_survives() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    s.save(
        &thingary_lib::domain::Save {
            request_id: id(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构电脑".into(),
            price_cents: Some("150000".into()),
            purchase_date: Some("2024-04-01".into()),
        },
        TODAY,
    )
    .unwrap();
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: "虚构独立支出".into(),
                date: "2024-05-01".into(),
                amount_cents: "99999".into(),
                category: "other".into(),
                notes: String::new(),
                refund_cents: None,
                refund_date: None,
                asset_id: None,
            },
        },
        TODAY,
    )
    .unwrap();
    income(&mut s, "2024-03-01", "123456");
    let mut m = modules();
    m.incomes = false;
    m.modules.planning = false;
    m.modules.expenses = false;
    // A forbidden read now fails rather than quietly returning an empty source.
    s.conn_for_test().unwrap().execute_batch("DROP TABLE plan_income; DROP TABLE goal_progress; DROP TABLE plan_profile; DROP TABLE expenses;").unwrap();
    let result = s
        .finance_sources_with_view(&Period::Year { year: 2024 }, &m, TODAY, true)
        .unwrap();
    assert!(matches!(result.incomes, Read::Disabled { .. }));
    let expenses = ready(result.expenses);
    assert_eq!(expenses.spent_cents, "150000");
    assert_eq!(expenses.lines.len(), 1);
    assert_eq!(expenses.lines[0].source, "purchase");
    let a = result.annual.unwrap();
    assert!(matches!(a.planning, Read::Disabled { .. }));
    assert_eq!(ready(a.years), vec![2024, 2026]);
    assert!(ready(a.savings).goals.is_empty());
}

#[test]
fn one_broken_source_does_not_remove_other_annual_facts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2025-01-01");
    snapshot(&mut s, "2025-12-31", &[(&a, "100000")], None);
    let end = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    record(&s, &end, TODAY);
    s.conn_for_test()
        .unwrap()
        .execute_batch("DROP TABLE plan_income; UPDATE goal_progress SET payload='{}';")
        .unwrap();
    let r = annual(&s, 2026);
    assert!(matches!(r.incomes, Read::Error { .. }));
    assert_eq!(ready(r.wealth).points.len(), 2);
    ready(r.expenses);
    let a = r.annual.unwrap();
    assert!(ready(a.comparison).is_some());
    assert!(matches!(a.planning, Read::Error { .. }));
    assert!(
        matches!(a.years, Read::Error { .. }),
        "Incomplete year inventory must not look complete"
    );
}

#[test]
fn review_projection_is_read_only_for_all_backup_facts_and_rejects_all_and_month_views() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let a = account(&mut s, "2025-01-01");
    goal(&mut s, &a, "2025-06-01");
    snapshot(&mut s, "2025-12-31", &[(&a, "100000")], None);
    let end = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    record(&s, &end, TODAY);
    income(&mut s, "2026-03-31", "500000");
    let before = dir.path().join("before.thingary");
    s.backup(Some(&before)).unwrap();
    let changes = s.conn_for_test().unwrap().total_changes();
    let generation = s.generation();
    for year in [2024, 2025, 2026] {
        annual(&s, year);
    }
    range_review(&s, "2025-12-31", "2026-06-30", true);
    range_review(&s, "2025-12-31", "2026-06-30", false);
    for period in [
        Period::All,
        Period::Month {
            month: "2026-06".into(),
        },
    ] {
        assert_eq!(
            s.finance_sources_with_view(&period, &modules(), TODAY, true)
                .unwrap_err()
                .code,
            "PERIOD"
        );
        assert!(
            s.conn_for_test().unwrap().is_autocommit(),
            "Rejected projections must release the read transaction"
        );
    }
    assert_eq!(s.conn_for_test().unwrap().total_changes(), changes);
    assert_eq!(s.generation(), generation);
    let after = dir.path().join("after.thingary");
    s.backup(Some(&after)).unwrap();
    assert_eq!(
        archive_entries(&before),
        archive_entries(&after),
        "Every backed-up database/file entry must retain its bytes"
    );
}

#[test]
fn external_write_between_sources_does_not_split_annual_goal_balance_and_comparison() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2025-01-01");
    goal(&mut s, &a, "2025-06-01");
    snapshot(&mut s, "2025-12-31", &[(&a, "100000")], None);
    let end = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    record(&s, &end, TODAY);
    let before = serde_json::to_value(annual(&s, 2026)).unwrap();
    let database = s.conn_for_test().unwrap().path().unwrap().to_owned();
    s.set_hook(move |point| {
        if point == "finance_sources.after_wealth" {
            let c = rusqlite::Connection::open(&database)?;
            c.execute_batch("UPDATE savings_goals SET target_cents=999999,revision=revision+1; UPDATE fin_snapshot_entries SET amount_cents=1; UPDATE goal_progress SET recorded_on='2026-12-20';")?;
        }
        Ok(())
    });
    let during = serde_json::to_value(annual(&s, 2026)).unwrap();
    assert_eq!(during, before);
    s.set_hook(|_| Ok(()));
    let after = serde_json::to_value(annual(&s, 2026)).unwrap();
    assert_ne!(after["annual"]["savings"], before["annual"]["savings"]);
    assert_ne!(
        after["annual"]["comparison"],
        before["annual"]["comparison"]
    );
    assert_ne!(after["annual"]["planning"], before["annual"]["planning"]);
}

fn range_review(s: &Store, from: &str, to: &str, include_from: bool) -> FinanceSources {
    s.finance_sources_with_view(
        &Period::Range {
            from: from.into(),
            to: to.into(),
            include_from,
        },
        &modules(),
        TODAY,
        true,
    )
    .unwrap()
}

#[test]
fn sparse_cross_year_range_uses_actual_endpoints_and_window_fact_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2024-01-01");
    let prior = snapshot(&mut s, "2024-12-31", &[(&a, "100000")], None);
    snapshot(&mut s, "2025-08-31", &[(&a, "125000")], None);
    let last = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    for (date, amount) in [
        ("2025-06-29", "100"),
        ("2025-06-30", "200"),
        ("2026-06-30", "300"),
        ("2026-07-01", "400"),
    ] {
        income(&mut s, date, amount);
        s.save(
            &thingary_lib::domain::Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构期间物品".into(),
                price_cents: Some(amount.into()),
                purchase_date: Some(date.into()),
            },
            TODAY,
        )
        .unwrap();
    }
    let result = range_review(&s, "2025-06-30", "2026-06-30", true);
    assert_eq!(
        ready(result.incomes)
            .iter()
            .map(|r| r.fields.net_cents.parse::<i64>().unwrap())
            .sum::<i64>(),
        500
    );
    assert_eq!(ready(result.expenses).spent_cents, "500");
    let comparison = ready(result.annual.unwrap().comparison).unwrap();
    assert_eq!(comparison.from.snapshot_id, prior.id);
    assert_eq!(comparison.to.snapshot_id, last.id);
    assert_eq!(comparison.net_change_cents.as_deref(), Some("50000"));
    let json = serde_json::to_value(range_review(&s, "2025-06-30", "2026-06-30", true)).unwrap();
    assert_eq!(
        json["annual"]["range"],
        serde_json::json!({"from":"2025-06-30","to":"2026-06-30","includeFrom":true})
    );
    assert!(json["annual"].get("year").is_none());
    let excluded = range_review(&s, "2025-06-30", "2026-06-30", false);
    assert_eq!(ready(excluded.incomes).len(), 1);
    assert_eq!(ready(excluded.expenses).spent_cents, "300");
}

#[test]
fn start_on_window_boundary_supersedes_older_snapshot_for_year_and_range() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2025-01-01");
    snapshot(&mut s, "2025-12-31", &[(&a, "100000")], None);
    let start = snapshot(&mut s, "2026-01-01", &[(&a, "110000")], None);
    let end = snapshot(&mut s, "2026-12-31", &[(&a, "150000")], None);
    let year = annual(&s, 2026);
    let json = serde_json::to_value(&year).unwrap();
    assert_eq!(json["annual"]["year"], 2026);
    assert_eq!(
        json["annual"]["range"],
        serde_json::json!({"from":"2026-01-01","to":"2026-12-31","includeFrom":true})
    );
    let yc = ready(year.annual.unwrap().comparison).unwrap();
    assert_eq!(
        ready(
            range_review(&s, "2026-01-01", "2026-12-31", false)
                .annual
                .unwrap()
                .comparison
        )
        .unwrap()
        .from
        .snapshot_id,
        start.id
    );
    assert_eq!(yc.from.snapshot_id, start.id);
    assert_eq!(yc.to.snapshot_id, end.id);
    let rc = ready(
        range_review(&s, "2026-01-01", "2026-12-31", true)
            .annual
            .unwrap()
            .comparison,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(yc).unwrap(),
        serde_json::to_value(rc).unwrap()
    );
}

#[test]
fn range_without_prior_uses_first_in_window_and_single_or_incomplete_is_not_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2026-01-01");
    let first = snapshot(&mut s, "2026-03-31", &[(&a, "100000")], None);
    assert!(ready(
        range_review(&s, "2026-01-01", "2026-03-31", true)
            .annual
            .unwrap()
            .comparison
    )
    .is_none());
    let last = snapshot(&mut s, "2026-06-30", &[(&a, "125000")], None);
    let c = ready(
        range_review(&s, "2026-01-01", "2026-06-30", true)
            .annual
            .unwrap()
            .comparison,
    )
    .unwrap();
    assert_eq!(c.from.snapshot_id, first.id);
    assert_eq!(c.to.snapshot_id, last.id);
    account(&mut s, "2026-06-30");
    assert!(ready(
        range_review(&s, "2026-04-01", "2026-06-30", true)
            .annual
            .unwrap()
            .comparison
    )
    .is_none());
    assert!(ready(
        range_review(&s, "2025-01-01", "2025-12-31", true)
            .annual
            .unwrap()
            .comparison
    )
    .is_none());
}

#[test]
fn range_planning_uses_snapshot_dates_without_recent_24_cap_and_exclusive_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2024-01-01");
    let first = snapshot(&mut s, "2024-12-31", &[(&a, "100000")], None);
    record(&s, &first, "2026-12-30");
    let start = chrono::NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
    for i in 0..30 {
        let day = (start + chrono::Duration::days(i))
            .format("%Y-%m-%d")
            .to_string();
        let snap = snapshot(&mut s, &day, &[(&a, "150000")], None);
        record(&s, &snap, "2026-12-31");
    }
    let inclusive = ready(
        range_review(&s, "2024-12-31", "2025-01-30", true)
            .annual
            .unwrap()
            .planning,
    );
    assert_eq!(inclusive.len(), 31);
    assert_eq!(inclusive[0].snapshot_id, first.id);
    assert_eq!(inclusive[0].recorded_on, "2026-12-30");
    let exclusive = ready(
        range_review(&s, "2024-12-31", "2025-01-30", false)
            .annual
            .unwrap()
            .planning,
    );
    assert_eq!(exclusive.len(), 30);
    assert!(exclusive.iter().all(|p| p.date.starts_with("2025")));
}

#[test]
fn historical_window_keeps_current_savings_basis_and_current_read_contract() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2024-01-01");
    goal(&mut s, &a, "2024-01-01");
    snapshot(&mut s, "2024-06-30", &[(&a, "100000")], None);
    let latest = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    let expected = serde_json::to_value(
        s.savings_goals_read(&s.generation(), None, TODAY, &modules())
            .unwrap(),
    )
    .unwrap();
    for view in [
        annual(&s, 2024),
        range_review(&s, "2024-01-01", "2024-12-31", true),
    ] {
        let actual = ready(view.annual.unwrap().savings);
        assert_eq!(actual.basis.as_ref().unwrap().snapshot_id, latest.id);
        assert_eq!(serde_json::to_value(actual).unwrap(), expected);
    }
}

#[test]
fn future_window_does_not_choose_or_emit_planning_endpoints_after_today() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "2025-01-01");
    snapshot(&mut s, "2025-12-31", &[(&a, "100000")], None);
    let current = snapshot(&mut s, "2026-06-30", &[(&a, "150000")], None);
    let future = snapshot(&mut s, "2026-12-31", &[(&a, "200000")], None);
    record(&s, &current, TODAY);
    record(&s, &future, TODAY);
    let result = s
        .finance_sources_with_view(
            &Period::Range {
                from: "2026-01-01".into(),
                to: "2026-12-31".into(),
                include_from: true,
            },
            &modules(),
            "2026-06-30",
            true,
        )
        .unwrap()
        .annual
        .unwrap();
    assert_eq!(ready(result.comparison).unwrap().to.snapshot_id, current.id);
    let planning = ready(result.planning);
    assert_eq!(planning.len(), 1);
    assert_eq!(planning[0].snapshot_id, current.id);
}
