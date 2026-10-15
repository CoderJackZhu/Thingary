use std::path::{Path, PathBuf};
use std::time::Duration;
use thingary_lib::{
    auto_backup, backup_crypto, backup_security,
    domain::Save,
    worker::{Policy, TickOutcome, Worker},
};

fn immediate() -> Policy {
    Policy {
        idle: Duration::ZERO,
        backoff: Duration::ZERO,
        today: chrono::Local::now().format("%Y-%m-%d").to_string(),
    }
}

fn fixture(root: &Path) -> Worker {
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
                        name: "虚构备份资料".into(),
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

fn publish(worker: &Worker) -> PathBuf {
    match worker.auto_backup_tick(&immediate()).unwrap() {
        TickOutcome::BackedUp(path) => path,
        other => panic!("expected a newly published backup, got {other:?}"),
    }
}

fn enable(worker: &Worker) {
    let setup = worker.backup_security_begin_setup().unwrap();
    worker
        .backup_security_confirm_setup(setup.session_id, setup.recovery_key)
        .unwrap();
}

fn files(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn old_plaintext_cannot_be_relabelled_with_the_enabled_policy() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let old_plain = publish(&worker);
    assert_eq!(
        backup_crypto::sniff(&old_plain).unwrap(),
        backup_crypto::Envelope::Zip
    );
    assert!(files(&extra).is_empty());

    enable(&worker);
    let after_enable = files(&extra);
    assert_eq!(
        after_enable.len(),
        1,
        "the first encrypted backup is copied"
    );
    assert!(after_enable[0].ends_with(".thingary.age"));
    worker.auto_backup_extra_now(&old_plain);
    assert_eq!(files(&extra), after_enable);
    assert!(!extra.join(old_plain.file_name().unwrap()).exists());
}

#[test]
fn old_key_archive_cannot_be_copied_after_rotation() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    enable(&worker);
    let old_name = files(&extra).pop().unwrap();
    let old_source = auto_backup::backup_dir(&root).join(&old_name);
    enable(&worker);
    assert_eq!(files(&extra).len(), 2);
    std::fs::remove_file(extra.join(&old_name)).unwrap();
    let remaining = files(&extra);
    worker.auto_backup_extra_now(&old_source);
    assert_eq!(files(&extra), remaining);
}

#[test]
fn unconfigured_and_damaged_policies_pause_existing_extra_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let source = publish(&worker);
    std::fs::remove_file(backup_security::policy_path(&root)).unwrap();
    worker.auto_backup_extra_now(&source);
    assert!(matches!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::Paused(_)
    ));
    assert!(files(&extra).is_empty());

    std::fs::write(
        backup_security::policy_path(&root),
        b"invalid configuration",
    )
    .unwrap();
    worker.auto_backup_extra_now(&source);
    assert!(matches!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::Paused(_)
    ));
    assert!(files(&extra).is_empty());
}

#[test]
fn extra_directory_change_requires_a_fresh_current_policy_archive() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let first = dir.path().join("first");
    let second = dir.path().join("second");
    std::fs::create_dir(&first).unwrap();
    std::fs::create_dir(&second).unwrap();
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(first.clone()).unwrap();
    let old = publish(&worker);
    worker.auto_backup_set_extra(second.clone()).unwrap();
    worker.auto_backup_extra_now(&old);
    assert!(files(&first).is_empty());
    assert!(files(&second).is_empty());
    let fresh = publish(&worker);
    assert_ne!(fresh, old);
    worker.auto_backup_extra_now(&fresh);
    assert_eq!(files(&second).len(), 1);
    assert!(files(&first).is_empty());
}

#[test]
fn enabling_from_a_recovery_key_also_copies_the_first_ciphertext() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let identity = age::x25519::Identity::generate();
    worker
        .backup_security_enable_from_key(backup_crypto::recovery_key_file_text(&identity))
        .unwrap();
    let names = files(&extra);
    assert_eq!(names.len(), 1);
    let copied = extra.join(&names[0]);
    let plain = dir.path().join("verified.thingary");
    backup_crypto::decrypt_to(&identity, &copied, &plain).unwrap();
    worker
        .call(move |store| {
            store
                .inspect_backup(&plain)
                .map(|summary| assert_eq!(summary.assets, 1))
        })
        .unwrap();
}

