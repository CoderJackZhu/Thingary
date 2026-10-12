//! C1 fixtures use only temporary libraries.
use thingary_lib::{
    plan_assumptions::{Save, Values},
    plan_basic::{BudgetFields, Section, Update},
    storage::Store,
};
fn setup(s: &mut Store) -> Update {
    let mut u: Update = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/update.json"
    ))
    .unwrap();
    u.generation = s.generation();
    s.plan_profile_update(&u, "2026-10-12").unwrap();
    u
}
fn save(s: &Store, values: Values, confirm: bool) -> Save {
    Save {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: s.plan_profile().unwrap().saved.map(|s| s.revision),
        values,
        confirm,
    }
}
#[test]
fn p01_no_empty_profile_no_implicit_confirmation_and_legacy_request_hash_is_preserved() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(&d.path().join("library")).unwrap();
    let read = s.plan_assumptions_read(&s.generation()).unwrap();
    assert_eq!(read.values, Values::default());
    assert_eq!(read.confirmation, "unconfirmed");
    assert_eq!(
        s.plan_assumptions_save(&save(&s, read.values, true), "2026-10-12")
            .unwrap_err()
            .code,
        "PROFILE_REQUIRED"
    );
    assert!(s.plan_profile().unwrap().saved.is_none());
    let original = setup(&mut s);
    let fingerprint: String = s
        .conn_for_test()
        .unwrap()
        .query_row(
            "SELECT fingerprint FROM feature_requests WHERE id=?1",
            [&original.request_id],
            |r| r.get(0),
        )
        .unwrap();
    let values = s.plan_assumptions_read(&s.generation()).unwrap().values;
    let i = save(&s, values.clone(), true);
    s.plan_assumptions_save(&i, "2026-10-12").unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "confirmed"
    );
    s.plan_profile_update(&original, "2026-10-12").unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "confirmed"
    );
    let now: String = s
        .conn_for_test()
        .unwrap()
        .query_row(
            "SELECT fingerprint FROM feature_requests WHERE id=?1",
            [&original.request_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(now, fingerprint);
    let u = Update {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: Some(2),
        section: Section::Budget(BudgetFields {
            spend_items: vec![],
            rent_cents: "2000".into(),
        }),
    };
    s.plan_profile_update(&u, "2026-10-12").unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "confirmed"
    );
    let mut basic = original.clone();
    basic.request_id = uuid::Uuid::new_v4().to_string();
    basic.expected_revision = Some(3);
    if let Section::Basic(f) = &mut basic.section {
        f.volatility_hundredths = 0;
    }
    s.plan_profile_update(&basic, "2026-10-12").unwrap();
    let r = s.plan_assumptions_read(&s.generation()).unwrap();
    assert_eq!(r.confirmation, "needs_review");
    assert_eq!(r.confirmed_values, Some(values));
    assert_eq!(r.values.volatility_hundredths, 0);
    let i = save(&s, Values::default(), false);
    s.plan_assumptions_save(&i, "2026-10-12").unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "needs_review"
    );
}
#[test]
fn rollback_replay_revision_generation_restart_and_full_backup() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("library");
    let mut s = Store::open(&root).unwrap();
    setup(&mut s);
    let values = Values {
        volatility_hundredths: 0,
        ..Default::default()
    };
    let i = save(&s, values.clone(), true);
    s.set_hook(|p| {
        if p == "plan_profile.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.plan_assumptions_save(&i, "2026-10-12").is_err());
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "unconfirmed"
    );
    s.set_hook(|p| {
        if p == "plan_profile.after_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构未知"))
        } else {
            Ok(())
        }
    });
    assert!(s.plan_assumptions_save(&i, "2026-10-12").is_err());
    assert_eq!(
        s.wealth_request_result(&i.request_id, &s.generation())
            .unwrap(),
        Some("profile".into())
    );
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.plan_assumptions_save(&i, "2026-10-12").unwrap().revision,
        2
    );
    let mut changed = i.clone();
    changed.confirm = false;
    assert_eq!(
        s.plan_assumptions_save(&changed, "2026-10-12")
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
    changed.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        s.plan_assumptions_save(&changed, "2026-10-12")
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation()).unwrap().values,
        values
    );
    let archive = d.path().join("fictional.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&d.path().join("restored")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored
            .plan_assumptions_read(&restored.generation())
            .unwrap()
            .confirmation,
        "confirmed"
    );
    assert_eq!(
        restored
            .plan_assumptions_read(&restored.generation())
            .unwrap()
            .values,
        values
    );
    assert_eq!(
        restored
            .wealth_request_result(&i.request_id, &i.generation)
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
}
#[test]
fn schema37_migrates_unconfirmed_preserves_payload_and_receipt() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("library");
    let mut s = Store::open(&root).unwrap();
    let u = setup(&mut s);
    let before = s.plan_profile().unwrap().saved.unwrap().profile;
    let dbpath = {
        let conn = s.conn_for_test().unwrap();
        conn.execute_batch("DROP TABLE cash_movements; DROP TABLE investment_flow_sources; DROP TABLE planning_flow_audit; DROP TABLE plan_assumption_checks;PRAGMA user_version=37;")
            .unwrap();
        conn.path().unwrap().to_owned()
    };
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, before);
    assert_eq!(
        s.plan_assumptions_read(&s.generation())
            .unwrap()
            .confirmation,
        "unconfirmed"
    );
    assert_eq!(
        s.wealth_request_result(&u.request_id, &s.generation())
            .unwrap(),
        Some("profile".into())
    );
    drop(s);
    let c = rusqlite::Connection::open(dbpath).unwrap();
    c.execute_batch("DROP TABLE cash_movements; DROP TABLE investment_flow_sources; DROP TABLE planning_flow_audit; DROP TABLE plan_assumption_checks;PRAGMA user_version=37;")
        .unwrap();
    // Store startup migrates atomically. A schema downgrade contains no invented checks.
    drop(c);
    let s = Store::open(&root).unwrap();
    assert!(s
        .plan_assumptions_read(&s.generation())
        .unwrap()
        .confirmed_values
        .is_none());
}
#[test]
fn disabled_and_invalid_values_do_not_write() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("library");
    let mut s = Store::open(&root).unwrap();
    setup(&mut s);
    let v = Values {
        volatility_hundredths: 6001,
        ..Default::default()
    };
    assert_eq!(
        s.plan_assumptions_save(&save(&s, v, true), "2026-10-12")
            .unwrap_err()
            .code,
        "INVALID_INPUT"
    );
    thingary_lib::modules::write(
        &root,
        &thingary_lib::modules::Modules {
            planning: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        s.plan_assumptions_read(&s.generation()).unwrap_err().code,
        "MODULE_DISABLED"
    );
    assert_eq!(
        s.plan_assumptions_save(&save(&s, Values::default(), true), "2026-10-12")
            .unwrap_err()
            .code,
        "MODULE_DISABLED"
    );
}
