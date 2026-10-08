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
fn next(s: &Store, section: Section, revision: i64) -> Update {
    Update {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: Some(revision),
        section,
    }
}
#[test]
fn scoped_pension_and_basic_share_revision_without_overwriting_each_other() {
    use thingary_lib::plan_basic::PensionFields;
    use thingary_lib::plan_profile::{Overrides, ProfileSave};
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let original = s.plan_profile_update(&input(&s), "2026-10-07").unwrap();
    let facts = PensionFields {
        birth_month: Some("1990-06".into()),
        worker: Some("male".into()),
        region: Some("beijing".into()),
        paid_months: Some(0),
        account_balance_cents: Some("0".into()),
        base_cents: Some("0".into()),
        past_index_hundredths: None,
        flex_months: Some(0),
        personal_pension_annual_cents: Some("0".into()),
        marginal_tax_hundredths: Some(0),
        wage_growth_hundredths: 300,
        pp_return_hundredths: 200,
        overrides: Overrides::default(),
    };
    let pension = next(&s, Section::Pension(facts), 1);
    let a = s.plan_profile_update(&pension, "2026-10-07").unwrap();
    assert_eq!(a.profile.retire, original.profile.retire);
    let mut base = input(&s);
    base.request_id = uuid::Uuid::new_v4().to_string();
    base.expected_revision = Some(2);
    if let Section::Basic(f) = &mut base.section {
        f.basic.contribution.monthly_cents = Some("-100000".into());
    }
    let b = s.plan_profile_update(&base, "2026-10-07").unwrap();
    assert_eq!(b.profile.paid_months, Some(0));
    assert_eq!(b.profile.account_balance_cents, Some("0".into()));
    assert_eq!(b.profile.assumptions.wage_growth_hundredths, 300);
    assert_eq!(
        s.plan_profile_update(&next(&s, pension.section, 1), "2026-10-07")
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    let full = ProfileSave {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: Some(3),
        profile: b.profile,
    };
    assert_eq!(
        s.plan_profile_save(&full, "2026-10-07").unwrap_err().code,
        "PLANNING_SCOPED"
    );
}
#[test]
fn null_simulation_and_negative_zero_values_roundtrip_restart_restore_without_creating_facts() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("fictional");
    let mut s = Store::open(&root).unwrap();
    let i = input(&s);
    let a = s.plan_profile_update(&i, "2026-10-07").unwrap();
    for n in [Some("-1"), Some("0"), None] {
        let revision = s.plan_profile().unwrap().saved.unwrap().revision;
        let mut i = input(&s);
        i.request_id = uuid::Uuid::new_v4().to_string();
        i.expected_revision = Some(revision);
        if let Section::Basic(f) = &mut i.section {
            f.basic.contribution.monthly_cents = n.map(str::to_string);
        }
        s.plan_profile_update(&i, "2026-10-07").unwrap();
    }
    assert!(s.wealth_accounts().unwrap().is_empty());
    assert!(s.wealth_summary().unwrap().points.is_empty());
    drop(s);
    let s = Store::open(&root).unwrap();
    let stored = s.plan_profile().unwrap().saved.unwrap();
    assert_eq!(stored.profile, a.profile);
    let backup = d.path().join("fictional.thingary");
    s.backup(Some(&backup)).unwrap();
    let mut restored = Store::open(&d.path().join("restore")).unwrap();
    let info = restored.inspect_backup(&backup).unwrap();
    restored
        .restore(&backup, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.plan_profile().unwrap().saved.unwrap().profile,
        stored.profile
    );
    assert!(restored.wealth_accounts().unwrap().is_empty());
}
#[cfg(feature = "fault-injection")]
#[test]
fn scoped_failure_before_commit_is_atomic_unknown_after_commit_replays_once() {
    use thingary_lib::domain::Error;
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let i = input(&s);
    s.set_hook(|p| {
        if p == "plan_profile.before_commit" {
            Err(Error::new("INJECTED", "虚构提交前故障"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.plan_profile_update(&i, "2026-10-07").unwrap_err().code,
        "INJECTED"
    );
    assert!(s.plan_profile().unwrap().saved.is_none());
    s.set_hook(|p| {
        if p == "plan_profile.after_commit" {
            Err(Error::new("INJECTED", "虚构提交后未知"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.plan_profile_update(&i, "2026-10-07").unwrap_err().code,
        "INJECTED"
    );
    assert_eq!(
        s.wealth_request_result(&i.request_id, &s.generation())
            .unwrap(),
        Some("profile".into())
    );
    s.set_hook(|_| Ok(()));
    assert_eq!(s.plan_profile_update(&i, "2026-10-07").unwrap().revision, 1);
    let count: i64 = s
        .conn_for_test()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM plan_profile", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
#[test]
fn legacy_reset_discards_estimates_and_preserves_facts_and_receipt_in_one_transaction() {
    use thingary_lib::domain::Error;
    use thingary_lib::plan_profile::ProfileSave;
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("fictional");
    let mut s = Store::open(&root).unwrap();
    let (_, mut old): (String, ProfileSave) = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/legacy-receipt.json"
    ))
    .unwrap();
    old.generation = s.generation();
    old.profile.retire.spend_cents = Some("500000".into());
    let a = s.plan_profile_save(&old, "2026-10-07").unwrap();
    assert!(s
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .profile
        .retire
        .basic
        .is_none());
    let mut i = input(&s);
    i.expected_revision = Some(1);
    #[cfg(feature = "fault-injection")]
    {
        s.set_hook(|p| {
            if p == "plan_profile.before_commit" {
                Err(Error::new("INJECTED", "虚构重设中断"))
            } else {
                Ok(())
            }
        });
        assert!(s.plan_profile_update(&i, "2026-10-07").is_err());
        assert!(s
            .plan_profile()
            .unwrap()
            .saved
            .unwrap()
            .profile
            .retire
            .basic
            .is_none());
        s.set_hook(|p| {
            if p == "plan_profile.after_commit" {
                Err(Error::new("INJECTED", "虚构重设未知"))
            } else {
                Ok(())
            }
        });
        assert!(s.plan_profile_update(&i, "2026-10-07").is_err());
        s.set_hook(|_| Ok(()));
    }
    let b = s.plan_profile_update(&i, "2026-10-07").unwrap();
    assert_eq!(b.revision, 2);
    assert!(b.profile.retire.legacy_definition.is_none());
    assert!(b.profile.retire.saving_phases.is_empty());
    assert!(b.profile.retire.route_id.is_none());
    assert_eq!(b.profile.paid_months, a.profile.paid_months);
    assert_eq!(
        b.profile.account_balance_cents,
        a.profile.account_balance_cents
    );
    let active = serde_json::to_value(&b).unwrap();
    for key in [
        "saving_phases",
        "route_id",
        "route_from_age",
        "gap_share_hundredths",
        "gap_keeps_paying",
        "legacy_definition",
    ] {
        assert!(active["profile"]["retire"].get(key).is_none());
    }
    let payload: String = s
        .conn_for_test()
        .unwrap()
        .query_row("SELECT payload FROM plan_profile", [], |r| r.get(0))
        .unwrap();
    assert!(!payload.contains("saving_phases"));
    assert!(!payload.contains("legacy_definition"));
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, b.profile);
    let backup = d.path().join("archive.thingary");
    s.backup(Some(&backup)).unwrap();
    let mut restored = Store::open(&d.path().join("restore")).unwrap();
    let info = restored.inspect_backup(&backup).unwrap();
    restored
        .restore(&backup, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.plan_profile().unwrap().saved.unwrap().profile,
        b.profile
    );
}
#[test]
fn worker_module_switch_is_authoritative_and_skips_corrupt_hidden_wealth_readers() {
    use thingary_lib::{modules::Modules, worker::Worker};
    let d = tempfile::tempdir().unwrap();
    let w = Worker::start(d.path().join("fictional")).unwrap();
    w.switch_demo(false).unwrap();
    w.call(|s| {
        s.plan_profile_update(&input(s), "2026-10-07")?;
        s.conn_for_test()?.execute("DROP TABLE fin_accounts", [])?;
        Ok(())
    })
    .unwrap();
    w.set_modules(Modules {
        wealth: false,
        ..Modules::default()
    })
    .unwrap();
    let r =
        serde_json::to_value(w.planning_sources(true, true, "2026-10-07".into()).unwrap()).unwrap();
    assert_eq!(r["modules"]["wealth"], false);
    assert_eq!(r["profile"]["status"], "ready");
    for name in ["snapshot", "accounts", "review"] {
        assert_eq!(r[name]["value"]["code"], "MODULE_DISABLED");
    }
    let overview = serde_json::to_value(
        w.planning_overview(None, true, "2026-10-07".into())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(overview["wealth"]["value"]["code"], "MODULE_DISABLED");
    assert_eq!(
        overview["planning"]["review"]["value"]["code"],
        "MODULE_DISABLED"
    );
    w.set_modules(Modules {
        planning: false,
        wealth: false,
        ..Modules::default()
    })
    .unwrap();
    let r =
        serde_json::to_value(w.planning_sources(true, true, "2026-10-07".into()).unwrap()).unwrap();
    assert_eq!(r["profile"]["value"]["code"], "MODULE_DISABLED");
}

#[test]
fn setup_fix_false_fingerprint_fallback_is_exact_and_cannot_ignore_basic_or_true_conditions() {
    use thingary_lib::plan_profile::ProfileSave;
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let (_, mut i): (String, ProfileSave) = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/legacy-receipt.json"
    ))
    .unwrap();
    i.generation = s.generation();
    s.plan_profile_save(&i, "2026-10-07").unwrap();
    let bytes = serde_json::to_string(&("plan_profile", &i))
        .unwrap()
        .replacen("\"retire\":{", "\"retire\":{\"setup_completed\":false,", 1);
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE feature_requests SET fingerprint=?1 WHERE id=?2",
            rusqlite::params![Store::digest_for_test(bytes.as_bytes()), i.request_id],
        )
        .unwrap();
    assert_eq!(s.plan_profile_save(&i, "2026-10-07").unwrap().revision, 1);
    i.profile.retire.setup_completed = true;
    assert_eq!(
        s.plan_profile_save(&i, "2026-10-07").unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    i.profile.retire.setup_completed = false;
    if let Section::Basic(f) = input(&s).section {
        i.profile.retire.basic = Some(f.basic);
    }
    assert_eq!(
        s.plan_profile_save(&i, "2026-10-07").unwrap_err().code,
        "REQUEST_CONFLICT"
    );
}

#[test]
fn full_legacy_command_cannot_create_basic_or_skip_existing_reset_confirmation() {
    use thingary_lib::plan_profile::ProfileSave;
    let d = tempfile::tempdir().unwrap();
    let mut prepared = Store::open(&d.path().join("prepared")).unwrap();
    let basic = prepared
        .plan_profile_update(&input(&prepared), "2026-10-07")
        .unwrap()
        .profile;
    let mut s = Store::open(&d.path().join("fresh")).unwrap();
    let mut full = ProfileSave {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: None,
        profile: basic,
    };
    assert_eq!(
        s.plan_profile_save(&full, "2026-10-07").unwrap_err().code,
        "PLANNING_SCOPED"
    );
    assert!(s.plan_profile().unwrap().saved.is_none());
    let (_, mut legacy): (String, ProfileSave) = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/legacy-receipt.json"
    ))
    .unwrap();
    legacy.generation = s.generation();
    s.plan_profile_save(&legacy, "2026-10-07").unwrap();
    full.expected_revision = Some(1);
    assert_eq!(
        s.plan_profile_save(&full, "2026-10-07").unwrap_err().code,
        "PLANNING_SCOPED"
    );
    assert!(s
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .profile
        .retire
        .basic
        .is_none());
}
#[test]
fn incomplete_basic_inputs_save_as_null_and_reject_excluded_loan_or_transfer() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let mut i = input(&s);
    if let Section::Basic(f) = &mut i.section {
        f.birth_month = None;
        f.target_age = None;
        f.spend_cents = None;
        f.basic.retirement_income.mode = None;
    }
    let saved = s.plan_profile_update(&i, "2026-10-07").unwrap();
    assert_eq!(saved.profile.birth_month, None);
    assert_eq!(saved.profile.retire.target_age, None);
    for source in ["event:fictional:loan", "personal_pension"] {
        let mut changed = input(&s);
        changed.request_id = uuid::Uuid::new_v4().to_string();
        changed.expected_revision = Some(1);
        if let Section::Basic(f) = &mut changed.section {
            f.basic.retirement_costs = vec![thingary_lib::plan_basic::CostScope {
                source_id: source.into(),
                treatment: "excluded".into(),
                reference_cents: None,
            }];
        }
        assert!(s.plan_profile_update(&changed, "2026-10-07").is_err());
        assert_eq!(s.plan_profile().unwrap().saved.unwrap().revision, 1);
    }
}

#[test]
fn setup_is_one_revision_and_replays_all_sections_atomically() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let mut json = serde_json::to_value(input(&s)).unwrap();
    let mut basic = json["fields"].take();
    basic["basic"]["retirement_income"] = serde_json::json!({"mode":"manual","selected":[{"id":"annuity","source_id":"annuity","role":"other"}]});
    json["section"] = "setup".into();
    json["fields"] = serde_json::json!({"basic":basic,"funds":null,"pension":null,"budget":{
        "spend_items":[],"income_items":[{"id":"annuity","label":"虚构年金","monthly_cents":"100000","start_age":60,"end_age":null,"indexed":true}],
        "rent_cents":"0","keep_paying_until_age":null,"keep_paying_monthly_cents":"0","keep_paying_base_cents":"0"
    }});
    let u: Update = serde_json::from_value(json.clone()).unwrap();
    let a = s.plan_profile_update(&u, "2026-10-07").unwrap();
    assert_eq!(a.revision, 1);
    assert_eq!(a.profile.retire.income_items.len(), 1);
    assert_eq!(
        serde_json::to_value(s.plan_profile_update(&u, "2026-10-07").unwrap()).unwrap(),
        serde_json::to_value(&a).unwrap()
    );
    json["fields"]["budget"]["income_items"][0]["monthly_cents"] = "200000".into();
    assert_eq!(
        s.plan_profile_update(&serde_json::from_value(json.clone()).unwrap(), "2026-10-07")
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
    json["request_id"] = uuid::Uuid::new_v4().to_string().into();
    json["expected_revision"] = 1.into();
    json["fields"]["budget"]["income_items"][0]["monthly_cents"] = "-1".into();
    assert!(s
        .plan_profile_update(&serde_json::from_value(json).unwrap(), "2026-10-07")
        .is_err());
    assert_eq!(
        serde_json::to_value(s.plan_profile().unwrap().saved.unwrap()).unwrap(),
        serde_json::to_value(&a).unwrap()
    );
}

#[test]
fn pension_only_partial_facts_save_without_creating_a_retirement_plan() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let mut json = serde_json::to_value(input(&s)).unwrap();
    json["section"] = "pension".into();
    json["fields"] = serde_json::json!({"birth_month":"1990-06","worker":null,"region":"beijing","paid_months":12,"account_balance_cents":null,"base_cents":null,"past_index_hundredths":null,"flex_months":null,"personal_pension_annual_cents":null,"marginal_tax_hundredths":null,"wage_growth_hundredths":0,"pp_return_hundredths":0,"overrides":{}});
    let u: Update = serde_json::from_value(json).unwrap();
    let a = s.plan_profile_update(&u, "2026-10-07").unwrap();
    assert_eq!(a.profile.paid_months, Some(12));
    assert!(a.profile.retire.basic.is_none());
    assert_eq!(a.profile.retire.target_age, None);
    let mut b = input(&s);
    b.request_id = uuid::Uuid::new_v4().to_string();
    b.expected_revision = Some(1);
    assert!(s
        .plan_profile_update(&b, "2026-10-07")
        .unwrap()
        .profile
        .retire
        .legacy_definition
        .is_none());
}

#[test]
fn old_backup_reads_facts_only_and_old_receipts_cannot_restore_retired_estimates() {
    use thingary_lib::plan_profile::ProfileSave;
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(&d.path().join("old-library")).unwrap();
    let (_, mut old): (String, ProfileSave) = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/legacy-receipt.json"
    ))
    .unwrap();
    old.generation = s.generation();
    old.profile.retire.spend_cents = Some("500000".into());
    old.profile.retire.route_id = Some("tech".into());
    old.profile.retire.gap_share_hundredths = 1500;
    let raw = serde_json::to_string(&old.profile).unwrap();
    let fingerprint = Store::digest_for_test(&serde_json::to_vec(&("plan_profile", &old)).unwrap());
    s.conn_for_test()
        .unwrap()
        .execute(
            "INSERT INTO plan_profile VALUES(1,?1,1,'2026-10-07T00:00:00Z')",
            [&raw],
        )
        .unwrap();
    s.conn_for_test()
        .unwrap()
        .execute(
            "INSERT INTO feature_requests VALUES(?1,?2,'profile')",
            rusqlite::params![old.request_id, fingerprint],
        )
        .unwrap();
    let before = s.plan_profile().unwrap().saved.unwrap();
    assert_eq!(before.profile.paid_months, old.profile.paid_months);
    assert_eq!(
        before.profile.account_balance_cents,
        old.profile.account_balance_cents
    );
    assert!(before.profile.retire.basic.is_none());
    assert!(before.profile.retire.spend_cents.is_none());
    assert!(before.profile.retire.target_age.is_none());
    assert!(before.profile.retire.saving_phases.is_empty());
    assert!(before.profile.retire.route_id.is_none());
    let still_raw: String = s
        .conn_for_test()
        .unwrap()
        .query_row("SELECT payload FROM plan_profile", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        still_raw, raw,
        "reading an old library must not mutate its bytes or revision"
    );
    let backup = d.path().join("old.thingary");
    s.backup(Some(&backup)).unwrap();
    let mut restored = Store::open(&d.path().join("restored")).unwrap();
    let info = restored.inspect_backup(&backup).unwrap();
    restored
        .restore(&backup, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.plan_profile().unwrap().saved.unwrap().profile,
        before.profile
    );
    assert_eq!(
        restored
            .wealth_request_result(&old.request_id, &restored.generation())
            .unwrap(),
        Some("profile".into())
    );
    let mut setup = input(&s);
    setup.expected_revision = Some(1);
    let general = s.plan_profile_update(&setup, "2026-10-07").unwrap();
    assert!(general.profile.retire.basic.is_some());
    assert_eq!(general.profile.paid_months, old.profile.paid_months);
    assert_eq!(
        s.plan_profile_save(&old, "2026-10-07").unwrap().revision,
        2,
        "historical replay verifies receipt but never reapplies estimates"
    );
    assert_eq!(
        s.plan_profile().unwrap().saved.unwrap().profile,
        general.profile
    );
    old.request_id = uuid::Uuid::new_v4().to_string();
    old.expected_revision = Some(2);
    assert_eq!(
        s.plan_profile_save(&old, "2026-10-07").unwrap_err().code,
        "PLANNING_SCOPED"
    );
    assert_eq!(
        s.plan_profile().unwrap().saved.unwrap().profile,
        general.profile
    );
}
