use thingary_lib::{
    domain::Error,
    purge::Purge,
    recurring::{PaymentSave, Plan, PlanFields, PlanSave},
    storage::Store,
    timeline::Query,
    trash::TrashQuery,
    virtual_assets::{Fields, Save, VirtualAsset},
    wealth::TrashChange,
};
const T: &str = "2026-09-28";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}
fn fields(name: &str, kind: &str) -> Fields {
    fields_billing(name, kind, "single")
}
fn fields_billing(name: &str, kind: &str, billing: &str) -> Fields {
    Fields {
        billing: billing.into(),
        label_id: None,
        pay_method: None,
        perpetual: None,
        name: name.into(),
        kind: kind.into(),
        provider: "虚构提供方".into(),
        purchase_date: None,
        price_cents: None,
        expires: None,
        plan_id: None,
        url: String::new(),
        notes: String::new(),
        stopped_on: None,
    }
}
fn save(s: &mut Store, old: Option<&VirtualAsset>, f: Fields) -> Result<VirtualAsset, Error> {
    s.virtual_save(
        &Save {
            renewal_price_cents: None,
            renewal_from: None,
            special_end: None,
            first_topup: None,
            plan: None,
            request_id: rid(),
            generation: s.generation(),
            id: old.map(|v| v.id.clone()),
            expected_revision: old.map(|v| v.revision),
            fields: f,
        },
        T,
    )
}
fn plan(s: &mut Store, name: &str, interval: u32, first: &str) -> Plan {
    s.recurring_plan_save(
        &PlanSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: PlanFields {
                auto_renew: true,
                interval_days: None,
                trial_days: None,
                service_start: None,
                coverage_start: None,
                name: name.into(),
                category: "subscription".into(),
                amount_cents: "2500".into(),
                interval_months: interval,
                first_due: first.into(),
                end_date: None,
                paused: false,
                notes: String::new(),
            },
        },
        T,
    )
    .unwrap()
}
fn pay(s: &mut Store, p: &Plan, due: &str, amount: &str) {
    s.recurring_payment_save(
        &PaymentSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: p.id.clone(),
            due_date: due.into(),
            state: "paid".into(),
            paid_date: Some(due.into()),
            amount_cents: Some(amount.into()),
            notes: String::new(),
        },
        T,
    )
    .unwrap();
}
fn trash(s: &Store, kind: &str, id: &str, revision: i64, deleted: bool) -> TrashChange {
    TrashChange {
        request_id: rid(),
        generation: s.generation(),
        kind: kind.into(),
        id: id.into(),
        expected_revision: revision,
        deleted,
    }
}
fn status(s: &Store, id: &str) -> (String, Option<String>, Option<String>) {
    let v = s
        .virtual_overview(T)
        .unwrap()
        .items
        .into_iter()
        .find(|v| v.id == id)
        .unwrap();
    (v.status, v.valid_until, v.spent_cents)
}

#[test]
fn status_follows_dates_and_stop() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut lic = fields("虚构剪辑软件", "license");
    lic.price_cents = Some("199800".into());
    lic.purchase_date = Some("2025-01-02".into());
    let lic = save(&mut s, None, lic).unwrap();
    assert_eq!(lic.status, "perpetual");
    let mut d = fields("example-notes.cn", "domain");
    d.expires = Some("2026-10-28".into()); // exactly 30 days out
    let d = save(&mut s, None, d).unwrap();
    assert_eq!(d.status, "expiring");
    let mut f = d.fields.clone();
    f.expires = Some("2026-10-29".into());
    let d = save(&mut s, Some(&d), f).unwrap();
    assert_eq!(d.status, "active");
    let mut f = d.fields.clone();
    f.expires = Some("2026-09-27".into());
    let d = save(&mut s, Some(&d), f).unwrap();
    assert_eq!(d.status, "expired");
    let sub = save(&mut s, None, fields("虚构云盘", "subscription")).unwrap();
    assert_eq!(
        (sub.status.as_str(), sub.spent_cents.clone()),
        ("ongoing", None)
    );
    // Stopping wins over any date and can be undone.
    let mut f = d.fields.clone();
    f.stopped_on = Some(T.into());
    let d = save(&mut s, Some(&d), f).unwrap();
    assert_eq!(d.status, "stopped");
    let mut f = d.fields.clone();
    f.stopped_on = None;
    assert_eq!(save(&mut s, Some(&d), f).unwrap().status, "expired");
    let o = s.virtual_overview(T).unwrap();
    assert_eq!(
        (
            o.in_use,
            o.expiring,
            o.expired,
            o.spent_cents.as_str(),
            o.unknown_price
        ),
        (2, 0, 1, "199800", 2)
    );
    // Inputs: future purchase, stop before purchase.
    let mut bad = fields("x", "license");
    bad.purchase_date = Some("2026-09-29".into());
    assert_eq!(code(save(&mut s, None, bad)), "VIRTUAL_DATE");
    let mut bad = fields("x", "license");
    bad.purchase_date = Some("2026-01-02".into());
    bad.stopped_on = Some("2026-01-01".into());
    assert_eq!(code(save(&mut s, None, bad)), "VIRTUAL_STOP");
}

