use thingary_lib::{
    photos::Selection,
    storage::Store,
    wish_plan::{Preferences, Save, Saving},
    wishlist::Fields,
};
const TODAY: &str = "2026-09-27";
fn wish(s: &Store) -> Save {
    Save {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: Fields {
            name: "虚构攒钱心愿".into(),
            category_id: None,
            estimated_price_cents: Some("10000".into()),
            priority: None,
            target_date: None,
            external_link: String::new(),
            notes: String::new(),
        },
        preferences: Preferences {
            mode: "savings".into(),
            ..Default::default()
        },
        photos: Selection {
            ids: vec![],
            cover_id: None,
        },
        status_intent: "preserve".into(),
        achieved_date: None,
    }
}
fn saving(s: &Store, w: &thingary_lib::wishlist::WishlistItem, mode: &str, cents: &str) -> Saving {
    Saving {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        id: w.id.clone(),
        expected_revision: w.revision,
        mode: mode.into(),
        cents: cents.into(),
    }
}
#[test]
fn savings_reaches_and_reverts_with_recoverable_asset() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.status, "ongoing");
    let a = saving(&s, &w, "add", "10000");
    let w = s.save_wish_savings(&a, TODAY).unwrap();
    assert_eq!(w.status, "achieved");
    assert_eq!(w.preferences.achievement_source.as_deref(), Some("savings"));
    let first_asset = w.converted_asset.as_ref().unwrap().id.clone();
    assert!(s.asset(&first_asset).unwrap().is_some());
    assert_eq!(s.count().unwrap(), 1);
    assert_eq!(s.save_wish_savings(&a, TODAY).unwrap().revision, w.revision);
    let correction = saving(&s, &w, "total", "9999");
    let w = s.save_wish_savings(&correction, TODAY).unwrap();
    assert_eq!(w.status, "ongoing");
    assert!(w.achieved_at.is_none());
    assert!(w.converted_asset.is_none());
    assert!(s.first_asset().unwrap().is_none());
    let w = s
        .save_wish_savings(&saving(&s, &w, "add", "1"), TODAY)
        .unwrap();
    assert_eq!(w.status, "achieved");
    assert_ne!(w.converted_asset.as_ref().unwrap().id, first_asset);
    input.id = Some(w.id);
    input.expected_revision = Some(w.revision);
    input.preferences = w.preferences;
    input.fields.estimated_price_cents = Some("20000".into());
    input.request_id = uuid::Uuid::new_v4().to_string();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.status, "ongoing");
    input.expected_revision = Some(w.revision);
    input.status_intent = "manual".into();
    input.request_id = uuid::Uuid::new_v4().to_string();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    let w = s
        .save_wish_savings(&saving(&s, &w, "total", "0"), TODAY)
        .unwrap();
    assert_eq!(w.status, "achieved");
    assert_eq!(w.preferences.achievement_source.as_deref(), Some("manual"));
    let id = w.id;
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(s.wishlist_item(&id).unwrap().unwrap().status, "achieved");
}
#[test]
fn manual_achievement_keeps_wish_and_creates_categorized_asset_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let category = s.taxonomy_snapshot().unwrap().categories[0].id.clone();
    let image = s.prepare_material("icon-phone", &s.generation()).unwrap();
    let mut input = wish(&s);
    input.fields.name = "虚构手机心愿".into();
    input.fields.category_id = Some(category.clone());
    input.preferences.mode = "countdown".into();
    input.photos = Selection {
        ids: vec![image.id.clone()],
        cover_id: Some(image.id),
    };
    input.status_intent = "manual".into();
    let wish = s.save_wish_plan(&input, TODAY).unwrap();
    let linked = wish.converted_asset.as_ref().unwrap();
    assert_eq!(wish.status, "achieved");
    assert_eq!(s.count().unwrap(), 1);
    let asset = s.record(&linked.id).unwrap().unwrap();
    assert_eq!(asset.asset.name, wish.fields.name);
    assert!(
        asset.asset.price_cents.is_none(),
        "wish estimate is not actual purchase price"
    );
    assert_eq!(
        asset.classification.category_id.as_deref(),
        Some(category.as_str())
    );
    assert_eq!(asset.details.notes, "手动实现心愿");
    assert_eq!(asset.photos.len(), 1);
    assert_eq!(asset.origin_wishlist.unwrap().id, wish.id);
    let replay = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(replay.converted_asset.unwrap().id, linked.id);
    assert_eq!(s.count().unwrap(), 1);
}
#[test]
fn legacy_achieved_wish_is_backfilled_once_on_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.status_intent = "manual".into();
    let wish = s.save_wish_plan(&input, TODAY).unwrap();
    let old_asset = wish.converted_asset.as_ref().unwrap().id.clone();
    drop(s);
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let db_path = dir
        .path()
        .join("datasets")
        .join(active["id"].as_str().unwrap())
        .join("data.sqlite");
    let db = rusqlite::Connection::open(db_path).unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; DROP TRIGGER wishlist_achievement_update;")
        .unwrap();
    db.execute(
        "UPDATE wishlist_items SET converted_asset_id=NULL WHERE id=?1",
        [&wish.id],
    )
    .unwrap();
    db.execute(
        "UPDATE assets SET deleted_at='2026-09-27T00:00:00Z' WHERE id=?1",
        [&old_asset],
    )
    .unwrap();
    db.execute_batch("DROP TABLE plan_rates; DROP TABLE virtual_assets; DROP TABLE plan_payments; DROP TABLE recurring_plans; DROP TABLE expenses; DROP TABLE fin_snapshot_entries; DROP TABLE fin_snapshots; DROP TABLE fin_accounts; ALTER TABLE wishlist_items DROP COLUMN deleted_at; CREATE TRIGGER wishlist_achievement_update BEFORE UPDATE ON wishlist_items WHEN (NEW.status='achieved') IS NOT (NEW.achieved_at IS NOT NULL) OR (NEW.converted_asset_id IS NOT NULL AND NEW.status!='achieved') OR (OLD.converted_asset_id IS NOT NULL AND (NEW.converted_asset_id IS NOT OLD.converted_asset_id OR NEW.achieved_at IS NOT OLD.achieved_at)) BEGIN SELECT RAISE(ABORT,'wishlist achievement state'); END; PRAGMA user_version=13;").unwrap();
    drop(db);
    let s = Store::open(dir.path()).unwrap();
    let linked = s
        .wishlist_item(&wish.id)
        .unwrap()
        .unwrap()
        .converted_asset
        .unwrap()
        .id;
    assert_ne!(linked, old_asset);
    assert_eq!(s.first_asset().unwrap().unwrap().id, linked);
    assert_eq!(s.count().unwrap(), 2);
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(
        s.wishlist_item(&wish.id)
            .unwrap()
            .unwrap()
            .converted_asset
            .unwrap()
            .id,
        linked
    );
    assert_eq!(s.count().unwrap(), 2);
}
#[test]
fn savings_caps_the_last_addition_and_rejects_more_after_completion() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let initial = wish(&s);
    let w = s.save_wish_plan(&initial, TODAY).unwrap();
    let w = s
        .save_wish_savings(&saving(&s, &w, "add", "7500"), TODAY)
        .unwrap();
    let final_add = saving(&s, &w, "add", "10000");
    let achieved = s.save_wish_savings(&final_add, TODAY).unwrap();
    assert_eq!(achieved.status, "achieved");
    assert_eq!(achieved.preferences.saved_cents, "10000");
    let all = s
        .query_wishlist(&thingary_lib::wishlist::Query {
            search: String::new(),
            filter: "all".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
        })
        .unwrap();
    assert_eq!(all.total, 1);
    assert_eq!(all.items[0].id, achieved.id);
    assert_eq!(
        s.save_wish_savings(&final_add, TODAY).unwrap().revision,
        achieved.revision
    );
    assert!(s
        .save_wish_savings(&saving(&s, &achieved, "add", "1"), TODAY)
        .is_err());
    let corrected = s
        .save_wish_savings(&saving(&s, &achieved, "total", "9999"), TODAY)
        .unwrap();
    assert_eq!(corrected.status, "ongoing");
    assert!(corrected.converted_asset.is_none());
    assert!(s.first_asset().unwrap().is_none());
}
#[test]
fn wish_photos_edit_replay_and_backup_preserve_independent_copies() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = s.prepare_material("icon-phone", &s.generation()).unwrap();
    let b = s
        .prepare_material("object3d-plant", &s.generation())
        .unwrap();
    let mut input = wish(&s);
    input.photos = Selection {
        ids: vec![a.id.clone(), b.id.clone()],
        cover_id: Some(a.id.clone()),
    };
    input.preferences.saved_cents = "10000".into();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.photos.len(), 2);
    input.id = Some(w.id.clone());
    input.expected_revision = Some(w.revision);
    input.request_id = uuid::Uuid::new_v4().to_string();
    input.fields.notes = "改备注保留原图".into();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.photos.len(), 2);
    assert!(s.photo_preview(&a.id, &s.generation()).is_ok());
    let archive = dir.path().join("test.thingary");
    s.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut target = Store::open(other.path()).unwrap();
    target
        .restore(&archive, &hash, &target.generation())
        .unwrap();
    assert_eq!(
        target.wishlist_item(&w.id).unwrap().unwrap().photos.len(),
        2
    );
}
#[test]
fn unknown_target_never_auto_achieves_and_atomic_errors_leave_no_wish() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.fields.estimated_price_cents = None;
    input.preferences.saved_cents = "10000".into();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.status, "ongoing");
    let mut bad = wish(&s);
    bad.preferences.channel_id = Some("missing".into());
    assert!(s.save_wish_plan(&bad, TODAY).is_err());
    assert_eq!(
        s.query_wishlist(&thingary_lib::wishlist::Query {
            search: "".into(),
            filter: "ongoing".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
        })
        .unwrap()
        .total,
        1
    );
}
#[test]
fn asset_options_history_exclusions_pin_and_backup_are_atomic() {
    use thingary_lib::{
        catalog::{Details, Query, SaveAsset},
        domain::Save as AssetSave,
        preferences::{AssetOptions, AssetPreferences, Exclusions, NewWarranty, Reminder},
        sales,
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = SaveAsset {
        base: AssetSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构测试相机".into(),
            price_cents: Some("10000".into()),
            purchase_date: Some("2026-09-01".into()),
        },
        details: Details::default(),
        photos: None,
        classification: None,
        options: Some(AssetOptions {
            preferences: AssetPreferences {
                cost_mode: "per_use".into(),
                use_count: 4,
                pinned: true,
                exclude: Exclusions {
                    total: true,
                    daily: true,
                    statistics: true,
                    timeline: true,
                },
                ..Default::default()
            },
            warranty: Some(NewWarranty {
                start_date: Some("2026-09-01".into()),
                end_date: "2027-09-01".into(),
                reminder: Some(Reminder {
                    date: "2027-08-25".into(),
                    notes: "虚构提醒".into(),
                }),
            }),
            retired_date: Some("2026-09-20".into()),
            sale: Some(sales::Fields {
                date: "2026-09-25".into(),
                price_cents: "2000".into(),
                platform: "闲鱼".into(),
                buyer: String::new(),
                notes: String::new(),
            }),
        }),
    };
    let r = s.save_asset(&input, TODAY).unwrap();
    assert_eq!(r.per_use_cents.as_deref(), Some("2000"));
    assert_eq!(r.warranties.len(), 1);
    assert_eq!(r.lifecycle.events.len(), 1);
    assert!(r.sale.is_some());
    assert_eq!(s.reminder_plans().unwrap().len(), 1);
    assert_eq!(s.overview("history", TODAY).unwrap().sold_count, 0);
    assert_eq!(s.purchase_trend("month", TODAY).unwrap().known_cents, "0");
    assert!(s
        .timeline(
            &thingary_lib::timeline::Query {
                filter: "all".into(),
                asset_id: None
            },
            TODAY
        )
        .unwrap()
        .dated
        .is_empty());
    assert!(!s
        .timeline(
            &thingary_lib::timeline::Query {
                filter: "all".into(),
                asset_id: Some(r.asset.id.clone())
            },
            TODAY
        )
        .unwrap()
        .dated
        .is_empty());
    assert_eq!(
        s.query_assets(
            &Query {
                search: "".into(),
                filter: "all".into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
                category: Default::default(),
                warranty: "all".into(),
                label: None,
            },
            TODAY
        )
        .unwrap()
        .total,
        1
    );
    let archive = dir.path().join("options.thingary");
    s.backup(Some(&archive)).unwrap();
    input.base.request_id = uuid::Uuid::new_v4().to_string();
    input.options.as_mut().unwrap().retired_date = Some("2020-01-01".into());
    assert!(s.save_asset(&input, TODAY).is_err());
    assert_eq!(s.count().unwrap(), 1);
}
#[test]
fn wishlist_lost_reply_and_failure_do_not_duplicate() {
    use thingary_lib::domain::Error;
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let input = wish(&s);
    s.set_hook(|p| {
        if p == "wish_plan.before_commit" {
            Err(Error::new("INJECTED", "test"))
        } else {
            Ok(())
        }
    });
    assert!(s.save_wish_plan(&input, TODAY).is_err());
    assert!(s
        .saved_wish_feature(&input.request_id, &s.generation())
        .unwrap()
        .is_none());
    s.set_hook(|p| {
        if p == "wish_plan.after_commit" {
            Err(Error::new("INJECTED", "lost reply"))
        } else {
            Ok(())
        }
    });
    assert!(s.save_wish_plan(&input, TODAY).is_err());
    let w = s
        .saved_wish_feature(&input.request_id, &s.generation())
        .unwrap()
        .unwrap();
    s.set_hook(|_| Ok(()));
    let next = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.id, next.id);
    let input = saving(&s, &w, "add", "100");
    s.set_hook(|p| {
        if p == "wish_plan.after_commit" {
            Err(Error::new("INJECTED", "lost reply"))
        } else {
            Ok(())
        }
    });
    assert!(s.save_wish_savings(&input, TODAY).is_err());
    assert_eq!(
        s.saved_wish_feature(&input.request_id, &s.generation())
            .unwrap()
            .unwrap()
            .preferences
            .saved_cents,
        "100"
    );
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.save_wish_savings(&input, TODAY)
            .unwrap()
            .preferences
            .saved_cents,
        "100"
    );
}
#[test]
fn managed_choices_order_disable_and_create_preserve_history() {
    use thingary_lib::choices::{Action, Change};
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let snap = s.choices("channel").unwrap();
    assert_eq!(
        snap.items
            .iter()
            .take(4)
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["淘宝", "京东", "拼多多", "抖音"]
    );
    let i = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: snap.revision,
        kind: "channel".into(),
        action: Action::Enable {
            id: snap.items[0].id.clone(),
            enabled: false,
        },
    };
    assert!(!s.change_choices(&i).unwrap().items[0].enabled);
    assert!(!s.change_choices(&i).unwrap().items[0].enabled);
    let snap = s.choices("label").unwrap();
    let i = Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: snap.revision,
        kind: "label".into(),
        action: Action::Create {
            name: "旅行专用".into(),
        },
    };
    let snap = s.change_choices(&i).unwrap();
    assert!(snap.items.iter().any(|e| e.name == "旅行专用"));
}

