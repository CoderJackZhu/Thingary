//! Planning stage 1 (PLANNING_DESIGN §3–§4): monthly income records and the
//! savings review built from real check-ins. Fictional data only.
use rusqlite::Connection;
use thingary_lib::{
    domain::Error,
    expenses,
    modules::{self, Modules},
    plan_income::{Fields, Save},
    plan_savings::Mark,
    purge::Purge,
    storage::{migrate_to, Store, SCHEMA, SCHEMA_VERSION},
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave, TrashChange},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn yuan(n: i64) -> String {
    (n * 100).to_string()
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}
fn fields(day: &str, net: i64, hpf: i64) -> Fields {
    Fields {
        date: day.into(),
        net_cents: yuan(net),
        hpf_cents: yuan(hpf),
        notes: String::new(),
    }
}
fn new(s: &Store, f: Fields) -> Save {
    Save {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: f,
    }
}
fn account(s: &mut Store, name: &str, kind: &str) -> Account {
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
                kind: kind.into(),
                counted: true,
                opened_on: "2026-01-01".into(),
                closed_on: None,
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn check_in(s: &mut Store, day: &str, rows: &[(&Account, i64)]) -> String {
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: day.into(),
            notes: format!("虚构备注 {day}"),
            entries: rows
                .iter()
                .map(|(a, v)| EntryInput {
                    account_id: a.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some(yuan(*v)),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap()
    .id
}
fn trash(s: &Store, kind: &str, id: &str, revision: i64, deleted: bool) -> TrashChange {
    TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: kind.into(),
        id: id.into(),
        expected_revision: revision,
        deleted,
    }
}
fn purge(s: &Store, kind: &str, id: &str) -> Purge {
    Purge {
        preview: None,
        request_id: rid(),
        generation: s.generation(),
        kind: Some(kind.into()),
        id: id.into(),
    }
}
fn rows(s: &Store) -> Vec<(String, String, String)> {
    s.plan_income_list()
        .unwrap()
        .rows
        .into_iter()
        .map(|r| (r.fields.date, r.fields.net_cents, r.fields.hpf_cents))
        .collect()
}

#[test]
fn income_saves_validates_orders_and_replays_requests() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    assert!(s.plan_income_list().unwrap().rows.is_empty());

    let first = s
        .plan_income_save(&new(&s, fields("2026-02-15", 20000, 3000)), TODAY)
        .unwrap();
    s.plan_income_save(&new(&s, fields("2026-03-15", 20000, 0)), TODAY)
        .unwrap();
    // Two rows on one day are allowed (pay and bonus paid separately).
    s.plan_income_save(&new(&s, fields("2026-03-15", 5000, 0)), TODAY)
        .unwrap();
    let days: Vec<String> = rows(&s).into_iter().map(|r| r.0).collect();
    assert_eq!(days, ["2026-03-15", "2026-03-15", "2026-02-15"]);

    // Zero is a stated fact; negative, decimal, blank and future are not.
    s.plan_income_save(&new(&s, fields("2026-04-15", 0, 0)), TODAY)
        .unwrap();
    for (f, want) in [
        (
            Fields {
                net_cents: "-1".into(),
                ..fields("2026-01-01", 1, 1)
            },
            "INCOME_NET",
        ),
        (
            Fields {
                net_cents: "".into(),
                ..fields("2026-01-01", 1, 1)
            },
            "INCOME_NET",
        ),
        (
            Fields {
                hpf_cents: "1.5".into(),
                ..fields("2026-01-01", 1, 1)
            },
            "INCOME_HPF",
        ),
        (fields("2027-01-01", 1, 1), "INCOME_DATE"),
        (fields("2026-02-30", 1, 1), "DATE"),
        (
            Fields {
                notes: "字".repeat(501),
                ..fields("2026-01-01", 1, 1)
            },
            "INCOME_NOTES",
        ),
    ] {
        assert_eq!(code(s.plan_income_save(&new(&s, f), TODAY)), want);
    }

    // Retrying the same request returns the same row; other content is refused.
    let again = new(&s, fields("2026-05-15", 21000, 3000));
    let a = s.plan_income_save(&again, TODAY).unwrap();
    let b = s.plan_income_save(&again, TODAY).unwrap();
    assert_eq!((a.id.as_str(), b.revision), (b.id.as_str(), 1));
    let mut other = again.clone();
    other.fields.net_cents = yuan(1);
    assert_eq!(code(s.plan_income_save(&other, TODAY)), "REQUEST_CONFLICT");

    // Edits use the revision; a stale one cannot overwrite a later correction.
    let mut edit = new(&s, fields("2026-02-15", 20500, 3000));
    edit.id = Some(first.id.clone());
    edit.expected_revision = Some(1);
    let edited = s.plan_income_save(&edit, TODAY).unwrap();
    assert_eq!(
        (edited.revision, edited.fields.net_cents.as_str()),
        (2, "2050000")
    );
    let mut stale = new(&s, fields("2026-02-15", 1, 1));
    stale.id = Some(first.id.clone());
    stale.expected_revision = Some(1);
    assert_eq!(code(s.plan_income_save(&stale, TODAY)), "REVISION_CONFLICT");
    // A request from an older library generation is refused.
    let mut old = new(&s, fields("2026-06-15", 1, 1));
    old.generation = "not-this-library".into();
    assert!(s.plan_income_save(&old, TODAY).is_err());
}

#[test]
fn a_failed_commit_leaves_nothing_and_the_retry_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let input = new(&s, fields("2026-02-15", 20000, 3000));
    s.set_hook(|p| {
        if p == "plan_income.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.plan_income_save(&input, TODAY)), "INJECTED");
    assert!(rows(&s).is_empty());
    s.set_hook(|_| Ok(()));
    s.plan_income_save(&input, TODAY).unwrap();
    assert_eq!(rows(&s).len(), 1);
}

#[test]
fn income_rows_delete_restore_and_purge_like_other_records() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let r = s
        .plan_income_save(&new(&s, fields("2026-02-15", 20000, 3000)), TODAY)
        .unwrap();
    s.wealth_trash(&trash(&s, "income", &r.id, 1, true))
        .unwrap();
    assert!(rows(&s).is_empty());
    let listed: Vec<(String, String)> = s
        .list_trash(&thingary_lib::trash::TrashQuery {
            filter: "wealth".into(),
            offset: 0,
            search: String::new(),
        })
        .unwrap()
        .items
        .into_iter()
        .map(|e| (e.kind, e.title))
        .collect();
    assert_eq!(listed, [("income".to_string(), "2026-02-15".to_string())]);
    // Each delete or restore is a revision, so a stale one cannot undo a later change.
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "income", &r.id, 1, false))),
        "REVISION_CONFLICT"
    );
    s.wealth_trash(&trash(&s, "income", &r.id, 2, false))
        .unwrap();
    assert_eq!(rows(&s).len(), 1);
    s.wealth_trash(&trash(&s, "income", &r.id, 3, true))
        .unwrap();
    let out = s.purge_trash(&purge(&s, "income", &r.id)).unwrap();
    assert_eq!((out.removed, out.kept), (1, 0));
    assert!(rows(&s).is_empty());
}

