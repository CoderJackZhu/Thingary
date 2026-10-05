use rusqlite::Connection;
use std::fs;
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save,
    storage::{migrate_to, Store, SCHEMA},
    taxonomy::{Change as TaxonomyChange, Command, Kind},
    wishlist::{Action, Change, Fields, Query},
};

fn fields(name: &str, price: Option<&str>) -> Fields {
    Fields {
        name: name.into(),
        category_id: None,
        estimated_price_cents: price.map(str::to_owned),
        priority: None,
        target_date: None,
        external_link: String::new(),
        notes: String::new(),
    }
}

fn add(
    store: &mut Store,
    request: &str,
    fields: Fields,
    cover: Vec<String>,
) -> thingary_lib::wishlist::WishlistItem {
    store
        .change_wishlist(&Change {
            request_id: request.into(),
            generation: store.generation(),
            expected_revision: None,
            action: Action::Add {
                fields,
                cover: thingary_lib::photos::Selection {
                    cover_id: cover.first().cloned(),
                    ids: cover,
                },
            },
        })
        .unwrap()
}

#[test]
fn ac16_create_cancel_and_abandon_do_not_touch_assets() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let before = store
        .query_assets(
            &thingary_lib::catalog::Query {
                search: "".into(),
                filter: "all".into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
                category: Default::default(),
                warranty: "all".into(),
                label: None,
            },
            "2026-09-25",
        )
        .unwrap();
    let request = uuid::Uuid::new_v4().to_string();
    let item = add(
        &mut store,
        &request,
        fields("虚构心愿", Some("150000")),
        vec![],
    );
    let same = add(
        &mut store,
        &request,
        fields("虚构心愿", Some("150000")),
        vec![],
    );
    assert_eq!(same.id, item.id);
    let page = store
        .query_wishlist(&Query {
            search: "虚构".into(),
            filter: "considering".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
        })
        .unwrap();
    assert_eq!(
        (
            page.total,
            page.considering_known_cents.as_str(),
            page.considering_unknown_count
        ),
        (1, "150000", 0)
    );
    assert_eq!(
        store
            .query_assets(
                &thingary_lib::catalog::Query {
                    search: "".into(),
                    filter: "all".into(),
                    sort: "created".into(),
                    descending: true,
                    offset: 0,
                    category: Default::default(),
                    warranty: "all".into(),
                    label: None,
                },
                "2026-09-25"
            )
            .unwrap()
            .total,
        before.total
    );
    let abandoned = store
        .change_wishlist(&Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: store.generation(),
            expected_revision: Some(item.revision),
            action: Action::Abandon {
                wishlist_id: item.id.clone(),
            },
        })
        .unwrap();
    assert_eq!(abandoned.status, "abandoned");
    assert_eq!(
        store
            .query_wishlist(&Query {
                search: "".into(),
                filter: "considering".into(),
                sort: "created".into(),
                descending: true,
                offset: 0
            })
            .unwrap()
            .considering_known_cents,
        "0"
    );
    assert_eq!(
        store
            .query_wishlist(&Query {
                search: "虚构".into(),
                filter: "dropped".into(),
                sort: "created".into(),
                descending: true,
                offset: 0
            })
            .unwrap()
            .items[0]
            .id,
        item.id
    );
}

