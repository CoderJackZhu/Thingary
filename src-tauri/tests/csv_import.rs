use thingary_lib::{
    csv_import::{template, Commit, Done},
    domain::Error,
    storage::Store,
};

const TODAY: &str = "2026-09-20";

fn commit(s: &Store, bytes: &[u8], include_duplicates: bool) -> Commit {
    Commit {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        hash: s.preview_csv_import(bytes, TODAY).unwrap().hash,
        include_duplicates,
    }
}
fn import(s: &mut Store, csv: &str, include_duplicates: bool) -> Result<Done, Error> {
    let input = commit(s, csv.as_bytes(), include_duplicates);
    s.import_csv(csv.as_bytes(), &input, TODAY)
}
/// Exported rows without the per-library 档案编号, sorted for comparison.
fn rows(s: &Store) -> Vec<String> {
    let csv = s.asset_csv().unwrap();
    let mut out: Vec<String> = csv
        .split("\r\n")
        .skip(1)
        .filter(|l| !l.is_empty())
        .map(|l| {
            // Version protects edits in one library; it is not a business
            // value and new copies start with their own revision.
            l.split_once(',')
                .unwrap()
                .1
                .rsplit_once(',')
                .unwrap()
                .0
                .to_owned()
        })
        .collect();
    out.sort();
    out
}

const SOURCE: &str =
    "名称,分类,品牌,型号,购入价（元）,币种,购入日期,渠道,状态,退役日期,售出日期,售价（元）,备注\n\
笔记本,电脑与办公,苹果,M4,\"¥12,999.5\",CNY,2026/1/5,新渠道,使用中,,,,\"多行\n备注\"\n\
旧耳机,新分类,,,300,,2025-03-01,,已退役,2026-02-01,,,'=公式\n\
旧相机,影音摄影,,,5000,人民币,2024-01-01,,已售出,2025-01-01,2026-01-01,2000,\n\
,,,,,,,,,,,,\n\
没名字的备注行被忽略吗,,,,abc,,,,,,,,\n\
未来,,,,,,2099-01-01,,,,,,\n\
售出缺价,,,,,,,,已售出,,2026-01-01,,\n";

#[test]
fn d21_import_previews_then_adds_and_round_trips() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let p = s.preview_csv_import(SOURCE.as_bytes(), TODAY).unwrap();
    assert_eq!(p.valid, 3);
    assert_eq!(
        p.invalid.iter().map(|n| n.line).collect::<Vec<_>>(),
        vec![7, 8, 9],
        "blank row skipped; lines count the quoted line break"
    );
    assert!(p.invalid[0].reason.contains("金额"));
    assert!(p.invalid[1].reason.contains("晚于今天"));
    assert!(p.invalid[2].reason.contains("售价"));
    assert_eq!(p.new_categories, vec!["新分类"]);
    assert_eq!(p.new_channels, vec!["新渠道"]);
    assert_eq!(s.count().unwrap(), 0, "preview writes nothing");

    let done = import(&mut s, SOURCE, false).unwrap();
    assert_eq!((done.imported, done.invalid), (3, 3));
    let first = rows(&s);
    assert!(
        first.iter().any(|r| r.starts_with(
            "笔记本,电脑与办公,苹果,M4,12999.50,CNY,2026-01-05,新渠道,使用中,,,,\"多行\n备注\""
        )),
        "{first:?}"
    );
    assert!(
        first
            .iter()
            .any(|r| r
                .starts_with("旧耳机,新分类,,,300.00,CNY,2025-03-01,,已退役,2026-02-01,,,'=公式")),
        "{first:?}"
    );
    assert!(
        first.iter().any(|r| r
            .starts_with("旧相机,影音摄影,,,5000.00,CNY,2024-01-01,,已售出,,2026-01-01,2000.00,")),
        "{first:?}"
    );

    // The export itself imports into another library unchanged.
    let other = tempfile::tempdir().unwrap();
    let mut t = Store::open(other.path()).unwrap();
    let exported = s.asset_csv().unwrap();
    assert_eq!(import(&mut t, &exported, false).unwrap().imported, 3);
    assert_eq!(rows(&t), first);

    // Importing again: all three are suspected duplicates, skipped by default.
    let p = t.preview_csv_import(exported.as_bytes(), TODAY).unwrap();
    assert_eq!(p.duplicates.len(), 3);
    assert_eq!(
        import(&mut t, &exported, false).unwrap_err().code,
        "CSV_NOTHING"
    );
    assert_eq!(t.count().unwrap(), 3);
    assert_eq!(import(&mut t, &exported, true).unwrap().imported, 3);
    assert_eq!(t.count().unwrap(), 6);
}

