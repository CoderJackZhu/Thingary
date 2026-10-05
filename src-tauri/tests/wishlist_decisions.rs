//! Purchase-decision domain and schema-27 migration tests (A06–A18).
use rusqlite::{params, Connection};
use thingary_lib::{
    catalog::{Details, SaveAsset},
    domain::{Error, Save as AssetSave},
    photos::Selection,
    storage::{migrate_to, Store, SCHEMA},
    wish_plan::{Preferences, Save as WishSave},
    wishlist::{Convert, Fields, Link, Verify},
};
const TODAY: &str = "2026-10-05";

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

fn wish_save(s: &Store, name: &str, price: Option<&str>) -> WishSave {
    WishSave {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: fields(name, price),
        preferences: Preferences::default(),
        photos: Selection {
            ids: vec![],
            cover_id: None,
        },
        replacement_asset_id: None,
        clear_replacement: false,
    }
}

fn asset(s: &mut Store, name: &str, price: Option<&str>) -> String {
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
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    record.asset.id
}

fn conversion(wish_id: &str, revision: i64, price: Option<&str>) -> Convert {
    Convert {
        wishlist_id: wish_id.into(),
        expected_revision: revision,
        asset: SaveAsset {
            options: None,
            base: AssetSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: String::new(),
                asset_id: None,
                expected_revision: None,
                name: String::new(),
                price_cents: price.map(str::to_owned),
                purchase_date: Some(TODAY.into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
    }
}

/// Builds a schema-26 library with one wish of every legacy shape, mirroring
/// what the 26→27 migration must classify.
fn legacy_library() -> (tempfile::TempDir, Connection, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let c = Connection::open(dir.path().join("data.sqlite")).unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 26, &|_| Ok(())).unwrap();
    let ids: Vec<String> = ["ongoing", "savings_done", "manual_done", "conversion_done", "no_source", "abandoned"]
        .iter()
        .map(|key| {
            let id = uuid::Uuid::new_v4().to_string();
            // Inserted as ongoing so the v12/v14 triggers see only valid
            // transitions, exactly like the old application produced them.
            c.execute(
                "INSERT INTO wishlist_items(id,name,estimated_price_cents,external_link,notes,status,revision,created_at,updated_at,abandoned_at) VALUES(?1,?2,300000,'','','ongoing',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL)",
                params![id, format!("虚构{key}")],
            )
            .unwrap();
            if *key == "abandoned" {
                c.execute(
                    "UPDATE wishlist_items SET status='abandoned',abandoned_at='2026-09-02T01:00:00+08:00' WHERE id=?1",
                    [&id],
                )
                .unwrap();
            }
            id
        })
        .collect();
    let mut asset_of: Vec<(usize, String)> = Vec::new();
    for (index, key) in [
        "ongoing",
        "savings_done",
        "manual_done",
        "conversion_done",
        "no_source",
        "abandoned",
    ]
    .iter()
    .enumerate()
    {
        if *key == "ongoing" || *key == "abandoned" {
            continue;
        }
        let asset = uuid::Uuid::new_v4().to_string();
        c.execute(
            "INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES(?1,?2,NULL,'2026-09-01',1)",
            params![asset, format!("虚构{key}物品")],
        )
        .unwrap();
        c.execute(
            "UPDATE wishlist_items SET status='achieved',converted_asset_id=?2,achieved_at='2026-09-02T01:00:00+08:00' WHERE id=?1",
            params![ids[index], asset],
        )
        .unwrap();
        asset_of.push((index, asset));
    }
    // The savings wish keeps its old amount and mode; the no-source wish has
    // no preferences row at all.
    c.execute(
        "INSERT INTO wishlist_preferences VALUES(?1,'{\"added_date\":\"2026-08-01\",\"channel_id\":null,\"mode\":\"savings\",\"saved_cents\":\"300000\",\"achievement_source\":\"savings\",\"pinned\":false,\"reminder\":false}')",
        [&ids[1]],
    )
    .unwrap();
    c.execute(
        "INSERT INTO wishlist_preferences VALUES(?1,'{\"added_date\":\"2026-08-01\",\"channel_id\":null,\"mode\":\"countdown\",\"saved_cents\":\"0\",\"achievement_source\":\"manual\",\"pinned\":false,\"reminder\":false}')",
        [&ids[2]],
    )
    .unwrap();
    c.execute(
        "INSERT INTO wishlist_preferences VALUES(?1,'{\"added_date\":\"2026-08-01\",\"channel_id\":null,\"mode\":\"countdown\",\"saved_cents\":\"0\",\"achievement_source\":\"conversion\",\"pinned\":false,\"reminder\":false}')",
        [&ids[3]],
    )
    .unwrap();
    // A live reminder on the considering wish survives; one on the manual
    // purchase must be dropped.
    c.execute(
        "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes) VALUES('keep','wishlist',?1,NULL,'2027-01-01','')",
        [&ids[0]],
    )
    .unwrap();
    c.execute(
        "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes) VALUES('drop-me','wishlist',?1,NULL,'2027-01-01','')",
        [&ids[2]],
    )
    .unwrap();
    (dir, c, ids)
}

#[test]
fn schema_twenty_seven_classifies_legacy_wishes_and_keeps_assets() {
    let (dir, c, ids) = legacy_library();
    let assets_before: Vec<String> = c
        .prepare("SELECT id FROM assets ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    migrate_to(&c, 27, &|_| Ok(())).unwrap();
    let state = |id: &str| -> String {
        c.query_row(
            "SELECT decision_state FROM wishlist_items WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(state(&ids[0]), "considering");
    assert_eq!(state(&ids[1]), "legacy_achieved");
    assert_eq!(state(&ids[2]), "purchased");
    assert_eq!(state(&ids[3]), "purchased");
    assert_eq!(state(&ids[4]), "legacy_achieved");
    assert_eq!(state(&ids[5]), "dropped");
    // Manual/conversion purchases keep the active link; auto/unknown-source
    // ones move to the read-only historical relation.
    for index in [2usize, 3] {
        let linked: Option<String> = c
            .query_row(
                "SELECT converted_asset_id FROM wishlist_items WHERE id=?1",
                [&ids[index]],
                |r| r.get(0),
            )
            .unwrap();
        assert!(linked.is_some(), "purchase keeps its confirmed link");
    }
    for index in [1usize, 4] {
        let (active, legacy): (Option<String>, Option<String>) = c
            .query_row(
                "SELECT converted_asset_id,legacy_generated_asset_id FROM wishlist_items WHERE id=?1",
                [&ids[index]],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(
            active.is_none(),
            "auto-achieved is not a confirmed purchase"
        );
        assert!(legacy.is_some(), "the generated asset stays as history");
    }
    // No asset is deleted, edited or duplicated by the upgrade (A12/A13).
    let assets_after: Vec<String> = c
        .prepare("SELECT id FROM assets ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(assets_before, assets_after);
    // Reminders survive only for wishes still being considered.
    let kept: i64 = c
        .query_row("SELECT count(*) FROM reminders WHERE id='keep'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let dropped: i64 = c
        .query_row(
            "SELECT count(*) FROM reminders WHERE id='drop-me'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!((kept, dropped), (1, 0));
    // The old savings amount is untouched and readable.
    let saved: String = c
        .query_row(
            "SELECT json_extract(payload,'$.saved_cents') FROM wishlist_preferences WHERE wishlist_id=?1",
            [&ids[1]],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(saved, "300000");
    drop(c);
    drop(dir);
}

#[test]
fn schema_twenty_seven_rolls_back_on_interrupted_migration() {
    let (_dir, c, _ids) = legacy_library();
    assert!(migrate_to(&c, 27, &|_| Err(Error::new("INJECTED", "中断"))).is_err());
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        26
    );
    let has_column: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('wishlist_items') WHERE name='decision_state')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!has_column);
    migrate_to(&c, 27, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        27
    );
}

#[test]
fn a06_purchase_confirm_links_exactly_one_asset_and_books_only_actual() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构相机", Some("400000")), TODAY)
        .unwrap();
    let mut input = conversion(&wish.id, wish.revision, Some("360000"));
    input.asset.base.generation = s.generation();
    input.asset.base.name = "虚构相机".into();
    let record = s.convert_wishlist(&input, TODAY).unwrap();
    // Replays resolve to the same single item (A07).
    let replay = s.convert_wishlist(&input, TODAY).unwrap();
    assert_eq!(replay.asset.id, record.asset.id);
    assert_eq!(s.count().unwrap(), 1);
    let after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(after.decision_state, "purchased");
    assert_eq!(after.purchase_source.as_deref(), Some("confirm_new"));
    assert_eq!(after.converted_asset.as_ref().unwrap().id, record.asset.id);
    // The estimate is neither the paid price nor an expense (A06).
    assert_eq!(record.asset.price_cents.as_deref(), Some("360000"));
    let view = s.expense_view(Some(2026)).unwrap();
    assert_eq!(view.spent_cents, "360000");
    // An unknown actual price stays unknown.
    let wish2 = s
        .save_wish_plan(&wish_save(&s, "虚构镜头", Some("100000")), TODAY)
        .unwrap();
    let mut input2 = conversion(&wish2.id, wish2.revision, None);
    input2.asset.base.generation = s.generation();
    input2.asset.base.name = "虚构镜头".into();
    let record2 = s.convert_wishlist(&input2, TODAY).unwrap();
    assert!(record2.asset.price_cents.is_none());
    let view = s.expense_view(Some(2026)).unwrap();
    assert_eq!(view.spent_cents, "360000");
    assert_eq!(view.unknown_amount_count, 1);
}

#[test]
fn a07_faults_around_commit_leave_no_half_purchase() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构无人机", Some("500000")), TODAY)
        .unwrap();
    let mut input = conversion(&wish.id, wish.revision, Some("480000"));
    input.asset.base.generation = s.generation();
    input.asset.base.name = "虚构无人机".into();
    s.set_hook(|p| {
        if p == "convert.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.convert_wishlist(&input, TODAY).unwrap_err().code,
        "INJECTED"
    );
    assert_eq!(s.count().unwrap(), 0);
    assert_eq!(
        s.wishlist_item(&wish.id).unwrap().unwrap().decision_state,
        "considering"
    );
    s.set_hook(|p| {
        if p == "convert.after_commit" {
            Err(Error::new("INJECTED", "回包丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.convert_wishlist(&input, TODAY).unwrap_err().code,
        "INJECTED"
    );
    s.set_hook(|_| Ok(()));
    let resolved = s.convert_wishlist(&input, TODAY).unwrap();
    assert_eq!(s.count().unwrap(), 1);
    drop(s);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(s.count().unwrap(), 1);
    let after = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(after.decision_state, "purchased");
    assert_eq!(
        after.converted_asset.as_ref().unwrap().id,
        resolved.asset.id
    );
}

#[test]
fn a08_linking_picks_the_chosen_id_among_same_names() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let first = asset(&mut s, "虚构同名键盘", Some("89900"));
    let second = asset(&mut s, "虚构同名键盘", Some("129900"));
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构键盘", Some("120000")), TODAY)
        .unwrap();
    let record = s.record(&second).unwrap().unwrap();
    let link = Link {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        wishlist_id: wish.id.clone(),
        expected_revision: wish.revision,
        asset_id: second.clone(),
        expected_asset_revision: record.asset.revision,
    };
    let linked = s.link_wish_asset(&link).unwrap();
    assert_eq!(linked.decision_state, "purchased");
    assert_eq!(linked.purchase_source.as_deref(), Some("confirm_link"));
    assert_eq!(linked.converted_asset.as_ref().unwrap().id, second);
    // Replay resolves; the untouched same-name item stays unrelated.
    s.link_wish_asset(&link).unwrap();
    assert_eq!(s.count().unwrap(), 2);
    assert!(s.record(&first).unwrap().unwrap().origin_wishlist.is_none());
    // Another wish cannot take the same asset.
    let other = s
        .save_wish_plan(&wish_save(&s, "虚构第二心愿", None), TODAY)
        .unwrap();
    let err = s
        .link_wish_asset(&Link {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            wishlist_id: other.id.clone(),
            expected_revision: other.revision,
            asset_id: second.clone(),
            expected_asset_revision: record.asset.revision,
        })
        .unwrap_err();
    assert_eq!(err.code, "WISH_LINK_ASSET");
    // Stale wish revisions conflict without half-links.
    let err = s
        .link_wish_asset(&Link {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            wishlist_id: other.id.clone(),
            expected_revision: other.revision + 5,
            asset_id: first.clone(),
            expected_asset_revision: record.asset.revision,
        })
        .unwrap_err();
    assert_eq!(err.code, "REVISION_CONFLICT");
    let still_open = s.wishlist_item(&other.id).unwrap().unwrap();
    assert!(still_open.converted_asset.is_none());
    // A soft-deleted asset is refused until restored.
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: first.clone(),
        expected_revision: record.asset.revision,
        deleted: true,
    })
    .unwrap();
    let err = s
        .link_wish_asset(&Link {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            wishlist_id: other.id.clone(),
            expected_revision: other.revision,
            asset_id: first.clone(),
            expected_asset_revision: 1,
        })
        .unwrap_err();
    assert_eq!(err.code, "WISH_LINK_ASSET");
}

#[test]
fn a09_linked_asset_lifecycle_never_reopens_the_wish() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构手表", Some("300000")), TODAY)
        .unwrap();
    let mut input = conversion(&wish.id, wish.revision, Some("280000"));
    input.asset.base.generation = s.generation();
    input.asset.base.name = "虚构手表".into();
    let record = s.convert_wishlist(&input, TODAY).unwrap();
    let id = record.asset.id.clone();
    let revision = s.record(&id).unwrap().unwrap().asset.revision;
    // Selling keeps the wish purchased.
    s.change_sale(
        &thingary_lib::sales::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: id.clone(),
            expected_revision: revision,
            action: thingary_lib::sales::Action::Sell {
                fields: thingary_lib::sales::Fields {
                    date: TODAY.into(),
                    price_cents: "100000".into(),
                    platform: "闲鱼".into(),
                    buyer: String::new(),
                    notes: String::new(),
                },
            },
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.wishlist_item(&wish.id).unwrap().unwrap().decision_state,
        "purchased"
    );
    // Soft delete: the wish points at Recently Deleted instead of reopening;
    // restoring brings the very same link back.
    let sold_revision = s.record(&id).unwrap().unwrap().asset.revision;
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.clone(),
        expected_revision: sold_revision,
        deleted: true,
    })
    .unwrap();
    let deleted = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(deleted.decision_state, "purchased");
    assert!(deleted.converted_asset.as_ref().unwrap().deleted);
    // A second, distinct conversion request is refused (no repeat transition);
    // replaying the original request id resolves to the very same item.
    let mut repeat = conversion(&wish.id, deleted.revision, None);
    repeat.asset.base.generation = s.generation();
    repeat.asset.base.name = "虚构手表".into();
    let err = s.convert_wishlist(&repeat, TODAY).map(|_| ()).unwrap_err();
    assert_eq!(err.code, "WISHLIST_ACHIEVED");
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.clone(),
        expected_revision: sold_revision + 1,
        deleted: false,
    })
    .unwrap();
    let restored = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(restored.decision_state, "purchased");
    assert!(!restored.converted_asset.as_ref().unwrap().deleted);
}

#[test]
fn a14_verifying_purchased_reuses_or_restores_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构显示器", Some("300000")), TODAY)
        .unwrap();
    let legacy_asset = asset(&mut s, "虚构显示器", None);
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-02T01:00:00+08:00',purchase_source='legacy_auto' WHERE id=?1",
            params![wish.id, legacy_asset],
        )
        .unwrap();
    }
    // Verify as purchased with a backfilled actual price and date.
    let revision = s.record(&legacy_asset).unwrap().unwrap().asset.revision;
    let verified = s
        .verify_legacy_wish(
            &Verify {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                wishlist_id: wish.id.clone(),
                expected_revision: s.wishlist_item(&wish.id).unwrap().unwrap().revision,
                outcome: "purchased".into(),
                decision_note: String::new(),
                asset_patch: Some(thingary_lib::wishlist::AssetPatch {
                    asset_id: legacy_asset.clone(),
                    expected_revision: revision,
                    price_cents: Some("269900".into()),
                    purchase_date: Some("2026-09-02".into()),
                }),
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(verified.decision_state, "purchased");
    assert_eq!(verified.converted_asset.as_ref().unwrap().id, legacy_asset);
    // No second asset was created and the historical relation persists.
    assert_eq!(s.count().unwrap(), 1);
    assert!(verified.legacy_generated_asset.is_some());
    let record = s.record(&legacy_asset).unwrap().unwrap();
    assert_eq!(record.asset.price_cents.as_deref(), Some("269900"));
    assert_eq!(record.asset.purchase_date.as_deref(), Some("2026-09-02"));
    // A soft-deleted original is restored explicitly by the verification.
    let wish2 = s
        .save_wish_plan(&wish_save(&s, "虚构耳机", Some("200000")), TODAY)
        .unwrap();
    let asset2 = asset(&mut s, "虚构耳机", None);
    let asset2_revision = s.record(&asset2).unwrap().unwrap().asset.revision;
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: asset2.clone(),
        expected_revision: asset2_revision,
        deleted: true,
    })
    .unwrap();
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-02T01:00:00+08:00' WHERE id=?1",
            params![wish2.id, asset2],
        )
        .unwrap();
    }
    let restored = s
        .verify_legacy_wish(
            &Verify {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                wishlist_id: wish2.id.clone(),
                expected_revision: s.wishlist_item(&wish2.id).unwrap().unwrap().revision,
                outcome: "purchased".into(),
                decision_note: String::new(),
                asset_patch: None,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(restored.decision_state, "purchased");
    assert!(!restored.converted_asset.as_ref().unwrap().deleted);
    // Without an original, the verify points to the purchase flow instead.
    let wish3 = s
        .save_wish_plan(&wish_save(&s, "虚构无物心愿", None), TODAY)
        .unwrap();
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T01:00:00+08:00',legacy_generated_at='2026-09-02T01:00:00+08:00' WHERE id=?1",
            [&wish3.id],
        )
        .unwrap();
    }
    let err = s
        .verify_legacy_wish(
            &Verify {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                wishlist_id: wish3.id.clone(),
                expected_revision: s.wishlist_item(&wish3.id).unwrap().unwrap().revision,
                outcome: "purchased".into(),
                decision_note: String::new(),
                asset_patch: None,
            },
            TODAY,
        )
        .unwrap_err();
    assert_eq!(err.code, "WISH_VERIFY");
}

