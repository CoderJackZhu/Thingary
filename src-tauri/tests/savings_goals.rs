//! Ordinary goals use fictional facts in temporary libraries only.
use calamine::{Data, Reader, Xlsx};
use std::io::Cursor;
use thingary_lib::{
    domain::Error,
    modules::{FinanceStatus, Modules, RuntimeModules},
    purge::Purge,
    savings_goals::{Fields, Goal, Read, Save, Trash},
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
            planning: false,
            ..Default::default()
        },
        incomes: true,
        movements: true,
        finance_status: FinanceStatus::Ready,
        finance_revision: 1,
    }
}
fn read(s: &Store) -> Read {
    s.savings_goals_read(&s.generation(), Some(2026), TODAY, &modules())
        .unwrap()
}
fn account(s: &mut Store, kind: &str, opened: &str) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: format!("虚构{kind}账户"),
                institution: "虚构机构".into(),
                side: if kind == "loan" { "liability" } else { "asset" }.into(),
                kind: kind.into(),
                counted: !matches!(kind, "property" | "insurance"),
                opened_on: opened.into(),
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
fn change_account(s: &mut Store, a: &Account, fields: AccountFields) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(a.id.clone()),
            expected_revision: Some(a.revision),
            fields,
        },
        TODAY,
    )
    .unwrap()
}
fn snapshot(s: &mut Store, day: &str, entries: &[(&Account, Option<&str>)]) -> Snapshot {
    s.wealth_snapshot_save(
        &SnapshotSave {
            close_accounts: Vec::new(),
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: day.into(),
            notes: "虚构盘点".into(),
            entries: entries
                .iter()
                .map(|(a, amount)| EntryInput {
                    account_id: a.id.clone(),
                    state: if amount.is_some() {
                        "entered"
                    } else {
                        "missing"
                    }
                    .into(),
                    amount_cents: amount.map(str::to_owned),
                    original_minor: None,
                    fx_rate_micro: None,
                    quantity_e8: None,
                    unit_price_e6: None,
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap()
}
fn save_input(s: &Store, accounts: &[&Account]) -> Save {
    Save {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: Fields {
            name: "虚构应急金".into(),
            target_cents: "100000".into(),
            target_date: Some("2027-12-31".into()),
            notes: "虚构目标，不预留资金".into(),
        },
        account_ids: accounts.iter().map(|a| a.id.clone()).collect(),
    }
}
fn goal(s: &mut Store, accounts: &[&Account], day: &str) -> Goal {
    s.savings_goals_save(&save_input(s, accounts), day, true)
        .unwrap()
}
fn edit_input(s: &Store, g: &Goal, accounts: &[&Account]) -> Save {
    Save {
        id: Some(g.id.clone()),
        expected_revision: Some(g.revision),
        fields: g.fields.clone(),
        ..save_input(s, accounts)
    }
}
fn trash_input(s: &Store, g: &Goal, deleted: bool) -> Trash {
    Trash {
        request_id: id(),
        generation: s.generation(),
        id: g.id.clone(),
        expected_revision: g.revision,
        deleted,
    }
}
fn account_trash(s: &mut Store, a: &Account) {
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "account".into(),
        id: a.id.clone(),
        expected_revision: a.revision,
        deleted: true,
    })
    .unwrap();
}
fn purge(s: &Store, kind: Option<&str>, row: &str, preview: Option<String>) -> Purge {
    Purge {
        request_id: id(),
        generation: s.generation(),
        kind: kind.map(str::to_owned),
        id: row.into(),
        preview,
    }
}
fn row_count(s: &Store, table: &str) -> i64 {
    s.conn_for_test()
        .unwrap()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn current_balances_share_one_complete_basis_and_never_mix_newer_partial_amounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let b = account(&mut s, "insurance", "2026-01-01");
    let g = goal(&mut s, &[&a, &b], "2026-01-01");
    let shared = goal(&mut s, &[&a], "2026-01-01");
    let complete = snapshot(
        &mut s,
        "2026-09-30",
        &[(&a, Some("30000")), (&b, Some("40000"))],
    );
    snapshot(&mut s, "2026-10-31", &[(&a, Some("90000")), (&b, None)]);
    let r = read(&s);
    assert_eq!(r.basis.unwrap().snapshot_id, complete.id);
    assert!(r.newer_incomplete);
    let view = r.goals.iter().find(|v| v.goal.id == g.id).unwrap();
    assert!(view.observations.iter().all(|o| o.status == "known"));
    let balance: i64 = view
        .observations
        .iter()
        .map(|o| o.amount_cents.as_ref().unwrap().parse::<i64>().unwrap())
        .sum();
    assert_eq!(balance, 70000);
    assert_eq!(view.shared_account_ids, vec![a.id.clone()]);
    assert_eq!(view.planning_overlap, None);
    let other = r.goals.iter().find(|v| v.goal.id == shared.id).unwrap();
    assert_eq!(other.observations[0].amount_cents.as_deref(), Some("30000"));
    assert_eq!(view.history.len(), 1);
}

#[test]
fn new_account_after_basis_remains_unknown_even_with_a_newer_partial_observation() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let complete = snapshot(&mut s, "2026-09-30", &[(&a, Some("0"))]);
    let b = account(&mut s, "pension", "2026-10-01");
    goal(&mut s, &[&a, &b], "2026-10-01");
    snapshot(&mut s, "2026-10-31", &[(&a, None), (&b, Some("99999"))]);
    let r = read(&s);
    assert_eq!(r.basis.unwrap().snapshot_id, complete.id);
    let observations = &r.goals[0].observations;
    let old = observations.iter().find(|o| o.account_id == a.id).unwrap();
    let new = observations.iter().find(|o| o.account_id == b.id).unwrap();
    assert_eq!(
        (old.status.as_str(), old.amount_cents.as_deref()),
        ("known", Some("0"))
    );
    assert_eq!(
        (new.status.as_str(), new.amount_cents.as_deref()),
        ("missing", None)
    );
    assert!(
        r.goals[0].history.is_empty(),
        "No pre-creation or incomplete points may become goal history"
    );
}

#[test]
fn no_complete_basis_does_not_turn_unknown_into_zero() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    goal(&mut s, &[&a], "2026-01-01");
    snapshot(&mut s, "2026-02-01", &[(&a, None)]);
    let r = read(&s);
    assert!(r.basis.is_none());
    assert_eq!(r.goals[0].observations[0].status, "missing");
    assert!(r.goals[0].observations[0].amount_cents.is_none());
}