#[test]
fn null_zero_future_sorts_search_and_stale_protocol() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let mut a = fields("alpha future", None);
    a.priority = Some("low".into());
    a.target_date = Some("2099-01-01".into());
    let mut b = fields("beta zero", Some("0"));
    b.priority = Some("high".into());
    let mut c = fields("alpha priced", Some("500"));
    c.priority = Some("medium".into());
    c.target_date = Some("2030-01-01".into());
    for value in [a, b, c] {
        add(&mut store, &uuid::Uuid::new_v4().to_string(), value, vec![]);
    }
    let query = |sort: &str| {
        store
            .query_wishlist(&Query {
                search: "alpha".into(),
                filter: "considering".into(),
                sort: sort.into(),
                descending: false,
                offset: 0,
            })
            .unwrap()
    };
    assert_eq!(
        query("price")
            .items
            .iter()
            .map(|i| i.fields.name.as_str())
            .collect::<Vec<_>>(),
        ["alpha priced", "alpha future"]
    );
    assert_eq!(
        query("target")
            .items
            .iter()
            .map(|i| i.fields.name.as_str())
            .collect::<Vec<_>>(),
        ["alpha priced", "alpha future"]
    );
    assert_eq!(
        query("priority")
            .items
            .iter()
            .map(|i| i.fields.name.as_str())
            .collect::<Vec<_>>(),
        ["alpha priced", "alpha future"]
    );
    for (descending, expected) in [
        (false, ["beta zero", "alpha priced", "alpha future"]),
        (true, ["alpha future", "alpha priced", "beta zero"]),
    ] {
        let names = store
            .query_wishlist(&Query {
                search: String::new(),
                filter: "considering".into(),
                sort: "priority".into(),
                descending,
                offset: 0,
            })
            .unwrap()
            .items
            .into_iter()
            .map(|item| item.fields.name)
            .collect::<Vec<_>>();
        assert_eq!(names, expected);
    }
    assert_eq!(query("created").total, 2);
    let request = uuid::Uuid::new_v4().to_string();
    add(&mut store, &request, fields("same", None), vec![]);
    let changed = Change {
        request_id: request,
        generation: store.generation(),
        expected_revision: None,
        action: Action::Add {
            fields: fields("different", None),
            cover: thingary_lib::photos::Selection {
                ids: vec![],
                cover_id: None,
            },
        },
    };
    assert_eq!(
        store.change_wishlist(&changed).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let stale = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: uuid::Uuid::new_v4().to_string(),
        expected_revision: None,
        action: Action::Add {
            fields: fields("stale", None),
            cover: thingary_lib::photos::Selection {
                ids: vec![],
                cover_id: None,
            },
        },
    };
    assert_eq!(
        store.change_wishlist(&stale).unwrap_err().code,
        "STALE_DATASET"
    );
}

#[test]
fn wishlist_pagination_reaches_items_after_the_first_hundred() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    for index in 0..101 {
        add(
            &mut store,
            &uuid::Uuid::new_v4().to_string(),
            fields(&format!("虚构分页心愿 {index:03}"), None),
            vec![],
        );
    }
    let page = |offset| {
        store
            .query_wishlist(&Query {
                search: String::new(),
                filter: "considering".into(),
                sort: "created".into(),
                descending: true,
                offset,
            })
            .unwrap()
    };
    let first = page(0);
    let second = page(100);
    assert_eq!((first.total, first.items.len()), (101, 100));
    assert_eq!((second.total, second.items.len()), (101, 1));
    assert!(!first.items.iter().any(|item| item.id == second.items[0].id));
    assert_eq!(page(200).items.len(), 0);
}

