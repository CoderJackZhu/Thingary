use thingary_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Error, Save},
    maintenance::{Action, Change, Fields},
    photos::Selection,
    sales,
    storage::Store,
    trash::TrashChange,
};

const TODAY: &str = "2026-09-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn create(s: &mut Store) -> AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: id(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构维护相机".into(),
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
fn fields(date: Option<&str>, cost: Option<&str>, kind: &str) -> Fields {
    Fields {
        date: date.map(str::to_owned),
        kind: kind.into(),
        title: "虚构维护".into(),
        description: "仅用于测试".into(),
        cost_cents: cost.map(str::to_owned),
        provider: "虚构服务商".into(),
    }
}
fn change(s: &Store, a: &AssetRecord, action: Action) -> Change {
    Change {
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

#[test]
fn add_correct_unknown_zero_and_sale_costs_are_authoritative() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s);
    assert_eq!(a.costs.known_maintenance_cents, "0");
    assert_eq!(a.costs.total_investment_cents.as_deref(), Some("100000"));
    let add = change(
        &s,
        &a,
        Action::Add {
            fields: fields(None, Some("20000"), "upgrade"),
            photos: empty(),
        },
    );
    let b = s.change_maintenance(&add, TODAY).unwrap();
    let maintenance_id = b.maintenances[0].id.clone();
    assert_eq!(b.costs.total_investment_cents.as_deref(), Some("120000"));
    assert_eq!(b.costs.daily_cents.as_deref(), Some("12000"));
    assert_eq!(
        s.change_maintenance(&add, TODAY)
            .unwrap()
            .maintenances
            .len(),
        1
    );
    let corrected = s
        .change_maintenance(
            &change(
                &s,
                &b,
                Action::Correct {
                    maintenance_id: maintenance_id.clone(),
                    fields: fields(None, Some("15000"), "upgrade"),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(corrected.maintenances[0].id, maintenance_id);
    assert_eq!(
        corrected.costs.total_investment_cents.as_deref(),
        Some("115000")
    );
    let unknown = s
        .change_maintenance(
            &change(
                &s,
                &corrected,
                Action::Add {
                    fields: fields(None, None, "other"),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(unknown.costs.known_maintenance_cents, "15000");
    assert_eq!(unknown.costs.unknown_maintenance_count, 1);
    assert!(unknown.costs.total_investment_cents.is_none());
    assert!(unknown.costs.daily_cents.is_none());
    let unknown_id = unknown
        .maintenances
        .iter()
        .find(|m| m.fields.cost_cents.is_none())
        .unwrap()
        .id
        .clone();
    let zero = s
        .change_maintenance(
            &change(
                &s,
                &unknown,
                Action::Correct {
                    maintenance_id: unknown_id,
                    fields: fields(None, Some("0"), "other"),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(zero.costs.total_investment_cents.as_deref(), Some("115000"));
    let sold = s
        .change_sale(
            &sales::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: zero.asset.id.clone(),
                expected_revision: zero.asset.revision,
                action: sales::Action::Sell {
                    fields: sales::Fields {
                        date: TODAY.into(),
                        price_cents: "30000".into(),
                        platform: "虚构".into(),
                        buyer: "".into(),
                        notes: "".into(),
                    },
                },
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(sold.costs.net_cost_cents.as_deref(), Some("85000"));
    assert_eq!(sold.costs.held_days, Some(10));
    assert_eq!(sold.costs.daily_cents.as_deref(), Some("8500"));
}

#[test]
fn dates_are_checked_in_both_directions_and_sold_history_is_allowed() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s);
    assert_eq!(
        s.change_maintenance(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(Some("2026-08-31"), Some("0"), "service"),
                    photos: empty()
                }
            ),
            TODAY
        )
        .unwrap_err()
        .code,
        "DATE_CONFLICT"
    );
    assert_eq!(
        s.change_maintenance(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(Some("2026-09-11"), Some("0"), "service"),
                    photos: empty()
                }
            ),
            TODAY
        )
        .unwrap_err()
        .code,
        "FUTURE"
    );
    let b = s
        .change_maintenance(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(Some("2026-09-03"), Some("20000"), "service"),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    let mut save = SaveAsset {
        options: None,
        base: Save {
            request_id: id(),
            generation: s.generation(),
            asset_id: Some(b.asset.id.clone()),
            expected_revision: Some(b.asset.revision),
            name: b.asset.name.clone(),
            price_cents: b.asset.price_cents.clone(),
            purchase_date: Some("2026-09-04".into()),
        },
        details: b.details.clone(),
        photos: None,
        classification: None,
    };
    let err = s.save_asset(&save, TODAY).unwrap_err();
    assert_eq!(err.code, "DATE_CONFLICT");
    assert!(err.message.contains(&b.maintenances[0].id));
    let sold = s
        .change_sale(
            &sales::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: b.asset.id.clone(),
                expected_revision: b.asset.revision,
                action: sales::Action::Sell {
                    fields: sales::Fields {
                        date: "2026-09-05".into(),
                        price_cents: "30000".into(),
                        platform: "".into(),
                        buyer: "".into(),
                        notes: "".into(),
                    },
                },
            },
            TODAY,
        )
        .unwrap();
    let sold_with_history = s
        .change_maintenance(
            &change(
                &s,
                &sold,
                Action::Add {
                    fields: fields(Some("2026-09-03"), Some("0"), "cleaning"),
                    photos: empty(),
                },
            ),
            TODAY,
        )
        .unwrap();
    assert_eq!(
        s.change_maintenance(
            &change(
                &s,
                &sold_with_history,
                Action::Add {
                    fields: fields(Some("2026-09-06"), Some("0"), "cleaning"),
                    photos: empty()
                }
            ),
            TODAY
        )
        .unwrap_err()
        .code,
        "DATE_CONFLICT"
    );
    save.base.request_id = id();
    save.base.expected_revision = Some(s.record(&sold.asset.id).unwrap().unwrap().asset.revision);
    save.base.purchase_date = Some("2026-09-02".into());
    assert!(s.save_asset(&save, TODAY).is_ok());
}

#[test]
fn request_conflicts_stale_inputs_and_faults_do_not_duplicate() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s);
    let q = change(
        &s,
        &a,
        Action::Add {
            fields: fields(None, Some("20000"), "repair"),
            photos: empty(),
        },
    );
    let mut collision = q.clone();
    if let Action::Add { fields, .. } = &mut collision.action {
        fields.cost_cents = Some("1".into());
    }
    s.set_hook(|p| {
        if p == "maintenance.before_commit" {
            Err(Error::new("INJECTED", "失败"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_maintenance(&q, TODAY).is_err());
    assert!(s
        .record(&a.asset.id)
        .unwrap()
        .unwrap()
        .maintenances
        .is_empty());
    assert!(s
        .saved_request(&q.request_id, &q.generation)
        .unwrap()
        .is_none());
    s.set_hook(|_| Ok(()));
    let b = s.change_maintenance(&q, TODAY).unwrap();
    assert_eq!(
        s.change_maintenance(&collision, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let mut stale = change(
        &s,
        &b,
        Action::Add {
            fields: fields(None, Some("0"), "other"),
            photos: empty(),
        },
    );
    stale.generation = "old".into();
    assert_eq!(
        s.change_maintenance(&stale, TODAY).unwrap_err().code,
        "STALE_DATASET"
    );
    stale.generation = s.generation();
    stale.expected_revision = 1;
    assert_eq!(
        s.change_maintenance(&stale, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let lost = change(
        &s,
        &b,
        Action::Add {
            fields: fields(None, Some("0"), "other"),
            photos: empty(),
        },
    );
    s.set_hook(|p| {
        if p == "maintenance.after_commit" {
            Err(Error::new("LOST", "丢失"))
        } else {
            Ok(())
        }
    });
    assert!(s.change_maintenance(&lost, TODAY).is_err());
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.saved_request(&lost.request_id, &lost.generation)
            .unwrap()
            .unwrap()
            .maintenances
            .len(),
        2
    );
    assert_eq!(
        s.change_maintenance(&lost, TODAY)
            .unwrap()
            .maintenances
            .len(),
        2
    );
}

#[test]
fn photos_parent_trash_backup_restore_and_reopen_preserve_children() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s);
    let photo = s
        .stage_photo(
            "camera.heic",
            include_bytes!("fixtures/camera.heic"),
            &s.generation(),
            None,
        )
        .unwrap();
    let b = s
        .change_maintenance(
            &change(
                &s,
                &a,
                Action::Add {
                    fields: fields(None, Some("20000"), "repair"),
                    photos: Selection {
                        ids: vec![photo.id.clone()],
                        cover_id: None,
                    },
                },
            ),
            TODAY,
        )
        .unwrap();
    let maintenance_id = b.maintenances[0].id.clone();
    let backup = root.path().join("maintenance.thingary");
    s.backup(Some(&backup)).unwrap();
    let hash = archive_hash(&backup).unwrap();
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
    assert_eq!(deleted.maintenances[0].id, maintenance_id);
    let restored = s
        .change_trash(&TrashChange {
            request_id: id(),
            generation: s.generation(),
            asset_id: b.asset.id.clone(),
            expected_revision: deleted.asset.revision,
            deleted: false,
        })
        .unwrap();
    assert_eq!(restored.maintenances[0].photos[0].id, photo.id);
    drop(s);
    let mut reopened = Store::open(root.path()).unwrap();
    assert_eq!(
        reopened.record(&b.asset.id).unwrap().unwrap().maintenances[0].id,
        maintenance_id
    );
    let generation = reopened.generation();
    reopened.restore(&backup, &hash, &generation).unwrap();
    let recovered = reopened.record(&b.asset.id).unwrap().unwrap();
    assert_eq!(recovered.maintenances[0].id, maintenance_id);
    assert_eq!(recovered.maintenances[0].photos[0].id, photo.id);
    assert_eq!(
        reopened
            .photo_preview(&photo.id, &reopened.generation())
            .unwrap()[..4],
        [137, 80, 78, 71]
    );
}