#[test]
fn d21_import_is_all_or_nothing_and_checks_the_file() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    assert_eq!(
        import(&mut s, &template(), false).unwrap_err().code,
        "CSV_NOTHING"
    );
    assert_eq!(
        s.preview_csv_import("品牌\n苹果\n".as_bytes(), TODAY)
            .unwrap_err()
            .code,
        "CSV_HEADER"
    );
    assert_eq!(
        s.preview_csv_import(&[0xC4, 0xE3, b'\n'], TODAY)
            .unwrap_err()
            .code,
        "CSV_ENCODING"
    );

    let csv = "名称,分类\n甲,全新分类\n乙,\n";
    let input = commit(&s, csv.as_bytes(), false);
    let changed = "名称,分类\n甲,全新分类\n乙,\n丙,\n";
    assert_eq!(
        s.import_csv(changed.as_bytes(), &input, TODAY)
            .unwrap_err()
            .code,
        "CSV_CHANGED"
    );

    s.set_hook(|p| {
        if p == "csv_import.before_commit" {
            Err(Error::new("FAULT", "注入"))
        } else {
            Ok(())
        }
    });
    assert!(s.import_csv(csv.as_bytes(), &input, TODAY).is_err());
    assert_eq!(s.count().unwrap(), 0, "rolled back");
    assert!(!s
        .taxonomy_snapshot()
        .unwrap()
        .categories
        .iter()
        .any(|c| c.name == "全新分类"));

    s.set_hook(|_| Ok(()));
    let done = s.import_csv(csv.as_bytes(), &input, TODAY).unwrap();
    assert_eq!(done.imported, 2);
    assert_eq!(
        s.import_csv(csv.as_bytes(), &input, TODAY).unwrap(),
        done,
        "same request replays"
    );
    assert_eq!(s.count().unwrap(), 2);
}

#[test]
fn duplicate_rows_inside_one_file_are_flagged_like_library_duplicates() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let csv = "名称,购入价（元）,购入日期\n台灯,100,2026-01-01\n台灯,100,2026-01-01\n台灯,,\n";
    let p = s.preview_csv_import(csv.as_bytes(), TODAY).unwrap();
    assert_eq!(p.valid, 3);
    assert_eq!(
        p.duplicates.len(),
        1,
        "only the repeated row, not the first"
    );
    assert_eq!(p.duplicates[0].line, 3);
    assert!(p.duplicates[0].reason.contains("文件内"));
    // Default skips the in-file repeat; forcing it imports both rows.
    assert_eq!(import(&mut s, csv, false).unwrap().imported, 2);
    assert_eq!(s.count().unwrap(), 2);
    let csv = "名称,购入价（元）,购入日期\n台灯,100,2026-01-01\n台灯,100,2026-01-01\n";
    let input = commit(&s, csv.as_bytes(), true);
    assert_eq!(
        s.import_csv(csv.as_bytes(), &input, TODAY)
            .unwrap()
            .imported,
        2
    );
    assert_eq!(s.count().unwrap(), 4);
}

#[test]
fn item_import_receipt_reports_only_the_original_request() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let csv = "名称\n甲\n";
    let input = commit(&s, csv.as_bytes(), false);
    assert!(
        s.item_import_receipt(&input).unwrap().is_none(),
        "not committed yet"
    );
    let done = s.import_csv(csv.as_bytes(), &input, TODAY).unwrap();
    assert_eq!(s.item_import_receipt(&input).unwrap().unwrap(), done);
    let mut other = input.clone();
    other.include_duplicates = true;
    assert_eq!(
        s.item_import_receipt(&other).unwrap_err().code,
        "REQUEST_CONFLICT"
    );
    let mut stale = input.clone();
    stale.generation = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        s.item_import_receipt(&stale).unwrap_err().code,
        "STALE_DATASET"
    );
    let mut unknown = input.clone();
    unknown.request_id = uuid::Uuid::new_v4().to_string();
    assert!(s.item_import_receipt(&unknown).unwrap().is_none());
}

#[test]
fn imported_sales_keep_backup_valid_and_old_libraries_are_repaired() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let csv = "名称,购入价（元）,购入日期,状态,退役日期,售出日期,售价（元）\n\
旧相机,5000,2024-01-01,已售出,,2026-01-01,2000\n\
旧耳机,300,2024-02-01,已售出,2025-01-01,2026-01-01,100\n";
    assert_eq!(import(&mut s, csv, false).unwrap().imported, 2);
    let out = tempfile::tempdir().unwrap();
    s.backup(Some(&out.path().join("a.thingary"))).unwrap();
    // A library imported before the fix: audits with no saved reply.
    drop(s);
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.path().join("active.json")).unwrap()).unwrap();
    let db = root
        .path()
        .join("datasets")
        .join(active["id"].as_str().unwrap())
        .join("data.sqlite");
    let raw = rusqlite::Connection::open(&db).unwrap();
    raw.execute(
        "DELETE FROM requests WHERE id IN (SELECT request_id FROM sale_audit)",
        [],
    )
    .unwrap();
    drop(raw);
    let mut s = Store::open(root.path()).unwrap();
    s.backup(Some(&out.path().join("c.thingary"))).unwrap();
    assert_eq!(import(&mut s, csv, true).unwrap().imported, 2);
    s.backup(Some(&out.path().join("d.thingary"))).unwrap();
}

