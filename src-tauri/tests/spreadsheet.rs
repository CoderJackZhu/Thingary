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
// Mirror Worker startup: the independent finance preferences are initialized once.
fn open_store(root: &std::path::Path) -> thingary_lib::domain::Result<Store> {
    let store = Store::open(root)?;
    thingary_lib::modules::initialize_runtime(root);
    Ok(store)
}
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
fn income_excel_keeps_recorded_currency_precision_and_clears_stale_origins() {
    use thingary_lib::catalog::{AmountKind, AmountOriginSave, PriceOrigin};
    let temp = tempfile::tempdir().unwrap();
    let mut store = open_store(&temp.path().join("source")).unwrap();
    let mut expected = BTreeMap::new();
    for (code, original, rate) in [
        ("USD", 12345, 7_123456),
        ("JPY", 12345, 48_000),
        ("KRW", 12345, 5_100),
        ("VND", 12345, 280),
    ] {
        let cents = thingary_lib::currency::convert(code, original, rate).unwrap();
        let income = store
            .plan_income_save(
                &thingary_lib::plan_income::Save {
                    request_id: id(),
                    generation: store.generation(),
                    id: None,
                    expected_revision: None,
                    fields: thingary_lib::plan_income::Fields {
                        date: "2026-09-30".into(),
                        net_cents: cents.to_string(),
                        notes: code.into(),
                        ..Default::default()
                    },
                },
                TODAY,
            )
            .unwrap();
        store
            .set_amount_origin(&AmountOriginSave {
                generation: store.generation(),
                kind: AmountKind::Income,
                record_id: income.id.clone(),
                origin: Some(PriceOrigin {
                    currency: code.into(),
                    original_minor: original.to_string(),
                    fx_rate_micro: rate.to_string(),
                }),
            })
            .unwrap();
        expected.insert(
            income.id,
            (
                code,
                thingary_lib::currency::decimal(original, thingary_lib::currency::decimals(code)),
            ),
        );
    }
    let stale = store
        .plan_income_save(
            &thingary_lib::plan_income::Save {
                request_id: id(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                fields: thingary_lib::plan_income::Fields {
                    date: "2026-09-30".into(),
                    net_cents: "100".into(),
                    notes: "原币失效".into(),
                    ..Default::default()
                },
            },
            TODAY,
        )
        .unwrap();
    store
        .conn_for_test()
        .unwrap()
        .execute(
            "INSERT INTO amount_origin VALUES ('income',?1,'USD',100,1000000)",
            [&stale.id],
        )
        .unwrap();
    store
        .conn_for_test()
        .unwrap()
        .execute(
            "UPDATE plan_income SET net_cents=300 WHERE id=?1",
            [&stale.id],
        )
        .unwrap();
    store
        .conn_for_test()
        .unwrap()
        .execute(
            "INSERT INTO fin_snapshots(id,date,revision,created_at,updated_at,notes)
             VALUES('deleted-snapshot','2026-09-01',1,'2026-09-01','2026-09-01','')",
            [],
        )
        .unwrap();
    store
        .conn_for_test()
        .unwrap()
        .execute(
            "UPDATE fin_snapshots SET deleted_at='2026-09-02' WHERE id='deleted-snapshot'",
            [],
        )
        .unwrap();
    let changes = store.conn_for_test().unwrap().total_changes();
    let file = temp.path().join("币种核对.xlsx");
    store.export_workbook(&file).unwrap();
    assert_eq!(changes, store.conn_for_test().unwrap().total_changes());
    let bytes = std::fs::read(&file).unwrap();
    let mut workbook = Xlsx::new(Cursor::new(&bytes)).unwrap();
    let snapshots = workbook.worksheet_range("盘点概况").unwrap();
    assert!(!snapshots
        .rows()
        .skip(1)
        .any(|r| r[6] == Data::String("deleted-snapshot".into())));
    let range = workbook.worksheet_range("月度收入").unwrap();
    let headers: Vec<_> = range
        .rows()
        .next()
        .unwrap()
        .iter()
        .map(ToString::to_string)
        .collect();
    let at = |row: &[Data], title: &str| {
        row[headers.iter().position(|h| h == title).unwrap()].to_string()
    };
    for row in range.rows().skip(1) {
        let key = at(row, "收入编号");
        if key == stale.id {
            assert_eq!(at(row, "原币币种"), "");
            assert_eq!(at(row, "原币金额"), "");
        } else {
            let (code, amount) = expected.get(&key).unwrap();
            assert_eq!(at(row, "原币币种"), *code);
            assert_eq!(at(row, "原币金额"), *amount);
        }
        assert_eq!(at(row, "公积金缴存（元）"), "");
        assert_eq!(at(row, "收入分类"), "未分类");
    }
    let mut dest = open_store(&temp.path().join("destination")).unwrap();
    let imported = batch(&dest, &bytes);
    let copied = commit(&mut dest, imported);
    assert_eq!(copied.counts.created_incomes, 5);
}

#[test]
fn workbook_failure_does_not_replace_destination_and_layout_supports_reading() {
    use std::io::Read;
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("只读样例.xlsx");
    std::fs::write(&file, b"previous").unwrap();
    let too_long = vec![vec!["名称".into()], vec!["字".repeat(32768)]];
    assert!(spreadsheet::write_workbook(&file, &[("明细", too_long)]).is_err());
    assert_eq!(std::fs::read(&file).unwrap(), b"previous");
    spreadsheet::write_workbook(
        &file,
        &[(
            "明细",
            rows(&[
                &["名称", "备注", "记录编号"],
                &["=普通文本", "第一行\n第二行", "000001"],
            ]),
        )],
    )
    .unwrap();
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&file).unwrap()).unwrap();
    let mut xml = String::new();
    zip.by_name("xl/worksheets/sheet1.xml")
        .unwrap()
        .read_to_string(&mut xml)
        .unwrap();
    assert!(xml.contains("<autoFilter"));
    assert!(xml.contains("state=\"frozen\""));
    assert!(xml.contains("hidden=\"1\""));
    let mut styles = String::new();
    zip.by_name("xl/styles.xml")
        .unwrap()
        .read_to_string(&mut styles)
        .unwrap();
    assert!(styles.contains("wrapText=\"1\""));
}
#[test]
fn item_workbook_preserves_text_unknown_zero_multiline_and_detects_edits() {
    let t = tempfile::tempdir().unwrap();
    let mut source = open_store(&t.path().join("source")).unwrap();
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
    for expected in [
        "说明",
        "物品",
        "账户",
        "完整盘点",
        "月度收入",
        "存钱目标",
        "目标关联账户",
        "盘点记录",
        "重要支出",
        "周期费用",
        "投资区间核对",
        "资金流动",
        "规划假设",
        "规划核对审计",
        "心愿清单",
        "维护记录",
        "保障记录",
        "虚拟资产",
        "储值充值",
        "储值余额记录",
        "业务提醒",
        "支出明细",
    ] {
        assert!(
            book.sheet_names().iter().any(|name| name == expected),
            "{expected}"
        );
    }
    assert_eq!(
        book.sheet_names().len(),
        book.sheet_names()
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
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
    let mut dest = open_store(&t.path().join("dest")).unwrap();
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
    let business_cells = |r: &[Data]| {
        r.iter()
            .enumerate()
            .filter(|(index, _)| !matches!(index, 0 | 17))
            .map(|(_, cell)| cell.clone())
            .collect::<Vec<_>>()
    };
    let mut original: Vec<_> = range.rows().skip(1).map(business_cells).collect();
    let mut copied: Vec<_> = other.rows().skip(1).map(business_cells).collect();
    original.sort_by_key(|r| r[0].to_string());
    copied.sort_by_key(|r| r[0].to_string());
    assert_eq!(original, copied);
}
#[test]
fn edited_item_xlsx_updates_existing_and_accepts_new_rows_and_excel_dates() {
    let t = tempfile::tempdir().unwrap();
    let mut store = open_store(&t.path().join("fictional")).unwrap();
    let asset = store
        .save_asset(
            &SaveAsset {
                base: Save {
                    request_id: id(),
                    generation: store.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构旧名称".into(),
                    price_cents: Some("123450".into()),
                    purchase_date: Some("2026-09-01".into()),
                },
                details: Details {
                    brand: "保留品牌".into(),
                    model: String::new(),
                    serial_number: "000123".into(),
                    notes: "原备注".into(),
                },
                photos: None,
                classification: None,
                options: None,
            },
            TODAY,
        )
        .unwrap();
    let exported = t.path().join("导出.xlsx");
    store.export_workbook(&exported).unwrap();
    let mut original: Xlsx<_> = calamine::open_workbook(&exported).unwrap();
    let original = original.worksheet_range("物品").unwrap();
    let titles = original.rows().next().unwrap();
    let col = |title: &str| {
        titles
            .iter()
            .position(|cell| cell.to_string().replace("（元）", "") == title)
            .unwrap()
    };
    let mut table = original
        .rows()
        .map(|r| r.iter().map(ToString::to_string).collect::<Vec<_>>())
        .collect::<Vec<_>>();
    table[1][col("名称")] = "虚构新名称".into();
    table[1][col("购入日期")] = "2026年9月2日".into();
    table[1][col("购入价")] = "￥1,250.50".into();
    table[1][col("备注")] = String::new();
    let mut added = vec![String::new(); titles.len()];
    added[col("名称")] = "虚构新增物品".into();
    added[col("购入价")] = "0".into();
    table.push(added);
    let edited = t.path().join("修改并新增.xlsx");
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("物品").unwrap();
    for (r, row) in table.iter().enumerate() {
        for (c, value) in row.iter().enumerate() {
            sheet.write_string(r as u32, c as u16, value).unwrap();
        }
    }
    let date = rust_xlsxwriter::ExcelDateTime::from_ymd(2026, 9, 3).unwrap();
    sheet
        .write_datetime_with_format(
            2,
            col("购入日期") as u16,
            &date,
            &rust_xlsxwriter::Format::new().set_num_format("yyyy/m/d"),
        )
        .unwrap();
    workbook.save(&edited).unwrap();
    let csv = spreadsheet::read_items(&std::fs::read(&edited).unwrap()).unwrap();
    let preview = store.preview_item_sheet(&csv, TODAY).unwrap();
    assert!(preview.invalid.is_empty(), "{:?}", preview.invalid);
    assert!(preview.conflicts.is_empty(), "{:?}", preview.conflicts);
    assert_eq!(
        (preview.additions, preview.updates, preview.unchanged),
        (1, 1, 0)
    );
    let result = store
        .import_item_sheet(
            &csv,
            &Commit {
                request_id: id(),
                generation: store.generation(),
                hash: preview.hash,
                include_duplicates: false,
            },
            TODAY,
        )
        .unwrap();
    assert_eq!((result.imported, result.updated), (2, 1));
    let after = t.path().join("再次导出.xlsx");
    store.export_workbook(&after).unwrap();
    let mut book: Xlsx<_> = calamine::open_workbook(&after).unwrap();
    let items = book.worksheet_range("物品").unwrap();
    let current = items
        .rows()
        .skip(1)
        .find(|r| r[0].to_string() == asset.asset.id)
        .unwrap();
    assert_eq!(current[col("名称")].to_string(), "虚构新名称");
    assert_eq!(current[col("购入价")].to_string(), "1250.50");
    assert_eq!(current[col("购入日期")].to_string(), "2026-09-02");
    assert_eq!(current[col("序列号")].to_string(), "000123");
    assert_eq!(current[col("品牌")].to_string(), "保留品牌");
    assert_eq!(current[col("备注")].to_string(), "");
    assert!(items
        .rows()
        .skip(1)
        .any(|r| r[col("名称")] == "虚构新增物品" && r[col("购入日期")] == "2026-09-03"));
}
#[test]
fn financial_sample_excel_transaction_replay_export_import_restart_backup() {
    let t = tempfile::tempdir().unwrap();
    let file = t.path().join("样例.xlsx");
    spreadsheet::write_template(&file, true).unwrap();
    let mut s = open_store(&t.path().join("source")).unwrap();
    let b = batch(&s, &std::fs::read(&file).unwrap());
    assert_eq!(b.files.len(), 3);
    let r = commit(&mut s, b.clone());
    assert_eq!(r.counts.created_accounts, 6);
    assert_eq!(r.counts.created_snapshots, 24);
    assert_eq!(r.counts.created_incomes, 25);
    let replay = commit(&mut s, b);
    assert_eq!(replay.request_id, r.request_id);
    let income = s.plan_income_list().unwrap().rows[0].clone();
    let source = s
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.fields.side == "asset")
        .unwrap();
    let classified = thingary_lib::plan_income::Fields {
        category: "cash_dividend".into(),
        source_account_id: Some(source.id),
        destination: Some("retained".into()),
        ..income.fields.clone()
    };
    s.plan_income_save(
        &thingary_lib::plan_income::Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: Some(income.id),
            expected_revision: Some(income.revision),
            fields: classified,
        },
        "2026-10-09",
    )
    .unwrap();
    let export = t.path().join("导出.xlsx");
    s.export_workbook(&export).unwrap();
    let mut dest = open_store(&t.path().join("dest")).unwrap();
    let b = batch(&dest, &std::fs::read(&export).unwrap());
    let copied = commit(&mut dest, b);
    assert_eq!(copied.counts.created_accounts, 6);
    assert_eq!(copied.counts.created_snapshots, 24);
    assert_eq!(copied.counts.created_incomes, 25);
    let classified = dest
        .plan_income_list()
        .unwrap()
        .rows
        .into_iter()
        .find(|i| i.fields.category == "cash_dividend")
        .unwrap();
    assert_eq!(classified.fields.destination.as_deref(), Some("retained"));
    assert_eq!(classified.fields.hpf_cents, income.fields.hpf_cents);
    let target_id = classified.fields.source_account_id.as_ref().unwrap();
    assert!(dest
        .wealth_accounts()
        .unwrap()
        .iter()
        .any(|a| &a.id == target_id));
    let normalize = |summary, accounts: Vec<thingary_lib::wealth::Account>| {
        let names: BTreeMap<_, _> = accounts
            .into_iter()
            .map(|a| (a.id, a.fields.name))
            .collect();
        // Import allocates new stable IDs. Compare each new read projection by
        // this fixture's unique account identity, while retaining every fact.
        assert_eq!(
            names
                .values()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            names.len()
        );
        let mut v = serde_json::to_value(summary).unwrap();
        for projection in ["structure_entries", "latest_entries"] {
            for entry in v[projection].as_array_mut().unwrap() {
                let name = names.get(entry["account_id"].as_str().unwrap()).unwrap();
                entry["account_id"] = serde_json::json!(name);
            }
        }
        v.as_object_mut().unwrap().remove("generation");
        for p in v["points"].as_array_mut().unwrap() {
            p.as_object_mut().unwrap().remove("snapshot_id");
            p.as_object_mut().unwrap().remove("compared_to");
        }
        v
    };
    assert_eq!(
        normalize(
            dest.wealth_summary().unwrap(),
            dest.wealth_accounts().unwrap()
        ),
        normalize(s.wealth_summary().unwrap(), s.wealth_accounts().unwrap())
    );
    let archive = t.path().join("完整.thingary");
    dest.backup(Some(&archive)).unwrap();
    drop(dest);
    let mut dest = open_store(&t.path().join("dest")).unwrap();
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
    let mut s = open_store(&t.path().join("s")).unwrap();
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
fn formulas_and_stray_cells_outside_imported_sheets_do_not_block_import() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("周边.xlsx");
    let mut book = rust_xlsxwriter::Workbook::new();
    let items = book.add_worksheet();
    items.set_name("物品").unwrap();
    items.write_string(0, 0, "名称").unwrap();
    items.write_string(1, 0, "台灯").unwrap();
    let scratch = book.add_worksheet();
    scratch.set_name("分析草稿").unwrap();
    scratch.write_string(0, 0, "名称").unwrap();
    scratch.write_formula(1, 0, "=1+1").unwrap();
    scratch.write_string(1_048_575, 5, "越界").unwrap();
    book.save(&path).unwrap();
    let csv = spreadsheet::read_items(&std::fs::read(&path).unwrap()).unwrap();
    assert!(String::from_utf8(csv).unwrap().contains("台灯"));

    // A finance import equally ignores a formula left in the item sheet.
    let mut book = rust_xlsxwriter::Workbook::new();
    let incomes = book.add_worksheet();
    incomes.set_name("月度收入").unwrap();
    for (i, h) in ["income_key", "date", "net_income"].iter().enumerate() {
        incomes.write_string(0, i as u16, *h).unwrap();
    }
    incomes.write_string(1, 0, "000123").unwrap();
    incomes.write_string(1, 1, "2026-09-10").unwrap();
    incomes.write_string(1, 2, "100.01").unwrap();
    let items = book.add_worksheet();
    items.set_name("物品").unwrap();
    items.write_string(0, 0, "名称").unwrap();
    items.write_formula(1, 0, "=1+1").unwrap();
    book.save(&path).unwrap();
    let files = spreadsheet::read_finance(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(files.len(), 1);

    // Inside an imported sheet a formula is still named and rejected.
    let mut book = rust_xlsxwriter::Workbook::new();
    let items = book.add_worksheet();
    items.set_name("物品").unwrap();
    items.write_string(0, 0, "名称").unwrap();
    items.write_formula(1, 0, "=1+1").unwrap();
    book.save(&path).unwrap();
    let err = spreadsheet::read_items(&std::fs::read(&path).unwrap()).unwrap_err();
    assert_eq!(err.code, "XLSX_FORMULA");
    assert!(err.message.contains("物品"), "{}", err.message);
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
    let s = open_store(&root).unwrap();
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
    let mut s = open_store(&root).unwrap();
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
    let mut s = open_store(&t.path().join("s")).unwrap();
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

fn financial_edit_records(s: &mut Store) -> (String, String, String) {
    use thingary_lib::{plan_income, wealth};
    let account = s
        .wealth_account_save(
            &wealth::AccountSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: wealth::AccountFields {
                    name: "虚构日常账户".into(),
                    institution: "虚构银行".into(),
                    side: "asset".into(),
                    kind: "cash".into(),
                    counted: true,
                    opened_on: "2026-01-01".into(),
                    closed_on: None,
                    notes: "普通保存，未经过导入".into(),
                    purchase_cents: None,
                    purchased_on: None,
                    group_id: None,
                    currency: "CNY".into(),
                    holding_mode: false,
                    holding_unit: None,
                },
            },
            TODAY,
        )
        .unwrap();
    let snapshot = s
        .wealth_snapshot_save(
            &wealth::SnapshotSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: "2026-09-30".into(),
                notes: "虚构完整盘点".into(),
                entries: vec![wealth::EntryInput {
                    account_id: account.id.clone(),
                    state: "entered".into(),
                    amount_cents: Some("10000".into()),
                    original_minor: None,
                    fx_rate_micro: None,
                    quantity_e8: None,
                    unit_price_e6: None,
                }],
                close_accounts: Vec::new(),
            },
            TODAY,
        )
        .unwrap();
    let income = s
        .plan_income_save(
            &plan_income::Save {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: plan_income::Fields {
                    date: "2026-09-30".into(),
                    net_cents: "1001".into(),
                    notes: "虚构利息".into(),
                    category: "interest".into(),
                    source_account_id: Some(account.id.clone()),
                    ..Default::default()
                },
            },
            TODAY,
        )
        .unwrap();
    assert_eq!(
        s.conn_for_test()
            .unwrap()
            .query_row("SELECT count(*) FROM import_external_key", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    (account.id, snapshot.id, income.id)
}

fn financial_edit_sheet<'a>(
    sheets: &'a mut [(String, Vec<Vec<String>>)],
    name: &str,
) -> &'a mut Vec<Vec<String>> {
    &mut sheets.iter_mut().find(|(n, _)| n == name).unwrap().1
}

