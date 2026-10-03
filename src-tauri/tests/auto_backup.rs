use std::{path::Path, time::Duration};
use thingary_lib::{
    auto_backup,
    domain::{Error, Save},
    storage::Store,
    worker::{Policy, TickOutcome, Worker},
};

fn policy(today: &str, idle: Duration, backoff: Duration) -> Policy {
    Policy {
        idle,
        backoff,
        today: today.into(),
    }
}
fn immediate(today: &str) -> Policy {
    policy(today, Duration::from_secs(0), Duration::from_secs(0))
}
fn save_real_asset(worker: &Worker, name: &str) {
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
                    price_cents: Some("100000".into()),
                    purchase_date: None,
                },
                "2026-09-29",
            )
            .map(|_| ())
        })
        .unwrap();
}
fn dated_name(date: &str) -> String {
    format!("物谱自动备份-{date}.thingary")
}

#[test]
fn real_writes_mark_the_sample_never_does() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    assert!(worker.demo_status().unwrap().active);
    // Editing fictional records must not schedule a real backup.
    worker
        .call(|s| {
            let record = s.first_asset()?.expect("sample has records");
            s.save(
                &Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: s.generation(),
                    asset_id: Some(record.id),
                    expected_revision: Some(record.revision),
                    name: "编辑后的虚构样例".into(),
                    price_cents: record.price_cents,
                    purchase_date: record.purchase_date,
                },
                "2026-09-29",
            )
            .map(|_| ())
        })
        .unwrap();
    assert!(!auto_backup::marker_path(&root).exists());
    // In sample mode the timer still backs up real changes when marked.
    save_real_asset(&worker, "虚构相机");
    assert!(auto_backup::marker_path(&root).exists());
    worker.switch_demo(true).unwrap();
    assert_eq!(
        worker.auto_backup_tick(&immediate("2026-09-29")).unwrap(),
        TickOutcome::BackedUp(auto_backup::backup_dir(&root).join(dated_name("2026-09-29")))
    );
}

#[test]
fn tick_waits_for_idle_then_publishes_and_clears_the_marker() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    let marker = auto_backup::marker_path(&root);
    assert!(marker.exists());
    assert_eq!(
        worker
            .auto_backup_tick(&policy(
                "2026-09-29",
                Duration::from_secs(600),
                Duration::from_secs(0)
            ))
            .unwrap(),
        TickOutcome::NotIdle
    );
    assert!(marker.exists());
    let published = auto_backup::backup_dir(&root).join(dated_name("2026-09-29"));
    assert_eq!(
        worker.auto_backup_tick(&immediate("2026-09-29")).unwrap(),
        TickOutcome::BackedUp(published.clone())
    );
    assert!(published.is_file());
    assert!(!marker.exists());
    let settings = auto_backup::Settings::load(&root);
    assert!(settings.enabled);
    assert!(settings.last_success_at.is_some());
    assert!(settings.last_error.is_none());
}

#[test]
fn same_day_runs_replace_the_single_dated_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    worker.auto_backup_tick(&immediate("2026-09-29")).unwrap();
    let dir = auto_backup::backup_dir(&root);
    let first = std::fs::read(dir.join(dated_name("2026-09-29"))).unwrap();
    save_real_asset(&worker, "虚构镜头");
    worker.auto_backup_tick(&immediate("2026-09-29")).unwrap();
    let names: Vec<String> = auto_backup::list(&dir)
        .into_iter()
        .map(|i| i.name)
        .collect();
    assert_eq!(names, vec![dated_name("2026-09-29")]);
    let second = std::fs::read(dir.join(dated_name("2026-09-29"))).unwrap();
    // Stored zips differ whenever the manifest's creation time or the
    // database content changed, so equality proves the rerun never published.
    assert_ne!(first, second);
    // A stale dot-prefixed leftover from a force-quit is cleared on rerun.
    std::fs::write(dir.join(".物谱自动备份-2026-09-29.partial"), b"stale").unwrap();
    save_real_asset(&worker, "虚构三脚架");
    worker.auto_backup_tick(&immediate("2026-09-29")).unwrap();
    assert!(!dir.join(".物谱自动备份-2026-09-29.partial").exists());
}

