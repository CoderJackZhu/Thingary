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
    pub target: crate::source::Target,
    pub domain: String,
    pub missing: Option<usize>,
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
    pub years: Vec<i32>,
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
SELECT 'purchase:'||a.id AS id,'purchase' AS kind,a.purchase_date AS date,a.id AS asset_id,w.id AS wishlist_id,a.name AS title,coalesce(w.name,'') AS note,a.price_cents AS amount,0 AS seq,'' AS at,'asset' AS source_kind,a.id AS source_id,NULL AS plan_id
  FROM assets a LEFT JOIN wishlist_items w ON w.converted_asset_id=a.id AND w.deleted_at IS NULL WHERE a.deleted_at IS NULL
UNION ALL
SELECT 'lifecycle:'||e.id,e.kind,e.date,a.id,NULL,a.name,e.notes,NULL,e.sequence,'','asset' AS source_kind,a.id AS source_id,NULL AS plan_id
  FROM lifecycle_events e JOIN assets a ON a.id=e.asset_id WHERE a.deleted_at IS NULL
UNION ALL
SELECT 'sale:'||s.id,'sale',s.date,a.id,NULL,a.name,s.platform,s.price_cents,0,'','asset' AS source_kind,a.id AS source_id,NULL AS plan_id
  FROM sales s JOIN assets a ON a.id=s.asset_id WHERE s.revoked_at IS NULL AND a.deleted_at IS NULL
UNION ALL
SELECT 'maintenance:'||m.id,'maintenance',m.date,a.id,NULL,a.name,m.title,m.cost_cents,0,'','asset' AS source_kind,a.id AS source_id,NULL AS plan_id
  FROM maintenances m JOIN assets a ON a.id=m.asset_id WHERE m.deleted_at IS NULL AND a.deleted_at IS NULL
UNION ALL
SELECT 'warranty_start:'||x.id,'warranty_start',x.start_date,a.id,NULL,a.name,x.kind||'|'||x.provider,NULL,0,'','asset' AS source_kind,a.id AS source_id,NULL AS plan_id
  FROM warranties x JOIN assets a ON a.id=x.asset_id WHERE x.deleted_at IS NULL AND a.deleted_at IS NULL AND (x.start_date IS NULL OR x.start_date<=?1)
UNION ALL
SELECT 'warranty_end:'||x.id,'warranty_end',x.end_date,a.id,NULL,a.name,x.kind||'|'||x.provider,NULL,0,'','asset' AS source_kind,a.id AS source_id,NULL AS plan_id
  FROM warranties x JOIN assets a ON a.id=x.asset_id WHERE x.deleted_at IS NULL AND a.deleted_at IS NULL AND x.end_date IS NOT NULL AND x.end_date<=?1
UNION ALL
SELECT 'wish_added:'||w.id,'wish_added',coalesce((SELECT json_extract(payload,'$.added_date') FROM wishlist_preferences WHERE wishlist_id=w.id),date(w.created_at,'localtime')),NULL,w.id,w.name,w.status,w.estimated_price_cents,0,w.created_at,'wish' AS source_kind,w.id AS source_id,NULL AS plan_id
  FROM wishlist_items w WHERE w.deleted_at IS NULL
UNION ALL
SELECT 'wish_abandoned:'||w.id,'wish_abandoned',date(w.abandoned_at,'localtime'),NULL,w.id,w.name,w.status,w.estimated_price_cents,0,w.abandoned_at,'wish' AS source_kind,w.id AS source_id,NULL AS plan_id
  FROM wishlist_items w WHERE w.status='abandoned' AND w.deleted_at IS NULL
UNION ALL
SELECT 'wish_achieved:'||w.id,'wish_achieved',date(w.achieved_at,'localtime'),NULL,w.id,w.name,w.status,w.estimated_price_cents,0,w.achieved_at,'wish' AS source_kind,w.id AS source_id,NULL AS plan_id FROM wishlist_items w WHERE w.status='achieved' AND w.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM assets x WHERE x.id=w.converted_asset_id AND x.deleted_at IS NULL)
UNION ALL
SELECT 'expense:'||e.id,'expense',e.date,NULL,NULL,e.title,e.category,e.amount_cents,0,'','expense' AS source_kind,e.id AS source_id,NULL AS plan_id FROM expenses e WHERE e.deleted_at IS NULL AND e.asset_id IS NULL
UNION ALL
SELECT 'payment:'||p.id,'payment',p.paid_date,NULL,NULL,r.name,r.category,p.amount_cents,0,'','payment' AS source_kind,p.id AS source_id,p.plan_id AS plan_id FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.deleted_at IS NULL AND r.deleted_at IS NULL AND p.state='paid'
UNION ALL
SELECT 'virtual:'||v.id,'virtual',v.purchase_date,NULL,NULL,v.name,v.kind,CASE WHEN v.plan_id IS NULL THEN v.price_cents END,0,'','virtual' AS source_kind,v.id AS source_id,NULL AS plan_id FROM virtual_assets v WHERE v.deleted_at IS NULL AND v.purchase_date IS NOT NULL
UNION ALL
SELECT 'topup:'||t.id,'topup',t.topup_date,NULL,NULL,v.name,'digital',t.paid_cents,0,'','topup' AS source_kind,t.id AS source_id,v.id AS plan_id FROM virtual_topups t JOIN virtual_assets v ON v.id=t.asset_id WHERE t.deleted_at IS NULL AND v.deleted_at IS NULL AND t.paid_cents IS NOT NULL AND t.topup_date IS NOT NULL
UNION ALL
SELECT 'refund:'||e.id,'refund',e.refund_date,e.asset_id,NULL,e.title,e.category,e.refund_cents,0,'','expense' AS source_kind,e.id AS source_id,NULL AS plan_id FROM expenses e WHERE e.deleted_at IS NULL AND e.refund_cents IS NOT NULL AND (e.asset_id IS NULL OR EXISTS(SELECT 1 FROM assets x WHERE x.id=e.asset_id AND x.deleted_at IS NULL))";

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
            "virtual",
            "topup",
            "snapshot",
        ],
        "snapshot" => &["snapshot"],
        "purchase" => &["purchase"],
        // A linked expense is the item's purchase, so it only shows there (X-D08).
        "expense" => &["expense", "refund", "payment", "virtual", "topup"],
        "maintenance" => &["maintenance"],
        "warranty" => &["warranty_start", "warranty_end"],
        "lifecycle" => &["retire", "activate", "sale"],
        "wishlist" => &["wish_added", "wish_abandoned", "wish_achieved", "purchase"],
        _ => return Err(Error::new("QUERY", "不支持的时间轴筛选")),
    })
}

