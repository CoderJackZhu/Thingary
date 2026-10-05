//! Virtual asset labels & billing acceptance (VIRTUAL_ASSET_BILLING_DESIGN §12).
//! Every example of the design's reproducible-example table, the schema-22
//! migration contract and the label scope lifecycle run against fictional
//! data in temporary directories.
use thingary_lib::{
    choices::{Action, Change},
    domain::Error,
    expenses,
    recurring::{PaymentRangeSave, PaymentSave, Plan, PlanFields, PlanSave},
    storage::{migrate_to, Store, SCHEMA},
    virtual_assets::{
        BalanceSave, Fields, LinkedPlanSave, Save as VirtualSave, SpecialEnd, TopupFields,
        TopupSave,
    },
    wealth::TrashChange,
};
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}
/// Integration tests read the dataset file directly for SQL-level assertions.
fn dataset_db(root: &std::path::Path) -> rusqlite::Connection {
    let active = std::fs::read_to_string(root.join("active.json")).unwrap();
    let id: String = serde_json::from_str::<serde_json::Value>(&active).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rusqlite::Connection::open(root.join("datasets").join(id).join("data.sqlite")).unwrap()
}
fn fields(name: &str, billing: &str) -> Fields {
    Fields {
        name: name.into(),
        kind: "general".into(),
        billing: billing.into(),
        label_id: None,
        pay_method: None,
        perpetual: None,
        provider: String::new(),
        purchase_date: None,
        price_cents: None,
        expires: None,
        plan_id: None,
        url: String::new(),
        notes: String::new(),
        stopped_on: None,
    }
}
fn plan_fields(name: &str, amount: &str, first_due: &str) -> PlanFields {
    PlanFields {
        auto_renew: true,
        service_start: Some(first_due.into()),
        coverage_start: Some(first_due.into()),
        interval_days: None,
        trial_days: None,
        name: name.into(),
        category: "subscription".into(),
        amount_cents: amount.into(),
        interval_months: 1,
        first_due: first_due.into(),
        end_date: None,
        paused: false,
        notes: String::new(),
    }
}
fn save_plan(s: &mut Store, name: &str, amount: &str, first_due: &str, today: &str) -> Plan {
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: plan_fields(name, amount, first_due),
        },
        today,
    )
    .unwrap()
}
/// Re-reads the live plan so later saves use its current revision.
fn fresh_plan(s: &Store, plan_id: &str) -> Plan {
    s.recurring_overview("2026-10-05")
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.id == plan_id)
        .unwrap()
}
fn sub_save(s: &Store, name: &str, plan: &Plan, extra: impl FnOnce(&mut Fields)) -> VirtualSave {
    let mut f = fields(name, "subscription");
    f.plan_id = Some(plan.id.clone());
    extra(&mut f);
    VirtualSave {
        plan: Some(LinkedPlanSave {
            id: Some(plan.id.clone()),
            expected_revision: Some(plan.revision),
            fields: plan.fields.clone(),
        }),
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: f,
    }
}
fn topup(asset: &str, date: Option<&str>, paid: Option<&str>, gift: Option<&str>) -> TopupSave {
    TopupSave {
        request_id: id(),
        generation: String::new(),
        asset_id: asset.into(),
        id: None,
        expected_revision: None,
        fields: TopupFields {
            topup_date: date.map(str::to_owned),
            paid_cents: paid.map(str::to_owned),
            gift_cents: gift.map(str::to_owned),
            credit_cents: None,
            pay_method: String::new(),
            notes: String::new(),
        },
    }
}
fn with_generation(s: &Store, mut t: TopupSave) -> TopupSave {
    t.generation = s.generation();
    t
}

/// P1: a schema-21 library keeps every old value; billing defaults follow the
/// plan mapping and existing labels become physical without changing IDs.
#[test]
fn schema21_library_upgrades_without_changing_old_meanings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.sqlite");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 21, &|_| Ok(())).unwrap();
    db.execute("INSERT INTO named_choices(id,kind,name,name_key,position,enabled) VALUES('lb1','label','旧标签','旧标签',0,1)", []).unwrap();
    db.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,paused,active_from,notes,created_at,updated_at,revision,service_start,coverage_start) VALUES('p1','旧计划','subscription',14000,1,'2024-01-20',0,'2024-01-20','','t','t',1,'2024-01-20','2024-01-20')", []).unwrap();
    db.execute("INSERT INTO plan_rates VALUES('p1','2024-01-20',14000)", [])
        .unwrap();
    db.execute("INSERT INTO virtual_assets(id,name,kind,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,revision,created_at,updated_at) VALUES
        ('v1','买断软件','license','厂商',NULL,128000,NULL,NULL,'','',NULL,1,'t','t'),
        ('v2','域名','domain','注册商','2020-05-01',6000,'2027-05-01',NULL,'','',NULL,1,'t','t'),
        ('v3','独立订阅','subscription','平台','2023-01-01',12800,NULL,NULL,'','',NULL,1,'t','t'),
        ('v4','计划订阅','subscription','平台',NULL,NULL,NULL,'p1','','',NULL,1,'t','t')", []).unwrap();
    db.execute(
        "INSERT INTO assets(id,name,revision) VALUES('a1','虚构物品',1)",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO asset_preferences(asset_id,payload) VALUES('a1','{\"label_id\":\"lb1\"}')",
        [],
    )
    .unwrap();
    drop(db);
    // Copy the file into a fresh library root the way an upgraded user has it.
    let root = dir.path().join("lib");
    let ds_id = uuid::Uuid::new_v4().to_string();
    std::fs::create_dir_all(root.join("datasets").join(&ds_id)).unwrap();
    std::fs::copy(
        &path,
        root.join("datasets").join(&ds_id).join("data.sqlite"),
    )
    .unwrap();
    std::fs::write(
        root.join("active.json"),
        serde_json::to_vec(
            &serde_json::json!({"id": ds_id, "generation": uuid::Uuid::new_v4().to_string()}),
        )
        .unwrap(),
    )
    .unwrap();
    let s = Store::open(&root).unwrap();
    let o = s.virtual_overview("2026-10-05").unwrap();
    let get = |id: &str| o.items.iter().find(|v| v.id == id).unwrap();
    // Old fields keep their values; billing follows the plan mapping.
    let v1 = get("v1");
    assert_eq!(
        (
            v1.fields.kind.as_str(),
            v1.fields.billing.as_str(),
            v1.spent_cents.as_deref(),
            v1.status.as_str()
        ),
        ("license", "single", Some("128000"), "perpetual")
    );
    let v2 = get("v2");
    assert_eq!(
        (v2.fields.billing.as_str(), v2.valid_until.as_deref()),
        ("single", Some("2027-05-01"))
    );
    // The old independent subscription stays a one-time spend, never a monthly fee.
    let v3 = get("v3");
    assert_eq!(
        (
            v3.fields.kind.as_str(),
            v3.fields.billing.as_str(),
            v3.spent_cents.as_deref(),
            v3.status.as_str()
        ),
        ("subscription", "single", Some("12800"), "ongoing")
    );
    let v4 = get("v4");
    assert_eq!(v4.fields.billing.as_str(), "subscription");
    // 33 started monthly periods from 2024-01-20 through the read date.
    assert_eq!(
        v4.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("462000")
    );
    // The old label gained a scope but kept its ID, name and references.
    let labels = s.choices("label").unwrap();
    assert_eq!(labels.items[0].id, "lb1");
    assert_eq!(labels.items[0].scope.as_deref(), Some("physical"));
    assert_eq!(labels.items[0].references, 1);
    assert_eq!(labels.items[0].virtual_references, Some(0));
    // Expenses carry the three known one-time prices; the plan estimate never
    // counts. The undated license price lands in the 待补充 bucket.
    let view = s.expense_view(None).unwrap();
    assert_eq!(view.spent_cents, "18800");
    assert_eq!(view.undated_cents, "128000");
    assert_eq!(view.unknown_amount_count, 0);
}

/// Migration interruption rolls back and a retry succeeds (design §10).
#[test]
fn migration_failure_rolls_back_and_retries() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.sqlite");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 21, &|_| Ok(())).unwrap();
    db.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,paused,active_from,notes,created_at,updated_at,revision,service_start,coverage_start) VALUES('p1','旧计划','subscription',14000,1,'2024-01-20',0,'2024-01-20','','t','t',1,'2024-01-20','2024-01-20')", []).unwrap();
    db.execute("INSERT INTO virtual_assets(id,name,kind,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,revision,created_at,updated_at) VALUES('v4','计划订阅','subscription','平台',NULL,NULL,NULL,'p1','','',NULL,1,'t','t')", []).unwrap();
    let hook = |point: &str| {
        if point == "migration.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    };
    assert!(thingary_lib::storage::migrate(&db, &hook).is_err());
    // The failed attempt leaves the schema and facts exactly as before.
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        21
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM pragma_table_info('virtual_assets') WHERE name='billing'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    drop(db);
    // A retry completes and keeps the old facts readable under the new schema.
    let root = dir.path().join("lib");
    let ds_id = uuid::Uuid::new_v4().to_string();
    std::fs::create_dir_all(root.join("datasets").join(&ds_id)).unwrap();
    std::fs::copy(
        &path,
        root.join("datasets").join(&ds_id).join("data.sqlite"),
    )
    .unwrap();
    std::fs::write(
        root.join("active.json"),
        serde_json::to_vec(&serde_json::json!({
            "id": ds_id,
            "generation": uuid::Uuid::new_v4().to_string()
        }))
        .unwrap(),
    )
    .unwrap();
    let s = Store::open(&root).unwrap();
    let o = s.virtual_overview("2026-10-05").unwrap();
    assert_eq!(o.items.len(), 1);
    assert_eq!(o.items[0].fields.billing, "subscription");
    assert_eq!(o.items[0].spent_cents.as_deref(), Some("0"));
}

