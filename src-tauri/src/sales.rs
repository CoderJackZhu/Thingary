use crate::{
    catalog::AssetRecord,
    domain::{cents, date, Error, Result},
    lifecycle::State,
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub date: String,
    pub price_cents: String,
    pub platform: String,
    pub buyer: String,
    pub notes: String,
}
impl Fields {
    pub fn validate(&self) -> Result<()> {
        date(&self.date)?;
        cents(Some(&self.price_cents))?;
        for (s, limit) in [
            (&self.platform, 200),
            (&self.buyer, 200),
            (&self.notes, 10000),
        ] {
            if s.chars().count() > limit || s.contains('\0') {
                return Err(Error::new(
                    "SALE_FIELDS",
                    "平台和买家最多 200 字，备注最多 10000 字，且不能含空字符",
                ));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Sale {
    pub id: String,
    pub previous_state: State,
    pub fields: Fields,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Sell { fields: Fields },
    Correct { sale_id: String, fields: Fields },
    Revoke { sale_id: String },
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

pub(crate) fn read(c: &Connection, id: &str) -> Result<Option<Sale>> {
    Ok(c.query_row("SELECT id,previous_state,date,price_cents,platform,buyer,notes FROM sales WHERE asset_id=?1 AND revoked_at IS NULL",[id],|r| Ok(Sale {
        id:r.get(0)?, previous_state:if r.get::<_,String>(1)?=="retired" {State::Retired} else {State::Active},
        fields:Fields {date:r.get(2)?,price_cents:r.get::<_,i64>(3)?.to_string(),platform:r.get(4)?,buyer:r.get(5)?,notes:r.get(6)?}
    })).optional()?)
}
pub(crate) fn validate_purchase_date(
    c: &Connection,
    id: &str,
    purchase: Option<&str>,
) -> Result<()> {
    if let (Some(p), Some(sale)) = (purchase, read(c, id)?) {
        if p > sale.fields.date.as_str() {
            return Err(Error::new(
                "DATE_CONFLICT",
                &format!(
                    "购入日期晚于售出记录（{}），请先更正售出日期。",
                    sale.fields.date
                ),
            ));
        }
    }
    Ok(())
}
impl Store {
    pub fn change_sale(&mut self, input: &Change, today: &str) -> Result<AssetRecord> {
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
        let fingerprint = digest(&serde_json::to_vec(&("asset-sale", input))?);
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
        let now = chrono::Utc::now().to_rfc3339();
        let (mut sale, action) = match &input.action {
            Action::Sell { fields } => {
                if record.lifecycle.state == State::Sold || record.sale.is_some() {
                    return Err(Error::new(
                        "STATE_CONFLICT",
                        "物品已售出，请修改原售出记录；真实购回需另建档案。",
                    ));
                }
                (
                    Sale {
                        id: uid(),
                        previous_state: record.lifecycle.state.clone(),
                        fields: fields.clone(),
                    },
                    "sell",
                )
            }
            Action::Correct { sale_id, .. } | Action::Revoke { sale_id } => {
                let mut sale = record
                    .sale
                    .clone()
                    .filter(|s| &s.id == sale_id && record.lifecycle.state == State::Sold)
                    .ok_or_else(|| {
                        Error::new("STATE_CONFLICT", "售出记录已变化，请重新读取后决定")
                    })?;
                // Corrections keep the sale identity and original source state.
                if let Action::Correct { fields, .. } = &input.action {
                    sale.fields = fields.clone();
                }
                (
                    sale,
                    if matches!(input.action, Action::Revoke { .. }) {
                        "revoke"
                    } else {
                        "correct"
                    },
                )
            }
        };
        if action != "revoke" {
            sale.fields.validate()?;
            sale.fields.price_cents = cents(Some(&sale.fields.price_cents))?.unwrap().to_string();
            if date(&sale.fields.date)? > date(today)? {
                return Err(Error::new("FUTURE", "售出日期不能晚于今天"));
            }
            if record
                .asset
                .purchase_date
                .as_ref()
                .is_some_and(|p| p > &sale.fields.date)
            {
                return Err(Error::new("DATE_CONFLICT", "售出日期不能早于购入日期"));
            }
            if let Some(last) = record.lifecycle.events.last() {
                if last.date > sale.fields.date {
                    return Err(Error::new(
                        "DATE_CONFLICT",
                        &format!("售出日期不能早于前置状态记录（{}）", last.date),
                    ));
                }
            }
            crate::maintenance::validate_sale_date(&tx, &input.asset_id, &sale.fields.date)?;
        }
        let prior = if sale.previous_state == State::Retired {
            "retired"
        } else {
            "active"
        };
        match action {
            "sell" => {
                tx.execute("INSERT INTO sales(id,asset_id,previous_state,date,price_cents,platform,buyer,notes,created_at,updated_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL)",params![sale.id,input.asset_id,prior,sale.fields.date,cents(Some(&sale.fields.price_cents))?,sale.fields.platform,sale.fields.buyer,sale.fields.notes,now])?;
            }
            "correct" => {
                tx.execute("UPDATE sales SET date=?1,price_cents=?2,platform=?3,buyer=?4,notes=?5,updated_at=?6 WHERE id=?7",params![sale.fields.date,cents(Some(&sale.fields.price_cents))?,sale.fields.platform,sale.fields.buyer,sale.fields.notes,now,sale.id])?;
            }
            _ => {
                tx.execute(
                    "UPDATE sales SET revoked_at=?1,updated_at=?1 WHERE id=?2",
                    params![now, sale.id],
                )?;
            }
        }
        tx.execute("INSERT INTO sale_audit(request_id,sale_id,action,snapshot,created_at) VALUES(?1,?2,?3,?4,?5)",params![input.request_id,sale.id,action,serde_json::to_string(&sale)?,now])?;
        tx.execute(
            "UPDATE assets SET lifecycle_state=?1,revision=?2 WHERE id=?3",
            params![
                if action == "revoke" { prior } else { "sold" },
                next,
                input.asset_id
            ],
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
        self.hit("sale.before_commit")?;
        tx.commit()?;
        self.hit("sale.after_commit")?;
        self.record_at(&input.asset_id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut stmt=c.prepare("SELECT id,asset_id,previous_state,date,price_cents,platform,buyer,notes,created_at,updated_at,revoked_at FROM sales")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let asset: String = r.get(1)?;
        uuid::Uuid::parse_str(&id).map_err(|_| Error::new("SALE", "售出标识无效"))?;
        let sale = Sale {
            id: id.clone(),
            previous_state: if r.get::<_, String>(2)? == "retired" {
                State::Retired
            } else {
                State::Active
            },
            fields: Fields {
                date: r.get(3)?,
                price_cents: r.get::<_, i64>(4)?.to_string(),
                platform: r.get(5)?,
                buyer: r.get(6)?,
                notes: r.get(7)?,
            },
        };
        sale.fields.validate()?;
        let revoked: Option<String> = r.get(10)?;
        for timestamp in [
            Some(r.get::<_, String>(8)?),
            Some(r.get::<_, String>(9)?),
            revoked.clone(),
        ]
        .into_iter()
        .flatten()
        {
            chrono::DateTime::parse_from_rfc3339(&timestamp)
                .map_err(|_| Error::new("SALE", "售出记录时间无效"))?;
        }
        let mut audit=c.prepare("SELECT a.request_id,a.action,a.snapshot,a.created_at,r.result FROM sale_audit a LEFT JOIN requests r ON r.id=a.request_id WHERE a.sale_id=?1 ORDER BY a.sequence")?;
        let mut edits = audit.query([&id])?;
        let mut count = 0;
        let mut ended = false;
        let mut last = None;
        while let Some(e) = edits.next()? {
            let request: String = e.get(0)?;
            let action: String = e.get(1)?;
            let snapshot: Sale = serde_json::from_str(&e.get::<_, String>(2)?)?;
            let result: crate::domain::Asset = serde_json::from_str(&e.get::<_, String>(4)?)?;
            snapshot.fields.validate()?;
            chrono::DateTime::parse_from_rfc3339(&e.get::<_, String>(3)?)
                .map_err(|_| Error::new("SALE", "售出纠错时间无效"))?;
            if uuid::Uuid::parse_str(&request).is_err()
                || ended
                || (count == 0 && action != "sell")
                || (count > 0 && action == "sell")
                || snapshot.id != id
                || snapshot.previous_state != sale.previous_state
                || result.id != asset
            {
                return Err(Error::new("SALE", "售出纠错关联不一致"));
            }
            ended = action == "revoke";
            last = Some(snapshot);
            count += 1;
        }
        if last.as_ref() != Some(&sale) || ended != revoked.is_some() {
            return Err(Error::new("SALE", "售出记录与纠错历史不一致"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_six_preserves_records_and_rolls_back() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::storage::SCHEMA).unwrap();
        crate::storage::migrate_to(&c, 6, &|_| Ok(())).unwrap();
        c.execute("INSERT INTO assets(id,name,revision,lifecycle_state) VALUES('old','旧虚构资产',4,'retired')",[]).unwrap();
        assert!(crate::storage::migrate(&c, &|_| Err(Error::new("INJECTED", "失败"))).is_err());
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            6
        );
        assert!(c.prepare("SELECT * FROM sales").is_err());
        crate::storage::migrate(&c, &|_| Ok(())).unwrap();
        assert_eq!(
            c.query_row("SELECT lifecycle_state,revision FROM assets", [], |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?
            )))
            .unwrap(),
            ("retired".into(), 4)
        );
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
