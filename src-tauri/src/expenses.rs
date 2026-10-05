//! Important expenses (ADR-001 §18). Only standalone expenses are stored; item
//! purchases, maintenance costs and sales are read from their source records,
//! so a correction there shows up here and nothing is counted twice.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const CATEGORIES: [&str; 7] = [
    "travel",
    "education",
    "health",
    "home",
    "digital",
    "gift",
    "other",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fields {
    pub title: String,
    pub date: String,
    pub amount_cents: String,
    pub category: String,
    pub notes: String,
    pub refund_cents: Option<String>,
    pub refund_date: Option<String>,
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
}

#[derive(Debug, Clone, Serialize)]
pub struct Expense {
    pub id: String,
    pub fields: Fields,
    pub revision: i64,
    pub asset_name: Option<String>,
    pub asset_deleted: bool,
}

/// One row of the expense view. `source` is purchase, maintenance, expense,
/// linked (a standalone expense now explained by an item; never summed),
/// payment (a confirmed recurring payment), virtual (a virtual asset's
/// one-time price when it has no linked plan), topup (a known paid topup of a
/// stored-value account; the only spend source of that billing mode),
/// refund or sale.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Line {
    pub source: String,
    pub id: String,
    pub asset_id: Option<String>,
    pub title: String,
    pub category: Option<String>,
    pub date: Option<String>,
    pub amount_cents: Option<String>,
    /// The standalone expense's notes (expense/linked/refund rows); search
    /// matches it per U12, other sources carry none.
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Month {
    pub month: String,
    pub spent_cents: String,
    pub refund_cents: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct View {
    pub generation: String,
    pub year: Option<i32>,
    /// Years that have at least one dated line, newest first.
    pub years: Vec<i32>,
    /// Dated lines in the chosen period, newest first.
    pub lines: Vec<Line>,
    /// Lines whose business date is unknown; never assigned to a period.
    pub undated: Vec<Line>,
    /// Twelve months when a year is chosen, otherwise empty.
    pub months: Vec<Month>,
    pub spent_cents: String,
    pub refund_cents: String,
    pub net_cents: String,
    pub sale_cents: String,
    pub undated_cents: String,
    /// Purchases or maintenance with a known date but unknown amount.
    pub unknown_amount_count: usize,
}

fn validate(f: &Fields, today: &str) -> Result<(i64, Option<i64>)> {
    let title = f.title.trim();
    if title.is_empty() || title.chars().count() > 80 || title.contains('\0') {
        return Err(Error::new("EXPENSE_TITLE", "名称须为 1–80 字"));
    }
    if f.notes.chars().count() > 10000 || f.notes.contains('\0') {
        return Err(Error::new(
            "EXPENSE_NOTES",
            "备注最多 10000 字，且不能含空字符",
        ));
    }
    if !CATEGORIES.contains(&f.category.as_str()) {
        return Err(Error::new("EXPENSE_CATEGORY", "请选择分类"));
    }
    date(&f.date)?;
    if f.date.as_str() > today {
        return Err(Error::new("EXPENSE_DATE", "支出日期不能晚于今天"));
    }
    let amount = cents(Some(&f.amount_cents))
        .map_err(|_| Error::new("EXPENSE_AMOUNT", "金额须为正数"))?
        .filter(|v| *v > 0)
        .ok_or_else(|| Error::new("EXPENSE_AMOUNT", "金额须为正数"))?;
    let refund = match (&f.refund_cents, &f.refund_date) {
        (None, None) => None,
        (Some(c), Some(d)) => {
            let r = cents(Some(c))
                .map_err(|_| Error::new("EXPENSE_REFUND", "退款金额须为正数"))?
                .filter(|v| *v > 0)
                .ok_or_else(|| Error::new("EXPENSE_REFUND", "退款金额须为正数"))?;
            if r > amount {
                return Err(Error::new("EXPENSE_REFUND", "退款不能超过支出金额"));
            }
            date(d)?;
            if d.as_str() < f.date.as_str() || d.as_str() > today {
                return Err(Error::new(
                    "EXPENSE_REFUND",
                    "退款日期须在支出日期与今天之间",
                ));
            }
            Some(r)
        }
        _ => return Err(Error::new("EXPENSE_REFUND", "退款须同时填写金额和日期")),
    };
    Ok((amount, refund))
}

fn read(c: &Connection, id: &str) -> Result<Option<Expense>> {
    Ok(c.query_row(
        "SELECT e.id,e.title,e.date,e.amount_cents,e.category,e.notes,e.refund_cents,e.refund_date,e.asset_id,e.revision,a.name,a.deleted_at IS NOT NULL FROM expenses e LEFT JOIN assets a ON a.id=e.asset_id WHERE e.id=?1 AND e.deleted_at IS NULL",
        [id],
        |r| {
            Ok(Expense {
                id: r.get(0)?,
                fields: Fields {
                    title: r.get(1)?,
                    date: r.get(2)?,
                    amount_cents: r.get::<_, i64>(3)?.to_string(),
                    category: r.get(4)?,
                    notes: r.get(5)?,
                    refund_cents: r.get::<_, Option<i64>>(6)?.map(|v| v.to_string()),
                    refund_date: r.get(7)?,
                    asset_id: r.get(8)?,
                },
                revision: r.get(9)?,
                asset_name: r.get(10)?,
                asset_deleted: r.get::<_, Option<bool>>(11)?.unwrap_or(false),
            })
        },
    )
    .optional()?)
}

// Every branch reads only effective rows, mirroring the timeline projection.
// Items excluded from the statistics page stay out of expenses too (X-D05).
// The trailing notes column carries the standalone expense's notes for search.
pub(crate) const LINES: &str = "
SELECT 'purchase',a.id,a.id,a.name,c.name,a.purchase_date,a.price_cents,NULL
  FROM assets a LEFT JOIN categories c ON c.id=a.category_id
  WHERE a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=a.id AND json_extract(p.payload,'$.exclude.statistics')=1)
