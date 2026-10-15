use crate::{
    backup_task::Cancellation,
    domain::{Error, Result},
    storage::sync_file,
};
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as _,
    fs::File,
    io::{Cursor, Read, Seek, Write},
    path::Path,
    str::FromStr,
};

/// What a chosen backup file looks like from its first bytes. Extensions are
/// only a hint; recognition always checks the content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Envelope {
    /// A binary age file encrypted to an X25519 recipient.
    Age,
    /// A plain `.thingary` ZIP archive.
    Zip,
}

/// Extra bytes the age envelope may add over the inner ZIP: the header, the
/// 16-byte tag per 64 KiB STREAM chunk, and slack for large-file ZIP offsets.
/// Measured overhead at 64 MiB is ~17 KiB; this leaves orders of magnitude of
/// room without letting oversized files through.
pub const MAX_CIPHER_OVERHEAD: u64 = 16 * 1024 * 1024;
/// The age header we will parse. The library itself enforces no limit, so the
/// header is located and copied under our own cap before any library parsing.
pub const MAX_HEADER: u64 = 64 * 1024;
/// A recovery key file is a small identity text; bigger inputs are rejected
/// before parsing (the library's own limit is 16 MiB).
pub const MAX_IDENTITY_FILE: usize = 64 * 1024;
const AGE_MAGIC: &[u8] = b"age-encryption.org/";

/// Sniffs a file by content, bounding how much is read.
pub fn sniff(path: &Path) -> Result<Envelope> {
    crate::storage::reject_links(path)?;
    let meta = std::fs::symlink_metadata(path)?;
    if crate::storage::is_link(&meta, path)? || !meta.is_file() {
        return Err(Error::new("BACKUP_LIMIT", "备份文件类型超出限制"));
    }
    let mut head = [0u8; 22];
    let mut file = File::open(path)?;
    let n = file.read(&mut head)?;
    if n >= AGE_MAGIC.len() && &head[..AGE_MAGIC.len()] == AGE_MAGIC {
        Ok(Envelope::Age)
    } else if n >= 4 && &head[..4] == b"PK\x03\x04" {
        Ok(Envelope::Zip)
    } else {
        Err(Error::new("BACKUP_FORMAT", "不是物谱备份或加密备份文件"))
    }
}

/// A recipient plus the SHA-256 of its canonical full text. Comparisons and
/// identity checks always use the full digest, never the short display form.
#[derive(Debug, Clone, PartialEq)]
pub struct RecipientKey {
    pub recipient: age::x25519::Recipient,
    pub id: String,
    pub text: String,
}

impl RecipientKey {
    pub fn from_recipient(recipient: age::x25519::Recipient) -> Self {
        let text = recipient.to_string();
        let id = format!("{:x}", Sha256::digest(text.as_bytes()));
        Self {
            recipient,
            id,
            text,
        }
    }
    /// Short, non-authoritative label for interfaces.
    pub fn short_id(&self) -> String {
        self.id.chars().take(8).collect()
    }
    pub fn parse(text: &str) -> Result<Self> {
        let trimmed = text.trim();
        let recipient = age::x25519::Recipient::from_str(trimmed)
            .map_err(|_| Error::new("CRYPTO_KEY", "公钥不可用，请检查安全配置"))?;
        Ok(Self::from_recipient(recipient))
    }
}

/// Parses exactly one supported X25519 identity from recovery-key text.
/// Comments and blank lines are allowed; anything else — a second identity,
/// plugin or SSH identities, oversized files — is rejected.
pub fn parse_recovery_key(text: &str) -> Result<age::x25519::Identity> {
    if text.len() > MAX_IDENTITY_FILE {
        return Err(Error::new("CRYPTO_KEY", "恢复密钥文件过大，无法识别"));
    }
    let mut found: Option<&str> = None;
    for line in text.lines() {
        let line = line.trim_end_matches('\r').trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if found.is_some() {
            return Err(Error::new(
                "CRYPTO_KEY",
                "恢复密钥文件包含多个身份，无法确定使用哪一个",
            ));
        }
        found = Some(line);
    }
    let line = found.ok_or_else(|| Error::new("CRYPTO_KEY", "恢复密钥为空"))?;
    age::x25519::Identity::from_str(line)
        .map_err(|_| Error::new("CRYPTO_KEY", "不是受支持的恢复密钥格式"))
}

/// Serializes a recovery key in the standard age identity file format so the
/// standard CLI and other tools can consume it directly.
pub fn recovery_key_file_text(identity: &age::x25519::Identity) -> String {
    use age::secrecy::ExposeSecret;
    let mut out =
        String::from("# Thingary 加密备份恢复密钥\n# 丢失后无法找回；请勿与备份文件存放在一起\n");
    let _ = writeln!(out, "{}", identity.to_string().expose_secret());
    out
}

