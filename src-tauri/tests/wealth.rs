use possio_lib::{
    domain::Error,
    storage::{migrate, migrate_to, Store, SCHEMA},
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave},
};
use std::io::Write;
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn yuan(n: i64) -> String {
    (n * 100).to_string()
}
fn open(s: &mut Store, name: &str, kind: &str, opened: &str) -> Account {
    let side = if ["credit_card", "loan", "other_liability"].contains(&kind) {
        "liability"
    } else {
        "asset"
    };
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: name.into(),
                institution: "虚构平台".into(),
                side: side.into(),
                kind: kind.into(),
                counted: true,
                opened_on: opened.into(),
                closed_on: None,
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn edit(s: &mut Store, a: &Account, f: impl FnOnce(&mut AccountFields)) -> Result<Account, Error> {
    let mut fields = a.fields.clone();
    f(&mut fields);
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(a.id.clone()),
            expected_revision: Some(a.revision),
            fields,
        },
        TODAY,
    )
}
fn row(a: &Account, state: &str, yuan_amount: Option<i64>) -> EntryInput {
    EntryInput {
        account_id: a.id.clone(),
        state: state.into(),
        amount_cents: yuan_amount.map(yuan),
    }
}
fn check_in(s: &Store, date: &str, entries: Vec<EntryInput>) -> SnapshotSave {
    SnapshotSave {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        date: date.into(),
        notes: String::new(),
        entries,
    }
}
struct Book {
    cash: Account,
    broker: Account,
    fund: Account,
    loan: Account,
}
fn book(s: &mut Store) -> Book {
    Book {
        cash: open(s, "虚构储蓄卡", "cash", "2026-01-01"),
        broker: open(s, "虚构证券", "mixed", "2026-01-01"),
        fund: open(s, "虚构公积金", "housing_fund", "2026-01-01"),
        loan: open(s, "虚构消费贷", "loan", "2026-01-01"),
    }
}
fn full(b: &Book, cash: i64, broker: i64, fund: i64, loan: i64) -> Vec<EntryInput> {
    vec![
        row(&b.cash, "entered", Some(cash)),
        row(&b.broker, "entered", Some(broker)),
        row(&b.fund, "entered", Some(fund)),
        row(&b.loan, "entered", Some(loan)),
    ]
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}

#[test]
fn x_ac01_02_net_worth_and_change_between_complete_check_ins() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    s.wealth_snapshot_save(
        &check_in(&s, "2026-09-30", full(&b, 100_000, 200_000, 50_000, 20_000)),
        TODAY,
    )
    .unwrap();
    s.wealth_snapshot_save(
        &check_in(&s, "2026-10-31", full(&b, 110_000, 200_000, 50_000, 20_000)),
        TODAY,
    )
    .unwrap();
    let sum = s.wealth_summary().unwrap();
    let p = &sum.points[0];
    assert_eq!(
        (
            p.assets_cents.as_str(),
            p.liabilities_cents.as_str(),
            p.net_cents.as_str(),
            p.complete
        ),
        ("35000000", "2000000", "33000000", true)
    );
    let p = &sum.points[1];
    assert_eq!(p.compared_to.as_deref(), Some("2026-09-30"));
    assert_eq!(p.change_cents.as_deref(), Some("1000000"));
    assert_eq!(p.change_rate_hundredths, Some(303));
    assert_eq!(sum.structure_date.as_deref(), Some("2026-10-31"));
    let kinds: Vec<_> = sum
        .structure
        .iter()
        .map(|x| (x.kind.as_str(), x.amount_cents.as_str(), x.share_hundredths))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("cash", "11000000", Some(3056)),
            ("mixed", "20000000", Some(5556)),
            ("housing_fund", "5000000", Some(1389))
        ]
    );
    assert_eq!(sum.liabilities[0].amount_cents, "2000000");
}

#[test]
fn x_ac03_no_rate_when_previous_net_is_zero_or_negative() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    s.wealth_snapshot_save(
        &check_in(&s, "2026-09-30", full(&b, 0, 0, 0, 10_000)),
        TODAY,
    )
    .unwrap();
    s.wealth_snapshot_save(
        &check_in(&s, "2026-10-31", full(&b, 10_000, 0, 0, 10_000)),
        TODAY,
    )
    .unwrap();
    s.wealth_snapshot_save(
        &check_in(&s, "2026-11-30", full(&b, 15_000, 0, 0, 10_000)),
        TODAY,
    )
    .unwrap();
    let points = s.wealth_summary().unwrap().points;
    assert_eq!(points[0].net_cents, "-1000000");
    assert_eq!(
        (
            points[1].change_cents.as_deref(),
            points[1].change_rate_hundredths
        ),
        (Some("1000000"), None)
    );
    assert_eq!(
        (
            points[2].change_cents.as_deref(),
            points[2].change_rate_hundredths
        ),
        (Some("500000"), None)
    );
}

