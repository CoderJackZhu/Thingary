//! U17 · 标签投入分析只读投影（产品设计 D23）。按稳定标签 ID 聚合当前库中
//! 未删除物品的已知购入、有效维护与未撤销售出回收；未知金额保持缺失，
//! 统计排除沿用 `exclude.statistics`。不写入任何业务资料或派生表。
use crate::{
    domain::{date, Error, Result},
    storage::Store,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TagInvestmentQuery {
    pub label_id: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagLabelInfo {
    pub id: String,
    pub name: String,
    pub inactive: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInvestmentCounts {
    pub matched: i64,
    pub included: i64,
    pub excluded: i64,
    pub active: i64,
    pub retired: i64,
    pub sold: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInvestmentTotals {
    pub known_purchase_cents: String,
    pub known_maintenance_cents: String,
    pub known_investment_cents: String,
    pub sale_proceeds_cents: String,
    pub known_net_cents: String,
    pub complete_investment_cents: Option<String>,
    pub complete_net_cents: Option<String>,
    pub has_known_purchase: bool,
    pub has_known_maintenance_record: bool,
    pub has_known_investment: bool,
    pub missing_purchase_count: i64,
    pub missing_maintenance_count: i64,
    pub incomplete_asset_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInvestmentItem {
    pub id: String,
    pub name: String,
    pub category_name: String,
    pub lifecycle_state: String,
    pub brand: String,
    pub model: String,
    pub serial_number: String,
    pub notes: String,
    pub purchase_cents: Option<String>,
    pub known_maintenance_cents: String,
    pub known_maintenance_record_count: i64,
    pub missing_maintenance_count: i64,
    pub known_investment_cents: String,
    pub complete_investment_cents: Option<String>,
    pub has_known_investment: bool,
    pub sale_proceeds_cents: String,
    pub incomplete: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInvestmentView {
    pub generation: String,
    pub today: String,
    pub label: TagLabelInfo,
    pub scope: String,
    pub counts: TagInvestmentCounts,
    pub totals: TagInvestmentTotals,
    pub items: Vec<TagInvestmentItem>,
}

/// One matched row: identity, money facts and the effective sale, all from a
/// single worker-thread read so amounts and details share one snapshot.
struct MatchedAsset {
    id: String,
    state: String,
    name: String,
    category_name: String,
    brand: String,
    model: String,
    serial_number: String,
    notes: String,
    price_cents: Option<i64>,
    statistics_excluded: bool,
    /// `(price, count)` of the single effective sale; `None` when unsold.
    sale: Option<(i64, i64)>,
}

fn matched_assets(c: &Connection, label_id: &str, states: &str) -> Result<Vec<MatchedAsset>> {
    let sql = format!(
        "SELECT a.id,a.lifecycle_state,a.name,a.price_cents,coalesce(c.name,'未分类'),\
         coalesce(p.brand,''),coalesce(p.model,''),coalesce(p.serial_number,''),coalesce(p.notes,''),\
         coalesce((SELECT json_extract(ap.payload,'$.exclude.statistics') FROM asset_preferences ap WHERE ap.asset_id=a.id),0),\
         (SELECT s.price_cents FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL),\
         (SELECT count(*) FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL) \
         FROM assets a \
         LEFT JOIN asset_profiles p ON p.asset_id=a.id \
         LEFT JOIN categories c ON c.id=a.category_id \
         WHERE a.deleted_at IS NULL \
           AND (SELECT json_extract(ap.payload,'$.label_id') FROM asset_preferences ap WHERE ap.asset_id=a.id)=?1 \
           AND a.lifecycle_state IN {states} \
         ORDER BY a.id"
    );
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt
        .query_map([label_id], |r| {
            let sale_price: Option<i64> = r.get(10)?;
            let sale_count: i64 = r.get(11)?;
            Ok(MatchedAsset {
                id: r.get(0)?,
                state: r.get(1)?,
                name: r.get(2)?,
                category_name: r.get(4)?,
                brand: r.get(5)?,
                model: r.get(6)?,
                serial_number: r.get(7)?,
                notes: r.get(8)?,
                price_cents: r.get(3)?,
                statistics_excluded: r.get::<_, i64>(9)? == 1,
                sale: sale_price.map(|price| (price, sale_count)),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for row in &rows {
        match (&row.sale, row.state.as_str()) {
            // 正常业务售出必须有金额；不一致资料按可重试的读取错误返回，
            // 不静默当作零回收，也不把有效销售挂到未售出物品上。
            (None, "sold") => {
                return Err(Error::new(
                    "SALE",
                    "已售出物品缺少有效售价，请重试或先更正售出记录",
                ))
            }
            (Some((_, count)), _) if *count > 1 => {
                return Err(Error::new(
                    "SALE",
                    "存在多条有效售出记录，请重试或先更正售出记录",
                ))
            }
            (Some(_), state) if state != "sold" => {
                return Err(Error::new(
                    "SALE",
                    "未售出物品存在有效售出记录，请重试或先更正售出记录",
                ))
            }
            _ => {}
        }
    }
    Ok(rows)
}

/// Known cost sums per asset: `(known_sum, known_records, unknown_records)`.
/// Rows are aggregated in Rust with checked arithmetic so a single asset can
/// never overflow silently (SQL SUM would).
fn maintenance_sums(
    c: &Connection,
    label_id: &str,
    states: &str,
) -> Result<HashMap<String, (i64, i64, i64)>> {
    let sql = format!(
        "SELECT m.asset_id,m.cost_cents FROM maintenances m \
         JOIN assets a ON a.id=m.asset_id \
         WHERE m.deleted_at IS NULL AND a.deleted_at IS NULL \
           AND (SELECT json_extract(ap.payload,'$.label_id') FROM asset_preferences ap WHERE ap.asset_id=m.asset_id)=?1 \
           AND a.lifecycle_state IN {states}"
    );
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt
        .query_map([label_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut sums: HashMap<String, (i64, i64, i64)> = HashMap::new();
    for (asset_id, cost) in rows {
        let entry = sums.entry(asset_id).or_insert((0, 0, 0));
        match cost {
            Some(value) => {
                entry.0 = entry
                    .0
                    .checked_add(value)
                    .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
                entry.1 += 1;
            }
            None => entry.2 += 1,
        }
    }
    Ok(sums)
}

impl Store {
    pub fn tag_investment_view(
        &self,
        label_id: &str,
        scope: &str,
        today: &str,
    ) -> Result<TagInvestmentView> {
        date(today)?;
        if label_id.is_empty()
            || !label_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(Error::new("QUERY", "不支持的标签筛选"));
        }
        let states = match scope {
            "all" => "('active','retired','sold')",
            "held" => "('active','retired')",
            _ => return Err(Error::new("QUERY", "不支持的统计范围")),
        };
        let c = self.conn()?;
        // 没有匹配物品的有效标签是空结果；不存在的标签 ID 是失效错误，
        // 不按同名标签替代（D23 开发细化）。
        let (name, enabled): (String, bool) = c
            .query_row(
                "SELECT name,enabled FROM named_choices WHERE id=?1 AND kind='label'",
                [label_id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .optional()?
            .ok_or_else(|| Error::new("LABEL", "标签已不可用，请返回物品列表重新选择"))?;
        let rows = matched_assets(c, label_id, states)?;
        let sums = maintenance_sums(c, label_id, states)?;
        let mut items: Vec<TagInvestmentItem> = Vec::new();
        let mut counts = TagInvestmentCounts {
            matched: rows.len() as i64,
            included: 0,
            excluded: 0,
            active: 0,
            retired: 0,
            sold: 0,
        };
        let (mut known_purchase, mut known_maintenance, mut proceeds) = (0i64, 0i64, 0i64);
        let (mut missing_purchase, mut missing_maintenance, mut incomplete_assets) =
            (0i64, 0i64, 0i64);
        let mut has_known_purchase = false;
        let mut has_known_maintenance_record = false;
        for row in rows {
            if row.statistics_excluded {
                counts.excluded += 1;
                continue;
            }
            counts.included += 1;
            match row.state.as_str() {
                "active" => counts.active += 1,
                "retired" => counts.retired += 1,
                "sold" => counts.sold += 1,
                _ => {}
            }
            let (known_sum, known_records, unknown_records) =
                sums.get(&row.id).copied().unwrap_or((0, 0, 0));
            let purchase = row.price_cents;
            let sale_price = row.sale.as_ref().map(|(price, _)| *price).unwrap_or(0);
            let known_investment = purchase
                .unwrap_or(0)
                .checked_add(known_sum)
                .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
            let complete = purchase.is_some() && unknown_records == 0;
            known_purchase = known_purchase
                .checked_add(purchase.unwrap_or(0))
                .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
            known_maintenance = known_maintenance
                .checked_add(known_sum)
                .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
            proceeds = proceeds
                .checked_add(sale_price)
                .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
            if purchase.is_none() {
                missing_purchase += 1;
            }
            missing_maintenance += unknown_records;
            let has_known_investment = purchase.is_some() || known_records > 0;
            has_known_purchase |= purchase.is_some();
            has_known_maintenance_record |= known_records > 0;
            if !complete {
                incomplete_assets += 1;
            }
            items.push(TagInvestmentItem {
                id: row.id,
                name: row.name,
                category_name: row.category_name,
                lifecycle_state: row.state,
                brand: row.brand,
                model: row.model,
                serial_number: row.serial_number,
                notes: row.notes,
                purchase_cents: purchase.map(|n| n.to_string()),
                known_maintenance_cents: known_sum.to_string(),
                known_maintenance_record_count: known_records,
                missing_maintenance_count: unknown_records,
                known_investment_cents: known_investment.to_string(),
                complete_investment_cents: if complete {
                    Some(known_investment.to_string())
                } else {
                    None
                },
                has_known_investment,
                sale_proceeds_cents: sale_price.to_string(),
                incomplete: !complete,
            });
        }
        // 完整物品按累计投入降序、同额按稳定 ID；不完整行组排在完整行之后，
        // 内部也按已知投入降序、再按 ID；无已知分量的行自然落在组末。
        items.sort_by(|a, b| {
            a.incomplete.cmp(&b.incomplete).then_with(|| {
                b.known_investment_cents
                    .parse::<i64>()
                    .unwrap_or(0)
                    .cmp(&a.known_investment_cents.parse::<i64>().unwrap_or(0))
                    .then_with(|| a.id.cmp(&b.id))
            })
        });
        let known_investment = known_purchase
            .checked_add(known_maintenance)
            .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
        let known_net = known_investment
            .checked_sub(proceeds)
            .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
        let complete_investment = if missing_purchase == 0 && missing_maintenance == 0 {
            Some(known_investment)
        } else {
            None
        };
        let complete_net = complete_investment
            .map(|total| {
                total
                    .checked_sub(proceeds)
                    .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))
            })
            .transpose()?;
        Ok(TagInvestmentView {
            generation: self.generation(),
            today: today.into(),
            label: TagLabelInfo {
                id: label_id.into(),
                name,
                inactive: !enabled,
            },
            scope: scope.into(),
            counts,
            totals: TagInvestmentTotals {
                known_purchase_cents: known_purchase.to_string(),
                known_maintenance_cents: known_maintenance.to_string(),
                known_investment_cents: known_investment.to_string(),
                sale_proceeds_cents: proceeds.to_string(),
                known_net_cents: known_net.to_string(),
                complete_investment_cents: complete_investment.map(|n| n.to_string()),
                complete_net_cents: complete_net.map(|n| n.to_string()),
                has_known_purchase,
                has_known_maintenance_record,
                has_known_investment: has_known_purchase || has_known_maintenance_record,
                missing_purchase_count: missing_purchase,
                missing_maintenance_count: missing_maintenance,
                incomplete_asset_count: incomplete_assets,
            },
            items,
        })
    }
}