UNION ALL
SELECT 'maintenance',m.id,a.id,a.name||CASE WHEN trim(m.title)='' THEN '' ELSE ' · '||m.title END,c.name,m.date,m.cost_cents,NULL
  FROM maintenances m JOIN assets a ON a.id=m.asset_id LEFT JOIN categories c ON c.id=a.category_id
  WHERE m.deleted_at IS NULL AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=a.id AND json_extract(p.payload,'$.exclude.statistics')=1)
UNION ALL
SELECT CASE WHEN e.asset_id IS NULL THEN 'expense' ELSE 'linked' END,e.id,e.asset_id,e.title,e.category,e.date,e.amount_cents,e.notes
  FROM expenses e WHERE e.deleted_at IS NULL AND (e.asset_id IS NULL OR EXISTS(SELECT 1 FROM assets x WHERE x.id=e.asset_id AND x.deleted_at IS NULL))
UNION ALL
SELECT 'refund',e.id,e.asset_id,e.title,e.category,e.refund_date,e.refund_cents,e.notes
  FROM expenses e WHERE e.deleted_at IS NULL AND e.refund_cents IS NOT NULL AND (e.asset_id IS NULL OR EXISTS(SELECT 1 FROM assets x WHERE x.id=e.asset_id AND x.deleted_at IS NULL))
UNION ALL
SELECT 'payment',p.id,NULL,r.name,r.category,p.paid_date,p.amount_cents,NULL
  FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id
  WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND p.state='paid'
UNION ALL
SELECT 'virtual',v.id,NULL,v.name,'digital',v.purchase_date,v.price_cents,NULL
  FROM virtual_assets v WHERE v.deleted_at IS NULL AND v.plan_id IS NULL AND v.price_cents IS NOT NULL
UNION ALL
SELECT 'topup',t.id,v.id,v.name,'digital',t.topup_date,t.paid_cents,NULL
  FROM virtual_topups t JOIN virtual_assets v ON v.id=t.asset_id
  WHERE t.deleted_at IS NULL AND v.deleted_at IS NULL AND t.paid_cents IS NOT NULL
UNION ALL
SELECT 'sale',s.id,a.id,a.name,c.name,s.date,s.price_cents,NULL
  FROM sales s JOIN assets a ON a.id=s.asset_id LEFT JOIN categories c ON c.id=a.category_id
  WHERE s.revoked_at IS NULL AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=a.id AND json_extract(p.payload,'$.exclude.statistics')=1)";

fn add(total: &mut i64, v: i64) -> Result<()> {
    *total = total
        .checked_add(v)
        .ok_or_else(|| Error::new("EXPENSE_OVERFLOW", "金额合计超出范围"))?;
    Ok(())
}

impl Store {
    pub fn expense(&self, id: &str) -> Result<Option<Expense>> {
        read(self.conn()?, id)
    }