#[test]
fn x_ac04_missing_is_not_zero_and_unchanged_must_match_the_last_known_amount() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    s.wealth_snapshot_save(
        &check_in(&s, "2026-09-30", full(&b, 100_000, 200_000, 50_000, 20_000)),
        TODAY,
    )
    .unwrap();
    let mut rows = full(&b, 100_000, 0, 50_000, 20_000);
    rows[1] = row(&b.broker, "missing", None);
    let partial = s
        .wealth_snapshot_save(&check_in(&s, "2026-10-31", rows), TODAY)
        .unwrap();
    assert_eq!(partial.missing, vec![b.broker.id.clone()]);
    let p = &s.wealth_summary().unwrap().points[1];
    assert_eq!(
        (p.complete, p.missing, p.change_cents.as_deref()),
        (false, 1, None)
    );
    assert_eq!(p.assets_cents, "15000000", "known subtotal only");

    let draft = s.wealth_snapshot_draft("2026-11-30").unwrap();
    let broker = draft
        .rows
        .iter()
        .find(|r| r.account.id == b.broker.id)
        .unwrap();
    assert_eq!(
        broker
            .previous
            .as_ref()
            .map(|o| (o.amount_cents.as_str(), o.date.as_str())),
        Some(("20000000", "2026-09-30")),
        "the last known amount skips the missing row"
    );
    let mut rows = full(&b, 100_000, 0, 50_000, 20_000);
    rows[1] = row(&b.broker, "unchanged", Some(199_999));
    assert_eq!(
        code(s.wealth_snapshot_save(&check_in(&s, "2026-11-30", rows), TODAY)),
        "SNAPSHOT_UNCHANGED"
    );
    let mut rows = full(&b, 100_000, 0, 50_000, 20_000);
    rows[1] = row(&b.broker, "unchanged", None);
    let saved = s
        .wealth_snapshot_save(&check_in(&s, "2026-11-30", rows), TODAY)
        .unwrap();
    assert!(saved.missing.is_empty());
    let p = &s.wealth_summary().unwrap().points[2];
    assert_eq!(
        p.compared_to.as_deref(),
        Some("2026-09-30"),
        "skips the partial check-in"
    );
    assert_eq!(p.change_cents.as_deref(), Some("0"));

    let fresh = open(&mut s, "虚构新卡", "cash", "2026-12-01");
    assert_eq!(
        code(s.wealth_snapshot_save(
            &check_in(
                &s,
                "2026-12-15",
                vec![
                    row(&b.cash, "entered", Some(1)),
                    row(&b.broker, "entered", Some(1)),
                    row(&b.fund, "entered", Some(1)),
                    row(&b.loan, "entered", Some(1)),
                    row(&fresh, "unchanged", None)
                ]
            ),
            TODAY
        )),
        "SNAPSHOT_UNCHANGED",
        "nothing earlier to confirm"
    );
}

#[test]
fn x_ac05_only_real_points_and_comparison_names_the_span() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    s.wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)), TODAY)
        .unwrap();
    s.wealth_snapshot_save(&check_in(&s, "2026-12-31", full(&b, 2, 1, 1, 1)), TODAY)
        .unwrap();
    let points = s.wealth_summary().unwrap().points;
    assert_eq!(points.len(), 2);
    assert_eq!(points[1].compared_to.as_deref(), Some("2026-09-30"));
}

