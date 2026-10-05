use thingary_lib::{
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
            options: None,
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
    assert_eq!(o.considering_wishes, 2);
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

    let all = s.stats_snapshot("all", TODAY).unwrap();
    assert_eq!((all.total, all.active, all.retired, all.sold), (5, 3, 1, 1));
    assert_eq!(
        (all.known_cents.as_str(), all.unknown_price_count),
        ("350000", 1)
    );
    assert_eq!(
        (
            all.sale_proceeds_cents.as_str(),
            all.sold_purchase_cents.as_str()
        ),
        ("150000", "200000")
    );
    assert_eq!(
        all.categories.iter().map(|c| c.count).sum::<i64>(),
        all.total
    );
    let month = s.stats_snapshot("month", TODAY).unwrap();
    assert_eq!((month.total, month.known_cents.as_str()), (3, "300000"));
    assert_eq!(month.start.as_deref(), Some("2026-09-01"));
    let week = s.stats_snapshot("week", TODAY).unwrap();
    assert_eq!((week.total, week.known_cents.as_str()), (1, "0"));
    assert_eq!(week.start.as_deref(), Some("2026-09-07"));
    assert!(s.stats_snapshot("bogus", TODAY).is_err());

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

#[test]
fn ac36_trend_buckets_are_inclusive_continuous_and_never_reduced_by_sales() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let today = "2026-01-15";
    let add = |s: &mut Store, name: &str, price: Option<&str>, date: Option<&str>| {
        s.save_asset(
            &SaveAsset {
                options: None,
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
                classification: None,
            },
            today,
        )
        .unwrap()
    };
    add(&mut s, "leap", Some("1000"), Some("2024-02-29"));
    add(&mut s, "q3-end", Some("2000"), Some("2025-09-30"));
    add(&mut s, "q4-start", None, Some("2025-10-01"));
    let sold = add(&mut s, "year-end", Some("4000"), Some("2025-12-31"));
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: sold.asset.id.clone(),
            expected_revision: sold.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-01-02".into(),
                    price_cents: "9999".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        today,
    )
    .unwrap();
    add(&mut s, "new-year", Some("8000"), Some("2026-01-01"));
    add(&mut s, "undated", Some("500"), None);
    let gone = add(&mut s, "deleted", Some("70000"), Some("2025-12-31"));
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: gone.asset.id.clone(),
        expected_revision: gone.asset.revision,
        deleted: true,
    })
    .unwrap();

    let year = s.purchase_trend("year", today).unwrap();
    let rows: Vec<_> = year
        .buckets
        .iter()
        .map(|b| {
            (
                b.key.as_str(),
                b.start.as_str(),
                b.end.as_str(),
                b.count,
                b.known_cents.as_str(),
                b.cumulative_cents.as_str(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("2024", "2024-01-01", "2024-12-31", 1, "1000", "1000"),
            ("2025", "2025-01-01", "2025-12-31", 3, "6000", "7000"),
            ("2026", "2026-01-01", "2026-12-31", 1, "8000", "15000")
        ]
    );
    assert_eq!(
        (
            year.unknown_price_count,
            year.unknown_date_count,
            year.unknown_date_known_cents.as_str(),
            year.known_cents.as_str()
        ),
        (1, 1, "500", "15000")
    );

    let quarter = s.purchase_trend("quarter", today).unwrap();
    assert_eq!(
        quarter.buckets.len(),
        9,
        "2024-Q1 … 2026-Q1 with empty quarters kept"
    );
    let q = |k: &str| quarter.buckets.iter().find(|b| b.key == k).unwrap().clone();
    assert_eq!(
        (q("2024-Q1").end.as_str(), q("2024-Q1").count),
        ("2024-03-31", 1)
    );
    assert_eq!(
        (
            q("2025-Q3").count,
            q("2025-Q4").count,
            q("2025-Q4").unknown_price_count
        ),
        (1, 2, 1)
    );
    assert_eq!(
        (q("2025-Q2").count, q("2025-Q2").cumulative_cents.as_str()),
        (0, "1000")
    );

    let month = s.purchase_trend("month", today).unwrap();
    let m = |k: &str| month.buckets.iter().find(|b| b.key == k).unwrap().clone();
    assert_eq!(
        (m("2024-02").end.as_str(), m("2024-02").count),
        ("2024-02-29", 1),
        "leap day stays in February"
    );
    assert_eq!(
        (
            m("2025-09").end.as_str(),
            m("2025-09").count,
            m("2025-10").count
        ),
        ("2025-09-30", 1, 1)
    );
    assert_eq!(month.buckets.first().unwrap().key, "2024-02");
    assert_eq!(month.buckets.last().unwrap().key, "2026-01");
    assert!(month
        .buckets
        .windows(2)
        .all(|w| w[0].cumulative_cents.parse::<i64>().unwrap()
            <= w[1].cumulative_cents.parse::<i64>().unwrap()));
    assert!(s.purchase_trend("week", today).is_err());
    let empty = tempfile::tempdir().unwrap();
    assert!(Store::open(empty.path())
        .unwrap()
        .purchase_trend("month", today)
        .unwrap()
        .buckets
        .is_empty());
}

fn dated(
    s: &mut Store,
    name: &str,
    price: Option<&str>,
    date: Option<&str>,
    today: &str,
) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
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
            classification: None,
        },
        today,
    )
    .unwrap()
}