#[test]
fn extra_original_currency_columns_do_not_block_item_import() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    // The exported item sheet carries three extra original-currency columns;
    // import reads the columns it knows by name and ignores the rest.
    let csv = "名称,购入价（元）,币种,原币币种,原币金额,汇率\n\
虚构台灯,9253.30,CNY,USD,1299.00,7.123400\n\
虚构耳机,100,CNY,,,\n";
    let p = s.preview_csv_import(csv.as_bytes(), TODAY).unwrap();
    assert_eq!(p.valid, 2);
    assert!(p.invalid.is_empty(), "{:?}", p.invalid);
    let done = import(&mut s, csv, false).unwrap();
    assert_eq!((done.imported, done.invalid), (2, 0));
    assert_eq!(s.count().unwrap(), 2);
    let rows = rows(&s);
    assert!(
        rows.iter()
            .any(|r| r.starts_with("虚构台灯,,,,") && r.contains("9253.30,CNY")),
        "{rows:?}"
    );
}

#[test]
fn edited_export_updates_the_item_and_new_rows_still_add() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    import(
        &mut s,
        "名称,品牌,序列号,购入价,购入日期,备注\n虚构相机,虚构品牌,TEST-001,100,2026/1/2,原备注\n",
        false,
    )
    .unwrap();
    let csv = s.asset_csv().unwrap();
    let (item_id, _) = csv.lines().nth(1).unwrap().split_once(',').unwrap();
    let item_id = item_id.to_owned();
    let record = s.record(&item_id).unwrap().unwrap();
    let edited = csv
        .replace("虚构相机,", "虚构新相机,")
        .replace("100.00,CNY", "0,CNY")
        .replace("2026-01-02", "2026年1月3日")
        .replace("原备注", "新备注");
    let mixed = format!("{edited},虚构新项目\n");
    let p = s.preview_csv_import(mixed.as_bytes(), TODAY).unwrap();
    assert!(p.invalid.is_empty(), "{:?}", p.invalid);
    assert!(p.conflicts.is_empty(), "{:?}", p.conflicts);
    assert_eq!((p.additions, p.updates, p.unchanged), (1, 1, 0));
    assert!(p.changes[0].changed.contains(&"购入价".into()));
    assert_eq!(s.count().unwrap(), 1, "preview is read-only");
    let input = commit(&s, mixed.as_bytes(), false);
    let done = s.import_csv(mixed.as_bytes(), &input, TODAY).unwrap();
    assert_eq!((done.imported, done.updated), (2, 1));
    assert_eq!(s.item_import_receipt(&input).unwrap(), Some(done.clone()));
    assert_eq!(s.import_csv(mixed.as_bytes(), &input, TODAY).unwrap(), done);
    assert_eq!(
        s.count().unwrap(),
        2,
        "update never creates a second camera"
    );
    let current = s.record(&item_id).unwrap().unwrap();
    assert_eq!(current.asset.name, "虚构新相机");
    assert_eq!(current.asset.price_cents.as_deref(), Some("0"));
    assert_eq!(current.asset.purchase_date.as_deref(), Some("2026-01-03"));
    assert_eq!(current.details.serial_number, record.details.serial_number);
    assert_eq!(current.details.notes, "新备注");
    assert_eq!(current.asset.revision, record.asset.revision + 1);
    let exported = s.asset_csv().unwrap();
    let p = s.preview_csv_import(exported.as_bytes(), TODAY).unwrap();
    assert_eq!((p.updates, p.unchanged), (0, 2));
    assert_eq!(import(&mut s, &exported, false).unwrap().unchanged, 2);
}

