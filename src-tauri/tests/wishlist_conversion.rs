use rusqlite::Connection;
use std::{fs, path::PathBuf};
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::{Error, Save},
    photos::Selection,
    storage::{migrate_to, Store, SCHEMA},
    trash::TrashChange,
    wishlist::{Action, Change, Convert, Fields, Query, WishlistItem},
};

const TODAY: &str = "2026-09-26";

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn add_wish(store: &mut Store, name: &str, price: Option<&str>, cover: bool) -> WishlistItem {
    let generation = store.generation();
    let ids = if cover {
        vec![
            store
                .stage_photo(
                    "心愿封面.png",
                    include_bytes!("fixtures/camera.png"),
                    &generation,
                    None,
                )
                .unwrap()
                .id,
        ]
    } else {
        vec![]
    };
    let category = store.taxonomy_snapshot().unwrap().categories[0].id.clone();
    store
        .change_wishlist(&Change {
            request_id: uuid(),
            generation,
            expected_revision: None,
            action: Action::Add {
                fields: Fields {
                    name: name.into(),
                    category_id: Some(category),
                    estimated_price_cents: price.map(str::to_owned),
                    priority: Some("high".into()),
                    target_date: None,
                    external_link: String::new(),
                    notes: "心愿备注".into(),
                },
                cover: Selection {
                    cover_id: ids.first().cloned(),
                    ids,
                },
            },
        })
        .unwrap()
}

fn convert_input(
    store: &Store,
    wish: &WishlistItem,
    price: Option<&str>,
    photos: Vec<String>,
) -> Convert {
    Convert {
        wishlist_id: wish.id.clone(),
        expected_revision: wish.revision,
        asset: SaveAsset {
            options: None,
            base: Save {
                request_id: uuid(),
                generation: store.generation(),
                asset_id: None,
                expected_revision: None,
                name: wish.fields.name.clone(),
                price_cents: price.map(str::to_owned),
                purchase_date: Some("2026-09-20".into()),
            },
            details: Details::default(),
            photos: Some(Selection {
                cover_id: photos.first().cloned(),
                ids: photos,
            }),
            classification: Some(thingary_lib::taxonomy::Classification {
                category_id: wish.fields.category_id.clone(),
                channel_id: None,
            }),
        },
    }
}

fn dataset(dir: &std::path::Path) -> PathBuf {
    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.join("active.json")).unwrap()).unwrap();
    dir.join("datasets").join(active["id"].as_str().unwrap())
}

fn asset_count(dir: &std::path::Path) -> i64 {
    Connection::open(dataset(dir).join("data.sqlite"))
        .unwrap()
        .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
        .unwrap()
}

fn ongoing_total(store: &Store) -> String {
    store
        .query_wishlist(&Query {
            search: String::new(),
            filter: "considering".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
        })
        .unwrap()
        .considering_known_cents
}

fn fail_at(store: &mut Store, at: &'static str, code: &'static str) {
    store.set_hook(move |point| {
        if point == at {
            Err(Error::new(code, "注入"))
        } else {
            Ok(())
        }
    });
}

