use crate::domain::{Error, Result};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Details {
    pub brand: String,
    pub model: String,
    pub serial_number: String,
    pub notes: String,
}
impl Details {
    pub fn validate(&self) -> Result<()> {
        for (value, limit) in [
            (&self.brand, 200),
            (&self.model, 200),
            (&self.serial_number, 200),
            (&self.notes, 10000),
        ] {
            if value.chars().count() > limit || value.contains('\0') {
                return Err(Error::new(
                    "DETAILS",
                    "品牌、型号和序列号最多 200 字，备注最多 10000 字，且不能包含空字符",
                ));
            }
        }
        Ok(())
    }
}

use crate::{
    domain::{Asset, Save},
    storage::Store,
};
use rusqlite::{params, OptionalExtension};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetRecord {
    pub preferences: crate::preferences::AssetPreferences,
    pub per_use_cents: Option<String>,
    pub label_name: Option<String>,
    pub sale: Option<crate::sales::Sale>,
    pub maintenances: Vec<crate::maintenance::Maintenance>,
    pub warranties: Vec<crate::warranty::Warranty>,
    pub warranty_summary: crate::warranty::WarrantySummary,
    pub costs: crate::maintenance::CostSummary,
    pub lifecycle: crate::lifecycle::Lifecycle,
    pub asset: Asset,
    pub details: Details,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted: bool,
    pub deleted_at: Option<String>,
    pub photos: Vec<crate::photos::Photo>,
    pub cover_id: Option<String>,
    pub classification: crate::taxonomy::Classification,
    #[serde(default)]
    pub origin_wishlist: Option<crate::wishlist::Origin>,
    /// Original-currency price; only present while it still converts to `asset.price_cents`.
    #[serde(default)]
    pub price_origin: Option<PriceOrigin>,
}
/// What the owner paid in a foreign currency. `price_cents` is always the converted CNY amount.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PriceOrigin {
    pub currency: String,
    pub original_minor: String,
    pub fx_rate_micro: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PriceOriginSave {
    pub generation: String,
    pub asset_id: String,
    pub origin: Option<PriceOrigin>,
}
impl PriceOrigin {
    /// The CNY cents this original price and rate convert to.
    fn converted(&self) -> Result<i64> {
        let bad = |m: &'static str| Error::new("PRICE_ORIGIN", m);
        if !crate::currency::valid(&self.currency) || crate::currency::is_cny(&self.currency) {
            return Err(bad("外币币种无效"));
        }
        let original = crate::currency::integer(&self.original_minor).map_err(bad)?;
        let rate = crate::currency::integer(&self.fx_rate_micro).map_err(bad)?;
        crate::currency::convert(&self.currency, original, rate).map_err(bad)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveAsset {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<crate::preferences::AssetOptions>,
    pub base: Save,
    pub details: Details,
    #[serde(default)]
    pub photos: Option<crate::photos::Selection>,
    #[serde(default)]
    pub classification: Option<crate::taxonomy::Classification>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub search: String,
    pub filter: String,
    pub sort: String,
    pub descending: bool,
    pub offset: u32,
    #[serde(default)]
    pub category: crate::taxonomy::CategoryFilter,
    #[serde(default)]
    pub warranty: String,
    /// None: any; "none": no tag; otherwise a tag id.
    #[serde(default)]
    pub label: Option<String>,
}
#[derive(Serialize, Debug, PartialEq)]
pub struct AssetCounts {
    pub generation: String,
    pub all: i64,
    pub active: i64,
    pub covered: i64,
    pub retired: i64,
    pub sold: i64,
}
#[derive(Serialize)]
pub struct Page {
    pub generation: String,
    pub items: Vec<AssetRecord>,
    pub total: i64,
    pub today: String,
}
impl Store {
    pub fn has_any_asset(&self) -> Result<bool> {
        Ok(self
            .conn()?
            .query_row("SELECT EXISTS(SELECT 1 FROM assets)", [], |r| r.get(0))?)
    }
    pub fn record(&self, id: &str) -> Result<Option<AssetRecord>> {
        self.record_at(id, &chrono::Local::now().format("%Y-%m-%d").to_string())
    }
    // `today` is an explicit observation day: production reads pass the local
    // calendar day, tests pass fixed days for boundary verification.
    pub fn record_at(&self, id: &str, today: &str) -> Result<Option<AssetRecord>> {
        let Some(asset) = self.asset(id)? else {
            return Ok(None);
        };
        let (details, created_at, updated_at) = self.conn()?.query_row(
            "SELECT brand,model,serial_number,notes,created_at,updated_at FROM asset_profiles WHERE asset_id=?1",[id],|r| Ok((Details {brand:r.get(0)?,model:r.get(1)?,serial_number:r.get(2)?,notes:r.get(3)?},r.get(4)?,r.get(5)?))).optional()?.unwrap_or_default();
        let deleted_at: Option<String> =
            self.conn()?
                .query_row("SELECT deleted_at FROM assets WHERE id=?1", [id], |r| {
                    r.get(0)
                })?;
        let sale = crate::sales::read(self.conn()?, id)?;
        let costs = crate::maintenance::summary(self.conn()?, &asset, sale.as_ref(), today)?;
        let warranties = crate::warranty::read(self.conn()?, id, today)?;
        let warranty_summary = crate::warranty::summarize(&warranties);
        let mut record = AssetRecord {
            preferences: crate::preferences::read(self.conn()?, id)?,
            per_use_cents: None,
            label_name: None,
            sale,
            maintenances: crate::maintenance::read(self.conn()?, id)?,
            warranties,
            warranty_summary,
            costs,
            lifecycle: self.lifecycle(id)?,
            asset,
            details,
            created_at,
            updated_at,
            photos: self.photos(id)?,
            cover_id: self.cover(id)?,
            classification: self.conn()?.query_row(
                "SELECT category_id,channel_id FROM assets WHERE id=?1",
                [id],
                |r| {
                    Ok(crate::taxonomy::Classification {
                        category_id: r.get(0)?,
                        channel_id: r.get(1)?,
                    })
                },
            )?,
            origin_wishlist: self.wishlist_origin(id)?,
            price_origin: None,
            deleted: deleted_at.is_some(),
            deleted_at,
        };
        if let Some(id) = &record.preferences.label_id {
            record.label_name = self
                .conn()?
                .query_row("SELECT name FROM named_choices WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .optional()?;
        }
        record.per_use_cents = crate::preferences::per_use_cost(&record);
        record.price_origin = self.price_origin(id, record.asset.price_cents.as_deref())?;
        Ok(Some(record))
    }
    /// The stored original price, unless the price was changed elsewhere since (then it no longer explains the CNY amount).
    fn price_origin(&self, id: &str, price_cents: Option<&str>) -> Result<Option<PriceOrigin>> {
        let origin = self
            .conn()?
            .query_row(
                "SELECT currency,original_minor,fx_rate_micro FROM asset_price_origin WHERE asset_id=?1",
                [id],
                |r| {
                    Ok(PriceOrigin {
                        currency: r.get(0)?,
                        original_minor: r.get::<_, i64>(1)?.to_string(),
                        fx_rate_micro: r.get::<_, i64>(2)?.to_string(),
                    })
                },
            )
            .optional()?;
        Ok(origin.filter(|o| {
            o.converted()
                .is_ok_and(|v| price_cents.is_some_and(|p| p == v.to_string()))
        }))
    }
    /// Records (or clears) the original-currency price of an already saved item. The CNY price must be what it converts to.
    pub fn set_price_origin(&mut self, input: &PriceOriginSave) -> Result<()> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        let tx = self.conn()?.unchecked_transaction()?;
        let price: Option<Option<String>> = tx
            .query_row(
                "SELECT CAST(price_cents AS TEXT) FROM assets WHERE id=?1 AND deleted_at IS NULL",
                [&input.asset_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(price) = price else {
            return Err(Error::new("NOT_FOUND", "找不到这件物品"));
        };
        match &input.origin {
            None => {
                tx.execute(
                    "DELETE FROM asset_price_origin WHERE asset_id=?1",
                    [&input.asset_id],
                )?;
            }
            Some(origin) => {
                let converted = origin.converted()?;
                if price.as_deref() != Some(converted.to_string().as_str()) {
                    return Err(Error::new(
                        "PRICE_ORIGIN",
                        "原币金额与汇率折算的人民币金额和物品价格不一致",
                    ));
                }
                tx.execute(
                    "INSERT INTO asset_price_origin(asset_id,currency,original_minor,fx_rate_micro) VALUES(?1,?2,?3,?4) ON CONFLICT(asset_id) DO UPDATE SET currency=excluded.currency,original_minor=excluded.original_minor,fx_rate_micro=excluded.fx_rate_micro",
                    params![
                        input.asset_id,
                        origin.currency,
                        crate::currency::integer(&origin.original_minor)
                            .map_err(|m| Error::new("PRICE_ORIGIN", m))?,
                        crate::currency::integer(&origin.fx_rate_micro)
                            .map_err(|m| Error::new("PRICE_ORIGIN", m))?
                    ],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn save_asset(&mut self, input: &SaveAsset, today: &str) -> Result<AssetRecord> {
        let result = self.save_record_with_options(
            &input.base,
            today,
            Some(&input.details),
            input.photos.as_ref(),
            input.classification.as_ref(),
            input.options.as_ref(),
        )?;
        self.record_at(&result.id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }
    pub fn saved_request(&self, request: &str, generation: &str) -> Result<Option<AssetRecord>> {
        if generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        let result: Option<String> = self
            .conn()?
            .query_row("SELECT result FROM requests WHERE id=?1", [request], |r| {
                r.get(0)
            })
            .optional()?;
        result
            .map(|s| {
                let a: Asset = serde_json::from_str(&s)?;
                self.record(&a.id)
            })
            .transpose()
            .map(Option::flatten)
    }
    fn matching_ids(&self, q: &Query, today: &str, all: bool) -> Result<(i64, Vec<String>)> {
        if q.search.chars().count() > 200 {
            return Err(Error::new("SEARCH", "搜索内容最多 200 字"));
        }
        let order = match q.sort.as_str() {
            "name" => "a.name COLLATE NOCASE",
            "price" => "a.price_cents",
            "date" => "a.purchase_date",
            "created" => "p.created_at",
            "deleted" => "a.deleted_at",
            "status" => "CASE a.lifecycle_state WHEN 'active' THEN 0 WHEN 'retired' THEN 1 WHEN 'sold' THEN 2 ELSE 3 END",
            "held" => "julianday(coalesce((SELECT s.date FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL),?4)) - julianday(a.purchase_date) + 1",
            // Same basis as the statistics ranking: (purchase + maintenance − sale) ÷
            // held days up to the sale or today (?4). Per-use items and anything
            // with an unknown price, date or maintenance cost sort last (NULL).
            "daily" => "(CASE WHEN coalesce((SELECT json_extract(payload,'$.cost_mode') FROM asset_preferences WHERE asset_id=a.id),'daily')='per_use' OR a.price_cents IS NULL OR a.purchase_date IS NULL OR EXISTS(SELECT 1 FROM maintenances m WHERE m.asset_id=a.id AND m.deleted_at IS NULL AND m.cost_cents IS NULL) THEN NULL ELSE (a.price_cents + (SELECT coalesce(sum(m.cost_cents),0) FROM maintenances m WHERE m.asset_id=a.id AND m.deleted_at IS NULL) - coalesce((SELECT s.price_cents FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL),0)) * 1.0 / (julianday(coalesce((SELECT s.date FROM sales s WHERE s.asset_id=a.id AND s.revoked_at IS NULL),?4)) - julianday(a.purchase_date) + 1) END)",
            _ => return Err(Error::new("QUERY", "不支持的排序")),
        };
        let filter = match q.filter.as_str() {
            "all" | "deleted" => "1",
            "active" => "a.lifecycle_state='active'",
            "retired" => "a.lifecycle_state='retired'",
            "sold" => "a.lifecycle_state='sold'",
            "held" => "a.lifecycle_state IN ('active','retired')",
            "missing_price" => "a.price_cents IS NULL",
            "missing_date" => "a.purchase_date IS NULL",
            _ => return Err(Error::new("QUERY", "不支持的筛选")),
        };
        // The SQL conditions mirror warranty::derive_status exactly: effective
        // means start<=today<=end with both dates known, expiring adds the
        // inclusive 0–30 day window. Cross-checked by tests/warranty.rs.
        // Parameter layout: ?1 search, ?2/?3 category, ?4 today, ?5 offset.
        let effective = "w.asset_id=a.id AND w.deleted_at IS NULL AND w.start_date IS NOT NULL AND w.end_date IS NOT NULL AND w.start_date<=?4 AND w.end_date>=?4";
        let uses_today = matches!(q.warranty.as_str(), "covered" | "expiring" | "lapsed");
        let warranty = match q.warranty.as_str() {
            "" | "all" => "1".to_string(),
            "covered" => format!("EXISTS(SELECT 1 FROM warranties w WHERE {effective})"),
            "expiring" => format!(
                "EXISTS(SELECT 1 FROM warranties w WHERE {effective} AND w.end_date<=date(?4,'+30 days'))"
            ),
            "lapsed" => format!(
                "EXISTS(SELECT 1 FROM warranties w WHERE w.asset_id=a.id AND w.deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM warranties w WHERE {effective})"
            ),
            "none" => "NOT EXISTS(SELECT 1 FROM warranties w WHERE w.asset_id=a.id AND w.deleted_at IS NULL)".to_string(),
            _ => return Err(Error::new("QUERY", "不支持的保障筛选")),
        };
        // Tag ids come from uid(); anything else is refused before it can reach the SQL text.
        let label = match q.label.as_deref() {
            None | Some("") => "1".to_string(),
            Some("none") => "(SELECT json_extract(payload,'$.label_id') FROM asset_preferences WHERE asset_id=a.id) IS NULL".to_string(),
            Some(id) if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => format!("(SELECT json_extract(payload,'$.label_id') FROM asset_preferences WHERE asset_id=a.id)='{id}'"),
            _ => return Err(Error::new("QUERY", "不支持的标签筛选")),
        };
        let visibility = if q.filter == "deleted" {
            "a.deleted_at IS NOT NULL"
        } else {
            "a.deleted_at IS NULL"
        };
        let (category_mode, category_id) = match &q.category {
            crate::taxonomy::CategoryFilter::All => (0, None),
            crate::taxonomy::CategoryFilter::Uncategorized => (1, None),
            crate::taxonomy::CategoryFilter::Category { id } => (2, Some(id.as_str())),
        };
        let direction = if q.descending { "DESC" } else { "ASC" };
        // The search haystack carries every searchable text field, including the
        // tag's display name (U12 added 标签): the label lives in preferences,
        // its name in named_choices.
        let from=format!("FROM assets a LEFT JOIN asset_profiles p ON a.id=p.asset_id LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN named_choices lbl ON lbl.kind='label' AND lbl.id=(SELECT json_extract(payload,'$.label_id') FROM asset_preferences WHERE asset_id=a.id) WHERE {visibility} AND ({filter}) AND ({warranty}) AND ({label}) AND (?2=0 OR (?2=1 AND a.category_id IS NULL) OR (?2=2 AND a.category_id=?3)) AND instr(lower(a.name || ' ' || coalesce(p.brand,'') || ' ' || coalesce(p.model,'') || ' ' || coalesce(p.serial_number,'') || ' ' || coalesce(p.notes,'') || ' ' || coalesce(c.name,'') || ' ' || coalesce(lbl.name,'')), lower(?1)) > 0");
        let total = if uses_today {
            self.conn()?.query_row(
                &format!("SELECT count(*) {from}"),
                params![q.search.trim(), category_mode, category_id, today],
                |r| r.get(0),
            )?
        } else {
            self.conn()?.query_row(
                &format!("SELECT count(*) {from}"),
                params![q.search.trim(), category_mode, category_id],
                |r| r.get(0),
            )?
        };
        // `all` lists every match for ⌘A across pages (D19); otherwise one page.
        let limit: i64 = if all { -1 } else { 100 };
        let sql=format!("SELECT a.id {from} ORDER BY coalesce((SELECT json_extract(payload,'$.pinned') FROM asset_preferences WHERE asset_id=a.id),0) DESC,({order}) IS NULL ASC, {order} {direction}, a.id ASC LIMIT ?6 OFFSET ?5");
        let mut stmt = self.conn()?.prepare(&sql)?;
        let offset = if all { 0 } else { q.offset };
        let ids = stmt
            .query_map(
                params![
                    q.search.trim(),
                    category_mode,
                    category_id,
                    today,
                    offset,
                    limit
                ],
                |r| r.get::<_, String>(0),
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok((total, ids))
    }
    /// Every asset id matching the list query, in list order (⌘A, D19).
    pub fn query_asset_ids(&self, q: &Query, today: &str) -> Result<Vec<String>> {
        Ok(self.matching_ids(q, today, true)?.1)
    }
    /// Sidebar counts (U16-D5): each number is the list total for exactly the
    /// filter its sidebar entry applies, so a count never disagrees with the list.
    pub fn asset_counts(&self, today: &str) -> Result<AssetCounts> {
        let total = |filter: &str, warranty: &str| -> Result<i64> {
            let q = Query {
                search: String::new(),
                filter: filter.into(),
                sort: "created".into(),
                descending: true,
                offset: 0,
                category: Default::default(),
                warranty: warranty.into(),
                label: None,
            };
            Ok(self.matching_ids(&q, today, false)?.0)
        };
        Ok(AssetCounts {
            generation: self.generation(),
            all: total("all", "all")?,
            active: total("active", "all")?,
            covered: total("held", "covered")?,
            retired: total("retired", "all")?,
            sold: total("sold", "all")?,
        })
    }
    pub fn query_assets(&self, q: &Query, today: &str) -> Result<Page> {
        let (total, ids) = self.matching_ids(q, today, false)?;
        let items = ids
            .into_iter()
            .map(|id| {
                self.record_at(&id, today)?
                    .ok_or_else(|| Error::new("NOT_FOUND", "档案不存在"))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Page {
            generation: self.generation(),
            items,
            total,
            today: today.into(),
        })
    }
}

/// Which record an original-currency amount belongs to, and the CNY column it must explain.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AmountKind {
    Expense,
    Income,
    Wish,
}
impl AmountKind {
    fn name(self) -> &'static str {
        match self {
            Self::Expense => "expense",
            Self::Income => "income",
            Self::Wish => "wish",
        }
    }
    fn amount_sql(self) -> &'static str {
        match self {
            Self::Expense => {
                "SELECT CAST(amount_cents AS TEXT) FROM expenses WHERE id=?1 AND deleted_at IS NULL"
            }
            Self::Income => {
                "SELECT CAST(net_cents AS TEXT) FROM plan_income WHERE id=?1 AND deleted_at IS NULL"
            }
            Self::Wish => {
                "SELECT CAST(estimated_price_cents AS TEXT) FROM wishlist_items WHERE id=?1"
            }
        }
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmountOriginSave {
    pub generation: String,
    pub kind: AmountKind,
    pub record_id: String,
    pub origin: Option<PriceOrigin>,
}
impl Store {
    fn record_amount(&self, kind: AmountKind, id: &str) -> Result<Option<Option<String>>> {
        Ok(self
            .conn()?
            .query_row(kind.amount_sql(), [id], |r| r.get(0))
            .optional()?)
    }
    /// The stored original amount, unless the CNY amount moved since (then it no longer explains it).
    pub fn amount_origin(&self, kind: AmountKind, id: &str) -> Result<Option<PriceOrigin>> {
        let amount = self.record_amount(kind, id)?.flatten();
        let origin = self
            .conn()?
            .query_row(
                "SELECT currency,original_minor,fx_rate_micro FROM amount_origin WHERE kind=?1 AND record_id=?2",
                params![kind.name(), id],
                |r| {
                    Ok(PriceOrigin {
                        currency: r.get(0)?,
                        original_minor: r.get::<_, i64>(1)?.to_string(),
                        fx_rate_micro: r.get::<_, i64>(2)?.to_string(),
                    })
                },
            )
            .optional()?;
        Ok(origin.filter(|o| {
            o.converted()
                .is_ok_and(|v| amount.as_deref() == Some(v.to_string().as_str()))
        }))
    }
    /// Records (or clears) the original-currency amount of an already saved record.
    pub fn set_amount_origin(&mut self, input: &AmountOriginSave) -> Result<()> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        let Some(amount) = self.record_amount(input.kind, &input.record_id)? else {
            return Err(Error::new("NOT_FOUND", "找不到这条记录"));
        };
        let tx = self.conn()?.unchecked_transaction()?;
        match &input.origin {
            None => {
                tx.execute(
                    "DELETE FROM amount_origin WHERE kind=?1 AND record_id=?2",
                    params![input.kind.name(), input.record_id],
                )?;
            }
            Some(origin) => {
                let converted = origin.converted()?;
                if amount.as_deref() != Some(converted.to_string().as_str()) {
                    return Err(Error::new(
                        "PRICE_ORIGIN",
                        "原币金额与汇率折算的人民币金额和记录金额不一致",
                    ));
                }
                tx.execute(
                    "INSERT INTO amount_origin(kind,record_id,currency,original_minor,fx_rate_micro) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(kind,record_id) DO UPDATE SET currency=excluded.currency,original_minor=excluded.original_minor,fx_rate_micro=excluded.fx_rate_micro",
                    params![
                        input.kind.name(),
                        input.record_id,
                        crate::currency::integer(&origin.original_minor)
                            .map_err(|m| Error::new("PRICE_ORIGIN", m))?,
                        crate::currency::integer(&origin.fx_rate_micro)
                            .map_err(|m| Error::new("PRICE_ORIGIN", m))?
                    ],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}
