//! Goal-conclusion history: one point per complete check-in revision, never a
//! balance or an asset fact. Fictional data only.
#[path = "helpers/legacy_account_schema.rs"]
mod legacy_account_schema;

use thingary_lib::{
    goal_progress::{Point, Record},
    purge::Purge,
    storage::Store,
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave, TrashChange},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn open(s: &mut Store, name: &str) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: name.into(),
                institution: "虚构平台".into(),
                side: "asset".into(),
                kind: "cash".into(),
                counted: true,
                opened_on: "2026-01-01".into(),
                closed_on: None,
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
                group_id: None,
                currency: "CNY".into(),
                holding_mode: false,
                holding_unit: None,
            },
        },
        TODAY,
    )
    .unwrap()
}
fn check_in(
    s: &mut Store,
    id: Option<(&str, i64)>,
    date: &str,
    rows: &[(&Account, bool, i64)],
) -> (String, i64) {
    let snap = s
        .wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(),
                generation: s.generation(),
                id: id.map(|(i, _)| i.into()),
                expected_revision: id.map(|(_, r)| r),
                date: date.into(),
                notes: String::new(),
                entries: rows
                    .iter()
                    .map(|(a, known, yuan)| EntryInput {
                        account_id: a.id.clone(),
                        state: if *known { "entered" } else { "missing" }.into(),
                        amount_cents: known.then(|| (yuan * 100).to_string()),
                        original_minor: None,
                        fx_rate_micro: None,
                        quantity_e8: None,
                        unit_price_e6: None,
                    })
                    .collect(),
            },
            TODAY,
        )
        .unwrap();
    (snap.id, snap.revision)
}
fn point(required: Option<&str>) -> Point {
    Point {
        mode: "traditional".into(),
        target_month: Some("2046-10".into()),
        available_cents: Some("10000000".into()),
        required_monthly_cents: required.map(Into::into),
        entered_monthly_cents: Some("500000".into()),
        success: Some(false),
        shortfall_at_goal_cents: Some("18900000".into()),
        predicted_retire_month: None,
        has_open_items: true,
    }
}
fn record(s: &Store, id: &str, revision: i64, p: Point) -> thingary_lib::domain::Result<()> {
    s.goal_progress_record(
        &Record {
            generation: s.generation(),
            snapshot_id: id.into(),
            snapshot_revision: revision,
            point: p,
        },
        "2026-10-13",
    )
}

#[test]
fn the_first_conclusion_of_a_revision_is_kept_and_a_correction_replaces_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let cash = open(&mut s, "虚构储蓄卡");
    let (id, rev) = check_in(&mut s, None, "2026-09-30", &[(&cash, true, 1000)]);
    assert!(s.goal_progress_list().unwrap().is_empty());

    record(&s, &id, rev, point(Some("580000"))).unwrap();
    record(&s, &id, rev, point(Some("999999"))).unwrap();
    let list = s.goal_progress_list().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].date, "2026-09-30");
    assert_eq!(list[0].recorded_on, "2026-10-13");
    assert_eq!(
        list[0].point.required_monthly_cents.as_deref(),
        Some("580000"),
        "a later view must not rewrite the day's conclusion"
    );

    let (_, rev2) = check_in(
        &mut s,
        Some((&id, rev)),
        "2026-09-30",
        &[(&cash, true, 1200)],
    );
    assert!(rev2 > rev);
    assert!(
        s.goal_progress_list().unwrap().is_empty(),
        "a corrected check-in no longer matches its old conclusion"
    );
    assert_eq!(
        record(&s, &id, rev, point(Some("1"))).unwrap_err().code,
        "STALE_REVISION"
    );
    record(&s, &id, rev2, point(Some("540000"))).unwrap();
    let list = s.goal_progress_list().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(
        list[0].point.required_monthly_cents.as_deref(),
        Some("540000")
    );
}

#[test]
fn unknown_stays_unknown_and_only_complete_live_check_ins_are_recorded() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let cash = open(&mut s, "虚构储蓄卡");
    let fund = open(&mut s, "虚构基金");
    let (partial, p_rev) = check_in(
        &mut s,
        None,
        "2026-08-31",
        &[(&cash, true, 1000), (&fund, false, 0)],
    );
    assert_eq!(
        record(&s, &partial, p_rev, point(None)).unwrap_err().code,
        "GOAL_PROGRESS"
    );
    let (id, rev) = check_in(
        &mut s,
        None,
        "2026-09-30",
        &[(&cash, true, 1000), (&fund, true, 500)],
    );
    let unknown = Point {
        required_monthly_cents: None,
        entered_monthly_cents: None,
        success: None,
        shortfall_at_goal_cents: None,
        available_cents: None,
        ..point(None)
    };
    record(&s, &id, rev, unknown.clone()).unwrap();
    assert_eq!(s.goal_progress_list().unwrap()[0].point, unknown);
    assert_eq!(
        record(&s, "no-such-snapshot", 1, point(None))
            .unwrap_err()
            .code,
        "GOAL_PROGRESS"
    );
}

