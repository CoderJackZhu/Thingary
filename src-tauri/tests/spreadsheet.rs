use calamine::{Data, Reader, Xlsx};
use std::{collections::BTreeMap, io::Cursor};
use thingary_lib::{
    catalog::{Details, SaveAsset},
    csv_import::Commit,
    domain::Save,
    financial_import::{BatchInput, CommitInput, FileInput},
    spreadsheet,
    storage::Store,
};
const TODAY: &str = "2026-10-10";
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn rows(values: &[&[&str]]) -> Vec<Vec<String>> {
    values
        .iter()
        .map(|r| r.iter().map(|s| s.to_string()).collect())
        .collect()
}
fn batch(s: &Store, bytes: &[u8]) -> BatchInput {
    BatchInput {
        generation: s.generation(),
        source_name: "虚构 Excel".into(),
        mapping_set_id: "第一组".into(),
        files: spreadsheet::read_finance(bytes)
            .unwrap()
            .into_iter()
            .map(|f| FileInput {
                kind: f.kind,
                name: f.name,
                csv_text: f.csv_text,
                column_mapping: f.column_mapping,
            })
            .collect(),
        mappings: BTreeMap::new(),
        actions: BTreeMap::new(),
        page: 0,
    }
}
fn commit(s: &mut Store, b: BatchInput) -> thingary_lib::financial_import::Receipt {
    let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    assert!(p.can_commit || p.prior_receipt.is_some(), "{:?}", p.issues);
    s.financial_import_commit(
        &CommitInput {
            request_id: id(),
            batch: b,
            context_digest: p.context_digest,
            normalized_digest: p.normalized_digest,
            file_fingerprints: p.file_fingerprints,
        },
        TODAY,
    )
    .unwrap()
}
#[test]
fn item_workbook_preserves_text_unknown_zero_multiline_and_detects_edits() {
    let t = tempfile::tempdir().unwrap();
    let mut source = Store::open(&t.path().join("source")).unwrap();
    for (name, price) in [
        ("=SUM(1,2)", None),
        ("'=字面单引号", Some("0")),
        ("前导编号物品", Some("10001")),
    ] {
        source
            .save_asset(
                &SaveAsset {
                    base: Save {
                        request_id: id(),
                        generation: source.generation(),
                        asset_id: None,
                        expected_revision: None,
                        name: name.into(),
                        price_cents: price.map(str::to_owned),
                        purchase_date: Some("2026-09-01".into()),
                    },
                    details: Details {
                        brand: "中文,品牌".into(),
                        model: "00001234567890123456".into(),
                        serial_number: String::new(),
                        notes: "第一行\n第二行\r\n含引号\"备注".into(),
                    },
                    photos: None,
                    classification: None,
                    options: None,
                },
                TODAY,
            )
            .unwrap();
    }
    let path = t.path().join("中文工作簿.xlsx");
    source.export_workbook(&path).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let mut book = Xlsx::new(Cursor::new(&bytes)).unwrap();
    assert_eq!(
        book.sheet_names(),
        &[
            "说明",
            "物品",
            "账户",
            "完整盘点",
            "月度收入",
            "盘点记录",
            "重要支出",
            "周期费用"
        ]
    );
    assert!(book.worksheet_formula("物品").unwrap().is_empty());
    let range = book.worksheet_range("物品").unwrap();
    assert!(range
        .rows()
        .skip(1)
        .any(|r| r[1] == Data::String("'=字面单引号".into())));
    assert!(range
        .rows()
        .skip(1)
        .any(|r| r[5] == Data::String("0.00".into())));
    let csv = spreadsheet::read_items(&bytes).unwrap();
    let mut dest = Store::open(&t.path().join("dest")).unwrap();
    let p = dest.preview_item_sheet(&csv, TODAY).unwrap();
    assert_eq!(p.valid, 3);
    assert!(p.invalid.is_empty());
    let c = Commit {
        request_id: id(),
        generation: dest.generation(),
        hash: p.hash,
        include_duplicates: false,
    };
    let mut altered = csv.clone();
    altered.push(b' ');
    assert_eq!(
        dest.import_item_sheet(&altered, &c, TODAY)
            .unwrap_err()
            .code,
        "CSV_CHANGED"
    );
    assert_eq!(dest.import_item_sheet(&csv, &c, TODAY).unwrap().imported, 3);
    assert_eq!(dest.import_item_sheet(&csv, &c, TODAY).unwrap().imported, 3);
    let second = t.path().join("second.xlsx");
    dest.export_workbook(&second).unwrap();
    let mut other = Xlsx::new(Cursor::new(std::fs::read(second).unwrap())).unwrap();
    let other = other.worksheet_range("物品").unwrap();
    let mut original: Vec<_> = range.rows().skip(1).map(|r| r[1..].to_vec()).collect();
    let mut copied: Vec<_> = other.rows().skip(1).map(|r| r[1..].to_vec()).collect();
    original.sort_by_key(|r| r[0].to_string());
    copied.sort_by_key(|r| r[0].to_string());
    assert_eq!(original, copied);
}
#[test]
fn financial_sample_excel_transaction_replay_export_import_restart_backup() {
    let t = tempfile::tempdir().unwrap();
    let file = t.path().join("样例.xlsx");
    spreadsheet::write_template(&file, true).unwrap();
    let mut s = Store::open(&t.path().join("source")).unwrap();
    let b = batch(&s, &std::fs::read(&file).unwrap());
    assert_eq!(b.files.len(), 3);
    let r = commit(&mut s, b.clone());
    assert_eq!(r.counts.created_accounts, 6);
    assert_eq!(r.counts.created_snapshots, 24);
    assert_eq!(r.counts.created_incomes, 25);
    let replay = commit(&mut s, b);
    assert_eq!(replay.request_id, r.request_id);
    let export = t.path().join("导出.xlsx");
    s.export_workbook(&export).unwrap();
    let mut dest = Store::open(&t.path().join("dest")).unwrap();
    let b = batch(&dest, &std::fs::read(&export).unwrap());
    let copied = commit(&mut dest, b);
    assert_eq!(copied.counts.created_accounts, 6);
    assert_eq!(copied.counts.created_snapshots, 24);
    assert_eq!(copied.counts.created_incomes, 25);
    let normalize = |summary| {
        let mut v = serde_json::to_value(summary).unwrap();
        v.as_object_mut().unwrap().remove("generation");
        for p in v["points"].as_array_mut().unwrap() {
            p.as_object_mut().unwrap().remove("snapshot_id");
            p.as_object_mut().unwrap().remove("compared_to");
        }
        v
    };
    assert_eq!(
        normalize(dest.wealth_summary().unwrap()),
        normalize(s.wealth_summary().unwrap())
    );
    let archive = t.path().join("完整.thingary");
    dest.backup(Some(&archive)).unwrap();
    drop(dest);
    let mut dest = Store::open(&t.path().join("dest")).unwrap();
    let generation = dest.generation();
    dest.restore(
        &archive,
        &thingary_lib::backup::archive_hash(&archive).unwrap(),
        &generation,
    )
    .unwrap();
    assert_eq!(
        dest.financial_import_receipt(&copied.request_id, &dest.generation())
            .unwrap()
            .unwrap()
            .objects
            .len(),
        55
    );
}
#[test]
fn empty_sheets_are_optional_and_multiline_errors_keep_excel_coordinates() {
    let t = tempfile::tempdir().unwrap();
    let p = t.path().join("表.xlsx");
    spreadsheet::write_template(&p, false).unwrap();
    assert_eq!(
        spreadsheet::read_finance(&std::fs::read(&p).unwrap())
            .unwrap_err()
            .code,
        "XLSX_FORMAT"
    );
    spreadsheet::write_workbook(
        &p,
        &[(
            "月度收入",
            rows(&[
                &["income_key", "date", "net_income", "hpf_deposit", "note"],
                &["000001", "2026-09-10", "100.01", "", "多行\n备注"],
                &["000002", "2026-09-11", "0", "0", ""],
            ]),
        )],
    )
    .unwrap();
    let f = spreadsheet::read_finance(&std::fs::read(&p).unwrap())
        .unwrap()
        .remove(0);
    assert_eq!(f.row_numbers, vec![0, 1, 2, 2, 3]);
    assert!(f.csv_text.contains("000001"));
    let mut s = Store::open(&t.path().join("s")).unwrap();
    let b = batch(&s, &std::fs::read(&p).unwrap());
    let r = commit(&mut s, b);
    assert_eq!(r.counts.created_incomes, 2);
    let exported = t.path().join("收入.xlsx");
    s.export_workbook(&exported).unwrap();
    let mut book = Xlsx::new(Cursor::new(std::fs::read(exported).unwrap())).unwrap();
    let range = book.worksheet_range("月度收入").unwrap();
    assert!(matches!(range.get((1, 3)), None | Some(Data::Empty)));
    assert_eq!(range[(2, 3)], Data::String("0.00".into()));
}
#[test]
fn formulas_errors_sparse_ranges_and_invalid_archives_are_rejected_without_writes() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("公式.xlsx");
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.set_name("物品").unwrap();
    sheet.write_string(0, 0, "名称").unwrap();
    sheet.write_formula(1, 0, "=1+1").unwrap();
    book.save(&path).unwrap();
    assert_eq!(
        spreadsheet::read_items(&std::fs::read(&path).unwrap())
            .unwrap_err()
            .code,
        "XLSX_FORMULA"
    );
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.set_name("物品").unwrap();
    sheet.write_string(0, 0, "名称").unwrap();
    sheet.write_string(1_048_575, 0, "越界").unwrap();
    book.save(&path).unwrap();
    assert_eq!(
        spreadsheet::read_items(&std::fs::read(&path).unwrap())
            .unwrap_err()
            .code,
        "LIMIT_ROWS"
    );
    assert_eq!(
        spreadsheet::read_items(b"not a workbook").unwrap_err().code,
        "XLSX_FORMAT"
    );
    assert_eq!(
        spreadsheet::read_items(&vec![0; spreadsheet::MAX_BYTES + 1])
            .unwrap_err()
            .code,
        "LIMIT_SIZE"
    );
    std::fs::write(&path, b"original").unwrap();
    assert!(
        spreadsheet::write_workbook(&path, &[("物品", vec![vec!["x".repeat(32768)]])]).is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"original");
}

