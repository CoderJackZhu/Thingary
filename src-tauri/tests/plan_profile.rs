//! Planning stage 2: the personal profile behind the pension estimate.
//! Fictional data only; the profile is sensitive and must never be a fixture
//! of real values.
use rusqlite::Connection;
use thingary_lib::{
    domain::Error,
    plan_profile::{Assumptions, Overrides, Profile, ProfileSave},
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
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().profile, profile());

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
