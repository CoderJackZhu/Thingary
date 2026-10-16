//! Fictional original-currency facts; downstream totals remain CNY cents.
use serde_json::{json, Value};
use thingary_lib::{
    currency,
    storage::Store,
    wealth::{Account, AccountSave, QuickUpdate, Snapshot, SnapshotSave},
};
const TODAY: &str = "2026-10-17";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn account(s: &mut Store, code: &str) -> Account {
    let input:AccountSave=serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"name":format!("虚构{code}账户"),"institution":"","side":"asset","kind":"cash","counted":true,"opened_on":"2020-01-01","closed_on":null,"notes":"","currency":code}})).unwrap();
    s.wealth_account_save(&input, TODAY).unwrap()
}
fn row(a: &Account, minor: &str, rate: &str) -> Value {
    json!({"account_id":a.id,"state":"entered","amount_cents":currency::convert(&a.fields.currency,minor.parse().unwrap(),rate.parse().unwrap()).unwrap().to_string(),"original_minor":minor,"fx_rate_micro":rate})
}
fn save(s: &mut Store, day: &str, rows: Vec<Value>, old: Option<&Snapshot>) -> Snapshot {
    let input:SnapshotSave=serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"id":old.map(|s|&s.id),"expected_revision":old.map(|s|s.revision),"date":day,"notes":"虚构备注","entries":rows})).unwrap();
    s.wealth_snapshot_save(&input, TODAY).unwrap()
}
fn quick(s: &Store, rows: Vec<Value>) -> QuickUpdate {
    serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"date":TODAY,"note":"虚构","changes":rows})).unwrap()
}
#[test]
fn shared_vectors_and_decimal_precision() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../tests/fixtures/currency-vectors.json")).unwrap();
    for c in cases {
        let result = currency::convert(
            c["code"].as_str().unwrap(),
            c["original"].as_str().unwrap().parse().unwrap(),
            c["rate"].as_str().unwrap().parse().unwrap(),
        );
        assert_eq!(
            result.ok().map(|v| v.to_string()),
            c["result"].as_str().map(str::to_owned),
            "{c}"
        );
    }
    assert_eq!(currency::parse_decimal("7.123456", 6).unwrap(), 7123456);
    assert!(currency::parse_decimal("7.1234567", 6).is_err());
    assert!(currency::parse_decimal("1.1", 0).is_err());
    assert_eq!(currency::parse_decimal("1234.56", 2).unwrap(), 123456);
    assert_eq!(
        currency::CURRENCIES.iter().map(|c| c.0).collect::<Vec<_>>(),
        vec!["CNY", "HKD", "USD", "EUR", "JPY", "GBP", "SGD", "AUD", "CAD", "CHF", "TWD", "MOP"]
    );
}
#[test]
fn defaults_preserve_old_write_json() {
    let t = tempfile::tempdir().unwrap();
    let s = Store::open(t.path()).unwrap();
    let raw = json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"name":"虚构","institution":"","side":"asset","kind":"cash","counted":true,"opened_on":"2020-01-01","closed_on":null,"notes":""}});
    let input: AccountSave = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(input).unwrap(), raw);
    let raw = json!({"request_id":id(),"generation":s.generation(),"date":TODAY,"note":"","changes":[{"account_id":id(),"amount_cents":"0","expected_previous":null}]});
    let input: QuickUpdate = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(input).unwrap(), raw);
    let raw = json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"date":TODAY,"notes":"","entries":[{"account_id":id(),"state":"entered","amount_cents":"0"}]});
    let input: SnapshotSave = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(input).unwrap(), raw);
}
#[test]
fn strict_fx_validation_and_any_history_locks_currency() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, "USD");
    let base = json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"date":TODAY,"notes":"","entries":[row(&a,"123456","7123456")]});
    for key in ["amount_cents", "fx_rate_micro", "original_minor"] {
        let mut value = base.clone();
        value["request_id"] = id().into();
        value["entries"][0][key] = if key == "amount_cents" {
            "1".into()
        } else {
            Value::Null
        };
        let input: SnapshotSave = serde_json::from_value(value).unwrap();
        assert_eq!(
            s.wealth_snapshot_save(&input, TODAY).unwrap_err().code,
            "FX_MISMATCH"
        );
    }
    let snap = save(
        &mut s,
        TODAY,
        vec![json!({"account_id":a.id,"state":"missing","amount_cents":null})],
        None,
    );
    assert!(s.wealth_accounts().unwrap()[0].has_entries);
    assert!(s.wealth_accounts().unwrap()[0].latest.is_none());
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE fin_snapshots SET deleted_at='2026-10-17T00:00:00Z' WHERE id=?1",
            [snap.id],
        )
        .unwrap();
    let input = AccountSave {
        request_id: id(),
        generation: s.generation(),
        id: Some(a.id),
        expected_revision: Some(a.revision),
        fields: thingary_lib::wealth::AccountFields {
            group_id: None,
            currency: "JPY".into(),
            holding_mode: false,
            holding_unit: None,
            ..a.fields
        },
    };
    assert_eq!(
        s.wealth_account_save(&input, TODAY).unwrap_err().code,
        "ACCOUNT_CURRENCY"
    );
    let c = account(&mut s, "CNY");
    let input:SnapshotSave=serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"date":TODAY,"notes":"","entries":[{"account_id":input.id,"state":"missing","amount_cents":null},{"account_id":c.id,"state":"entered","amount_cents":"1","original_minor":"1","fx_rate_micro":"1000000"}]})).unwrap();
    assert_eq!(
        s.wealth_snapshot_save(&input, TODAY).unwrap_err().code,
        "FX_MISMATCH"
    );
}
#[test]
fn a22_corrections_and_same_day_quick_preserve_currency_facts() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, "USD");
    let b = account(&mut s, "JPY");
    let first = save(
        &mut s,
        "2026-10-01",
        vec![row(&a, "100", "7000000"), row(&b, "1000", "50000")],
        None,
    );
    let later = save(
        &mut s,
        "2026-10-02",
        vec![
            json!({"account_id":a.id,"state":"unchanged","amount_cents":null}),
            row(&b, "2000", "60000"),
        ],
        None,
    );
    assert_eq!(later.entries[0].original_minor.as_deref(), Some("100"));
    save(
        &mut s,
        "2026-10-01",
        vec![row(&a, "200", "8000000"), row(&b, "1000", "50000")],
        Some(&first),
    );
    let kept = save(
        &mut s,
        "2026-10-02",
        vec![
            json!({"account_id":a.id,"state":"unchanged","amount_cents":null}),
            row(&b, "2000", "60000"),
        ],
        Some(&later),
    );
    assert_eq!(kept.entries[0].amount_cents.as_deref(), Some("700"));
    assert_eq!(kept.entries[0].fx_rate_micro.as_deref(), Some("7000000"));
    let mut input = quick(
        &s,
        vec![
            json!({"account_id":b.id,"amount_cents":"15000","original_minor":"3000","fx_rate_micro":"50000"}),
        ],
    );
    input.date = "2026-10-02".into();
    let result = s.wealth_quick_update(&input, TODAY).unwrap();
    assert_eq!(result.entries[0].original_minor.as_deref(), Some("100"));
    assert_eq!(result.entries[0].fx_rate_micro.as_deref(), Some("7000000"));
    assert_eq!(result.entries[0].state, "unchanged");
}
#[test]
fn foreign_transfer_net_zero_rounding_and_true_original_staleness() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, "USD");
    let b = account(&mut s, "USD");
    save(
        &mut s,
        TODAY,
        vec![row(&a, "10000", "7000000"), row(&b, "10000", "8000000")],
        None,
    );
    let change = |a: &Account, minor: &str, rate: &str, expected: &str, original: &str| {
        let mut r = row(a, minor, rate);
        r.as_object_mut().unwrap().remove("state");
        r["expected_previous"] = expected.into();
        r["expected_original_minor"] = original.into();
        r
    };
    let input = quick(
        &s,
        vec![
            change(&a, "9000", "7200000", "70000", "10000"),
            change(&b, "11000", "7200000", "80000", "10000"),
        ],
    );
    assert_eq!(
        s.wealth_quick_update(&input, TODAY).unwrap_err().code,
        "QUICK_TRANSFER"
    );
    let old = s.wealth_summary().unwrap().points[0].snapshot_id.clone();
    let old = s.wealth_snapshot(&old).unwrap().unwrap();
    let old = save(
        &mut s,
        TODAY,
        vec![row(&a, "1", "500000"), row(&b, "1", "500000")],
        Some(&old),
    );
    let input = quick(
        &s,
        vec![
            change(&a, "0", "500000", "1", "1"),
            change(&b, "2", "500000", "1", "1"),
        ],
    );
    assert_eq!(
        s.wealth_quick_update(&input, TODAY).unwrap_err().code,
        "QUICK_TRANSFER"
    );
    save(
        &mut s,
        TODAY,
        vec![row(&a, "2", "500000"), row(&b, "1", "500000")],
        Some(&old),
    );
    let input = quick(&s, vec![change(&a, "3", "500000", "1", "1")]);
    assert_eq!(
        s.wealth_quick_update(&input, TODAY).unwrap_err().code,
        "QUICK_STALE"
    );
    let input = quick(&s, vec![change(&a, "4", "500000", "1", "2")]);
    assert!(s.wealth_quick_update(&input, TODAY).is_ok());
}