#[test]
fn offline_extra_copy_retries_the_same_artifact_without_any_new_write() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("currently-offline");
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let source = publish(&worker);
    worker.auto_backup_extra_now(&source);
    assert!(worker
        .auto_backup_status()
        .unwrap()
        .extra_last_error
        .is_some());
    assert!(!auto_backup::marker_path(&root).exists());
    let count = auto_backup::list(&auto_backup::backup_dir(&root)).len();
    let mut backoff = immediate();
    backoff.backoff = Duration::from_secs(3600);
    assert!(!matches!(
        worker.auto_backup_tick(&backoff).unwrap(),
        TickOutcome::ExtraPending(_)
    ));

    std::fs::create_dir(&extra).unwrap();
    assert_eq!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::ExtraPending(source.clone())
    );
    worker.auto_backup_extra_now(&source);
    let status = worker.auto_backup_status().unwrap();
    assert!(status.extra_last_error.is_none());
    assert!(status.extra_last_at.is_some());
    assert_eq!(files(&extra).len(), 1);
    assert_eq!(
        auto_backup::list(&auto_backup::backup_dir(&root)).len(),
        count
    );
    assert_eq!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::NoMarker
    );
}

#[test]
fn replaced_published_source_is_rejected_before_extra_publication() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let source = publish(&worker);
    std::fs::write(&source, b"fictional replacement bytes").unwrap();
    worker.auto_backup_extra_now(&source);
    assert!(
        files(&extra).is_empty(),
        "neither a final file nor partial remains"
    );
    assert!(worker
        .auto_backup_status()
        .unwrap()
        .extra_last_error
        .is_some());
    assert!(auto_backup::marker_path(&root).exists());
    let fresh = publish(&worker);
    assert_ne!(fresh, source);
    worker.auto_backup_extra_now(&fresh);
    assert_eq!(files(&extra).len(), 1);
    assert!(worker
        .auto_backup_status()
        .unwrap()
        .extra_last_error
        .is_none());
    assert_eq!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::NoMarker
    );
}

#[test]
fn deleted_pending_source_is_regenerated_without_another_factual_write() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let source = publish(&worker);
    std::fs::remove_file(&source).unwrap();
    worker.auto_backup_extra_now(&source);
    assert!(files(&extra).is_empty());
    assert!(auto_backup::marker_path(&root).exists());
    let fresh = publish(&worker);
    assert_ne!(fresh, source);
    worker.auto_backup_extra_now(&fresh);
    assert_eq!(files(&extra).len(), 1);
    assert!(worker
        .auto_backup_status()
        .unwrap()
        .extra_last_error
        .is_none());
}

#[test]
fn restart_with_an_extra_location_regenerates_a_verified_artifact() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("library");
    let extra = dir.path().join("extra");
    std::fs::create_dir(&extra).unwrap();
    let worker = fixture(&root);
    worker.backup_security_choose_plaintext().unwrap();
    worker.auto_backup_set_extra(extra.clone()).unwrap();
    let old_source = publish(&worker);
    worker.auto_backup_extra_now(&old_source);
    assert!(!auto_backup::marker_path(&root).exists());
    drop(worker);

    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let restarted = loop {
        match Worker::start(root.clone()) {
            Ok(worker) => break worker,
            Err(error) if error.code == "LOCKED" && std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => panic!("isolated worker restart failed: {error}"),
        }
    };
    assert!(auto_backup::marker_path(&root).exists());
    restarted.auto_backup_extra_now(&old_source);
    assert_eq!(
        files(&extra).len(),
        1,
        "old files are not rebound on restart"
    );
    let fresh = publish(&restarted);
    assert_ne!(fresh, old_source);
    restarted.auto_backup_extra_now(&fresh);
    assert_eq!(files(&extra).len(), 2);
}