/// Streams `source` through age encryption into a temporary file in
/// `target_parent`, then publishes it atomically without overwriting. The
/// plaintext is only ever read from its private staging path.
pub fn encrypt_to(
    recipient: &age::x25519::Recipient,
    source: &Path,
    destination: &Path,
) -> Result<()> {
    let staged = encrypt_staged(recipient, source, destination, &Cancellation::default())?;
    crate::backup::publish_staged(staged, destination)
}

/// Encrypts into a same-directory temporary. The caller owns guarded publication.
pub fn encrypt_staged(
    recipient: &age::x25519::Recipient,
    source: &Path,
    destination: &Path,
    cancel: &Cancellation,
) -> Result<tempfile::NamedTempFile> {
    cancel.check()?;
    crate::storage::reject_links(source)?;
    crate::storage::reject_links(destination)?;
    if destination.exists() {
        return Err(Error::new("EXISTS", "目标备份已存在，请另选文件名"));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| Error::new("PATH", "备份位置无效"))?;
    let mut temp = crate::storage::temp_file_in(parent)?;
    {
        let encryptor = age::Encryptor::with_recipients(std::iter::once(recipient as _))
            .map_err(|_| Error::new("CRYPTO_KEY", "公钥不可用，无法加密备份"))?;
        let mut writer = encryptor
            .wrap_output(temp.as_file_mut())
            .map_err(|_| Error::new("IO", "无法写入加密备份"))?;
        let mut input = File::open(source)?;
        cancel.copy(&mut input, &mut writer)?;
        cancel.check()?;
        // finish() writes the final authenticated chunk; its result is required.
        writer
            .finish()
            .map_err(|_| Error::new("IO", "加密备份未能完整收尾"))?;
    }
    temp.as_file().sync_all()?;
    cancel.check()?;
    Ok(temp)
}

/// Locates the end of an age v1 header (the `--- <mac>` line plus the 16-byte
/// payload nonce) under a hard cap, so the library's unbounded header parser
/// never sees more than `MAX_HEADER` bytes.
#[cfg(test)]
fn bounded_header(source: &Path) -> Result<(Vec<u8>, u64)> {
    bounded_header_cancel(source, &Cancellation::default())
}