impl Store {
    pub fn timeline(&self, q: &Query, today: &str) -> Result<Timeline> {
        self.timeline_read(q, today, false)
    }
    pub(crate) fn timeline_with_snapshots(&self, q: &Query, today: &str) -> Result<Timeline> {
        self.timeline_read(q, today, true)
    }
    fn timeline_read(&self, q: &Query, today: &str, include_snapshots: bool) -> Result<Timeline> {
        let wanted = kinds(&q.filter)?;
        if let Some(id) = &q.asset_id {
            uuid::Uuid::parse_str(id).map_err(|_| Error::new("ID", "档案标识无效"))?;
        }
        let sql = format!(
            "SELECT id,kind,date,asset_id,wishlist_id,title,note,amount,source_kind,source_id,plan_id FROM ({EVENTS}) WHERE (?2 IS NULL OR asset_id=?2) ORDER BY date IS NULL,date DESC,{RANK},seq DESC,at DESC,id"
        );
        let mut stmt = self.conn()?.prepare(&sql)?;
        let rows = stmt.query_map(params![today, q.asset_id], |r| {
            let source_kind: String = r.get(8)?;
            let id: String = r.get(9)?;
            let target = match source_kind.as_str() {
                "asset" => crate::source::Target::Asset { id },
                "wish" => crate::source::Target::Wish { id },
                "payment" => crate::source::Target::Payment {
                    id,
                    plan_id: r.get(10)?,
                },
                "virtual" => crate::source::Target::Virtual { id },
                "topup" => crate::source::Target::Topup {
                    id,
                    asset_id: r.get(10)?,
                },
                _ => crate::source::Target::Expense { id },
            };
            let domain = match source_kind.as_str() {
                "asset" => "physical",
                "wish" => "wish",
                _ => "expense",
            }
            .into();
            Ok(Event {
                target,
                domain,
                missing: None,
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
        if include_snapshots && q.asset_id.is_none() && wanted.contains(&"snapshot") {
            for point in self.wealth_summary()?.points {
                dated.push(Event {
                    id: format!("snapshot:{}", point.snapshot_id),
                    kind: "snapshot".into(),
                    date: Some(point.date),
                    asset_id: None,
                    wishlist_id: None,
                    title: "财富盘点".into(),
                    note: String::new(),
                    amount_cents: point.complete.then_some(point.net_cents),
                    missing: Some(point.missing),
                    domain: "wealth".into(),
                    target: crate::source::Target::Snapshot {
                        id: point.snapshot_id,
                    },
                });
            }
            // Stable sort preserves the established same-day physical event order.
            dated.sort_by(|a, b| b.date.cmp(&a.date));
        }
        let years = dated
            .iter()
            .filter_map(|e| e.date.as_ref()?.get(..4)?.parse::<i32>().ok())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .rev()
            .collect();
        Ok(Timeline {
            generation: self.generation(),
            today: today.into(),
            years,
            dated,
            undated,
        })
    }
}

impl Store {
    pub fn timeline_view(
        &self,
        q: &Query,
        domain: &str,
        year: Option<i32>,
        today: &str,
    ) -> Result<Timeline> {
        if !["all", "physical", "wish", "wealth", "expense"].contains(&domain)
            || year.is_some_and(|y| !(1..=9999).contains(&y))
        {
            return Err(Error::new("QUERY", "时间轴筛选无效"));
        }
        let tx = self.conn()?.unchecked_transaction()?;
        let mut result = self.timeline_with_snapshots(q, today)?;
        result
            .dated
            .retain(|e| domain == "all" || e.domain == domain);
        result
            .undated
            .retain(|e| domain == "all" || e.domain == domain);
        // Year options follow the domain and kind selection, never the active
        // year: an empty result keeps every reachable year in the picker.
        result.years = result
            .dated
            .iter()
            .filter_map(|e| e.date.as_ref()?.get(..4)?.parse::<i32>().ok())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .rev()
            .collect();
        if let Some(y) = year {
            let prefix = format!("{y:04}-");
            result
                .dated
                .retain(|e| e.date.as_ref().is_some_and(|d| d.starts_with(&prefix)));
        }
        tx.commit()?;
        Ok(result)
    }
}