#[test]
fn e06_e07_holding_groups_use_natural_anniversaries_with_month_end() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    dated(
        &mut s,
        "leap",
        Some("100"),
        Some("2024-02-29"),
        "2025-02-28",
    );
    let h = s.holding("held", "2025-02-28").unwrap();
    assert_eq!(
        h.groups.iter().find(|g| g.key == "1to2y").unwrap().count,
        1,
        "E06: 2024-02-29 reaches one year on 2025-02-28"
    );
    assert_eq!(
        h.longest.unwrap().held_days,
        366,
        "inclusive days computed separately, not 12×30"
    );
    let h = s.holding("held", "2025-02-27").unwrap();
    assert_eq!(
        h.groups.iter().find(|g| g.key == "6to12m").unwrap().count,
        1,
        "one day earlier stays below a year"
    );

    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    dated(
        &mut s,
        "month-end",
        Some("100"),
        Some("2025-08-31"),
        "2026-02-28",
    );
    assert_eq!(
        s.holding("held", "2026-02-28").unwrap().groups[2].count,
        1,
        "E07: 08-31 + 6 months = 02-28"
    );
    assert_eq!(
        s.holding("held", "2026-02-27").unwrap().groups[1].count,
        1,
        "left-closed: still under 6 months the day before"
    );
}

