//! Planning stage 2: the personal profile behind the pension estimate.
//! Fictional data only; the profile is sensitive and must never be a fixture
//! of real values.
use rusqlite::Connection;
use thingary_lib::{
    domain::Error,
    plan_profile::{
        Assumptions, IncomeItem, LifeEvent, Overrides, Profile, ProfileSave, Retire, SavingPhase,
        SpendItem,
    },
    storage::{migrate_to, Store, SCHEMA, SCHEMA_VERSION},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}
fn profile() -> Profile {
    Profile {
        birth_month: Some("1990-06".into()),
        worker: Some("male".into()),
        region: Some("beijing".into()),
        paid_months: Some(48),
        account_balance_cents: Some("5000000".into()),
        base_cents: Some("2000000".into()),
        past_index_hundredths: None,
        flex_months: Some(0),
        personal_pension_annual_cents: Some("1200000".into()),
        marginal_tax_hundredths: Some(1000),
        assumptions: Assumptions {
            inflation_hundredths: 200,
            wage_growth_hundredths: 300,
            pp_return_hundredths: 200,
        },
        overrides: Overrides::default(),
        retire: Retire::default(),
    }
}
fn save(s: &Store, p: Profile, expected: Option<i64>) -> ProfileSave {
    ProfileSave {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: expected,
        profile: p,
    }
}

// Compare objective sources, not retired forecast assumptions.
fn assert_facts(a: &Profile, e: &Profile) {
    let mut actual = serde_json::to_value(a).unwrap();
    let mut expected = serde_json::to_value(e).unwrap();
    actual.as_object_mut().unwrap().remove("retire");
    expected.as_object_mut().unwrap().remove("retire");
    assert_eq!(actual, expected);
    assert_eq!(
        a.retire.core.as_ref().map(|c| &c.occurrences),
        e.retire.core.as_ref().map(|c| &c.occurrences)
    );
    assert_eq!(
        a.retire.core.as_ref().map(|c| &c.fund_rules),
        e.retire.core.as_ref().map(|c| &c.fund_rules)
    );
    let defs = |p: &Profile| {
        p.retire
            .life_events
            .iter()
            .map(|e| {
                let mut v = serde_json::to_value(e).unwrap();
                v.as_object_mut().unwrap().remove("included");
                v
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(defs(a), defs(e));
    assert!(a.retire.saving_phases.is_empty());
    assert!(a.retire.route_id.is_none());
    assert!(a.retire.legacy_definition.is_none());
}
fn event_update(s: &Store, p: &Profile, revision: i64) -> thingary_lib::plan_basic::Update {
    let c = p.retire.core.as_ref().unwrap();
    thingary_lib::plan_basic::Update {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: Some(revision),
        section: thingary_lib::plan_basic::Section::Events(
            thingary_lib::plan_basic::EventsFields {
                life_events: p.retire.life_events.clone(),
                occurrences: c.occurrences.clone(),
                legacy_costs: None,
            },
        ),
    }
}

#[test]
fn profile_saves_once_then_by_revision_and_replays_requests() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    assert!(s.plan_profile().unwrap().saved.is_none());

    let first = save(&s, profile(), None);
    let a = s.plan_profile_save(&first, TODAY).unwrap();
    let b = s.plan_profile_save(&first, TODAY).unwrap();
    assert_eq!(
        (a.revision, b.revision),
        (1, 1),
        "a retried request is a no-op"
    );
    let saved = s.plan_profile().unwrap().saved.unwrap();
    assert_facts(&saved.profile, &profile());
    assert!(chrono::DateTime::parse_from_rfc3339(&saved.updated_at).is_ok());

    // A second create (no expected revision) and a stale edit are both refused.
    assert_eq!(
        code(s.plan_profile_save(&save(&s, profile(), None), TODAY)),
        "REVISION_CONFLICT"
    );
    let mut edited = profile();
    edited.paid_months = Some(60);
    let full = save(&s, edited.clone(), Some(1));
    assert_eq!(code(s.plan_profile_save(&full, TODAY)), "PLANNING_SCOPED");
    let pension=serde_json::from_value(serde_json::json!({"section":"pension","fields":{
        "birth_month":edited.birth_month,"worker":edited.worker,"region":edited.region,"paid_months":edited.paid_months,"account_balance_cents":edited.account_balance_cents,"base_cents":edited.base_cents,"past_index_hundredths":edited.past_index_hundredths,"flex_months":edited.flex_months,"personal_pension_annual_cents":edited.personal_pension_annual_cents,"marginal_tax_hundredths":edited.marginal_tax_hundredths,"wage_growth_hundredths":300,"pp_return_hundredths":200,"overrides":edited.overrides}})).unwrap();
    let ok = s
        .plan_profile_update(
            &thingary_lib::plan_basic::Update {
                request_id: rid(),
                generation: s.generation(),
                expected_revision: Some(1),
                section: pension,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!((ok.revision, ok.profile.paid_months), (2, Some(60)));
    assert_eq!(
        code(s.plan_profile_save(&save(&s, profile(), Some(1)), TODAY)),
        "REVISION_CONFLICT"
    );
    // Reusing a request id for other content is refused.
    let mut other = first.clone();
    other.profile.paid_months = Some(1);
    assert_eq!(code(s.plan_profile_save(&other, TODAY)), "REQUEST_CONFLICT");
    // An older library generation is refused.
    let mut old = save(&s, edited, Some(2));
    old.generation = "not-this-library".into();
    assert!(s.plan_profile_save(&old, TODAY).is_err());
}

#[test]
fn profile_validation_names_the_bad_field() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    type Change = Box<dyn Fn(&mut Profile)>;
    let cases: Vec<(Change, &str)> = vec![
        (
            Box::new(|p| p.birth_month = Some("1990-13".into())),
            "PROFILE_BIRTH",
        ),
        (
            Box::new(|p| p.birth_month = Some("2026-12".into())),
            "PROFILE_BIRTH",
        ),
        (
            Box::new(|p| p.birth_month = Some("1990-6".into())),
            "PROFILE_BIRTH",
        ),
        (
            Box::new(|p| p.worker = Some("other".into())),
            "PROFILE_WORKER",
        ),
        (
            Box::new(|p| p.region = Some("shanghai".into())),
            "PROFILE_REGION",
        ),
        (Box::new(|p| p.paid_months = Some(1201)), "PROFILE_MONTHS"),
        (
            Box::new(|p| p.account_balance_cents = Some("-1".into())),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|p| p.base_cents = Some("".into())),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|p| p.past_index_hundredths = Some(0)),
            "PROFILE_INDEX",
        ),
        (Box::new(|p| p.flex_months = Some(37)), "PROFILE_FLEX"),
        (
            Box::new(|p| p.retire.spend_cents = Some("0".into())),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|p| p.retire.real_return_before_hundredths = 2001),
            "PROFILE_RATE",
        ),
        (Box::new(|p| p.retire.horizon_age = 69), "PROFILE_RETIRE"),
        (
            Box::new(|p| p.retire.emergency_months = 37),
            "PROFILE_RETIRE",
        ),
        (Box::new(|p| p.flex_months = Some(-37)), "PROFILE_FLEX"),
        (
            Box::new(|p| p.personal_pension_annual_cents = Some("1200001".into())),
            "PROFILE_PENSION",
        ),
        (
            Box::new(|p| p.marginal_tax_hundredths = Some(4501)),
            "PROFILE_RATE",
        ),
        (
            Box::new(|p| p.assumptions.inflation_hundredths = 2001),
            "PROFILE_RATE",
        ),
        (
            Box::new(|p| p.overrides.base_upper_cents = Some("0".into())),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|p| {
                p.overrides.base_lower_cents = Some("900000".into());
                p.overrides.base_upper_cents = Some("800000".into());
            }),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|p| p.overrides.notional_rate_hundredths = Some(3001)),
            "PROFILE_RATE",
        ),
    ];
    for (change, want) in cases {
        let mut p = profile();
        change(&mut p);
        assert_eq!(code(s.plan_profile_save(&save(&s, p, None), TODAY)), want);
    }
    assert!(
        s.plan_profile().unwrap().saved.is_none(),
        "nothing was stored"
    );
    // Zero is allowed: no personal pension, nothing paid yet, no balance.
    let mut zero = profile();
    zero.personal_pension_annual_cents = Some("0".into());
    zero.paid_months = Some(0);
    zero.account_balance_cents = Some("0".into());
    s.plan_profile_save(&save(&s, zero, None), TODAY).unwrap();
}