#[test]
fn partial_edits_preserve_omitted_fields_and_stale_or_repeated_ids_block_all_writes() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    import(
        &mut s,
        "名称,品牌,序列号,购入价,购入日期,备注\n虚构台灯,品牌,TEST-002,100,2026/1/2,原备注\n",
        false,
    )
    .unwrap();
    let exported = s.asset_csv().unwrap();
    let item_id = exported.lines().nth(1).unwrap().split_once(',').unwrap().0;
    let record = s.record(item_id).unwrap().unwrap();
    let partial = format!(
        "档案编号,档案版本,名称,备注\n{item_id},{},改名,\n",
        record.asset.revision
    );
    assert_eq!(import(&mut s, &partial, false).unwrap().updated, 1);
    let changed = s.record(item_id).unwrap().unwrap();
    assert_eq!(changed.details.notes, "", "explicit blank clears notes");
    assert_eq!(
        changed.details.serial_number, "TEST-002",
        "omitted fields survive"
    );
    assert_eq!(changed.asset.price_cents.as_deref(), Some("10000"));
    let stale = format!("{partial},,新增行,\n");
    let input = commit(&s, stale.as_bytes(), false);
    assert_eq!(
        s.preview_csv_import(stale.as_bytes(), TODAY)
            .unwrap()
            .conflicts
            .len(),
        1
    );
    assert_eq!(
        s.import_csv(stale.as_bytes(), &input, TODAY)
            .unwrap_err()
            .code,
        "CSV_CONFLICT"
    );
    assert_eq!(s.count().unwrap(), 1);
    assert!(s.item_import_receipt(&input).unwrap().is_none());
    let repeated = format!(
        "档案编号,档案版本,名称\n{item_id},{0},甲\n{item_id},{0},乙\n",
        changed.asset.revision
    );
    assert_eq!(
        s.preview_csv_import(repeated.as_bytes(), TODAY)
            .unwrap()
            .conflicts
            .len(),
        1
    );
    assert_eq!(
        import(&mut s, &repeated, false).unwrap_err().code,
        "CSV_CONFLICT"
    );
    let stale_invalid = format!(
        "档案编号,档案版本,名称,购入价\n{item_id},{},改名,abc\n,,新增行,0\n",
        record.asset.revision
    );
    let preview = s
        .preview_csv_import(stale_invalid.as_bytes(), TODAY)
        .unwrap();
    assert_eq!((preview.conflicts.len(), preview.invalid.len()), (1, 1));
    assert_eq!(
        import(&mut s, &stale_invalid, false).unwrap_err().code,
        "CSV_CONFLICT"
    );
    let repeated_invalid = format!(
        "档案编号,档案版本,名称,购入价\n{item_id},{0},甲,abc\n{item_id},{0},乙,0\n",
        changed.asset.revision
    );
    assert_eq!(
        s.preview_csv_import(repeated_invalid.as_bytes(), TODAY)
            .unwrap()
            .conflicts
            .len(),
        1
    );
    assert_eq!(
        import(&mut s, &repeated_invalid, false).unwrap_err().code,
        "CSV_CONFLICT"
    );
    assert_eq!(s.count().unwrap(), 1);
    s.backup(Some(&root.path().join("虚构修改.thingary")))
        .unwrap();
}

#[test]
fn lifecycle_columns_cannot_silently_rewrite_history() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    import(
        &mut s,
        "名称,购入价,购入日期,状态,退役日期\n虚构退役物品,0,2026-01-01,已退役,2026-02-01\n",
        false,
    )
    .unwrap();
    let exported = s.asset_csv().unwrap();
    let item_id = exported.lines().nth(1).unwrap().split_once(',').unwrap().0;
    let edited = exported.replace("虚构退役物品", "改名退役物品");
    assert_eq!(import(&mut s, &edited, false).unwrap().updated, 1);
    assert_eq!(
        s.record(item_id).unwrap().unwrap().lifecycle.events.len(),
        1
    );
    let exported = s.asset_csv().unwrap().replace("2026-02-01", "2026-03-01");
    assert_eq!(
        s.preview_csv_import(exported.as_bytes(), TODAY)
            .unwrap()
            .conflicts
            .len(),
        1
    );
    assert_eq!(
        import(&mut s, &exported, false).unwrap_err().code,
        "CSV_CONFLICT"
    );
    import(
        &mut s,
        "名称,购入价,购入日期,状态,售出日期,售价\n虚构售出物品,0,2026-01-01,已售出,2026-04-01,0\n",
        false,
    )
    .unwrap();
    let exported = s.asset_csv().unwrap();
    let records = thingary_lib::spreadsheet::csv_text(&[
        vec![
            "档案编号".into(),
            "档案版本".into(),
            "名称".into(),
            "退役日期".into(),
        ],
        {
            let sold = exported
                .lines()
                .find(|line| line.contains("虚构售出物品"))
                .unwrap()
                .split(',')
                .collect::<Vec<_>>();
            vec![
                sold[0].into(),
                sold[17].into(),
                "售出后改名".into(),
                "2026-03-01".into(),
            ]
        },
    ]);
    assert_eq!(
        s.preview_csv_import(records.as_bytes(), TODAY)
            .unwrap()
            .conflicts
            .len(),
        1
    );
    assert_eq!(
        import(&mut s, &records, false).unwrap_err().code,
        "CSV_CONFLICT"
    );
}