fn financial_edit_cell(rows: &mut [Vec<String>], row: usize, title: &str, value: &str) {
    let column = rows[0].iter().position(|h| h == title).unwrap();
    rows[row].resize(rows[0].len(), String::new());
    rows[row][column] = value.into();
}

fn financial_edit_workbook(
    s: &Store,
    path: &std::path::Path,
    edit: impl FnOnce(&mut Vec<(String, Vec<Vec<String>>)>),
) -> Vec<u8> {
    s.export_workbook(path).unwrap();
    let mut book = Xlsx::new(Cursor::new(std::fs::read(path).unwrap())).unwrap();
    // Start from the real export, retaining its headers, IDs and reading sheets.
    let mut sheets: Vec<_> = book
        .sheet_names()
        .clone()
        .into_iter()
        .map(|name| {
            let range = book.worksheet_range(&name).unwrap();
            let rows = range
                .rows()
                .map(|r| r.iter().map(ToString::to_string).collect())
                .collect();
            (name, rows)
        })
        .collect();
    edit(&mut sheets);
    let sheets: Vec<_> = sheets
        .iter()
        .map(|(n, r)| (n.as_str(), r.clone()))
        .collect();
    spreadsheet::write_workbook(path, &sheets).unwrap();
    std::fs::read(path).unwrap()
}

