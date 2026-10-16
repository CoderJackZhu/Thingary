//! Fictional Store acceptance: endpoint facts, conflict/receipt lifecycle and transport.
use thingary_lib::{
    domain::Error,
    investment_review::{Fields, Save, Trash},
    storage::Store,
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave, TrashChange},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn account(s: &mut Store, name: &str, kind: &str, counted: bool) -> Account {
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
                counted,
                opened_on: if counted { "2026-01-01" } else { "2026-11-01" }.into(),
                closed_on: None,
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
            },
        },
        TODAY,
    )
    .unwrap()
}
fn snapshot(s: &mut Store, date: &str, rows: &[(&Account, Option<&str>)]) -> String {
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: date.into(),
            notes: String::new(),
            entries: rows
                .iter()
                .map(|(a, n)| EntryInput {
                    account_id: a.id.clone(),
                    state: if n.is_some() { "entered" } else { "missing" }.into(),
                    amount_cents: n.map(str::to_owned),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap()
    .id
}
fn setup() -> (tempfile::TempDir, Store, Account, String, String) {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    thingary_lib::modules::initialize_runtime(&root);
    let mut s = Store::open(&root).unwrap();
    let a = account(&mut s, "虚构基金", "fund", true);
    let from = snapshot(&mut s, "2026-09-30", &[(&a, Some("10000000"))]);
    let to = snapshot(&mut s, "2026-10-31", &[(&a, Some("11200000"))]);
    (tmp, s, a, from, to)
}
fn input(s: &Store, from: &str, to: &str) -> Save {
    let v = s.investment_review_read(&s.generation(), from, to).unwrap();
    Save {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        from_snapshot_id: from.into(),
        to_snapshot_id: to.into(),
        from_value_key: v.from_value_key,
        to_value_key: v.to_value_key,
        fields: Fields {
            inflow_cents: Some("1000000".into()),
            outflow_cents: Some("0".into()),
            confirmed_complete: true,
            unsupported_movements: false,
            notes: "虚构核对".into(),
        },
    }
}
fn edit_snapshot(s: &mut Store, id: &str, amount: &str, notes: &str) {
    let snap = s.wealth_snapshot(id).unwrap().unwrap();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(id.into()),
            expected_revision: Some(snap.revision),
            date: snap.date,
            notes: notes.into(),
            entries: snap
                .entries
                .iter()
                .map(|e| EntryInput {
                    account_id: e.account_id.clone(),
                    state: "entered".into(),
                    amount_cents: Some(amount.into()),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap();
}
fn err<T: std::fmt::Debug>(v: Result<T, Error>) -> String {
    v.unwrap_err().code
}
#[test]
fn real_endpoints_review_save_edit_and_receipt_are_exact() {
    let (_tmp, mut s, _a, from, to) = setup();
    let before = s
        .investment_review_read(&s.generation(), &from, &to)
        .unwrap();
    assert_eq!(before.result["status"], "not_recorded");
    let i = input(&s, &from, &to);
    let f = s.investment_review_save(&i).unwrap();
    assert_eq!(s.investment_review_save(&i).unwrap(), f);
    assert_eq!(
        s.investment_review_list(&s.generation())
            .unwrap()
            .records
            .len(),
        1
    );
    assert_eq!(
        s.wealth_request_result(&i.request_id, &s.generation())
            .unwrap(),
        Some(f["id"].as_str().unwrap().into())
    );
    let v = s
        .investment_review_read(&s.generation(), &from, &to)
        .unwrap();
    assert_eq!(v.result["value"]["profit_cents"], "200000");
    let mut altered = i.clone();
    altered.fields.notes = "different".into();
    assert_eq!(err(s.investment_review_save(&altered)), "REQUEST_CONFLICT");
    let mut edit = input(&s, &from, &to);
    edit.id = Some(f["id"].as_str().unwrap().into());
    edit.expected_revision = Some(1);
    edit.fields.inflow_cents = None;
    edit.fields.confirmed_complete = false;
    let changed = s.investment_review_save(&edit).unwrap();
    assert_eq!(changed["revision"], 2);
    let v = s
        .investment_review_read(&s.generation(), &from, &to)
        .unwrap();
    assert_eq!(v.result["status"], "needs_review");
    assert_eq!(v.result["change_cents"], "1200000");
    edit.request_id = rid();
    assert_eq!(err(s.investment_review_save(&edit)), "REVISION_CONFLICT");
}
#[test]
fn notes_do_not_invalidate_but_balance_edits_require_explicit_reconfirmation() {
    let (_tmp, mut s, _a, from, to) = setup();
    let i = input(&s, &from, &to);
    let f = s.investment_review_save(&i).unwrap();
    edit_snapshot(&mut s, &to, "11200000", "备注更正");
    assert_eq!(
        s.investment_review_read(&s.generation(), &from, &to)
            .unwrap()
            .result["status"],
        "ready"
    );
    let mut edit = input(&s, &from, &to);
    edit.id = Some(f["id"].as_str().unwrap().into());
    edit.expected_revision = Some(1);
    edit_snapshot(&mut s, &to, "11300000", "金额更正");
    assert_eq!(err(s.investment_review_save(&edit)), "STALE_ENDPOINTS");
    let v = s
        .investment_review_read(&s.generation(), &from, &to)
        .unwrap();
    assert!(v.result["reasons"]
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("stale_endpoints")));
    edit.from_value_key = v.from_value_key;
    edit.to_value_key = v.to_value_key;
    edit.request_id = rid();
    s.investment_review_save(&edit).unwrap();
    assert_eq!(
        s.investment_review_read(&s.generation(), &from, &to)
            .unwrap()
            .result["value"]["profit_cents"],
        "300000"
    );
}
#[test]
fn overlapping_intervals_require_explicit_delete_and_restore_rechecks_conflict() {
    let (_tmp, mut s, a, from, to) = setup();
    let mid = snapshot(&mut s, "2026-10-15", &[(&a, Some("10500000"))]);
    let f = s.investment_review_save(&input(&s, &from, &to)).unwrap();
    let sub = input(&s, &from, &mid);
    assert_eq!(err(s.investment_review_save(&sub)), "OVERLAPPING_FLOW");
    let mut trash = Trash {
        request_id: rid(),
        generation: s.generation(),
        id: f["id"].as_str().unwrap().into(),
        expected_revision: 1,
        deleted: true,
    };
    s.investment_review_trash(&trash).unwrap();
    s.investment_review_trash(&trash).unwrap();
    s.investment_review_save(&sub).unwrap();
    trash.request_id = rid();
    trash.expected_revision = 2;
    trash.deleted = false;
    assert_eq!(err(s.investment_review_trash(&trash)), "OVERLAPPING_FLOW");
    let mut adjacent = input(&s, &mid, &to);
    adjacent.fields.inflow_cents = Some("500000".into());
    s.investment_review_save(&adjacent).unwrap();
    assert_eq!(
        s.investment_review_list(&s.generation())
            .unwrap()
            .records
            .len(),
        3
    );
}
#[test]
fn deleted_or_incomplete_endpoints_never_become_zero_and_records_survive() {
    let (_tmp, mut s, a, from, to) = setup();
    s.investment_review_save(&input(&s, &from, &to)).unwrap();
    let incomplete = snapshot(&mut s, "2026-11-30", &[(&a, None)]);
    assert_eq!(
        err(s.investment_review_read(&s.generation(), &to, &incomplete)),
        "ENDPOINT_INCOMPLETE"
    );
    let snap = s.wealth_snapshot(&to).unwrap().unwrap();
    s.wealth_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "snapshot".into(),
        id: to.clone(),
        expected_revision: snap.revision,
        deleted: true,
    })
    .unwrap();
    assert_eq!(
        err(s.investment_review_read(&s.generation(), &from, &to)),
        "ENDPOINT_MISSING"
    );
    assert_eq!(
        s.investment_review_list(&s.generation())
            .unwrap()
            .records
            .len(),
        1
    );
}
#[test]
fn uncounted_members_do_not_change_scope_and_counted_changes_are_not_comparable() {
    let (_tmp, mut s, a, from, to) = setup();
    let ignored = account(&mut s, "未计入虚构投资", "investment", false);
    let later = snapshot(
        &mut s,
        "2026-11-30",
        &[(&a, Some("11200000")), (&ignored, Some("50000"))],
    );
    let v = s
        .investment_review_read(&s.generation(), &to, &later)
        .unwrap();
    assert_eq!(v.input["to"]["members"].as_array().unwrap().len(), 1);
    assert_eq!(v.result["status"], "not_recorded");
    let mut changed = ignored.fields.clone();
    changed.counted = true;
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(ignored.id.clone()),
            expected_revision: Some(ignored.revision),
            fields: changed,
        },
        TODAY,
    )
    .unwrap();
    let last = snapshot(
        &mut s,
        "2026-12-31",
        &[(&a, Some("11200000")), (&ignored, Some("50000"))],
    );
    let v = s
        .investment_review_read(&s.generation(), &from, &last)
        .unwrap();
    assert_eq!(v.result["status"], "not_comparable");
}
#[test]
fn invalid_inputs_disabled_module_and_backup_roundtrip() {
    let (tmp, mut s, _a, from, to) = setup();
    let mut i = input(&s, &from, &to);
    i.fields.inflow_cents = None;
    assert_eq!(err(s.investment_review_save(&i)), "INVESTMENT_INVALID");
    assert_eq!(
        s.investment_review_list(&s.generation())
            .unwrap()
            .records
            .len(),
        0
    );
    i.fields.inflow_cents = Some("0".into());
    i.fields.unsupported_movements = true;
    assert_eq!(err(s.investment_review_save(&i)), "INVESTMENT_INVALID");
    i.fields.confirmed_complete = false;
    s.investment_review_save(&i).unwrap();
    let rows = s.investment_review_list(&s.generation()).unwrap();
    let archive = tmp.path().join("full.thingary");
    s.backup(Some(&archive)).unwrap();
    let restored_root = tempfile::tempdir().unwrap();
    let mut restored = Store::open(&restored_root.path().join("library")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored
            .investment_review_list(&restored.generation())
            .unwrap()
            .records[0]
            .flow,
        rows.records[0].flow
    );
    let export = tmp.path().join("csv");
    s.export_all_csv(&export).unwrap();
    let csv = std::fs::read_to_string(export.join("投资区间核对.csv")).unwrap();
    assert!(csv.contains("原期初内容键"));
    assert!(csv.contains(&from));
    assert!(csv.contains("转入（分）"));
    thingary_lib::modules::write(
        &tmp.path().join("library"),
        &thingary_lib::modules::Modules {
            wealth: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        err(s.investment_review_list(&s.generation())),
        "MODULE_DISABLED"
    );
    assert_eq!(s.investment_review_save(&i).unwrap()["revision"], 1);
    i.request_id = rid();
    assert_eq!(err(s.investment_review_save(&i)), "MODULE_DISABLED");
    assert_eq!(
        err(s.investment_review_read(&s.generation(), &from, &to)),
        "MODULE_DISABLED"
    );
}
#[cfg(feature = "fault-injection")]
#[test]
fn before_commit_rolls_back_and_after_commit_reconciles_one_write() {
    let (_tmp, mut s, _a, from, to) = setup();
    let i = input(&s, &from, &to);
    s.set_hook(|p| {
        if p == "investment_review.before_commit" {
            Err(Error::new("FAULT", "虚构故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.investment_review_save(&i).is_err());
    s.set_hook(|_| Ok(()));
    assert!(s
        .wealth_request_result(&i.request_id, &s.generation())
        .unwrap()
        .is_none());
    s.set_hook(|p| {
        if p == "investment_review.after_commit" {
            Err(Error::new("FAULT", "虚构失联"))
        } else {
            Ok(())
        }
    });
    assert!(s.investment_review_save(&i).is_err());
    s.set_hook(|_| Ok(()));
    let f = s.investment_review_save(&i).unwrap();
    assert_eq!(f["revision"], 1);
    assert_eq!(
        s.investment_review_list(&s.generation())
            .unwrap()
            .records
            .len(),
        1
    );
}

#[test]
fn historic_account_type_change_is_not_silently_treated_as_profit() {
    let (_tmp, mut s, a, from, to) = setup();
    let mut fields = a.fields.clone();
    fields.kind = "bond".into();
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
    .unwrap();
    let last = snapshot(&mut s, "2026-12-31", &[(&a, Some("11500000"))]);
    let view = s
        .investment_review_read(&s.generation(), &to, &last)
        .unwrap();
    assert_eq!(view.input["from"]["members"][0]["kind"], "fund");
    assert_eq!(view.input["to"]["members"][0]["kind"], "bond");
    assert_eq!(view.result["status"], "not_comparable");
    assert_eq!(
        s.investment_review_read(&s.generation(), &from, &to)
            .unwrap()
            .result["status"],
        "not_recorded"
    );
}

#[test]
fn legacy_manual_save_and_read_skip_disabled_movement_table_and_replay_after_wealth_off() {
    let (tmp, mut s, _a, from, to) = setup();
    thingary_lib::modules::write_runtime(
        &tmp.path().join("library"),
        thingary_lib::modules::Modules {
            planning: false,
            ..Default::default()
        },
        thingary_lib::modules::FinanceUpdate {
            movements: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    s.conn_for_test()
        .unwrap()
        .execute_batch("DROP TABLE cash_movements;")
        .unwrap();
    let request = input(&s, &from, &to);
    let saved = s.investment_review_save(&request).unwrap();
    assert_eq!(
        s.investment_review_read(&s.generation(), &from, &to)
            .unwrap()
            .result["value"]["profit_cents"],
        "200000"
    );
    thingary_lib::modules::write(
        &tmp.path().join("library"),
        &thingary_lib::modules::Modules {
            wealth: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(s.investment_review_save(&request).unwrap(), saved);
    let mut fresh = request;
    fresh.request_id = rid();
    assert_eq!(
        s.investment_review_save(&fresh).unwrap_err().code,
        "MODULE_DISABLED"
    );
}

#[test]
fn disabled_movements_do_not_hide_endpoint_balance_and_scope_changes() {
    let (tmp, mut s, a, from, to) = setup();
    let request = input(&s, &from, &to);
    s.investment_review_save(&request).unwrap();
    thingary_lib::modules::write_runtime(
        &tmp.path().join("library"),
        Default::default(),
        thingary_lib::modules::FinanceUpdate {
            movements: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    edit_snapshot(&mut s, &to, "11300000", "虚构金额更正");
    let view = s
        .investment_review_read(&s.generation(), &from, &to)
        .unwrap();
    assert_eq!(view.result["status"], "needs_review");
    assert!(view.result["value"].is_null());
    let pair = thingary_lib::planning_flow_review::Pair {
        from_snapshot_id: from.clone(),
        to_snapshot_id: to.clone(),
    };
    assert_eq!(
        s.followup_review_read(&pair, &s.generation()).unwrap()["preview"]["confirmation"],
        "needs_review"
    );
    let mut added = account(&mut s, "虚构新增范围", "fund", true);
    let mut fields = added.fields.clone();
    fields.opened_on = "2026-10-01".into();
    added = s
        .wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: s.generation(),
                id: Some(added.id),
                expected_revision: Some(added.revision),
                fields,
            },
            TODAY,
        )
        .unwrap();
    let snap = s.wealth_snapshot(&to).unwrap().unwrap();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(to.clone()),
            expected_revision: Some(snap.revision),
            date: snap.date,
            notes: String::new(),
            entries: vec![
                EntryInput {
                    account_id: a.id,
                    state: "entered".into(),
                    amount_cents: Some("11300000".into()),
                },
                EntryInput {
                    account_id: added.id,
                    state: "entered".into(),
                    amount_cents: Some("100".into()),
                },
            ],
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.investment_review_read(&s.generation(), &from, &to)
            .unwrap()
            .result["status"],
        "not_comparable"
    );
    assert_eq!(
        s.followup_review_read(&pair, &s.generation()).unwrap()["preview"]["confirmation"],
        "needs_review"
    );
}
