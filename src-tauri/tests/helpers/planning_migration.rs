//! §16.2: fictional old datasets; compare every factual row and managed-file digest.
use crate::{
    domain::Error,
    storage::{migrate_to, Store, SCHEMA, SCHEMA_VERSION},
};
use rusqlite::{types::ValueRef, Connection};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, io::Write, path::Path};
const TODAY: &str = "2026-10-12";
fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn dataset(root: &Path) -> std::path::PathBuf {
    let a: Value = serde_json::from_slice(&fs::read(root.join("active.json")).unwrap()).unwrap();
    root.join("datasets").join(a["id"].as_str().unwrap())
}
fn manifest(c: &Connection, files: &Path) -> Value {
    let names:Vec<String>=c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('plan_profile','investment_flows','plan_assumption_checks','cash_movements','investment_flow_sources','planning_flow_audit') ORDER BY name").unwrap().query_map([],|r|r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    let mut tables = BTreeMap::new();
    for name in names {
        let quoted = name.replace('"', "\"\"");
        let sql = if name == "plan_income" {
            "SELECT id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,deleted_at FROM plan_income".to_owned()
        } else {
            format!("SELECT * FROM \"{quoted}\"")
        };
        let mut q = c.prepare(&sql).unwrap();
        let columns = q
            .column_names()
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>();
        let count = q.column_count();
        let mut rows = q.query([]).unwrap();
        let mut values = vec![];
        while let Some(row) = rows.next().unwrap() {
            let v = (0..count)
                .map(|i| match row.get_ref(i).unwrap() {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(t) => json!(std::str::from_utf8(t).unwrap()),
                    ValueRef::Blob(b) => json!({"blob":b}),
                })
                .collect::<Vec<_>>();
            values.push(json!(v));
        }
        values.sort_by_key(Value::to_string);
        tables.insert(name, json!({"columns":columns,"rows":values}));
    }
    let mut hashes = BTreeMap::new();
    if files.exists() {
        for e in fs::read_dir(files).unwrap() {
            let e = e.unwrap();
            let bytes = fs::read(e.path()).unwrap();
            hashes.insert(
                e.file_name().to_string_lossy().to_string(),
                json!({"size":bytes.len(),"sha256":Store::digest_for_test(&bytes)}),
            );
        }
    }
    assert!(c
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    json!({"tables":tables,"files":hashes})
}
fn old_profile(s: &Store, pp: &str, mode: Value) -> Value {
    let mut p = serde_json::to_value(s.plan_profile().unwrap().saved.unwrap().profile).unwrap();
    for (key, value) in [
        ("birth_month", json!("1990-06")),
        ("worker", json!("male")),
        ("region", json!("beijing")),
        ("paid_months", json!(48)),
        ("account_balance_cents", json!("7000000")),
        ("base_cents", json!("2000000")),
        ("past_index_hundredths", Value::Null),
        ("flex_months", json!(0)),
        ("personal_pension_annual_cents", json!("1200000")),
        ("marginal_tax_hundredths", json!(1000)),
        ("medical_paid_months", json!(12)),
        ("medical_required_months", json!(300)),
        ("medical_topup_cents", json!("990000")),
        ("overrides", json!({"avg_wage_cents":"1000000"})),
    ] {
        p[key] = value;
    }
    p["assumptions"]["wage_growth_hundredths"] = json!(300);
    p["assumptions"]["pp_return_hundredths"] = json!(200);
    let r = p["retire"].as_object_mut().unwrap();
    r.remove("simplified");
    r.insert("target_age".into(), json!(50));
    r.insert("horizon_age".into(), json!(90));
    r.insert("keep_paying_monthly_cents".into(), json!("20000"));
    r.insert("keep_paying_until_age".into(), json!(60));
    r.insert("income_items".into(),json!([
        {"id":"generic-income","label":"虚构租金","monthly_cents":"0","start_age":40,"end_age":60,"indexed":false},
        {"id":"old-state","label":"旧国家养老金假设","monthly_cents":"500000","start_age":63,"end_age":null,"indexed":true}
    ]));
    r["basic"]["retirement_income"] = json!({"mode":mode,"selected":[{"id":"generic-income","source_id":"rent-generic","role":"other"},{"id":"old-state","source_id":"state_pension_estimate","role":"state_pension"}]});
    r["basic"]["pension_contributions"] =
        json!({"start_month":"2026-10","stop_month":"2030-01","base_cents":"2000000"});
    r["basic"]["contribution_costs"]
        .as_array_mut()
        .unwrap()
        .push(json!({"source_id":"personal_pension","treatment":"extra","reference_cents":null}));
    r["core"].as_object_mut().unwrap().remove("releases");
    r["core"]["hpf_monthly_cents"] = json!("50000");
    r["core"]["personal_pension_account_id"] = json!(pp);
    r["core"]["personal_pension_balance_confirmed"] = json!(true);
    r["core"]["costs"] = json!([]);
    for i in r["spend_items"].as_array_mut().unwrap() {
        let o = i.as_object_mut().unwrap();
        o.remove("start_month");
        o.remove("end_month");
        o.remove("time_unconfirmed");
        o.insert("start_age".into(), json!(50));
        o.insert("end_age".into(), json!(80));
    }
    for e in r["life_events"].as_array_mut().unwrap() {
        let o = e.as_object_mut().unwrap();
        o.remove("until_month");
        o.remove("time_unconfirmed");
        o.insert("until_age".into(), json!(70));
    }
    p
}
fn seed(root: &Path) -> (Store, String) {
    let mut s = Store::open(root).unwrap();
    crate::demo::prepare(&mut s, TODAY).unwrap();
    let pp = s
        .wealth_account_save(
            &crate::wealth::AccountSave {
                request_id: uid(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: crate::wealth::AccountFields {
                    name: "虚构个人养老金实际账户".into(),
                    institution: "虚构银行".into(),
                    side: "asset".into(),
                    kind: "other_asset".into(),
                    counted: true,
                    opened_on: "2020-01-01".into(),
                    closed_on: None,
                    notes: "实际账户虚构事实，不是社保公式余额".into(),
                },
            },
            TODAY,
        )
        .unwrap()
        .id;
    let zero_asset = s
        .save(
            &crate::domain::Save {
                request_id: uid(),
                generation: s.generation(),
                asset_id: None,
                expected_revision: None,
                name: "虚构零金额赠品".into(),
                price_cents: Some("0".into()),
                purchase_date: Some(TODAY.into()),
            },
            TODAY,
        )
        .unwrap()
        .id;
    let c = s.conn_for_test().unwrap();
    c.execute("INSERT INTO fin_snapshot_entries SELECT id,?1,'entered',0,'asset','other_asset',1 FROM fin_snapshots ORDER BY date DESC LIMIT 1",[&pp]).unwrap();
    // Exercise nullable factual income, explicit zero and soft deletion as exact stored values.
    c.execute("UPDATE plan_income SET hpf_cents=NULL,notes='虚构未知缴存\n保留备注' WHERE id=(SELECT id FROM plan_income LIMIT 1)",[]).unwrap();
    c.execute("UPDATE assets SET deleted_at='2026-10-11T00:00:00Z' WHERE id=(SELECT id FROM assets WHERE id!=?1 LIMIT 1)",[&zero_asset]).unwrap();
    let mut p = serde_json::to_value(s.plan_profile().unwrap().saved.unwrap().profile).unwrap();
    let (snap, rev, date): (String, i64, String) = c
        .query_row(
            "SELECT id,revision,date FROM fin_snapshots ORDER BY date DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    let cash: String = c
        .query_row(
            "SELECT id FROM fin_accounts WHERE kind='cash' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let asset = zero_asset;
    let (debt,balance):(String,i64)=c.query_row("SELECT account_id,amount_cents FROM fin_snapshot_entries WHERE snapshot_id=?1 AND side='liability' AND amount_cents>0 LIMIT 1",[&snap],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    let event = p["retire"]["life_events"][0]["id"].clone();
    p["retire"]["core"]["occurrences"] = json!([{"id":uid(),"event_id":event,"status":"occurred","actual_date":date,"payments_complete":true,"payments":[{"id":uid(),"date":date,"amount_cents":"0","account_id":cash,"absorbed_snapshot_id":snap,"absorbed_revision":rev,"source_kind":"asset","source_id":asset}],"loan":{"account_id":debt,"as_of":date,"principal_cents":balance.to_string(),"remaining_months":10}}]);
    p["retire"]["core"]["debt_repayments"] = json!([{"account_id":debt,"recorded_on":TODAY,"as_of":date,"balance_cents":balance.to_string(),"start_month":"2026-10","last_month":"2027-07","monthly_cents":null,"before":null,"after":"excluded"}]);
    let checked: crate::plan_profile::Profile = serde_json::from_value(p.clone()).unwrap();
    checked.validate(TODAY).unwrap();
    checked
        .retire
        .core
        .as_ref()
        .unwrap()
        .validate_references(c, true)
        .unwrap();
    c.execute("UPDATE plan_profile SET payload=?1", [p.to_string()])
        .unwrap();
    (s, pp)
}
fn snapshot_db(s: &Store, dir: &Path, old: &Value, version: i64) {
    fs::create_dir_all(dir).unwrap();
    let mut c = Connection::open(dir.join("data.sqlite")).unwrap();
    rusqlite::backup::Backup::new(s.conn_for_test().unwrap(), &mut c)
        .unwrap()
        .run_to_completion(128, std::time::Duration::from_millis(1), None)
        .unwrap();
    c.execute(
        "UPDATE plan_profile SET payload=?1,revision=7,updated_at='2026-10-01T00:00:00Z'",
        [old.to_string()],
    )
    .unwrap();
    // Build a real pre-37 layout rather than only lowering its version marker.
    if version < 37 {
        c.execute_batch("DROP TABLE cash_movements; DROP TABLE investment_flow_sources; DROP TABLE planning_flow_audit; DROP TABLE plan_assumption_checks; DROP TABLE investment_flows; ALTER TABLE plan_income DROP COLUMN source_account_id; ALTER TABLE plan_income DROP COLUMN receiving_account_id; ALTER TABLE plan_income DROP COLUMN category; ALTER TABLE plan_income DROP COLUMN destination; ALTER TABLE plan_income DROP COLUMN classification_changed;").unwrap();
    }
    c.execute_batch(&format!("PRAGMA user_version={version}"))
        .unwrap();
    c.execute(
        "INSERT INTO feature_requests VALUES(?1,'fictional-mixed-request-fingerprint','profile')",
        ["90000000-0000-4000-8000-000000000001"],
    )
    .unwrap();
    c.close().unwrap();
}
fn archive(dir: &Path, files: &Path, target: &Path, version: i64) {
    let mut entries = BTreeMap::new();
    let mut payloads = vec![(
        "data.sqlite".to_string(),
        fs::read(dir.join("data.sqlite")).unwrap(),
    )];
    if files.exists() {
        for e in fs::read_dir(files).unwrap() {
            let e = e.unwrap();
            payloads.push((
                format!("files/{}", e.file_name().to_string_lossy()),
                fs::read(e.path()).unwrap(),
            ));
        }
    }
    let mut zip = zip::ZipWriter::new(fs::File::create(target).unwrap());
    for (name, bytes) in payloads {
        entries.insert(
            name.clone(),
            json!({"size":bytes.len(),"hash":Store::digest_for_test(&bytes)}),
        );
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(
        json!({"format":1,"schema":version,"created_at":"2026-10-01T00:00:00Z","entries":entries})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    zip.finish().unwrap();
}
#[test]
fn every_factual_table_file_and_mixed_receipt_survives_each_policy_mode() {
    for mode in [
        json!("employee"),
        json!("manual"),
        json!("none"),
        Value::Null,
    ] {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("fictional");
        let (s, pp) = seed(&root);
        let old = old_profile(&s, &pp, mode);
        let stage = d.path().join("old");
        snapshot_db(&s, &stage, &old, 35);
        let files = dataset(&root).join("files");
        let c = Connection::open(stage.join("data.sqlite")).unwrap();
        let before = manifest(&c, &files);
        migrate_to(&c, SCHEMA_VERSION, &|_| Ok(())).unwrap();
        assert_eq!(manifest(&c, &files), before);
        let (raw, revision, stamp): (String, i64, String) = c
            .query_row(
                "SELECT payload,revision,updated_at FROM plan_profile",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let p: crate::plan_profile::Profile = serde_json::from_str(&raw).unwrap();
        assert_eq!(revision, 8);
        assert_eq!(stamp, "2026-10-01T00:00:00Z");
        assert_eq!(p.retire.simplified.time.reference, None);
        assert_eq!(p.retire.simplified.time.target_month, None);
        assert_eq!(p.retire.simplified.income_mode, "unconfirmed");
        let income = &p.retire.simplified.future_incomes;
        assert_eq!(income.len(), 1);
        assert_eq!(income[0].id, "generic-income");
        assert_eq!(income[0].monthly_cents.as_deref(), Some("0"));
        assert_eq!(income[0].start_month, None);
        let core = p.retire.core.unwrap();
        assert!(core.releases.is_empty());
        assert_eq!(
            json!(core.occurrences),
            old["retire"]["core"]["occurrences"]
        );
        assert_eq!(
            json!(core.debt_repayments),
            old["retire"]["core"]["debt_repayments"]
        );
        for key in [
            "birth_month",
            "medical_topup_cents",
            "personal_pension_account_id",
            "personal_pension_balance_confirmed",
            "hpf_monthly_cents",
            "state_pension_estimate",
            "until_age",
            "start_age",
        ] {
            assert!(!raw.contains(&format!("\"{key}\"")), "{key}");
        }
        if old["retire"]["basic"]["retirement_income"]["mode"] == "employee" {
            if let Ok(dir) = std::env::var("THINGARY_MIGRATION_EVIDENCE_DIR") {
                fs::create_dir_all(&dir).unwrap();
                fs::write(Path::new(&dir).join("fictional-preservation.json"),serde_json::to_vec_pretty(&json!({"description":"虚构旧库§16.2，全部事实表及托管附件摘要；不含旧政策载荷","schema_before":35,"schema_after":SCHEMA_VERSION,"facts_before":before,"facts_after":manifest(&c,&files),"occurrences_before":old["retire"]["core"]["occurrences"],"occurrences_after":core.occurrences,"debt_repayments_before":old["retire"]["core"]["debt_repayments"],"debt_repayments_after":core.debt_repayments})).unwrap()).unwrap();
            }
        }
        let once = raw;
        migrate_to(&c, SCHEMA_VERSION, &|_| panic!("must not run again")).unwrap();
        assert_eq!(
            c.query_row("SELECT payload FROM plan_profile", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            once
        );
    }
}
#[test]
fn conversion_and_schema_change_rollback_before_commit_then_retry() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("source");
    let (s, pp) = seed(&root);
    let old = old_profile(&s, &pp, json!("employee"));
    let stage = d.path().join("old");
    snapshot_db(&s, &stage, &old, 35);
    let c = Connection::open(stage.join("data.sqlite")).unwrap();
    let files = dataset(&root).join("files");
    let before = manifest(&c, &files);
    for point in ["migration.planning.converted", "migration.before_commit"] {
        assert!(migrate_to(&c, 36, &|p| if p == point {
            Err(Error::new("INJECTED", "虚构迁移中断"))
        } else {
            Ok(())
        })
        .is_err());
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            35
        );
        assert_eq!(
            c.query_row("SELECT revision FROM plan_profile", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            7
        );
        assert_eq!(
            c.query_row("SELECT payload FROM plan_profile", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            old.to_string()
        );
        assert_eq!(manifest(&c, &files), before);
    }
    migrate_to(&c, 36, &|_| Ok(())).unwrap();
}
#[test]
fn old_archive_restores_all_facts_leaves_original_bytes_and_keeps_generation_gate() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("source");
    let (s, pp) = seed(&root);
    let old = old_profile(&s, &pp, json!("employee"));
    let stage = d.path().join("old");
    snapshot_db(&s, &stage, &old, 35);
    let files = dataset(&root).join("files");
    let c = Connection::open(stage.join("data.sqlite")).unwrap();
    let before = manifest(&c, &files);
    drop(c);
    let path = d.path().join("old.thingary");
    archive(&stage, &files, &path, 35);
    let bytes = fs::read(&path).unwrap();
    let dest = d.path().join("restore");
    let mut restored = Store::open(&dest).unwrap();
    let info = restored.inspect_backup(&path).unwrap();
    assert!(info.planning_conditions_reset);
    assert_eq!(info.schema, 35);
    let generation = restored.generation();
    restored.set_hook(|p| {
        if p == "migration.planning.converted" {
            Err(Error::new("INJECTED", "虚构恢复迁移中断"))
        } else {
            Ok(())
        }
    });
    assert!(restored.restore(&path, &info.hash, &generation).is_err());
    assert_eq!(restored.generation(), generation);
    assert_eq!(
        restored
            .conn_for_test()
            .unwrap()
            .query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    restored.set_hook(|_| Ok(()));
    restored.restore(&path, &info.hash, &generation).unwrap();
    assert_ne!(restored.generation(), generation);
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(
        manifest(
            restored.conn_for_test().unwrap(),
            &dataset(&dest).join("files")
        ),
        before
    );
    assert_eq!(
        restored
            .wealth_request_result(
                "90000000-0000-4000-8000-000000000001",
                &restored.generation()
            )
            .unwrap()
            .as_deref(),
        Some("profile")
    );
    let current = d.path().join("current.thingary");
    restored.backup(Some(&current)).unwrap();
    let mut round = Store::open(&d.path().join("round")).unwrap();
    let checked = round.inspect_backup(&current).unwrap();
    assert!(!checked.planning_conditions_reset);
    round
        .restore(&current, &checked.hash, &round.generation())
        .unwrap();
    assert_eq!(
        manifest(
            round.conn_for_test().unwrap(),
            &dataset(&d.path().join("round")).join("files")
        ),
        before
    );
}
#[test]
fn policy_only_profile_restores_from_every_supported_profile_schema() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/planning-basic/legacy-receipt.json"
    ))
    .unwrap();
    let old = &fixture[1]["profile"];
    for version in 30..=35 {
        let d = tempfile::tempdir().unwrap();
        let stage = d.path().join("old");
        fs::create_dir(&stage).unwrap();
        let c = Connection::open(stage.join("data.sqlite")).unwrap();
        c.execute_batch(SCHEMA).unwrap();
        migrate_to(&c, version, &|_| Ok(())).unwrap();
        c.execute(
            "INSERT INTO plan_profile VALUES(1,?1,1,'2026-10-01T00:00:00Z')",
            [old.to_string()],
        )
        .unwrap();
        drop(c);
        let path = d.path().join("old.thingary");
        archive(&stage, &stage.join("files"), &path, version);
        let mut s = Store::open(&d.path().join("restore")).unwrap();
        let info = s.inspect_backup(&path).unwrap();
        assert!(info.planning_conditions_reset);
        s.restore(&path, &info.hash, &s.generation()).unwrap();
        let p = s.plan_profile().unwrap().saved.unwrap().profile;
        assert_eq!(p.retire.simplified.income_mode, "unconfirmed");
        assert!(p.retire.simplified.future_incomes.is_empty());
        assert!(s.wealth_accounts().unwrap().is_empty());
        assert!(s.plan_income_list().unwrap().rows.is_empty());
    }
}
#[test]
fn malformed_general_facts_or_attachment_abort_before_library_replacement() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("source");
    let (s, pp) = seed(&root);
    let mut old = old_profile(&s, &pp, json!("employee"));
    let stage = d.path().join("old");
    snapshot_db(&s, &stage, &old, 35);
    let files = dataset(&root).join("files");
    let c = Connection::open(stage.join("data.sqlite")).unwrap();
    old["retire"]["core"]["fund_rules"][0]["account_id"] = json!(uid());
    c.execute("UPDATE plan_profile SET payload=?1", [old.to_string()])
        .unwrap();
    assert!(migrate_to(&c, 36, &|_| Ok(())).is_err());
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        35
    );
    drop(c);
    let path = d.path().join("bad.thingary");
    archive(&stage, &files, &path, 35);
    let target = Store::open(&d.path().join("restore")).unwrap();
    assert!(target.inspect_backup(&path).is_err());
    snapshot_db(&s, &stage, &old_profile(&s, &pp, json!("employee")), 35);
    archive(&stage, &stage.join("missing-files"), &path, 35);
    assert!(target.inspect_backup(&path).is_err());
}

#[test]
fn live_upgrade_reopen_preserves_identity_then_scoped_unknown_commit_is_exactly_once() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("fictional");
    let (s, pp) = seed(&root);
    let old = old_profile(&s, &pp, json!("employee"));
    let generation = s.generation();
    let c = s.conn_for_test().unwrap();
    c.execute(
        "UPDATE plan_profile SET payload=?1,revision=7",
        [old.to_string()],
    )
    .unwrap();
    c.execute(
        "INSERT INTO feature_requests VALUES(?1,'fictional-legacy-fingerprint','profile')",
        ["90000000-0000-4000-8000-000000000001"],
    )
    .unwrap();
    c.execute_batch("DROP TABLE cash_movements; DROP TABLE investment_flow_sources; DROP TABLE planning_flow_audit; DROP TABLE plan_assumption_checks; DROP TABLE investment_flows; ALTER TABLE plan_income DROP COLUMN source_account_id; ALTER TABLE plan_income DROP COLUMN receiving_account_id; ALTER TABLE plan_income DROP COLUMN category; ALTER TABLE plan_income DROP COLUMN destination; ALTER TABLE plan_income DROP COLUMN classification_changed; PRAGMA user_version=35;").unwrap();
    let before = manifest(c, &dataset(&root).join("files"));
    drop(s);
    let mut s = Store::open(&root).unwrap();
    assert_eq!(s.generation(), generation);
    assert_eq!(
        manifest(s.conn_for_test().unwrap(), &dataset(&root).join("files")),
        before
    );
    let current = s.plan_profile().unwrap().saved.unwrap();
    assert_eq!(current.revision, 8);
    assert_eq!(
        s.wealth_request_result("90000000-0000-4000-8000-000000000001", &generation)
            .unwrap()
            .as_deref(),
        Some("profile")
    );
    let mut fields = current.profile.retire.simplified;
    fields.time.target_month = Some("2040-01".into());
    fields.time.horizon_month = Some("2070-01".into());
    fields.income_mode = "excluded".into();
    let mut update = crate::plan_basic::Update {
        request_id: "90000000-0000-4000-8000-000000000001".into(),
        generation: generation.clone(),
        expected_revision: Some(8),
        section: crate::plan_basic::Section::Simplified(fields),
    };
    assert_eq!(
        s.plan_profile_update(&update, TODAY).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    update.request_id = uid();
    s.set_hook(|p| {
        if p == "plan_profile.after_commit" {
            Err(Error::new("INJECTED", "虚构写后失联"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.plan_profile_update(&update, TODAY).unwrap_err().code,
        "INJECTED"
    );
    assert_eq!(
        s.wealth_request_result(&update.request_id, &generation)
            .unwrap()
            .as_deref(),
        Some("profile")
    );
    s.set_hook(|_| Ok(()));
    assert_eq!(s.plan_profile_update(&update, TODAY).unwrap().revision, 9);
    let after = manifest(s.conn_for_test().unwrap(), &dataset(&root).join("files"));
    // Only this new persisted idempotency receipt is an expected factual-row addition.
    let mut expected = before;
    expected["tables"]["feature_requests"] = after["tables"]["feature_requests"].clone();
    assert_eq!(expected, after);
    drop(s);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.plan_profile().unwrap().saved.unwrap().revision, 9);
    assert_eq!(s.generation(), generation);
}

#[test]
fn damaged_current_profile_is_not_misrepresented_as_a_legacy_reset() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("fictional");
    let (s, _) = seed(&root);
    let mut p = serde_json::to_value(s.plan_profile().unwrap().saved.unwrap().profile).unwrap();
    p["retire"]["simplified"]["future_incomes"] = json!({"broken":true});
    let c = s.conn_for_test().unwrap();
    c.execute("UPDATE plan_profile SET payload=?1", [p.to_string()])
        .unwrap();
    c.execute_batch("PRAGMA user_version=35").unwrap();
    assert!(migrate_to(c, 36, &|_| Ok(())).is_err());
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        35
    );
    assert_eq!(
        c.query_row("SELECT payload FROM plan_profile", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        p.to_string()
    );
}

#[test]
fn cancelled_event_references_do_not_block_migration_restore_or_current_save() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("source");
    let (s, pp) = seed(&root);
    let mut old = old_profile(&s, &pp, json!("employee"));
    let event = old["retire"]["life_events"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    old["retire"]["life_events"][0]["included"] = json!(true);
    old["retire"]["spend_cents"] = json!("100");
    old["retire"]["basic"]["retirement_costs"] = json!([{"source_id":format!("event:{event}:holding"),"treatment":"included","reference_cents":"1000"}]);
    old["retire"]["core"]["occurrences"] = json!([{"id":uid(),"event_id":event,"status":"cancelled","actual_date":TODAY,"payments_complete":true,"payments":[],"loan":null}]);
    let stage = d.path().join("old");
    snapshot_db(&s, &stage, &old, 35);
    let files = dataset(&root).join("files");
    let path = d.path().join("cancelled.thingary");
    archive(&stage, &files, &path, 35);
    let c = Connection::open(stage.join("data.sqlite")).unwrap();
    migrate_to(&c, 36, &|_| Ok(())).unwrap();
    let raw: String = c
        .query_row("SELECT payload FROM plan_profile", [], |r| r.get(0))
        .unwrap();
    let migrated: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        migrated["retire"]["core"]["occurrences"],
        old["retire"]["core"]["occurrences"]
    );
    let mut restored = Store::open(&d.path().join("restore")).unwrap();
    let info = restored.inspect_backup(&path).unwrap();
    restored
        .restore(&path, &info.hash, &restored.generation())
        .unwrap();
    let current = restored.plan_profile().unwrap().saved.unwrap();
    let update = crate::plan_basic::Update {
        request_id: uid(),
        generation: restored.generation(),
        expected_revision: Some(current.revision),
        section: crate::plan_basic::Section::Simplified(current.profile.retire.simplified),
    };
    restored.plan_profile_update(&update, TODAY).unwrap();
}

#[test]
fn schema36_income_receipts_upgrade_and_backup_preserve_original_facts() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("source");
    let (mut s, _) = seed(&root);
    let input:crate::plan_income::Save=serde_json::from_value(json!({"request_id":uid(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"date":TODAY,"net_cents":"100","hpf_cents":null,"notes":"虚构旧到账"}})).unwrap();
    let row = s.plan_income_save(&input, TODAY).unwrap();
    let profile = serde_json::to_value(s.plan_profile().unwrap().saved.unwrap().profile).unwrap();
    let old = d.path().join("schema36");
    snapshot_db(&s, &old, &profile, 36);
    let path = d.path().join("schema36.thingary");
    archive(&old, &dataset(&root).join("files"), &path, 36);
    let mut restored = Store::open(&d.path().join("restored")).unwrap();
    let info = restored.inspect_backup(&path).unwrap();
    restored
        .restore(&path, &info.hash, &restored.generation())
        .unwrap();
    let copied = restored.plan_income(&row.id).unwrap().unwrap();
    assert_eq!(copied.fields.category, "unclassified");
    assert_eq!(copied.fields.net_cents, "100");
    assert!(copied.fields.hpf_cents.is_none());
    assert_eq!(
        restored
            .wealth_request_result(&input.request_id, &restored.generation())
            .unwrap()
            .as_deref(),
        Some(row.id.as_str())
    );
    let data = dataset(&root);
    drop(s);
    let c = Connection::open(data.join("data.sqlite")).unwrap();
    c.execute_batch("DROP TABLE cash_movements; DROP TABLE investment_flow_sources; DROP TABLE planning_flow_audit; DROP TABLE plan_assumption_checks; DROP TABLE investment_flows; ALTER TABLE plan_income DROP COLUMN source_account_id; ALTER TABLE plan_income DROP COLUMN receiving_account_id; ALTER TABLE plan_income DROP COLUMN category; ALTER TABLE plan_income DROP COLUMN destination; ALTER TABLE plan_income DROP COLUMN classification_changed; PRAGMA user_version=36;").unwrap();
    drop(c);
    let mut upgraded = Store::open(&root).unwrap();
    let replay = upgraded.plan_income_save(&input, TODAY).unwrap();
    assert_eq!(replay.id, row.id);
    assert_eq!(replay.revision, row.revision);
    assert!(!replay.classification_changed);
}
