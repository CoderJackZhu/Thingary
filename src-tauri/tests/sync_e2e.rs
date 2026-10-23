//! End-to-end sync coverage at the command layer: two fictional devices talk to
//! an in-process fake WebDAV server through the real status/push/pull/resolve
//! functions. All libraries are temporary and all content is made up.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::{Cursor, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use thingary_lib::{
    domain::Save,
    files::Attach,
    storage::SCHEMA_VERSION,
    sync::{
        commands::{finalize_pending_pull, pull_inspect, push, reconcile, status, SyncRuntime},
        engine::sha256_hex,
        fingerprint::{fingerprint, Fingerprint},
        manifest::Manifest,
        state::{ConfigStore, SyncConfig},
    },
    worker::Worker,
};

const TODAY: &str = "2026-10-23";
const PASSPHRASE: &str = "正确-虚构-同步口令";
const PASSWORD: &str = "虚构-应用密码";

#[derive(Default)]
struct DavState {
    collections: BTreeSet<String>,
    files: HashMap<String, (Vec<u8>, String)>,
    sequence: u64,
    manifest_puts: usize,
    writes: usize,
}

struct DavControl {
    connections: AtomicUsize,
    offline: AtomicBool,
    drop_after_manifest_put: AtomicBool,
    drop_before_manifest_put: AtomicBool,
}

struct FakeDav {
    base_url: String,
    state: Arc<Mutex<DavState>>,
    control: Arc<DavControl>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl FakeDav {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(DavState::default()));
        let control = Arc::new(DavControl {
            connections: AtomicUsize::new(0),
            offline: AtomicBool::new(false),
            drop_after_manifest_put: AtomicBool::new(false),
            drop_before_manifest_put: AtomicBool::new(false),
        });
        let server_state = Arc::clone(&state);
        let server_control = Arc::clone(&control);
        let stop = Arc::new(AtomicBool::new(false));
        let server_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            while !server_stop.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        server_control.connections.fetch_add(1, Ordering::SeqCst);
                        handle(stream, &server_state, &server_control);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            base_url: format!("http://{address}"),
            state,
            control,
            stop,
            thread: Some(handle),
        }
    }

    fn set_offline(&self, offline: bool) {
        self.control.offline.store(offline, Ordering::SeqCst);
    }

    fn drop_after_manifest_put(&self) {
        self.control
            .drop_after_manifest_put
            .store(true, Ordering::SeqCst);
    }

    fn allow_manifest_puts(&self) {
        self.control
            .drop_before_manifest_put
            .store(false, Ordering::SeqCst);
        self.control
            .drop_after_manifest_put
            .store(false, Ordering::SeqCst);
    }

    fn drop_before_manifest_put(&self) {
        self.control
            .drop_before_manifest_put
            .store(true, Ordering::SeqCst);
    }

    fn connections(&self) -> usize {
        self.control.connections.load(Ordering::SeqCst)
    }

    fn writes(&self) -> usize {
        self.state.lock().unwrap().writes
    }

    fn manifest_puts(&self) -> usize {
        self.state.lock().unwrap().manifest_puts
    }

    fn file_names(&self) -> Vec<String> {
        let mut names = self
            .state
            .lock()
            .unwrap()
            .files
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    fn snapshot_names(&self) -> Vec<String> {
        let state = self.state.lock().unwrap();
        let mut names = state
            .files
            .keys()
            .filter(|path| path.contains("/snapshots/"))
            .filter_map(|path| path.rsplit('/').next())
            .filter(|name| name.ends_with(".thingary.age"))
            .map(str::to_string)
            .collect::<Vec<_>>();
        names.sort();
        names.dedup();
        names
    }

    fn manifest(&self) -> Option<Manifest> {
        let state = self.state.lock().unwrap();
        let path = state
            .files
            .keys()
            .find(|path| path.ends_with("/manifest.json"))?;
        Manifest::parse(&state.files[path].0).ok()
    }

    fn replace_manifest(&self, manifest: &Manifest) {
        let mut state = self.state.lock().unwrap();
        let path = state
            .files
            .keys()
            .find(|path| path.ends_with("/manifest.json"))
            .cloned()
            .expect("remote manifest exists");
        state.sequence += 1;
        let etag = format!("\"{}\"", state.sequence);
        state
            .files
            .insert(path, (manifest.to_json().unwrap(), etag));
    }
}

