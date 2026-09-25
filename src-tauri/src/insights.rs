//! Overview figures, recomputed from live records on every read (AC35).
//! Current holdings = undeleted Active + Retired; history adds Sold. Unknown
//! prices and dates are counted, never treated as zero.
use crate::{
    domain::{Error, Result},
    storage::Store,
};
use rusqlite::params;
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct CategoryShare {
    /// `None` is 未分类.
    pub id: Option<String>,
    pub name: String,
    /// Color slot: order among categories with any live asset, so both scopes
    /// paint a category the same; `None` (未分类 or beyond 7) uses the neutral.
    pub slot: Option<i64>,
    pub count: i64,
    pub known_cents: String,
    pub unknown_price_count: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Overview {
    pub generation: String,
    pub today: String,
    pub held_count: i64,
    pub active_count: i64,
    pub retired_count: i64,
    pub sold_count: i64,
    pub held_known_cents: String,
    pub held_unknown_price_count: i64,
    pub history_known_cents: String,
    pub history_unknown_price_count: i64,
    /// Mean natural-day holding length of held assets with a known purchase date.
    pub average_holding_days: Option<i64>,
    pub held_unknown_date_count: i64,
    pub ongoing_wishes: i64,
    pub scope: String,
    pub categories: Vec<CategoryShare>,
    pub recent: Vec<crate::timeline::Event>,
}

impl Store {
    pub fn overview(&self, scope: &str, today: &str) -> Result<Overview> {
        crate::domain::date(today)?;
        let states = match scope {
            "held" => "('active','retired')",
            "history" => "('active','retired','sold')",
            _ => return Err(Error::new("QUERY", "不支持的统计范围")),
        };
        let c = self.conn()?;
        let (held, active, retired, sold): (i64, i64, i64, i64) = c.query_row(
            "SELECT coalesce(sum(lifecycle_state IN ('active','retired')),0),coalesce(sum(lifecycle_state='active'),0),coalesce(sum(lifecycle_state='retired'),0),coalesce(sum(lifecycle_state='sold'),0) FROM assets WHERE deleted_at IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let money = |filter: &str| -> Result<(i64, i64)> {
            Ok(c.query_row(
                &format!("SELECT coalesce(sum(price_cents),0),coalesce(sum(price_cents IS NULL),0) FROM assets WHERE deleted_at IS NULL AND lifecycle_state IN {filter}"),
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?)
        };
        let (held_cents, held_unknown) = money("('active','retired')")?;
        let (history_cents, history_unknown) = money("('active','retired','sold')")?;
        // 持有天数 = max(1, today − purchase + 1); held assets end at today.
        let (average, unknown_date): (Option<f64>, i64) = c.query_row(
            "SELECT avg(max(1,julianday(?1)-julianday(purchase_date)+1)),coalesce(sum(purchase_date IS NULL),0) FROM assets WHERE deleted_at IS NULL AND lifecycle_state IN ('active','retired')",
            [today],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let ongoing: i64 = c.query_row(
            "SELECT count(*) FROM wishlist_items WHERE status='ongoing'",
            [],
            |r| r.get(0),
        )?;
        let mut stmt = c.prepare(&format!(
            "SELECT c.id,coalesce(c.name,'未分类'),CASE WHEN c.id IS NOT NULL THEN (SELECT count(*) FROM categories o WHERE o.position<c.position AND EXISTS(SELECT 1 FROM assets x WHERE x.category_id=o.id AND x.deleted_at IS NULL)) END,count(*),coalesce(sum(a.price_cents),0),coalesce(sum(a.price_cents IS NULL),0) FROM assets a LEFT JOIN categories c ON c.id=a.category_id WHERE a.deleted_at IS NULL AND a.lifecycle_state IN {states} GROUP BY c.id ORDER BY c.position IS NULL,c.position"
        ))?;
        let categories = stmt
            .query_map(params![], |r| {
                Ok(CategoryShare {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    slot: r.get::<_, Option<i64>>(2)?.filter(|n| *n < 7),
                    count: r.get(3)?,
                    known_cents: r.get::<_, i64>(4)?.to_string(),
                    unknown_price_count: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut recent = self
            .timeline(
                &crate::timeline::Query {
                    filter: "all".into(),
                    asset_id: None,
                },
                today,
            )?
            .dated;
        recent.truncate(8);
        Ok(Overview {
            generation: self.generation(),
            today: today.into(),
            held_count: held,
            active_count: active,
            retired_count: retired,
            sold_count: sold,
            held_known_cents: held_cents.to_string(),
            held_unknown_price_count: held_unknown,
            history_known_cents: history_cents.to_string(),
            history_unknown_price_count: history_unknown,
            average_holding_days: average.map(|d| d.round() as i64),
            held_unknown_date_count: unknown_date,
            ongoing_wishes: ongoing,
            scope: scope.into(),
            categories,
            recent,
        })
    }
}
