use serde_json::{json, Value};
use std::io::Write;
use thingary_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, SaveAsset},
    domain::Save,
    lifecycle, maintenance,
    photos::Selection,
    sales,
    storage::{migrate_to, Store, SCHEMA},
    taxonomy::Classification,
    timeline,
    trash::{RecordChange, TrashChange, TrashQuery},
    warranty,
    wishlist::{self, Convert},
};

const TODAY: &str = "2026-09-20";
const PNG: &[u8] = include_bytes!("fixtures/camera.png");
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn photo(s: &Store, name: &str) -> Selection {
    let p = s.stage_photo(name, PNG, &s.generation(), None).unwrap();
    Selection {
        cover_id: Some(p.id.clone()),
        ids: vec![p.id],
    }
}
fn asset(s: &mut Store, name: &str, price: &str, photos: Option<Selection>) -> AssetRecord {
    let category = s.taxonomy_snapshot().unwrap().categories[2].id.clone();
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some(price.into()),
                purchase_date: Some("2026-09-01".into()),
            },
            details: Details {
                brand: "虚构品牌".into(),
                model: "M1".into(),
                serial_number: "SN-FAKE".into(),
                notes: "备注，含逗号\n换行".into(),
            },
            photos,
            classification: Some(Classification {
                category_id: Some(category),
                channel_id: None,
            }),
        },
        TODAY,
    )
    .unwrap()
}
fn wish(s: &mut Store, name: &str, cover: bool) -> wishlist::WishlistItem {
    let cover = if cover {
        photo(s, "心愿封面.png")
    } else {
        Selection {
            ids: vec![],
            cover_id: None,
        }
    };
    s.change_wishlist(&wishlist::Change {
        request_id: id(),
        generation: s.generation(),
        expected_revision: None,
        action: wishlist::Action::Add {
            fields: wishlist::Fields {
                name: name.into(),
                category_id: None,
                estimated_price_cents: Some("150000".into()),
                priority: Some("high".into()),
                target_date: Some("2099-01-01".into()),
                external_link: "https://example.com/fake".into(),
                notes: String::new(),
            },
            cover,
        },
    })
    .unwrap()
}

/// Everything a user can see, minus the dataset generation that restore must change.
fn snapshot(s: &Store) -> Value {
    let mut v = json!({
        "assets": s.query_assets(&thingary_lib::catalog::Query { search: String::new(), filter: "all".into(), sort: "created".into(), descending: true, offset: 0, category: Default::default(), warranty: "all".into(), label: None }, TODAY).unwrap().items,
        "trash": s.list_trash(&TrashQuery { filter: "all".into(), offset: 0, search: String::new() }).unwrap().items,
        "timeline": [s.timeline(&timeline::Query { filter: "all".into(), asset_id: None }, TODAY).unwrap().dated, s.timeline(&timeline::Query { filter: "all".into(), asset_id: None }, TODAY).unwrap().undated],
        "taxonomy": s.taxonomy_snapshot().unwrap().categories,
        "materials": s.material_entries().unwrap(),
    });
    for filter in ["ongoing", "achieved", "abandoned"] {
        v[filter] = json!(
            s.query_wishlist(&wishlist::Query {
                search: String::new(),
                filter: filter.into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
            })
            .unwrap()
            .items
        );
    }
    let o = s.overview("history", TODAY).unwrap();
    v["overview"] = json!([
        o.held_count,
        o.sold_count,
        o.held_known_cents,
        o.history_known_cents,
        o.ongoing_wishes,
        o.categories
    ]);
    v
}
fn photo_ids(v: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    fn walk(v: &Value, ids: &mut Vec<String>) {
        match v {
            Value::Object(m) => {
                if let (Some(Value::String(id)), Some(Value::String(_))) =
                    (m.get("id"), m.get("name"))
                {
                    if m.len() == 2 {
                        ids.push(id.clone());
                    }
                }
                m.values().for_each(|x| walk(x, ids));
            }
            Value::Array(a) => a.iter().for_each(|x| walk(x, ids)),
            _ => {}
        }
    }
    walk(v, &mut ids);
    ids.sort();
    ids.dedup();
    ids
}

