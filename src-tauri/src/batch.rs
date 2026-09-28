//! Batch operations on items (D19). One request changes many items in a single
//! transaction with the single-item rules; the receipt keeps each item's prior
//! values so one undo can put the whole batch back, skipping items changed since.
use crate::{
    domain::{Error, Result},
    lifecycle::{self, Kind},
    preferences::{AssetPreferences, Exclusions},
    storage::{digest, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Deserializer, Serialize};

/// Distinguishes a missing field (keep) from an explicit `null` (clear).
fn present<'de, D: Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::deserialize(d).map(Some)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub asset_id: String,
    pub expected_revision: i64,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub category_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub channel_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub label_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Exclusions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warranty: Option<crate::warranty::Fields>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sale: Option<crate::sales::Fields>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub generation: String,
    /// `classify`, `label`, `exclude`, `retire`, `activate`, `delete`, `warranty` or `sell`.
    pub action: String,
    pub items: Vec<Item>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Undo {
    pub request_id: String,
    pub generation: String,
    pub batch_request_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Outcome {
    pub changed: usize,
    pub skipped: usize,
}

/// Compact facts the selection panel and batch tables need, one per item.
#[derive(Clone, Debug, Serialize)]
pub struct Row {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub state: String,
    pub price_cents: Option<String>,
    pub purchase_date: Option<String>,
    pub last_event_date: Option<String>,
    pub category_id: Option<String>,
    pub channel_id: Option<String>,
    pub label_id: Option<String>,
    pub exclude: Exclusions,
    /// Known maintenance total, for the sale table's net-cost preview.
    pub maintenance_cents: String,
}

/// What undo needs to restore one item.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Before {
    asset_id: String,
    revision_after: i64,
    category_id: Option<String>,
    channel_id: Option<String>,
    preferences: Option<AssetPreferences>,
    event_id: Option<String>,
    state: Option<String>,
    /// Added warranty or sale, and the per-item request behind its audit row.
    #[serde(default)]
    record_id: Option<String>,
    #[serde(default)]
    record_request: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Receipt {
    action: String,
    items: Vec<Before>,
}

fn row(c: &Connection, id: &str) -> Result<Option<Row>> {
    let found = c
        .query_row(
            "SELECT a.id,a.name,a.revision,a.lifecycle_state,a.price_cents,a.purchase_date,(SELECT max(date) FROM lifecycle_events e WHERE e.asset_id=a.id),a.category_id,a.channel_id,(SELECT coalesce(sum(cost_cents),0) FROM maintenances m WHERE m.asset_id=a.id AND m.deleted_at IS NULL) FROM assets a WHERE a.id=?1 AND a.deleted_at IS NULL",
            [id],
            |r| {
                Ok(Row {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    revision: r.get(2)?,
                    state: r.get(3)?,
                    price_cents: r.get::<_, Option<i64>>(4)?.map(|v| v.to_string()),
                    purchase_date: r.get(5)?,
                    last_event_date: r.get(6)?,
                    category_id: r.get(7)?,
                    channel_id: r.get(8)?,
                    label_id: None,
                    exclude: Exclusions::default(),
                    maintenance_cents: r.get::<_, i64>(9)?.to_string(),
                })
            },
        )
        .optional()?;
    found
        .map(|mut row| {
            let p = crate::preferences::read(c, &row.id)?;
            row.label_id = p.label_id;
            row.exclude = p.exclude;
            Ok(row)
        })
        .transpose()
}

fn write_preferences(c: &Connection, id: &str, p: &AssetPreferences) -> Result<()> {
    p.validate()?;
    if let Some(label) = &p.label_id {
        let exists: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM named_choices WHERE id=?1 AND kind='label')",
            [label],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(Error::new("LABEL", "状态标签已不可用，请重新选择"));
        }
    }
    c.execute("INSERT INTO asset_preferences(asset_id,payload) VALUES(?1,?2) ON CONFLICT(asset_id) DO UPDATE SET payload=excluded.payload", params![id, serde_json::to_string(p)?])?;
    Ok(())
}

fn named(row: &Row, e: Error) -> Error {
    Error::new(&e.code, &format!("「{}」：{}", row.name, e.message))
}