#[test]
fn unknown_fields_are_rejected_and_a_failed_commit_leaves_nothing() {
    let mut raw = serde_json::to_value(profile()).unwrap();
    raw["extra"] = serde_json::json!(1);
    assert!(serde_json::from_value::<Profile>(raw).is_err());

    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let input = save(&s, profile(), None);
    s.set_hook(|p| {
        if p == "plan_profile.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.plan_profile_save(&input, TODAY)), "INJECTED");
    assert!(s.plan_profile().unwrap().saved.is_none());
    s.set_hook(|_| Ok(()));
    assert_eq!(s.plan_profile_save(&input, TODAY).unwrap().revision, 1);
}

#[test]
fn schema_29_libraries_upgrade_and_profiles_survive_backup_and_restore() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 29, &|_| Ok(())).unwrap();
    let before: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='plan_profile'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, 0);
    migrate_to(&c, SCHEMA_VERSION, &|_| Ok(())).unwrap();
    let after: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='plan_profile'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after, 1);

    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("a")).unwrap();
    let mut p = profile();
    p.overrides.avg_wage_cents = Some("1300000".into());
    p.overrides.hpf_rate_hundredths = Some(170);
    s.plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    let file = dir.path().join("备份.thingary");
    s.backup(Some(&file)).unwrap();
    drop(s);
    let mut t = Store::open(&dir.path().join("b")).unwrap();
    let summary = t.inspect_backup(&file).unwrap();
    t.restore(&file, &summary.hash, &t.generation()).unwrap();
    assert_eq!(t.plan_profile().unwrap().saved.unwrap().profile, p);
}

#[test]
fn a_stage_2_profile_without_retirement_fields_loads_with_defaults() {
    let mut raw = serde_json::to_value(profile()).unwrap();
    raw.as_object_mut().unwrap().remove("retire");
    let p: Profile = serde_json::from_value(raw).unwrap();
    assert_eq!(p.retire, Retire::default());
    assert_eq!((p.retire.horizon_age, p.retire.emergency_months), (90, 6));
    let mut custom = profile();
    custom.retire = Retire {
        spend_cents: Some("800000".into()),
        real_return_before_hundredths: 100,
        real_return_after_hundredths: 50,
        horizon_age: 95,
        emergency_months: 9,
        ..Retire::default()
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    s.plan_profile_save(&save(&s, custom.clone(), None), TODAY)
        .unwrap();
    assert_facts(&s.plan_profile().unwrap().saved.unwrap().profile, &custom);
}

fn spend(id: &str) -> SpendItem {
    SpendItem {
        id: id.into(),
        label: "医疗".into(),
        monthly_cents: "50000".into(),
        start_age: Some(65),
        end_age: None,
        inflation_hundredths: Some(400),
        essential: true,
    }
}
fn income(id: &str) -> IncomeItem {
    IncomeItem {
        id: id.into(),
        label: "企业年金".into(),
        monthly_cents: "100000".into(),
        start_age: 60,
        end_age: None,
        indexed: false,
    }
}

#[test]
fn a_profile_saved_before_plan_types_loads_and_new_fields_round_trip() {
    let mut raw = serde_json::to_value(profile()).unwrap();
    let r = raw["retire"].as_object_mut().unwrap();
    for k in [
        "mode",
        "target_age",
        "volatility_hundredths",
        "spend_items",
        "income_items",
    ] {
        r.remove(k);
    }
    let p: Profile = serde_json::from_value(raw).unwrap();
    assert_eq!(p.retire, Retire::default());
    assert_eq!(
        (
            p.retire.mode.as_str(),
            p.retire.target_age,
            p.retire.volatility_hundredths
        ),
        ("fire", None, 500)
    );
    let mut custom = profile();
    custom.retire = Retire {
        mode: "traditional".into(),
        target_age: Some(60),
        volatility_hundredths: 1200,
        spend_items: vec![spend("a")],
        income_items: vec![income("b")],
        saving_phases: vec![phase("p1", 0, -600000), phase("p2", 300, 1700000)],
        ..Retire::default()
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    s.plan_profile_save(&save(&s, custom.clone(), None), TODAY)
        .unwrap();
    assert_facts(&s.plan_profile().unwrap().saved.unwrap().profile, &custom);
}

#[test]
fn plan_type_items_and_volatility_are_validated() {
    type Change = Box<dyn Fn(&mut Retire)>;
    let cases: Vec<(Change, &str)> = vec![
        (Box::new(|_| {}), ""),
        (Box::new(|r| r.mode = "coast".into()), "PROFILE_RETIRE"),
        (Box::new(|r| r.target_age = Some(19)), "PROFILE_RETIRE"),
        (Box::new(|r| r.target_age = Some(90)), "PROFILE_RETIRE"),
        (Box::new(|r| r.volatility_hundredths = 6001), "PROFILE_RATE"),
        (
            Box::new(|r| r.spend_items.push(spend("a"))),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.income_items[0].id = "a".into()),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.spend_items[0].label = " ".into()),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.spend_items[0].monthly_cents = "0".into()),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|r| r.spend_items[0].start_age = Some(121)),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| {
                r.spend_items[0].start_age = Some(70);
                r.spend_items[0].end_age = Some(70);
            }),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.spend_items[0].inflation_hundredths = Some(2001)),
            "PROFILE_RATE",
        ),
        (
            Box::new(|r| r.income_items[0].end_age = Some(60)),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| {
                r.income_items = (0..21).map(|n| income(&format!("i{n}"))).collect();
            }),
            "PROFILE_RETIRE",
        ),
    ];
    for (i, (change, want)) in cases.into_iter().enumerate() {
        let mut p = profile();
        p.retire.spend_items = vec![spend("a")];
        p.retire.income_items = vec![income("b")];
        change(&mut p.retire);
        let got = p.validate(TODAY).err().map(|e| e.code).unwrap_or_default();
        assert_eq!(got, want, "case {i}");
    }
}

