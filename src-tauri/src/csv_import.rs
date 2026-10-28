//! Asset table import (D21, U14): adds new assets and updates ordinary fields
//! for rows that carry a stable exported ID and matching revision. Preview
//! checks every row without writing; commit re-checks the same bytes and writes
//! all valid rows in one transaction.
use crate::{
    catalog::Details,
    csv_export::HEADER,
    domain::{Error, Result, Save},
    lifecycle::{append_event, Kind, Lifecycle, State},
    storage::{atomic_write, digest, uid, Store},
    taxonomy::{self, Classification},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::Path,
};

pub const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_ROWS: usize = 5000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RowNote {
    pub line: usize,
    pub name: String,
    pub reason: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Add,
    Update,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Change {
    pub line: usize,
    pub name: String,
    pub kind: ChangeKind,
    pub changed: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Preview {
    pub hash: String,
    pub valid: usize,
    pub additions: usize,
    pub updates: usize,
    pub unchanged: usize,
    pub invalid: Vec<RowNote>,
    pub duplicates: Vec<RowNote>,
    pub changes: Vec<Change>,
    pub conflicts: Vec<RowNote>,
    pub new_categories: Vec<String>,
    pub new_channels: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Commit {
    pub request_id: String,
    pub generation: String,
    pub hash: String,
    pub include_duplicates: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Done {
    pub imported: usize,
    #[serde(default)]
    pub updated: usize,
    #[serde(default)]
    pub unchanged: usize,
    pub skipped_duplicates: usize,
    pub invalid: usize,
}

/// Header-only template; stable IDs and revisions are only for round-tripping
/// an exported library, never required for adding rows.
pub fn template() -> String {
    let mut columns = HEADER
        .iter()
        .enumerate()
        .filter(|(i, _)| !matches!(i, 0 | 17))
        .map(|(_, h)| *h)
        .collect::<Vec<_>>();
    columns.push("序列号");
    format!("\u{feff}{}\r\n", columns.join(","))
}
pub fn write_template(path: &Path) -> Result<()> {
    atomic_write(path, template().as_bytes())
}

struct Row {
    line: usize,
    /// Present only when the row came from an export and still names a live item.
    existing: Option<(String, i64)>,
    name: String,
    details: Details,
    category: Option<String>,
    channel: Option<String>,
    price: Option<i64>,
    purchase: Option<String>,
    retired: Option<String>,
    sold: Option<(String, i64)>,
}

/// RFC 4180 with CRLF or LF; returns each record with its starting line.
pub(crate) fn records(text: &str) -> Result<Vec<(usize, Vec<String>)>> {
    let (mut out, mut row, mut cell) = (Vec::new(), Vec::new(), String::new());
    let (mut quoted, mut line, mut start) = (false, 1, 1);
    let mut chars = text.chars().peekable();
    let mut end = |row: &mut Vec<String>, cell: &mut String, start: usize| {
        row.push(std::mem::take(cell));
        let row = std::mem::take(row);
        if row.iter().any(|v| !v.trim().is_empty()) {
            out.push((start, row));
        }
    };
    while let Some(c) = chars.next() {
        if c == '\n' {
            line += 1;
        }
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                chars.next();
                cell.push('"');
            }
            ('"', true) => quoted = false,
            ('"', false) if cell.is_empty() => quoted = true,
            (',', false) => row.push(std::mem::take(&mut cell)),
            ('\r', false) if chars.peek() == Some(&'\n') => {}
            ('\n', false) => {
                end(&mut row, &mut cell, start);
                start = line;
            }
            (c, _) => cell.push(c),
        }
    }
    if quoted {
        return Err(Error::new(
            "CSV_FORMAT",
            "文件末尾有未闭合的引号，请检查表格后重试",
        ));
    }
    end(&mut row, &mut cell, start);
    Ok(out)
}

/// Reverses the export's formula guard so exported tables round-trip.
fn unguard(v: &str) -> &str {
    match v.strip_prefix('\'') {
        Some(rest) if rest.starts_with(['=', '+', '-', '@', '\t', '\r']) => rest,
        _ => v,
    }
}

fn yuan(v: &str) -> std::result::Result<Option<i64>, String> {
    let value = crate::import_values::yuan(v)?;
    if value.is_some_and(|n| n < 0) {
        return Err(format!(
            "金额「{}」须为不小于 0 的数字，最多两位小数",
            v.trim()
        ));
    }
    Ok(value)
}

fn day(v: &str, label: &str, today: &str) -> std::result::Result<Option<String>, String> {
    let v = v.trim();
    if v.is_empty() {
        return Ok(None);
    }
    match crate::import_values::day(v) {
        Some(normal) if normal.as_str() > today => Err(format!("{label}不能晚于今天")),
        Some(normal) => Ok(Some(normal)),
        None => Err(format!(
            "{label}「{v}」须写成 2026-09-01、2026/9/1 或 2026年9月1日"
        )),
    }
}

fn row(
    line: usize,
    cell: &dyn Fn(&str) -> String,
    today: &str,
) -> std::result::Result<Row, String> {
    let name = cell("名称").trim().to_owned();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("名称须为 1–200 字".into());
    }
    if !matches!(
        cell("币种").trim().to_uppercase().as_str(),
        "" | "CNY" | "RMB" | "人民币"
    ) {
        return Err("目前只支持人民币（CNY）".into());
    }
    let details = Details {
        brand: cell("品牌").trim().into(),
        model: cell("型号").trim().into(),
        serial_number: cell("序列号").trim().into(),
        notes: cell("备注"),
    };
    details.validate().map_err(|e| e.message)?;
    let named = |kind, label: &str| -> std::result::Result<Option<String>, String> {
        let v = cell(label);
        if v.trim().is_empty() {
            return Ok(None);
        }
        taxonomy::canonical_name(kind, &v)
            .map(Some)
            .map_err(|e| format!("{label}：{}", e.message))
    };
    let category = named(taxonomy::Kind::Category, "分类")?;
    let channel = named(taxonomy::Kind::Channel, "渠道")?;
    let price = yuan(&cell("购入价"))?;
    let purchase = day(&cell("购入日期"), "购入日期", today)?;
    let retired = day(&cell("退役日期"), "退役日期", today)?;
    let sold_on = day(&cell("售出日期"), "售出日期", today)?;
    let sold_price = yuan(&cell("售价"))?;
    for d in [&retired, &sold_on].into_iter().flatten() {
        if purchase.as_ref().is_some_and(|p| d < p) {
            return Err("退役或售出日期不能早于购入日期".into());
        }
    }
    let sold = match cell("状态").trim() {
        "" | "使用中" => {
            if retired.is_some() || sold_on.is_some() || sold_price.is_some() {
                return Err("状态为使用中时不能填写退役或售出信息".into());
            }
            None
        }
        "已退役" => {
            if retired.is_none() {
                return Err("已退役须填写退役日期".into());
            }
            if sold_on.is_some() || sold_price.is_some() {
                return Err("已退役时不能填写售出信息".into());
            }
            None
        }
        "已售出" => match (sold_on, sold_price) {
            (Some(d), Some(p)) => {
                if retired.as_ref().is_some_and(|r| r > &d) {
                    return Err("退役日期不能晚于售出日期".into());
                }
                Some((d, p))
            }
            _ => return Err("已售出须填写售出日期与售价".into()),
        },
        other => return Err(format!("状态「{other}」须为使用中、已退役或已售出")),
    };
    Ok(Row {
        line,
        existing: None,
        name,
        details,
        category,
        channel,
        price,
        purchase,
        retired,
        sold,
    })
}

struct Checked {
    rows: Vec<Row>,
    duplicate: Vec<bool>,
    unchanged: Vec<bool>,
    preview: Preview,
}

fn find(c: &Connection, kind: taxonomy::Kind, name: &str) -> Result<Option<String>> {
    let table = if matches!(kind, taxonomy::Kind::Category) {
        "categories"
    } else {
        "channels"
    };
    Ok(c.query_row(
        &format!("SELECT id FROM {table} WHERE name_key=?1"),
        [name.to_ascii_lowercase()],
        |r| r.get(0),
    )
    .optional()?)
}

fn check(c: &Connection, bytes: &[u8], today: &str, guarded: bool) -> Result<Checked> {
    if bytes.len() > MAX_BYTES {
        return Err(Error::new("CSV_SIZE", "文件超过 5 MB，请拆分后分批导入"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| {
        Error::new(
            "CSV_ENCODING",
            "文件不是 UTF-8 编码。请在表格软件中另存为「CSV UTF-8」后重试",
        )
    })?;
    let mut all = records(text.trim_start_matches('\u{feff}'))?.into_iter();
    let Some((_, header)) = all.next() else {
        return Err(Error::new("CSV_EMPTY", "文件是空的"));
    };
    let key = |h: &str| {
        h.trim()
            .trim_start_matches('\u{feff}')
            .replace("（元）", "")
            .replace("(元)", "")
    };
    let columns: Vec<String> = header.iter().map(|h| key(h)).collect();
    if !columns.iter().any(|c| c == "名称") {
        return Err(Error::new(
            "CSV_HEADER",
            "第一行找不到「名称」列。请用「下载模板」得到的表头",
        ));
    }
    let data: Vec<_> = all.collect();
    if data.len() > MAX_ROWS {
        return Err(Error::new("CSV_SIZE", "超过 5,000 行，请拆分后分批导入"));
    }
    let mut out = Checked {
        rows: Vec::new(),
        duplicate: Vec::new(),
        unchanged: Vec::new(),
        preview: Preview {
            hash: digest(bytes),
            valid: 0,
            additions: 0,
            updates: 0,
            unchanged: 0,
            invalid: Vec::new(),
            duplicates: Vec::new(),
            changes: Vec::new(),
            conflicts: Vec::new(),
            new_categories: Vec::new(),
            new_channels: Vec::new(),
        },
    };
    let (mut cats, mut chans) = (BTreeSet::new(), BTreeSet::new());
    // Dedup also covers repeats inside this file, so an empty library cannot
    // import the same row twice.
    let mut seen: HashSet<(String, Option<String>, Option<i64>)> = HashSet::new();
    let mut seen_ids = HashSet::new();
    for (line, cells) in data {
        let raw_id = columns
            .iter()
            .position(|c| c == "档案编号")
            .and_then(|i| cells.get(i))
            .map(|v| v.trim())
            .unwrap_or("");
        let baseline = current_cells(c, raw_id)?;
        let cell = |label: &str| {
            let value = columns
                .iter()
                .position(|c| c == label)
                .map(|i| cells.get(i).cloned().unwrap_or_default())
                .unwrap_or_else(|| baseline.get(label).cloned().unwrap_or_default());
            if guarded && columns.iter().any(|c| c == label) {
                unguard(&value).to_owned()
            } else {
                value
            }
        };
        let stable_id = cell("档案编号").trim().to_owned();
        let stable_revision = cell("档案版本").trim().to_owned();
        let existing = if stable_id.is_empty() {
            None
        } else {
            c.query_row(
                "SELECT revision,deleted_at IS NOT NULL FROM assets WHERE id=?1",
                [&stable_id],
                |x| Ok((x.get::<_, i64>(0)?, x.get::<_, bool>(1)?)),
            )
            .optional()?
        };
        // Identity checks must also cover rows with invalid editable values;
        // otherwise a stale/copy conflict could silently become a skipped row.
        let identity_issue = if stable_id.is_empty() && !stable_revision.is_empty() {
            Some("档案编号和档案版本须一起保留；新增物品请将两格都留空")
        } else if let Some((revision, deleted)) = existing {
            if !seen_ids.insert(stable_id.clone()) {
                Some("同一档案编号在文件中出现多次；复制行新增物品时请清空隐藏的档案编号和档案版本")
            } else if deleted {
                Some("这件物品已在最近删除中；请先核对原档案，不能通过表格重新新增")
            } else {
                match stable_revision.parse::<i64>().ok().filter(|n| *n > 0) {
                    Some(value) if value == revision => None,
                    Some(_) => {
                        Some("这份表格导出后，物品又被修改过。请重新导出再改，避免覆盖新内容")
                    }
                    None => Some(
                        "修改已有物品须保留隐藏的档案版本；新增物品请将档案编号和档案版本都留空",
                    ),
                }
            }
        } else {
            None
        };
        if let Some(reason) = identity_issue {
            out.preview.conflicts.push(RowNote {
                line,
                name: cell("名称").trim().into(),
                reason: reason.into(),
            });
        }
        match row(line, &cell, today) {
            Err(reason) => out.preview.invalid.push(RowNote {
                line,
                name: cell("名称").trim().into(),
                reason,
            }),
            Ok(mut r) => {
                let mut same = false;
                let mut conflict = identity_issue.is_some();
                if !conflict {
                    if let Some((revision, false)) = existing {
                        r.existing = Some((stable_id.clone(), revision));
                        if lifecycle_changed(c, &stable_id, &r)? {
                            conflict = true;
                            out.preview.conflicts.push(RowNote {
                                line,
                                name: r.name.clone(),
                                reason: "批量表格可修改名称、分类、品牌、型号、序列号、购入信息、渠道和备注；退役、重新启用或售出请到物品详情处理".into(),
                            });
                        } else {
                            same = changed_fields(c, &stable_id, &r)?.is_empty();
                        }
                    }
                }
                let in_file = !seen.insert((r.name.clone(), r.purchase.clone(), r.price));
                let dup: bool = !conflict
                    && r.existing.is_none()
                    && (in_file
                        || c.query_row(
                            "SELECT EXISTS(SELECT 1 FROM assets WHERE deleted_at IS NULL AND name=?1 AND purchase_date IS ?2 AND price_cents IS ?3)",
                            params![r.name, r.purchase, r.price],
                            |x| x.get(0),
                        )?);
                if dup {
                    out.preview.duplicates.push(RowNote {
                        line,
                        name: r.name.clone(),
                        reason: if in_file {
                            "名称、购入日期和购入价与文件内其他行相同".into()
                        } else {
                            "名称、购入日期和购入价与已有物品相同".into()
                        },
                    });
                }
                if !conflict {
                    if r.existing.is_some() && same {
                        out.preview.unchanged += 1;
                    } else if r.existing.is_some() {
                        out.preview.updates += 1;
                        out.preview.changes.push(Change {
                            line,
                            name: r.name.clone(),
                            kind: ChangeKind::Update,
                            changed: changed_fields(c, &stable_id, &r)?,
                        });
                    } else {
                        out.preview.additions += 1;
                        out.preview.changes.push(Change {
                            line,
                            name: r.name.clone(),
                            kind: ChangeKind::Add,
                            changed: Vec::new(),
                        });
                    }
                }
                for (set, kind, v) in [
                    (&mut cats, taxonomy::Kind::Category, &r.category),
                    (&mut chans, taxonomy::Kind::Channel, &r.channel),
                ] {
                    if let Some(v) = v {
                        if find(c, kind, v)?.is_none()
                            && !set.iter().any(|s: &String| s.eq_ignore_ascii_case(v))
                        {
                            set.insert(v.clone());
                        }
                    }
                }
                out.duplicate.push(dup);
                out.unchanged.push(same);
                out.rows.push(r);
            }
        }
    }
    out.preview.valid = out.rows.len();
    out.preview.new_categories = cats.into_iter().collect();
    out.preview.new_channels = chans.into_iter().collect();
    Ok(out)
}

fn changed_fields(c: &Connection, id: &str, row: &Row) -> Result<Vec<String>> {
    let current: [String; 9] = c.query_row(
        "SELECT a.name,COALESCE(c.name,''),COALESCE(p.brand,''),COALESCE(p.model,''),
                COALESCE(CAST(a.price_cents AS TEXT),''),COALESCE(a.purchase_date,''),
                COALESCE(ch.name,''),COALESCE(p.serial_number,''),COALESCE(p.notes,'')
         FROM assets a LEFT JOIN categories c ON c.id=a.category_id
         LEFT JOIN channels ch ON ch.id=a.channel_id
         LEFT JOIN asset_profiles p ON p.asset_id=a.id WHERE a.id=?1 AND a.deleted_at IS NULL",
        [id],
        |r| {
            Ok([
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
            ])
        },
    )?;
    let price = row.price.map(|v| v.to_string()).unwrap_or_default();
    let wanted = [
        row.name.as_str(),
        row.category.as_deref().unwrap_or(""),
        row.details.brand.as_str(),
        row.details.model.as_str(),
        price.as_str(),
        row.purchase.as_deref().unwrap_or(""),
        row.channel.as_deref().unwrap_or(""),
        row.details.serial_number.as_str(),
        row.details.notes.as_str(),
    ];
    let labels = [
        "名称",
        "分类",
        "品牌",
        "型号",
        "购入价",
        "购入日期",
        "渠道",
        "序列号",
        "备注",
    ];
    Ok(labels
        .iter()
        .zip(current.iter().zip(wanted))
        .filter(|(_, (old, new))| old.as_str() != *new)
        .map(|(label, _)| (*label).to_owned())
        .collect())
}

/// Omitted columns preserve existing facts; an explicitly empty editable cell
/// clears that field. New rows have no baseline.
fn current_cells(c: &Connection, id: &str) -> Result<BTreeMap<String, String>> {
    if id.is_empty() {
        return Ok(BTreeMap::new());
    }
    let value = c
        .query_row(
            "SELECT a.name,COALESCE(c.name,''),COALESCE(p.brand,''),COALESCE(p.model,''),
                a.price_cents,COALESCE(a.purchase_date,''),COALESCE(ch.name,''),
                COALESCE(p.serial_number,''),COALESCE(p.notes,''),a.lifecycle_state,
                CASE WHEN a.lifecycle_state='retired' THEN
                    (SELECT e.date FROM lifecycle_events e WHERE e.asset_id=a.id ORDER BY e.sequence DESC LIMIT 1)
                END,s.date,s.price_cents
             FROM assets a LEFT JOIN categories c ON c.id=a.category_id
             LEFT JOIN channels ch ON ch.id=a.channel_id
             LEFT JOIN asset_profiles p ON p.asset_id=a.id
             LEFT JOIN sales s ON s.asset_id=a.id AND s.revoked_at IS NULL
             WHERE a.id=?1 AND a.deleted_at IS NULL",
            [id],
            |r| {
                let money = |index| -> rusqlite::Result<String> {
                    Ok(r.get::<_, Option<i64>>(index)?
                        .map(|v| crate::currency::decimal(v, 2))
                        .unwrap_or_default())
                };
                Ok(BTreeMap::from([
                    ("名称".into(), r.get(0)?),
                    ("分类".into(), r.get(1)?),
                    ("品牌".into(), r.get(2)?),
                    ("型号".into(), r.get(3)?),
                    ("购入价".into(), money(4)?),
                    ("购入日期".into(), r.get(5)?),
                    ("渠道".into(), r.get(6)?),
                    ("序列号".into(), r.get(7)?),
                    ("备注".into(), r.get(8)?),
                    (
                        "状态".into(),
                        match r.get::<_, String>(9)?.as_str() {
                            "retired" => "已退役",
                            "sold" => "已售出",
                            _ => "使用中",
                        }
                        .into(),
                    ),
                    ("退役日期".into(), r.get::<_, Option<String>>(10)?.unwrap_or_default()),
                    ("售出日期".into(), r.get::<_, Option<String>>(11)?.unwrap_or_default()),
                    ("售价".into(), money(12)?),
                ]))
            },
        )
        .optional()?;
    Ok(value.unwrap_or_default())
}

fn lifecycle_changed(c: &Connection, id: &str, row: &Row) -> Result<bool> {
    let (state, retired, sold_date, sold_price): (String, Option<String>, Option<String>, Option<i64>) = c.query_row(
        "SELECT a.lifecycle_state,
                CASE WHEN a.lifecycle_state='retired' THEN
                    (SELECT e.date FROM lifecycle_events e WHERE e.asset_id=a.id ORDER BY e.sequence DESC LIMIT 1)
                END,
                (SELECT s.date FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL),
                (SELECT s.price_cents FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL)
         FROM assets a WHERE a.id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    Ok(match state.as_str() {
        "active" => row.retired.is_some() || row.sold.is_some(),
        "retired" => row.retired.as_ref() != retired.as_ref() || row.sold.is_some(),
        "sold" => match (&row.sold, sold_date, sold_price) {
            (Some((date, price)), Some(current_date), Some(current_price)) => {
                date != &current_date || *price != current_price || row.retired.is_some()
            }
            _ => true,
        },
        _ => true,
    })
}

/// Finds a category/channel by name or appends it at the end.
fn ensure(c: &Connection, kind: taxonomy::Kind, name: &str) -> Result<String> {
    if let Some(id) = find(c, kind, name)? {
        return Ok(id);
    }
    let table = if matches!(kind, taxonomy::Kind::Category) {
        "categories"
    } else {
        "channels"
    };
    let (count, position): (i64, i64) = c.query_row(
        &format!("SELECT count(*),coalesce(max(position),-1)+1 FROM {table}"),
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if count >= 500 {
        return Err(Error::new("TAXONOMY_LIMIT", "分类或渠道已达 500 项上限"));
    }
    let id = uid();
    if matches!(kind, taxonomy::Kind::Category) {
        c.execute(
            "INSERT INTO categories VALUES(?1,?2,?3,'box',?4)",
            params![id, name, name.to_ascii_lowercase(), position],
        )?;
    } else {
        c.execute(
            "INSERT INTO channels VALUES(?1,?2,?3,?4)",
            params![id, name, name.to_ascii_lowercase(), position],
        )?;
    }
    Ok(id)
}

/// Libraries imported before 2.4.2 hold sale audits with no saved reply, which
/// made every backup of them fail validation. Adds the missing replies; a
/// library without such rows is untouched.
pub(crate) fn repair_sale_receipts(c: &Connection) -> Result<usize> {
    let mut stmt = c.prepare(
        "SELECT a.request_id,x.id,x.name,x.price_cents,x.purchase_date,x.revision FROM sale_audit a JOIN sales s ON s.id=a.sale_id JOIN assets x ON x.id=s.asset_id WHERE NOT EXISTS(SELECT 1 FROM requests r WHERE r.id=a.request_id)",
    )?;
    let missing = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                crate::domain::Asset {
                    id: r.get(1)?,
                    name: r.get(2)?,
                    price_cents: r.get::<_, Option<i64>>(3)?.map(|n| n.to_string()),
                    purchase_date: r.get(4)?,
                    revision: r.get(5)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    if missing.is_empty() {
        return Ok(0);
    }
    let tx = c.unchecked_transaction()?;
    for (request, asset) in &missing {
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                request,
                digest(request.as_bytes()),
                serde_json::to_string(asset)?
            ],
        )?;
    }
    tx.commit()?;
    Ok(missing.len())
}

impl Store {
    pub fn preview_csv_import(&self, bytes: &[u8], today: &str) -> Result<Preview> {
        Ok(check(self.conn()?, bytes, today, true)?.preview)
    }

    pub fn preview_item_sheet(&self, bytes: &[u8], today: &str) -> Result<Preview> {
        Ok(check(self.conn()?, bytes, today, false)?.preview)
    }
    pub fn import_item_sheet(&mut self, bytes: &[u8], input: &Commit, today: &str) -> Result<Done> {
        self.import_table(bytes, input, today, false)
    }
    pub fn import_csv(&mut self, bytes: &[u8], input: &Commit, today: &str) -> Result<Done> {
        self.import_table(bytes, input, today, true)
    }
    /// Read-only check for an item import whose reply was lost. The stored
    /// reply is tied to this exact request by fingerprint; `None` means the
    /// request never committed, which is a definite answer for this dataset.
    pub fn item_import_receipt(&self, input: &Commit) -> Result<Option<Done>> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint =
            |kind: &str| -> Result<String> { Ok(digest(&serde_json::to_vec(&(kind, input))?)) };
        let Some((prior, result)) = self
            .conn()?
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
        else {
            return Ok(None);
        };
        if prior != fingerprint("csv-import")? && prior != fingerprint("xlsx-import")? {
            return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
        }
        Ok(Some(serde_json::from_str(&result)?))
    }
    fn import_table(
        &mut self,
        bytes: &[u8],
        input: &Commit,
        today: &str,
        guarded: bool,
    ) -> Result<Done> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新选择文件"));
        }
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        if digest(bytes) != input.hash {
            return Err(Error::new(
                "CSV_CHANGED",
                "文件在预览后被改动，请重新选择并核对",
            ));
        }
        self.refuse_new_asset()?;
        let fingerprint = digest(&serde_json::to_vec(&(
            if guarded { "csv-import" } else { "xlsx-import" },
            input,
        ))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some((prior, result)) = tx
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if prior != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        let checked = check(&tx, bytes, today, guarded)?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut done = Done {
            imported: 0,
            updated: 0,
            unchanged: 0,
            skipped_duplicates: 0,
            invalid: checked.preview.invalid.len(),
        };
        if !checked.preview.conflicts.is_empty() {
            return Err(Error::new(
                "CSV_CONFLICT",
                "表格中有需要重新核对的档案编号、版本或状态，资料未改变",
            ));
        }
        for ((r, dup), unchanged) in checked
            .rows
            .iter()
            .zip(&checked.duplicate)
            .zip(&checked.unchanged)
        {
            if *dup && !input.include_duplicates {
                done.skipped_duplicates += 1;
                continue;
            }
            if *unchanged {
                done.unchanged += 1;
                continue;
            }
            let at = |e: Error| Error::new(&e.code, &format!("第 {} 行：{}", r.line, e.message));
            let (request, asset_id, expected_revision) = match &r.existing {
                Some((id, revision)) => (uid(), Some(id.clone()), Some(*revision)),
                None => (uid(), None, None),
            };
            let save = Save {
                request_id: request,
                generation: input.generation.clone(),
                asset_id: asset_id.clone(),
                expected_revision,
                name: r.name.clone(),
                price_cents: r.price.map(|p| p.to_string()),
                purchase_date: r.purchase.clone(),
            };
            save.validate(today).map_err(at)?;
            let classification = Classification {
                category_id: r
                    .category
                    .as_deref()
                    .map(|n| ensure(&tx, taxonomy::Kind::Category, n))
                    .transpose()?,
                channel_id: r
                    .channel
                    .as_deref()
                    .map(|n| ensure(&tx, taxonomy::Kind::Channel, n))
                    .transpose()?,
            };
            let asset = self
                .write_asset(&tx, &save, Some(&r.details), None, Some(&classification))
                .map_err(at)?;
            if asset_id.is_some() {
                // Detail reads must observe the updated revision immediately.
                // Lifecycle/sale edits are deliberately outside bulk import.
                done.updated += 1;
                done.imported += 1;
                continue;
            }
            let mut previous = "active";
            if let Some(d) = &r.retired {
                let life = Lifecycle {
                    state: State::Active,
                    events: Vec::new(),
                };
                append_event(
                    &tx,
                    &asset.id,
                    r.purchase.as_deref(),
                    &life,
                    &Kind::Retire,
                    d,
                    "",
                    today,
                    &now,
                )
                .map_err(at)?;
                previous = "retired";
            }
            if let Some((d, price)) = &r.sold {
                let sale = uid();
                tx.execute("INSERT INTO sales(id,asset_id,previous_state,date,price_cents,platform,buyer,notes,created_at,updated_at,revoked_at) VALUES(?1,?2,?3,?4,?5,'','','',?6,?6,NULL)", params![sale, asset.id, previous, d, price, now])?;
                let snapshot = serde_json::json!({"id": sale, "previous_state": previous, "fields": {"date": d, "price_cents": price.to_string(), "platform": "", "buyer": "", "notes": ""}});
                // Backups trace every sale audit to a saved reply holding the asset.
                let request = uid();
                tx.execute(
                    "INSERT INTO requests VALUES(?1,?2,?3)",
                    params![
                        request,
                        digest(request.as_bytes()),
                        serde_json::to_string(&asset)?
                    ],
                )?;
                tx.execute("INSERT INTO sale_audit(request_id,sale_id,action,snapshot,created_at) VALUES(?1,?2,'sell',?3,?4)", params![request, sale, snapshot.to_string(), now])?;
                tx.execute(
                    "UPDATE assets SET lifecycle_state='sold' WHERE id=?1",
                    [&asset.id],
                )?;
            }
            done.imported += 1;
        }
        if done.imported == 0 && done.unchanged == 0 {
            return Err(Error::new("CSV_NOTHING", "没有可导入的行，资料未改变"));
        }
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, serde_json::to_string(&done)?],
        )?;
        self.hit("csv_import.before_commit")?;
        tx.commit()?;
        Ok(done)
    }
}