#[test]
fn new_relations_reject_property_liability_closed_deleted_and_duplicate_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let property = account(&mut s, "property", "2026-01-01");
    let loan = account(&mut s, "loan", "2026-01-01");
    let closed = account(&mut s, "cash", "2026-01-01");
    let mut f = closed.fields.clone();
    f.closed_on = Some("2026-02-01".into());
    let closed = change_account(&mut s, &closed, f);
    let deleted = account(&mut s, "cash", "2026-01-01");
    account_trash(&mut s, &deleted);
    for a in [&property, &loan, &closed, &deleted] {
        let input = save_input(&s, &[a]);
        assert_eq!(
            s.savings_goals_save(&input, TODAY, true).unwrap_err().code,
            "GOAL_ACCOUNTS"
        );
        assert!(s
            .wealth_request_result(&input.request_id, &s.generation())
            .unwrap()
            .is_none());
    }
    let eligible = account(&mut s, "insurance", "2026-01-01");
    assert_eq!(
        s.savings_goals_save(&save_input(&s, &[&eligible, &eligible]), TODAY, true)
            .unwrap_err()
            .code,
        "GOAL_ACCOUNTS"
    );
    assert_eq!(
        s.savings_goals_save(&save_input(&s, &[]), TODAY, true)
            .unwrap_err()
            .code,
        "GOAL_ACCOUNTS"
    );
    assert_eq!(row_count(&s, "savings_goals"), 0);
    assert_eq!(
        goal(&mut s, &[&eligible], TODAY).account_ids,
        vec![eligible.id]
    );
}