fn phase(id: &str, from: u32, cents: i64) -> SavingPhase {
    SavingPhase {
        id: id.into(),
        label: "阶段".into(),
        from_age_months: from,
        monthly_cents: cents,
    }
}

#[test]
fn saving_phases_are_ordered_bounded_and_may_be_negative() {
    type Change = Box<dyn Fn(&mut Retire)>;
    let cases: Vec<(Change, &str)> = vec![
        (Box::new(|_| {}), ""),
        (Box::new(|r| r.gap_share_hundredths = 5000), ""),
        (Box::new(|r| r.gap_share_hundredths = 5001), "PROFILE_RATE"),
        (Box::new(|r| r.gap_share_hundredths = -1), "PROFILE_RATE"),
        (
            Box::new(|r| r.saving_phases[0].monthly_cents = -100_000_001),
            "PROFILE_AMOUNT",
        ),
        (
            Box::new(|r| r.saving_phases[1].from_age_months = 0),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.saving_phases[1].from_age_months = 1441),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.saving_phases[1].id = "a".into()),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.saving_phases[0].label = " ".into()),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| {
                r.saving_phases = (0..31)
                    .map(|n| phase(&format!("p{n}"), n * 12, 1))
                    .collect();
            }),
            "PROFILE_RETIRE",
        ),
    ];
    for (i, (change, want)) in cases.into_iter().enumerate() {
        let mut p = profile();
        p.retire.saving_phases = vec![phase("a", 100, -600000), phase("b", 300, 800000)];
        change(&mut p.retire);
        let got = p.validate(TODAY).err().map(|e| e.code).unwrap_or_default();
        assert_eq!(got, want, "case {i}");
    }
}

fn event(id: &str) -> LifeEvent {
    LifeEvent {
        id: id.into(),
        label: "买房".into(),
        kind: "house".into(),
        date: "2033-10".into(),
        included: true,
        price_cents: "45000000".into(),
        down_cents: "15000000".into(),
        extra_cents: "1000000".into(),
        loan_rate_hundredths: 350,
        loan_years: 30,
        holding_cents: "150000".into(),
        rent_saved_cents: "270000".into(),
        cycle_years: None,
        until_age: None,
        resale_cents: "0".into(),
    }
}

#[test]
fn life_events_are_validated_and_round_trip() {
    type Change = Box<dyn Fn(&mut LifeEvent)>;
    let cases: Vec<(Change, &str)> = vec![
        (Box::new(|_| {}), ""),
        (
            Box::new(|e| {
                e.kind = "car".into();
                e.cycle_years = Some(5);
                e.until_age = Some(60);
            }),
            "",
        ),
        (Box::new(|e| e.kind = "boat".into()), "PROFILE_RETIRE"),
        (Box::new(|e| e.date = "2033-13".into()), "PROFILE_RETIRE"),
        (Box::new(|e| e.date = "2033-1".into()), "PROFILE_RETIRE"),
        (Box::new(|e| e.price_cents = "0".into()), "PROFILE_AMOUNT"),
        (
            Box::new(|e| e.down_cents = "45000001".into()),
            "PROFILE_AMOUNT",
        ),
        (Box::new(|e| e.extra_cents = "-1".into()), "PROFILE_AMOUNT"),
        (Box::new(|e| e.loan_rate_hundredths = 2001), "PROFILE_RATE"),
        (Box::new(|e| e.loan_years = 0), "PROFILE_RETIRE"),
        (Box::new(|e| e.cycle_years = Some(41)), "PROFILE_RETIRE"),
        (Box::new(|e| e.until_age = Some(121)), "PROFILE_RETIRE"),
        (Box::new(|e| e.label = " ".into()), "PROFILE_RETIRE"),
    ];
    for (i, (change, want)) in cases.into_iter().enumerate() {
        let mut p = profile();
        p.retire.life_events = vec![event("a")];
        change(&mut p.retire.life_events[0]);
        let got = p.validate(TODAY).err().map(|e| e.code).unwrap_or_default();
        assert_eq!(got, want, "case {i}");
    }
    let mut dup = profile();
    dup.retire.life_events = vec![event("a"), event("a")];
    assert_eq!(dup.validate(TODAY).unwrap_err().code, "PROFILE_RETIRE");
    let mut many = profile();
    many.retire.life_events = (0..21).map(|n| event(&format!("e{n}"))).collect();
    assert_eq!(many.validate(TODAY).unwrap_err().code, "PROFILE_RETIRE");
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut ok = profile();
    ok.retire.life_events = vec![event("a"), event("b")];
    s.plan_profile_save(&save(&s, ok.clone(), None), TODAY)
        .unwrap();
    assert_facts(&s.plan_profile().unwrap().saved.unwrap().profile, &ok);
}

#[test]
fn the_career_route_is_bounded_and_round_trips() {
    let mut p = profile();
    p.retire.route_id = Some("soe".into());
    p.retire.route_from_age = 35;
    assert!(p.validate(TODAY).is_ok());
    for (age, id, want) in [
        (19, "soe", "PROFILE_RETIRE"),
        (71, "soe", "PROFILE_RETIRE"),
        (35, "", "PROFILE_RETIRE"),
    ] {
        let mut q = profile();
        q.retire.route_id = Some(id.into());
        q.retire.route_from_age = age;
        assert_eq!(q.validate(TODAY).unwrap_err().code, want);
    }
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    s.plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    assert_facts(&s.plan_profile().unwrap().saved.unwrap().profile, &p);
    assert_eq!(Retire::default().route_id, None);
}

#[test]
fn leaving_work_costs_default_to_none_for_older_profiles_and_are_validated() {
    // 升级前保存的资料没有这几个字段：照常读取，默认值等于「没有」。
    let mut raw = serde_json::to_value(profile()).unwrap();
    let retire = raw["retire"].as_object_mut().unwrap();
    for key in [
        "keep_paying_until_age",
        "keep_paying_monthly_cents",
        "keep_paying_base_cents",
        "gap_keeps_paying",
        "rent_cents",
    ] {
        retire.remove(key);
    }
    let old: Profile = serde_json::from_value(raw).unwrap();
    assert_eq!(old.retire, Retire::default());
    assert_eq!(old.retire.keep_paying_until_age, None);
    assert_eq!(
        (
            old.retire.keep_paying_monthly_cents.as_str(),
            old.retire.rent_cents.as_str(),
            old.retire.gap_keeps_paying
        ),
        ("0", "0", false)
    );
    old.validate(TODAY).unwrap();

    type Change = Box<dyn Fn(&mut Retire)>;
    let cases: Vec<(Change, &str)> = vec![
        (
            Box::new(|r| {
                r.keep_paying_until_age = Some(60);
                r.keep_paying_monthly_cents = "212000".into();
                r.keep_paying_base_cents = "727000".into();
                r.rent_cents = "600000".into();
                r.gap_keeps_paying = true;
            }),
            "",
        ),
        (
            Box::new(|r| r.keep_paying_until_age = Some(19)),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.keep_paying_until_age = Some(71)),
            "PROFILE_RETIRE",
        ),
        (
            Box::new(|r| r.keep_paying_monthly_cents = "-1".into()),
            "PROFILE_AMOUNT",
        ),
        (Box::new(|r| r.rent_cents = "abc".into()), "PROFILE_AMOUNT"),
        (
            Box::new(|r| r.keep_paying_base_cents = "".into()),
            "PROFILE_AMOUNT",
        ),
    ];
    for (i, (change, want)) in cases.into_iter().enumerate() {
        let mut p = profile();
        change(&mut p.retire);
        let got = p.validate(TODAY).err().map(|e| e.code).unwrap_or_default();
        assert_eq!(got, want, "case {i}");
    }
}

