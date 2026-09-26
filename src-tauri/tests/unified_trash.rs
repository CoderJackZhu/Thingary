use possio_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Error, Save},
    maintenance,
    photos::Selection,
    sales,
    storage::Store,
    trash::{RecordChange, TrashChange, TrashQuery},
    warranty,
};

const TODAY: &str = "2026-09-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn create(s: &mut Store, name: &str) -> AssetRecord {
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
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn empty() -> Selection {
    Selection {
        ids: vec![],
        cover_id: None,
    }
}
fn add_maintenance(s: &mut Store, a: &AssetRecord, cost: Option<&str>) -> AssetRecord {
    s.change_maintenance(
        &maintenance::Change {
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action: maintenance::Action::Add {
                fields: maintenance::Fields {
                    date: Some("2026-09-03".into()),
                    kind: "repair".into(),
                    title: "虚构维护".into(),
                    description: String::new(),
                    cost_cents: cost.map(str::to_owned),
                    provider: String::new(),
                },
                photos: empty(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn add_warranty(s: &mut Store, a: &AssetRecord) -> AssetRecord {
    s.change_warranty(
        &warranty::Change {
            reminder: None,
            request_id: id(),
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            expected_revision: a.asset.revision,
            action: warranty::Action::Add {
                fields: warranty::Fields {
                    kind: "manufacturer".into(),
                    provider: "虚构保障方".into(),
                    start_date: Some("2026-09-01".into()),
                    end_date: Some("2026-12-31".into()),
                    notes: String::new(),
                },
                photos: empty(),
            },
        },
        TODAY,
    )
    .unwrap()
}
fn record_change(
    s: &Store,
    a: &AssetRecord,
    kind: &str,
    record_id: &str,
    deleted: bool,
) -> RecordChange {
    RecordChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        record_id: record_id.into(),
        kind: kind.into(),
        expected_revision: a.asset.revision,
        deleted,
    }
}
fn asset_change(s: &Store, a: &AssetRecord, deleted: bool) -> TrashChange {
    TrashChange {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: a.asset.revision,
        deleted,
    }
}
fn trash(s: &Store, filter: &str) -> possio_lib::trash::TrashPage {
    s.list_trash(&TrashQuery {
        filter: filter.into(),
        offset: 0,
    })
    .unwrap()
}
fn dataset(root: &std::path::Path) -> std::path::PathBuf {
    let active: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("active.json")).unwrap()).unwrap();
    root.join("datasets").join(active["id"].as_str().unwrap())
}

#[test]
fn e09_parent_delete_never_adopts_or_revives_child_deletes() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    // E09: purchase ¥1,000, maintenance A ¥200, maintenance B ¥100.
    let a = create(&mut s, "虚构相机");
    let a = add_maintenance(&mut s, &a, Some("20000"));
    let a = add_maintenance(&mut s, &a, Some("10000"));
    assert_eq!(a.costs.total_investment_cents.as_deref(), Some("130000"));
    // Same-day maintenance ordering is not guaranteed: identify by cost.
    let id_a = a
        .maintenances
        .iter()
        .find(|m| m.fields.cost_cents.as_deref() == Some("20000"))
        .unwrap()
        .id
        .clone();
    let id_b = a
        .maintenances
        .iter()
        .find(|m| m.fields.cost_cents.as_deref() == Some("10000"))
        .unwrap()
        .id
        .clone();
    let revision_before = a.asset.revision;
    // Delete maintenance A independently: total drops to ¥1,100.
    let delete_a = record_change(&s, &a, "maintenance", &id_a, true);
    let after_delete = s.change_record_trash(&delete_a, TODAY).unwrap();
    assert_eq!(after_delete.asset.revision, revision_before + 1);
    assert_eq!(
        after_delete.costs.total_investment_cents.as_deref(),
        Some("110000")
    );
    assert!(after_delete.maintenances.iter().all(|m| m.id != id_a));
    // Delete then restore the parent asset: B comes back, A stays deleted.
    let deleted_asset = s
        .change_trash(&asset_change(&s, &after_delete, true))
        .unwrap();
    assert!(deleted_asset.deleted);
    let list = trash(&s, "all");
    assert_eq!(list.total, 2);
    assert!(list.items.iter().any(|e| e.kind == "asset"));
    assert!(list
        .items
        .iter()
        .any(|e| e.kind == "maintenance" && e.id == id_a));
    let restored = s
        .change_trash(&asset_change(&s, &deleted_asset, false))
        .unwrap();
    assert!(!restored.deleted);
    assert_eq!(
        restored.costs.total_investment_cents.as_deref(),
        Some("110000")
    );
    assert!(restored.maintenances.iter().any(|m| m.id == id_b));
    assert!(restored.maintenances.iter().all(|m| m.id != id_a));
    // Restoring A alone brings the total back to ¥1,300, same record id.
    let restore_a = record_change(&s, &restored, "maintenance", &id_a, false);
    let final_record = s.change_record_trash(&restore_a, TODAY).unwrap();
    assert_eq!(
        final_record.costs.total_investment_cents.as_deref(),
        Some("130000")
    );
    assert_eq!(final_record.maintenances.len(), 2);
    assert!(final_record.maintenances.iter().any(|m| m.id == id_a));
    assert_eq!(trash(&s, "all").total, 0);
    // AC44: replaying the restore request adds nothing (no duplicate facts).
    let replay = s.change_record_trash(&restore_a, TODAY).unwrap();
    assert_eq!(replay.asset.revision, final_record.asset.revision);
    drop(s);
    let db = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM maintenances", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM maintenance_audit", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        2
    );
}

