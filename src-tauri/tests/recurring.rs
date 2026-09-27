use possio_lib::{
    domain::Error,
    recurring::{PaymentSave, Plan, PlanFields, PlanSave},
    storage::Store,
};
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn fields(name: &str, amount: &str, interval: u32, first: &str) -> PlanFields {
    PlanFields {
        name: name.into(),
        category: "subscription".into(),
        amount_cents: amount.into(),
        interval_months: interval,
        first_due: first.into(),
        end_date: None,
        paused: false,
        notes: String::new(),
    }
}
fn create(s: &mut Store, f: PlanFields, today: &str) -> Plan {
    s.recurring_plan_save(
        &PlanSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: f,
        },
        today,
    )
    .unwrap()
}
fn edit(s: &mut Store, p: &Plan, today: &str, change: impl FnOnce(&mut PlanFields)) -> Plan {
    let mut f = p.fields.clone();
    change(&mut f);
    s.recurring_plan_save(
        &PlanSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(p.id.clone()),
            expected_revision: Some(p.revision),
            fields: f,
        },
        today,
    )
    .unwrap()
}
fn pay(s: &Store, p: &Plan, due: &str, amount: Option<&str>, paid: Option<&str>) -> PaymentSave {
    PaymentSave {
        request_id: rid(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        plan_id: p.id.clone(),
        due_date: due.into(),
        state: if amount.is_some() { "paid" } else { "skipped" }.into(),
        paid_date: paid.map(str::to_owned),
        amount_cents: amount.map(str::to_owned),
        notes: String::new(),
    }
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}
fn dues(s: &Store, today: &str) -> Vec<(String, String)> {
    s.recurring_overview(today)
        .unwrap()
        .due
        .into_iter()
        .map(|d| (d.plan_name, d.due_date))
        .collect()
}

#[test]
fn x_ac08_annual_burden_and_monthly_average_are_not_payments() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    const T: &str = "2026-09-28";
    let mut rent = fields("虚构房租", "300000", 1, "2026-10-01");
    rent.category = "rent".into();
    create(&mut s, rent, T);
    create(&mut s, fields("虚构服务", "12000", 1, "2026-10-05"), T);
    create(&mut s, fields("虚构域名", "12000", 12, "2027-03-01"), T);
    let o = s.recurring_overview(T).unwrap();
    assert_eq!(
        (o.annual_cents.as_str(), o.monthly_cents.as_str()),
        ("3756000", "313000")
    );
    assert_eq!(
        o.next12_cents, "3756000",
        "12 rent + 12 service + 1 domain inside the year"
    );
    assert!(o.due.is_empty() && o.payments.is_empty());
    assert_eq!(
        s.expense_view(None).unwrap().spent_cents,
        "0",
        "plans are not spending"
    );
    assert_eq!(
        o.upcoming
            .iter()
            .map(|d| d.due_date.as_str())
            .collect::<Vec<_>>(),
        vec!["2026-10-01", "2026-10-05"]
    );
}

#[test]
fn x_ac09_x_ac10_due_periods_wait_for_one_confirmation() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let p = create(
        &mut s,
        fields("虚构服务", "12000", 1, "2026-08-31"),
        "2026-08-01",
    );
    assert_eq!(
        dues(&s, "2026-09-30"),
        vec![
            ("虚构服务".into(), "2026-08-31".into()),
            ("虚构服务".into(), "2026-09-30".into())
        ]
    );
    assert_eq!(
        s.expense_view(None).unwrap().spent_cents,
        "0",
        "being due is not a payment"
    );

    let input = pay(&s, &p, "2026-08-31", Some("11800"), Some("2026-09-02"));
    s.set_hook(|x| {
        if x == "recurring_payment.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        code(s.recurring_payment_save(&input, "2026-09-30")),
        "INJECTED"
    );
    s.set_hook(|_| Ok(()));
    let first = s.recurring_payment_save(&input, "2026-09-30").unwrap();
    let again = s.recurring_payment_save(&input, "2026-09-30").unwrap();
    assert_eq!((first.id.as_str(), again.revision), (again.id.as_str(), 1));
    assert_eq!(
        code(s.recurring_payment_save(
            &pay(&s, &p, "2026-08-31", Some("11800"), Some("2026-09-02")),
            "2026-09-30"
        )),
        "PAYMENT_EXISTS"
    );
    assert_eq!(
        dues(&s, "2026-09-30"),
        vec![("虚构服务".into(), "2026-09-30".into())]
    );
    let v = s.expense_view(Some(2026)).unwrap();
    assert_eq!(v.spent_cents, "11800", "the actual amount, counted once");
    assert_eq!(
        v.months[8].spent_cents, "11800",
        "on the paid date, September"
    );
    assert!(v
        .lines
        .iter()
        .any(|l| l.source == "payment" && l.title == "虚构服务"));

    // Skipping clears the period without any amount.
    s.recurring_payment_save(&pay(&s, &p, "2026-09-30", None, None), "2026-09-30")
        .unwrap();
    assert!(dues(&s, "2026-09-30").is_empty());
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "11800");

    // Correcting keeps the period; moving it is refused.
    let mut fix = pay(&s, &p, "2026-08-31", Some("12000"), Some("2026-09-01"));
    fix.id = Some(first.id.clone());
    fix.expected_revision = Some(1);
    assert_eq!(
        s.recurring_payment_save(&fix, "2026-09-30")
            .unwrap()
            .amount_cents
            .as_deref(),
        Some("12000")
    );
    let mut moved = pay(&s, &p, "2026-09-30", Some("1"), Some("2026-09-01"));
    moved.id = Some(first.id.clone());
    moved.expected_revision = Some(2);
    assert_eq!(
        code(s.recurring_payment_save(&moved, "2026-09-30")),
        "PAYMENT_PERIOD"
    );
}

