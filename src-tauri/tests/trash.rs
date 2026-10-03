use thingary_lib::{
    backup::archive_hash,
    catalog::{Details, Query, SaveAsset},
    domain::{Error, Save},
    files::Attach,
    storage::Store,
    trash::TrashChange,
};
fn save(s: &Store) -> SaveAsset {
    SaveAsset {
        options: None,
        classification: None,
        photos: None,
        base: Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构相机".into(),
            price_cents: Some("0".into()),
            purchase_date: None,
        },
        details: Details {
            notes: "完整保留".into(),
            ..Details::default()
        },
    }
}
fn query(deleted: bool) -> Query {
    Query {
        category: Default::default(),
        search: String::new(),
        filter: if deleted { "deleted" } else { "all" }.into(),
        sort: "deleted".into(),
        descending: true,
        offset: 0,
        warranty: "all".into(),
        label: None,
    }
}
fn change(s: &Store, id: &str, revision: i64, deleted: bool) -> TrashChange {
    TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: id.into(),
        expected_revision: revision,
        deleted,
    }
}
#[test]
fn trash_restore_preserves_identity_files_and_backup() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = s.save_asset(&save(&s), "2026-09-24").unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::RgbImage::new(4, 4)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let photo = s
        .attach(
            &Attach {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: 1,
            },
            bytes.get_ref(),
        )
        .unwrap();
    let delete = change(&s, &a.asset.id, 2, true);
    let deleted = s.change_trash(&delete).unwrap();
    assert!(deleted.deleted_at.is_some());
    assert_eq!(deleted.asset.revision, 3);
    assert_eq!(
        s.query_assets(&query(false), "2026-09-24").unwrap().total,
        0
    );
    assert_eq!(s.query_assets(&query(true), "2026-09-24").unwrap().total, 1);
    assert_eq!(s.image_bytes(&photo.id).unwrap(), bytes.get_ref().clone());
    assert_eq!(
        s.change_trash(&delete).unwrap().deleted_at,
        deleted.deleted_at
    );
    let archive = root.path().join("trash.thingary");
    s.backup(Some(&archive)).unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut restored = Store::open(other.path()).unwrap();
    restored
        .restore(
            &archive,
            &archive_hash(&archive).unwrap(),
            &restored.generation(),
        )
        .unwrap();
    assert_eq!(
        restored.record(&a.asset.id).unwrap().unwrap().deleted_at,
        deleted.deleted_at
    );
    assert_eq!(
        restored.image_bytes(&photo.id).unwrap(),
        bytes.get_ref().clone()
    );
    drop(s);
    let mut s = Store::open(root.path()).unwrap();
    let restore = change(&s, &a.asset.id, 3, false);
    let b = s.change_trash(&restore).unwrap();
    assert!(!b.deleted);
    assert_eq!(b.deleted_at, None);
    assert_eq!(b.asset.id, a.asset.id);
    assert_eq!(b.details, a.details);
    assert_eq!(b.asset.price_cents, a.asset.price_cents);
    assert_eq!(b.asset.purchase_date, a.asset.purchase_date);
    assert_eq!(b.created_at, a.created_at);
    assert_eq!(b.updated_at, a.updated_at);
    assert_eq!(b.asset.revision, 4);
    assert_eq!(s.change_trash(&restore).unwrap().asset.revision, 4);
    // Old delete receipt cannot undo a later restore, and vice versa.
    assert!(!s.change_trash(&delete).unwrap().deleted);
    assert_eq!(
        s.query_assets(&query(false), "2026-09-24").unwrap().total,
        1
    );
    assert_eq!(s.query_assets(&query(true), "2026-09-24").unwrap().total, 0);
    assert_eq!(s.count().unwrap(), 1);
}
#[test]
fn stale_edits_and_conflicting_trash_actions_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let mut draft = save(&s);
    let a = s.save_asset(&draft, "2026-09-24").unwrap();
    let delete = change(&s, &a.asset.id, 1, true);
    s.change_trash(&delete).unwrap();
    draft.base.request_id = uuid::Uuid::new_v4().to_string();
    draft.base.asset_id = Some(a.asset.id.clone());
    draft.base.expected_revision = Some(1);
    assert_eq!(
        s.save_asset(&draft, "2026-09-24").unwrap_err().code,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        s.change_trash(&change(&s, &a.asset.id, 1, false))
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    let mut collision = delete.clone();
    collision.deleted = false;
    assert_eq!(
        s.change_trash(&collision).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    collision.request_id = uuid::Uuid::new_v4().to_string();
    collision.generation = "stale".into();
    assert_eq!(
        s.change_trash(&collision).unwrap_err().code,
        "STALE_DATASET"
    );
    assert!(s.record(&a.asset.id).unwrap().unwrap().deleted);
}
#[test]
#[cfg(feature = "fault-injection")]
fn deletion_and_restore_retry_after_commit_failures() {
    for deleted in [true, false] {
        for point in ["trash.before_commit", "trash.after_commit"] {
            let root = tempfile::tempdir().unwrap();
            let mut s = Store::open(root.path()).unwrap();
            let a = s.save_asset(&save(&s), "2026-09-24").unwrap();
            if !deleted {
                s.change_trash(&change(&s, &a.asset.id, 1, true)).unwrap();
            }
            let revision = if deleted { 1 } else { 2 };
            let q = change(&s, &a.asset.id, revision, deleted);
            s.set_hook(move |p| {
                if p == point {
                    Err(Error::new("INJECTED", "故障"))
                } else {
                    Ok(())
                }
            });
            assert!(s.change_trash(&q).is_err());
            drop(s);
            let mut s = Store::open(root.path()).unwrap();
            let receipt = s.saved_request(&q.request_id, &q.generation).unwrap();
            assert_eq!(receipt.is_some(), point == "trash.after_commit");
            let current = s.record(&a.asset.id).unwrap().unwrap();
            assert_eq!(
                current.deleted,
                if point == "trash.after_commit" {
                    deleted
                } else {
                    !deleted
                }
            );
            let final_record = s.change_trash(&q).unwrap();
            assert_eq!(final_record.asset.revision, revision + 1);
            assert_eq!(s.change_trash(&q).unwrap().asset.revision, revision + 1);
        }
    }
}