#[test]
fn a15_verify_then_repurchase_via_link_new_or_legacy_reuse() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构平板", Some("500000")), TODAY)
        .unwrap();
    let legacy_asset = asset(&mut s, "虚构平板", None);
    let legacy_revision = s.record(&legacy_asset).unwrap().unwrap().asset.revision;
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-01T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-01T01:00:00+08:00',purchase_source='legacy_auto' WHERE id=?1",
            params![wish.id, legacy_asset],
        )
        .unwrap();
    }
    let revision = s.wishlist_item(&wish.id).unwrap().unwrap().revision;
    let considering = s
        .verify_legacy_wish(
            &Verify {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                wishlist_id: wish.id.clone(),
                expected_revision: revision,
                outcome: "considering".into(),
                decision_note: String::new(),
                asset_patch: None,
            },
            TODAY,
        )
        .unwrap();
    // The active purchase link is cleared while history stays readable.
    assert_eq!(considering.decision_state, "considering");
    assert!(considering.converted_asset.is_none());
    assert!(considering.legacy_generated_asset.is_some());
    // The historical date is preserved, never faked as today.
    assert!(considering.legacy_generated_at.is_some());
    assert!(considering.achieved_at.is_none());
    // The old asset is untouched and still counted once.
    assert_eq!(s.count().unwrap(), 1);
    // A real later purchase may explicitly reuse the legacy archive.
    let reused = s
        .link_wish_asset(&Link {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            wishlist_id: wish.id.clone(),
            expected_revision: considering.revision,
            asset_id: legacy_asset.clone(),
            expected_asset_revision: legacy_revision,
        })
        .unwrap();
    assert_eq!(reused.decision_state, "purchased");
    assert_eq!(reused.purchase_source.as_deref(), Some("legacy_reuse"));
    assert_eq!(reused.converted_asset.as_ref().unwrap().id, legacy_asset);
    assert_eq!(s.count().unwrap(), 1);
    // Dropped legacy records keep the item and the relation read-only.
    let wish2 = s
        .save_wish_plan(&wish_save(&s, "虚构另一台", None), TODAY)
        .unwrap();
    let asset2 = asset(&mut s, "虚构另一台", None);
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-01T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-01T01:00:00+08:00' WHERE id=?1",
            params![wish2.id, asset2],
        )
        .unwrap();
    }
    let dropped = s
        .verify_legacy_wish(
            &Verify {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                wishlist_id: wish2.id.clone(),
                expected_revision: s.wishlist_item(&wish2.id).unwrap().unwrap().revision,
                outcome: "dropped".into(),
                decision_note: "旧记录不再考虑".into(),
                asset_patch: None,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(dropped.decision_state, "dropped");
    assert_eq!(dropped.decision_note, "旧记录不再考虑");
    assert!(dropped.legacy_generated_asset.is_some());
    assert!(s.record(&asset2).unwrap().is_some());
    assert_eq!(s.count().unwrap(), 2);
}

#[test]
fn drop_reconsider_and_page_stats_follow_decisions() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = s
        .save_wish_plan(&wish_save(&s, "虚构考虑中", Some("100000")), TODAY)
        .unwrap();
    let b = s
        .save_wish_plan(&wish_save(&s, "虚构未知价", None), TODAY)
        .unwrap();
    let c = s
        .save_wish_plan(&wish_save(&s, "虚构已放弃", Some("50000")), TODAY)
        .unwrap();
    let dropped = s
        .change_wishlist(&thingary_lib::wishlist::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            expected_revision: Some(c.revision),
            action: thingary_lib::wishlist::Action::Drop {
                wishlist_id: c.id.clone(),
                decision_note: "暂时不买".into(),
            },
        })
        .unwrap();
    assert_eq!(dropped.decision_state, "dropped");
    assert_eq!(dropped.decision_note, "暂时不买");
    // Reconsider keeps the note and allows editing it; no reminder returns.
    let reconsidered = s
        .change_wishlist(&thingary_lib::wishlist::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            expected_revision: Some(dropped.revision),
            action: thingary_lib::wishlist::Action::Reconsider {
                wishlist_id: c.id.clone(),
                decision_note: "重新考虑，理由已更新".into(),
            },
        })
        .unwrap();
    assert_eq!(reconsidered.decision_state, "considering");
    assert_eq!(reconsidered.decision_note, "重新考虑，理由已更新");
    // Purchased wishes leave the considering totals (A10).
    let mut purchase = conversion(&a.id, reconsidered.revision + 1, None);
    purchase.asset.base.generation = s.generation();
    purchase.asset.base.name = "虚构考虑中".into();
    let fresh = s.wishlist_item(&a.id).unwrap().unwrap();
    purchase.expected_revision = fresh.revision;
    s.convert_wishlist(&purchase, TODAY).unwrap();
    let page = s
        .query_wishlist(&thingary_lib::wishlist::Query {
            search: String::new(),
            filter: "all".into(),
            sort: "created".into(),
            descending: true,
            offset: 0,
        })
        .unwrap();
    assert_eq!(page.total, 3);
    assert_eq!(page.considering_known_cents, "50000");
    assert_eq!(page.considering_unknown_count, 1);
    // Filters expose the new states.
    for (filter, expected) in [("considering", 2), ("purchased", 1), ("dropped", 0)] {
        assert_eq!(
            s.query_wishlist(&thingary_lib::wishlist::Query {
                search: String::new(),
                filter: filter.into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
            })
            .unwrap()
            .total,
            expected
        );
    }
    // Decision notes are bounded like every other text field.
    let long: String = "长".repeat(10001);
    let err = s
        .change_wishlist(&thingary_lib::wishlist::Change {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            expected_revision: Some(b.revision),
            action: thingary_lib::wishlist::Action::Drop {
                wishlist_id: b.id.clone(),
                decision_note: long,
            },
        })
        .unwrap_err();
    assert_eq!(err.code, "WISH_DECISION_NOTE");
}