#[test]
fn linked_plan_is_the_only_source_of_validity_and_cost() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let p = plan(&mut s, "虚构视频会员", 1, "2026-07-31");
    let mut f = fields_billing("虚构视频会员", "subscription", "subscription");
    f.plan_id = Some(p.id.clone());
    let v = save(&mut s, None, f.clone()).unwrap();
    assert_eq!(
        (v.status.as_str(), v.valid_until.clone()),
        ("ongoing", None)
    );
    assert_eq!(v.spent_cents.as_deref(), Some("0"));
    pay(&mut s, &p, "2026-07-31", "2500");
    pay(&mut s, &p, "2026-08-31", "2800");
    // Month-end anchor: the 08-31 period covers through 09-29.
    assert_eq!(
        status(&s, &v.id),
        (
            "ongoing".into(),
            Some("2026-09-29".into()),
            Some("5300".into())
        )
    );
    // Linked costs come only from payments: no second virtual expense line.
    let view = s.expense_view(None).unwrap();
    assert_eq!(view.spent_cents, "5300");
    assert!(view.lines.iter().all(|l| l.source != "virtual"));
    // Constraints: licenses never link, linked items carry no price, one item per plan.
    let mut bad = fields("x", "license");
    bad.plan_id = Some(p.id.clone());
    assert_eq!(code(save(&mut s, None, bad)), "VIRTUAL_PLAN");
    let mut bad = f.clone();
    bad.price_cents = Some("1".into());
    assert_eq!(code(save(&mut s, None, bad)), "VIRTUAL_PLAN");
    assert_eq!(code(save(&mut s, None, f.clone())), "VIRTUAL_PLAN_TAKEN");
    let o = s.virtual_overview(T).unwrap();
    assert_eq!(o.plans[0].linked_to.as_deref(), Some("虚构视频会员"));

    // Deleting the plan hides its validity; restoring the item is blocked
    // when its plan went to another item meanwhile.
    s.wealth_trash(&trash(&s, "virtual", &v.id, v.revision, true))
        .unwrap();
    let other = save(&mut s, None, f).unwrap();
    assert_eq!(
        code(s.wealth_trash(&trash(&s, "virtual", &v.id, v.revision + 1, false))),
        "VIRTUAL_PLAN_TAKEN"
    );
    s.wealth_trash(&trash(&s, "plan", &p.id, p.revision, true))
        .unwrap();
    let hidden = &s.virtual_overview(T).unwrap().items[0];
    assert!(hidden.plan_deleted && hidden.valid_until.is_none() && hidden.spent_cents.is_none());
    // Purging the plan unlinks every item that pointed to it.
    s.purge_trash(&Purge {
        request_id: rid(),
        generation: s.generation(),
        kind: Some("plan".into()),
        id: p.id.clone(),
    })
    .unwrap();
    let after = &s.virtual_overview(T).unwrap().items[0];
    assert_eq!(
        (after.id.as_str(), after.fields.plan_id.clone()),
        (other.id.as_str(), None)
    );
    s.wealth_trash(&trash(&s, "virtual", &v.id, v.revision + 1, false))
        .unwrap();
}