fn financial_edit_batch(s: &Store, bytes: &[u8]) -> BatchInput {
    BatchInput {
        source_name: "历史表格".into(),
        mapping_set_id: "账户映射".into(),
        ..batch(s, bytes)
    }
}

fn financial_edit_commit_input(s: &Store, b: BatchInput) -> CommitInput {
    let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    assert!(p.can_commit, "{:?}", p.issues);
    CommitInput {
        request_id: id(),
        batch: b,
        context_digest: p.context_digest,
        normalized_digest: p.normalized_digest,
        file_fingerprints: p.file_fingerprints,
    }
}

#[test]
fn financial_export_edit_reimport_corrects_local_ids_and_adds_rows_atomically() {
    use thingary_lib::financial_import::Action;
    let temp = tempfile::tempdir().unwrap();
    let mut s = open_store(&temp.path().join("library")).unwrap();
    let (account_id, snapshot_id, income_id) = financial_edit_records(&mut s);
    let bytes = financial_edit_workbook(&s, &temp.path().join("编辑导出.xlsx"), |sheets| {
        let accounts = financial_edit_sheet(sheets, "账户");
        financial_edit_cell(accounts, 1, "账户名称", "虚构改名账户");
        financial_edit_cell(accounts, 1, "备注", "编辑后的备注\n仍为同一账户");
        accounts.push(accounts[1].clone());
        financial_edit_cell(accounts, 2, "账户编号", "");
        financial_edit_cell(accounts, 2, "账户名称", "虚构新增账户");
        financial_edit_cell(accounts, 2, "启用日期", "2026-10-01");
        let snapshots = financial_edit_sheet(sheets, "完整盘点");
        financial_edit_cell(snapshots, 1, "人民币金额（元）", "123.45");
        snapshots.push(snapshots[1].clone());
        financial_edit_cell(snapshots, 2, "盘点编号", "");
        financial_edit_cell(snapshots, 2, "盘点日期", "2026-10-02");
        financial_edit_cell(snapshots, 2, "账户编号", "");
        financial_edit_cell(snapshots, 2, "账户名称", "虚构改名账户");
        snapshots.push(snapshots[2].clone());
        financial_edit_cell(snapshots, 3, "账户名称", "虚构新增账户");
        financial_edit_cell(snapshots, 3, "人民币金额（元）", "0");
        let incomes = financial_edit_sheet(sheets, "月度收入");
        financial_edit_cell(incomes, 1, "税后到账（元）", "20.02");
        financial_edit_cell(incomes, 1, "到账日期", "2026-10-01");
        incomes.push(incomes[1].clone());
        financial_edit_cell(incomes, 2, "收入编号", "");
        financial_edit_cell(incomes, 2, "税后到账（元）", "5");
        financial_edit_cell(incomes, 2, "到账日期", "2026-10-02");
    });
    let mut b = financial_edit_batch(&s, &bytes);
    let changes = s.conn_for_test().unwrap().total_changes();
    let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    assert_eq!(s.conn_for_test().unwrap().total_changes(), changes);
    assert_eq!(p.counts.conflicts, 3, "{:?}", p.issues);
    assert!(!p.can_commit);
    for (kind, original) in [
        ("account", &account_id),
        ("snapshot", &snapshot_id),
        ("income", &income_id),
    ] {
        let object = p.objects.iter().find(|o| o.id == *original).unwrap();
        assert_eq!(object.kind, kind);
        assert_eq!(object.status, "conflict");
        assert_eq!(object.action, "unresolved");
        assert!(object.before.is_some());
        assert_ne!(object.before.as_ref(), Some(&object.after));
        b.actions.insert(
            object.key.clone(),
            Action {
                action: "correct".into(),
                expected_revision: object.expected_revision,
            },
        );
    }
    let blocked = CommitInput {
        request_id: id(),
        batch: financial_edit_batch(&s, &bytes),
        context_digest: p.context_digest,
        normalized_digest: p.normalized_digest,
        file_fingerprints: p.file_fingerprints,
    };
    assert_eq!(
        s.financial_import_commit(&blocked, TODAY).unwrap_err().code,
        "IMPORT_INVALID"
    );
    assert_eq!(s.wealth_accounts().unwrap().len(), 1);
    let input = financial_edit_commit_input(&s, b);
    let receipt = s.financial_import_commit(&input, TODAY).unwrap();
    assert_eq!(receipt.counts.corrected, 3);
    assert_eq!(receipt.counts.created_accounts, 1);
    assert_eq!(receipt.counts.created_snapshots, 1);
    assert_eq!(receipt.counts.created_incomes, 1);
    let accounts = s.wealth_accounts().unwrap();
    assert_eq!(accounts.len(), 2);
    let account = accounts.iter().find(|a| a.id == account_id).unwrap();
    assert_eq!(account.fields.name, "虚构改名账户");
    assert_eq!(account.fields.notes, "编辑后的备注\n仍为同一账户");
    assert_eq!(account.revision, 2);
    let snapshot = s.wealth_snapshot(&snapshot_id).unwrap().unwrap();
    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.entries[0].amount_cents.as_deref(), Some("12345"));
    assert!(snapshot.missing.is_empty());
    assert_eq!(s.wealth_summary().unwrap().points.len(), 2);
    let income = s.plan_income(&income_id).unwrap().unwrap();
    assert_eq!(income.revision, 2);
    assert_eq!(income.fields.date, "2026-10-01");
    assert_eq!(income.fields.net_cents, "2002");
    assert_eq!(income.fields.hpf_cents, None);
    assert_eq!(
        income.fields.source_account_id.as_deref(),
        Some(account_id.as_str())
    );
    assert_eq!(s.plan_income_list().unwrap().rows.len(), 2);
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap().request_id,
        receipt.request_id
    );
    let mut retry = input;
    retry.request_id = id();
    assert_eq!(
        s.financial_import_commit(&retry, TODAY).unwrap().request_id,
        receipt.request_id
    );
    // A fresh export uses local IDs even for rows first created by an import.
    let path = temp.path().join("再次导出.xlsx");
    s.export_workbook(&path).unwrap();
    let fresh = financial_edit_batch(&s, &std::fs::read(path).unwrap());
    let p = s
        .financial_import_preview(&fresh, TODAY, &|| false)
        .unwrap();
    assert_eq!(p.counts.same, 6, "{:?}", p.issues);
    assert_eq!(
        p.counts.new_accounts + p.counts.new_snapshots + p.counts.new_incomes,
        0
    );
    assert!(p.can_commit, "{:?}", p.issues);
}

