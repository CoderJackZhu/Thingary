use possio_lib::{
    domain::{Error, Save},
    files::{validate_image, Attach},
    storage::Store,
};
use std::io::Cursor;
fn fixture(format: image::ImageFormat) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        12,
        8,
        image::Rgb([54, 95, 197]),
    ))
    .write_to(&mut out, format)
    .unwrap();
    out.into_inner()
}
fn seed(s: &mut Store) -> (String, i64) {
    let a = s
        .save(
            &Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构".into(),
                price_cents: None,
                purchase_date: None,
            },
            "2026-09-24",
        )
        .unwrap();
    (a.id, a.revision)
}
#[test]
fn formats_and_corruption() {
    for f in [
        image::ImageFormat::Png,
        image::ImageFormat::Jpeg,
        image::ImageFormat::WebP,
    ] {
        assert!(validate_image(&fixture(f)).is_ok());
    }
    assert!(validate_image(b"not an image").is_err());
    let mut b = fixture(image::ImageFormat::Png);
    b.truncate(25);
    assert!(validate_image(&b).is_err());
    assert!(validate_image(&vec![0; 20 * 1024 * 1024 + 1]).is_err());
}
#[cfg(feature = "fault-injection")]
#[test]
fn interrupted_image_retries_keep_original() {
    for point in [
        "image.before_write",
        "image.after_stage",
        "image.after_place",
        "image.before_commit",
        "image.after_commit",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(dir.path()).unwrap();
        let (id, revision) = seed(&mut s);
        let q = Attach {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: id.clone(),
            expected_revision: revision,
        };
        let b = fixture(image::ImageFormat::Png);
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "模拟写入故障"))
            } else {
                Ok(())
            }
        });
        assert!(s.attach(&q, &b).is_err());
        drop(s);
        let mut s = Store::open(dir.path()).unwrap();
        let a = s.attach(&q, &b).unwrap();
        assert_eq!(s.attach(&q, &b).unwrap().id, a.id);
        assert_eq!(s.image_bytes(&a.id).unwrap(), b);
        assert_eq!(s.asset(&id).unwrap().unwrap().revision, 2);
    }
}
#[test]
fn source_move_shared_and_deleted_references() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let bytes = fixture(image::ImageFormat::Png);
    let source = dir.path().join("source.png");
    std::fs::write(&source, &bytes).unwrap();
    let mut images = Vec::new();
    for _ in 0..2 {
        let (id, revision) = seed(&mut s);
        let q = Attach {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: id,
            expected_revision: revision,
        };
        images.push(s.attach(&q, &std::fs::read(&source).unwrap()).unwrap());
    }
    std::fs::rename(&source, dir.path().join("moved.png")).unwrap();
    drop(s);
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("active.json")).unwrap()).unwrap();
    let db = rusqlite::Connection::open(
        dir.path()
            .join("datasets")
            .join(active["id"].as_str().unwrap())
            .join("data.sqlite"),
    )
    .unwrap();
    db.execute("UPDATE assets SET deleted_at='2026-09-24'", [])
        .unwrap();
    drop(db);
    let s = Store::open(dir.path()).unwrap();
    assert_eq!(images[0].file, images[1].file);
    for a in images {
        assert_eq!(s.image_bytes(&a.id).unwrap(), bytes);
    }
}
