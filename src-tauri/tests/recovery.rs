use possio_lib::{
    backup::archive_hash,
    domain::{Error, Save},
    files::Attach,
    storage::Store,
};
use std::{
    io::{Cursor, Read, Write},
    path::Path,
};
fn input(s: &Store, name: &str) -> Save {
    Save {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        asset_id: None,
        expected_revision: None,
        name: name.into(),
        price_cents: Some("100000".into()),
        purchase_date: None,
    }
}
fn backup_fixture(root: &Path) -> (Store, String, String, std::path::PathBuf) {
    let mut s = Store::open(root).unwrap();
    let a = s.save(&input(&s, "备份前"), "2026-09-24").unwrap();
    let mut b = Cursor::new(Vec::new());
    image::RgbImage::new(8, 8)
        .write_to(&mut b, image::ImageFormat::Png)
        .unwrap();
    let photo = s
        .attach(
            &Attach {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: a.id.clone(),
                expected_revision: 1,
            },
            b.get_ref(),
        )
        .unwrap();
    let backup = root.join("source.possio");
    s.backup(Some(&backup)).unwrap();
    let mut edit = input(&s, "备份后");
    edit.asset_id = Some(a.id.clone());
    edit.expected_revision = Some(2);
    s.save(&edit, "2026-09-24").unwrap();
    (s, a.id, photo.id, backup)
}
fn rewrite(src: &Path, dst: &Path, change: impl Fn(&str, Vec<u8>) -> Option<(String, Vec<u8>)>) {
    let mut input = zip::ZipArchive::new(std::fs::File::open(src).unwrap()).unwrap();
    let mut out = zip::ZipWriter::new(std::fs::File::create(dst).unwrap());
    for i in 0..input.len() {
        let mut f = input.by_index(i).unwrap();
        let name = f.name().to_owned();
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes).unwrap();
        if let Some((name, b)) = change(&name, bytes) {
            out.start_file(
                name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            out.write_all(&b).unwrap();
        }
    }
    out.finish().unwrap();
}
#[test]
fn complete_restore_and_stale_requests() {
    let root = tempfile::tempdir().unwrap();
    let (mut s, id, photo, backup) = backup_fixture(root.path());
    let gen = s.generation();
    let hash = archive_hash(&backup).unwrap();
    s.restore(&backup, &hash, &gen).unwrap();
    assert_ne!(gen, s.generation());
    assert_eq!(s.asset(&id).unwrap().unwrap().name, "备份前");
    assert!(!s.image_bytes(&photo).unwrap().is_empty());
    let mut stale = input(&s, "旧请求");
    stale.generation = gen;
    assert_eq!(
        s.save(&stale, "2026-09-24").unwrap_err().code,
        "STALE_DATASET"
    );
    drop(s);
    let s = Store::open(root.path()).unwrap();
    assert_eq!(s.asset(&id).unwrap().unwrap().name, "备份前");
    let fresh = tempfile::tempdir().unwrap();
    let mut other = Store::open(fresh.path()).unwrap();
    other.restore(&backup, &hash, &other.generation()).unwrap();
    assert_eq!(other.asset(&id).unwrap().unwrap().name, "备份前");
    assert!(!other.image_bytes(&photo).unwrap().is_empty());
}
#[test]
fn bad_archives_leave_current_data() {
    let root = tempfile::tempdir().unwrap();
    let (mut s, id, _, src) = backup_fixture(root.path());
    for case in [
        "missing",
        "corrupt",
        "version",
        "traversal",
        "absolute",
        "unexpected",
    ] {
        let dst = root.path().join(format!("{case}.possio"));
        rewrite(&src, &dst, |name, mut b| {
            if case == "missing" && name.starts_with("files/") {
                return None;
            }
            if case == "corrupt" && name == "data.sqlite" {
                b[0] ^= 1;
            }
            if case == "version" && name == "manifest.json" {
                let mut m: serde_json::Value = serde_json::from_slice(&b).unwrap();
                m["format"] = 99.into();
                b = serde_json::to_vec(&m).unwrap();
            }
            let n = if name.starts_with("files/") {
                match case {
                    "traversal" => "../escape".into(),
                    "absolute" => "/tmp/escape".into(),
                    "unexpected" => "secret.txt".into(),
                    _ => name.into(),
                }
            } else {
                name.into()
            };
            Some((n, b))
        });
        assert!(
            s.restore(&dst, &archive_hash(&dst).unwrap(), &s.generation())
                .is_err(),
            "{case}"
        );
        assert_eq!(s.asset(&id).unwrap().unwrap().name, "备份后");
    }
    assert_eq!(
        s.restore(&src, "wrong fingerprint", &s.generation())
            .unwrap_err()
            .code,
        "BACKUP_CHANGED"
    );
}
#[cfg(feature = "fault-injection")]
#[test]
fn interrupted_switch_selects_a_complete_dataset() {
    for point in [
        "restore.after_extract",
        "restore.after_validate",
        "restore.before_protection",
        "restore.after_protection",
        "restore.after_dataset",
        "restore.after_close",
        "restore.after_journal",
        "restore.after_pointer",
        "restore.after_open",
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut s, id, photo, src) = backup_fixture(root.path());
        let generation = s.generation();
        let hash = archive_hash(&src).unwrap();
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "模拟恢复中断"))
            } else {
                Ok(())
            }
        });
        assert!(s.restore(&src, &hash, &generation).is_err());
        drop(s);
        let s = Store::open(root.path()).unwrap();
        let expected = if ["restore.after_pointer", "restore.after_open"].contains(&point) {
            "备份前"
        } else {
            "备份后"
        };
        assert_eq!(s.asset(&id).unwrap().unwrap().name, expected, "{point}");
        assert!(!s.image_bytes(&photo).unwrap().is_empty());
    }
}

#[cfg(feature = "fault-injection")]
#[test]
fn legacy_migration_failure_preserves_original_and_archive() {
    use sha2::{Digest, Sha256};
    let root = tempfile::tempdir().unwrap();
    let (mut s, id, _, _) = backup_fixture(root.path());
    let legacy_path = root.path().join("legacy.sqlite");
    let db = rusqlite::Connection::open(&legacy_path).unwrap();
    db.execute_batch("CREATE TABLE assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,price_cents INTEGER,purchase_date TEXT,revision INTEGER NOT NULL CHECK(revision>0));
CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);
PRAGMA user_version=1; PRAGMA application_id=1347375955;").unwrap();
    let old_id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO assets VALUES(?1,'旧格式虚构物品',NULL,NULL,1)",
        [&old_id],
    )
    .unwrap();
    drop(db);
    let bytes = std::fs::read(&legacy_path).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":1,"created_at":"2026-09-24T00:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let archive = root.path().join("legacy.possio");
    let mut z = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    let opts =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("manifest.json", opts).unwrap();
    z.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    z.start_file("data.sqlite", opts).unwrap();
    z.write_all(&bytes).unwrap();
    z.finish().unwrap();
    let hash = archive_hash(&archive).unwrap();
    s.set_hook(|p| {
        if p == "migration.before_commit" {
            Err(Error::new("INJECTED", "模拟迁移失败"))
        } else {
            Ok(())
        }
    });
    assert!(s.restore(&archive, &hash, &s.generation()).is_err());
    assert_eq!(s.asset(&id).unwrap().unwrap().name, "备份后");
    assert_eq!(archive_hash(&archive).unwrap(), hash);
    s.set_hook(|_| Ok(()));
    s.restore(&archive, &hash, &s.generation()).unwrap();
    assert_eq!(s.asset(&old_id).unwrap().unwrap().name, "旧格式虚构物品");
}