struct Book {
    cash: Account,
    fund: Account,
}
fn book(s: &mut Store) -> Book {
    Book {
        cash: account(s, "虚构储蓄卡", "cash"),
        fund: account(s, "虚构公积金", "housing_fund"),
    }
}

#[test]
fn review_is_built_from_real_check_ins_and_income() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let b = book(&mut s);
    check_in(&mut s, "2026-01-31", &[(&b.cash, 10000), (&b.fund, 20000)]);
    let end = check_in(&mut s, "2026-03-31", &[(&b.cash, 30000), (&b.fund, 26000)]);

    // No income yet: the interval exists but has no figures, with the reason.
    let r = s.plan_review().unwrap();
    assert_eq!(r.intervals.len(), 1);
    assert_eq!(r.intervals[0].status, "no_income");
    assert_eq!(r.stats.count, 0);

    s.plan_income_save(&new(&s, fields("2026-02-15", 20000, 3000)), TODAY)
        .unwrap();
    s.plan_income_save(&new(&s, fields("2026-03-15", 20000, 3000)), TODAY)
        .unwrap();
    let r = s.plan_review().unwrap();
    let i = &r.intervals[0];
    assert_eq!(
        (i.from.as_str(), i.to.as_str(), i.days),
        ("2026-01-31", "2026-03-31", 59)
    );
    // Net worth +26 000, deposits 6 000, pay 40 000.
    assert_eq!(i.delta_nw_cents.as_deref(), Some("2600000"));
    assert_eq!(i.saving_cents.as_deref(), Some("2000000"));
    assert_eq!(i.spend_cents.as_deref(), Some("2000000"));
    assert_eq!(i.rate_hundredths, Some(5000));
    assert_eq!(r.stats.count, 1);
    assert!(r.stats.low_sample);

    // A one-off mark keeps the interval visible but out of the usual figures.
    let mark = |s: &Store, excluded: bool| Mark {
        request_id: rid(),
        generation: s.generation(),
        snapshot_id: end.clone(),
        excluded,
    };
    s.plan_baseline_mark(&mark(&s, true)).unwrap();
    let r = s.plan_review().unwrap();
    assert!(r.intervals[0].excluded);
    assert_eq!(
        (r.stats.count, r.stats.median_monthly_saving_cents),
        (0, None)
    );
    let replay = mark(&s, false);
    s.plan_baseline_mark(&replay).unwrap();
    s.plan_baseline_mark(&replay).unwrap(); // same request: a no-op
    assert!(!s.plan_review().unwrap().intervals[0].excluded);
    assert_eq!(
        code(s.plan_baseline_mark(&Mark {
            snapshot_id: rid(),
            ..mark(&s, true)
        })),
        "NOT_FOUND"
    );

    // An incomplete check-in never ends an interval and is counted.
    let later = s
        .wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: "虚构新账户".into(),
                    institution: "虚构平台".into(),
                    side: "asset".into(),
                    kind: "cash".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    let _ = later; // backfilled account marks older check-ins incomplete
    let r = s.plan_review().unwrap();
    assert_eq!(r.incomplete_count, 2);
    assert!(r.intervals.is_empty());
}