impl Drop for FakeDav {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.base_url.trim_start_matches("http://"));
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn handle(mut stream: TcpStream, state: &Arc<Mutex<DavState>>, control: &DavControl) {
    if control.offline.load(Ordering::SeqCst) {
        return;
    }
    stream.set_nonblocking(false).unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut buffer).unwrap_or(0);
        if read == 0 {
            return;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let head = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
    let mut lines = head.lines();
    let request = lines.next().unwrap();
    let mut request = request.split_whitespace();
    let method = request.next().unwrap().to_string();
    let path = request.next().unwrap().to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    while bytes.len() < header_end + content_length {
        let read = stream.read(&mut buffer).unwrap_or(0);
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    let body = bytes[header_end..header_end + content_length].to_vec();
    let mut state = state.lock().unwrap();
    match method.as_str() {
        "MKCOL" => {
            state.collections.insert(path);
            state.writes += 1;
            respond(&mut stream, 201, &[], &[]);
        }
        "PUT" => {
            if let Some(expected) = headers.get("if-match") {
                if state.files.get(&path).map(|(_, etag)| etag) != Some(expected) {
                    respond(&mut stream, 412, &[], &[]);
                    return;
                }
            }
            if headers.get("if-none-match").map(String::as_str) == Some("*")
                && state.files.contains_key(&path)
            {
                respond(&mut stream, 412, &[], &[]);
                return;
            }
            if path.ends_with("/manifest.json")
                && control.drop_before_manifest_put.load(Ordering::SeqCst)
            {
                control.offline.store(true, Ordering::SeqCst);
                drop(state);
                return;
            }
            state.sequence += 1;
            let etag = format!("\"{}\"", state.sequence);
            state.files.insert(path.clone(), (body, etag.clone()));
            state.writes += 1;
            if path.ends_with("/manifest.json") {
                state.manifest_puts += 1;
                if control.drop_after_manifest_put.load(Ordering::SeqCst) {
                    control.offline.store(true, Ordering::SeqCst);
                    drop(state);
                    return;
                }
            }
            respond(&mut stream, 201, &[("ETag", etag.as_str())], &[]);
        }
        "GET" => match state.files.get(&path) {
            Some((body, etag)) => respond(&mut stream, 200, &[("ETag", etag)], body),
            None => respond(&mut stream, 404, &[], &[]),
        },
        "DELETE" => {
            state.files.remove(&path);
            state.writes += 1;
            respond(&mut stream, 204, &[], &[]);
        }
        "PROPFIND" => {
            let depth = headers
                .get("depth")
                .and_then(|value| value.parse::<u8>().ok())
                .unwrap_or(1);
            let mut hrefs = BTreeSet::new();
            let trimmed = path.trim_end_matches('/');
            hrefs.insert(format!("/{trimmed}/"));
            if depth > 0 {
                let prefix = if trimmed.is_empty() {
                    String::new()
                } else {
                    format!("{trimmed}/")
                };
                for key in state.collections.iter().chain(state.files.keys()) {
                    let Some(rest) = key.strip_prefix(&prefix) else {
                        continue;
                    };
                    let Some(first) = rest.split('/').next().filter(|part| !part.is_empty()) else {
                        continue;
                    };
                    hrefs.insert(format!("/{prefix}{first}"));
                }
            }
            let xml = format!(
                "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">{}</d:multistatus>",
                hrefs
                    .iter()
                    .map(|href| format!("<d:response><d:href>{href}</d:href></d:response>"))
                    .collect::<String>()
            );
            respond(
                &mut stream,
                207,
                &[("ETag", "\"collection\"")],
                xml.as_bytes(),
            );
        }
        _ => respond(&mut stream, 405, &[], &[]),
    }
}

fn respond(stream: &mut TcpStream, status: u16, headers: &[(&str, &str)], body: &[u8]) {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        207 => "Multi-Status",
        404 => "Not Found",
        405 => "Method Not Allowed",
        412 => "Precondition Failed",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    write!(stream, "\r\n").unwrap();
    stream.write_all(body).unwrap();
}

fn sync_config(server: &FakeDav, device_name: &str, enabled: bool) -> SyncConfig {
    SyncConfig {
        enabled,
        base_url: server.base_url.clone(),
        username: "虚构账户".into(),
        password: PASSWORD.into(),
        base_path: "dav".into(),
        device_name: device_name.into(),
        ..SyncConfig::default()
    }
}

struct Device {
    _temp: tempfile::TempDir,
    root: PathBuf,
    config_root: PathBuf,
    worker: Worker,
    runtime: Arc<SyncRuntime>,
}

impl Device {
    fn new(config: SyncConfig, passphrase: &str) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let config_root = temp.path().join("config");
        let staging = temp.path().join("staging");
        ConfigStore::new(config_root.clone()).save(&config).unwrap();
        let worker = Worker::start(root.clone()).unwrap();
        worker.switch_demo(false).unwrap();
        let runtime = Arc::new(SyncRuntime::new(config_root.clone(), staging).unwrap());
        runtime.unlock(passphrase).unwrap();
        Self {
            _temp: temp,
            root,
            config_root,
            worker,
            runtime,
        }
    }

    fn fingerprint(&self) -> Fingerprint {
        self.worker
            .call_personal(|store| fingerprint(store))
            .unwrap()
    }

    fn protection_count(&self) -> usize {
        fs::read_dir(self.root.join("protection"))
            .map(|entries| entries.filter_map(|entry| entry.ok()).count())
            .unwrap_or(0)
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
    let id = id.to_owned();
    let name = name.to_owned();
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
    let dataset = active
        .get("id")
        .and_then(|value| value.as_str())
        .expect("active dataset");
    let files = root.join("datasets").join(dataset).join("files");
    let mut hashes = BTreeMap::new();
    if let Ok(entries) = fs::read_dir(files) {
        for entry in entries {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_file() {
                let bytes = fs::read(entry.path()).unwrap();
                hashes.insert(
                    entry.file_name().to_string_lossy().into_owned(),
                    sha256_hex(&bytes),
                );
            }
        }
    }
    hashes
}

fn wait_for_next_snapshot_second() {
    thread::sleep(Duration::from_millis(1100));
}

fn tree_contains(root: &Path, needle: &str) -> bool {
    let needle = needle.as_bytes();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(path);
            } else if kind.is_file() {
                if let Ok(bytes) = fs::read(path) {
                    if bytes.windows(needle.len()).any(|window| window == needle) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[test]
fn empty_device_pulls_pushed_library_and_matches_counts_and_managed_hashes() {
    let server = FakeDav::start();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    let b = Device::new(sync_config(&server, "虚构设备乙", true), PASSPHRASE);

    seed_library(&a.worker, "虚构相机");
    assert!(a.fingerprint().managed_files >= 1);
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);

    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "remote_ahead");
    let inspection = pull_inspect(&b.worker, &b.runtime, false).unwrap();
    assert_eq!(inspection.version, 1);
    assert!(inspection.summary.is_some());

    b.worker.backup_session_restore(inspection.token).unwrap();
    finalize_pending_pull(&b.worker, &b.runtime).unwrap();

    let left = a.fingerprint();
    let right = b.fingerprint();
    assert_eq!(left, right);
    assert!(!right.empty);
    assert_eq!(left.table_counts, right.table_counts);
    assert_eq!(managed_hashes(&a.root), managed_hashes(&b.root));
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "up_to_date");
}