#[test]
fn ac17_actual_price_is_separate_and_both_sides_trace_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let wish = add_wish(&mut store, "虚构降噪耳机", Some("150000"), true);
    assert_eq!(ongoing_total(&store), "150000");
    let staged = store
        .stage_wishlist_cover(&wish.id, &store.generation())
        .unwrap();
    assert_ne!(staged.id, wish.cover.as_ref().unwrap().id);
    let input = convert_input(&store, &wish, Some("120000"), vec![staged.id.clone()]);
    let record = store.convert_wishlist(&input, TODAY).unwrap();

    assert_eq!(asset_count(dir.path()), 1);
    assert_eq!(record.asset.price_cents.as_deref(), Some("120000"));
    assert_eq!(record.classification.category_id, wish.fields.category_id);
    assert_eq!(record.cover_id.as_deref(), Some(staged.id.as_str()));
    let origin = record.origin_wishlist.as_ref().unwrap();
    assert_eq!(
        (origin.id.as_str(), origin.estimated_price_cents.as_deref()),
        (wish.id.as_str(), Some("150000"))
    );
    assert_eq!(origin.created_at, wish.created_at);

    let achieved = store.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(achieved.status, "achieved");
    assert_eq!(achieved.revision, wish.revision + 1);
    assert_eq!(
        achieved.fields, wish.fields,
        "estimate, notes and category stay as planned"
    );
    assert_eq!(achieved.created_at, wish.created_at);
    assert_eq!(
        achieved.cover, wish.cover,
        "wish keeps its own cover attachment"
    );
    let link = achieved.converted_asset.unwrap();
    assert_eq!(
        (link.id.as_str(), link.deleted),
        (record.asset.id.as_str(), false)
    );
    assert!(achieved.achieved_at.is_some());
    assert_eq!(
        ongoing_total(&store),
        "0",
        "achieved estimate leaves the ongoing total"
    );
    let page = store
        .query_wishlist(&Query {
            search: String::new(),
            filter: "purchased".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
        })
        .unwrap();
    assert_eq!(page.total, 1);
    // The asset photo is a separate attachment over the same managed file.
    assert!(store.photo_preview(&staged.id, &store.generation()).is_ok());
    let db = Connection::open(dataset(dir.path()).join("data.sqlite")).unwrap();
    let (asset_hash, wish_hash): (String, String) = db
        .query_row(
            "SELECT a.hash,w.hash FROM attachments a, wishlist_attachments w WHERE a.id=?1 AND w.id=?2",
            [&staged.id, &wish.cover.as_ref().unwrap().id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(asset_hash, wish_hash);
    let actions: Vec<String> = db
        .prepare("SELECT action FROM wishlist_audit WHERE wishlist_id=?1 ORDER BY sequence")
        .unwrap()
        .query_map([&wish.id], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(actions, ["add", "convert"]);
}

#[test]
fn unknown_price_and_no_cover_convert_without_inventing_values() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let wish = add_wish(&mut store, "未知价心愿", None, false);
    assert_eq!(
        store
            .stage_wishlist_cover(&wish.id, &store.generation())
            .unwrap_err()
            .code,
        "NOT_FOUND"
    );
    let mut input = convert_input(&store, &wish, None, vec![]);
    input.asset.base.purchase_date = None;
    let record = store.convert_wishlist(&input, TODAY).unwrap();
    assert_eq!(record.asset.price_cents, None);
    assert_eq!(record.asset.purchase_date, None);
    assert!(record.photos.is_empty());
    assert_eq!(record.origin_wishlist.unwrap().estimated_price_cents, None);
}

#[test]
fn ac18_cancel_faults_replay_and_repeat_never_duplicate() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let wish = add_wish(&mut store, "故障心愿", Some("150000"), false);
    let input = convert_input(&store, &wish, Some("120000"), vec![]);

    // Fault before commit: nothing half-written, same request can retry.
    fail_at(&mut store, "convert.before_commit", "INJECTED");
    assert_eq!(
        store.convert_wishlist(&input, TODAY).unwrap_err().code,
        "INJECTED"
    );
    store.set_hook(|_| Ok(()));
    assert_eq!(asset_count(dir.path()), 0);
    let still = store.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(
        (still.status.as_str(), still.revision),
        ("ongoing", wish.revision)
    );
    assert!(store
        .saved_request(&input.asset.base.request_id, &store.generation())
        .unwrap()
        .is_none());

    // Lost reply after commit: the original request resolves to one asset.
    fail_at(&mut store, "convert.after_commit", "LOST");
    assert_eq!(
        store.convert_wishlist(&input, TODAY).unwrap_err().code,
        "LOST"
    );
    store.set_hook(|_| Ok(()));
    let saved = store
        .saved_request(&input.asset.base.request_id, &store.generation())
        .unwrap()
        .unwrap();
    assert_eq!(
        store.convert_wishlist(&input, TODAY).unwrap().asset.id,
        saved.asset.id
    );
    assert_eq!(asset_count(dir.path()), 1);

    // A different request (second click, stale form) cannot convert again.
    let again = convert_input(&store, &wish, Some("120000"), vec![]);
    assert_eq!(
        store.convert_wishlist(&again, TODAY).unwrap_err().code,
        "WISHLIST_ACHIEVED"
    );
    let mut altered = input.clone();
    altered.asset.base.price_cents = Some("1".into());
    assert_eq!(
        store.convert_wishlist(&altered, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    assert_eq!(asset_count(dir.path()), 1);

    // Abandoned and stale wishes are refused without writing.
    let other = add_wish(&mut store, "旧版本心愿", None, false);
    let mut stale = convert_input(&store, &other, None, vec![]);
    stale.expected_revision += 1;
    assert_eq!(
        store.convert_wishlist(&stale, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    store
        .change_wishlist(&Change {
            request_id: uuid(),
            generation: store.generation(),
            expected_revision: Some(other.revision),
            action: Action::Abandon {
                wishlist_id: other.id.clone(),
            },
        })
        .unwrap();
    let abandoned = convert_input(&store, &other, None, vec![]);
    assert_eq!(
        store.convert_wishlist(&abandoned, TODAY).unwrap_err().code,
        "WISHLIST_STATUS"
    );
    let mut future = convert_input(&store, &wish, None, vec![]);
    future.asset.base.purchase_date = Some("2099-01-01".into());
    assert!(store.convert_wishlist(&future, TODAY).is_err());
    assert_eq!(asset_count(dir.path()), 1);
}

#[test]
fn ac18_missing_file_and_real_write_lock_leave_no_half_conversion() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let wish = add_wish(&mut store, "文件故障心愿", Some("9900"), true);
    let staged = store
        .stage_wishlist_cover(&wish.id, &store.generation())
        .unwrap();
    let input = convert_input(&store, &wish, Some("9900"), vec![staged.id.clone()]);
    let files = dataset(dir.path()).join("files");
    let managed = fs::read_dir(&files)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let parked = dir.path().join("parked");
    fs::rename(&managed, &parked).unwrap();
    assert!(store.convert_wishlist(&input, TODAY).is_err());
    assert_eq!(asset_count(dir.path()), 0);
    assert_eq!(
        store.wishlist_item(&wish.id).unwrap().unwrap().status,
        "ongoing"
    );
    fs::rename(&parked, &managed).unwrap();

    let lock = Connection::open(dataset(dir.path()).join("data.sqlite")).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert_eq!(
        store.convert_wishlist(&input, TODAY).unwrap_err().code,
        "DATABASE"
    );
    assert_eq!(
        store.wishlist_item(&wish.id).unwrap().unwrap().status,
        "ongoing"
    );
    lock.execute_batch("ROLLBACK").unwrap();
    let record = store.convert_wishlist(&input, TODAY).unwrap();
    assert_eq!(record.photos.len(), 1);
    assert_eq!(asset_count(dir.path()), 1);
}

#[test]
fn ac19_ac27_ac28_soft_deleted_asset_keeps_link_and_restores_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let wish = add_wish(&mut store, "删除关联心愿", Some("150000"), true);
    let staged = store
        .stage_wishlist_cover(&wish.id, &store.generation())
        .unwrap();
    let record = store
        .convert_wishlist(
            &convert_input(&store, &wish, Some("120000"), vec![staged.id.clone()]),
            TODAY,
        )
        .unwrap();
    let deleted = store
        .change_trash(&TrashChange {
            request_id: uuid(),
            generation: store.generation(),
            asset_id: record.asset.id.clone(),
            expected_revision: record.asset.revision,
            deleted: true,
        })
        .unwrap();
    assert!(deleted.deleted);
    let after = store.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(after.status, "achieved");
    let link = after.converted_asset.unwrap();
    assert_eq!(
        (link.id.as_str(), link.deleted),
        (record.asset.id.as_str(), true)
    );
    assert_eq!(
        store
            .convert_wishlist(&convert_input(&store, &wish, Some("120000"), vec![]), TODAY)
            .unwrap_err()
            .code,
        "WISHLIST_ACHIEVED"
    );
    assert_eq!(asset_count(dir.path()), 1);
    assert!(store
        .wishlist_item(&wish.id)
        .unwrap()
        .unwrap()
        .cover
        .is_some());

    let restored = store
        .change_trash(&TrashChange {
            request_id: uuid(),
            generation: store.generation(),
            asset_id: record.asset.id.clone(),
            expected_revision: deleted.asset.revision,
            deleted: false,
        })
        .unwrap();
    assert_eq!(restored.asset.id, record.asset.id);
    assert_eq!(restored.origin_wishlist.unwrap().id, wish.id);
    assert!(
        !store
            .wishlist_item(&wish.id)
            .unwrap()
            .unwrap()
            .converted_asset
            .unwrap()
            .deleted
    );
    assert!(store.photo_preview(&staged.id, &store.generation()).is_ok());
}

#[test]
fn backup_restore_and_reopen_keep_conversion_link() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path()).unwrap();
    let wish = add_wish(&mut store, "备份心愿", Some("150000"), true);
    let staged = store
        .stage_wishlist_cover(&wish.id, &store.generation())
        .unwrap();
    let record = store
        .convert_wishlist(
            &convert_input(&store, &wish, Some("120000"), vec![staged.id]),
            TODAY,
        )
        .unwrap();
    let archive = dir.path().join("conversion.thingary");
    store.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    let generation = store.generation();
    store.restore(&archive, &hash, &generation).unwrap();
    let wish_after = store.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(wish_after.converted_asset.unwrap().id, record.asset.id);
    drop(store);
    let reopened = Store::open(dir.path()).unwrap();
    assert_eq!(
        reopened
            .record(&record.asset.id)
            .unwrap()
            .unwrap()
            .origin_wishlist
            .unwrap()
            .id,
        wish.id
    );
}