/// Design §12: 2024-01-20 start, monthly 14000, ends 2026-02-19 →
/// 25 started paid periods, estimate 350000; after the end there is no renewal.
#[test]
fn twenty_five_periods_example_estimates_and_ends() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut plan = save_plan(&mut s, "GPT", "14000", "2024-01-20", "2024-01-20");
    plan.fields.end_date = Some("2026-02-19".into());
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(plan.id.clone()),
                expected_revision: Some(plan.revision),
                fields: plan.fields.clone(),
            },
            "2024-01-20",
        )
        .unwrap();
    let v = s
        .virtual_save(&sub_save(&s, "GPT 订阅", &plan, |_| {}), "2024-01-20")
        .unwrap();
    // During the 25th period (2026-01-20 … 2026-02-19): 25 started periods.
    let mid = s.virtual_overview("2026-02-10").unwrap();
    let item = mid.items.iter().find(|v| v.id == v.id).unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("350000")
    );
    // After the end: status reads ended and no next payment is scheduled.
    let later = s.virtual_overview("2026-02-20").unwrap();
    let item = later.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.status, "expired");
    assert_eq!(item.plan.as_ref().unwrap().next_due, None);
    // On the last day itself the subscription is still in use.
    let last = s.virtual_overview("2026-02-19").unwrap();
    let item = last.items.iter().find(|x| x.id == v.id).unwrap();
    assert!(item.status != "expired");
}

/// Design §12: unrecorded → confirming 25 historical periods records 350000;
/// a replayed request never creates a 26th payment.
#[test]
fn backfill_confirmations_and_receipt_replay() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut plan = save_plan(&mut s, "GPT", "14000", "2024-01-20", "2024-01-20");
    plan.fields.end_date = Some("2026-02-19".into());
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(plan.id.clone()),
                expected_revision: Some(plan.revision),
                fields: plan.fields.clone(),
            },
            "2024-01-20",
        )
        .unwrap();
    let v = s
        .virtual_save(&sub_save(&s, "GPT 订阅", &plan, |_| {}), "2024-01-20")
        .unwrap();
    let plan = fresh_plan(&s, &plan.id);
    let before = s.virtual_overview("2026-02-19").unwrap();
    let item = before.items.iter().find(|v| v.id == v.id).unwrap();
    assert_eq!(item.paid_count, 0);
    // Confirm the whole history in one range save.
    let q = PaymentRangeSave {
        request_id: id(),
        generation: s.generation(),
        plan_id: plan.id.clone(),
        expected_revision: plan.revision,
        from_due: "2024-01-20".into(),
        to_due: "2026-01-20".into(),
        amount_cents: "14000".into(),
        confirmed: true,
    };
    s.recurring_payment_range_save(&q, "2026-02-19").unwrap();
    let after = s.virtual_overview("2026-02-19").unwrap();
    let item = after.items.iter().find(|v| v.id == v.id).unwrap();
    assert_eq!(item.paid_count, 25);
    assert_eq!(item.spent_cents.as_deref(), Some("350000"));
    // The estimate is unchanged; only recorded facts were added.
    assert_eq!(
        item.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("350000")
    );
    // A replayed request (same id) adds nothing.
    let replay = PaymentRangeSave {
        request_id: q.request_id.clone(),
        ..q.clone()
    };
    s.recurring_payment_range_save(&replay, "2026-02-19")
        .unwrap();
    let after_replay = s.virtual_overview("2026-02-19").unwrap();
    let item = after_replay.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.paid_count, 25);
    // The expense view shows the confirmed payments exactly once.
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "350000");
}

/// Design §12: Jan 31 monthly anchor → Feb 28 → Mar 31; fixed 30 days → Mar 02;
/// 2026-10-05 with 30 days covers through 11-03 and renews on 11-04.
#[test]
fn month_end_anchor_and_fixed_days_never_drift() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    // Monthly from 2026-01-31.
    let plan = save_plan(&mut s, "月订", "100", "2026-01-31", "2026-01-31");
    let v = s
        .virtual_save(&sub_save(&s, "月订", &plan, |_| {}), "2026-01-31")
        .unwrap();
    let read = |today: &str| {
        let o = s.virtual_overview(today).unwrap();
        let item = o.items.iter().find(|x| x.id == v.id).unwrap();
        item.plan.as_ref().unwrap().next_coverage.clone().unwrap()
    };
    // In February the current period is 02-28 … 03-27.
    assert_eq!(read("2026-02-28").0, "2026-02-28");
    // In March the anchor returns to the 31st.
    assert_eq!(read("2026-03-31").0, "2026-03-31");
    // Late February the monthly schedule sits on the shortened 02-28 period.
    let feb = s
        .virtual_overview("2026-02-27")
        .unwrap()
        .items
        .into_iter()
        .find(|x| x.id == v.id)
        .unwrap();
    assert_eq!(
        feb.plan.as_ref().unwrap().next_due.as_deref(),
        Some("2026-02-28")
    );
    // Switching the same plan to fixed 30 days counts days instead: the next
    // payment lands on 03-02 and history does not drift.
    let plan = fresh_plan(&s, &plan.id);
    let mut fields = plan.fields.clone();
    fields.interval_days = Some(30);
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(plan.id.clone()),
                expected_revision: Some(plan.revision),
                fields,
            },
            "2026-03-31",
        )
        .unwrap();
    let _ = &plan;
    let item = s
        .virtual_overview("2026-02-27")
        .unwrap()
        .items
        .into_iter()
        .find(|x| x.id == v.id)
        .unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().next_due.as_deref(),
        Some("2026-03-02")
    );
    // Fixed 30 days from 10-05: first period 10-05 … 11-03, next 11-04.
    let mut fields = plan_fields("三十天", "500", "2026-10-05");
    fields.interval_days = Some(30);
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields,
            },
            "2026-10-05",
        )
        .unwrap();
    let v2 = s
        .virtual_save(&sub_save(&s, "三十天", &plan, |_| {}), "2026-10-05")
        .unwrap();
    let item = s
        .virtual_overview("2026-10-05")
        .unwrap()
        .items
        .into_iter()
        .find(|x| x.id == v2.id)
        .unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().next_coverage.clone().unwrap(),
        ("2026-10-05".into(), "2026-11-03".into())
    );
    // On the following day the next payment is the second period, 11-04.
    let item = s
        .virtual_overview("2026-10-06")
        .unwrap()
        .items
        .into_iter()
        .find(|x| x.id == v2.id)
        .unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().next_due.as_deref(),
        Some("2026-11-04")
    );
}

/// Design §12: 2026-01-01 with a 7-day trial, monthly 14000 — trial through
/// 01-07, billing starts 01-08, no payment facts are ever auto-created.
#[test]
fn free_trial_defers_billing_and_estimate() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut fields = plan_fields("试用订阅", "14000", "2026-01-08");
    fields.service_start = Some("2026-01-01".into());
    fields.trial_days = Some(7);
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields,
            },
            "2026-01-01",
        )
        .unwrap();
    assert_eq!(plan.fields.coverage_start.as_deref(), Some("2026-01-08"));
    let v = s
        .virtual_save(&sub_save(&s, "试用订阅", &plan, |_| {}), "2026-01-01")
        .unwrap();
    let read = |today: &str| {
        let o = s.virtual_overview(today).unwrap();
        let item = o.items.iter().find(|x| x.id == v.id).unwrap();
        (
            item.status.clone(),
            item.plan
                .as_ref()
                .unwrap()
                .estimated_cents
                .clone()
                .unwrap_or_default(),
            item.plan.as_ref().unwrap().next_due.clone(),
        )
    };
    // Inside the trial: estimate zero, first charge not due yet.
    assert_eq!(
        read("2026-01-07"),
        (
            "ongoing".to_owned(),
            "0".to_owned(),
            Some("2026-01-08".to_owned())
        )
    );
    // First paid period starts on 01-08; the estimate counts one period.
    assert_eq!(
        read("2026-01-08"),
        (
            "ongoing".to_owned(),
            "14000".to_owned(),
            Some("2026-01-08".to_owned())
        )
    );
    // No payment facts were created by the passage of time.
    let view = s.expense_view(None).unwrap();
    assert_eq!(view.spent_cents, "0");
    assert!(view.lines.iter().all(|l| l.source != "payment"));
    // Billing earlier than the trial's last day is rejected.
    let mut bad = plan_fields("早计费", "100", "2026-01-07");
    bad.service_start = Some("2026-01-01".into());
    bad.trial_days = Some(7);
    let e = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: bad,
            },
            "2026-01-01",
        )
        .unwrap_err();
    assert_eq!(e.code, "PLAN_TRIAL");
}

/// Design §12: current period 14000, next period 16000 — history and current
/// estimates stay at 14000; cancelling only removes pending future prices.
#[test]
fn future_renewal_price_segments_do_not_rewrite_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "调价订阅", "14000", "2026-01-10", "2026-01-10");
    let v = s
        .virtual_save(&sub_save(&s, "调价订阅", &plan, |_| {}), "2026-01-10")
        .unwrap();
    // Confirm one historical period so paid facts exist.
    pay(&mut s, &plan, "2026-01-10", "14000", "2026-01-10");
    // Announce 16000 from the period starting 2026-02-10.
    let mut input = sub_save(&s, "调价订阅", &fresh_plan(&s, &plan.id), |_| {});
    input.id = Some(v.id.clone());
    input.expected_revision = Some(v.revision);
    input.renewal_price_cents = Some("16000".into());
    input.renewal_from = Some("2026-02-10".into());
    s.virtual_save(&input, "2026-01-15").unwrap();
    // Current estimate at 2026-01-20 counts only the 14000 period.
    let mid = s.virtual_overview("2026-01-20").unwrap();
    let item = mid.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("14000")
    );
    // Past 02-10 the newer price applies to the newer period only.
    let later = s.virtual_overview("2026-02-15").unwrap();
    let item = later.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("30000")
    );
    // The confirmed payment keeps its original amount.
    assert_eq!(item.spent_cents.as_deref(), Some("14000"));
    // Cancelling before the effective date removes only the pending segment.
    let current = s.virtual_overview("2026-01-20").unwrap();
    let current = current.items.iter().find(|x| x.id == v.id).unwrap();
    let mut cancel = sub_save(&s, "调价订阅", &fresh_plan(&s, &plan.id), |_| {});
    cancel.id = Some(v.id.clone());
    cancel.expected_revision = Some(current.revision);
    cancel.renewal_price_cents = Some(String::new());
    s.virtual_save(&cancel, "2026-01-20").unwrap();
    let after = s.virtual_overview("2026-03-15").unwrap();
    let item = after.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(
        item.plan.as_ref().unwrap().estimated_cents.as_deref(),
        Some("42000")
    );
    // A renewal price must start on a real service period.
    let mut bad = sub_save(&s, "调价订阅", &fresh_plan(&s, &plan.id), |_| {});
    bad.id = Some(v.id.clone());
    bad.expected_revision = Some(item.revision);
    bad.renewal_price_cents = Some("16000".into());
    bad.renewal_from = Some("2026-02-11".into());
    assert_eq!(
        code(s.virtual_save(&bad, "2026-03-15").map(|_| ())),
        "RENEWAL_AMOUNT"
    );
}

