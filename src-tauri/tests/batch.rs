//! D19 batch operations: one transaction, single-item rules, one undo that
//! skips items changed since.
use possio_lib::{
    batch::{Change, Item, Undo},
    catalog::{AssetRecord, Details, Query, SaveAsset},
    domain::Save,
    preferences::Exclusions,
    storage::Store,
    taxonomy::CategoryFilter,
};
const TODAY: &str = "2026-09-28";
fn rid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn asset(s: &mut Store, name: &str) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: rid(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some("100000".into()),
                purchase_date: Some("2026-09-01".into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn item(s: &Store, id: &str) -> Item {
    Item {
        asset_id: id.into(),
        expected_revision: s.record(id).unwrap().unwrap().asset.revision,
        category_id: None,
        channel_id: None,
        label_id: None,
        exclude: None,
        date: None,
        warranty: None,
        sale: None,
    }
}
fn change(s: &Store, action: &str, items: Vec<Item>) -> Change {
    Change {
        request_id: rid(),
        generation: s.generation(),
        action: action.into(),
        items,
    }
}
fn undo(s: &mut Store, batch: &Change) -> possio_lib::batch::Outcome {
    s.batch_undo(&Undo {
        request_id: rid(),
        generation: s.generation(),
        batch_request_id: batch.request_id.clone(),
    })
    .unwrap()
}

#[test]
fn classify_sets_per_item_values_keeps_the_rest_and_undoes_as_one() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let cats = s.taxonomy_snapshot().unwrap().categories;
    let (a, b, c) = (
        asset(&mut s, "虚构甲"),
        asset(&mut s, "虚构乙"),
        asset(&mut s, "虚构丙"),
    );
    let mut ia = item(&s, &a.asset.id);
    ia.category_id = Some(Some(cats[0].id.clone()));
    let mut ib = item(&s, &b.asset.id);
    ib.category_id = Some(Some(cats[1].id.clone()));
    let ic = item(&s, &c.asset.id); // keep
    let batch = change(&s, "classify", vec![ia, ib, ic]);
    assert_eq!(s.batch_change(&batch, TODAY).unwrap().changed, 3);
    assert_eq!(
        s.batch_change(&batch, TODAY).unwrap().changed,
        3,
        "replay returns the receipt"
    );
    let cat = |s: &Store, id: &str| s.record(id).unwrap().unwrap().classification.category_id;
    assert_eq!(cat(&s, &a.asset.id).as_deref(), Some(cats[0].id.as_str()));
    assert_eq!(cat(&s, &b.asset.id).as_deref(), Some(cats[1].id.as_str()));
    assert_eq!(cat(&s, &c.asset.id), None);

    // b is edited again afterwards: undo restores a and c, skips b.
    let mut again = item(&s, &b.asset.id);
    again.category_id = Some(None);
    s.batch_change(&change(&s, "classify", vec![again]), TODAY)
        .unwrap();
    let out = undo(&mut s, &batch);
    assert_eq!((out.changed, out.skipped), (2, 1));
    assert_eq!(cat(&s, &a.asset.id), None);
    assert_eq!(cat(&s, &b.asset.id), None, "b keeps its later edit");
}

#[test]
fn one_invalid_item_saves_nothing_and_names_the_item() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (a, b) = (asset(&mut s, "虚构甲"), asset(&mut s, "虚构乙"));
    let mut ia = item(&s, &a.asset.id);
    ia.date = Some("2026-09-10".into());
    let mut ib = item(&s, &b.asset.id);
    ib.date = Some("2026-08-01".into()); // before purchase
    let err = s
        .batch_change(&change(&s, "retire", vec![ia, ib]), TODAY)
        .unwrap_err();
    assert_eq!(err.code, "DATE_CONFLICT");
    assert!(err.message.contains("虚构乙"));
    assert!(
        s.record(&a.asset.id)
            .unwrap()
            .unwrap()
            .lifecycle
            .events
            .is_empty(),
        "all or nothing"
    );

    let stale = Item {
        expected_revision: 99,
        ..item(&s, &a.asset.id)
    };
    assert_eq!(
        s.batch_change(&change(&s, "delete", vec![stale]), TODAY)
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
}

#[test]
fn retire_labels_exclusions_and_delete_undo_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (a, b) = (asset(&mut s, "虚构甲"), asset(&mut s, "虚构乙"));
    let dated = |s: &Store, id: &str, d: &str| Item {
        date: Some(d.into()),
        ..item(s, id)
    };
    let retire = change(
        &s,
        "retire",
        vec![
            dated(&s, &a.asset.id, "2026-09-20"),
            dated(&s, &b.asset.id, "2026-09-28"),
        ],
    );
    s.batch_change(&retire, TODAY).unwrap();
    let state = |s: &Store, id: &str| s.record(id).unwrap().unwrap().lifecycle;
    assert_eq!(state(&s, &a.asset.id).events[0].date, "2026-09-20");
    assert_eq!(undo(&mut s, &retire).changed, 2);
    assert!(state(&s, &a.asset.id).events.is_empty());
    assert_eq!(
        state(&s, &a.asset.id).state,
        possio_lib::lifecycle::State::Active
    );

    let label = s.choices("label").unwrap().items[0].id.clone();
    let tagged = change(
        &s,
        "label",
        vec![Item {
            label_id: Some(Some(label.clone())),
            ..item(&s, &a.asset.id)
        }],
    );
    s.batch_change(&tagged, TODAY).unwrap();
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().preferences.label_id,
        Some(label)
    );
    let excluded = change(
        &s,
        "exclude",
        vec![Item {
            exclude: Some(Exclusions {
                total: true,
                ..Default::default()
            }),
            ..item(&s, &b.asset.id)
        }],
    );
    s.batch_change(&excluded, TODAY).unwrap();
    assert!(
        s.record(&b.asset.id)
            .unwrap()
            .unwrap()
            .preferences
            .exclude
            .total
    );
    assert_eq!(undo(&mut s, &excluded).changed, 1);
    assert!(
        !s.record(&b.asset.id)
            .unwrap()
            .unwrap()
            .preferences
            .exclude
            .total
    );

    let delete = change(
        &s,
        "delete",
        vec![item(&s, &a.asset.id), item(&s, &b.asset.id)],
    );
    s.batch_change(&delete, TODAY).unwrap();
    assert!(s.record(&a.asset.id).unwrap().unwrap().deleted);
    assert_eq!(undo(&mut s, &delete).changed, 2);
    assert!(!s.record(&b.asset.id).unwrap().unwrap().deleted);
}

