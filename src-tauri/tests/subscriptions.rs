use thingary_lib::{
    domain::Error,
    link::LinkSave,
    recurring::{PaymentRangeSave, PaymentSave, PlanFields, PlanSave},
    storage::{migrate_to, Store, SCHEMA, SCHEMA_VERSION},
    virtual_assets::{Fields, LinkedPlanSave, Save},
};
fn code(result: Result<impl Sized + std::fmt::Debug, Error>) -> String {
    result.unwrap_err().code
}
const TODAY: &str = "2026-10-04";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn fields() -> PlanFields {
    PlanFields {
        auto_renew: true,
        interval_days: None,
        trial_days: None,
        name: "虚构 GPT".into(),
        category: "subscription".into(),
        amount_cents: "14000".into(),
        interval_months: 1,
        first_due: "2026-11-04".into(),
        service_start: Some("2024-01-04".into()),
        coverage_start: Some("2026-11-04".into()),
        end_date: None,
        paused: false,
        notes: String::new(),
    }
}
fn sub(s: &Store) -> Save {
    Save {
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        plan: Some(LinkedPlanSave {
            id: None,
            expected_revision: None,
            fields: fields(),
        }),
        fields: Fields {
            billing: "subscription".into(),
            label_id: None,
            pay_method: None,
            perpetual: None,
            name: "虚构 GPT".into(),
            kind: "subscription".into(),
            provider: String::new(),
            purchase_date: Some("2024-01-04".into()),
            price_cents: None,
            expires: None,
            plan_id: None,
            url: String::new(),
            notes: String::new(),
            stopped_on: None,
        },
    }
}
fn pay(s: &Store, plan: &str, due: &str, amount: &str) -> PaymentSave {
    PaymentSave {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        plan_id: plan.into(),
        due_date: due.into(),
        state: "paid".into(),
        paid_date: Some(due.into()),
        amount_cents: Some(amount.into()),
        notes: String::new(),
    }
}
#[test]
fn subscription_is_one_atomic_relationship_with_no_automatic_historical_payments() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let q = sub(&s);
    s.set_hook(|p| {
        if p == "virtual.before_commit" {
            Err(Error::new("TEST", "失败"))
        } else {
            Ok(())
        }
    });
    assert!(s.virtual_save(&q, TODAY).is_err());
    assert!(s.recurring_overview(TODAY).unwrap().plans.is_empty());
    s.set_hook(|_| Ok(()));
    let v = s.virtual_save(&q, TODAY).unwrap();
    let replay = s.virtual_save(&q, TODAY).unwrap();
    assert_eq!(v.id, replay.id);
    assert_eq!(v.fields.plan_id, replay.fields.plan_id);
    let o = s.recurring_overview(TODAY).unwrap();
    assert_eq!(o.plans.len(), 1);
    assert!(o.due.is_empty() && o.payments.is_empty());
    assert_eq!(v.status, "ongoing");
    assert_eq!(v.spent_cents.as_deref(), Some("0"));
    assert_eq!(o.plans[0].estimated_cents.as_deref(), Some("476000"));
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(
        s.virtual_overview("2028-01-01").unwrap().items[0].status,
        "ongoing"
    );
}
#[test]
fn prepaid_quarterly_lease_ends_by_coverage_and_retains_confirmed_facts_after_edits() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut f = fields();
    f.name = "虚构季付租约".into();
    f.category = "rent".into();
    f.amount_cents = "900000".into();
    f.interval_months = 3;
    f.service_start = Some("2026-11-01".into());
    f.coverage_start = f.service_start.clone();
    f.first_due = "2026-10-25".into();
    f.end_date = Some("2027-10-31".into());
    let p = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f.clone(),
            },
            TODAY,
        )
        .unwrap();
    let o = s.recurring_overview(TODAY).unwrap();
    assert_eq!(o.plans[0].contract_cents.as_deref(), Some("3600000"));
    assert_eq!(o.plans[0].monthly_cents.as_deref(), Some("300000"));
    assert_eq!(o.next12_cents, "3600000");
    let dates = ["2026-10-25", "2027-01-25", "2027-04-25", "2027-07-25"];
    for d in dates {
        s.recurring_payment_save(&pay(&s, &p.id, d, "900000"), "2027-10-04")
            .unwrap();
    }
    let before = s.recurring_overview("2027-10-04").unwrap().payments;
    assert!(s.recurring_overview("2027-10-31").unwrap().due.is_empty());
    assert_eq!(before[0].coverage_start.as_deref(), Some("2027-08-01"));
    assert_eq!(before[0].coverage_end.as_deref(), Some("2027-10-31"));
    assert_eq!(
        s.recurring_payment_save(&pay(&s, &p.id, "2027-10-25", "900000"), "2027-10-31")
            .unwrap_err()
            .code,
        "PAYMENT_PERIOD"
    );
    f.amount_cents = "1000000".into();
    f.coverage_start = Some("2026-11-02".into());
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(p.id),
            expected_revision: Some(p.revision),
            fields: f,
        },
        "2027-10-04",
    )
    .unwrap();
    let after = s.recurring_overview("2027-10-04").unwrap().payments;
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(after).unwrap()
    );
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "3600000");
}
#[test]
fn explicit_range_is_atomic_retryable_skips_existing_and_checks_revision_generation_and_future() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let v = s.virtual_save(&sub(&s), TODAY).unwrap();
    let p = v.plan.unwrap();
    s.recurring_payment_save(&pay(&s, &p.id, "2024-02-04", "15000"), TODAY)
        .unwrap();
    let mut q = PaymentRangeSave {
        request_id: id(),
        generation: s.generation(),
        plan_id: p.id,
        expected_revision: p.revision,
        from_due: "2024-01-04".into(),
        to_due: "2024-03-04".into(),
        amount_cents: "14000".into(),
        confirmed: false,
    };
    assert_eq!(
        s.recurring_payment_range_save(&q, TODAY).unwrap_err().code,
        "PAYMENT_RANGE"
    );
    q.confirmed = true;
    s.set_hook(|p| {
        if p == "recurring_range.before_commit" {
            Err(Error::new("TEST", "失败"))
        } else {
            Ok(())
        }
    });
    assert!(s.recurring_payment_range_save(&q, TODAY).is_err());
    assert_eq!(s.recurring_overview(TODAY).unwrap().payments.len(), 1);
    s.set_hook(|p| {
        if p == "recurring_range.after_commit" {
            Err(Error::new("TEST", "回执丢失"))
        } else {
            Ok(())
        }
    });
    assert!(s.recurring_payment_range_save(&q, TODAY).is_err());
    assert!(s
        .wealth_request_result(&q.request_id, &s.generation())
        .unwrap()
        .is_some());
    s.set_hook(|_| Ok(()));
    s.recurring_payment_range_save(&q, TODAY).unwrap();
    assert_eq!(s.recurring_overview(TODAY).unwrap().payments.len(), 3);
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "43000");
    q.request_id = id();
    q.to_due = "2027-01-04".into();
    assert_eq!(
        s.recurring_payment_range_save(&q, TODAY).unwrap_err().code,
        "PAYMENT_RANGE"
    );
    q.to_due = "2024-03-04".into();
    q.expected_revision += 1;
    assert_eq!(
        s.recurring_payment_range_save(&q, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    q.generation = id();
    assert!(s.recurring_payment_range_save(&q, TODAY).is_err());
}
#[test]
fn price_history_changes_estimates_forward_while_paid_cost_remains_exact() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut f = fields();
    f.first_due = "2026-01-01".into();
    f.service_start = Some(f.first_due.clone());
    f.coverage_start = f.service_start.clone();
    f.amount_cents = "100".into();
    let p = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f.clone(),
            },
            "2026-01-01",
        )
        .unwrap();
    s.recurring_payment_save(&pay(&s, &p.id, "2026-01-01", "100"), "2026-01-01")
        .unwrap();
    f.amount_cents = "200".into();
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(p.id),
            expected_revision: Some(p.revision),
            fields: f,
        },
        "2026-02-01",
    )
    .unwrap();
    let o = s.recurring_overview("2026-03-15").unwrap();
    assert_eq!(o.plans[0].estimated_cents.as_deref(), Some("500"));
    assert_eq!(o.plans[0].paid_cents.as_deref(), Some("100"));
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "100");
}
#[test]
fn schema_twenty_upgrade_preserves_old_fields_and_rolls_back_atomically() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 20, &|_| Ok(())).unwrap();
    let pid = id();
    let vid = id();
    c.execute("INSERT INTO recurring_plans VALUES(?1,'虚构旧房租','rent',300000,1,'2024-01-01',NULL,0,'2024-01-01','旧备注',1,'old','old',NULL)",[&pid]).unwrap();
    c.execute("INSERT INTO virtual_assets(id,name,kind,provider,price_cents,revision,created_at,updated_at,url,notes) VALUES(?1,'虚构旧单次订阅','subscription','',12800,1,'old','old','','')",[&vid]).unwrap();
    assert!(
        migrate_to(&c, SCHEMA_VERSION, &|p| if p == "migration.before_commit" {
            Err(Error::new("TEST", "失败"))
        } else {
            Ok(())
        })
        .is_err()
    );
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        20
    );
    migrate_to(&c, SCHEMA_VERSION, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row(
            "SELECT amount_cents,first_due,service_start,coverage_start FROM recurring_plans",
            [],
            |r| Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?
            ))
        )
        .unwrap(),
        (300000, "2024-01-01".into(), None, None)
    );
    assert_eq!(
        c.query_row("SELECT price_cents FROM virtual_assets", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        12800
    );
    assert_eq!(
        c.query_row("SELECT count(*) FROM plan_rates", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn new_subscription_backup_round_trip_keeps_relationship_rates_and_actual_payments() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("source")).unwrap();
    let v = s.virtual_save(&sub(&s), TODAY).unwrap();
    s.recurring_payment_save(
        &pay(
            &s,
            v.fields.plan_id.as_deref().unwrap(),
            "2024-01-04",
            "13000",
        ),
        TODAY,
    )
    .unwrap();
    let file = dir.path().join("虚构.thingary");
    s.backup(Some(&file)).unwrap();
    let mut dest = Store::open(&dir.path().join("dest")).unwrap();
    let summary = dest.inspect_backup(&file).unwrap();
    dest.restore(&file, &summary.hash, &dest.generation())
        .unwrap();
    let out = dest.virtual_overview(TODAY).unwrap().items.pop().unwrap();
    assert_eq!(out.id, v.id);
    assert_eq!(out.fields.plan_id, v.fields.plan_id);
    assert_eq!(out.status, "ongoing");
    assert_eq!(out.spent_cents.as_deref(), Some("13000"));
    assert_eq!(out.plan.unwrap().estimated_cents.as_deref(), Some("476000"));
}

#[test]
fn virtual_and_plan_revision_conflicts_roll_back_the_entire_edit() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let v = s.virtual_save(&sub(&s), TODAY).unwrap();
    let p = v.plan.as_ref().unwrap();
    let mut f = p.fields.clone();
    f.amount_cents = "15000".into();
    // 单边保存已关联计划被拒绝：共享计费编辑必须携带双方修订（设计 §9）。
    assert_eq!(
        code(s.recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(p.id.clone()),
                expected_revision: Some(p.revision),
                fields: f.clone(),
            },
            TODAY,
        )),
        "LINK_CONFLICT"
    );
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: v.id.clone(),
            asset_expected_revision: v.revision,
            plan_id: p.id.clone(),
            plan_expected_revision: p.revision,
            fields: f,
            billing: None,
            unify_name_to: None,
        },
        TODAY,
    )
    .unwrap();
    let mut q = Save {
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: Some(v.id.clone()),
        expected_revision: Some(v.revision),
        fields: v.fields.clone(),
        plan: Some(LinkedPlanSave {
            id: Some(p.id.clone()),
            expected_revision: Some(p.revision),
            fields: p.fields.clone(),
        }),
    };
    q.fields.name = "不可部分写入".into();
    assert_eq!(
        s.virtual_save(&q, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let after = s.virtual_overview(TODAY).unwrap().items.pop().unwrap();
    assert_eq!(after.fields.name, v.fields.name);
    assert_eq!(after.plan.unwrap().fields.amount_cents, "15000");
}
#[test]
fn paused_renewal_keeps_paid_rights_and_fixed_term_still_expires() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let v = s.virtual_save(&sub(&s), TODAY).unwrap();
    let p = v.plan.unwrap();
    s.recurring_payment_save(&pay(&s, &p.id, "2026-10-04", "14000"), TODAY)
        .unwrap();
    let mut f = p.fields.clone();
    f.paused = true;
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: v.id.clone(),
            asset_expected_revision: v.revision,
            plan_id: p.id.clone(),
            plan_expected_revision: p.revision,
            fields: f.clone(),
            billing: None,
            unify_name_to: None,
        },
        TODAY,
    )
    .unwrap();
    let out = s.virtual_overview(TODAY).unwrap().items.pop().unwrap();
    assert_eq!(out.status, "paused");
    assert_eq!(out.paid_until.as_deref(), Some("2026-11-03"));
    assert_eq!(out.spent_cents.as_deref(), Some("14000"));
    f.paused = false;
    f.end_date = Some("2026-11-30".into());
    // 结束同样经共享保存：双方修订已被暂停一步推进，按最新读取提交。
    let asset = s.virtual_overview(TODAY).unwrap().items.pop().unwrap();
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.id,
            asset_expected_revision: asset.revision,
            plan_id: p.id,
            plan_expected_revision: p.revision + 1,
            fields: f,
            billing: None,
            unify_name_to: None,
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.virtual_overview("2026-11-29").unwrap().items[0].status,
        "expiring"
    );
    assert_eq!(
        s.virtual_overview("2026-12-01").unwrap().items[0].status,
        "expired"
    );
}