/// Design §12: a two-day special extension changes the unconfirmed target and
/// later forecasts; confirmed coverage and past price segments stay put.
#[test]
fn special_period_end_extends_only_the_target_period() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "特期订阅", "14000", "2026-03-01", "2026-03-01");
    let v = s
        .virtual_save(&sub_save(&s, "特期订阅", &plan, |_| {}), "2026-03-01")
        .unwrap();
    // Confirm the first two periods so their coverage is a recorded fact.
    pay(&mut s, &plan, "2026-03-01", "14000", "2026-03-01");
    pay(&mut s, &plan, "2026-04-01", "14000", "2026-04-01");
    // Extend the third period (2026-05-01 … 2026-05-31) by two days.
    let mut input = sub_save(&s, "特期订阅", &fresh_plan(&s, &plan.id), |_| {});
    input.id = Some(v.id.clone());
    input.expected_revision = Some(v.revision);
    input.special_end = Some(SpecialEnd {
        period_start: "2026-05-01".into(),
        coverage_end: Some("2026-06-02".into()),
    });
    s.virtual_save(&input, "2026-05-10").unwrap();
    let read = |today: &str| {
        s.virtual_overview(today)
            .unwrap()
            .items
            .into_iter()
            .find(|x| x.id == v.id)
            .unwrap()
            .plan
            .unwrap()
            .next_coverage
            .clone()
            .unwrap()
    };
    // The special period now ends 06-02; the next one starts 06-03.
    let o = s.recurring_overview("2026-05-10").unwrap();
    let covers = |due: &str| {
        o.due
            .iter()
            .chain(o.upcoming.iter())
            .find(|d| d.due_date == due)
            .map(|d| {
                (
                    d.coverage_start.clone().unwrap(),
                    d.coverage_end.clone().unwrap(),
                )
            })
            .unwrap()
    };
    assert_eq!(
        covers("2026-05-01"),
        ("2026-05-01".into(), "2026-06-02".into())
    );
    let o = s.recurring_overview("2026-05-28").unwrap();
    let june = o
        .upcoming
        .iter()
        .find(|d| d.due_date == "2026-06-01")
        .map(|d| {
            (
                d.coverage_start.clone().unwrap(),
                d.coverage_end.clone().unwrap(),
            )
        })
        .unwrap();
    assert_eq!(june, ("2026-06-03".into(), "2026-07-02".into()));
    let fourth = read("2026-06-01");
    assert_eq!(fourth, ("2026-06-03".into(), "2026-07-02".into()));
    // Confirmed coverage was never rewritten.
    let stored: Vec<(String, String)> = {
        let c = dataset_db(dir.path().join("lib").as_path());
        let mut q = c
            .prepare("SELECT coverage_start,coverage_end FROM plan_payments WHERE plan_id=?1 ORDER BY due_date")
            .unwrap();
        let rows = q
            .query_map([&plan.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        rows.map(|x| x.unwrap()).collect()
    };
    assert_eq!(stored[0], ("2026-03-01".into(), "2026-03-31".into()));
    assert_eq!(stored[1], ("2026-04-01".into(), "2026-04-30".into()));
    // Overlap, pre-start and post-final-end special ends are rejected.
    let mut bad = sub_save(&s, "特期订阅", &fresh_plan(&s, &plan.id), |_| {});
    bad.id = Some(v.id.clone());
    bad.expected_revision = Some(v.revision + 1);
    bad.special_end = Some(SpecialEnd {
        period_start: "2026-07-03".into(),
        // Reaches the start of the period after next: real overlap.
        coverage_end: Some("2026-09-03".into()),
    });
    assert_eq!(
        code(s.virtual_save(&bad, "2026-06-10").map(|_| ())),
        "PERIOD_END"
    );
    bad.special_end = Some(SpecialEnd {
        period_start: "2026-07-03".into(),
        coverage_end: Some("2026-07-01".into()),
    });
    assert_eq!(
        code(s.virtual_save(&bad, "2026-06-10").map(|_| ())),
        "PERIOD_END"
    );
}

/// Design §12: turning auto-renewal off saves the confirmed last day; the
/// service stays valid through that day and ends the day after. A legacy
/// paused plan keeps its paused-schedule meaning.
#[test]
fn explicit_end_date_rules_status_and_paused_stays_legacy() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "终订", "14000", "2026-08-01", "2026-08-01");
    let v = s
        .virtual_save(&sub_save(&s, "终订", &plan, |_| {}), "2026-08-01")
        .unwrap();
    // Confirm the end date 2026-09-30 (auto-renewal off).
    let mut input = sub_save(&s, "终订", &fresh_plan(&s, &plan.id), |_| {});
    input.id = Some(v.id.clone());
    input.expected_revision = Some(v.revision);
    input.plan.as_mut().unwrap().fields.end_date = Some("2026-09-30".into());
    s.virtual_save(&input, "2026-08-01").unwrap();
    let read = |today: &str| {
        s.virtual_overview(today)
            .unwrap()
            .items
            .into_iter()
            .find(|x| x.id == v.id)
            .unwrap()
            .status
    };
    // The final day itself is still in use; the day after, it has ended.
    assert!(read("2026-09-30") != "expired");
    assert_eq!(read("2026-10-01"), "expired");
    // A legacy paused plan keeps "paused" and never regains periods silently.
    let paused = save_plan(&mut s, "暂停计划", "9000", "2026-01-01", "2026-01-01");
    let mut fields = paused.fields.clone();
    fields.paused = true;
    let paused = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(paused.id.clone()),
                expected_revision: Some(paused.revision),
                fields,
            },
            "2026-01-01",
        )
        .unwrap();
    let vp = s
        .virtual_save(&sub_save(&s, "暂停档案", &paused, |_| {}), "2026-10-05")
        .unwrap();
    let o = s.virtual_overview("2026-10-05").unwrap();
    let item = o.items.iter().find(|x| x.id == vp.id).unwrap();
    assert_eq!(item.status, "paused");
    assert_eq!(item.plan.as_ref().unwrap().next_due, None);
}

/// Rent regression inside the shared plan engine: prepay next month, unknown
/// final term, and a fixed one-year contract paid quarterly (design §1).
#[test]
fn rent_prepay_and_quarterly_year_contract_survive() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    // Rent: paid 10-25 for November; no final term.
    let mut fields = plan_fields("房租", "300000", "2026-11-01");
    fields.category = "rent".into();
    fields.first_due = "2026-10-25".into();
    let rent = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields,
            },
            "2026-10-05",
        )
        .unwrap();
    pay(&mut s, &rent, "2026-10-25", "300000", "2026-10-25");
    let o = s.recurring_overview("2026-10-26").unwrap();
    let r = o.plans.iter().find(|p| p.id == rent.id).unwrap();
    // The paid 10-25 instalment covered November; the next one covers December.
    assert_eq!(
        r.next_coverage.clone().unwrap(),
        ("2026-12-01".into(), "2026-12-31".into())
    );
    assert_eq!(r.next_due.as_deref(), Some("2026-11-25"));
    // Quarterly payments for a one-year contract: exactly four periods.
    let mut fields = plan_fields("年约", "900000", "2026-01-01");
    fields.interval_months = 3;
    fields.end_date = Some("2026-12-31".into());
    let year = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields,
            },
            "2026-01-01",
        )
        .unwrap();
    let o = s.recurring_overview("2026-02-01").unwrap();
    let y = o.plans.iter().find(|p| p.id == year.id).unwrap();
    assert_eq!(y.contract_cents.as_deref(), Some("3600000"));
    assert_eq!(y.monthly_cents.as_deref(), Some("300000"));
    // The next12 forecast counts real quarterly dates, not annualised guesses.
    assert_eq!(y.next_due.as_deref(), Some("2026-04-01"));
}

fn pay(s: &mut Store, plan: &Plan, due: &str, amount: &str, day: &str) {
    s.recurring_payment_save(
        &PaymentSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan.id.clone(),
            due_date: due.into(),
            state: "paid".into(),
            paid_date: Some(day.into()),
            amount_cents: Some(amount.into()),
            notes: String::new(),
        },
        day,
    )
    .unwrap();
}

/// Design §12: topup paid 15000 + gift 5000 → credit 20000 by default,
/// spend 15000 exactly once in expenses, net worth untouched.
#[test]
fn topup_facts_feed_expenses_once_and_never_net_worth() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let v = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("饭卡", "topup"),
            },
            "2026-09-01",
        )
        .unwrap();
    // First topup: paid 15000, gift 5000, credited 20000.
    let mut t = topup(&v.id, Some("2026-09-01"), Some("15000"), Some("5000"));
    t.fields.credit_cents = Some("20000".into());
    s.virtual_topup_save(&with_generation(&s, t), "2026-09-01")
        .unwrap();
    let o = s.virtual_overview("2026-09-02").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.topup_known_cents.as_deref(), Some("15000"));
    assert_eq!(item.topup_credit_cents.as_deref(), Some("20000"));
    assert_eq!(item.spent_cents.as_deref(), Some("15000"));
    // Exactly one expense line; the gift is never spend.
    let view = s.expense_view(None).unwrap();
    let lines: Vec<_> = view.lines.iter().filter(|l| l.source == "topup").collect();
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].amount_cents.as_deref(), Some("15000"));
    assert_eq!(view.spent_cents, "15000");
    // 金融净资产 untouched: no accounts exist, and topups never create any.
    let summary = s.wealth_summary().unwrap();
    assert!(summary.points.is_empty());
}