#[test]
fn receipt_lookup_requires_exact_wishlist_payload_and_audit() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let input = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: store.generation(),
        expected_revision: None,
        action: Action::Add {
            fields: fields("exact receipt", Some("1234")),
            cover: thingary_lib::photos::Selection {
                ids: vec![],
                cover_id: None,
            },
        },
    };
    let saved = store.change_wishlist(&input).unwrap();
    assert_eq!(
        store.saved_wishlist_request(&input).unwrap().unwrap().id,
        saved.id
    );

    let mut mismatch = input.clone();
    if let Action::Add { fields, .. } = &mut mismatch.action {
        fields.name = "different payload".into();
    }
    assert_eq!(
        store.saved_wishlist_request(&mismatch).unwrap_err().code,
        "REQUEST_CONFLICT"
    );

    let missing = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        ..input.clone()
    };
    assert!(store.saved_wishlist_request(&missing).unwrap().is_none());

    let unrelated_request = uuid::Uuid::new_v4().to_string();
    store
        .save_asset(
            &SaveAsset {
                options: None,
                base: Save {
                    request_id: unrelated_request.clone(),
                    generation: store.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "unrelated asset".into(),
                    price_cents: None,
                    purchase_date: None,
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            "2026-09-25",
        )
        .unwrap();
    let unrelated = Change {
        request_id: unrelated_request,
        ..input.clone()
    };
    assert_eq!(
        store.saved_wishlist_request(&unrelated).unwrap_err().code,
        "REQUEST_CONFLICT"
    );

    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let db = Connection::open(
        dir.path()
            .join("datasets")
            .join(active["id"].as_str().unwrap())
            .join("data.sqlite"),
    )
    .unwrap();
    db.execute(
        "DELETE FROM wishlist_audit WHERE request_id=?1",
        [&input.request_id],
    )
    .unwrap();
    assert!(store.saved_wishlist_request(&input).unwrap().is_none());
}

#[test]
fn category_migration_covers_ongoing_and_abandoned_but_channel_does_not() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let snap = store.taxonomy_snapshot().unwrap();
    let source = snap.categories[0].id.clone();
    let target = snap.categories[1].id.clone();
    let mut one = fields("ongoing", None);
    one.category_id = Some(source.clone());
    let mut two = fields("abandoned", None);
    two.category_id = Some(source.clone());
    let ongoing = add(&mut store, &uuid::Uuid::new_v4().to_string(), one, vec![]);
    let abandoned = add(&mut store, &uuid::Uuid::new_v4().to_string(), two, vec![]);
    store
        .change_wishlist(&Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: store.generation(),
            expected_revision: Some(abandoned.revision),
            action: Action::Abandon {
                wishlist_id: abandoned.id.clone(),
            },
        })
        .unwrap();
    let references = store
        .taxonomy_snapshot()
        .unwrap()
        .categories
        .into_iter()
        .find(|entry| entry.id == source)
        .unwrap()
        .references;
    assert_eq!(references.ongoing_wishlist, 1);
    assert_eq!(references.abandoned_wishlist, 1);
    store
        .change_taxonomy(&TaxonomyChange {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: store.generation(),
            expected_revision: snap.revision,
            command: Command::Remove {
                kind: Kind::Category,
                id: source,
                target_id: Some(target.clone()),
            },
        })
        .unwrap();
    assert_eq!(
        store
            .wishlist_item(&ongoing.id)
            .unwrap()
            .unwrap()
            .fields
            .category_id
            .as_deref(),
        Some(target.as_str())
    );
    assert_eq!(
        store
            .wishlist_item(&abandoned.id)
            .unwrap()
            .unwrap()
            .fields
            .category_id
            .as_deref(),
        Some(target.as_str())
    );
    let after = store.taxonomy_snapshot().unwrap();
    store
        .change_taxonomy(&TaxonomyChange {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: store.generation(),
            expected_revision: after.revision,
            command: Command::Remove {
                kind: Kind::Channel,
                id: after.channels[0].id.clone(),
                target_id: None,
            },
        })
        .unwrap();
    assert_eq!(
        store
            .wishlist_item(&ongoing.id)
            .unwrap()
            .unwrap()
            .fields
            .category_id
            .as_deref(),
        Some(target.as_str())
    );
    let after_channel = store.taxonomy_snapshot().unwrap();
    store
        .change_taxonomy(&TaxonomyChange {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: store.generation(),
            expected_revision: after_channel.revision,
            command: Command::Remove {
                kind: Kind::Category,
                id: target,
                target_id: None,
            },
        })
        .unwrap();
    assert_eq!(
        store
            .wishlist_item(&ongoing.id)
            .unwrap()
            .unwrap()
            .fields
            .category_id,
        None
    );
    assert_eq!(
        store
            .wishlist_item(&abandoned.id)
            .unwrap()
            .unwrap()
            .fields
            .category_id,
        None
    );
}

