//! Chart balances use only fictional, temporary snapshot facts.
use thingary_lib::{
    storage::Store,
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave},
};
const TODAY: &str = "2026-10-17";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn account(s: &mut Store, kind: &str, counted: bool) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: format!("虚构{kind}"),
                institution: "虚构平台".into(),
                side: "asset".into(),
                kind: kind.into(),
                counted,
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
fn save(s: &mut Store, date: &str, accounts: &[Account], missing: Option<usize>) {
    s.wealth_snapshot_save(
        &SnapshotSave {
            close_accounts: Vec::new(),
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: date.into(),
            notes: "虚构图表测试".into(),
            entries: accounts
                .iter()
                .enumerate()
                .map(|(i, a)| EntryInput {
                    account_id: a.id.clone(),
                    state: if missing == Some(i) {
                        "missing"
                    } else {
                        "entered"
                    }
                    .into(),
                    amount_cents: (missing != Some(i)).then(|| "10000".into()),
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
}
#[test]
fn chart_balances_include_precious_metals_and_all_investment_kinds_but_exclude_uncounted() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut accounts = [
        "cash",
        "investment",
        "mixed",
        "fund",
        "bond",
        "precious_metal",
        "housing_fund",
        "pension",
        "insurance",
        "property",
    ]
    .iter()
    .map(|kind| account(&mut s, kind, *kind != "property"))
    .collect::<Vec<_>>();
    accounts.push(account(&mut s, "cash", false));
    accounts.push(account(&mut s, "precious_metal", false));
    save(&mut s, "2026-09-01", &accounts, None);
    let summary = s.wealth_summary().unwrap();
    let p = &summary.points[0];
    assert!(p.complete);
    assert_eq!(p.liquid_cents.as_deref(), Some("10000"));
    assert_eq!(p.invested_cents.as_deref(), Some("50000"));
    save(&mut s, "2026-10-01", &accounts, Some(0));
    let summary = s.wealth_summary().unwrap();
    let incomplete = &summary.points[1];
    assert!(!incomplete.complete);
    assert_eq!(incomplete.liquid_cents, None);
    assert_eq!(incomplete.invested_cents, None);
}
#[test]
fn chart_balances_keep_entry_time_kind_and_counted_after_current_account_edits() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "cash", true);
    save(&mut s, "2026-09-01", std::slice::from_ref(&a), None);
    let mut fields = a.fields.clone();
    fields.kind = "investment".into();
    fields.counted = false;
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(a.id),
            expected_revision: Some(a.revision),
            fields,
        },
        TODAY,
    )
    .unwrap();
    let summary = s.wealth_summary().unwrap();
    assert_eq!(summary.points[0].liquid_cents.as_deref(), Some("10000"));
    assert_eq!(summary.points[0].invested_cents.as_deref(), Some("0"));
}
#[test]
fn complete_snapshot_with_no_matching_categories_is_known_zero() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = account(&mut s, "housing_fund", true);
    save(&mut s, "2026-09-01", &[a], None);
    let summary = s.wealth_summary().unwrap();
    assert_eq!(summary.points[0].liquid_cents.as_deref(), Some("0"));
    assert_eq!(summary.points[0].invested_cents.as_deref(), Some("0"));
}