#[test]
fn foreign_import_csv_excel_and_backup_roundtrip_and_row_errors() {
    use std::collections::BTreeMap;
    use thingary_lib::financial_import::{BatchInput, CommitInput, FileInput};
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    thingary_lib::modules::initialize_runtime(t.path());
    let batch=BatchInput {generation:s.generation(),source_name:"虚构外币导入".into(),mapping_set_id:"虚构".into(),files:vec![
      FileInput{kind:"accounts".into(),name:"虚构账户.csv".into(),csv_text:"account_key,name,kind,enabled_from,counted,币种\na,虚构美元,cash,2020-01-01,true,USD\nb,虚构日元,cash,2020-01-01,true,JPY\nc,虚构人民币,cash,2020-01-01,true,CNY\n".into(),column_mapping:BTreeMap::new()},
      FileInput{kind:"snapshots".into(),name:"虚构盘点.csv".into(),csv_text:"snapshot_key,date,account_key,amount,币种,原币金额,汇率\ns,2026-10-17,a,,USD,1234.56,7.123456\ns,2026-10-17,b,500,JPY,10000,0.05\ns,2026-10-17,c,0,CNY,,\n".into(),column_mapping:BTreeMap::new()}
    ],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0};
    let p = s
        .financial_import_preview(&batch, TODAY, &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    let input = CommitInput {
        request_id: id(),
        batch: batch.clone(),
        context_digest: p.context_digest,
        normalized_digest: p.normalized_digest,
        file_fingerprints: p.file_fingerprints,
    };
    s.financial_import_commit(&input, TODAY).unwrap();
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap().request_id,
        input.request_id
    );
    let summary = s.wealth_summary().unwrap();
    assert_eq!(summary.points[0].net_cents, "929433");
    assert_eq!(summary.structure_entries.len(), 3);
    let snap = s
        .wealth_snapshot(&summary.points[0].snapshot_id)
        .unwrap()
        .unwrap();
    assert_eq!(snap.entries[0].original_minor.as_deref(), Some("123456"));
    assert_eq!(snap.entries[1].original_minor.as_deref(), Some("10000"));
    let csv = t.path().join("虚构.csv");
    s.export_finance_csv("wealth", &csv).unwrap();
    let csv = std::fs::read_to_string(csv).unwrap();
    assert!(csv.contains("币种,原币金额,汇率,份额,单价\r\n"));
    assert!(csv.contains("USD,1234.56,7.123456,,\r\n"));
    assert!(csv.contains("JPY,10000,0.050000,,\r\n"));
    assert!(csv.contains("CNY,,,,\r\n"));
    let xlsx = t.path().join("虚构.xlsx");
    s.export_workbook(&xlsx).unwrap();
    let bytes = std::fs::read(&xlsx).unwrap();
    let files = thingary_lib::spreadsheet::read_finance(&bytes)
        .unwrap()
        .into_iter()
        .map(|f| FileInput {
            kind: f.kind,
            name: f.name,
            csv_text: f.csv_text,
            column_mapping: BTreeMap::new(),
        })
        .collect();
    let mut dest = Store::open(&t.path().join("虚构往返")).unwrap();
    let batch = BatchInput {
        generation: dest.generation(),
        source_name: "虚构往返".into(),
        mapping_set_id: "虚构往返".into(),
        files,
        mappings: BTreeMap::new(),
        actions: BTreeMap::new(),
        page: 0,
    };
    let p = dest
        .financial_import_preview(&batch, TODAY, &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    dest.financial_import_commit(
        &CommitInput {
            request_id: id(),
            batch,
            context_digest: p.context_digest,
            normalized_digest: p.normalized_digest,
            file_fingerprints: p.file_fingerprints,
        },
        TODAY,
    )
    .unwrap();
    let a = dest.wealth_accounts().unwrap();
    assert_eq!(a[0].fields.currency, "USD");
    assert_eq!(a[1].fields.currency, "JPY");
    assert_eq!(dest.wealth_summary().unwrap().points[0].net_cents, "929433");
    let archive = t.path().join("虚构.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&t.path().join("虚构恢复")).unwrap();
    let info = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &info.hash, &restored.generation())
        .unwrap();
    assert_eq!(
        restored.wealth_accounts().unwrap()[0]
            .latest
            .as_ref()
            .unwrap()
            .fx_rate_micro
            .as_deref(),
        Some("7123456")
    );
    let mut bad = batch_from_original(&s);
    bad.files[1].csv_text="snapshot_key,date,account_key,amount,币种,原币金额,汇率\nx,2026-10-17,a,1,USD,1234.56,7.123456\nx,2026-10-17,b,,JPY,1.2,0.05\nx,2026-10-17,c,,CNY,,\n".into();
    let p = s.financial_import_preview(&bad, TODAY, &|| false).unwrap();
    assert!(!p.can_commit);
    assert!(p.issues.iter().any(|i| i.code == "FX_MISMATCH"));
    assert!(p.issues.iter().any(|i| i.code == "AMOUNT_REQUIRED"));
    fn batch_from_original(s: &Store) -> BatchInput {
        BatchInput{generation:s.generation(),source_name:"虚构外币导入".into(),mapping_set_id:"虚构".into(),files:vec![FileInput{kind:"accounts".into(),name:"虚构.csv".into(),csv_text:"account_key,name,kind,enabled_from,counted,币种\na,虚构美元,cash,2020-01-01,true,USD\nb,虚构日元,cash,2020-01-01,true,JPY\nc,虚构人民币,cash,2020-01-01,true,CNY\n".into(),column_mapping:BTreeMap::new()},FileInput{kind:"snapshots".into(),name:"虚构.csv".into(),csv_text:String::new(),column_mapping:BTreeMap::new()}],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0}
    }
}

#[test]
fn foreign_snapshot_interruption_is_atomic_and_cross_currency_transfer_is_rejected() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, "USD");
    let b = account(&mut s, "JPY");
    save(
        &mut s,
        "2026-10-01",
        vec![row(&a, "100", "7000000"), row(&b, "10000", "50000")],
        None,
    );
    let input = quick(
        &s,
        vec![
            json!({"account_id":a.id,"amount_cents":"0","original_minor":"0","fx_rate_micro":"7000000","expected_previous":"700","expected_original_minor":"100"}),
            json!({"account_id":b.id,"amount_cents":"50700","original_minor":"10140","fx_rate_micro":"50000","expected_previous":"50000","expected_original_minor":"10000"}),
        ],
    );
    assert_eq!(
        s.wealth_quick_update(&input, TODAY).unwrap_err().code,
        "QUICK_CURRENCY"
    );
    let input = quick(
        &s,
        vec![
            json!({"account_id":a.id,"amount_cents":"1400","original_minor":"200","fx_rate_micro":"7000000"}),
        ],
    );
    s.set_hook(|p| {
        if p == "wealth_quick_update.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.wealth_quick_update(&input, TODAY).unwrap_err().code,
        "INJECTED"
    );
    assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
    assert_eq!(
        s.wealth_request_result(&input.request_id, &s.generation())
            .unwrap(),
        None
    );
    assert_eq!(
        s.wealth_accounts().unwrap()[0]
            .latest
            .as_ref()
            .unwrap()
            .original_minor
            .as_deref(),
        Some("100")
    );
}

