use std::path::Path;
use thingary_lib::{
    backup, backup_crypto, backup_security,
    backup_task::Cancellation,
    catalog::{Details, SaveAsset},
    domain::Save,
    photos::Selection,
    storage::Store,
};

fn save(store: &mut Store, name: &str, photos: Vec<String>) {
    store
        .save_asset(
            &SaveAsset {
                options: None,
                classification: None,
                base: Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: name.into(),
                    price_cents: None,
                    purchase_date: None,
                },
                details: Details::default(),
                photos: Some(Selection {
                    cover_id: photos.first().cloned(),
                    ids: photos,
                }),
            },
            "2026-10-15",
        )
        .unwrap();
}

fn entries(dir: &Path) -> usize {
    std::fs::read_dir(dir).unwrap().count()
}

#[test]
fn prepared_snapshot_packs_on_another_thread_after_live_images_are_removed() {
    let root = tempfile::tempdir().unwrap();
    let mut store = Store::open(root.path()).unwrap();
    let photo = store
        .stage_photo(
            "虚构图",
            include_bytes!("fixtures/camera.png"),
            &store.generation(),
            None,
        )
        .unwrap();
    save(&mut store, "快照内虚构物品", vec![photo.id]);
    let staging = backup_security::ensure_staging(root.path()).unwrap();
    let cancel = Cancellation::default();
    let prepared = store.prepare_backup(&staging, &cancel).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let prepared_dir = std::fs::read_dir(&staging)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            std::fs::metadata(prepared_dir)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    save(&mut store, "冻结后新增的虚构物品", vec![]);
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.path().join("active.json")).unwrap()).unwrap();
    let live_files = root
        .path()
        .join("datasets")
        .join(active["id"].as_str().unwrap())
        .join("files");
    for file in std::fs::read_dir(live_files).unwrap() {
        std::fs::remove_file(file.unwrap().path()).unwrap();
    }
    drop(store);
    let archive = std::thread::spawn(move || prepared.pack(&cancel).unwrap())
        .join()
        .unwrap();
    let summary =
        backup::inspect_frozen_with(archive.path(), root.path(), &Cancellation::default()).unwrap();
    assert_eq!(summary.assets, 1, "metadata comes from the frozen database");
    assert_eq!(
        summary.files, 1,
        "images stay pinned independently of the live library"
    );
    drop(archive);
    assert_eq!(entries(&staging), 0);
}

#[test]
fn cancelled_prepare_and_pack_remove_only_their_own_staging() {
    let root = tempfile::tempdir().unwrap();
    let store = Store::open(root.path()).unwrap();
    let staging = backup_security::ensure_staging(root.path()).unwrap();
    let cancelled = Cancellation::default();
    cancelled.cancel();
    assert_eq!(
        store
            .prepare_backup(&staging, &cancelled)
            .err()
            .unwrap()
            .code,
        "CANCELLED"
    );
    assert_eq!(entries(&staging), 0);
    let prepared = store
        .prepare_backup(&staging, &Cancellation::default())
        .unwrap();
    assert_eq!(prepared.pack(&cancelled).unwrap_err().code, "CANCELLED");
    assert_eq!(entries(&staging), 0);
}

#[test]
fn staged_outputs_stay_unpublished_until_guarded_commit_and_never_clobber() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    std::fs::write(&source, b"fictional bytes").unwrap();
    let identity = age::x25519::Identity::generate();
    let destination = root.path().join("encrypted.age");
    let staged = backup_crypto::encrypt_staged(
        &identity.to_public(),
        &source,
        &destination,
        &Cancellation::default(),
    )
    .unwrap();
    let temp_path = staged.path().to_path_buf();
    assert!(!destination.exists());
    drop(staged);
    assert!(!temp_path.exists());
    let staged = backup_crypto::encrypt_staged(
        &identity.to_public(),
        &source,
        &destination,
        &Cancellation::default(),
    )
    .unwrap();
    backup::publish_staged(staged, &destination).unwrap();
    let original = std::fs::read(&destination).unwrap();
    let second = backup::stage_plaintext(
        &source,
        &root.path().join("unused"),
        &Cancellation::default(),
    )
    .unwrap();
    assert!(backup::publish_staged(second, &destination).is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), original);
    let plain = root.path().join("plain");
    backup_crypto::decrypt_to_cancel(&identity, &destination, &plain, &Cancellation::default())
        .unwrap();
    assert_eq!(std::fs::read(plain).unwrap(), b"fictional bytes");
}