fn receipt(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match prior {
        Some((f, _)) if f != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"))
        }
        Some((_, result)) => Ok(Some(result)),
        None => Ok(None),
    }
}

impl Store {
    pub fn batch_rows(&self, ids: &[String]) -> Result<Vec<Row>> {
        let c = self.conn()?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(r) = row(c, id)? {
                out.push(r);
            }
        }
        Ok(out)
    }

    pub fn batch_change(&mut self, input: &Change, today: &str) -> Result<Outcome> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        if input.items.is_empty() || input.items.len() > 10000 {
            return Err(Error::new("BATCH_EMPTY", "请至少选择一件物品"));
        }
        let fingerprint = digest(&serde_json::to_vec(&("batch", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(prior) = receipt(&tx, &input.request_id, &fingerprint)? {
            let r: Receipt = serde_json::from_str(&prior)?;
            return Ok(Outcome {
                changed: r.items.len(),
                skipped: 0,
            });
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut before = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for item in &input.items {
            if !seen.insert(item.asset_id.as_str()) {
                return Err(Error::new("BATCH_DUPLICATE", "同一件物品只能出现一次"));
            }
            let current = row(&tx, &item.asset_id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "有物品已删除或不存在，请重新读取"))?;
            if current.revision != item.expected_revision {
                return Err(Error::new(
                    "REVISION_CONFLICT",
                    &format!("「{}」已变化，请重新读取后再保存", current.name),
                ));
            }
            let mut b = Before {
                asset_id: item.asset_id.clone(),
                revision_after: current.revision + 1,
                category_id: current.category_id.clone(),
                channel_id: current.channel_id.clone(),
                preferences: None,
                event_id: None,
                state: Some(current.state.clone()),
                record_id: None,
                record_request: None,
            };
            match input.action.as_str() {
                "classify" => {
                    let category = item
                        .category_id
                        .clone()
                        .unwrap_or(current.category_id.clone());
                    let channel = item
                        .channel_id
                        .clone()
                        .unwrap_or(current.channel_id.clone());
                    crate::taxonomy::validate_classification(
                        &tx,
                        &crate::taxonomy::Classification {
                            category_id: category.clone(),
                            channel_id: channel.clone(),
                        },
                    )
                    .map_err(|e| named(&current, e))?;
                    tx.execute(
                        "UPDATE assets SET category_id=?2,channel_id=?3 WHERE id=?1",
                        params![item.asset_id, category, channel],
                    )?;
                }
                "label" | "exclude" => {
                    let mut p = crate::preferences::read(&tx, &item.asset_id)?;
                    b.preferences = Some(p.clone());
                    if input.action == "label" {
                        p.label_id = item
                            .label_id
                            .clone()
                            .ok_or_else(|| Error::new("BATCH_FIELD", "缺少状态标签"))?;
                    } else {
                        p.exclude = item
                            .exclude
                            .clone()
                            .ok_or_else(|| Error::new("BATCH_FIELD", "缺少统计口径"))?;
                    }
                    write_preferences(&tx, &item.asset_id, &p).map_err(|e| named(&current, e))?;
                }
                "retire" | "activate" => {
                    let kind = if input.action == "retire" {
                        Kind::Retire
                    } else {
                        Kind::Activate
                    };
                    let day = item
                        .date
                        .as_deref()
                        .ok_or_else(|| Error::new("BATCH_FIELD", "缺少日期"))?;
                    let life = self.lifecycle(&item.asset_id)?;
                    let id = lifecycle::append_event(
                        &tx,
                        &item.asset_id,
                        current.purchase_date.as_deref(),
                        &life,
                        &kind,
                        day,
                        "",
                        today,
                        &now,
                    )
                    .map_err(|e| named(&current, e))?;
                    b.event_id = Some(id);
                }
                "delete" => {
                    tx.execute(
                        "UPDATE assets SET deleted_at=?2 WHERE id=?1",
                        params![item.asset_id, now],
                    )?;
                }
                "warranty" => {
                    let f = item
                        .warranty
                        .as_ref()
                        .ok_or_else(|| Error::new("BATCH_FIELD", "缺少保障资料"))?;
                    f.validate().map_err(|e| named(&current, e))?;
                    let id = crate::storage::uid();
                    tx.execute("INSERT INTO warranties(id,asset_id,kind,provider,start_date,end_date,notes,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,NULL)", params![id, item.asset_id, f.kind, f.provider.trim(), f.start_date, f.end_date, f.notes, now])?;
                    let request = crate::storage::uid();
                    tx.execute("INSERT INTO warranty_audit(request_id,warranty_id,action,snapshot,created_at) VALUES(?1,?2,'add',?3,?4)", params![request, id, serde_json::to_string(f)?, now])?;
                    b.record_id = Some(id);
                    b.record_request = Some(request);
                }
                "sell" => {
                    let mut f = item
                        .sale
                        .clone()
                        .ok_or_else(|| Error::new("BATCH_FIELD", "缺少售出资料"))?;
                    let life = self.lifecycle(&item.asset_id)?;
                    let check = || -> Result<()> {
                        if current.state == "sold" {
                            return Err(Error::new(
                                "STATE_CONFLICT",
                                "物品已售出，请修改原售出记录",
                            ));
                        }
                        f.validate()?;
                        if crate::domain::date(&f.date)? > crate::domain::date(today)? {
                            return Err(Error::new("FUTURE", "售出日期不能晚于今天"));
                        }
                        if current.purchase_date.as_ref().is_some_and(|p| p > &f.date) {
                            return Err(Error::new("DATE_CONFLICT", "售出日期不能早于购入日期"));
                        }
                        if let Some(last) = life.events.last() {
                            if last.date > f.date {
                                return Err(Error::new(
                                    "DATE_CONFLICT",
                                    &format!("售出日期不能早于前置状态记录（{}）", last.date),
                                ));
                            }
                        }
                        crate::maintenance::validate_sale_date(&tx, &item.asset_id, &f.date)
                    };
                    check().map_err(|e| named(&current, e))?;
                    f.price_cents = crate::domain::cents(Some(&f.price_cents))?
                        .unwrap_or(0)
                        .to_string();
                    let sale = crate::sales::Sale {
                        id: crate::storage::uid(),
                        previous_state: life.state.clone(),
                        fields: f.clone(),
                    };
                    tx.execute("INSERT INTO sales(id,asset_id,previous_state,date,price_cents,platform,buyer,notes,created_at,updated_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,NULL)", params![sale.id, item.asset_id, current.state, f.date, f.price_cents.parse::<i64>().unwrap_or(0), f.platform, f.buyer, f.notes, now])?;
                    let request = crate::storage::uid();
                    tx.execute("INSERT INTO sale_audit(request_id,sale_id,action,snapshot,created_at) VALUES(?1,?2,'sell',?3,?4)", params![request, sale.id, serde_json::to_string(&sale)?, now])?;
                    tx.execute(
                        "UPDATE assets SET lifecycle_state='sold' WHERE id=?1",
                        [&item.asset_id],
                    )?;
                    b.record_id = Some(sale.id);
                    b.record_request = Some(request);
                }
                _ => return Err(Error::new("BATCH_ACTION", "不支持的批量操作")),
            }
            tx.execute(
                "UPDATE assets SET revision=revision+1 WHERE id=?1",
                [&item.asset_id],
            )?;
            if let (Some(request), "sell") = (&b.record_request, input.action.as_str()) {
                // Backups trace every sale to a saved reply holding the asset.
                let asset = self
                    .asset(&item.asset_id)?
                    .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))?;
                tx.execute(
                    "INSERT INTO requests VALUES(?1,?2,?3)",
                    params![
                        request,
                        digest(request.as_bytes()),
                        serde_json::to_string(&asset)?
                    ],
                )?;
            }
            if input.action != "delete" {
                tx.execute(
                    "UPDATE asset_profiles SET updated_at=?2 WHERE asset_id=?1",
                    params![item.asset_id, now],
                )?;
            }
            before.push(b);
        }
        let result = Receipt {
            action: input.action.clone(),
            items: before,
        };
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&result)?
            ],
        )?;
        self.hit("batch.before_commit")?;
        tx.commit()?;
        Ok(Outcome {
            changed: result.items.len(),
            skipped: 0,
        })
    }

    /// Puts a whole batch back. An item edited since the batch (its revision
    /// moved on) is left as it is and counted as skipped.
    pub fn batch_undo(&mut self, input: &Undo) -> Result<Outcome> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("batch_undo", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(prior) = receipt(&tx, &input.request_id, &fingerprint)? {
            return Ok(serde_json::from_str::<(usize, usize)>(&prior)
                .map(|(changed, skipped)| Outcome { changed, skipped })?);
        }
        let raw: String = tx
            .query_row(
                "SELECT result FROM feature_requests WHERE id=?1",
                [&input.batch_request_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次批量操作"))?;
        let batch: Receipt = serde_json::from_str(&raw)
            .map_err(|_| Error::new("NOT_FOUND", "找不到这次批量操作"))?;
        let (mut changed, mut skipped) = (0, 0);
        for b in &batch.items {
            let current: Option<i64> = tx
                .query_row(
                    "SELECT revision FROM assets WHERE id=?1",
                    [&b.asset_id],
                    |r| r.get(0),
                )
                .optional()?;
            if current != Some(b.revision_after) {
                skipped += 1;
                continue;
            }
            let restored = match batch.action.as_str() {
                "classify" => {
                    let ok = crate::taxonomy::validate_classification(
                        &tx,
                        &crate::taxonomy::Classification {
                            category_id: b.category_id.clone(),
                            channel_id: b.channel_id.clone(),
                        },
                    )
                    .is_ok();
                    ok && tx.execute(
                        "UPDATE assets SET category_id=?2,channel_id=?3 WHERE id=?1",
                        params![b.asset_id, b.category_id, b.channel_id],
                    )? == 1
                }
                "label" | "exclude" => match &b.preferences {
                    Some(p) => write_preferences(&tx, &b.asset_id, p).is_ok(),
                    None => false,
                },
                "retire" | "activate" => {
                    let last: Option<String> = tx
                        .query_row("SELECT id FROM lifecycle_events WHERE asset_id=?1 ORDER BY sequence DESC LIMIT 1", [&b.asset_id], |r| r.get(0))
                        .optional()?;
                    let sold: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sales WHERE asset_id=?1 AND revoked_at IS NULL)", [&b.asset_id], |r| r.get(0))?;
                    if last.is_some() && last == b.event_id && !sold {
                        tx.execute("DELETE FROM lifecycle_events WHERE id=?1", [&last])?;
                        tx.execute(
                            "UPDATE assets SET lifecycle_state=?2 WHERE id=?1",
                            params![b.asset_id, b.state],
                        )?;
                        true
                    } else {
                        false
                    }
                }
                "delete" => {
                    tx.execute(
                        "UPDATE assets SET deleted_at=NULL WHERE id=?1",
                        [&b.asset_id],
                    )? == 1
                }
                "warranty" => {
                    let live: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM warranties WHERE id=?1 AND deleted_at IS NULL)", [&b.record_id], |r| r.get(0))?;
                    if live {
                        tx.execute(
                            "DELETE FROM warranty_audit WHERE warranty_id=?1",
                            [&b.record_id],
                        )?;
                        tx.execute(
                            "DELETE FROM reminders WHERE kind='warranty' AND source_id=?1",
                            [&b.record_id],
                        )?;
                        tx.execute("DELETE FROM warranties WHERE id=?1", [&b.record_id])?;
                    }
                    live
                }
                "sell" => {
                    let live: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM sales WHERE id=?1 AND revoked_at IS NULL)",
                        [&b.record_id],
                        |r| r.get(0),
                    )?;
                    if live {
                        tx.execute("DELETE FROM requests WHERE id IN (SELECT request_id FROM sale_audit WHERE sale_id=?1)", [&b.record_id])?;
                        tx.execute("DELETE FROM sale_audit WHERE sale_id=?1", [&b.record_id])?;
                        tx.execute("DELETE FROM sales WHERE id=?1", [&b.record_id])?;
                        tx.execute(
                            "UPDATE assets SET lifecycle_state=?2 WHERE id=?1",
                            params![b.asset_id, b.state],
                        )?;
                    }
                    live
                }
                _ => false,
            };
            if restored {
                tx.execute(
                    "UPDATE assets SET revision=revision+1 WHERE id=?1",
                    [&b.asset_id],
                )?;
                changed += 1;
            } else {
                skipped += 1;
            }
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&(changed, skipped))?
            ],
        )?;
        self.hit("batch_undo.before_commit")?;
        tx.commit()?;
        Ok(Outcome { changed, skipped })
    }
}