#[test]
fn a_new_local_day_gets_its_own_archive() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    worker.auto_backup_tick(&immediate("2026-09-29")).unwrap();
    save_real_asset(&worker, "虚构镜头");
    worker.auto_backup_tick(&immediate("2026-09-30")).unwrap();
    let names: Vec<String> = auto_backup::list(&auto_backup::backup_dir(&root))
        .into_iter()
        .map(|i| i.date)
        .collect();
    assert_eq!(names, vec!["2026-09-30", "2026-09-29"]);
}

#[test]
fn an_empty_personal_library_clears_the_marker_and_writes_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    // A marker left by an earlier session over records that are gone now.
    std::fs::write(auto_backup::marker_path(&root), b"1").unwrap();
    assert_eq!(
        worker.auto_backup_tick(&immediate("2026-09-29")).unwrap(),
        TickOutcome::EmptyLibrary
    );
    assert!(!auto_backup::marker_path(&root).exists());
    assert!(!auto_backup::backup_dir(&root).exists());
}

#[test]
fn a_marker_from_a_force_quit_is_made_up_after_restart() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    {
        let worker = Worker::start(root.clone()).unwrap();
        save_real_asset(&worker, "虚构相机");
        assert!(auto_backup::marker_path(&root).exists());
    }
    let restarted = (0..100)
        .find_map(|_| match Worker::start(root.clone()) {
            Ok(worker) => Some(worker),
            Err(error) if error.code == "LOCKED" => {
                std::thread::sleep(Duration::from_millis(20));
                None
            }
            Err(error) => panic!("unexpected restart failure: {error}"),
        })
        .expect("old worker released library lock");
    // No change was observed this session, so the leftover marker is idle.
    assert_eq!(
        restarted
            .auto_backup_tick(&immediate("2026-09-29"))
            .unwrap(),
        TickOutcome::BackedUp(auto_backup::backup_dir(&root).join(dated_name("2026-09-29")))
    );
    assert!(!auto_backup::marker_path(&root).exists());
}

#[test]
fn an_existing_library_without_any_auto_backup_gets_one_without_a_change() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    {
        let worker = Worker::start(root.clone()).unwrap();
        save_real_asset(&worker, "虚构相机");
    }
    // Simulate an upgrade from a version without automatic backup.
    std::fs::remove_file(auto_backup::marker_path(&root)).unwrap();
    let upgraded = (0..100)
        .find_map(|_| match Worker::start(root.clone()) {
            Ok(worker) => Some(worker),
            Err(error) if error.code == "LOCKED" => {
                std::thread::sleep(Duration::from_millis(20));
                None
            }
            Err(error) => panic!("unexpected restart failure: {error}"),
        })
        .expect("old worker released library lock");
    assert_eq!(
        upgraded.auto_backup_tick(&immediate("2026-09-29")).unwrap(),
        TickOutcome::BackedUp(auto_backup::backup_dir(&root).join(dated_name("2026-09-29")))
    );
    // Once one exists, nothing more happens until a real change.
    assert_eq!(
        upgraded.auto_backup_tick(&immediate("2026-09-30")).unwrap(),
        TickOutcome::NoMarker
    );
    assert_eq!(auto_backup::list(&auto_backup::backup_dir(&root)).len(), 1);
    // An empty library with no archives still writes nothing.
    let empty_root = tmp.path().join("empty");
    let empty = Worker::start(empty_root.clone()).unwrap();
    assert_eq!(
        empty.auto_backup_tick(&immediate("2026-09-29")).unwrap(),
        TickOutcome::NoMarker
    );
    assert!(!auto_backup::backup_dir(&empty_root).exists());
}

