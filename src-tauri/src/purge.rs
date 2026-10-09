//! Permanent deletion from Recently Deleted (D17). Only rows the user already
//! deleted can be purged; each takes the rows that exist only for it, and
//! image files are removed after commit once nothing references them.
use crate::{
    domain::{Error, Result},
    storage::{digest, Store},
};
use rusqlite::{params, Connection, OptionalExtension, ToSql, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Purge {
    pub request_id: String,
    pub generation: String,
    /// A Recently Deleted kind; `None` together with an empty `id` empties the list.
    pub kind: Option<String>,
    pub id: String,
    /// 整组清除的后端复核摘要（R7）：`kind=link_group` 的新请求必填并在写事务
    /// 重算比较；缺省不参与序列化，保持旧回执指纹不变。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Purged {
    pub removed: usize,
    /// Items left because another deleted item still depends on them.
    pub kept: usize,
    #[serde(default)]
    pub kept_reasons: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PurgeAllPreview {
    pub generation: String,
    pub preview: String,
    pub groups: Vec<crate::link::LinkPurgePreview>,
    pub other_count: usize,
}

/// SQLite values are encoded with type and escaped bytes, with deterministic row order.
pub(crate) fn sql_facts(
    c: &Connection,
    sql: &str,
    parameters: &[&dyn ToSql],
) -> Result<Vec<Vec<String>>> {
    let mut q = c.prepare(sql)?;
    let width = q.column_count();
    let mut rows = q.query(parameters)?;
    let mut facts = Vec::new();
    while let Some(row) = rows.next()? {
        let mut values = Vec::new();
        for i in 0..width {
            values.push(format!("{:?}", row.get_ref(i)?));
        }
        facts.push(values);
    }
    Ok(facts)
}

fn all_digest(c: &Connection, generation: &str) -> Result<String> {
    let mut facts = Vec::new();
    for table in KINDS.iter().map(|(_, table)| *table).chain([
        "link_trash_groups",
        "link_trash_members",
        "plan_rates",
        "plan_rules",
        "plan_period_ends",
        "reminders",
        "plan_profile",
        "virtual_topups",
        "virtual_balances",
    ]) {
        facts.push((
            table,
            sql_facts(c, &format!("SELECT * FROM {table} ORDER BY rowid"), &[])?,
        ));
    }
    Ok(digest(&serde_json::to_vec(&(
        "purge-all",
        generation,
        facts,
    ))?))
}

const KINDS: [(&str, &str); 11] = [
    ("wish", "wishlist_items"),
    ("payment", "plan_payments"),
    ("maintenance", "maintenances"),
    ("warranty", "warranties"),
    ("expense", "expenses"),
    ("income", "plan_income"),
    ("snapshot", "fin_snapshots"),
    ("account", "fin_accounts"),
    ("virtual", "virtual_assets"),
    ("plan", "recurring_plans"),
    ("asset", "assets"),
];

/// Protection codes the “empty everything” pass tolerates by keeping the row
/// (or the whole group) and counting it as kept.
fn is_kept_reason(error: &Error) -> bool {
    matches!(
        error.code.as_str(),
        "PLANNING_DEPENDENCY" | "WISH_LINKED" | "LINK_PLAN_REFERENCED"
    )
}

fn table(kind: &str) -> Result<&'static str> {
    KINDS
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, t)| *t)
        .ok_or_else(|| Error::new("TRASH_KIND", "不支持的类型"))
}