#[test]
fn schema_eleven_upgrade_is_atomic_and_keeps_audit() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 11, &|_| Ok(())).unwrap();
    let id = uuid();
    db.execute("INSERT INTO wishlist_items(id,name,external_link,notes,status,revision,created_at,updated_at) VALUES(?1,'旧心愿','','','ongoing',1,'2026-09-25T00:00:00Z','2026-09-25T00:00:00Z')", [&id]).unwrap();
    db.execute("INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at) VALUES('r1',?1,'add','{}','2026-09-25T00:00:00Z')", [&id]).unwrap();
    assert!(migrate_to(&db, 12, &|p| if p == "migration.before_commit" {
        Err(Error::new("INJECTED", "中断"))
    } else {
        Ok(())
    })
    .is_err());
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        11
    );
    assert!(db
        .prepare("SELECT converted_asset_id FROM wishlist_items")
        .is_err());
    migrate_to(&db, 12, &|_| Ok(())).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        12
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM wishlist_audit WHERE action='add'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    // Achieved without a link, or relinking, is rejected by the schema itself.
    assert!(db
        .execute(
            "UPDATE wishlist_items SET status='achieved' WHERE id=?1",
            [&id]
        )
        .is_err());
    db.execute(
        "INSERT INTO assets(id,name,revision) VALUES('a1','x',1),('a2','y',1)",
        [],
    )
    .unwrap();
    db.execute("UPDATE wishlist_items SET status='achieved',converted_asset_id='a1',achieved_at='2026-09-26T00:00:00Z' WHERE id=?1", [&id]).unwrap();
    assert!(db
        .execute(
            "UPDATE wishlist_items SET converted_asset_id='a2' WHERE id=?1",
            [&id]
        )
        .is_err());
    assert!(db.execute("UPDATE wishlist_items SET status='ongoing',converted_asset_id=NULL,achieved_at=NULL WHERE id=?1", [&id]).is_err());
}
