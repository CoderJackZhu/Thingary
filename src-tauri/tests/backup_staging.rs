use std::path::Path;
use thingary_lib::{backup_crypto, backup_security, domain::Save, worker::Worker};

fn worker(root: &Path) -> Worker {
    let worker = Worker::start(root.to_path_buf()).unwrap();
    worker.switch_demo(false).unwrap();
    worker
        .call(|store| {
            store
                .save(
                    &Save {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        generation: store.generation(),
                        asset_id: None,
                        expected_revision: None,
                        name: "虚构相机".into(),
                        price_cents: None,
                        purchase_date: None,
                    },
                    &chrono::Local::now().format("%Y-%m-%d").to_string(),
                )
                .map(|_| ())
        })
        .unwrap();
    worker
}

fn staged_entries(root: &Path) -> usize {
    std::fs::read_dir(backup_security::staging_root(root))
        .map(|entries| entries.count())
        .unwrap_or(0)
}

#[test]
fn other_backups_preserve_the_checked_restore_session() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let worker = worker(&root);
    let setup = worker.backup_security_begin_setup().unwrap();
    worker
        .backup_security_confirm_setup(setup.session_id, setup.recovery_key.clone())
        .unwrap();
    let cipher = dir.path().join("source.thingary.age");
    worker.create_backup_file(cipher.clone(), false).unwrap();
    let session = worker.backup_inspect_begin(cipher).unwrap();
    worker
        .backup_session_unlock(session.token.clone(), setup.recovery_key)
        .unwrap();
    assert_eq!(staged_entries(&root), 2);

    worker
        .create_backup_file(dir.path().join("other.thingary.age"), false)
        .unwrap();
    worker
        .create_backup_file(dir.path().join("explicit-plain.thingary"), true)
        .unwrap();
    assert_eq!(
        staged_entries(&root),
        2,
        "only the frozen cipher and decrypted inspection remain"
    );
    worker.backup_session_restore(session.token).unwrap();
    assert_eq!(staged_entries(&root), 0);
}

#[test]
fn invalid_inner_archive_leaves_no_decrypted_plaintext() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let worker = worker(&root);
    let identity = age::x25519::Identity::generate();
    let plain = dir.path().join("invalid-inner");
    std::fs::write(&plain, b"fictional authenticated data, not a Thingary ZIP").unwrap();
    let cipher = dir.path().join("invalid-inner.age");
    backup_crypto::encrypt_to(&identity.to_public(), &plain, &cipher).unwrap();
    let session = worker.backup_inspect_begin(cipher).unwrap();
    assert!(worker
        .backup_session_unlock(
            session.token.clone(),
            backup_crypto::recovery_key_file_text(&identity),
        )
        .is_err());
    assert_eq!(
        staged_entries(&root),
        1,
        "only the frozen cipher remains for retry"
    );
    for entry in std::fs::read_dir(backup_security::staging_root(&root)).unwrap() {
        let path = entry.unwrap().path();
        assert!(path.is_file(), "no decrypted inspection directory survives");
        assert_eq!(
            backup_crypto::sniff(&path).unwrap(),
            backup_crypto::Envelope::Age
        );
    }
    worker.backup_session_cancel(session.token).unwrap();
    assert_eq!(staged_entries(&root), 0);
}

#[test]
fn cancel_and_drop_remove_only_their_own_decrypted_directory() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let staging = backup_security::ensure_staging(&root).unwrap();
    let unrelated = staging.join("unrelated-active-job");
    std::fs::create_dir(&unrelated).unwrap();
    for cancel in [true, false] {
        let frozen = tempfile::NamedTempFile::new_in(&root).unwrap();
        let mut session = backup_security::Inspection::new_encrypted(
            "token".into(),
            "fictional.age".into(),
            frozen,
            "cipher-digest".into(),
            "generation".into(),
        );
        let plain_dir = tempfile::tempdir_in(&staging).unwrap();
        let owned_path = plain_dir.path().to_path_buf();
        let plain = owned_path.join("backup.thingary");
        std::fs::write(&plain, b"fictional plaintext").unwrap();
        session.set_decrypted(plain, "plain-digest".into(), plain_dir);
        let mut inspections = backup_security::Inspections::default();
        inspections.begin(session);
        if cancel {
            assert!(inspections.cancel("token"));
        }
        drop(inspections);
        assert!(!owned_path.exists());
        assert!(unrelated.is_dir());
    }
}

#[test]
fn startup_removes_orphan_inspection_staging_without_touching_valid_data() {
    use thingary_lib::{backup, backup_task::Cancellation, storage::Store};
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let mut store = Store::open(&root).unwrap();
    store
        .save(
            &Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: store.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构保留资料".into(),
                price_cents: None,
                purchase_date: None,
            },
            "2026-10-15",
        )
        .unwrap();
    let auto_dir = root.join("auto-backups");
    std::fs::create_dir(&auto_dir).unwrap();
    let valid_auto = auto_dir.join("物谱自动备份-2026-10-15.thingary");
    store.backup(Some(&valid_auto)).unwrap();
    let manual = dir.path().join("valid-manual.thingary");
    std::fs::copy(&valid_auto, &manual).unwrap();
    let protection = root.join("protection");
    std::fs::create_dir(&protection).unwrap();
    let protected = protection.join("valid.thingary");
    std::fs::copy(&valid_auto, &protected).unwrap();
    let expected = std::fs::read(&valid_auto).unwrap();
    let before_pointer = std::fs::read(root.join("active.json")).unwrap();
    let staging = backup_security::ensure_staging(&root).unwrap();

    // Keep intentionally leaked handles to model process death: no RAII
    // destructor runs, so only the next Worker's startup cleanup can remove it.
    let frozen =
        backup::freeze_with_cancel(&manual, &root, u64::MAX - 1, &Cancellation::default()).unwrap();
    assert_eq!(frozen.path().parent().unwrap(), staging);
    let (file, orphan_frozen) = frozen.keep().unwrap();
    drop(file);
    let orphan_dir = tempfile::tempdir_in(&staging).unwrap().keep();
    std::fs::write(
        orphan_dir.join("data.sqlite"),
        b"fictional abandoned validation database",
    )
    .unwrap();
    std::fs::write(
        orphan_dir.join("backup.thingary"),
        b"fictional abandoned plaintext",
    )
    .unwrap();
    std::fs::hard_link(&valid_auto, orphan_dir.join("pinned-artifact")).unwrap();
    let unrelated = root.join("unrelated-temporary-file");
    std::fs::write(&unrelated, b"keep unrelated data").unwrap();
    drop(store);

    let worker = Worker::start(root.clone()).unwrap();
    assert!(!orphan_frozen.exists());
    assert!(!orphan_dir.exists());
    assert!(!staging.exists());
    assert_eq!(
        std::fs::read(root.join("active.json")).unwrap(),
        before_pointer
    );
    assert_eq!(worker.call(|store| store.count()).unwrap(), 1);
    for path in [&valid_auto, &manual, &protected] {
        assert_eq!(std::fs::read(path).unwrap(), expected);
    }
    assert_eq!(std::fs::read(unrelated).unwrap(), b"keep unrelated data");
}

#[cfg(unix)]
#[test]
fn existing_staging_directory_permissions_are_restricted_before_reuse() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let staging = backup_security::staging_root(dir.path());
    std::fs::create_dir(&staging).unwrap();
    std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755)).unwrap();
    backup_security::ensure_staging(dir.path()).unwrap();
    assert_eq!(
        std::fs::metadata(staging).unwrap().permissions().mode() & 0o777,
        0o700
    );
}