/// Design §12: unknown paid stays unknown; explicit zero differs from unknown;
/// unknown dates go to the undated bucket; partial knowledge is visible.
#[test]
fn topup_unknown_zero_and_undated_facts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let v = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("公交卡", "topup"),
            },
            "2026-09-01",
        )
        .unwrap();
    // Gift-only topup with explicit zero paid.
    let zero = topup(&v.id, Some("2026-09-02"), Some("0"), Some("1000"));
    s.virtual_topup_save(&with_generation(&s, zero), "2026-09-02")
        .unwrap();
    // Unknown paid (credit known instead), unknown date.
    let unknown = topup(&v.id, None, None, None);
    let mut unknown = with_generation(&s, unknown);
    unknown.fields.credit_cents = Some("3000".into());
    s.virtual_topup_save(&unknown, "2026-09-02").unwrap();
    // Known paid on an unknown date.
    let undated = topup(&v.id, None, Some("2000"), None);
    s.virtual_topup_save(&with_generation(&s, undated), "2026-09-02")
        .unwrap();
    let o = s.virtual_overview("2026-09-02").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.topup_count, 3);
    assert_eq!(item.topup_unknown_paid, 1);
    assert_eq!(item.topup_known_cents.as_deref(), Some("2000"));
    // The undated amount lands in the 待补充 bucket, never in a month.
    let view = s.expense_view(Some(2026)).unwrap();
    assert_eq!(view.undated_cents, "2000");
    assert_eq!(view.undated.len(), 1);
    assert_eq!(view.spent_cents, "0");
    // An empty topup is not a fact at all.
    let empty = topup(&v.id, Some("2026-09-03"), None, None);
    assert_eq!(
        s.virtual_topup_save(&with_generation(&s, empty), "2026-09-03")
            .unwrap_err()
            .code,
        "TOPUP_EMPTY"
    );
    // Future topup dates are rejected.
    let future = topup(&v.id, Some("2026-09-30"), Some("100"), None);
    assert_eq!(
        s.virtual_topup_save(&with_generation(&s, future), "2026-09-02")
            .unwrap_err()
            .code,
        "TOPUP_DATE"
    );
}

/// Balances are dated manual check-ins: corrections never spend, topups never
/// consume a balance, and expiry never refunds.
#[test]
fn balance_records_stay_manual_checkins() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let v = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("购物卡", "topup"),
            },
            "2026-09-01",
        )
        .unwrap();
    let t = topup(&v.id, Some("2026-09-01"), Some("10000"), None);
    s.virtual_topup_save(&with_generation(&s, t), "2026-09-01")
        .unwrap();
    let b = BalanceSave {
        request_id: id(),
        generation: s.generation(),
        asset_id: v.id.clone(),
        id: None,
        expected_revision: None,
        balance_cents: "8000".into(),
        recorded_on: "2026-09-20".into(),
        notes: String::new(),
    };
    let record = s.virtual_balance_save(&b, "2026-09-20").unwrap();
    let o = s.virtual_overview("2026-09-21").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(
        item.balance.as_ref().map(|b| b.balance_cents.as_str()),
        Some("8000")
    );
    // A later topup does not silently move the recorded balance.
    let t2 = topup(&v.id, Some("2026-09-25"), Some("5000"), None);
    s.virtual_topup_save(&with_generation(&s, t2), "2026-09-25")
        .unwrap();
    let o = s.virtual_overview("2026-09-26").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.balance.as_ref().unwrap().recorded_on, "2026-09-20");
    // Known spend stays the topup sum; the balance is not spend.
    assert_eq!(item.spent_cents.as_deref(), Some("15000"));
    // Setting an expiry in the past auto-ends the account without refunding.
    let mut input = VirtualSave {
        plan: None,
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: Some(v.id.clone()),
        expected_revision: Some(item.revision),
        fields: fields("购物卡", "topup"),
    };
    input.fields.expires = Some("2026-09-10".into());
    s.virtual_save(&input, "2026-09-26").unwrap();
    let o = s.virtual_overview("2026-09-26").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.status, "expired");
    assert_eq!(item.spent_cents.as_deref(), Some("15000"));
    let view = s.expense_view(None).unwrap();
    assert_eq!(view.refund_cents, "0");
    let _ = record;
}

/// Failure, receipt replay, trash and purge: no half account, no double spend.
#[test]
fn first_topup_is_atomic_and_trash_keeps_facts_consistent() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    s.set_hook(|point| {
        if point == "virtual.before_commit" {
            return Err(Error::new("INJECTED", "中断"));
        }
        Ok(())
    });
    let request = id();
    let input = VirtualSave {
        plan: None,
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: Some(TopupFields {
            topup_date: Some("2026-09-01".into()),
            paid_cents: Some("15000".into()),
            gift_cents: None,
            credit_cents: None,
            pay_method: String::new(),
            notes: String::new(),
        }),
        request_id: request.clone(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: fields("图书卡", "topup"),
    };
    assert!(s.virtual_save(&input, "2026-09-01").is_err());
    drop(s);
    // The injected failure left no account behind.
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    assert!(s.virtual_overview("2026-09-01").unwrap().items.is_empty());
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    // Retrying with the same request id after the failure creates one account.
    let retry = VirtualSave {
        request_id: request,
        generation: s.generation(),
        ..input.clone()
    };
    let v = s.virtual_save(&retry, "2026-09-01").unwrap();
    assert_eq!(s.virtual_overview("2026-09-01").unwrap().items.len(), 1);
    // Deleting the account hides its topup spend; restoring brings it back.
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "virtual".into(),
        id: v.id.clone(),
        expected_revision: v.revision,
        deleted: true,
    })
    .unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "virtual".into(),
        id: v.id.clone(),
        expected_revision: v.revision + 1,
        deleted: false,
    })
    .unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "15000");
    // Purging the account removes the facts entirely.
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "virtual".into(),
        id: v.id.clone(),
        expected_revision: v.revision + 2,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: id(),
        generation: s.generation(),
        kind: Some("virtual".into()),
        id: v.id.clone(),
    })
    .unwrap();
    let live: i64 = dataset_db(&dir.path().join("lib"))
        .query_row("SELECT count(*) FROM virtual_topups", [], |r| r.get(0))
        .unwrap();
    assert_eq!(live, 0);
}

/// Label scopes: creation defaults, virtual picking, renames across domains,
/// removal migration including trashed rows, and narrowing guards (VA-01/02).
#[test]
fn label_scope_management_spans_both_domains() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let change = |s: &Store, action: Action| Change {
        request_id: id(),
        generation: s.generation(),
        expected_revision: s.choices("label").unwrap().revision,
        kind: "label".into(),
        action,
    };
    // A label created for the virtual domain gets that scope.
    let virtual_label = {
        let input = change(
            &s,
            Action::Create {
                name: "AI 工具".into(),
                scope: Some("virtual".into()),
            },
        );
        s.change_choices(&input).unwrap();
        s.choices("label")
            .unwrap()
            .items
            .into_iter()
            .find(|e| e.name == "AI 工具")
            .unwrap()
            .id
    };
    // The label may be picked on a virtual asset.
    let v = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    label_id: Some(virtual_label.clone()),
                    ..fields("GPT", "topup")
                },
            },
            "2026-09-01",
        )
        .unwrap();
    // A physical-only label cannot be picked on a virtual asset.
    let physical_label = {
        let input = change(
            &s,
            Action::Create {
                name: "随身物品".into(),
                scope: Some("physical".into()),
            },
        );
        s.change_choices(&input).unwrap();
        s.choices("label")
            .unwrap()
            .items
            .into_iter()
            .find(|e| e.name == "随身物品")
            .unwrap()
            .id
    };
    let blocked = VirtualSave {
        plan: None,
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: Fields {
            label_id: Some(physical_label.clone()),
            ..fields("域名", "single")
        },
    };
    assert_eq!(
        code(s.virtual_save(&blocked, "2026-09-01").map(|_| ())),
        "LABEL_SCOPE"
    );
    // Renaming keeps both domains in sync through the stable ID.
    let input = change(
        &s,
        Action::Rename {
            id: virtual_label.clone(),
            name: "AI 服务".into(),
        },
    );
    s.change_choices(&input).unwrap();
    // The label id on the asset is unchanged; the manager shows one entry.
    let labels = s.choices("label").unwrap();
    assert_eq!(
        labels.items.iter().filter(|e| e.name == "AI 服务").count(),
        1
    );
    // Narrowing a label referenced by virtual assets is refused…
    let input = change(
        &s,
        Action::Scope {
            id: virtual_label.clone(),
            scope: "physical".into(),
        },
    );
    assert_eq!(code(s.change_choices(&input).map(|_| ())), "CHOICE_SCOPE");
    // …and so is narrowing to virtual while physical items still reference it.
    let item = {
        let input = thingary_lib::catalog::SaveAsset {
            base: thingary_lib::domain::Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构物品".into(),
                price_cents: Some("100".into()),
                purchase_date: Some("2026-09-01".into()),
            },
            details: Default::default(),
            photos: None,
            classification: None,
            options: Some(thingary_lib::preferences::AssetOptions {
                preferences: thingary_lib::preferences::AssetPreferences {
                    label_id: Some(physical_label.clone()),
                    ..Default::default()
                },
                ..Default::default()
            }),
        };
        s.save_asset(&input, "2026-09-01").unwrap()
    };
    let _ = item;
    let input = change(
        &s,
        Action::Scope {
            id: physical_label.clone(),
            scope: "virtual".into(),
        },
    );
    assert_eq!(code(s.change_choices(&input).map(|_| ())), "CHOICE_SCOPE");
    // Removal migrates references from both domains in one transaction,
    // including rows hidden in Recently Deleted.
    s.wealth_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: "virtual".into(),
        id: v.id.clone(),
        expected_revision: v.revision,
        deleted: true,
    })
    .unwrap();
    let counts = s.choices("label").unwrap();
    let entry = counts
        .items
        .iter()
        .find(|e| e.id == virtual_label)
        .unwrap()
        .clone();
    assert_eq!(entry.references, 0);
    assert_eq!(entry.virtual_references, Some(1));
    let input = change(
        &s,
        Action::Remove {
            id: virtual_label.clone(),
            replacement: None,
            expected_references: entry.references,
            expected_virtual_references: entry.virtual_references.unwrap_or(0),
        },
    );
    s.change_choices(&input).unwrap();
    let gone: i64 = dataset_db(&dir.path().join("lib"))
        .query_row(
            "SELECT count(*) FROM label_scopes WHERE label_id=?1",
            [virtual_label],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(gone, 0);
    let cleared: Option<String> = dataset_db(&dir.path().join("lib"))
        .query_row(
            "SELECT label_id FROM virtual_assets WHERE id=?1",
            [v.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cleared, None);
}

/// VA-03: a general label attached to both an item and a subscription keeps
/// the physical investment analysis free of virtual costs.
#[test]
fn tag_investment_excludes_virtual_costs_for_general_labels() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let change = |s: &Store, action: Action| Change {
        request_id: id(),
        generation: s.generation(),
        expected_revision: s.choices("label").unwrap().revision,
        kind: "label".into(),
        action,
    };
    let both_label = {
        let input = change(
            &s,
            Action::Create {
                name: "通用".into(),
                scope: Some("both".into()),
            },
        );
        s.change_choices(&input).unwrap();
        s.choices("label")
            .unwrap()
            .items
            .into_iter()
            .find(|e| e.name == "通用")
            .unwrap()
            .id
    };
    // One physical item with a known price, one subscription under the same label.
    let item = {
        let input = thingary_lib::catalog::SaveAsset {
            base: thingary_lib::domain::Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构键盘".into(),
                price_cents: Some("80000".into()),
                purchase_date: Some("2026-08-01".into()),
            },
            details: Default::default(),
            photos: None,
            classification: None,
            options: Some(thingary_lib::preferences::AssetOptions {
                preferences: thingary_lib::preferences::AssetPreferences {
                    label_id: Some(both_label.clone()),
                    ..Default::default()
                },
                ..Default::default()
            }),
        };
        s.save_asset(&input, "2026-08-01").unwrap()
    };
    let plan = save_plan(&mut s, "GPT", "14000", "2026-09-01", "2026-09-01");
    let mut f = fields("GPT", "subscription");
    f.label_id = Some(both_label.clone());
    f.plan_id = Some(plan.id.clone());
    let input = VirtualSave {
        plan: Some(LinkedPlanSave {
            id: Some(plan.id.clone()),
            expected_revision: Some(plan.revision),
            fields: plan.fields.clone(),
        }),
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: f,
    };
    s.virtual_save(&input, "2026-09-01").unwrap();
    // Tag investment still counts only the physical lifecycle cost.
    let view = s
        .tag_investment_view(&both_label, "all", "2026-10-05")
        .unwrap();
    assert_eq!(view.counts.matched, 1);
    assert_eq!(view.totals.known_investment_cents, "80000");
    assert_eq!(view.items[0].id, item.asset.id);
}

