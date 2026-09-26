use possio_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::Save,
    lifecycle, maintenance,
    photos::Selection,
    sales,
    storage::Store,
    timeline::{Event, Query},
    trash::{RecordChange, TrashChange},
    warranty,
    wishlist::{self, Convert},
};

const TODAY: &str = "2026-09-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn empty() -> Selection {
    Selection {
        ids: vec![],
        cover_id: None,
    }
}
fn save(
    s: &mut Store,
    prior: Option<&AssetRecord>,
    name: &str,
    price: Option<&str>,
    date: Option<&str>,
) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: prior.map(|r| r.asset.id.clone()),
                expected_revision: prior.map(|r| r.asset.revision),
                name: name.into(),
                price_cents: price.map(str::to_owned),
                purchase_date: date.map(str::to_owned),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn maintenance_fields(date: Option<&str>, cost: &str, title: &str) -> maintenance::Fields {
    maintenance::Fields {
        date: date.map(str::to_owned),
        kind: "repair".into(),
        title: title.into(),
        description: String::new(),
        cost_cents: Some(cost.into()),
        provider: String::new(),
    }
}
fn maintain(s: &mut Store, a: &AssetRecord, action: maintenance::Action) -> AssetRecord {
    s.change_maintenance(
        &maintenance::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action,
        },
        TODAY,
    )
    .unwrap()
}
fn warranty_fields(end: &str) -> warranty::Fields {
    warranty::Fields {
        kind: "manufacturer".into(),
        provider: "虚构保障方".into(),
        start_date: Some("2026-09-01".into()),
        end_date: Some(end.into()),
        notes: String::new(),
    }
}
fn warrant(s: &mut Store, a: &AssetRecord, action: warranty::Action) -> AssetRecord {
    s.change_warranty(
        &warranty::Change {
            reminder: None,
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action,
        },
        TODAY,
    )
    .unwrap()
}
fn sale(s: &mut Store, a: &AssetRecord, action: sales::Action) -> AssetRecord {
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action,
        },
        TODAY,
    )
    .unwrap()
}
fn events(s: &Store, filter: &str, asset: Option<&AssetRecord>) -> (Vec<Event>, Vec<Event>) {
    let t = s
        .timeline(
            &Query {
                filter: filter.into(),
                asset_id: asset.map(|a| a.asset.id.clone()),
            },
            TODAY,
        )
        .unwrap();
    (t.dated, t.undated)
}
fn shape(list: &[Event]) -> Vec<(String, Option<String>)> {
    list.iter()
        .map(|e| (e.kind.clone(), e.date.clone()))
        .collect()
}
fn pair(kind: &str, date: &str) -> (String, Option<String>) {
    (kind.into(), Some(date.into()))
}