#[test]
fn cancelled_file_operations_leave_no_output() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    std::fs::write(&source, b"fictional bytes").unwrap();
    let destination = root.path().join("destination");
    let flag = Cancellation::default();
    flag.cancel();
    let identity = age::x25519::Identity::generate();
    assert_eq!(
        backup::stage_plaintext(&source, &destination, &flag)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert_eq!(
        backup_crypto::encrypt_staged(&identity.to_public(), &source, &destination, &flag)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert_eq!(
        backup_crypto::decrypt_to_cancel(&identity, &source, &destination, &flag)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert_eq!(
        backup::freeze_with_cancel(&source, root.path(), 1024, &flag)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert_eq!(
        backup::file_digest_with_cancel(&source, 1024, &flag)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert_eq!(
        backup::inspect_frozen_with(&source, root.path(), &flag)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert!(!destination.exists());
    assert_eq!(entries(root.path()), 1);
}

#[test]
fn inspection_cancel_does_not_remove_a_background_readers_frozen_file() {
    let root = tempfile::tempdir().unwrap();
    let frozen = tempfile::NamedTempFile::new_in(root.path()).unwrap();
    let path = frozen.path().to_path_buf();
    let inspection = backup_security::Inspection::new_encrypted(
        "token".into(),
        "fictional.age".into(),
        frozen,
        "digest".into(),
        "generation".into(),
    );
    let held = inspection.frozen_handle().unwrap();
    let mut inspections = backup_security::Inspections::default();
    inspections.begin(inspection);
    assert!(inspections.cancel("token"));
    assert!(path.exists());
    drop(held);
    assert!(!path.exists());
}

#[test]
fn task_cancel_does_not_queue_behind_a_busy_storage_worker() {
    use std::sync::mpsc;
    use std::time::Duration;
    use thingary_lib::worker::Worker;
    let root = tempfile::tempdir().unwrap();
    let worker = Worker::start(root.path().join("library")).unwrap();
    worker.switch_demo(false).unwrap();
    worker.backup_security_choose_plaintext().unwrap();
    let task_id = worker.backup_task_begin().unwrap();
    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (release_tx, release_rx) = mpsc::sync_channel(1);
    worker
        .call(move |store| {
            store.set_hook(move |point| {
                if point == "backup.before_snapshot" {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }
                Ok(())
            });
            Ok(())
        })
        .unwrap();
    let destination = root.path().join("cancelled.thingary");
    let path = destination.clone();
    let writer = worker.clone();
    let write_id = task_id.clone();
    let export =
        std::thread::spawn(move || writer.create_backup_file_task(path, false, Some(write_id)));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let canceller = worker.clone();
    let (done_tx, done_rx) = mpsc::sync_channel(1);
    let cancel = std::thread::spawn(move || {
        done_tx
            .send(canceller.backup_task_cancel(&task_id))
            .unwrap()
    });
    let result = done_rx.recv_timeout(Duration::from_secs(1));
    release_tx.send(()).unwrap();
    cancel.join().unwrap();
    assert!(
        result.unwrap().unwrap(),
        "cancellation bypasses the blocked Worker queue"
    );
    assert_eq!(export.join().unwrap().unwrap_err().code, "CANCELLED");
    assert!(!destination.exists());
}
