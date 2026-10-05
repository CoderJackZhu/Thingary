//! Wishlist plans. Savings amounts are read-only history since the purchase
//! decision redesign (LOW_FREQUENCY_REVIEW_DESIGN §3.6): the write command
//! answers with a clear feature-retired error, while old receipts stay
//! readable and are never re-executed.
use crate::{
    domain::{cents, date, Error, Result},
    photos::Selection,
    storage::{digest, uid, Store},
    wishlist::{Fields, WishlistItem},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub added_date: Option<String>,
    pub channel_id: Option<String>,
    /// Legacy field, read-only history; None for new wishes (§3.1).
    pub mode: Option<String>,
    pub saved_cents: String,
    pub achievement_source: Option<String>,
    pub pinned: bool,
    pub reminder: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            added_date: None,
            channel_id: None,
            mode: None,
            saved_cents: "0".into(),
            achievement_source: None,
            pinned: false,
            reminder: false,
        }
    }
}
impl Preferences {
    pub fn validate(&self) -> Result<()> {
        if let Some(d) = &self.added_date {
            date(d)?;
        }
        cents(Some(&self.saved_cents))?;
        if self
            .mode
            .as_deref()
            .is_some_and(|m| !["countdown", "savings"].contains(&m))
            || self
                .achievement_source
                .as_deref()
                .is_some_and(|s| !["manual", "savings", "conversion"].contains(&s))
        {
            return Err(Error::new("WISH_PLAN", "心愿计划无效"));
        }
        Ok(())
    }
}
pub fn read(c: &Connection, id: &str) -> Result<Preferences> {
    let raw: Option<String> = c
        .query_row(
            "SELECT payload FROM wishlist_preferences WHERE wishlist_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
        .map(Option::unwrap_or_default)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
    pub preferences: Preferences,
    pub photos: Selection,
    /// The item this wish is considering replacing; None drops an active
    /// relation but preserves any purged display history until explicitly
    /// cleared. New targets must be live; an unchanged soft-deleted relation
    /// is kept without touching the item (§7.1).
    #[serde(default)]
    pub replacement_asset_id: Option<String>,
    /// Clear the minimum history after a purge only on an explicit removal.
    /// Omit false to keep existing schema-28 receipt fingerprints unchanged.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub clear_replacement: bool,
}
// Schema-27 queued requests and receipts predate the replacement fields.
// Serialize their exact original shape and order for replay compatibility;
// this alternative is never accepted for a request changing a relation.
fn legacy_plan_fingerprint(input: &Save) -> Result<String> {
    #[derive(Serialize)]
    struct LegacySave<'a> {
        request_id: &'a str,
        generation: &'a str,
        id: &'a Option<String>,
        expected_revision: Option<i64>,
        fields: &'a Fields,
        preferences: &'a Preferences,
        photos: &'a Selection,
    }
    let old = LegacySave {
        request_id: &input.request_id,
        generation: &input.generation,
        id: &input.id,
        expected_revision: input.expected_revision,
        fields: &input.fields,
        preferences: &input.preferences,
        photos: &input.photos,
    };
    Ok(digest(&serde_json::to_vec(&("wish_plan", old))?))
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Saving {
    pub request_id: String,
    pub generation: String,
    pub id: String,
    pub expected_revision: i64,
    pub mode: String,
    pub cents: String,
}
/// Replay-only receipt lookup shared by the decision commands: same id with a
/// different fingerprint is a conflict; no row means it never committed.
pub(crate) fn receipt(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((f, result)) = prior {
        if f != fingerprint {
            return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
        }
        Ok(Some(result))
    } else {
        Ok(None)
    }
}
fn reference(c: &Connection, table: &str, id: Option<&str>) -> Result<()> {
    if let Some(id) = id {
        if !c.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"),
            [id],
            |r| r.get::<_, bool>(0),
        )? {
            return Err(Error::new("TAXONOMY_STALE", "分类或渠道已变化，请重新选择"));
        }
    }
    Ok(())
}
impl Store {
    /// Saves wish fields and preferences. Editing never changes the decision
    /// state, never generates, deletes or retires an asset, and never drives
    /// the retired savings transitions (§3.1, §3.3, A16).
    pub fn save_wish_plan(&mut self, input: &Save, today: &str) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wish_plan", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let prior = match receipt(&tx, &input.request_id, &fingerprint) {
            Err(e)
                if e.code == "REQUEST_CONFLICT"
                    && input.replacement_asset_id.is_none()
                    && !input.clear_replacement =>
            {
                receipt(&tx, &input.request_id, &legacy_plan_fingerprint(input)?)?
            }
            other => other?,
        };
        if let Some(id) = prior {
            return crate::wishlist::read(&tx, &id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"));
        }
        input.fields.validate()?;
        input.preferences.validate()?;
        if input
            .preferences
            .added_date
            .as_deref()
            .is_some_and(|d| d > today)
        {
            return Err(Error::new("WISH_DATE", "添加时间不能晚于今天"));
        }
        reference(&tx, "categories", input.fields.category_id.as_deref())?;
        reference(&tx, "channels", input.preferences.channel_id.as_deref())?;
        let old = input
            .id
            .as_ref()
            .map(|id| {
                crate::wishlist::read(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"))
            })
            .transpose()?;
        if old.as_ref().map(|w| w.revision) != input.expected_revision
            || old.as_ref().is_some_and(|w| w.deleted)
        {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        // Newly selected targets must be live. Keeping the wish's original
        // soft-deleted target must not block unrelated field edits.
        if input.clear_replacement && input.replacement_asset_id.is_some() {
            return Err(Error::new("WISH_REPLACEMENT", "清除关系时不能同时选择物品"));
        }
        if let Some(asset_id) = &input.replacement_asset_id {
            uuid::Uuid::parse_str(asset_id).map_err(|_| Error::new("ID", "物品标识无效"))?;
            let live: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND deleted_at IS NULL)",
                [asset_id],
                |r| r.get(0),
            )?;
            let kept = old
                .as_ref()
                .and_then(|w| w.replacement_asset.as_ref())
                .is_some_and(|a| a.id == *asset_id);
            if !live && !kept {
                return Err(Error::new(
                    "WISH_REPLACEMENT",
                    "这件物品已删除或不存在，请重新选择",
                ));
            }
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let p = input.preferences.clone();
        // Only a wish still being considered keeps a reminder, and only with a
        // plan date; reconsidering never restores an old reminder (§3.5).
        let considering = old
            .as_ref()
            .map(|w| w.decision_state == "considering")
            .unwrap_or(true);
        let now = chrono::Utc::now().to_rfc3339();
        let f = &input.fields;
        if old.is_some() {
            tx.execute("UPDATE wishlist_items SET name=?2,category_id=?3,estimated_price_cents=?4,priority=?5,target_date=?6,external_link=?7,notes=?8,revision=revision+1,updated_at=?9 WHERE id=?1",params![id,f.name.trim(),f.category_id,cents(f.estimated_price_cents.as_deref())?,f.priority,f.target_date,f.external_link.trim(),f.notes,now])?;
        } else {
            tx.execute("INSERT INTO wishlist_items(id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,decision_state,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'ongoing','considering',1,?9,?9)",params![id,f.name.trim(),f.category_id,cents(f.estimated_price_cents.as_deref())?,f.priority,f.target_date,f.external_link.trim(),f.notes,now])?;
        }
        match &input.replacement_asset_id {
            Some(asset_id) => tx.execute(
                "UPDATE wishlist_items SET replacement_asset_id=?2,replacement_asset_name='' WHERE id=?1",
                params![id, asset_id],
            )?,
            None => tx.execute(
                "UPDATE wishlist_items SET replacement_asset_id=NULL,replacement_asset_name=CASE WHEN ?2 THEN '' ELSE replacement_asset_name END WHERE id=?1",
                params![id, input.clear_replacement],
            )?,
        };
        self.commit_wishlist_cover(&tx, &id, &input.photos)?;
        tx.execute("INSERT INTO wishlist_preferences VALUES(?1,?2) ON CONFLICT(wishlist_id) DO UPDATE SET payload=excluded.payload",params![id,serde_json::to_string(&p)?])?;
        tx.execute(
            "DELETE FROM reminders WHERE kind='wishlist' AND entity_id=?1",
            [&id],
        )?;
        if considering && p.reminder {
            let d = f
                .target_date
                .as_ref()
                .ok_or_else(|| Error::new("REMINDER", "到期通知需要计划日期"))?;
            tx.execute(
                "INSERT INTO reminders(id,kind,entity_id,source_id,date,notes) VALUES(?1,'wishlist',?2,NULL,?3,'')",
                params![format!("wish-{id}"), id, d],
            )?;
        }
        let result = crate::wishlist::read(&tx, &id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"))?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        tx.execute(
            "INSERT INTO feature_audit VALUES(?1,'wishlist',?2,?3,?4)",
            params![input.request_id, id, serde_json::to_string(&result)?, now],
        )?;
        self.hit("wish_plan.before_commit")?;
        tx.commit()?;
        self.hit("wish_plan.after_commit")?;
        Ok(result)
    }
    /// The savings write is retired. A request that already committed returns
    /// its saved result; anything else is refused with a clear message and no
    /// business side effect (A16, A17).
    pub fn save_wish_savings(&mut self, input: &Saving, _today: &str) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fp = digest(&serde_json::to_vec(&("wish_savings", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fp)? {
            return crate::wishlist::read(&tx, &id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到心愿"));
        }
        Err(Error::new(
            "WISH_SAVINGS_DISABLED",
            "心愿攒钱已停用：已攒金额保留为只读历史。如需记录实际购入，请使用「已买到，记录购入」。",
        ))
    }
}
impl Store {
    pub fn saved_wish_feature(
        &self,
        request: &str,
        generation: &str,
    ) -> Result<Option<WishlistItem>> {
        self.check_generation(generation)?;
        let id:Option<String>=self.conn()?.query_row("SELECT r.result FROM feature_requests r JOIN feature_audit a ON a.request_id=r.id WHERE r.id=?1 AND a.kind IN ('wishlist','savings')",[request],|r|r.get(0)).optional()?;
        id.map(|id| crate::wishlist::read(self.conn()?, &id))
            .transpose()
            .map(Option::flatten)
    }
}
