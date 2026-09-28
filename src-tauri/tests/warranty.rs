use possio_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, Query, SaveAsset},
    domain::{Error, Save},
    lifecycle::{self},
    photos::Selection,
    sales,
    storage::Store,
    trash::TrashChange,
    warranty::{Action, Change, Fields, Status, SummaryStatus, WarrantySummary},
};

const TODAY: &str = "2026-09-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn create(s: &mut Store, name: &str, category: Option<&str>) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: name.into(),
                price_cents: Some("100000".into()),
                purchase_date: Some("2026-09-01".into()),
            },
            details: Details::default(),
            photos: None,
            classification: category.map(|category_id| possio_lib::taxonomy::Classification {
                category_id: Some(category_id.to_owned()),
                channel_id: None,
            }),
        },
        TODAY,
    )
    .unwrap()
}
fn fields(start: Option<&str>, end: Option<&str>) -> Fields {
    Fields {
        kind: "manufacturer".into(),
        provider: "虚构保障方".into(),
        start_date: start.map(str::to_owned),
        end_date: end.map(str::to_owned),
        notes: "仅用于测试".into(),
    }
}
fn change(s: &Store, a: &AssetRecord, action: Action) -> Change {
    Change {
        reminder: None,
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        action,
    }
}
fn empty() -> Selection {
    Selection {
        ids: vec![],
        cover_id: None,
    }
}
fn add(s: &mut Store, a: &AssetRecord, f: Fields) -> AssetRecord {
    let next = s
        .change_warranty(
            &change(
                s,
                a,
                Action::Add {
                    fields: f,
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(next.asset.revision, a.asset.revision + 1);
    next
}
fn query(warranty: &str) -> Query {
    Query {
        search: String::new(),
        filter: "all".into(),
        sort: "created".into(),
        descending: true,
        offset: 0,
        category: Default::default(),
        warranty: warranty.into(),
        label: None,
    }
}
fn names(page: &possio_lib::catalog::Page) -> Vec<&str> {
    page.items.iter().map(|r| r.asset.name.as_str()).collect()
}
fn dataset(root: &std::path::Path) -> std::path::PathBuf {
    let active: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("active.json")).unwrap()).unwrap();
    root.join("datasets").join(active["id"].as_str().unwrap())
}

#[test]
fn e04_fixed_day_boundaries_and_next_day_rollover() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构保障相机", None);
    let a = add(&mut s, &a, fields(Some("2026-09-01"), Some("2026-09-10")));
    let a = add(&mut s, &a, fields(Some("2026-09-01"), Some("2026-10-10")));
    let a = add(&mut s, &a, fields(Some("2026-09-01"), Some("2026-10-11")));
    let record = s.record_at(&a.asset.id, "2026-09-10").unwrap().unwrap();
    let statuses: Vec<(Status, Option<i64>)> = record
        .warranties
        .iter()
        .map(|w| (w.status, w.remaining_days))
        .collect();
    assert_eq!(
        statuses,
        vec![
            (Status::Expiring, Some(0)),
            (Status::Expiring, Some(30)),
            (Status::Active, Some(31)),
        ]
    );
    assert_eq!(record.warranty_summary.status, SummaryStatus::Covered);
    assert_eq!(record.warranty_summary.expiring_count, 2);
    // The SQL filter and the derived summary must agree (same rule set).
    let covered = s.query_assets(&query("covered"), "2026-09-10").unwrap();
    assert_eq!(names(&covered), vec!["虚构保障相机"]);
    // Next natural day: the 9/10 warranty expires, the other two moved closer.
    let next = s.record_at(&a.asset.id, "2026-09-11").unwrap().unwrap();
    let statuses: Vec<(Status, Option<i64>)> = next
        .warranties
        .iter()
        .map(|w| (w.status, w.remaining_days))
        .collect();
    assert_eq!(
        statuses,
        vec![
            (Status::Expired, None),
            (Status::Expiring, Some(29)),
            (Status::Expiring, Some(30)),
        ]
    );
    assert_eq!(next.warranty_summary.status, SummaryStatus::ExpiringSoon);
    assert_eq!(next.warranty_summary.active_count, 0);
    // Lifecycle and costs never move because of warranties.
    assert_eq!(next.lifecycle.state, lifecycle::State::Active);
    assert_eq!(
        next.costs.total_investment_cents,
        a.costs.total_investment_cents
    );
    assert_eq!(
        next.costs.daily_cents.as_deref(),
        Some("9091"),
        "purchase ¥1000 over 11 days (9/1–9/11) stays untouched by warranties"
    );
}

