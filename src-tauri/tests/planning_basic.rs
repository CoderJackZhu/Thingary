//! Strict current scoped transactions, fictional data only.
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

fn next(s: &Store, section: Section, revision: i64) -> Update {
    Update {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: Some(revision),
        section,
    }
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
fn dormant_event_fee_confirmation_survives_saves_without_reducing_active_budget() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    store
        .plan_profile_update(&input(&store), "2026-10-08")
        .unwrap();
    let mut json = serde_json::to_value(input(&store)).unwrap();
    json["request_id"] = serde_json::json!(uuid::Uuid::new_v4().to_string());
    json["expected_revision"] = serde_json::json!(1);
    json["section"] = serde_json::json!("events");
    json["fields"] = serde_json::json!({"occurrences":[],"life_events":[{
        "id":"fictional-car","label":"虚构车","kind":"car","date":"2028-10","included":false,
        "price_cents":"7000000","down_cents":"7000000","extra_cents":"0","loan_rate_hundredths":350,
        "loan_years":3,"holding_cents":"120000","rent_saved_cents":"0","cycle_years":null,"until_month":null,"time_unconfirmed":false,"resale_cents":"0"
    }]});
    let mut events: Update = serde_json::from_value(json).unwrap();
    store.plan_profile_update(&events, "2026-10-08").unwrap();
    let mut basic = input(&store);
    basic.request_id = uuid::Uuid::new_v4().to_string();
    basic.expected_revision = Some(2);
    if let Section::Basic(f) = &mut basic.section {
        f.spend_cents = Some("10000".into());
        f.basic.retirement_costs = vec![thingary_lib::plan_basic::CostScope {
            source_id: "event:fictional-car:holding".into(),
            treatment: "included".into(),
            reference_cents: Some("120000".into()),
        }];
    }
    store.plan_profile_update(&basic, "2026-10-08").unwrap();
    drop(store);
    let mut store = Store::open(dir.path()).unwrap();
    let saved = store.plan_profile().unwrap().saved.unwrap();
    assert_eq!(
        saved.profile.retire.basic.unwrap().retirement_costs[0]
            .reference_cents
            .as_deref(),
        Some("120000")
    );
    events.request_id = uuid::Uuid::new_v4().to_string();
    events.expected_revision = Some(3);
    if let Section::Events(f) = &mut events.section {
        f.life_events[0].included = true;
    }
    // Re-enabling an included amount larger than the budget remains an explicit conflict.
    assert!(store.plan_profile_update(&events, "2026-10-08").is_err());
    assert_eq!(store.plan_profile().unwrap().saved.unwrap().revision, 3);
}

