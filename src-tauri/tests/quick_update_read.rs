//! Fictional read metadata: carrying a balance is not a new explicit update.
use thingary_lib::{
    storage::Store,
    wealth::{
        Account, AccountFields, AccountSave, EntryInput, QuickChange, QuickUpdate, SnapshotSave,
    },
};
const TODAY: &str = "2026-10-17";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn account(store: &mut Store, name: &str) -> Account {
    store
        .wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: name.into(),
                    institution: String::new(),
                    side: "asset".into(),
                    kind: "cash".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
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
#[test]
fn carried_balances_keep_their_explicit_date_in_list_and_single_account_reads() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = Store::open(directory.path()).unwrap();
    let first = account(&mut store, "虚构储蓄");
    let second = account(&mut store, "虚构现金");
    let unknown = account(&mut store, "虚构未填");
    assert!(first.last_entered_on.is_none());
    store
        .wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                date: "2026-10-01".into(),
                notes: String::new(),
                entries: [&first, &second, &unknown]
                    .iter()
                    .map(|a| EntryInput {
                        account_id: a.id.clone(),
                        state: if a.id == unknown.id {
                            "missing"
                        } else {
                            "entered"
                        }
                        .into(),
                        amount_cents: if a.id == unknown.id {
                            None
                        } else {
                            Some("10000".into())
                        },
                    })
                    .collect(),
            },
            TODAY,
        )
        .unwrap();
    store
        .wealth_quick_update(
            &QuickUpdate {
                request_id: rid(),
                generation: store.generation(),
                date: "2026-10-10".into(),
                note: String::new(),
                changes: vec![QuickChange {
                    account_id: second.id.clone(),
                    amount_cents: "12000".into(),
                    expected_previous: Some("10000".into()),
                }],
            },
            TODAY,
        )
        .unwrap();
    let accounts = store.wealth_accounts().unwrap();
    let carried = accounts.iter().find(|a| a.id == first.id).unwrap();
    assert_eq!(carried.latest.as_ref().unwrap().date, "2026-10-10");
    assert_eq!(carried.last_entered_on.as_deref(), Some("2026-10-01"));
    assert_eq!(
        accounts
            .iter()
            .find(|a| a.id == second.id)
            .unwrap()
            .last_entered_on
            .as_deref(),
        Some("2026-10-10")
    );
    assert!(accounts
        .iter()
        .find(|a| a.id == unknown.id)
        .unwrap()
        .last_entered_on
        .is_none());
    let single = store
        .wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: store.generation(),
                id: Some(first.id.clone()),
                expected_revision: Some(first.revision),
                fields: first.fields.clone(),
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(single.last_entered_on.as_deref(), Some("2026-10-01"));
    let points = store.wealth_summary().unwrap().points;
    assert!(!points[0].has_unchanged);
    assert!(points[1].has_unchanged);
    assert!(
        !points[1].complete,
        "the fictional unknown account stays missing"
    );
}
