//! Considered-replacement relation tests (§7.1, C01–C02).
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::Save as AssetSave,
    photos::Selection,
    storage::{migrate_to, Store, SCHEMA, SCHEMA_VERSION},
    wish_plan::{Preferences, Save as WishSave},
    wishlist::Fields,
};
const TODAY: &str = "2026-10-05";

fn wish_save(s: &thingary_lib::storage::Store, name: &str) -> WishSave {
    WishSave {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: Fields {
            name: name.into(),
            category_id: None,
            estimated_price_cents: None,
            priority: None,
            target_date: None,
            external_link: String::new(),
            notes: String::new(),
        },
        preferences: Preferences::default(),
        photos: Selection {
            ids: vec![],
            cover_id: None,
        },
        replacement_asset_id: None,
        clear_replacement: false,
    }
}

fn asset(s: &mut thingary_lib::storage::Store, name: &str, price: Option<&str>) -> (String, i64) {
    let record = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: AssetSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: name.into(),
                    price_cents: price.map(str::to_owned),
                    purchase_date: Some("2026-01-10".into()),
                },
                details: Details {
                    brand: String::new(),
                    model: String::new(),
                    serial_number: String::new(),
                    notes: String::new(),
                },
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    (record.asset.id, record.asset.revision)
}

fn edit_replacement(
    s: &mut thingary_lib::storage::Store,
    wish_id: &str,
    revision: i64,
    target: Option<&str>,
) -> Result<thingary_lib::wishlist::WishlistItem, thingary_lib::domain::Error> {
    let current = s.wishlist_item(wish_id).unwrap().unwrap();
    s.save_wish_plan(
        &WishSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: Some(wish_id.into()),
            expected_revision: Some(revision),
            fields: current.fields.clone(),
            preferences: current.preferences.clone(),
            photos: Selection {
                ids: current.photos.iter().map(|p| p.id.clone()).collect(),
                cover_id: current.cover.as_ref().map(|c| c.id.clone()),
            },
            replacement_asset_id: target.map(str::to_owned),
            clear_replacement: false,
        },
        TODAY,
    )
}

#[test]
fn c01_relation_picks_the_chosen_id_and_never_touches_the_item() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let first = asset(&mut s, "虚构同名显示器", Some("100000"));
    let second = asset(&mut s, "虚构同名显示器", Some("150000"));
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构换屏心愿"), TODAY)
        .unwrap();
    // Same-name pair: the chosen stable ID wins, the twin stays untouched.
    let linked = edit_replacement(&mut s, &wish.id, wish.revision, Some(&second.0)).unwrap();
    assert_eq!(linked.replacement_asset.as_ref().unwrap().id, second.0);
    assert_eq!(s.record(&first.0).unwrap().unwrap().asset.revision, first.1);
    assert!(!linked.replacement_asset.as_ref().unwrap().deleted);
    assert_eq!(
        s.record(&second.0).unwrap().unwrap().asset.revision,
        second.1,
        "the relation never modifies the item"
    );
    assert!(linked.converted_asset.is_none(), "relations stay separate");
    // Unknown-valued items are fine: the relation does not compute anything.
    let (unknown, _) = asset(&mut s, "虚构无价旧物", None);
    let linked = edit_replacement(&mut s, &wish.id, linked.revision, Some(&unknown)).unwrap();
    assert_eq!(linked.replacement_asset.as_ref().unwrap().id, unknown);
    // Clearing drops the relation entirely.
    let cleared = edit_replacement(&mut s, &wish.id, linked.revision, None).unwrap();
    assert!(cleared.replacement_asset.is_none());
    // A deleted item cannot be newly selected.
    let (gone, gone_rev) = asset(&mut s, "虚构将删旧物", None);
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: gone.clone(),
        expected_revision: gone_rev,
        deleted: true,
    })
    .unwrap();
    let err = edit_replacement(&mut s, &wish.id, cleared.revision, Some(&gone)).unwrap_err();
    assert_eq!(err.code, "WISH_REPLACEMENT");
}

