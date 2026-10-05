//! Permanent deletion from Recently Deleted (D17). Only rows the user already
//! deleted can be purged; each takes the rows that exist only for it, and
//! image files are removed after commit once nothing references them.
use crate::{
    domain::{Error, Result},
    storage::{digest, Store},
};
use rusqlite::{params, OptionalExtension, Transaction};
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
}

#[derive(Clone, Debug, Serialize)]
pub struct Purged {
    pub removed: usize,
    /// Items left because another deleted item still depends on them.
    pub kept: usize,
}

const KINDS: [(&str, &str); 10] = [
    ("wish", "wishlist_items"),
    ("payment", "plan_payments"),
    ("maintenance", "maintenances"),
    ("warranty", "warranties"),
    ("expense", "expenses"),
    ("snapshot", "fin_snapshots"),
    ("account", "fin_accounts"),
    ("virtual", "virtual_assets"),
    ("plan", "recurring_plans"),
    ("asset", "assets"),
];

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

/// Removes one deleted row and everything that exists only for it. Returns
/// `false` when the row must stay: a realized item whose wish still exists.
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
                "DELETE FROM fin_snapshots WHERE id=?1",
            ],
        )?,
        "plan" => run(
            tx,
            id,
            &[
                // A purged plan leaves its virtual asset unlinked (ADR-001 §21.3);
                // without a plan the billing mode reads as a one-time spend again.
                "UPDATE virtual_assets SET plan_id=NULL,billing='single' WHERE plan_id=?1",
                "DELETE FROM plan_payments WHERE plan_id=?1",
                "DELETE FROM recurring_plans WHERE id=?1",
            ],
        )?,
        "account" => run(tx, id, &["DELETE FROM fin_accounts WHERE id=?1"])?,
        "expense" => run(tx, id, &["DELETE FROM expenses WHERE id=?1"])?,
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
    Ok(true)
}

impl Store {
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
            let (removed, kept) = result.split_once('/').unwrap_or(("0", "0"));
            return Ok(Purged {
                removed: removed.parse().unwrap_or(0),
                kept: kept.parse().unwrap_or(0),
            });
        }
        let mut files = BTreeSet::new();
        let (mut removed, mut kept) = (0, 0);
        match &input.kind {
            Some(kind) => {
                if !purge_one(&tx, kind, &input.id, &mut files)? {
                    return Err(Error::new(
                        "WISH_LINKED",
                        "这件物品由一条心愿实现。请先永久删除那条心愿，或把物品留在最近删除中。",
                    ));
                }
                removed = 1;
            }
            None => {
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
                        if purge_one(&tx, kind, &id, &mut files)? {
                            removed += 1;
                        } else {
                            kept += 1;
                        }
                    }
                }
            }
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, format!("{removed}/{kept}")],
        )?;
        self.hit("purge.before_commit")?;
        tx.commit()?;
        self.hit("purge.after_commit")?;
        self.remove_unreferenced(&files);
        Ok(Purged { removed, kept })
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