fn core_fixture(s: &mut Store) -> (Profile, String, String) {
    use thingary_lib::{
        plan_core::{Core, FundRule, Occurrence, Payment},
        wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
    };
    let account = s
        .wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: "虚构可用账户".into(),
                    institution: "虚构".into(),
                    side: "asset".into(),
                    kind: "cash".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    let snapshot = s
        .wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: "2026-10-31".into(),
                notes: "虚构完整盘点".into(),
                entries: vec![EntryInput {
                    account_id: account.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some("70000000".into()),
                }],
            },
            TODAY,
        )
        .unwrap();
    let mut p = profile();
    p.retire.saving_phases = vec![SavingPhase {
        id: "phase".into(),
        label: "明确零".into(),
        from_age_months: 0,
        monthly_cents: 0,
    }];
    p.retire.life_events = vec![LifeEvent {
        id: "event".into(),
        label: "虚构已购物品".into(),
        kind: "other".into(),
        date: "2026-09".into(),
        included: false,
        price_cents: "30000000".into(),
        down_cents: "30000000".into(),
        extra_cents: "0".into(),
        loan_rate_hundredths: 0,
        loan_years: 1,
        holding_cents: "0".into(),
        rent_saved_cents: "0".into(),
        cycle_years: None,
        until_age: None,
        resale_cents: "0".into(),
    }];
    p.retire.core = Some(Core {
        debt_repayments: vec![],
        contract_version: 1,
        monetary_basis_date: "2026-10-07".into(),
        fund_rules: vec![FundRule {
            account_id: account.id.clone(),
            availability: "available".into(),
            share_hundredths: 10000,
        }],
        hpf_monthly_cents: Some("0".into()),
        personal_pension_account_id: None,
        personal_pension_balance_confirmed: true,
        costs: vec![],
        occurrences: vec![Occurrence {
            id: rid(),
            event_id: "event".into(),
            status: "occurred".into(),
            actual_date: "2026-09-01".into(),
            payments_complete: true,
            payments: vec![Payment {
                id: rid(),
                date: "2026-09-01".into(),
                amount_cents: Some("30000000".into()),
                account_id: Some(account.id.clone()),
                absorbed_snapshot_id: Some(snapshot.id.clone()),
                absorbed_revision: Some(snapshot.revision),
                source_kind: None,
                source_id: None,
            }],
            loan: None,
        }],
    });
    (p, account.id, snapshot.id)
}

