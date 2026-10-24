//! Sync against a REAL WebDAV server instead of the in-process fake.
//!
//! These tests are `#[ignore]`d: they need an external server and are meant for manual
//! integration checks (the maintainer runs `wsgidav`, Nextcloud, 坚果云 …).
//!
//!   THINGARY_REAL_WEBDAV_URL=http://127.0.0.1:8765 \
//!     cargo test --features fault-injection --test sync_real_webdav -- --ignored --nocapture
//!
//! Optional: THINGARY_REAL_WEBDAV_USER / _PASSWORD (default anonymous-style fictional values).
//! `android_push_pulls_on_desktop` additionally needs THINGARY_REAL_WEBDAV_BASE_PATH and
//! THINGARY_REAL_WEBDAV_PASSPHRASE: it pulls what another device (the Android emulator) pushed.
use std::{
    collections::BTreeMap,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::Duration,
};
use thingary_lib::{
    domain::Save,
    files::Attach,
    sync::{
        commands::{finalize_pending_pull, pull_inspect, push, reconcile, status, SyncRuntime},
        engine::sha256_hex,
        fingerprint::{fingerprint, Fingerprint},
        state::{ConfigStore, SyncConfig},
    },
    worker::Worker,
};

const TODAY: &str = "2026-10-25";
const PASSPHRASE: &str = "联调-虚构-口令";

fn server_url() -> String {
    std::env::var("THINGARY_REAL_WEBDAV_URL")
        .expect("set THINGARY_REAL_WEBDAV_URL to a real WebDAV server, e.g. http://127.0.0.1:8765")
}

fn config(device_name: &str, base_path: &str) -> SyncConfig {
    SyncConfig {
        enabled: true,
        base_url: server_url(),
        username: std::env::var("THINGARY_REAL_WEBDAV_USER").unwrap_or_else(|_| "虚构账户".into()),
        password: std::env::var("THINGARY_REAL_WEBDAV_PASSWORD")
            .unwrap_or_else(|_| "虚构-应用密码".into()),
        base_path: base_path.into(),
        device_name: device_name.into(),
        ..SyncConfig::default()
    }
}

struct Device {
    _temp: tempfile::TempDir,
    root: PathBuf,
    worker: Worker,
    runtime: Arc<SyncRuntime>,
}

impl Device {
    fn new(config: SyncConfig, passphrase: &str) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let config_root = temp.path().join("config");
        ConfigStore::new(config_root.clone()).save(&config).unwrap();
        let worker = Worker::start(root.clone()).unwrap();
        worker.switch_demo(false).unwrap();
        let runtime = Arc::new(SyncRuntime::new(config_root, temp.path().join("staging")).unwrap());
        runtime.unlock(passphrase).unwrap();
        Self {
            _temp: temp,
            root,
            worker,
            runtime,
        }
    }

    fn fingerprint(&self) -> Fingerprint {
        self.worker
            .call_personal(|store| fingerprint(store))
            .unwrap()
    }

    fn pull_and_restore(&self) {
        let inspection = pull_inspect(&self.worker, &self.runtime, false).unwrap();
        self.worker
            .backup_session_restore(inspection.token)
            .unwrap();
        finalize_pending_pull(&self.worker, &self.runtime).unwrap();
    }
}

fn seed_library(worker: &Worker, name: &str) -> String {
    let name = name.to_owned();
    worker
        .call_personal(move |store| {
            let asset = store.save(
                &Save {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name,
                    price_cents: Some("129900".into()),
                    purchase_date: Some(TODAY.into()),
                },
                TODAY,
            )?;
            let mut png = Cursor::new(Vec::new());
            image::RgbImage::new(8, 8)
                .write_to(&mut png, image::ImageFormat::Png)
                .unwrap();
            store.attach(
                &Attach {
                    request_id: uuid::Uuid::new_v4().to_string(),
                    generation: store.generation(),
                    asset_id: asset.id.clone(),
                    expected_revision: asset.revision,
                },
                png.get_ref(),
            )?;
            Ok(asset.id)
        })
        .unwrap()
}

fn rename_asset(worker: &Worker, id: &str, name: &str) {
    let (id, name) = (id.to_owned(), name.to_owned());
    worker
        .call_personal(move |store| {
            let record = store.asset(&id)?.expect("fictional asset exists");
            store
                .save(
                    &Save {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        generation: store.generation(),
                        asset_id: Some(record.id),
                        expected_revision: Some(record.revision),
                        name,
                        price_cents: record.price_cents,
                        purchase_date: record.purchase_date,
                    },
                    TODAY,
                )
                .map(|_| ())
        })
        .unwrap()
}