#[test]
fn input_rules() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    const T: &str = "2026-09-28";
    for (f, want) in [
        (fields("", "1", 1, "2026-10-01"), "PLAN_NAME"),
        (fields("x", "0", 1, "2026-10-01"), "PLAN_AMOUNT"),
        (fields("x", "1", 2, "2026-10-01"), "PLAN_INTERVAL"),
        (
            PlanFields {
                category: "food".into(),
                ..fields("x", "1", 1, "2026-10-01")
            },
            "PLAN_CATEGORY",
        ),
        (
            PlanFields {
                end_date: Some("2026-09-01".into()),
                ..fields("x", "1", 1, "2026-10-01")
            },
            "PLAN_END",
        ),
    ] {
        let r = s.recurring_plan_save(
            &PlanSave {
                request_id: rid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            T,
        );
        assert_eq!(code(r), want);
    }
    let p = create(&mut s, fields("虚构服务", "100", 1, "2026-09-15"), T);
    assert_eq!(
        code(s.recurring_payment_save(&pay(&s, &p, "2026-09-16", Some("100"), Some(T)), T)),
        "PAYMENT_PERIOD"
    );
    assert_eq!(
        code(s.recurring_payment_save(
            &pay(&s, &p, "2026-09-15", Some("100"), Some("2026-09-29")),
            T
        )),
        "PAYMENT_DATE"
    );
    assert_eq!(
        code(s.recurring_payment_save(&pay(&s, &p, "2026-09-15", Some("0"), Some(T)), T)),
        "PAYMENT_AMOUNT"
    );
    let mut both = pay(&s, &p, "2026-09-15", None, None);
    both.amount_cents = Some("100".into());
    assert_eq!(code(s.recurring_payment_save(&both, T)), "PAYMENT_STATE");
    // A future period can be paid early; it then leaves the forecast.
    let before = s.recurring_overview(T).unwrap().next12_cents;
    s.recurring_payment_save(&pay(&s, &p, "2026-10-15", Some("100"), Some(T)), T)
        .unwrap();
    let after = s.recurring_overview(T).unwrap().next12_cents;
    assert_eq!(
        before.parse::<i64>().unwrap() - after.parse::<i64>().unwrap(),
        100
    );
}

#[test]
fn pause_end_and_plan_edits_never_rewrite_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let p = create(
        &mut s,
        fields("虚构会员", "5000", 1, "2026-01-10"),
        "2026-01-01",
    );
    let paid = s
        .recurring_payment_save(
            &pay(&s, &p, "2026-01-10", Some("5000"), Some("2026-01-10")),
            "2026-01-10",
        )
        .unwrap();
    let p = edit(&mut s, &p, "2026-02-01", |f| f.paused = true);
    let o = s.recurring_overview("2026-05-20").unwrap();
    assert!(o.due.is_empty() && o.upcoming.is_empty());
    assert_eq!(
        (o.annual_cents.as_str(), o.next12_cents.as_str()),
        ("0", "0")
    );

    // Resuming asks only from today on; the paused months are not recalled.
    let p = edit(&mut s, &p, "2026-05-20", |f| f.paused = false);
    assert_eq!(p.active_from, "2026-05-20");
    assert!(dues(&s, "2026-06-10")
        .iter()
        .map(|d| d.1.as_str())
        .eq(["2026-06-10"]));

    // A price change applies to later periods; the recorded payment keeps 5000.
    let p = edit(&mut s, &p, "2026-06-01", |f| f.amount_cents = "6000".into());
    assert_eq!(
        s.recurring_overview("2026-06-10").unwrap().due[0].amount_cents,
        "6000"
    );
    let o = s.recurring_overview("2026-06-10").unwrap();
    let kept = o.payments.iter().find(|x| x.id == paid.id).unwrap();
    assert_eq!(
        (kept.amount_cents.as_deref(), kept.off_schedule),
        (Some("5000"), false)
    );

    // Moving the anchor leaves the old record in place, marked off schedule.
    let p = edit(&mut s, &p, "2026-06-01", |f| {
        f.first_due = "2026-01-15".into()
    });
    let o = s.recurring_overview("2026-06-10").unwrap();
    assert!(
        o.payments
            .iter()
            .find(|x| x.id == paid.id)
            .unwrap()
            .off_schedule
    );
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "5000");

    // An end date stops future periods and the annual burden.
    edit(&mut s, &p, "2026-06-01", |f| {
        f.end_date = Some("2026-07-15".into())
    });
    let o = s.recurring_overview("2026-07-20").unwrap();
    assert_eq!(
        (o.annual_cents.as_str(), o.next12_cents.as_str()),
        ("0", "0")
    );
    assert!(o.upcoming.is_empty());
}

