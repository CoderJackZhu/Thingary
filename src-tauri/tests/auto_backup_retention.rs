use chrono::{Local, TimeZone};
use std::{fs, path::Path};
use thingary_lib::auto_backup;

fn write_old(dir: &Path, suffix: &str, second: u32, encrypted: bool) -> String {
    let ext = if encrypted {
        ".thingary.age"
    } else {
        ".thingary"
    };
    let name = format!("物谱自动备份-2026-10-16-1310-{suffix}{ext}");
    let path = dir.join(&name);
    fs::write(&path, name.as_bytes()).unwrap();
    let modified = Local
        .with_ymd_and_hms(2026, 10, 16, 13, 10, second)
        .single()
        .unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified.into()))
        .unwrap();
    name
}

#[test]
fn same_minute_list_and_prune_keep_the_actual_latest_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let old: Vec<_> = (0..7)
        .map(|i| write_old(tmp.path(), &format!("f0000{i}"), i, i % 2 == 0))
        .collect();
    let newest = write_old(tmp.path(), "000000", 7, true);
    assert_eq!(auto_backup::list(tmp.path())[0].name, newest);
    auto_backup::prune(tmp.path()).unwrap();
    assert!(tmp.path().join(&newest).exists());
    assert!(!tmp.path().join(&old[0]).exists());
    assert_eq!(auto_backup::list(tmp.path()).len(), auto_backup::KEEP);
    for name in &old[1..] {
        assert_eq!(fs::read(tmp.path().join(name)).unwrap(), name.as_bytes());
    }
}

#[test]
fn indistinguishable_old_times_stop_cleanup_without_deleting_anything() {
    let tmp = tempfile::tempdir().unwrap();
    for i in 0..8 {
        write_old(tmp.path(), &format!("f0000{i}"), 7, true);
    }
    let error = auto_backup::prune(tmp.path()).unwrap_err();
    assert_eq!(error.code, "AUTO_BACKUP_ORDER");
    assert_eq!(auto_backup::list(tmp.path()).len(), 8);
}

#[test]
fn new_names_are_restorable_and_time_ordered_even_when_metadata_is_changed() {
    let tmp = tempfile::tempdir().unwrap();
    let older = "物谱自动备份-2026-10-16-131001000000001-ffffff.thingary.age";
    let newer = "物谱自动备份-2026-10-16-131001000000002-000000.thingary";
    for name in [older, newer] {
        assert!(auto_backup::is_auto_backup_name(name));
        assert_eq!(auto_backup::date_of(name), Some("2026-10-16"));
        fs::write(tmp.path().join(name), name).unwrap();
    }
    assert_eq!(auto_backup::list(tmp.path())[0].name, newer);
}

#[test]
fn published_file_is_pinned_even_if_the_clock_moves_back() {
    let tmp = tempfile::tempdir().unwrap();
    let old: Vec<_> = (0..7)
        .map(|i| write_old(tmp.path(), &format!("f0000{i}"), i, true))
        .collect();
    let published = tmp
        .path()
        .join("物谱自动备份-2026-10-15-131001000000001-000000.thingary.age");
    fs::write(&published, b"new key ciphertext").unwrap();
    auto_backup::prune_after_publish(tmp.path(), &published).unwrap();
    assert_eq!(fs::read(&published).unwrap(), b"new key ciphertext");
    assert!(!tmp.path().join(&old[0]).exists());
    assert_eq!(auto_backup::list(tmp.path()).len(), 7);
}

#[test]
fn a_missing_published_file_cannot_trigger_cleanup() {
    let tmp = tempfile::tempdir().unwrap();
    for day in 1..=9 {
        fs::write(
            tmp.path()
                .join(format!("物谱自动备份-2026-10-{day:02}.thingary")),
            b"old",
        )
        .unwrap();
    }
    let missing = tmp
        .path()
        .join("物谱自动备份-2026-10-16-131001000000001-000000.thingary.age");
    let error = auto_backup::prune_after_publish(tmp.path(), &missing).unwrap_err();
    assert_eq!(error.code, "AUTO_BACKUP_MISSING");
    assert_eq!(auto_backup::list(tmp.path()).len(), 9);
    let foreign = tmp.path().join("other").join(missing.file_name().unwrap());
    assert_eq!(
        auto_backup::prune_after_publish(tmp.path(), &foreign)
            .unwrap_err()
            .code,
        "AUTO_BACKUP_NAME"
    );
}

#[test]
fn rewritten_legacy_metadata_is_not_a_reason_to_guess_at_a_cutoff() {
    let tmp = tempfile::tempdir().unwrap();
    for i in 0..8 {
        let name = write_old(tmp.path(), &format!("f0000{i}"), i, true);
        fs::OpenOptions::new()
            .write(true)
            .open(tmp.path().join(name))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH))
            .unwrap();
    }
    assert_eq!(
        auto_backup::prune(tmp.path()).unwrap_err().code,
        "AUTO_BACKUP_ORDER"
    );
    assert_eq!(auto_backup::list(tmp.path()).len(), 8);
}

