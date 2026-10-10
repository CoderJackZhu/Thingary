//! XLSX transport for the existing import transactions. No schema changes.
//! Values are explicit strings on export: identifiers, dates and decimal amounts
//! survive spreadsheet auto-conversion; empty cells remain unknown, not zero.
use crate::{
    domain::{Error, Result},
    storage::{atomic_write, Store},
};
use calamine::{Data, DataType, Reader, Xlsx};
use rust_xlsxwriter::{Format, Workbook};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::Path,
};

pub const MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_EXPANDED: u64 = 64 * 1024 * 1024;
const MAX_ROWS: u32 = 50_001;
const MAX_COLS: u16 = 32;
pub const FINANCE_SHEETS: [(&str, &str); 3] = [
    ("accounts", "账户"),
    ("snapshots", "完整盘点"),
    ("incomes", "月度收入"),
];

fn invalid(message: &str) -> Error {
    Error::new("XLSX_FORMAT", message)
}
fn xerr(e: impl std::fmt::Display) -> Error {
    invalid(&format!("Excel 文件处理失败：{e}"))
}

/// Quote every field for the internal, unchanged CSV validator. No external CSV
/// compatibility is exposed by the native picker.
pub fn csv_text(rows: &[Vec<String>]) -> String {
    let mut out = String::new();
    for row in rows {
        out.push_str(
            &row.iter()
                .map(|v| format!("\"{}\"", v.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push_str("\r\n");
    }
    out
}
fn csv_rows(csv: &str) -> Result<Vec<Vec<String>>> {
    Ok(
        crate::csv_import::records(csv.trim_start_matches('\u{feff}'))?
            .into_iter()
            .map(|(_, row)| row)
            .collect(),
    )
}

/// Build in memory first; atomic_write preserves the destination on failure.
pub fn write_workbook(path: &Path, sheets: &[(&str, Vec<Vec<String>>)]) -> Result<()> {
    let mut book = Workbook::new();
    let text = Format::new().set_num_format("@");
    let header = Format::new().set_bold().set_num_format("@");
    for (name, rows) in sheets {
        let sheet = book.add_worksheet();
        sheet.set_name(*name).map_err(xerr)?;
        let width = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
        if rows.len() > 1_048_576 || width > 16_384 {
            return Err(invalid("表格超出 Excel 行列上限"));
        }
        sheet
            .set_column_range_format(0, (width - 1) as u16, &text)
            .map_err(xerr)?;
        sheet
            .set_column_range_width(0, (width - 1) as u16, 22)
            .map_err(xerr)?;
        sheet.set_freeze_panes(1, 0).map_err(xerr)?;
        for (r, row) in rows.iter().enumerate() {
            for (c, value) in row.iter().enumerate() {
                if !value.is_empty() {
                    // Explicit write_string never turns user text into formulas.
                    sheet
                        .write_string_with_format(
                            r as u32,
                            c as u16,
                            value,
                            if r == 0 { &header } else { &text },
                        )
                        .map_err(xerr)?;
                }
            }
        }
    }
    atomic_write(path, &book.save_to_buffer().map_err(xerr)?)
}
fn instructions() -> Vec<Vec<String>> {
    [
        vec!["工作表", "用途"],
        vec!["物品", "通过物品导入，只新增、不覆盖；只有名称必填。"],
        vec!["账户／完整盘点／月度收入", "通过金融历史导入一起预览和提交；保留编号。同名账户须明确映射。空白工作表不参加导入。"],
        vec!["盘点记录／重要支出／周期费用", "分析用，不参加导入。"],
        vec!["填写规则", "编号、日期、金额按文本保存；金额单位元、最多两位小数；日期 YYYY-MM-DD；空白表示未知，0 表示明确零。不要填写公式。"],
        vec!["金额分析", "金额列是精确十进制文本；计算时可在副本中转换为数值。"],
        vec!["账户字段", "kind：cash/investment/mixed/fund/bond/housing_fund/other_asset/credit_card/loan/other_liability；counted：true/false。"],
        vec!["账户日期", "enabled_from 为启用日；disabled_from 为停用生效日（当日不再盘点）。"],
        vec!["盘点字段", "snapshot_key 同一次盘点相同；account_key 引用账户表；amount 负债也填正数；kind_at_date/counted_at_date 可留空采用当前类型。"],
        vec!["完整盘点", "每次盘点须包括当日全部有效账户；历史未知余额导出仍留空，补齐前不能作为完整盘点导入。"],
        vec!["数据保护", "Excel 不包含图片及全部配置和关系，不能用于完整恢复或换机。请使用 .thingary 完整备份。"],
    ].into_iter().map(|r| r.into_iter().map(str::to_owned).collect()).collect()
}
pub fn write_template(path: &Path, sample: bool) -> Result<()> {
    let mut sheets = vec![
        ("说明", instructions()),
        ("物品", csv_rows(&crate::csv_import::template())?),
    ];
    for (kind, name) in FINANCE_SHEETS {
        let csv = if sample {
            match kind {
                "accounts" => {
                    include_str!("financial_import_parser/samples/accounts.csv").to_owned()
                }
                "snapshots" => {
                    include_str!("financial_import_parser/samples/snapshots.csv").to_owned()
                }
                _ => include_str!("financial_import_parser/samples/incomes.csv").to_owned(),
            }
        } else {
            crate::financial_import_parser::template_csv(kind).map_err(xerr)?
        };
        sheets.push((name, csv_rows(&csv)?));
    }
    write_workbook(path, &sheets)
}

/// Check actual expanded ZIP/XML before calamine can allocate a sparse range.
/// Bound entries, cells and coordinates, disallow formulas and macros.
fn preflight(bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_BYTES {
        return Err(Error::new("LIMIT_SIZE", "Excel 文件最多 20 MiB"));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(xerr)?;
    if archive.len() > 256 {
        return Err(invalid("Excel 文件包含过多内部文件"));
    }
    let mut expanded = 0u64;
    for i in 0..archive.len() {
        let mut part = archive.by_index(i).map_err(xerr)?;
        if part.name().ends_with("vbaProject.bin") {
            return Err(invalid("不支持含宏的工作簿，请保存为普通 .xlsx"));
        }
        expanded = expanded
            .checked_add(part.size())
            .ok_or_else(|| invalid("Excel 文件解压大小超限"))?;
        if expanded > MAX_EXPANDED {
            return Err(Error::new("LIMIT_SIZE", "Excel 解压后超过 64 MiB，请拆分"));
        }
        let mut xml = Vec::new();
        (&mut part)
            .take(MAX_EXPANDED + 1)
            .read_to_end(&mut xml)
            .map_err(xerr)?;
        if xml.len() as u64 != part.size() {
            return Err(invalid("Excel 内部文件大小不一致"));
        }
        if !part.name().ends_with(".xml") {
            continue;
        }
        let mut reader = quick_xml::Reader::from_reader(xml.as_slice());
        let mut worksheet = false;
        loop {
            use quick_xml::events::Event;
            match reader.read_event().map_err(xerr)? {
                Event::Start(e) | Event::Empty(e) => {
                    if e.local_name().as_ref() == b"worksheet" {
                        worksheet = true;
                    }
                    if e.local_name().as_ref() == b"Relationship" {
                        let kind = e.try_get_attribute("Type").map_err(xerr)?;
                        if kind
                            .as_ref()
                            .is_some_and(|a| a.value.ends_with(b"/worksheet"))
                        {
                            let target = e
                                .try_get_attribute("Target")
                                .map_err(xerr)?
                                .ok_or_else(|| invalid("工作表引用无效"))?;
                            if !target.value.ends_with(b".xml") {
                                return Err(invalid("工作表引用须为 XML"));
                            }
                        }
                    }
                    if !worksheet {
                        continue;
                    }
                    if e.local_name().as_ref() == b"f" {
                        return Err(Error::new(
                            "XLSX_FORMULA",
                            "工作簿含公式，请将公式粘贴为值后再导入",
                        ));
                    }
                    if e.local_name().as_ref() == b"dimension" {
                        if let Some(a) = e.try_get_attribute("ref").map_err(xerr)? {
                            for coordinate in
                                std::str::from_utf8(&a.value).map_err(xerr)?.split(':')
                            {
                                check_coordinate(coordinate)?;
                            }
                        }
                    }
                    if e.local_name().as_ref() == b"c" {
                        let a = e
                            .try_get_attribute("r")
                            .map_err(xerr)?
                            .ok_or_else(|| invalid("单元格缺少坐标"))?;
                        let reference = std::str::from_utf8(&a.value).map_err(xerr)?;
                        check_coordinate(reference)?;
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
    }
    Ok(())
}
fn check_coordinate(reference: &str) -> Result<()> {
    let split = reference
        .find(|c: char| c.is_ascii_digit())
        .ok_or_else(|| invalid("单元格坐标无效"))?;
    let (letters, digits) = reference.split_at(split);
    let col = letters
        .bytes()
        .try_fold(0u32, |n, c| {
            if c.is_ascii_uppercase() {
                n.checked_mul(26)?.checked_add((c - b'A' + 1) as u32)
            } else {
                None
            }
        })
        .ok_or_else(|| invalid("单元格列坐标无效"))?;
    let row: u32 = digits.parse().map_err(xerr)?;
    if row == 0 || row > MAX_ROWS || col == 0 || col > MAX_COLS as u32 {
        return Err(Error::new(
            "LIMIT_ROWS",
            "导入工作簿最多 50000 数据行、32 列；请移除范围外的单元格和格式",
        ));
    }
    Ok(())
}
#[derive(Debug, serde::Serialize)]
pub struct SheetInput {
    pub kind: String,
    pub name: String,
    pub csv_text: String,
    /// Internal physical CSV line -> original Excel row (embedded newlines).
    pub row_numbers: Vec<usize>,
    pub column_mapping: BTreeMap<String, String>,
}
fn read_sheet(book: &mut Xlsx<Cursor<&[u8]>>, name: &str) -> Result<Vec<Vec<String>>> {
    let range = book.worksheet_range(name).map_err(xerr)?;
    if range.is_empty() {
        return Ok(Vec::new());
    }
    if range.start() != Some((0, 0)) {
        return Err(invalid(&format!("「{name}」的表头须从 A1 开始")));
    }
    if range.height() > MAX_ROWS as usize || range.width() > MAX_COLS as usize {
        return Err(invalid("工作表行列超限"));
    }
    range
        .rows()
        .enumerate()
        .map(|(r, row)| {
            row.iter()
                .enumerate()
                .map(|(c, v)| {
                    let at = || format!("「{name}」第 {} 行第 {} 列", r + 1, c + 1);
                    if r > 0
                        && matches!(v, Data::Int(_) | Data::Float(_))
                        && range
                            .get((0, c))
                            .is_some_and(|h| h.to_string().ends_with("_key"))
                    {
                        return Err(invalid(&format!(
                            "{} 编号须按文本填写，避免丢失前导零或精度",
                            at()
                        )));
                    }
                    match v {
                        Data::Empty => Ok(String::new()),
                        Data::String(s) => Ok(s.clone()),
                        Data::Bool(b) => Ok(b.to_string()),
                        Data::Int(n) => Ok(n.to_string()),
                        Data::Float(n) if n.is_finite() => Ok(n.to_string()),
                        Data::DateTime(_) => v
                            .as_datetime()
                            .filter(|d| d.time() == chrono::NaiveTime::MIN)
                            .map(|d| d.date())
                            .map(|d| d.format("%Y-%m-%d").to_string())
                            .ok_or_else(|| invalid(&format!("{} 日期无效", at()))),
                        Data::DateTimeIso(s) => Ok(s.clone()),
                        _ => Err(invalid(&format!("{} 含错误值或不支持的类型，请修正", at()))),
                    }
                })
                .collect()
        })
        .collect()
}
fn input(kind: &str, name: &str, rows: Vec<Vec<String>>) -> SheetInput {
    let mut row_numbers = vec![0];
    for (r, row) in rows.iter().enumerate() {
        let lines = 1 + row
            .iter()
            .map(|v| v.bytes().filter(|&c| c == b'\n').count())
            .sum::<usize>();
        row_numbers.extend(std::iter::repeat_n(r + 1, lines));
    }
    SheetInput {
        kind: kind.into(),
        name: name.into(),
        csv_text: csv_text(&rows),
        row_numbers,
        column_mapping: BTreeMap::new(),
    }
}
pub fn read_finance(bytes: &[u8]) -> Result<Vec<SheetInput>> {
    preflight(bytes)?;
    let mut book = Xlsx::new(Cursor::new(bytes)).map_err(xerr)?;
    let mut files = Vec::new();
    for (kind, name) in FINANCE_SHEETS {
        if !book.sheet_names().iter().any(|n| n == name) {
            continue;
        }
        let rows = read_sheet(&mut book, name)?;
        if rows
            .iter()
            .skip(1)
            .any(|r| r.iter().any(|v| !v.trim().is_empty()))
        {
            files.push(input(kind, name, rows));
        }
    }
    if files.is_empty() {
        return Err(invalid(
            "没有可导入的账户、完整盘点或月度收入工作表，请填写 Excel 模板",
        ));
    }
    let size: usize = files.iter().map(|f| f.csv_text.len()).sum();
    if size > MAX_BYTES {
        return Err(Error::new("LIMIT_SIZE", "导入内容最多 20 MiB，请拆分"));
    }
    Ok(files)
}
pub fn read_item_input(bytes: &[u8]) -> Result<SheetInput> {
    preflight(bytes)?;
    let mut book = Xlsx::new(Cursor::new(bytes)).map_err(xerr)?;
    if !book.sheet_names().iter().any(|n| n == "物品") {
        return Err(invalid("缺少「物品」工作表，请使用 Excel 模板"));
    }
    let rows = read_sheet(&mut book, "物品")?;
    if rows.len() > 5001 {
        return Err(Error::new("LIMIT_ROWS", "物品每次最多 5000 行"));
    }
    let text = csv_text(&rows);
    if text.len() > crate::csv_import::MAX_BYTES {
        return Err(Error::new("LIMIT_SIZE", "物品导入内容最多 5 MiB"));
    }
    Ok(input("items", "物品", rows))
}
pub fn read_items(bytes: &[u8]) -> Result<Vec<u8>> {
    Ok(read_item_input(bytes)?.csv_text.into_bytes())
}
pub fn read_file(path: &Path) -> Result<Vec<u8>> {
    if !path
        .extension()
        .is_some_and(|x| x.eq_ignore_ascii_case("xlsx"))
    {
        return Err(invalid("请选择 .xlsx Excel 文件"));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BYTES {
        return Err(Error::new("LIMIT_SIZE", "Excel 文件最多 20 MiB"));
    }
    Ok(bytes)
}

impl Store {
    pub fn export_workbook(&self, path: &Path) -> Result<Vec<(&'static str, i64)>> {
        let items = csv_rows(&self.asset_table(false)?)?;
        let mut sheets = vec![("说明", instructions()), ("物品", items)];
        let mut accounts = vec![crate::financial_import_parser::template_columns("accounts")
            .unwrap()
            .iter()
            .map(|s| s.to_string())
            .collect()];
        for a in self.wealth_accounts()? {
            accounts.push(vec![
                a.id,
                a.fields.name,
                a.fields.kind,
                a.fields.opened_on,
                a.fields.closed_on.unwrap_or_default(),
                a.fields.counted.to_string(),
                a.fields.institution,
                a.fields.notes,
            ]);
        }
        sheets.push(("账户", accounts));
        let mut snapshots = vec![
            crate::financial_import_parser::template_columns("snapshots")
                .unwrap()
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ];
        let mut stmt=self.conn()?.prepare("SELECT s.id,s.date,e.account_id,e.amount_cents,s.notes,e.kind,e.counted FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE s.deleted_at IS NULL ORDER BY s.date,s.id,e.account_id")?;
        for row in stmt.query_map([], |r| {
            Ok(vec![
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                decimal(r.get(3)?),
                r.get(4)?,
                r.get(5)?,
                r.get::<_, bool>(6)?.to_string(),
            ])
        })? {
            snapshots.push(row?);
        }
        sheets.push(("完整盘点", snapshots));
        let mut incomes = vec![crate::financial_import_parser::template_columns("incomes")
            .unwrap()
            .iter()
            .map(|s| s.to_string())
            .collect()];
        let mut stmt=self.conn()?.prepare("SELECT id,date,net_cents,hpf_cents,notes FROM plan_income WHERE deleted_at IS NULL ORDER BY date,id")?;
        for row in stmt.query_map([], |r| {
            Ok(vec![
                r.get(0)?,
                r.get(1)?,
                decimal(r.get(2)?),
                decimal(r.get(3)?),
                r.get(4)?,
            ])
        })? {
            incomes.push(row?);
        }
        sheets.push(("月度收入", incomes));
        for (name, csv) in [
            ("盘点记录", self.wealth_table(false)?),
            ("重要支出", self.expenses_table(false)?),
            ("周期费用", self.recurring_table(false)?),
        ] {
            sheets.push((name, csv_rows(&csv.0)?));
        }
        let counts = sheets
            .iter()
            .filter(|(name, _)| *name != "说明")
            .map(|(name, rows)| (*name, rows.len().saturating_sub(1) as i64))
            .collect();
        write_workbook(path, &sheets)?;
        Ok(counts)
    }
}
fn decimal(cents: Option<i64>) -> String {
    cents.map_or_else(String::new, |c| {
        format!(
            "{}{}.{:02}",
            if c < 0 { "-" } else { "" },
            c.unsigned_abs() / 100,
            c.unsigned_abs() % 100
        )
    })
}