#[test]
fn ac38_effective_events_follow_every_correction_delete_and_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = save(&mut s, None, "虚构相机", Some("100000"), Some("2026-09-01"));
    let a = maintain(
        &mut s,
        &a,
        maintenance::Action::Add {
            fields: maintenance_fields(Some("2026-09-03"), "20000", "换快门"),
            photos: empty(),
        },
    );
    let a = maintain(
        &mut s,
        &a,
        maintenance::Action::Add {
            fields: maintenance_fields(None, "5000", "清洁"),
            photos: empty(),
        },
    );
    let a = warrant(
        &mut s,
        &a,
        warranty::Action::Add {
            fields: warranty_fields("2026-09-05"),
            photos: empty(),
        },
    );
    let a = warrant(
        &mut s,
        &a,
        warranty::Action::Add {
            fields: warranty_fields("2026-12-31"),
            photos: empty(),
        },
    );
    let a = s
        .change_lifecycle(
            &lifecycle::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: a.asset.revision,
                action: lifecycle::Action::Append {
                    kind: lifecycle::Kind::Retire,
                    date: "2026-09-06".into(),
                    notes: "收起".into(),
                },
            },
            TODAY,
        )
        .unwrap();
    let a = sale(
        &mut s,
        &a,
        sales::Action::Sell {
            fields: sales::Fields {
                date: "2026-09-10".into(),
                price_cents: "30000".into(),
                platform: "虚构平台".into(),
                buyer: String::new(),
                notes: String::new(),
            },
        },
    );
    let b = save(&mut s, None, "旧物补录", None, None);

    let (dated, undated) = events(&s, "all", None);
    assert_eq!(
        shape(&dated),
        [
            pair("sale", "2026-09-10"),
            pair("retire", "2026-09-06"),
            pair("warranty_end", "2026-09-05"),
            pair("maintenance", "2026-09-03"),
            pair("warranty_start", "2026-09-01"),
            pair("warranty_start", "2026-09-01"),
            pair("purchase", "2026-09-01"),
        ],
        "business dates, not record creation; future expiry is not an event yet"
    );
    assert_eq!(
        dated.last().unwrap().amount_cents.as_deref(),
        Some("100000")
    );
    let mut pending: Vec<_> = undated
        .iter()
        .map(|e| (e.kind.as_str(), e.title.as_str()))
        .collect();
    pending.sort();
    assert_eq!(
        pending,
        [("maintenance", "虚构相机"), ("purchase", "旧物补录")]
    );
    // Single-asset view is the same projection narrowed by id.
    let (only_a, only_a_undated) = events(&s, "all", Some(&a));
    assert_eq!(only_a, dated);
    assert_eq!(only_a_undated.len(), 1);
    assert_eq!(events(&s, "all", Some(&b)).1.len(), 1);
    // Filters.
    assert_eq!(
        events(&s, "purchase", None).0.len() + events(&s, "purchase", None).1.len(),
        2
    );
    assert_eq!(
        shape(&events(&s, "lifecycle", None).0),
        [pair("sale", "2026-09-10"), pair("retire", "2026-09-06")]
    );
    assert_eq!(events(&s, "warranty", None).0.len(), 3);
    assert_eq!(events(&s, "maintenance", None).0.len(), 1);
    assert!(s
        .timeline(
            &Query {
                filter: "bogus".into(),
                asset_id: None
            },
            TODAY
        )
        .is_err());

    // AC24: revoking the sale removes the sale fact, purchase stays single.
    let sale_id = a.sale.as_ref().unwrap().id.clone();
    let a = sale(&mut s, &a, sales::Action::Revoke { sale_id });
    assert!(!events(&s, "all", Some(&a))
        .0
        .iter()
        .any(|e| e.kind == "sale"));
    // AC07: correcting the purchase date moves the one purchase event.
    let a = save(
        &mut s,
        Some(&a),
        "虚构相机",
        Some("100000"),
        Some("2026-08-30"),
    );
    let purchases: Vec<_> = events(&s, "purchase", Some(&a)).0;
    assert_eq!(shape(&purchases), [pair("purchase", "2026-08-30")]);
    // AC11: maintenance correction updates in place; delete/restore toggles it once.
    let dated_m = a
        .maintenances
        .iter()
        .find(|m| m.fields.date.is_some())
        .unwrap()
        .id
        .clone();
    let a = maintain(
        &mut s,
        &a,
        maintenance::Action::Correct {
            maintenance_id: dated_m.clone(),
            fields: maintenance_fields(Some("2026-09-04"), "25000", "换快门"),
            photos: empty(),
        },
    );
    let m = events(&s, "maintenance", Some(&a)).0;
    assert_eq!(
        (m.len(), m[0].date.as_deref(), m[0].amount_cents.as_deref()),
        (1, Some("2026-09-04"), Some("25000"))
    );
    let rc = |s: &Store, a: &AssetRecord, deleted| RecordChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        record_id: dated_m.clone(),
        kind: "maintenance".into(),
        expected_revision: a.asset.revision,
        deleted,
    };
    let a = s.change_record_trash(&rc(&s, &a, true), TODAY).unwrap();
    assert!(events(&s, "maintenance", Some(&a)).0.is_empty());
    let a = s.change_record_trash(&rc(&s, &a, false), TODAY).unwrap();
    assert_eq!(events(&s, "maintenance", Some(&a)).0.len(), 1);
    // AC15: moving the expiry into the future removes the expiry event; repeated reads never add copies.
    let short = a
        .warranties
        .iter()
        .find(|w| w.fields.end_date.as_deref() == Some("2026-09-05"))
        .unwrap()
        .id
        .clone();
    let a = warrant(
        &mut s,
        &a,
        warranty::Action::Correct {
            warranty_id: short,
            fields: warranty_fields("2026-12-01"),
            photos: empty(),
        },
    );
    for _ in 0..3 {
        assert!(!events(&s, "warranty", Some(&a))
            .0
            .iter()
            .any(|e| e.kind == "warranty_end"));
    }
    // AC28: deleting the asset hides all its facts; restore brings back exactly the same set.
    let before = events(&s, "all", None);
    let deleted = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            deleted: true,
        })
        .unwrap();
    let (gone, gone_undated) = events(&s, "all", None);
    assert!(gone
        .iter()
        .chain(&gone_undated)
        .all(|e| e.asset_id.as_deref() != Some(a.asset.id.as_str())));
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: deleted.asset.revision,
        deleted: false,
    })
    .unwrap();
    assert_eq!(events(&s, "all", None), before);
    drop(s);
    let reopened = Store::open(root.path()).unwrap();
    assert_eq!(
        events(&reopened, "all", None),
        before,
        "nothing is stored, so restarts cannot duplicate"
    );
}