#[test]
fn core_committed_unknown_receipt_restart_restore_and_conflict_preserve_one_occurrence() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("fictional");
    let mut s = Store::open(&root).unwrap();
    let (p, _, snapshot) = core_fixture(&mut s);
    let input = save(&s, p.clone(), None);
    s.set_hook(|point| {
        if point == "plan_profile.before_commit" {
            Err(Error::new("INJECTED", "事务提交前中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.plan_profile_save(&input, TODAY)), "INJECTED");
    assert!(s.plan_profile().unwrap().saved.is_none());
    s.set_hook(|point| {
        if point == "plan_profile.after_commit" {
            Err(Error::new("INJECTED", "提交成功后回执丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.plan_profile_save(&input, TODAY)), "INJECTED");
    s.set_hook(|_| Ok(()));
    assert_eq!(s.plan_profile_save(&input, TODAY).unwrap().revision, 1);
    assert_eq!(
        code(s.plan_profile_save(&save(&s, p.clone(), None), TODAY)),
        "REVISION_CONFLICT"
    );
    let mut cancelled = p.clone();
    cancelled.retire.core.as_mut().unwrap().occurrences.clear();
    assert_eq!(
        code(s.plan_profile_save(&save(&s, cancelled, Some(1)), TODAY)),
        "PLANNING_SCOPED"
    );
    let mut basis = p.clone();
    basis.retire.core.as_mut().unwrap().monetary_basis_date = "2026-10-08".into();
    assert_eq!(
        code(s.plan_profile_save(&save(&s, basis, Some(1)), TODAY)),
        "PLANNING_SCOPED"
    );
    drop(s);
    let s = Store::open(&root).unwrap();
    let read = s.plan_profile().unwrap().saved.unwrap();
    assert_facts(&read.profile, &p);
    assert!(read.reference_issues.is_empty());
    let file = dir.path().join("fictional.thingary");
    s.backup(Some(&file)).unwrap();
    let mut restored = Store::open(&dir.path().join("restored")).unwrap();
    let summary = restored.inspect_backup(&file).unwrap();
    assert_eq!(summary.schema, SCHEMA_VERSION as u32);
    restored
        .restore(&file, &summary.hash, &restored.generation())
        .unwrap();
    assert_facts(&restored.plan_profile().unwrap().saved.unwrap().profile, &p);
    assert_eq!(
        restored
            .wealth_snapshot(&snapshot)
            .unwrap()
            .unwrap()
            .entries[0]
            .amount_cents,
        Some("70000000".into())
    );
}

#[test]
fn core_referenced_sources_cannot_delete_and_corrections_raise_read_time_missing() {
    use thingary_lib::{
        expenses::{Fields, Save},
        wealth::{EntryInput, SnapshotSave, TrashChange},
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("fictional")).unwrap();
    let (mut p, account, snapshot) = core_fixture(&mut s);
    let expense = s
        .expense_save(
            &Save {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    title: "虚构已付首付款".into(),
                    date: "2026-09-01".into(),
                    amount_cents: "30000000".into(),
                    category: "other".into(),
                    notes: String::new(),
                    refund_cents: None,
                    refund_date: None,
                    asset_id: None,
                },
            },
            TODAY,
        )
        .unwrap();
    let payment = &mut p.retire.core.as_mut().unwrap().occurrences[0].payments[0];
    payment.source_kind = Some("expense".into());
    payment.source_id = Some(expense.id.clone());
    s.plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    for (kind, id, revision) in [
        ("snapshot", snapshot.clone(), 1),
        ("expense", expense.id.clone(), 1),
    ] {
        assert_eq!(
            code(s.wealth_trash(&TrashChange {
                request_id: rid(),
                generation: s.generation(),
                kind: kind.into(),
                id,
                expected_revision: revision,
                deleted: true
            })),
            "PLANNING_DEPENDENCY"
        );
    }
    let mut fields = expense.fields.clone();
    fields.amount_cents = "30000001".into();
    s.expense_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: Some(expense.id.clone()),
            expected_revision: Some(1),
            fields,
        },
        TODAY,
    )
    .unwrap();
    assert!(!s
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .reference_issues
        .is_empty());
    assert_eq!(
        code(s.plan_profile_update(&event_update(&s, &p.clone(), 1), TODAY)),
        "PLANNING_SOURCE"
    );
    let payment = &mut p.retire.core.as_mut().unwrap().occurrences[0].payments[0];
    payment.amount_cents = Some("30000001".into());
    s.plan_profile_update(&event_update(&s, &p.clone(), 1), TODAY)
        .unwrap();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(snapshot.clone()),
            expected_revision: Some(1),
            date: "2026-10-31".into(),
            notes: "更正虚构盘点".into(),
            entries: vec![EntryInput {
                account_id: account,
                state: "entered".into(),
                amount_cents: Some("0".into()),
            }],
        },
        TODAY,
    )
    .unwrap();
    assert!(!s
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .reference_issues
        .is_empty());
    assert_eq!(
        code(s.plan_profile_update(&event_update(&s, &p.clone(), 2), TODAY)),
        "PLANNING_ABSORPTION"
    );
    p.retire.core.as_mut().unwrap().occurrences[0].payments[0].absorbed_revision = Some(2);
    s.plan_profile_update(&event_update(&s, &p, 2), TODAY)
        .unwrap();
    assert!(s
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .reference_issues
        .is_empty());
}

#[test]
fn core_unknown_partial_duplicate_and_invalid_inputs_are_not_promoted_to_complete() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("fictional")).unwrap();
    let (mut p, _, _) = core_fixture(&mut s);
    let o = &mut p.retire.core.as_mut().unwrap().occurrences[0];
    o.payments_complete = false;
    o.payments[0].amount_cents = None;
    o.payments[0].account_id = None;
    o.payments[0].absorbed_snapshot_id = None;
    o.payments[0].absorbed_revision = None;
    s.plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    assert_facts(&s.plan_profile().unwrap().saved.unwrap().profile, &p);
    let mut dup = p.clone();
    let mut o = dup.retire.core.as_ref().unwrap().occurrences[0].clone();
    o.id = rid();
    dup.retire.core.as_mut().unwrap().occurrences.push(o);
    assert_eq!(
        code(s.plan_profile_update(&event_update(&s, &dup, 1), TODAY)),
        "PLANNING_CORE"
    );
    let mut invalid = p.clone();
    invalid.retire.core.as_mut().unwrap().monetary_basis_date = "2026-02-30".into();
    assert!(invalid.validate(TODAY).is_err());
    let mut future = p.clone();
    future.retire.core.as_mut().unwrap().contract_version = 2;
    assert_eq!(code(future.validate(TODAY)), "PLANNING_VERSION");
    let mut raw = serde_json::to_value(&p).unwrap();
    raw["retire"]["core"]["future_field"] = serde_json::json!(1);
    assert!(serde_json::from_value::<Profile>(raw).is_err());
}

#[test]
fn schema30_upgrade_rolls_back_without_rewriting_legacy_ids_zero_and_explicit_amounts() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 30, &|_| Ok(())).unwrap();
    let mut p = profile();
    p.retire.saving_phases = vec![
        SavingPhase {
            id: "old-zero".into(),
            label: "零".into(),
            from_age_months: 0,
            monthly_cents: 0,
        },
        SavingPhase {
            id: "old-nonzero".into(),
            label: "非零".into(),
            from_age_months: 480,
            monthly_cents: 500000,
        },
    ];
    let mut raw = serde_json::to_value(&p).unwrap();
    raw["retire"].as_object_mut().unwrap().remove("core");
    let payload = raw.to_string();
    c.execute(
        "INSERT INTO plan_profile VALUES(1,?1,7,'2026-10-07T00:00:00Z')",
        [&payload],
    )
    .unwrap();
    assert!(
        migrate_to(&c, 31, &|point| if point == "migration.before_commit" {
            Err(Error::new("INJECTED", "迁移中断"))
        } else {
            Ok(())
        })
        .is_err()
    );
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        30
    );
    migrate_to(&c, 31, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row("SELECT payload FROM plan_profile", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        payload
    );
    let loaded: Profile = serde_json::from_str(&payload).unwrap();
    assert!(loaded.retire.core.is_none());
    assert_eq!(loaded.retire.saving_phases, p.retire.saving_phases);
}

