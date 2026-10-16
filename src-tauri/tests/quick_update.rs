//! Quick single-account updates and transfers saved as check-ins. All records are fictional.
use thingary_lib::{
    domain::Error,
    storage::Store,
    wealth::{
        Account, AccountFields, AccountSave, EntryInput, QuickChange, QuickUpdate, Snapshot,
        SnapshotSave,
    },
};

const TODAY: &str = "2026-10-17";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T>(r: Result<T, Error>) -> String {
    match r {
        Ok(_) => "OK".into(),
        Err(e) => e.code,
    }
}
fn open(s: &mut Store, name: &str, side: &str, kind: &str, opened: &str) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: name.into(),
                institution: String::new(),
                side: side.into(),
                kind: kind.into(),
                counted: true,
                opened_on: opened.into(),
                closed_on: None,
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
                group_id: None,
            },
        },
        TODAY,
    )
    .unwrap()
}
fn check_in(s: &mut Store, date: &str, rows: &[(&Account, Option<i64>)]) -> Snapshot {
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: date.into(),
            notes: "虚构完整盘点".into(),
            entries: rows
                .iter()
                .map(|(a, v)| EntryInput {
                    account_id: a.id.clone(),
                    state: if v.is_some() { "entered" } else { "missing" }.into(),
                    amount_cents: v.map(|v| v.to_string()),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap()
}
fn quick(
    s: &Store,
    date: &str,
    note: &str,
    changes: &[(&Account, i64, Option<i64>)],
) -> QuickUpdate {
    QuickUpdate {
        request_id: rid(),
        generation: s.generation(),
        date: date.into(),
        note: note.into(),
        changes: changes
            .iter()
            .map(|(a, v, prev)| QuickChange {
                account_id: a.id.clone(),
                amount_cents: v.to_string(),
                expected_previous: prev.map(|p| p.to_string()),
            })
            .collect(),
    }
}
fn row<'a>(s: &'a Snapshot, a: &Account) -> (&'a str, Option<&'a str>) {
    let e = s.entries.iter().find(|e| e.account_id == a.id).unwrap();
    (e.state.as_str(), e.amount_cents.as_deref())
}
/// Cash 1000.00, fund 5000.00, card debt 300.00 on 2026-10-01.
fn book(s: &mut Store) -> (Account, Account, Account) {
    let cash = open(s, "虚构储蓄", "asset", "cash", "2026-01-01");
    let fund = open(s, "虚构基金", "asset", "fund", "2026-01-01");
    let card = open(s, "虚构信用卡", "liability", "credit_card", "2026-01-01");
    check_in(
        s,
        "2026-10-01",
        &[
            (&cash, Some(100000)),
            (&fund, Some(500000)),
            (&card, Some(30000)),
        ],
    );
    (cash, fund, card)
}

#[test]
fn a_new_day_records_one_account_and_carries_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cash, fund, card) = book(&mut s);
    let saved = s
        .wealth_quick_update(
            &quick(&s, "2026-10-10", "", &[(&fund, 520000, None)]),
            TODAY,
        )
        .unwrap();
    assert_eq!(saved.date, "2026-10-10");
    assert!(
        saved.missing.is_empty(),
        "carried rows keep the check-in complete"
    );
    assert_eq!(row(&saved, &fund), ("entered", Some("520000")));
    assert_eq!(row(&saved, &cash), ("unchanged", Some("100000")));
    assert_eq!(row(&saved, &card), ("unchanged", Some("30000")));
    let points = s.wealth_summary().unwrap().points;
    assert_eq!(points.last().unwrap().net_cents, "590000");
    assert_eq!(
        points.last().unwrap().change_cents.as_deref(),
        Some("20000")
    );
}

#[test]
fn an_account_without_any_amount_stays_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cash, _, _) = book(&mut s);
    let fresh = open(&mut s, "虚构新账户", "asset", "cash", "2026-10-05");
    let saved = s
        .wealth_quick_update(&quick(&s, "2026-10-10", "", &[(&cash, 90000, None)]), TODAY)
        .unwrap();
    assert_eq!(row(&saved, &fresh), ("missing", None));
    assert_eq!(saved.missing, vec![fresh.id.clone()]);
}

#[test]
fn the_same_day_changes_only_the_target_and_keeps_recorded_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cash, fund, card) = book(&mut s);
    let first = s
        .wealth_quick_update(
            &quick(&s, "2026-10-10", "虚构加仓", &[(&fund, 520000, None)]),
            TODAY,
        )
        .unwrap();
    // A later correction of the earlier check-in must not rewrite carried rows (A22).
    let earlier = s.wealth_summary().unwrap().points[0].snapshot_id.clone();
    let old = s.wealth_snapshot(&earlier).unwrap().unwrap();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(old.id.clone()),
            expected_revision: Some(old.revision),
            date: old.date.clone(),
            notes: old.notes.clone(),
            entries: [(&cash, 111100), (&fund, 500000), (&card, 30000)]
                .iter()
                .map(|(a, v)| EntryInput {
                    account_id: a.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some(v.to_string()),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap();
    let second = s
        .wealth_quick_update(
            &quick(&s, "2026-10-10", "虚构还款", &[(&card, 0, Some(30000))]),
            TODAY,
        )
        .unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.revision, first.revision + 1);
    assert_eq!(row(&second, &card), ("entered", Some("0")));
    assert_eq!(row(&second, &fund), ("entered", Some("520000")));
    assert_eq!(
        row(&second, &cash),
        ("unchanged", Some("100000")),
        "recorded carry kept"
    );
    assert_eq!(second.notes, "虚构基金：虚构加仓\n虚构信用卡：虚构还款");
}

