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
    /// What this one deletion took along, shown so a restore holds no surprise (D17).
    pub contents: Vec<Content>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Content {
    pub kind: &'static str,
    pub count: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrashQuery {
    pub filter: String,
    pub offset: u32,
    #[serde(default)]
    pub search: String,
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
        if input.deleted {
            crate::plan_core::protect_reference(&tx, "asset", &input.asset_id)?;
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
    /// A search word filters the full result before pagination: `total` counts
    /// every match, never just the current page.
    pub fn list_trash(&self, q: &TrashQuery) -> Result<TrashPage> {
        if !["all", "asset", "maintenance", "warranty", "wish", "wealth"]
            .contains(&q.filter.as_str())
        {
            return Err(Error::new("QUERY", "不支持的筛选"));
        }
        if q.search.chars().count() > 200 {
            return Err(Error::new("SEARCH", "搜索内容最多 200 字"));
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
                        contents: vec![],
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
                        contents: vec![],
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
                        contents: vec![],
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
                        contents: vec![],
                    })
                }
            };
            // Linked pairs deleted as a group show once as 关联订阅; their two
            // member rows are suppressed so counts stay per group (§7.2).
            if q.filter == "all" || q.filter == "asset" || q.filter == "wealth" {
                let mut g = c.prepare(
                    "SELECT g.id,g.created_at,g.revision,
                        (SELECT name FROM virtual_assets v WHERE v.id=(SELECT member_id FROM link_trash_members WHERE group_id=g.id AND member_kind='virtual')),
                        (SELECT count(*) FROM plan_payments p WHERE p.plan_id=(SELECT member_id FROM link_trash_members WHERE group_id=g.id AND member_kind='plan')),
                        (SELECT sum(amount_cents) FROM plan_payments p WHERE p.plan_id=(SELECT member_id FROM link_trash_members WHERE group_id=g.id AND member_kind='plan') AND p.state='paid')
                     FROM link_trash_groups g WHERE g.status='deleted'",
                )?;
                let groups = g
                    .query_map([], |r| {
                        Ok(Entry {
                            kind: "link_group".into(),
                            id: r.get(0)?,
                            title: r
                                .get::<_, Option<String>>(3)?
                                .unwrap_or_else(|| "关联订阅".into()),
                            subtype: Some("link".into()),
                            date: None,
                            end_date: None,
                            cost_cents: r.get::<_, Option<i64>>(5)?.map(|v| v.to_string()),
                            provider: None,
                            deleted_at: r.get(1)?,
                            asset_id: None,
                            asset_name: None,
                            asset_deleted: false,
                            asset_revision: r.get(2)?,
                            asset_state: None,
                            contents: match r.get::<_, i64>(4)? {
                                0 => vec![],
                                n => vec![Content {
                                    kind: "payment",
                                    count: n,
                                }],
                            },
                        })
                    })?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                entries.extend(groups);
            }
            let group_skip =
                "AND id NOT IN (SELECT member_id FROM link_trash_members m JOIN link_trash_groups g ON g.id=m.group_id WHERE g.status='deleted')";
            entries.extend(query_entries(c, "SELECT id,date,NULL,date,deleted_at,revision FROM fin_snapshots WHERE deleted_at IS NOT NULL", wealth("snapshot"))?);
            entries.extend(query_entries(c, "SELECT id,name,kind,NULL,deleted_at,revision FROM fin_accounts WHERE deleted_at IS NOT NULL", wealth("account"))?);
            entries.extend(query_entries(c, "SELECT id,title,category,date,deleted_at,revision FROM expenses WHERE deleted_at IS NOT NULL", wealth("expense"))?);
            entries.extend(query_entries(c, "SELECT id,date,NULL,date,deleted_at,revision FROM plan_income WHERE deleted_at IS NOT NULL", wealth("income"))?);
            entries.extend(query_entries(c, &format!("SELECT id,name,category,NULL,deleted_at,revision FROM recurring_plans WHERE deleted_at IS NOT NULL {group_skip}"), wealth("plan"))?);
            entries.extend(query_entries(c, &format!("SELECT id,name,kind,purchase_date,deleted_at,revision FROM virtual_assets WHERE deleted_at IS NOT NULL {group_skip}"), wealth("virtual"))?);
            // Independently deleted topups and balance check-ins; a topup hidden
            // by its deleted account is not a row (its parent restores it).
            let mut topups = query_entries(c, "SELECT t.id,v.name,NULL,t.topup_date,t.deleted_at,t.revision,v.id,v.name,v.deleted_at IS NOT NULL FROM virtual_topups t JOIN virtual_assets v ON v.id=t.asset_id WHERE t.deleted_at IS NOT NULL", |r| {
                let mut e = wealth("topup")(r)?;
                e.asset_id = Some(r.get(6)?);
                e.asset_name = Some(r.get(7)?);
                e.asset_deleted = r.get(8)?;
                Ok(e)
            })?;
            entries.append(&mut topups);
            let mut balances = query_entries(c, "SELECT b.id,v.name,NULL,b.recorded_on,b.deleted_at,b.revision,v.id,v.name,v.deleted_at IS NOT NULL FROM virtual_balances b JOIN virtual_assets v ON v.id=b.asset_id WHERE b.deleted_at IS NOT NULL", |r| {
                let mut e = wealth("balance")(r)?;
                e.asset_id = Some(r.get(6)?);
                e.asset_name = Some(r.get(7)?);
                e.asset_deleted = r.get(8)?;
                Ok(e)
            })?;
            entries.append(&mut balances);
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
        if q.filter == "all" || q.filter == "wish" {
            // `date` is the realization day; `asset_*` describe the realized item.
            entries.extend(query_entries(
                c,
                "SELECT w.id,w.name,w.status,substr(w.achieved_at,1,10),w.deleted_at,w.revision,a.id,a.name,a.deleted_at IS NOT NULL FROM wishlist_items w LEFT JOIN assets a ON a.id=w.converted_asset_id WHERE w.deleted_at IS NOT NULL",
                |r| {
                    Ok(Entry {
                        kind: "wish".into(),
                        id: r.get(0)?,
                        title: r.get(1)?,
                        subtype: r.get(2)?,
                        date: r.get(3)?,
                        end_date: None,
                        cost_cents: None,
                        provider: None,
                        deleted_at: r.get(4)?,
                        asset_id: r.get(6)?,
                        asset_name: r.get(7)?,
                        asset_deleted: r.get::<_, Option<bool>>(8)?.unwrap_or(false),
                        asset_revision: r.get(5)?,
                        asset_state: None,
                        contents: vec![],
                    })
                },
            )?);
        }
        for entry in &mut entries {
            entry.contents = contents(c, &entry.kind, &entry.id)?;
        }
        // RFC3339 UTC stamps sort lexicographically; ties break by kind then id.
        entries.sort_by(|a, b| {
            b.deleted_at
                .cmp(&a.deleted_at)
                .then_with(|| a.kind.cmp(&b.kind))
                .then_with(|| a.id.cmp(&b.id))
        });
        // Literal substring match over the shown title, the row's type label
        // and the parent name (same fields the panel displays; U12).
        let needle = q.search.trim().to_lowercase();
        if !needle.is_empty() {
            entries.retain(|e| {
                [
                    e.title.to_lowercase(),
                    kind_label(&e.kind),
                    e.asset_name.as_deref().unwrap_or("").to_lowercase(),
                ]
                .into_iter()
                .any(|t| t.contains(&needle))
            });
        }
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

/// Rows hidden only because their parent is deleted: they return with it.
fn contents(c: &Connection, kind: &str, id: &str) -> Result<Vec<Content>> {
    let queries: &[(&'static str, &str)] = match kind {
        "asset" => &[
            (
                "maintenance",
                "SELECT count(*) FROM maintenances WHERE asset_id=?1 AND deleted_at IS NULL",
            ),
            (
                "warranty",
                "SELECT count(*) FROM warranties WHERE asset_id=?1 AND deleted_at IS NULL",
            ),
            (
                "expense",
                "SELECT count(*) FROM expenses WHERE asset_id=?1 AND deleted_at IS NULL",
            ),
            (
                "photo",
                "SELECT count(*) FROM asset_photos WHERE asset_id=?1",
            ),
        ],
        "maintenance" => &[(
            "photo",
            "SELECT count(*) FROM maintenance_photos WHERE maintenance_id=?1",
        )],
        "warranty" => &[(
            "photo",
            "SELECT count(*) FROM warranty_photos WHERE warranty_id=?1",
        )],
        "plan" => &[(
            "payment",
            "SELECT count(*) FROM plan_payments WHERE plan_id=?1 AND deleted_at IS NULL",
        )],
        "virtual" => &[
            (
                "topup",
                "SELECT count(*) FROM virtual_topups WHERE asset_id=?1 AND deleted_at IS NULL",
            ),
            (
                "balance",
                "SELECT count(*) FROM virtual_balances WHERE asset_id=?1 AND deleted_at IS NULL",
            ),
        ],
        "snapshot" => &[(
            "entry",
            "SELECT count(*) FROM fin_snapshot_entries WHERE snapshot_id=?1",
        )],
        // 关联订阅组：隐藏付款数来自组内计划侧（§7.2 预览口径一致）。
        "link_group" => &[(
            "payment",
            "SELECT count(*) FROM plan_payments WHERE plan_id=(SELECT member_id FROM link_trash_members WHERE group_id=?1 AND member_kind='plan') AND deleted_at IS NULL",
        )],
        "wish" => &[(
            "photo",
            "SELECT count(*) FROM wishlist_attachments WHERE wishlist_id=?1",
        )],
        _ => &[],
    };
    let mut out = Vec::new();
    for (kind, sql) in queries {
        let count: i64 = c.query_row(sql, [id], |r| r.get(0))?;
        if count > 0 {
            out.push(Content { kind, count });
        }
    }
    Ok(out)
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

/// The row type label shown in the panel (entryDisplay's typeLabel); search
/// matches this text so users can find rows by what the page calls them.
fn kind_label(kind: &str) -> String {
    match kind {
        "asset" => "物品",
        "maintenance" => "维护",
        "warranty" => "保障",
        "wish" => "心愿",
        "snapshot" => "盘点",
        "account" => "账户",
        "expense" => "支出",
        "income" => "收入记录",
        "plan" => "周期计划",
        "payment" => "周期付款",
        "virtual" => "虚拟资产",
        "topup" => "充值",
        "balance" => "余额记录",
        "link_group" => "关联订阅",
        other => other,
    }
    .to_string()
}