#[test]
fn core_payment_aliases_reject_and_legacy_duplicates_degrade_after_restore() {
    use thingary_lib::{
        catalog::{Details, SaveAsset},
        domain::Save as AssetSave,
        photos::Selection,
        wishlist::{Action, Change, Fields, Link},
    };
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("fictional-alias-repair");
    let mut s = Store::open(&root).unwrap();
    let (mut p, account, _snapshot_id) = core_fixture(&mut s);
    p.personal_pension_annual_cents = Some("0".into());
    p.assumptions.inflation_hundredths = 0;
    p.retire.spend_cents = Some("100000".into());
    let a = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: AssetSave {
                    request_id: rid(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构同一购入".into(),
                    price_cents: Some("30000000".into()),
                    purchase_date: Some("2026-11-01".into()),
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    let w = s
        .change_wishlist(&Change {
            request_id: rid(),
            generation: s.generation(),
            expected_revision: None,
            action: Action::Add {
                fields: Fields {
                    name: "虚构同一购买愿望".into(),
                    category_id: None,
                    estimated_price_cents: None,
                    priority: None,
                    target_date: None,
                    external_link: String::new(),
                    notes: String::new(),
                },
                cover: Selection {
                    cover_id: None,
                    ids: vec![],
                },
            },
        })
        .unwrap();
    s.link_wish_asset(&Link {
        request_id: rid(),
        generation: s.generation(),
        wishlist_id: w.id.clone(),
        expected_revision: w.revision,
        asset_id: a.asset.id.clone(),
        expected_asset_revision: a.asset.revision,
    })
    .unwrap();
    let mut ev = p.retire.life_events[0].clone();
    ev.id = "event-two".into();
    p.retire.life_events.push(ev);
    let c = p.retire.core.as_mut().unwrap();
    let o = &mut c.occurrences[0];
    o.actual_date = "2026-11-01".into();
    let pay = &mut o.payments[0];
    pay.date = "2026-11-01".into();
    pay.account_id = Some(account);
    pay.absorbed_snapshot_id = None;
    pay.absorbed_revision = None;
    pay.source_kind = Some("asset".into());
    pay.source_id = Some(a.asset.id.clone());
    let mut o2 = o.clone();
    o2.id = rid();
    o2.event_id = "event-two".into();
    o2.payments[0].id = rid();
    o2.payments[0].source_kind = Some("wish".into());
    o2.payments[0].source_id = Some(w.id.clone());
    c.occurrences.push(o2);

    let rejected = save(&s, p.clone(), None);
    for _ in 0..2 {
        assert_eq!(
            code(s.plan_profile_save(&rejected, TODAY)),
            "PLANNING_SOURCE_DUPLICATE"
        );
        assert!(
            s.plan_profile().unwrap().saved.is_none(),
            "rejected save must not commit"
        );
    }
    // Linked expense is another acquisition alias; standalone expense is a distinct factual payment.
    let fields = thingary_lib::expenses::Fields {
        title: "虚构购入支出".into(),
        date: "2026-11-01".into(),
        amount_cents: "30000000".into(),
        category: "other".into(),
        notes: String::new(),
        refund_cents: None,
        refund_date: None,
        asset_id: Some(a.asset.id.clone()),
    };
    let linked = s
        .expense_save(
            &thingary_lib::expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields.clone(),
            },
            TODAY,
        )
        .unwrap();
    let mut ep = p.clone();
    let payment = &mut ep.retire.core.as_mut().unwrap().occurrences[1].payments[0];
    payment.source_kind = Some("expense".into());
    payment.source_id = Some(linked.id);
    assert_eq!(
        code(s.plan_profile_save(&save(&s, ep.clone(), None), TODAY)),
        "PLANNING_SOURCE_DUPLICATE"
    );
    let standalone = s
        .expense_save(
            &thingary_lib::expenses::Save {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::expenses::Fields {
                    asset_id: None,
                    ..fields
                },
            },
            TODAY,
        )
        .unwrap();
    ep.retire.core.as_mut().unwrap().occurrences[1].payments[0].source_id = Some(standalone.id);
    let valid = save(&s, ep.clone(), None);
    assert_eq!(s.plan_profile_save(&valid, TODAY).unwrap().revision, 1);
    assert_eq!(s.plan_profile_save(&valid, TODAY).unwrap().revision, 1);
    assert!(s
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .reference_issues
        .is_empty());
    // Independent asset with the same date and price must remain legal.
    let a2 = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: AssetSave {
                    request_id: rid(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构另一次购入".into(),
                    price_cents: Some("30000000".into()),
                    purchase_date: Some("2026-11-01".into()),
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    let mut two = p.clone();
    let payment = &mut two.retire.core.as_mut().unwrap().occurrences[1].payments[0];
    payment.source_kind = Some("asset".into());
    payment.source_id = Some(a2.asset.id);
    assert_eq!(
        s.plan_profile_update(&event_update(&s, &two, 1), TODAY)
            .unwrap()
            .revision,
        2
    );
    let good_file = dir.path().join("fictional-good.thingary");
    s.backup(Some(&good_file)).unwrap();
    let mut restored = Store::open(&dir.path().join("good-restored")).unwrap();
    let info = restored.inspect_backup(&good_file).unwrap();
    restored
        .restore(&good_file, &info.hash, &restored.generation())
        .unwrap();
    assert_facts(
        &restored.plan_profile().unwrap().saved.unwrap().profile,
        &two,
    );
    assert!(restored
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .reference_issues
        .is_empty());
    // Inject ONLY into this temporary fictional library to simulate an older accepted alias payload.
    drop(s);
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("active.json")).unwrap()).unwrap();
    let db = Connection::open(
        root.join("datasets")
            .join(active["id"].as_str().unwrap())
            .join("data.sqlite"),
    )
    .unwrap();
    db.execute(
        "UPDATE plan_profile SET payload=?1 WHERE id=1",
        [serde_json::to_string(&p).unwrap()],
    )
    .unwrap();
    drop(db);
    let s = Store::open(&root).unwrap();
    let legacy = s.plan_profile().unwrap().saved.unwrap();
    assert_facts(&legacy.profile, &p);
    assert!(legacy
        .reference_issues
        .iter()
        .any(|i| i.contains("重复关联")));
    let bad_file = dir.path().join("fictional-legacy.thingary");
    s.backup(Some(&bad_file)).unwrap();
    let mut restored = Store::open(&dir.path().join("legacy-restored")).unwrap();
    let info = restored.inspect_backup(&bad_file).unwrap();
    restored
        .restore(&bad_file, &info.hash, &restored.generation())
        .unwrap();
    assert!(restored
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .reference_issues
        .iter()
        .any(|i| i.contains("重复关联")));
}

#[test]
fn guided_setup_marker_is_backward_compatible_and_preserves_facts_through_restore() {
    use thingary_lib::plan_income::{Fields, Save};
    let mut old = serde_json::to_value(profile()).unwrap();
    old["retire"]
        .as_object_mut()
        .unwrap()
        .remove("setup_completed");
    let legacy: Profile = serde_json::from_value(old).unwrap();
    assert!(!legacy.retire.setup_completed);
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("library")).unwrap();
    let (p, _, _) = core_fixture(&mut s);
    s.plan_income_save(
        &Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: Fields {
                date: "2026-12-20".into(),
                net_cents: "100000".into(),
                hpf_cents: Some("0".into()),
                notes: "虚构到账".into(),
            },
        },
        TODAY,
    )
    .unwrap();
    s.plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    let facts = serde_json::json!({"accounts":s.wealth_accounts().unwrap(),"wealth":s.wealth_summary().unwrap(),"review":s.plan_review().unwrap(),"income":s.plan_income_list().unwrap()});
    let occurrences = p.retire.core.as_ref().unwrap().occurrences.clone();
    let mut update: thingary_lib::plan_basic::Update = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/update.json"
    ))
    .unwrap();
    update.request_id = rid();
    update.generation = s.generation();
    update.expected_revision = Some(1);
    let general = s.plan_profile_update(&update, TODAY).unwrap();
    assert!(general.profile.retire.basic.is_some());
    assert!(general.profile.retire.legacy_definition.is_none());
    assert_eq!(
        facts,
        serde_json::json!({"accounts":s.wealth_accounts().unwrap(),"wealth":s.wealth_summary().unwrap(),"review":s.plan_review().unwrap(),"income":s.plan_income_list().unwrap()})
    );
    assert_eq!(
        s.plan_profile()
            .unwrap()
            .saved
            .unwrap()
            .profile
            .retire
            .core
            .unwrap()
            .occurrences,
        occurrences
    );
    let file = dir.path().join("setup.thingary");
    s.backup(Some(&file)).unwrap();
    drop(s);
    let mut restored = Store::open(&dir.path().join("restored")).unwrap();
    let summary = restored.inspect_backup(&file).unwrap();
    restored
        .restore(&file, &summary.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.plan_profile().unwrap().saved.unwrap().profile,
        general.profile
    );
    let mut after = serde_json::json!({"accounts":restored.wealth_accounts().unwrap(),"wealth":restored.wealth_summary().unwrap(),"review":restored.plan_review().unwrap(),"income":restored.plan_income_list().unwrap()});
    for key in ["wealth", "review", "income"] {
        after[key]["generation"] = facts[key]["generation"].clone();
    }
    assert_eq!(after, facts);
}