#[test]
fn malformed_points_and_other_libraries_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let cash = open(&mut s, "虚构储蓄卡");
    let (id, rev) = check_in(&mut s, None, "2026-09-30", &[(&cash, true, 1000)]);
    for bad in [
        Point {
            mode: "yolo".into(),
            ..point(None)
        },
        Point {
            target_month: Some("2046-13".into()),
            ..point(None)
        },
        Point {
            available_cents: Some("12.5".into()),
            ..point(None)
        },
        Point {
            required_monthly_cents: Some("1e9".into()),
            ..point(None)
        },
        Point {
            entered_monthly_cents: Some("9999999999999".into()),
            ..point(None)
        },
    ] {
        assert_eq!(record(&s, &id, rev, bad).unwrap_err().code, "GOAL_PROGRESS");
    }
    let negative = Point {
        entered_monthly_cents: Some("-120000".into()),
        ..point(None)
    };
    record(&s, &id, rev, negative).unwrap();
    let stale = Record {
        generation: "another-library".into(),
        snapshot_id: id.clone(),
        snapshot_revision: rev,
        point: point(None),
    };
    assert_eq!(
        s.goal_progress_record(&stale, "2026-10-13")
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
    assert!(s
        .goal_progress_record(
            &Record {
                generation: s.generation(),
                snapshot_id: id,
                snapshot_revision: rev,
                point: point(None)
            },
            "13/10/2026"
        )
        .is_err());
}

#[test]
fn deleting_hides_the_point_and_purging_removes_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let cash = open(&mut s, "虚构储蓄卡");
    let (id, rev) = check_in(&mut s, None, "2026-09-30", &[(&cash, true, 1000)]);
    record(&s, &id, rev, point(Some("580000"))).unwrap();
    let trash = |s: &mut Store, deleted: bool, expected: i64| {
        s.wealth_trash(&TrashChange {
            request_id: rid(),
            generation: s.generation(),
            kind: "snapshot".into(),
            id: id.clone(),
            expected_revision: expected,
            deleted,
        })
        .unwrap()
    };
    let count = |s: &Store| -> i64 {
        s.conn_for_test()
            .unwrap()
            .query_row("SELECT count(*) FROM goal_progress", [], |r| r.get(0))
            .unwrap()
    };
    let revision = |s: &Store| -> i64 {
        s.conn_for_test()
            .unwrap()
            .query_row(
                "SELECT revision FROM fin_snapshots WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap()
    };
    trash(&mut s, true, rev);
    assert!(s.goal_progress_list().unwrap().is_empty());
    assert_eq!(count(&s), 1, "deleting only hides the day");
    let current = revision(&s);
    trash(&mut s, false, current);
    assert!(
        s.goal_progress_list().unwrap().is_empty(),
        "a restored check-in is a new revision and starts over"
    );
    let current = revision(&s);
    trash(&mut s, true, current);
    s.purge_trash(&Purge {
        request_id: rid(),
        generation: s.generation(),
        kind: Some("snapshot".into()),
        id: id.clone(),
        preview: None,
    })
    .unwrap();
    assert_eq!(count(&s), 0);
}

#[test]
fn schema_40_adds_an_empty_table_and_a_failed_step_rolls_back() {
    use thingary_lib::{
        domain::Error,
        storage::{migrate_to, SCHEMA_VERSION},
    };
    const { assert!(SCHEMA_VERSION >= 40) };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let cash = open(&mut s, "虚构储蓄卡");
    let (id, rev) = check_in(&mut s, None, "2026-09-30", &[(&cash, true, 1000)]);
    let c = s.conn_for_test().unwrap();
    legacy_account_schema::restore_pre41_account_schema(c);
    c.execute_batch("DROP TABLE goal_progress; PRAGMA user_version=39;")
        .unwrap();
    let version = || {
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap()
    };
    let table = || {
        c.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='goal_progress'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
    };
    let fail = |p: &str| {
        if p == "migration.before_commit" {
            Err(Error::new("FAULT", "注入故障"))
        } else {
            Ok(())
        }
    };
    assert!(migrate_to(c, 40, &fail).is_err());
    assert_eq!(
        (version(), table()),
        (39, 0),
        "the failed step leaves the old schema intact"
    );
    migrate_to(c, 40, &|_| Ok(())).unwrap();
    assert_eq!((version(), table()), (40, 1));
    let rows: i64 = c
        .query_row("SELECT count(*) FROM goal_progress", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0, "no history is invented for earlier check-ins");
    // The check-in itself is untouched by the upgrade and can be recorded afterwards.
    record(&s, &id, rev, point(Some("580000"))).unwrap();
    assert_eq!(s.goal_progress_list().unwrap().len(), 1);
}