#[test]
fn a18_backup_restore_and_reopen_keep_decision_relations() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构主机", Some("900000")), TODAY)
        .unwrap();
    let mut input = conversion(&wish.id, wish.revision, Some("850000"));
    input.asset.base.generation = s.generation();
    input.asset.base.name = "虚构主机".into();
    let record = s.convert_wishlist(&input, TODAY).unwrap();
    let legacy = s
        .save_wish_plan(&wish_save(&s, "虚构旧攒钱", Some("120000")), TODAY)
        .unwrap();
    let legacy_asset = asset(&mut s, "虚构旧攒钱", None);
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-01T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-01T01:00:00+08:00' WHERE id=?1",
            params![legacy.id, legacy_asset],
        )
        .unwrap();
    }
    let archive = dir.path().join("decisions.thingary");
    s.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    let purchased = s.wishlist_item(&wish.id).unwrap().unwrap();
    assert_eq!(purchased.decision_state, "purchased");
    assert_eq!(
        purchased.converted_asset.as_ref().unwrap().id,
        record.asset.id
    );
    let legacy_after = s.wishlist_item(&legacy.id).unwrap().unwrap();
    assert_eq!(legacy_after.decision_state, "legacy_achieved");
    assert_eq!(
        legacy_after.legacy_generated_asset.as_ref().unwrap().id,
        legacy_asset
    );
    assert_eq!(s.count().unwrap(), 2);
    drop(s);
    let reopened = Store::open(dir.path()).unwrap();
    assert_eq!(
        reopened
            .wishlist_item(&wish.id)
            .unwrap()
            .unwrap()
            .decision_state,
        "purchased"
    );
    assert_eq!(
        reopened
            .wishlist_item(&legacy.id)
            .unwrap()
            .unwrap()
            .decision_state,
        "legacy_achieved"
    );
    assert_eq!(reopened.count().unwrap(), 2);
}