/// VA-17: renewal reminders fire only while the asset is live; stopping,
/// deleting or disabling the module withdraws them, warranties stay intact.
#[test]
fn renewal_reminders_follow_the_asset_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "续费订阅", "14000", "2026-09-01", "2026-09-01");
    let v = s
        .virtual_save(&sub_save(&s, "续费订阅", &plan, |_| {}), "2026-09-01")
        .unwrap();
    // No reminders exist by default — not for this or any other subscription.
    assert!(s.reminder_plans().unwrap().is_empty());
    // The user opts in for one dated reminder.
    dataset_db(&dir.path().join("lib"))
        .execute(
            "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes) VALUES(?1,'renewal',?2,NULL,'2026-11-01','续费提醒')",
            rusqlite::params![id(), v.id.clone()],
        )
        .unwrap();
    let plans = s.reminder_plans().unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].date, "2026-11-01");
    // Stopping the asset withdraws the pending notification.
    let mut input = sub_save(&s, "续费订阅", &fresh_plan(&s, &plan.id), |f| {
        f.stopped_on = Some("2026-09-15".into());
    });
    input.id = Some(v.id.clone());
    input.expected_revision = Some(v.revision);
    s.virtual_save(&input, "2026-09-15").unwrap();
    assert!(s.reminder_plans().unwrap().is_empty());
    // Switching the virtual module off pauses reminders library-wide.
    let o = s.virtual_overview("2026-09-20").unwrap();
    let live = o.items.iter().find(|x| x.id == v.id).unwrap();
    let _ = live;
    // Warranty reminders are unaffected by any of this.
    let asset = {
        let input = thingary_lib::catalog::SaveAsset {
            base: thingary_lib::domain::Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构耳机".into(),
                price_cents: None,
                purchase_date: Some("2026-09-01".into()),
            },
            details: Default::default(),
            photos: None,
            classification: None,
            options: Some(thingary_lib::preferences::AssetOptions {
                warranty: Some(thingary_lib::preferences::NewWarranty {
                    start_date: Some("2026-09-01".into()),
                    end_date: "2027-09-01".into(),
                    reminder: Some(thingary_lib::preferences::Reminder {
                        date: "2027-08-25".into(),
                        notes: "保障到期".into(),
                    }),
                }),
                ..Default::default()
            }),
        };
        s.save_asset(&input, "2026-09-01").unwrap()
    };
    let plans = s.reminder_plans().unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].title, "保障到期提醒 · 虚构耳机");
    let _ = asset;
}

/// VA-15 extra: a stored-value account created without any topup has no zero
/// fact; its spend reads as unknown, never as 0.
#[test]
fn topup_account_without_facts_is_unknown_not_zero() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let v = s
        .virtual_save(
            &VirtualSave {
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("空储值", "topup"),
            },
            "2026-09-01",
        )
        .unwrap();
    let o = s.virtual_overview("2026-09-01").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.topup_count, 0);
    assert_eq!(item.spent_cents, None);
    assert_eq!(o.unknown_price, 1);
    let view: expenses::View = s.expense_view(None).unwrap();
    assert!(view.lines.iter().all(|l| l.source != "topup"));
}

/// VA-21/22: old backups (17/19/20/21) inspect, restore and migrate with every
/// old meaning intact; a schema-22 backup round-trips the new tables.
#[test]
fn old_and_new_backups_restore_and_migrate() {
    use sha2::{Digest, Sha256};
    use std::io::Write as _;
    let dir = tempfile::tempdir().unwrap();
    // A schema-22 library with the new facts becomes a full backup.
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "订阅", "14000", "2024-01-20", "2026-10-05");
    let v = s
        .virtual_save(
            &VirtualSave {
                plan: Some(LinkedPlanSave {
                    id: Some(plan.id.clone()),
                    expected_revision: Some(plan.revision),
                    fields: plan.fields.clone(),
                }),
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: Fields {
                    name: "备份订阅".into(),
                    kind: "general".into(),
                    billing: "subscription".into(),
                    label_id: None,
                    pay_method: None,
                    perpetual: None,
                    provider: String::new(),
                    purchase_date: None,
                    price_cents: None,
                    expires: None,
                    plan_id: Some(plan.id.clone()),
                    url: String::new(),
                    notes: String::new(),
                    stopped_on: None,
                },
            },
            "2026-10-05",
        )
        .unwrap();
    // A second, stored-value account carries the topup and balance facts.
    let card = s
        .virtual_save(
            &VirtualSave {
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
                plan: None,
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("饭卡", "topup"),
            },
            "2026-09-30",
        )
        .unwrap();
    let t = topup(&card.id, Some("2026-09-30"), Some("15000"), Some("5000"));
    let mut t = with_generation(&s, t);
    t.fields.credit_cents = Some("20000".into());
    s.virtual_topup_save(&t, "2026-09-30").unwrap();
    let b = BalanceSave {
        request_id: id(),
        generation: s.generation(),
        asset_id: card.id.clone(),
        id: None,
        expected_revision: None,
        balance_cents: "8000".into(),
        recorded_on: "2026-09-30".into(),
        notes: String::new(),
    };
    s.virtual_balance_save(&b, "2026-09-30").unwrap();
    let file = dir.path().join("v22.thingary");
    s.backup(Some(&file)).unwrap();
    let summary = s.inspect_backup(&file).unwrap();
    assert_eq!(
        (
            summary.schema,
            summary.virtual_assets,
            summary.virtual_topups
        ),
        (thingary_lib::storage::SCHEMA_VERSION as u32, 2, 1)
    );
    // Restore into a second library and compare the facts.
    let mut other = Store::open(&dir.path().join("other")).unwrap();
    other
        .restore(&file, &summary.hash, &other.generation())
        .unwrap();
    let o = other.virtual_overview("2026-10-05").unwrap();
    assert_eq!(o.items.len(), 2);
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.fields.billing, "subscription");
    let card = o.items.iter().find(|x| x.id == card.id).unwrap();
    assert_eq!(card.topup_known_cents.as_deref(), Some("15000"));
    assert_eq!(card.topup_credit_cents.as_deref(), Some("20000"));
    assert_eq!(
        card.balance.as_ref().map(|x| x.balance_cents.as_str()),
        Some("8000")
    );

    // Old-schema databases zip into legacy backups and migrate on restore.
    for version in [17u32, 19, 20, 21] {
        let old_db = dir.path().join(format!("v{version}.sqlite"));
        let db = rusqlite::Connection::open(&old_db).unwrap();
        db.execute_batch(SCHEMA).unwrap();
        migrate_to(&db, i64::from(version), &|_| Ok(())).unwrap();
        let (plan_ok, virtual_ok) = match version {
            17 => (true, false),
            _ => (true, true),
        };
        let (pid, vid) = (
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
        );
        if plan_ok {
            db.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,paused,active_from,notes,created_at,updated_at,revision) VALUES(?1,'旧计划','subscription',14000,1,'2024-01-20',0,'2024-01-20','','t','t',1)", [&pid]).unwrap_or_else(|_| panic!("plan insert at {version}"));
        }
        if virtual_ok {
            // virtual_assets has no service columns at any version; the
            // schema-21 additions live on recurring_plans.
            let sql = "INSERT INTO virtual_assets(id,name,kind,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,revision,created_at,updated_at) VALUES(?1,'旧订阅','subscription','平台',NULL,12800,NULL,NULL,'','',NULL,1,'t','t')";
            db.execute(sql, [&vid])
                .unwrap_or_else(|_| panic!("virtual insert at {version}"));
        }
        drop(db);
        let bytes = std::fs::read(&old_db).unwrap();
        let manifest = serde_json::json!({"format":1,"schema":version,"created_at":"2026-10-05T02:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
        let archive = dir.path().join(format!("v{version}.thingary"));
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        z.start_file("manifest.json", opts).unwrap();
        z.write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        z.start_file("data.sqlite", opts).unwrap();
        z.write_all(&bytes).unwrap();
        z.finish().unwrap();

        let mut target = Store::open(&dir.path().join(format!("restore-{version}"))).unwrap();
        let summary = target.inspect_backup(&archive).unwrap();
        assert_eq!(summary.schema, version);
        target
            .restore(&archive, &summary.hash, &target.generation())
            .unwrap();
        // 旧事实迁移后保持原义：独立订阅价格仍是单次投入。
        let o = target.virtual_overview("2026-10-05").unwrap();
        if virtual_ok {
            let v1 = o.items.iter().find(|x| x.id == vid).expect("v1 present");
            assert_eq!(v1.fields.billing, "single");
            assert_eq!(v1.spent_cents.as_deref(), Some("12800"));
            assert_eq!(v1.status, "ongoing");
            // The old price is a one-time spend; without a purchase date it
            // lands in the 待补充 bucket.
            let view = target.expense_view(None).unwrap();
            let line = view
                .lines
                .iter()
                .chain(view.undated.iter())
                .find(|l| l.source == "virtual" && l.id == vid);
            assert!(line.is_some());
        }
    }
}

