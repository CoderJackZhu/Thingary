use std::collections::BTreeMap;
use thingary_lib::{financial_import::*, storage::Store};
fn batch(s: &Store) -> BatchInput {
    BatchInput {
        generation: s.generation(),
        source_name: "虚构历史".into(),
        mapping_set_id: "第一组".into(),
        files: vec![
            FileInput {
                kind: "accounts".into(),
                name: "账户.csv".into(),
                csv_text: include_str!("../src/financial_import_parser/samples/accounts.csv")
                    .into(),
                column_mapping: BTreeMap::new(),
            },
            FileInput {
                kind: "snapshots".into(),
                name: "盘点.csv".into(),
                csv_text: include_str!("../src/financial_import_parser/samples/snapshots.csv")
                    .into(),
                column_mapping: BTreeMap::new(),
            },
        ],
        mappings: BTreeMap::new(),
        actions: BTreeMap::new(),
        page: 0,
    }
}
fn commit_input(s: &Store, batch: BatchInput) -> CommitInput {
    let p = s
        .financial_import_preview(&batch, "2026-10-09", &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    CommitInput {
        request_id: uuid::Uuid::new_v4().to_string(),
        batch,
        context_digest: p.context_digest,
        normalized_digest: p.normalized_digest,
        file_fingerprints: p.file_fingerprints,
    }
}
#[test]
fn sample_24_months_atomic_replay_and_backup_roundtrip() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let b = batch(&s);
    let input = commit_input(&s, b);
    assert!(s.wealth_accounts().unwrap().is_empty());
    let receipt = s.financial_import_commit(&input, "2026-10-09").unwrap();
    assert_eq!(receipt.counts.created_accounts, 6);
    assert_eq!(receipt.counts.created_snapshots, 24);
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .request_id,
        receipt.request_id
    );
    let mut retry = input.clone();
    retry.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        s.financial_import_commit(&retry, "2026-10-09")
            .unwrap()
            .request_id,
        receipt.request_id
    );
    assert_eq!(s.wealth_summary().unwrap().points.len(), 24);
    let archive = tmp.path().join("虚构完整备份.thingary");
    s.backup(Some(&archive)).unwrap();
    drop(s);
    let mut s = Store::open(tmp.path()).unwrap();
    assert_eq!(
        s.financial_import_receipt(&input.request_id, &s.generation())
            .unwrap()
            .unwrap()
            .objects
            .len(),
        30
    );
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    let gen = s.generation();
    s.restore(&archive, &hash, &gen).unwrap();
    assert_eq!(
        s.financial_import_receipt(&retry.request_id, &s.generation())
            .unwrap()
            .unwrap()
            .request_id,
        receipt.request_id
    );
    assert_eq!(s.wealth_summary().unwrap().points.len(), 24);
}
#[test]
fn closing_balance_and_missing_rows_cannot_be_bypassed() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Store::open(tmp.path()).unwrap();
    let mut b = batch(&s);
    b.files[1].csv_text = b.files[1]
        .csv_text
        .replace("2025-12-31,acc_card,0.00", "2025-12-31,acc_card,1250.00");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    assert!(p.issues.iter().any(|i| i.code == "ACCOUNT_CLOSE_BALANCE"));
    let mut b = batch(&s);
    b.files[1].csv_text = b.files[1]
        .csv_text
        .replace("2024-09-30,acc_cash,", "2024-09-30,acc_unknown,");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    assert!(p.issues.iter().any(|i| i.code == "ACCOUNT_UNMAPPED"));
    assert!(s.wealth_accounts().unwrap().is_empty());
}
#[cfg(feature = "fault-injection")]
#[test]
fn failed_snapshot_rolls_back_accounts_mapping_receipt_and_can_retry() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let input = commit_input(&s, batch(&s));
    s.set_hook(|p| {
        if p == "financial_import.after_accounts" {
            Err(thingary_lib::domain::Error::new(
                "INJECTED",
                "新账户后盘点失败",
            ))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "INJECTED"
    );
    assert!(s.wealth_accounts().unwrap().is_empty());
    assert!(s
        .financial_import_receipt(&input.request_id, &s.generation())
        .unwrap()
        .is_none());
    for table in [
        "import_external_key",
        "import_receipt",
        "feature_requests",
        "fin_snapshots",
    ] {
        assert_eq!(
            s.conn_for_test()
                .unwrap()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    s.set_hook(|_| Ok(()));
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .counts
            .created_snapshots,
        24
    );
}
fn simple(s: &Store) -> BatchInput {
    BatchInput { generation:s.generation(),source_name:"虚构单账户".into(),mapping_set_id:"稳定映射".into(),files:vec![
        FileInput{kind:"accounts".into(),name:"账户.csv".into(),csv_text:"account_key,name,kind,enabled_from,disabled_from,counted,platform,note\na,虚构投资,mixed,2024-01-01,,true,,\n".into(),column_mapping:BTreeMap::new()},
        FileInput{kind:"snapshots".into(),name:"盘点.csv".into(),csv_text:"snapshot_key,date,account_key,amount,note,kind_at_date,counted_at_date\ns,2024-01-31,a,123.45,虚构历史,fund,false\n".into(),column_mapping:BTreeMap::new()}
    ],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0}
}
#[test]
fn explicit_history_overrides_direction_and_ordinary_correction() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let input = commit_input(&s, simple(&s));
    let receipt = s.financial_import_commit(&input, "2026-10-09").unwrap();
    let sid = &receipt
        .objects
        .iter()
        .find(|r| r.kind == "snapshot")
        .unwrap()
        .id;
    let snapshot = s.wealth_snapshot(sid).unwrap().unwrap();
    assert_eq!(snapshot.entries[0].kind, "fund");
    assert!(!snapshot.entries[0].counted);
    assert_eq!(snapshot.entries[0].amount_cents.as_deref(), Some("12345"));
    let a = &s.wealth_accounts().unwrap()[0];
    assert_eq!(a.fields.kind, "mixed");
    assert!(a.fields.counted);
    let ordinary = thingary_lib::wealth::SnapshotSave {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        id: Some(sid.clone()),
        expected_revision: Some(snapshot.revision),
        date: snapshot.date,
        notes: "普通更正".into(),
        entries: vec![thingary_lib::wealth::EntryInput {
            account_id: a.id.clone(),
            state: "entered".into(),
            amount_cents: Some("12400".into()),
        }],
    };
    let corrected = s.wealth_snapshot_save(&ordinary, "2026-10-09").unwrap();
    assert_eq!(corrected.entries[0].kind, "fund");
    assert!(!corrected.entries[0].counted);
    let mut bad = simple(&s);
    bad.files[1].csv_text = bad.files[1].csv_text.replace(",fund,false", ",loan,false");
    let p = s
        .financial_import_preview(&bad, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    assert!(p
        .issues
        .iter()
        .any(|i| i.code == "HISTORY_KIND_SIDE" && i.source_row == Some(2)));
}
#[test]
fn conflict_is_whole_group_and_preview_revisions_include_skipped_accounts() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let initial = commit_input(&s, simple(&s));
    s.financial_import_commit(&initial, "2026-10-09").unwrap();
    let mut b = simple(&s);
    b.files[1].csv_text = b.files[1].csv_text.replace("123.45", "200.00");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    let conflict = p.objects.iter().find(|o| o.kind == "snapshot").unwrap();
    assert_eq!(conflict.status, "conflict");
    assert_ne!(conflict.before.as_ref(), Some(&conflict.after));
    b.actions.insert(
        conflict.key.clone(),
        Action {
            action: "correct".into(),
            expected_revision: conflict.expected_revision,
        },
    );
    let input = commit_input(&s, b);
    let a = s.wealth_accounts().unwrap().remove(0);
    s.wealth_account_save(
        &thingary_lib::wealth::AccountSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: Some(a.id),
            expected_revision: Some(a.revision),
            fields: thingary_lib::wealth::AccountFields {
                notes: "预览后修改".into(),
                ..a.fields
            },
        },
        "2026-10-09",
    )
    .unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    assert!(s
        .financial_import_receipt(&input.request_id, &s.generation())
        .unwrap()
        .is_none());
    assert_eq!(s.wealth_summary().unwrap().points[0].net_cents, "0");
}
#[test]
fn real_unkeyed_catalog_blank_zero_and_explicit_group_exclusion() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let b = simple(&s);
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(p.can_commit);
    s.wealth_account_save(
        &thingary_lib::wealth::AccountSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: thingary_lib::wealth::AccountFields {
                name: "未带外部键的真实账户".into(),
                institution: "虚构".into(),
                side: "asset".into(),
                kind: "cash".into(),
                counted: false,
                opened_on: "2024-01-01".into(),
                closed_on: None,
                notes: String::new(),
            },
        },
        "2026-10-09",
    )
    .unwrap();
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    assert!(p
        .issues
        .iter()
        .any(|i| i.code == "SNAPSHOT_MISSING_ACCOUNT" || i.code == "SNAPSHOT_INCOMPLETE_ROWS"));
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files[1].csv_text = b.files[1].csv_text.replace("123.45", "");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    assert!(p.issues.iter().any(|i| i.code == "AMOUNT_REQUIRED"));
    b.actions.insert(
        "snapshot:s".into(),
        Action {
            action: "exclude".into(),
            expected_revision: None,
        },
    );
    let input = commit_input(&s, b);
    let r = s.financial_import_commit(&input, "2026-10-09").unwrap();
    assert_eq!(r.counts.created_accounts, 1);
    assert_eq!(r.counts.created_snapshots, 0);
    assert!(s.wealth_summary().unwrap().points.is_empty());
}
#[cfg(feature = "fault-injection")]
#[test]
fn lost_reply_restart_preserves_original_receipt_and_no_duplicates() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let input = commit_input(&s, simple(&s));
    s.set_hook(|p| {
        if p == "financial_import.after_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "回执丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "INJECTED"
    );
    drop(s);
    let mut s = Store::open(tmp.path()).unwrap();
    let r = s
        .financial_import_receipt(&input.request_id, &s.generation())
        .unwrap()
        .unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .request_id,
        r.request_id
    );
    assert_eq!(s.wealth_accounts().unwrap().len(), 1);
    assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
    let mut changed = input;
    changed.batch.source_name = "另一个来源".into();
    assert_eq!(
        s.financial_import_commit(&changed, "2026-10-09")
            .unwrap_err()
            .code,
        "REQUEST_CONFLICT"
    );
}
#[test]
fn dataset_and_module_changes_refuse_outstanding_preview() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(&tmp.path().join("library")).unwrap();
    let input = commit_input(&s, simple(&s));
    let archive = tmp.path().join("旧预览.thingary");
    s.backup(Some(&archive)).unwrap();
    let hash = thingary_lib::backup::archive_hash(&archive).unwrap();
    s.restore(&archive, &hash, &s.generation()).unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "STALE_DATASET"
    );
    let input = commit_input(&s, simple(&s));
    std::fs::write(tmp.path().join("modules.json"), r#"{"wealth":false}"#).unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "MODULE_DISABLED"
    );
    // Even when restored to the same enabled contents, switching the module
    // invalidates a preview that belonged to its previous configuration.
    std::fs::write(tmp.path().join("modules.json"), r#"{"wealth":true}"#).unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    assert!(s.wealth_accounts().unwrap().is_empty());
}
#[test]
fn schema_33_upgrade_and_failure_rollback_keep_old_facts() {
    use thingary_lib::storage::{migrate, migrate_to, SCHEMA, SCHEMA_VERSION};
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 33, &|_| Ok(())).unwrap();
    let old_id = uuid::Uuid::new_v4().to_string();
    db.execute("INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES(?1,'虚构旧资料',NULL,NULL,1)",[&old_id]).unwrap();

    let tables = |db: &rusqlite::Connection| {
        db.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('import_external_key','import_receipt','import_external_object')",[],|r|r.get::<_,i64>(0)).unwrap()
    };
    assert!(migrate(&db, &|_| Err(thingary_lib::domain::Error::new(
        "INJECTED",
        "迁移回滚"
    )))
    .is_err());
    assert_eq!(tables(&db), 0);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        33
    );
    assert_eq!(
        db.query_row("SELECT name FROM assets WHERE id=?1", [&old_id], |r| r
            .get::<_, String>(
            0
        ))
        .unwrap(),
        "虚构旧资料"
    );
    migrate(&db, &|_| Ok(())).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT price_cents FROM assets WHERE id=?1",
            [&old_id],
            |r| r.get::<_, Option<i64>>(0)
        )
        .unwrap(),
        None
    );
    assert_eq!(tables(&db), 3);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
}
#[test]
fn old_schema_33_backup_restores_ids_unknowns_and_upgrades_import_tables() {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let tmp = tempfile::tempdir().unwrap();
    let mut source = Store::open(&tmp.path().join("source")).unwrap();
    let b = simple(&source);
    let input = commit_input(&source, b);
    let r = source
        .financial_import_commit(&input, "2026-10-09")
        .unwrap();
    let sid = r
        .objects
        .iter()
        .find(|o| o.kind == "snapshot")
        .unwrap()
        .id
        .clone();
    let a = source.wealth_accounts().unwrap().remove(0);
    let snap = source.wealth_snapshot(&sid).unwrap().unwrap();
    source
        .wealth_snapshot_save(
            &thingary_lib::wealth::SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: source.generation(),
                id: Some(sid.clone()),
                expected_revision: Some(snap.revision),
                date: snap.date,
                notes: "虚构旧未知".into(),
                entries: vec![thingary_lib::wealth::EntryInput {
                    account_id: a.id.clone(),
                    state: "missing".into(),
                    amount_cents: None,
                }],
            },
            "2026-10-09",
        )
        .unwrap();
    let old_db = tmp.path().join("old33.sqlite");
    let mut db = rusqlite::Connection::open(&old_db).unwrap();
    rusqlite::backup::Backup::new(source.conn_for_test().unwrap(), &mut db)
        .unwrap()
        .run_to_completion(128, std::time::Duration::from_millis(1), None)
        .unwrap();
    db.execute_batch(
        "DROP TABLE import_receipt; DROP TABLE import_external_key; DROP TABLE plan_income;",
    )
    .unwrap();
    db.execute_batch(
        include_str!("../src/plan_income.sql")
            .split("-- A check-in")
            .next()
            .unwrap(),
    )
    .unwrap();
    db.execute_batch("PRAGMA user_version=33;").unwrap();
    drop(db);
    let bytes = std::fs::read(&old_db).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":33,"created_at":"2026-10-09T08:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let archive = tmp.path().join("虚构旧版备份.thingary");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("manifest.json", options).unwrap();
    zip.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    zip.start_file("data.sqlite", options).unwrap();
    zip.write_all(&bytes).unwrap();
    zip.finish().unwrap();
    let mut target = Store::open(&tmp.path().join("target")).unwrap();
    let inspected = target.inspect_backup(&archive).unwrap();
    assert_eq!(inspected.schema, 33);
    assert_eq!(
        (inspected.import_mappings, inspected.import_receipts),
        (0, 0)
    );
    target
        .restore(&archive, &inspected.hash, &target.generation())
        .unwrap();
    assert_eq!(target.wealth_accounts().unwrap()[0].id, a.id);
    assert_eq!(
        target.wealth_snapshot(&sid).unwrap().unwrap().entries[0].amount_cents,
        None
    );
    assert_eq!(
        target
            .conn_for_test()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        thingary_lib::storage::SCHEMA_VERSION
    );
    drop(target);
    let target = Store::open(&tmp.path().join("target")).unwrap();
    assert_eq!(
        target.wealth_snapshot(&sid).unwrap().unwrap().entries[0].amount_cents,
        None
    );
}
#[test]
fn permanent_purge_tombstones_keys_and_preserves_receipt_without_name_rebinding() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files.retain(|f| f.kind == "accounts");
    let input = commit_input(&s, b.clone());
    let r = s.financial_import_commit(&input, "2026-10-09").unwrap();
    let id = &r.objects[0].id;
    s.wealth_trash(&thingary_lib::wealth::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: "account".into(),
        id: id.clone(),
        expected_revision: 1,
        deleted: true,
    })
    .unwrap();
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("account".into()),
        id: id.clone(),
        preview: None,
    })
    .unwrap();
    assert!(s.wealth_accounts().unwrap().is_empty());
    assert_eq!(
        s.conn_for_test()
            .unwrap()
            .query_row(
                "SELECT status FROM import_external_key WHERE object_id=?1",
                [id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "purged"
    );
    assert!(s
        .financial_import_receipt(&input.request_id, &s.generation())
        .unwrap()
        .is_some());
    b.files[0].csv_text = b.files[0]
        .csv_text
        .replace("虚构投资", "虚构投资（同名候选）");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!p.can_commit);
    assert!(p.issues.iter().any(|i| i.code == "IMPORT_TOMBSTONE"));
    let archive = tmp.path().join("墓碑.thingary");
    s.backup(Some(&archive)).unwrap();
    s.inspect_backup(&archive).unwrap();
}
#[test]
fn limits_are_aggregate_and_cancel_does_not_write() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files[0].csv_text = " ".repeat(10 * 1024 * 1024 + 1);
    b.files[1].csv_text = " ".repeat(10 * 1024 * 1024);
    assert_eq!(
        s.financial_import_preview(&b, "2026-10-09", &|| false)
            .unwrap_err()
            .code,
        "LIMIT_SIZE"
    );
    assert_eq!(
        s.financial_import_preview(&simple(&s), "2026-10-09", &|| true)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
    assert!(s.wealth_accounts().unwrap().is_empty());
}
#[test]
#[ignore = "capacity measurement: run separately with /usr/bin/time -l"]
fn maximum_20_mib_50000_rows_and_cancellation_latency() {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };
    let tmp = tempfile::tempdir().unwrap();
    let s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files[0].csv_text="account_key,name,kind,enabled_from,disabled_from,counted,platform,note\na,虚构甲,cash,1900-01-01,,true,,\nb,虚构乙,cash,1900-01-01,,true,,\n".into();
    b.files[1].csv_text =
        "snapshot_key,date,account_key,amount,note,kind_at_date,counted_at_date,extra\n".into();
    let note = "x".repeat(300);
    for i in 0..24999 {
        let day = chrono::NaiveDate::from_ymd_opt(1900, 1, 1).unwrap() + chrono::Duration::days(i);
        for key in ["a", "b"] {
            b.files[1]
                .csv_text
                .push_str(&format!("s{i},{day},{key},0,{note},,,,\n"));
        }
    }
    // Remove one excess separator so the extra column is a single ignored cell.
    b.files[1].csv_text = b.files[1].csv_text.replace(",,,,\n", ",,,\n");
    let bytes = b.files.iter().map(|f| f.csv_text.len()).sum::<usize>();
    let pad = thingary_lib::financial_import_parser::MAX_BYTES - bytes;
    b.files[1].csv_text.pop();
    b.files[1].csv_text.push_str(&"z".repeat(pad));
    b.files[1].csv_text.push('\n');
    assert_eq!(
        b.files.iter().map(|f| f.csv_text.len()).sum::<usize>(),
        20 * 1024 * 1024
    );
    let flag = Arc::new(AtomicBool::new(false));
    let other = flag.clone();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        other.store(true, Ordering::Release);
        Instant::now()
    });
    let start = Instant::now();
    let err = s
        .financial_import_preview(&b, "2026-10-09", &|| flag.load(Ordering::Acquire))
        .unwrap_err();
    let completed = Instant::now();
    let cancelled_at = thread.join().unwrap();
    assert_eq!(err.code, "CANCELLED");
    let latency = completed.saturating_duration_since(cancelled_at);
    assert!(latency < Duration::from_millis(250), "{latency:?}");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    assert_eq!(p.total, 25001);
    assert_eq!(p.objects.len(), 50);
    assert_eq!(p.counts.new_snapshots, 24999);
    println!(
        "capacity bytes=20971520 rows=50000 elapsed={:?} cancellation={:?}",
        start.elapsed(),
        latency
    );
    assert!(s.wealth_accounts().unwrap().is_empty());
}
#[test]
fn snapshots_only_exposes_unmapped_keys_for_explicit_selection() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files.retain(|f| f.kind == "snapshots");
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert_eq!(p.referenced_keys, vec!["a"]);
    assert!(!p.can_commit);
}
#[test]
#[ignore = "capacity measurement: run separately with /usr/bin/time -l"]
fn maximum_50000_accounts_capacity() {
    let tmp = tempfile::tempdir().unwrap();
    let s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files.retain(|f| f.kind == "accounts");
    let mut csv = "account_key,name,kind,enabled_from,disabled_from,counted,platform,note,extra\n"
        .to_string();
    let note = "x".repeat(300);
    for i in 0..50000 {
        csv.push_str(&format!("a{i},虚构{i},cash,2024-01-01,,true,,{note},\n"));
    }
    let pad = thingary_lib::financial_import_parser::MAX_BYTES - csv.len();
    csv.pop();
    csv.push_str(&"z".repeat(pad));
    csv.push('\n');
    b.files[0].csv_text = csv;
    let start = std::time::Instant::now();
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    assert_eq!(p.total, 50000);
    assert_eq!(p.objects.len(), 50);
    println!(
        "50000 accounts bytes=20971520 elapsed={:?}",
        start.elapsed()
    );
}