#[test]
fn second_push_bumps_remote_version_and_pulls_cleanly() {
    let server = FakeDav::start();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    let asset = seed_library(&a.worker, "虚构相机");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);

    wait_for_next_snapshot_second();
    rename_asset(&a.worker, &asset, "虚构相机（改名）");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 2);
    assert_eq!(server.manifest().unwrap().version, 2);
    assert_eq!(server.snapshot_names().len(), 2);

    let b = Device::new(sync_config(&server, "虚构设备乙", true), PASSPHRASE);
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "remote_ahead");
    let inspection = pull_inspect(&b.worker, &b.runtime, false).unwrap();
    assert_eq!(inspection.version, 2);
    b.worker.backup_session_restore(inspection.token).unwrap();
    finalize_pending_pull(&b.worker, &b.runtime).unwrap();

    assert_eq!(a.fingerprint(), b.fingerprint());
    assert_eq!(managed_hashes(&a.root), managed_hashes(&b.root));
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "up_to_date");
}

#[test]
fn conflict_blocks_status_writes_and_both_choices_keep_history_and_protection() {
    let server = FakeDav::start();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    let b = Device::new(sync_config(&server, "虚构设备乙", true), PASSPHRASE);
    let asset = seed_library(&a.worker, "虚构相机");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);

    let inspection = pull_inspect(&b.worker, &b.runtime, false).unwrap();
    b.worker.backup_session_restore(inspection.token).unwrap();
    finalize_pending_pull(&b.worker, &b.runtime).unwrap();
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "up_to_date");

    wait_for_next_snapshot_second();
    rename_asset(&a.worker, &asset, "甲改写");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 2);
    rename_asset(&b.worker, &asset, "乙改写");

    let before_writes = server.writes();
    let before_files = server.file_names();
    let before_manifest = server.manifest().unwrap();
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "conflict");
    assert_eq!(server.writes(), before_writes);
    assert_eq!(server.file_names(), before_files);
    assert_eq!(server.manifest().unwrap(), before_manifest);

    let snapshots_before = server.snapshot_names();
    let kept = push(&b.worker, &b.runtime, true).unwrap();
    assert_eq!(kept.version, 3);
    let snapshots_after = server.snapshot_names();
    assert!(snapshots_before
        .iter()
        .all(|name| snapshots_after.contains(name)));
    assert!(snapshots_after.len() > snapshots_before.len());
    assert_eq!(server.manifest().unwrap().version, 3);
    assert_eq!(server.manifest().unwrap().device_name, "虚构设备乙");

    rename_asset(&a.worker, &asset, "甲再次改写");
    assert_eq!(status(&a.worker, &a.runtime).unwrap().state, "conflict");
    let protection_before = a.protection_count();
    let adopted = pull_inspect(&a.worker, &a.runtime, true).unwrap();
    assert_eq!(adopted.version, 3);
    a.worker.backup_session_restore(adopted.token).unwrap();
    finalize_pending_pull(&a.worker, &a.runtime).unwrap();

    assert_eq!(a.protection_count(), protection_before + 1);
    assert_eq!(a.fingerprint(), b.fingerprint());
    assert_eq!(managed_hashes(&a.root), managed_hashes(&b.root));
}

