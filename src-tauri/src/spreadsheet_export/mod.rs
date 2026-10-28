//! Readable business projections. Full fidelity restore belongs to backups.
use crate::{domain::Result, storage::Store};

mod daily;
mod finance;
mod planning;

pub(super) type ExportSheet = (&'static str, Vec<Vec<String>>);

pub(crate) fn account_names(
    c: &rusqlite::Connection,
) -> Result<std::collections::BTreeMap<String, String>> {
    let mut q = c.prepare("SELECT id,name,deleted_at IS NOT NULL FROM fin_accounts")?;
    let rows = q
        .query_map([], |r| {
            let name: String = r.get(1)?;
            let deleted: bool = r.get(2)?;
            Ok((
                r.get(0)?,
                if deleted {
                    format!("{name}（账户已删除）")
                } else {
                    name
                },
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

pub(super) fn sheets(store: &Store) -> Result<Vec<ExportSheet>> {
    let mut sheets = daily::sheets(store)?;
    sheets.extend(planning::sheets(store)?);
    sheets.extend(finance::sheets(store)?);
    Ok(sheets)
}

pub(super) fn money(value: Option<i64>) -> String {
    value
        .map(|v| crate::currency::decimal(v, 2))
        .unwrap_or_default()
}

pub(super) fn date(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|v| {
            v.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|_| value.to_owned())
}

pub(super) fn time(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|v| {
            v.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|_| value.to_owned())
}

pub(super) fn yes(value: bool) -> String {
    if value { "是" } else { "否" }.into()
}

pub(super) fn row(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{Reader, Xlsx};
    use std::io::Cursor;

    #[test]
    fn business_dates_and_times_do_not_expose_fractional_iso_timestamps() {
        let raw = "2026-10-28T05:17:33.967978+00:00";
        let local = chrono::DateTime::parse_from_rfc3339(raw)
            .unwrap()
            .with_timezone(&chrono::Local);
        assert_eq!(date(raw), local.format("%Y-%m-%d").to_string());
        assert_eq!(time(raw), local.format("%Y-%m-%d %H:%M:%S").to_string());
        assert_eq!(date("2026-10-28"), "2026-10-28");
        assert_eq!(date(""), "");
        assert_eq!(time(""), "");
    }

    #[test]
    fn income_account_columns_show_names_and_deleted_status() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::open(&temp.path().join("library")).unwrap();
        crate::modules::initialize_runtime(&store.root);
        crate::demo::prepare(&mut store, "2026-10-28").unwrap();
        let c = store.conn().unwrap();
        let mut q = c
            .prepare("SELECT id,name FROM fin_accounts WHERE deleted_at IS NULL LIMIT 2")
            .unwrap();
        let accounts = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(accounts.len(), 2);
        let income: String = c
            .query_row("SELECT id FROM plan_income LIMIT 1", [], |r| r.get(0))
            .unwrap();
        c.execute(
            "UPDATE plan_income SET category='interest',source_account_id=?1,
             destination='transferred',receiving_account_id=?2 WHERE id=?3",
            rusqlite::params![accounts[0].0, accounts[1].0, income],
        )
        .unwrap();
        c.execute(
            "UPDATE fin_accounts SET deleted_at='2026-10-28' WHERE id=?1",
            [&accounts[1].0],
        )
        .unwrap();
        let path = temp.path().join("虚构收入账户.xlsx");
        store.export_workbook(&path).unwrap();
        let bytes = std::fs::read(path).unwrap();
        let mut book = Xlsx::new(Cursor::new(bytes)).unwrap();
        let range = book.worksheet_range("月度收入").unwrap();
        let rows: Vec<Vec<String>> = range
            .rows()
            .map(|r| r.iter().map(ToString::to_string).collect())
            .collect();
        let source = rows[0]
            .iter()
            .position(|v| v == "来源账户（只读）")
            .unwrap();
        let receiving = rows[0]
            .iter()
            .position(|v| v == "接收账户（只读）")
            .unwrap();
        let r = rows.iter().find(|r| r[0] == income).unwrap();
        assert_eq!(r[source], accounts[0].1);
        assert_eq!(r[receiving], format!("{}（账户已删除）", accounts[1].1));
    }

    #[test]
    fn fictional_workbook_covers_saved_business_and_does_not_write() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = Store::open(&temp.path().join("library")).unwrap();
        crate::modules::initialize_runtime(&store.root);
        crate::demo::prepare(&mut store, "2026-10-28").unwrap();
        let generation = store.generation();
        let changes = store.conn().unwrap().total_changes();
        let path = temp.path().join("虚构业务资料.xlsx");
        let counts = store.export_workbook(&path).unwrap();
        assert_eq!(changes, store.conn().unwrap().total_changes());
        assert_eq!(generation, store.generation());
        let bytes = std::fs::read(&path).unwrap();
        let mut book = Xlsx::new(Cursor::new(&bytes)).unwrap();
        for sheet in [
            "物品",
            "心愿清单",
            "维护记录",
            "保障记录",
            "虚拟资产",
            "周期费用",
            "月度收入",
            "规划条件",
            "大额计划",
            "盘点概况",
            "支出明细",
        ] {
            let range = book.worksheet_range(sheet).unwrap();
            assert!(range.height() > 1, "虚构样例缺少 {sheet}");
        }
        for (name, count) in counts {
            let range = book.worksheet_range(name).unwrap();
            assert_eq!(range.height().saturating_sub(1) as i64, count, "{name}");
            assert!(book.worksheet_formula(name).unwrap().is_empty(), "{name}");
            assert!(
                !range.rows().next().unwrap().iter().any(|v| {
                    [
                        "请求编号",
                        "原权威来源草稿",
                        "原期初内容键",
                        "流动依据内容键",
                    ]
                    .contains(&v.to_string().as_str())
                }),
                "{name}"
            );
        }
        let files = crate::spreadsheet::read_finance(&bytes).unwrap();
        assert_eq!(files.len(), 3);
        assert!(!files
            .iter()
            .find(|f| f.kind == "incomes")
            .unwrap()
            .column_mapping
            .is_empty());

        // Optional retained fictional artifacts support the real native acceptance
        // path. create_dir refuses reuse of any existing destination.
        if let Some(folder) = std::env::var_os("THINGARY_FICTIONAL_EXPORT_DIR") {
            let folder = std::path::PathBuf::from(folder);
            assert!(folder.is_absolute());
            std::fs::create_dir(&folder).unwrap();
            std::fs::copy(path, folder.join("虚构业务资料.xlsx")).unwrap();
            store
                .backup(Some(&folder.join("虚构验收资料.thingary")))
                .unwrap();
        }
    }
}
