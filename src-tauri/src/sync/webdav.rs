use std::{io::Read, thread, time::Duration};

use quick_xml::{
    events::Event,
    name::{Namespace, ResolveResult},
    reader::NsReader,
    Reader,
};
use serde::{Deserialize, Serialize};

use crate::domain::{Error, Result};

const MAX_RESPONSE_BYTES: usize = 512 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PutCondition {
    None,
    Match(String),
    Missing,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DavResponse {
    pub body: Vec<u8>,
    pub etag: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PropfindResponse {
    pub hrefs: Vec<String>,
    pub etag: Option<String>,
}

pub trait WebDav: Send + Sync {
    fn mkcol(&self, path: &str) -> Result<()>;
    fn put(&self, path: &str, body: &[u8], condition: PutCondition) -> Result<DavResponse>;
    fn get(&self, path: &str) -> Result<DavResponse>;
    fn delete(&self, path: &str) -> Result<()>;
    fn propfind(&self, path: &str, depth: u8) -> Result<PropfindResponse>;
}

pub struct UreqWebDav {
    agent: ureq::Agent,
    base_url: String,
    authorization: String,
}

impl UreqWebDav {
    pub fn new(base_url: String, username: String, password: String) -> Result<Self> {
        let base_url = base_url.trim_end_matches('/').to_string();
        // ureq 3 rejects the WebDAV methods (MKCOL, PROPFIND), so this uses ureq 2.
        let plain_http = base_url.starts_with("http://");
        let rest = base_url
            .strip_prefix("https://")
            .or_else(|| base_url.strip_prefix("http://"))
            .unwrap_or("");
        let authority = rest.split('/').next().unwrap_or("");
        if authority.is_empty()
            || authority.contains('@')
            || base_url.contains('?')
            || base_url.contains('#')
            || base_url
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
        {
            return Err(Error::new("SYNC_CONFIG", "WebDAV 地址无效"));
        }
        // The application password travels in a Basic header, so plain http is only for this
        // computer or the local network (a NAS at home), never for a server on the internet.
        if plain_http && !plain_http_allowed(authority) {
            return Err(Error::new(
                "SYNC_CONFIG",
                "WebDAV 地址需要使用 https；只有本机或局域网地址可以用 http",
            ));
        }
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(30))
            .timeout_connect(Duration::from_secs(8))
            .redirects(0)
            .build();
        Ok(Self {
            agent,
            base_url,
            authorization: format!("Basic {}", base64(&format!("{username}:{password}"))),
        })
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        body: &[u8],
        headers: &[(&str, &str)],
        retries: usize,
    ) -> Result<(u16, DavResponse)> {
        let url = self.url(path)?;
        for attempt in 0..=retries {
            let mut request = self
                .agent
                .request(method, &url)
                .set("Authorization", &self.authorization);
            for (name, value) in headers {
                request = request.set(name, value);
            }
            let outcome = if body.is_empty() && method != "PUT" {
                request.call()
            } else {
                request.send_bytes(body)
            };
            let response = match outcome {
                Ok(response) => response,
                // A non-2xx status is an answer, not a transport failure.
                Err(ureq::Error::Status(_, response)) => response,
                Err(_) if attempt < retries => {
                    thread::sleep(Duration::from_millis(80));
                    continue;
                }
                Err(_) => return Err(Error::new("SYNC_NETWORK", "无法连接 WebDAV 服务器")),
            };
            let status = response.status();
            let etag = response.header("ETag").map(str::to_string);
            let mut bytes = Vec::new();
            response
                .into_reader()
                .take(MAX_RESPONSE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| Error::new("SYNC_NETWORK", "WebDAV 响应无法读取"))?;
            if bytes.len() > MAX_RESPONSE_BYTES {
                return Err(Error::new("SYNC_NETWORK", "WebDAV 响应过大"));
            }
            return Ok((status, DavResponse { body: bytes, etag }));
        }
        Err(Error::new("SYNC_NETWORK", "无法连接 WebDAV 服务器"))
    }

    fn url(&self, path: &str) -> Result<String> {
        // Collections are addressed with a trailing slash: Apache, nginx and several NAS servers
        // answer a slash-less collection URL with a redirect, which this client never follows.
        let (path, slash) = path
            .strip_suffix('/')
            .map_or((path, ""), |inner| (inner, "/"));
        let mut safe = String::new();
        for (index, component) in path.split('/').enumerate() {
            if component.is_empty() || component == "." || component == ".." {
                return Err(Error::new("SYNC_PATH", "WebDAV 路径无效"));
            }
            if index > 0 {
                safe.push('/');
            }
            for byte in component.bytes() {
                if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                    safe.push(byte as char);
                } else {
                    safe.push_str(&format!("%{byte:02X}"));
                }
            }
        }
        Ok(format!("{}/{safe}{slash}", self.base_url))
    }

    pub fn get_optional(&self, path: &str) -> Result<Option<DavResponse>> {
        let (status, response) = self.request("GET", path, &[], &[], 2)?;
        match status {
            200 => Ok(Some(response)),
            404 => Ok(None),
            409 if nutstore_missing_ancestors(&response.body) => Ok(None),
            _ => Err(status_error(status)),
        }
    }
}

