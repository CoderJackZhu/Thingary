//! Timeline is a read-only projection of effective business facts. Nothing is
//! stored, so corrections, deletions, restores and restarts cannot duplicate
//! or strand events; the global page and asset detail share this one query.
use crate::{
    domain::{Error, Result},
    storage::Store,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: String,
    pub kind: String,
    pub date: Option<String>,
    pub asset_id: Option<String>,
    pub wishlist_id: Option<String>,
    pub title: String,
    /// Wish events carry the wish's current status here so the UI opens the right filter.
    pub note: String,
    pub amount_cents: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub filter: String,
    #[serde(default)]
    pub asset_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Timeline {
    pub generation: String,
    pub today: String,
    /// Newest first by business date.
    pub dated: Vec<Event>,
    /// Facts whose business date is still unknown, never placed on a guessed day.
    pub undated: Vec<Event>,
}

// Same-day order, newest first: later steps of a life come before earlier ones.
const RANK: &str = "CASE kind WHEN 'sale' THEN 0 WHEN 'retire' THEN 1 WHEN 'activate' THEN 1 WHEN 'warranty_end' THEN 2 WHEN 'maintenance' THEN 3 WHEN 'warranty_start' THEN 4 WHEN 'purchase' THEN 5 WHEN 'wish_abandoned' THEN 6 ELSE 7 END";

// Every branch reads only effective rows: live assets, unrevoked sales and
// undeleted maintenance/warranties. A converted wish appears once, as its
// asset's purchase; its own realization is not a second purchase. When that
// asset is deleted the wish keeps its realization event (D17); facts that
// belong to a deleted asset, including a linked expense's refund, disappear.
const EVENTS: &str = "
SELECT 'purchase:'||a.id AS id,'purchase' AS kind,a.purchase_date AS date,a.id AS asset_id,w.id AS wishlist_id,a.name AS title,coalesce(w.name,'') AS note,a.price_cents AS amount,0 AS seq,'' AS at
  FROM assets a LEFT JOIN wishlist_items w ON w.converted_asset_id=a.id AND w.deleted_at IS NULL WHERE a.deleted_at IS NULL
UNION ALL
SELECT 'lifecycle:'||e.id,e.kind,e.date,a.id,NULL,a.name,e.notes,NULL,e.sequence,''
  FROM lifecycle_events e JOIN assets a ON a.id=e.asset_id WHERE a.deleted_at IS NULL
UNION ALL
SELECT 'sale:'||s.id,'sale',s.date,a.id,NULL,a.name,s.platform,s.price_cents,0,''
  FROM sales s JOIN assets a ON a.id=s.asset_id WHERE s.revoked_at IS NULL AND a.deleted_at IS NULL
UNION ALL
SELECT 'maintenance:'||m.id,'maintenance',m.date,a.id,NULL,a.name,m.title,m.cost_cents,0,''
  FROM maintenances m JOIN assets a ON a.id=m.asset_id WHERE m.deleted_at IS NULL AND a.deleted_at IS NULL
UNION ALL
SELECT 'warranty_start:'||x.id,'warranty_start',x.start_date,a.id,NULL,a.name,x.kind||'|'||x.provider,NULL,0,''
  FROM warranties x JOIN assets a ON a.id=x.asset_id WHERE x.deleted_at IS NULL AND a.deleted_at IS NULL AND (x.start_date IS NULL OR x.start_date<=?1)
UNION ALL
SELECT 'warranty_end:'||x.id,'warranty_end',x.end_date,a.id,NULL,a.name,x.kind||'|'||x.provider,NULL,0,''
  FROM warranties x JOIN assets a ON a.id=x.asset_id WHERE x.deleted_at IS NULL AND a.deleted_at IS NULL AND x.end_date IS NOT NULL AND x.end_date<=?1
UNION ALL
SELECT 'wish_added:'||w.id,'wish_added',coalesce((SELECT json_extract(payload,'$.added_date') FROM wishlist_preferences WHERE wishlist_id=w.id),date(w.created_at,'localtime')),NULL,w.id,w.name,w.status,w.estimated_price_cents,0,w.created_at
  FROM wishlist_items w WHERE w.deleted_at IS NULL
UNION ALL
SELECT 'wish_abandoned:'||w.id,'wish_abandoned',date(w.abandoned_at,'localtime'),NULL,w.id,w.name,w.status,w.estimated_price_cents,0,w.abandoned_at
  FROM wishlist_items w WHERE w.status='abandoned' AND w.deleted_at IS NULL
UNION ALL
SELECT 'wish_achieved:'||w.id,'wish_achieved',date(w.achieved_at,'localtime'),NULL,w.id,w.name,w.status,w.estimated_price_cents,0,w.achieved_at FROM wishlist_items w WHERE w.status='achieved' AND w.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM assets x WHERE x.id=w.converted_asset_id AND x.deleted_at IS NULL)
UNION ALL
SELECT 'expense:'||e.id,'expense',e.date,NULL,NULL,e.title,e.category,e.amount_cents,0,'' FROM expenses e WHERE e.deleted_at IS NULL AND e.asset_id IS NULL
UNION ALL
SELECT 'payment:'||p.id,'payment',p.paid_date,NULL,NULL,r.name,r.category,p.amount_cents,0,'' FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND p.state='paid'
UNION ALL
SELECT 'refund:'||e.id,'refund',e.refund_date,e.asset_id,NULL,e.title,e.category,e.refund_cents,0,'' FROM expenses e WHERE e.deleted_at IS NULL AND e.refund_cents IS NOT NULL AND (e.asset_id IS NULL OR EXISTS(SELECT 1 FROM assets x WHERE x.id=e.asset_id AND x.deleted_at IS NULL))";