#[test]
fn explicit_cny_and_absent_defaults_have_identical_normalized_import_digest() {
    use std::collections::BTreeMap;
    use thingary_lib::financial_import::{BatchInput, FileInput};
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(dir.path()).unwrap();
    thingary_lib::modules::initialize_runtime(dir.path());
    let mut b = BatchInput {
        generation: s.generation(),
        source_name: "虚构旧请求".into(),
        mapping_set_id: "虚构".into(),
        files: vec![FileInput {
            kind: "accounts".into(),
            name: "虚构.csv".into(),
            csv_text:
                "account_key,name,kind,enabled_from,counted\na,虚构人民币,cash,2020-01-01,true\n"
                    .into(),
            column_mapping: BTreeMap::new(),
        }],
        mappings: BTreeMap::new(),
        actions: BTreeMap::new(),
        page: 0,
    };
    let old = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    assert!(old.can_commit);
    b.files[0].csv_text =
        "account_key,name,kind,enabled_from,counted,币种\na,虚构人民币,cash,2020-01-01,true,CNY\n"
            .into();
    let explicit = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    assert!(explicit.can_commit);
    assert_eq!(old.normalized_digest, explicit.normalized_digest);
}

#[test]
fn original_and_rate_can_replace_amount_column_but_cny_remains_required() {
    use thingary_lib::financial_import_parser::{
        parse_import_v1, ImportContext, ImportRequestV1, StandardRowV1,
    };
    let input:ImportRequestV1=serde_json::from_value(json!({"contract_version":1,"kind":"snapshots","csv_text":"snapshot_key,date,account_key,币种,原币金额,汇率\ns,2026-10-17,a,USD,1234.56,7.123456\ns,2026-10-17,b,CNY,,\n"})).unwrap();
    let parsed = parse_import_v1(
        &input,
        &ImportContext {
            today: TODAY,
            cancel: &|| false,
        },
    )
    .unwrap();
    assert_eq!(parsed.rows.len(), 1);
    let StandardRowV1::Snapshots(row) = &parsed.rows[0] else {
        panic!()
    };
    assert_eq!(row.amount_cents, "879433");
    assert!(parsed
        .issues
        .iter()
        .any(|i| i.code == "AMOUNT_REQUIRED" && i.source_row == Some(3)));
}