#[test]
fn installed_0_0_1_schema25_upgrades_in_place_without_excel_or_id_changes() {
    use thingary_lib::storage::{migrate_to, SCHEMA, SCHEMA_VERSION};
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("fictional-library");
    let dataset = id();
    let generation = id();
    let dir = root.join("datasets").join(&dataset);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        root.join("active.json"),
        serde_json::to_vec(&serde_json::json!({"id":dataset,"generation":generation})).unwrap(),
    )
    .unwrap();
    let db = rusqlite::Connection::open(dir.join("data.sqlite")).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    migrate_to(&db, 25, &|_| Ok(())).unwrap();
    let asset = id();
    let account = id();
    let snap = id();
    db.execute("INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES(?1,'虚构旧物品',NULL,'2026-09-01',1)",[&asset]).unwrap();
    db.execute("INSERT INTO asset_profiles(asset_id,brand,model,serial_number,notes,created_at,updated_at) VALUES(?1,'虚构品牌','000123','','旧备注','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')",[&asset]).unwrap();
    db.execute("INSERT INTO fin_accounts(id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,created_at,updated_at,deleted_at) VALUES(?1,'虚构旧账户','虚构平台','asset','cash',1,'2026-01-01',NULL,'旧事实',0,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',NULL)",[&account]).unwrap();
    db.execute("INSERT INTO fin_snapshots(id,date,notes,revision,created_at,updated_at) VALUES(?1,'2026-09-30','旧未知盘点',1,'2026-09-30T00:00:00Z','2026-09-30T00:00:00Z')",[&snap]).unwrap();
    db.execute("INSERT INTO fin_snapshot_entries(snapshot_id,account_id,state,amount_cents,side,kind,counted) VALUES(?1,?2,'missing',NULL,'asset','cash',1)",[&snap,&account]).unwrap();
    drop(db);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.generation(), generation);
    assert_eq!(
        s.conn_for_test()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    assert_eq!(s.wealth_accounts().unwrap()[0].id, account);
    assert_eq!(
        s.wealth_snapshot(&snap).unwrap().unwrap().entries[0].amount_cents,
        None
    );
    let path = t.path().join("升级后的表格.xlsx");
    s.export_workbook(&path).unwrap();
    let mut book = Xlsx::new(Cursor::new(std::fs::read(path).unwrap())).unwrap();
    let range = book.worksheet_range("物品").unwrap();
    assert_eq!(range[(1, 0)], Data::String(asset));
    assert_eq!(range[(1, 4)], Data::String("000123".into()));
    assert_eq!(range[(1, 5)], Data::Empty);
    let archive = t.path().join("升级后备份.thingary");
    s.backup(Some(&archive)).unwrap();
    drop(s);
    let mut s = Store::open(&root).unwrap();
    let gen = s.generation();
    s.restore(
        &archive,
        &thingary_lib::backup::archive_hash(&archive).unwrap(),
        &gen,
    )
    .unwrap();
    assert_eq!(s.wealth_accounts().unwrap()[0].id, account);
}

