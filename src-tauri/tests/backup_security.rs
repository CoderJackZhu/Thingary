use std::path::{Path, PathBuf};
use thingary_lib::{
    auto_backup, backup_security,
    domain::Save,
    worker::{Policy, TickOutcome, Worker},
};

/// A syntactically valid recovery key belonging to nobody, for negative tests.
fn test_recovery_key() -> String {
    use age::secrecy::ExposeSecret;
    age::x25519::Identity::generate()
        .to_string()
        .expose_secret()
        .to_string()
}

/// Worker restarts need bounded lock retries: SQLite closes asynchronously.
fn restart_worker(root: &Path) -> Worker {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match Worker::start(root.to_owned()) {
            Ok(worker) => return worker,
            Err(error) if error.code == "LOCKED" && std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            Err(error) => panic!("worker restart failed: {error}"),
        }
    }
}

fn immediate() -> Policy {
    Policy {
        idle: std::time::Duration::from_secs(0),
        backoff: std::time::Duration::from_secs(0),
        today: chrono::Local::now().format("%Y-%m-%d").to_string(),
    }
}

fn save_asset(worker: &Worker, name: &str) {
    let name = name.to_owned();
    worker.switch_demo(false).unwrap();
    worker
        .call(move |s| {
            s.save(
                &Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name,
                    price_cents: None,
                    purchase_date: None,
                },
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
            )
            .map(|_| ())
        })
        .unwrap();
}

/// Completes the generate → re-enter → verify cycle and returns the setup
/// payload so tests can keep the recovery key.
fn enable_encryption(worker: &Worker) -> backup_security::KeySetupStarted {
    let started = worker.backup_security_begin_setup().unwrap();
    worker
        .backup_security_confirm_setup(started.session_id.clone(), started.recovery_key.clone())
        .unwrap();
    started
}

fn encrypt_with(store_worker: &Worker, destination: &Path) -> PathBuf {
    store_worker
        .create_backup_file(destination.to_path_buf(), false)
        .unwrap()
        .unwrap();
    destination.to_path_buf()
}

/// C02/C03: wrong re-entered key commits nothing; the correct key enables the
/// policy and immediately produces the first encrypted automatic backup, even
/// with no data change of its own.
#[test]
fn key_setup_verification_gates_the_enabled_policy() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");

    let started = worker.backup_security_begin_setup().unwrap();
    // A different key must not pass verification or commit anything.
    let other = test_recovery_key();
    let wrong = worker
        .backup_security_confirm_setup(started.session_id.clone(), other)
        .unwrap_err();
    assert_eq!(wrong.code, "CRYPTO_KEY");
    // A fresh library starts on the plaintext default; a wrong key changes nothing.
    let status = worker.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_DISABLED);
    assert!(status.recipient_id.is_none());

    // Cancel drops the session; its id can no longer be confirmed.
    worker
        .backup_security_cancel_setup(started.session_id.clone())
        .unwrap();
    let err = worker
        .backup_security_confirm_setup(started.session_id, started.recovery_key)
        .unwrap_err();
    assert_eq!(err.code, "SESSION");

    // The correct key enables encryption and the first backup runs at once.
    let started = worker.backup_security_begin_setup().unwrap();
    let commit = worker
        .backup_security_confirm_setup(started.session_id.clone(), started.recovery_key.clone())
        .unwrap();
    assert_eq!(commit.state, backup_security::STATE_ENABLED);
    // The commit snapshot still says waiting; the persisted outcome is success.
    let status = worker.backup_security_status().unwrap();
    assert!(matches!(
        status.first_backup,
        Some(backup_security::FirstBackup::Success { .. })
    ));
    let items = auto_backup::list(&auto_backup::backup_dir(&root));
    assert_eq!(items.len(), 1);
    assert!(items[0].name.ends_with(auto_backup::EXT_AGE));
    // No plaintext archive was ever published.
    assert!(auto_backup::list(&auto_backup::backup_dir(&root))
        .iter()
        .all(|i| !i.name.ends_with(auto_backup::EXT)));
}

