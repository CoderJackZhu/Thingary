//! XLSX transport for the existing import transactions. No schema changes.
//! Values are explicit strings on export: identifiers, dates and decimal amounts
//! survive spreadsheet auto-conversion; empty cells remain unknown, not zero.
use crate::{
    domain::{Error, Result},
    storage::{atomic_write, Store},
};
use calamine::{Data, DataType, Reader, Xlsx};
use rust_xlsxwriter::{Format, FormatAlign, Workbook};
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
    let text = Format::new()
        .set_num_format("@")
        .set_align(FormatAlign::Top);
    let wrapped = text.clone().set_text_wrap();
    let header = wrapped.clone().set_bold().set_background_color("#E7EFEA");
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
        sheet.set_repeat_rows(0, 0).map_err(xerr)?;
        sheet.set_row_height(0, 34).map_err(xerr)?;
        if *name != "说明" && rows.len() > 1 {
            sheet
                .autofilter(0, 0, (rows.len() - 1) as u32, (width - 1) as u16)
                .map_err(xerr)?;
        }
        for (c, title) in rows.first().into_iter().flatten().enumerate() {
            let column_width =
                if title.contains("备注") || title.contains("说明") || title.contains("摘要")
                {
                    48
                } else if title.contains("编号") || title.ends_with("_key") {
                    38
                } else if title.contains("时间") {
                    26
                } else if title.contains("日期") || title.contains("金额") {
                    19
                } else {
                    24
                };
            sheet
                .set_column_width(c as u16, column_width)
                .map_err(xerr)?;
            if *name != "说明"
                && (title.ends_with("编号")
                    || title == "档案版本"
                    || title.ends_with("代码")
                    || (*name == "账户" && title == "按持仓记录"))
            {
                sheet.set_column_hidden(c as u16).map_err(xerr)?;
            }
        }
        for (r, row) in rows.iter().enumerate() {
            for (c, value) in row.iter().enumerate() {
                if !value.is_empty() {
                    // Explicit write_string never turns user text into formulas.
                    sheet
                        .write_string_with_format(
                            r as u32,
                            c as u16,
                            value,
                            if r == 0 {
                                &header
                            } else if value.contains('\n')
                                || rows[0].get(c).is_some_and(|h| {
                                    h.contains("备注") || h.contains("说明") || h.contains("摘要")
                                })
                                || *name == "说明"
                            {
                                &wrapped
                            } else {
                                &text
                            },
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
        vec!["物品", "可新增行，也可修改导出的名称、分类、品牌、型号、序列号、购入价、购入日期、渠道和备注。同库更新请保留隐藏的档案编号和档案版本；复制为新物品时清空这两列。退役、出售等历史操作请在物品详情处理。新增行只有名称必填；名称、购入日期和购入价相同会提示疑似重复，默认跳过。"],
        vec!["账户／完整盘点／月度收入", "通过金融历史导入一起预览和提交；保留编号。同名账户须明确映射。空白工作表不参加导入。"],
        vec!["新增金融记录", "新增账户、盘点、收入的编号可留空；系统会生成。盘点中的账户编号留空时，可按账户表里的唯一账户名称关联；同名账户须填写编号并在预览中明确选择。修改原记录须保留原编号。"],
        vec!["盘点记录／重要支出／周期费用／投资区间核对／资金流动／规划假设／规划核对审计／存钱目标／目标关联账户", "分析用，不参加导入；投资区间转入和转出金额单位分，以列名为准。"],
        vec!["填写规则", "日期可填 2026-10-28、2026/10/28、2026年10月28日或 Excel 日期；金额单位元、最多两位小数，可填 1,234.50。空白表示未知，0 表示明确零。已有物品导入时，留空单元格表示清空字段，删除整列则保留原值。不要填写公式。"],
        vec!["金额分析", "金额列是精确十进制文本；计算时可在副本中转换为数值。"],
        vec!["账户字段", "kind：cash/investment/mixed/fund/bond/housing_fund/other_asset/property/pension/insurance/precious_metal/receivable/vehicle/credit_card/loan/other_liability；counted：true/false；property 必须为 false。"],
        vec!["外币账户", "账户币种缺省为 CNY；原币金额按币种小数位填写，汇率为每单位原币兑换人民币、最多6位小数。完整盘点可只填原币和汇率，已填人民币金额须相符；未知不补零。"],
        vec!["固定资产", "购入价、购入日期为可选列，仅房产和车辆可填；购入价单位元，空白表示未知，0 是明确零，不参与净资产或规划计算。"],
        vec!["账户日期", "enabled_from 为启用日；disabled_from 为停用生效日（当日不再盘点）。"],
        vec!["盘点字段", "snapshot_key 同一次盘点相同；account_key 引用账户表；amount 负债也填正数；kind_at_date/counted_at_date 可留空采用当前类型。"],
        vec!["完整盘点", "本表导出的是全部盘点明细，并非每行都能直接导入：每次盘点须包括当日全部有效账户，历史未知余额导出仍留空，含空余额或当日缺账户的盘点补齐前不能导入，导入预览会指出。"],
        vec!["数据保护", "Excel 不包含图片及全部配置和关系，不能用于完整恢复或换机。请使用 .thingary 完整备份。"],
    ].into_iter().map(|r| r.into_iter().map(str::to_owned).collect()).collect()
}

fn finance_header<'a>(kind: &str, canonical: &'a str) -> &'a str {
    match (kind, canonical) {
        (_, "account_key") => "账户编号",
        (_, "snapshot_key") => "盘点编号",
        (_, "income_key") => "收入编号",
        (_, "name") => "账户名称",
        (_, "kind") => "类型代码",
        (_, "enabled_from") => "启用日期",
        (_, "disabled_from") => "停用生效日期",
        (_, "counted") => "计入净资产代码",
        (_, "platform") => "平台",
        (_, "note") => "备注",
        ("snapshots", "date") => "盘点日期",
        ("incomes", "date") => "到账日期",
        (_, "amount") => "人民币金额（元）",
        (_, "kind_at_date") => "当时类型代码",
        (_, "counted_at_date") => "当时计入净资产代码",
        (_, "net_income") => "税后到账（元）",
        (_, "hpf_deposit") => "公积金缴存（元）",
        (_, "category") => "收入分类代码",
        (_, "source_account_key") => "来源账户编号",
        (_, "destination") => "去向代码",
        (_, "receiving_account_key") => "接收账户编号",
        (_, "legacy_estimate_unavailable") => "旧口径估计停用代码",
        _ => canonical,
    }
}

