//! Asset table import (D21, U14): adds new assets only, never updates or
//! merges. Preview checks every row without writing; commit re-checks the
//! same bytes and writes all valid rows in one transaction.
use crate::{
    catalog::Details,
    csv_export::HEADER,
    domain::{date, Error, Result, Save},
    lifecycle::{append_event, Kind, Lifecycle, State},
    storage::{atomic_write, digest, uid, Store},
    taxonomy::{self, Classification},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, path::Path};

pub const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_ROWS: usize = 5000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RowNote {
    pub line: usize,
    pub name: String,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Preview {
    pub hash: String,
    pub valid: usize,
    pub invalid: Vec<RowNote>,
    pub duplicates: Vec<RowNote>,
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
    pub skipped_duplicates: usize,
    pub invalid: usize,
}

/// Header-only template; the export's 档案编号 column is left out.
pub fn template() -> String {
    format!("\u{feff}{}\r\n", HEADER[1..].join(","))
}
pub fn write_template(path: &Path) -> Result<()> {
    atomic_write(path, template().as_bytes())
}

struct Row {
    line: usize,
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
    let v: String = v.trim().trim_start_matches(['¥', '￥']).replace(',', "");
    if v.is_empty() {
        return Ok(None);
    }
    let bad = || format!("金额「{v}」须为不小于 0 的数字，最多两位小数");
    let (whole, frac) = v.split_once('.').unwrap_or((&v, ""));
    if whole.is_empty()
        || whole.len() > 9
        || frac.len() > 2
        || !(whole.chars().chain(frac.chars())).all(|c| c.is_ascii_digit())
    {
        return Err(bad());
    }
    Ok(Some(
        whole.parse::<i64>().map_err(|_| bad())? * 100
            + format!("{frac:0<2}").parse::<i64>().map_err(|_| bad())?,
    ))
}

fn day(v: &str, label: &str, today: &str) -> std::result::Result<Option<String>, String> {
    let v = v.trim();
    if v.is_empty() {
        return Ok(None);
    }
    let parts: Vec<&str> = v.split(['-', '/', '.']).collect();
    let normal = match parts.as_slice() {
        [y, m, d] if y.len() == 4 => format!("{y}-{:0>2}-{:0>2}", m, d),
        _ => String::new(),
    };
    match date(&normal) {
        Ok(_) if normal.as_str() > today => Err(format!("{label}不能晚于今天")),
        Ok(_) => Ok(Some(normal)),
        Err(_) => Err(format!("{label}「{v}」须写成 2026-09-01 或 2026/9/1")),
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
        serial_number: String::new(),
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
        preview: Preview {
            hash: digest(bytes),
            valid: 0,
            invalid: Vec::new(),
            duplicates: Vec::new(),
            new_categories: Vec::new(),
            new_channels: Vec::new(),
        },
    };
    let (mut cats, mut chans) = (BTreeSet::new(), BTreeSet::new());
    for (line, cells) in data {
        let cell = |label: &str| {
            columns
                .iter()
                .position(|c| c == label)
                .and_then(|i| cells.get(i))
                .map_or(String::new(), |v| {
                    if guarded {
                        unguard(v).to_owned()
                    } else {
                        v.to_owned()
                    }
                })
        };
        match row(line, &cell, today) {
            Err(reason) => out.preview.invalid.push(RowNote {
                line,
                name: cell("名称").trim().into(),
                reason,
            }),
            Ok(r) => {
                let dup: bool = c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM assets WHERE deleted_at IS NULL AND name=?1 AND purchase_date IS ?2 AND price_cents IS ?3)",
                    params![r.name, r.purchase, r.price],
                    |x| x.get(0),
                )?;
                if dup {
                    out.preview.duplicates.push(RowNote {
                        line,
                        name: r.name.clone(),
                        reason: "名称、购入日期和购入价与已有物品相同".into(),
                    });
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
                out.rows.push(r);
            }
        }
    }
    out.preview.valid = out.rows.len();
    out.preview.new_categories = cats.into_iter().collect();
    out.preview.new_channels = chans.into_iter().collect();
    Ok(out)
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
            skipped_duplicates: 0,
            invalid: checked.preview.invalid.len(),
        };
        for (r, dup) in checked.rows.iter().zip(&checked.duplicate) {
            if *dup && !input.include_duplicates {
                done.skipped_duplicates += 1;
                continue;
            }
            let at = |e: Error| Error::new(&e.code, &format!("第 {} 行：{}", r.line, e.message));
            let save = Save {
                request_id: uid(),
                generation: input.generation.clone(),
                asset_id: None,
                expected_revision: None,
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
        if done.imported == 0 {
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