#[test]
fn timeline_labels_legacy_achievements_with_their_own_date() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构旧镜头", Some("80000")), TODAY)
        .unwrap();
    let legacy_asset = asset(&mut s, "虚构旧镜头", None);
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-08-15T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-08-15T01:00:00+08:00' WHERE id=?1",
            params![wish.id, legacy_asset],
        )
        .unwrap();
    }
    let events = s
        .timeline(
            &thingary_lib::timeline::Query {
                filter: "wishlist".into(),
                asset_id: None,
            },
            TODAY,
        )
        .unwrap();
    let achieved = events
        .dated
        .iter()
        .find(|e| e.kind == "wish_achieved")
        .unwrap();
    // The historical date, never the upgrade day, and the legacy marker.
    assert_eq!(achieved.date.as_deref(), Some("2026-08-15"));
    assert_eq!(achieved.note, "legacy_achieved");
    // After verifying as not purchased the fact survives on its own date.
    s.verify_legacy_wish(
        &Verify {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            wishlist_id: wish.id.clone(),
            expected_revision: s.wishlist_item(&wish.id).unwrap().unwrap().revision,
            outcome: "considering".into(),
            decision_note: String::new(),
            asset_patch: None,
        },
        TODAY,
    )
    .unwrap();
    let events = s
        .timeline(
            &thingary_lib::timeline::Query {
                filter: "wishlist".into(),
                asset_id: None,
            },
            TODAY,
        )
        .unwrap();
    let achieved = events
        .dated
        .iter()
        .find(|e| e.kind == "wish_achieved")
        .unwrap();
    assert_eq!(achieved.date.as_deref(), Some("2026-08-15"));
}