#[test]
fn one_time_prices_reach_expenses_timeline_and_backups() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a")).unwrap();
    let mut f = fields("虚构笔记软件", "license");
    f.price_cents = Some("32800".into());
    f.purchase_date = Some("2026-03-05".into());
    let v = save(&mut a, None, f).unwrap();
    let mut undated = fields("虚构图标包", "license");
    undated.price_cents = Some("1200".into());
    save(&mut a, None, undated).unwrap();
    let view = a.expense_view(Some(2026)).unwrap();
    assert_eq!(view.spent_cents, "32800");
    assert_eq!(view.undated_cents, "1200");
    let line = view.lines.iter().find(|l| l.source == "virtual").unwrap();
    assert_eq!(line.category.as_deref(), Some("digital"));
    let t = a
        .timeline(
            &Query {
                filter: "expense".into(),
                asset_id: None,
            },
            T,
        )
        .unwrap();
    assert!(t
        .dated
        .iter()
        .any(|e| e.kind == "virtual" && e.amount_cents.as_deref() == Some("32800")));
    // Recently Deleted lists it; deleting removes it from expenses.
    a.wealth_trash(&trash(&a, "virtual", &v.id, v.revision, true))
        .unwrap();
    let listed = a
        .list_trash(&TrashQuery {
            filter: "wealth".into(),
            offset: 0,
            search: String::new(),
        })
        .unwrap();
    assert!(listed
        .items
        .iter()
        .any(|e| e.kind == "virtual" && e.id == v.id));
    assert_eq!(a.expense_view(Some(2026)).unwrap().spent_cents, "0");
    a.wealth_trash(&trash(&a, "virtual", &v.id, v.revision + 1, false))
        .unwrap();

    let file = dir.path().join("备份.thingary");
    a.backup(Some(&file)).unwrap();
    drop(a);
    let mut b = Store::open(&dir.path().join("b")).unwrap();
    let summary = b.inspect_backup(&file).unwrap();
    assert_eq!(
        (summary.schema, summary.virtual_assets),
        (thingary_lib::storage::SCHEMA_VERSION as u32, 2)
    );
    b.restore(&file, &summary.hash, &b.generation()).unwrap();
    assert_eq!(b.virtual_overview(T).unwrap().items.len(), 2);
}

#[test]
fn legacy_continuing_subscriptions_keep_paid_facts_and_use_only_explicit_end_dates() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let p = plan(&mut s, "虚构旧 GPT", 1, "2026-07-31");
    let mut f = fields_billing("虚构旧 GPT", "subscription", "subscription");
    f.plan_id = Some(p.id.clone());
    let v = save(&mut s, None, f).unwrap();
    pay(&mut s, &p, "2026-07-31", "2400");
    let before = s.recurring_overview(T).unwrap();
    let future = s.virtual_overview("2028-01-01").unwrap();
    let read = &future.items[0];
    assert_eq!(read.status, "ongoing");
    assert_eq!(read.paid_until.as_deref(), Some("2026-08-30"));
    assert_eq!(read.spent_cents.as_deref(), Some("2400"));
    assert_eq!(read.revision, v.revision);
    let after = s.recurring_overview(T).unwrap();
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(after).unwrap()
    );
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "2400");

    let mut f = p.fields.clone();
    f.paused = true;
    let paused = s
        .recurring_plan_save(
            &PlanSave {
                request_id: rid(),
                generation: s.generation(),
                id: Some(p.id.clone()),
                expected_revision: Some(p.revision),
                fields: f.clone(),
            },
            T,
        )
        .unwrap();
    assert_eq!(s.virtual_overview(T).unwrap().items[0].status, "paused");
    f.paused = false;
    f.end_date = Some("2026-10-31".into());
    s.recurring_plan_save(
        &PlanSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(p.id),
            expected_revision: Some(paused.revision),
            fields: f,
        },
        T,
    )
    .unwrap();
    let finite = s.virtual_overview("2026-10-04").unwrap().items.remove(0);
    assert_eq!(finite.status, "active");
    assert_eq!(finite.valid_until.as_deref(), Some("2026-10-31"));
    assert_eq!(finite.paid_until.as_deref(), Some("2026-08-30"));
    assert_eq!(
        s.virtual_overview("2026-10-31").unwrap().items[0].status,
        "expiring"
    );
    assert_eq!(
        s.virtual_overview("2026-11-01").unwrap().items[0].status,
        "expired"
    );

    let d = plan(&mut s, "虚构域名计划", 1, "2026-07-31");
    let mut domain = fields_billing("example.test", "domain", "subscription");
    domain.plan_id = Some(d.id.clone());
    let dv = save(&mut s, None, domain).unwrap();
    pay(&mut s, &d, "2026-07-31", "1000");
    assert_eq!(status(&s, &dv.id).0, "expired");

    let mut single = fields("虚构旧单次服务", "subscription");
    single.price_cents = Some("12800".into());
    let single = save(&mut s, None, single).unwrap();
    assert_eq!(single.status, "ongoing");
    assert_eq!(single.spent_cents.as_deref(), Some("12800"));
    assert!(single.fields.plan_id.is_none());
}