#[test]
fn backups_carry_plans_and_schema_sixteen_backups_migrate() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a")).unwrap();
    let p = create(
        &mut a,
        fields("虚构房租", "300000", 1, "2026-09-01"),
        "2026-09-28",
    );
    a.recurring_payment_save(
        &pay(&a, &p, "2026-09-01", Some("300000"), Some("2026-09-01")),
        "2026-09-28",
    )
    .unwrap();
    let file = dir.path().join("备份.possio");
    a.backup(Some(&file)).unwrap();
    drop(a);
    let mut b = Store::open(&dir.path().join("b")).unwrap();
    let summary = b.inspect_backup(&file).unwrap();
    assert_eq!(
        (summary.schema, summary.plans, summary.payments),
        (17, 1, 1)
    );
    b.restore(&file, &summary.hash, &b.generation()).unwrap();
    assert_eq!(
        b.recurring_overview("2026-09-28").unwrap().payments.len(),
        1
    );

    use sha2::{Digest, Sha256};
    use std::io::Write;
    let v16 = dir.path().join("v16.sqlite");
    let db = rusqlite::Connection::open(&v16).unwrap();
    db.execute_batch(possio_lib::storage::SCHEMA).unwrap();
    possio_lib::storage::migrate_to(&db, 16, &|_| Ok(())).unwrap();
    drop(db);
    let bytes = std::fs::read(&v16).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":16,"created_at":"2026-09-28T02:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let old = dir.path().join("v16.possio");
    let mut z = zip::ZipWriter::new(std::fs::File::create(&old).unwrap());
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("manifest.json", opts).unwrap();
    z.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    z.start_file("data.sqlite", opts).unwrap();
    z.write_all(&bytes).unwrap();
    z.finish().unwrap();
    let summary = b.inspect_backup(&old).unwrap();
    b.restore(&old, &summary.hash, &b.generation()).unwrap();
    assert!(b.recurring_overview("2026-09-28").unwrap().plans.is_empty());
}

#[test]
fn plans_and_payments_delete_restore_and_reach_the_timeline() {
    use possio_lib::{timeline::Query, trash::TrashQuery, wealth::TrashChange};
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    const T: &str = "2026-09-28";
    let p = create(
        &mut s,
        fields("虚构会员", "5000", 1, "2026-08-01"),
        "2026-08-01",
    );
    let aug = s
        .recurring_payment_save(
            &pay(&s, &p, "2026-08-01", Some("5000"), Some("2026-08-01")),
            T,
        )
        .unwrap();
    let events = |s: &Store| -> Vec<String> {
        s.timeline(
            &Query {
                filter: "expense".into(),
                asset_id: None,
            },
            T,
        )
        .unwrap()
        .dated
        .into_iter()
        .map(|e| e.kind)
        .collect()
    };
    assert_eq!(events(&s), vec!["payment"]);
    let trash = |s: &Store, kind: &str, id: &str, rev: i64, deleted: bool| TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: kind.into(),
        id: id.into(),
        expected_revision: rev,
        deleted,
    };
    let rows = |s: &Store| -> Vec<(String, bool)> {
        s.list_trash(&TrashQuery {
            filter: "wealth".into(),
            offset: 0,
        })
        .unwrap()
        .items
        .into_iter()
        .map(|e| (e.kind, e.asset_deleted))
        .collect()
    };

    // Deleting a payment frees its period; a new record then blocks restoring it.
    s.wealth_trash(&trash(&s, "payment", &aug.id, 1, true))
        .unwrap();
    assert_eq!(dues(&s, T).len(), 2);
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    assert!(events(&s).is_empty());
    let redo = s
        .recurring_payment_save(
            &pay(&s, &p, "2026-08-01", Some("4800"), Some("2026-08-02")),
            T,
        )
        .unwrap();
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "payment", &aug.id, 2, false))),
        "PAYMENT_EXISTS"
    );
    s.wealth_trash(&trash(&s, "payment", &redo.id, 1, true))
        .unwrap();
    s.wealth_trash(&trash(&s, "payment", &aug.id, 2, false))
        .unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "5000");

    // Deleting the plan hides it and its payments without rewriting them.
    s.wealth_trash(&trash(&s, "plan", &p.id, 1, true)).unwrap();
    let o = s.recurring_overview(T).unwrap();
    assert!(o.plans.is_empty() && o.payments.is_empty() && o.due.is_empty());
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    assert_eq!(
        rows(&s),
        vec![("plan".into(), false), ("payment".into(), true)],
        "newest deletion first: the plan, then the redo payment under it"
    );
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "payment", &redo.id, 2, false))),
        "PARENT_DELETED"
    );
    s.wealth_trash(&trash(&s, "plan", &p.id, 2, false)).unwrap();
    let o = s.recurring_overview(T).unwrap();
    assert_eq!((o.plans.len(), o.payments.len()), (1, 1));
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "5000");
}