fn managed_hashes(root: &Path) -> BTreeMap<String, String> {
    let active: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("active.json")).unwrap()).unwrap();
    let dataset = active["id"].as_str().expect("active dataset");
    let mut hashes = BTreeMap::new();
    if let Ok(entries) = fs::read_dir(root.join("datasets").join(dataset).join("files")) {
        for entry in entries.flatten() {
            if entry.file_type().unwrap().is_file() {
                hashes.insert(
                    entry.file_name().to_string_lossy().into_owned(),
                    sha256_hex(&fs::read(entry.path()).unwrap()),
                );
            }
        }
    }
    hashes
}

/// Snapshot names carry a one-second timestamp: two pushes in the same second would collide.
fn next_second() {
    thread::sleep(Duration::from_millis(1100));
}

#[test]
#[ignore = "needs THINGARY_REAL_WEBDAV_URL"]
fn two_desktop_devices_round_trip_on_a_real_server() {
    // A fresh remote folder per run keeps repeated runs independent.
    let base = format!("it-{}", uuid::Uuid::new_v4());
    let a = Device::new(config("虚构设备甲", &base), PASSPHRASE);
    let b = Device::new(config("虚构设备乙", &base), PASSPHRASE);

    // 1. first push, empty device pulls: identical content and managed files.
    let asset = seed_library(&a.worker, "虚构相机");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "remote_ahead");
    b.pull_and_restore();
    assert_eq!(a.fingerprint(), b.fingerprint());
    assert_eq!(managed_hashes(&a.root), managed_hashes(&b.root));
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "up_to_date");

    // 2. a normal change travels both ways with an increasing version (If-Match accepted).
    next_second();
    rename_asset(&a.worker, &asset, "甲改写");
    assert_eq!(status(&a.worker, &a.runtime).unwrap().state, "local_ahead");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 2);
    b.pull_and_restore();
    assert_eq!(a.fingerprint(), b.fingerprint());

    // 3. both change after the last common point: nothing is merged, the user must choose.
    next_second();
    rename_asset(&a.worker, &asset, "甲再改");
    rename_asset(&b.worker, &asset, "乙改写");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 3);
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "conflict");

    // 4. a read-only reconcile with nothing pending changes nothing.
    assert_eq!(reconcile(&b.runtime).unwrap().outcome, "nothing_pending");

    // 5. wrong passphrase on a third device never touches local data.
    let c = Device::new(config("虚构设备丙", &base), "错误-虚构-口令");
    let before = c.fingerprint();
    assert!(pull_inspect(&c.worker, &c.runtime, false).is_err());
    assert_eq!(c.fingerprint(), before);
}

#[test]
#[ignore = "needs THINGARY_REAL_WEBDAV_URL, THINGARY_REAL_WEBDAV_BASE_PATH, THINGARY_REAL_WEBDAV_PASSPHRASE"]
fn android_push_pulls_on_desktop() {
    let base = std::env::var("THINGARY_REAL_WEBDAV_BASE_PATH")
        .expect("base path used by the Android device");
    let passphrase = std::env::var("THINGARY_REAL_WEBDAV_PASSPHRASE")
        .expect("passphrase used by the Android device");
    let desktop = Device::new(config("虚构桌面", &base), &passphrase);

    let state = status(&desktop.worker, &desktop.runtime).unwrap();
    println!(
        "desktop sees: state={} remote={:?}",
        state.state,
        state
            .remote
            .as_ref()
            .map(|r| (r.version, r.device_name.clone(), r.schema_version))
    );
    assert_eq!(
        state.state, "remote_ahead",
        "the Android push must be visible and newer"
    );

    desktop.pull_and_restore();
    let restored = desktop.fingerprint();
    println!("restored tables: {:?}", restored.table_counts);
    assert!(
        !restored.empty,
        "the restored library must contain the Android data"
    );
    assert_eq!(
        status(&desktop.worker, &desktop.runtime).unwrap().state,
        "up_to_date"
    );
}

#[test]
#[ignore = "needs THINGARY_REAL_WEBDAV_URL, THINGARY_REAL_WEBDAV_BASE_PATH, THINGARY_REAL_WEBDAV_PASSPHRASE"]
fn desktop_pushes_a_new_version_for_android_to_pull() {
    let base = std::env::var("THINGARY_REAL_WEBDAV_BASE_PATH")
        .expect("base path used by the Android device");
    let passphrase = std::env::var("THINGARY_REAL_WEBDAV_PASSPHRASE")
        .expect("passphrase used by the Android device");
    let desktop = Device::new(config("虚构桌面", &base), &passphrase);
    desktop.pull_and_restore();
    next_second();
    seed_library(&desktop.worker, "桌面新增的虚构物品");
    let pushed = push(&desktop.worker, &desktop.runtime, false).unwrap();
    println!("desktop pushed version {}", pushed.version);
    assert!(pushed.version >= 2);
}
