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
            ..Default::default()
        },
        photos: Selection {
            ids: vec![],
            cover_id: None,
        },
        replacement_asset_id: None,
        clear_replacement: false,
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
fn savings_writes_are_retired_but_old_fields_stay_readable() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    // Legacy preferences with a savings amount load, validate and round-trip
    // untouched through an ordinary edit (A16: no auto transitions).
    let mut input = wish(&s);
    input.preferences.mode = Some("savings".into());
    input.preferences.saved_cents = "7500".into();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.decision_state, "considering");
    assert_eq!(w.preferences.saved_cents, "7500");
    input.id = Some(w.id.clone());
    input.expected_revision = Some(w.revision);
    input.request_id = uuid::Uuid::new_v4().to_string();
    input.fields.estimated_price_cents = Some("20000".into());
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.decision_state, "considering");
    assert_eq!(w.status, "ongoing");
    assert_eq!(w.preferences.saved_cents, "7500");
    assert!(s.first_asset().unwrap().is_none());
    // New savings writes are refused with a clear retired-feature message.
    let err = s
        .save_wish_savings(&saving(&s, &w, "add", "100"), TODAY)
        .unwrap_err();
    assert_eq!(err.code, "WISH_SAVINGS_DISABLED");
    let err = s
        .save_wish_savings(&saving(&s, &w, "total", "20000"), TODAY)
        .unwrap_err();
    assert_eq!(err.code, "WISH_SAVINGS_DISABLED");
    assert_eq!(
        s.wishlist_item(&w.id).unwrap().unwrap().revision,
        w.revision
    );
}
#[test]
fn explicit_purchase_creates_categorized_asset_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let category = s.taxonomy_snapshot().unwrap().categories[0].id.clone();
    let image = s.prepare_material("icon-phone", &s.generation()).unwrap();
    let mut input = wish(&s);
    input.fields.name = "虚构手机心愿".into();
    input.fields.category_id = Some(category.clone());
    input.photos = Selection {
        ids: vec![image.id.clone()],
        cover_id: Some(image.id),
    };
    let wish = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(wish.decision_state, "considering");
    // The conversion form stages the wish cover as a fresh asset photo, the
    // same way the production purchase confirmation does.
    let staged = s.stage_wishlist_cover(&wish.id, &s.generation()).unwrap();
    let conversion = thingary_lib::wishlist::Convert {
        wishlist_id: wish.id.clone(),
        expected_revision: wish.revision,
        asset: thingary_lib::catalog::SaveAsset {
            options: Some(Default::default()),
            base: thingary_lib::domain::Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: wish.fields.name.clone(),
                price_cents: None,
                purchase_date: Some(TODAY.into()),
            },
            details: Default::default(),
            photos: Some(Selection {
                ids: vec![staged.id.clone()],
                cover_id: Some(staged.id),
            }),
            classification: Some(thingary_lib::taxonomy::Classification {
                category_id: Some(category.clone()),
                channel_id: None,
            }),
        },
    };
    s.convert_wishlist(&conversion, TODAY).unwrap();
    s.convert_wishlist(&conversion, TODAY).unwrap();
    assert_eq!(s.count().unwrap(), 1);
    let after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(after.decision_state, "purchased");
    let linked = after.converted_asset.as_ref().unwrap();
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
    assert_eq!(asset.photos.len(), 1);
    assert_eq!(asset.origin_wishlist.as_ref().unwrap().id, wish.id);
    assert!(!asset.origin_wishlist.unwrap().legacy);
}
#[test]
fn legacy_achieved_without_link_is_never_backfilled() {
    // The pre-27 code generated an asset when reading an achieved wish with a
    // missing link; that path is retired (§3.6, A12).
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let input = wish(&s);
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let db_path = dir
        .path()
        .join("datasets")
        .join(active["id"].as_str().unwrap())
        .join("data.sqlite");
    let db = rusqlite::Connection::open(db_path).unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    // A schema-27 library that lost its active link (e.g. verified as not
    // purchased) keeps only the read-only historical relation.
    db.execute(
        "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-01T09:00:00+08:00',legacy_generated_at='2026-09-01T09:00:00+08:00' WHERE id=?1",
        [&w.id],
    )
    .unwrap();
    drop(db);
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    let item = s.wishlist_item(&w.id).unwrap().unwrap();
    assert_eq!(item.decision_state, "legacy_achieved");
    assert!(item.converted_asset.is_none());
    assert!(item.legacy_generated_asset.is_none());
    assert!(s.first_asset().unwrap().is_none());
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(
        s.wishlist_item(&w.id).unwrap().unwrap().decision_state,
        "legacy_achieved"
    );
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
    input.replacement_asset_id = None;
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
fn unknown_price_stays_considering_and_atomic_errors_leave_no_wish() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.fields.estimated_price_cents = None;
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    assert_eq!(w.decision_state, "considering");
    let mut bad = wish(&s);
    bad.preferences.channel_id = Some("missing".into());
    assert!(s.save_wish_plan(&bad, TODAY).is_err());
    assert_eq!(
        s.query_wishlist(&thingary_lib::wishlist::Query {
            search: "".into(),
            filter: "considering".into(),
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
}
#[test]
fn old_committed_savings_receipt_resolves_but_never_reexecutes() {
    // A17: a savings request that committed before the upgrade keeps returning
    // its saved historical result; an unknown one is simply refused.
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
    input.preferences.mode = Some("savings".into());
    input.preferences.saved_cents = "5000".into();
    let w = s.save_wish_plan(&input, TODAY).unwrap();
    // An old committed receipt, exactly as the retired command wrote it.
    let request = uuid::Uuid::new_v4().to_string();
    let fingerprint = thingary_lib::storage::Store::digest_for_test(
        &serde_json::to_vec(&(
            "wish_savings",
            Saving {
                request_id: request.clone(),
                generation: s.generation(),
                id: w.id.clone(),
                expected_revision: w.revision,
                mode: "add".into(),
                cents: "100".into(),
            },
        ))
        .unwrap(),
    );
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            rusqlite::params![request, fingerprint, w.id],
        )
        .unwrap();
        db.execute(
            "INSERT INTO feature_audit VALUES(?1,'savings',?2,'{}','2026-09-01T00:00:00Z')",
            rusqlite::params![request, w.id],
        )
        .unwrap();
    }
    // The historical amount lives on in the payload for this check.
    let saved = s
        .saved_wish_feature(&request, &s.generation())
        .unwrap()
        .unwrap();
    assert_eq!(saved.id, w.id);
    assert_eq!(saved.preferences.saved_cents, "5000");
    assert_eq!(saved.decision_state, "considering");
    // Re-sending the same committed request replays the stored result and
    // performs no new write.
    let replay = s
        .save_wish_savings(
            &Saving {
                request_id: request,
                generation: s.generation(),
                id: w.id.clone(),
                expected_revision: w.revision,
                mode: "add".into(),
                cents: "100".into(),
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(replay.preferences.saved_cents, "5000");
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
        kind: "channel".into(),
        action: Action::Create {
            scope: None,
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
fn reminders_follow_edits_purchase_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let mut input = wish(&s);
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
    // An explicit purchase cancels the unsent reminder (§3.5).
    s.convert_wishlist(
        &thingary_lib::wishlist::Convert {
            wishlist_id: w.id.clone(),
            expected_revision: w.revision,
            asset: thingary_lib::catalog::SaveAsset {
                options: None,
                base: thingary_lib::domain::Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: w.fields.name.clone(),
                    price_cents: None,
                    purchase_date: Some(TODAY.into()),
                },
                details: Default::default(),
                photos: None,
                classification: None,
            },
        },
        TODAY,
    )
    .unwrap();
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
    let input = wish(&s);
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
    assert_eq!(actual.decision_state, "purchased");
    assert!(actual.achieved_at.is_some());
    assert!(actual.converted_asset.is_some());
    assert_eq!(actual.purchase_source.as_deref(), Some("confirm_new"));
    // The retired savings write can no longer move a purchased wish.
    assert_eq!(
        s.save_wish_savings(&saving(&s, &actual, "total", "0"), TODAY)
            .unwrap_err()
            .code,
        "WISH_SAVINGS_DISABLED"
    );
    s.backup(Some(&dir.path().join("converted.thingary")))
        .unwrap();
}