#[test]
fn ac31_every_p0_relation_restores_into_an_empty_library() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = Store::open(&dir.path().join("a")).unwrap();
    let source = dir.path().join("custom.png");
    std::fs::write(&source, PNG).unwrap();
    a.add_material_once(&source, &a.generation(), &id())
        .unwrap();

    let main_photo = photo(&a, "主图.png");
    let kept = asset(&mut a, "持有物品", "100000", Some(main_photo));
    let kept = a
        .change_maintenance(
            &maintenance::Change {
                request_id: id(),
                generation: a.generation(),
                asset_id: kept.asset.id.clone(),
                expected_revision: kept.asset.revision,
                action: maintenance::Action::Add {
                    fields: maintenance::Fields {
                        date: Some("2026-09-05".into()),
                        kind: "repair".into(),
                        title: "虚构维修".into(),
                        description: String::new(),
                        cost_cents: Some("20000".into()),
                        provider: String::new(),
                    },
                    photos: Selection {
                        cover_id: None,
                        ..photo(&a, "维修单.png")
                    },
                },
            },
            TODAY,
        )
        .unwrap();
    let kept = a
        .change_maintenance(
            &maintenance::Change {
                request_id: id(),
                generation: a.generation(),
                asset_id: kept.asset.id.clone(),
                expected_revision: kept.asset.revision,
                action: maintenance::Action::Add {
                    fields: maintenance::Fields {
                        date: None,
                        kind: "cleaning".into(),
                        title: "删掉的清洁".into(),
                        description: String::new(),
                        cost_cents: None,
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
    let removed = kept
        .maintenances
        .iter()
        .find(|m| m.fields.title == "删掉的清洁")
        .unwrap()
        .id
        .clone();
    let kept = a
        .change_record_trash(
            &RecordChange {
                request_id: id(),
                generation: a.generation(),
                asset_id: kept.asset.id.clone(),
                record_id: removed,
                kind: "maintenance".into(),
                expected_revision: kept.asset.revision,
                deleted: true,
            },
            TODAY,
        )
        .unwrap();
    let kept = a
        .change_warranty(
            &warranty::Change {
                reminder: None,
                request_id: id(),
                generation: a.generation(),
                asset_id: kept.asset.id.clone(),
                expected_revision: kept.asset.revision,
                action: warranty::Action::Add {
                    fields: warranty::Fields {
                        kind: "applecare".into(),
                        provider: "虚构".into(),
                        start_date: Some("2026-09-01".into()),
                        end_date: Some("2027-09-01".into()),
                        notes: String::new(),
                    },
                    photos: Selection {
                        cover_id: None,
                        ..photo(&a, "保修卡.png")
                    },
                },
            },
            TODAY,
        )
        .unwrap();
    a.change_lifecycle(
        &lifecycle::Change {
            request_id: id(),
            generation: a.generation(),
            asset_id: kept.asset.id.clone(),
            expected_revision: kept.asset.revision,
            action: lifecycle::Action::Append {
                kind: lifecycle::Kind::Retire,
                date: "2026-09-10".into(),
                notes: "收起".into(),
            },
        },
        TODAY,
    )
    .unwrap();
    let sold = asset(&mut a, "已售物品", "50000", None);
    a.change_sale(
        &sales::Change {
            request_id: id(),
            generation: a.generation(),
            asset_id: sold.asset.id.clone(),
            expected_revision: sold.asset.revision,
            action: sales::Action::Sell {
                fields: sales::Fields {
                    date: "2026-09-15".into(),
                    price_cents: "30000".into(),
                    platform: "虚构平台".into(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let gone_photo = photo(&a, "删除物品图.png");
    let gone = asset(&mut a, "最近删除的物品", "9900", Some(gone_photo));
    a.change_trash(&TrashChange {
        request_id: id(),
        generation: a.generation(),
        asset_id: gone.asset.id.clone(),
        expected_revision: gone.asset.revision,
        deleted: true,
    })
    .unwrap();
    let achieved = wish(&mut a, "已实现心愿", true);
    let staged = a
        .stage_wishlist_cover(&achieved.id, &a.generation())
        .unwrap();
    a.convert_wishlist(
        &Convert {
            wishlist_id: achieved.id.clone(),
            expected_revision: achieved.revision,
            asset: SaveAsset {
                options: None,
                base: Save {
                    request_id: id(),
                    generation: a.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "心愿买到的".into(),
                    price_cents: Some("120000".into()),
                    purchase_date: Some("2026-09-18".into()),
                },
                details: Details::default(),
                photos: Some(Selection {
                    cover_id: Some(staged.id.clone()),
                    ids: vec![staged.id],
                }),
                classification: None,
            },
        },
        TODAY,
    )
    .unwrap();
    let dropped = wish(&mut a, "放弃的心愿", true);
    a.change_wishlist(&wishlist::Change {
        request_id: id(),
        generation: a.generation(),
        expected_revision: Some(dropped.revision),
        action: wishlist::Action::Abandon {
            wishlist_id: dropped.id,
        },
    })
    .unwrap();
    wish(&mut a, "进行中心愿", false);

    let before = snapshot(&a);
    let ids = photo_ids(&before);
    assert_eq!(
        ids.len(),
        6,
        "asset, maintenance, warranty, converted asset and two wish covers: {ids:?}"
    );
    let gone_photo_id = gone.photos[0].id.clone();
    let archive = dir.path().join("完整备份.thingary");
    a.backup(Some(&archive)).unwrap();
    drop(a);

    let mut b = Store::open(&dir.path().join("b")).unwrap();
    let old = b.generation();
    let summary = b.inspect_backup(&archive).unwrap();
    assert_eq!(
        (
            summary.schema,
            summary.assets,
            summary.deleted_assets,
            summary.wishes,
            summary.maintenances,
            summary.warranties
        ),
        (thingary_lib::storage::SCHEMA_VERSION as u32, 4, 1, 3, 2, 1)
    );
    assert_eq!(summary.hash, archive_hash(&archive).unwrap());
    assert!(
        summary.files >= 1,
        "identical images share one managed file"
    );
    b.restore(&archive, &summary.hash, &old).unwrap();
    assert_ne!(b.generation(), old);
    assert_eq!(
        snapshot(&b),
        before,
        "IDs, states, money, wish links, records and trash all identical"
    );
    for photo in &ids {
        assert!(
            b.photo_preview(photo, &b.generation()).is_ok(),
            "photo {photo} readable after restore"
        );
    }
    // The soft-deleted asset keeps its original image too.
    assert!(b.photo_preview(&gone_photo_id, &b.generation()).is_ok());
    // Requests prepared against the replaced library are rejected.
    let stale = b.save(
        &Save {
            request_id: id(),
            generation: old,
            asset_id: None,
            expected_revision: None,
            name: "旧窗口".into(),
            price_cents: None,
            purchase_date: None,
        },
        TODAY,
    );
    assert_eq!(stale.unwrap_err().code, "STALE_DATASET");
    // The trash still works after restore: restoring the deleted asset brings it back.
    let entry = b
        .list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 0,
            search: String::new(),
        })
        .unwrap()
        .items
        .into_iter()
        .find(|e| {
            serde_json::to_value(e)
                .unwrap()
                .to_string()
                .contains("最近删除的物品")
        })
        .unwrap();
    let entry = serde_json::to_value(entry).unwrap();
    let asset_id = entry["asset_id"]
        .as_str()
        .or(entry["id"].as_str())
        .unwrap()
        .to_owned();
    let record = b.record(&asset_id).unwrap().unwrap();
    b.change_trash(&TrashChange {
        request_id: id(),
        generation: b.generation(),
        asset_id,
        expected_revision: record.asset.revision,
        deleted: false,
    })
    .unwrap();
    drop(b);
    let reopened = Store::open(&dir.path().join("b")).unwrap();
    assert_eq!(reopened.overview("history", TODAY).unwrap().held_count, 3);
}

#[test]
fn schema_eleven_wishlist_backup_inspects_and_migrates_on_restore() {
    use sha2::{Digest, Sha256};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v11.sqlite");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 11, &|_| Ok(())).unwrap();
    let wid = id();
    db.execute("INSERT INTO wishlist_items(id,name,estimated_price_cents,external_link,notes,status,revision,created_at,updated_at,abandoned_at) VALUES(?1,'旧版心愿',150000,'','','abandoned',2,'2026-09-25T00:00:00Z','2026-09-25T01:00:00Z','2026-09-25T01:00:00Z')", [&wid]).unwrap();
    drop(db);
    let bytes = std::fs::read(&path).unwrap();
    let manifest = json!({"format":1,"schema":11,"created_at":"2026-09-25T02:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let archive = dir.path().join("v11.thingary");
    let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("manifest.json", opts).unwrap();
    z.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    z.start_file("data.sqlite", opts).unwrap();
    z.write_all(&bytes).unwrap();
    z.finish().unwrap();

    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let summary = s.inspect_backup(&archive).unwrap();
    assert_eq!((summary.schema, summary.wishes), (11, 1));
    s.restore(&archive, &summary.hash, &s.generation()).unwrap();
    let item = s.wishlist_item(&wid).unwrap().unwrap();
    assert_eq!(
        (item.status.as_str(), item.converted_asset, item.achieved_at),
        ("abandoned", None, None)
    );
}

#[test]
fn ac32_inspection_rejects_bad_archives_without_touching_the_library() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let kept = asset(&mut s, "原有资料", "100", None);
    let junk = dir.path().join("junk.thingary");
    std::fs::write(&junk, b"not a zip").unwrap();
    assert!(s.inspect_backup(&junk).is_err());
    assert!(s
        .inspect_backup(&dir.path().join("missing.thingary"))
        .is_err());
    assert!(s.restore(&junk, "deadbeef", &s.generation()).is_err());
    assert_eq!(s.asset(&kept.asset.id).unwrap().unwrap().name, "原有资料");
    // No scratch folders are left in the library root.
    let leftovers: Vec<_> = std::fs::read_dir(dir.path().join("lib"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}
