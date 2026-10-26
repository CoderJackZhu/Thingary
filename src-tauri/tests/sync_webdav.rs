use std::{
    collections::{BTreeSet, HashMap},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
};

use thingary_lib::sync::webdav::{PutCondition, UreqWebDav, WebDav};

#[derive(Default)]
struct DavState {
    collections: BTreeSet<String>,
    files: HashMap<String, (Vec<u8>, String)>,
    sequence: u64,
    forced_response: Option<(u16, Vec<u8>)>,
}

struct FakeDav {
    base_url: String,
    _state: Arc<Mutex<DavState>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl FakeDav {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(DavState::default()));
        let server_state = Arc::clone(&state);
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let server_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            while !server_stop.load(std::sync::atomic::Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => handle(stream, &server_state),
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(2));
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            base_url: format!("http://{address}"),
            _state: state,
            stop,
            thread: Some(handle),
        }
    }
}

impl Drop for FakeDav {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = TcpStream::connect(self.base_url.trim_start_matches("http://"));
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn handle(mut stream: TcpStream, state: &Arc<Mutex<DavState>>) {
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
    if let Some((status, body)) = &state.forced_response {
        respond(&mut stream, *status, &[], body);
        return;
    }
    match method.as_str() {
        "MKCOL" => {
            state.collections.insert(path);
            respond(&mut stream, 201, &[], &[]);
        }
        "PUT" => {
            if let Some(expected) = headers.get("if-match") {
                if state.files.get(&path).map(|(_, etag)| etag) != Some(expected) {
                    respond(&mut stream, 412, &[], &[]);
                    return;
                }
            }
            state.sequence += 1;
            let etag = format!("\"{}\"", state.sequence);
            state.files.insert(path, (body, etag.clone()));
            respond(&mut stream, 201, &[("ETag", etag.as_str())], &[]);
        }
        "GET" => match state.files.get(&path) {
            Some((body, etag)) => respond(&mut stream, 200, &[("ETag", etag)], body),
            None => respond(&mut stream, 404, &[], &[]),
        },
        "DELETE" => {
            state.files.remove(&path);
            respond(&mut stream, 204, &[], &[]);
        }
        "PROPFIND" => {
            let mut names = state
                .files
                .keys()
                .filter(|name| name.starts_with(&path))
                .cloned()
                .collect::<Vec<_>>();
            names.sort();
            let xml = format!(
                "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">{}</d:multistatus>",
                names
                    .iter()
                    .map(|name| format!("<d:response><d:href>{name}</d:href></d:response>"))
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

#[test]
fn fake_webdav_exercises_layout_methods_and_if_match() {
    let server = FakeDav::start();
    let client = UreqWebDav::new(
        server.base_url.clone(),
        "fictional-user".into(),
        "application-password".into(),
    )
    .unwrap();

    client.mkcol("Thingary").unwrap();
    client.mkcol("Thingary/library").unwrap();
    client.mkcol("Thingary/library/snapshots").unwrap();
    let first = client
        .put("Thingary/library/manifest.json", b"one", PutCondition::None)
        .unwrap();
    let etag = first.etag.unwrap();
    let got = client.get("Thingary/library/manifest.json").unwrap();
    assert_eq!(got.body, b"one");
    assert_eq!(got.etag.as_deref(), Some(etag.as_str()));

    let stale = client.put(
        "Thingary/library/manifest.json",
        b"two",
        PutCondition::Match("\"stale\"".into()),
    );
    assert_eq!(stale.unwrap_err().code, "SYNC_PRECONDITION");
    client
        .put(
            "Thingary/library/manifest.json",
            b"two",
            PutCondition::Match(etag),
        )
        .unwrap();

    client
        .put(
            "Thingary/library/snapshots/20261023T120000Z-device.thingary.age",
            b"ciphertext",
            PutCondition::None,
        )
        .unwrap();
    let listed = client.propfind("Thingary/library/snapshots", 1).unwrap();
    assert!(listed
        .hrefs
        .iter()
        .any(|href| href.ends_with(".thingary.age")));
    client
        .delete("Thingary/library/snapshots/20261023T120000Z-device.thingary.age")
        .unwrap();
}

#[test]
fn configured_client_never_exposes_credentials_in_errors() {
    let client = UreqWebDav::new(
        "http://127.0.0.1:1".into(),
        "fictional-user".into(),
        "super-secret-application-password".into(),
    )
    .unwrap();
    let error = client.get("manifest.json").unwrap_err();
    let visible = format!("{} {}", error.code, error.message);
    assert!(!visible.contains("fictional-user"));
    assert!(!visible.contains("super-secret-application-password"));
}

#[test]
fn nutstore_missing_ancestors_are_absent_only_for_reads() {
    let server = FakeDav::start();
    let client =
        UreqWebDav::new(server.base_url.clone(), "fictional".into(), "secret".into()).unwrap();
    let missing = br#"<?xml version="1.0"?><d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>AncestorsNotFound</s:exception><s:message>private server details</s:message></d:error>"#;
    server._state.lock().unwrap().forced_response = Some((409, missing.to_vec()));

    assert!(client
        .get_optional("new/Thingary/manifest.json")
        .unwrap()
        .is_none());
    assert_eq!(
        client.get("new/Thingary/snapshot.age").unwrap_err().code,
        "SYNC_NOT_FOUND"
    );
    assert_eq!(
        client.propfind("new/Thingary", 1).unwrap_err().code,
        "SYNC_NOT_FOUND"
    );
    for condition in [PutCondition::Missing, PutCondition::Match("stale".into())] {
        assert_eq!(
            client
                .put("manifest.json", b"data", condition)
                .unwrap_err()
                .code,
            "SYNC_PRECONDITION"
        );
    }
    assert_eq!(client.mkcol("new").unwrap_err().code, "SYNC_PRECONDITION");

    // Unknown conflicts, malformed XML and other namespaces must remain errors.
    for body in [
        b"AncestorsNotFound".as_slice(),
        br#"<d:error xmlns:d="DAV:"><exception>AncestorsNotFound</exception></d:error>"#,
        br#"<d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>AncestorsNotFound</s:exception>"#,
        br#"<d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>PreconditionFailed</s:exception></d:error>"#,
    ] {
        server._state.lock().unwrap().forced_response = Some((409, body.to_vec()));
        let error = client.get_optional("manifest.json").unwrap_err();
        assert_eq!(error.code, "SYNC_PRECONDITION");
        assert_eq!(client.propfind("new", 1).unwrap_err().code, "SYNC_PRECONDITION");
        assert!(!error.message.contains("private server details"));
    }
    for status in [401, 403, 412, 500] {
        server._state.lock().unwrap().forced_response = Some((status, missing.to_vec()));
        assert!(client.get_optional("manifest.json").is_err());
        assert_ne!(
            client.propfind("new", 1).unwrap_err().code,
            "SYNC_NOT_FOUND"
        );
    }
}