#[test]
fn record_trash_requests_are_idempotent_and_conflict_safe() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构平板");
    let a = add_warranty(&mut s, &a);
    let warranty_id = a.warranties[0].id.clone();
    let delete = record_change(&s, &a, "warranty", &warranty_id, true);
    assert!(s
        .saved_record_trash_request(&delete, TODAY)
        .unwrap()
        .is_none());
    let deleted = s.change_record_trash(&delete, TODAY).unwrap();
    assert!(deleted.warranties.is_empty());
    assert_eq!(
        s.saved_record_trash_request(&delete, TODAY)
            .unwrap()
            .unwrap()
            .asset
            .revision,
        deleted.asset.revision
    );
    // Same request id, same payload: replay returns the receipt, no new write.
    let replay = s.change_record_trash(&delete, TODAY).unwrap();
    assert_eq!(replay.asset.revision, deleted.asset.revision);
    // Same request id, different payload: conflict.
    let mut collision = delete.clone();
    collision.deleted = false;
    assert_eq!(
        s.saved_record_trash_request(&collision, TODAY)
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
    assert_eq!(
        s.change_record_trash(&collision, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    // Stale dataset and stale revision are both refused.
    let mut stale = record_change(&s, &deleted, "warranty", &warranty_id, false);
    stale.generation = "stale".into();
    assert_eq!(
        s.saved_record_trash_request(&stale, TODAY)
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
    assert_eq!(
        s.change_record_trash(&stale, TODAY).unwrap_err().code,
        "STALE_DATASET"
    );
    let mut stale_revision = record_change(&s, &deleted, "warranty", &warranty_id, false);
    stale_revision.expected_revision = deleted.asset.revision - 1;
    assert_eq!(
        s.change_record_trash(&stale_revision, TODAY)
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    // A fresh request whose target equals the current state is not a success.
    let fresh_delete = RecordChange {
        request_id: id(),
        ..record_change(&s, &deleted, "warranty", &warranty_id, true)
    };
    assert_eq!(
        s.change_record_trash(&fresh_delete, TODAY)
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    // Unknown record or wrong kind is rejected without side effects.
    assert_eq!(
        s.change_record_trash(
            &record_change(&s, &deleted, "maintenance", &warranty_id, false),
            TODAY
        )
        .unwrap_err()
        .code,
        "NOT_FOUND"
    );
    assert_eq!(
        s.change_record_trash(
            &record_change(&s, &deleted, "warranty", &id(), false),
            TODAY
        )
        .unwrap_err()
        .code,
        "NOT_FOUND"
    );
    assert_eq!(trash(&s, "warranty").total, 1);
    let restore = record_change(&s, &deleted, "warranty", &warranty_id, false);
    let restored = s.change_record_trash(&restore, TODAY).unwrap();
    assert_eq!(restored.warranties.len(), 1);
    assert_eq!(restored.warranties[0].id, warranty_id);
    assert_eq!(restored.warranty_summary.total, 1);
    assert_eq!(trash(&s, "all").total, 0);
}

#[test]
fn child_delete_and_restore_blocked_while_parent_is_deleted() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构耳机");
    let with_m = add_maintenance(&mut s, &a, Some("5000"));
    let id_kept = with_m.maintenances[0].id.clone();
    // Delete the maintenance, then the parent asset.
    let deleted_m = s
        .change_record_trash(
            &record_change(&s, &with_m, "maintenance", &id_kept, true),
            TODAY,
        )
        .unwrap();
    let parent_deleted = s.change_trash(&asset_change(&s, &deleted_m, true)).unwrap();
    // The independently deleted child stays in the unified list and says the
    // parent itself is deleted (AC43/AC42).
    let list = trash(&s, "all");
    assert_eq!(list.total, 2);
    let child = list.items.iter().find(|e| e.kind == "maintenance").unwrap();
    assert_eq!(child.asset_id.as_deref(), Some(a.asset.id.as_str()));
    assert!(child.asset_deleted);
    // Restoring the child while the parent is deleted is refused, explicitly.
    let blocked = record_change(&s, &parent_deleted, "maintenance", &id_kept, false);
    assert_eq!(
        s.change_record_trash(&blocked, TODAY).unwrap_err().code,
        "PARENT_DELETED"
    );
    // Deleting another record under a deleted parent is refused too.
    assert_eq!(
        s.change_record_trash(
            &record_change(&s, &parent_deleted, "maintenance", &id_kept, true),
            TODAY
        )
        .unwrap_err()
        .code,
        "PARENT_DELETED"
    );
    // Restore the parent first, then the child succeeds on the same id.
    let parent_restored = s
        .change_trash(&asset_change(&s, &parent_deleted, false))
        .unwrap();
    assert!(parent_restored.maintenances.is_empty());
    let child_restored = s
        .change_record_trash(
            &record_change(&s, &parent_restored, "maintenance", &id_kept, false),
            TODAY,
        )
        .unwrap();
    assert_eq!(child_restored.maintenances.len(), 1);
    assert_eq!(child_restored.maintenances[0].id, id_kept);
}

#[test]
fn maintenance_restore_resists_conflicting_corrections_during_deletion() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构键盘");
    let with_m = add_maintenance(&mut s, &a, Some("3000"));
    let maintenance_id = with_m.maintenances[0].id.clone();
    let deleted = s
        .change_record_trash(
            &record_change(&s, &with_m, "maintenance", &maintenance_id, true),
            TODAY,
        )
        .unwrap();
    // While deleted, the maintenance date no longer blocks a later purchase
    // date correction (validate filters deleted rows) ...
    let corrected = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: Save {
                    request_id: id(),
                    generation: s.generation(),
                    asset_id: Some(a.asset.id.clone()),
                    expected_revision: Some(deleted.asset.revision),
                    name: a.asset.name.clone(),
                    price_cents: Some("100000".into()),
                    purchase_date: Some("2026-09-05".into()),
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    // ... so restoring now contradicts the corrected purchase date: refuse,
    // keep the deleted item and never shift dates silently.
    let blocked = record_change(&s, &corrected, "maintenance", &maintenance_id, false);
    assert_eq!(
        s.change_record_trash(&blocked, TODAY).unwrap_err().code,
        "DATE_CONFLICT"
    );
    let list = trash(&s, "maintenance");
    assert_eq!(list.total, 1);
    assert_eq!(list.items[0].id, maintenance_id);
    // A warranty restore under the same parent is unaffected.
    let with_w = add_warranty(&mut s, &corrected);
    let warranty_id = with_w.warranties[0].id.clone();
    let w_deleted = s
        .change_record_trash(
            &record_change(&s, &with_w, "warranty", &warranty_id, true),
            TODAY,
        )
        .unwrap();
    let w_restored = s
        .change_record_trash(
            &record_change(&s, &w_deleted, "warranty", &warranty_id, false),
            TODAY,
        )
        .unwrap();
    assert_eq!(w_restored.warranties.len(), 1);
    // Correct the purchase date back, then the maintenance restore succeeds.
    let repaired = s
        .save_asset(
            &SaveAsset {
                options: None,
                base: Save {
                    request_id: id(),
                    generation: s.generation(),
                    asset_id: Some(a.asset.id.clone()),
                    expected_revision: Some(w_restored.asset.revision),
                    name: a.asset.name.clone(),
                    price_cents: Some("100000".into()),
                    purchase_date: Some("2026-09-01".into()),
                },
                details: Details::default(),
                photos: None,
                classification: None,
            },
            TODAY,
        )
        .unwrap();
    let restored = s
        .change_record_trash(
            &record_change(&s, &repaired, "maintenance", &maintenance_id, false),
            TODAY,
        )
        .unwrap();
    assert!(restored.maintenances.iter().any(|m| m.id == maintenance_id));
    assert_eq!(trash(&s, "all").total, 0);
}

#[test]
fn sold_state_and_unknown_costs_survive_record_delete_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构手机");
    // E02: an unknown-cost maintenance makes totals incomplete; deleting the
    // record restores computability, restoring it makes them incomplete again.
    let with_unknown = add_maintenance(&mut s, &a, None);
    assert_eq!(with_unknown.costs.total_investment_cents, None);
    assert_eq!(with_unknown.costs.unknown_maintenance_count, 1);
    let unknown_id = with_unknown.maintenances[0].id.clone();
    let deleted = s
        .change_record_trash(
            &record_change(&s, &with_unknown, "maintenance", &unknown_id, true),
            TODAY,
        )
        .unwrap();
    assert_eq!(
        deleted.costs.total_investment_cents.as_deref(),
        Some("100000")
    );
    assert_eq!(deleted.costs.unknown_maintenance_count, 0);
    // Zero cost is a known value, not the same as unknown.
    let with_zero = add_maintenance(&mut s, &deleted, Some("0"));
    assert_eq!(
        with_zero.costs.total_investment_cents.as_deref(),
        Some("100000")
    );
    let sold = sales::Change {
        request_id: id(),
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        expected_revision: with_zero.asset.revision,
        action: sales::Action::Sell {
            fields: sales::Fields {
                date: "2026-09-10".into(),
                price_cents: "30000".into(),
                platform: String::new(),
                buyer: String::new(),
                notes: String::new(),
            },
        },
    };
    let sold = s.change_sale(&sold, TODAY).unwrap();
    assert_eq!(sold.lifecycle.state, possio_lib::lifecycle::State::Sold);
    // AC29: delete and restore the Sold asset; it stays Sold with its sale.
    let asset_deleted = s.change_trash(&asset_change(&s, &sold, true)).unwrap();
    let asset_restored = s
        .change_trash(&asset_change(&s, &asset_deleted, false))
        .unwrap();
    assert_eq!(
        asset_restored.lifecycle.state,
        possio_lib::lifecycle::State::Sold
    );
    assert_eq!(
        asset_restored.sale.as_ref().unwrap().fields.price_cents,
        "30000"
    );
    // Restoring the unknown-cost record makes costs incomplete again (E02).
    let incomplete = s
        .change_record_trash(
            &record_change(&s, &asset_restored, "maintenance", &unknown_id, false),
            TODAY,
        )
        .unwrap();
    assert_eq!(incomplete.costs.total_investment_cents, None);
    assert_eq!(incomplete.costs.net_cost_cents, None);
    assert_eq!(incomplete.costs.unknown_maintenance_count, 1);
}

#[test]
fn mixed_deletes_keep_files_and_survive_backup_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构咖啡机");
    let asset_photo = s
        .stage_photo(
            "camera.png",
            include_bytes!("fixtures/camera.png"),
            &s.generation(),
            None,
        )
        .unwrap();
    let a = s
        .save_asset(
            &SaveAsset {
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
                photos: Some(Selection {
                    ids: vec![asset_photo.id.clone()],
                    cover_id: Some(asset_photo.id.clone()),
                }),
            },
            TODAY,
        )
        .unwrap();
    // The maintenance photo reuses identical bytes: the hash file is shared.
    let shared_photo = s
        .stage_photo(
            "camera.png",
            include_bytes!("fixtures/camera.png"),
            &s.generation(),
            None,
        )
        .unwrap();
    let with_m = s
        .change_maintenance(
            &maintenance::Change {
                request_id: id(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: a.asset.revision,
                action: maintenance::Action::Add {
                    fields: maintenance::Fields {
                        date: Some("2026-09-03".into()),
                        kind: "service".into(),
                        title: "虚构保养".into(),
                        description: String::new(),
                        cost_cents: Some("4000".into()),
                        provider: String::new(),
                    },
                    photos: Selection {
                        ids: vec![shared_photo.id.clone()],
                        cover_id: None,
                    },
                },
            },
            TODAY,
        )
        .unwrap();
    let with_w = add_warranty(&mut s, &with_m);
    let maintenance_id = with_m.maintenances[0].id.clone();
    let warranty_id = with_w.warranties[0].id.clone();
    // One of each kind deleted at once.
    let m_deleted = s
        .change_record_trash(
            &record_change(&s, &with_w, "maintenance", &maintenance_id, true),
            TODAY,
        )
        .unwrap();
    let w_deleted = s
        .change_record_trash(
            &record_change(&s, &m_deleted, "warranty", &warranty_id, true),
            TODAY,
        )
        .unwrap();
    let b = create(&mut s, "虚构录音设备");
    s.change_trash(&asset_change(&s, &b, true)).unwrap();
    // The asset photo and its bytes survive every deletion; the maintenance
    // attachment is still readable while its record is deleted.
    assert_eq!(
        s.image_bytes(&asset_photo.id).unwrap(),
        include_bytes!("fixtures/camera.png").to_vec()
    );
    assert_eq!(
        s.image_bytes(&shared_photo.id).unwrap(),
        include_bytes!("fixtures/camera.png").to_vec()
    );
    assert_eq!(w_deleted.photos.len(), 1);
    assert_eq!(trash(&s, "all").total, 3);
    // Backup and restore into a fresh library keeps all three delete marks.
    let archive = root.path().join("t11.possio");
    s.backup(Some(&archive)).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut restored_store = Store::open(other.path()).unwrap();
    restored_store
        .restore(
            &archive,
            &archive_hash(&archive).unwrap(),
            &restored_store.generation(),
        )
        .unwrap();
    let list = restored_store
        .list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 0,
        })
        .unwrap();
    assert_eq!(list.total, 3);
    let restored_record = restored_store
        .record_at(&a.asset.id, TODAY)
        .unwrap()
        .unwrap();
    assert!(restored_record.maintenances.is_empty());
    assert!(restored_record.warranties.is_empty());
    assert_eq!(
        restored_store.image_bytes(&asset_photo.id).unwrap(),
        include_bytes!("fixtures/camera.png").to_vec()
    );
    let recovered = restored_store
        .change_record_trash(
            &RecordChange {
                request_id: id(),
                generation: restored_store.generation(),
                asset_id: a.asset.id.clone(),
                record_id: maintenance_id.clone(),
                kind: "maintenance".into(),
                expected_revision: w_deleted.asset.revision,
                deleted: false,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(recovered.maintenances.len(), 1);
    assert_eq!(recovered.maintenances[0].photos.len(), 1);
}

#[test]
fn unified_list_filters_orders_and_pages_stably() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = create(&mut s, "虚构电脑");
    let b = create(&mut s, "虚构相机");
    let with_m = add_maintenance(&mut s, &a, Some("1000"));
    let maintenance_id = with_m.maintenances[0].id.clone();
    let with_w = add_warranty(&mut s, &with_m);
    let warranty_id = with_w.warranties[0].id.clone();
    // Order of deletion events: maintenance, asset b, warranty.
    let m_deleted = s
        .change_record_trash(
            &record_change(&s, &with_w, "maintenance", &maintenance_id, true),
            TODAY,
        )
        .unwrap();
    let _b_deleted = s.change_trash(&asset_change(&s, &b, true)).unwrap();
    let w_deleted = s
        .change_record_trash(
            &record_change(&s, &m_deleted, "warranty", &warranty_id, true),
            TODAY,
        )
        .unwrap();
    let all = trash(&s, "all");
    assert_eq!(all.total, 3);
    assert_eq!(
        all.items
            .iter()
            .map(|e| e.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["warranty", "asset", "maintenance"]
    );
    for filter in ["asset", "maintenance", "warranty"] {
        let one = trash(&s, filter);
        assert_eq!(one.total, 1);
        assert_eq!(one.items[0].kind, filter);
    }
    // The maintenance/warranty entries name their (still live) parent.
    let m_entry = trash(&s, "maintenance").items.remove(0);
    assert_eq!(m_entry.asset_name.as_deref(), Some("虚构电脑"));
    assert!(!m_entry.asset_deleted);
    assert_eq!(m_entry.asset_state.as_deref(), Some("active"));
    assert_eq!(m_entry.asset_revision, w_deleted.asset.revision);
    let asset_entry = trash(&s, "asset").items.remove(0);
    assert_eq!(asset_entry.title, "虚构相机");
    assert_eq!(asset_entry.asset_state.as_deref(), Some("active"));
    // Paging follows the same stable order.
    let page = s
        .list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 1,
        })
        .unwrap();
    assert_eq!(page.total, 3);
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.items[0].kind, "asset");
    let beyond = s
        .list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 3,
        })
        .unwrap();
    assert_eq!(beyond.items.len(), 0);
    assert!(s
        .list_trash(&TrashQuery {
            filter: "everything".into(),
            offset: 0,
        })
        .is_err());
}