#[test]
fn e05_mixed_facts_summary_and_filters_use_one_rule_set() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let category = &s.taxonomy_snapshot().unwrap().categories[0].id;
    // A: future + expired + incomplete dates → facts kept, no coverage claim.
    let mixed = create(&mut s, "虚构混合保障平板", None);
    let mixed = add(
        &mut s,
        &mixed,
        fields(Some("2026-10-01"), Some("2027-01-01")),
    );
    let mixed = add(
        &mut s,
        &mixed,
        fields(Some("2025-01-01"), Some("2026-01-01")),
    );
    let mixed = add(&mut s, &mixed, fields(None, None));
    // B: long-valid + near-expiry + future → covered, near-expiry hint retained.
    let covered = create(&mut s, "虚构长效保障耳机", Some(category));
    let covered = add(
        &mut s,
        &covered,
        fields(Some("2026-01-01"), Some("2026-12-31")),
    );
    let covered = add(
        &mut s,
        &covered,
        fields(Some("2026-09-01"), Some("2026-09-12")),
    );
    let covered = add(
        &mut s,
        &covered,
        fields(Some("2026-10-01"), Some("2027-06-30")),
    );
    // C: only near-expiry coverage → expiring soon; also retired.
    let expiring = create(&mut s, "虚构临期保障键盘", None);
    let expiring = add(
        &mut s,
        &expiring,
        fields(Some("2026-08-01"), Some("2026-09-12")),
    );
    let expiring = s
        .change_lifecycle(
            &lifecycle::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: expiring.asset.id.clone(),
                expected_revision: expiring.asset.revision,
                action: lifecycle::Action::Append {
                    kind: lifecycle::Kind::Retire,
                    date: "2026-09-05".into(),
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    // D: no warranty records at all — distinct from unknown dates.
    let none = create(&mut s, "虚构无保障手机", None);
    let none_id = none.asset.id.clone();
    drop(none);

    let records = [
        s.record_at(&mixed.asset.id, TODAY).unwrap().unwrap(),
        s.record_at(&covered.asset.id, TODAY).unwrap().unwrap(),
        s.record_at(&expiring.asset.id, TODAY).unwrap().unwrap(),
        s.record_at(&none_id, TODAY).unwrap().unwrap(),
    ];
    assert_eq!(
        records[0].warranty_summary.status,
        SummaryStatus::NotCovered
    );
    assert_eq!(
        (
            records[0].warranty_summary.upcoming_count,
            records[0].warranty_summary.expired_count,
            records[0].warranty_summary.pending_count
        ),
        (1, 1, 1)
    );
    assert_eq!(records[1].warranty_summary.status, SummaryStatus::Covered);
    assert_eq!(records[1].warranty_summary.expiring_count, 1);
    assert_eq!(
        records[2].warranty_summary.status,
        SummaryStatus::ExpiringSoon
    );

    // The SQL filter matches exactly what the derived summaries say.
    let expected = |name: &str, filter: &str| -> bool {
        let summary = &records
            .iter()
            .find(|r| r.asset.name == name)
            .unwrap()
            .warranty_summary;
        match filter {
            "covered" => {
                summary.status == SummaryStatus::Covered
                    || summary.status == SummaryStatus::ExpiringSoon
            }
            "expiring" => summary.expiring_count > 0,
            "lapsed" => summary.status == SummaryStatus::NotCovered,
            "none" => summary.status == SummaryStatus::None,
            other => panic!("unknown filter {other}"),
        }
    };
    for filter in ["covered", "expiring", "lapsed", "none"] {
        let page = s.query_assets(&query(filter), TODAY).unwrap();
        let mut got = names(&page);
        got.sort_unstable();
        let mut want: Vec<&str> = [
            "虚构混合保障平板",
            "虚构长效保障耳机",
            "虚构临期保障键盘",
            "虚构无保障手机",
        ]
        .into_iter()
        .filter(|name| expected(name, filter))
        .collect();
        want.sort_unstable();
        assert_eq!(got, want, "filter {filter}");
    }
    assert_eq!(
        s.query_assets(&query("covered"), TODAY).unwrap().total,
        2,
        "covered = 耳机 + 键盘"
    );
    // Intersections with search, category and lifecycle, and deleted parents.
    let mut search = query("expiring");
    search.search = "耳机".into();
    assert_eq!(
        names(&s.query_assets(&search, TODAY).unwrap()),
        vec!["虚构长效保障耳机"]
    );
    let mut category_query = query("expiring");
    category_query.category = possio_lib::taxonomy::CategoryFilter::Category {
        id: category.clone(),
    };
    assert_eq!(
        names(&s.query_assets(&category_query, TODAY).unwrap()),
        vec!["虚构长效保障耳机"]
    );
    let mut retired = query("expiring");
    retired.filter = "retired".into();
    assert_eq!(
        names(&s.query_assets(&retired, TODAY).unwrap()),
        vec!["虚构临期保障键盘"]
    );
    let trashed = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: covered.asset.id.clone(),
            expected_revision: covered.asset.revision,
            deleted: true,
        })
        .unwrap();
    assert!(trashed.deleted);
    let after = s.query_assets(&query("covered"), TODAY).unwrap();
    assert_eq!(names(&after), vec!["虚构临期保障键盘"]);
    let error = match s.query_assets(&query("nonsense"), TODAY) {
        Err(e) => e,
        Ok(_) => panic!("unknown warranty filter must be refused"),
    };
    assert_eq!(error.code, "QUERY");
}

