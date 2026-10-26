use std::io::{Read, Write};

use age::secrecy::SecretString;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::{Error, Result};

use super::{manifest::Manifest, state::SyncConfig};

#[derive(Clone, Debug)]
pub struct DecisionInput {
    pub configured: bool,
    pub local_changed: bool,
    pub remote_changed: bool,
    pub local_empty: bool,
    pub remote: Option<Manifest>,
    pub local_schema: u32,
    pub has_sync_baseline: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncDecision {
    Disabled,
    UpToDate,
    EmptyRemote,
    Push,
    Pull,
    Conflict,
}

pub fn decide(input: &DecisionInput) -> Result<SyncDecision> {
    if !input.configured {
        return Ok(SyncDecision::Disabled);
    }
    if let Some(remote) = input.remote.as_ref() {
        if remote.schema_version > input.local_schema {
            return Err(Error::new(
                "SYNC_SCHEMA_NEWER",
                "远端资料由较新版本的物谱创建，请先升级应用",
            ));
        }
    }
    if !input.has_sync_baseline {
        return match input.remote.as_ref() {
            None if input.local_empty => Ok(SyncDecision::UpToDate),
            None => Ok(SyncDecision::EmptyRemote),
            Some(_) if input.local_empty => Ok(SyncDecision::Pull),
            Some(_) => Ok(SyncDecision::Conflict),
        };
    }
    Ok(match (input.local_changed, input.remote_changed) {
        (false, false) => SyncDecision::UpToDate,
        (true, false) => SyncDecision::Push,
        (false, true) => SyncDecision::Pull,
        (true, true) => SyncDecision::Conflict,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingResolution {
    None,
    Committed,
    Retryable,
    Conflict,
}

pub fn reconcile_pending(
    config: &SyncConfig,
    remote: Option<&Manifest>,
) -> Result<PendingResolution> {
    let Some(pending) = config.pending_push.as_ref() else {
        return Ok(PendingResolution::None);
    };
    if remote == Some(&pending.manifest) {
        return Ok(PendingResolution::Committed);
    }
    match remote {
        None if pending.previous_remote_version == 0 => Ok(PendingResolution::Retryable),
        Some(manifest) if manifest.version == pending.previous_remote_version => {
            Ok(PendingResolution::Retryable)
        }
        _ => Ok(PendingResolution::Conflict),
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn verify_snapshot(manifest: &Manifest, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != manifest.snapshot_bytes
        || sha256_hex(bytes) != manifest.snapshot_sha256
    {
        return Err(Error::new(
            "SYNC_SNAPSHOT_MISMATCH",
            "远端同步快照与清单不一致",
        ));
    }
    Ok(())
}

/// scrypt cost for sync snapshots, fixed (2^18, about 256 MiB and a second or so) instead of the
/// device-tuned default: a fast phone would otherwise pick a cost that a slower computer
/// refuses to open, which used to surface as a misleading "wrong passphrase".
// The test-only fault-injection feature uses a cheap cost so the suites stay fast.
const SYNC_WORK_FACTOR: u8 = if cfg!(feature = "fault-injection") {
    12
} else {
    18
};
/// Highest cost accepted when opening a snapshot (also covers snapshots written by builds that
/// tuned the cost to the device).
const SYNC_MAX_WORK_FACTOR: u8 = 20;

pub fn encrypt_snapshot(plaintext: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    encrypt_with_work_factor(plaintext, passphrase, SYNC_WORK_FACTOR)
}

pub fn encrypt_with_work_factor(plaintext: &[u8], passphrase: &str, log_n: u8) -> Result<Vec<u8>> {
    let mut recipient = age::scrypt::Recipient::new(SecretString::from(passphrase));
    recipient.set_work_factor(log_n);
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| Error::new("SYNC_CIPHERTEXT", "无法加密同步快照"))?;
    let mut encrypted = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|_| Error::new("SYNC_CIPHERTEXT", "无法加密同步快照"))?;
    writer
        .write_all(plaintext)
        .and_then(|_| writer.finish())
        .map_err(|_| Error::new("SYNC_CIPHERTEXT", "无法加密同步快照"))?;
    Ok(encrypted)
}

pub fn decrypt_snapshot(ciphertext: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    decrypt_with_limit(ciphertext, passphrase, SYNC_MAX_WORK_FACTOR)
}

pub fn decrypt_with_limit(ciphertext: &[u8], passphrase: &str, max_log_n: u8) -> Result<Vec<u8>> {
    let decryptor = age::Decryptor::new(ciphertext)
        .map_err(|_| Error::new("SYNC_CIPHERTEXT", "同步快照密文无效"))?;
    let mut identity = age::scrypt::Identity::new(SecretString::from(passphrase));
    identity.set_max_work_factor(max_log_n);
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|error| match error {
            age::DecryptError::ExcessiveWork { .. } => Error::new(
                "SYNC_CIPHERTEXT",
                "此同步快照的加密强度超出本设备可处理的范围，请升级应用，或在写入它的设备上重新同步",
            ),
            _ => Error::new("SYNC_PASSPHRASE", "同步口令不正确"),
        })?;
    let mut plaintext = Vec::new();
    reader
        .read_to_end(&mut plaintext)
        .map_err(|_| Error::new("SYNC_CIPHERTEXT", "同步快照密文不完整或已损坏"))?;
    Ok(plaintext)
}