fn export_instructions(sheets: &[(&str, Vec<Vec<String>>)]) -> Vec<Vec<String>> {
    let mut rows = vec![
        vec!["工作表／项目".into(), "用途与说明".into(), "记录数".into()],
        vec!["阅读范围".into(), "包含已保存的主要业务资料及已售出、已结束等正常历史；不受页面筛选、分页或模块隐藏影响。不包含最近删除、图片与附件本体、临时试算或内部恢复记录。".into(), String::new()],
        vec!["金额与币种".into(), "人民币是汇总基准，金额使用保存值，不按导出时汇率重估。原币金额不能跨币种直接相加；JPY、KRW、VND 无小数，其他币种按实际精度显示。汇率是每单位原币折合人民币。空白为未知，0 为明确零。".into(), String::new()],
        vec!["精度与计算".into(), "金额、日期和编号按文本保留精度，日期为 YYYY-MM-DD，记录时间按本机时区显示到秒。需要计算时可在副本中转换金额为数值；公式样式的备注仍是普通文字。".into(), String::new()],
        vec!["避免重复计算".into(), "支出明细是统一阅读视图，与物品、维护、重要支出、订阅付款及充值表有重复。关联参考不重复计入；充值赠送和到账额度不当实付，退款与售出回收分别列示。排除统计的物品仍在档案表，统一支出沿用业务统计口径。".into(), String::new()],
        vec!["导入范围".into(), "物品、账户、完整盘点、月度收入支持导入；其余表只供阅读。物品普通字段可修改或新增行；同库更新保留隐藏的档案编号和档案版本，复制新增时清空这两列。金融表更正须在预览中确认。物品及收入的原币补充列只供阅读，原币账户与盘点按已有规则导入。含未知余额的盘点须先补齐；文件超过既有导入容量上限时不能整体导入。".into(), String::new()],
        vec!["金融表编辑".into(), "新增账户、盘点和收入的编号可留空，由系统生成；盘点可按账户表中的唯一名称关联。修改已有记录保留原编号，中文类型、是否计入、收入分类和去向为可编辑字段。账户状态由启停日期决定；标为只读的名称及原币补充列不参与更正，关联账户通过编号和导入预览的账户对应关系指定。".into(), String::new()],
        vec!["辅助列".into(), "名称和中文说明用于阅读；编号、代码等导入辅助列默认隐藏，需要核对时可在表格软件中取消隐藏。账户名称、分组和自定义持仓单位可能是当前设置，不据此推断历史设置；原币失效时留空，不补造汇率日期或来源。".into(), String::new()],
        vec!["完整恢复".into(), "Excel 用于查看和核对业务资料，完整换机与恢复请使用 .thingary 备份。".into(), String::new()],
        vec!["导出时间".into(), chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(), String::new()],
    ];
    for (name, data) in sheets.iter().filter(|(name, _)| *name != "说明") {
        let purpose = match *name {
            "物品" => "支持新增与修改普通字段；出售、退役历史及标为只读的补充列不能通过改表修改",
            "账户" | "完整盘点" | "月度收入" => {
                "支持既有金融历史导入的字段；补充阅读列只读"
            }
            "支出明细" => "统一支出阅读视图；查看计入方式，勿与来源表重复相加",
            "盘点记录" => "逐账户余额明细；状态区分录入、沿用和未知",
            "盘点概况" => "每次盘点的日期、备注与完整性",
            "规划核对审计" => "业务更正摘要；不含内部请求、原始快照及恢复信息",
            _ => "已保存的业务明细，只供阅读和核对，不参加导入",
        };
        rows.push(vec![
            (*name).into(),
            purpose.into(),
            data.len().saturating_sub(1).to_string(),
        ]);
    }
    rows
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

/// Maps wanted sheet titles to their XML parts through the workbook's
/// relationships. `None` means the structure is not fully resolvable, so every
/// worksheet part must be checked as before.
fn wanted_sheet_parts(
    parts: &[(String, Vec<u8>)],
    wanted: &[&str],
) -> Option<Vec<(String, String)>> {
    let part = |name: &str| {
        parts
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, data)| data.as_slice())
    };
    let attr = |e: &quick_xml::events::BytesStart, name: &str| -> Option<String> {
        e.try_get_attribute(name)
            .ok()
            .flatten()
            .map(|a| String::from_utf8_lossy(&a.value).into_owned())
    };
    let mut rid_target: Vec<(String, String)> = Vec::new();
    let mut reader = quick_xml::Reader::from_reader(part("xl/_rels/workbook.xml.rels")?);
    loop {
        use quick_xml::events::Event;
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() == b"Relationship"
                    && attr(&e, "Type")?.ends_with("/worksheet")
                {
                    rid_target.push((attr(&e, "Id")?, attr(&e, "Target")?));
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            Ok(_) => {}
        }
    }
    let mut out = Vec::new();
    let mut reader = quick_xml::Reader::from_reader(part("xl/workbook.xml")?);
    loop {
        use quick_xml::events::Event;
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() != b"sheet" {
                    continue;
                }
                let title = attr(&e, "name")?;
                if !wanted.contains(&title.as_str()) {
                    continue;
                }
                let rid = e
                    .attributes()
                    .flatten()
                    .find(|a| a.key.local_name().as_ref() == b"id")
                    .map(|a| String::from_utf8_lossy(&a.value).into_owned())?;
                let target = rid_target
                    .iter()
                    .find(|(id, _)| *id == rid)
                    .map(|(_, t)| t.clone())?;
                let mut path = target.trim_start_matches('/').to_owned();
                if let Some(rest) = path.strip_prefix("./") {
                    path = rest.to_owned();
                }
                if !path.starts_with("xl/") {
                    path = format!("xl/{path}");
                }
                if !parts.iter().any(|(n, _)| *n == path) {
                    return None;
                }
                out.push((path, title));
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            Ok(_) => {}
        }
    }
    Some(out)
}