#[test]
fn prune_keeps_seven_named_archives_and_nothing_else() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("auto-backups");
    std::fs::create_dir_all(&dir).unwrap();
    for day in 1..=9 {
        std::fs::write(
            dir.join(dated_name(&format!("2026-09-{day:02}"))),
            [day as u8],
        )
        .unwrap();
    }
    std::fs::write(dir.join("物谱备份-2026-09-01.thingary"), b"manual").unwrap();
    std::fs::write(dir.join("重要资料.txt"), b"mine").unwrap();
    std::fs::write(dir.join(".物谱自动备份-2026-09-09.partial"), b"tmp").unwrap();
    auto_backup::prune(&dir).unwrap();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort_unstable();
    assert_eq!(
        names,
        vec![
            ".物谱自动备份-2026-09-09.partial".to_string(),
            "物谱备份-2026-09-01.thingary".to_string(),
            dated_name("2026-09-03"),
            dated_name("2026-09-04"),
            dated_name("2026-09-05"),
            dated_name("2026-09-06"),
            dated_name("2026-09-07"),
            dated_name("2026-09-08"),
            dated_name("2026-09-09"),
            "重要资料.txt".to_string(),
        ]
    );
    let items = auto_backup::list(&dir);
    assert_eq!(items.len(), 7);
    assert_eq!(items[0].date, "2026-09-09");
    assert_eq!(items[0].size, 1);
}

#[test]
fn resolve_rejects_anything_that_is_not_one_dated_name() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    for bad in [
        "../物谱自动备份-2026-09-29.thingary",
        "sub/物谱自动备份-2026-09-29.thingary",
        "物谱自动备份-2026-09-29.zip",
        "物谱备份-2026-09-29.thingary",
        "物谱自动备份-2026-9-29.thingary",
        ".",
        "..",
        "",
    ] {
        assert!(auto_backup::resolve(&root, bad).is_err(), "{bad}");
    }
    let good = dated_name("2026-09-29");
    assert_eq!(
        auto_backup::resolve(&root, &good).unwrap(),
        auto_backup::backup_dir(&root).join(good)
    );
}

#[test]
fn copy_extra_errors_on_a_missing_target_and_keeps_the_source() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join(dated_name("2026-09-29"));
    std::fs::write(&source, b"archive").unwrap();
    let vanished = tmp.path().join("unmounted-disk/thingary");
    let missing = auto_backup::copy_extra(&source, &vanished).unwrap_err();
    assert!(missing.message.contains("找不到额外备份位置"));
    assert!(!vanished.exists());
    assert!(source.is_file());
    // The copy keeps the archive's owner-only permissions.
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
    // A healthy location receives the copy and prunes to its own seven.
    let extra = tmp.path().join("extra");
    std::fs::create_dir_all(&extra).unwrap();
    for day in 1..=8 {
        std::fs::write(extra.join(dated_name(&format!("2026-09-{day:02}"))), [0]).unwrap();
    }
    auto_backup::copy_extra(&source, &extra).unwrap();
    assert_eq!(
        std::fs::read(extra.join(dated_name("2026-09-29"))).unwrap(),
        b"archive"
    );
    let mode = std::fs::metadata(extra.join(dated_name("2026-09-29")))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    assert_eq!(auto_backup::list(&extra).len(), 7);
}

#[test]
fn damaged_or_missing_settings_read_as_enabled() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    assert!(auto_backup::Settings::load(&root).enabled);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(auto_backup::settings_path(&root), b"{ not json").unwrap();
    assert!(auto_backup::Settings::load(&root).enabled);
    // Saved state survives a round trip.
    let settings = auto_backup::Settings {
        enabled: false,
        extra_dir: Some("/Volumes/Fiction/thingary".into()),
        last_success_at: Some("2026-09-29T10:00:00+08:00".into()),
        last_error: Some(auto_backup::Failure {
            at: "2026-09-29T11:00:00+08:00".into(),
            message: "模拟失败".into(),
        }),
        extra_last_at: None,
        extra_last_error: None,
    };
    settings.save(&root).unwrap();
    assert!(!auto_backup::Settings::load(&root).enabled);
    assert_eq!(
        auto_backup::Settings::load(&root).extra_dir.as_deref(),
        Some("/Volumes/Fiction/thingary")
    );
    // A disabled switch stops the tick before anything else.
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    assert!(auto_backup::marker_path(&root).exists());
    assert_eq!(
        worker.auto_backup_tick(&immediate("2026-09-29")).unwrap(),
        TickOutcome::Disabled
    );
    assert!(!auto_backup::backup_dir(&root).exists());
}

