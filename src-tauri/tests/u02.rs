use possio_lib::{
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
fn saving(s: &Store, w: &possio_lib::wishlist::WishlistItem, mode: &str, cents: &str) -> Saving {
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
fn savings_reaches_and_reverts_without_creating_assets() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.status, "ongoing");
    let a = saving(&s, &w, "add", "10000");
    let w = s.save_wish_savings(&a, TODAY).unwrap();
    assert_eq!(w.status, "achieved");
    assert_eq!(w.preferences.achievement_source.as_deref(), Some("savings"));
    assert_eq!(s.count().unwrap(), 0);
    assert_eq!(s.save_wish_savings(&a, TODAY).unwrap().revision, w.revision);
    let correction = saving(&s, &w, "total", "9999");
    let w = s.save_wish_savings(&correction, TODAY).unwrap();
    assert_eq!(w.status, "ongoing");
    assert!(w.achieved_at.is_none());
    let w = s
        .save_wish_savings(&saving(&s, &w, "add", "1"), TODAY)
        .unwrap();
    assert_eq!(w.status, "achieved");
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
        .query_wishlist(&possio_lib::wishlist::Query {
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
    let archive = dir.path().join("test.possio");
    s.backup(Some(&archive)).unwrap();
    let hash = possio_lib::backup::archive_hash(&archive).unwrap();
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
        s.query_wishlist(&possio_lib::wishlist::Query {
            search: "".into(),
            filter: "ongoing".into(),
            sort: "created".into(),
            descending: true,
            offset: 0
        })
        .unwrap()
        .total,
        1
    );
}
#[test]
fn asset_options_history_exclusions_pin_and_backup_are_atomic() {
    use possio_lib::{
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
            &possio_lib::timeline::Query {
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
            &possio_lib::timeline::Query {
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
                warranty: "all".into()
            },
            TODAY
        )
        .unwrap()
        .total,
        1
    );
    let archive = dir.path().join("options.possio");
    s.backup(Some(&archive)).unwrap();
    input.base.request_id = uuid::Uuid::new_v4().to_string();
    input.options.as_mut().unwrap().retired_date = Some("2020-01-01".into());
    assert!(s.save_asset(&input, TODAY).is_err());
    assert_eq!(s.count().unwrap(), 1);
}
#[test]
fn wishlist_lost_reply_and_failure_do_not_duplicate() {
    use possio_lib::domain::Error;
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
    use possio_lib::choices::{Action, Change};
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
    use possio_lib::{
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
    let archive = dir.path().join("reminder.possio");
    s.backup(Some(&archive)).unwrap();
    input.expected_revision = Some(w.revision);
    input.request_id = uuid::Uuid::new_v4().to_string();
    input.status_intent = "manual".into();
    s.save_wish_plan(&input, TODAY).unwrap();
    assert!(s.reminder_plans().unwrap().is_empty());
    let hash = possio_lib::backup::archive_hash(&archive).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    assert_eq!(s.reminder_plans().unwrap()[0].date, "2027-02-01");
}
#[test]
fn automatically_achieved_wish_converts_once_and_keeps_achievement_date() {
    use possio_lib::{
        catalog::{Details, SaveAsset},
        domain::Save as AssetSave,
        wishlist::Convert,
    };
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.preferences.saved_cents = "10000".into();
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
    assert_eq!(actual.achieved_at, w.achieved_at);
    assert!(actual.converted_asset.is_some());
    let w = s
        .save_wish_savings(&saving(&s, &actual, "total", "0"), TODAY)
        .unwrap();
    assert_eq!(w.status, "achieved");
    assert_eq!(
        w.preferences.achievement_source.as_deref(),
        Some("conversion")
    );
    s.backup(Some(&dir.path().join("converted.possio")))
        .unwrap();
}