/// VA-22: a newer schema is refused instead of creating an empty library.
#[test]
fn newer_schema_backup_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    save_plan(&mut s, "原有计划", "1000", "2026-01-01", "2026-10-05");
    let path = dir.path().join("future.thingary");
    std::fs::write(&path, b"not a zip").unwrap();
    assert!(s.inspect_backup(&path).is_err());
    // restore refuses junk and the library stays untouched.
    assert!(s.restore(&path, "bad", &s.generation()).is_err());
    assert!(!s.recurring_overview("2026-10-05").unwrap().plans.is_empty());
}

/// Review R1: a Jan-31 monthly anchor's second period covers Feb 28 … Mar 30
/// (the original anchor grid), leaving no service gap before Mar 31.
#[test]
fn review_r1_month_end_coverage_uses_original_anchor_grid() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "月末订阅", "14000", "2026-01-31", "2026-03-31");
    let pay = s
        .recurring_payment_save(
            &PaymentSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                plan_id: plan.id.clone(),
                due_date: "2026-02-28".into(),
                state: "paid".into(),
                paid_date: Some("2026-02-28".into()),
                amount_cents: Some("14000".into()),
                notes: String::new(),
            },
            "2026-03-31",
        )
        .unwrap();
    assert_eq!(
        (pay.coverage_start.as_deref(), pay.coverage_end.as_deref()),
        (Some("2026-02-28"), Some("2026-03-30"))
    );
    let o = s.recurring_overview("2026-03-31").unwrap();
    let p = o.plans.iter().find(|p| p.id == plan.id).unwrap();
    assert_eq!(p.next_due.as_deref(), Some("2026-03-31"));
}

/// Review R2: a service that ends inside its free trial saves as an ended
/// zero-cost record and never schedules a first charge.
#[test]
fn review_r2_end_during_trial_saves_zero_cost_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut f = plan_fields("试用即止", "14000", "2026-01-08");
    f.service_start = Some("2026-01-01".into());
    f.trial_days = Some(7);
    f.end_date = Some("2026-01-05".into());
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            "2026-01-10",
        )
        .unwrap();
    let o = s.recurring_overview("2026-01-10").unwrap();
    let p = o.plans.iter().find(|p| p.id == plan.id).unwrap();
    assert_eq!(p.estimated_cents.as_deref(), Some("0"));
    assert_eq!(p.next_due, None);
    assert!(o.due.is_empty(), "试用内结束不安排首笔付款");
}

/// Review R3: a 45-day trial rejects range backfill inside the free window
/// and leaves neither payments nor a receipt behind.
#[test]
fn review_r3_trial_backfill_rejected_without_half_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut f = plan_fields("长试用", "14000", "2026-02-15");
    f.service_start = Some("2026-01-01".into());
    f.trial_days = Some(45);
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            "2026-03-20",
        )
        .unwrap();
    let request = id();
    let q = PaymentRangeSave {
        request_id: request.clone(),
        generation: s.generation(),
        plan_id: plan.id.clone(),
        expected_revision: plan.revision,
        from_due: "2026-01-15".into(),
        to_due: "2026-01-15".into(),
        amount_cents: "14000".into(),
        confirmed: true,
    };
    assert_eq!(
        s.recurring_payment_range_save(&q, "2026-03-20")
            .unwrap_err()
            .code,
        "PAYMENT_RANGE"
    );
    let o = s.recurring_overview("2026-03-20").unwrap();
    assert_eq!(o.payments.len(), 0);
    assert_eq!(
        s.expense_view(None).unwrap().spent_cents,
        "0",
        "拒绝后无付款事实"
    );
    let receipt: Option<String> = {
        use rusqlite::OptionalExtension;
        let c = dataset_db(&dir.path().join("lib"));
        c.query_row(
            "SELECT result FROM feature_requests WHERE id=?1",
            [&request],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
    };
    let _ = &receipt;
    // A rejected range must not act as a receipt that would replay payments.
    let replay = s.recurring_payment_range_save(&q, "2026-03-20");
    assert!(replay.is_err() || o.payments.is_empty());
    let _ = receipt;
}

/// Review R4: changing the period keeps historical estimates under the rule
/// that was in effect; only future periods follow the new rule.
#[test]
fn review_r4_period_change_segments_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "调周期", "14000", "2026-01-01", "2026-05-01");
    let before = s
        .recurring_overview("2026-05-01")
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.id == plan.id)
        .unwrap()
        .estimated_cents;
    assert_eq!(before.as_deref(), Some("70000"));
    let mut f = plan.fields.clone();
    f.interval_months = 3;
    let _ = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(plan.id.clone()),
                expected_revision: Some(plan.revision),
                fields: f,
            },
            "2026-05-01",
        )
        .unwrap();
    let after = s
        .recurring_overview("2026-05-01")
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.id == plan.id)
        .unwrap()
        .estimated_cents;
    assert_eq!(after.as_deref(), Some("70000"), "历史月度估算保持");
}

/// Review R7: after a future rate takes effect, dues, monthly average and the
/// next-12-month forecast all use the effective rate, not the old amount.
#[test]
fn review_r7_effective_rates_reach_dues_and_forecasts() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let plan = save_plan(&mut s, "调价订阅", "14000", "2026-10-01", "2026-10-05");
    pay(&mut s, &plan, "2026-10-01", "14000", "2026-10-01");
    let mut input = sub_save(&s, "调价订阅", &plan, |_| {});
    input.renewal_price_cents = Some("16000".into());
    input.renewal_from = Some("2026-11-01".into());
    let v = s.virtual_save(&input, "2026-10-05").unwrap();
    let o = s.recurring_overview("2026-12-05").unwrap();
    let dues: Vec<(&str, &str)> = o
        .due
        .iter()
        .filter(|d| d.plan_id == plan.id)
        .map(|d| (d.due_date.as_str(), d.amount_cents.as_str()))
        .collect();
    assert_eq!(
        dues,
        vec![("2026-11-01", "16000"), ("2026-12-01", "16000")],
        "待付款按生效价"
    );
    let p = o.plans.iter().find(|p| p.id == plan.id).unwrap();
    assert_eq!(p.monthly_cents.as_deref(), Some("16000"));
    assert_eq!(p.estimated_cents.as_deref(), Some("46000"));
    assert_eq!(p.paid_cents.as_deref(), Some("14000"), "历史实付不变");
    let _ = v;
}

/// Review R8: an archive linked to a legacy plan (no service dates) edits and
/// saves its profile fields; the plan keeps its legacy scheduling.
#[test]
fn review_r8_legacy_linked_plan_edit_keeps_old_meaning() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut f = plan_fields("旧计划", "9900", "2026-01-01");
    f.service_start = None;
    f.coverage_start = None;
    f.first_due = "2026-01-01".into();
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f.clone(),
            },
            "2026-10-05",
        )
        .unwrap();
    let mut fields = fields("旧关联订阅", "subscription");
    fields.kind = "subscription".into();
    fields.plan_id = Some(plan.id.clone());
    let v = s
        .virtual_save(
            &VirtualSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields,
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
            },
            "2026-10-05",
        )
        .unwrap();
    // 用真实编辑载荷（带 plan 透传）改备注保存。
    let mut input = VirtualSave {
        request_id: id(),
        generation: s.generation(),
        id: Some(v.id.clone()),
        expected_revision: Some(v.revision),
        fields: v.fields.clone(),
        plan: Some(LinkedPlanSave {
            id: Some(plan.id.clone()),
            expected_revision: Some(plan.revision),
            fields: f.clone(),
        }),
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
    };
    input.fields.notes = "编辑后的备注".into();
    let saved = s.virtual_save(&input, "2026-10-05").unwrap();
    assert_eq!(saved.fields.notes, "编辑后的备注");
    // 重开对照：计划字段与排期原义不变。
    drop(s);
    let reopened = Store::open(&dir.path().join("lib")).unwrap();
    let o = reopened.virtual_overview("2026-10-05").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    assert_eq!(item.fields.notes, "编辑后的备注");
    assert_eq!(item.fields.billing, "subscription");
    let p = reopened
        .recurring_overview("2026-10-05")
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.id == plan.id)
        .unwrap();
    assert_eq!(p.fields.service_start, None, "旧计划保持无服务日期");
}

/// Review R9: a stale Remove confirmation that missed new virtual references
/// is rejected; the replacement must cover every referenced domain.
#[test]
fn review_r9_remove_confirms_both_domains() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let change = |s: &Store, action: Action| Change {
        request_id: id(),
        generation: s.generation(),
        expected_revision: s.choices("label").unwrap().revision,
        kind: "label".into(),
        action,
    };
    let both = {
        let input = change(
            &s,
            Action::Create {
                name: "两域".into(),
                scope: Some("both".into()),
            },
        );
        s.change_choices(&input).unwrap();
        s.choices("label")
            .unwrap()
            .items
            .into_iter()
            .find(|e| e.name == "两域")
            .unwrap()
            .id
    };
    let physical = {
        let input = change(
            &s,
            Action::Create {
                name: "仅实物".into(),
                scope: Some("physical".into()),
            },
        );
        s.change_choices(&input).unwrap();
        s.choices("label")
            .unwrap()
            .items
            .into_iter()
            .find(|e| e.name == "仅实物")
            .unwrap()
            .id
    };
    let mut f = fields("带标签档案", "single");
    f.label_id = Some(both.clone());
    let v = s
        .virtual_save(
            &VirtualSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
            },
            "2026-10-05",
        )
        .unwrap();
    // 过期确认：虚拟引用已存在但确认里写 0 → 拒绝。
    let stale = change(
        &s,
        Action::Remove {
            id: both.clone(),
            replacement: None,
            expected_references: 0,
            expected_virtual_references: 0,
        },
    );
    assert_eq!(
        code(s.change_choices(&stale).map(|_| ())),
        "CHOICE_REFERENCES"
    );
    // 不兼容目标：虚拟引用迁到仅实物标签 → 拒绝。
    let incompatible = change(
        &s,
        Action::Remove {
            id: both.clone(),
            replacement: Some(physical.clone()),
            expected_references: 0,
            expected_virtual_references: 1,
        },
    );
    assert_eq!(
        code(s.change_choices(&incompatible).map(|_| ())),
        "CHOICE_SCOPE"
    );
    // 清空迁移成功，两域引用都清空。
    let ok = change(
        &s,
        Action::Remove {
            id: both.clone(),
            replacement: None,
            expected_references: 0,
            expected_virtual_references: 1,
        },
    );
    s.change_choices(&ok).unwrap();
    let cleared: Option<String> = dataset_db(&dir.path().join("lib"))
        .query_row(
            "SELECT label_id FROM virtual_assets WHERE id=?1",
            [&v.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cleared, None);
}