#[test]
fn purge_waits_for_legacy_relation_too() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构旧配件", None), TODAY)
        .unwrap();
    let legacy_asset = asset(&mut s, "虚构旧配件", None);
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-01T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-01T01:00:00+08:00' WHERE id=?1",
            params![wish.id, legacy_asset],
        )
        .unwrap();
    }
    let revision = s.record(&legacy_asset).unwrap().unwrap().asset.revision;
    s.change_trash(&thingary_lib::trash::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: legacy_asset.clone(),
        expected_revision: revision,
        deleted: true,
    })
    .unwrap();
    // The historical relation protects the archive from purging, like the
    // active purchase link does.
    let err = s
        .purge_trash(&thingary_lib::purge::Purge {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            kind: Some("asset".into()),
            id: legacy_asset.clone(),
        })
        .unwrap_err();
    assert_eq!(err.code, "WISH_LINKED");
    assert!(s.record(&legacy_asset).unwrap().is_some());
    // Wishes are purged before the items they generated; then it can go.
    let wish_revision = s.wishlist_item(&wish.id).unwrap().unwrap().revision;
    s.wealth_trash(&thingary_lib::wealth::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: "wish".into(),
        id: wish.id.clone(),
        expected_revision: wish_revision,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("wish".into()),
        id: wish.id.clone(),
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("asset".into()),
        id: legacy_asset.clone(),
    })
    .unwrap();
    assert!(s.record(&legacy_asset).unwrap().is_none());
}