/// C03/C08: the first encrypted automatic backup failing keeps the previous
/// good archive and records the failure without disabling anything.
#[cfg(feature = "fault-injection")]
#[test]
fn first_encrypted_backup_failure_keeps_old_archive_and_stays_enabled() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    enable_encryption(&worker);
    let dir = auto_backup::backup_dir(&root);
    let old = auto_backup::list(&dir);
    assert_eq!(old.len(), 1);
    let old_name = old[0].name.clone();
    worker
        .call(|s| {
            s.set_hook(|point| {
                if point == "backup.before_publish" {
                    Err(thingary_lib::domain::Error::new("INJECTED", "模拟加密失败"))
                } else {
                    Ok(())
                }
            });
            Ok(())
        })
        .unwrap();
    // Rotating with the hook armed: the new epoch's first backup fails, the
    // old key's good archive survives, and the failure is recorded.
    let rotation = worker.backup_security_begin_setup().unwrap();
    worker
        .backup_security_confirm_setup(rotation.session_id, rotation.recovery_key)
        .unwrap();
    let items = auto_backup::list(&dir);
    assert_eq!(items.len(), 1, "no partial artifact");
    assert_eq!(items[0].name, old_name, "the old good archive survives");
    let status = worker.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_ENABLED);
    assert!(matches!(
        status.first_backup,
        Some(backup_security::FirstBackup::Failed { .. })
    ));
    // The failure is surfaced through the first-backup outcome, and the
    // pending marker keeps the retry scheduled.
    assert!(auto_backup::marker_path(&root).exists());
}

/// C05/C16-environment: manual encrypted export leaves the destination with
/// only ciphertext, and private staging is cleaned afterwards.
#[test]
fn encrypted_export_never_places_plaintext_in_the_destination() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    enable_encryption(&worker);
    let target_dir = tmp.path().join("cloud-drive");
    std::fs::create_dir_all(&target_dir).unwrap();
    let target = target_dir.join("物谱备份-test.thingary.age");
    encrypt_with(&worker, &target);
    for entry in std::fs::read_dir(&target_dir).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        assert!(!name.ends_with(auto_backup::EXT) || name.ends_with(auto_backup::EXT_AGE));
        let bytes = std::fs::read(target_dir.join(&name)).unwrap();
        assert!(
            !bytes.starts_with(b"PK"),
            "no plaintext ZIP in the destination"
        );
    }
    // Private staging is removed after publication.
    let staging = root.join("backup-staging");
    let staging_leftovers = !staging.exists() || std::fs::read_dir(&staging).unwrap().count() == 0;
    assert!(staging_leftovers);
}

/// The export plan follows the policy and blocks while unconfigured.
#[test]
fn manual_export_follows_the_policy() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    // A missing policy file is not the plaintext default: it blocks until chosen.
    std::fs::remove_file(backup_security::policy_path(&root)).unwrap();
    let blocked = worker.backup_export_plan(false).unwrap();
    assert!(blocked.blocked_reason.is_some());
    let err = worker
        .create_backup_file(tmp.path().join("x.thingary"), false)
        .unwrap_err();
    assert_eq!(err.code, "SECURITY_POLICY");

    enable_encryption(&worker);
    let plan = worker.backup_export_plan(false).unwrap();
    assert!(plan.encrypted);
    assert!(plan.blocked_reason.is_none());
    let age_file = tmp.path().join("manual.thingary.age");
    encrypt_with(&worker, &age_file);
    assert_eq!(
        thingary_lib::backup_crypto::sniff(&age_file).unwrap(),
        thingary_lib::backup_crypto::Envelope::Age
    );
    // The explicit unencrypted exception still works and is plaintext.
    let plain = worker
        .create_backup_file(tmp.path().join("manual.thingary"), true)
        .unwrap()
        .unwrap();
    assert_eq!(plain, "manual.thingary");
    assert_eq!(
        thingary_lib::backup_crypto::sniff(&tmp.path().join("manual.thingary")).unwrap(),
        thingary_lib::backup_crypto::Envelope::Zip
    );
}