#[test]
fn holding_statistics_and_exact_daily_rankings_from_an_independent_sample() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let today = "2026-09-10";
    // Held: A ¥10.00 over 3 days = 333.33…¢/day; B ¥3.33 over 1 day = 333¢/day.
    // Both round to ¥3.33, but A must rank above B on the exact ratio.
    let a = dated(&mut s, "A", Some("1000"), Some("2026-09-08"), today);
    let b = dated(&mut s, "B", Some("333"), Some("2026-09-10"), today);
    // C: held 2 years+ (2024-09-01 → 2026-09-10 = 740 days), ¥7,400 → ¥10/day.
    dated(&mut s, "C", Some("740000"), Some("2024-09-01"), today);
    // D: sold with profit — ¥1,000, sold ¥1,500 after 10 days → net −¥500, −¥50/day.
    let d = dated(&mut s, "D", Some("100000"), Some("2026-08-01"), today);
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: d.asset.id.clone(),
            expected_revision: d.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-08-10".into(),
                    price_cents: "150000".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        today,
    )
    .unwrap();
    // E: sold at a loss — ¥2,000 over 20 days, sold ¥1,000 → ¥50/day.
    let e = dated(&mut s, "E", Some("200000"), Some("2026-07-01"), today);
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: e.asset.id.clone(),
            expected_revision: e.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-07-20".into(),
                    price_cents: "100000".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        today,
    )
    .unwrap();
    dated(&mut s, "no-price", None, Some("2026-01-01"), today);
    dated(&mut s, "no-date", Some("100"), None, today);

    let h = s.holding("held", today).unwrap();
    let held: Vec<_> = h
        .held_ranking
        .iter()
        .map(|r| {
            (
                r.name.as_str(),
                r.held_days,
                r.cost_cents.as_str(),
                r.daily_cents.as_str(),
            )
        })
        .collect();
    assert_eq!(
        held,
        [
            ("C", 740, "740000", "1000"),
            ("A", 3, "1000", "333"),
            ("B", 1, "333", "333")
        ]
    );
    assert_eq!(
        (h.held_ranking[1].id.as_str(), h.held_ranking[2].id.as_str()),
        (a.asset.id.as_str(), b.asset.id.as_str())
    );
    let sold: Vec<_> = h
        .sold_ranking
        .iter()
        .map(|r| {
            (
                r.name.as_str(),
                r.held_days,
                r.cost_cents.as_str(),
                r.daily_cents.as_str(),
            )
        })
        .collect();
    assert_eq!(
        sold,
        [("E", 20, "100000", "5000"), ("D", 10, "-50000", "-5000")],
        "gross and net kept in separate lists"
    );
    let mut excluded: Vec<_> = h
        .excluded
        .iter()
        .map(|x| (x.name.as_str(), x.reason.as_str()))
        .collect();
    excluded.sort();
    assert_eq!(
        excluded,
        [("no-date", "购入日期未知"), ("no-price", "购入金额未知")]
    );

    // Held scope: A 3, B 1, C 740, no-price 253 (2026-01-01 → 09-10) days; no-date flagged.
    assert_eq!((h.dated_count, h.unknown_date_count), (4, 1));
    let counts: Vec<_> = h.groups.iter().map(|g| g.count).collect();
    assert_eq!(
        counts,
        [2, 0, 1, 0, 1, 0],
        "A,B <3m; no-price 8 months; C 2 years"
    );
    assert_eq!(h.average_days, Some((3 + 1 + 740 + 253) as f64 / 4.0));
    assert_eq!(h.median_days, Some((3 + 253) as f64 / 2.0));
    assert_eq!(
        h.longest.as_ref().map(|l| (l.name.as_str(), l.held_days)),
        Some(("C", 740))
    );
    // History adds sold assets ending at their sale date: D 10, E 20 → odd count median.
    let all = s.holding("history", today).unwrap();
    assert_eq!(all.dated_count, 6);
    assert_eq!(all.median_days, Some((10 + 20) as f64 / 2.0));
    assert!(s.holding("bogus", today).is_err());
}

fn sell(s: &mut Store, record: &AssetRecord, price: &str) -> AssetRecord {
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: record.asset.id.clone(),
            expected_revision: record.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-09-05".into(),
                    price_cents: price.into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap()
}