#[test]
fn x_ac10_retries_reuse_the_first_result_and_failed_commits_leave_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    let input = check_in(&s, "2026-09-30", full(&b, 1, 2, 3, 4));
    s.set_hook(|p| {
        if p == "wealth_snapshot.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.wealth_snapshot_save(&input, TODAY)), "INJECTED");
    assert!(s.wealth_summary().unwrap().points.is_empty());
    assert_eq!(
        s.wealth_request_result(&input.request_id, &s.generation())
            .unwrap(),
        None
    );
    s.set_hook(|_| Ok(()));
    let first = s.wealth_snapshot_save(&input, TODAY).unwrap();
    let again = s.wealth_snapshot_save(&input, TODAY).unwrap();
    assert_eq!(
        (first.id.as_str(), first.revision),
        (again.id.as_str(), again.revision)
    );
    assert_eq!(
        s.wealth_request_result(&input.request_id, &s.generation())
            .unwrap()
            .as_deref(),
        Some(first.id.as_str())
    );
    let mut other = input.clone();
    other.notes = "不同内容".into();
    assert_eq!(
        code(s.wealth_snapshot_save(&other, TODAY)),
        "REQUEST_CONFLICT"
    );
    assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
}

#[test]
fn check_in_rows_must_match_the_accounts_due_that_day() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    let late = open(&mut s, "虚构新卡", "cash", "2026-10-15");
    assert_eq!(
        code(s.wealth_snapshot_save(&check_in(&s, "2027-01-01", full(&b, 1, 1, 1, 1)), TODAY)),
        "SNAPSHOT_DATE"
    );
    assert_eq!(
        code(s.wealth_snapshot_save(
            &check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)[..3].to_vec()),
            TODAY
        )),
        "SNAPSHOT_INCOMPLETE_ROWS"
    );
    let mut extra = full(&b, 1, 1, 1, 1);
    extra.push(row(&late, "entered", Some(1)));
    assert_eq!(
        code(s.wealth_snapshot_save(&check_in(&s, "2026-09-30", extra), TODAY)),
        "SNAPSHOT_ACCOUNT"
    );
    let mut dup = full(&b, 1, 1, 1, 1);
    dup[3] = row(&b.cash, "entered", Some(1));
    assert_eq!(
        code(s.wealth_snapshot_save(&check_in(&s, "2026-09-30", dup), TODAY)),
        "SNAPSHOT_ACCOUNT"
    );
    let mut negative = full(&b, 1, 1, 1, 1);
    negative[0].amount_cents = Some("-100".into());
    assert_eq!(
        code(s.wealth_snapshot_save(&check_in(&s, "2026-09-30", negative), TODAY)),
        "WEALTH_AMOUNT"
    );
    let first = s
        .wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)), TODAY)
        .unwrap();
    assert_eq!(
        code(s.wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)), TODAY)),
        "SNAPSHOT_DATE_TAKEN"
    );
    let draft = s.wealth_snapshot_draft("2026-09-30").unwrap();
    assert_eq!(
        draft.existing.as_ref().map(|x| x.id.as_str()),
        Some(first.id.as_str())
    );
    assert_eq!(draft.rows.len(), 4, "the later account is not due yet");

    // Correcting keeps the id, bumps the revision and rejects a stale form.
    let mut fix = check_in(&s, "2026-09-30", full(&b, 5, 1, 1, 1));
    fix.id = Some(first.id.clone());
    fix.expected_revision = Some(first.revision);
    let fixed = s.wealth_snapshot_save(&fix, TODAY).unwrap();
    assert_eq!((fixed.id.as_str(), fixed.revision), (first.id.as_str(), 2));
    fix.request_id = rid();
    assert_eq!(
        code(s.wealth_snapshot_save(&fix, TODAY)),
        "REVISION_CONFLICT"
    );
}

#[test]
fn backfilled_account_marks_older_check_ins_incomplete_instead_of_zero() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    s.wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)), TODAY)
        .unwrap();
    let old = open(&mut s, "补建的旧账户", "fund", "2025-01-01");
    let p = &s.wealth_summary().unwrap().points[0];
    assert_eq!((p.complete, p.missing), (false, 1));
    let snap = s.wealth_snapshot(&p.snapshot_id).unwrap().unwrap();
    assert_eq!(snap.missing, vec![old.id]);
}

#[test]
fn x_d01_d04_history_keeps_its_scope_and_counted_changes_block_comparison() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    let first = s
        .wealth_snapshot_save(
            &check_in(&s, "2026-09-30", full(&b, 100_000, 0, 0, 20_000)),
            TODAY,
        )
        .unwrap();
    let loan = edit(&mut s, &b.loan, |f| {
        f.counted = false;
        f.kind = "other_liability".into();
    })
    .unwrap();
    assert_eq!(loan.revision, 2);
    assert_eq!(
        code(edit(&mut s, &loan, |f| {
            f.side = "asset".into();
            f.kind = "cash".into();
        })),
        "ACCOUNT_SIDE"
    );
    s.wealth_snapshot_save(
        &check_in(&s, "2026-10-31", full(&b, 100_000, 0, 0, 20_000)),
        TODAY,
    )
    .unwrap();
    let sum = s.wealth_summary().unwrap();
    assert_eq!(
        sum.points[0].net_cents, "8000000",
        "old check-in still counts the loan"
    );
    assert_eq!(sum.points[1].net_cents, "10000000");
    assert!(sum.points[1].scope_changed);
    assert_eq!(sum.points[1].change_cents, None);
    let old_loan = s
        .wealth_snapshot(&first.id)
        .unwrap()
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.account_id == b.loan.id)
        .unwrap();
    assert_eq!((old_loan.kind.as_str(), old_loan.counted), ("loan", true));
}