fn kinds(filter: &str) -> Result<&'static [&'static str]> {
    Ok(match filter {
        "all" => &[
            "purchase",
            "retire",
            "activate",
            "sale",
            "maintenance",
            "warranty_start",
            "warranty_end",
            "wish_added",
            "wish_abandoned",
            "wish_achieved",
            "expense",
            "refund",
            "payment",
        ],
        "purchase" => &["purchase"],
        // A linked expense is the item's purchase, so it only shows there (X-D08).
        "expense" => &["expense", "refund", "payment"],
        "maintenance" => &["maintenance"],
        "warranty" => &["warranty_start", "warranty_end"],
        "lifecycle" => &["retire", "activate", "sale"],
        "wishlist" => &["wish_added", "wish_abandoned", "wish_achieved", "purchase"],
        _ => return Err(Error::new("QUERY", "不支持的时间轴筛选")),
    })
}

impl Store {
    pub fn timeline(&self, q: &Query, today: &str) -> Result<Timeline> {
        let wanted = kinds(&q.filter)?;
        if let Some(id) = &q.asset_id {
            uuid::Uuid::parse_str(id).map_err(|_| Error::new("ID", "档案标识无效"))?;
        }
        let sql = format!(
            "SELECT id,kind,date,asset_id,wishlist_id,title,note,amount FROM ({EVENTS}) WHERE (?2 IS NULL OR asset_id=?2) ORDER BY date IS NULL,date DESC,{RANK},seq DESC,at DESC,id"
        );
        let mut stmt = self.conn()?.prepare(&sql)?;
        let rows = stmt.query_map(params![today, q.asset_id], |r| {
            Ok(Event {
                id: r.get(0)?,
                kind: r.get(1)?,
                date: r.get(2)?,
                asset_id: r.get(3)?,
                wishlist_id: r.get(4)?,
                title: r.get(5)?,
                note: r.get(6)?,
                amount_cents: r.get::<_, Option<i64>>(7)?.map(|n| n.to_string()),
            })
        })?;
        let (mut dated, mut undated) = (Vec::new(), Vec::new());
        for row in rows {
            let event = row?;
            if q.asset_id.is_none() {
                if let Some(id) = &event.asset_id {
                    if crate::preferences::read(self.conn()?, id)?.exclude.timeline {
                        continue;
                    }
                }
            }
            // The wishlist view keeps only purchases that realized a wish.
            let keep = wanted.contains(&event.kind.as_str())
                && (q.filter != "wishlist"
                    || event.kind != "purchase"
                    || event.wishlist_id.is_some());
            if keep {
                if event.date.is_some() {
                    dated.push(event);
                } else {
                    undated.push(event);
                }
            }
        }
        Ok(Timeline {
            generation: self.generation(),
            today: today.into(),
            dated,
            undated,
        })
    }
}
