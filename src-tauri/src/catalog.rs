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
    pub asset: Asset,
    pub details: Details,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub deleted: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveAsset {
    pub base: Save,
    pub details: Details,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub search: String,
    pub filter: String,
    pub sort: String,
    pub descending: bool,
    pub offset: u32,
}
#[derive(Serialize)]
pub struct Page {
    pub generation: String,
    pub items: Vec<AssetRecord>,
    pub total: i64,
    pub today: String,
}
impl Store {
    pub fn record(&self, id: &str) -> Result<Option<AssetRecord>> {
        let Some(asset) = self.asset(id)? else {
            return Ok(None);
        };
        let (details, created_at, updated_at) = self.conn()?.query_row(
            "SELECT brand,model,serial_number,notes,created_at,updated_at FROM asset_profiles WHERE asset_id=?1",[id],|r| Ok((Details {brand:r.get(0)?,model:r.get(1)?,serial_number:r.get(2)?,notes:r.get(3)?},r.get(4)?,r.get(5)?))).optional()?.unwrap_or_default();
        let deleted = self.conn()?.query_row(
            "SELECT deleted_at IS NOT NULL FROM assets WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        Ok(Some(AssetRecord {
            asset,
            details,
            created_at,
            updated_at,
            deleted,
        }))
    }
    pub fn save_asset(&mut self, input: &SaveAsset, today: &str) -> Result<AssetRecord> {
        let result = self.save_record(&input.base, today, Some(&input.details))?;
        self.record(&result.id)?
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
    pub fn query_assets(&self, q: &Query, today: &str) -> Result<Page> {
        if q.search.chars().count() > 200 {
            return Err(Error::new("SEARCH", "搜索内容最多 200 字"));
        }
        let order = match q.sort.as_str() {
            "name" => "a.name COLLATE NOCASE",
            "price" => "a.price_cents",
            "date" => "a.purchase_date",
            "created" => "p.created_at",
            _ => return Err(Error::new("QUERY", "不支持的排序")),
        };
        let filter = match q.filter.as_str() {
            "all" => "1",
            "missing_price" => "a.price_cents IS NULL",
            "missing_date" => "a.purchase_date IS NULL",
            _ => return Err(Error::new("QUERY", "不支持的筛选")),
        };
        let direction = if q.descending { "DESC" } else { "ASC" };
        let from=format!("FROM assets a LEFT JOIN asset_profiles p ON a.id=p.asset_id WHERE a.deleted_at IS NULL AND ({filter}) AND instr(lower(a.name || ' ' || coalesce(p.brand,'') || ' ' || coalesce(p.model,'') || ' ' || coalesce(p.serial_number,'') || ' ' || coalesce(p.notes,'')), lower(?1)) > 0");
        let total =
            self.conn()?
                .query_row(&format!("SELECT count(*) {from}"), [q.search.trim()], |r| {
                    r.get(0)
                })?;
        let sql=format!("SELECT a.id {from} ORDER BY ({order}) IS NULL ASC, {order} {direction}, a.id ASC LIMIT 100 OFFSET ?2");
        let mut stmt = self.conn()?.prepare(&sql)?;
        let ids = stmt
            .query_map(params![q.search.trim(), q.offset], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let items = ids
            .into_iter()
            .map(|id| {
                self.record(&id)?
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
