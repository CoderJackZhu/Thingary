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
        birth_month: "1990-06".into(),
        worker: "male".into(),
        region: "beijing".into(),
        paid_months: 48,
        account_balance_cents: "5000000".into(),
        base_cents: "2000000".into(),
        past_index_hundredths: None,
        flex_months: 0,
        personal_pension_annual_cents: "1200000".into(),
        marginal_tax_hundredths: 1000,
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
    assert_eq!(saved.profile, profile());
    assert!(chrono::DateTime::parse_from_rfc3339(&saved.updated_at).is_ok());

    // A second create (no expected revision) and a stale edit are both refused.
    assert_eq!(
        code(s.plan_profile_save(&save(&s, profile(), None), TODAY)),
        "REVISION_CONFLICT"
    );
    let mut edited = profile();
    edited.paid_months = 60;
    let ok = s
        .plan_profile_save(&save(&s, edited.clone(), Some(1)), TODAY)
        .unwrap();
    assert_eq!((ok.revision, ok.profile.paid_months), (2, 60));
    assert_eq!(
        code(s.plan_profile_save(&save(&s, profile(), Some(1)), TODAY)),
        "REVISION_CONFLICT"
    );
    // Reusing a request id for other content is refused.
    let mut other = first.clone();
    other.profile.paid_months = 1;
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
            Box::new(|p| p.birth_month = "1990-13".into()),
            "PROFILE_BIRTH",
        ),
        (
            Box::new(|p| p.birth_month = "2026-12".into()),
            "PROFILE_BIRTH",
        ),
        (
            Box::new(|p| p.birth_month = "1990-6".into()),
            "PROFILE_BIRTH",
        ),
        (Box::new(|p| p.worker = "other".into()), "PROFILE_WORKER"),
        (Box::new(|p| p.region = "shanghai".into()), "PROFILE_REGION"),
        (Box::new(|p| p.paid_months = 1201), "PROFILE_MONTHS"),
        (
            Box::new(|p| p.account_balance_cents = "-1".into()),
            "PROFILE_AMOUNT",
        ),
        (Box::new(|p| p.base_cents = "".into()), "PROFILE_AMOUNT"),
        (
            Box::new(|p| p.past_index_hundredths = Some(0)),
            "PROFILE_INDEX",
        ),
        (Box::new(|p| p.flex_months = 37), "PROFILE_FLEX"),
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
        (Box::new(|p| p.flex_months = -37), "PROFILE_FLEX"),
        (
            Box::new(|p| p.personal_pension_annual_cents = "1200001".into()),
            "PROFILE_PENSION",
        ),
        (
            Box::new(|p| p.marginal_tax_hundredths = 4501),
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
    zero.personal_pension_annual_cents = "0".into();
    zero.paid_months = 0;
    zero.account_balance_cents = "0".into();
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
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, custom);
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
        ("fire", 50, 500)
    );
    let mut custom = profile();
    custom.retire = Retire {
        mode: "traditional".into(),
        target_age: 60,
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
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, custom);
}

#[test]
fn plan_type_items_and_volatility_are_validated() {
    type Change = Box<dyn Fn(&mut Retire)>;
    let cases: Vec<(Change, &str)> = vec![
        (Box::new(|_| {}), ""),
        (Box::new(|r| r.mode = "coast".into()), "PROFILE_RETIRE"),
        (Box::new(|r| r.target_age = 19), "PROFILE_RETIRE"),
        (Box::new(|r| r.target_age = 90), "PROFILE_RETIRE"),
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
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, ok);
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
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, p);
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
