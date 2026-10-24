use std::time::Duration;

use thingary_lib::sync::{
    engine::{decide, DecisionInput, SyncDecision},
    manifest::Manifest,
    state::{ConfigStore, PassphraseSession, PendingPush, SyncConfig},
};

fn manifest(version: u64, schema_version: u32) -> Manifest {
    Manifest {
        format: 1,
        library_id: "2f2e52d3-00bb-4f93-bba4-ad9f62f34211".into(),
        version,
        snapshot: format!("snapshots/20261023T12000{version}Z-device.thingary.age"),
        snapshot_sha256: "a".repeat(64),
        snapshot_bytes: 123,
        schema_version,
        app_version: "0.0.9".into(),
        device_id: "device-id".into(),
        device_name: "虚构设备".into(),
        created_at: "2026-10-23T12:00:00Z".into(),
    }
}

#[test]
fn state_machine_covers_ordinary_first_connection_and_schema_branches() {
    let cases = [
        (false, false, SyncDecision::UpToDate),
        (true, false, SyncDecision::Push),
        (false, true, SyncDecision::Pull),
        (true, true, SyncDecision::Conflict),
    ];
    for (local_changed, remote_changed, expected) in cases {
        assert_eq!(
            decide(&DecisionInput {
                configured: true,
                local_changed,
                remote_changed,
                local_empty: false,
                remote: Some(manifest(2, 44)),
                local_schema: 44,
                has_sync_baseline: true,
            })
            .unwrap(),
            expected
        );
    }

    assert_eq!(
        decide(&DecisionInput {
            configured: true,
            local_changed: true,
            remote_changed: false,
            local_empty: false,
            remote: None,
            local_schema: 44,
            has_sync_baseline: false,
        })
        .unwrap(),
        SyncDecision::EmptyRemote
    );
    assert_eq!(
        decide(&DecisionInput {
            configured: true,
            local_changed: false,
            remote_changed: true,
            local_empty: true,
            remote: Some(manifest(1, 44)),
            local_schema: 44,
            has_sync_baseline: false,
        })
        .unwrap(),
        SyncDecision::Pull
    );
    assert_eq!(
        decide(&DecisionInput {
            configured: true,
            local_changed: true,
            remote_changed: true,
            local_empty: false,
            remote: Some(manifest(1, 44)),
            local_schema: 44,
            has_sync_baseline: false,
        })
        .unwrap(),
        SyncDecision::Conflict
    );

    let error = decide(&DecisionInput {
        configured: true,
        local_changed: false,
        remote_changed: true,
        local_empty: true,
        remote: Some(manifest(1, 45)),
        local_schema: 44,
        has_sync_baseline: false,
    })
    .unwrap_err();
    assert_eq!(error.code, "SYNC_SCHEMA_NEWER");
}

#[test]
fn sync_json_keeps_secrets_private_and_persists_unknown_push_evidence() {
    let temp = tempfile::tempdir().unwrap();
    let store = ConfigStore::new(temp.path().to_path_buf());
    let pending_manifest = manifest(8, 44);
    let config = SyncConfig {
        enabled: true,
        base_url: "https://dav.example.test/root".into(),
        username: "fictional-user".into(),
        password: "application-password".into(),
        base_path: "backup".into(),
        library_id: Some(pending_manifest.library_id.clone()),
        device_id: "device-id".into(),
        device_name: "测试电脑".into(),
        last_synced_remote_version: Some(7),
        last_synced_fingerprint: Some("b".repeat(64)),
        last_synced_at: Some("2026-10-23T11:00:00Z".into()),
        pending_push: Some(PendingPush {
            previous_remote_version: 7,
            manifest: pending_manifest,
            fingerprint: "c".repeat(64),
        }),
        remembered_passphrase: Some("fictional-passphrase".into()),
        auto_check: true,
    };
    store.save(&config).unwrap();

    let loaded = store.load().unwrap();
    assert_eq!(loaded, config);
    assert!(loaded.public_view().has_password);
    let public_json = serde_json::to_string(&loaded.public_view()).unwrap();
    assert!(!public_json.contains("application-password"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(store.path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn passphrase_session_expires_without_persisting_the_secret() {
    let session = PassphraseSession::with_ttl(Duration::from_millis(30));
    session.unlock("虚构同步口令".into()).unwrap();
    assert_eq!(session.get().unwrap(), "虚构同步口令");
    std::thread::sleep(Duration::from_millis(45));
    let error = session.get().unwrap_err();
    assert_eq!(error.code, "SYNC_LOCKED");
}