#[test]
fn strict_current_contract_rejects_policy_fields_and_unknown_versus_zero_roundtrips() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let original = s.plan_profile_update(&input(&s), "2026-10-12").unwrap();
    let mut fields = thingary_lib::plan_simplified::Fields::default();
    let update = next(&s, Section::Simplified(fields.clone()), 1);
    let read = s.plan_profile_update(&update, "2026-10-12").unwrap();
    assert_eq!(read.profile.retire.simplified.income_mode, "unconfirmed");
    fields.income_mode = "manual".into();
    fields.time = thingary_lib::plan_simplified::Time {
        reference: None,
        target_month: Some("2030-01".into()),
        horizon_month: Some("2040-01".into()),
    };
    fields.future_incomes=vec![serde_json::from_value(serde_json::json!({"id":"fictional-income","name":"虚构养老金","role":"pension","included":true,"monthly_cents":null,"start_month":null,"end_month":null,"basis":"start_month","basis_month":null,"growth":"fixed_nominal","source":null,"source_checked_on":null,"notes":""})).unwrap()];
    let a = s
        .plan_profile_update(
            &next(&s, Section::Simplified(fields.clone()), 2),
            "2026-10-12",
        )
        .unwrap();
    assert_eq!(
        a.profile.retire.simplified.future_incomes[0].monthly_cents,
        None
    );
    fields.future_incomes[0].monthly_cents = Some("0".into());
    let b = s
        .plan_profile_update(
            &next(&s, Section::Simplified(fields.clone()), 3),
            "2026-10-12",
        )
        .unwrap();
    assert_eq!(
        b.profile.retire.simplified.future_incomes[0].monthly_cents,
        Some("0".into())
    );
    assert_eq!(b.profile.retire.basic, original.profile.retire.basic);
    for key in [
        "birth_month",
        "paid_months",
        "medical_paid_months",
        "region",
        "account_balance_cents",
    ] {
        let mut value = serde_json::to_value(&b.profile).unwrap();
        value[key] = serde_json::json!(0);
        assert!(serde_json::from_value::<thingary_lib::plan_profile::Profile>(value).is_err());
    }
    let mut value = serde_json::to_value(next(&s, Section::Simplified(fields), 4)).unwrap();
    value["section"] = serde_json::json!("pension");
    assert!(serde_json::from_value::<Update>(value).is_err());
    let archive = d.path().join("fictional.thingary");
    s.backup(Some(&archive)).unwrap();
    let bytes = std::fs::read(&archive).unwrap();
    let mut restored = Store::open(&d.path().join("restore")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.plan_profile().unwrap().saved.unwrap().profile,
        b.profile
    );
    assert_eq!(std::fs::read(&archive).unwrap(), bytes);
    assert!(restored.wealth_accounts().unwrap().is_empty());
    assert!(restored.plan_income_list().unwrap().rows.is_empty());
}
#[test]
fn setup_time_income_budget_funds_share_one_revision_and_failure_rolls_back() {
    use thingary_lib::plan_basic::{BudgetFields, FundsFields, SetupFields};
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let Section::Basic(basic) = input(&s).section else {
        panic!("fixture")
    };
    let mut fields = thingary_lib::plan_simplified::Fields {
        income_mode: "excluded".into(),
        ..Default::default()
    };
    fields.time.target_month = Some("2030-01".into());
    fields.time.horizon_month = Some("2040-01".into());
    let setup = Update {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: None,
        section: Section::Setup(Box::new(SetupFields {
            basic: basic.clone(),
            budget: Some(BudgetFields {
                spend_items: vec![],
                rent_cents: "0".into(),
            }),
            funds: Some(FundsFields {
                monetary_basis_date: basic.monetary_basis_date,
                fund_rules: vec![],
                releases: vec![],
            }),
            simplified: fields.clone(),
        })),
    };
    s.set_hook(|p| {
        if p == "plan_profile.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.plan_profile_update(&setup, "2026-10-12").is_err());
    assert!(s.plan_profile().unwrap().saved.is_none());
    assert_eq!(
        s.wealth_request_result(&setup.request_id, &s.generation())
            .unwrap(),
        None
    );
    s.set_hook(|p| {
        if p == "plan_profile.after_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构失联"))
        } else {
            Ok(())
        }
    });
    assert!(s.plan_profile_update(&setup, "2026-10-12").is_err());
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.wealth_request_result(&setup.request_id, &s.generation())
            .unwrap(),
        Some("profile".into())
    );
    let saved = s.plan_profile_update(&setup, "2026-10-12").unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(saved.profile.retire.simplified, fields);
    let mut changed = setup.clone();
    if let Section::Setup(f) = &mut changed.section {
        f.simplified.income_mode = "unconfirmed".into();
    }
    assert_eq!(
        s.plan_profile_update(&changed, "2026-10-12")
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
}
#[test]
fn future_income_boundary_validation_is_strict_but_incomplete_inputs_can_save() {
    let base:thingary_lib::plan_simplified::Fields=serde_json::from_value(serde_json::json!({"contract_version":1,"time":{"reference":{"month":"2026-10","age_months":360},"target_month":"2030-01","horizon_month":"2040-01"},"income_mode":"manual","future_incomes":[{"id":"fictional","name":"虚构一般收入","role":"other","included":true,"monthly_cents":null,"start_month":null,"end_month":null,"basis":"start_month","basis_month":null,"growth":"constant_purchasing_power","source":null,"source_checked_on":null,"notes":""}]})).unwrap();
    assert!(base.validate("2026-10-12").is_ok());
    let mut max = base.clone();
    max.future_incomes[0].monthly_cents = Some("99999999999".into());
    assert!(max.validate("2026-10-12").is_ok());
    for (key, v) in [
        ("monthly_cents", serde_json::json!("01")),
        ("monthly_cents", serde_json::json!("100000000000")),
        ("start_month", serde_json::json!("2026-13")),
        ("source_checked_on", serde_json::json!("2026-10-13")),
        ("basis", serde_json::json!("reference_month")),
        ("growth", serde_json::json!("policy")),
    ] {
        let mut j = serde_json::to_value(&base).unwrap();
        j["future_incomes"][0][key] = v;
        let f: thingary_lib::plan_simplified::Fields = serde_json::from_value(j).unwrap();
        assert!(f.validate("2026-10-12").is_err(), "{key}");
    }
    let mut f = base.clone();
    f.future_incomes[0].start_month = Some("2026-10".into());
    f.future_incomes[0].end_month = Some("2026-10".into());
    assert!(f.validate("2026-10-12").is_ok());
    f.future_incomes[0].end_month = Some("2026-09".into());
    assert!(f.validate("2026-10-12").is_err());
    f = base.clone();
    f.future_incomes.push(f.future_incomes[0].clone());
    assert!(f.validate("2026-10-12").is_err());
    f = base;
    f.time.reference.as_mut().unwrap().month = "2026-11".into();
    assert!(f.validate("2026-10-12").is_err());
}

