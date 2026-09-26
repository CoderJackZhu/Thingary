use possio_lib::{
    backup::archive_hash,
    catalog::{Details, SaveAsset},
    domain::{Error, Save},
    photos::Selection,
    storage::Store,
    trash::TrashChange,
};
use std::{fs, io::Cursor, path::Path};
const PNG: &[u8] = include_bytes!("fixtures/camera.png");
const HEIC: &[u8] = include_bytes!("fixtures/camera.heic");
fn input(s: &Store, ids: Vec<String>) -> SaveAsset {
    SaveAsset {
        options: None,
        classification: None,
        base: Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构图片档案".into(),
            price_cents: None,
            purchase_date: None,
        },
        details: Details::default(),
        photos: Some(Selection {
            cover_id: ids.first().cloned(),
            ids,
        }),
    }
}
fn dataset(root: &Path) -> std::path::PathBuf {
    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("active.json")).unwrap()).unwrap();
    root.join("datasets").join(active["id"].as_str().unwrap())
}
#[test]
fn all_four_formats_and_invalid_images() {
    let root = tempfile::tempdir().unwrap();
    let s = Store::open(root.path()).unwrap();
    let mut formats = vec![PNG.to_vec(), HEIC.to_vec()];
    for format in [image::ImageFormat::Jpeg, image::ImageFormat::WebP] {
        let mut out = Cursor::new(Vec::new());
        image::load_from_memory(PNG)
            .unwrap()
            .write_to(&mut out, format)
            .unwrap();
        formats.push(out.into_inner());
    }
    for bytes in formats {
        let photo = s
            .stage_photo("样例", &bytes, &s.generation(), None)
            .unwrap();
        let preview = s.photo_preview(&photo.id, &s.generation()).unwrap();
        let decoded = image::load_from_memory(&preview).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (480, 320));
    }
    assert!(s
        .stage_photo("伪装.heic", b"not an image", &s.generation(), None)
        .is_err());
    assert!(s
        .stage_photo("损坏.heic", &HEIC[..HEIC.len() / 2], &s.generation(), None)
        .is_err());
    assert_eq!(
        s.stage_photo(
            "超限",
            &vec![0; 20 * 1024 * 1024 + 1],
            &s.generation(),
            None
        )
        .unwrap_err()
        .code,
        "IMAGE_SIZE"
    );
    assert_eq!(s.count().unwrap(), 0); // Selecting or abandoning images alone cannot create assets.
}
#[test]
fn originals_survive_move_cover_change_trash_and_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let source = root.path().join("camera.heic");
    fs::write(&source, HEIC).unwrap();
    let p = s.stage_photo_path(&source, &s.generation(), None).unwrap();
    let q = s
        .stage_photo("second.png", PNG, &s.generation(), None)
        .unwrap();
    fs::rename(&source, root.path().join("moved.heic")).unwrap();
    let mut request = input(&s, vec![p.id.clone(), q.id.clone()]);
    let a = s.save_asset(&request, "2026-09-24").unwrap();
    assert_eq!(a.photos.len(), 2);
    assert_eq!(a.cover_id, Some(p.id.clone()));
    assert_eq!(s.image_bytes(&p.id).unwrap(), HEIC);
    request.base.request_id = uuid::Uuid::new_v4().to_string();
    request.base.asset_id = Some(a.asset.id.clone());
    request.base.expected_revision = Some(1);
    request.photos = Some(Selection {
        ids: vec![q.id.clone()],
        cover_id: Some(q.id.clone()),
    });
    let b = s.save_asset(&request, "2026-09-24").unwrap();
    assert_eq!(b.cover_id, Some(q.id.clone()));
    assert_eq!(s.image_bytes(&p.id).unwrap(), HEIC);
    for (deleted, revision) in [(true, 2), (false, 3)] {
        let r = s
            .change_trash(&TrashChange {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: revision,
                deleted,
            })
            .unwrap();
        assert_eq!(r.photos, b.photos);
        assert_eq!(r.cover_id, b.cover_id);
    }
    let archive = root.path().join("images.possio");
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
        restored.record(&a.asset.id).unwrap().unwrap().photos,
        b.photos
    );
    assert_eq!(restored.image_bytes(&p.id).unwrap(), HEIC);
    assert!(restored
        .photo_preview(&q.id, &restored.generation())
        .is_ok());
}
#[test]
fn missing_original_repair_and_atomic_rejection() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let p = s
        .stage_photo("camera.heic", HEIC, &s.generation(), None)
        .unwrap();
    let request = input(&s, vec![p.id.clone()]);
    for entry in fs::read_dir(dataset(root.path()).join("files")).unwrap() {
        fs::remove_file(entry.unwrap().path()).unwrap();
    }
    assert_eq!(
        s.photo_preview(&p.id, &s.generation()).unwrap_err().code,
        "IMAGE_MISSING"
    ); // Cache cannot hide a missing original.
    assert!(s.save_asset(&request, "2026-09-24").is_err());
    assert_eq!(s.count().unwrap(), 0);
    assert_eq!(
        s.stage_photo("wrong.png", PNG, &s.generation(), Some(&p.id))
            .unwrap_err()
            .code,
        "REPAIR_MISMATCH"
    );
    s.stage_photo("repaired.heic", HEIC, &s.generation(), Some(&p.id))
        .unwrap();
    let a = s.save_asset(&request, "2026-09-24").unwrap();
    let foreign = input(&s, vec![p.id.clone()]);
    assert_eq!(
        s.save_asset(&foreign, "2026-09-24").unwrap_err().code,
        "IMAGE_OWNER"
    );
    assert_eq!(s.count().unwrap(), 1);
    let mut invalid = request.clone();
    invalid.base.request_id = uuid::Uuid::new_v4().to_string();
    invalid.base.asset_id = Some(a.asset.id.clone());
    invalid.base.expected_revision = Some(1);
    invalid.base.name = "不应保存".into();
    invalid.photos.as_mut().unwrap().cover_id = Some(uuid::Uuid::new_v4().to_string());
    assert!(s.save_asset(&invalid, "2026-09-24").is_err());
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().asset.name,
        a.asset.name
    );
}
#[test]
#[cfg(feature = "fault-injection")]
fn failed_staging_and_commit_retry_are_complete() {
    for point in ["photo.before_place", "photo.after_place"] {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::open(root.path()).unwrap();
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "故障"))
            } else {
                Ok(())
            }
        });
        assert!(s.stage_photo("camera", PNG, &s.generation(), None).is_err());
        assert_eq!(s.count().unwrap(), 0);
        s.set_hook(|_| Ok(()));
        assert!(s.stage_photo("camera", PNG, &s.generation(), None).is_ok());
    }
    for point in ["save.before_commit", "save.after_commit"] {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::open(root.path()).unwrap();
        let p = s
            .stage_photo("camera", HEIC, &s.generation(), None)
            .unwrap();
        let request = input(&s, vec![p.id.clone()]);
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "故障"))
            } else {
                Ok(())
            }
        });
        assert!(s.save_asset(&request, "2026-09-24").is_err());
        drop(s);
        let mut s = Store::open(root.path()).unwrap();
        assert_eq!(
            s.count().unwrap(),
            if point == "save.after_commit" { 1 } else { 0 }
        );
        let a = s.save_asset(&request, "2026-09-24").unwrap();
        assert_eq!(a.photos.len(), 1);
        assert_eq!(a.cover_id, Some(p.id));
        assert_eq!(
            s.save_asset(&request, "2026-09-24").unwrap().asset.id,
            a.asset.id
        );
        assert_eq!(s.count().unwrap(), 1);
    }
}
#[test]
fn schema_three_migrates_existing_attachments() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let a = s.save_asset(&input(&s, vec![]), "2026-09-24").unwrap();
    let photo = s
        .attach(
            &possio_lib::files::Attach {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: a.asset.id.clone(),
                expected_revision: 1,
            },
            PNG,
        )
        .unwrap();
    drop(s);
    let db = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
    db.execute_batch("DROP TABLE reminders; DROP TABLE feature_audit; DROP TABLE feature_requests; DROP TABLE wishlist_preferences; DROP TABLE asset_preferences; DROP TABLE disabled_choices; DROP TABLE named_choices; DROP TABLE wishlist_audit; DROP TABLE wishlist_media; DROP TABLE wishlist_attachments; DROP TABLE wishlist_items; DROP TRIGGER asset_purchase_after_maintenance_update; DROP TRIGGER asset_purchase_after_maintenance_insert; DROP TRIGGER maintenance_dates_update; DROP TRIGGER maintenance_dates_insert; DROP TABLE maintenance_photos; DROP TABLE maintenance_audit; DROP TABLE maintenances; DROP TABLE sale_audit; DROP TABLE sales; DROP TABLE lifecycle_events; ALTER TABLE assets DROP COLUMN lifecycle_state; DROP TRIGGER asset_taxonomy_insert; DROP TRIGGER asset_taxonomy_update; DROP INDEX assets_category; DROP INDEX assets_channel; ALTER TABLE assets DROP COLUMN category_id; ALTER TABLE assets DROP COLUMN channel_id; DROP TABLE categories; DROP TABLE channels; DROP TABLE taxonomy_state; DROP TABLE taxonomy_requests; DROP TABLE asset_media; DROP TABLE asset_photos; DROP TRIGGER warranty_dates_update; DROP TRIGGER warranty_dates_insert; DROP TABLE warranty_audit; DROP TABLE warranty_photos; DROP TABLE warranties; DROP TABLE materials; PRAGMA user_version=3;")
        .unwrap();
    drop(db);
    let s = Store::open(root.path()).unwrap();
    let r = s.record(&a.asset.id).unwrap().unwrap();
    assert_eq!(r.cover_id, Some(photo.id.clone()));
    assert_eq!(r.photos[0].id, photo.id);
    assert_eq!(s.image_bytes(&photo.id).unwrap(), PNG);
}

#[test]
fn preview_honors_orientation_and_dimension_limits() {
    let mut jpeg = Cursor::new(Vec::new());
    image::load_from_memory(PNG)
        .unwrap()
        .write_to(&mut jpeg, image::ImageFormat::Jpeg)
        .unwrap();
    // Minimal synthetic EXIF: orientation 6, rotate 90 degrees clockwise.
    let exif = [
        b'E', b'x', b'i', b'f', 0, 0, b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0,
        0, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
    oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend_from_slice(&exif);
    oriented.extend_from_slice(&jpeg.into_inner()[2..]);
    let preview = possio_lib::native_images::preview(&oriented).unwrap();
    let image = image::load_from_memory(&preview).unwrap();
    assert_eq!((image.width(), image.height()), (320, 480));
    let mut oversized = Cursor::new(Vec::new());
    image::RgbImage::new(12001, 1)
        .write_to(&mut oversized, image::ImageFormat::Png)
        .unwrap();
    assert_eq!(
        possio_lib::native_images::preview(oversized.get_ref())
            .unwrap_err()
            .code,
        "IMAGE_DIMENSIONS"
    );
}
