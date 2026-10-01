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
            "SELECT coalesce(sum(lifecycle_state IN ('active','retired')),0),coalesce(sum(lifecycle_state='active'),0),coalesce(sum(lifecycle_state='retired'),0),coalesce(sum(lifecycle_state='sold'),0) FROM assets WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=assets.id AND json_extract(p.payload,'$.exclude.total')=1)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let money = |filter: &str| -> Result<(i64, i64)> {
            Ok(c.query_row(
                &format!("SELECT coalesce(sum(price_cents),0),coalesce(sum(price_cents IS NULL),0) FROM assets WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=assets.id AND json_extract(p.payload,'$.exclude.total')=1) AND lifecycle_state IN {filter}"),
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?)
        };
        let (held_cents, held_unknown) = money("('active','retired')")?;
        let (history_cents, history_unknown) = money("('active','retired','sold')")?;
        // 持有天数 = max(1, today − purchase + 1); held assets end at today.
        let (average, unknown_date): (Option<f64>, i64) = c.query_row(
            "SELECT avg(max(1,julianday(?1)-julianday(purchase_date)+1)),coalesce(sum(purchase_date IS NULL),0) FROM assets WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=assets.id AND json_extract(p.payload,'$.exclude.total')=1) AND lifecycle_state IN ('active','retired')",
            [today],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let ongoing: i64 = c.query_row(
            "SELECT count(*) FROM wishlist_items WHERE status='ongoing' AND deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        let mut stmt = c.prepare(&format!(
            "SELECT c.id,coalesce(c.name,'未分类'),CASE WHEN c.id IS NOT NULL THEN (SELECT count(*) FROM categories o WHERE o.position<c.position AND EXISTS(SELECT 1 FROM assets x WHERE x.category_id=o.id AND x.deleted_at IS NULL)) END,count(*),coalesce(sum(a.price_cents),0),coalesce(sum(a.price_cents IS NULL),0) FROM assets a LEFT JOIN categories c ON c.id=a.category_id WHERE a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=a.id AND json_extract(p.payload,'$.exclude.total')=1) AND a.lifecycle_state IN {states} GROUP BY c.id ORDER BY c.position IS NULL,c.position"
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

#[derive(Clone, Debug, Serialize)]
pub struct SnapshotCategory {
    pub id: Option<String>,
    pub name: String,
    pub count: i64,
    pub known_cents: String,
    pub unknown_price_count: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct StatsSnapshot {
    pub period: String,
    pub start: Option<String>,
    pub end: String,
    pub total: i64,
    pub active: i64,
    pub retired: i64,
    pub sold: i64,
    pub known_cents: String,
    pub unknown_price_count: i64,
    pub sale_proceeds_cents: String,
    pub sold_purchase_cents: String,
    pub sold_unknown_price_count: i64,
    /// Sold assets bought for ¥0: no resale rate exists, so they stay out of the recovery figures.
    pub sold_zero_price_count: i64,
    pub categories: Vec<SnapshotCategory>,
}

impl Store {
    /// Periods select assets by purchase date. The all-time view also includes
    /// assets without a purchase date; narrower views cannot place those.
    pub fn stats_snapshot(&self, period: &str, today: &str) -> Result<StatsSnapshot> {
        use chrono::Datelike;
        let day = crate::domain::date(today)?;
        let start = match period {
            "all" => None,
            "week" => day.checked_sub_days(chrono::Days::new(
                day.weekday().num_days_from_monday() as u64
            )),
            "month" => chrono::NaiveDate::from_ymd_opt(day.year(), day.month(), 1),
            "quarter" => {
                chrono::NaiveDate::from_ymd_opt(day.year(), (day.month() - 1) / 3 * 3 + 1, 1)
            }
            "year" => chrono::NaiveDate::from_ymd_opt(day.year(), 1, 1),
            _ => return Err(Error::new("QUERY", "不支持的统计期间")),
        };
        let c = self.conn()?;
        let mut stmt = c.prepare("SELECT a.lifecycle_state,a.price_cents,c.id,coalesce(c.name,'未分类'),s.price_cents FROM assets a LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN sales s ON s.asset_id=a.id AND s.revoked_at IS NULL WHERE a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=a.id AND json_extract(p.payload,'$.exclude.statistics')=1) AND (?1 IS NULL OR a.purchase_date BETWEEN ?1 AND ?2) ORDER BY c.position IS NULL,c.position,a.id")?;
        let mut rows = stmt.query(params![start.map(|d| d.to_string()), today])?;
        let mut result = StatsSnapshot {
            period: period.into(),
            start: start.map(|d| d.to_string()),
            end: today.into(),
            total: 0,
            active: 0,
            retired: 0,
            sold: 0,
            known_cents: "0".into(),
            unknown_price_count: 0,
            sale_proceeds_cents: "0".into(),
            sold_purchase_cents: "0".into(),
            sold_unknown_price_count: 0,
            sold_zero_price_count: 0,
            categories: Vec::new(),
        };
        let (mut known, mut proceeds, mut sold_purchase) = (0i64, 0i64, 0i64);
        while let Some(row) = rows.next()? {
            let state: String = row.get(0)?;
            let price: Option<i64> = row.get(1)?;
            let category_id: Option<String> = row.get(2)?;
            let category_name: String = row.get(3)?;
            let sale_price: Option<i64> = row.get(4)?;
            result.total += 1;
            match state.as_str() {
                "active" => result.active += 1,
                "retired" => result.retired += 1,
                "sold" => result.sold += 1,
                _ => {}
            }
            if let Some(value) = price {
                known += value
            } else {
                result.unknown_price_count += 1
            }
            if state == "sold" {
                // Recovery compares like with like: only sales of assets whose purchase
                // price is known and positive enter either side.
                match price {
                    Some(value) if value > 0 => {
                        sold_purchase += value;
                        proceeds += sale_price.unwrap_or(0);
                    }
                    Some(_) => result.sold_zero_price_count += 1,
                    None => result.sold_unknown_price_count += 1,
                }
            }
            let idx = result
                .categories
                .iter()
                .position(|item| item.id == category_id);
            let category = if let Some(idx) = idx {
                &mut result.categories[idx]
            } else {
                result.categories.push(SnapshotCategory {
                    id: category_id,
                    name: category_name,
                    count: 0,
                    known_cents: "0".into(),
                    unknown_price_count: 0,
                });
                result.categories.last_mut().unwrap()
            };
            category.count += 1;
            if let Some(value) = price {
                category.known_cents =
                    (category.known_cents.parse::<i64>().unwrap_or(0) + value).to_string()
            } else {
                category.unknown_price_count += 1
            }
        }
        result.known_cents = known.to_string();
        result.sale_proceeds_cents = proceeds.to_string();
        result.sold_purchase_cents = sold_purchase.to_string();
        Ok(result)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Bucket {
    /// `2026-09`, `2026-Q3` or `2026`; both ends of the period are inclusive days.
    pub key: String,
    pub start: String,
    pub end: String,
    pub count: i64,
    pub known_cents: String,
    pub unknown_price_count: i64,
    /// Running total of known purchase prices; selling never lowers it.
    pub cumulative_cents: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Trend {
    pub generation: String,
    pub today: String,
    pub granularity: String,
    pub buckets: Vec<Bucket>,
    pub known_cents: String,
    pub unknown_price_count: i64,
    /// Purchases without a date are never assigned to a period.
    pub unknown_date_count: i64,
    pub unknown_date_known_cents: String,
}

fn period(
    date: chrono::NaiveDate,
    granularity: &str,
) -> (String, chrono::NaiveDate, chrono::NaiveDate) {
    use chrono::{Datelike, NaiveDate};
    let (y, m) = (date.year(), date.month());
    let (key, first, months) = match granularity {
        "month" => (format!("{y}-{m:02}"), m, 1),
        "quarter" => (format!("{y}-Q{}", (m - 1) / 3 + 1), (m - 1) / 3 * 3 + 1, 3),
        _ => (format!("{y}"), 1, 12),
    };
    let start = NaiveDate::from_ymd_opt(y, first, 1).expect("valid period start");
    let next = start
        .checked_add_months(chrono::Months::new(months))
        .expect("period within calendar range");
    (key, start, next.pred_opt().expect("period end"))
}

impl Store {
    pub fn purchase_trend(&self, granularity: &str, today: &str) -> Result<Trend> {
        if !["month", "quarter", "year"].contains(&granularity) {
            return Err(Error::new("QUERY", "不支持的趋势粒度"));
        }
        let today_date = crate::domain::date(today)?;
        let c = self.conn()?;
        let mut stmt = c.prepare(
            "SELECT purchase_date,price_cents FROM assets WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=assets.id AND json_extract(p.payload,'$.exclude.statistics')=1) AND purchase_date IS NOT NULL ORDER BY purchase_date",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let (unknown_dates, unknown_date_cents): (i64, i64) = c.query_row(
            "SELECT count(*),coalesce(sum(price_cents),0) FROM assets WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=assets.id AND json_extract(p.payload,'$.exclude.statistics')=1) AND purchase_date IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut buckets: Vec<Bucket> = Vec::new();
        let (mut cumulative, mut unknown_prices) = (0i64, 0i64);
        if let Some((first, _)) = rows.first() {
            // Continuous periods from the first purchase to the current one, empty ones included.
            let mut cursor = crate::domain::date(first)?;
            let last = today_date.max(crate::domain::date(&rows[rows.len() - 1].0)?);
            let mut rows = rows.iter().peekable();
            loop {
                let (key, start, end) = period(cursor, granularity);
                let (mut count, mut cents, mut unknown) = (0, 0, 0);
                while let Some((date, price)) = rows.peek() {
                    if crate::domain::date(date)? > end {
                        break;
                    }
                    count += 1;
                    match price {
                        Some(p) => cents += p,
                        None => unknown += 1,
                    }
                    rows.next();
                }
                cumulative += cents;
                unknown_prices += unknown;
                buckets.push(Bucket {
                    key,
                    start: start.to_string(),
                    end: end.to_string(),
                    count,
                    known_cents: cents.to_string(),
                    unknown_price_count: unknown,
                    cumulative_cents: cumulative.to_string(),
                });
                if end >= last {
                    break;
                }
                cursor = end.succ_opt().expect("next period");
            }
        }
        Ok(Trend {
            generation: self.generation(),
            today: today.into(),
            granularity: granularity.into(),
            buckets,
            known_cents: cumulative.to_string(),
            unknown_price_count: unknown_prices,
            unknown_date_count: unknown_dates,
            unknown_date_known_cents: unknown_date_cents.to_string(),
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct HoldingGroup {
    pub key: String,
    pub label: String,
    pub count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct RankedAsset {
    pub id: String,
    pub name: String,
    pub state: String,
    pub held_days: i64,
    /// 总投入 for held assets, 净生命周期成本 for sold ones.
    pub cost_cents: String,
    /// Display value only; ordering uses the exact cost ÷ days ratio.
    pub daily_cents: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Excluded {
    pub id: String,
    pub name: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Holding {
    pub generation: String,
    pub today: String,
    pub scope: String,
    pub groups: Vec<HoldingGroup>,
    pub dated_count: i64,
    pub unknown_date_count: i64,
    pub average_days: Option<f64>,
    pub median_days: Option<f64>,
    pub longest: Option<RankedAsset>,
    /// Current holdings by gross daily cost (总投入 ÷ 持有天数), highest first.
    pub held_ranking: Vec<RankedAsset>,
    /// Sold assets by net daily cost (净生命周期成本 ÷ 截至售出日天数), highest first.
    pub sold_ranking: Vec<RankedAsset>,
    pub excluded: Vec<Excluded>,
}

/// Whole natural months from `start` to `end`; an anniversary that does not
/// exist in a month falls on that month's last day (S04, E06/E07).
fn full_months(start: chrono::NaiveDate, end: chrono::NaiveDate) -> u32 {
    let mut months = 0;
    while start
        .checked_add_months(chrono::Months::new(months + 1))
        .is_some_and(|d| d <= end)
    {
        months += 1;
    }
    months
}

const GROUPS: [(&str, &str, u32); 6] = [
    ("lt3m", "0–3 个月", 3),
    ("3to6m", "3–6 个月", 6),
    ("6to12m", "6–12 个月", 12),
    ("1to2y", "1–2 年", 24),
    ("2to3y", "2–3 年", 36),
    ("gte3y", "3 年以上", u32::MAX),
];

impl Store {
    pub fn holding(&self, scope: &str, today: &str) -> Result<Holding> {
        let states: &[&str] = match scope {
            "held" => &["active", "retired"],
            "history" => &["active", "retired", "sold"],
            _ => return Err(Error::new("QUERY", "不支持的统计范围")),
        };
        let today_date = crate::domain::date(today)?;
        let c = self.conn()?;
        let mut stmt = c.prepare(
            "SELECT id,lifecycle_state FROM assets WHERE deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=assets.id AND json_extract(p.payload,'$.exclude.statistics')=1) ORDER BY id",
        )?;
        let ids = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut counts = [0i64; 6];
        let mut days_list: Vec<(i64, RankedAsset)> = Vec::new();
        let (mut unknown_dates, mut held_rank, mut sold_rank, mut excluded) =
            (0, Vec::new(), Vec::new(), Vec::new());
        for (id, state) in ids {
            let asset = self
                .asset(&id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "档案不存在"))?;
            let sale = crate::sales::read(c, &id)?;
            let costs = crate::maintenance::summary(c, &asset, sale.as_ref(), today)?;
            // Ranking: complete cost and a known date are both required.
            let cost = if sale.is_some() {
                &costs.net_cost_cents
            } else {
                &costs.total_investment_cents
            };
            let preferences = crate::preferences::read(c, &id)?;
            if !preferences.exclude.daily && preferences.cost_mode == "daily" {
                match (cost, costs.held_days, costs.daily_cents.as_ref()) {
                    (Some(cost), Some(days), Some(daily)) => {
                        let row = RankedAsset {
                            id: id.clone(),
                            name: asset.name.clone(),
                            state: state.clone(),
                            held_days: days,
                            cost_cents: cost.clone(),
                            daily_cents: daily.clone(),
                        };
                        if sale.is_some() {
                            sold_rank.push(row)
                        } else {
                            held_rank.push(row)
                        }
                    }
                    _ => {
                        let reason = match (
                            asset.price_cents.is_none(),
                            costs.unknown_maintenance_count > 0,
                            asset.purchase_date.is_none(),
                        ) {
                            (true, _, _) => "购入金额未知",
                            (_, true, _) => "有维护费用未知",
                            _ => "购入日期未知",
                        };
                        excluded.push(Excluded {
                            id: id.clone(),
                            name: asset.name.clone(),
                            reason: reason.into(),
                        });
                    }
                }
            }
            if !states.contains(&state.as_str()) {
                continue;
            }
            let Some(purchase) = asset.purchase_date.as_deref() else {
                unknown_dates += 1;
                continue;
            };
            let end = match &sale {
                Some(s) => crate::domain::date(&s.fields.date)?,
                None => today_date,
            };
            let months = full_months(crate::domain::date(purchase)?, end);
            let group = GROUPS
                .iter()
                .position(|(_, _, limit)| months < *limit)
                .unwrap_or(4);
            counts[group] += 1;
            let days = costs
                .held_days
                .ok_or_else(|| Error::new("DATE", "持有天数无法计算"))?;
            days_list.push((
                days,
                RankedAsset {
                    id,
                    name: asset.name,
                    state,
                    held_days: days,
                    cost_cents: String::new(),
                    daily_cents: String::new(),
                },
            ));
        }
        // Exact ratio ordering: a/b > c/d ⇔ a·d > c·b (days are always ≥ 1).
        let by_ratio = |x: &RankedAsset, y: &RankedAsset| {
            let (a, b) = (
                x.cost_cents.parse::<i128>().unwrap_or(0),
                i128::from(x.held_days),
            );
            let (p, q) = (
                y.cost_cents.parse::<i128>().unwrap_or(0),
                i128::from(y.held_days),
            );
            (p * b).cmp(&(a * q)).then_with(|| x.id.cmp(&y.id))
        };
        held_rank.sort_by(by_ratio);
        sold_rank.sort_by(by_ratio);
        days_list.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
        let n = days_list.len();
        let mut sorted: Vec<i64> = days_list.iter().map(|d| d.0).collect();
        sorted.sort_unstable();
        let median = match n {
            0 => None,
            _ if n % 2 == 1 => Some(sorted[n / 2] as f64),
            _ => Some((sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0),
        };
        Ok(Holding {
            generation: self.generation(),
            today: today.into(),
            scope: scope.into(),
            groups: GROUPS
                .iter()
                .zip(counts)
                .map(|((key, label, _), count)| HoldingGroup {
                    key: (*key).into(),
                    label: (*label).into(),
                    count,
                })
                .collect(),
            dated_count: n as i64,
            unknown_date_count: unknown_dates,
            average_days: (n > 0).then(|| sorted.iter().sum::<i64>() as f64 / n as f64),
            median_days: median,
            longest: days_list.into_iter().next().map(|d| d.1),
            held_ranking: held_rank,
            sold_ranking: sold_rank,
            excluded,
        })
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ResaleRow {
    pub id: String,
    pub name: String,
    pub purchase_cents: String,
    pub sale_cents: String,
    /// 售出价 − 购入价; negative when sold below purchase.
    pub gain_cents: String,
    /// 售出价 ÷ 购入价 in hundredths of a percent, rounded half up; not capped at 100%.
    pub rate_hundredths: i64,
    pub sold_date: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResaleRate {
    pub generation: String,
    pub today: String,
    pub included_count: i64,
    pub total_purchase_cents: String,
    pub total_sale_cents: String,
    pub total_gain_cents: String,
    /// Plain mean of the per-asset rates; `None` when nothing qualifies.
    pub average_rate_hundredths: Option<i64>,
    /// Total sale price ÷ total purchase price over the same assets.
    pub weighted_rate_hundredths: Option<i64>,
    /// Highest rate first; equal ratios fall back to the asset id.
    pub rows: Vec<ResaleRow>,
    pub excluded: Vec<Excluded>,
}

impl Store {
    /// Resale rate of sold assets (U19): sale price ÷ purchase price, maintenance
    /// ignored. Unknown or zero purchase prices cannot be rated and are listed,
    /// never counted as zero.
    pub fn resale_rate(&self, today: &str) -> Result<ResaleRate> {
        crate::domain::date(today)?;
        let c = self.conn()?;
        let mut stmt = c.prepare(
            "SELECT a.id,a.name,a.price_cents,s.price_cents,s.date FROM assets a JOIN sales s ON s.asset_id=a.id AND s.revoked_at IS NULL WHERE a.deleted_at IS NULL AND a.lifecycle_state='sold' AND NOT EXISTS(SELECT 1 FROM asset_preferences p WHERE p.asset_id=a.id AND json_extract(p.payload,'$.exclude.statistics')=1) ORDER BY a.id",
        )?;
        let sold = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut rows = Vec::new();
        let mut excluded = Vec::new();
        let (mut purchase_total, mut sale_total) = (0i128, 0i128);
        for (id, name, purchase, sale, sold_date) in sold {
            match purchase {
                Some(purchase) if purchase > 0 => {
                    let (p, s) = (i128::from(purchase), i128::from(sale));
                    purchase_total += p;
                    sale_total += s;
                    rows.push(ResaleRow {
                        id,
                        name,
                        purchase_cents: p.to_string(),
                        sale_cents: s.to_string(),
                        gain_cents: (s - p).to_string(),
                        rate_hundredths: ((s * 20000 + p) / (p * 2)) as i64,
                        sold_date,
                    });
                }
                other => excluded.push(Excluded {
                    id,
                    name,
                    reason: if other.is_none() {
                        "购入金额未知"
                    } else {
                        "购入价为 ¥0，不计算"
                    }
                    .into(),
                }),
            }
        }
        // Exact ratio ordering, highest first: a/b > c/d ⇔ a·d > c·b (purchases are positive).
        rows.sort_by(|x, y| {
            let n = |r: &ResaleRow| {
                (
                    r.sale_cents.parse::<i128>().unwrap_or(0),
                    r.purchase_cents.parse::<i128>().unwrap_or(1),
                )
            };
            let ((a, b), (p, q)) = (n(x), n(y));
            (p * b).cmp(&(a * q)).then_with(|| x.id.cmp(&y.id))
        });
        let count = rows.len() as i64;
        let average = (count > 0).then(|| {
            let sum: f64 = rows
                .iter()
                .map(|r| {
                    r.sale_cents.parse::<f64>().unwrap_or(0.0) * 10000.0
                        / r.purchase_cents.parse::<f64>().unwrap_or(1.0)
                })
                .sum();
            (sum / count as f64).round() as i64
        });
        let weighted = (count > 0)
            .then(|| ((sale_total * 20000 + purchase_total) / (purchase_total * 2)) as i64);
        Ok(ResaleRate {
            generation: self.generation(),
            today: today.into(),
            included_count: count,
            total_purchase_cents: purchase_total.to_string(),
            total_sale_cents: sale_total.to_string(),
            total_gain_cents: (sale_total - purchase_total).to_string(),
            average_rate_hundredths: average,
            weighted_rate_hundredths: weighted,
            rows,
            excluded,
        })
    }
}