#[test]
fn historical_subscription_ends_without_future_dues_and_backfills_only_confirmed_facts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = sub(&s);
    input.fields.purchase_date = Some("2024-01-20".into());
    let f = &mut input.plan.as_mut().unwrap().fields;
    f.service_start = Some("2024-01-20".into());
    f.first_due = "2026-01-20".into();
    f.coverage_start = Some("2026-01-20".into());
    f.end_date = Some("2026-02-19".into());
    let v = s.virtual_save(&input, TODAY).unwrap();
    assert_eq!(v.status, "expired");
    assert_eq!(v.valid_until.as_deref(), Some("2026-02-19"));
    assert_eq!(v.paid_count, 0);
    assert_eq!(v.spent_cents.as_deref(), Some("0"));
    let p = v.plan.unwrap();
    assert_eq!(p.estimated_cents.as_deref(), Some("350000"));
    assert_eq!(p.next_due, None);
    let o = s.virtual_overview(TODAY).unwrap();
    assert_eq!((o.in_use, o.expired), (0, 1));
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    let q = PaymentRangeSave {
        request_id: id(),
        generation: s.generation(),
        plan_id: p.id.clone(),
        expected_revision: p.revision,
        from_due: "2024-01-20".into(),
        to_due: "2026-01-20".into(),
        amount_cents: "14000".into(),
        confirmed: true,
    };
    s.recurring_payment_range_save(&q, TODAY).unwrap();
    s.recurring_payment_range_save(&q, TODAY).unwrap();
    let later = s.virtual_overview("2028-01-01").unwrap().items.remove(0);
    assert_eq!(later.status, "expired");
    assert_eq!(later.paid_count, 25);
    assert_eq!(later.spent_cents.as_deref(), Some("350000"));
    assert_eq!(
        later.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("350000")
    );
    assert_eq!(later.plan.unwrap().next_due, None);
    assert!(s.recurring_overview(TODAY).unwrap().due.is_empty());
    assert!(s.recurring_overview(TODAY).unwrap().upcoming.is_empty());
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "350000");
    drop(s);
    let restored = Store::open(dir.path())
        .unwrap()
        .virtual_overview(TODAY)
        .unwrap();
    assert_eq!(restored.items[0].paid_count, 25);
    assert_eq!(restored.items[0].spent_cents.as_deref(), Some("350000"));
}