/// Check actual expanded ZIP/XML before calamine can allocate a sparse range.
/// Bound entries, cells and coordinates, disallow formulas and macros. Only
/// worksheets that take part in the import are scanned for formulas and stray
/// cells; scratch sums elsewhere in the workbook stay harmless.
fn preflight(bytes: &[u8], wanted: &[&str]) -> Result<()> {
    if bytes.len() > MAX_BYTES {
        return Err(Error::new("LIMIT_SIZE", "Excel 文件最多 20 MiB"));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(xerr)?;
    if archive.len() > 256 {
        return Err(invalid("Excel 文件包含过多内部文件"));
    }
    let mut expanded = 0u64;
    let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
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
        parts.push((part.name().to_owned(), xml));
    }
    let targets = wanted_sheet_parts(&parts, wanted);
    let is_wanted = |name: &str| {
        targets
            .as_ref()
            .is_none_or(|list| list.iter().any(|(part, _)| part == name))
    };
    let title_of = |name: &str| -> Option<&str> {
        targets
            .as_ref()
            .and_then(|list| list.iter().find(|(part, _)| part == name))
            .map(|(_, title)| title.as_str())
    };
    for (name, xml) in &parts {
        if !name.ends_with(".xml") {
            continue;
        }
        let mut reader = quick_xml::Reader::from_reader(xml.as_slice());
        let mut worksheet = false;
        loop {
            use quick_xml::events::Event;
            match reader.read_event().map_err(xerr)? {
                Event::Start(e) | Event::Empty(e) => {
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
                    if e.local_name().as_ref() == b"worksheet" {
                        worksheet = true;
                    }
                    if !worksheet || !is_wanted(name) {
                        continue;
                    }
                    if e.local_name().as_ref() == b"f" {
                        let at = title_of(name);
                        return Err(Error::new(
                            "XLSX_FORMULA",
                            &match at {
                                Some(title) => {
                                    format!("「{title}」工作表含公式，请将公式粘贴为值后再导入")
                                }
                                None => "工作簿含公式，请将公式粘贴为值后再导入".into(),
                            },
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
                        && range.get((0, c)).is_some_and(|h| {
                            h.to_string().ends_with("_key") || h.to_string().ends_with("编号")
                        })
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
                            .map(|d| d.date())
                            .map(|d| d.format("%Y-%m-%d").to_string())
                            .ok_or_else(|| invalid(&format!("{} 日期无效", at()))),
                        Data::DateTimeIso(s) => crate::import_values::day(s)
                            .ok_or_else(|| invalid(&format!("{} 日期无效", at()))),
                        _ => Err(invalid(&format!("{} 含错误值或不支持的类型，请修正", at()))),
                    }
                })
                .collect()
        })
        .collect()
}
fn input(kind: &str, name: &str, mut rows: Vec<Vec<String>>) -> SheetInput {
    let editable_labels: &[(&str, &str)] = match kind {
        "accounts" => &[("kind", "账户类型"), ("counted", "计入净资产")],
        "snapshots" => &[
            ("kind_at_date", "当时账户类型"),
            ("counted_at_date", "当时计入净资产"),
        ],
        "incomes" => &[("category", "收入分类"), ("destination", "收入去向")],
        _ => &[],
    };
    // Visible business fields are the editable source of truth. Hidden codes
    // remain for old templates, but must not override a user's visible edits.
    if let Some(header) = rows.first() {
        let enums = editable_labels
            .iter()
            .filter_map(|(canonical, label)| {
                header
                    .iter()
                    .position(|h| h == label)
                    .map(|column| (*canonical, column))
            })
            .collect::<Vec<_>>();
        for row in rows.iter_mut().skip(1) {
            for (canonical, column) in &enums {
                if let Some(value) = row.get_mut(*column) {
                    let normalized = match (*canonical, value.trim()) {
                        ("category", "非投资收入") => "non_investment",
                        ("category", "利息") => "interest",
                        ("category", "现金分红") => "cash_dividend",
                        ("category", "其他投资收入") => "other_investment",
                        ("category", "未分类") => "unclassified",
                        ("destination", "留在来源账户") => "retained",
                        ("destination", "已转入其他账户") => "transferred",
                        ("destination", "去向待核对") => "unknown",
                        _ => continue,
                    };
                    *value = normalized.into();
                }
            }
        }
    }
    let mut row_numbers = vec![0];
    for (r, row) in rows.iter().enumerate() {
        let lines = 1 + row
            .iter()
            .map(|v| v.bytes().filter(|&c| c == b'\n').count())
            .sum::<usize>();
        row_numbers.extend(std::iter::repeat_n(r + 1, lines));
    }
    let mut column_mapping = BTreeMap::new();
    if let Some(header) = rows.first() {
        for canonical in crate::financial_import_parser::template_columns(kind).unwrap_or_default()
        {
            let readable = editable_labels
                .iter()
                .find(|(key, label)| key == canonical && header.iter().any(|h| h == label))
                .map(|(_, label)| *label)
                .unwrap_or_else(|| finance_header(kind, canonical));
            if readable != *canonical
                && header.iter().any(|h| h == readable)
                && !header.iter().any(|h| h == canonical)
            {
                column_mapping.insert(readable.into(), (*canonical).into());
            }
        }
    }
    SheetInput {
        kind: kind.into(),
        name: name.into(),
        csv_text: csv_text(&rows),
        row_numbers,
        column_mapping,
    }
}
pub fn read_finance(bytes: &[u8]) -> Result<Vec<SheetInput>> {
    preflight(bytes, &FINANCE_SHEETS.map(|(_, name)| name))?;
    let mut book = Xlsx::new(Cursor::new(bytes)).map_err(xerr)?;
    let mut tables = Vec::new();
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
            tables.push((kind, name, rows));
        }
    }
    if tables.is_empty() {
        return Err(invalid(
            "没有可导入的账户、完整盘点或月度收入工作表，请填写 Excel 模板",
        ));
    }
    finance_new_keys(&mut tables)?;
    let files: Vec<_> = tables
        .into_iter()
        .map(|(kind, name, rows)| input(kind, name, rows))
        .collect();
    let size: usize = files.iter().map(|f| f.csv_text.len()).sum();
    if size > MAX_BYTES {
        return Err(Error::new("LIMIT_SIZE", "导入内容最多 20 MiB，请拆分"));
    }
    Ok(files)
}