impl WebDav for UreqWebDav {
    fn mkcol(&self, path: &str) -> Result<()> {
        let (status, _) = self.request("MKCOL", &collection(path), &[], &[], 1)?;
        match status {
            200 | 201 | 204 | 405 => Ok(()),
            _ => Err(status_error(status)),
        }
    }

    fn put(&self, path: &str, body: &[u8], condition: PutCondition) -> Result<DavResponse> {
        let mut headers = Vec::new();
        match &condition {
            PutCondition::None => {}
            PutCondition::Match(etag) => headers.push(("If-Match", etag.as_str())),
            PutCondition::Missing => headers.push(("If-None-Match", "*")),
        }
        let (status, response) = self.request("PUT", path, body, &headers, 0)?;
        match status {
            200 | 201 | 204 => Ok(response),
            409 | 412 => Err(Error::new(
                "SYNC_PRECONDITION",
                "远端同步清单已被其他设备更新",
            )),
            _ => Err(status_error(status)),
        }
    }

    fn get(&self, path: &str) -> Result<DavResponse> {
        let (status, response) = self.request("GET", path, &[], &[], 2)?;
        match status {
            200 => Ok(response),
            _ => Err(read_status_error(status, &response.body)),
        }
    }

    fn delete(&self, path: &str) -> Result<()> {
        let (status, _) = self.request("DELETE", path, &[], &[], 1)?;
        match status {
            200 | 202 | 204 | 404 => Ok(()),
            _ => Err(status_error(status)),
        }
    }

    fn propfind(&self, path: &str, depth: u8) -> Result<PropfindResponse> {
        let depth = depth.to_string();
        let (status, response) =
            self.request("PROPFIND", &collection(path), &[], &[("Depth", &depth)], 2)?;
        if status != 207 && status != 200 {
            return Err(read_status_error(status, &response.body));
        }
        let mut reader = Reader::from_reader(response.body.as_slice());
        reader.config_mut().trim_text(true);
        let mut hrefs = Vec::new();
        let mut in_href = false;
        loop {
            match reader.read_event() {
                Ok(Event::Start(event)) if event.local_name().as_ref() == b"href" => in_href = true,
                Ok(Event::Text(text)) if in_href => {
                    hrefs.push(
                        text.decode()
                            .map_err(|_| Error::new("SYNC_WEBDAV", "WebDAV 列表无法读取"))?
                            .into_owned(),
                    );
                }
                Ok(Event::End(event)) if event.local_name().as_ref() == b"href" => in_href = false,
                Ok(Event::Eof) => break,
                Err(_) => return Err(Error::new("SYNC_WEBDAV", "WebDAV 列表无法读取")),
                _ => {}
            }
        }
        hrefs.sort();
        hrefs.dedup();
        Ok(PropfindResponse {
            hrefs,
            etag: response.etag,
        })
    }
}

fn collection(path: &str) -> String {
    format!("{}/", path.trim_end_matches('/'))
}

fn read_status_error(status: u16, body: &[u8]) -> Error {
    if status == 409 && nutstore_missing_ancestors(body) {
        return status_error(404);
    }
    status_error(status)
}