#[cfg(feature = "fault-injection")]
#[test]
fn a_failed_run_keeps_the_old_archive_the_marker_and_records_the_error() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    worker.auto_backup_tick(&immediate("2026-09-29")).unwrap();
    let dir = auto_backup::backup_dir(&root);
    let old = std::fs::read(dir.join(dated_name("2026-09-29"))).unwrap();
    worker
        .call(|s| {
            s.set_hook(|point| {
                if point == "backup.before_publish" {
                    Err(Error::new("INJECTED", "模拟备份失败"))
                } else {
                    Ok(())
                }
            });
            Ok(())
        })
        .unwrap();
    save_real_asset(&worker, "虚构镜头");
    assert!(worker
        .auto_backup_tick(&policy(
            "2026-09-29",
            Duration::from_secs(0),
            Duration::from_secs(1800)
        ))
        .is_err());
    // The dated archive is the untouched previous one; no temporaries remain.
    assert_eq!(
        std::fs::read(dir.join(dated_name("2026-09-29"))).unwrap(),
        old
    );
    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(leftovers, vec![dated_name("2026-09-29")]);
    // The marker survives so the run is retried, and the failure is recorded.
    assert!(auto_backup::marker_path(&root).exists());
    let settings = auto_backup::Settings::load(&root);
    let failure = settings.last_error.expect("failure recorded");
    assert!(!failure.at.is_empty());
    assert!(failure.message.contains("模拟备份失败"));
}

#[cfg(feature = "fault-injection")]
#[test]
fn backoff_skips_until_it_expires_or_a_new_change_arrives() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    worker
        .call(|s| {
            s.set_hook(|point| {
                if point == "backup.before_publish" {
                    Err(Error::new("INJECTED", "模拟备份失败"))
                } else {
                    Ok(())
                }
            });
            Ok(())
        })
        .unwrap();
    let backoff = policy(
        "2026-09-29",
        Duration::from_secs(0),
        Duration::from_secs(1800),
    );
    assert!(worker.auto_backup_tick(&backoff).is_err());
    // The hook is repaired, but the failure is still within its backoff.
    worker
        .call(|s| {
            s.set_hook(|_| Ok(()));
            Ok(())
        })
        .unwrap();
    assert_eq!(
        worker.auto_backup_tick(&backoff).unwrap(),
        TickOutcome::Backoff
    );
    // A new change overrides the backoff and retries at once.
    save_real_asset(&worker, "虚构镜头");
    assert!(matches!(
        worker.auto_backup_tick(&backoff).unwrap(),
        TickOutcome::BackedUp(_)
    ));
    assert!(auto_backup::backup_dir(&root)
        .join(dated_name("2026-09-29"))
        .is_file());
}

#[test]
fn published_archives_are_complete_backups_of_the_real_library() {
    // The automatic archive is exactly a manual one: inspectable by the
    // existing checker, restorable by the existing path.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    save_real_asset(&worker, "虚构相机");
    worker.auto_backup_tick(&immediate("2026-09-29")).unwrap();
    let archive = auto_backup::backup_dir(&root).join(dated_name("2026-09-29"));
    let summary = worker
        .call_personal(move |s| s.inspect_backup(&archive))
        .unwrap();
    assert_eq!(summary.assets, 1);
    assert_eq!(summary.schema, thingary_lib::storage::SCHEMA_VERSION as u32);
}

#[test]
fn run_uses_the_existing_backup_protocol_without_touching_final_on_error() {
    // Direct function-level check with a plain store, no worker involved.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let mut store = Store::open(&root).unwrap();
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
            "2026-09-29",
        )
        .unwrap();
    let dir = tmp.path().join("auto-backups");
    let published = auto_backup::run(&store, &dir, "2026-09-29").unwrap();
    assert_eq!(published, dir.join(dated_name("2026-09-29")));
    assert!(published.is_file());
    let before = std::fs::read(&published).unwrap();
    // A second run of the same day replaces the file with fresh content.
    store
        .save(
            &Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: store.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构镜头".into(),
                price_cents: None,
                purchase_date: None,
            },
            "2026-09-29",
        )
        .unwrap();
    auto_backup::run(&store, &dir, "2026-09-29").unwrap();
    assert_ne!(std::fs::read(&published).unwrap(), before);
    assert_eq!(
        Path::new(&published).file_name().unwrap().to_str().unwrap(),
        dated_name("2026-09-29")
    );
}
