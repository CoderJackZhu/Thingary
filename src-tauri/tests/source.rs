//! Q03a: stable source targets, snapshot events, and the domain/year timeline
//! projection. All data is fictional and lives in temporary directories only.
use thingary_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::Save,
    expenses,
    recurring::{PaymentSave, Plan, PlanFields, PlanSave},
    source::Target,
    storage::Store,
    timeline::{Query, Timeline},
    virtual_assets,
    wealth::{
        Account, AccountFields, AccountSave, EntryInput, Snapshot, SnapshotSave, TrashChange,
    },
    wishlist,
};
const TODAY: &str = "2026-09-28";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T: std::fmt::Debug>(r: std::result::Result<T, thingary_lib::domain::Error>) -> String {
    r.unwrap_err().code
}
fn asset(s: &mut Store, name: &str, price: &str, date: &str) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: rid(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some(price.into()),
                purchase_date: Some(date.into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn account(s: &mut Store, name: &str, side: &str) -> Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: name.into(),
                institution: "虚构平台".into(),
                side: side.into(),
                kind: if side == "liability" { "loan" } else { "cash" }.into(),
                counted: true,
                opened_on: "2024-01-01".into(),
                closed_on: None,
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn check_in(
    s: &Store,
    id: Option<&str>,
    revision: Option<i64>,
    date: &str,
    entries: Vec<EntryInput>,
) -> SnapshotSave {
    SnapshotSave {
        request_id: rid(),
        generation: s.generation(),
        id: id.map(str::to_owned),
        expected_revision: revision,
        date: date.into(),
        notes: String::new(),
        entries,
    }
}
fn row(a: &Account, yuan: i64) -> EntryInput {
    EntryInput {
        account_id: a.id.clone(),
        state: "entered".into(),
        amount_cents: Some((yuan * 100).to_string()),
    }
}
fn plan(s: &mut Store, name: &str, first: &str) -> Plan {
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
                amount_cents: "12000".into(),
                interval_months: 1,
                first_due: first.into(),
                end_date: None,
                paused: false,
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn pay(s: &mut Store, plan_id: &str, due: &str) -> String {
    s.recurring_payment_save(
        &PaymentSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan_id.into(),
            due_date: due.into(),
            state: "paid".into(),
            paid_date: Some(due.into()),
            amount_cents: Some("12000".into()),
            notes: String::new(),
        },
        TODAY,
    )
    .unwrap()
    .id
}
fn virtual_fields(name: &str, plan_id: Option<&str>) -> virtual_assets::Fields {
    virtual_assets::Fields {
        billing: if plan_id.is_some() {
            "subscription".into()
        } else {
            "single".into()
        },
        label_id: None,
        pay_method: None,
        perpetual: None,
        name: name.into(),
        // A plan-linked entitlement must be a recurring kind, never a buyout.
        kind: if plan_id.is_some() {
            "domain"
        } else {
            "license"
        }
        .into(),
        provider: "虚构厂商".into(),
        purchase_date: Some("2026-04-01".into()),
        // A linked asset derives cost and validity from plan payments.
        price_cents: plan_id.is_none().then(|| "60000".to_string()),
        expires: None,
        plan_id: plan_id.map(str::to_owned),
        url: String::new(),
        notes: String::new(),
        stopped_on: None,
    }
}
fn virtual_save(s: &mut Store, fields: virtual_assets::Fields) -> virtual_assets::VirtualAsset {
    s.virtual_save(
        &virtual_assets::Save {
            renewal_price_cents: None,
            renewal_from: None,
            special_end: None,
            first_topup: None,
            plan: None,
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields,
        },
        TODAY,
    )
    .unwrap()
}
fn wish(s: &mut Store, name: &str) -> wishlist::WishlistItem {
    s.change_wishlist(&wishlist::Change {
        request_id: rid(),
        generation: s.generation(),
        expected_revision: None,
        action: wishlist::Action::Add {
            fields: wishlist::Fields {
                name: name.into(),
                category_id: None,
                estimated_price_cents: Some("880000".into()),
                priority: None,
                target_date: None,
                external_link: String::new(),
                notes: String::new(),
            },
            cover: thingary_lib::photos::Selection {
                cover_id: None,
                ids: vec![],
            },
        },
    })
    .unwrap()
}
fn expense(s: &mut Store, fields: expenses::Fields) -> expenses::Expense {
    s.expense_save(
        &expenses::Save {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields,
        },
        TODAY,
    )
    .unwrap()
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
fn view(s: &Store, domain: &str, year: Option<i32>) -> Timeline {
    view_filter(s, "all", domain, year)
}
fn view_filter(s: &Store, filter: &str, domain: &str, year: Option<i32>) -> Timeline {
    s.timeline_view(
        &Query {
            filter: filter.into(),
            asset_id: None,
        },
        domain,
        year,
        TODAY,
    )
    .unwrap()
}
fn kinds(t: &Timeline) -> Vec<String> {
    t.dated.iter().map(|e| e.kind.clone()).collect()
}

#[test]
fn validate_source_accepts_every_live_target_and_rejects_identity_breaks() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = asset(&mut s, "虚构相机", "1500000", "2025-01-10");
    let w = wish(&mut s, "虚构镜头");
    let cash = account(&mut s, "虚构现金", "asset");
    let loan = account(&mut s, "虚构贷款", "liability");
    let snap = s
        .wealth_snapshot_save(
            &check_in(
                &s,
                None,
                None,
                "2026-08-31",
                vec![row(&cash, 300), row(&loan, 50)],
            ),
            TODAY,
        )
        .unwrap();
    let x = expense(
        &mut s,
        expenses::Fields {
            title: "虚构独立支出".into(),
            date: "2025-03-05".into(),
            amount_cents: "200000".into(),
            category: "other".into(),
            notes: String::new(),
            refund_cents: Some("50000".into()),
            refund_date: Some("2026-01-20".into()),
            asset_id: None,
        },
    );
    let p = plan(&mut s, "虚构云订阅", "2026-01-01");
    let payment = pay(&mut s, &p.id, "2026-02-01");
    let v = virtual_save(&mut s, virtual_fields("虚构买断软件", None));
    let generation = s.generation();
    for target in [
        Target::Asset {
            id: a.asset.id.clone(),
        },
        Target::Wish { id: w.id.clone() },
        Target::Snapshot {
            id: snap.id.clone(),
        },
        Target::Expense { id: x.id.clone() },
        Target::Payment {
            id: payment.clone(),
            plan_id: p.id.clone(),
        },
        Target::Virtual { id: v.id.clone() },
        Target::Plan { id: p.id.clone() },
    ] {
        s.validate_source(&target, &generation).unwrap();
    }
    // A target from another dataset is stale; it is never resolved here.
    let other_dir = tempfile::tempdir().unwrap();
    let other = Store::open(other_dir.path()).unwrap();
    assert_eq!(
        code(s.validate_source(
            &Target::Asset {
                id: a.asset.id.clone()
            },
            &other.generation()
        )),
        "STALE_DATASET"
    );
    for id in ["", "not-a-uuid"] {
        assert_eq!(
            code(s.validate_source(&Target::Asset { id: id.into() }, &generation)),
            "ID"
        );
    }
    // A payment only validates through its own plan.
    assert_eq!(
        code(s.validate_source(
            &Target::Payment {
                id: payment,
                plan_id: rid()
            },
            &generation
        )),
        "NOT_FOUND"
    );
}

#[test]
fn validate_source_follows_deletion_relations_and_payment_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = asset(&mut s, "虚构主机", "800000", "2025-06-01");
    let linked = expense(
        &mut s,
        expenses::Fields {
            title: "关联主机的独立支出".into(),
            date: "2025-06-01".into(),
            amount_cents: "1200000".into(),
            category: "digital".into(),
            notes: String::new(),
            refund_cents: None,
            refund_date: None,
            asset_id: Some(a.asset.id.clone()),
        },
    );
    let p = plan(&mut s, "虚构域名", "2026-03-01");
    let payment = pay(&mut s, &p.id, "2026-03-01");
    let w = wish(&mut s, "虚构心愿");
    let cash = account(&mut s, "虚构现金", "asset");
    let snap = s
        .wealth_snapshot_save(
            &check_in(&s, None, None, "2026-08-31", vec![row(&cash, 100)]),
            TODAY,
        )
        .unwrap();
    let v = virtual_save(&mut s, virtual_fields("虚构订阅", None));
    let generation = s.generation();
    // Correcting the payment to skipped invalidates its target; the plan lives on.
    s.recurring_payment_save(
        &PaymentSave {
            request_id: rid(),
            generation: s.generation(),
            id: Some(payment.clone()),
            expected_revision: Some(1),
            plan_id: p.id.clone(),
            due_date: "2026-03-01".into(),
            state: "skipped".into(),
            paid_date: None,
            amount_cents: None,
            notes: String::new(),
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        code(s.validate_source(
            &Target::Payment {
                id: payment,
                plan_id: p.id.clone()
            },
            &generation
        )),
        "NOT_FOUND"
    );
    // The linked asset is gone, so the still-live expense no longer resolves.
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: rid(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        deleted: true,
    })
    .unwrap();
    assert_eq!(
        code(s.validate_source(&Target::Expense { id: linked.id }, &generation)),
        "NOT_FOUND"
    );
    // Deleting the plan takes its history with it.
    s.wealth_trash(&trash(&s, "plan", &p.id, p.revision, true))
        .unwrap();
    assert_eq!(
        code(s.validate_source(&Target::Plan { id: p.id }, &generation)),
        "NOT_FOUND"
    );
    s.wealth_trash(&trash(&s, "wish", &w.id, w.revision, true))
        .unwrap();
    assert_eq!(
        code(s.validate_source(&Target::Wish { id: w.id }, &generation)),
        "NOT_FOUND"
    );
    s.wealth_trash(&trash(&s, "snapshot", &snap.id, snap.revision, true))
        .unwrap();
    assert_eq!(
        code(s.validate_source(&Target::Snapshot { id: snap.id }, &generation)),
        "NOT_FOUND"
    );
    s.wealth_trash(&trash(&s, "virtual", &v.id, v.revision, true))
        .unwrap();
    assert_eq!(
        code(s.validate_source(&Target::Virtual { id: v.id }, &generation)),
        "NOT_FOUND"
    );
}

/// A library with one event of each domain: physical purchase, a wish, a
/// complete snapshot, a standalone expense with a cross-year refund, a paid
/// plan payment, an independent virtual purchase, and a plan-linked virtual
/// asset whose cost only exists through the payment.
struct Mixed {
    asset_id: String,
    wish_id: String,
    snapshot_id: String,
    expense_id: String,
    payment_id: String,
    plan_id: String,
    virtual_id: String,
    linked_virtual_id: String,
}
fn mixed(s: &mut Store) -> Mixed {
    let a = asset(s, "虚构相机", "1500000", "2025-01-10");
    let w = wish(s, "虚构镜头");
    let cash = account(s, "虚构现金", "asset");
    let snap = s
        .wealth_snapshot_save(
            &check_in(s, None, None, "2026-08-31", vec![row(&cash, 300)]),
            TODAY,
        )
        .unwrap();
    let x = expense(
        s,
        expenses::Fields {
            title: "虚构独立支出".into(),
            date: "2025-03-05".into(),
            amount_cents: "200000".into(),
            category: "other".into(),
            notes: String::new(),
            refund_cents: Some("50000".into()),
            refund_date: Some("2026-01-20".into()),
            asset_id: None,
        },
    );
    let p = plan(s, "虚构云订阅", "2026-01-01");
    let payment = pay(s, &p.id, "2026-02-01");
    let v = virtual_save(s, virtual_fields("虚构买断软件", None));
    let linked = virtual_save(s, virtual_fields("虚构关联域名", Some(&p.id)));
    Mixed {
        asset_id: a.asset.id,
        wish_id: w.id,
        snapshot_id: snap.id,
        expense_id: x.id,
        payment_id: payment,
        plan_id: p.id,
        virtual_id: v.id,
        linked_virtual_id: linked.id,
    }
}

#[test]
fn timeline_view_partitions_domains_and_carries_targets() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let m = mixed(&mut s);
    let all = view(&s, "all", None);
    // Newest first: wish_added lands on its creation date, both virtual events
    // share the association/buyout date.
    assert_eq!(
        kinds(&all),
        vec![
            "wish_added",
            "snapshot",
            "virtual",
            "virtual",
            "payment",
            "refund",
            "expense",
            "purchase"
        ]
    );
    // Every event resolves through a stable target.
    assert!(all.dated.windows(2).all(|w| w[0].date >= w[1].date));
    let mut virtual_targets = vec![];
    for e in all.dated.iter().chain(all.undated.iter()) {
        assert!(!e.domain.is_empty(), "event {} lacks a domain", e.id);
        match &e.target {
            Target::Topup { .. } => {}
            Target::Asset { id } => assert_eq!(id, &m.asset_id),
            Target::Wish { id } => assert_eq!(id, &m.wish_id),
            Target::Snapshot { id } => assert_eq!(id, &m.snapshot_id),
            Target::Expense { id } => assert_eq!(id, &m.expense_id),
            Target::Payment { id, plan_id } => {
                assert_eq!(id, &m.payment_id);
                assert_eq!(plan_id, &m.plan_id);
            }
            Target::Virtual { id } => virtual_targets.push(id.clone()),
            Target::Plan { .. } => panic!("no plan-only event exists"),
        }
    }
    assert_eq!(virtual_targets.len(), 2);
    assert!(
        virtual_targets.contains(&m.virtual_id) && virtual_targets.contains(&m.linked_virtual_id)
    );
    assert_eq!(kinds(&view(&s, "physical", None)), vec!["purchase"]);
    assert_eq!(kinds(&view(&s, "wish", None)), vec!["wish_added"]);
    assert_eq!(kinds(&view(&s, "wealth", None)), vec!["snapshot"]);
    assert_eq!(
        kinds(&view(&s, "expense", None)),
        vec!["virtual", "virtual", "payment", "refund", "expense"]
    );
    // The linked asset's cost only exists through its payment: its event has
    // no amount of its own, and the payment appears exactly once.
    let linked = all
        .dated
        .iter()
        .find(|e| {
            e.target
                == Target::Virtual {
                    id: m.linked_virtual_id.clone(),
                }
        })
        .unwrap();
    assert_eq!(linked.amount_cents, None);
    assert_eq!(all.dated.iter().filter(|e| e.kind == "payment").count(), 1);
}