#[test]
fn c02_purchase_and_lifecycle_leave_the_relation_alone() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (old_item, old_rev) = asset(&mut s, "虚构旧键盘", Some("80000"));
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构换键盘心愿"), TODAY)
        .unwrap();
    let linked = edit_replacement(&mut s, &wish.id, wish.revision, Some(&old_item)).unwrap();
    // Buying the new item creates its own record; the old item keeps its
    // lifecycle state, dates and revision.
    let purchase = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: AssetSave {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构新键盘".into(),
                    price_cents: Some("120000".into()),
                    purchase_date: Some(TODAY.into()),
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    assert_ne!(purchase.asset.id, old_item);
    let after = s.record(&old_item).unwrap().unwrap();
    assert_eq!(after.asset.revision, old_rev, "no lifecycle rewrite");
    assert_eq!(
        after.lifecycle.state,
        thingary_lib::lifecycle::State::Active
    );
    // The wish itself is unchanged: purchase is a plain save, not a decision.
    let wish_after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(wish_after.decision_state, "considering");
    assert_eq!(wish_after.replacement_asset.as_ref().unwrap().id, old_item);
    // Retiring the old item never cancels the wish relation either.
    s.change_lifecycle(
        &thingary_lib::lifecycle::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: old_item.clone(),
            expected_revision: after.asset.revision,
            action: thingary_lib::lifecycle::Action::Append {
                kind: thingary_lib::lifecycle::Kind::Retire,
                date: TODAY.into(),
                notes: String::new(),
            },
        },
        TODAY,
    )
    .unwrap();
    let wish_final = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(wish_final.replacement_asset.as_ref().unwrap().id, old_item);
    assert!(linked.converted_asset.is_none());
    let retired = s.record(&old_item).unwrap().unwrap();
    s.change_sale(
        &thingary_lib::sales::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: old_item.clone(),
            expected_revision: retired.asset.revision,
            action: thingary_lib::sales::Action::Sell {
                fields: thingary_lib::sales::Fields {
                    date: TODAY.into(),
                    price_cents: "10000".into(),
                    platform: String::new(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    let sold_wish = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(sold_wish.decision_state, "considering");
    assert_eq!(sold_wish.replacement_asset.unwrap().id, old_item);
}

#[test]
fn c02_soft_delete_keeps_the_relation_and_restore_brings_it_back() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (item, rev) = asset(&mut s, "虚构考虑替换的椅子", None);
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构换椅子心愿"), TODAY)
        .unwrap();
    let linked = edit_replacement(&mut s, &wish.id, wish.revision, Some(&item)).unwrap();
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: item.clone(),
        expected_revision: rev,
        deleted: true,
    })
    .unwrap();
    let deleted = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert!(deleted.replacement_asset.as_ref().unwrap().deleted);
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: item.clone(),
        expected_revision: rev + 1,
        deleted: false,
    })
    .unwrap();
    let restored = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert!(!restored.replacement_asset.as_ref().unwrap().deleted);
    let _ = linked;
}

#[test]
fn c02_permanent_delete_clears_the_fk_and_keeps_the_display_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (item, rev) = asset(&mut s, "虚构将永久删除的台灯", None);
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构换台灯心愿"), TODAY)
        .unwrap();
    edit_replacement(&mut s, &wish.id, wish.revision, Some(&item)).unwrap();
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: item.clone(),
        expected_revision: rev,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("asset".into()),
        id: item.clone(),
    })
    .unwrap();
    let stale = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert!(stale.replacement_asset.is_none(), "no dangling FK");
    assert_eq!(stale.replacement_asset_name, "虚构将永久删除的台灯");
    // The stale relation is clearable through the same edit path.
    let mut clear = wish_save(&s, "虚构换台灯心愿");
    clear.id = Some(wish.id.clone());
    clear.expected_revision = Some(stale.revision);
    clear.clear_replacement = true;
    let cleared = s.save_wish_plan(&clear, TODAY).unwrap();
    assert!(cleared.replacement_asset.is_none());
    assert_eq!(cleared.replacement_asset_name, "");
}

