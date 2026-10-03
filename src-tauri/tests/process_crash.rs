#![cfg(feature = "fault-injection")]
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Cursor,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use thingary_lib::{
    backup::archive_hash, domain::Save, files::Attach, storage::Store, trash::TrashChange,
};
#[derive(Serialize, Deserialize)]
struct Case {
    action: String,
    point: String,
    save: Save,
    attach: Attach,
    bytes: Vec<u8>,
    photo_save: Option<thingary_lib::catalog::SaveAsset>,
}
fn request(s: &Store, name: &str) -> Save {
    Save {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: None,
        expected_revision: None,
        name: name.into(),
        price_cents: Some("100000".into()),
        purchase_date: Some("2026-09-15".into()),
    }
}
#[test]
fn crash_child() {
    let Ok(root) = std::env::var("THINGARY_CRASH_TEST_ROOT") else {
        return;
    };
    let root = Path::new(&root);
    let case: Case = serde_json::from_slice(&fs::read(root.join("case.json")).unwrap()).unwrap();
    let mut s = Store::open(&root.join("data")).unwrap();
    let point = case.point.clone();
    let marker = root.join("ready");
    s.set_hook(move |p| {
        if p == point {
            fs::write(&marker, p).unwrap();
            loop {
                std::thread::park();
            }
        }
        Ok(())
    });
    match case.action.as_str() {
        "save" => {
            s.save(&case.save, "2026-09-24").unwrap();
        }
        "trash-delete" | "trash-restore" => {
            s.change_trash(&TrashChange {
                request_id: case.attach.request_id.clone(),
                generation: case.save.generation.clone(),
                asset_id: case.attach.asset_id.clone(),
                expected_revision: if case.action == "trash-delete" { 1 } else { 2 },
                deleted: case.action == "trash-delete",
            })
            .unwrap();
        }
        "photo-save" => {
            s.save_asset(case.photo_save.as_ref().unwrap(), "2026-09-24")
                .unwrap();
        }
        "photo-stage" => {
            s.stage_photo("样例", &case.bytes, &s.generation(), None)
                .unwrap();
        }
        "image" => {
            s.attach(&case.attach, &case.bytes).unwrap();
        }
        "backup" => {
            s.backup(Some(&root.join("output.thingary"))).unwrap();
        }
        "restore" => {
            let archive = root.join("source.thingary");
            s.restore(&archive, &archive_hash(&archive).unwrap(), &s.generation())
                .unwrap();
        }
        _ => panic!("unknown test action"),
    };
    panic!("fault point not reached");
}
fn kill_at(root: &Path, case: &Case) {
    fs::write(root.join("case.json"), serde_json::to_vec(case).unwrap()).unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "crash_child", "--nocapture"])
        .env("THINGARY_CRASH_TEST_ROOT", root)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let started = Instant::now();
    while !root.join("ready").exists() {
        if let Some(status) = child.try_wait().unwrap() {
            panic!("child exited before {}: {status}", case.point);
        }
        if started.elapsed() > Duration::from_secs(10) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("timeout at {}", case.point);
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    child.kill().unwrap();
    let status = child.wait().unwrap();
    assert!(!status.success());
    println!("SIGKILL verified at {}", case.point);
}
#[test]
fn real_process_termination_preserves_complete_state() {
    for (action, points) in [
        ("save", vec!["save.before_commit", "save.after_commit"]),
        (
            "photo-save",
            vec!["save.before_commit", "save.after_commit"],
        ),
        (
            "photo-stage",
            vec!["photo.before_place", "photo.after_place"],
        ),
        (
            "trash-delete",
            vec!["trash.before_commit", "trash.after_commit"],
        ),
        (
            "trash-restore",
            vec!["trash.before_commit", "trash.after_commit"],
        ),
        (
            "image",
            vec![
                "image.after_stage",
                "image.after_place",
                "image.before_commit",
                "image.after_commit",
            ],
        ),
        (
            "backup",
            vec!["backup.after_snapshot", "backup.before_publish"],
        ),
        (
            "restore",
            vec![
                "restore.after_extract",
                "restore.after_validate",
                "restore.before_protection",
                "restore.after_protection",
                "restore.after_dataset",
                "restore.after_close",
                "restore.after_journal",
                "restore.after_pointer",
                "restore.after_open",
            ],
        ),
    ] {
        for point in points {
            let root = tempfile::tempdir().unwrap();
            let mut s = Store::open(&root.path().join("data")).unwrap();
            let save = request(&s, "备份前");
            let mut bytes = Cursor::new(Vec::new());
            image::RgbImage::new(8, 8)
                .write_to(&mut bytes, image::ImageFormat::Png)
                .unwrap();
            let mut attach = Attach {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: uuid::Uuid::new_v4().to_string(),
                expected_revision: 1,
            };
            let mut photo = None;
            if !["save", "photo-save", "photo-stage"].contains(&action) {
                attach.asset_id = s.save(&save, "2026-09-24").unwrap().id;
            }
            if action == "trash-restore" {
                s.change_trash(&TrashChange {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: attach.asset_id.clone(),
                    expected_revision: 1,
                    deleted: true,
                })
                .unwrap();
            }
            if action == "restore" {
                photo = Some(s.attach(&attach, bytes.get_ref()).unwrap());
                s.backup(Some(&root.path().join("source.thingary")))
                    .unwrap();
                let mut edit = request(&s, "备份后");
                edit.asset_id = Some(attach.asset_id.clone());
                edit.expected_revision = Some(2);
                s.save(&edit, "2026-09-24").unwrap();
            }
            let photo_save = if action == "photo-save" {
                let p = s
                    .stage_photo("样例", bytes.get_ref(), &s.generation(), None)
                    .unwrap();
                Some(thingary_lib::catalog::SaveAsset {
                    options: None,
                    classification: None,
                    base: save.clone(),
                    details: Default::default(),
                    photos: Some(thingary_lib::photos::Selection {
                        ids: vec![p.id.clone()],
                        cover_id: Some(p.id),
                    }),
                })
            } else {
                None
            };
            let case = Case {
                photo_save,
                action: action.into(),
                point: point.into(),
                save: save.clone(),
                attach: attach.clone(),
                bytes: bytes.into_inner(),
            };
            drop(s);
            kill_at(root.path(), &case);
            let mut s = Store::open(&root.path().join("data")).unwrap();
            match action {
                "photo-stage" => {
                    assert_eq!(s.count().unwrap(), 0);
                    let p = s
                        .stage_photo("重试", &case.bytes, &s.generation(), None)
                        .unwrap();
                    assert!(s.photo_preview(&p.id, &s.generation()).is_ok());
                }
                "photo-save" => {
                    assert_eq!(
                        s.count().unwrap(),
                        if point == "save.after_commit" { 1 } else { 0 }
                    );
                    let req = case.photo_save.as_ref().unwrap();
                    let a = s.save_asset(req, "2026-09-24").unwrap();
                    assert_eq!(a.photos.len(), 1);
                    assert_eq!(a.cover_id, req.photos.as_ref().unwrap().cover_id);
                    assert_eq!(
                        s.save_asset(req, "2026-09-24").unwrap().asset.id,
                        a.asset.id
                    );
                    assert_eq!(s.image_bytes(&a.photos[0].id).unwrap(), case.bytes);
                    assert_eq!(s.count().unwrap(), 1);
                }
                "save" => {
                    assert_eq!(
                        s.count().unwrap(),
                        if point == "save.before_commit" { 0 } else { 1 }
                    );
                    let a = s.save(&save, "2026-09-24").unwrap();
                    assert_eq!(s.save(&save, "2026-09-24").unwrap(), a);
                    assert_eq!(s.count().unwrap(), 1);
                }
                "trash-delete" | "trash-restore" => {
                    let deleted = action == "trash-delete";
                    let revision = if deleted { 1 } else { 2 };
                    let record = s.record(&attach.asset_id).unwrap().unwrap();
                    assert_eq!(
                        record.deleted,
                        if point == "trash.after_commit" {
                            deleted
                        } else {
                            !deleted
                        }
                    );
                    let request = TrashChange {
                        request_id: attach.request_id.clone(),
                        generation: save.generation.clone(),
                        asset_id: attach.asset_id.clone(),
                        expected_revision: revision,
                        deleted,
                    };
                    assert_eq!(
                        s.change_trash(&request).unwrap().asset.revision,
                        revision + 1
                    );
                    assert_eq!(
                        s.change_trash(&request).unwrap().asset.revision,
                        revision + 1
                    );
                }
                "image" => {
                    let a = s.attach(&attach, &case.bytes).unwrap();
                    assert_eq!(s.image_bytes(&a.id).unwrap(), case.bytes);
                    assert_eq!(s.attach(&attach, &case.bytes).unwrap().id, a.id);
                    assert_eq!(s.asset(&attach.asset_id).unwrap().unwrap().revision, 2);
                }
                "backup" => {
                    assert!(!root.path().join("output.thingary").exists());
                    assert_eq!(s.count().unwrap(), 1);
                }
                "restore" => {
                    let expected =
                        if ["restore.after_pointer", "restore.after_open"].contains(&point) {
                            "备份前"
                        } else {
                            "备份后"
                        };
                    assert_eq!(s.asset(&attach.asset_id).unwrap().unwrap().name, expected);
                    assert_eq!(s.image_bytes(&photo.unwrap().id).unwrap(), case.bytes);
                }
                _ => unreachable!(),
            }
        }
    }
}