#[test]
fn review_p1_notes_only_correction_keeps_recorded_unchanged_amount() {
    // July 100 -> corrected to 200; August was saved as unchanged (100).
    // Correcting only August's notes must keep 100, not re-derive 200 (A22).
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let opened = s
        .wealth_account_save(
            &thingary_lib::wealth::AccountSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::wealth::AccountFields {
                    name: "虚构储蓄卡".into(),
                    institution: "虚构平台".into(),
                    side: "asset".into(),
                    kind: "cash".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: String::new(),
                },
            },
            "2026-07-31",
        )
        .unwrap();
    let id = opened.id.clone();
    let mut save = |request: &str,
                    date: &str,
                    state: &str,
                    cents: Option<&str>,
                    notes: &str,
                    revision: Option<i64>,
                    snap_id: Option<&str>| {
        s.wealth_snapshot_save(
            &thingary_lib::wealth::SnapshotSave {
                request_id: request.into(),
                generation: s.generation(),
                id: snap_id.map(str::to_owned),
                expected_revision: revision,
                date: date.into(),
                notes: notes.into(),
                entries: vec![thingary_lib::wealth::EntryInput {
                    account_id: id.clone(),
                    state: state.into(),
                    amount_cents: cents.map(str::to_owned),
                }],
            },
            "2026-08-31",
        )
        .unwrap()
    };
    let july = save(
        &uuid::Uuid::new_v4().to_string(),
        "2026-07-31",
        "entered",
        Some("10000"),
        "七月备注",
        None,
        None,
    );
    let august = save(
        &uuid::Uuid::new_v4().to_string(),
        "2026-08-31",
        "unchanged",
        None,
        "",
        None,
        None,
    );
    assert_eq!(august.entries[0].amount_cents.as_deref(), Some("10000"));
    // Correct July's amount to 200.
    save(
        &uuid::Uuid::new_v4().to_string(),
        "2026-07-31",
        "entered",
        Some("20000"),
        "七月备注",
        Some(july.revision),
        Some(&july.id),
    );
    // Correct only August's notes; the unchanged row keeps its recorded 100.
    let fixed = save(
        &uuid::Uuid::new_v4().to_string(),
        "2026-08-31",
        "unchanged",
        None,
        "只改备注",
        Some(august.revision),
        Some(&august.id),
    );
    assert_eq!(fixed.notes, "只改备注");
    assert_eq!(fixed.entries[0].amount_cents.as_deref(), Some("10000"));
    // This is the real UI request after toggling “unchanged” again: no
    // intermediate entered save; the explicit displayed amount is submitted.
    let request = uuid::Uuid::new_v4().to_string();
    let after_mark = save(
        &request,
        "2026-08-31",
        "unchanged",
        Some("20000"),
        "只改备注",
        Some(fixed.revision),
        Some(&fixed.id),
    );
    assert_eq!(after_mark.entries[0].amount_cents.as_deref(), Some("20000"));
    assert_eq!(after_mark.entries[0].state, "unchanged");
    // A lost reply replays the same request and does not apply another write.
    let replay = save(
        &request,
        "2026-08-31",
        "unchanged",
        Some("20000"),
        "只改备注",
        Some(fixed.revision),
        Some(&fixed.id),
    );
    assert_eq!(replay.revision, after_mark.revision);
    assert_eq!(replay.entries[0].amount_cents.as_deref(), Some("20000"));
}