#[test]
fn wrong_passphrase_pull_errors_and_leaves_local_data_unchanged() {
    let server = FakeDav::start();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    let b = Device::new(sync_config(&server, "虚构设备乙", true), PASSPHRASE);
    let asset = seed_library(&a.worker, "虚构相机");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);

    let inspection = pull_inspect(&b.worker, &b.runtime, false).unwrap();
    b.worker.backup_session_restore(inspection.token).unwrap();
    finalize_pending_pull(&b.worker, &b.runtime).unwrap();

    wait_for_next_snapshot_second();
    rename_asset(&a.worker, &asset, "甲的新版本");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 2);
    assert_eq!(status(&b.worker, &b.runtime).unwrap().state, "remote_ahead");

    let before = b.fingerprint();
    let before_files = managed_hashes(&b.root);
    b.runtime.unlock("错误-虚构-口令").unwrap();
    let error = pull_inspect(&b.worker, &b.runtime, false).unwrap_err();
    assert_eq!(error.code, "SYNC_PASSPHRASE");
    assert_eq!(b.fingerprint(), before);
    assert_eq!(managed_hashes(&b.root), before_files);
}

#[test]
fn newer_remote_schema_blocks_pull_and_push() {
    let server = FakeDav::start();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    seed_library(&a.worker, "虚构相机");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);

    let mut manifest = server.manifest().unwrap();
    manifest.schema_version = SCHEMA_VERSION as u32 + 1;
    server.replace_manifest(&manifest);

    let b = Device::new(sync_config(&server, "虚构设备乙", true), PASSPHRASE);
    let pull_error = pull_inspect(&b.worker, &b.runtime, true).unwrap_err();
    assert_eq!(pull_error.code, "SYNC_SCHEMA_NEWER");
    let push_error = push(&b.worker, &b.runtime, false).unwrap_err();
    assert_eq!(push_error.code, "SYNC_SCHEMA_NEWER");
    assert!(b.fingerprint().empty);
}