/// C04-equivalent at library level: the app decrypts its own ciphertext into
/// a full inspect → restore cycle (standard-CLI interop lives in the gate
/// evidence and native acceptance steps).
#[test]
fn encrypted_round_trip_unlock_and_restore() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let started = enable_encryption(&worker);
    let cipher = tmp.path().join("roundtrip.thingary.age");
    encrypt_with(&worker, &cipher);

    let inspection = worker.backup_inspect_begin(cipher.clone()).unwrap();
    assert!(inspection.encrypted);
    assert!(inspection.summary.is_none());
    // A wrong key cannot unlock; the session stays alive for a retry.
    let wrong = worker
        .backup_session_unlock(inspection.token.clone(), test_recovery_key())
        .unwrap_err();
    assert_eq!(wrong.code, "CRYPTO_AUTH");
    assert!(wrong.message.contains("无法解密"));
    let unlocked = worker
        .backup_session_unlock(inspection.token.clone(), started.recovery_key.clone())
        .unwrap();
    assert_eq!(unlocked.summary.assets, 1);

    // Restore replaces the library with the checked one-asset snapshot.
    let generation = worker
        .backup_session_restore(inspection.token.clone())
        .unwrap();
    let count = worker.call(|s| s.count()).unwrap();
    assert_eq!(count, 1);
    // A repeated confirm is idempotent, not a second restore.
    let again = worker.backup_session_restore(inspection.token).unwrap();
    assert_eq!(again, generation);
}

/// C10: after inspection the original path is replaced; the frozen session
/// bytes still unlock, because checks never re-read the chosen path.
#[test]
fn inspection_freezes_the_original_bytes() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let started = enable_encryption(&worker);
    let cipher = tmp.path().join("freeze.thingary.age");
    encrypt_with(&worker, &cipher);
    let inspection = worker.backup_inspect_begin(cipher.clone()).unwrap();
    // Someone replaces the file with garbage after inspection began.
    std::fs::write(&cipher, b"PK\x03\x04 replaced with a plain zip").unwrap();
    let unlocked = worker
        .backup_session_unlock(inspection.token.clone(), started.recovery_key)
        .unwrap();
    assert_eq!(unlocked.summary.assets, 1);
    worker.backup_session_cancel(inspection.token).unwrap();
}

/// C11: restoring ciphertext onto a machine without a usable policy persists
/// the review state before the data changes, and it survives a restart.
#[test]
fn encrypted_restore_without_a_policy_pauses_until_reviewed() {
    let tmp = tempfile::tempdir().unwrap();
    let source_root = tmp.path().join("source-library");
    let worker = Worker::start(source_root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let started = enable_encryption(&worker);
    let cipher = tmp.path().join("carry.thingary.age");
    encrypt_with(&worker, &cipher);
    // A fresh machine with no policy at all.
    let target_root = tmp.path().join("target-library");
    let target = Worker::start(target_root.clone()).unwrap();
    save_asset(&target, "虚构旧物品");
    let inspection = target.backup_inspect_begin(cipher).unwrap();
    let unlocked = target
        .backup_session_unlock(inspection.token.clone(), started.recovery_key.clone())
        .unwrap();
    assert_eq!(unlocked.summary.assets, 1);
    target.backup_session_restore(inspection.token).unwrap();
    let status = target.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_RESTORE_REVIEW);
    assert!(status.paused);
    assert!(matches!(
        target.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::Paused(_)
    ));
    // The review state survives a restart; it never silently resumes.
    drop(target);
    let restarted = restart_worker(&target_root);
    let status = restarted.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_RESTORE_REVIEW);
    // An explicit choice re-enables backups.
    restarted.backup_security_choose_plaintext().unwrap();
    assert!(matches!(
        restarted.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::BackedUp(_)
    ));
}

