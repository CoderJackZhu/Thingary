use crate::{
    catalog::AssetRecord,
    domain::{Asset, Error, Result},
    storage::{digest, Store},
};
use rusqlite::{params, OptionalExtension};
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
impl Store {
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
}