#[test]
fn c01_backup_roundtrip_and_schema27_upgrade_preserve_relations() {
    // A schema-27 library (pre-relation) migrates cleanly, and a schema-28
    // backup restores the relation with its item.
    let dir = tempfile::tempdir().unwrap();
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 27, &|_| Ok(())).unwrap();
    let wid = uuid::Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO wishlist_items(id,name,estimated_price_cents,external_link,notes,status,decision_state,decision_note,revision,created_at,updated_at,abandoned_at) VALUES(?1,'旧库心愿',NULL,'','','ongoing','considering','',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL)",
        [&wid],
    )
    .unwrap();
    migrate_to(&c, SCHEMA_VERSION, &|_| Ok(())).unwrap();
    let cols: Vec<String> = c
        .prepare("SELECT name FROM pragma_table_info('wishlist_items')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(cols.contains(&"replacement_asset_id".to_string()));

    let mut s = Store::open(&dir.path().join("lib")).unwrap();
    let (item, _) = asset(&mut s, "虚构备份旧物", Some("50000"));
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构备份心愿"), TODAY)
        .unwrap();
    let linked = edit_replacement(&mut s, &wish.id, wish.revision, Some(&item)).unwrap();
    let archive = dir.path().join("c.thingary");
    s.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    let after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(after.replacement_asset.as_ref().unwrap().id, item);
    assert!(!after.replacement_asset.as_ref().unwrap().deleted);
    drop(s);
    let reopened = Store::open(&dir.path().join("lib")).unwrap();
    let reopened = reopened.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(reopened.replacement_asset.as_ref().unwrap().id, item);
    let _ = linked;
}

#[test]
fn c02_stale_relation_name_survives_backup_of_a_purged_target() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (item, rev) = asset(&mut s, "虚构易删旧机", None);
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构换机心愿"), TODAY)
        .unwrap();
    edit_replacement(&mut s, &wish.id, wish.revision, Some(&item)).unwrap();
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: item.clone(),
        expected_revision: rev,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("asset".into()),
        id: item.clone(),
    })
    .unwrap();
    let archive = dir.path().join("stale.thingary");
    s.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    let after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert!(after.replacement_asset.is_none());
    assert_eq!(after.replacement_asset_name, "虚构易删旧机");
}

#[test]
fn schema28_rolls_back_cleanly() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 27, &|_| Ok(())).unwrap();
    c.execute("INSERT INTO wishlist_items(id,name,external_link,notes,status,decision_state,decision_note,revision,created_at,updated_at) VALUES('w','旧心愿','','','ongoing','considering','',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')", params![]).unwrap();
    c.execute(
        "INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES('a','旧物',NULL,'2026-09-01',1)",
        params![],
    )
    .unwrap();
    assert!(
        thingary_lib::storage::migrate_to(&c, SCHEMA_VERSION, &|_| Err(
            thingary_lib::domain::Error::new("INJECTED", "中断")
        ))
        .is_err()
    );
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        27
    );
    let has_col: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('wishlist_items') WHERE name='replacement_asset_id')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!has_col);
    thingary_lib::storage::migrate_to(&c, SCHEMA_VERSION, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
}

#[test]
fn editing_other_fields_keeps_a_soft_deleted_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (id, revision) = asset(&mut s, "虚构旧物", None);
    let wish = s.save_wish_plan(&wish_save(&s, "虚构心愿"), TODAY).unwrap();
    let linked = edit_replacement(&mut s, &wish.id, wish.revision, Some(&id)).unwrap();
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.clone(),
        expected_revision: revision,
        deleted: true,
    })
    .unwrap();
    let edited = edit_replacement(&mut s, &wish.id, linked.revision, Some(&id)).unwrap();
    assert!(edited.replacement_asset.unwrap().deleted);
}