/// C12: a machine already enabled with key B restores key A's backup; the
/// local policy keeps key B and is disclosed through the status.
#[test]
fn restoring_another_key_keeps_the_local_enabled_policy() {
    let tmp = tempfile::tempdir().unwrap();
    let source_root = tmp.path().join("source-library");
    let worker = Worker::start(source_root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let a = enable_encryption(&worker);
    let cipher = tmp.path().join("key-a.thingary.age");
    encrypt_with(&worker, &cipher);

    let target_root = tmp.path().join("target-library");
    let target = Worker::start(target_root.clone()).unwrap();
    save_asset(&target, "虚构旧物品");
    let b = enable_encryption(&target);
    assert_ne!(a.recipient_id, b.recipient_id);
    let inspection = target.backup_inspect_begin(cipher).unwrap();
    target
        .backup_session_unlock(inspection.token.clone(), a.recovery_key)
        .unwrap();
    target.backup_session_restore(inspection.token).unwrap();
    let status = target.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_ENABLED);
    assert_eq!(
        status.recipient_id.as_deref(),
        Some(b.recipient_id.as_str())
    );
    // Subsequent automatic backups use the local key B.
    assert!(matches!(
        target.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::BackedUp(_)
    ));
    let items = auto_backup::list(&auto_backup::backup_dir(&target_root));
    assert!(items.iter().any(|i| i.name.ends_with(auto_backup::EXT_AGE)));
}

/// C13: the pre-restore protection copy stays a local plaintext and is never
/// sent to the extra location.
#[test]
fn protection_copy_stays_local_plaintext() {
    let tmp = tempfile::tempdir().unwrap();
    let source_root = tmp.path().join("source-library");
    let worker = Worker::start(source_root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let started = enable_encryption(&worker);
    let cipher = tmp.path().join("protect.thingary.age");
    encrypt_with(&worker, &cipher);

    let target_root = tmp.path().join("target-library");
    let target = Worker::start(target_root.clone()).unwrap();
    save_asset(&target, "虚构旧物品");
    let extra = tmp.path().join("extra-drive");
    std::fs::create_dir_all(&extra).unwrap();
    target.auto_backup_set_extra(extra.clone()).unwrap();
    let inspection = target.backup_inspect_begin(cipher).unwrap();
    target
        .backup_session_unlock(inspection.token.clone(), started.recovery_key)
        .unwrap();
    target.backup_session_restore(inspection.token).unwrap();
    // The protection copy exists locally and is plaintext...
    let protection = target_root.join("protection");
    let copies: Vec<_> = std::fs::read_dir(&protection)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert!(!copies.is_empty());
    for copy in copies {
        assert_eq!(
            thingary_lib::backup_crypto::sniff(&copy).unwrap(),
            thingary_lib::backup_crypto::Envelope::Zip
        );
    }
    // ...and the extra location received nothing from the restore.
    assert!(std::fs::read_dir(&extra).unwrap().next().is_none());
}

/// C06: a damaged or missing policy file pauses automatic backups and never
/// falls back to plaintext, and old ciphertext is untouched.
#[test]
fn damaged_policy_pauses_and_keeps_old_archives() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    enable_encryption(&worker);
    let dir = auto_backup::backup_dir(&root);
    let before: Vec<String> = auto_backup::list(&dir)
        .into_iter()
        .map(|i| i.name)
        .collect();
    assert_eq!(before.len(), 1);
    std::fs::write(backup_security::policy_path(&root), b"{ broken").unwrap();
    let status = worker.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_NEEDS_ATTENTION);
    assert!(status.paused);
    assert!(matches!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::Paused(_)
    ));
    let after: Vec<String> = auto_backup::list(&dir)
        .into_iter()
        .map(|i| i.name)
        .collect();
    assert_eq!(after, before, "nothing pruned or replaced");
    // Only an explicit plaintext choice repairs the state.
    worker.backup_security_choose_plaintext().unwrap();
    let status = worker.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_DISABLED);
    assert!(!status.paused);
    let after: Vec<String> = auto_backup::list(&dir)
        .into_iter()
        .map(|i| i.name)
        .collect();
    assert_eq!(after, before);
}