#[test]
fn cover_is_independent_and_schema_ten_migrates() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 10, &|_| Ok(())).unwrap();
    let asset = uuid::Uuid::new_v4().to_string();
    let maintenance = uuid::Uuid::new_v4().to_string();
    let warranty = uuid::Uuid::new_v4().to_string();
    let attachment = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO assets(id,name,revision,lifecycle_state) VALUES(?1,'旧资产',1,'active')",
        [&asset],
    )
    .unwrap();
    db.execute("INSERT INTO asset_profiles(asset_id,brand,model,serial_number,notes) VALUES(?1,'','','','')", [&asset]).unwrap();
    db.execute("INSERT INTO maintenances(id,asset_id,kind,title,description,provider,created_at,updated_at) VALUES(?1,?2,'repair','旧维护','','','2026-09-25T00:00:00Z','2026-09-25T00:00:00Z')", rusqlite::params![maintenance,asset]).unwrap();
    db.execute("INSERT INTO warranties(id,asset_id,kind,provider,notes,created_at,updated_at) VALUES(?1,?2,'manufacturer','','','2026-09-25T00:00:00Z','2026-09-25T00:00:00Z')", rusqlite::params![warranty,asset]).unwrap();
    db.execute(
        "INSERT INTO attachments(id,asset_id,file,hash,size) VALUES(?1,?2,'hash','hash',1)",
        rusqlite::params![attachment, asset],
    )
    .unwrap();
    migrate_to(&db, 11, &|_| Ok(())).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        11
    );
    for table in ["assets", "maintenances", "warranties", "attachments"] {
        assert_eq!(
            db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let photo = store
        .stage_photo(
            "cover.png",
            include_bytes!("fixtures/camera.png"),
            &store.generation(),
            None,
        )
        .unwrap();
    let item = add(
        &mut store,
        &uuid::Uuid::new_v4().to_string(),
        fields("covered", None),
        vec![photo.id.clone()],
    );
    assert_eq!(item.cover.as_ref().unwrap().id, photo.id);
    assert!(store.photo_preview(&photo.id, &store.generation()).is_ok());
}

#[test]
fn faults_lost_receipt_and_real_write_lock_do_not_duplicate() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let input = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: store.generation(),
        expected_revision: None,
        action: Action::Add {
            fields: fields("fault", Some("1")),
            cover: thingary_lib::photos::Selection {
                ids: vec![],
                cover_id: None,
            },
        },
    };
    store.set_hook(|point| {
        if point == "wishlist.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(store.change_wishlist(&input).unwrap_err().code, "INJECTED");
    store.set_hook(|_| Ok(()));
    assert_eq!(
        store
            .query_wishlist(&Query {
                search: "fault".into(),
                filter: "considering".into(),
                sort: "created".into(),
                descending: true,
                offset: 0
            })
            .unwrap()
            .total,
        0
    );
    store.set_hook(|point| {
        if point == "wishlist.after_commit" {
            Err(thingary_lib::domain::Error::new("LOST", "回包丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(store.change_wishlist(&input).unwrap_err().code, "LOST");
    store.set_hook(|_| Ok(()));
    let saved = store.saved_wishlist_request(&input).unwrap().unwrap();
    assert_eq!(saved.fields.name, "fault");
    assert_eq!(store.change_wishlist(&input).unwrap().id, saved.id);
    assert_eq!(
        store
            .query_wishlist(&Query {
                search: "fault".into(),
                filter: "considering".into(),
                sort: "created".into(),
                descending: true,
                offset: 0
            })
            .unwrap()
            .total,
        1
    );

    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let lock = Connection::open(
        dir.path()
            .join("datasets")
            .join(active["id"].as_str().unwrap())
            .join("data.sqlite"),
    )
    .unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let locked = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: store.generation(),
        expected_revision: None,
        action: Action::Add {
            fields: fields("locked", None),
            cover: thingary_lib::photos::Selection {
                ids: vec![],
                cover_id: None,
            },
        },
    };
    assert_eq!(store.change_wishlist(&locked).unwrap_err().code, "DATABASE");
    lock.execute_batch("ROLLBACK").unwrap();
    assert_eq!(
        store.change_wishlist(&locked).unwrap().fields.name,
        "locked"
    );
}

#[test]
fn custom_material_removal_backup_restore_and_reopen_keep_cover() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let source = dir.path().join("custom.png");
    fs::write(&source, include_bytes!("fixtures/camera.png")).unwrap();
    let material = store
        .add_material_once(
            &source,
            &store.generation(),
            &uuid::Uuid::new_v4().to_string(),
        )
        .unwrap();
    let photo = store
        .prepare_material(&material.id, &store.generation())
        .unwrap();
    let item = add(
        &mut store,
        &uuid::Uuid::new_v4().to_string(),
        fields("custom cover", None),
        vec![photo.id.clone()],
    );
    fs::remove_file(&source).unwrap();
    store
        .remove_material(&material.id, &store.generation())
        .unwrap();
    assert!(store.photo_preview(&photo.id, &store.generation()).is_ok());
    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let dataset = dir
        .path()
        .join("datasets")
        .join(active["id"].as_str().unwrap());
    let db = Connection::open(dataset.join("data.sqlite")).unwrap();
    let managed: String = db
        .query_row(
            "SELECT file FROM wishlist_attachments WHERE id=?1",
            [&photo.id],
            |r| r.get(0),
        )
        .unwrap();
    drop(db);
    fs::remove_file(dataset.join("files").join(managed)).unwrap();
    assert_eq!(
        store
            .photo_preview(&photo.id, &store.generation())
            .unwrap_err()
            .code,
        "IMAGE_MISSING"
    );
    store
        .stage_photo(
            "repair.png",
            include_bytes!("fixtures/camera.png"),
            &store.generation(),
            Some(&photo.id),
        )
        .unwrap();
    assert!(store.photo_preview(&photo.id, &store.generation()).is_ok());
    let archive = dir.path().join("wishlist.thingary");
    store.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    let generation = store.generation();
    store.restore(&archive, &hash, &generation).unwrap();
    assert_eq!(
        store
            .wishlist_item(&item.id)
            .unwrap()
            .unwrap()
            .cover
            .unwrap()
            .id,
        photo.id
    );
    assert!(store.photo_preview(&photo.id, &store.generation()).is_ok());
    drop(store);
    let reopened = Store::open(dir.path()).unwrap();
    assert_eq!(
        reopened
            .wishlist_item(&item.id)
            .unwrap()
            .unwrap()
            .cover
            .unwrap()
            .id,
        photo.id
    );
}

#[test]
fn name_sort_orders_the_whole_filtered_wishlist_before_pagination() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    for index in (0..102).rev() {
        add(
            &mut store,
            &uuid::Uuid::new_v4().to_string(),
            fields(&format!("虚构排序心愿 {index:03}"), Some("100")),
            vec![],
        );
    }
    add(
        &mut store,
        &uuid::Uuid::new_v4().to_string(),
        fields("不匹配", None),
        vec![],
    );
    let query = |descending, offset| {
        store
            .query_wishlist(&Query {
                search: "虚构排序心愿".into(),
                filter: "considering".into(),
                sort: "name".into(),
                descending,
                offset,
            })
            .unwrap()
    };
    for (descending, first_name, last_name) in [
        (false, "虚构排序心愿 000", "虚构排序心愿 101"),
        (true, "虚构排序心愿 101", "虚构排序心愿 000"),
    ] {
        let first = query(descending, 0);
        let second = query(descending, 100);
        assert_eq!(
            (first.total, first.items.len(), second.items.len()),
            (102, 100, 2)
        );
        assert_eq!(first.items[0].fields.name, first_name);
        assert_eq!(second.items[1].fields.name, last_name);
        assert_eq!(first.considering_known_cents, "10200");
        assert_eq!(first.considering_unknown_count, 1);
        assert!(second
            .items
            .iter()
            .all(|r| !first.items.iter().any(|x| x.id == r.id)));
    }
}
