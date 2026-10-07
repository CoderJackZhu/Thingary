//! 旧订阅合并发现：升级前独立保存的“旧版订阅档案”和“订阅类计划”可能是同一个服务。
//! 只在名称规范化后完全相同、且双方都唯一时列为候选；由用户逐对勾选确认，
//! 事务内重新核对修订与占用后，把档案挂到计划上。不按名称自动合并、不删除任何记录。
//! 档案表约束要求关联档案不带单次价格和到期日，合并前的这两项写入档案备注保留。
use crate::{
    domain::{Error, Result},
    recurring::receipt,
    storage::{digest, Store},
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct MergePair {
    pub asset_id: String,
    pub asset_name: String,
    pub asset_revision: i64,
    pub provider: String,
    pub asset_price_cents: Option<String>,
    pub asset_expires: Option<String>,
    pub stopped_on: Option<String>,
    pub plan_id: String,
    pub plan_name: String,
    pub plan_revision: i64,
    pub amount_cents: String,
    pub interval_months: i64,
    pub interval_days: Option<i64>,
    pub paid_count: i64,
    pub paid_cents: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeView {
    pub generation: String,
    pub pairs: Vec<MergePair>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePick {
    pub asset_id: String,
    pub asset_expected_revision: i64,
    pub plan_id: String,
    pub plan_expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeSave {
    pub request_id: String,
    pub generation: String,
    pub pairs: Vec<MergePick>,
}

fn norm(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn yuan(cents: i64) -> String {
    format!("¥{}.{:02}", cents / 100, cents % 100)
}

struct Legacy {
    id: String,
    name: String,
    revision: i64,
    provider: String,
    price: Option<i64>,
    expires: Option<String>,
    stopped_on: Option<String>,
}

struct Candidate {
    id: String,
    name: String,
    revision: i64,
    amount: i64,
    months: i64,
    days: Option<i64>,
}

fn pairs(c: &Connection) -> Result<Vec<MergePair>> {
    let mut assets: HashMap<String, Vec<Legacy>> = HashMap::new();
    let mut stmt = c.prepare(
        "SELECT id,name,revision,provider,price_cents,expires,stopped_on FROM virtual_assets WHERE deleted_at IS NULL AND plan_id IS NULL AND kind='subscription' AND billing='single'",
    )?;
    for row in stmt.query_map([], |r| {
        Ok(Legacy {
            id: r.get(0)?,
            name: r.get(1)?,
            revision: r.get(2)?,
            provider: r.get(3)?,
            price: r.get(4)?,
            expires: r.get(5)?,
            stopped_on: r.get(6)?,
        })
    })? {
        let row = row?;
        assets.entry(norm(&row.name)).or_default().push(row);
    }
    let mut plans: HashMap<String, Vec<Candidate>> = HashMap::new();
    // 被任何档案（含最近删除）引用过的计划交给既有的关联核对流程，不在这里猜。
    let mut stmt = c.prepare(
        "SELECT id,name,revision,amount_cents,interval_months,interval_days FROM recurring_plans r WHERE deleted_at IS NULL AND category='subscription' AND NOT EXISTS (SELECT 1 FROM virtual_assets v WHERE v.plan_id=r.id)",
    )?;
    for row in stmt.query_map([], |r| {
        Ok(Candidate {
            id: r.get(0)?,
            name: r.get(1)?,
            revision: r.get(2)?,
            amount: r.get(3)?,
            months: r.get(4)?,
            days: r.get(5)?,
        })
    })? {
        let row = row?;
        plans.entry(norm(&row.name)).or_default().push(row);
    }
    let mut out = Vec::new();
    for (key, a) in &assets {
        let Some(p) = plans.get(key) else { continue };
        if key.is_empty() || a.len() != 1 || p.len() != 1 {
            continue;
        }
        let (a, p) = (&a[0], &p[0]);
        let (paid_count, paid_cents): (i64, Option<i64>) = c.query_row(
            "SELECT count(*),sum(amount_cents) FROM plan_payments WHERE plan_id=?1 AND state='paid' AND deleted_at IS NULL",
            [&p.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        out.push(MergePair {
            asset_id: a.id.clone(),
            asset_name: a.name.clone(),
            asset_revision: a.revision,
            provider: a.provider.clone(),
            asset_price_cents: a.price.map(|v| v.to_string()),
            asset_expires: a.expires.clone(),
            stopped_on: a.stopped_on.clone(),
            plan_id: p.id.clone(),
            plan_name: p.name.clone(),
            plan_revision: p.revision,
            amount_cents: p.amount.to_string(),
            interval_months: p.months,
            interval_days: p.days,
            paid_count,
            paid_cents: paid_cents.unwrap_or(0).to_string(),
        });
    }
    out.sort_by(|a, b| {
        a.plan_name
            .cmp(&b.plan_name)
            .then(a.asset_id.cmp(&b.asset_id))
    });
    Ok(out)
}

impl Store {
    /// 读取可合并的旧订阅候选；只读，不修改任何记录。
    pub fn link_merge_view(&self) -> Result<MergeView> {
        Ok(MergeView {
            generation: self.generation(),
            pairs: pairs(self.conn()?)?,
        })
    }

    /// 用户确认的若干对一次事务合并：任一对已变化则全部不写。
    pub fn link_merge(&mut self, input: &MergeSave, today: &str) -> Result<String> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        if input.pairs.is_empty() {
            return Err(Error::new("EMPTY", "请至少选择一对"));
        }
        let fingerprint = digest(&serde_json::to_vec(&("link_merge", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(result);
        }
        let live = pairs(&tx)?;
        let now = chrono::Utc::now().to_rfc3339();
        for pick in &input.pairs {
            let pair = live
                .iter()
                .find(|p| p.asset_id == pick.asset_id && p.plan_id == pick.plan_id)
                .ok_or_else(|| Error::new("MERGE_CHANGED", "这对记录已变化，请重新读取后再合并"))?;
            if pair.asset_revision != pick.asset_expected_revision
                || pair.plan_revision != pick.plan_expected_revision
            {
                return Err(Error::new("REVISION_CONFLICT", "记录已变化，请重新读取"));
            }
            let mut kept = Vec::new();
            if let Some(p) = pair
                .asset_price_cents
                .as_ref()
                .and_then(|v| v.parse::<i64>().ok())
            {
                kept.push(format!("单次价格 {}", yuan(p)));
            }
            if let Some(e) = &pair.asset_expires {
                kept.push(format!("到期日 {e}"));
            }
            let note = if kept.is_empty() {
                String::new()
            } else {
                format!(
                    "{today} 合并前原记录：{}（已不单独计入，付款与服务期以付款计划为准）",
                    kept.join("，")
                )
            };
            let changed = tx.execute(
                "UPDATE virtual_assets SET plan_id=?2,billing='subscription',price_cents=NULL,expires=NULL,perpetual=0,notes=CASE WHEN ?3='' THEN notes WHEN notes='' THEN ?3 ELSE notes||char(10)||?3 END,revision=revision+1,updated_at=?4 WHERE id=?1 AND revision=?5 AND plan_id IS NULL AND deleted_at IS NULL",
                params![pair.asset_id, pair.plan_id, note, now, pick.asset_expected_revision],
            )?;
            if changed != 1 {
                return Err(Error::new("REVISION_CONFLICT", "记录已变化，请重新读取"));
            }
        }
        let result = input.pairs.len().to_string();
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, result],
        )?;
        self.hit("link_merge.before_commit")?;
        tx.commit()?;
        self.hit("link_merge.after_commit")?;
        Ok(result)
    }
}
