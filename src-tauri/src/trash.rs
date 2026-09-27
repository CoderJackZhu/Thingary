use crate::{
    catalog::AssetRecord,
    domain::{Asset, Error, Result},
    storage::{digest, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrashChange {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub expected_revision: i64,
    pub deleted: bool,
}

/// Independent soft delete or restore of one maintenance/warranty record.
/// The parent asset keeps its own visibility: deleting the asset never writes
/// these marks, and restoring the asset never clears them (S05/AC41–44).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordChange {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub record_id: String,
    pub kind: String,
    pub expected_revision: i64,
    pub deleted: bool,
}

/// One row of the unified recently-deleted list. Assets carry their own facts;
/// record rows also expose the current parent state so the UI can say whether
/// the parent itself still needs to be restored first.
#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub subtype: Option<String>,
    pub date: Option<String>,
    pub end_date: Option<String>,
    pub cost_cents: Option<String>,
    pub provider: Option<String>,
    pub deleted_at: String,
    pub asset_id: Option<String>,
    pub asset_name: Option<String>,
    pub asset_deleted: bool,
    pub asset_revision: i64,
    pub asset_state: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrashQuery {
    pub filter: String,
    pub offset: u32,
}
#[derive(Serialize)]
pub struct TrashPage {
    pub generation: String,
    pub items: Vec<Entry>,
    pub total: i64,
}
impl Store {
    /// Check the exact record operation, not merely the request ID: the shared
    /// requests table also contains asset, lifecycle, maintenance and sale writes.
    pub fn saved_record_trash_request(
        &self,
        input: &RecordChange,
        today: &str,
    ) -> Result<Option<AssetRecord>> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        let fingerprint = digest(&serde_json::to_vec(&("record-trash", input))?);
        let previous: Option<String> = self
            .conn()?
            .query_row(
                "SELECT fingerprint FROM requests WHERE id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        match previous {
            None => Ok(None),
            Some(prior) if prior != fingerprint => {
                Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"))
            }
            Some(_) => self.record_at(&input.asset_id, today),
        }
    }

    pub fn change_trash(&mut self, input: &TrashChange) -> Result<AssetRecord> {
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
        let fingerprint = digest(&serde_json::to_vec(&("asset-trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM requests WHERE id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(prior) = previous {
            if prior != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            // A receipt confirms this action occurred; never replay it over a later restore/delete.
            return self
                .record(&input.asset_id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"));
        }
        let mut record = self
            .record(&input.asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))?;
        if record.asset.revision != input.expected_revision || record.deleted == input.deleted {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "物品已更改，请重新读取后再决定",
            ));
        }
        let now = chrono::Utc::now().to_rfc3339();
        let deleted_at = input.deleted.then_some(now.as_str());
        tx.execute(
            "UPDATE assets SET deleted_at=?1,revision=?2 WHERE id=?3",
            params![deleted_at, next, input.asset_id],
        )?;
        // Keep profile timestamps and all attachment references: deletion is not a content edit.
        record.asset.revision = next;
        let result: &Asset = &record.asset;
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(result)?
            ],
        )?;
        self.hit("trash.before_commit")?;
        tx.commit()?;
        self.hit("trash.after_commit")?;
        self.record(&input.asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }

    fn record_table(kind: &str) -> Result<&'static str> {
        match kind {
            "maintenance" => Ok("maintenances"),
            "warranty" => Ok("warranties"),
            _ => Err(Error::new("KIND", "记录类型无效")),
        }
    }
    /// A deleted maintenance/warranty can only be restored while its dates still
    /// fit the (possibly corrected) purchase/sale facts. The schema triggers
    /// enforce this on the UPDATE; translate their abort text into the shared
    /// conflict code instead of a generic database failure.
    fn map_row_error(error: rusqlite::Error) -> Error {
        let text = error.to_string();
        for (needle, code, message) in [
            (
                "maintenance before purchase",
                "DATE_CONFLICT",
                "购入日期已晚于这条维护记录的日期。请先核对日期；这条记录会保留在最近删除中。",
            ),
            (
                "maintenance after sale",
                "DATE_CONFLICT",
                "售出日期已早于这条维护记录的日期。请先核对日期；这条记录会保留在最近删除中。",
            ),
            (
                "warranty end before start",
                "DATE_CONFLICT",
                "这份保障的起止日期现在互相矛盾，暂不能恢复；记录会保留在最近删除中。",
            ),
        ] {
            if text.contains(needle) {
                return Error::new(code, message);
            }
        }
        Error::from(error)
    }
    pub fn change_record_trash(
        &mut self,
        input: &RecordChange,
        today: &str,
    ) -> Result<AssetRecord> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        let table = Self::record_table(&input.kind)?;
        for id in [&input.request_id, &input.asset_id, &input.record_id] {
            uuid::Uuid::parse_str(id).map_err(|_| Error::new("ID", "请求或记录标识无效"))?;
        }
        let next = input
            .expected_revision
            .checked_add(1)
            .filter(|_| input.expected_revision > 0)
            .ok_or_else(|| Error::new("REVISION", "版本标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("record-trash", input))?);
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
        if record.deleted {
            return Err(Error::new(
                "PARENT_DELETED",
                "所属物品还在最近删除中。请先恢复所属物品，再处理这条记录。",
            ));
        }
        if record.asset.revision != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "所属物品已更改，请重新读取后再决定",
            ));
        }
        let label = if input.kind == "maintenance" {
            "维护记录"
        } else {
            "保障记录"
        };
        let deleted_at: Option<String> = tx
            .query_row(
                &format!("SELECT deleted_at FROM {table} WHERE id=?1 AND asset_id=?2"),
                params![input.record_id, input.asset_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::new("NOT_FOUND", &format!("{label}已变化，请重新读取")))?;
        if deleted_at.is_some() == input.deleted {
            // A matching current state is not evidence this request succeeded.
            return Err(Error::new(
                "REVISION_CONFLICT",
                &format!("{label}状态已变化，请重新读取后再决定"),
            ));
        }
        let now = chrono::Utc::now().to_rfc3339();
        // Deletion is a visibility fact, not a content edit: keep the record's
        // own timestamps and every attachment reference untouched.
        let stamp = input.deleted.then_some(now.as_str());
        let updated = tx
            .execute(
                &format!("UPDATE {table} SET deleted_at=?1 WHERE id=?2"),
                params![stamp, input.record_id],
            )
            .map_err(Self::map_row_error)?;
        if updated != 1 {
            return Err(Error::new(
                "NOT_FOUND",
                &format!("{label}已变化，请重新读取"),
            ));
        }
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
        self.hit("record-trash.before_commit")?;
        tx.commit()?;
        self.hit("record-trash.after_commit")?;
        self.record_at(&input.asset_id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }

    /// Unified view over every independently deleted row (assets, maintenances,
    /// warranties). Children hidden only by a deleted parent never appear here.
    pub fn list_trash(&self, q: &TrashQuery) -> Result<TrashPage> {
        if !["all", "asset", "maintenance", "warranty", "wealth"].contains(&q.filter.as_str()) {
            return Err(Error::new("QUERY", "不支持的筛选"));
        }
        let c = self.conn()?;
        let mut entries: Vec<Entry> = Vec::new();
        if q.filter == "all" || q.filter == "asset" {
            entries.extend(query_entries(
                c,
                "SELECT a.id,a.name,a.deleted_at,a.revision,a.lifecycle_state FROM assets a WHERE a.deleted_at IS NOT NULL",
                |r| {
                    Ok(Entry {
                        kind: "asset".into(),
                        id: r.get(0)?,
                        title: r.get(1)?,
                        subtype: None,
                        date: None,
                        end_date: None,
                        cost_cents: None,
                        provider: None,
                        deleted_at: r.get(2)?,
                        asset_id: None,
                        asset_name: None,
                        asset_deleted: true,
                        asset_revision: r.get(3)?,
                        asset_state: Some(r.get(4)?),
                    })
                },
            )?);
        }
        if q.filter == "all" || q.filter == "maintenance" {
            entries.extend(query_entries(
                c,
                "SELECT m.id,m.title,m.kind,m.date,m.cost_cents,m.deleted_at,a.id,a.name,a.deleted_at,a.revision,a.lifecycle_state FROM maintenances m JOIN assets a ON a.id=m.asset_id WHERE m.deleted_at IS NOT NULL",
                |r| {
                    Ok(Entry {
                        kind: "maintenance".into(),
                        id: r.get(0)?,
                        title: r.get(1)?,
                        subtype: Some(r.get(2)?),
                        date: r.get(3)?,
                        end_date: None,
                        cost_cents: r.get::<_, Option<i64>>(4)?.map(|n| n.to_string()),
                        provider: None,
                        deleted_at: r.get(5)?,
                        asset_id: Some(r.get(6)?),
                        asset_name: Some(r.get(7)?),
                        asset_deleted: r.get::<_, Option<String>>(8)?.is_some(),
                        asset_revision: r.get(9)?,
                        asset_state: Some(r.get(10)?),
                    })
                },
            )?);
        }
        if q.filter == "all" || q.filter == "warranty" {
            entries.extend(query_entries(
                c,
                "SELECT w.id,w.provider,w.kind,w.start_date,w.end_date,w.deleted_at,a.id,a.name,a.deleted_at,a.revision,a.lifecycle_state FROM warranties w JOIN assets a ON a.id=w.asset_id WHERE w.deleted_at IS NOT NULL",
                |r| {
                    Ok(Entry {
                        kind: "warranty".into(),
                        id: r.get(0)?,
                        title: r.get::<_, String>(1)?.trim().to_owned(),
                        subtype: Some(r.get(2)?),
                        date: r.get(3)?,
                        end_date: r.get(4)?,
                        cost_cents: None,
                        provider: r.get(1)?,
                        deleted_at: r.get(5)?,
                        asset_id: Some(r.get(6)?),
                        asset_name: Some(r.get(7)?),
                        asset_deleted: r.get::<_, Option<String>>(8)?.is_some(),
                        asset_revision: r.get(9)?,
                        asset_state: Some(r.get(10)?),
                    })
                },
            )?);
        }
        if q.filter == "all" || q.filter == "wealth" {
            // Wealth rows reuse the shared shape: `date` is the check-in date,
            // `subtype` the account kind and `asset_revision` the row revision.
            let wealth = |kind: &'static str| {
                move |r: &rusqlite::Row<'_>| {
                    Ok(Entry {
                        kind: kind.into(),
                        id: r.get(0)?,
                        title: r.get(1)?,
                        subtype: r.get(2)?,
                        date: r.get(3)?,
                        end_date: None,
                        cost_cents: None,
                        provider: None,
                        deleted_at: r.get(4)?,
                        asset_id: None,
                        asset_name: None,
                        asset_deleted: false,
                        asset_revision: r.get(5)?,
                        asset_state: None,
                    })
                }
            };
            entries.extend(query_entries(c, "SELECT id,date,NULL,date,deleted_at,revision FROM fin_snapshots WHERE deleted_at IS NOT NULL", wealth("snapshot"))?);
            entries.extend(query_entries(c, "SELECT id,name,kind,NULL,deleted_at,revision FROM fin_accounts WHERE deleted_at IS NOT NULL", wealth("account"))?);
            entries.extend(query_entries(c, "SELECT id,title,category,date,deleted_at,revision FROM expenses WHERE deleted_at IS NOT NULL", wealth("expense"))?);
            entries.extend(query_entries(c, "SELECT id,name,category,NULL,deleted_at,revision FROM recurring_plans WHERE deleted_at IS NOT NULL", wealth("plan"))?);
            // Only independently deleted payments are rows; a payment hidden by its
            // deleted plan is not (section 5). `asset_deleted` marks that plan.
            let mut paid = query_entries(c, "SELECT p.id,r.name,p.state,p.due_date,p.deleted_at,p.revision,p.amount_cents,r.deleted_at IS NOT NULL FROM plan_payments p JOIN recurring_plans r ON r.id=p.plan_id WHERE p.deleted_at IS NOT NULL", |r| {
                let mut e = wealth("payment")(r)?;
                e.cost_cents = r.get::<_, Option<i64>>(6)?.map(|v| v.to_string());
                e.asset_deleted = r.get(7)?;
                Ok(e)
            })?;
            entries.append(&mut paid);
        }
        // RFC3339 UTC stamps sort lexicographically; ties break by kind then id.
        entries.sort_by(|a, b| {
            b.deleted_at
                .cmp(&a.deleted_at)
                .then_with(|| a.kind.cmp(&b.kind))
                .then_with(|| a.id.cmp(&b.id))
        });
        let total = entries.len() as i64;
        let items = entries
            .into_iter()
            .skip(q.offset as usize)
            .take(100)
            .collect();
        Ok(TrashPage {
            generation: self.generation(),
            items,
            total,
        })
    }
}

fn query_entries(
    c: &Connection,
    sql: &str,
    build: impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<Entry>,
) -> Result<Vec<Entry>> {
    let mut stmt = c.prepare(sql)?;
    let rows = stmt
        .query_map([], build)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}