#[test]
#[ignore = "capacity measurement: populated directory and repeat import"]
fn maximum_populated_accounts_reimport_and_cancel() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files.retain(|f| f.kind == "accounts");
    b.files[0].csv_text =
        "account_key,name,kind,enabled_from,disabled_from,counted,platform,note\n".into();
    for i in 0..50000 {
        b.files[0]
            .csv_text
            .push_str(&format!("a{i},虚构{i},cash,2024-01-01,,true,,\n"));
    }
    let input = commit_input(&s, b.clone());
    s.financial_import_commit(&input, "2026-10-09").unwrap();
    let start = std::time::Instant::now();
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert_eq!(p.counts.same, 50000);
    assert_eq!(p.objects.len(), 50);
    println!("populated 50000 repeat elapsed={:?}", start.elapsed());
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let signal = flag.clone();
    let timer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(50));
        signal.store(true, std::sync::atomic::Ordering::Release);
        std::time::Instant::now()
    });
    let result = s.financial_import_preview(&b, "2026-10-09", &|| {
        flag.load(std::sync::atomic::Ordering::Acquire)
    });
    let latency = timer.join().unwrap().elapsed();
    assert_eq!(result.unwrap_err().code, "CANCELLED");
    println!("populated 50000 cancellation latency={latency:?}");
    assert!(latency < std::time::Duration::from_secs(1));
}