#[test]
fn editing_other_fields_keeps_a_purged_replacement_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (id, revision) = asset(&mut s, "虚构旧物", None);
    let wish = s.save_wish_plan(&wish_save(&s, "虚构心愿"), TODAY).unwrap();
    edit_replacement(&mut s, &wish.id, wish.revision, Some(&id)).unwrap();
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.clone(),
        expected_revision: revision,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("asset".into()),
        id,
    })
    .unwrap();
    let purged = s.wishlist_item(&wish.id).unwrap().unwrap();
    let edited = edit_replacement(&mut s, &wish.id, purged.revision, None).unwrap();
    assert_eq!(edited.replacement_asset_name, "虚构旧物");
}

#[test]
fn confirmed_purchase_keeps_the_old_item_and_replacement_relation() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (id, revision) = asset(&mut s, "虚构旧物", None);
    let wish = s.save_wish_plan(&wish_save(&s, "虚构新物"), TODAY).unwrap();
    let linked = edit_replacement(&mut s, &wish.id, wish.revision, Some(&id)).unwrap();
    let purchase = s
        .convert_wishlist(
            &thingary_lib::wishlist::Convert {
                wishlist_id: wish.id.clone(),
                expected_revision: linked.revision,
                asset: SaveAsset {
                    options: None,
                    base: AssetSave {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        generation: s.generation(),
                        asset_id: None,
                        expected_revision: None,
                        name: "虚构新物".into(),
                        price_cents: Some("12000".into()),
                        purchase_date: Some(TODAY.into()),
                    },
                    details: Details::default(),
                    photos: None,
                    classification: None,
                },
            },
            TODAY,
        )
        .unwrap();
    let after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(after.decision_state, "purchased");
    assert_eq!(
        after.converted_asset.as_ref().unwrap().id,
        purchase.asset.id
    );
    assert_eq!(after.replacement_asset.as_ref().unwrap().id, id);
    let old = s.record(&id).unwrap().unwrap();
    assert_eq!(old.asset.revision, revision);
    assert_eq!(old.lifecycle.state, thingary_lib::lifecycle::State::Active);
    assert_eq!(old.costs.total_investment_cents, None);
}

#[test]
fn replacement_failure_is_atomic_and_receipt_replay_keeps_revision() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (id, revision) = asset(&mut s, "虚构旧物", None);
    let input = WishSave {
        replacement_asset_id: Some(id.clone()),
        ..wish_save(&s, "虚构心愿")
    };
    s.set_hook(|p| {
        if p == "wish_plan.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert!(s.save_wish_plan(&input, TODAY).is_err());
    assert!(s
        .saved_wish_feature(&input.request_id, &s.generation())
        .unwrap()
        .is_none());
    s.set_hook(|_| Ok(()));
    let linked = s.save_wish_plan(&input, TODAY).unwrap();
    let replay = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!((linked.id, linked.revision), (replay.id, replay.revision));
    assert_eq!(s.record(&id).unwrap().unwrap().asset.revision, revision);
    let bytes = serde_json::to_string(&input).unwrap();
    assert!(
        !bytes.contains("clear_replacement"),
        "default false keeps the original C receipt fingerprint"
    );
}

#[test]
fn pre_replacement_wish_plan_receipt_replays_without_new_writes() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let input = wish_save(&s, "虚构旧版本心愿");
    let saved = s.save_wish_plan(&input, TODAY).unwrap();
    // The old Save struct ended before the C-stage replacement field.
    let old_bytes = serde_json::to_string(&("wish_plan", &input))
        .unwrap()
        .replace(",\"replacement_asset_id\":null", "");
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let c = Connection::open(
        dir.path()
            .join("datasets")
            .join(active["id"].as_str().unwrap())
            .join("data.sqlite"),
    )
    .unwrap();
    c.execute(
        "UPDATE feature_requests SET fingerprint=?2 WHERE id=?1",
        params![
            input.request_id,
            format!("{:x}", Sha256::digest(old_bytes.as_bytes()))
        ],
    )
    .unwrap();
    let replay = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!((saved.id, saved.revision), (replay.id, replay.revision));
    let mut different = input;
    different.fields.notes = "changed".into();
    assert_eq!(
        s.save_wish_plan(&different, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
}