#[test]
fn select_all_reaches_every_match_beyond_one_page() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    for i in 0..105 {
        asset(&mut s, &format!("虚构批量 {i}"));
    }
    asset(&mut s, "别的东西");
    let q = Query {
        search: "批量".into(),
        filter: "all".into(),
        sort: "name".into(),
        descending: false,
        offset: 0,
        category: CategoryFilter::All,
        warranty: String::new(),
    };
    assert_eq!(s.query_assets(&q, TODAY).unwrap().items.len(), 100);
    let ids = s.query_asset_ids(&q, TODAY).unwrap();
    assert_eq!(ids.len(), 105);
    let rows = s.batch_rows(&ids[..3]).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].price_cents.as_deref(), Some("100000"));
}

#[test]
fn batch_warranty_and_sale_undo_and_keep_backups_valid() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (a, b) = (asset(&mut s, "虚构甲"), asset(&mut s, "虚构乙"));
    let warranty = |start: &str| possio_lib::warranty::Fields {
        kind: "manufacturer".into(),
        provider: String::new(),
        start_date: Some(start.into()),
        end_date: Some("2027-09-01".into()),
        notes: String::new(),
    };
    let covered = change(
        &s,
        "warranty",
        vec![
            Item {
                warranty: Some(warranty("2026-09-01")),
                ..item(&s, &a.asset.id)
            },
            Item {
                warranty: Some(warranty("2026-09-01")),
                ..item(&s, &b.asset.id)
            },
        ],
    );
    s.batch_change(&covered, TODAY).unwrap();
    assert_eq!(s.record(&a.asset.id).unwrap().unwrap().warranties.len(), 1);

    let sale = |price: &str| possio_lib::sales::Fields {
        date: "2026-09-20".into(),
        price_cents: price.into(),
        platform: "虚构回收商".into(),
        buyer: String::new(),
        notes: String::new(),
    };
    let sold = change(
        &s,
        "sell",
        vec![
            Item {
                sale: Some(sale("30000")),
                ..item(&s, &a.asset.id)
            },
            Item {
                sale: Some(sale("0")),
                ..item(&s, &b.asset.id)
            },
        ],
    );
    s.batch_change(&sold, TODAY).unwrap();
    let rec = s.record(&a.asset.id).unwrap().unwrap();
    assert_eq!(rec.lifecycle.state, possio_lib::lifecycle::State::Sold);
    assert_eq!(rec.sale.unwrap().fields.price_cents, "30000");

    // A library holding batch sales and warranties passes backup validation.
    let file = dir.path().join("批量.possio");
    s.backup(Some(&file)).unwrap();
    assert_eq!(s.inspect_backup(&file).unwrap().assets, 2);

    assert_eq!(undo(&mut s, &sold).changed, 2);
    let rec = s.record(&b.asset.id).unwrap().unwrap();
    assert!(rec.sale.is_none());
    assert_eq!(rec.lifecycle.state, possio_lib::lifecycle::State::Active);
    // Undoing the older warranty batch now skips: the sale undo moved revisions on.
    assert_eq!(undo(&mut s, &covered).skipped, 2);

    let late = change(
        &s,
        "sell",
        vec![Item {
            sale: Some(possio_lib::sales::Fields {
                date: "2026-08-01".into(),
                ..sale("1")
            }),
            ..item(&s, &a.asset.id)
        }],
    );
    assert_eq!(
        s.batch_change(&late, TODAY).unwrap_err().code,
        "DATE_CONFLICT"
    );
}