#[test]
fn basic_reset_preserves_single_core_occurrence_payment_and_existing_account_snapshot_income_ids() {
    use thingary_lib::plan_basic::{Section, Update};
    use thingary_lib::plan_income::{Fields as IncomeFields, Save as IncomeSave};
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(&d.path().join("fictional")).unwrap();
    let (mut p, account_id, snapshot_id) = core_fixture(&mut s);
    use thingary_lib::{
        plan_core::{CostRule, Loan},
        wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
    };
    let debt = s
        .wealth_account_save(
            &AccountSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: "虚构余债".into(),
                    institution: "虚构".into(),
                    side: "liability".into(),
                    kind: "loan".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    let snapshot = s
        .wealth_snapshot_save(
            &SnapshotSave {
                request_id: rid(),
                generation: s.generation(),
                id: Some(snapshot_id.clone()),
                expected_revision: Some(1),
                date: "2026-10-31".into(),
                notes: "虚构完整资料".into(),
                entries: vec![
                    EntryInput {
                        account_id: account_id.clone(),
                        state: "entered".into(),
                        amount_cents: Some("70000000".into()),
                    },
                    EntryInput {
                        account_id: debt.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some("1200000".into()),
                    },
                ],
            },
            TODAY,
        )
        .unwrap();
    p.retire.life_events[0].price_cents = "40000000".into();
    let c = p.retire.core.as_mut().unwrap();
    c.occurrences[0].payments[0].absorbed_revision = Some(snapshot.revision);
    c.occurrences[0].loan = Some(Loan {
        account_id: debt.id.clone(),
        as_of: snapshot.date,
        principal_cents: "1200000".into(),
        remaining_months: 12,
    });
    c.costs = vec![CostRule {
        phase_id: "phase".into(),
        source_id: "event:event:loan".into(),
        included: true,
        reference_cents: "100000".into(),
    }];
    let income = s
        .plan_income_save(
            &IncomeSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: IncomeFields {
                    date: "2026-09-01".into(),
                    net_cents: "0".into(),
                    hpf_cents: Some("0".into()),
                    notes: "虚构零事实".into(),
                },
            },
            TODAY,
        )
        .unwrap();
    let old = s
        .plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    let before_accounts = serde_json::to_value(s.wealth_accounts().unwrap()).unwrap();
    let before_snapshot = serde_json::to_value(s.wealth_snapshot(&snapshot_id).unwrap()).unwrap();
    let before_income = serde_json::to_value(s.plan_income_list().unwrap()).unwrap();
    let mut i: Update = serde_json::from_str(include_str!(
        "../../tests/fixtures/planning-basic/update.json"
    ))
    .unwrap();
    i.generation = s.generation();
    i.expected_revision = Some(1);
    if let Section::Basic(f) = &mut i.section {
        f.confirm_legacy_replacement = true;
    }
    let new = s.plan_profile_update(&i, TODAY).unwrap();
    assert_eq!(new.profile.retire.core, old.profile.retire.core);
    assert_eq!(
        new.profile.retire.life_events,
        old.profile.retire.life_events
    );
    assert!(new.profile.retire.legacy_definition.is_none());
    assert_eq!(
        serde_json::to_value(s.wealth_accounts().unwrap()).unwrap(),
        before_accounts
    );
    assert_eq!(
        serde_json::to_value(s.wealth_snapshot(&snapshot_id).unwrap()).unwrap(),
        before_snapshot
    );
    assert_eq!(
        serde_json::to_value(s.plan_income_list().unwrap()).unwrap(),
        before_income
    );
    assert_eq!(
        s.plan_income(&income.id).unwrap().unwrap().fields.net_cents,
        "0"
    );
    assert_eq!(s.wealth_accounts().unwrap()[0].id, account_id);
    let count: i64 = s
        .conn_for_test()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM plan_profile", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

// Independent loan schedules are profile assumptions, with stable liability references.
fn debt_account(s: &mut Store) -> String {
    use thingary_lib::wealth::{AccountFields, AccountSave};
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: "虚构信用卡".into(),
                institution: "虚构银行".into(),
                side: "liability".into(),
                kind: "credit_card".into(),
                counted: true,
                opened_on: "2026-04-10".into(),
                closed_on: None,
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap()
    .id
}
fn debt_record(account: &str) -> thingary_lib::plan_core::DebtRepayment {
    serde_json::from_value(serde_json::json!({"account_id":account,"recorded_on":"2026-10-10","as_of":"2026-10-10","balance_cents":"500000","start_month":"2026-11","last_month":"2028-10","monthly_cents":"200000","before":"scheduled","after":"scheduled"})).unwrap()
}
fn debt_update(
    s: &Store,
    updates: Vec<thingary_lib::plan_core::DebtRepayment>,
    remove: Vec<String>,
    revision: i64,
) -> thingary_lib::plan_basic::Update {
    thingary_lib::plan_basic::Update {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: Some(revision),
        section: thingary_lib::plan_basic::Section::DebtRepayments(
            thingary_lib::plan_basic::DebtRepaymentsFields { updates, remove },
        ),
    }
}
#[test]
fn debt_optional_defaults_old_bytes_backup_new_partial_save_restart_conflict_and_unknown_replay() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("fictional");
    let mut s = Store::open(&root).unwrap();
    let (p, _, _) = core_fixture(&mut s);
    let account = debt_account(&mut s);
    let second = debt_account(&mut s);
    let old_json = serde_json::to_value(&p).unwrap();
    assert!(old_json["retire"]["core"].get("debt_repayments").is_none());
    let old: Profile = serde_json::from_value(old_json.clone()).unwrap();
    assert!(old.retire.core.as_ref().unwrap().debt_repayments.is_empty());
    assert_eq!(serde_json::to_value(&old).unwrap(), old_json);
    s.plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    let old_file = d.path().join("old.thingary");
    s.backup(Some(&old_file)).unwrap();
    let mut restore = Store::open(&d.path().join("old-restored")).unwrap();
    let info = restore.inspect_backup(&old_file).unwrap();
    restore
        .restore(&old_file, &info.hash, &restore.generation())
        .unwrap();
    assert!(restore
        .plan_profile()
        .unwrap()
        .saved
        .unwrap()
        .profile
        .retire
        .core
        .unwrap()
        .debt_repayments
        .is_empty());
    let first = debt_update(&s, vec![debt_record(&account)], vec![], 1);
    s.set_hook(|point| {
        if point == "plan_profile.before_commit" {
            Err(Error::new("INJECTED", "提交前"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.plan_profile_update(&first, TODAY)), "INJECTED");
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().revision, 1);
    s.set_hook(|point| {
        if point == "plan_profile.after_commit" {
            Err(Error::new("INJECTED", "回执丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.plan_profile_update(&first, TODAY)), "INJECTED");
    drop(s);
    let mut s = Store::open(&root).unwrap();
    assert_eq!(s.plan_profile_update(&first, TODAY).unwrap().revision, 2);
    assert_eq!(
        s.plan_profile()
            .unwrap()
            .saved
            .unwrap()
            .profile
            .retire
            .core
            .unwrap()
            .debt_repayments,
        vec![debt_record(&account)]
    );
    let mut conflicting = first.clone();
    if let thingary_lib::plan_basic::Section::DebtRepayments(f) = &mut conflicting.section {
        f.updates[0].before = Some("included".into());
    }
    assert_eq!(
        code(s.plan_profile_update(&conflicting, TODAY)),
        "REQUEST_CONFLICT"
    );
    assert_eq!(
        code(s.plan_profile_update(
            &debt_update(&s, vec![debt_record(&second)], vec![], 1),
            TODAY
        )),
        "REVISION_CONFLICT"
    );
    let mut unknown = debt_record(&second);
    unknown.monthly_cents = None;
    unknown.last_month = None;
    unknown.after = None;
    let next = s
        .plan_profile_update(&debt_update(&s, vec![unknown.clone()], vec![], 2), TODAY)
        .unwrap();
    assert_eq!(next.revision, 3);
    assert_eq!(
        next.profile.retire.core.as_ref().unwrap().debt_repayments,
        vec![debt_record(&account), unknown]
    );
    assert_eq!(
        next.profile.retire.core.as_ref().unwrap().occurrences,
        p.retire.core.as_ref().unwrap().occurrences
    );
    let new_file = d.path().join("new.thingary");
    s.backup(Some(&new_file)).unwrap();
    let mut restore = Store::open(&d.path().join("new-restored")).unwrap();
    let info = restore.inspect_backup(&new_file).unwrap();
    assert_eq!(info.schema, SCHEMA_VERSION as u32);
    restore
        .restore(&new_file, &info.hash, &restore.generation())
        .unwrap();
    assert_eq!(
        restore
            .plan_profile()
            .unwrap()
            .saved
            .unwrap()
            .profile
            .retire
            .core,
        next.profile.retire.core
    );
    s.plan_profile_update(&debt_update(&s, vec![], vec![account, second], 3), TODAY)
        .unwrap();
    assert!(
        serde_json::to_value(s.plan_profile().unwrap().saved.unwrap().profile).unwrap()["retire"]
            ["core"]
            .get("debt_repayments")
            .is_none()
    );
}
#[test]
fn debt_strict_payload_validation_and_live_references() {
    let d = tempfile::tempdir().unwrap();
    let mut s = Store::open(d.path()).unwrap();
    let (p, asset, _) = core_fixture(&mut s);
    let account = debt_account(&mut s);
    s.plan_profile_save(&save(&s, p, None), TODAY).unwrap();
    let row = debt_record(&account);
    let value = serde_json::to_value(&row).unwrap();
    for (key, v) in [
        ("monthly_cents", serde_json::json!(-1)),
        ("balance_cents", serde_json::Value::Null),
        ("unexpected", serde_json::json!(true)),
    ] {
        let mut invalid = value.clone();
        invalid[key] = v;
        assert!(serde_json::from_value::<thingary_lib::plan_core::DebtRepayment>(invalid).is_err());
    }
    for (key, v) in [
        ("monthly_cents", "01"),
        ("recorded_on", "2027-01-01"),
        ("as_of", "2026-02-30"),
        ("start_month", "2026-13"),
        ("last_month", "2066-11"),
        ("before", "invalid"),
    ] {
        let mut invalid = value.clone();
        invalid[key] = serde_json::json!(v);
        let row = serde_json::from_value(invalid).unwrap();
        assert!(s
            .plan_profile_update(&debt_update(&s, vec![row], vec![], 1), TODAY)
            .is_err());
    }
    for reference in [asset, rid()] {
        let mut row = row.clone();
        row.account_id = reference;
        assert_eq!(
            code(s.plan_profile_update(&debt_update(&s, vec![row], vec![], 1), TODAY)),
            "PLANNING_REFERENCE"
        );
    }
    assert_eq!(
        code(s.plan_profile_update(
            &debt_update(&s, vec![row.clone(), row.clone()], vec![], 1),
            TODAY
        )),
        "PLANNING_BASIC"
    );
    assert_eq!(
        code(s.plan_profile_update(
            &debt_update(&s, vec![], vec![account.clone(), account.clone()], 1),
            TODAY
        )),
        "PLANNING_BASIC"
    );
    assert_eq!(
        code(s.plan_profile_update(
            &debt_update(&s, vec![row.clone()], vec![account.clone()], 1),
            TODAY
        )),
        "PLANNING_BASIC"
    );
    use thingary_lib::wealth::TrashChange;
    s.wealth_trash(&TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: "account".into(),
        id: account.clone(),
        expected_revision: 1,
        deleted: true,
    })
    .unwrap();
    assert_eq!(
        code(s.plan_profile_update(&debt_update(&s, vec![row], vec![], 1), TODAY)),
        "PLANNING_REFERENCE"
    );
}
#[test]
fn debt_backup_inspection_rejects_illegal_fields_and_missing_account() {
    for broken in ["invalid-choice", "missing-reference"] {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::open(&d.path().join("source")).unwrap();
        let (mut p, _, _) = core_fixture(&mut s);
        let account = debt_account(&mut s);
        let mut row = debt_record(&account);
        if broken == "invalid-choice" {
            row.before = Some("invalid".into())
        } else {
            row.account_id = rid()
        };
        p.retire.core.as_mut().unwrap().debt_repayments = vec![row];
        s.conn_for_test()
            .unwrap()
            .execute(
                "INSERT INTO plan_profile VALUES(1,?1,1,'2026-10-10T00:00:00Z')",
                [serde_json::to_string(&p).unwrap()],
            )
            .unwrap();
        let file = d.path().join("bad.thingary");
        assert!(
            s.backup(Some(&file)).is_err(),
            "invalid live data cannot be backed up"
        );
        // Construct a hostile but hash-correct archive to exercise inspection separately.
        use std::io::Write;
        let db_path = d.path().join("bad.sqlite");
        let mut target = Connection::open(&db_path).unwrap();
        rusqlite::backup::Backup::new(s.conn_for_test().unwrap(), &mut target)
            .unwrap()
            .run_to_completion(128, std::time::Duration::from_millis(1), None)
            .unwrap();
        drop(target);
        let bytes = std::fs::read(db_path).unwrap();
        let manifest = serde_json::json!({"format":1,"schema":SCHEMA_VERSION,"created_at":"2026-10-10T00:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":Store::digest_for_test(&bytes)}}});
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("manifest.json", options).unwrap();
        zip.write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        zip.start_file("data.sqlite", options).unwrap();
        zip.write_all(&bytes).unwrap();
        zip.finish().unwrap();
        let restored = Store::open(&d.path().join("target")).unwrap();
        assert!(restored.inspect_backup(&file).is_err(), "{broken}");
    }
}

#[test]
fn custom_region_saves_partial_facts_restarts_and_round_trips_backup() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("custom");
    let mut s = Store::open(&root).unwrap();
    let mut p = profile();
    p.region = Some("custom".into());
    // A missing benefit base can be saved in steps; it is never replaced with zero.
    p.overrides.avg_wage_cents = None;
    let a = s
        .plan_profile_save(&save(&s, p.clone(), None), TODAY)
        .unwrap();
    assert_eq!(a.profile.region.as_deref(), Some("custom"));
    assert!(a.profile.overrides.avg_wage_cents.is_none());
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_facts(&s.plan_profile().unwrap().saved.unwrap().profile, &p);
    let file = d.path().join("custom.thingary");
    s.backup(Some(&file)).unwrap();
    let mut t = Store::open(&d.path().join("restore")).unwrap();
    let info = t.inspect_backup(&file).unwrap();
    t.restore(&file, &info.hash, &t.generation()).unwrap();
    assert_facts(&t.plan_profile().unwrap().saved.unwrap().profile, &p);
}