// Nutstore returns 409 rather than 404 when a read's top-level folder is absent.
// Only recognise its structured error on reads; write conflicts must keep failing.
fn nutstore_missing_ancestors(body: &[u8]) -> bool {
    if body.len() > 8192 {
        return false;
    }
    let mut reader = NsReader::from_reader(body);
    reader.config_mut().trim_text(true);
    let mut depth = 0_usize;
    let mut root_seen = false;
    let mut in_exception = false;
    let mut missing = false;
    loop {
        let Ok((namespace, event)) = reader.read_resolved_event() else {
            return false;
        };
        match event {
            Event::Start(event) => {
                if depth == 0 {
                    if root_seen
                        || namespace != ResolveResult::Bound(Namespace(b"DAV:"))
                        || event.local_name().as_ref() != b"error"
                    {
                        return false;
                    }
                    root_seen = true;
                }
                depth += 1;
                in_exception = depth == 2
                    && namespace == ResolveResult::Bound(Namespace(b"http://ns.jianguoyun.com"))
                    && event.local_name().as_ref() == b"exception";
            }
            Event::Text(text) if in_exception => {
                missing = text.decode().is_ok_and(|code| code == "AncestorsNotFound");
            }
            Event::End(_) => {
                let Some(parent_depth) = depth.checked_sub(1) else {
                    return false;
                };
                depth = parent_depth;
                in_exception = false;
            }
            Event::DocType(_) => return false,
            Event::Empty(_) if depth == 0 => return false,
            Event::Eof => return root_seen && depth == 0 && missing,
            _ => {}
        }
    }
}

fn status_error(status: u16) -> Error {
    match status {
        401 | 403 => Error::new("SYNC_AUTH", "WebDAV 登录失败或没有访问权限"),
        404 => Error::new("SYNC_NOT_FOUND", "WebDAV 资源不存在"),
        409 | 412 => Error::new("SYNC_PRECONDITION", "远端同步状态已改变"),
        _ => Error::new("SYNC_WEBDAV", "WebDAV 服务器未完成请求"),
    }
}

fn base64(value: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = value.as_bytes();
    let mut output = String::new();
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        output.push(ALPHABET[(first >> 2) as usize] as char);
        output.push(ALPHABET[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    output
}

/// True for hosts where sending credentials over plain http stays on this machine or the local
/// network: loopback, private IPv4 ranges, link-local, `.local`-style names and bare host names.
fn plain_http_allowed(authority: &str) -> bool {
    let host = if let Some(inner) = authority.strip_prefix('[') {
        inner.split(']').next().unwrap_or("")
    } else {
        authority
            .rsplit_once(':')
            .map_or(authority, |(host, port)| {
                if port.chars().all(|c| c.is_ascii_digit()) {
                    host
                } else {
                    authority
                }
            })
    }
    .to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            std::net::IpAddr::V6(v6) => {
                let first = v6.segments()[0];
                v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
            }
        };
    }
    host == "localhost"
        || !host.contains('.')
        || ["local", "lan", "home.arpa", "internal"]
            .iter()
            .any(|suffix| host.ends_with(&format!(".{suffix}")))
}

#[cfg(test)]
mod http_policy_tests {
    use super::plain_http_allowed;

    #[test]
    fn plain_http_is_limited_to_this_machine_and_the_local_network() {
        for ok in [
            "127.0.0.1:8765",
            "localhost",
            "[::1]:8080",
            "10.0.2.2:8765",
            "192.168.1.20",
            "172.16.0.5",
            "172.31.255.1",
            "169.254.1.1",
            "nas",
            "mynas.local",
            "box.home.arpa:5005",
            "[fd00::1]",
            "[fe80::1]:80",
        ] {
            assert!(plain_http_allowed(ok), "{ok} should be allowed");
        }
        for bad in [
            "dav.example.com",
            "8.8.8.8",
            "172.32.0.1",
            "11.0.0.1",
            "[2001:db8::1]",
            "evil.example.com:8080",
            "dav.jianguoyun.com",
        ] {
            assert!(!plain_http_allowed(bad), "{bad} should be refused");
        }
    }
}