#[test]
fn current_type_changes_do_not_rewrite_history_and_old_property_is_never_cash() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let g = goal(&mut s, &[&a], "2026-01-01");
    snapshot(&mut s, "2026-02-01", &[(&a, Some("30000"))]);
    let mut f = a.fields.clone();
    f.kind = "property".into();
    f.counted = false;
    let property = change_account(&mut s, &a, f);
    let r = read(&s);
    assert_eq!(r.goals[0].observations[0].status, "unavailable");
    assert_eq!(r.goals[0].history[0].observations[0].status, "known");
    assert_eq!(r.goals[0].history[0].observations[0].kind, "cash");
    // Existing invalid references may survive an unrelated goal edit.
    let mut edit = edit_input(&s, &g, &[&property]);
    edit.fields.name = "虚构更正目标".into();
    s.savings_goals_save(&edit, TODAY, true).unwrap();
    snapshot(&mut s, "2026-03-01", &[(&property, Some("20000000"))]);
    let mut f = property.fields.clone();
    f.kind = "cash".into();
    f.counted = true;
    let cash = change_account(&mut s, &property, f);
    let r = read(&s);
    assert_eq!(
        r.goals[0].observations[0].status, "unavailable",
        "The basis still records property, despite the current cash label"
    );
    assert_eq!(r.goals[0].history[1].observations[0].status, "unavailable");
    snapshot(&mut s, "2026-04-01", &[(&cash, Some("50000"))]);
    let r = read(&s);
    assert_eq!(
        r.goals[0].observations[0].amount_cents.as_deref(),
        Some("50000")
    );
    assert_eq!(
        r.goals[0].history[0].observations[0]
            .amount_cents
            .as_deref(),
        Some("30000")
    );
}

#[test]
fn closed_existing_relation_is_unavailable_now_but_its_old_zero_is_a_fact() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let g = goal(&mut s, &[&a], "2026-01-01");
    snapshot(&mut s, "2026-02-01", &[(&a, Some("0"))]);
    let mut f = a.fields.clone();
    f.closed_on = Some("2026-02-02".into());
    let a = change_account(&mut s, &a, f);
    s.savings_goals_save(&edit_input(&s, &g, &[&a]), TODAY, true)
        .unwrap();
    let r = read(&s);
    assert_eq!(r.goals[0].observations[0].status, "unavailable");
    assert_eq!(
        r.goals[0].history[0].observations[0]
            .amount_cents
            .as_deref(),
        Some("0")
    );
}

#[test]
fn changing_relations_replaces_the_set_and_requests_are_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let b = account(&mut s, "pension", "2026-01-01");
    let input = save_input(&s, &[&a]);
    let g = s.savings_goals_save(&input, "2026-01-01", true).unwrap();
    assert_eq!(s.savings_goals_save(&input, TODAY, true).unwrap().id, g.id);
    assert_eq!(row_count(&s, "savings_goals"), 1);
    let mut conflict = input.clone();
    conflict.account_ids = vec![b.id.clone()];
    assert_eq!(
        s.savings_goals_save(&conflict, TODAY, true)
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
    let edit = edit_input(&s, &g, &[&b]);
    let changed = s.savings_goals_save(&edit, TODAY, true).unwrap();
    assert_eq!(changed.revision, 2);
    assert_eq!(changed.created_on, "2026-01-01");
    assert_eq!(changed.account_ids, vec![b.id.clone()]);
    assert_eq!(row_count(&s, "savings_goal_accounts"), 1);
    assert_eq!(
        s.savings_goals_save(&edit, TODAY, true).unwrap().revision,
        2
    );
    let mut stale = edit.clone();
    stale.request_id = id();
    assert_eq!(
        s.savings_goals_save(&stale, TODAY, true).unwrap_err().code,
        "REVISION_CONFLICT"
    );
}