#[test]
fn review_p1_verify_patch_without_changes_keeps_item_facts() {
    // The verify form prefills the item's own price/date and submits blanks
    // as null; the backend coalesce must keep the recorded facts.
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构核实质", Some("300000")), TODAY)
        .unwrap();
    let legacy_asset = asset(&mut s, "虚构核实质", Some("269900"));
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE assets SET purchase_date='2026-01-10' WHERE id=?1",
            [&legacy_asset],
        )
        .unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-02T01:00:00+08:00' WHERE id=?1",
            params![wish.id, legacy_asset],
        )
        .unwrap();
    }
    let revision = s.record(&legacy_asset).unwrap().unwrap().asset.revision;
    let verified = s
        .verify_legacy_wish(
            &Verify {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                wishlist_id: wish.id.clone(),
                expected_revision: s.wishlist_item(&wish.id).unwrap().unwrap().revision,
                outcome: "purchased".into(),
                decision_note: String::new(),
                // Nothing edited: both patch fields left empty.
                asset_patch: Some(thingary_lib::wishlist::AssetPatch {
                    asset_id: legacy_asset.clone(),
                    expected_revision: revision,
                    price_cents: None,
                    purchase_date: None,
                }),
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(verified.decision_state, "purchased");
    let record = s.record(&legacy_asset).unwrap().unwrap();
    assert_eq!(record.asset.price_cents.as_deref(), Some("269900"));
    assert_eq!(record.asset.purchase_date.as_deref(), Some("2026-01-10"));
    // An explicit correction still lands.
    let wish2 = s
        .save_wish_plan(&wish_save(&s, "虚构核实质二", None), TODAY)
        .unwrap();
    let asset2 = asset(&mut s, "虚构核实质二", None);
    {
        let db = s.conn_for_test().unwrap();
        db.execute(
            "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T01:00:00+08:00',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-02T01:00:00+08:00' WHERE id=?1",
            params![wish2.id, asset2],
        )
        .unwrap();
    }
    let revision2 = s.record(&asset2).unwrap().unwrap().asset.revision;
    s.verify_legacy_wish(
        &Verify {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            wishlist_id: wish2.id.clone(),
            expected_revision: s.wishlist_item(&wish2.id).unwrap().unwrap().revision,
            outcome: "purchased".into(),
            decision_note: String::new(),
            asset_patch: Some(thingary_lib::wishlist::AssetPatch {
                asset_id: asset2.clone(),
                expected_revision: revision2,
                price_cents: Some("199900".into()),
                purchase_date: Some("2026-03-01".into()),
            }),
        },
        TODAY,
    )
    .unwrap();
    let record2 = s.record(&asset2).unwrap().unwrap();
    assert_eq!(record2.asset.price_cents.as_deref(), Some("199900"));
    assert_eq!(record2.asset.purchase_date.as_deref(), Some("2026-03-01"));
}

#[test]
fn review_p1_manual_achievement_without_link_becomes_pending_verification() {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("manual-v26.sqlite");
    let c = Connection::open(&path).unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 26, &|_| Ok(())).unwrap();
    let wid = uuid::Uuid::new_v4().to_string();
    // Keep all schema triggers: this must be a genuinely valid old backup.
    c.execute(
        "INSERT INTO wishlist_items(id,name,estimated_price_cents,external_link,notes,status,revision,created_at,updated_at,abandoned_at) VALUES(?1,'旧版手动实现',150000,'','','ongoing',1,'2026-08-01T00:00:00Z','2026-08-02T00:00:00Z',NULL)", [&wid],
    ).unwrap();
    c.execute("UPDATE wishlist_items SET status='achieved',achieved_at='2026-08-02T01:00:00+08:00',revision=2 WHERE id=?1", [&wid]).unwrap();
    c.execute(
        "INSERT INTO wishlist_preferences VALUES(?1,'{\"added_date\":\"2026-08-01\",\"channel_id\":null,\"mode\":\"countdown\",\"saved_cents\":\"0\",\"achievement_source\":\"manual\",\"pinned\":false,\"reminder\":false}')", [&wid],
    ).unwrap();
    let request = uuid::Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO feature_audit VALUES(?1,'wishlist',?2,'{}','2026-08-02T01:00:00+08:00')",
        params![request, wid],
    )
    .unwrap();
    c.execute(
        "INSERT INTO feature_requests VALUES(?1,?2,?3)",
        params![request, "0".repeat(64), wid],
    )
    .unwrap();
    c.close().unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":26,"created_at":"2026-08-02T02:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let archive = dir.path().join("manual-v26.thingary");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("manifest.json", options).unwrap();
    zip.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    zip.start_file("data.sqlite", options).unwrap();
    zip.write_all(&bytes).unwrap();
    zip.finish().unwrap();
    let mut s = Store::open(&dir.path().join("destination")).unwrap();
    let inspected = s.inspect_backup(&archive).unwrap();
    assert_eq!((inspected.schema, inspected.wishes), (26, 1));
    s.restore(&archive, &inspected.hash, &s.generation())
        .unwrap();
    let restored = s.wishlist_item(&wid).unwrap().unwrap();
    assert_eq!(restored.decision_state, "legacy_achieved");
    assert!(restored.legacy_generated_asset.is_none());
    assert!(restored.converted_asset.is_none());
    assert_eq!(
        restored.legacy_generated_at.as_deref(),
        Some("2026-08-02T01:00:00+08:00")
    );
    assert_eq!(s.count().unwrap(), 0);
    for filter in ["all", "considering"] {
        let page = s
            .query_wishlist(&thingary_lib::wishlist::Query {
                search: String::new(),
                filter: filter.into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
            })
            .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, wid);
    }
    let checked = dir.path().join("restored.thingary");
    s.backup(Some(&checked)).unwrap();
    assert_eq!(s.inspect_backup(&checked).unwrap().wishes, 1);
}

