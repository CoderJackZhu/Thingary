use crate::{
    catalog::AssetRecord,
    domain::{cents, daily_cents, date, held_days, Error, Result},
    photos::{Photo, Selection},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub date: Option<String>,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub cost_cents: Option<String>,
    pub provider: String,
}
impl Fields {
    pub fn validate(&self) -> Result<()> {
        if let Some(value) = &self.date {
            date(value)?;
        }
        if ![
            "repair",
            "service",
            "cleaning",
            "replacement",
            "upgrade",
            "accessory",
            "other",
        ]
        .contains(&self.kind.as_str())
        {
            return Err(Error::new("MAINTENANCE_KIND", "请选择有效的维护类型"));
        }
        if self.title.trim().is_empty()
            || self.title.trim().chars().count() > 200
            || self.title.contains('\0')
            || self.provider.chars().count() > 200
            || self.provider.contains('\0')
            || self.description.chars().count() > 10000
            || self.description.contains('\0')
        {
            return Err(Error::new(
                "MAINTENANCE_FIELDS",
                "标题须为 1–200 字，服务商最多 200 字，描述最多 10000 字，且不能含空字符",
            ));
        }
        cents(self.cost_cents.as_deref())?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Maintenance {
    pub id: String,
    pub fields: Fields,
    pub photos: Vec<Photo>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CostSummary {
    pub known_maintenance_cents: String,
    pub unknown_maintenance_count: i64,
    pub total_investment_cents: Option<String>,
    pub sale_proceeds_cents: Option<String>,
    pub net_cost_cents: Option<String>,
    pub held_days: Option<i64>,
    pub daily_cents: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Add {
        fields: Fields,
        photos: Selection,
    },
    Correct {
        maintenance_id: String,
        fields: Fields,
        photos: Selection,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub expected_revision: i64,
    pub action: Action,
}

pub(crate) fn read(c: &Connection, id: &str) -> Result<Vec<Maintenance>> {
    let mut stmt = c.prepare("SELECT id,date,kind,title,description,cost_cents,provider,created_at,updated_at FROM maintenances WHERE asset_id=?1 AND deleted_at IS NULL ORDER BY date IS NULL,date DESC,created_at DESC,id")?;
    let rows = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Fields {
                    date: r.get(1)?,
                    kind: r.get(2)?,
                    title: r.get(3)?,
                    description: r.get(4)?,
                    cost_cents: r.get::<_, Option<i64>>(5)?.map(|n| n.to_string()),
                    provider: r.get(6)?,
                },
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(maintenance_id, fields, created_at, updated_at)| {
            Ok(Maintenance {
                photos: maintenance_photos(c, &maintenance_id)?,
                id: maintenance_id,
                fields,
                created_at,
                updated_at,
            })
        })
        .collect()
}

fn maintenance_photos(c: &Connection, id: &str) -> Result<Vec<Photo>> {
    let mut stmt = c.prepare("SELECT attachment_id,name FROM maintenance_photos WHERE maintenance_id=?1 ORDER BY position,attachment_id")?;
    let photos = stmt
        .query_map([id], |r| {
            Ok(Photo {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(photos)
}

pub(crate) fn summary(
    c: &Connection,
    asset: &crate::domain::Asset,
    sale: Option<&crate::sales::Sale>,
    today: &str,
) -> Result<CostSummary> {
    let (known, unknown): (i64, i64) = c.query_row(
        "SELECT COALESCE(sum(cost_cents),0),COALESCE(sum(CASE WHEN cost_cents IS NULL THEN 1 ELSE 0 END),0) FROM maintenances WHERE asset_id=?1 AND deleted_at IS NULL",
        [&asset.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let purchase = asset
        .price_cents
        .as_deref()
        .map(str::parse::<i64>)
        .transpose()
        .map_err(|_| Error::new("PRICE", "金额超出范围"))?;
    let complete = purchase.is_some() && unknown == 0;
    let total = if complete {
        purchase.unwrap().checked_add(known)
    } else {
        None
    };
    if complete && total.is_none() {
        return Err(Error::new("OVERFLOW", "金额超出范围"));
    }
    let sale_proceeds = sale
        .map(|s| s.fields.price_cents.parse::<i64>())
        .transpose()
        .map_err(|_| Error::new("PRICE", "金额超出范围"))?;
    let proceeds = sale_proceeds.unwrap_or(0);
    let net = total
        .map(|n| {
            n.checked_sub(proceeds)
                .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))
        })
        .transpose()?;
    let endpoint = sale.map(|s| s.fields.date.as_str()).unwrap_or(today);
    let days = held_days(asset.purchase_date.as_deref(), endpoint)?;
    let daily = if complete {
        daily_cents(purchase, known, proceeds, days)?
    } else {
        None
    };
    Ok(CostSummary {
        known_maintenance_cents: known.to_string(),
        unknown_maintenance_count: unknown,
        total_investment_cents: total.map(|n| n.to_string()),
        sale_proceeds_cents: sale_proceeds.map(|n| n.to_string()),
        net_cost_cents: net.map(|n| n.to_string()),
        held_days: days,
        daily_cents: daily.map(|n| n.to_string()),
    })
}

pub(crate) fn validate_purchase_date(
    c: &Connection,
    id: &str,
    purchase: Option<&str>,
) -> Result<()> {
    if let Some(purchase) = purchase {
        let conflict: Option<(String, String)> = c.query_row(
            "SELECT id,date FROM maintenances WHERE asset_id=?1 AND deleted_at IS NULL AND date IS NOT NULL AND date<?2 ORDER BY date LIMIT 1",
            params![id, purchase],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        if let Some((id, value)) = conflict {
            return Err(Error::new(
                "DATE_CONFLICT",
                &format!("购入日期晚于维护记录 {id}（{value}），请先更正维护日期。"),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_sale_date(c: &Connection, id: &str, sale_date: &str) -> Result<()> {
    let conflict: Option<(String, String)> = c.query_row(
        "SELECT id,date FROM maintenances WHERE asset_id=?1 AND deleted_at IS NULL AND date IS NOT NULL AND date>?2 ORDER BY date LIMIT 1",
        params![id, sale_date],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?;
    if let Some((id, value)) = conflict {
        return Err(Error::new(
            "DATE_CONFLICT",
            &format!("售出日期早于维护记录 {id}（{value}），请先更正维护日期。"),
        ));
    }
    Ok(())
}

impl Store {
    pub fn change_maintenance(&mut self, input: &Change, today: &str) -> Result<AssetRecord> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        for id in [&input.request_id, &input.asset_id] {
            uuid::Uuid::parse_str(id).map_err(|_| Error::new("ID", "请求或档案标识无效"))?;
        }
        let next = input
            .expected_revision
            .checked_add(1)
            .filter(|_| input.expected_revision > 0)
            .ok_or_else(|| Error::new("REVISION", "版本标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("asset-maintenance", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(previous) = tx
            .query_row(
                "SELECT fingerprint FROM requests WHERE id=?1",
                [&input.request_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            if previous != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return self
                .record_at(&input.asset_id, today)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"));
        }
        let record = self
            .record_at(&input.asset_id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))?;
        if record.deleted || record.asset.revision != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "物品已更改或移入最近删除，请重新读取后决定",
            ));
        }
        let (maintenance_id, fields, photos, action, created_at) = match &input.action {
            Action::Add { fields, photos } => (uid(), fields.clone(), photos, "add", None),
            Action::Correct {
                maintenance_id,
                fields,
                photos,
            } => {
                uuid::Uuid::parse_str(maintenance_id)
                    .map_err(|_| Error::new("ID", "维护记录标识无效"))?;
                let created: String = tx.query_row("SELECT created_at FROM maintenances WHERE id=?1 AND asset_id=?2 AND deleted_at IS NULL", params![maintenance_id, input.asset_id], |r| r.get(0)).optional()?.ok_or_else(|| Error::new("NOT_FOUND", "维护记录已变化，请重新读取"))?;
                (
                    maintenance_id.clone(),
                    fields.clone(),
                    photos,
                    "correct",
                    Some(created),
                )
            }
        };
        fields.validate()?;
        if let Some(value) = &fields.date {
            if date(value)? > date(today)? {
                return Err(Error::new("FUTURE", "维护日期不能晚于今天"));
            }
            if record
                .asset
                .purchase_date
                .as_ref()
                .is_some_and(|p| value < p)
            {
                return Err(Error::new("DATE_CONFLICT", "维护日期不能早于购入日期"));
            }
            if record.sale.as_ref().is_some_and(|s| value > &s.fields.date) {
                return Err(Error::new("DATE_CONFLICT", "维护日期不能晚于售出日期"));
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        let cost = cents(fields.cost_cents.as_deref())?;
        if action == "add" {
            tx.execute("INSERT INTO maintenances(id,asset_id,date,kind,title,description,cost_cents,provider,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL)", params![maintenance_id,input.asset_id,fields.date,fields.kind,fields.title.trim(),fields.description,cost,fields.provider.trim(),now])?;
        } else {
            tx.execute("UPDATE maintenances SET date=?1,kind=?2,title=?3,description=?4,cost_cents=?5,provider=?6,updated_at=?7 WHERE id=?8", params![fields.date,fields.kind,fields.title.trim(),fields.description,cost,fields.provider.trim(),now,maintenance_id])?;
        }
        self.commit_maintenance_photos(&tx, &input.asset_id, &maintenance_id, photos)?;
        let snapshot = Maintenance {
            id: maintenance_id.clone(),
            fields: Fields {
                cost_cents: cost.map(|n| n.to_string()),
                ..fields
            },
            photos: maintenance_photos(&tx, &maintenance_id)?,
            created_at: created_at.unwrap_or_else(|| now.clone()),
            updated_at: now.clone(),
        };
        tx.execute("INSERT INTO maintenance_audit(request_id,maintenance_id,action,snapshot,created_at) VALUES(?1,?2,?3,?4,?5)", params![input.request_id,maintenance_id,action,serde_json::to_string(&snapshot)?,now])?;
        tx.execute(
            "UPDATE assets SET revision=?1 WHERE id=?2",
            params![next, input.asset_id],
        )?;
        tx.execute(
            "UPDATE asset_profiles SET updated_at=?1 WHERE asset_id=?2",
            params![now, input.asset_id],
        )?;
        let mut result = record.asset;
        result.revision = next;
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&result)?
            ],
        )?;
        self.hit("maintenance.before_commit")?;
        tx.commit()?;
        self.hit("maintenance.after_commit")?;
        self.record_at(&input.asset_id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut stmt = c.prepare("SELECT id,asset_id,date,kind,title,description,cost_cents,provider,created_at,updated_at,deleted_at FROM maintenances")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let asset_id: String = r.get(1)?;
        if uuid::Uuid::parse_str(&id).is_err() || uuid::Uuid::parse_str(&asset_id).is_err() {
            return Err(Error::new("MAINTENANCE", "维护记录标识无效"));
        }
        Fields {
            date: r.get(2)?,
            kind: r.get(3)?,
            title: r.get(4)?,
            description: r.get(5)?,
            cost_cents: r.get::<_, Option<i64>>(6)?.map(|n| n.to_string()),
            provider: r.get(7)?,
        }
        .validate()?;
        for i in [8, 9] {
            chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(i)?)
                .map_err(|_| Error::new("MAINTENANCE", "维护记录时间无效"))?;
        }
        if let Some(v) = r.get::<_, Option<String>>(10)? {
            chrono::DateTime::parse_from_rfc3339(&v)
                .map_err(|_| Error::new("MAINTENANCE", "维护删除时间无效"))?;
        }
    }
    let invalid: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM maintenance_photos p JOIN maintenances m ON m.id=p.maintenance_id JOIN attachments a ON a.id=p.attachment_id WHERE a.asset_id!=m.asset_id)", [], |r| r.get(0))?;
    if invalid {
        return Err(Error::new("REFERENCE", "维护图片不属于对应物品"));
    }
    Ok(())
}