fn bounded_header_cancel(source: &Path, cancel: &Cancellation) -> Result<(Vec<u8>, u64)> {
    let mut file = File::open(source)?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        cancel.check()?;
        let remaining = (MAX_HEADER as usize + 16).saturating_sub(buf.len());
        if remaining == 0 {
            return Err(Error::new("BACKUP_LIMIT", "加密备份头超出限制"));
        }
        let cap = remaining.min(chunk.len());
        let n = file.read(&mut chunk[..cap])?;
        if n == 0 {
            return Err(Error::new("CRYPTO_FORMAT", "加密备份不完整"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(p) = buf.windows(5).position(|w| w == b"\n--- ") {
            let mac_start = p + 1;
            let Some(line_end) = buf[mac_start..].iter().position(|&b| b == b'\n') else {
                continue;
            };
            let header_end = mac_start + line_end + 1;
            if header_end as u64 > MAX_HEADER {
                return Err(Error::new("BACKUP_LIMIT", "加密备份头超出限制"));
            }
            let total = header_end + 16;
            if buf.len() < total {
                continue;
            }
            buf.truncate(total);
            return Ok((buf, total as u64));
        }
    }
}

/// Streams an age file through authenticated decryption into `destination`.
/// Decryption runs to end of file: only after the final chunk authenticates is
/// the output complete, and any truncation, tampering or trailing bytes fail.
pub fn decrypt_to(
    identity: &age::x25519::Identity,
    source: &Path,
    destination: &Path,
) -> Result<()> {
    decrypt_to_cancel(identity, source, destination, &Cancellation::default())
}

pub fn decrypt_to_cancel(
    identity: &age::x25519::Identity,
    source: &Path,
    destination: &Path,
    cancel: &Cancellation,
) -> Result<()> {
    cancel.check()?;
    crate::storage::reject_links(source)?;
    crate::storage::reject_links(destination)?;
    let (header, payload_start) = bounded_header_cancel(source, cancel)?;
    let mut file = File::open(source)?;
    file.seek(std::io::SeekFrom::Start(payload_start))?;
    let input = Cursor::new(header).chain(file);
    let decryptor = age::Decryptor::new(input).map_err(|e| match e {
        age::DecryptError::UnknownFormat => Error::new("CRYPTO_FORMAT", "不支持此加密类型"),
        _ => Error::new("CRYPTO_AUTH", "加密备份无法解析，可能已损坏"),
    })?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|_| Error::new("CRYPTO_AUTH", "无法解密，请核对恢复密钥或备份完整性"))?;
    let mut out = crate::storage::temp_file_in(
        destination
            .parent()
            .ok_or_else(|| Error::new("PATH", "临时位置无效"))?,
    )?;
    let mut buf = [0u8; 64 * 1024];
    let mut remaining: u64 = crate::backup::MAX_ARCHIVE_FILE;
    loop {
        cancel.check()?;
        let n = reader
            .read(&mut buf)
            .map_err(|_| Error::new("CRYPTO_AUTH", "无法解密，请核对恢复密钥或备份完整性"))?;
        cancel.check()?;
        if n == 0 {
            break;
        }
        remaining = remaining
            .checked_sub(n as u64)
            .ok_or_else(|| Error::new("BACKUP_LIMIT", "解密内容超出备份大小限制"))?;
        out.write_all(&buf[..n])?;
    }
    cancel.check()?;
    out.as_file().sync_all()?;
    cancel.check()?;
    crate::storage::persist_retry(out, destination, true)?;
    sync_file(destination)?;
    Ok(())
}

/// Random challenge used to prove a re-entered recovery key really decrypts
/// content for the candidate recipient, not merely that it parses.
pub fn challenge_roundtrip(
    recipient: &age::x25519::Recipient,
    identity: &age::x25519::Identity,
) -> Result<bool> {
    use rand::RngCore;
    let mut token = [0u8; 64];
    rand::rngs::OsRng.fill_bytes(&mut token);
    let cipher = age::encrypt(recipient, &token)
        .map_err(|_| Error::new("CRYPTO_KEY", "公钥不可用，无法加密备份"))?;
    // A non-matching key is a normal "not verified" outcome, not an error:
    // callers distinguish "key proves itself" from "key does not".
    let verified = match age::decrypt(identity, &cipher) {
        Ok(round) => round == token,
        Err(_) => false,
    };
    Ok(verified)
}

/// Hashes a file without loading it into memory.
pub fn file_digest(path: &Path, max: u64) -> Result<(u64, String)> {
    crate::backup::file_digest(path, max)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("thingary-backup-crypto-tests");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(format!("{name}-{}", crate::storage::uid()))
    }

    #[test]
    fn round_trip_preserves_digest() {
        let identity = age::x25519::Identity::generate();
        let recipient = identity.to_public();
        let plain = tmp("plain.bin");
        std::fs::write(&plain, vec![7u8; 200_000]).unwrap();
        let cipher = tmp("plain.age");
        encrypt_to(&recipient, &plain, &cipher).unwrap();
        assert_eq!(sniff(&cipher).unwrap(), Envelope::Age);
        assert!(cipher.metadata().unwrap().len() > plain.metadata().unwrap().len());
        let back = tmp("round.bin");
        decrypt_to(&identity, &cipher, &back).unwrap();
        assert_eq!(
            file_digest(&plain, 1 << 30).unwrap().1,
            file_digest(&back, 1 << 30).unwrap().1
        );
        // Overhead stays far below the budget.
        let overhead = cipher.metadata().unwrap().len() - plain.metadata().unwrap().len();
        assert!(overhead < 1024 * 1024, "overhead {overhead}");
    }

    #[test]
    fn publish_never_overwrites() {
        let identity = age::x25519::Identity::generate();
        let plain = tmp("noclobber.bin");
        std::fs::write(&plain, b"x").unwrap();
        let cipher = tmp("noclobber.age");
        encrypt_to(&identity.to_public(), &plain, &cipher).unwrap();
        assert!(encrypt_to(&identity.to_public(), &plain, &cipher).is_err());
    }

    #[test]
    fn wrong_key_tampering_truncation_and_tail_are_rejected() {
        let identity = age::x25519::Identity::generate();
        let plain = tmp("tamper.bin");
        std::fs::write(&plain, vec![1u8; 150_000]).unwrap();
        let cipher = tmp("tamper.age");
        encrypt_to(&identity.to_public(), &plain, &cipher).unwrap();
        let bytes = std::fs::read(&cipher).unwrap();
        let out = tmp("tamper.out");
        let other = age::x25519::Identity::generate();
        assert!(decrypt_to(&other, &cipher, &out).is_err());
        let mut head = bytes.clone();
        head[10] ^= 0xff;
        let head_path = tmp("t-head.age");
        std::fs::write(&head_path, head).unwrap();
        assert!(decrypt_to(&identity, &head_path, &out).is_err());
        let mut mid = bytes.clone();
        let mid_at = bytes.len() / 2;
        mid[mid_at] ^= 0xff;
        let mid_path = tmp("t-mid.age");
        std::fs::write(&mid_path, mid).unwrap();
        assert!(decrypt_to(&identity, &mid_path, &out).is_err());
        let cut = tmp("t-cut.age");
        std::fs::write(&cut, &bytes[..bytes.len() - 40]).unwrap();
        assert!(decrypt_to(&identity, &cut, &out).is_err());
        let mut tail = bytes.clone();
        tail.extend_from_slice(b"tail");
        let tail_path = tmp("t-tail.age");
        std::fs::write(&tail_path, tail).unwrap();
        assert!(decrypt_to(&identity, &tail_path, &out).is_err());
    }

    #[test]
    fn oversized_header_is_rejected_under_the_cap() {
        let identity = age::x25519::Identity::generate();
        let mut huge = String::from("age-encryption.org/v1\n");
        for i in 0..60_000 {
            let _ = writeln!(huge, "-> junk{i} aaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        }
        let path = tmp("huge.age");
        std::fs::write(&path, huge).unwrap();
        let out = tmp("huge.out");
        assert!(decrypt_to(&identity, &path, &out).is_err());
    }

    fn err_code(result: Result<age::x25519::Identity>) -> String {
        match result {
            Ok(_) => panic!("expected an error"),
            Err(error) => error.code,
        }
    }

    #[test]
    fn recovery_key_parsing_rules() {
        let identity = age::x25519::Identity::generate();
        use age::secrecy::ExposeSecret;
        let secret = identity.to_string().expose_secret().to_string();
        parse_recovery_key(&format!("# note\n\n{secret}\n# end\n")).unwrap();
        assert_eq!(
            err_code(parse_recovery_key(&format!("{secret}\n{secret}\n"))),
            "CRYPTO_KEY"
        );
        assert_eq!(
            err_code(parse_recovery_key("AGE-PLUGIN-QUIRK-1FOO")),
            "CRYPTO_KEY"
        );
        assert_eq!(err_code(parse_recovery_key("garbage")), "CRYPTO_KEY");
        assert_eq!(
            err_code(parse_recovery_key("# only comments")),
            "CRYPTO_KEY"
        );
        assert_eq!(
            err_code(parse_recovery_key(&format!("# {}", "x".repeat(70_000)))),
            "CRYPTO_KEY"
        );
        let round = parse_recovery_key(&recovery_key_file_text(&identity)).unwrap();
        assert_eq!(
            round.to_public().to_string(),
            identity.to_public().to_string()
        );
    }

    #[test]
    fn challenge_roundtrip_accepts_matching_key_only() {
        let identity = age::x25519::Identity::generate();
        let recipient = identity.to_public();
        assert!(challenge_roundtrip(&recipient, &identity).unwrap());
        let other = age::x25519::Identity::generate();
        assert!(!challenge_roundtrip(&recipient, &other).unwrap());
    }

    #[test]
    fn zip_files_are_sniffed_not_decrypted() {
        let path = tmp("zip.age");
        {
            let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
            zip.start_file("a.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"hello").unwrap();
            zip.finish().unwrap();
        }
        assert_eq!(sniff(&path).unwrap(), Envelope::Zip);
        let identity = age::x25519::Identity::generate();
        let out = tmp("zip.out");
        let err = decrypt_to(&identity, &path, &out).unwrap_err();
        assert_eq!(err.code, "CRYPTO_FORMAT");
    }
}

#[cfg(test)]
mod bounded_header_boundary_tests {
    use super::*;
    #[test]
    fn mac_line_split_across_reads_is_not_rejected() {
        let mut bytes = b"age-encryption.org/v1\n".to_vec();
        bytes.resize(4091, b'a');
        bytes.extend_from_slice(b"\n--- AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n");
        let expected = bytes.len() + 16;
        bytes.extend_from_slice(&[0; 16]);
        bytes.extend_from_slice(b"payload");
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(&bytes).unwrap();
        let (header, offset) = bounded_header(file.path()).unwrap();
        assert_eq!(offset, expected as u64);
        assert_eq!(header, bytes[..expected]);
    }
    #[test]
    fn mac_at_the_header_limit_cannot_extend_the_cap() {
        let mut bytes = b"age-encryption.org/v1\n".to_vec();
        bytes.resize(MAX_HEADER as usize - 8, b'a');
        bytes.extend_from_slice(b"\n--- AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n");
        bytes.extend_from_slice(&[0; 16]);
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(&bytes).unwrap();
        assert_eq!(
            bounded_header(file.path()).unwrap_err().code,
            "BACKUP_LIMIT"
        );
    }
}