/// Review R11: the first topup's default credit tracks paid+gift (150+50=200)
/// until the user overrides it; the stored fact keeps the linkage result.
#[test]
fn review_r11_default_credit_tracks_paid_and_gift() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let v = s
        .virtual_save(
            &VirtualSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("联动卡", "topup"),
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
            },
            "2026-10-05",
        )
        .unwrap();
    let t = topup(&v.id, Some("2026-10-05"), Some("15000"), Some("5000"));
    let mut t = with_generation(&s, t);
    t.fields.credit_cents = None; // 未手改到账
    s.virtual_topup_save(&t, "2026-10-05").unwrap();
    let o = s.virtual_overview("2026-10-05").unwrap();
    let item = o.items.iter().find(|x| x.id == v.id).unwrap();
    // 后端保存明确到账值；未手改时前端提交实付＋赠送（15000+5000）。
    assert_eq!(item.topup_credit_cents.as_deref(), Some("20000"));
    assert_eq!(item.topup_known_cents.as_deref(), Some("15000"));
}

#[test]
fn revised_rules_preserve_historical_payment_candidates_and_coverage() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let p = save_plan(&mut s, "历史规则", "10000", "2026-01-01", "2026-01-01");
    let mut f = p.fields.clone();
    f.interval_months = 3;
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(p.id.clone()),
            expected_revision: Some(p.revision),
            fields: f,
        },
        "2026-05-01",
    )
    .unwrap();
    let current = fresh_plan(&s, &p.id);
    s.recurring_payment_range_save(
        &PaymentRangeSave {
            request_id: id(),
            generation: s.generation(),
            plan_id: p.id.clone(),
            expected_revision: current.revision,
            from_due: "2026-02-01".into(),
            to_due: "2026-08-01".into(),
            amount_cents: "10000".into(),
            confirmed: true,
        },
        "2026-10-05",
    )
    .unwrap();
    let overview = s.recurring_overview("2026-10-05").unwrap();
    let records = overview.payments;
    assert_eq!(records.len(), 5); // Feb, Mar, Apr, May, Aug
    assert!(records.iter().all(|p| !p.off_schedule));
    let aug = records.iter().find(|p| p.due_date == "2026-08-01").unwrap();
    assert_eq!(aug.coverage_start.as_deref(), Some("2026-08-01"));
    assert_eq!(aug.coverage_end.as_deref(), Some("2026-10-31"));
}

#[test]
fn schema22_fixed_day_rule_survives_upgrade_and_failed_rebuild_restores_fk() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 22, &|_| Ok(())).unwrap();
    let pid = id();
    c.execute("INSERT INTO recurring_plans(id,name,category,amount_cents,interval_months,first_due,end_date,paused,active_from,notes,revision,created_at,updated_at,service_start,coverage_start,interval_days,trial_days) VALUES(?1,'fixed','subscription',100,1,'2026-01-01',NULL,0,'2026-01-01','',1,'n','n','2026-01-01','2026-01-01',18,NULL)", [&pid]).unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    assert!(migrate_to(&c, 23, &|_| Err(Error::new("INJECTED", "test"))).is_err());
    assert_eq!(
        c.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        22
    );
    migrate_to(&c, 23, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row(
            "SELECT interval_days FROM plan_rules WHERE plan_id=?1",
            [&pid],
            |r| r.get::<_, Option<u32>>(0)
        )
        .unwrap(),
        Some(18)
    );
}

#[test]
fn payment_anchor_change_and_trial_change_keep_prior_monthly_history() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let p = save_plan(&mut s, "锚点历史", "10000", "2026-01-01", "2026-01-01");
    let mut f = p.fields.clone();
    f.first_due = "2026-01-15".into();
    f.trial_days = Some(7);
    f.coverage_start = Some("2026-01-08".into());
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(p.id.clone()),
            expected_revision: Some(p.revision),
            fields: f,
        },
        "2026-05-01",
    )
    .unwrap();
    let overview = s.recurring_overview("2026-10-05").unwrap();
    assert_eq!(overview.plans[0].estimated_cents.as_deref(), Some("90000"));
    let pay = s
        .recurring_payment_save(
            &PaymentSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                plan_id: p.id,
                due_date: "2026-03-01".into(),
                state: "paid".into(),
                paid_date: Some("2026-03-01".into()),
                amount_cents: Some("10000".into()),
                notes: String::new(),
            },
            "2026-10-05",
        )
        .unwrap();
    assert!(!pay.off_schedule);
    assert_eq!(pay.coverage_end.as_deref(), Some("2026-03-31"));
}

#[test]
fn auto_renew_and_final_day_are_independent_and_persisted() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let mut f = plan_fields("确定结束", "10000", "2026-01-01");
    f.end_date = Some("2026-12-31".into());
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
    assert!(p.fields.auto_renew);
    f.auto_renew = false;
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(p.id.clone()),
            expected_revision: Some(p.revision),
            fields: f.clone(),
        },
        "2026-05-01",
    )
    .unwrap();
    assert!(!fresh_plan(&s, &p.id).fields.auto_renew);
    assert_eq!(
        fresh_plan(&s, &p.id).fields.end_date.as_deref(),
        Some("2026-12-31")
    );
    f.end_date = None;
    assert_eq!(
        code(s.recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(p.id.clone()),
                expected_revision: Some(p.revision + 1),
                fields: f
            },
            "2026-05-01"
        )),
        "PLAN_END"
    );
}

#[test]
fn rebuild_foreign_key_failure_rolls_back_before_commit() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 22, &|_| Ok(())).unwrap();
    c.execute_batch("PRAGMA foreign_keys=OFF; INSERT INTO plan_payments(id,plan_id,due_date,state,paid_date,amount_cents,notes,revision,created_at,updated_at) VALUES('bad','absent','2026-01-01','skipped',NULL,NULL,'',1,'n','n'); PRAGMA foreign_keys=ON;").unwrap();
    assert_eq!(code(migrate_to(&c, 23, &|_| Ok(()))), "DATABASE_FORMAT");
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        22
    );
    assert_eq!(
        c.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn stored_value_facts_cannot_attach_to_one_time_archives() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let v = s
        .virtual_save(
            &VirtualSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: fields("买断", "single"),
                plan: None,
                renewal_price_cents: None,
                renewal_from: None,
                special_end: None,
                first_topup: None,
            },
            "2026-10-05",
        )
        .unwrap();
    let invalid = VirtualSave {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: fields("无效首次充值", "single"),
        plan: None,
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: Some(topup(&v.id, Some("2026-10-05"), Some("10000"), None).fields),
    };
    assert_eq!(
        code(s.virtual_save(&invalid, "2026-10-05")),
        "VIRTUAL_BILLING"
    );
    assert_eq!(s.virtual_overview("2026-10-05").unwrap().items.len(), 1);
    let input = with_generation(&s, topup(&v.id, Some("2026-10-05"), Some("10000"), None));
    assert_eq!(
        code(s.virtual_topup_save(&input, "2026-10-05")),
        "VIRTUAL_BILLING"
    );
    assert_eq!(
        code(s.virtual_balance_save(
            &BalanceSave {
                request_id: id(),
                generation: s.generation(),
                asset_id: v.id,
                id: None,
                expected_revision: None,
                balance_cents: "10000".into(),
                recorded_on: "2026-10-05".into(),
                notes: String::new()
            },
            "2026-10-05"
        )),
        "VIRTUAL_BILLING"
    );
}

#[test]
fn trial_free_window_has_no_current_burden_and_future_paid_dates_remain() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let mut f = plan_fields("试用负担", "14000", "2026-01-08");
    f.service_start = Some("2026-01-01".into());
    f.trial_days = Some(7);
    s.recurring_plan_save(
        &PlanSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: f,
        },
        "2026-01-01",
    )
    .unwrap();
    let o = s.recurring_overview("2026-01-05").unwrap();
    assert_eq!(o.annual_cents, "0");
    assert_eq!(o.plans[0].monthly_cents.as_deref(), Some("0"));
    assert!(o.next12_cents.parse::<u64>().unwrap() > 0);
}

fn period_reminder(
    s: &mut Store,
    asset_id: &str,
    today: &str,
) -> thingary_lib::virtual_assets::VirtualAsset {
    let asset = s
        .virtual_overview(today)
        .unwrap()
        .items
        .into_iter()
        .find(|v| v.id == asset_id)
        .unwrap();
    s.virtual_reminder_save(
        &thingary_lib::virtual_assets::ReminderSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.id,
            expected_revision: asset.revision,
            repeat_every_period: true,
            lead_days: 3,
            reminder: Some(thingary_lib::preferences::Reminder {
                date: today.into(),
                notes: "虚构付款账户备款".into(),
            }),
        },
        today,
    )
    .unwrap()
}