#[test]
fn deleted_receipt_reimport_behavior() {
    for purged in [false, true] {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::open(tmp.path()).unwrap();
        let mut b = simple(&s);
        b.files.retain(|f| f.kind == "accounts");
        let input = commit_input(&s, b.clone());
        let r = s.financial_import_commit(&input, "2026-10-09").unwrap();
        let id = r.objects[0].id.clone();
        s.wealth_trash(&thingary_lib::wealth::TrashChange {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            kind: "account".into(),
            id: id.clone(),
            expected_revision: 1,
            deleted: true,
        })
        .unwrap();
        if purged {
            s.purge_trash(&thingary_lib::purge::Purge {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                kind: Some("account".into()),
                id: id.clone(),
                preview: None,
            })
            .unwrap();
        }
        let p = s
            .financial_import_preview(&b, "2026-10-09", &|| false)
            .unwrap();
        let mut retry = input.clone();
        retry.request_id = uuid::Uuid::new_v4().to_string();
        let result = s.financial_import_commit(&retry, "2026-10-09").unwrap();
        assert!(!p.can_commit);
        assert_eq!(p.prior_receipt.as_ref().unwrap().unavailable_objects, 1);
        assert_eq!(result.unavailable_objects, 1);
        assert_eq!(
            s.financial_import_commit(&input, "2026-10-09")
                .unwrap()
                .unavailable_objects,
            1
        );
        assert_eq!(
            s.financial_import_receipt(&retry.request_id, &s.generation())
                .unwrap()
                .unwrap()
                .unavailable_objects,
            1
        );
        // Availability is not stored or added to the historical receipt.
        let raw: String = s
            .conn_for_test()
            .unwrap()
            .query_row(
                "SELECT result_json FROM import_receipt WHERE request_id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!raw.contains("unavailable_objects"));
        assert_eq!(result.request_id, r.request_id);
        assert!(s.wealth_accounts().unwrap().is_empty());
        drop(s);
        let mut s = Store::open(tmp.path()).unwrap();
        assert_eq!(
            s.financial_import_receipt(&retry.request_id, &s.generation())
                .unwrap()
                .unwrap()
                .unavailable_objects,
            1
        );
        if !purged {
            s.wealth_trash(&thingary_lib::wealth::TrashChange {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                kind: "account".into(),
                id: id.clone(),
                expected_revision: 2,
                deleted: false,
            })
            .unwrap();
            assert_eq!(
                s.financial_import_receipt(&input.request_id, &s.generation())
                    .unwrap()
                    .unwrap()
                    .unavailable_objects,
                0
            );
            assert_eq!(s.wealth_accounts().unwrap().len(), 1);
        }
        // Another mapping set is a new batch; never rebind the old key.
        b.generation = s.generation();
        b.mapping_set_id = "另一个映射集合".into();
        let fresh = commit_input(&s, b);
        let new = s.financial_import_commit(&fresh, "2026-10-09").unwrap();
        assert_ne!(new.objects[0].id, id);
        assert_eq!(new.unavailable_objects, 0);
        assert_eq!(
            s.wealth_accounts().unwrap().len(),
            if purged { 1 } else { 2 }
        );
    }
}

#[test]
fn snapshot_receipt_availability_is_current_after_delete_and_purge() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let input = commit_input(&s, simple(&s));
    let r = s.financial_import_commit(&input, "2026-10-09").unwrap();
    let id = r
        .objects
        .iter()
        .find(|o| o.kind == "snapshot")
        .unwrap()
        .id
        .clone();
    s.wealth_trash(&thingary_lib::wealth::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: "snapshot".into(),
        id: id.clone(),
        expected_revision: 1,
        deleted: true,
    })
    .unwrap();
    assert_eq!(
        s.financial_import_receipt(&input.request_id, &s.generation())
            .unwrap()
            .unwrap()
            .unavailable_objects,
        1
    );
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("snapshot".into()),
        id,
        preview: None,
    })
    .unwrap();
    assert_eq!(
        s.financial_import_preview(&input.batch, "2026-10-09", &|| false)
            .unwrap()
            .prior_receipt
            .unwrap()
            .unavailable_objects,
        1
    );
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .unavailable_objects,
        1
    );
}