    pub fn expense_save(&mut self, input: &Save, today: &str) -> Result<Expense> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("expense", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((f, id)) = prior {
            if f != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
            }
            return read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这笔支出"));
        }
        let f = &input.fields;
        let (amount, refund) = validate(f, today)?;
        let old = input
            .id
            .as_deref()
            .map(|id| read(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这笔支出")))
            .transpose()?;
        if old.as_ref().map(|e| e.revision) != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "支出已变化，请重新读取"));
        }
        if let Some(asset) = &f.asset_id {
            // Keeping an existing link to a since-deleted item is allowed;
            // a new link must point at a live item.
            let kept = old.as_ref().and_then(|e| e.fields.asset_id.as_ref()) == Some(asset);
            let live: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND deleted_at IS NULL)",
                [asset],
                |r| r.get(0),
            )?;
            if !live && !kept {
                return Err(Error::new("EXPENSE_ASSET", "关联的物品不存在或已删除"));
            }
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE expenses SET title=?2,date=?3,amount_cents=?4,category=?5,notes=?6,refund_cents=?7,refund_date=?8,asset_id=?9,revision=revision+1,updated_at=?10 WHERE id=?1",
                params![id, f.title.trim(), f.date, amount, f.category, f.notes, refund, f.refund_date, f.asset_id, now])?;
        } else {
            tx.execute("INSERT INTO expenses(id,title,date,amount_cents,category,notes,refund_cents,refund_date,asset_id,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?10)",
                params![id, f.title.trim(), f.date, amount, f.category, f.notes, refund, f.refund_date, f.asset_id, now])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这笔支出"))?;
        self.hit("expense.before_commit")?;
        tx.commit()?;
        self.hit("expense.after_commit")?;
        Ok(result)
    }

    pub fn expense_view(&self, year: Option<i32>) -> Result<View> {
        let c = self.conn()?;
        let mut q = c.prepare(LINES)?;
        let all = q
            .query_map([], |r| {
                Ok(Line {
                    source: r.get(0)?,
                    id: r.get(1)?,
                    asset_id: r.get(2)?,
                    title: r.get(3)?,
                    category: r.get(4)?,
                    date: r.get(5)?,
                    amount_cents: r.get::<_, Option<i64>>(6)?.map(|v| v.to_string()),
                    notes: r.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let years: BTreeSet<i32> = all
            .iter()
            .filter_map(|l| l.date.as_deref()?.get(..4)?.parse().ok())
            .collect();
        let in_period = |d: &str| year.is_none_or(|y| d.starts_with(&format!("{y:04}-")));
        let (mut spent, mut refunds, mut sales, mut undated_total) = (0i64, 0i64, 0i64, 0i64);
        let mut unknown = 0;
        let mut months: BTreeMap<String, (i64, i64)> = BTreeMap::new();
        if let Some(y) = year {
            for m in 1..=12 {
                months.insert(format!("{y:04}-{m:02}"), (0, 0));
            }
        }
        let (mut lines, mut undated) = (Vec::new(), Vec::new());
        for l in all {
            let amount = l
                .amount_cents
                .as_deref()
                .map(str::parse::<i64>)
                .transpose()
                .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?;
            let Some(day) = l.date.clone() else {
                // Purchases and maintenance can have unknown dates; they are a
                // separate subtotal, never assigned to a month.
                if let Some(v) = amount {
                    add(&mut undated_total, v)?;
                }
                undated.push(l);
                continue;
            };
            if !in_period(&day) {
                continue;
            }
            match (l.source.as_str(), amount) {
                ("purchase" | "maintenance", None) => unknown += 1,
                (
                    "purchase" | "maintenance" | "expense" | "payment" | "virtual" | "topup",
                    Some(v),
                ) => {
                    add(&mut spent, v)?;
                    if let Some(m) = months.get_mut(&day[..7]) {
                        add(&mut m.0, v)?;
                    }
                }
                ("refund", Some(v)) => {
                    add(&mut refunds, v)?;
                    if let Some(m) = months.get_mut(&day[..7]) {
                        add(&mut m.1, v)?;
                    }
                }
                ("sale", Some(v)) => add(&mut sales, v)?,
                _ => {}
            }
            lines.push(l);
        }
        lines.sort_by(|a, b| {
            b.date
                .cmp(&a.date)
                .then_with(|| a.source.cmp(&b.source))
                .then_with(|| a.id.cmp(&b.id))
        });
        undated.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.id.cmp(&b.id)));
        Ok(View {
            generation: self.generation(),
            year,
            years: years.into_iter().rev().collect(),
            lines,
            undated,
            months: months
                .into_iter()
                .map(|(month, (s, r))| Month {
                    month,
                    spent_cents: s.to_string(),
                    refund_cents: r.to_string(),
                })
                .collect(),
            spent_cents: spent.to_string(),
            refund_cents: refunds.to_string(),
            net_cents: (spent - refunds).to_string(),
            sale_cents: sales.to_string(),
            undated_cents: undated_total.to_string(),
            unknown_amount_count: unknown,
        })
    }
}

/// Backup validation for schema 16 data beyond what SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法支出资料");
    let mut q = c.prepare("SELECT id,title,date,amount_cents,category,notes,refund_cents,refund_date,asset_id,revision,created_at,updated_at FROM expenses")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let f = Fields {
            title: r.get(1)?,
            date: r.get(2)?,
            amount_cents: r.get::<_, i64>(3)?.to_string(),
            category: r.get(4)?,
            notes: r.get(5)?,
            refund_cents: r.get::<_, Option<i64>>(6)?.map(|v| v.to_string()),
            refund_date: r.get(7)?,
            asset_id: r.get(8)?,
        };
        if uuid::Uuid::parse_str(&id).is_err() || r.get::<_, i64>(9)? < 1 {
            return Err(bad());
        }
        validate(&f, "9999-12-31").map_err(|_| bad())?;
        for i in [10, 11] {
            chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(i)?).map_err(|_| bad())?;
        }
    }
    Ok(())
}