#[test]
fn save_faults_are_atomic_and_committed_receipt_survives_restart_and_module_close() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let mut s = Store::open(&root).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let input = save_input(&s, &[&a]);
    s.set_hook(|p| {
        if p == "savings_goals.before_commit" {
            Err(Error::new("INJECTED", "虚构提交前故障"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.savings_goals_save(&input, TODAY, true).unwrap_err().code,
        "INJECTED"
    );
    assert_eq!(row_count(&s, "savings_goals"), 0);
    assert_eq!(row_count(&s, "savings_goal_accounts"), 0);
    assert!(s
        .wealth_request_result(&input.request_id, &input.generation)
        .unwrap()
        .is_none());
    s.set_hook(|p| {
        if p == "savings_goals.after_commit" {
            Err(Error::new("INJECTED", "虚构回复丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.savings_goals_save(&input, TODAY, true).unwrap_err().code,
        "INJECTED"
    );
    let result_id = s
        .wealth_request_result(&input.request_id, &input.generation)
        .unwrap()
        .unwrap();
    assert_eq!(row_count(&s, "savings_goals"), 1);
    drop(s);
    let mut s = Store::open(&root).unwrap();
    let mut off = modules();
    off.modules.wealth = false;
    assert_eq!(
        s.savings_goals_read(&s.generation(), None, TODAY, &off)
            .unwrap_err()
            .code,
        "MODULE_DISABLED"
    );
    assert_eq!(
        s.savings_goals_save(&input, TODAY, false).unwrap_err().code,
        "MODULE_DISABLED"
    );
    assert_eq!(
        s.wealth_request_result(&input.request_id, &input.generation)
            .unwrap(),
        Some(result_id.clone())
    );
    assert_eq!(
        s.savings_goals_save(&input, TODAY, true).unwrap().id,
        result_id
    );
    assert_eq!(row_count(&s, "savings_goals"), 1);
    let mut stale = input.clone();
    stale.request_id = id();
    stale.generation = id();
    assert_eq!(
        s.savings_goals_save(&stale, TODAY, true).unwrap_err().code,
        "STALE_DATASET"
    );
}

#[test]
fn trash_faults_restore_the_same_id_and_soft_deleted_targets_still_protect_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let g = goal(&mut s, &[&a], "2026-01-01");
    account_trash(&mut s, &a);
    assert_eq!(
        s.purge_trash(&purge(&s, Some("account"), &a.id, None))
            .unwrap_err()
            .code,
        "PLANNING_DEPENDENCY"
    );
    let trash = trash_input(&s, &g, true);
    assert_eq!(
        s.savings_goals_trash(&trash, false).unwrap_err().code,
        "MODULE_DISABLED"
    );
    s.set_hook(|p| {
        if p == "savings_goals.before_commit" {
            Err(Error::new("INJECTED", "虚构删除前故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.savings_goals_trash(&trash, true).is_err());
    assert_eq!(read(&s).goals[0].goal.revision, 1);
    assert!(s
        .wealth_request_result(&trash.request_id, &trash.generation)
        .unwrap()
        .is_none());
    s.set_hook(|p| {
        if p == "savings_goals.after_commit" {
            Err(Error::new("INJECTED", "虚构删除回复丢失"))
        } else {
            Ok(())
        }
    });
    assert!(s.savings_goals_trash(&trash, true).is_err());
    assert!(read(&s).goals.is_empty());
    assert_eq!(
        s.wealth_request_result(&trash.request_id, &trash.generation)
            .unwrap(),
        Some(g.id.clone())
    );
    s.set_hook(|_| Ok(()));
    s.savings_goals_trash(&trash, true).unwrap();
    assert_eq!(
        s.purge_trash(&purge(&s, Some("account"), &a.id, None))
            .unwrap_err()
            .code,
        "PLANNING_DEPENDENCY"
    );
    s.savings_goals_trash(
        &Trash {
            request_id: id(),
            expected_revision: 2,
            deleted: false,
            ..trash.clone()
        },
        true,
    )
    .unwrap();
    let restored = read(&s);
    assert_eq!(restored.goals[0].goal.id, g.id);
    assert_eq!(restored.goals[0].goal.account_ids, vec![a.id.clone()]);
    assert_eq!(restored.goals[0].observations[0].status, "unavailable");
    s.savings_goals_trash(
        &Trash {
            request_id: id(),
            expected_revision: 3,
            ..trash
        },
        true,
    )
    .unwrap();
    s.purge_trash(&purge(&s, Some("savings_goal"), &g.id, None))
        .unwrap();
    assert_eq!(row_count(&s, "savings_goal_accounts"), 0);
    s.purge_trash(&purge(&s, Some("account"), &a.id, None))
        .unwrap();
    assert_eq!(row_count(&s, "fin_accounts"), 0);
}

#[test]
fn clear_preview_expires_when_relations_change_then_deletes_goals_before_accounts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", "2026-01-01");
    let b = account(&mut s, "cash", "2026-01-01");
    let c = account(&mut s, "cash", "2026-01-01");
    let deleted = goal(&mut s, &[&a], "2026-01-01");
    let active = goal(&mut s, &[&b], "2026-01-01");
    account_trash(&mut s, &a);
    s.savings_goals_trash(&trash_input(&s, &deleted, true), true)
        .unwrap();
    let preview = s.purge_all_preview().unwrap();
    s.savings_goals_save(&edit_input(&s, &active, &[&b, &c]), TODAY, true)
        .unwrap();
    assert_eq!(
        s.purge_trash(&purge(&s, None, "", Some(preview.preview)))
            .unwrap_err()
            .code,
        "PREVIEW_STALE"
    );
    assert_eq!(row_count(&s, "savings_goals"), 2);
    assert_eq!(row_count(&s, "fin_accounts"), 3);
    let preview = s.purge_all_preview().unwrap();
    let cleared = s
        .purge_trash(&purge(&s, None, "", Some(preview.preview)))
        .unwrap();
    assert_eq!(cleared.removed, 2);
    assert_eq!(cleared.kept, 0);
    assert_eq!(row_count(&s, "savings_goals"), 1);
    assert_eq!(row_count(&s, "fin_accounts"), 2);
    assert_eq!(row_count(&s, "savings_goal_accounts"), 2);
    assert_eq!(read(&s).goals[0].goal.id, active.id);
}

#[test]
fn complete_backup_and_read_only_excel_preserve_goals_relations_and_deleted_state() {
    let dir = tempfile::tempdir().unwrap();
    let source_root = dir.path().join("source");
    let mut s = Store::open(&source_root).unwrap();
    thingary_lib::modules::initialize_runtime(&source_root);
    let a = account(&mut s, "pension", "2026-01-01");
    let b = account(&mut s, "insurance", "2026-01-01");
    let mut input = save_input(&s, &[&a, &b]);
    input.fields.name = "=SUM(1,2)".into();
    let active = s.savings_goals_save(&input, "2026-01-01", true).unwrap();
    let deleted = goal(&mut s, &[&b], "2026-01-01");
    s.savings_goals_trash(&trash_input(&s, &deleted, true), true)
        .unwrap();
    snapshot(
        &mut s,
        "2026-09-30",
        &[(&a, Some("30000")), (&b, Some("40000"))],
    );
    let expected = serde_json::to_value(read(&s).goals).unwrap();
    let archive = dir.path().join("fictional.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&dir.path().join("restored")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        serde_json::to_value(read(&restored).goals).unwrap(),
        expected
    );
    assert_eq!(row_count(&restored, "savings_goals"), 2);
    assert_eq!(row_count(&restored, "savings_goal_accounts"), 3);
    restored
        .savings_goals_trash(
            &Trash {
                request_id: id(),
                generation: restored.generation(),
                id: deleted.id.clone(),
                expected_revision: 2,
                deleted: false,
            },
            true,
        )
        .unwrap();
    assert_eq!(read(&restored).goals.len(), 2);
    assert_eq!(
        restored
            .wealth_request_result(&input.request_id, &restored.generation())
            .unwrap(),
        Some(active.id.clone())
    );
    let workbook = dir.path().join("fictional.xlsx");
    s.export_workbook(&workbook).unwrap();
    let bytes = std::fs::read(workbook).unwrap();
    let mut book = Xlsx::new(Cursor::new(&bytes)).unwrap();
    for name in ["存钱目标", "目标关联账户"] {
        assert!(book.worksheet_formula(name).unwrap().is_empty());
    }
    let goals = book.worksheet_range("存钱目标").unwrap();
    assert_eq!(goals.height(), 2);
    let goal_headers = goals.rows().next().unwrap();
    let goal_col = |name: &str| {
        goal_headers
            .iter()
            .position(|v| matches!(v, Data::String(value) if value == name))
            .unwrap()
    };
    let exported = goals
        .rows()
        .skip(1)
        .find(|row| row[goal_col("目标编号")] == Data::String(active.id.clone()))
        .unwrap();
    assert_eq!(exported[goal_col("名称")], Data::String("=SUM(1,2)".into()));
    assert_eq!(
        exported[goal_col("目标金额（元）")],
        Data::String("1000.00".into())
    );
    assert!(!goals
        .rows()
        .skip(1)
        .any(|row| row[goal_col("目标编号")] == Data::String(deleted.id.clone())));
    let links = book.worksheet_range("目标关联账户").unwrap();
    assert_eq!(links.height(), 3);
    let link_headers = links.rows().next().unwrap();
    let link_col = |name: &str| {
        link_headers
            .iter()
            .position(|v| matches!(v, Data::String(value) if value == name))
            .unwrap()
    };
    assert!(links
        .rows()
        .skip(1)
        .all(|row| row[link_col("目标编号")] == Data::String(active.id.clone())));
    assert!(links
        .rows()
        .skip(1)
        .any(|row| row[link_col("账户编号")] == Data::String(b.id.clone())));
    let imported = thingary_lib::spreadsheet::read_finance(&bytes).unwrap();
    assert!(imported
        .iter()
        .all(|file| !file.name.contains("存钱目标") && !file.name.contains("目标关联账户")));
}