#[test]
fn retired_account_rate_is_suggested_to_new_account_without_future_leak_and_same_day_wins() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let old = account(&mut s, "USD");
    save(&mut s, "2026-10-01", vec![row(&old, "0", "7000000")], None);
    let mut fields = old.fields.clone();
    fields.closed_on = Some("2026-10-02".into());
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(old.id.clone()),
            expected_revision: Some(old.revision),
            fields,
        },
        TODAY,
    )
    .unwrap();
    let new = account(&mut s, "USD");
    let mut fields = new.fields.clone();
    fields.opened_on = "2026-10-03".into();
    let new = s
        .wealth_account_save(
            &AccountSave {
                request_id: id(),
                generation: s.generation(),
                id: Some(new.id.clone()),
                expected_revision: Some(new.revision),
                fields,
            },
            TODAY,
        )
        .unwrap();
    save(
        &mut s,
        "2026-10-09",
        vec![row(&new, "100", "8000000")],
        None,
    );
    let draft = s.wealth_snapshot_draft("2026-10-05").unwrap();
    assert_eq!(draft.rows.len(), 1);
    assert_eq!(draft.rows[0].account.id, new.id);
    assert!(draft.rows[0].previous.is_none());
    assert_eq!(draft.rate_suggestions["USD"].rate, "7000000");
    assert_eq!(draft.rate_suggestions["USD"].date, "2026-10-01");
    let same = s.wealth_snapshot_draft("2026-10-09").unwrap();
    assert_eq!(same.rate_suggestions["USD"].rate, "8000000");
    assert_eq!(same.rate_suggestions["USD"].date, "2026-10-09");
    assert!(s
        .wealth_snapshot_draft("2026-09-30")
        .unwrap()
        .rate_suggestions
        .is_empty());
}