#[test]
fn dropped_manifest_response_reconciles_without_a_second_manifest_write() {
    let server = FakeDav::start();
    server.drop_after_manifest_put();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    seed_library(&a.worker, "虚构相机");

    assert!(push(&a.worker, &a.runtime, false).is_err());
    assert_eq!(server.manifest().unwrap().version, 1);
    assert_eq!(server.manifest_puts(), 1);
    assert_eq!(server.snapshot_names().len(), 1);

    server.set_offline(false);
    let reconciled = push(&a.worker, &a.runtime, false).unwrap();
    assert_eq!(reconciled.version, 1);
    assert_eq!(server.manifest_puts(), 1);
    assert_eq!(server.manifest().unwrap().version, 1);
    assert_eq!(server.snapshot_names().len(), 1);
    assert_eq!(status(&a.worker, &a.runtime).unwrap().state, "up_to_date");
}

#[test]
fn reconcile_confirms_a_push_that_landed_and_writes_nothing() {
    let server = FakeDav::start();
    server.drop_after_manifest_put();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    seed_library(&a.worker, "虚构相机");
    assert!(push(&a.worker, &a.runtime, false).is_err());

    server.set_offline(false);
    let writes = server.writes();
    let result = reconcile(&a.runtime).unwrap();
    assert_eq!((result.outcome, result.version), ("landed", Some(1)));
    assert_eq!(server.writes(), writes, "reconcile is read-only");
    assert_eq!(server.manifest_puts(), 1);
    assert_eq!(status(&a.worker, &a.runtime).unwrap().state, "up_to_date");
    assert_eq!(reconcile(&a.runtime).unwrap().outcome, "nothing_pending");
}

#[test]
fn reconcile_forgets_a_push_that_never_reached_the_cloud() {
    let server = FakeDav::start();
    server.drop_before_manifest_put();
    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    seed_library(&a.worker, "虚构相机");
    assert!(push(&a.worker, &a.runtime, false).is_err());
    assert!(server.manifest().is_none());

    server.set_offline(false);
    let writes = server.writes();
    let result = reconcile(&a.runtime).unwrap();
    assert_eq!(result.outcome, "not_landed");
    assert_eq!(server.writes(), writes, "reconcile is read-only");
    assert!(server.manifest().is_none());
    // The attempt is forgotten, so the ordinary comparison applies and a fresh push works.
    assert_ne!(status(&a.worker, &a.runtime).unwrap().state, "up_to_date");
    server.allow_manifest_puts();
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);
}