#[test]
#[cfg(feature = "fault-injection")]
fn record_trash_retry_recovers_after_injected_commit_failures() {
    for deleted in [true, false] {
        for point in ["record-trash.before_commit", "record-trash.after_commit"] {
            let root = tempfile::tempdir().unwrap();
            let mut s = Store::open(root.path()).unwrap();
            let a = create(&mut s, "虚构故障样机");
            let with_m = add_maintenance(&mut s, &a, Some("1000"));
            let maintenance_id = with_m.maintenances[0].id.clone();
            if !deleted {
                // The restore path needs a record that is already deleted.
                s.change_record_trash(
                    &record_change(&s, &with_m, "maintenance", &maintenance_id, true),
                    TODAY,
                )
                .unwrap();
            }
            let current = s.record_at(&a.asset.id, TODAY).unwrap().unwrap();
            let input = record_change(&s, &current, "maintenance", &maintenance_id, deleted);
            s.set_hook(move |p| {
                if p == point {
                    Err(Error::new("INJECTED", "故障"))
                } else {
                    Ok(())
                }
            });
            assert!(s.change_record_trash(&input, TODAY).is_err());
            drop(s);
            let mut s = Store::open(root.path()).unwrap();
            let receipt = s
                .saved_request(&input.request_id, &input.generation)
                .unwrap();
            assert_eq!(receipt.is_some(), point == "record-trash.after_commit");
            let now = s.record_at(&a.asset.id, TODAY).unwrap().unwrap();
            let still_visible = now.maintenances.iter().any(|m| m.id == maintenance_id);
            assert_eq!(
                still_visible,
                if point == "record-trash.after_commit" {
                    !deleted
                } else {
                    deleted
                }
            );
            let final_record = s.change_record_trash(&input, TODAY).unwrap();
            assert_eq!(
                final_record
                    .maintenances
                    .iter()
                    .any(|m| m.id == maintenance_id),
                !deleted
            );
            assert_eq!(
                s.change_record_trash(&input, TODAY).unwrap().asset.revision,
                final_record.asset.revision
            );
        }
    }
}