#[test]
fn ac14_ac15_overlap_correction_and_reopen_keep_single_facts() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构重叠保障相机", None);
    // AC14: one future-effective and one expiring today; the summary must not
    // read the future record as current coverage (S03).
    let a = add(&mut s, &a, fields(Some("2026-09-11"), Some("2027-09-11")));
    let a = add(&mut s, &a, fields(Some("2026-03-10"), Some("2026-09-10")));
    let record = s.record_at(&a.asset.id, TODAY).unwrap().unwrap();
    assert_eq!(record.warranty_summary.status, SummaryStatus::ExpiringSoon);
    assert_eq!(record.warranty_summary.upcoming_count, 1);
    assert_eq!(record.warranties.len(), 2);
    let expiring_id = record
        .warranties
        .iter()
        .find(|w| w.status == Status::Expiring)
        .unwrap()
        .id
        .clone();
    // AC15: correct the end date on the same record; no new fact appears.
    let correct_input = change(
        &s,
        &a,
        Action::Correct {
            warranty_id: expiring_id.clone(),
            fields: fields(Some("2026-03-10"), Some("2026-10-20")),
            photos: empty(),
        },
    );
    let corrected = s.change_warranty(&correct_input, TODAY).unwrap();
    assert_eq!(corrected.warranties.len(), 2);
    let corrected_record = corrected
        .warranties
        .iter()
        .find(|w| w.id == expiring_id)
        .unwrap();
    assert_eq!(corrected_record.status, Status::Active);
    assert_eq!(corrected_record.remaining_days, Some(40));
    assert_eq!(corrected.warranty_summary.status, SummaryStatus::Covered);
    // Repeated reads do not fabricate duplicate expiry facts.
    for _ in 0..3 {
        let reread = s.record_at(&a.asset.id, TODAY).unwrap().unwrap();
        assert_eq!(reread.warranties.len(), 2);
        assert_eq!(reread.warranty_summary, corrected.warranty_summary);
    }
    // Same-request replay returns the saved record, never a second change.
    let replay = s.change_warranty(&correct_input, TODAY).unwrap();
    assert_eq!(replay.warranties.len(), 2);
    // Reopen: audit keeps add + correct for the same ID, statuses stay derived.
    drop(s);
    let mut reopened = Store::open(root.path()).unwrap();
    let after = reopened.record_at(&a.asset.id, TODAY).unwrap().unwrap();
    assert_eq!(after.warranties.len(), 2);
    assert_eq!(after.warranty_summary.status, SummaryStatus::Covered);
    let audit: i64 = {
        let check = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
        check
            .query_row(
                "SELECT count(*) FROM warranty_audit WHERE warranty_id=?1",
                [&expiring_id],
                |r| r.get(0),
            )
            .unwrap()
    };
    assert_eq!(audit, 2);
    // Retiring the asset changes neither warranty facts nor their statuses.
    let retired = reopened
        .change_lifecycle(
            &lifecycle::Change {
                request_id: id(),
                generation: reopened.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: after.asset.revision,
                action: lifecycle::Action::Append {
                    kind: lifecycle::Kind::Retire,
                    date: TODAY.into(),
                    notes: String::new(),
                },
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(retired.lifecycle.state, lifecycle::State::Retired);
    assert_eq!(retired.warranties.len(), 2);
    assert_eq!(retired.warranty_summary.status, SummaryStatus::Covered);
    assert_eq!(
        retired.costs.total_investment_cents,
        after.costs.total_investment_cents
    );
}

#[test]
fn dates_allow_future_and_reverse_order_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构日期保障平板", None);
    // Future start and end are legal warranties; no purchase/sale clamps.
    let a = add(&mut s, &a, fields(Some("2027-01-01"), Some("2028-01-01")));
    // Same-day start and end is legal.
    let a = add(&mut s, &a, fields(Some("2026-09-10"), Some("2026-09-10")));
    let record = s.record_at(&a.asset.id, TODAY).unwrap().unwrap();
    // Read order is soonest end date first: the same-day record leads.
    assert_eq!(record.warranties[0].status, Status::Expiring);
    assert_eq!(record.warranties[0].remaining_days, Some(0));
    assert_eq!(record.warranties[1].status, Status::Upcoming);
    // End before start is refused by the domain layer…
    let err = s
        .change_warranty(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(Some("2026-10-01"), Some("2026-09-30")),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap_err();
    assert_eq!(err.code, "DATE_CONFLICT");
    // …and by the schema trigger even for direct writes.
    let raw = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
    assert!(raw
        .execute(
            "INSERT INTO warranties(id,asset_id,kind,provider,start_date,end_date,notes,created_at,updated_at) VALUES('manual',?1,'other','','2026-10-01','2026-09-30','','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            [&a.asset.id],
        )
        .is_err());
    drop(raw);
    assert_eq!(
        s.record_at(&a.asset.id, TODAY)
            .unwrap()
            .unwrap()
            .warranties
            .len(),
        2,
        "rejected writes leave no rows"
    );
}

#[cfg(feature = "fault-injection")]
#[test]
fn faults_receipts_and_conflicts_do_not_duplicate_facts() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构故障保障相机", None);
    let q = change(
        &s,
        &a,
        Action::Add {
            fields: fields(Some("2026-09-01"), Some("2026-12-31")),
            photos: empty(),
        },
    );
    let mut collision = q.clone();
    if let Action::Add { fields, .. } = &mut collision.action {
        fields.end_date = Some("2026-11-30".into());
    }
    s.set_hook(|p| {
        if p == "warranty.before_commit" {
            Err(Error::new("INJECTED", "失败"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_warranty(&q, TODAY).is_err());
    assert!(s
        .record_at(&a.asset.id, TODAY)
        .unwrap()
        .unwrap()
        .warranties
        .is_empty());
    assert!(s
        .saved_request(&q.request_id, &q.generation)
        .unwrap()
        .is_none());
    s.set_hook(|_| Ok(()));
    let b = s.change_warranty(&q, TODAY).unwrap();
    assert_eq!(b.warranties.len(), 1);
    assert_eq!(
        s.change_warranty(&collision, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let mut stale = change(
        &s,
        &b,
        Action::Add {
            fields: fields(None, None),
            photos: empty(),
        },
    );
    stale.generation = "old".into();
    assert_eq!(
        s.change_warranty(&stale, TODAY).unwrap_err().code,
        "STALE_DATASET"
    );
    stale.generation = s.generation();
    stale.expected_revision = 1;
    assert_eq!(
        s.change_warranty(&stale, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    // Receipt lost after commit: the stored request reconciles to one fact.
    let lost = change(
        &s,
        &b,
        Action::Add {
            fields: fields(None, None),
            photos: empty(),
        },
    );
    s.set_hook(|p| {
        if p == "warranty.after_commit" {
            Err(Error::new("LOST", "丢失"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_warranty(&lost, TODAY).is_err());
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.saved_request(&lost.request_id, &lost.generation)
            .unwrap()
            .unwrap()
            .warranties
            .len(),
        2
    );
    assert_eq!(s.change_warranty(&lost, TODAY).unwrap().warranties.len(), 2);
    // Correcting an unknown warranty id is refused, not turned into an add.
    let mut unknown = change(
        &s,
        &b,
        Action::Correct {
            warranty_id: id(),
            fields: fields(None, None),
            photos: empty(),
        },
    );
    unknown.expected_revision = s
        .record_at(&b.asset.id, TODAY)
        .unwrap()
        .unwrap()
        .asset
        .revision;
    assert_eq!(
        s.change_warranty(&unknown, TODAY).unwrap_err().code,
        "NOT_FOUND"
    );
}

#[test]
fn photos_parent_trash_backup_restore_and_reopen_preserve_warranties() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构图片保障相机", None);
    let other = create(&mut s, "虚构另一保障平板", None);
    let photo = s
        .stage_photo(
            "camera.png",
            include_bytes!("fixtures/camera.png"),
            &s.generation(),
            None,
        )
        .unwrap();
    let b = add(&mut s, &a, fields(Some("2026-09-01"), Some("2027-09-01")));
    let b = s
        .change_warranty(
            &change(
                &s,
                &b,
                Action::Add {
                    fields: fields(Some("2026-09-02"), Some("2028-09-02")),
                    photos: Selection {
                        ids: vec![photo.id.clone()],
                        cover_id: None,
                    },
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(b.warranties.len(), 2);
    let with_photo = b
        .warranties
        .iter()
        .find(|w| w.fields.end_date.as_deref() == Some("2028-09-02"))
        .unwrap();
    assert_eq!(with_photo.photos[0].id, photo.id);
    assert_eq!(
        s.photo_preview(&photo.id, &s.generation()).unwrap()[..4],
        [137, 80, 78, 71]
    );
    // Warranties cannot borrow an attachment owned by another asset.
    let err = s
        .change_warranty(
            &change(
                &s,
                &other,
                Action::Add {
                    fields: fields(None, None),
                    photos: Selection {
                        ids: vec![photo.id.clone()],
                        cover_id: None,
                    },
                },
            ),
            TODAY,
        )
        .unwrap_err();
    assert_eq!(err.code, "IMAGE_OWNER");
    let backup = root.path().join("warranty.possio");
    s.backup(Some(&backup)).unwrap();
    let hash = archive_hash(&backup).unwrap();
    // Parent deletion hides the record; restore brings it back unchanged.
    let deleted = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: b.asset.id.clone(),
            expected_revision: b.asset.revision,
            deleted: true,
        })
        .unwrap();
    assert!(deleted.deleted);
    assert_eq!(deleted.warranties.len(), 2);
    let restored = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: b.asset.id.clone(),
            expected_revision: deleted.asset.revision,
            deleted: false,
        })
        .unwrap();
    assert_eq!(restored.warranties.len(), 2);
    assert_eq!(
        restored
            .warranties
            .iter()
            .find(|w| w.fields.end_date.as_deref() == Some("2028-09-02"))
            .unwrap()
            .photos[0]
            .id,
        photo.id
    );
    drop(s);
    let mut reopened = Store::open(root.path()).unwrap();
    let after = reopened.record_at(&b.asset.id, TODAY).unwrap().unwrap();
    assert_eq!(after.warranties.len(), 2);
    assert_eq!(after.warranty_summary.status, SummaryStatus::Covered);
    let generation = reopened.generation();
    reopened.restore(&backup, &hash, &generation).unwrap();
    let recovered = reopened.record_at(&b.asset.id, TODAY).unwrap().unwrap();
    assert_eq!(recovered.warranties.len(), 2);
    assert_eq!(
        recovered
            .warranties
            .iter()
            .find(|w| w.fields.end_date.as_deref() == Some("2028-09-02"))
            .unwrap()
            .photos[0]
            .id,
        photo.id
    );
    assert_eq!(
        reopened
            .photo_preview(&photo.id, &reopened.generation())
            .unwrap()[..4],
        [137, 80, 78, 71]
    );
}

#[test]
fn schema_ten_upgrade_preserves_data_and_rolls_back_atomically() {
    let root = tempfile::tempdir().unwrap();
    {
        let mut s = Store::open(root.path()).unwrap();
        let a = create(&mut s, "旧版虚构档案", None);
        let _ = s
            .change_warranty(
                &change(
                    &s,
                    &a,
                    Action::Add {
                        fields: fields(Some("2026-09-01"), Some("2027-09-01")),
                        photos: empty(),
                    },
                ),
                TODAY,
            )
            .unwrap();
        let _ = s
            .change_sale(
                &sales::Change {
                    request_id: id(),
                    generation: s.generation(),
                    asset_id: a.asset.id.clone(),
                    expected_revision: s
                        .record_at(&a.asset.id, TODAY)
                        .unwrap()
                        .unwrap()
                        .asset
                        .revision,
                    action: sales::Action::Sell {
                        fields: sales::Fields {
                            date: TODAY.into(),
                            price_cents: "30000".into(),
                            platform: String::new(),
                            buyer: String::new(),
                            notes: String::new(),
                        },
                    },
                },
                TODAY,
            )
            .unwrap();
    }
    // Rewind to schema 9 the way a pre-T10 library would look.
    let dataset = root.path().join("datasets").join(
        std::fs::read_to_string(root.path().join("active.json"))
            .and_then(|active| {
                Ok(serde_json::from_str::<serde_json::Value>(&active)?["id"]
                    .as_str()
                    .unwrap()
                    .to_owned())
            })
            .unwrap(),
    );
    let db = rusqlite::Connection::open(dataset.join("data.sqlite")).unwrap();
    db.execute_batch(
        "DROP TABLE virtual_assets; DROP TABLE plan_payments; DROP TABLE recurring_plans; DROP TABLE expenses; DROP TABLE fin_snapshot_entries; DROP TABLE fin_snapshots; DROP TABLE fin_accounts; DROP TABLE reminders; DROP TABLE feature_audit; DROP TABLE feature_requests; DROP TABLE wishlist_preferences; DROP TABLE asset_preferences; DROP TABLE disabled_choices; DROP TABLE named_choices; DROP TABLE wishlist_audit; DROP TABLE wishlist_media; DROP TABLE wishlist_attachments; DROP TABLE wishlist_items; DROP TRIGGER warranty_dates_update; DROP TRIGGER warranty_dates_insert; DROP TABLE warranty_audit; DROP TABLE warranty_photos; DROP TABLE warranties; PRAGMA user_version=9;",
    )
    .unwrap();
    drop(db);
    let mut s = Store::open(root.path()).unwrap();
    let version: i64 = {
        let check = rusqlite::Connection::open(dataset.join("data.sqlite")).unwrap();
        check
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(version, 20);
    let record = s
        .query_assets(&query("all"), TODAY)
        .unwrap()
        .items
        .into_iter()
        .next()
        .unwrap();
    assert_eq!(record.asset.name, "旧版虚构档案");
    assert!(record.sale.is_some(), "existing sale survives the upgrade");
    assert_eq!(
        record.warranty_summary,
        WarrantySummary::default(),
        "no warranty facts are invented during migration"
    );
    // Warranties work on the migrated library.
    let _ = s
        .change_warranty(
            &change(
                &s,
                &record,
                Action::Add {
                    fields: fields(Some("2026-09-02"), Some("2027-09-02")),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();

    // A failing 9→10 step leaves the library at 9 without partial tables.
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(possio_lib::storage::SCHEMA).unwrap();
    possio_lib::storage::migrate_to(&c, 9, &|_| Ok(())).unwrap();
    assert!(possio_lib::storage::migrate_to(&c, 10, &|point| {
        if point == "migration.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    })
    .is_err());
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        9
    );
    assert!(c.prepare("SELECT 1 FROM warranties").is_err());
    possio_lib::storage::migrate_to(&c, 10, &|_| Ok(())).unwrap();
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        10
    );
}

#[test]
fn legacy_schema_nine_backup_restores_and_migrates() {
    use sha2::{Digest, Sha256};
    let root = tempfile::tempdir().unwrap();
    // Build an archive that looks like it came from a schema 9 library.
    let legacy_path = {
        let mut s = Store::open(root.path()).unwrap();
        create(&mut s, "旧版备份虚构物品", None);
        drop(s);
        let db = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
        db.execute_batch(
            "DROP TABLE virtual_assets; DROP TABLE plan_payments; DROP TABLE recurring_plans; DROP TABLE expenses; DROP TABLE fin_snapshot_entries; DROP TABLE fin_snapshots; DROP TABLE fin_accounts; DROP TABLE reminders; DROP TABLE feature_audit; DROP TABLE feature_requests; DROP TABLE wishlist_preferences; DROP TABLE asset_preferences; DROP TABLE disabled_choices; DROP TABLE named_choices; DROP TABLE wishlist_audit; DROP TABLE wishlist_media; DROP TABLE wishlist_attachments; DROP TABLE wishlist_items; DROP TRIGGER warranty_dates_update; DROP TRIGGER warranty_dates_insert; DROP TABLE warranty_audit; DROP TABLE warranty_photos; DROP TABLE warranties; PRAGMA user_version=9;",
        )
        .unwrap();
        drop(db);
        let bytes = std::fs::read(dataset(root.path()).join("data.sqlite")).unwrap();
        let staged = root.path().join("legacy-v9");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("data.sqlite"), &bytes).unwrap();
        staged
    };
    let bytes = std::fs::read(legacy_path.join("data.sqlite")).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":9,"created_at":"2026-09-24T00:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let archive = root.path().join("legacy.possio");
    {
        use std::io::Write;
        let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        z.start_file("manifest.json", opts).unwrap();
        z.write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        z.start_file("data.sqlite", opts).unwrap();
        z.write_all(&bytes).unwrap();
        z.finish().unwrap();
    }
    let hash = archive_hash(&archive).unwrap();
    // A fresh library adopts the old backup and migrates it through schema 11.
    let target = tempfile::tempdir().unwrap();
    let mut s = Store::open(target.path()).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    let page = s.query_assets(&query("none"), TODAY).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].asset.name, "旧版备份虚构物品");
    assert_eq!(page.items[0].warranty_summary.status, SummaryStatus::None);
    let _ = s
        .change_warranty(
            &change(
                &s,
                &page.items[0],
                Action::Add {
                    fields: fields(Some("2026-09-01"), Some("2027-09-01")),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(s.query_assets(&query("covered"), TODAY).unwrap().total, 1);
}

#[test]
fn attachment_ids_are_exclusive_but_identical_bytes_can_be_shared() {
    use possio_lib::maintenance;
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构附件归属", None);
    let stage = |s: &Store| {
        s.stage_photo(
            "camera.png",
            include_bytes!("fixtures/camera.png"),
            &s.generation(),
            None,
        )
        .unwrap()
    };
    let selection = |id: &str| Selection {
        ids: vec![id.into()],
        cover_id: None,
    };
    let asset_save = |s: &Store, a: &AssetRecord, photo: &str| SaveAsset {
        options: None,
        base: Save {
            request_id: id(),
            generation: s.generation(),
            asset_id: Some(a.asset.id.clone()),
            expected_revision: Some(a.asset.revision),
            name: a.asset.name.clone(),
            price_cents: Some("100000".into()),
            purchase_date: Some("2026-09-01".into()),
        },
        details: Details::default(),
        classification: None,
        photos: Some(selection(photo)),
    };
    let maintenance_change = |s: &Store, a: &AssetRecord, photo: &str| maintenance::Change {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        action: maintenance::Action::Add {
            fields: maintenance::Fields {
                date: None,
                kind: "cleaning".into(),
                title: "虚构清洁".into(),
                description: String::new(),
                cost_cents: Some("0".into()),
                provider: String::new(),
            },
            photos: selection(photo),
        },
    };
    let asset_photo = stage(&s);
    let a = s
        .save_asset(&asset_save(&s, &a, &asset_photo.id), TODAY)
        .unwrap();
    let maintenance_photo = stage(&s);
    let a = s
        .change_maintenance(&maintenance_change(&s, &a, &maintenance_photo.id), TODAY)
        .unwrap();
    for photo in [&asset_photo.id, &maintenance_photo.id] {
        let input = change(
            &s,
            &a,
            Action::Add {
                fields: fields(None, None),
                photos: selection(photo),
            },
        );
        assert_eq!(
            s.change_warranty(&input, TODAY).unwrap_err().code,
            "IMAGE_OWNER"
        );
        assert!(s
            .saved_request(&input.request_id, &s.generation())
            .unwrap()
            .is_none());
        assert_eq!(
            s.record_at(&a.asset.id, TODAY)
                .unwrap()
                .unwrap()
                .asset
                .revision,
            a.asset.revision
        );
    }
    let warranty_photo = stage(&s);
    assert_ne!(warranty_photo.id, asset_photo.id);
    let a = s
        .change_warranty(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(None, None),
                    photos: selection(&warranty_photo.id),
                },
            ),
            TODAY,
        )
        .unwrap();
    // Same warranty can retain its own ID during correction.
    let a = s
        .change_warranty(
            &change(
                &s,
                &a,
                Action::Correct {
                    warranty_id: a.warranties[0].id.clone(),
                    fields: fields(Some("2026-09-01"), Some("2027-09-01")),
                    photos: selection(&warranty_photo.id),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(
        s.change_warranty(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(None, None),
                    photos: selection(&warranty_photo.id)
                }
            ),
            TODAY
        )
        .unwrap_err()
        .code,
        "IMAGE_OWNER"
    );
    assert_eq!(
        s.save_asset(&asset_save(&s, &a, &warranty_photo.id), TODAY)
            .unwrap_err()
            .code,
        "IMAGE_OWNER"
    );
    assert_eq!(
        s.change_maintenance(&maintenance_change(&s, &a, &warranty_photo.id), TODAY)
            .unwrap_err()
            .code,
        "IMAGE_OWNER"
    );
    let another = stage(&s);
    let a = s
        .change_warranty(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(None, None),
                    photos: selection(&another.id),
                },
            ),
            TODAY,
        )
        .unwrap();
    let db = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(DISTINCT hash) FROM attachments", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM attachments", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        4
    );
    let archive = root.path().join("exclusive.possio");
    s.backup(Some(&archive)).unwrap();
    s.restore(&archive, &archive_hash(&archive).unwrap(), &s.generation())
        .unwrap();
    assert_eq!(
        s.record_at(&a.asset.id, TODAY)
            .unwrap()
            .unwrap()
            .warranties
            .len(),
        2
    );
    // Restore validation must also reject a malformed cross-entity reference.
    let db = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
    db.execute(
        "INSERT INTO asset_photos VALUES(?1,?2,1,'invalid shared reference')",
        rusqlite::params![a.asset.id, warranty_photo.id],
    )
    .unwrap();
    assert_eq!(
        s.backup(Some(&root.path().join("invalid.possio")))
            .unwrap_err()
            .code,
        "REFERENCE"
    );
}

#[test]
fn reminder_correction_cancellation_and_invalid_date_are_atomic() {
    use possio_lib::{preferences::Reminder, warranty::ReminderSetting};
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let a = create(&mut s, "虚构提醒物品", None);
    let mut request = change(
        &s,
        &a,
        Action::Add {
            fields: fields(Some("2026-09-01"), Some("2027-09-01")),
            photos: empty(),
        },
    );
    request.reminder = Some(ReminderSetting {
        value: Some(Reminder {
            date: "2027-08-25".into(),
            notes: "第一版".into(),
        }),
    });
    let a = s.change_warranty(&request, TODAY).unwrap();
    assert_eq!(s.reminder_plans().unwrap()[0].date, "2027-08-25");
    let mut request = change(
        &s,
        &a,
        Action::Correct {
            warranty_id: a.warranties[0].id.clone(),
            fields: fields(Some("2026-09-01"), Some("2027-09-01")),
            photos: empty(),
        },
    );
    request.reminder = Some(ReminderSetting {
        value: Some(Reminder {
            date: "2027-10-01".into(),
            notes: "错误".into(),
        }),
    });
    assert!(s.change_warranty(&request, TODAY).is_err());
    assert_eq!(s.reminder_plans().unwrap()[0].body, "第一版");
    request.reminder = Some(ReminderSetting { value: None });
    let a = s.change_warranty(&request, TODAY).unwrap();
    assert!(s.reminder_plans().unwrap().is_empty());
    assert!(a.warranties[0].reminder.is_none());
}
