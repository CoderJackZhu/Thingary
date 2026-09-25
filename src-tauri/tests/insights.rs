use possio_lib::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::Save,
    lifecycle,
    photos::Selection,
    sales,
    storage::Store,
    taxonomy::Classification,
    trash::TrashChange,
    wishlist,
};

const TODAY: &str = "2026-09-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn asset(
    s: &mut Store,
    name: &str,
    category: Option<&str>,
    price: Option<&str>,
    date: Option<&str>,
) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: price.map(str::to_owned),
                purchase_date: date.map(str::to_owned),
            },
            details: Details::default(),
            photos: None,
            classification: Some(Classification {
                category_id: category.map(str::to_owned),
                channel_id: None,
            }),
        },
        TODAY,
    )
    .unwrap()
}

#[test]
fn ac35_held_and_history_scopes_count_unknowns_and_exclude_deleted() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let cats = s.taxonomy_snapshot().unwrap().categories;
    let (c1, c2) = (
        cats[0].id.as_str().to_owned(),
        cats[1].id.as_str().to_owned(),
    );
    // Independent sample, TODAY 2026-09-10:
    // A active c1 ¥1,000 09-01 (10 d) · B retired c1 price? 08-31 (11 d) · C active c2 ¥500 date?
    // D sold c2 ¥2,000 · E active uncategorized ¥0 09-10 (1 d) · F deleted c1 ¥9,999.
    asset(&mut s, "A", Some(&c1), Some("100000"), Some("2026-09-01"));
    let b = asset(&mut s, "B", Some(&c1), None, Some("2026-08-31"));
    s.change_lifecycle(
        &lifecycle::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: b.asset.id.clone(),
            expected_revision: b.asset.revision,
            action: lifecycle::Action::Append {
                kind: lifecycle::Kind::Retire,
                date: "2026-09-02".into(),
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap();
    asset(&mut s, "C", Some(&c2), Some("50000"), None);
    let d = asset(&mut s, "D", Some(&c2), Some("200000"), Some("2026-09-01"));
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: d.asset.id.clone(),
            expected_revision: d.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-09-05".into(),
                    price_cents: "150000".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    asset(&mut s, "E", None, Some("0"), Some("2026-09-10"));
    let f = asset(&mut s, "F", Some(&c1), Some("999900"), Some("2026-09-01"));
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: f.asset.id.clone(),
        expected_revision: f.asset.revision,
        deleted: true,
    })
    .unwrap();
    for (name, abandon) in [("W1", false), ("W2", false), ("W3", true)] {
        let w = s
            .change_wishlist(&wishlist::Change {
                request_id: id(),
                generation: s.generation(),
                expected_revision: None,
                action: wishlist::Action::Add {
                    fields: wishlist::Fields {
                        name: name.into(),
                        category_id: None,
                        estimated_price_cents: None,
                        priority: None,
                        target_date: None,
                        external_link: String::new(),
                        notes: String::new(),
                    },
                    cover: Selection {
                        ids: vec![],
                        cover_id: None,
                    },
                },
            })
            .unwrap();
        if abandon {
            s.change_wishlist(&wishlist::Change {
                request_id: id(),
                generation: s.generation(),
                expected_revision: Some(w.revision),
                action: wishlist::Action::Abandon { wishlist_id: w.id },
            })
            .unwrap();
        }
    }

    let o = s.overview("held", TODAY).unwrap();
    assert_eq!(
        (o.held_count, o.active_count, o.retired_count, o.sold_count),
        (4, 3, 1, 1)
    );
    assert_eq!(
        (o.held_known_cents.as_str(), o.held_unknown_price_count),
        ("150000", 1)
    );
    assert_eq!(
        (
            o.history_known_cents.as_str(),
            o.history_unknown_price_count
        ),
        ("350000", 1)
    );
    assert_eq!(
        (o.average_holding_days, o.held_unknown_date_count),
        (Some(7), 1),
        "(10+11+1)/3, C excluded"
    );
    assert_eq!(o.ongoing_wishes, 2);
    let held: Vec<_> = o
        .categories
        .iter()
        .map(|c| {
            (
                c.id.clone(),
                c.count,
                c.known_cents.as_str(),
                c.unknown_price_count,
            )
        })
        .collect();
    assert_eq!(
        held,
        [
            (Some(c1.clone()), 2, "100000", 1),
            (Some(c2.clone()), 1, "50000", 0),
            (None, 1, "0", 0)
        ]
    );
    assert_eq!(
        o.categories.iter().map(|c| c.count).sum::<i64>(),
        o.held_count
    );
    // Recent events are the newest effective timeline facts (wishes carry the real clock date).
    assert!(o.recent.len() == 8 && o.recent.windows(2).all(|w| w[0].date >= w[1].date));
    assert!(o
        .recent
        .iter()
        .any(|e| e.kind == "sale" && e.date.as_deref() == Some("2026-09-05")));
    assert!(o
        .recent
        .iter()
        .all(|e| e.asset_id.as_deref() != Some(f.asset.id.as_str())));

    let h = s.overview("history", TODAY).unwrap();
    let c2_history = h
        .categories
        .iter()
        .find(|c| c.id.as_deref() == Some(c2.as_str()))
        .unwrap();
    assert_eq!(
        (c2_history.count, c2_history.known_cents.as_str()),
        (2, "250000"),
        "sold D counts in history only"
    );
    assert_eq!(h.categories.iter().map(|c| c.count).sum::<i64>(), 5);
    assert!(s.overview("bogus", TODAY).is_err());

    // Empty library: no division, no invented averages.
    let empty = tempfile::tempdir().unwrap();
    let e = Store::open(empty.path())
        .unwrap()
        .overview("held", TODAY)
        .unwrap();
    assert_eq!(
        (e.held_count, e.average_holding_days, e.categories.len()),
        (0, None, 0)
    );
}

#[test]
fn category_color_slot_is_stable_across_scopes() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let cats = s.taxonomy_snapshot().unwrap().categories;
    // Only the 2nd and 4th default categories hold assets: they get slots 0 and 1.
    asset(
        &mut s,
        "held",
        Some(&cats[3].id),
        Some("100"),
        Some("2026-09-01"),
    );
    let sold = asset(
        &mut s,
        "sold",
        Some(&cats[1].id),
        Some("100"),
        Some("2026-09-01"),
    );
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: sold.asset.id.clone(),
            expected_revision: sold.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-09-02".into(),
                    price_cents: "1".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    asset(&mut s, "loose", None, None, None);
    let slot = |scope: &str, id: Option<&str>| {
        s.overview(scope, TODAY)
            .unwrap()
            .categories
            .into_iter()
            .find(|c| c.id.as_deref() == id)
            .map(|c| c.slot)
    };
    assert_eq!(slot("held", Some(&cats[3].id)), Some(Some(1)));
    assert_eq!(
        slot("history", Some(&cats[3].id)),
        Some(Some(1)),
        "switching scope never repaints"
    );
    assert_eq!(slot("history", Some(&cats[1].id)), Some(Some(0)));
    assert_eq!(slot("held", None), Some(None));
}
