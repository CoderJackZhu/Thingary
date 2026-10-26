use thingary_lib::sync::{
    engine::{
        decrypt_snapshot, encrypt_snapshot, reconcile_pending, verify_snapshot, PendingResolution,
    },
    manifest::Manifest,
    state::{PendingPush, SyncConfig},
};

fn manifest(version: u64, sha: &str, bytes: u64) -> Manifest {
    Manifest {
        format: 1,
        library_id: "2f2e52d3-00bb-4f93-bba4-ad9f62f34211".into(),
        version,
        snapshot: format!("snapshots/20261023T12000{version}Z-device.thingary.age"),
        snapshot_sha256: sha.into(),
        snapshot_bytes: bytes,
        schema_version: 44,
        app_version: "0.0.9".into(),
        device_id: "device-id".into(),
        device_name: "虚构设备".into(),
        created_at: "2026-10-23T12:00:00Z".into(),
    }
}

#[test]
fn passphrase_cipher_rejects_wrong_secret_tampering_and_truncation() {
    let plaintext = b"fictional complete backup bytes";
    let encrypted = encrypt_snapshot(plaintext, "正确的虚构口令").unwrap();
    assert_ne!(encrypted, plaintext);
    assert_eq!(
        decrypt_snapshot(&encrypted, "正确的虚构口令").unwrap(),
        plaintext
    );
    assert_eq!(
        decrypt_snapshot(&encrypted, "错误口令").unwrap_err().code,
        "SYNC_PASSPHRASE"
    );

    let mut tampered = encrypted.clone();
    let middle = tampered.len() / 2;
    tampered[middle] ^= 0x40;
    let original_manifest = manifest(
        1,
        &thingary_lib::sync::engine::sha256_hex(&encrypted),
        encrypted.len() as u64,
    );
    assert_eq!(
        verify_snapshot(&original_manifest, &tampered)
            .unwrap_err()
            .code,
        "SYNC_SNAPSHOT_MISMATCH"
    );
    assert_eq!(
        verify_snapshot(&original_manifest, &encrypted[..encrypted.len() - 1])
            .unwrap_err()
            .code,
        "SYNC_SNAPSHOT_MISMATCH"
    );
}

#[test]
fn manifest_must_match_snapshot_size_and_sha256() {
    let bytes = b"ciphertext";
    let sha = thingary_lib::sync::engine::sha256_hex(bytes);
    verify_snapshot(&manifest(1, &sha, bytes.len() as u64), bytes).unwrap();
    assert_eq!(
        verify_snapshot(&manifest(1, &"0".repeat(64), bytes.len() as u64), bytes)
            .unwrap_err()
            .code,
        "SYNC_SNAPSHOT_MISMATCH"
    );
    assert_eq!(
        verify_snapshot(&manifest(1, &sha, bytes.len() as u64 + 1), bytes)
            .unwrap_err()
            .code,
        "SYNC_SNAPSHOT_MISMATCH"
    );
}

#[test]
fn unknown_manifest_write_is_reconciled_before_any_retry() {
    let pending_manifest = manifest(8, &"a".repeat(64), 123);
    let config = SyncConfig {
        pending_push: Some(PendingPush {
            previous_remote_version: 7,
            manifest: pending_manifest.clone(),
            fingerprint: "d".repeat(64),
        }),
        ..SyncConfig::default()
    };

    assert_eq!(
        reconcile_pending(&config, Some(&pending_manifest)).unwrap(),
        PendingResolution::Committed
    );
    assert_eq!(
        reconcile_pending(&config, Some(&manifest(7, &"b".repeat(64), 99))).unwrap(),
        PendingResolution::Retryable
    );
    assert_eq!(
        reconcile_pending(&config, Some(&manifest(9, &"c".repeat(64), 99))).unwrap(),
        PendingResolution::Conflict
    );
}

#[test]
fn snapshots_from_a_faster_device_open_and_an_excessive_cost_is_not_a_wrong_passphrase() {
    use thingary_lib::sync::engine::{decrypt_with_limit, encrypt_with_work_factor};
    // Written with a higher cost than this device would pick on its own.
    let heavy = encrypt_with_work_factor(b"fictional", "口令", 14).unwrap();
    assert_eq!(decrypt_snapshot(&heavy, "口令").unwrap(), b"fictional");
    // A limit below the written cost is reported as such, not as a wrong passphrase.
    assert_eq!(
        decrypt_with_limit(&heavy, "口令", 10).unwrap_err().code,
        "SYNC_CIPHERTEXT"
    );
    // A genuinely wrong passphrase is still a passphrase error.
    assert_eq!(
        decrypt_with_limit(&heavy, "错误", 20).unwrap_err().code,
        "SYNC_PASSPHRASE"
    );
}