#[test]
fn timeline_view_years_and_cross_year_refund() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let m = mixed(&mut s);
    let in_2025 = view(&s, "all", Some(2025));
    assert_eq!(kinds(&in_2025), vec!["expense", "purchase"]);
    // A refund belongs to its own refund year, never the expense's year.
    assert_eq!(
        view(&s, "expense", Some(2025))
            .dated
            .iter()
            .filter(|e| e.kind == "refund")
            .count(),
        0
    );
    assert_eq!(
        view(&s, "expense", Some(2026))
            .dated
            .iter()
            .find(|e| e.kind == "refund")
            .unwrap()
            .target,
        Target::Expense {
            id: m.expense_id.clone()
        }
    );
    // Domain-specific year options; an empty year keeps them all reachable.
    assert_eq!(view(&s, "wealth", None).years, vec![2026]);
    let empty = view(&s, "wealth", Some(1999));
    assert!(empty.dated.is_empty() && empty.undated.is_empty());
    assert_eq!(empty.years, vec![2026]);
    assert_eq!(view(&s, "all", None).years, vec![2026, 2025]);
}

#[test]
fn undated_facts_stay_visible_under_domain_but_never_join_a_year() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = asset(&mut s, "虚构相机", "1500000", "2025-01-10");
    s.change_maintenance(
        &thingary_lib::maintenance::Change {
            request_id: rid(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action: thingary_lib::maintenance::Action::Add {
                fields: thingary_lib::maintenance::Fields {
                    date: None,
                    kind: "repair".into(),
                    title: "日期待补的维护".into(),
                    description: String::new(),
                    cost_cents: Some("30000".into()),
                    provider: String::new(),
                },
                photos: thingary_lib::photos::Selection {
                    cover_id: None,
                    ids: vec![],
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let physical = view(&s, "physical", None);
    assert_eq!(physical.dated.len(), 1);
    assert_eq!(physical.undated.len(), 1);
    assert_eq!(physical.undated[0].domain, "physical");
    // The undated fact is listed apart, never dated into the chosen year.
    let y2025 = view(&s, "physical", Some(2025));
    assert_eq!(y2025.dated.len(), 1);
    assert_eq!(y2025.undated.len(), 1);
    let y2026 = view(&s, "physical", Some(2026));
    assert!(y2026.dated.is_empty());
    assert_eq!(y2026.undated.len(), 1);
    // Unknown dates do not create year options either.
    assert_eq!(physical.years, vec![2025]);
}

#[test]
fn snapshot_events_stay_single_through_correction_delete_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let cash = account(&mut s, "虚构现金", "asset");
    let mut input = check_in(&s, None, None, "2026-08-31", vec![row(&cash, 300)]);
    let mut saved: Snapshot = s.wealth_snapshot_save(&input, TODAY).unwrap();
    let one = |s: &Store| {
        let t = view(s, "wealth", None);
        assert_eq!(t.dated.len(), 1);
        t.dated[0].clone()
    };
    let event = one(&s);
    assert_eq!(event.id, format!("snapshot:{}", saved.id));
    assert_eq!(event.amount_cents.as_deref(), Some("30000"));
    // Correcting the same check-in is still exactly one event with the new value.
    input = check_in(
        &s,
        Some(&saved.id),
        Some(saved.revision),
        "2026-08-31",
        vec![row(&cash, 320)],
    );
    saved = s.wealth_snapshot_save(&input, TODAY).unwrap();
    assert_eq!(one(&s).amount_cents.as_deref(), Some("32000"));
    // Deleting removes the event and invalidates the target; restoring brings
    // the same one back. Each soft-delete/restore bumps the revision by one.
    let mut revision = saved.revision;
    s.wealth_trash(&trash(&s, "snapshot", &saved.id, revision, true))
        .unwrap();
    revision += 1;
    assert!(view(&s, "wealth", None).dated.is_empty());
    assert_eq!(
        code(s.validate_source(
            &Target::Snapshot {
                id: saved.id.clone()
            },
            &s.generation()
        )),
        "NOT_FOUND"
    );
    s.wealth_trash(&trash(&s, "snapshot", &saved.id, revision, false))
        .unwrap();
    revision += 1;
    assert_eq!(one(&s).id, format!("snapshot:{}", saved.id));
    // A same-date replacement after deletion is a different source, never the old one.
    s.wealth_trash(&trash(&s, "snapshot", &saved.id, revision, true))
        .unwrap();
    let replacement = s
        .wealth_snapshot_save(
            &check_in(&s, None, None, "2026-08-31", vec![row(&cash, 310)]),
            TODAY,
        )
        .unwrap();
    let event = one(&s);
    assert_eq!(event.id, format!("snapshot:{}", replacement.id));
    assert_eq!(
        code(s.validate_source(&Target::Snapshot { id: saved.id }, &s.generation())),
        "NOT_FOUND"
    );
    s.validate_source(&Target::Snapshot { id: replacement.id }, &s.generation())
        .unwrap();
}

#[test]
fn incomplete_snapshot_events_show_missing_counts_and_reject_bad_queries() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    account(&mut s, "虚构现金", "asset");
    account(&mut s, "虚构贷款", "liability");
    // Open accounts due that day: one entered, one explicitly unknown.
    let rows = s.wealth_accounts().unwrap();
    let entered = rows.iter().find(|a| a.fields.side == "asset").unwrap();
    let unknown = rows.iter().find(|a| a.fields.side == "liability").unwrap();
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: rid(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: "2026-09-28".into(),
            notes: String::new(),
            entries: vec![
                EntryInput {
                    account_id: entered.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some("1000000".into()),
                },
                EntryInput {
                    account_id: unknown.id.clone(),
                    state: "missing".into(),
                    amount_cents: None,
                },
            ],
        },
        TODAY,
    )
    .unwrap();
    let t = view(&s, "wealth", None);
    assert_eq!(t.dated.len(), 1);
    let e = &t.dated[0];
    // An incomplete check-in shows its gap, never a subtotal posing as net worth.
    assert_eq!(e.amount_cents, None);
    assert_eq!(e.missing, Some(1));
    assert!(matches!(e.target, Target::Snapshot { .. }));
    let bad_domain: std::result::Result<Timeline, _> = s.timeline_view(
        &Query {
            filter: "all".into(),
            asset_id: None,
        },
        "money",
        None,
        TODAY,
    );
    assert_eq!(code(bad_domain), "QUERY");
    let bad_year: std::result::Result<Timeline, _> = s.timeline_view(
        &Query {
            filter: "all".into(),
            asset_id: None,
        },
        "all",
        Some(0),
        TODAY,
    );
    assert_eq!(code(bad_year), "QUERY");
    // The snapshot kind filter shows check-ins alone; other kinds exclude them.
    assert_eq!(
        kinds(&view_filter(&s, "snapshot", "all", None)),
        vec!["snapshot"]
    );
    let purchases = view_filter(&s, "purchase", "all", None);
    assert!(purchases.dated.iter().all(|e| e.kind != "snapshot"));
    // A domain with no events of the chosen kind is an honest empty result.
    assert!(view_filter(&s, "purchase", "wealth", None).dated.is_empty());
}

#[test]
fn review_recent_shares_one_projection_with_the_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    mixed(&mut s);
    let review = s.review_overview(None, TODAY).unwrap();
    let recent = match review.recent {
        thingary_lib::review::Read::Ready(v) => v,
        thingary_lib::review::Read::Error(e) => panic!("{e}"),
    };
    let projection = s
        .timeline_view(
            &Query {
                filter: "all".into(),
                asset_id: None,
            },
            "all",
            None,
            TODAY,
        )
        .unwrap();
    assert_eq!(recent.len(), 8.min(projection.dated.len()));
    for (r, p) in recent.iter().zip(projection.dated.iter()) {
        assert_eq!(r.id, p.id);
    }
    assert!(recent.iter().any(|e| e.kind == "snapshot"));
    let y2025 = s.review_overview(Some(2025), TODAY).unwrap();
    let recent = match y2025.recent {
        thingary_lib::review::Read::Ready(v) => v,
        thingary_lib::review::Read::Error(e) => panic!("{e}"),
    };
    assert!(recent
        .iter()
        .all(|e| e.date.as_deref().unwrap().starts_with("2025-")));
    assert!(recent.iter().all(|e| e.date.is_some()));
}