#[test]
fn general_arrangements_preserve_personal_pension_and_housing_account_facts() {
    use thingary_lib::plan_basic::FundsFields;
    use thingary_lib::plan_core::{FundRelease, FundRule};
    use thingary_lib::wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave};
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let today = "2026-10-12";
    let mut accounts = vec![];
    for (name, kind) in [
        ("虚构现金", "cash"),
        ("虚构个人养老金真实账户", "other_asset"),
        ("虚构公积金真实账户", "housing_fund"),
    ] {
        accounts.push(
            s.wealth_account_save(
                &AccountSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    id: None,
                    expected_revision: None,
                    fields: AccountFields {
                        name: name.into(),
                        institution: "虚构机构".into(),
                        side: "asset".into(),
                        kind: kind.into(),
                        counted: true,
                        opened_on: "2026-01-01".into(),
                        closed_on: None,
                        notes: "虚构客观事实，不是公式余额".into(),
                        purchase_cents: None,
                        purchased_on: None,
                        currency: "CNY".into(),
                    },
                },
                today,
            )
            .unwrap(),
        );
    }
    let snapshot = s
        .wealth_snapshot_save(
            &SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: "2026-10-07".into(),
                notes: "虚构盘点".into(),
                entries: accounts
                    .iter()
                    .zip([Some("10000"), Some("5000"), None])
                    .map(|(a, n)| EntryInput {
                        account_id: a.id.clone(),
                        state: if n.is_some() { "entered" } else { "missing" }.into(),
                        amount_cents: n.map(str::to_string),
                        original_minor: None,
                        fx_rate_micro: None,
                    })
                    .collect(),
            },
            today,
        )
        .unwrap();
    let original_accounts = serde_json::to_value(s.wealth_accounts().unwrap()).unwrap();
    let original_snapshot = serde_json::to_value(&snapshot).unwrap();
    s.plan_profile_update(&input(&s), today).unwrap();
    let funds = FundsFields {
        monetary_basis_date: "2026-10-07".into(),
        fund_rules: accounts
            .iter()
            .enumerate()
            .map(|(n, a)| FundRule {
                account_id: a.id.clone(),
                availability: if n == 0 { "available" } else { "restricted" }.into(),
                share_hundredths: 10000,
            })
            .collect(),
        releases: vec![
            FundRelease {
                id: "fictional-pension-release".into(),
                account_id: accounts[1].id.clone(),
                month: "2030-01".into(),
                net_cents: Some("5000".into()),
                estimated: false,
                excludes_future_deposits: true,
            },
            FundRelease {
                id: "fictional-hpf-release".into(),
                account_id: accounts[2].id.clone(),
                month: "2030-01".into(),
                net_cents: None,
                estimated: false,
                excludes_future_deposits: true,
            },
        ],
    };
    let saved = s
        .plan_profile_update(&next(&s, Section::Funds(funds.clone()), 1), today)
        .unwrap();
    assert_eq!(saved.revision, 2);
    assert_eq!(
        saved.profile.retire.core.as_ref().unwrap().releases[1].net_cents,
        None
    );
    assert_eq!(
        serde_json::to_value(s.wealth_accounts().unwrap()).unwrap(),
        original_accounts
    );
    assert_eq!(
        serde_json::to_value(s.wealth_snapshot(&snapshot.id).unwrap().unwrap()).unwrap(),
        original_snapshot
    );
    assert!(s.plan_income_list().unwrap().rows.is_empty());
    let mut duplicate = funds.clone();
    duplicate.releases.push(duplicate.releases[0].clone());
    assert!(s
        .plan_profile_update(&next(&s, Section::Funds(duplicate), 2), today)
        .is_err());
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().revision, 2);
    let backup = d.path().join("fictional.thingary");
    s.backup(Some(&backup)).unwrap();
    let mut restored = Store::open(&d.path().join("restored")).unwrap();
    let info = restored.inspect_backup(&backup).unwrap();
    restored
        .restore(&backup, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        serde_json::to_value(restored.wealth_accounts().unwrap()).unwrap(),
        original_accounts
    );
    assert_eq!(
        serde_json::to_value(restored.wealth_snapshot(&snapshot.id).unwrap().unwrap()).unwrap(),
        original_snapshot
    );
    assert_eq!(
        restored.plan_profile().unwrap().saved.unwrap().profile,
        saved.profile
    );
    assert!(restored.plan_income_list().unwrap().rows.is_empty());
}