#[test]
fn schema_twelve_upgrade_rolls_back_and_preserves_old_records() {
    use thingary_lib::{
        domain::Error,
        storage::{migrate_to, SCHEMA},
    };
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 12, &|_| Ok(())).unwrap();
    c.execute("INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES('old','旧虚构物品',12345,'2026-09-01',1)", []).unwrap();
    assert!(migrate_to(&c, 13, &|_| Err(Error::new("INJECTED", "rollback"))).is_err());
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        12
    );
    migrate_to(&c, 13, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row("SELECT price_cents FROM assets WHERE id='old'", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        12345
    );
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM named_choices WHERE kind='sale_channel'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        7
    );
}
#[test]
fn reminders_follow_edits_achievement_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.preferences.mode = "countdown".into();
    input.preferences.reminder = true;
    input.fields.target_date = Some("2027-01-01".into());
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(s.reminder_plans().unwrap()[0].date, "2027-01-01");
    input.id = Some(w.id.clone());
    input.expected_revision = Some(w.revision);
    input.request_id = uuid::Uuid::new_v4().to_string();
    input.fields.target_date = Some("2027-02-01".into());
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(s.reminder_plans().unwrap().len(), 1);
    assert_eq!(s.reminder_plans().unwrap()[0].date, "2027-02-01");
    let archive = dir.path().join("reminder.thingary");
    s.backup(Some(&archive)).unwrap();
    input.expected_revision = Some(w.revision);
    input.request_id = uuid::Uuid::new_v4().to_string();
    input.status_intent = "manual".into();
    s.save_wish_plan(&input, TODAY).unwrap();
    assert!(s.reminder_plans().unwrap().is_empty());
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    assert_eq!(s.reminder_plans().unwrap()[0].date, "2027-02-01");
}
#[test]
fn switching_the_wishlist_off_pauses_only_its_reminders() {
    use thingary_lib::modules::{read, write, Modules};
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let mut s = Store::open(&root).unwrap();
    let mut input = wish(&s);
    input.preferences.mode = "countdown".into();
    input.preferences.reminder = true;
    input.fields.target_date = Some("2027-01-01".into());
    s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(s.reminder_plans().unwrap().len(), 1);
    let off = Modules {
        wishlist: false,
        ..Modules::default()
    };
    write(&root, &off).unwrap();
    assert!(s.reminder_plans().unwrap().is_empty());
    // Other switches do not touch wishlist reminders; the wish itself is kept.
    write(
        &root,
        &Modules {
            stats: false,
            ..Modules::default()
        },
    )
    .unwrap();
    assert_eq!(s.reminder_plans().unwrap().len(), 1);
    assert!(read(&root).wishlist);
}
#[test]
fn explicit_purchase_conversion_still_converts_once() {
    use thingary_lib::{
        catalog::{Details, SaveAsset},
        domain::Save as AssetSave,
        wishlist::Convert,
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.preferences.saved_cents = "9999".into();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    let conversion = Convert {
        wishlist_id: w.id.clone(),
        expected_revision: w.revision,
        asset: SaveAsset {
            options: Some(Default::default()),
            base: AssetSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: w.fields.name.clone(),
                price_cents: Some("9500".into()),
                purchase_date: Some(TODAY.into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
    };
    s.convert_wishlist(&conversion, TODAY).unwrap();
    s.convert_wishlist(&conversion, TODAY).unwrap();
    assert_eq!(s.count().unwrap(), 1);
    let actual = s.wishlist_item(&w.id).unwrap().unwrap();
    assert!(actual.achieved_at.is_some());
    assert!(actual.converted_asset.is_some());
    let w = s
        .save_wish_savings(&saving(&s, &actual, "total", "0"), TODAY)
        .unwrap();
    assert_eq!(w.status, "achieved");
    assert_eq!(
        w.preferences.achievement_source.as_deref(),
        Some("conversion")
    );
    s.backup(Some(&dir.path().join("converted.thingary")))
        .unwrap();
}