#[test]
fn closing_needs_a_recorded_zero_and_dates_must_cover_recorded_check_ins() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    s.wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)), TODAY)
        .unwrap();
    assert_eq!(
        code(edit(&mut s, &b.loan, |f| f.closed_on = Some("2026-10-15".into()))),
        "ACCOUNT_CLOSE_BALANCE"
    );
    assert_eq!(
        code(edit(&mut s, &b.loan, |f| f.opened_on = "2026-10-01".into())),
        "ACCOUNT_DATE"
    );
    assert_eq!(
        code(edit(&mut s, &b.loan, |f| f.closed_on = Some("2026-09-30".into()))),
        "ACCOUNT_DATE",
        "the 09-30 check-in must stay inside the open period"
    );
    s.wealth_snapshot_save(&check_in(&s, "2026-10-10", full(&b, 1, 1, 1, 0)), TODAY)
        .unwrap();
    let closed = edit(&mut s, &b.loan, |f| f.closed_on = Some("2026-10-15".into())).unwrap();
    assert_eq!(closed.fields.closed_on.as_deref(), Some("2026-10-15"));
    let draft = s.wealth_snapshot_draft("2026-10-31").unwrap();
    assert_eq!(draft.rows.len(), 3);
    let fresh = open(&mut s, "从未盘点的卡", "credit_card", "2026-01-01");
    edit(&mut s, &fresh, |f| f.closed_on = Some("2026-02-01".into())).unwrap();
}

#[test]
fn schema_fourteen_upgrade_is_atomic_and_retryable() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 14, &|_| Ok(())).unwrap();
    let version = |c: &rusqlite::Connection| {
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap()
    };
    assert!(migrate(&c, &|p| if p == "migration.before_commit" {
        Err(Error::new("INJECTED", "中断"))
    } else {
        Ok(())
    })
    .is_err());
    assert_eq!(version(&c), 14);
    let tables: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name LIKE 'fin_%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 0);
    migrate(&c, &|_| Ok(())).unwrap();
    assert_eq!(version(&c), 17);
}

fn archive(dir: &std::path::Path, schema: u32, db: &std::path::Path) -> std::path::PathBuf {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(db).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":schema,"created_at":"2026-09-28T02:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let path = dir.join(format!("v{schema}.possio"));
    let mut z = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("manifest.json", opts).unwrap();
    z.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    z.start_file("data.sqlite", opts).unwrap();
    z.write_all(&bytes).unwrap();
    z.finish().unwrap();
    path
}

#[test]
fn backups_carry_check_ins_old_ones_migrate_and_newer_ones_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a")).unwrap();
    let b = book(&mut a);
    a.wealth_snapshot_save(
        &check_in(&a, "2026-09-30", full(&b, 100_000, 200_000, 50_000, 20_000)),
        TODAY,
    )
    .unwrap();
    let file = dir.path().join("完整备份.possio");
    a.backup(Some(&file)).unwrap();
    let before = serde_json::to_string(&a.wealth_summary().unwrap().points).unwrap();
    drop(a);

    let mut c = Store::open(&dir.path().join("c")).unwrap();
    let summary = c.inspect_backup(&file).unwrap();
    assert_eq!(
        (summary.schema, summary.accounts, summary.snapshots),
        (17, 4, 1)
    );
    c.restore(&file, &summary.hash, &c.generation()).unwrap();
    assert_eq!(
        serde_json::to_string(&c.wealth_summary().unwrap().points).unwrap(),
        before
    );
    assert_eq!(c.wealth_accounts().unwrap().len(), 4);

    let v14 = dir.path().join("v14.sqlite");
    let db = rusqlite::Connection::open(&v14).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 14, &|_| Ok(())).unwrap();
    drop(db);
    let old = archive(dir.path(), 14, &v14);
    let summary = c.inspect_backup(&old).unwrap();
    c.restore(&old, &summary.hash, &c.generation()).unwrap();
    assert!(c.wealth_accounts().unwrap().is_empty());
    assert!(c.wealth_summary().unwrap().points.is_empty());

    let v16 = dir.path().join("v16.sqlite");
    let db = rusqlite::Connection::open(&v16).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate(&db, &|_| Ok(())).unwrap();
    db.execute_batch("PRAGMA user_version=18;").unwrap();
    drop(db);
    assert_eq!(
        code(c.inspect_backup(&archive(dir.path(), 18, &v16))),
        "BACKUP_VERSION"
    );
}