#[test]
fn review_verify_changed_fields_reject_stale_prefill_revision() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let wish = s
        .save_wish_plan(&wish_save(&s, "虚构核实冲突", None), TODAY)
        .unwrap();
    let original = asset(&mut s, "虚构原物品", Some("50000"));
    let before = s.record(&original).unwrap().unwrap();
    s.conn_for_test().unwrap().execute(
        "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T00:00:00Z',legacy_generated_asset_id=?2,legacy_generated_at='2026-09-02T00:00:00Z' WHERE id=?1",
        params![wish.id, original],
    ).unwrap();
    // A later correction occurred after the form loaded its baseline.
    s.conn_for_test().unwrap().execute(
        "UPDATE assets SET price_cents=90000,purchase_date='2026-02-10',revision=revision+1 WHERE id=?1",
        [&original],
    ).unwrap();
    let request = uuid::Uuid::new_v4().to_string();
    let error = s
        .verify_legacy_wish(
            &Verify {
                request_id: request.clone(),
                generation: s.generation(),
                wishlist_id: wish.id.clone(),
                expected_revision: wish.revision,
                outcome: "purchased".into(),
                decision_note: String::new(),
                asset_patch: Some(thingary_lib::wishlist::AssetPatch {
                    asset_id: original.clone(),
                    expected_revision: before.asset.revision,
                    price_cents: Some("60000".into()),
                    purchase_date: None,
                }),
            },
            TODAY,
        )
        .unwrap_err();
    assert_eq!(error.code, "REVISION_CONFLICT");
    let after = s.record(&original).unwrap().unwrap();
    assert_eq!(after.asset.price_cents.as_deref(), Some("90000"));
    assert_eq!(after.asset.purchase_date.as_deref(), Some("2026-02-10"));
    assert_eq!(
        s.wishlist_item(&wish.id).unwrap().unwrap().decision_state,
        "legacy_achieved"
    );
    assert!(s
        .saved_wish_feature(&request, &s.generation())
        .unwrap()
        .is_none());
}

#[test]
fn native_review_legacy_wishes_are_visible_in_all_and_considering() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let legacy = s
        .save_wish_plan(&wish_save(&s, "虚构历史待核实", Some("400000")), TODAY)
        .unwrap();
    let normal = s
        .save_wish_plan(&wish_save(&s, "虚构正常考虑", Some("100000")), TODAY)
        .unwrap();
    s.conn_for_test().unwrap().execute(
        "UPDATE wishlist_items SET decision_state='legacy_achieved',status='achieved',achieved_at='2026-09-02T00:00:00Z',legacy_generated_at='2026-09-02T00:00:00Z' WHERE id=?1", [&legacy.id],
    ).unwrap();
    for filter in ["all", "considering"] {
        let mut query = thingary_lib::wishlist::Query {
            search: String::new(),
            filter: filter.into(),
            sort: "name".into(),
            descending: false,
            offset: 0,
        };
        let page = s.query_wishlist(&query).unwrap();
        assert_eq!(page.total, 2);
        assert!(page.items.iter().any(|item| item.id == legacy.id));
        assert!(page.items.iter().any(|item| item.id == normal.id));
        assert_eq!(page.legacy_achieved_count, 1);
        assert_eq!(page.considering_known_cents, "100000");
        query.search = "历史待核实".into();
        let search = s.query_wishlist(&query).unwrap();
        assert_eq!(search.total, 1);
        assert_eq!(search.items[0].id, legacy.id);
        assert_eq!(search.considering_known_cents, "100000");
        query.offset = 100;
        let beyond = s.query_wishlist(&query).unwrap();
        assert!(beyond.items.is_empty());
        assert_eq!(beyond.total, 1);
    }
    for filter in ["purchased", "dropped"] {
        let page = s
            .query_wishlist(&thingary_lib::wishlist::Query {
                search: String::new(),
                filter: filter.into(),
                sort: "name".into(),
                descending: false,
                offset: 0,
            })
            .unwrap();
        assert_eq!(page.total, 0);
    }
}