fn excluded_from_statistics(s: &mut Store, record: &AssetRecord) {
    let mut options = thingary_lib::preferences::AssetOptions::default();
    options.preferences.exclude.statistics = true;
    s.save_asset(
        &SaveAsset {
            options: Some(options),
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: Some(record.asset.id.clone()),
                expected_revision: Some(record.asset.revision),
                name: record.asset.name.clone(),
                price_cents: record.asset.price_cents.clone(),
                purchase_date: record.asset.purchase_date.clone(),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap();
}

/// Resale sample (business rules: docs/PRODUCT_RULES.md): values are independent of the code.
#[test]
fn u19_resale_rate_matches_the_documented_sample() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let day = Some("2026-08-01");
    let a = asset(&mut s, "A 相机", None, Some("1000000"), day);
    let a = sell(&mut s, &a, "650000");
    let b = asset(&mut s, "B 耳机", None, Some("200000"), day);
    sell(&mut s, &b, "240000");
    let c = asset(&mut s, "C 键盘", None, Some("80000"), day);
    sell(&mut s, &c, "0");
    let d = asset(&mut s, "D 手机", None, None, day);
    sell(&mut s, &d, "100000");
    let e = asset(&mut s, "E 赠品", None, Some("0"), day);
    sell(&mut s, &e, "5000");
    let f = asset(&mut s, "F 不计入", None, Some("100000"), day);
    let f = sell(&mut s, &f, "90000");
    excluded_from_statistics(&mut s, &f);
    let g = asset(&mut s, "G 已删除", None, Some("100000"), day);
    let g = sell(&mut s, &g, "80000");
    s.change_trash(&TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: g.asset.id.clone(),
        expected_revision: g.asset.revision,
        deleted: true,
    })
    .unwrap();
    let h = asset(&mut s, "H 已撤销", None, Some("100000"), day);
    let h = sell(&mut s, &h, "70000");
    let sale_id = s.record(&h.asset.id).unwrap().unwrap().sale.unwrap().id;
    let h = s.record(&h.asset.id).unwrap().unwrap();
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: h.asset.id.clone(),
            expected_revision: h.asset.revision,
            action: sales::Action::Revoke { sale_id },
        },
        TODAY,
    )
    .unwrap();
    let i = asset(&mut s, "I 退役", None, Some("100000"), day);
    s.change_lifecycle(
        &lifecycle::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: i.asset.id.clone(),
            expected_revision: i.asset.revision,
            action: lifecycle::Action::Append {
                kind: lifecycle::Kind::Retire,
                date: "2026-09-02".into(),
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap();
    let _ = a;

    let r = s.resale_rate(TODAY).unwrap();
    assert_eq!(r.included_count, 3);
    assert_eq!(
        (
            r.total_purchase_cents.as_str(),
            r.total_sale_cents.as_str(),
            r.total_gain_cents.as_str()
        ),
        ("1280000", "890000", "-390000")
    );
    // (65 + 120 + 0) / 3 = 61.666…% → 61.67%; 890,000 / 1,280,000 = 69.53125% → 69.53%.
    assert_eq!(r.average_rate_hundredths, Some(6167));
    assert_eq!(r.weighted_rate_hundredths, Some(6953));
    let rows: Vec<_> = r
        .rows
        .iter()
        .map(|x| (x.name.as_str(), x.rate_hundredths, x.gain_cents.as_str()))
        .collect();
    assert_eq!(
        rows,
        [
            ("B 耳机", 12000, "40000"),
            ("A 相机", 6500, "-350000"),
            ("C 键盘", 0, "-80000")
        ]
    );
    let mut excluded: Vec<_> = r
        .excluded
        .iter()
        .map(|x| (x.name.as_str(), x.reason.as_str()))
        .collect();
    excluded.sort();
    assert_eq!(
        excluded,
        [
            ("D 手机", "购入金额未知"),
            ("E 赠品", "购入价为 ¥0，不计算")
        ]
    );

    // The recovery card shares the same eligible set (§3): 8,900 / 12,800, not 9,950 / 12,800.
    let all = s.stats_snapshot("all", TODAY).unwrap();
    assert_eq!(
        (
            all.sale_proceeds_cents.as_str(),
            all.sold_purchase_cents.as_str()
        ),
        ("890000", "1280000")
    );
    assert_eq!(
        (all.sold_unknown_price_count, all.sold_zero_price_count),
        (1, 1)
    );
    assert_eq!(all.sold, 5);
}

#[test]
fn u19_resale_rate_edges_ties_corrections_and_extremes() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let empty = s.resale_rate(TODAY).unwrap();
    assert_eq!(
        (empty.included_count, empty.average_rate_hundredths),
        (0, None)
    );
    assert_eq!(empty.weighted_rate_hundredths, None);
    assert_eq!(empty.total_gain_cents, "0");
    assert!(empty.rows.is_empty() && empty.excluded.is_empty());
    assert!(s.resale_rate("bogus").is_err());

    // Nothing rateable: no 0% and no division, only the reason list.
    let lone = asset(&mut s, "无购入价", None, None, Some("2026-08-01"));
    sell(&mut s, &lone, "1000");
    let none = s.resale_rate(TODAY).unwrap();
    assert_eq!(none.average_rate_hundredths, None);
    assert_eq!(none.excluded.len(), 1);

    // A ratio differing by one hundredth of a percent is ordered by the exact value.
    let x = asset(&mut s, "X", None, Some("1000"), Some("2026-08-01"));
    sell(&mut s, &x, "333");
    let y = asset(&mut s, "Y", None, Some("10000"), Some("2026-08-01"));
    sell(&mut s, &y, "3334");
    // Equal ratios fall back to the asset id; 1/3 rounds half up at the hundredth.
    let (p, q) = (
        asset(&mut s, "P", None, Some("300"), Some("2026-08-01")),
        asset(&mut s, "Q", None, Some("600"), Some("2026-08-01")),
    );
    sell(&mut s, &p, "100");
    sell(&mut s, &q, "200");
    let r = s.resale_rate(TODAY).unwrap();
    let names: Vec<_> = r.rows.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(names[0], "Y");
    assert_eq!(names[3], "X");
    assert_eq!(r.rows[1].rate_hundredths, 3333);
    assert_eq!(r.rows[1].rate_hundredths, r.rows[2].rate_hundredths);
    assert!(r.rows[1].id < r.rows[2].id);
    let (x_row, y_row) = (&r.rows[3], &r.rows[0]);
    assert_eq!((x_row.rate_hundredths, y_row.rate_hundredths), (3330, 3334));

    // Correcting the sale price moves the rate; a sale far above purchase is not capped.
    let record = s.record(&x.asset.id).unwrap().unwrap();
    let sale = record.sale.clone().unwrap();
    s.change_sale(
        &sales::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: x.asset.id.clone(),
            expected_revision: record.asset.revision,
            action: sales::Action::Correct {
                sale_id: sale.id,
                fields: sales::Fields {
                    price_cents: "5000".into(),
                    ..sale.fields
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let r = s.resale_rate(TODAY).unwrap();
    assert_eq!(r.rows[0].name, "X");
    assert_eq!(r.rows[0].rate_hundredths, 50000);

    // Extreme amounts stay exact and are returned as strings.
    let big = asset(&mut s, "极值", None, Some("1"), Some("2026-08-01"));
    sell(&mut s, &big, "99999999999");
    let r = s.resale_rate(TODAY).unwrap();
    assert_eq!(r.rows[0].name, "极值");
    assert_eq!(r.rows[0].rate_hundredths, 999_999_999_990_000);
    assert_eq!(r.rows[0].gain_cents, "99999999998");
}

#[test]
fn trend_ignores_purchase_dates_after_today_instead_of_building_endless_periods() {
    let root = tempfile::tempdir().unwrap();
    let s = Store::open(root.path()).unwrap();
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.path().join("active.json")).unwrap()).unwrap();
    let db = root
        .path()
        .join("datasets")
        .join(active["id"].as_str().unwrap())
        .join("data.sqlite");
    drop(s);
    {
        let raw = rusqlite::Connection::open(&db).unwrap();
        raw.execute(
            "INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES('11111111-1111-4111-8111-111111111111','损坏日期',100,'9999-12-31',1)",
            [],
        )
        .unwrap();
    }
    let s = Store::open(root.path()).unwrap();
    let trend = s.purchase_trend("month", "2026-10-02").unwrap();
    assert!(trend.buckets.is_empty());
    assert_eq!(trend.unknown_date_count, 1);
}

#[test]
fn overview_daily_cost_sums_held_records_with_independent_exclusions_and_maintenance() {
    use thingary_lib::{catalog::Query, maintenance};
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    for (name, price, date, prefs, retired, sale, maintenance_cost, deleted) in [
        (
            "active",
            Some("100000"),
            Some("2026-09-01"),
            serde_json::json!({}),
            None,
            None,
            None,
            false,
        ),
        (
            "retired",
            Some("200000"),
            Some("2026-09-06"),
            serde_json::json!({}),
            Some("2026-09-07"),
            None,
            None,
            false,
        ),
        (
            "zero",
            Some("0"),
            Some(TODAY),
            serde_json::json!({}),
            None,
            None,
            None,
            false,
        ),
        (
            "maintenance",
            Some("10000"),
            Some("2026-09-01"),
            serde_json::json!({}),
            None,
            None,
            Some(Some("3000")),
            false,
        ),
        (
            "unknown-price",
            None,
            Some(TODAY),
            serde_json::json!({}),
            None,
            None,
            None,
            false,
        ),
        (
            "unknown-date",
            Some("100"),
            None,
            serde_json::json!({}),
            None,
            None,
            None,
            false,
        ),
        (
            "unknown-maintenance",
            Some("100"),
            Some(TODAY),
            serde_json::json!({}),
            None,
            None,
            Some(None),
            false,
        ),
        (
            "per-use",
            Some("100000"),
            Some(TODAY),
            serde_json::json!({"cost_mode":"per_use","use_count":10}),
            None,
            None,
            None,
            false,
        ),
        (
            "excluded-daily",
            Some("100000"),
            Some(TODAY),
            serde_json::json!({"exclude":{"daily":true}}),
            None,
            None,
            None,
            false,
        ),
        (
            "excluded-other",
            Some("100"),
            Some(TODAY),
            serde_json::json!({"exclude":{"total":true,"statistics":true}}),
            None,
            None,
            None,
            false,
        ),
        (
            "sold",
            Some("200000"),
            Some("2026-09-01"),
            serde_json::json!({}),
            None,
            Some(
                serde_json::json!({"date":"2026-09-05","price_cents":"100","platform":"","buyer":"","notes":""}),
            ),
            None,
            false,
        ),
        (
            "deleted",
            Some("200000"),
            Some(TODAY),
            serde_json::json!({}),
            None,
            None,
            None,
            true,
        ),
    ] {
        let mut a = s.save_asset(&SaveAsset {
            options: Some(serde_json::from_value(serde_json::json!({"preferences":prefs,"warranty":null,"retired_date":retired,"sale":sale})).unwrap()),
            base: Save { request_id: id(), generation:s.generation(), asset_id:None, expected_revision:None, name:name.into(), price_cents:price.map(Into::into), purchase_date:date.map(Into::into) },
            details:Details::default(), photos:None, classification:None,
        }, TODAY).unwrap();
        if let Some(cost) = maintenance_cost {
            a = s
                .change_maintenance(
                    &maintenance::Change {
                        request_id: id(),
                        generation: s.generation(),
                        asset_id: a.asset.id.clone(),
                        expected_revision: a.asset.revision,
                        action: maintenance::Action::Add {
                            fields: maintenance::Fields {
                                date: Some(TODAY.into()),
                                kind: "upgrade".into(),
                                title: "虚构维护".into(),
                                description: String::new(),
                                cost_cents: cost.map(Into::into),
                                provider: String::new(),
                            },
                            photos: Selection {
                                ids: vec![],
                                cover_id: None,
                            },
                        },
                    },
                    TODAY,
                )
                .unwrap();
        }
        if deleted {
            s.change_trash(&TrashChange {
                request_id: id(),
                generation: s.generation(),
                asset_id: a.asset.id,
                expected_revision: a.asset.revision,
                deleted: true,
            })
            .unwrap();
        }
    }
    let q = Query {
        category: Default::default(),
        search: String::new(),
        filter: "all".into(),
        sort: "name".into(),
        descending: false,
        offset: 0,
        warranty: "all".into(),
        label: None,
    };
    let before = serde_json::to_value(s.query_assets(&q, TODAY).unwrap()).unwrap();
    for scope in ["held", "history"] {
        let daily = s.overview(scope, TODAY).unwrap().held_daily;
        assert_eq!(daily.known_cents.as_deref(), Some("51400"));
        assert_eq!(daily.included_count, 5);
        assert_eq!(daily.unknown_count, 3);
        assert_eq!(daily.per_use_count, 1);
        assert_eq!(daily.excluded_count, 1);
    }
    assert_eq!(
        serde_json::to_value(s.query_assets(&q, TODAY).unwrap()).unwrap(),
        before
    );
}

#[test]
fn overview_daily_cost_distinguishes_empty_unknown_and_known_zero() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    assert_eq!(
        s.overview("held", TODAY)
            .unwrap()
            .held_daily
            .known_cents
            .as_deref(),
        Some("0")
    );
    asset(&mut s, "unknown", None, None, Some(TODAY));
    let daily = s.overview("held", TODAY).unwrap().held_daily;
    assert_eq!(daily.known_cents, None);
    assert_eq!(daily.included_count, 0);
    assert_eq!(daily.unknown_count, 1);
    asset(&mut s, "zero", None, Some("0"), Some(TODAY));
    let daily = s.overview("held", TODAY).unwrap().held_daily;
    assert_eq!(daily.known_cents.as_deref(), Some("0"));
    assert_eq!(daily.included_count, 1);
    assert_eq!(daily.unknown_count, 1);
}
