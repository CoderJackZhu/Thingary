//! Fictional fixed asset purchase values, legacy requests and transport coverage.
use calamine::{Reader, Xlsx};
use std::{collections::BTreeMap, io::Cursor};
use thingary_lib::{
    financial_import::{BatchInput, CommitInput, FileInput},
    financial_import_parser::{self as parser, ImportContext, ImportRequestV1, StandardRowV1},
    storage::Store,
    wealth::{AccountSave, EntryInput, SnapshotSave},
};
const TODAY: &str = "2026-10-17";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn legacy(s: &Store, kind: &str) -> serde_json::Value {
    serde_json::json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"name":"虚构固定资产","institution":"","side":"asset","kind":kind,"counted":false,"opened_on":"2020-01-01","closed_on":null,"notes":""}})
}
#[test]
fn validates_purchase_and_preserves_legacy_fingerprint_and_replay() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let value = legacy(&s, "cash");
    let input: AccountSave = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&input).unwrap(), value);
    let a = s.wealth_account_save(&input, TODAY).unwrap();
    assert!(a.fields.purchase_cents.is_none());
    assert_eq!(s.wealth_account_save(&input, TODAY).unwrap().id, a.id);
    let mut invalid = legacy(&s, "cash");
    invalid["fields"]["purchase_cents"] = "0".into();
    assert_eq!(
        s.wealth_account_save(&serde_json::from_value(invalid).unwrap(), TODAY)
            .unwrap_err()
            .code,
        "ACCOUNT_PURCHASE"
    );
    let mut invalid = legacy(&s, "property");
    invalid["fields"]["purchased_on"] = "2026-10-18".into();
    assert_eq!(
        s.wealth_account_save(&serde_json::from_value(invalid).unwrap(), TODAY)
            .unwrap_err()
            .code,
        "ACCOUNT_PURCHASE"
    );
    let mut value = legacy(&s, "property");
    value["fields"]["purchase_cents"] = "10000".into();
    let a = s
        .wealth_account_save(&serde_json::from_value(value).unwrap(), TODAY)
        .unwrap();
    let mut change: AccountSave = serde_json::from_value(legacy(&s, "cash")).unwrap();
    change.id = Some(a.id.clone());
    change.expected_revision = Some(a.revision);
    assert_eq!(
        s.wealth_account_save(&change, TODAY).unwrap_err().code,
        "ACCOUNT_PURCHASE"
    );
    change.fields = a.fields;
    let mut carried = change.clone();
    carried.fields.kind = "cash".into();
    let rejected = s.wealth_account_save(&carried, TODAY).unwrap_err();
    assert_eq!(rejected.code, "ACCOUNT_PURCHASE");
    assert!(rejected.message.contains("请先清空"));
    change.fields.purchase_cents = None;
    let cleared = s.wealth_account_save(&change, TODAY).unwrap();
    change.request_id = id();
    change.expected_revision = Some(cleared.revision);
    change.fields.kind = "cash".into();
    assert!(s.wealth_account_save(&change, TODAY).is_ok());
}
fn parse(csv: &str) -> parser::ImportPreviewV1 {
    let input: ImportRequestV1 = serde_json::from_value(
        serde_json::json!({"contract_version":1,"kind":"accounts","csv_text":csv}),
    )
    .unwrap();
    parser::parse_import_v1(
        &input,
        &ImportContext {
            today: TODAY,
            cancel: &|| false,
        },
    )
    .unwrap()
}
#[test]
fn old_and_new_templates_validate_each_purchase_row() {
    let old =
        parse("account_key,name,kind,enabled_from,counted\na,虚构旧账户,cash,2020-01-01,true\n");
    assert_eq!(old.rows.len(), 1);
    let StandardRowV1::Accounts(a) = &old.rows[0] else {
        panic!()
    };
    assert!(a.purchase_cents.is_none());
    let p=parse("account_key,name,kind,enabled_from,counted,购入价,购入日期\na,虚构车辆,vehicle,2020-01-01,false,0,2020-06-01\nb,虚构现金,cash,2020-01-01,true,123,\nc,虚构车辆,vehicle,2020-01-01,false,,2026-10-18\n");
    assert_eq!(p.rows.len(), 1);
    let StandardRowV1::Accounts(a) = &p.rows[0] else {
        panic!()
    };
    assert_eq!(a.purchase_cents.as_deref(), Some("0"));
    assert!(p
        .issues
        .iter()
        .any(|i| i.code == "ACCOUNT_PURCHASE" && i.source_row == Some(3)));
    assert!(p
        .issues
        .iter()
        .any(|i| i.code == "DATE_FUTURE" && i.source_row == Some(4)));
    assert!(parser::template_csv("accounts")
        .unwrap()
        .contains("购入价,购入日期"));
}
#[test]
fn purchase_import_commit_and_csv_excel_preserve_zero_and_unknown() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    thingary_lib::modules::initialize_runtime(t.path());
    let batch=BatchInput{generation:s.generation(),source_name:"虚构固定资产导入".into(),mapping_set_id:"虚构".into(),files:vec![FileInput{kind:"accounts".into(),name:"虚构.csv".into(),csv_text:"account_key,name,kind,enabled_from,counted,购入价,购入日期\na,虚构车辆,vehicle,2020-01-01,false,0,2020-06-01\nb,虚构房产,property,2020-01-01,false,,\n".into(),column_mapping:BTreeMap::new()}],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0};
    let p = s
        .financial_import_preview(&batch, TODAY, &|| false)
        .unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    s.financial_import_commit(
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
    let accounts = s.wealth_accounts().unwrap();
    assert_eq!(accounts.len(), 2);
    assert_eq!(accounts[0].fields.purchase_cents.as_deref(), Some("0"));
    s.wealth_snapshot_save(
        &SnapshotSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            date: TODAY.into(),
            notes: "虚构".into(),
            entries: accounts
                .iter()
                .map(|a| EntryInput {
                    account_id: a.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some("12300".into()),
                })
                .collect(),
        },
        TODAY,
    )
    .unwrap();
    let csv = t.path().join("虚构.csv");
    s.export_finance_csv("wealth", &csv).unwrap();
    let csv = std::fs::read_to_string(csv).unwrap();
    assert!(csv.starts_with("\u{feff}盘点日期,账户,平台,方向,类型,计入净资产,状态,金额（元）,盘点备注,购入价,购入日期\r\n"));
    assert!(csv.contains("虚构,0.00,2020-06-01\r\n"));
    assert!(csv.contains("虚构,,\r\n"));
    let path = t.path().join("虚构.xlsx");
    s.export_workbook(&path).unwrap();
    let mut book: Xlsx<_> = Xlsx::new(Cursor::new(std::fs::read(path).unwrap())).unwrap();
    let rows = book.worksheet_range("账户").unwrap();
    let rows: Vec<_> = rows.rows().collect();
    assert_eq!(rows[0][8].to_string(), "购入价");
    assert_eq!(rows[0][9].to_string(), "购入日期");
    assert_eq!(rows[1][8].to_string(), "0.00");
    assert_eq!(rows[1][9].to_string(), "2020-06-01");
    assert_eq!(s.wealth_summary().unwrap().points[0].net_cents, "0");
}
#[test]
fn purchase_write_interruption_leaves_no_account_or_receipt() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let mut value = legacy(&s, "vehicle");
    value["fields"]["purchase_cents"] = "12300".into();
    let input: AccountSave = serde_json::from_value(value).unwrap();
    s.set_hook(|point| {
        if point == "wealth_account.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构故障"))
        } else {
            Ok(())
        }
    });
    assert!(s.wealth_account_save(&input, TODAY).is_err());
    assert!(s.wealth_accounts().unwrap().is_empty());
    assert_eq!(
        s.wealth_request_result(&input.request_id, &s.generation())
            .unwrap(),
        None
    );
}
