use possio_lib::{
    backup::archive_hash,
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Result, Save},
    materials,
    photos::Selection,
    storage::Store,
};
use std::{fs, path::Path};
const TODAY: &str = "2026-09-25";
fn dataset(root: &Path) -> std::path::PathBuf {
    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("active.json")).unwrap()).unwrap();
    root.join("datasets").join(active["id"].as_str().unwrap())
}
fn save(
    s: &mut Store,
    name: &str,
    id: Option<(&str, i64)>,
    ids: Vec<String>,
    cover: Option<String>,
) -> Result<AssetRecord> {
    s.save_asset(
        &SaveAsset {
            base: Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: id.map(|(i, _)| i.to_string()),
                expected_revision: id.map(|(_, r)| r),
                name: name.into(),
                price_cents: None,
                purchase_date: None,
            },
            details: Details::default(),
            photos: Some(Selection {
                ids,
                cover_id: cover,
            }),
            classification: None,
        },
        TODAY,
    )
}
#[test]
fn catalog_matches_the_eight_embedded_illustrations_and_rejects_unknown_ids() {
    let catalog = materials::catalog().unwrap();
    let ids: Vec<&str> = catalog.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "laptop",
            "camera",
            "headphones",
            "phone",
            "tablet",
            "keyboard",
            "coffee",
            "box"
        ]
    );
    assert_eq!(
        catalog.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(),
        [
            "电脑",
            "相机",
            "耳机",
            "手机",
            "平板",
            "键盘",
            "咖啡机",
            "通用物品"
        ]
    );
    for m in &catalog {
        assert!(!material_art_is_empty(
            materials::builtin(&m.id).unwrap().bytes
        ));
    }
    for id in [
        "",
        " ",
        "../materials/laptop",
        "materials/laptop.png",
        "laptop.png",
        "laptop\x00",
        "录音设备",
        "keyboard ",
    ] {
        assert!(materials::builtin(id).is_none(), "rejected id: {id:?}");
    }
}
fn material_art_is_empty(bytes: &[u8]) -> bool {
    // The rendered originals are multi-kilobyte PNGs; a stub would betray a lost asset.
    bytes.len() < 1024 || bytes[..8] != [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
}
#[test]
fn prepare_rejects_unknown_ids_and_stale_generation_without_writes() {
    let root = tempfile::tempdir().unwrap();
    let s = Store::open(root.path()).unwrap();
    for id in ["", "../materials/laptop", "不存在"] {
        assert_eq!(
            s.prepare_material(id, &s.generation()).unwrap_err().code,
            "MATERIAL"
        );
    }
    assert_eq!(
        s.prepare_material("keyboard", "stale-generation")
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
    // Nothing was staged, committed or written to the managed folders.
    assert_eq!(s.count().unwrap(), 0);
    assert!(!dataset(root.path()).join("files").exists());
    assert!(!dataset(root.path()).join("staging").exists());
}
#[test]
fn material_selections_stage_independently_and_commit_per_asset() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let first = s.prepare_material("keyboard", &s.generation()).unwrap();
    let second = s.prepare_material("keyboard", &s.generation()).unwrap();
    assert_eq!(first.name, "键盘示意图（非实物照片）");
    assert_ne!(first.id, second.id); // Each selection owns its staged photo id.
    assert_eq!(second.name, first.name);
    // Same artwork bytes are stored once and reused by hash.
    let stored: Vec<_> = fs::read_dir(dataset(root.path()).join("files"))
        .unwrap()
        .collect();
    assert_eq!(stored.len(), 1);
    assert!(s.photo_preview(&first.id, &s.generation()).is_ok());
    // Two materials on one asset: the empty-collection first photo becomes cover.
    let tablet = s.prepare_material("tablet", &s.generation()).unwrap();
    let a = save(
        &mut s,
        "虚构键盘档案",
        None,
        vec![first.id.clone()],
        Some(first.id.clone()),
    )
    .unwrap();
    assert_eq!(a.photos.len(), 1);
    assert_eq!(a.photos[0].name, "键盘示意图（非实物照片）");
    assert_eq!(a.cover_id.as_deref(), Some(first.id.as_str()));
    let b = save(
        &mut s,
        "虚构平板与键盘",
        None,
        vec![tablet.id.clone(), second.id.clone()],
        Some(tablet.id.clone()),
    )
    .unwrap();
    assert_eq!(b.photos.len(), 2);
    assert_eq!(b.cover_id.as_deref(), Some(tablet.id.as_str()));
    assert_eq!(s.count().unwrap(), 2);
    // A committed photo of another asset must not be reused across assets.
    assert_eq!(
        save(
            &mut s,
            "不应复用他人图片",
            None,
            vec![first.id.clone()],
            Some(first.id.clone())
        )
        .err()
        .unwrap()
        .code,
        "IMAGE_OWNER"
    );
    assert_eq!(s.count().unwrap(), 2);
}
#[test]
fn material_photos_survive_reopen_and_backup_restore() {
    let root = tempfile::tempdir().unwrap();
    {
        let mut s = Store::open(root.path()).unwrap();
        let keyboard = s.prepare_material("keyboard", &s.generation()).unwrap();
        let record = save(
            &mut s,
            "虚构键盘档案",
            None,
            vec![keyboard.id.clone()],
            Some(keyboard.id.clone()),
        )
        .unwrap();
        let edited = save(
            &mut s,
            "虚构键盘档案",
            Some((record.asset.id.as_str(), record.asset.revision)),
            vec![keyboard.id.clone()],
            None,
        )
        .unwrap();
        assert_eq!(edited.photos.len(), 1);
        assert_eq!(edited.cover_id, None); // Cover may be dropped on edit.
    }
    let s = Store::open(root.path()).unwrap();
    let reopened = s.count().unwrap();
    assert_eq!(reopened, 1);
    let record = {
        let page = s
            .query_assets(
                &possio_lib::catalog::Query {
                    search: String::new(),
                    filter: "all".into(),
                    sort: "created".into(),
                    descending: true,
                    offset: 0,
                    category: Default::default(),
                },
                TODAY,
            )
            .unwrap();
        page.items[0].clone()
    };
    assert_eq!(record.photos[0].name, "键盘示意图（非实物照片）");
    assert!(s
        .photo_preview(&record.photos[0].id, &s.generation())
        .is_ok());
    // A user-uploaded material must ride the same backup and stay usable.
    let upload = root.path().join("我的相机素材.png");
    fs::write(&upload, materials::builtin("camera").unwrap().bytes).unwrap();
    let entry = s.add_material(&upload, &s.generation()).unwrap();
    assert_eq!(entry.name, "我的相机素材.png");
    let archive = root.path().join("material.possio");
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
    let recovered = restored.record(&record.asset.id).unwrap().unwrap();
    assert_eq!(recovered.photos, record.photos);
    assert!(restored
        .photo_preview(&recovered.photos[0].id, &restored.generation())
        .is_ok());
    let entries = restored.material_entries().unwrap();
    let restored_entry = entries.iter().find(|e| e.id == entry.id).unwrap();
    assert!(!restored_entry.builtin);
    assert!(restored
        .material_preview(&entry.id, &restored.generation())
        .is_ok());
    let prepared = restored
        .prepare_material(&entry.id, &restored.generation())
        .unwrap();
    assert_eq!(prepared.name, entry.name);
}

#[test]
fn user_materials_upload_remove_and_rejections() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    assert_eq!(s.material_entries().unwrap().len(), 8); // Built-ins only.
    let upload = root.path().join("我的键盘素材.png");
    fs::write(&upload, materials::builtin("keyboard").unwrap().bytes).unwrap();
    assert_eq!(
        s.add_material(&upload, "stale-generation")
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
    let entry = s.add_material(&upload, &s.generation()).unwrap();
    assert!(!entry.builtin);
    let entries = s.material_entries().unwrap();
    assert_eq!(entries.len(), 9);
    assert_eq!(entries.last().unwrap(), &entry);
    assert!(s.material_preview(&entry.id, &s.generation()).is_ok());
    // Uploaded bytes land in the content store; a second upload reuses them.
    let files: Vec<_> = fs::read_dir(dataset(root.path()).join("files"))
        .unwrap()
        .collect();
    assert_eq!(files.len(), 1);
    // Prepare keeps the user name; commits per asset as usual.
    let photo = s.prepare_material(&entry.id, &s.generation()).unwrap();
    assert_eq!(photo.name, "我的键盘素材.png");
    let record = save(
        &mut s,
        "虚构自定义素材档案",
        None,
        vec![photo.id.clone()],
        Some(photo.id.clone()),
    )
    .unwrap();
    assert_eq!(record.photos.len(), 1);
    // Built-ins cannot be removed; unknown ids are rejected.
    assert_eq!(
        s.remove_material("keyboard", &s.generation())
            .unwrap_err()
            .code,
        "MATERIAL"
    );
    assert_eq!(
        s.remove_material("not-a-uuid", &s.generation())
            .unwrap_err()
            .code,
        "MATERIAL"
    );
    let after = s.remove_material(&entry.id, &s.generation()).unwrap();
    assert_eq!(after.len(), 8);
    // Removing the library entry leaves saved assets and hosted bytes intact.
    assert!(s
        .photo_preview(&record.photos[0].id, &s.generation())
        .is_ok());
    assert_eq!(
        s.prepare_material(&entry.id, &s.generation())
            .unwrap_err()
            .code,
        "MATERIAL"
    );
    assert_eq!(s.count().unwrap(), 1);
}

#[test]
fn schema_nine_upgrade_preserves_assets_and_adds_materials() {
    let root = tempfile::tempdir().unwrap();
    {
        let mut s = Store::open(root.path()).unwrap();
        save(&mut s, "旧版虚构档案", None, vec![], None).unwrap();
    }
    // Rewind to schema 8 the way an older library would look.
    let db = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
    db.execute_batch("DROP TABLE materials; PRAGMA user_version=8;")
        .unwrap();
    drop(db);
    let s = Store::open(root.path()).unwrap();
    let version: i64 = {
        let check = rusqlite::Connection::open(dataset(root.path()).join("data.sqlite")).unwrap();
        check
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(version, 9);
    assert_eq!(s.count().unwrap(), 1);
    assert_eq!(s.material_entries().unwrap().len(), 8);
    let upload = root.path().join("迁移后素材.png");
    fs::write(&upload, materials::builtin("box").unwrap().bytes).unwrap();
    assert!(s.add_material(&upload, &s.generation()).is_ok());
}