#[test]
fn mixed_names_and_formats_share_one_chronology() {
    let tmp = tempfile::tempdir().unwrap();
    let legacy = "物谱自动备份-2026-10-16.thingary";
    fs::write(tmp.path().join(legacy), b"old date-only").unwrap();
    write_old(tmp.path(), "ffffff", 1, true);
    let mut latest = String::new();
    for nano in 1..=7 {
        latest = format!(
            "物谱自动备份-2026-10-16-131002{nano:09}-000000.thingary{}",
            if nano % 2 == 0 { ".age" } else { "" }
        );
        let path = tmp.path().join(&latest);
        fs::write(&path, latest.as_bytes()).unwrap();
        // A cloud copy may rewrite filesystem time; new immutable names win.
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH))
            .unwrap();
    }
    assert_eq!(auto_backup::list(tmp.path())[0].name, latest);
    auto_backup::prune_after_publish(tmp.path(), &tmp.path().join(&latest)).unwrap();
    assert_eq!(auto_backup::list(tmp.path()).len(), 7);
    assert!(!tmp.path().join(legacy).exists());
    assert!(!tmp
        .path()
        .join("物谱自动备份-2026-10-16-1310-ffffff.thingary.age")
        .exists());
}

#[test]
fn extra_copy_preserves_legacy_time_and_the_same_retention_order() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("source");
    let extra = tmp.path().join("extra");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&extra).unwrap();
    let mut names = Vec::new();
    for i in 0..8 {
        let suffix = if i == 7 {
            "000000".to_owned()
        } else {
            format!("f0000{i}")
        };
        let name = write_old(&source, &suffix, i, i % 2 == 0);
        auto_backup::copy_extra(&source.join(&name), &extra, || true).unwrap();
        assert_eq!(
            fs::metadata(source.join(&name))
                .unwrap()
                .modified()
                .unwrap(),
            fs::metadata(extra.join(&name)).unwrap().modified().unwrap()
        );
        names.push(name);
    }
    assert_eq!(auto_backup::list(&extra)[0].name, names[7]);
    assert!(!extra.join(&names[0]).exists());
    for name in &names[1..] {
        assert_eq!(fs::read(extra.join(name)).unwrap(), name.as_bytes());
    }
    assert_eq!(auto_backup::list(&extra).len(), 7);
    assert_eq!(
        auto_backup::list(&source).len(),
        8,
        "copy does not prune the source"
    );
}

#[test]
fn generated_name_time_is_strictly_increasing_without_using_the_random_suffix() {
    let names: Vec<_> = (0..100)
        .map(|_| auto_backup::unique_name("2026-10-16", true))
        .collect();
    for name in &names {
        assert!(auto_backup::is_auto_backup_name(name));
    }
    let core = |s: &String| s.strip_prefix("物谱自动备份-").unwrap()[..26].to_owned();
    assert!(names.windows(2).all(|pair| core(&pair[0]) < core(&pair[1])));
    for bad in [
        "物谱自动备份-2026-10-16-13100100000000-000000.thingary.age",
        "物谱自动备份-2026-10-16-131001000000001-FFFFFF.thingary.age",
        "物谱自动备份-2026-10-16-131001000000001-000000.thingary.partial",
    ] {
        assert!(!auto_backup::is_auto_backup_name(bad));
    }
}

#[test]
fn uncertain_retention_is_reported_as_failed_and_pending_work_is_kept() {
    use thingary_lib::{backup_security::FirstBackup, domain::Save, worker::Worker};
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    worker.switch_demo(false).unwrap();
    worker
        .call(|s| {
            s.save(
                &Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构验收相机".into(),
                    price_cents: None,
                    purchase_date: None,
                },
                &Local::now().format("%Y-%m-%d").to_string(),
            )
            .map(|_| ())
        })
        .unwrap();
    let dir = auto_backup::backup_dir(&root);
    fs::create_dir_all(&dir).unwrap();
    let minute = Local::now().format("%Y-%m-%d-%H%M").to_string();
    for i in 0..7 {
        let file = dir.join(format!("物谱自动备份-{minute}-f0000{i}.thingary.age"));
        fs::write(&file, b"fictional older ciphertext placeholder").unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(file)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH))
            .unwrap();
    }
    let setup = worker.backup_security_begin_setup().unwrap();
    worker
        .backup_security_confirm_setup(setup.session_id, setup.recovery_key)
        .unwrap();
    let status = worker.backup_security_status().unwrap();
    assert!(matches!(
        status.first_backup,
        Some(FirstBackup::Failed { .. })
    ));
    assert!(auto_backup::marker_path(&root).exists());
    assert!(auto_backup::Settings::load(&root).last_error.is_some());
    assert!(auto_backup::Settings::load(&root).last_success_at.is_none());
    assert_eq!(
        auto_backup::list(&dir).len(),
        8,
        "the published file and all seven old files survive"
    );
}