#[test]
fn financial_export_edit_reimport_single_sheets_resolve_local_references() {
    use thingary_lib::financial_import::Action;
    for kind in ["snapshots", "incomes"] {
        let temp = tempfile::tempdir().unwrap();
        let mut s = open_store(&temp.path().join("library")).unwrap();
        let (account, snapshot, income) = financial_edit_records(&mut s);
        let bytes = financial_edit_workbook(&s, &temp.path().join("单表编辑.xlsx"), |sheets| {
            if kind == "snapshots" {
                let rows = financial_edit_sheet(sheets, "完整盘点");
                financial_edit_cell(rows, 1, "人民币金额（元）", "222.22");
                financial_edit_cell(rows, 1, "盘点日期", "2026-09-29");
            } else {
                let rows = financial_edit_sheet(sheets, "月度收入");
                financial_edit_cell(rows, 1, "税后到账（元）", "222.22");
                financial_edit_cell(rows, 1, "到账日期", "2026-10-01");
            }
        });
        let mut b = financial_edit_batch(&s, &bytes);
        b.files.retain(|f| f.kind == kind);
        if kind == "incomes" {
            // The income-only UI uses a separate mapping namespace.
            b.mapping_set_id = "收入映射".into();
        }
        let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
        assert!(!p.issues.iter().any(|i| i.blocking), "{:?}", p.issues);
        assert_eq!(p.counts.conflicts, 1);
        assert_eq!(p.external_keys.get(&account), Some(&account));
        let object = &p.objects[0];
        assert_eq!(
            object.id,
            if kind == "snapshots" {
                &snapshot
            } else {
                &income
            }
            .as_str()
        );
        b.actions.insert(
            object.key.clone(),
            Action {
                action: "keep".into(),
                expected_revision: object.expected_revision,
            },
        );
        assert_eq!(commit(&mut s, b.clone()).counts.skipped, 1);
        assert_eq!(
            s.wealth_snapshot(&snapshot).unwrap().unwrap().date,
            "2026-09-30"
        );
        assert_eq!(
            s.plan_income(&income).unwrap().unwrap().fields.net_cents,
            "1001"
        );
        b.actions.get_mut(&object.key).unwrap().action = "correct".into();
        let receipt = commit(&mut s, b);
        assert_eq!(receipt.counts.corrected, 1);
        assert_eq!(s.wealth_accounts().unwrap().len(), 1);
        assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
        assert_eq!(s.plan_income_list().unwrap().rows.len(), 1);
        if kind == "snapshots" {
            let snapshot = s.wealth_snapshot(&snapshot).unwrap().unwrap();
            assert_eq!(snapshot.date, "2026-09-29");
            assert_eq!(snapshot.entries[0].amount_cents.as_deref(), Some("22222"));
        } else {
            let income = s.plan_income(&income).unwrap().unwrap();
            assert_eq!(income.fields.date, "2026-10-01");
            assert_eq!(income.fields.net_cents, "22222");
            assert_eq!(
                income.fields.source_account_id.as_deref(),
                Some(account.as_str())
            );
        }
    }
}

