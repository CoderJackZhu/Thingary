use chrono::DateTime;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{Error, Result};

pub const MANIFEST_FORMAT: u32 = 1;
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Manifest {
    pub format: u32,
    pub library_id: String,
    pub version: u64,
    pub snapshot: String,
    pub snapshot_sha256: String,
    pub snapshot_bytes: u64,
    pub schema_version: u32,
    pub app_version: String,
    pub device_id: String,
    pub device_name: String,
    pub created_at: String,
}

impl Manifest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(Error::new("SYNC_MANIFEST", "远端同步清单过大"));
        }
        let manifest: Self = serde_json::from_slice(bytes)
            .map_err(|_| Error::new("SYNC_MANIFEST", "远端同步清单无法读取"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn to_json(&self) -> Result<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec_pretty(self).map_err(|_| Error::new("SYNC_MANIFEST", "无法生成同步清单"))
    }

    pub fn validate(&self) -> Result<()> {
        if self.format != MANIFEST_FORMAT
            || Uuid::parse_str(&self.library_id).is_err()
            || self.version == 0
            || self.snapshot_bytes == 0
            || !valid_snapshot_path(&self.snapshot)
            || !valid_sha256(&self.snapshot_sha256)
            || self.app_version.trim().is_empty()
            || self.device_id.trim().is_empty()
            || self.device_name.trim().is_empty()
            || DateTime::parse_from_rfc3339(&self.created_at).is_err()
        {
            return Err(Error::new("SYNC_MANIFEST", "远端同步清单内容无效"));
        }
        Ok(())
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_snapshot_path(value: &str) -> bool {
    let Some(name) = value.strip_prefix("snapshots/") else {
        return false;
    };
    !name.is_empty()
        && name.ends_with(".thingary.age")
        && !name.contains('/')
        && !name.contains('\\')
        && name != ".thingary.age"
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}
