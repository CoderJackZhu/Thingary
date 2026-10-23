use std::{thread, time::Duration};

use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use ureq::http::{header, Method, Request, Uri};

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
        let uri: Uri = base_url
            .parse()
            .map_err(|_| Error::new("SYNC_CONFIG", "WebDAV 地址无效"))?;
        if !matches!(uri.scheme_str(), Some("http" | "https"))
            || uri.authority().is_none()
            || uri
                .path_and_query()
                .and_then(|value| value.query())
                .is_some()
            || uri
                .authority()
                .is_some_and(|value| value.as_str().contains('@'))
        {
            return Err(Error::new("SYNC_CONFIG", "WebDAV 地址无效"));
        }
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            .timeout_connect(Some(Duration::from_secs(8)))
            .max_redirects(0)
            .http_status_as_error(false)
            .build();
        Ok(Self {
            agent: config.new_agent(),
            base_url,
            authorization: format!("Basic {}", base64(&format!("{username}:{password}"))),
        })
    }

    fn request(
        &self,
        method: Method,
        path: &str,
        body: &[u8],
        headers: &[(&str, &str)],
        retries: usize,
    ) -> Result<(u16, DavResponse)> {
        let url = self.url(path)?;
        for attempt in 0..=retries {
            let mut builder = Request::builder()
                .method(method.clone())
                .uri(&url)
                .header(header::AUTHORIZATION, &self.authorization);
            for (name, value) in headers {
                builder = builder.header(*name, *value);
            }
            let request = builder
                .body(body.to_vec())
                .map_err(|_| Error::new("SYNC_NETWORK", "无法创建 WebDAV 请求"))?;
            match self.agent.run(request) {
                Ok(mut response) => {
                    let status = response.status().as_u16();
                    let etag = response
                        .headers()
                        .get(header::ETAG)
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_string);
                    let bytes = response
                        .body_mut()
                        .with_config()
                        .limit(MAX_RESPONSE_BYTES as u64)
                        .read_to_vec()
                        .map_err(|_| Error::new("SYNC_NETWORK", "WebDAV 响应无法读取"))?;
                    return Ok((status, DavResponse { body: bytes, etag }));
                }
                Err(_) if attempt < retries => thread::sleep(Duration::from_millis(80)),
                Err(_) => return Err(Error::new("SYNC_NETWORK", "无法连接 WebDAV 服务器")),
            }
        }
        Err(Error::new("SYNC_NETWORK", "无法连接 WebDAV 服务器"))
    }

    fn url(&self, path: &str) -> Result<String> {
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
        Ok(format!("{}/{safe}", self.base_url))
    }

    pub fn get_optional(&self, path: &str) -> Result<Option<DavResponse>> {
        let (status, response) = self.request(Method::GET, path, &[], &[], 2)?;
        match status {
            200 => Ok(Some(response)),
            404 => Ok(None),
            _ => Err(status_error(status)),
        }
    }
}

impl WebDav for UreqWebDav {
    fn mkcol(&self, path: &str) -> Result<()> {
        let method = Method::from_bytes(b"MKCOL").expect("valid WebDAV method");
        let (status, _) = self.request(method, path, &[], &[], 1)?;
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
        let (status, response) = self.request(Method::PUT, path, body, &headers, 0)?;
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
        let (status, response) = self.request(Method::GET, path, &[], &[], 2)?;
        match status {
            200 => Ok(response),
            _ => Err(status_error(status)),
        }
    }

    fn delete(&self, path: &str) -> Result<()> {
        let (status, _) = self.request(Method::DELETE, path, &[], &[], 1)?;
        match status {
            200 | 202 | 204 | 404 => Ok(()),
            _ => Err(status_error(status)),
        }
    }

    fn propfind(&self, path: &str, depth: u8) -> Result<PropfindResponse> {
        let method = Method::from_bytes(b"PROPFIND").expect("valid WebDAV method");
        let depth = depth.to_string();
        let (status, response) = self.request(method, path, &[], &[("Depth", &depth)], 2)?;
        if status != 207 && status != 200 {
            return Err(status_error(status));
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