#[test]
fn financial_export_edit_reimport_rejects_stale_context_and_correction_revisions() {
    use thingary_lib::{financial_import::Action, plan_income, wealth};
    let temp = tempfile::tempdir().unwrap();
    let mut s = open_store(&temp.path().join("library")).unwrap();
    let (account, _, income) = financial_edit_records(&mut s);
    let bytes = financial_edit_workbook(&s, &temp.path().join("过期预览.xlsx"), |sheets| {
        financial_edit_cell(
            financial_edit_sheet(sheets, "月度收入"),
            1,
            "税后到账（元）",
            "123",
        );
    });
    let mut b = financial_edit_batch(&s, &bytes);
    b.files.retain(|f| f.kind == "incomes");
    let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    b.actions.insert(
        p.objects[0].key.clone(),
        Action {
            action: "correct".into(),
            expected_revision: p.objects[0].expected_revision,
        },
    );
    let input = financial_edit_commit_input(&s, b.clone());
    let a = s.wealth_accounts().unwrap().remove(0);
    s.wealth_account_save(
        &wealth::AccountSave {
            request_id: id(),
            generation: s.generation(),
            id: Some(account),
            expected_revision: Some(a.revision),
            fields: wealth::AccountFields {
                notes: "预览后账户变化".into(),
                ..a.fields
            },
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    assert!(s
        .financial_import_receipt(&input.request_id, &s.generation())
        .unwrap()
        .is_none());
    assert_eq!(
        s.plan_income(&income).unwrap().unwrap().fields.net_cents,
        "1001"
    );
    let input = financial_edit_commit_input(&s, b.clone());
    let current = s.plan_income(&income).unwrap().unwrap();
    s.plan_income_save(
        &plan_income::Save {
            request_id: id(),
            generation: s.generation(),
            id: Some(income.clone()),
            expected_revision: Some(current.revision),
            fields: plan_income::Fields {
                notes: "预览后收入变化".into(),
                ..current.fields
            },
        },
        TODAY,
    )
    .unwrap();
    assert_eq!(
        s.financial_import_commit(&input, TODAY).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        s.financial_import_preview(&b, TODAY, &|| false)
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    assert_eq!(
        s.plan_income(&income).unwrap().unwrap().fields.net_cents,
        "1001"
    );
}

fn financial_edit_delete(s: &mut Store, kind: &str, record: &str, revision: i64, purge: bool) {
    s.wealth_trash(&thingary_lib::wealth::TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: kind.into(),
        id: record.into(),
        expected_revision: revision,
        deleted: true,
    })
    .unwrap();
    if purge {
        s.purge_trash(&thingary_lib::purge::Purge {
            request_id: id(),
            generation: s.generation(),
            kind: Some(kind.into()),
            id: record.into(),
            preview: None,
        })
        .unwrap();
    }
}

#[test]
fn financial_export_edit_reimport_preserves_deleted_ids_and_purged_tombstones() {
    for (kind, file_kind, sheet, title) in [
        ("account", "accounts", "账户", "备注"),
        ("snapshot", "snapshots", "完整盘点", "备注"),
        ("income", "incomes", "月度收入", "备注"),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let mut s = open_store(&temp.path().join("library")).unwrap();
        let (account, snapshot, income) = financial_edit_records(&mut s);
        if kind == "account" {
            // Accounts with history cannot be deleted through the normal API.
            financial_edit_delete(&mut s, "snapshot", &snapshot, 1, true);
            financial_edit_delete(&mut s, "income", &income, 1, true);
        }
        let original = match kind {
            "account" => &account,
            "snapshot" => &snapshot,
            _ => &income,
        };
        let bytes = financial_edit_workbook(&s, &temp.path().join("删除前导出.xlsx"), |_| {});
        let mut unchanged = financial_edit_batch(&s, &bytes);
        unchanged.files.retain(|f| f.kind == file_kind);
        // Establish the mapping through the real same-record import path.
        assert_eq!(commit(&mut s, unchanged).counts.skipped, 1);
        let bytes = financial_edit_workbook(&s, &temp.path().join("编辑旧表.xlsx"), |sheets| {
            financial_edit_cell(
                financial_edit_sheet(sheets, sheet),
                1,
                title,
                "删除后不能回导复活",
            );
        });
        financial_edit_delete(&mut s, kind, original, 1, false);
        for purged in [false, true] {
            if purged {
                s.purge_trash(&thingary_lib::purge::Purge {
                    request_id: id(),
                    generation: s.generation(),
                    kind: Some(kind.into()),
                    id: original.clone(),
                    preview: None,
                })
                .unwrap();
            }
            let mut b = financial_edit_batch(&s, &bytes);
            b.files.retain(|f| f.kind == file_kind);
            for fresh_namespace in [false, true] {
                if fresh_namespace {
                    b.mapping_set_id = "虚构另一组".into();
                }
                let changes = s.conn_for_test().unwrap().total_changes();
                let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
                assert!(!p.can_commit);
                assert!(
                    p.issues.iter().any(|i| i.code == "IMPORT_TOMBSTONE"),
                    "{kind}: {:?}",
                    p.issues
                );
                assert_eq!(p.objects[0].id, *original);
                assert_eq!(p.objects[0].status, "error");
                assert_eq!(changes, s.conn_for_test().unwrap().total_changes());
            }
        }
    }
}

#[test]
fn financial_export_edit_reimport_corrects_visible_chinese_enums() {
    use thingary_lib::financial_import::Action;
    let temp = tempfile::tempdir().unwrap();
    let mut s = open_store(&temp.path().join("library")).unwrap();
    let (account_id, snapshot_id, income_id) = financial_edit_records(&mut s);
    let bytes = financial_edit_workbook(&s, &temp.path().join("可见枚举.xlsx"), |sheets| {
        let accounts = financial_edit_sheet(sheets, "账户");
        let id = accounts[0].iter().position(|h| h == "账户编号").unwrap();
        assert_eq!(accounts[1][id], account_id);
        financial_edit_cell(accounts, 1, "账户类型", "其他资产");
        financial_edit_cell(accounts, 1, "计入净资产", "否");
        let snapshots = financial_edit_sheet(sheets, "完整盘点");
        let id = snapshots[0].iter().position(|h| h == "盘点编号").unwrap();
        assert_eq!(snapshots[1][id], snapshot_id);
        financial_edit_cell(snapshots, 1, "当时账户类型", "投资账户");
        financial_edit_cell(snapshots, 1, "当时计入净资产", "否");
        let incomes = financial_edit_sheet(sheets, "月度收入");
        let id = incomes[0].iter().position(|h| h == "收入编号").unwrap();
        assert_eq!(incomes[1][id], income_id);
        financial_edit_cell(incomes, 1, "收入分类", "其他投资收入");
        financial_edit_cell(incomes, 1, "收入去向", "去向待核对");
    });
    // A visible value must override the hidden canonical cell, not be ignored.
    let mut b = financial_edit_batch(&s, &bytes);
    let changes = s.conn_for_test().unwrap().total_changes();
    let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
    assert_eq!(changes, s.conn_for_test().unwrap().total_changes());
    assert!(!p.can_commit);
    assert_eq!(p.counts.conflicts, 3, "{:?}", p.issues);
    let account = p.objects.iter().find(|o| o.id == account_id).unwrap();
    let snapshot = p.objects.iter().find(|o| o.id == snapshot_id).unwrap();
    let income = p.objects.iter().find(|o| o.id == income_id).unwrap();
    assert_eq!(account.after["kind"], "other_asset");
    assert_eq!(account.after["counted"], false);
    assert_eq!(snapshot.after["entries"][0]["kind"], "investment");
    assert_eq!(snapshot.after["entries"][0]["counted"], false);
    assert_eq!(income.after["category"], "other_investment");
    assert_eq!(income.after["destination"], "unknown");
    for object in [account, snapshot, income] {
        b.actions.insert(
            object.key.clone(),
            Action {
                action: "correct".into(),
                expected_revision: object.expected_revision,
            },
        );
    }
    let receipt = commit(&mut s, b);
    assert_eq!(receipt.counts.corrected, 3);
    let account = s
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.id == account_id)
        .unwrap();
    assert_eq!(account.fields.kind, "other_asset");
    assert!(!account.fields.counted);
    let snapshot = s.wealth_snapshot(&snapshot_id).unwrap().unwrap();
    assert_eq!(snapshot.entries[0].kind, "investment");
    assert!(!snapshot.entries[0].counted);
    let income = s.plan_income(&income_id).unwrap().unwrap();
    assert_eq!(income.fields.category, "other_investment");
    assert_eq!(income.fields.destination.as_deref(), Some("unknown"));
    assert_eq!(
        income.fields.source_account_id.as_deref(),
        Some(account_id.as_str())
    );
    assert_eq!(s.wealth_accounts().unwrap().len(), 1);
    assert_eq!(s.wealth_summary().unwrap().points.len(), 1);
    assert_eq!(s.plan_income_list().unwrap().rows.len(), 1);
}

#[test]
fn financial_export_edit_reimport_rejects_each_unknown_visible_chinese_enum() {
    let temp = tempfile::tempdir().unwrap();
    let mut s = open_store(&temp.path().join("library")).unwrap();
    let (account, snapshot, income) = financial_edit_records(&mut s);
    for (sheet, title, value, code) in [
        ("账户", "账户类型", "虚构未知类型", "KIND_INVALID"),
        ("账户", "计入净资产", "也许", "BOOL_INVALID"),
        ("完整盘点", "当时账户类型", "虚构未知类型", "KIND_INVALID"),
        ("完整盘点", "当时计入净资产", "也许", "BOOL_INVALID"),
        (
            "月度收入",
            "收入分类",
            "虚构未知分类",
            "INCOME_CLASSIFICATION",
        ),
        (
            "月度收入",
            "收入去向",
            "虚构未知去向",
            "INCOME_CLASSIFICATION",
        ),
    ] {
        let unknown =
            financial_edit_workbook(&s, &temp.path().join("未知枚举.xlsx"), |sheets| {
                financial_edit_cell(financial_edit_sheet(sheets, sheet), 1, title, value)
            });
        let b = financial_edit_batch(&s, &unknown);
        let changes = s.conn_for_test().unwrap().total_changes();
        let p = s.financial_import_preview(&b, TODAY, &|| false).unwrap();
        assert!(!p.can_commit, "{sheet}/{title}: silently accepted {value}");
        assert!(
            p.issues.iter().any(|i| i.blocking && i.code == code),
            "{sheet}/{title}: {:?}",
            p.issues
        );
        assert_eq!(changes, s.conn_for_test().unwrap().total_changes());
        let input = CommitInput {
            request_id: id(),
            batch: b,
            context_digest: p.context_digest,
            normalized_digest: p.normalized_digest,
            file_fingerprints: p.file_fingerprints,
        };
        assert_eq!(
            s.financial_import_commit(&input, TODAY).unwrap_err().code,
            "IMPORT_INVALID",
            "{sheet}/{title}"
        );
        assert!(s
            .financial_import_receipt(&input.request_id, &s.generation())
            .unwrap()
            .is_none());
        assert_eq!(s.wealth_accounts().unwrap().len(), 1);
        assert_eq!(s.wealth_accounts().unwrap()[0].id, account);
        let unchanged = s.wealth_snapshot(&snapshot).unwrap().unwrap();
        assert_eq!(unchanged.revision, 1);
        assert_eq!(unchanged.entries[0].kind, "cash");
        assert!(unchanged.entries[0].counted);
        let unchanged = s.plan_income(&income).unwrap().unwrap();
        assert_eq!(unchanged.revision, 1);
        assert_eq!(unchanged.fields.category, "interest");
        assert_eq!(unchanged.fields.destination, None);
    }
}