#[test]
fn reconcile_reports_when_another_device_wrote_in_the_meantime() {
    let server = FakeDav::start();
    let mut config_a = sync_config(&server, "虚构设备甲", true);
    let mut config_b = sync_config(&server, "虚构设备乙", true);
    config_a.library_id = Some("3f1c0e2a-0000-4000-8000-000000000001".into());
    config_b.library_id = Some("3f1c0e2a-0000-4000-8000-000000000001".into());
    let a = Device::new(config_a, PASSPHRASE);
    let b = Device::new(config_b, PASSPHRASE);
    seed_library(&a.worker, "虚构相机");
    seed_library(&b.worker, "虚构耳机");

    server.drop_before_manifest_put();
    assert!(push(&a.worker, &a.runtime, false).is_err());
    server.set_offline(false);
    server.allow_manifest_puts();
    assert_eq!(push(&b.worker, &b.runtime, false).unwrap().version, 1);

    let writes = server.writes();
    let result = reconcile(&a.runtime).unwrap();
    assert_eq!(
        (result.outcome, result.version),
        ("remote_changed", Some(1))
    );
    assert_eq!(server.writes(), writes, "reconcile is read-only");
    assert_eq!(status(&a.worker, &a.runtime).unwrap().state, "conflict");
}

#[test]
fn unconfigured_sync_never_opens_a_connection() {
    let server = FakeDav::start();
    let mut config = sync_config(&server, "未配置设备", false);
    config.password = PASSWORD.into();
    let device = Device::new(config, PASSPHRASE);

    assert_eq!(
        status(&device.worker, &device.runtime).unwrap().state,
        "unconfigured"
    );
    assert_eq!(
        push(&device.worker, &device.runtime, false)
            .unwrap_err()
            .code,
        "SYNC_UNCONFIGURED"
    );
    assert_eq!(
        pull_inspect(&device.worker, &device.runtime, false)
            .unwrap_err()
            .code,
        "SYNC_UNCONFIGURED"
    );
    assert_eq!(server.connections(), 0);
    assert_eq!(server.writes(), 0);
}

#[test]
fn errors_and_public_state_never_reveal_password_or_passphrase() {
    let server = FakeDav::start();
    let wrong_passphrase = "错误-虚构-敏感口令";
    let password = "敏感-虚构-应用密码";

    let a = Device::new(sync_config(&server, "虚构设备甲", true), PASSPHRASE);
    seed_library(&a.worker, "虚构相机");
    assert_eq!(push(&a.worker, &a.runtime, false).unwrap().version, 1);

    let mut b_config = sync_config(&server, "虚构设备乙", true);
    b_config.password = password.into();
    let b = Device::new(b_config, wrong_passphrase);
    let error = pull_inspect(&b.worker, &b.runtime, false).unwrap_err();
    assert_eq!(error.code, "SYNC_PASSPHRASE");
    let visible = format!("{error} {error:?}");
    for secret in [PASSPHRASE, wrong_passphrase, password] {
        assert!(!visible.contains(secret));
    }

    let loaded = ConfigStore::new(b.config_root.clone()).load().unwrap();
    let debug = format!("{loaded:?}");
    assert!(!debug.contains(password));
    let public = serde_json::to_string(&loaded.public_view()).unwrap();
    assert!(!public.contains(password));
    assert!(!public.contains(PASSPHRASE));

    for device in [&a, &b] {
        let root = device.root.parent().unwrap();
        assert!(!tree_contains(root, PASSPHRASE));
        assert!(!tree_contains(root, wrong_passphrase));
    }

    let mut unreachable = sync_config(&server, "虚构设备丙", true);
    unreachable.base_url = "http://127.0.0.1:1".into();
    unreachable.password = password.into();
    let c = Device::new(unreachable, PASSPHRASE);
    let network_error = push(&c.worker, &c.runtime, false).unwrap_err();
    let visible = format!("{network_error} {network_error:?}");
    for secret in [PASSPHRASE, password] {
        assert!(!visible.contains(secret));
    }
}
