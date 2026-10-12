//! C2 business acceptance, always fictional isolated Store roots.
use serde_json::{json, Value};
use thingary_lib::{
    cash_movement::{Endpoint, Fields, Query, Save, Source, SourceQuery, Trash},
    domain::Error,
    planning_flow_review::{Draft, Pair, Save as ReviewSave, Selection},
    storage::Store,
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave, TrashChange},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
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
fn snapshot(s: &mut Store, date: &str, accounts: &[(&Account, &str)]) -> String {
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: date.into(),
            notes: String::new(),
            entries: accounts
                .iter()
                .map(|(a, n)| EntryInput {
                    account_id: a.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some((*n).into()),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap()
    .id
}
fn setup(close: &str) -> (tempfile::TempDir, Store, Account, Account, Pair) {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(&d.path().join("library")).unwrap();
    let inv = account(&mut s, "虚构投资", "fund");
    let cash = account(&mut s, "虚构现金", "cash");
    let from = snapshot(
        &mut s,
        "2026-09-30",
        &[(&inv, "10000000"), (&cash, "5000000")],
    );
    let to = snapshot(&mut s, "2026-10-31", &[(&inv, close), (&cash, "5000000")]);
    (
        d,
        s,
        inv,
        cash,
        Pair {
            from_snapshot_id: from,
            to_snapshot_id: to,
        },
    )
}
fn ep(a: &Account) -> Endpoint {
    Endpoint::Account {
        account_id: a.id.clone(),
    }
}
fn external() -> Endpoint {
    Endpoint::External {
        label: "虚构范围外对象".into(),
    }
}
fn fields(from: Endpoint, to: Endpoint, amount: &str, purpose: &str) -> Fields {
    Fields {
        date: "2026-10-15".into(),
        amount_cents: amount.into(),
        from,
        to,
        purpose: purpose.into(),
        source: None,
        notes: "虚构已结算".into(),
    }
}
fn movement(s: &mut Store, f: Fields) -> thingary_lib::cash_movement::Saved {
    s.movement_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: f,
        },
        TODAY,
    )
    .unwrap()
}
fn draft(confirmed: bool) -> Draft {
    Draft {
        selection: Selection::Movements,
        confirmed_complete: confirmed,
        unsupported_movements: false,
        notes: String::new(),
    }
}
fn preview(s: &Store, p: &Pair, d: &Draft) -> Value {
    s.followup_review_preview(p, d, &s.generation()).unwrap()
}
fn review_input(s: &Store, p: &Pair, d: &Draft) -> ReviewSave {
    let v = preview(s, p, d);
    ReviewSave {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: v["revision"].as_i64(),
        pair: p.clone(),
        draft: d.clone(),
        basis_key: v["basis_key"].as_str().unwrap().into(),
    }
}
fn confirm(s: &mut Store, p: &Pair) -> thingary_lib::cash_movement::Saved {
    s.followup_review_save(&review_input(s, p, &draft(true)))
        .unwrap()
}
fn profit(s: &Store, p: &Pair) -> Value {
    s.followup_review_read(p, &s.generation()).unwrap()["preview"]["result"].clone()
}
fn list(s: &Store, deleted: &str) -> Value {
    s.movement_list(
        &Query {
            from_date: None,
            to_date: None,
            account_id: None,
            deleted: deleted.into(),
            cursor: None,
        },
        &s.generation(),
    )
    .unwrap()
}
fn trash(s: &mut Store, id: &str, revision: i64, deleted: bool) {
    s.movement_trash(&Trash {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: Some(revision),
        id: id.into(),
        deleted,
    })
    .unwrap();
}
#[test]
fn f01_transfer_out_explains_gain_without_creating_consumption_or_changing_snapshots() {
    let (_d, mut s, inv, cash, p) = setup("9700000");
    let before = serde_json::to_value(s.wealth_snapshot(&p.to_snapshot_id).unwrap()).unwrap();
    movement(
        &mut s,
        fields(ep(&inv), ep(&cash), "800000", "own_transfer"),
    );
    confirm(&mut s, &p);
    let r = profit(&s, &p);
    assert_eq!(r["status"], "ready");
    assert_eq!(r["value"]["change_cents"], "-300000");
    assert_eq!(r["value"]["profit_cents"], "500000");
    assert_eq!(r["value"]["outflow_cents"], "800000");
    assert_eq!(
        serde_json::to_value(s.wealth_snapshot(&p.to_snapshot_id).unwrap()).unwrap(),
        before
    );
    assert!(s.plan_income_list().unwrap().rows.is_empty());
    assert!(s.expense_view(None).unwrap().lines.is_empty());
    assert_eq!(list(&s, "active")["records"].as_array().unwrap().len(), 1);
}
fn expense(s: &mut Store, amount: &str) -> thingary_lib::expenses::Expense {
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::expenses::Fields {
                title: "虚构生活支付".into(),
                date: "2026-10-15".into(),
                amount_cents: amount.into(),
                category: "other".into(),
                notes: String::new(),
                refund_cents: None,
                refund_date: None,
                asset_id: None,
            },
        },
        TODAY,
    )
    .unwrap()
}
fn source(s: &Store, kind: &str) -> Source {
    let opts = s
        .movement_sources(
            &SourceQuery {
                kind: kind.into(),
                text: String::new(),
                cursor: None,
                movement_id: None,
            },
            &s.generation(),
        )
        .unwrap();
    serde_json::from_value(opts["options"][0]["ref"].clone()).unwrap()
}
#[test]
fn f02_direct_living_payment_links_one_expense_and_is_one_outflow() {
    let (_d, mut s, inv, _cash, p) = setup("9700000");
    expense(&mut s, "800000");
    let mut f = fields(ep(&inv), external(), "800000", "living_payment");
    f.source = Some(source(&s, "expense"));
    movement(&mut s, f);
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "500000");
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "800000");
    assert_eq!(list(&s, "active")["records"][0]["source_status"], "matched");
}
#[test]
fn f03_cash_principal_in_is_neither_income_nor_gain() {
    let (_d, mut s, inv, cash, p) = setup("11000000");
    movement(
        &mut s,
        fields(ep(&cash), ep(&inv), "1000000", "own_transfer"),
    );
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "0");
    assert!(s.plan_income_list().unwrap().rows.is_empty());
}
#[test]
fn f04_internal_transfer_cancels_and_single_account_scope_is_outflow() {
    use std::collections::BTreeSet;
    let (_d, mut s, a, _cash, _p) = setup("10000000");
    let b = account(&mut s, "虚构投资B", "investment");
    let f = fields(ep(&a), ep(&b), "2000000", "own_transfer");
    assert_eq!(
        thingary_lib::planning_flow_review::classify(
            &f,
            &BTreeSet::from([a.id.clone(), b.id.clone()])
        )
        .unwrap(),
        (0, 0)
    );
    assert_eq!(
        thingary_lib::planning_flow_review::classify(&f, &BTreeSet::from([a.id.clone()])).unwrap(),
        (0, 2000000)
    );
    let from = snapshot(
        &mut s,
        "2026-11-01",
        &[(&a, "10000000"), (&b, "2000000"), (&_cash, "5000000")],
    );
    let to = snapshot(
        &mut s,
        "2026-11-30",
        &[(&a, "8000000"), (&b, "4000000"), (&_cash, "5000000")],
    );
    let p = Pair {
        from_snapshot_id: from,
        to_snapshot_id: to,
    };
    let mut f = f;
    f.date = "2026-11-15".into();
    movement(&mut s, f);
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["inflow_cents"], "0");
    assert_eq!(profit(&s, &p)["value"]["outflow_cents"], "0");
}
fn income(
    s: &mut Store,
    from: Option<String>,
    to: Option<String>,
    destination: &str,
) -> thingary_lib::plan_income::Income {
    s.plan_income_save(
        &thingary_lib::plan_income::Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::plan_income::Fields {
                date: "2026-10-15".into(),
                net_cents: "500000".into(),
                hpf_cents: None,
                notes: "虚构分红".into(),
                category: "cash_dividend".into(),
                source_account_id: from,
                destination: Some(destination.into()),
                receiving_account_id: to,
            },
        },
        TODAY,
    )
    .unwrap()
}
#[test]
fn f05_dividend_retained_transferred_and_reinvested_is_not_added_twice() {
    let (_d, mut s, inv, _cash, p) = setup("10500000");
    income(&mut s, Some(inv.id.clone()), None, "retained");
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "500000");
    let (_d, mut s, inv, cash, p) = setup("10000000");
    income(
        &mut s,
        Some(inv.id.clone()),
        Some(cash.id.clone()),
        "transferred",
    );
    let mut f = fields(ep(&inv), ep(&cash), "500000", "income_distribution");
    f.source = Some(source(&s, "income"));
    movement(&mut s, f);
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "500000");
    assert_eq!(s.plan_income_list().unwrap().rows.len(), 1);
    let (_d, mut s, inv, _cash, p) = setup("10500000");
    income(&mut s, None, None, "unknown");
    let sources = s
        .movement_sources(
            &SourceQuery {
                kind: "income".into(),
                text: String::new(),
                cursor: None,
                movement_id: None,
            },
            &s.generation(),
        )
        .unwrap();
    assert_eq!(sources["options"].as_array().unwrap().len(), 1);
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "500000");
    assert!(list(&s, "active")["records"].as_array().unwrap().is_empty());
    assert!(!inv.id.is_empty());
}
#[test]
fn f06_investment_cost_is_net_loss_external_cost_is_disclosed_and_excluded() {
    let (_d, mut s, inv, _cash, p) = setup("9990000");
    movement(
        &mut s,
        fields(ep(&inv), external(), "10000", "investment_cost"),
    );
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["outflow_cents"], "0");
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "-10000");
    let (_d, mut s, _inv, cash, p) = setup("10000000");
    movement(
        &mut s,
        fields(ep(&cash), external(), "10000", "investment_cost"),
    );
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "0");
    let read = s.followup_review_read(&p, &s.generation()).unwrap();
    assert!(read["preview"]["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["code"] == "external_cost_excluded"));
}
#[test]
fn f07_empty_details_require_explicit_complete_confirmation_and_manual_unknown_remains_unknown() {
    let (_d, mut s, _inv, _cash, p) = setup("10000000");
    let r = s.followup_review_read(&p, &s.generation()).unwrap();
    assert_eq!(r["draft"]["selection"]["inflow_cents"], Value::Null);
    assert_eq!(r["preview"]["result"]["status"], "not_recorded");
    let v = preview(&s, &p, &draft(false));
    assert_eq!(v["selected_totals"]["inflow_cents"], "0");
    assert_eq!(v["result"]["status"], "needs_review");
    let i = review_input(&s, &p, &draft(false));
    s.followup_review_save(&i).unwrap();
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    confirm(&mut s, &p);
    assert_eq!(profit(&s, &p)["status"], "ready");
}
#[test]
fn f08_authority_is_exclusive_preview_is_read_only_switch_audits_previous_totals() {
    let (_d, mut s, inv, cash, p) = setup("11000000");
    movement(
        &mut s,
        fields(ep(&cash), ep(&inv), "1000000", "own_transfer"),
    );
    let manual = Draft {
        selection: Selection::Manual {
            inflow_cents: Some("1000000".into()),
            outflow_cents: Some("0".into()),
        },
        ..draft(true)
    };
    s.followup_review_save(&review_input(&s, &p, &manual))
        .unwrap();
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "0");
    let before = s.followup_review_read(&p, &s.generation()).unwrap();
    let v = preview(&s, &p, &draft(true));
    assert_eq!(v["previous_totals"]["inflow_cents"], "1000000");
    assert_eq!(v["difference"]["inflow_cents"], "0");
    assert_eq!(s.followup_review_read(&p, &s.generation()).unwrap(), before);
    confirm(&mut s, &p);
    assert_eq!(
        s.followup_review_read(&p, &s.generation()).unwrap()["preview"]["saved_mode"],
        "movements"
    );
    assert_eq!(profit(&s, &p)["value"]["profit_cents"], "0");
    let audit:i64=s.conn_for_test().unwrap().query_row("SELECT COUNT(*) FROM planning_flow_audit WHERE entity_kind='review' AND before_value LIKE '%manual%'",[],|r|r.get(0)).unwrap();
    assert_eq!(audit, 1);
}
#[test]
fn f09_insert_change_delete_restore_invalidate_manual_and_details_but_notes_do_not() {
    let (_d, mut s, inv, cash, p) = setup("10000000");
    confirm(&mut s, &p);
    let stale = review_input(&s, &p, &draft(true));
    let f = fields(ep(&inv), ep(&cash), "10000", "own_transfer");
    let m = movement(&mut s, f.clone());
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    assert_eq!(
        s.followup_review_save(&stale).unwrap_err().code,
        "STALE_BASIS"
    );
    confirm(&mut s, &p);
    let mut note = f.clone();
    note.notes = "只改虚构备注".into();
    let m = s
        .movement_save(
            &Save {
                request_id: rid(),
                generation: s.generation(),
                id: Some(m.id.clone()),
                expected_revision: Some(m.revision),
                fields: note,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(profit(&s, &p)["status"], "ready");
    let mut change = f;
    change.amount_cents = "20000".into();
    let m = s
        .movement_save(
            &Save {
                request_id: rid(),
                generation: s.generation(),
                id: Some(m.id.clone()),
                expected_revision: Some(m.revision),
                fields: change,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    confirm(&mut s, &p);
    trash(&mut s, &m.id, m.revision, true);
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    confirm(&mut s, &p);
    trash(&mut s, &m.id, m.revision + 1, false);
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    let manual = Draft {
        selection: Selection::Manual {
            inflow_cents: Some("0".into()),
            outflow_cents: Some("20000".into()),
        },
        ..draft(true)
    };
    s.followup_review_save(&review_input(&s, &p, &manual))
        .unwrap();
    movement(&mut s, fields(ep(&cash), ep(&inv), "1000", "own_transfer"));
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    assert_eq!(
        s.investment_review_read(&s.generation(), &p.from_snapshot_id, &p.to_snapshot_id)
            .unwrap()
            .result["status"],
        "needs_review"
    );
}
#[test]
fn f10_intermediate_snapshot_overlap_delete_restore_and_endpoint_correction_do_not_split() {
    let (_d, mut s, inv, cash, p) = setup("10000000");
    let review = confirm(&mut s, &p);
    let mid = snapshot(
        &mut s,
        "2026-10-15",
        &[(&inv, "10000000"), (&cash, "5000000")],
    );
    assert_eq!(profit(&s, &p)["status"], "ready");
    let sub = Pair {
        from_snapshot_id: p.from_snapshot_id.clone(),
        to_snapshot_id: mid,
    };
    assert_eq!(
        s.followup_review_save(&review_input(&s, &sub, &draft(false)))
            .unwrap_err()
            .code,
        "OVERLAPPING_FLOW"
    );
    let t = Trash {
        request_id: rid(),
        generation: s.generation(),
        id: review.id.clone(),
        expected_revision: Some(review.revision),
        deleted: true,
    };
    s.followup_review_trash(&t).unwrap();
    confirm(&mut s, &sub);
    let restore = Trash {
        request_id: rid(),
        deleted: false,
        expected_revision: Some(review.revision + 1),
        ..t
    };
    assert_eq!(
        s.followup_review_trash(&restore).unwrap_err().code,
        "OVERLAPPING_FLOW"
    );
    assert_eq!(
        s.followup_review_list(&s.generation()).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let end = s.wealth_snapshot(&sub.to_snapshot_id).unwrap().unwrap();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(end.id),
            expected_revision: Some(end.revision),
            date: "2026-10-15".into(),
            notes: String::new(),
            entries: vec![
                EntryInput {
                    account_id: inv.id,
                    state: "entered".into(),
                    amount_cents: Some("10000100".into()),
                },
                EntryInput {
                    account_id: cash.id,
                    state: "entered".into(),
                    amount_cents: Some("5000000".into()),
                },
            ],
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(profit(&s, &sub)["status"], "needs_review");
}
#[test]
fn f11_source_uniqueness_correction_delete_restore_unlink_and_account_purge_protection() {
    let (_d, mut s, inv, _cash, p) = setup("9700000");
    let expense = expense(&mut s, "800000");
    let mut f = fields(ep(&inv), external(), "800000", "living_payment");
    f.source = Some(source(&s, "expense"));
    let m = movement(&mut s, f.clone());
    confirm(&mut s, &p);
    let duplicate = Save {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: f.clone(),
    };
    assert_eq!(
        s.movement_save(&duplicate, TODAY).unwrap_err().code,
        "SOURCE_CONFLICT"
    );
    let mut ef = expense.fields.clone();
    ef.notes = "只改备注".into();
    let expense = s
        .expense_save(
            &thingary_lib::expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: Some(expense.id.clone()),
                expected_revision: Some(expense.revision),
                fields: ef.clone(),
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(profit(&s, &p)["status"], "ready");
    ef.amount_cents = "900000".into();
    let expense = s
        .expense_save(
            &thingary_lib::expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: Some(expense.id.clone()),
                expected_revision: Some(expense.revision),
                fields: ef,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(
        list(&s, "active")["records"][0]["source_status"],
        "needs_review"
    );
    assert_eq!(profit(&s, &p)["status"], "needs_review");
    s.wealth_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "expense".into(),
        id: expense.id.clone(),
        expected_revision: expense.revision,
        deleted: true,
    })
    .unwrap();
    assert_eq!(list(&s, "active")["records"][0]["source_status"], "deleted");
    let purge = thingary_lib::purge::Purge {
        request_id: rid(),
        generation: s.generation(),
        kind: Some("expense".into()),
        id: expense.id.clone(),
        preview: None,
    };
    assert_eq!(
        s.purge_trash(&purge).unwrap_err().code,
        "PLANNING_DEPENDENCY"
    );
    f.source = None;
    s.movement_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: Some(m.id),
            expected_revision: Some(m.revision),
            fields: f,
        },
        TODAY,
    )
    .unwrap();
    s.purge_trash(&purge).unwrap();
    assert_eq!(list(&s, "active")["records"].as_array().unwrap().len(), 1);
    let independent = account(&mut s, "虚构无盘点现金", "cash");
    movement(
        &mut s,
        fields(ep(&independent), external(), "100", "external_funding"),
    );
    s.wealth_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "account".into(),
        id: independent.id.clone(),
        expected_revision: independent.revision,
        deleted: true,
    })
    .unwrap();
    let purge = thingary_lib::purge::Purge {
        request_id: rid(),
        generation: s.generation(),
        kind: Some("account".into()),
        id: independent.id,
        preview: None,
    };
    assert_eq!(
        s.purge_trash(&purge).unwrap_err().code,
        "PLANNING_DEPENDENCY"
    );
}
#[test]
fn f12_unsettled_unsupported_or_unknown_movements_never_confirm_simple_profit() {
    let (_d, mut s, _inv, _cash, p) = setup("9700000");
    let unsupported = Draft {
        unsupported_movements: true,
        ..draft(false)
    };
    let v = preview(&s, &p, &unsupported);
    assert_eq!(v["result"]["status"], "needs_review");
    assert!(v["result"]["reasons"]
        .as_array()
        .unwrap()
        .contains(&json!("unsupported_movement")));
    s.followup_review_save(&review_input(&s, &p, &unsupported))
        .unwrap();
    let confirmed = Draft {
        confirmed_complete: true,
        ..unsupported
    };
    assert_eq!(
        s.followup_review_save(&review_input(&s, &p, &confirmed))
            .unwrap_err()
            .code,
        "INVALID_INPUT"
    );
}
#[test]
fn validation_module_gates_receipts_faults_and_cursor_expires_instead_of_dropping_rows() {
    let (d, mut s, inv, cash, p) = setup("10000000");
    let f = fields(ep(&cash), ep(&inv), "100", "own_transfer");
    let input = Save {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: None,
        id: None,
        fields: f.clone(),
    };
    s.set_hook(|p| {
        if p == "movement.before_commit" {
            Err(Error::new("INJECTED", "虚构故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.movement_save(&input, TODAY).is_err());
    assert!(list(&s, "active")["records"].as_array().unwrap().is_empty());
    s.set_hook(|p| {
        if p == "movement.after_commit" {
            Err(Error::new("INJECTED", "虚构未知"))
        } else {
            Ok(())
        }
    });
    assert!(s.movement_save(&input, TODAY).is_err());
    s.set_hook(|_| Ok(()));
    let saved = s.movement_save(&input, TODAY).unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(
        s.followup_receipt(&input.request_id, &s.generation())
            .unwrap()
            .unwrap()
            .id,
        saved.id
    );
    assert_eq!(list(&s, "active")["records"].as_array().unwrap().len(), 1);
    let mut conflict = input.clone();
    conflict.fields.amount_cents = "200".into();
    assert_eq!(
        s.movement_save(&conflict, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let mut invalid = input.clone();
    invalid.request_id = rid();
    invalid.fields.amount_cents = "0".into();
    assert_eq!(
        s.movement_save(&invalid, TODAY).unwrap_err().code,
        "INVALID_INPUT"
    );
    invalid.fields.amount_cents = "01".into();
    assert!(s.movement_save(&invalid, TODAY).is_err());
    invalid.fields.amount_cents = "1".into();
    invalid.fields.date = "2026-02-30".into();
    assert!(s.movement_save(&invalid, TODAY).is_err());
    for _ in 0..51 {
        movement(&mut s, f.clone());
    }
    let page = list(&s, "active");
    assert_eq!(page["records"].as_array().unwrap().len(), 50);
    let query = Query {
        from_date: None,
        to_date: None,
        account_id: None,
        deleted: "active".into(),
        cursor: Some(page["next_cursor"].as_str().unwrap().into()),
    };
    assert_eq!(
        s.movement_list(&query, &s.generation()).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    movement(&mut s, f);
    assert_eq!(
        s.movement_list(&query, &s.generation()).unwrap_err().code,
        "STALE_CURSOR"
    );
    let i = review_input(&s, &p, &draft(true));
    s.set_hook(|p| {
        if p == "followup_review.before_commit" {
            Err(Error::new("INJECTED", "虚构故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.followup_review_save(&i).is_err());
    assert_eq!(profit(&s, &p)["status"], "not_recorded");
    s.set_hook(|p| {
        if p == "followup_review.after_commit" {
            Err(Error::new("INJECTED", "虚构未知"))
        } else {
            Ok(())
        }
    });
    assert!(s.followup_review_save(&i).is_err());
    s.set_hook(|_| Ok(()));
    assert_eq!(s.followup_review_save(&i).unwrap().revision, 1);
    thingary_lib::modules::write(
        &d.path().join("library"),
        &thingary_lib::modules::Modules {
            planning: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        s.movement_list(&query, &s.generation()).unwrap_err().code,
        "MODULE_DISABLED"
    );
    assert_eq!(
        s.followup_review_read(&p, &s.generation())
            .unwrap_err()
            .code,
        "MODULE_DISABLED"
    );
}
#[test]
fn full_backup_restart_and_excel_include_facts_modes_confirmation_and_audit() {
    let (d, mut s, inv, cash, p) = setup("9700000");
    let m = movement(
        &mut s,
        fields(ep(&inv), ep(&cash), "800000", "own_transfer"),
    );
    let r = confirm(&mut s, &p);
    let before = s.followup_review_read(&p, &s.generation()).unwrap();
    let mut setup: thingary_lib::plan_basic::Update = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/update.json"
    ))
    .unwrap();
    setup.generation = s.generation();
    s.plan_profile_update(&setup, TODAY).unwrap();
    s.plan_assumptions_save(
        &thingary_lib::plan_assumptions::Save {
            request_id: rid(),
            generation: s.generation(),
            expected_revision: Some(1),
            values: thingary_lib::plan_assumptions::Values {
                volatility_hundredths: 0,
                ..Default::default()
            },
            confirm: true,
        },
        TODAY,
    )
    .unwrap();
    let workbook = d.path().join("fictional.xlsx");
    let counts = s.export_workbook(&workbook).unwrap();
    assert!(counts
        .iter()
        .any(|(name, n)| *name == "资金流动" && *n == 1));
    let mut excel: calamine::Xlsx<_> = calamine::open_workbook(&workbook).unwrap();
    use calamine::Reader;
    let flow = excel.worksheet_range("资金流动").unwrap();
    assert!(flow
        .rows()
        .flatten()
        .any(|v| matches!(v, calamine::Data::String(t) if t == "800000")));
    let review = excel.worksheet_range("投资区间核对").unwrap();
    assert!(review
        .rows()
        .flatten()
        .any(|v| matches!(v, calamine::Data::String(t) if t == "movements")));
    assert!(review
        .rows()
        .flatten()
        .any(|v| matches!(v, calamine::Data::String(t) if t == "confirmed")));
    assert!(excel.worksheet_range("规划核对审计").unwrap().height() > 1);
    let assumptions = excel.worksheet_range("规划假设").unwrap();
    assert!(assumptions
        .rows()
        .flatten()
        .any(|v| matches!(v,calamine::Data::String(t) if t=="confirmed")));
    let archive = d.path().join("fictional.thingary");
    s.backup(Some(&archive)).unwrap();
    let root = d.path().join("library");
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.followup_review_read(&p, &s.generation()).unwrap(), before);
    let mut restored = Store::open(&d.path().join("restore")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    assert_eq!(info.cash_movements, 1);
    assert_eq!(info.investment_reviews, 1);
    assert_eq!(info.assumption_checks, 1);
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(profit(&restored, &p)["value"]["profit_cents"], "500000");
    assert_eq!(list(&restored, "active")["records"][0]["id"], m.id);
    assert_eq!(
        restored
            .followup_review_list(&restored.generation())
            .unwrap()["records"][0]["id"],
        r.id
    );
}
#[test]
fn schema38_migration_is_empty_old_manual_and_original_receipt_survive_and_rollback() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(thingary_lib::storage::SCHEMA).unwrap();
    thingary_lib::storage::migrate_to(&c, 38, &|_| Ok(())).unwrap();
    assert!(
        thingary_lib::storage::migrate_to(&c, 39, &|p| if p == "migration.before_commit" {
            Err(Error::new("INJECTED", "虚构迁移故障"))
        } else {
            Ok(())
        })
        .is_err()
    );
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        38
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='cash_movements'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    thingary_lib::storage::migrate_to(&c, 39, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM cash_movements", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let (d, mut s, _inv, _cash, p) = setup("10000000");
    let read = s
        .investment_review_read(&s.generation(), &p.from_snapshot_id, &p.to_snapshot_id)
        .unwrap();
    let input = thingary_lib::investment_review::Save {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: None,
        id: None,
        from_snapshot_id: p.from_snapshot_id.clone(),
        to_snapshot_id: p.to_snapshot_id.clone(),
        from_value_key: read.from_value_key,
        to_value_key: read.to_value_key,
        fields: thingary_lib::investment_review::Fields {
            inflow_cents: Some("0".into()),
            outflow_cents: Some("0".into()),
            confirmed_complete: true,
            unsupported_movements: false,
            notes: "虚构旧手填".into(),
        },
    };
    let flow = s.investment_review_save(&input).unwrap();
    s.conn_for_test().unwrap().execute_batch("DROP TABLE cash_movements;DROP TABLE investment_flow_sources;DROP TABLE planning_flow_audit;PRAGMA user_version=38;").unwrap();
    drop(s);
    let mut s = Store::open(&d.path().join("library")).unwrap();
    assert_eq!(
        s.followup_review_read(&p, &s.generation()).unwrap()["preview"]["saved_mode"],
        "manual"
    );
    assert_eq!(profit(&s, &p)["status"], "ready");
    assert_eq!(s.investment_review_save(&input).unwrap(), flow);
}
#[test]
fn movements_work_without_a_profile_or_two_snapshots_and_dates_have_distinct_list_review_boundaries(
) {
    let d = tempfile::tempdir().unwrap();
    let mut empty = Store::open(&d.path().join("library")).unwrap();
    let a = account(&mut empty, "虚构独立现金", "cash");
    movement(
        &mut empty,
        fields(external(), ep(&a), "1000", "external_funding"),
    );
    assert!(empty.plan_profile().unwrap().saved.is_none());
    assert!(empty.wealth_summary().unwrap().points.is_empty());
    assert_eq!(
        list(&empty, "active")["records"].as_array().unwrap().len(),
        1
    );
    let (_d, mut s, inv, cash, p) = setup("10000000");
    confirm(&mut s, &p);
    let mut opening = fields(ep(&inv), ep(&cash), "10000", "own_transfer");
    opening.date = "2026-09-30".into();
    movement(&mut s, opening.clone());
    assert_eq!(profit(&s, &p)["status"], "ready");
    let query = Query {
        from_date: Some(opening.date.clone()),
        to_date: Some(opening.date),
        account_id: Some(inv.id.clone()),
        deleted: "active".into(),
        cursor: None,
    };
    assert_eq!(
        s.movement_list(&query, &s.generation()).unwrap()["records"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut closing = fields(ep(&inv), ep(&cash), "20000", "own_transfer");
    closing.date = "2026-10-31".into();
    movement(&mut s, closing);
    let v = preview(&s, &p, &draft(true));
    assert_eq!(v["movement_count"], 1);
    assert_eq!(v["selected_totals"]["outflow_cents"], "20000");
}
#[test]
fn restored_original_facts_still_reject_old_basis_and_source_restore_enforces_uniqueness() {
    let (_d, mut s, inv, _cash, p) = setup("10000000");
    let expense = expense(&mut s, "10000");
    let mut f = fields(ep(&inv), external(), "10000", "living_payment");
    f.source = Some(source(&s, "expense"));
    let m = movement(&mut s, f.clone());
    confirm(&mut s, &p);
    let old = review_input(&s, &p, &draft(true));
    let ef = expense.fields.clone();
    let mut changed = ef.clone();
    changed.amount_cents = "20000".into();
    let changed = s
        .expense_save(
            &thingary_lib::expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: Some(expense.id.clone()),
                expected_revision: Some(expense.revision),
                fields: changed,
            },
            TODAY,
        )
        .unwrap();
    s.expense_save(
        &thingary_lib::expenses::Save {
            request_id: rid(),
            generation: s.generation(),
            id: Some(expense.id),
            expected_revision: Some(changed.revision),
            fields: ef,
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(list(&s, "active")["records"][0]["source_status"], "matched");
    assert_eq!(
        s.followup_review_save(&old).unwrap_err().code,
        "STALE_BASIS"
    );
    confirm(&mut s, &p);
    let old = review_input(&s, &p, &draft(true));
    trash(&mut s, &m.id, m.revision, true);
    let second = movement(&mut s, f);
    assert_eq!(
        s.movement_trash(&Trash {
            request_id: rid(),
            generation: s.generation(),
            expected_revision: Some(m.revision + 1),
            id: m.id.clone(),
            deleted: false
        })
        .unwrap_err()
        .code,
        "SOURCE_CONFLICT"
    );
    trash(&mut s, &second.id, second.revision, true);
    trash(&mut s, &m.id, m.revision + 1, false);
    assert_eq!(
        s.followup_review_save(&old).unwrap_err().code,
        "STALE_BASIS"
    );
    assert_eq!(profit(&s, &p)["status"], "needs_review");
}
#[test]
fn read_errors_are_not_represented_as_empty_or_reconciled_history_and_backup_refuses_forged_index()
{
    let (d, mut s, inv, cash, p) = setup("10000000");
    let m = movement(&mut s, fields(ep(&inv), ep(&cash), "100", "own_transfer"));
    confirm(&mut s, &p);
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE cash_movements SET date='2026-10-16' WHERE id=?1",
            rusqlite::params![m.id],
        )
        .unwrap();
    assert!(s.backup(Some(&d.path().join("invalid.thingary"))).is_err());
    s.conn_for_test()
        .unwrap()
        .execute_batch("DROP TABLE cash_movements;")
        .unwrap();
    assert!(s
        .movement_list(
            &Query {
                from_date: None,
                to_date: None,
                account_id: None,
                deleted: "all".into(),
                cursor: None
            },
            &s.generation()
        )
        .is_err());
    assert!(s.followup_review_list(&s.generation()).is_err());
}

#[test]
fn deleted_movements_can_explicitly_unlink_a_source_without_restoring_or_losing_the_fact() {
    let (_d, mut s, inv, _cash, _p) = setup("10000000");
    let expense = expense(&mut s, "100");
    let mut f = fields(ep(&inv), external(), "100", "living_payment");
    f.source = Some(source(&s, "expense"));
    let m = movement(&mut s, f.clone());
    trash(&mut s, &m.id, 1, true);
    f.source = None;
    s.movement_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            expected_revision: Some(2),
            id: Some(m.id),
            fields: f,
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(list(&s, "deleted")["records"][0]["deleted"], true);
    assert_eq!(
        list(&s, "deleted")["records"][0]["source_status"],
        "unlinked"
    );
    s.wealth_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "expense".into(),
        id: expense.id.clone(),
        expected_revision: expense.revision,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: rid(),
        generation: s.generation(),
        kind: Some("expense".into()),
        id: expense.id,
        preview: None,
    })
    .unwrap();
    assert_eq!(list(&s, "deleted")["records"].as_array().unwrap().len(), 1);
}
