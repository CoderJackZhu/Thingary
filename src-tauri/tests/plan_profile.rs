//! Current general planning; fictional temporary libraries only.
use rusqlite::Connection;
use thingary_lib::{
    domain::Error,
    plan_profile::{LifeEvent, Profile, ProfileSave},
    storage::{Store, SCHEMA_VERSION},
};
const TODAY: &str = "2026-12-31";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}
fn profile() -> Profile {
    thingary_lib::plan_basic::empty_profile()
}
fn save(s: &Store, p: Profile, expected: Option<i64>) -> ProfileSave {
    ProfileSave {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: expected,
        profile: p,
    }
}
// Fixture setup alone writes a current profile at revision 1, without an occurrence.
// Each assertion exercises the actual scoped Events transaction, not the removed full-profile port.
trait CurrentFixture {
    fn save_current_events(
        &mut self,
        i: &ProfileSave,
        today: &str,
    ) -> thingary_lib::domain::Result<thingary_lib::plan_profile::Saved>;
}
impl CurrentFixture for Store {
    fn save_current_events(
        &mut self,
        i: &ProfileSave,
        today: &str,
    ) -> thingary_lib::domain::Result<thingary_lib::plan_profile::Saved> {
        if self.plan_profile()?.saved.is_none() {
            let mut p = i.profile.clone();
            p.retire.core.as_mut().unwrap().occurrences.clear();
            p.validate(today)?;
            self.conn_for_test()?.execute(
                "INSERT INTO plan_profile VALUES(1,?1,1,?2)",
                rusqlite::params![serde_json::to_string(&p)?, "2026-10-12T00:00:00Z"],
            )?;
        }
        self.plan_profile_update(
            &thingary_lib::plan_basic::Update {
                request_id: i.request_id.clone(),
                generation: i.generation.clone(),
                expected_revision: Some(i.expected_revision.unwrap_or(0) + 1),
                section: thingary_lib::plan_basic::Section::Events(
                    thingary_lib::plan_basic::EventsFields {
                        life_events: i.profile.retire.life_events.clone(),
                        occurrences: i.profile.retire.core.as_ref().unwrap().occurrences.clone(),
                    },
                ),
            },
            today,
        )
    }
}
fn assert_facts(a: &Profile, e: &Profile) {
    assert_eq!(a, e);
}
fn event_update(s: &Store, p: &Profile, revision: i64) -> thingary_lib::plan_basic::Update {
    let c = p.retire.core.as_ref().unwrap();
    thingary_lib::plan_basic::Update {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: Some(revision + 1),
        section: thingary_lib::plan_basic::Section::Events(
            thingary_lib::plan_basic::EventsFields {
                life_events: p.retire.life_events.clone(),
                occurrences: c.occurrences.clone(),
            },
        ),
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
                    purchase_cents: None,
                    purchased_on: None,
                    currency: "CNY".into(),
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
                    original_minor: None,
                    fx_rate_micro: None,
                }],
            },
            TODAY,
        )
        .unwrap();
    let mut p = profile();
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
        until_month: None,
        time_unconfirmed: false,
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
        releases: vec![],
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
                purchase_cents: None,
                purchased_on: None,
                currency: "CNY".into(),
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
        expected_revision: Some(revision + 1),
        section: thingary_lib::plan_basic::Section::DebtRepayments(
            thingary_lib::plan_basic::DebtRepaymentsFields { updates, remove },
        ),
    }
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
    assert_eq!(code(s.save_current_events(&input, TODAY)), "INJECTED");
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().revision, 1);
    s.set_hook(|point| {
        if point == "plan_profile.after_commit" {
            Err(Error::new("INJECTED", "提交成功后回执丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.save_current_events(&input, TODAY)), "INJECTED");
    s.set_hook(|_| Ok(()));
    assert_eq!(s.save_current_events(&input, TODAY).unwrap().revision, 2);
    assert_eq!(
        code(s.save_current_events(&save(&s, p.clone(), None), TODAY)),
        "REVISION_CONFLICT"
    );
    let mut cancelled = p.clone();
    cancelled.retire.core.as_mut().unwrap().occurrences.clear();
    assert_eq!(
        code(s.plan_profile_update(&event_update(&s, &cancelled, 1), TODAY)),
        "PLANNING_OCCURRENCE"
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
    s.save_current_events(&save(&s, p.clone(), None), TODAY)
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
                original_minor: None,
                fx_rate_micro: None,
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
    s.save_current_events(&save(&s, p.clone(), None), TODAY)
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
            code(s.save_current_events(&rejected, TODAY)),
            "PLANNING_SOURCE_DUPLICATE"
        );
        assert!(
            s.plan_profile().unwrap().saved.unwrap().revision == 1,
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
        code(s.save_current_events(&save(&s, ep.clone(), None), TODAY)),
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
    assert_eq!(s.save_current_events(&valid, TODAY).unwrap().revision, 2);
    assert_eq!(s.save_current_events(&valid, TODAY).unwrap().revision, 2);
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
        3
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
    s.save_current_events(&save(&s, p.clone(), None), TODAY)
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
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().revision, 2);
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
    assert_eq!(s.plan_profile_update(&first, TODAY).unwrap().revision, 3);
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
    assert_eq!(next.revision, 4);
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
    s.save_current_events(&save(&s, p, None), TODAY).unwrap();
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