fn income_batch(s: &Store, text: &str) -> BatchInput {
    let mut b = simple(s);
    b.files = vec![FileInput {
        kind: "incomes".into(),
        name: "虚构中文收入.csv".into(),
        csv_text: text.into(),
        column_mapping: BTreeMap::new(),
    }];
    b
}
const INCOME_CSV: &str = "\u{feff}income_key,date,net_income,hpf_deposit,note\r\nu,2026-08-10,100.01,,\"虚构，备注\n第二行\"\r\nz,2026-08-10,100.01,0,明确零\r\n";
#[test]
fn i02_i03_income_unknown_zero_same_day_same_amount_and_i11_roundtrip() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("source");
    let mut s = Store::open(&root).unwrap();
    let b = income_batch(&s, INCOME_CSV);
    let input = commit_input(&s, b.clone());
    let r = s.financial_import_commit(&input, "2026-10-09").unwrap();
    assert_eq!(r.counts.created_incomes, 2);
    let rows = s.plan_income_list().unwrap().rows;
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|i| i.fields.net_cents == "10001"));
    assert!(rows
        .iter()
        .any(|i| i.fields.hpf_cents.is_none() && i.fields.notes == "虚构，备注\n第二行"));
    assert!(rows
        .iter()
        .any(|i| i.fields.hpf_cents.as_deref() == Some("0")));
    let prior = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert!(!prior.can_commit);
    assert_eq!(prior.prior_receipt.unwrap().counts.created_incomes, 2);
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .request_id,
        r.request_id
    );
    // Different bytes with the same keys and values skip both, never add rows.
    let same = income_batch(&s, &INCOME_CSV.replace("\r\n", "\n"));
    let same = commit_input(&s, same);
    assert_eq!(
        s.financial_import_commit(&same, "2026-10-09")
            .unwrap()
            .counts
            .skipped,
        2
    );
    let archive = tmp.path().join("虚构35.thingary");
    s.backup(Some(&archive)).unwrap();
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.plan_income_list().unwrap().rows.len(), 2);
    let mut t = Store::open(&tmp.path().join("restored")).unwrap();
    let checked = t.inspect_backup(&archive).unwrap();
    assert_eq!(
        (
            checked.schema,
            checked.import_mappings,
            checked.import_receipts
        ),
        (35, 2, 2)
    );
    t.restore(&archive, &checked.hash, &t.generation()).unwrap();
    assert_eq!(
        serde_json::to_value(t.plan_income_list().unwrap().rows).unwrap(),
        serde_json::to_value(rows).unwrap()
    );
    assert_eq!(
        t.financial_import_receipt(&r.request_id, &t.generation())
            .unwrap()
            .unwrap()
            .counts
            .created_incomes,
        2
    );
    let mut b = b;
    b.generation = t.generation();
    assert!(
        !t.financial_import_preview(&b, "2026-10-09", &|| false)
            .unwrap()
            .can_commit
    );
}
#[test]
fn income_conflicts_stale_revisions_and_deleted_receipts_preserve_identity() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let input = commit_input(&s, income_batch(&s, INCOME_CSV));
    let receipt = s.financial_import_commit(&input, "2026-10-09").unwrap();
    let mut b = income_batch(&s, &INCOME_CSV.replace("100.01,,", "100.01,0,"));
    let p = s
        .financial_import_preview(&b, "2026-10-09", &|| false)
        .unwrap();
    assert_eq!(
        (p.counts.conflicts, p.counts.same, p.can_commit),
        (1, 1, false)
    );
    let conflict = p.objects.iter().find(|o| o.status == "conflict").unwrap();
    assert!(conflict.before.as_ref().unwrap()["hpf_cents"].is_null());
    assert_eq!(conflict.after["hpf_cents"], "0");
    b.actions.insert(
        conflict.key.clone(),
        Action {
            action: "correct".into(),
            expected_revision: conflict.expected_revision,
        },
    );
    let correction = commit_input(&s, b);
    let i = s.plan_income(&conflict.id).unwrap().unwrap();
    let mut f = i.fields;
    f.notes = "虚构并发修改".into();
    s.plan_income_save(
        &thingary_lib::plan_income::Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: Some(i.id.clone()),
            expected_revision: Some(i.revision),
            fields: f,
        },
        "2026-10-09",
    )
    .unwrap();
    assert_eq!(
        s.financial_import_commit(&correction, "2026-10-09")
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    let p = s
        .financial_import_preview(&correction.batch, "2026-10-09", &|| false)
        .unwrap_err();
    assert_eq!(p.code, "REVISION_CONFLICT");
    s.wealth_trash(&thingary_lib::wealth::TrashChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: "income".into(),
        id: i.id.clone(),
        expected_revision: 2,
        deleted: true,
    })
    .unwrap();
    assert_eq!(
        s.financial_import_receipt(&receipt.request_id, &s.generation())
            .unwrap()
            .unwrap()
            .unavailable_objects,
        1
    );
    s.purge_trash(&thingary_lib::purge::Purge {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        kind: Some("income".into()),
        id: i.id.clone(),
        preview: None,
    })
    .unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .unavailable_objects,
        1
    );
    let status: String = s
        .conn_for_test()
        .unwrap()
        .query_row(
            "SELECT status FROM import_external_key WHERE object_id=?1",
            [i.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "purged");
    assert_eq!(s.plan_income_list().unwrap().rows.len(), 1);
}
#[test]
fn i07_income_invalid_row_blocks_all_writes_and_cancel_is_read_only() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    for bad in [
        "bad,2026-02-30,2,0,x",
        "bad,2026-08-10,1e3,0,x",
        "bad,2026-08-10,1.001,0,x",
        "bad,2026-08-10,,0,x",
        "bad,2026-08-10,1,-1,x",
    ] {
        let b = income_batch(&s, &format!("{INCOME_CSV}{bad}\n"));
        let p = s
            .financial_import_preview(&b, "2026-10-09", &|| false)
            .unwrap();
        assert!(!p.can_commit);
        assert!(p
            .issues
            .iter()
            .any(|i| i.blocking && i.source_row.is_some()));
        let input = CommitInput {
            request_id: uuid::Uuid::new_v4().to_string(),
            batch: b,
            context_digest: p.context_digest,
            normalized_digest: p.normalized_digest,
            file_fingerprints: p.file_fingerprints,
        };
        assert_eq!(
            s.financial_import_commit(&input, "2026-10-09")
                .unwrap_err()
                .code,
            "IMPORT_INVALID"
        );
        assert!(s.plan_income_list().unwrap().rows.is_empty());
    }
    assert_eq!(
        s.financial_import_preview(&income_batch(&s, INCOME_CSV), "2026-10-09", &|| true)
            .unwrap_err()
            .code,
        "CANCELLED"
    );
}
#[test]
fn mixed_batch_rolls_back_after_accounts_after_incomes_and_before_commit_i09_restart() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(tmp.path()).unwrap();
    let mut b = simple(&s);
    b.files.extend(income_batch(&s, INCOME_CSV).files);
    let input = commit_input(&s, b);
    for fail in [
        "financial_import.after_accounts",
        "financial_import.after_incomes",
        "financial_import.before_commit",
    ] {
        s.set_hook(move |p| {
            if p == fail {
                Err(thingary_lib::domain::Error::new("INJECTED", fail))
            } else {
                Ok(())
            }
        });
        assert_eq!(
            s.financial_import_commit(&input, "2026-10-09")
                .unwrap_err()
                .code,
            "INJECTED"
        );
        for table in [
            "fin_accounts",
            "fin_snapshots",
            "plan_income",
            "import_external_key",
            "import_receipt",
            "feature_requests",
        ] {
            let n: i64 = s
                .conn_for_test()
                .unwrap()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{fail} {table}");
        }
    }
    s.set_hook(|p| {
        if p == "financial_import.after_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "lost reply"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "INJECTED"
    );
    drop(s);
    let mut s = Store::open(tmp.path()).unwrap();
    let r = s
        .financial_import_receipt(&input.request_id, &s.generation())
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            r.counts.created_accounts,
            r.counts.created_snapshots,
            r.counts.created_incomes
        ),
        (1, 1, 2)
    );
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap()
            .request_id,
        r.request_id
    );
    assert_eq!(s.plan_income_list().unwrap().rows.len(), 2);
    let archive = tmp.path().join("mixed35.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&tmp.path().join("restored")).unwrap();
    let checked = restored.inspect_backup(&archive).unwrap();
    assert_eq!(
        (
            checked.schema,
            checked.import_mappings,
            checked.import_receipts
        ),
        (35, 4, 1)
    );
    restored
        .restore(&archive, &checked.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        serde_json::to_value(
            restored
                .financial_import_receipt(&r.request_id, &restored.generation())
                .unwrap()
                .unwrap()
                .objects
        )
        .unwrap(),
        serde_json::to_value(&r.objects).unwrap()
    );
    assert_eq!(restored.plan_income_list().unwrap().rows.len(), 2);
    let kinds: i64 = restored
        .conn_for_test()
        .unwrap()
        .query_row(
            "SELECT count(DISTINCT object_kind) FROM import_external_key",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kinds, 3);
}
#[test]
fn income_only_import_with_wealth_disabled_and_planning_switch_invalidates_preview() {
    use thingary_lib::modules::{self, Modules};
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    let mut s = Store::open(&root).unwrap();
    modules::write(
        &root,
        &Modules {
            wealth: false,
            ..Modules::default()
        },
    )
    .unwrap();
    let input = commit_input(&s, income_batch(&s, INCOME_CSV));
    modules::write(
        &root,
        &Modules {
            wealth: false,
            planning: false,
            ..Modules::default()
        },
    )
    .unwrap();
    assert_eq!(
        s.financial_import_commit(&input, "2026-10-09")
            .unwrap_err()
            .code,
        "MODULE_DISABLED"
    );
    assert!(s.plan_income_list().unwrap().rows.is_empty());
    modules::write(
        &root,
        &Modules {
            wealth: false,
            ..Modules::default()
        },
    )
    .unwrap();
    let input = commit_input(&s, income_batch(&s, INCOME_CSV));
    s.financial_import_commit(&input, "2026-10-09").unwrap();
}