/// C07: an extra-location copy whose policy epoch changed mid-copy is
/// dropped instead of published.
#[test]
fn extra_copy_cancels_when_the_epoch_changed() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    enable_encryption(&worker);
    let dir = auto_backup::backup_dir(&root);
    let source = dir.join(auto_backup::list(&dir)[0].name.clone());
    let extra = tmp.path().join("extra");
    std::fs::create_dir_all(&extra).unwrap();
    let err = auto_backup::copy_extra(&source, &extra, || false).unwrap_err();
    assert_eq!(err.code, "SECURITY_EPOCH");
    assert!(std::fs::read_dir(&extra).unwrap().next().is_none());
}

/// C07b: a success only clears the change marker its snapshot covered.
#[test]
fn marker_clearing_respects_writes_after_the_snapshot() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    std::fs::create_dir_all(&root).unwrap();
    auto_backup::write_marker(&root, "session-a", 5).unwrap();
    // A write after the snapshot (count 7 > snapshot 5) stays pending.
    auto_backup::write_marker(&root, "session-a", 7).unwrap();
    auto_backup::clear_marker_if_covered(&root, "session-a", 5).unwrap();
    assert!(
        auto_backup::marker_path(&root).exists(),
        "newer writes stay pending"
    );
    auto_backup::clear_marker_if_covered(&root, "session-a", 7).unwrap();
    assert!(!auto_backup::marker_path(&root).exists());
    // A marker from an earlier session is covered by any fresh full snapshot.
    auto_backup::write_marker(&root, "session-old", 100).unwrap();
    auto_backup::clear_marker_if_covered(&root, "session-a", 1).unwrap();
    assert!(!auto_backup::marker_path(&root).exists());
    // Legacy markers keep the old clear-on-success behavior.
    std::fs::write(auto_backup::marker_path(&root), b"1").unwrap();
    auto_backup::clear_marker_if_covered(&root, "session-a", 1).unwrap();
    assert!(!auto_backup::marker_path(&root).exists());
}

/// Rotation: verifying a new key commits a new epoch, forces a fresh first
/// backup under that key, and the old key's backup stays restorable.
#[test]
fn rotation_commits_a_new_epoch_and_keeps_the_old_key_working() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let first = enable_encryption(&worker);
    let dir = auto_backup::backup_dir(&root);
    assert_eq!(auto_backup::list(&dir).len(), 1);
    let old_archive = dir.join(auto_backup::list(&dir)[0].name.clone());

    let second = worker.backup_security_begin_setup().unwrap();
    let status = worker
        .backup_security_confirm_setup(second.session_id.clone(), second.recovery_key.clone())
        .unwrap();
    assert_eq!(status.state, backup_security::STATE_ENABLED);
    assert_eq!(
        status.recipient_id.as_deref(),
        Some(second.recipient_id.as_str())
    );
    // A new epoch forces its own first backup even without data changes.
    let items = auto_backup::list(&dir);
    assert_eq!(items.len(), 2);
    assert!(items
        .iter()
        .any(|i| i.name != old_archive.file_name().unwrap().to_str().unwrap()));

    // The old key still restores the old archive.
    let target_root = tmp.path().join("rotation-target");
    let target = Worker::start(target_root).unwrap();
    save_asset(&target, "虚构别的物品");
    let inspection = target.backup_inspect_begin(old_archive).unwrap();
    target
        .backup_session_unlock(inspection.token.clone(), first.recovery_key)
        .unwrap();
    target.backup_session_restore(inspection.token).unwrap();
    let count = target.call(|s| s.count()).unwrap();
    assert_eq!(count, 1);
}