#[test]
fn ac18_wish_realization_is_one_purchase_not_two() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let add = |s: &mut Store, name: &str| {
        s.change_wishlist(&wishlist::Change {
            request_id: id(),
            generation: s.generation(),
            expected_revision: None,
            action: wishlist::Action::Add {
                fields: wishlist::Fields {
                    name: name.into(),
                    category_id: None,
                    estimated_price_cents: Some("150000".into()),
                    priority: None,
                    target_date: None,
                    external_link: String::new(),
                    notes: String::new(),
                },
                cover: empty(),
            },
        })
        .unwrap()
    };
    let wish = add(&mut s, "虚构耳机心愿");
    let dropped = add(&mut s, "放弃的心愿");
    s.change_wishlist(&wishlist::Change {
        request_id: id(),
        generation: s.generation(),
        expected_revision: Some(dropped.revision),
        action: wishlist::Action::Abandon {
            wishlist_id: dropped.id.clone(),
        },
    })
    .unwrap();
    let asset = s
        .convert_wishlist(
            &Convert {
                wishlist_id: wish.id.clone(),
                expected_revision: wish.revision,
                asset: SaveAsset {
                    options: None,
                    base: Save {
                        request_id: id(),
                        generation: s.generation(),
                        asset_id: None,
                        expected_revision: None,
                        name: "虚构耳机".into(),
                        price_cents: Some("120000".into()),
                        purchase_date: Some("2026-09-08".into()),
                    },
                    details: Details::default(),
                    photos: None,
                    classification: None,
                },
            },
            TODAY,
        )
        .unwrap();
    let other = save(&mut s, None, "普通购买", Some("1000"), Some("2026-09-09"));

    let (all, _) = events(&s, "all", None);
    let purchases: Vec<_> = all.iter().filter(|e| e.kind == "purchase").collect();
    assert_eq!(purchases.len(), 2, "one purchase per live asset");
    let realized = purchases
        .iter()
        .find(|e| e.asset_id.as_deref() == Some(asset.asset.id.as_str()))
        .unwrap();
    assert_eq!(
        (
            realized.wishlist_id.as_deref(),
            realized.note.as_str(),
            realized.amount_cents.as_deref()
        ),
        (Some(wish.id.as_str()), "虚构耳机心愿", Some("120000"))
    );
    let local_day = chrono::DateTime::parse_from_rfc3339(&wish.created_at)
        .unwrap()
        .with_timezone(&chrono::Local)
        .format("%Y-%m-%d")
        .to_string();
    assert!(all.iter().any(|e| e.kind == "wish_added"
        && e.wishlist_id.as_deref() == Some(wish.id.as_str())
        && e.date.as_deref() == Some(local_day.as_str())));
    let (wishes, _) = events(&s, "wishlist", None);
    let mut kinds: Vec<_> = wishes.iter().map(|e| e.kind.as_str()).collect();
    kinds.sort();
    assert_eq!(
        kinds,
        ["purchase", "wish_abandoned", "wish_added", "wish_added"],
        "ordinary purchases stay out of the wishlist view"
    );
    assert!(!wishes
        .iter()
        .any(|e| e.asset_id.as_deref() == Some(other.asset.id.as_str())));
    // Deleting the converted asset hides the purchase but the wish history remains.
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: asset.asset.id.clone(),
        expected_revision: asset.asset.revision,
        deleted: true,
    })
    .unwrap();
    let (after, _) = events(&s, "all", None);
    assert_eq!(after.iter().filter(|e| e.kind == "purchase").count(), 1);
    assert!(after
        .iter()
        .any(|e| e.kind == "wish_added" && e.wishlist_id.as_deref() == Some(wish.id.as_str())));
}
