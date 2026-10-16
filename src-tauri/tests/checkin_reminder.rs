//! Optional check-in reminder: derived from the last complete check-in,
//! machine-local, and cancelled by the next check-in. Fictional data only.
use thingary_lib::{
    checkin_reminder::Settings,
    modules::{self, FinanceUpdate, Modules},
    storage::Store,
    wealth::{Account, AccountFields, AccountSave, EntryInput, SnapshotSave},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn open(s: &mut Store, name: &str, kind: &str) -> Account {
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
                purchase_cents: None,
                purchased_on: None,
                group_id: None,
            },
        },
        TODAY,
    )
    .unwrap()
}
fn check_in(s: &mut Store, date: &str, rows: &[(&Account, bool)]) {
    let entries = rows
        .iter()
        .map(|(a, known)| EntryInput {
            account_id: a.id.clone(),
            state: if *known { "entered" } else { "missing" }.into(),
            amount_cents: known.then(|| "100000".into()),
        })
        .collect();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: date.into(),
            notes: String::new(),
            entries,
        },
        TODAY,
    )
    .unwrap();
}
/// Module preferences live beside the library directory, so every test needs its own parent.
fn library() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    std::fs::create_dir(&root).unwrap();
    (dir, root)
}
fn ids(s: &Store) -> Vec<String> {
    s.reminder_plans_for(TODAY)
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .filter(|id| id.starts_with("thingary-checkin-"))
        .collect()
}

#[test]
fn off_by_default_then_plans_follow_the_last_complete_check_in() {
    let (_dir, root) = library();
    let mut s = Store::open(&root).unwrap();
    let cash = open(&mut s, "虚构储蓄卡", "cash");
    let fund = open(&mut s, "虚构基金", "mixed");
    check_in(&mut s, "2026-09-30", &[(&cash, true), (&fund, true)]);
    assert!(ids(&s).is_empty(), "no reminder until the user opts in");
    assert!(s.checkin_reminder_status().unwrap().next_date.is_none());

    Settings { months: 1 }.save(&root).unwrap();
    assert_eq!(
        ids(&s),
        ["thingary-checkin-2026-10-30", "thingary-checkin-2026-11-06"]
    );
    let status = s.checkin_reminder_status().unwrap();
    assert_eq!(status.last_check_in.as_deref(), Some("2026-09-30"));
    assert_eq!(status.next_date.as_deref(), Some("2026-10-30"));

    // An incomplete check-in does not restart the clock.
    check_in(&mut s, "2026-10-15", &[(&cash, true), (&fund, false)]);
    assert_eq!(ids(&s)[0], "thingary-checkin-2026-10-30");

    // A new complete check-in replaces the old reminders.
    check_in(&mut s, "2026-11-20", &[(&cash, true), (&fund, true)]);
    assert_eq!(
        ids(&s),
        ["thingary-checkin-2026-12-20", "thingary-checkin-2026-12-27"]
    );

    Settings { months: 0 }.save(&root).unwrap();
    assert!(ids(&s).is_empty());
}

#[test]
fn a_switched_off_wealth_module_pauses_the_reminder_without_losing_the_setting() {
    let (_dir, root) = library();
    let mut s = Store::open(&root).unwrap();
    let cash = open(&mut s, "虚构储蓄卡", "cash");
    check_in(&mut s, "2026-09-30", &[(&cash, true)]);
    Settings { months: 3 }.save(&root).unwrap();
    assert_eq!(ids(&s).len(), 2);

    let off = Modules {
        wealth: false,
        ..Modules::default()
    };
    modules::write_runtime(&root, off, FinanceUpdate::default()).unwrap();
    assert!(ids(&s).is_empty());
    assert_eq!(Settings::load(&root).months, 3);

    modules::write_runtime(&root, Modules::default(), FinanceUpdate::default()).unwrap();
    assert_eq!(ids(&s).len(), 2);
}

#[test]
fn no_complete_check_in_means_nothing_to_remind_about() {
    let (_dir, root) = library();
    let s = Store::open(&root).unwrap();
    Settings { months: 1 }.save(&root).unwrap();
    assert!(ids(&s).is_empty());
    let status = s.checkin_reminder_status().unwrap();
    assert_eq!(status.months, 1);
    assert!(status.last_check_in.is_none() && status.next_date.is_none());
}
