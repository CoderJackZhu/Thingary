use possio_lib::{
    backup::archive_hash,
    catalog::{Details, Query, SaveAsset},
    domain::{Error, Save},
    storage::Store,
    taxonomy::{CategoryFilter, Change, Classification, Command, Direction, Icon, Kind},
    trash::TrashChange,
};
fn change(s: &Store, command: Command) -> Change {
    Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        expected_revision: s.taxonomy_snapshot().unwrap().revision,
        command,
    }
}
fn save(s: &Store, category: Option<&str>, channel: Option<&str>) -> SaveAsset {
    SaveAsset {
        base: Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构相机".into(),
            price_cents: None,
            purchase_date: None,
        },
        details: Details {
            notes: "保留备注".into(),
            ..Default::default()
        },
        photos: None,
        classification: Some(Classification {
            category_id: category.map(Into::into),
            channel_id: channel.map(Into::into),
        }),
    }
}
fn query(category: CategoryFilter) -> Query {
    Query {
        search: "".into(),
        filter: "all".into(),
        sort: "name".into(),
        descending: false,
        offset: 0,
        category,
    }
}
fn trash(s: &Store, id: &str, revision: i64, deleted: bool) -> TrashChange {
    TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.into(),
        expected_revision: revision,
        deleted,
    }
}
#[test]
fn identity_search_and_live_and_deleted_migration() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let list = s.taxonomy_snapshot().unwrap();
    let source = list.categories[0].id.clone();
    let target = list.categories[1].id.clone();
    let channel = list.channels[0].id.clone();
    let original = save(&s, Some(&source), Some(&channel));
    let a = s.save_asset(&original, "2026-09-24").unwrap();
    let b = s
        .save_asset(&save(&s, Some(&source), None), "2026-09-24")
        .unwrap();
    let deleted = s.change_trash(&trash(&s, &b.asset.id, 1, true)).unwrap();
    let rename = change(
        &s,
        Command::Rename {
            kind: Kind::Category,
            id: source.clone(),
            name: "创作设备".into(),
        },
    );
    s.change_taxonomy(&rename).unwrap();
    let list = s.taxonomy_snapshot().unwrap();
    let entry = list.categories.iter().find(|e| e.id == source).unwrap();
    assert_eq!(entry.name, "创作设备");
    assert_eq!(
        (
            entry.references.active_assets,
            entry.references.deleted_assets
        ),
        (1, 1)
    );
    let mut q = query(CategoryFilter::Category { id: source.clone() });
    q.search = "创作".into();
    q.filter = "missing_price".into();
    assert_eq!(s.query_assets(&q, "2026-09-24").unwrap().total, 1);
    s.change_taxonomy(&change(
        &s,
        Command::SetIcon {
            id: source.clone(),
            icon: Icon::Camera,
        },
    ))
    .unwrap();
    s.change_taxonomy(&change(
        &s,
        Command::MoveCategory {
            id: source.clone(),
            direction: Direction::Down,
        },
    ))
    .unwrap();
    assert_eq!(s.taxonomy_snapshot().unwrap().categories[1].id, source);
    s.change_taxonomy(&change(
        &s,
        Command::Remove {
            kind: Kind::Category,
            id: source.clone(),
            target_id: Some(target.clone()),
        },
    ))
    .unwrap();
    let migrated = s.record(&a.asset.id).unwrap().unwrap();
    assert_eq!(migrated.classification.category_id, Some(target.clone()));
    assert_eq!(migrated.asset.revision, 2);
    assert_eq!(migrated.details, a.details);
    let b = s.record(&b.asset.id).unwrap().unwrap();
    assert!(b.deleted);
    assert_eq!(b.classification.category_id, Some(target));
    assert_eq!(b.asset.revision, deleted.asset.revision + 1);
    let mut stale = original.clone();
    stale.base.request_id = uuid::Uuid::new_v4().to_string();
    stale.base.asset_id = Some(a.asset.id.clone());
    stale.base.expected_revision = Some(1);
    assert!(s.save_asset(&stale, "2026-09-24").is_err());
    s.change_taxonomy(&change(
        &s,
        Command::Remove {
            kind: Kind::Channel,
            id: channel,
            target_id: None,
        },
    ))
    .unwrap();
    assert_eq!(
        s.record(&a.asset.id)
            .unwrap()
            .unwrap()
            .classification
            .channel_id,
        None
    );
    let restored = s
        .change_trash(&trash(&s, &b.asset.id, b.asset.revision, false))
        .unwrap();
    assert_eq!(restored.classification, b.classification);
    assert_eq!(s.count().unwrap(), 2);
    // An old client that omits classification must preserve the migrated relation.
    let mut edit = save(&s, None, None);
    edit.classification = None;
    edit.base.asset_id = Some(restored.asset.id.clone());
    edit.base.expected_revision = Some(restored.asset.revision);
    assert_eq!(
        s.save_asset(&edit, "2026-09-24").unwrap().classification,
        restored.classification
    );
}
#[test]
fn stale_snapshots_targets_names_and_receipts() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let id = s.taxonomy_snapshot().unwrap().categories[0].id.clone();
    let pending = change(
        &s,
        Command::Remove {
            kind: Kind::Category,
            id: id.clone(),
            target_id: None,
        },
    );
    s.save_asset(&save(&s, Some(&id), None), "2026-09-24")
        .unwrap();
    assert_eq!(
        s.change_taxonomy(&pending).unwrap_err().code,
        "TAXONOMY_CONFLICT"
    );
    for target in [id.clone(), "missing".into()] {
        assert!(s
            .change_taxonomy(&change(
                &s,
                Command::Remove {
                    kind: Kind::Category,
                    id: id.clone(),
                    target_id: Some(target)
                }
            ))
            .is_err());
    }
    let create = change(
        &s,
        Command::Create {
            kind: Kind::Category,
            name: "  Cafe\u{301}  ".into(),
            icon: None,
        },
    );
    let result = s.change_taxonomy(&create).unwrap();
    let created = result
        .categories
        .iter()
        .find(|e| e.name == "Café")
        .unwrap()
        .id
        .clone();
    assert_eq!(s.change_taxonomy(&create).unwrap().categories.len(), 7);
    let mut collision = create.clone();
    collision.command = Command::Create {
        kind: Kind::Category,
        name: "不同内容".into(),
        icon: None,
    };
    assert_eq!(
        s.change_taxonomy(&collision).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    assert!(s
        .change_taxonomy(&change(
            &s,
            Command::Create {
                kind: Kind::Category,
                name: "CAFé".into(),
                icon: None
            }
        ))
        .is_err());
    s.change_taxonomy(&change(
        &s,
        Command::Create {
            kind: Kind::Channel,
            name: "Café".into(),
            icon: None,
        },
    ))
    .unwrap();
    s.change_taxonomy(&change(
        &s,
        Command::Rename {
            kind: Kind::Category,
            id: created,
            name: "更名".into(),
        },
    ))
    .unwrap();
    // Retrying the old creation must not recreate or undo the later rename.
    assert!(!s
        .change_taxonomy(&create)
        .unwrap()
        .categories
        .iter()
        .any(|e| e.name == "Café"));
    assert!(serde_json::from_value::<Command>(
        serde_json::json!({"type":"remove","kind":"category","id":id})
    )
    .is_err());
    let mut wrong_gen = create;
    wrong_gen.generation = "old".into();
    assert_eq!(
        s.change_taxonomy(&wrong_gen).unwrap_err().code,
        "STALE_DATASET"
    );
}
#[test]
#[cfg(feature = "fault-injection")]
fn migration_commit_and_lost_response_are_atomic_and_retryable() {
    for point in [
        "taxonomy.after_migrate",
        "taxonomy.before_commit",
        "taxonomy.after_commit",
    ] {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::open(root.path()).unwrap();
        let id = s.taxonomy_snapshot().unwrap().categories[0].id.clone();
        let a = s
            .save_asset(&save(&s, Some(&id), None), "2026-09-24")
            .unwrap();
        let request = change(
            &s,
            Command::Remove {
                kind: Kind::Category,
                id: id.clone(),
                target_id: None,
            },
        );
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "故障"))
            } else {
                Ok(())
            }
        });
        assert!(s.change_taxonomy(&request).is_err());
        drop(s);
        let mut s = Store::open(root.path()).unwrap();
        let committed = point == "taxonomy.after_commit";
        assert_eq!(
            s.taxonomy_request(&request.request_id, &request.generation)
                .unwrap(),
            committed
        );
        let r = s.record(&a.asset.id).unwrap().unwrap();
        assert_eq!(
            r.classification.category_id,
            if committed { None } else { Some(id) }
        );
        assert_eq!(r.asset.revision, if committed { 2 } else { 1 });
        s.change_taxonomy(&request).unwrap();
        s.change_taxonomy(&request).unwrap();
        assert_eq!(s.record(&a.asset.id).unwrap().unwrap().asset.revision, 2);
        assert_eq!(s.count().unwrap(), 1);
    }
}
#[test]
fn backup_restore_preserves_taxonomy_and_rejects_old_generation() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let list = s.taxonomy_snapshot().unwrap();
    let id = list.categories[2].id.clone();
    let a = s
        .save_asset(
            &save(&s, Some(&id), Some(&list.channels[0].id)),
            "2026-09-24",
        )
        .unwrap();
    let pending = change(
        &s,
        Command::Rename {
            kind: Kind::Category,
            id: id.clone(),
            name: "更名".into(),
        },
    );
    let path = root.path().join("taxonomy.possio");
    s.backup(Some(&path)).unwrap();
    s.change_taxonomy(&pending).unwrap();
    s.restore(&path, &archive_hash(&path).unwrap(), &s.generation())
        .unwrap();
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().classification,
        a.classification
    );
    assert_eq!(s.taxonomy_snapshot().unwrap().categories[2].name, "摄影");
    assert_eq!(
        s.change_taxonomy(&pending).unwrap_err().code,
        "STALE_DATASET"
    );
    assert_eq!(
        s.query_assets(&query(CategoryFilter::Uncategorized), "2026-09-24")
            .unwrap()
            .total,
        0
    );
}