#[test]
fn x11_mid_replacement_failure_preserves_schema34_all_data_and_zero_then_upgrades() {
    use thingary_lib::storage::{migrate_to, SCHEMA};
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 34, &|_| Ok(())).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    db.execute("INSERT INTO plan_income VALUES(?1,'2026-08-01',10001,0,'虚构零缴存',4,'2026-08-01T00:00:00Z','2026-08-02T00:00:00Z','2026-08-03T00:00:00Z')",[&id]).unwrap();
    db.execute("INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES(?1,'虚构旧物品',NULL,NULL,2)",[&id]).unwrap();
    db.execute("INSERT INTO import_external_key VALUES('虚构','旧映射','account','purged-key',?1,?2,3,'purged','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')",rusqlite::params![id,"a".repeat(64)]).unwrap();
    db.execute("INSERT INTO import_receipt VALUES(?1,?2,?3,'虚构','旧映射','{}','2026-08-01T00:00:00Z','committed')",rusqlite::params![id,"b".repeat(64),"c".repeat(64)]).unwrap();
    let all_data = || {
        let mut q = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables = q
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        tables
            .into_iter()
            .map(|name| {
                let mut q = db
                    .prepare(&format!("SELECT * FROM {name} ORDER BY rowid"))
                    .unwrap();
                let columns = q.column_count();
                let rows = q
                    .query_map([], |r| {
                        Ok((0..columns)
                            .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                            .collect::<Vec<_>>())
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                (name, rows)
            })
            .collect::<Vec<_>>()
    };
    let old_all_data = all_data();
    let definitions = || {
        let mut q = db
            .prepare("SELECT type,name,coalesce(sql,'') FROM sqlite_master ORDER BY type,name")
            .unwrap();
        q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };
    let data = || {
        db.query_row("SELECT id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,deleted_at FROM plan_income",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,Option<i64>>(3)?,r.get::<_,String>(4)?,r.get::<_,i64>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,Option<String>>(8)?))).unwrap()
    };
    let old_schema = definitions();
    let old_data = data();
    let error = migrate_to(&db, 35, &|p| {
        if p == "migration.x11.replacing" {
            assert_eq!(
                db.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name='plan_income'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
            Err(thingary_lib::domain::Error::new("INJECTED", "替表中途"))
        } else {
            Ok(())
        }
    })
    .unwrap_err();
    assert_eq!(error.code, "INJECTED");
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        34
    );
    assert_eq!(definitions(), old_schema);
    assert_eq!(all_data(), old_all_data);
    assert_eq!(data(), old_data);
    migrate_to(&db, 35, &|_| Ok(())).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        35
    );
    assert_eq!(data(), old_data);
    assert_eq!(data().3, Some(0));
    db.execute("UPDATE plan_income SET hpf_cents=NULL WHERE id=?1", [id])
        .unwrap();
    assert_eq!(data().3, None);
    println!("x11: mid replacement -> rollback, complete schema and row preserved, version34; retry34->35 preserved zero/IDs/revision/timestamps/deletion");
}
#[test]
fn x11_foreign_key_check_runs_before_commit_and_rolls_back() {
    use thingary_lib::storage::{migrate_to, SCHEMA};
    let db = rusqlite::Connection::open_in_memory().unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 34, &|_| Ok(())).unwrap();
    db.execute_batch(
        "PRAGMA foreign_keys=OFF; INSERT INTO plan_baseline_marks VALUES('missing-snapshot');",
    )
    .unwrap();
    assert_eq!(
        migrate_to(&db, 35, &|_| Ok(())).unwrap_err().code,
        "DATA_CONSTRAINT"
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        34
    );
    let required: i64 = db
        .query_row(
            "SELECT \"notnull\" FROM pragma_table_info('plan_income') WHERE name='hpf_cents'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(required, 1);
}
#[test]
fn old34_backup_and_receipt_restore_into35_preserve_replay_zero_and_mappings() {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(&tmp.path().join("source")).unwrap();
    let input = commit_input(&s, simple(&s));
    let receipt = s.financial_import_commit(&input, "2026-10-09").unwrap();
    let income = s
        .plan_income_save(
            &thingary_lib::plan_income::Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::plan_income::Fields {
                    date: "2026-08-01".into(),
                    net_cents: "10001".into(),
                    hpf_cents: Some("0".into()),
                    notes: "虚构旧零".into(),
                },
            },
            "2026-10-09",
        )
        .unwrap();
    let path = tmp.path().join("old34.sqlite");
    let mut db = rusqlite::Connection::open(&path).unwrap();
    rusqlite::backup::Backup::new(s.conn_for_test().unwrap(), &mut db)
        .unwrap()
        .run_to_completion(128, std::time::Duration::from_millis(1), None)
        .unwrap();
    db.execute_batch("CREATE TEMP TABLE old_income AS SELECT * FROM plan_income; CREATE TEMP TABLE old_keys AS SELECT * FROM import_external_key; CREATE TEMP TABLE old_receipts AS SELECT * FROM import_receipt; DROP TABLE plan_income; DROP TABLE import_external_key; DROP TABLE import_receipt;").unwrap();
    db.execute_batch(
        include_str!("../src/plan_income.sql")
            .split("-- A check-in")
            .next()
            .unwrap(),
    )
    .unwrap();
    db.execute_batch(include_str!("../src/x10.sql")).unwrap();
    db.execute_batch("INSERT INTO plan_income SELECT * FROM old_income; INSERT INTO import_external_key SELECT * FROM old_keys; INSERT INTO import_receipt SELECT * FROM old_receipts;").unwrap();
    drop(db);
    let bytes = std::fs::read(path).unwrap();
    let manifest = serde_json::json!({"format":1,"schema":34,"created_at":"2026-10-09T08:00:00Z","entries":{"data.sqlite":{"size":bytes.len(),"hash":format!("{:x}",Sha256::digest(&bytes))}}});
    let archive = tmp.path().join("虚构旧34备份.thingary");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
    let opt = zip::write::SimpleFileOptions::default();
    zip.start_file("manifest.json", opt).unwrap();
    zip.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    zip.start_file("data.sqlite", opt).unwrap();
    zip.write_all(&bytes).unwrap();
    zip.finish().unwrap();
    let mut t = Store::open(&tmp.path().join("target")).unwrap();
    let checked = t.inspect_backup(&archive).unwrap();
    assert_eq!(
        (
            checked.schema,
            checked.import_mappings,
            checked.import_receipts
        ),
        (34, 2, 1)
    );
    t.restore(&archive, &checked.hash, &t.generation()).unwrap();
    assert_eq!(
        t.conn_for_test()
            .unwrap()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        35
    );
    let old = t
        .financial_import_receipt(&receipt.request_id, &t.generation())
        .unwrap()
        .unwrap();
    assert_eq!((old.counts.created_incomes, old.counts.new_incomes), (0, 0));
    assert_eq!(old.objects.len(), 2);
    assert_eq!(
        t.plan_income(&income.id)
            .unwrap()
            .unwrap()
            .fields
            .hpf_cents
            .as_deref(),
        Some("0")
    );
    let mut retry = input.clone();
    retry.batch.generation = t.generation();
    retry.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        t.financial_import_commit(&retry, "2026-10-09")
            .unwrap()
            .request_id,
        receipt.request_id
    );
    t.backup(Some(&tmp.path().join("new35.thingary"))).unwrap();
    println!("old34 backup inspect/restore ->35: old receipt read and same-batch replay, 2 mappings, 1 receipt, zero and IDs preserved");
}
