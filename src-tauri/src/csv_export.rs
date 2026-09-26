//! Readable asset table (AC30, R06). Not a backup: no photos, maintenance,
//! warranties or wishes. RFC 4180 with UTF-8 BOM and CRLF so spreadsheets
//! open Chinese text correctly; unknown values stay empty, never zero.
use crate::{
    domain::Result,
    storage::{atomic_write, Store},
};
use std::path::Path;

pub const HEADER: [&str; 13] = [
    "档案编号",
    "名称",
    "分类",
    "品牌",
    "型号",
    "购入价（元）",
    "币种",
    "购入日期",
    "渠道",
    "状态",
    "售出日期",
    "售价（元）",
    "备注",
];

/// Text a spreadsheet could run as a formula gets a leading apostrophe.
fn text(value: &str) -> String {
    if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{value}")
    } else {
        value.to_owned()
    }
}

fn yuan(cents: Option<i64>) -> String {
    cents.map_or_else(String::new, |c| {
        let sign = if c < 0 { "-" } else { "" };
        format!("{sign}{}.{:02}", c.abs() / 100, c.abs() % 100)
    })
}

fn field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) || value != value.trim() {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

impl Store {
    pub fn asset_csv(&self) -> Result<String> {
        let mut stmt = self.conn()?.prepare(
            "SELECT a.id,a.name,c.name,p.brand,p.model,a.price_cents,a.purchase_date,ch.name,a.lifecycle_state,s.date,s.price_cents,p.notes
             FROM assets a LEFT JOIN asset_profiles p ON p.asset_id=a.id LEFT JOIN categories c ON c.id=a.category_id
             LEFT JOIN channels ch ON ch.id=a.channel_id LEFT JOIN sales s ON s.asset_id=a.id AND s.revoked_at IS NULL
             WHERE a.deleted_at IS NULL ORDER BY p.created_at IS NULL,p.created_at,a.id",
        )?;
        let mut out = String::from("\u{feff}");
        out.push_str(&HEADER.map(field).join(","));
        out.push_str("\r\n");
        let rows = stmt.query_map([], |r| {
            let t = |i: usize| r.get::<_, Option<String>>(i).map(|v| v.unwrap_or_default());
            let state = match r.get::<_, String>(8)?.as_str() {
                "retired" => "已退役",
                "sold" => "已售出",
                _ => "使用中",
            };
            Ok([
                t(0)?,
                text(&t(1)?),
                text(&t(2)?),
                text(&t(3)?),
                text(&t(4)?),
                yuan(r.get(5)?),
                "CNY".into(),
                t(6)?,
                text(&t(7)?),
                state.into(),
                t(9)?,
                yuan(r.get(10)?),
                text(&t(11)?),
            ])
        })?;
        for row in rows {
            out.push_str(&row?.map(|v| field(&v)).join(","));
            out.push_str("\r\n");
        }
        Ok(out)
    }

    /// The native save panel already confirmed any replacement; the write is atomic.
    pub fn export_csv(&self, destination: &Path) -> Result<i64> {
        let csv = self.asset_csv()?;
        atomic_write(destination, csv.as_bytes())?;
        Ok(self.conn()?.query_row(
            "SELECT count(*) FROM assets WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?)
    }
}