/// New rows do not require users to fill hidden identifiers. Generated external
/// keys are deterministic, so importing the same unchanged sheet is idempotent.
fn finance_new_keys(tables: &mut [(&str, &str, Vec<Vec<String>>)]) -> Result<()> {
    let column = |headers: &[String], kind, key| {
        headers
            .iter()
            .position(|h| h == key || h == finance_header(kind, key))
    };
    let mut account_names = BTreeMap::<String, Option<String>>::new();
    for (kind, _, rows) in tables.iter_mut() {
        let key = match *kind {
            "accounts" => "account_key",
            "snapshots" => "snapshot_key",
            "incomes" => "income_key",
            _ => continue,
        };
        let name_column = column(&rows[0], kind, "name");
        let date_column = column(&rows[0], kind, "date");
        let key_column = column(&rows[0], kind, key).unwrap_or_else(|| {
            rows[0].push(finance_header(kind, key).into());
            rows[0].len() - 1
        });
        let mut identical = BTreeMap::<String, usize>::new();
        for row in rows
            .iter_mut()
            .skip(1)
            .filter(|r| r.iter().any(|v| !v.trim().is_empty()))
        {
            row.resize(row.len().max(key_column + 1), String::new());
            if row[key_column].trim().is_empty() {
                let identity = match *kind {
                    "accounts" => name_column
                        .and_then(|c| row.get(c))
                        .map(|s| s.trim().to_owned())
                        .unwrap_or_default(),
                    "snapshots" => {
                        let date = date_column
                            .and_then(|c| row.get(c))
                            .map(|s| s.trim())
                            .unwrap_or("");
                        crate::import_values::day(date).unwrap_or_else(|| date.into())
                    }
                    _ => csv_text(std::slice::from_ref(row)),
                };
                let hash = crate::storage::digest(identity.as_bytes());
                let suffix = if *kind == "incomes" {
                    let count = identical.entry(hash.clone()).or_default();
                    *count += 1;
                    format!("-{count}")
                } else {
                    String::new()
                };
                row[key_column] = format!("xlsx-{kind}-{}{suffix}", &hash[..24]);
            }
            if *kind == "accounts" {
                if let Some(name) = name_column
                    .and_then(|c| row.get(c))
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                {
                    account_names
                        .entry(name.into())
                        .and_modify(|old| *old = None)
                        .or_insert_with(|| Some(row[key_column].clone()));
                }
            }
        }
    }
    for (kind, _, rows) in tables
        .iter_mut()
        .filter(|(kind, _, _)| *kind == "snapshots")
    {
        let Some(name_column) = rows[0].iter().position(|h| h == "账户名称") else {
            continue;
        };
        let key_column = column(&rows[0], kind, "account_key").unwrap_or_else(|| {
            rows[0].push(finance_header(kind, "account_key").into());
            rows[0].len() - 1
        });
        for (index, row) in rows.iter_mut().enumerate().skip(1) {
            if row.iter().all(|v| v.trim().is_empty()) {
                continue;
            }
            row.resize(row.len().max(key_column + 1), String::new());
            if row[key_column].trim().is_empty() {
                let name = row.get(name_column).map(|v| v.trim()).unwrap_or("");
                if let Some(Some(key)) = account_names.get(name) {
                    row[key_column] = key.clone();
                } else if !name.is_empty() {
                    return Err(invalid(&format!("「完整盘点」第 {} 行账户「{name}」没有唯一对应。请在账户表补齐，或填写账户编号后在预览中选择对应账户", index + 1)));
                }
            }
        }
    }
    Ok(())
}
pub fn read_item_input(bytes: &[u8]) -> Result<SheetInput> {
    preflight(bytes, &["物品"])?;
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
        // All business readers share this connection and therefore one snapshot.
        // Finish the read transaction before publishing any output file.
        let transaction = self.conn()?.unchecked_transaction()?;
        let items = csv_rows(&self.asset_table(false)?)?;
        let mut sheets = vec![("说明", instructions()), ("物品", items)];
        let mut accounts: Vec<Vec<String>> =
            vec![crate::financial_import_parser::template_columns("accounts")
                .unwrap()
                .iter()
                .map(|s| s.to_string())
                .collect()];
        accounts[0].extend(
            [
                "账户类型",
                "计入净资产",
                "账户状态（只读）",
                "金额录入方式（只读）",
            ]
            .map(str::to_owned),
        );
        let account_names = crate::spreadsheet_export::account_names(self.conn()?)?;
        for a in self.wealth_accounts()? {
            let kind_label = crate::financial_import_parser::ACCOUNT_KINDS
                .iter()
                .find(|k| k.key == a.fields.kind)
                .map(|k| k.label)
                .unwrap_or("其他");
            let counted = if a.fields.counted { "是" } else { "否" };
            let status = if a.fields.closed_on.is_some() {
                "已停用"
            } else {
                "启用"
            };
            accounts.push(vec![
                a.id,
                a.fields.name,
                a.fields.kind,
                a.fields.opened_on,
                a.fields.closed_on.unwrap_or_default(),
                a.fields.counted.to_string(),
                a.fields.institution,
                a.fields.notes,
                a.fields
                    .purchase_cents
                    .map(|v| {
                        let c: i64 = v.parse().expect("validated cents");
                        format!("{}.{:02}", c / 100, c % 100)
                    })
                    .unwrap_or_default(),
                a.fields.purchased_on.unwrap_or_default(),
                a.fields
                    .group_id
                    .as_deref()
                    .map(|id| {
                        self.conn()?
                            .query_row(
                                "SELECT name FROM fin_account_groups WHERE id=?1",
                                [id],
                                |r| r.get::<_, String>(0),
                            )
                            .map_err(crate::domain::Error::from)
                    })
                    .transpose()?
                    .unwrap_or_default(),
                a.fields.currency,
                a.fields.holding_mode.to_string(),
                a.fields.holding_unit.unwrap_or_default(),
                kind_label.into(),
                counted.into(),
                status.into(),
                if a.fields.holding_mode {
                    "按数量与单价"
                } else {
                    "直接填写余额"
                }
                .into(),
            ]);
        }
        sheets.push(("账户", accounts));
        let mut snapshots: Vec<Vec<String>> = vec![
            crate::financial_import_parser::template_columns("snapshots")
                .unwrap()
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ];
        snapshots[0]
            .extend(["账户名称", "填写状态", "当时账户类型", "当时计入净资产"].map(str::to_owned));
        let mut stmt=self.conn()?.prepare("SELECT s.id,s.date,e.account_id,e.amount_cents,s.notes,e.kind,e.counted,a.currency,e.original_minor,e.fx_rate_micro,e.quantity_e8,e.unit_price_e6,a.name,e.state FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id JOIN fin_accounts a ON a.id=e.account_id WHERE s.deleted_at IS NULL ORDER BY s.date,s.id,e.account_id")?;
        for row in stmt.query_map([], |r| {
            Ok(vec![
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                decimal(r.get(3)?),
                r.get(4)?,
                r.get(5)?,
                r.get::<_, bool>(6)?.to_string(),
                r.get::<_, String>(7)?,
                r.get::<_, Option<i64>>(8)?
                    .map(|v| {
                        crate::currency::decimal(
                            v,
                            crate::currency::decimals(&r.get::<_, String>(7).unwrap_or_default()),
                        )
                    })
                    .unwrap_or_default(),
                r.get::<_, Option<i64>>(9)?
                    .map(|v| crate::currency::decimal(v, 6))
                    .unwrap_or_default(),
                r.get::<_, Option<i64>>(10)?
                    .map(|v| crate::currency::decimal(v, 8))
                    .unwrap_or_default(),
                r.get::<_, Option<i64>>(11)?
                    .map(|v| crate::currency::decimal(v, 6))
                    .unwrap_or_default(),
                r.get::<_, String>(12)?,
                match r.get::<_, String>(13)?.as_str() {
                    "entered" => "已填写",
                    "unchanged" => "沿用上次",
                    _ => "未填写",
                }
                .into(),
                crate::financial_import_parser::ACCOUNT_KINDS
                    .iter()
                    .find(|k| k.key == r.get::<_, String>(5).unwrap_or_default())
                    .map(|k| k.label)
                    .unwrap_or("其他")
                    .into(),
                if r.get::<_, bool>(6)? { "是" } else { "否" }.into(),
            ])
        })? {
            snapshots.push(row?);
        }
        sheets.push(("完整盘点", snapshots));
        let mut incomes: Vec<Vec<String>> =
            vec![crate::financial_import_parser::template_columns("incomes")
                .unwrap()
                .iter()
                .map(|s| s.to_string())
                .collect()];
        let mut stmt=self.conn()?.prepare("SELECT i.id,i.date,i.net_cents,i.hpf_cents,i.notes,i.category,i.source_account_id,i.destination,i.receiving_account_id,i.classification_changed,o.currency,o.original_minor,o.fx_rate_micro FROM plan_income i LEFT JOIN amount_origin o ON o.kind='income' AND o.record_id=i.id WHERE i.deleted_at IS NULL ORDER BY i.date,i.id")?;
        incomes[0].extend(
            [
                "原币币种",
                "原币金额",
                "汇率",
                "收入分类",
                "来源账户（只读）",
                "接收账户（只读）",
                "收入去向",
            ]
            .map(str::to_owned),
        );
        for row in stmt.query_map([], |r| {
            let net = r.get::<_, Option<i64>>(2)?;
            let origin = crate::csv_export::origin_cells(r.get(10)?, r.get(11)?, r.get(12)?, net);
            let category: String = r.get(5)?;
            let destination: Option<String> = r.get(7)?;
            let mut row = vec![
                r.get(0)?,
                r.get(1)?,
                decimal(net),
                decimal(r.get(3)?),
                r.get(4)?,
                r.get(5)?,
                r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                r.get::<_, Option<String>>(7)?.unwrap_or_default(),
                r.get::<_, Option<String>>(8)?.unwrap_or_default(),
                r.get::<_, bool>(9)?.to_string(),
            ];
            row.extend(origin);
            row.extend([
                match category.as_str() {
                    "non_investment" => "非投资收入",
                    "interest" => "利息",
                    "cash_dividend" => "现金分红",
                    "other_investment" => "其他投资收入",
                    _ => "未分类",
                }
                .into(),
                r.get::<_, Option<String>>(6)?
                    .map(|id| {
                        account_names
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(|| "关联账户已清除".into())
                    })
                    .unwrap_or_default(),
                r.get::<_, Option<String>>(8)?
                    .map(|id| {
                        account_names
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(|| "关联账户已清除".into())
                    })
                    .unwrap_or_default(),
                match destination.as_deref() {
                    Some("retained") => "留在来源账户",
                    Some("transferred") => "已转入其他账户",
                    Some("unknown") => "去向待核对",
                    _ => "",
                }
                .into(),
            ]);
            Ok(row)
        })? {
            incomes.push(row?);
        }
        sheets.push(("月度收入", incomes));
        for (name, csv) in [
            ("盘点记录", self.wealth_table(false)?),
            ("重要支出", self.expenses_table(false)?),
        ] {
            sheets.push((name, csv_rows(&csv.0)?));
        }
        for (name, rows) in crate::spreadsheet_export::sheets(self)? {
            if let Some(existing) = sheets.iter_mut().find(|(title, _)| *title == name) {
                existing.1 = rows;
            } else {
                sheets.push((name, rows));
            }
        }
        for (kind, name) in FINANCE_SHEETS {
            if let Some((_, rows)) = sheets.iter_mut().find(|(title, _)| *title == name) {
                for h in &mut rows[0] {
                    *h = finance_header(kind, h).to_owned();
                }
            }
        }
        sheets[0].1 = export_instructions(&sheets);
        let counts = sheets
            .iter()
            .filter(|(name, _)| *name != "说明")
            .map(|(name, rows)| (*name, rows.len().saturating_sub(1) as i64))
            .collect();
        drop(stmt);
        transaction.commit()?;
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