fn trash(
    s: &Store,
    kind: &str,
    id: &str,
    revision: i64,
    deleted: bool,
) -> possio_lib::wealth::TrashChange {
    possio_lib::wealth::TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: kind.into(),
        id: id.into(),
        expected_revision: revision,
        deleted,
    }
}
fn trash_kinds(s: &Store) -> Vec<(String, String)> {
    s.list_trash(&possio_lib::trash::TrashQuery {
        filter: "wealth".into(),
        offset: 0,
    })
    .unwrap()
    .items
    .into_iter()
    .map(|e| (e.kind, e.title))
    .collect()
}

#[test]
fn x_ac14_check_ins_and_unused_accounts_delete_and_restore_safely() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let b = book(&mut s);
    let snap = s
        .wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 1, 1, 1, 1)), TODAY)
        .unwrap();
    let del = trash(&s, "snapshot", &snap.id, snap.revision, true);
    s.wealth_trash(&del).unwrap();
    s.wealth_trash(&del).unwrap(); // retried request is a no-op
    assert!(s.wealth_summary().unwrap().points.is_empty());
    assert_eq!(
        trash_kinds(&s),
        vec![("snapshot".into(), "2026-09-30".into())]
    );
    assert!(b.cash.latest.is_none() && s.wealth_accounts().unwrap()[0].latest.is_none());

    // The date was reused while deleted, so restoring must not create a second one.
    let other = s
        .wealth_snapshot_save(&check_in(&s, "2026-09-30", full(&b, 2, 2, 2, 2)), TODAY)
        .unwrap();
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "snapshot", &snap.id, 2, false))),
        "SNAPSHOT_DATE_TAKEN"
    );
    s.wealth_trash(&trash(&s, "snapshot", &other.id, 1, true))
        .unwrap();

    // An account period that no longer covers the date also blocks restore.
    edit(&mut s, &b.fund, |f| f.opened_on = "2026-10-01".into()).unwrap();
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "snapshot", &snap.id, 2, false))),
        "SNAPSHOT_ACCOUNT"
    );
    let fund = s
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.id == b.fund.id)
        .unwrap();
    edit(&mut s, &fund, |f| f.opened_on = "2026-01-01".into()).unwrap();
    s.wealth_trash(&trash(&s, "snapshot", &snap.id, 2, false))
        .unwrap();
    let points = s.wealth_summary().unwrap().points;
    assert_eq!(
        (points.len(), points[0].snapshot_id.as_str()),
        (1, snap.id.as_str())
    );
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "snapshot", &snap.id, 2, false))),
        "REVISION_CONFLICT"
    );

    assert_eq!(
        code(s.wealth_trash(&trash(&s, "account", &b.cash.id, 1, true))),
        "ACCOUNT_HAS_HISTORY"
    );
    let spare = open(&mut s, "误建账户", "cash", "2026-01-01");
    s.wealth_trash(&trash(&s, "account", &spare.id, 1, true))
        .unwrap();
    assert_eq!(s.wealth_accounts().unwrap().len(), 4);
    assert!(s
        .wealth_snapshot(&snap.id)
        .unwrap()
        .unwrap()
        .missing
        .is_empty());
    s.wealth_trash(&trash(&s, "account", &spare.id, 2, false))
        .unwrap();
    assert_eq!(s.wealth_accounts().unwrap().len(), 5);
    assert_eq!(
        s.wealth_snapshot(&snap.id).unwrap().unwrap().missing,
        vec![spare.id.clone()],
        "a restored account opened before the date shows as missing, never as zero"
    );

    // Deleted check-ins survive a backup round trip and stay restorable.
    s.wealth_trash(&trash(&s, "snapshot", &snap.id, 3, true))
        .unwrap();
    let file = dir.path().join("备份.possio");
    s.backup(Some(&file)).unwrap();
    drop(s);
    let mut c = Store::open(&dir.path().join("c")).unwrap();
    let summary = c.inspect_backup(&file).unwrap();
    c.restore(&file, &summary.hash, &c.generation()).unwrap();
    assert_eq!(trash_kinds(&c).len(), 2, "both deleted check-ins");
    c.wealth_trash(&trash(&c, "snapshot", &snap.id, 4, false))
        .unwrap();
    assert_eq!(c.wealth_summary().unwrap().points.len(), 1);
}