#[test]
fn numeric_amount_dates_and_error_cells_are_handled_without_silent_key_conversion() {
    use std::io::{Read, Write};
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("类型.xlsx");
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.set_name("月度收入").unwrap();
    for (i, h) in ["income_key", "date", "net_income", "hpf_deposit", "note"]
        .iter()
        .enumerate()
    {
        sheet.write_string(0, i as u16, *h).unwrap();
    }
    sheet.write_string(1, 0, "000123").unwrap();
    let d = rust_xlsxwriter::ExcelDateTime::from_ymd(2026, 9, 10).unwrap();
    sheet
        .write_datetime_with_format(
            1,
            1,
            &d,
            &rust_xlsxwriter::Format::new().set_num_format("yyyy-mm-dd"),
        )
        .unwrap();
    sheet.write_number(1, 2, 100.01).unwrap();
    book.save(&path).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let f = spreadsheet::read_finance(&bytes).unwrap();
    assert!(f[0].csv_text.contains("2026-09-10"));
    assert!(f[0].csv_text.contains("100.01"));
    let mut s = Store::open(&t.path().join("s")).unwrap();
    let b = batch(&s, &bytes);
    assert_eq!(commit(&mut s, b).counts.created_incomes, 1);
    sheet_test_numeric_key(&path);
    assert!(spreadsheet::read_finance(&std::fs::read(&path).unwrap())
        .unwrap_err()
        .message
        .contains("编号须按文本"));
    // Independent malformed-cell fixture: Excel's error type has no formula.
    let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
    let mut output = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for i in 0..archive.len() {
        let mut part = archive.by_index(i).unwrap();
        let name = part.name().to_string();
        let mut data = Vec::new();
        part.read_to_end(&mut data).unwrap();
        if name == "xl/worksheets/sheet1.xml" {
            let xml = String::from_utf8(data).unwrap();
            let start = xml.find("<c r=\"A2\"").unwrap();
            let end = start + xml[start..].find("</c>").unwrap() + 4;
            data = format!(
                "{}<c r=\"A2\" t=\"e\"><v>#DIV/0!</v></c>{}",
                &xml[..start],
                &xml[end..]
            )
            .into_bytes();
        }
        output
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        output.write_all(&data).unwrap();
    }
    let bytes = output.finish().unwrap().into_inner();
    assert!(spreadsheet::read_finance(&bytes)
        .unwrap_err()
        .message
        .contains("含错误值"));
}
fn sheet_test_numeric_key(path: &std::path::Path) {
    let mut book = rust_xlsxwriter::Workbook::new();
    let sheet = book.add_worksheet();
    sheet.set_name("月度收入").unwrap();
    sheet.write_string(0, 0, "income_key").unwrap();
    sheet.write_number(1, 0, 123.0).unwrap();
    book.save(path).unwrap();
}
