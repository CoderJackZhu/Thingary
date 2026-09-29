use possio_lib::{
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
        .map(|l| l.split_once(',').unwrap().1.to_owned())
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
