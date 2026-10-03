use std::io::Cursor;
use thingary_lib::{
    backup::archive_hash,
    domain::Save,
    files::{Attach, MAX_IMAGE_BYTES},
    storage::Store,
};

/// Incompressible PNG just under the per-image limit, distinct per seed.
fn noise_png(seed: u32) -> Vec<u8> {
    let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    let image = image::RgbImage::from_fn(2400, 2400, |_, _| {
        let mut px = [0u8; 3];
        for c in &mut px {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            *c = state as u8;
        }
        image::Rgb(px)
    });
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    let bytes = bytes.into_inner();
    assert!(bytes.len() > 16 * 1024 * 1024 && bytes.len() <= MAX_IMAGE_BYTES);
    bytes
}

/// Regression: a library above the old 100 MiB cap must still back up, and
/// restore (which first takes a protection backup of it) must still work.
#[test]
fn libraries_above_the_former_100_mib_cap_back_up_and_restore() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let asset = s
        .save(
            &Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "大图虚构样例".into(),
                price_cents: None,
                purchase_date: None,
            },
            "2026-09-27",
        )
        .unwrap();
    let mut revision = asset.revision;
    let mut total = 0;
    for seed in 0..7 {
        let bytes = noise_png(seed);
        total += bytes.len();
        s.attach(
            &Attach {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: asset.id.clone(),
                expected_revision: revision,
            },
            &bytes,
        )
        .unwrap();
        revision += 1;
    }
    assert!(total > 100 * 1024 * 1024);
    let archive = root.path().join("large.thingary");
    s.backup(Some(&archive)).unwrap();
    assert!(std::fs::metadata(&archive).unwrap().len() > 100 * 1024 * 1024);
    let summary = s.inspect_backup(&archive).unwrap();
    assert_eq!(summary.files, 7);
    // Restoring into the same, equally large library exercises the protection backup.
    let generation = s.generation();
    s.restore(&archive, &archive_hash(&archive).unwrap(), &generation)
        .unwrap();
    assert_ne!(s.generation(), generation);
    assert_eq!(s.asset(&asset.id).unwrap().unwrap().revision, revision);
}
