//! Fictional positions in temporary stores; no market service or trade ledger.
use serde_json::{json, Value};
use thingary_lib::{
    currency, holdings,
    storage::Store,
    wealth::{Account, AccountSave, QuickUpdate, Snapshot, SnapshotSave},
};
const DAY: &str = "2026-10-17";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn account(s: &mut Store, mode: bool, code: &str) -> Account {
    let input:AccountSave=serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"id":null,"expected_revision":null,"fields":{"name":"虚构持仓账户","institution":"","side":"asset","kind":"fund","counted":true,"opened_on":"2020-01-01","closed_on":null,"notes":"虚构","currency":code,"holding_mode":mode}})).unwrap();
    s.wealth_account_save(&input, DAY).unwrap()
}
fn toggle(s: &mut Store, a: &Account, mode: bool) -> Account {
    let mut fields = a.fields.clone();
    fields.holding_mode = mode;
    fields.holding_unit = None;
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(a.id.clone()),
            expected_revision: Some(a.revision),
            fields,
        },
        DAY,
    )
    .unwrap()
}
fn position(a: &Account, q: &str, p: &str, rate: &str) -> Value {
    let original = holdings::minor(
        q.parse().unwrap(),
        p.parse().unwrap(),
        currency::decimals(&a.fields.currency),
    )
    .unwrap();
    let amount = if a.fields.currency == "CNY" {
        original
    } else {
        currency::convert(&a.fields.currency, original, rate.parse().unwrap()).unwrap()
    };
    let mut r = json!({"account_id":a.id,"state":"entered","amount_cents":amount.to_string(),"quantity_e8":q,"unit_price_e6":p});
    if a.fields.currency != "CNY" {
        r["original_minor"] = original.to_string().into();
        r["fx_rate_micro"] = rate.into();
    }
    r
}
fn balance(a: &Account, amount: &str) -> Value {
    json!({"account_id":a.id,"state":"entered","amount_cents":amount})
}
fn input(s: &Store, date: &str, rows: Vec<Value>, old: Option<&Snapshot>) -> SnapshotSave {
    serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"id":old.map(|v|&v.id),"expected_revision":old.map(|v|v.revision),"date":date,"notes":"虚构备注更正","entries":rows})).unwrap()
}
fn save(s: &mut Store, date: &str, rows: Vec<Value>, old: Option<&Snapshot>) -> Snapshot {
    let r = input(s, date, rows, old);
    s.wealth_snapshot_save(&r, DAY).unwrap()
}
fn quick(s: &Store, rows: Vec<Value>, date: &str) -> QuickUpdate {
    serde_json::from_value(json!({"request_id":id(),"generation":s.generation(),"date":date,"note":"虚构更新","changes":rows})).unwrap()
}
#[test]
fn shared_input_vectors_reject_malformed_whitespace() {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../tests/fixtures/holding-input-vectors.json"
    ))
    .unwrap();
    for c in cases {
        assert_eq!(
            holdings::parse(
                c["text"].as_str().unwrap(),
                c["places"].as_u64().unwrap() as u32
            )
            .ok()
            .map(|v| v.to_string()),
            c["result"].as_str().map(str::to_owned),
            "{c}"
        );
    }
}
#[test]
fn shared_integer_vectors_precision_and_default_json() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../tests/fixtures/holdings-vectors.json")).unwrap();
    for c in cases {
        assert_eq!(
            holdings::minor(
                c["quantity"].as_str().unwrap().parse().unwrap(),
                c["price"].as_str().unwrap().parse().unwrap(),
                c["decimals"].as_u64().unwrap() as u32
            )
            .ok()
            .map(|v| v.to_string()),
            c["result"].as_str().map(str::to_owned),
            "{c}"
        );
    }
    assert_eq!(holdings::parse(" 1,234.5678 ", 8).unwrap(), 123456780000);
    assert_eq!(holdings::parse("1 234.5", 8).unwrap(), 123450000000);
    assert!(holdings::parse("1,23", 8).is_err());
    assert!(holdings::parse("1.123456789", 8).is_err());
    assert!(holdings::parse("1.1234567", 6).is_err());
    let raw = json!({"request_id":id(),"generation":"虚构","id":null,"expected_revision":null,"fields":{"name":"虚构","institution":"","side":"asset","kind":"cash","counted":true,"opened_on":"2020-01-01","closed_on":null,"notes":""}});
    let a: AccountSave = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(a).unwrap(), raw);
}
#[test]
fn new_facts_are_strict_and_missing_never_carries_metadata() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, true, "CNY");
    let b = account(&mut s, false, "CNY");
    for change in [
        json!({"account_id":a.id,"state":"entered","amount_cents":"100","quantity_e8":"100000000"}),
        balance(&a, "100"),
        json!({"account_id":a.id,"state":"entered","amount_cents":"1","quantity_e8":"100000000","unit_price_e6":"1000000"}),
    ] {
        let r = input(&s, DAY, vec![change, balance(&b, "0")], None);
        assert_eq!(
            s.wealth_snapshot_save(&r, DAY).unwrap_err().code,
            "HOLDING_MISMATCH"
        );
    }
    let r = input(
        &s,
        DAY,
        vec![
            position(&a, "100000000", "1000000", ""),
            position(&b, "100000000", "1000000", ""),
        ],
        None,
    );
    assert_eq!(
        s.wealth_snapshot_save(&r, DAY).unwrap_err().code,
        "HOLDING_MISMATCH"
    );
    let snap = save(
        &mut s,
        DAY,
        vec![position(&a, "0", "1234567", ""), balance(&b, "0")],
        None,
    );
    assert_eq!(snap.entries[0].amount_cents.as_deref(), Some("0"));
    let row = json!({"account_id":a.id,"state":"missing","amount_cents":null,"quantity_e8":"0","unit_price_e6":"1"});
    let r = input(&s, DAY, vec![row.clone(), balance(&b, "0")], Some(&snap));
    assert_eq!(
        s.wealth_snapshot_save(&r, DAY).unwrap_err().code,
        "HOLDING_MISMATCH"
    );
}
#[test]
fn both_mode_switches_preserve_exact_old_facts_notes_and_other_quick_rows() {
    for initial in [false, true] {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        let a = account(&mut s, initial, "CNY");
        let b = account(&mut s, false, "CNY");
        let row = if initial {
            position(&a, "100000000", "1000000", "")
        } else {
            balance(&a, "100")
        };
        let first = save(&mut s, DAY, vec![row.clone(), balance(&b, "100")], None);
        let a = toggle(&mut s, &a, !initial);
        let corrected = save(
            &mut s,
            DAY,
            vec![row.clone(), balance(&b, "100")],
            Some(&first),
        );
        assert_eq!(
            serde_json::to_value(&first.entries[0]).unwrap(),
            serde_json::to_value(&corrected.entries[0]).unwrap()
        );
        let mut changed = row.clone();
        if initial {
            changed["quantity_e8"] = "200000000".into();
            changed["unit_price_e6"] = "500000".into();
        } else {
            changed["amount_cents"] = "101".into();
        }
        let r = input(&s, DAY, vec![changed, balance(&b, "100")], Some(&corrected));
        assert_eq!(
            s.wealth_snapshot_save(&r, DAY).unwrap_err().code,
            "HOLDING_MISMATCH"
        );
        let q = quick(&s, vec![balance(&b, "200")], DAY);
        let kept = s.wealth_quick_update(&q, DAY).unwrap();
        assert_eq!(
            serde_json::to_value(&corrected.entries[0]).unwrap(),
            serde_json::to_value(&kept.entries[0]).unwrap()
        );
        let archive = t.path().join("虚构历史模式.thingary");
        s.backup(Some(&archive)).unwrap();
        assert!(s.inspect_backup(&archive).is_ok());
        assert_eq!(
            s.wealth_account_history(&a.id).unwrap().rows[0].quantity_e8,
            first.entries[0].quantity_e8
        );
    }
}
#[test]
fn a22_and_newday_carry_entire_position_after_earlier_correction() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, true, "USD");
    let b = account(&mut s, false, "CNY");
    let first = save(
        &mut s,
        "2026-10-01",
        vec![
            position(&a, "100000000", "1000000", "7000000"),
            balance(&b, "1"),
        ],
        None,
    );
    let next = save(
        &mut s,
        "2026-10-02",
        vec![
            json!({"account_id":a.id,"state":"unchanged","amount_cents":null}),
            balance(&b, "2"),
        ],
        None,
    );
    save(
        &mut s,
        "2026-10-01",
        vec![
            position(&a, "200000000", "2000000", "8000000"),
            balance(&b, "1"),
        ],
        Some(&first),
    );
    let a = toggle(&mut s, &a, false);
    let q = quick(&s, vec![balance(&b, "3")], "2026-10-02");
    let result = s.wealth_quick_update(&q, DAY).unwrap();
    assert_eq!(
        serde_json::to_value(&result.entries[0]).unwrap(),
        serde_json::to_value(&next.entries[0]).unwrap()
    );
    let q = quick(&s, vec![balance(&b, "4")], DAY);
    let result = s.wealth_quick_update(&q, DAY).unwrap();
    assert_eq!(result.entries[0].quantity_e8.as_deref(), Some("100000000"));
    assert_eq!(result.entries[0].unit_price_e6.as_deref(), Some("1000000"));
    assert_eq!(result.entries[0].fx_rate_micro.as_deref(), Some("7000000"));
    assert!(!a.fields.holding_mode);
}
#[test]
fn quick_quantity_price_stale_and_transfer_guards_are_real() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, true, "CNY");
    let b = account(&mut s, false, "CNY");
    save(
        &mut s,
        DAY,
        vec![position(&a, "100000000", "5000", ""), balance(&b, "100")],
        None,
    );
    let mut r = position(&a, "200000000", "2500", "");
    r["expected_previous"] = "1".into();
    r["expected_quantity_e8"] = "100000000".into();
    let q = quick(&s, vec![r], DAY);
    let changed = s.wealth_quick_update(&q, DAY).unwrap();
    assert_eq!(changed.entries[0].amount_cents.as_deref(), Some("1"));
    let mut r = position(&a, "300000000", "2500", "");
    r["expected_previous"] = "1".into();
    r["expected_quantity_e8"] = "100000000".into();
    let q = quick(&s, vec![r.clone()], DAY);
    assert_eq!(
        s.wealth_quick_update(&q, DAY).unwrap_err().code,
        "QUICK_STALE"
    );
    r["expected_quantity_e8"] = "200000000".into();
    let q = quick(&s, vec![r], DAY);
    let updated = s.wealth_quick_update(&q, DAY).unwrap();
    assert_eq!(updated.entries[0].quantity_e8.as_deref(), Some("300000000"));
    let mut r = position(&a, "300000000", "1000000", "");
    r["expected_previous"] = updated.entries[0].amount_cents.clone().unwrap().into();
    r["expected_quantity_e8"] = "300000000".into();
    let q = quick(&s, vec![r], DAY);
    assert_eq!(
        s.wealth_quick_update(&q, DAY).unwrap().entries[0]
            .unit_price_e6
            .as_deref(),
        Some("1000000")
    );
    let q = quick(
        &s,
        vec![position(&a, "0", "1", ""), balance(&b, "400")],
        DAY,
    );
    assert_eq!(
        s.wealth_quick_update(&q, DAY).unwrap_err().code,
        "QUICK_HOLDING"
    );
}
#[test]
fn excel_roundtrip_preserves_both_historical_modes_fx_groups_and_rejects_corruption() {
    use std::collections::BTreeMap;
    use thingary_lib::financial_import::{BatchInput, CommitInput, FileInput};
    for (initial, code) in [(true, "USD"), (false, "USD"), (true, "JPY"), (false, "JPY")] {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        thingary_lib::modules::initialize_runtime(t.path());
        let a = account(&mut s, initial, code);
        let group = s
            .account_group_save(&thingary_lib::account_groups::Save {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                name: "虚构持仓组".into(),
            })
            .unwrap();
        let mut fields = a.fields.clone();
        fields.group_id = Some(group.id);
        fields.holding_unit = initial.then(|| "克".into());
        let a = s
            .wealth_account_save(
                &AccountSave {
                    request_id: id(),
                    generation: s.generation(),
                    id: Some(a.id.clone()),
                    expected_revision: Some(a.revision),
                    fields,
                },
                DAY,
            )
            .unwrap();
        let r = if code == "JPY" {
            if initial {
                position(&a, "0", "1234567", "50000")
            } else {
                json!({"account_id":a.id,"state":"entered","amount_cents":"0","original_minor":"0","fx_rate_micro":"50000"})
            }
        } else if initial {
            position(&a, "123456780000", "1234567", "7123456")
        } else {
            json!({"account_id":a.id,"state":"entered","amount_cents":"879433","original_minor":"123456","fx_rate_micro":"7123456"})
        };
        let old = save(&mut s, DAY, vec![r], None);
        let _a = toggle(&mut s, &a, !initial);
        let csv = t.path().join("虚构持仓.csv");
        s.export_finance_csv("wealth", &csv).unwrap();
        assert!(std::fs::read_to_string(csv)
            .unwrap()
            .contains("汇率,份额,单价"));
        let path = t.path().join("虚构持仓.xlsx");
        s.export_workbook(&path).unwrap();
        let files = thingary_lib::spreadsheet::read_finance(&std::fs::read(path).unwrap())
            .unwrap()
            .into_iter()
            .map(|f| FileInput {
                kind: f.kind,
                name: f.name,
                csv_text: f.csv_text,
                column_mapping: f.column_mapping,
            })
            .collect::<Vec<_>>();
        let mut d = Store::open(&t.path().join("虚构导入")).unwrap();
        let mut batch = BatchInput {
            generation: d.generation(),
            source_name: "虚构持仓往返".into(),
            mapping_set_id: "虚构".into(),
            files,
            mappings: BTreeMap::new(),
            actions: BTreeMap::new(),
            page: 0,
        };
        let p = d.financial_import_preview(&batch, DAY, &|| false).unwrap();
        assert!(p.can_commit, "{:?}", p.issues);
        d.financial_import_commit(
            &CommitInput {
                request_id: id(),
                batch: batch.clone(),
                context_digest: p.context_digest,
                normalized_digest: p.normalized_digest,
                file_fingerprints: p.file_fingerprints,
            },
            DAY,
        )
        .unwrap();
        let actual = d
            .wealth_snapshot(&d.wealth_summary().unwrap().points[0].snapshot_id)
            .unwrap()
            .unwrap();
        assert_eq!(actual.entries[0].quantity_e8, old.entries[0].quantity_e8);
        assert_eq!(
            actual.entries[0].unit_price_e6,
            old.entries[0].unit_price_e6
        );
        assert_eq!(
            actual.entries[0].original_minor,
            old.entries[0].original_minor
        );
        assert_eq!(
            actual.entries[0].fx_rate_micro,
            old.entries[0].fx_rate_micro
        );
        assert_eq!(
            d.wealth_accounts().unwrap()[0].fields.holding_mode,
            !initial
        );
        assert!(d.wealth_accounts().unwrap()[0].fields.group_id.is_some());
        if initial && code == "USD" {
            let text = &mut batch
                .files
                .iter_mut()
                .find(|f| f.kind == "snapshots")
                .unwrap()
                .csv_text;
            *text = text.replace("1234.56780000", "2234.56780000");
            let p = d.financial_import_preview(&batch, DAY, &|| false).unwrap();
            assert!(!p.can_commit);
            assert!(p.issues.iter().any(|i| i.code == "HOLDING_MISMATCH"));
        }
    }
}
#[test]
fn quantity_price_only_import_calculates_money_and_fault_rolls_back() {
    use std::collections::BTreeMap;
    use thingary_lib::financial_import::{BatchInput, CommitInput, FileInput};
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    thingary_lib::modules::initialize_runtime(t.path());
    let batch=BatchInput{generation:s.generation(),source_name:"虚构只填份额".into(),mapping_set_id:"虚构".into(),files:vec![FileInput{kind:"accounts".into(),name:"虚构账户.csv".into(),csv_text:"account_key,name,kind,enabled_from,counted,按持仓记录\na,虚构份额,fund,2020-01-01,true,true\n".into(),column_mapping:BTreeMap::new()},FileInput{kind:"snapshots".into(),name:"虚构盘点.csv".into(),csv_text:"snapshot_key,date,account_key,份额,单价\ns,2026-10-17,a,1234.5678,1.234567\n".into(),column_mapping:BTreeMap::new()}],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0};
    let p = s.financial_import_preview(&batch, DAY, &|| false).unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    let commit = CommitInput {
        request_id: id(),
        batch,
        context_digest: p.context_digest,
        normalized_digest: p.normalized_digest,
        file_fingerprints: p.file_fingerprints,
    };
    s.set_hook(|p| {
        if p == "financial_import.before_commit" {
            Err(thingary_lib::domain::Error::new("INJECTED", "虚构中断"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        s.financial_import_commit(&commit, DAY).unwrap_err().code,
        "INJECTED"
    );
    assert!(s.wealth_accounts().unwrap().is_empty());
    assert_eq!(
        s.wealth_request_result(&commit.request_id, &s.generation())
            .unwrap(),
        None
    );
    s.set_hook(|_| Ok(()));
    s.financial_import_commit(&commit, DAY).unwrap();
    assert_eq!(s.wealth_summary().unwrap().points[0].net_cents, "152416");
}

#[test]
fn financial_parser_rejects_decimal_commas_in_quantity_and_price() {
    use std::collections::BTreeMap;
    use thingary_lib::financial_import::{BatchInput, FileInput};
    let t = tempfile::tempdir().unwrap();
    let s = Store::open(t.path()).unwrap();
    thingary_lib::modules::initialize_runtime(t.path());
    for (quantity, price) in [("\"1.2,3\"", "1"), ("1", "\"1,234.5,6\"")] {
        let batch=BatchInput{generation:s.generation(),source_name:"虚构非法持仓逗号".into(),mapping_set_id:"虚构".into(),files:vec![FileInput{kind:"accounts".into(),name:"虚构账户.csv".into(),csv_text:"account_key,name,kind,enabled_from,counted,按持仓记录\na,虚构份额,fund,2020-01-01,true,true\n".into(),column_mapping:BTreeMap::new()},FileInput{kind:"snapshots".into(),name:"虚构盘点.csv".into(),csv_text:format!("snapshot_key,date,account_key,份额,单价\ns,2026-10-17,a,{quantity},{price}\n"),column_mapping:BTreeMap::new()}],mappings:BTreeMap::new(),actions:BTreeMap::new(),page:0};
        let preview = s.financial_import_preview(&batch, DAY, &|| false).unwrap();
        assert!(!preview.can_commit);
        assert!(preview
            .issues
            .iter()
            .any(|i| i.code == "HOLDING_MISMATCH" && i.source_row == Some(2)));
        assert!(s.wealth_accounts().unwrap().is_empty());
    }
}
#[test]
fn disabled_holding_changed_to_cash_carries_history_and_backup_stays_valid() {
    let t = tempfile::tempdir().unwrap();
    let mut s = Store::open(t.path()).unwrap();
    let a = account(&mut s, true, "CNY");
    save(
        &mut s,
        "2026-10-01",
        vec![position(&a, "100000000", "1234567", "")],
        None,
    );
    let a = toggle(&mut s, &a, false);
    let mut fields = a.fields.clone();
    fields.kind = "cash".into();
    s.wealth_account_save(
        &AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(a.id.clone()),
            expected_revision: Some(a.revision),
            fields,
        },
        DAY,
    )
    .unwrap();
    let snap = save(
        &mut s,
        DAY,
        vec![json!({"account_id":a.id,"state":"unchanged","amount_cents":null})],
        None,
    );
    assert_eq!(snap.entries[0].quantity_e8.as_deref(), Some("100000000"));
    assert_eq!(snap.entries[0].unit_price_e6.as_deref(), Some("1234567"));
    assert_eq!(snap.entries[0].kind, "cash");
    let archive = t.path().join("虚构改类型沿用.thingary");
    s.backup(Some(&archive)).unwrap();
    assert!(s.inspect_backup(&archive).is_ok());
}

#[test]
fn same_cny_but_different_original_and_rate_is_not_a_historical_mode_exception() {
    for initial in [true, false] {
        let t = tempfile::tempdir().unwrap();
        let mut s = Store::open(t.path()).unwrap();
        let a = account(&mut s, initial, "USD");
        let row = if initial {
            position(&a, "100000000", "1000000", "7000000")
        } else {
            json!({"account_id":a.id,"state":"entered","amount_cents":"700","original_minor":"100","fx_rate_micro":"7000000"})
        };
        let old = save(&mut s, DAY, vec![row], None);
        let a = toggle(&mut s, &a, !initial);
        let changed = if initial {
            position(&a, "200000000", "1000000", "3500000")
        } else {
            json!({"account_id":a.id,"state":"entered","amount_cents":"700","original_minor":"200","fx_rate_micro":"3500000"})
        };
        let r = input(&s, DAY, vec![changed], Some(&old));
        assert_eq!(
            s.wealth_snapshot_save(&r, DAY).unwrap_err().code,
            "HOLDING_MISMATCH"
        );
    }
}
