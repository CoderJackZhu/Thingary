//! Fictional contract and native Store evidence, never an application data directory.
use thingary_lib::{
    plan_basic::{Section, Update},
    storage::Store,
};
fn input(s: &Store) -> Update {
    let mut i: Update = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/update.json"
    ))
    .unwrap();
    i.generation = s.generation();
    i
}
#[test]
fn shared_json_is_strict_and_unknown_pension_facts_can_save() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let i = input(&s);
    let p = s.plan_profile_update(&i, "2026-10-07").unwrap();
    assert_eq!(p.profile.worker, None);
    assert_eq!(p.profile.region, None);
    assert_eq!(p.profile.paid_months, None);
    assert_eq!(p.profile.account_balance_cents, None);
    assert_eq!(
        p.profile.retire.basic.unwrap().contribution.monthly_cents,
        None
    );
    let mut j = serde_json::to_value(&i).unwrap();
    j["fields"]["basic"]["career"] = "fictional".into();
    assert!(serde_json::from_value::<Update>(j).is_err());
    let mut j = serde_json::to_value(&i).unwrap();
    j["unknown"] = true.into();
    assert!(serde_json::from_value::<Update>(j).is_err());
    let mut j = serde_json::to_value(&i).unwrap();
    j["fields"]["paid_months"] = 0.into();
    assert!(serde_json::from_value::<Update>(j).is_err());
}
#[test]
fn same_request_with_a_new_condition_is_not_a_replay() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let mut i = input(&s);
    assert_eq!(s.plan_profile_update(&i, "2026-10-07").unwrap().revision, 1);
    assert_eq!(s.plan_profile_update(&i, "2026-10-07").unwrap().revision, 1);
    if let Section::Basic(f) = &mut i.section {
        f.basic.contribution.monthly_cents = Some("0".into());
    }
    assert_eq!(
        s.plan_profile_update(&i, "2026-10-07").unwrap_err().code,
        "REQUEST_CONFLICT"
    );
}
#[test]
fn schema31_receipt_bytes_and_actual_replay_survive_new_optional_fields() {
    use thingary_lib::plan_profile::ProfileSave;
    let bytes = include_str!("../../tests/fixtures/planning-basic/legacy-receipt.json");
    let (_, mut i): (String, ProfileSave) = serde_json::from_str(bytes).unwrap();
    assert_eq!(serde_json::to_string(&("plan_profile", &i)).unwrap(), bytes);
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    i.generation = s.generation();
    let old_bytes = bytes.replace("fictional-generation", &i.generation);
    let a = s.plan_profile_save(&i, "2026-10-07").unwrap();
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE feature_requests SET fingerprint=?1 WHERE id=?2",
            rusqlite::params![Store::digest_for_test(old_bytes.as_bytes()), i.request_id],
        )
        .unwrap();
    assert_eq!(
        s.plan_profile_save(&i, "2026-10-07").unwrap().revision,
        a.revision
    );
    i.profile.retire.setup_completed = true;
    assert_eq!(
        s.plan_profile_save(&i, "2026-10-07").unwrap_err().code,
        "REQUEST_CONFLICT"
    );
}