/// Turning encryption off commits plaintext semantics, keeps ciphertexts and
/// the automatic-backup switch, and re-enabling accepts a re-entered key.
#[test]
fn disable_then_reenable_from_key() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    let started = enable_encryption(&worker);
    let dir = auto_backup::backup_dir(&root);
    assert_eq!(auto_backup::list(&dir).len(), 1);

    worker.backup_security_disable().unwrap();
    let status = worker.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_DISABLED);
    // Ciphertexts survive disabling.
    assert!(auto_backup::list(&dir)[0]
        .name
        .ends_with(auto_backup::EXT_AGE));
    save_asset(&worker, "虚构镜头");
    assert!(matches!(
        worker.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::BackedUp(_)
    ));
    assert!(auto_backup::list(&dir)
        .iter()
        .any(|i| i.name.ends_with(auto_backup::EXT)));

    // Re-enabling from the user-held key works without a new generation.
    worker
        .backup_security_enable_from_key(started.recovery_key.clone())
        .unwrap();
    let status = worker.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_ENABLED);
    assert_eq!(
        status.recipient_id.as_deref(),
        Some(started.recipient_id.as_str())
    );
    // Invalid key text is rejected without changing state.
    let err = worker
        .backup_security_enable_from_key("not a key at all".into())
        .unwrap_err();
    assert_eq!(err.code, "CRYPTO_KEY");
}

/// New automatic-backup names parse for listing, restoring and pruning, and
/// random temporaries never qualify.
#[test]
fn unique_names_parse_and_random_files_do_not() {
    use thingary_lib::auto_backup as ab;
    for good in [
        "物谱自动备份-2026-10-15.thingary",
        "物谱自动备份-2026-10-15-1430-a1b2c3.thingary",
        "物谱自动备份-2026-10-15-1430-a1b2c3.thingary.age",
    ] {
        assert!(ab::is_auto_backup_name(good), "{good}");
        assert_eq!(ab::date_of(good), Some("2026-10-15"), "{good}");
    }
    for bad in [
        "物谱自动备份-2026-10-15.thingary.ag",
        "物谱自动备份-2026-10-15-1430-A1B2C3.thingary.age",
        "物谱自动备份-2026-10-15-1430-a1b2c3.zip",
        "物谱自动备份-2026-10-15-930-a1b2c3.thingary",
        ".物谱自动备份-2026-10-15-1430-a1b2c3.thingary.partial",
        "物谱自动备份-2026-10-15-1430.thingary",
    ] {
        assert!(!ab::is_auto_backup_name(bad), "{bad}");
    }
}

/// A policy file lost while the app is closed must not be taken for a first
/// run: with encrypted backups already on disk, backups stay paused until the
/// user chooses again.
#[test]
fn a_policy_file_lost_while_closed_does_not_downgrade_to_plaintext() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_asset(&worker, "虚构相机");
    enable_encryption(&worker);
    assert!(auto_backup::list(&auto_backup::backup_dir(&root))
        .iter()
        .any(|item| item.name.ends_with(auto_backup::EXT_AGE)));
    drop(worker);
    std::fs::remove_file(backup_security::policy_path(&root)).unwrap();
    let restarted = restart_worker(&root);
    let status = restarted.backup_security_status().unwrap();
    assert_eq!(status.state, backup_security::STATE_UNCONFIGURED);
    assert!(status.paused);
    assert!(!backup_security::policy_path(&root).exists());
    assert!(matches!(
        restarted.auto_backup_tick(&immediate()).unwrap(),
        TickOutcome::Paused(_)
    ));
}