#[test]
fn reasons_list_the_interval_records_and_respect_modules() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("lib");
    let mut s = Store::open(&root).unwrap();
    let b = book(&mut s);
    check_in(&mut s, "2026-01-31", &[(&b.cash, 100), (&b.fund, 100)]);
    let end = check_in(&mut s, "2026-03-31", &[(&b.cash, 100), (&b.fund, 100)]);
    for day in ["2026-01-20", "2026-03-05", "2026-04-02"] {
        s.expense_save(
            &expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: expenses::Fields {
                    title: format!("虚构支出 {day}"),
                    date: day.into(),
                    amount_cents: yuan(500),
                    category: "travel".into(),
                    notes: String::new(),
                    refund_cents: None,
                    refund_date: None,
                    asset_id: None,
                },
            },
            TODAY,
        )
        .unwrap();
    }
    let r = s.plan_interval_reasons(&end).unwrap();
    assert_eq!(
        (r.from.as_str(), r.to.as_str()),
        ("2026-01-31", "2026-03-31")
    );
    assert_eq!(r.notes, "虚构备注 2026-03-31");
    // Only the one dated inside (from, to].
    assert_eq!(
        r.lines.iter().map(|l| l.title.as_str()).collect::<Vec<_>>(),
        ["虚构支出 2026-03-05"]
    );
    modules::write(
        &root,
        &Modules {
            expenses: false,
            ..Modules::default()
        },
    )
    .unwrap();
    assert!(s.plan_interval_reasons(&end).unwrap().lines.is_empty());
    // The first check-in has nothing to compare with.
    let first = s.wealth_summary().unwrap().points[0].snapshot_id.clone();
    assert_eq!(code(s.plan_interval_reasons(&first)), "NOT_FOUND");
}

#[test]
fn purging_a_check_in_clears_its_mark() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let b = book(&mut s);
    let id = check_in(&mut s, "2026-01-31", &[(&b.cash, 1), (&b.fund, 1)]);
    s.plan_baseline_mark(&Mark {
        request_id: rid(),
        generation: s.generation(),
        snapshot_id: id.clone(),
        excluded: true,
    })
    .unwrap();
    let revision = s.wealth_snapshot(&id).unwrap().unwrap().revision;
    s.wealth_trash(&trash(&s, "snapshot", &id, revision, true))
        .unwrap();
    s.purge_trash(&purge(&s, "snapshot", &id)).unwrap();
    let left: i64 = s
        .conn_for_test()
        .unwrap()
        .query_row("SELECT count(*) FROM plan_baseline_marks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn schema_28_libraries_upgrade_and_new_backups_round_trip() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 28, &|_| Ok(())).unwrap();
    let before: i64 = c
        .query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('plan_income','plan_baseline_marks')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, 0);
    migrate_to(&c, SCHEMA_VERSION, &|_| Ok(())).unwrap();
    let after: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name IN ('plan_income','plan_baseline_marks')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after, 2);

    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("a")).unwrap();
    let b = book(&mut s);
    let snap = check_in(&mut s, "2026-01-31", &[(&b.cash, 1), (&b.fund, 1)]);
    s.plan_income_save(&new(&s, fields("2026-02-15", 20000, 3000)), TODAY)
        .unwrap();
    s.plan_baseline_mark(&Mark {
        request_id: rid(),
        generation: s.generation(),
        snapshot_id: snap.clone(),
        excluded: true,
    })
    .unwrap();
    let file = dir.path().join("备份.thingary");
    s.backup(Some(&file)).unwrap();
    drop(s);
    let mut t = Store::open(&dir.path().join("b")).unwrap();
    let summary = t.inspect_backup(&file).unwrap();
    t.restore(&file, &summary.hash, &t.generation()).unwrap();
    assert_eq!(
        rows(&t),
        [("2026-02-15".into(), "2000000".into(), "300000".into())]
    );
    let marks: i64 = t
        .conn_for_test()
        .unwrap()
        .query_row("SELECT count(*) FROM plan_baseline_marks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(marks, 1);
}