#[test]
fn transfers_move_money_without_changing_net_worth() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cash, fund, card) = book(&mut s);
    let saved = s
        .wealth_quick_update(
            &quick(
                &s,
                "2026-10-10",
                "虚构申购",
                &[(&cash, 80000, Some(100000)), (&fund, 520000, Some(500000))],
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(
        s.wealth_summary()
            .unwrap()
            .points
            .last()
            .unwrap()
            .change_cents
            .as_deref(),
        Some("0")
    );
    assert!(saved.notes.ends_with("虚构储蓄 → 虚构基金：虚构申购"));
    // Paying a card from savings lowers both and keeps net worth.
    s.wealth_quick_update(
        &quick(
            &s,
            "2026-10-12",
            "",
            &[(&cash, 50000, Some(80000)), (&card, 0, Some(30000))],
        ),
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.wealth_summary()
            .unwrap()
            .points
            .last()
            .unwrap()
            .change_cents
            .as_deref(),
        Some("0")
    );
    // Unbalanced pairs, missing expectations and unknown sources are refused.
    for changes in [
        vec![(&cash, 40000, Some(50000)), (&fund, 520000, Some(520000))],
        vec![(&cash, 40000, None), (&fund, 530000, Some(520000))],
    ] {
        assert_eq!(
            code(s.wealth_quick_update(&quick(&s, "2026-10-12", "", &changes), TODAY)),
            "QUICK_TRANSFER"
        );
    }
    let unknown = open(&mut s, "虚构未盘点", "asset", "cash", "2026-10-11");
    assert_eq!(
        code(s.wealth_quick_update(
            &quick(
                &s,
                "2026-10-12",
                "",
                &[(&unknown, 0, Some(0)), (&cash, 50000, Some(50000))]
            ),
            TODAY
        )),
        "QUICK_STALE"
    );
}

#[test]
fn stale_dates_amounts_and_bad_input_change_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cash, fund, _) = book(&mut s);
    let before = s.wealth_summary().unwrap();
    for (input, expected) in [
        (
            quick(&s, "2026-09-30", "", &[(&cash, 1, None)]),
            "QUICK_DATE",
        ),
        (
            quick(&s, "2026-10-18", "", &[(&cash, 1, None)]),
            "SNAPSHOT_DATE",
        ),
        (
            quick(&s, "2026-10-10", "", &[(&cash, 1, Some(99999))]),
            "QUICK_STALE",
        ),
        (quick(&s, "2026-10-10", "", &[]), "QUICK_CHANGES"),
        (
            quick(
                &s,
                "2026-10-10",
                "",
                &[(&cash, 1, None), (&fund, 1, None), (&cash, 1, None)],
            ),
            "QUICK_CHANGES",
        ),
        (
            quick(&s, "2026-10-10", &"长".repeat(501), &[(&cash, 1, None)]),
            "QUICK_NOTE",
        ),
    ] {
        assert_eq!(code(s.wealth_quick_update(&input, TODAY)), expected);
    }
    let mut negative = quick(&s, "2026-10-10", "", &[(&cash, 0, None)]);
    negative.changes[0].amount_cents = "-1".into();
    assert_eq!(
        code(s.wealth_quick_update(&negative, TODAY)),
        "WEALTH_AMOUNT"
    );
    let mut twice = quick(
        &s,
        "2026-10-10",
        "",
        &[(&cash, 1, Some(100000)), (&cash, 2, Some(100000))],
    );
    twice.changes[1].amount_cents = "200001".into();
    assert_eq!(
        code(s.wealth_quick_update(&twice, TODAY)),
        "SNAPSHOT_ACCOUNT"
    );
    let after = s.wealth_summary().unwrap();
    assert_eq!(after.points.len(), before.points.len());
}

#[test]
fn closed_accounts_are_out_of_range() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cash, _, _) = book(&mut s);
    // Emptying the account by a quick update satisfies the closing rule.
    s.wealth_quick_update(
        &quick(&s, "2026-10-03", "", &[(&cash, 0, Some(100000))]),
        TODAY,
    )
    .unwrap();
    let mut fields = cash.fields.clone();
    fields.closed_on = Some("2026-10-05".into());
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(cash.id.clone()),
            expected_revision: Some(cash.revision),
            fields,
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        code(s.wealth_quick_update(&quick(&s, "2026-10-10", "", &[(&cash, 1, None)]), TODAY)),
        "SNAPSHOT_ACCOUNT"
    );
}

#[test]
fn retries_return_the_first_result_and_interrupted_commits_leave_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (_, fund, _) = book(&mut s);
    let input = quick(&s, "2026-10-10", "虚构", &[(&fund, 520000, Some(500000))]);
    s.set_hook(|p| {
        if p == "wealth_quick_update.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.wealth_quick_update(&input, TODAY)), "INJECTED");
    assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
    assert_eq!(
        s.wealth_request_result(&input.request_id, &s.generation())
            .unwrap(),
        None
    );
    s.set_hook(|_| Ok(()));
    let first = s.wealth_quick_update(&input, TODAY).unwrap();
    // The replay is answered from the receipt even though the balance moved on.
    let again = s.wealth_quick_update(&input, TODAY).unwrap();
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
    let mut altered = input.clone();
    altered.note = "虚构改过".into();
    assert_eq!(
        code(s.wealth_quick_update(&altered, TODAY)),
        "REQUEST_CONFLICT"
    );
    assert_eq!(s.wealth_summary().unwrap().points.len(), 2);
}