fn column(tx: &Transaction<'_>, sql: &str, id: &str) -> Result<Vec<String>> {
    let mut q = tx.prepare(sql)?;
    let values = q
        .query_map([id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(values)
}

fn hashes(tx: &Transaction<'_>, sql: &str, id: &str, out: &mut BTreeSet<String>) -> Result<()> {
    out.extend(column(tx, sql, id)?);
    Ok(())
}

fn run(tx: &Transaction<'_>, id: &str, sql: &[&str]) -> Result<()> {
    for statement in sql {
        tx.execute(statement, [id])?;
    }
    Ok(())
}

/// Removes one deleted linked pair as a group (design §7.3): checks run for
/// both members before anything is written, so a protected group stays whole
/// and the caller can count it as kept. The group row remains with status
/// `purged` as the operation's ownership record.
pub(crate) fn purge_group(
    tx: &Transaction<'_>,
    group_id: &str,
    _files: &mut BTreeSet<String>,
) -> Result<()> {
    let (status, _revision): (String, i64) = tx
        .query_row(
            "SELECT status,revision FROM link_trash_groups WHERE id=?1",
            [group_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条删除组"))?;
    if status != "deleted" {
        return Err(Error::new(
            "LINK_GROUP_STALE",
            "这组记录已恢复或已清除，请重新读取最近删除",
        ));
    }
    let (asset_id, plan_id) = crate::link::group_members_of(tx, group_id)?;
    let consistent: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM virtual_assets v JOIN recurring_plans p ON p.id=v.plan_id JOIN link_trash_members a ON a.member_id=v.id AND a.member_kind='virtual' JOIN link_trash_members b ON b.member_id=p.id AND b.member_kind='plan' WHERE a.group_id=?1 AND b.group_id=?1 AND v.deleted_at IS NOT NULL AND p.deleted_at IS NOT NULL AND v.revision=a.revision_after AND p.revision=b.revision_after)", [group_id], |r| r.get(0))?;
    if !consistent {
        return Err(Error::new(
            "LINK_GROUP_STALE",
            "删除组成员已变化，请重新读取并核对关联",
        ));
    }
    crate::plan_core::protect_reference(tx, "virtual", &asset_id)?;
    crate::plan_core::protect_reference(tx, "plan", &plan_id)?;
    // Group-external assets must not lose their relationship silently: a
    // historical tombstone still referencing the plan keeps the purge from
    // proceeding until it has been handled explicitly (§7.3/§8).
    let external: Option<String> = tx
        .query_row(
            "SELECT id FROM virtual_assets WHERE plan_id=?1 AND id NOT IN (SELECT member_id FROM link_trash_members WHERE group_id=?2 AND member_kind='virtual') LIMIT 1",
            params![plan_id, group_id],
            |r| r.get(0),
        )
        .optional()?;
    if external.is_some() {
        return Err(Error::new(
            "LINK_PLAN_REFERENCED",
            "还有其他档案按 ID 引用这项计划；请先处理那些旧档案，再永久清除这组",
        ));
    }
    // 计划侧全部付款、规则与提醒一并移除（§7.3）。
    run(
        tx,
        &plan_id,
        &[
            "DELETE FROM plan_payments WHERE plan_id=?1",
            "DELETE FROM plan_rates WHERE plan_id=?1",
            "DELETE FROM plan_rules WHERE plan_id=?1",
            "DELETE FROM plan_period_ends WHERE plan_id=?1",
        ],
    )?;
    run(
        tx,
        &asset_id,
        &["DELETE FROM reminders WHERE kind='renewal' AND entity_id=?1"],
    )?;
    tx.execute("DELETE FROM virtual_assets WHERE id=?1", [&asset_id])?;
    tx.execute("DELETE FROM recurring_plans WHERE id=?1", [&plan_id])?;
    tx.execute(
        "UPDATE link_trash_groups SET status='purged',revision=revision+1,updated_at=?2 WHERE id=?1",
        params![group_id, chrono::Utc::now().to_rfc3339()],
    )?;
    // Saved replies may carry the removed content; a purge leaves no copy.
    for id in [&asset_id, &plan_id] {
        tx.execute("DELETE FROM requests WHERE instr(result,?1)>0", [id])?;
    }
    Ok(())
}

/// Removes one deleted row and everything that exists only for it. Returns
/// `false` when the row must stay: a realized item whose wish still exists,
/// or a plan a live archive still uses.
fn purge_one(
    tx: &Transaction<'_>,
    kind: &str,
    id: &str,
    files: &mut BTreeSet<String>,
) -> Result<bool> {
    let deleted: Option<Option<String>> = tx
        .query_row(
            &format!("SELECT deleted_at FROM {} WHERE id=?1", table(kind)?),
            [id],
            |r| r.get(0),
        )
        .optional()?;
    match deleted {
        None => return Ok(true),
        Some(None) => return Err(Error::new("NOT_DELETED", "只能永久删除最近删除中的项目")),
        Some(Some(_)) => {}
    }
    // A member of an open trash group purges as the whole group (§7.3); the
    // group pass runs both protection checks before anything is written.
    if kind == "virtual" || kind == "plan" {
        if let Some((gid, _)) = crate::link::open_group_for(tx, id)? {
            return Err(Error::new(
                "PREVIEW_REQUIRED",
                &format!("请读取关联删除组 {gid} 的完整清除预览"),
            ));
        }
    }
    if kind == "payment" {
        let pid: String =
            tx.query_row("SELECT plan_id FROM plan_payments WHERE id=?1", [id], |r| {
                r.get(0)
            })?;
        if crate::link::open_group_for(tx, &pid)?.is_some() {
            return Err(Error::new(
                "LINK_GROUP_REQUIRED",
                "付款属于一个删除组，请整组处理",
            ));
        }
    }
    crate::plan_core::protect_reference(tx, kind, id)?;
    match kind {
        "asset" => {
            let linked: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM wishlist_items WHERE converted_asset_id=?1 OR legacy_generated_asset_id=?1)",
                [id],
                |r| r.get(0),
            )?;
            if linked {
                return Ok(false);
            }
            // A considered-replacement relation never blocks deletion: the FK
            // clears and the item's name stays as the stale relation's
            // display history (§7.1).
            tx.execute(
                "UPDATE wishlist_items SET replacement_asset_id=NULL,replacement_asset_name=(SELECT name FROM assets WHERE id=?1),revision=revision+1 WHERE replacement_asset_id=?1",
                [id],
            )?;
            hashes(
                tx,
                "SELECT hash FROM attachments WHERE asset_id=?1",
                id,
                files,
            )?;
            run(tx, id, &[
                "DELETE FROM maintenance_photos WHERE maintenance_id IN (SELECT id FROM maintenances WHERE asset_id=?1)",
                "DELETE FROM maintenance_audit WHERE maintenance_id IN (SELECT id FROM maintenances WHERE asset_id=?1)",
                "DELETE FROM feature_audit WHERE entity_id IN (SELECT id FROM maintenances WHERE asset_id=?1)",
                "DELETE FROM maintenances WHERE asset_id=?1",
                "DELETE FROM warranty_photos WHERE warranty_id IN (SELECT id FROM warranties WHERE asset_id=?1)",
                "DELETE FROM warranty_audit WHERE warranty_id IN (SELECT id FROM warranties WHERE asset_id=?1)",
                "DELETE FROM reminders WHERE kind='warranty' AND entity_id=?1",
                "DELETE FROM warranties WHERE asset_id=?1",
                "DELETE FROM asset_media WHERE asset_id=?1",
                "DELETE FROM asset_photos WHERE asset_id=?1",
                "DELETE FROM attachments WHERE asset_id=?1",
                "DELETE FROM sale_audit WHERE sale_id IN (SELECT id FROM sales WHERE asset_id=?1)",
                "DELETE FROM sales WHERE asset_id=?1",
                "DELETE FROM lifecycle_events WHERE asset_id=?1",
                "DELETE FROM asset_profiles WHERE asset_id=?1",
                "DELETE FROM asset_preferences WHERE asset_id=?1",
                "DELETE FROM expenses WHERE asset_id=?1",
                "DELETE FROM feature_audit WHERE entity_id=?1",
                "DELETE FROM assets WHERE id=?1",
            ])?;
        }
        "maintenance" => {
            hashes(tx, "SELECT a.hash FROM maintenance_photos p JOIN attachments a ON a.id=p.attachment_id WHERE p.maintenance_id=?1", id, files)?;
            let photos = column(
                tx,
                "SELECT attachment_id FROM maintenance_photos WHERE maintenance_id=?1",
                id,
            )?;
            run(
                tx,
                id,
                &["DELETE FROM maintenance_photos WHERE maintenance_id=?1"],
            )?;
            for photo in &photos {
                tx.execute("DELETE FROM attachments WHERE id=?1", [photo])?;
            }
            run(
                tx,
                id,
                &[
                    "DELETE FROM maintenance_audit WHERE maintenance_id=?1",
                    "DELETE FROM feature_audit WHERE entity_id=?1",
                    "DELETE FROM maintenances WHERE id=?1",
                ],
            )?;
        }
        "warranty" => {
            hashes(tx, "SELECT a.hash FROM warranty_photos p JOIN attachments a ON a.id=p.attachment_id WHERE p.warranty_id=?1", id, files)?;
            let photos = column(
                tx,
                "SELECT attachment_id FROM warranty_photos WHERE warranty_id=?1",
                id,
            )?;
            run(
                tx,
                id,
                &["DELETE FROM warranty_photos WHERE warranty_id=?1"],
            )?;
            for photo in &photos {
                tx.execute("DELETE FROM attachments WHERE id=?1", [photo])?;
            }
            run(
                tx,
                id,
                &[
                    "DELETE FROM warranty_audit WHERE warranty_id=?1",
                    "DELETE FROM reminders WHERE kind='warranty' AND source_id=?1",
                    "DELETE FROM feature_audit WHERE entity_id=?1",
                    "DELETE FROM warranties WHERE id=?1",
                ],
            )?;
        }
        "wish" => {
            hashes(
                tx,
                "SELECT hash FROM wishlist_attachments WHERE wishlist_id=?1",
                id,
                files,
            )?;
            run(
                tx,
                id,
                &[
                    "DELETE FROM wishlist_media WHERE wishlist_id=?1",
                    "DELETE FROM wishlist_attachments WHERE wishlist_id=?1",
                    "DELETE FROM wishlist_audit WHERE wishlist_id=?1",
                    "DELETE FROM wishlist_preferences WHERE wishlist_id=?1",
                    "DELETE FROM reminders WHERE kind='wishlist' AND entity_id=?1",
                    "DELETE FROM feature_audit WHERE entity_id=?1",
                    "DELETE FROM wishlist_items WHERE id=?1",
                ],
            )?;
        }
        "snapshot" => run(
            tx,
            id,
            &[
                "DELETE FROM fin_snapshot_entries WHERE snapshot_id=?1",
                "DELETE FROM plan_baseline_marks WHERE snapshot_id=?1",
                "DELETE FROM fin_snapshots WHERE id=?1",
            ],
        )?,
        "plan" => {
            // 一个仍被有效档案使用的计划不能被静默解除关联（设计 §7.3）；
            // 整组清除先走 purge_group，这里只处理无有效关联的计划。
            if let Some((_, name, _)) = crate::link::live_asset_of_plan(tx, id)? {
                return Err(Error::new(
                    "LINK_PLAN_REFERENCED",
                    &format!("这项计划仍由「{name}」使用；请先整组删除或恢复，再永久清除"),
                ));
            }
            run(
                tx,
                id,
                &[
                    "DELETE FROM plan_payments WHERE plan_id=?1",
                    "DELETE FROM plan_rates WHERE plan_id=?1",
                    "DELETE FROM plan_rules WHERE plan_id=?1",
                    "DELETE FROM plan_period_ends WHERE plan_id=?1",
                    "DELETE FROM recurring_plans WHERE id=?1",
                ],
            )?
        }
        "account" => run(tx, id, &["DELETE FROM fin_accounts WHERE id=?1"])?,
        "expense" => run(tx, id, &["DELETE FROM expenses WHERE id=?1"])?,
        "income" => run(tx, id, &["DELETE FROM plan_income WHERE id=?1"])?,
        "payment" => run(tx, id, &["DELETE FROM plan_payments WHERE id=?1"])?,
        "virtual" => run(
            tx,
            id,
            &[
                // Facts die with their account, so do their reminders.
                "DELETE FROM reminders WHERE kind='renewal' AND entity_id=?1",
                "DELETE FROM virtual_topups WHERE asset_id=?1",
                "DELETE FROM virtual_balances WHERE asset_id=?1",
                "DELETE FROM virtual_assets WHERE id=?1",
            ],
        )?,
        _ => return Err(Error::new("TRASH_KIND", "不支持的类型")),
    }
    // Saved replies may carry the removed content; a purge leaves no copy.
    tx.execute("DELETE FROM requests WHERE instr(result,?1)>0", [id])?;
    if matches!(kind, "account" | "snapshot" | "income") {
        tx.execute("UPDATE import_external_key SET status='purged',revision=revision+1,updated_at=?3 WHERE object_kind=?1 AND object_id=?2 AND status='active'", params![kind,id,chrono::Utc::now().to_rfc3339()])?;
    }
    Ok(true)
}

impl Store {
    pub fn purge_all_preview(&self) -> Result<PurgeAllPreview> {
        let tx = self.conn()?.unchecked_transaction()?;
        let generation = self.generation();
        let ids = column(
            &tx,
            "SELECT id FROM link_trash_groups WHERE status='deleted' AND ?1='' ORDER BY id",
            "",
        )?;
        let groups = ids
            .iter()
            .map(|id| crate::link::purge_preview(&tx, &generation, id))
            .collect::<Result<Vec<_>>>()?;
        let total = self
            .list_trash(&crate::trash::TrashQuery {
                filter: "all".into(),
                search: String::new(),
                offset: 0,
            })?
            .total as usize;
        Ok(PurgeAllPreview {
            preview: all_digest(&tx, &generation)?,
            generation,
            other_count: total.saturating_sub(groups.len()),
            groups,
        })
    }
    pub fn purge_trash(&mut self, input: &Purge) -> Result<Purged> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("purge", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((f, result)) = prior {
            if f != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
            }
            if let Ok(result) = serde_json::from_str::<Purged>(&result) {
                return Ok(result);
            }
            let (removed, kept) = result.split_once('/').unwrap_or(("0", "0"));
            return Ok(Purged {
                removed: removed.parse().unwrap_or(0),
                kept: kept.parse().unwrap_or(0),
                kept_reasons: Vec::new(),
            });
        }
        let mut files = BTreeSet::new();
        let (mut removed, mut kept) = (0, 0);
        let mut kept_reasons = Vec::new();
        match &input.kind {
            // 整组清除：双方与计划侧全部付款、规则、提醒一个事务移除（§7.3）。
            // 预览摘要在写事务重算比较；影响变化（新增付款、更正、引用变化）
            // 要求重新读取确认，不沿用旧确认静默扩大清除范围（R7）。
            Some(kind) if kind == "link_group" => {
                let expected = input.preview.as_deref().ok_or_else(|| {
                    Error::new("PREVIEW_REQUIRED", "永久清除前请先读取整组影响预览")
                })?;
                let actual = crate::link::purge_digest_for(&tx, &input.generation, &input.id)?;
                if actual != expected {
                    return Err(Error::new(
                        "PREVIEW_STALE",
                        "清除影响已变化，请重新读取预览后再确认",
                    ));
                }
                purge_group(&tx, &input.id, &mut files)?;
                removed = 1;
            }
            Some(kind) => {
                if !purge_one(&tx, kind, &input.id, &mut files)? {
                    let (code, message) = match kind.as_str() {
                        "wish" => (
                            "WISH_LINKED",
                            "这件物品由一条心愿实现。请先永久删除那条心愿，或把物品留在最近删除中。",
                        ),
                        "plan" => (
                            "LINK_PLAN_REFERENCED",
                            "这项计划仍被有效档案使用；请先整组删除或恢复，再永久清除。",
                        ),
                        _ => ("WISH_LINKED", "这项记录被其他资料引用，暂时不能永久删除。"),
                    };
                    return Err(Error::new(code, message));
                }
                removed = 1;
            }
            None => {
                let has_groups: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM link_trash_groups WHERE status='deleted')",
                    [],
                    |r| r.get(0),
                )?;
                if has_groups || input.preview.is_some() {
                    let expected = input.preview.as_deref().ok_or_else(|| {
                        Error::new("PREVIEW_REQUIRED", "清空前请读取完整影响预览")
                    })?;
                    if expected != all_digest(&tx, &input.generation)? {
                        return Err(Error::new(
                            "PREVIEW_STALE",
                            "清空影响已变化，请重新读取预览后确认",
                        ));
                    }
                }
                // Linked pairs purge as one group before the row-by-row pass,
                // so a member can never be purged twice or leave its partner
                // half-cleared (§7.3). Protected groups stay whole and count
                // once as kept.
                let mut group_ids: Vec<String> = {
                    let mut q = tx.prepare(
                        "SELECT id FROM link_trash_groups WHERE status='deleted' ORDER BY id",
                    )?;
                    let ids = q
                        .query_map([], |r| r.get::<_, String>(0))?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    ids
                };
                group_ids.sort();
                for gid in group_ids {
                    match purge_group(&tx, &gid, &mut files) {
                        Ok(()) => removed += 1,
                        Err(e) if is_kept_reason(&e) => {
                            kept += 1;
                            kept_reasons.push(format!("关联组 {gid}：{}", e.message));
                        }
                        Err(e) => return Err(e),
                    }
                }
                // Children before parents, wishes before the items they realized.
                for (kind, table) in KINDS {
                    let mut q = tx.prepare(&format!(
                        "SELECT id FROM {table} WHERE deleted_at IS NOT NULL ORDER BY id"
                    ))?;
                    let ids = q
                        .query_map([], |r| r.get::<_, String>(0))?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    drop(q);
                    for id in ids {
                        // 组成员由上面的整组处理：被保留的组不再逐个清除，
                        // 已清除的组成员也不会再出现（§7.3）。
                        if (kind == "virtual" || kind == "plan")
                            && crate::link::open_group_for(&tx, &id)?.is_some()
                        {
                            continue;
                        }
                        if kind == "payment" {
                            let pid: String = tx.query_row(
                                "SELECT plan_id FROM plan_payments WHERE id=?1",
                                [&id],
                                |r| r.get(0),
                            )?;
                            if crate::link::open_group_for(&tx, &pid)?.is_some() {
                                continue;
                            }
                        }
                        match purge_one(&tx, kind, &id, &mut files) {
                            Ok(true) => removed += 1,
                            Ok(false) => {
                                kept += 1;
                                kept_reasons.push(format!("{kind} {id}：仍有其他资料引用"));
                            }
                            Err(e) if is_kept_reason(&e) => {
                                kept += 1;
                                kept_reasons.push(format!("{kind} {id}：{}", e.message));
                            }
                            Err(e) => return Err(e),
                        }
                    }
                }
            }
        }
        let result = Purged {
            removed,
            kept,
            kept_reasons,
        };
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&result)?
            ],
        )?;
        self.hit("purge.before_commit")?;
        tx.commit()?;
        self.hit("purge.after_commit")?;
        self.remove_unreferenced(&files);
        Ok(result)
    }

    /// Best effort: a file left behind is only wasted space, never lost data.
    fn remove_unreferenced(&self, candidates: &BTreeSet<String>) {
        let Ok(c) = self.conn() else { return };
        let dir = self.dataset();
        // Staged selections are never cleaned up, so only a recent one can
        // belong to a form still in progress.
        let recent = std::time::SystemTime::now() - std::time::Duration::from_secs(86_400);
        let staged: String = std::fs::read_dir(dir.join("staging"))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| {
                e.metadata()
                    .and_then(|m| m.modified())
                    .is_ok_and(|t| t > recent)
            })
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .collect();
        for hash in candidates {
            let used = c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM attachments WHERE hash=?1) OR EXISTS(SELECT 1 FROM wishlist_attachments WHERE hash=?1) OR EXISTS(SELECT 1 FROM materials WHERE hash=?1)",
                    [hash],
                    |r| r.get::<_, bool>(0),
                )
                .unwrap_or(true);
            if used
                || staged.contains(hash.as_str())
                || crate::files::validate_file_name(hash).is_err()
            {
                continue;
            }
            let _ = std::fs::remove_file(dir.join("files").join(hash));
            let _ = std::fs::remove_file(dir.join("cache").join(format!("{hash}.png")));
            let _ = std::fs::remove_file(dir.join("cache").join(format!("{hash}.png.sha256")));
        }
    }
}