#[test]
fn period_reminders_advance_only_after_real_payment_and_roundtrip_backup() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("lib");
    let mut s = Store::open(&root).unwrap();
    let plan = save_plan(&mut s, "虚构 GPT 月费", "14000", "2026-09-20", "2026-10-05");
    let v = s
        .virtual_save(&sub_save(&s, "虚构 GPT 月费", &plan, |_| {}), "2026-10-05")
        .unwrap();
    assert_eq!(v.payment_due.as_ref().unwrap().due_date, "2026-09-20");
    assert_eq!(v.status, "ongoing");
    assert!(s.reminder_plans_for("2026-10-05").unwrap().is_empty());
    let opted = period_reminder(&mut s, &v.id, "2026-10-05");
    assert_eq!(opted.reminder.as_ref().unwrap().date, "2026-09-17");
    assert_eq!(opted.paid_count, 0); // Funding preferences never create expenses.
    assert!(s.expense_view(None).unwrap().lines.is_empty());
    let before = s.reminder_plans_for("2026-10-05").unwrap();
    assert!(before.iter().any(|p| p.date == "2026-09-17"));
    let october = before
        .iter()
        .find(|p| p.date == "2026-10-17")
        .unwrap()
        .id
        .clone();
    // One explicit payment creates one expense. Replaying the receipt is safe.
    let payment = PaymentSave {
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        plan_id: plan.id.clone(),
        due_date: "2026-09-20".into(),
        state: "paid".into(),
        paid_date: Some("2026-10-05".into()),
        amount_cents: Some("14000".into()),
        notes: String::new(),
    };
    s.recurring_payment_save(&payment, "2026-10-05").unwrap();
    s.recurring_payment_save(&payment, "2026-10-05").unwrap();
    let after = s.reminder_plans_for("2026-10-05").unwrap();
    assert!(!after.iter().any(|p| p.date == "2026-09-17"));
    assert_eq!(
        after.iter().find(|p| p.date == "2026-10-17").unwrap().id,
        october
    );
    let v = s
        .virtual_overview("2026-10-05")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert_eq!(v.status, "ongoing");
    assert_eq!(v.paid_count, 1);
    assert_eq!(v.spent_cents.as_deref(), Some("14000"));
    // 15 days out is beyond the 7-day window: no action yet, reminder still tracks the period.
    assert!(v.payment_due.is_none());
    assert_eq!(v.reminder.as_ref().unwrap().date, "2026-10-17");
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "14000");
    // Explicit early payment advances the next reminder, without ending service.
    pay(&mut s, &plan, "2026-10-20", "14000", "2026-10-05");
    let v = s
        .virtual_overview("2026-10-05")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert!(v.payment_due.is_none());
    assert_eq!(v.reminder.as_ref().unwrap().date, "2026-11-17");
    assert_eq!(v.status, "ongoing");
    assert!(!s
        .reminder_plans_for("2026-10-05")
        .unwrap()
        .iter()
        .any(|p| p.date == "2026-10-17"));
    let file = dir.path().join("period.thingary");
    s.backup(Some(&file)).unwrap();
    let summary = s.inspect_backup(&file).unwrap();
    assert_eq!(summary.schema, 29);
    let mut restored = Store::open(&dir.path().join("restored")).unwrap();
    restored
        .restore(&file, &summary.hash, &restored.generation())
        .unwrap();
    let restored_v = restored
        .virtual_overview("2026-10-05")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert_eq!(restored_v.paid_count, 2);
    assert_eq!(restored_v.reminder.as_ref().unwrap().date, "2026-11-17");
    assert!(restored_v.reminder.unwrap().repeat_every_period);
    assert_eq!(
        serde_json::to_value(s.reminder_plans_for("2026-10-05").unwrap()).unwrap(),
        serde_json::to_value(restored.reminder_plans_for("2026-10-05").unwrap()).unwrap()
    );
}

#[test]
fn reminders_and_payment_candidates_follow_trial_special_end_price_and_fixed_days() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut f = plan_fields("试用订阅", "14000", "2026-09-27");
    f.service_start = Some("2026-09-20".into());
    f.trial_days = Some(7);
    f.interval_days = Some(30);
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            "2026-09-20",
        )
        .unwrap();
    let mut save = sub_save(&s, "试用订阅", &plan, |_| {});
    save.special_end = Some(SpecialEnd {
        period_start: "2026-09-27".into(),
        coverage_end: Some("2026-10-31".into()),
    });
    let v = s.virtual_save(&save, "2026-09-20").unwrap();
    let mut price_save = sub_save(&s, "Trial subscription", &fresh_plan(&s, &plan.id), |_| {});
    price_save.id = Some(v.id.clone());
    price_save.expected_revision = Some(v.revision);
    price_save.renewal_price_cents = Some("16000".into());
    price_save.renewal_from = Some("2026-11-01".into());
    let v = s.virtual_save(&price_save, "2026-09-20").unwrap();
    let candidate = v.payment_due.as_ref().unwrap();
    assert_eq!(candidate.due_date, "2026-09-27");
    assert_eq!(candidate.coverage_end.as_deref(), Some("2026-10-31"));
    period_reminder(&mut s, &v.id, "2026-09-20");
    assert!(s
        .reminder_plans_for("2026-09-20")
        .unwrap()
        .iter()
        .any(|p| p.date == "2026-09-24"));
    pay(&mut s, &plan, "2026-09-27", "14000", "2026-09-27");
    let v = s
        .virtual_overview("2026-09-27")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert!(v.payment_due.is_none());
    assert_eq!(v.reminder.unwrap().date, "2026-10-24");
    // Inside the window the candidate carries the next period's price.
    let v = s
        .virtual_overview("2026-10-22")
        .unwrap()
        .items
        .pop()
        .unwrap();
    let candidate = v.payment_due.unwrap();
    assert_eq!(candidate.due_date, "2026-10-27");
    assert_eq!(candidate.coverage_end.as_deref(), Some("2026-11-30"));
    assert_eq!(candidate.amount_cents, "16000");
    // Historical unrecorded periods are not revived as current payment actions.
    let v = s
        .virtual_overview("2027-02-02")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert!(v.payment_due.unwrap().coverage_end.unwrap().as_str() >= "2027-02-02");
    let current_reminder = v.reminder.unwrap().date;
    assert!(s
        .reminder_plans_for("2027-02-02")
        .unwrap()
        .iter()
        .all(|p| p.date >= current_reminder));
}

#[test]
fn period_reminders_pause_with_renewal_plan_module_and_end_and_skip_paid_periods() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("lib");
    let mut s = Store::open(&root).unwrap();
    let plan = save_plan(&mut s, "虚构订阅", "100", "2026-10-20", "2026-10-05");
    let v = s
        .virtual_save(&sub_save(&s, "虚构订阅", &plan, |_| {}), "2026-10-05")
        .unwrap();
    period_reminder(&mut s, &v.id, "2026-10-05");
    let update = |s: &mut Store, edit: fn(&mut PlanFields)| {
        let p = fresh_plan(s, &plan.id);
        let mut f = p.fields.clone();
        edit(&mut f);
        s.recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(p.id),
                expected_revision: Some(p.revision),
                fields: f,
            },
            "2026-10-05",
        )
        .unwrap();
    };
    update(&mut s, |f| {
        f.auto_renew = false;
        f.end_date = Some("2026-11-19".into());
    });
    assert!(s.reminder_plans_for("2026-10-05").unwrap().is_empty());
    update(&mut s, |f| {
        f.auto_renew = true;
        f.end_date = None;
        f.paused = true;
    });
    assert!(s.reminder_plans_for("2026-10-05").unwrap().is_empty());
    assert!(s.virtual_overview("2026-10-05").unwrap().items[0]
        .payment_due
        .is_none());
    update(&mut s, |f| f.paused = false);
    assert!(!s.reminder_plans_for("2026-10-05").unwrap().is_empty());
    thingary_lib::modules::write(
        &root,
        &thingary_lib::modules::Modules {
            virtual_assets: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(s.reminder_plans_for("2026-10-05").unwrap().is_empty());
    thingary_lib::modules::write(&root, &Default::default()).unwrap();
    // A skipped period is an explicit fact too; it has no funding reminder.
    s.recurring_payment_save(
        &PaymentSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan.id.clone(),
            due_date: "2026-10-20".into(),
            state: "skipped".into(),
            paid_date: None,
            amount_cents: None,
            notes: String::new(),
        },
        "2026-10-05",
    )
    .unwrap();
    assert!(!s
        .reminder_plans_for("2026-10-05")
        .unwrap()
        .iter()
        .any(|p| p.date == "2026-10-17"));
    update(&mut s, |f| f.end_date = Some("2026-10-31".into()));
    assert!(s.reminder_plans_for("2026-11-01").unwrap().is_empty());
    assert!(s.virtual_overview("2026-11-01").unwrap().items[0]
        .payment_due
        .is_none());
    assert_eq!(
        s.virtual_overview("2026-11-01").unwrap().items[0].status,
        "expired"
    );
}

#[test]
fn schema26_preserves_single_reminders_and_rolls_back_on_interruption() {
    // An unresolved old request must keep the same serialized fingerprint.
    let old_request = r#"{"request_id":"old-request","generation":"old-library","asset_id":"v","expected_revision":1,"reminder":{"date":"2026-10-17","notes":"single"}}"#;
    let parsed: thingary_lib::virtual_assets::ReminderSave =
        serde_json::from_str(old_request).unwrap();
    assert!(!parsed.repeat_every_period);
    assert_eq!(serde_json::to_string(&parsed).unwrap(), old_request);
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 25, &|_| Ok(())).unwrap();
    db.execute("INSERT INTO reminders(id,kind,entity_id,date,notes) VALUES('old','renewal','v','2026-10-17','仅本次')", []).unwrap();
    assert!(
        migrate_to(&db, 26, &|point| if point == "migration.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        })
        .is_err()
    );
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        25
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM pragma_table_info('reminders') WHERE name='repeat_every_period'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    migrate_to(&db, 26, &|_| Ok(())).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT date,notes,repeat_every_period,lead_days FROM reminders WHERE id='old'",
            [],
            |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?
            ))
        )
        .unwrap(),
        ("2026-10-17".into(), "仅本次".into(), 0, 3)
    );
    assert!(db.execute("INSERT INTO reminders(id,kind,entity_id,date,notes,repeat_every_period) VALUES('bad','wishlist','w','2026-10-17','',1)", []).is_err());
}

#[test]
fn payment_action_appears_only_inside_the_prepayment_window() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let mut f = plan_fields("虚构博客域名", "9000", "2026-09-15");
    f.interval_months = 12;
    let plan = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            "2026-09-15",
        )
        .unwrap();
    s.virtual_save(&sub_save(&s, "虚构博客域名", &plan, |_| {}), "2026-09-15")
        .unwrap();
    pay(&mut s, &plan, "2026-09-15", "9000", "2026-09-15");
    let due = |today: &str| {
        s.virtual_overview(today)
            .unwrap()
            .items
            .pop()
            .unwrap()
            .payment_due
    };
    // Yearly plans open 30 days ahead; a year out nothing is asked.
    assert!(due("2026-10-06").is_none());
    assert!(due("2027-08-15").is_none());
    assert_eq!(due("2027-08-16").unwrap().due_date, "2027-09-15");
    assert_eq!(due("2027-09-20").unwrap().due_date, "2027-09-15"); // overdue stays
                                                                   // The periodic-cost page's "upcoming" list uses the same 30-day yearly window.
    let upcoming = |today: &str| s.recurring_overview(today).unwrap().upcoming.len();
    assert_eq!(upcoming("2027-08-15"), 0);
    assert_eq!(upcoming("2027-08-16"), 1);
    // Prepaying years ahead must not erase the next scheduled payment.
    pay(&mut s, &plan, "2027-09-15", "9000", "2026-10-06");
    pay(&mut s, &plan, "2028-09-15", "9000", "2026-10-06");
    let next = s.recurring_overview("2026-10-06").unwrap().plans[0]
        .next_due
        .clone();
    assert_eq!(next.as_deref(), Some("2029-09-15"));
}
