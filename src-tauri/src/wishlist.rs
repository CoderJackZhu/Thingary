use crate::{
    domain::{cents, date, Error, Result},
    photos::{Photo, Selection},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub name: String,
    pub category_id: Option<String>,
    pub estimated_price_cents: Option<String>,
    pub priority: Option<String>,
    pub target_date: Option<String>,
    pub external_link: String,
    pub notes: String,
}

impl Fields {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() || self.name.trim().chars().count() > 200 {
            return Err(Error::new("WISHLIST_NAME", "名称须为 1–200 字"));
        }
        cents(self.estimated_price_cents.as_deref())?;
        if let Some(value) = &self.priority {
            if !["high", "medium", "low"].contains(&value.as_str()) {
                return Err(Error::new("WISHLIST_PRIORITY", "请选择有效的优先级"));
            }
        }
        if let Some(value) = &self.target_date {
            date(value)?;
        }
        if self.external_link.chars().count() > 2048
            || self.external_link.contains('\0')
            || self.notes.chars().count() > 10000
            || self.notes.contains('\0')
        {
            return Err(Error::new(
                "WISHLIST_FIELDS",
                "链接最多 2048 字，备注最多 10000 字，且不能含空字符",
            ));
        }
        if !self.external_link.trim().is_empty()
            && !self.external_link.trim().starts_with("https://")
            && !self.external_link.trim().starts_with("http://")
        {
            return Err(Error::new(
                "WISHLIST_LINK",
                "链接须以 http:// 或 https:// 开头",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WishlistItem {
    pub id: String,
    pub fields: Fields,
    /// Compatibility projection of decision_state for old readers; the
    /// authority is decision_state (ongoing/achieved/abandoned).
    pub status: String,
    /// considering | purchased | dropped | legacy_achieved (§3.3, §3.6).
    #[serde(default = "default_decision")]
    pub decision_state: String,
    /// Note about the latest decision; never overwrites consideration reasons.
    #[serde(default)]
    pub decision_note: String,
    /// confirm_new | confirm_link | legacy_reuse | legacy_manual | legacy_conversion | legacy_auto.
    #[serde(default)]
    pub purchase_source: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub abandoned_at: Option<String>,
    pub achieved_at: Option<String>,
    pub converted_asset: Option<LinkedAsset>,
    /// Read-only historical auto-generation relation, never a confirmed purchase.
    #[serde(default)]
    pub legacy_generated_asset: Option<LinkedAsset>,
    #[serde(default)]
    pub legacy_generated_at: Option<String>,
    /// The item this wish is considering replacing (§7.1); a separate
    /// relation from the purchase link and never lifecycle-driving.
    #[serde(default)]
    pub replacement_asset: Option<LinkedAsset>,
    /// Display name kept after the replacement item was permanently deleted.
    #[serde(default)]
    pub replacement_asset_name: String,
    pub cover: Option<Photo>,
    #[serde(default)]
    pub photos: Vec<Photo>,
    #[serde(default)]
    pub preferences: crate::wish_plan::Preferences,
    /// In Recently Deleted: hidden everywhere and closed to changes (D17).
    #[serde(default)]
    pub deleted: bool,
}

pub(crate) fn default_decision() -> String {
    "considering".into()
}

pub(crate) fn status_of(decision: &str) -> &'static str {
    match decision {
        "purchased" | "legacy_achieved" => "achieved",
        "dropped" => "abandoned",
        _ => "ongoing",
    }
}

pub(crate) fn valid_decision(decision: &str) -> bool {
    ["considering", "purchased", "dropped", "legacy_achieved"].contains(&decision)
}

pub(crate) fn validate_decision_note(note: &str) -> Result<()> {
    if note.chars().count() > 10000 || note.contains('\0') {
        return Err(Error::new(
            "WISH_DECISION_NOTE",
            "决定备注最多 10000 字，且不能含空字符",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LinkedAsset {
    pub id: String,
    pub name: String,
    pub deleted: bool,
}

/// The wish an asset was converted from, shown on the asset detail. `legacy`
/// marks the old auto-generation relation, displayed as 旧版由此心愿自动生成.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Origin {
    pub id: String,
    pub name: String,
    pub estimated_price_cents: Option<String>,
    pub created_at: String,
    pub achieved_at: Option<String>,
    #[serde(default)]
    pub legacy: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Convert {
    pub wishlist_id: String,
    pub expected_revision: i64,
    pub asset: crate::catalog::SaveAsset,
}

/// 关联已有物品为本次购入（§3.4）：不修改该物品的任何资料。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    pub request_id: String,
    pub generation: String,
    pub wishlist_id: String,
    pub expected_revision: i64,
    pub asset_id: String,
    /// Concurrency guard only; the asset itself is never modified.
    pub expected_asset_revision: i64,
}

/// 历史待核实记录的三种核实（§3.6）。补录价格／日期仅作用于原物品。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verify {
    pub request_id: String,
    pub generation: String,
    pub wishlist_id: String,
    pub expected_revision: i64,
    /// purchased | considering | dropped
    pub outcome: String,
    #[serde(default)]
    pub decision_note: String,
    /// 可选：更正原物品的实际价格／购入日期（purchased 时）。
    #[serde(default)]
    pub asset_patch: Option<AssetPatch>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetPatch {
    pub asset_id: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub price_cents: Option<String>,
    #[serde(default)]
    pub purchase_date: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Add {
        fields: Fields,
        cover: Selection,
    },
    Abandon {
        wishlist_id: String,
    },
    /// 不再考虑：可选决定备注，档案与图片保留。
    Drop {
        wishlist_id: String,
        #[serde(default)]
        decision_note: String,
    },
    /// 重新考虑：回到考虑中；保留并允许更正上一次决定备注，不恢复旧提醒。
    Reconsider {
        wishlist_id: String,
        #[serde(default)]
        decision_note: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: Option<i64>,
    pub action: Action,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub search: String,
    pub filter: String,
    pub sort: String,
    pub descending: bool,
    pub offset: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Page {
    pub generation: String,
    pub items: Vec<WishlistItem>,
    pub total: i64,
    pub considering_known_cents: String,
    pub considering_unknown_count: i64,
    pub legacy_achieved_count: i64,
}

#[derive(Serialize, Deserialize)]
struct Receipt {
    wishlist_id: String,
}

pub(crate) fn read(c: &Connection, id: &str) -> Result<Option<WishlistItem>> {
    let row = c
        .query_row(
            "SELECT id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,decision_state,decision_note,purchase_source,revision,created_at,updated_at,abandoned_at,achieved_at,legacy_generated_at,replacement_asset_name,deleted_at IS NOT NULL FROM wishlist_items WHERE id=?1",
            [id],
            |r| {
                let decision: String = r.get(8)?;
                Ok(WishlistItem {
                    id: r.get(0)?,
                    fields: Fields {
                        name: r.get(1)?,
                        category_id: r.get(2)?,
                        estimated_price_cents: r.get::<_, Option<i64>>(3)?.map(|n| n.to_string()),
                        priority: r.get(4)?,
                        target_date: r.get(5)?,
                        external_link: r.get(6)?,
                        notes: r.get(7)?,
                    },
                    status: status_of(&decision).into(),
                    decision_state: decision,
                    decision_note: r.get(9)?,
                    purchase_source: r.get(10)?,
                    revision: r.get(11)?,
                    created_at: r.get(12)?,
                    updated_at: r.get(13)?,
                    abandoned_at: r.get(14)?,
                    achieved_at: r.get(15)?,
                    converted_asset: None,
                    legacy_generated_asset: None,
                    legacy_generated_at: r.get(16)?,
                    replacement_asset: None,
                    replacement_asset_name: r.get(17)?,
                    cover: None,
                    photos: vec![],
                    preferences: Default::default(),
                    deleted: r.get(18)?,
                })
            },
        )
        .optional()?;
    row.map(|mut item| {
        item.converted_asset = c
            .query_row(
                "SELECT a.id,a.name,a.deleted_at IS NOT NULL FROM wishlist_items w JOIN assets a ON a.id=w.converted_asset_id WHERE w.id=?1",
                [&item.id],
                |r| Ok(LinkedAsset { id: r.get(0)?, name: r.get(1)?, deleted: r.get(2)? }),
            )
            .optional()?;
        item.legacy_generated_asset = c
            .query_row(
                "SELECT a.id,a.name,a.deleted_at IS NOT NULL FROM wishlist_items w JOIN assets a ON a.id=w.legacy_generated_asset_id WHERE w.id=?1",
                [&item.id],
                |r| Ok(LinkedAsset { id: r.get(0)?, name: r.get(1)?, deleted: r.get(2)? }),
            )
            .optional()?;
        item.replacement_asset = c
            .query_row(
                "SELECT a.id,a.name,a.deleted_at IS NOT NULL FROM wishlist_items w JOIN assets a ON a.id=w.replacement_asset_id WHERE w.id=?1",
                [&item.id],
                |r| Ok(LinkedAsset { id: r.get(0)?, name: r.get(1)?, deleted: r.get(2)? }),
            )
            .optional()?;
        item.cover = c
            .query_row(
                "SELECT a.id,a.name FROM wishlist_media m JOIN wishlist_attachments a ON a.id=m.cover_id WHERE m.wishlist_id=?1",
                [&item.id],
                |r| Ok(Photo { id: r.get(0)?, name: r.get(1)? }),
            )
            .optional()?;
        item.preferences = crate::wish_plan::read(c, &item.id)?;
        item.photos = c.prepare("SELECT id,name FROM wishlist_attachments WHERE wishlist_id=?1 ORDER BY position,id")?.query_map([&item.id],|r|Ok(Photo{id:r.get(0)?,name:r.get(1)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(item)
    })
    .transpose()
}

/// One live wish row for a decision transition; errors when missing or deleted.
fn live_wish(tx: &Transaction<'_>, id: &str) -> Result<WishlistItem> {
    let wish = read(tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
    if wish.deleted {
        return Err(Error::new("NOT_FOUND", "这条心愿在最近删除中，请先恢复"));
    }
    Ok(wish)
}

/// Marks the wish purchased and links the asset inside the caller's
/// transaction. Callers own receipts and commit; the compatibility status
/// projection follows decision_state.
fn mark_purchased(
    tx: &Transaction<'_>,
    wish_id: &str,
    expected_revision: i64,
    asset_id: &str,
    purchase_source: &str,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let changed = tx.execute(
        "UPDATE wishlist_items SET decision_state='purchased',status='achieved',converted_asset_id=?1,purchase_source=?2,achieved_at=coalesce(achieved_at,?3),revision=revision+1,updated_at=?3 WHERE id=?4 AND revision=?5 AND deleted_at IS NULL AND decision_state IN ('considering','legacy_achieved') AND converted_asset_id IS NULL",
        params![asset_id, purchase_source, now, wish_id, expected_revision],
    )?;
    if changed != 1 {
        return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
    }
    Ok(())
}

/// Cancels a wish's unsent reminders once it stops being considered; the
/// reconsider path never re-creates them automatically (§3.5).
fn drop_reminders(tx: &Transaction<'_>, wish_id: &str) -> Result<()> {
    tx.execute(
        "DELETE FROM reminders WHERE kind='wishlist' AND entity_id=?1",
        [wish_id],
    )?;
    Ok(())
}

impl Store {
    pub fn wishlist_item(&self, id: &str) -> Result<Option<WishlistItem>> {
        read(self.conn()?, id)
    }

    pub fn saved_wishlist_request(&self, input: &Change) -> Result<Option<WishlistItem>> {
        self.check_generation(&input.generation)?;
        let fingerprint = digest(&serde_json::to_vec(&("wishlist", input))?);
        let connection = self.conn()?;
        let saved: Option<(String, String)> = connection
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((prior, value)) = saved else {
            return Ok(None);
        };
        if prior != fingerprint {
            return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
        }
        let receipt: Receipt = serde_json::from_str(&value)?;
        let action = match &input.action {
            Action::Add { .. } => "add",
            Action::Abandon { .. } => "abandon",
            Action::Drop { .. } => "drop",
            Action::Reconsider { .. } => "reconsider",
        };
        let audited: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM wishlist_audit WHERE request_id=?1 AND wishlist_id=?2 AND action=?3)",
            params![input.request_id, receipt.wishlist_id, action],
            |r| r.get(0),
        )?;
        if !audited {
            return Ok(None);
        }
        read(connection, &receipt.wishlist_id)
    }

    pub fn change_wishlist(&mut self, input: &Change) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wishlist", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some((prior, result)) = tx
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if prior != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            let receipt: Receipt = serde_json::from_str(&result)?;
            return read(&tx, &receipt.wishlist_id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        let (id, action) = match &input.action {
            Action::Add { fields, cover } => {
                if input.expected_revision.is_some() {
                    return Err(Error::new("REVISION", "新心愿不能带已有版本"));
                }
                fields.validate()?;
                if let Some(category_id) = &fields.category_id {
                    let exists: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
                        [category_id],
                        |r| r.get(0),
                    )?;
                    if !exists {
                        return Err(Error::new("TAXONOMY_STALE", "分类已不可用，请重新选择"));
                    }
                }
                let id = uid();
                tx.execute(
                    "INSERT INTO wishlist_items(id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,decision_state,revision,created_at,updated_at,abandoned_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'ongoing','considering',1,?9,?9,NULL)",
                    params![id, fields.name.trim(), fields.category_id, cents(fields.estimated_price_cents.as_deref())?, fields.priority, fields.target_date, fields.external_link.trim(), fields.notes, now],
                )?;
                self.commit_wishlist_cover(&tx, &id, cover)?;
                (id, "add")
            }
            Action::Abandon { wishlist_id } | Action::Drop { wishlist_id, .. } => {
                let note = match &input.action {
                    Action::Drop { decision_note, .. } => {
                        validate_decision_note(decision_note)?;
                        decision_note
                    }
                    _ => "",
                };
                uuid::Uuid::parse_str(wishlist_id).map_err(|_| Error::new("ID", "心愿标识无效"))?;
                let expected = input
                    .expected_revision
                    .filter(|r| *r > 0)
                    .ok_or_else(|| Error::new("REVISION", "版本标识无效"))?;
                let wish = live_wish(&tx, wishlist_id)?;
                if wish.revision != expected {
                    return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
                }
                if wish.decision_state != "considering" {
                    return Err(Error::new(
                        "WISHLIST_STATUS",
                        "只有考虑中的心愿可以不再考虑",
                    ));
                }
                drop_reminders(&tx, wishlist_id)?;
                tx.execute(
                    "UPDATE wishlist_items SET decision_state='dropped',status='abandoned',decision_note=?1,revision=revision+1,updated_at=?2,abandoned_at=?2 WHERE id=?3 AND revision=?4 AND decision_state='considering'",
                    params![note, now, wishlist_id, expected],
                )?;
                (
                    wishlist_id.clone(),
                    match &input.action {
                        Action::Drop { .. } => "drop",
                        _ => "abandon",
                    },
                )
            }
            Action::Reconsider {
                wishlist_id,
                decision_note,
            } => {
                validate_decision_note(decision_note)?;
                uuid::Uuid::parse_str(wishlist_id).map_err(|_| Error::new("ID", "心愿标识无效"))?;
                let expected = input
                    .expected_revision
                    .filter(|r| *r > 0)
                    .ok_or_else(|| Error::new("REVISION", "版本标识无效"))?;
                let wish = live_wish(&tx, wishlist_id)?;
                if wish.revision != expected {
                    return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
                }
                if wish.decision_state != "dropped" {
                    return Err(Error::new(
                        "WISHLIST_STATUS",
                        "只有不再考虑的心愿可以重新考虑",
                    ));
                }
                tx.execute(
                    "UPDATE wishlist_items SET decision_state='considering',status='ongoing',decision_note=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND revision=?4 AND decision_state='dropped'",
                    params![decision_note, now, wishlist_id, expected],
                )?;
                (wishlist_id.clone(), "reconsider")
            }
        };
        let result = read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
        tx.execute(
            "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![input.request_id, id, action, serde_json::to_string(&result)?, now],
        )?;
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&Receipt {
                    wishlist_id: id.clone()
                })?
            ],
        )?;
        self.hit("wishlist.before_commit")?;
        tx.commit()?;
        self.hit("wishlist.after_commit")?;
        self.wishlist_item(&id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))
    }

    /// Records an explicit purchase: creates the asset, marks the wish
    /// Purchased and stores both receipts in one transaction (§3.4). The
    /// receipt is the asset JSON, so `saved_request` resolves a lost reply
    /// exactly like an ordinary asset save.
    pub fn convert_wishlist(
        &mut self,
        input: &Convert,
        today: &str,
    ) -> Result<crate::catalog::AssetRecord> {
        let base = &input.asset.base;
        self.check_generation(&base.generation)?;
        if base.asset_id.is_some() || base.expected_revision.is_some() {
            return Err(Error::new(
                "REVISION",
                "购入确认只能新建物品；已有物品请使用关联",
            ));
        }
        uuid::Uuid::parse_str(&input.wishlist_id).map_err(|_| Error::new("ID", "心愿标识无效"))?;
        base.validate(today)?;
        input.asset.details.validate()?;
        let fingerprint = digest(&serde_json::to_vec(&("wishlist_convert", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some((prior, result)) = tx
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&base.request_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if prior != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            drop(tx);
            let asset: crate::domain::Asset = serde_json::from_str(&result)?;
            return self
                .record_at(&asset.id, today)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"));
        }
        let wish = live_wish(&tx, &input.wishlist_id)?;
        if wish.converted_asset.is_some() {
            return Err(Error::new(
                "WISHLIST_ACHIEVED",
                "这条心愿已记录购入物品，不能再次转换",
            ));
        }
        if !["considering", "legacy_achieved"].contains(&wish.decision_state.as_str()) {
            return Err(Error::new(
                "WISHLIST_STATUS",
                "这条心愿不在可记录购入的状态",
            ));
        }
        if wish.revision != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        let asset = self.write_asset(
            &tx,
            base,
            Some(&input.asset.details),
            input.asset.photos.as_ref(),
            input.asset.classification.as_ref(),
        )?;
        if let Some(options) = &input.asset.options {
            self.write_asset_options(&tx, &asset.id, base, options, today)?;
        }
        mark_purchased(
            &tx,
            &input.wishlist_id,
            input.expected_revision,
            &asset.id,
            "confirm_new",
        )?;
        drop_reminders(&tx, &input.wishlist_id)?;
        let wish = read(&tx, &input.wishlist_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
        tx.execute(
            "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at) VALUES(?1,?2,'convert',?3,?4)",
            params![base.request_id, input.wishlist_id, serde_json::to_string(&wish)?, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![base.request_id, fingerprint, serde_json::to_string(&asset)?],
        )?;
        self.hit("convert.before_commit")?;
        tx.commit()?;
        self.hit("convert.after_commit")?;
        self.record_at(&asset.id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }

    /// Links an existing asset as this wish's confirmed purchase (§3.4). The
    /// asset's price, dates, state and notes are never modified here.
    pub fn link_wish_asset(&mut self, input: &Link) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        uuid::Uuid::parse_str(&input.wishlist_id).map_err(|_| Error::new("ID", "心愿标识无效"))?;
        uuid::Uuid::parse_str(&input.asset_id).map_err(|_| Error::new("ID", "物品标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wish_link", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = crate::wish_plan::receipt(&tx, &input.request_id, &fingerprint)? {
            return read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"));
        }
        let wish = live_wish(&tx, &input.wishlist_id)?;
        if wish.revision != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        if wish.converted_asset.is_some() {
            return Err(Error::new("WISHLIST_ACHIEVED", "这条心愿已记录购入物品"));
        }
        if !["considering", "legacy_achieved"].contains(&wish.decision_state.as_str()) {
            return Err(Error::new(
                "WISHLIST_STATUS",
                "这条心愿不在可记录购入的状态",
            ));
        }
        let asset: Option<(String, i64, Option<String>)> = tx
            .query_row(
                "SELECT name,revision,deleted_at FROM assets WHERE id=?1",
                [&input.asset_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((_, revision, deleted_at)) = asset else {
            return Err(Error::new("NOT_FOUND", "找不到这件物品"));
        };
        if deleted_at.is_some() {
            return Err(Error::new(
                "WISH_LINK_ASSET",
                "这件物品在最近删除中；如需关联请先恢复它",
            ));
        }
        if revision != input.expected_asset_revision {
            return Err(Error::new("REVISION_CONFLICT", "物品已变化，请重新选择"));
        }
        let owner: Option<String> = tx
            .query_row(
                "SELECT id FROM wishlist_items WHERE converted_asset_id=?1 AND deleted_at IS NULL AND id!=?2",
                params![input.asset_id, input.wishlist_id],
                |r| r.get(0),
            )
            .optional()?;
        if owner.is_some() {
            return Err(Error::new(
                "WISH_LINK_ASSET",
                "这件物品已关联其他心愿的购入",
            ));
        }
        // Reusing this wish's own legacy archive is an explicit confirmation,
        // not a silent re-label of the historical relation.
        let source = if wish
            .legacy_generated_asset
            .as_ref()
            .is_some_and(|a| a.id == input.asset_id)
        {
            "legacy_reuse"
        } else {
            "confirm_link"
        };
        mark_purchased(
            &tx,
            &input.wishlist_id,
            input.expected_revision,
            &input.asset_id,
            source,
        )?;
        drop_reminders(&tx, &input.wishlist_id)?;
        let result = read(&tx, &input.wishlist_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.wishlist_id],
        )?;
        tx.execute(
            "INSERT INTO feature_audit VALUES(?1,'wishlist',?2,?3,?4)",
            params![
                input.request_id,
                input.wishlist_id,
                serde_json::to_string(&result)?,
                now
            ],
        )?;
        tx.execute(
            "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at) VALUES(?1,?2,'link',?3,?4)",
            params![input.request_id, input.wishlist_id, serde_json::to_string(&result)?, now],
        )?;
        self.hit("wish_plan.before_commit")?;
        tx.commit()?;
        self.hit("wish_plan.after_commit")?;
        Ok(result)
    }

    /// Verifies a legacy auto-achieved wish (§3.6). Never deletes or regenerates
    /// the old asset; the historical relation stays readable.
    pub fn verify_legacy_wish(&mut self, input: &Verify, today: &str) -> Result<WishlistItem> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        uuid::Uuid::parse_str(&input.wishlist_id).map_err(|_| Error::new("ID", "心愿标识无效"))?;
        validate_decision_note(&input.decision_note)?;
        if !["purchased", "considering", "dropped"].contains(&input.outcome.as_str()) {
            return Err(Error::new("WISH_VERIFY", "不支持的核实结果"));
        }
        let fingerprint = digest(&serde_json::to_vec(&("wish_verify", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = crate::wish_plan::receipt(&tx, &input.request_id, &fingerprint)? {
            return read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"));
        }
        let wish = live_wish(&tx, &input.wishlist_id)?;
        if wish.revision != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        if wish.decision_state != "legacy_achieved" {
            return Err(Error::new("WISH_VERIFY", "只有历史待核实的心愿需要核实"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        match input.outcome.as_str() {
            "purchased" => {
                let Some(legacy) = wish.legacy_generated_asset.as_ref() else {
                    return Err(Error::new(
                        "WISH_VERIFY",
                        "这条心愿没有原关联物品；请使用记录购入或关联已有物品",
                    ));
                };
                if let Some(patch) = &input.asset_patch {
                    if patch.asset_id != legacy.id {
                        return Err(Error::new("WISH_VERIFY", "只能更正原关联物品本身"));
                    }
                    let revision: i64 = tx.query_row(
                        "SELECT revision FROM assets WHERE id=?1",
                        [&legacy.id],
                        |r| r.get(0),
                    )?;
                    if revision != patch.expected_revision {
                        return Err(Error::new("REVISION_CONFLICT", "物品已变化，请重新读取"));
                    }
                    if let Some(day) = patch.purchase_date.as_deref() {
                        date(day)?;
                        if day > today {
                            return Err(Error::new("WISH_DATE", "购入日期不能晚于今天"));
                        }
                        crate::lifecycle::validate_purchase_date(&tx, &legacy.id, Some(day))?;
                        crate::sales::validate_purchase_date(&tx, &legacy.id, Some(day))?;
                        crate::maintenance::validate_purchase_date(&tx, &legacy.id, Some(day))?;
                    }
                    if patch.price_cents.is_some() || patch.purchase_date.is_some() {
                        tx.execute(
                            "UPDATE assets SET price_cents=coalesce(?2,price_cents),purchase_date=coalesce(?3,purchase_date),revision=revision+1 WHERE id=?1 AND revision=?4",
                            params![legacy.id, cents(patch.price_cents.as_deref())?, patch.purchase_date.clone(), patch.expected_revision],
                        )?;
                    }
                }
                // A soft-deleted original comes back explicitly with this
                // confirmation, never silently.
                tx.execute(
                    "UPDATE assets SET deleted_at=NULL,revision=revision+1 WHERE id=?1 AND deleted_at IS NOT NULL",
                    [&legacy.id],
                )?;
                mark_purchased(
                    &tx,
                    &input.wishlist_id,
                    input.expected_revision,
                    &legacy.id,
                    "legacy_reuse",
                )?;
                drop_reminders(&tx, &input.wishlist_id)?;
            }
            "considering" => {
                // The old auto-generated asset stays as-is; the achievement
                // date is preserved in the historical relation, never faked.
                let changed = tx.execute(
                    "UPDATE wishlist_items SET decision_state='considering',status='ongoing',achieved_at=NULL,legacy_generated_at=coalesce(legacy_generated_at,?2),revision=revision+1,updated_at=?3 WHERE id=?1 AND revision=?4 AND decision_state='legacy_achieved'",
                    params![input.wishlist_id, wish.achieved_at.clone(), now, input.expected_revision],
                )?;
                if changed != 1 {
                    return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
                }
            }
            "dropped" => {
                drop_reminders(&tx, &input.wishlist_id)?;
                let changed = tx.execute(
                    "UPDATE wishlist_items SET decision_state='dropped',status='abandoned',achieved_at=NULL,decision_note=?2,abandoned_at=?3,legacy_generated_at=coalesce(legacy_generated_at,?5),revision=revision+1,updated_at=?3 WHERE id=?1 AND revision=?4 AND decision_state='legacy_achieved'",
                    params![input.wishlist_id, input.decision_note, now, input.expected_revision, wish.achieved_at.clone()],
                )?;
                if changed != 1 {
                    return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
                }
            }
            _ => unreachable!("outcome validated above"),
        }
        let result = read(&tx, &input.wishlist_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
        let action = match input.outcome.as_str() {
            "purchased" => "verify_purchased",
            "considering" => "verify_considering",
            _ => "verify_dropped",
        };
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.wishlist_id],
        )?;
        tx.execute(
            "INSERT INTO feature_audit VALUES(?1,'wishlist',?2,?3,?4)",
            params![
                input.request_id,
                input.wishlist_id,
                serde_json::to_string(&result)?,
                now
            ],
        )?;
        tx.execute(
            "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![input.request_id, input.wishlist_id, action, serde_json::to_string(&result)?, now],
        )?;
        self.hit("wish_plan.before_commit")?;
        tx.commit()?;
        self.hit("wish_plan.after_commit")?;
        Ok(result)
    }

    /// Stages the wish cover as a fresh draft photo for the conversion form, so
    /// the asset gets its own attachment through the normal photo commit.
    pub fn stage_wishlist_cover(&self, wishlist_id: &str, generation: &str) -> Result<Photo> {
        self.check_generation(generation)?;
        let (name, hash): (String, String) = self
            .conn()?
            .query_row(
                "SELECT a.name,a.hash FROM wishlist_media m JOIN wishlist_attachments a ON a.id=m.cover_id WHERE m.wishlist_id=?1",
                [wishlist_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| Error::new("NOT_FOUND", "这条心愿没有封面"))?;
        let bytes = self.original(&hash)?;
        self.stage_photo(&name, &bytes, generation, None)
    }

    pub(crate) fn wishlist_origin(&self, asset_id: &str) -> Result<Option<Origin>> {
        let linked = |column: &str, legacy: bool| -> Result<Option<Origin>> {
            Ok(self
                .conn()?
                .query_row(
                    &format!("SELECT id,name,estimated_price_cents,created_at,achieved_at FROM wishlist_items WHERE {column}=?1 AND deleted_at IS NULL"),
                    [asset_id],
                    |r| {
                        Ok(Origin {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            estimated_price_cents: r.get::<_, Option<i64>>(2)?.map(|n| n.to_string()),
                            created_at: r.get(3)?,
                            achieved_at: r.get(4)?,
                            legacy,
                        })
                    },
                )
                .optional()?)
        };
        // A confirmed purchase always wins over the historical relation.
        Ok(linked("converted_asset_id", false)?.or(linked("legacy_generated_asset_id", true)?))
    }

    pub fn query_wishlist(&self, q: &Query) -> Result<Page> {
        if q.search.chars().count() > 200 {
            return Err(Error::new("SEARCH", "搜索内容最多 200 字"));
        }
        let filter = match q.filter.as_str() {
            "all" | "considering" | "purchased" | "dropped" => q.filter.as_str(),
            _ => return Err(Error::new("QUERY", "不支持的心愿筛选")),
        };
        let direction = if q.descending { "DESC" } else { "ASC" };
        let order = match q.sort.as_str() {
            "name" => format!("w.name COLLATE NOCASE {direction}"),
            "created" => format!("coalesce((SELECT json_extract(payload,'$.added_date') FROM wishlist_preferences WHERE wishlist_id=w.id),substr(w.created_at,1,10)) {direction}"),
            "priority" => format!("w.priority IS NULL ASC,CASE w.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END {direction}"),
            "price" => format!("w.estimated_price_cents IS NULL ASC,w.estimated_price_cents {direction}"),
            "target" => format!("w.target_date IS NULL ASC,w.target_date {direction}"),
            _ => return Err(Error::new("QUERY", "不支持的心愿排序")),
        };
        // Legacy records pending verification surface under 全部 and 考虑中 with
        // their own marker; they never count as confirmed purchases or plans.
        let from = "FROM wishlist_items w LEFT JOIN categories c ON c.id=w.category_id WHERE w.deleted_at IS NULL AND (w.decision_state=?1 OR (?1='all' AND w.decision_state IN ('considering','purchased','dropped','legacy_achieved')) OR (?1='considering' AND w.decision_state='legacy_achieved')) AND instr(lower(w.name || ' ' || w.external_link || ' ' || w.notes || ' ' || coalesce(c.name,'')),lower(?2))>0";
        let total = self.conn()?.query_row(
            &format!("SELECT count(*) {from}"),
            params![filter, q.search.trim()],
            |r| r.get(0),
        )?;
        let mut stmt = self.conn()?.prepare(&format!(
            "SELECT w.id {from} ORDER BY coalesce((SELECT json_extract(payload,'$.pinned') FROM wishlist_preferences WHERE wishlist_id=w.id),0) DESC,{order},w.created_at DESC,w.id ASC LIMIT 100 OFFSET ?3"
        ))?;
        let ids = stmt
            .query_map(params![filter, q.search.trim(), q.offset], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let items = ids
            .into_iter()
            .map(|id| read(self.conn()?, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "心愿不存在")))
            .collect::<Result<Vec<_>>>()?;
        let (known, unknown): (i64, i64) = self.conn()?.query_row(
            "SELECT coalesce(sum(estimated_price_cents),0),coalesce(sum(estimated_price_cents IS NULL),0) FROM wishlist_items WHERE decision_state='considering' AND deleted_at IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let legacy: i64 = self.conn()?.query_row(
            "SELECT count(*) FROM wishlist_items WHERE decision_state='legacy_achieved' AND deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(Page {
            generation: self.generation(),
            items,
            total,
            considering_known_cents: known.to_string(),
            considering_unknown_count: unknown,
            legacy_achieved_count: legacy,
        })
    }
}

pub(crate) fn validate_dataset(c: &Connection, version: i64) -> Result<()> {
    // Backups are inspected before migration, so the read matches the shape of
    // the version being checked; decision columns exist only from schema 27
    // and the replacement relation only from schema 28.
    let mut stmt = c.prepare(if version >= 27 {
        "SELECT id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,decision_state,decision_note,revision,created_at,updated_at,abandoned_at FROM wishlist_items"
    } else {
        "SELECT id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,'' AS decision_state,'' AS decision_note,revision,created_at,updated_at,abandoned_at FROM wishlist_items"
    })?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            Fields {
                name: r.get(1)?,
                category_id: r.get(2)?,
                estimated_price_cents: r.get::<_, Option<i64>>(3)?.map(|n| n.to_string()),
                priority: r.get(4)?,
                target_date: r.get(5)?,
                external_link: r.get(6)?,
                notes: r.get(7)?,
            },
            r.get::<_, String>(8)?,
            r.get::<_, String>(9)?,
            r.get::<_, i64>(10)?,
            r.get::<_, String>(11)?,
            r.get::<_, String>(12)?,
            r.get::<_, Option<String>>(13)?,
        ))
    })?;
    for row in rows {
        let (id, fields, decision, note, revision, created, updated, abandoned) = row?;
        uuid::Uuid::parse_str(&id).map_err(|_| Error::new("WISHLIST", "心愿标识无效"))?;
        fields.validate()?;
        if version >= 27 {
            validate_decision_note(&note)?;
            if !valid_decision(&decision) || revision < 1 {
                return Err(Error::new("WISHLIST", "心愿状态或版本无效"));
            }
        } else if revision < 1 {
            return Err(Error::new("WISHLIST", "心愿状态或版本无效"));
        }
        for value in [Some(created), Some(updated), abandoned]
            .into_iter()
            .flatten()
        {
            chrono::DateTime::parse_from_rfc3339(&value)
                .map_err(|_| Error::new("WISHLIST", "心愿时间无效"))?;
        }
    }
    let invalid: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM wishlist_media m WHERE m.cover_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wishlist_attachments a WHERE a.id=m.cover_id AND a.wishlist_id=m.wishlist_id)) OR EXISTS(SELECT 1 FROM wishlist_attachments w JOIN attachments a ON a.id=w.id)", [], |r| r.get(0))?;
    if invalid {
        return Err(Error::new(
            "REFERENCE",
            "心愿封面归属错误或与物品附件共用标识",
        ));
    }
    let achieved: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM wishlist_items WHERE status='achieved')",
        [],
        |r| r.get(0),
    )?;
    if version < 12 {
        // Schema 11 had no conversion link, so an Achieved row cannot be traced.
        return if achieved {
            Err(Error::new("WISHLIST", "旧备份含无法追溯的已实现心愿"))
        } else {
            Ok(())
        };
    }
    if version >= 27 {
        let bad_state: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM wishlist_items WHERE status!=CASE decision_state WHEN 'purchased' THEN 'achieved' WHEN 'legacy_achieved' THEN 'achieved' WHEN 'dropped' THEN 'abandoned' ELSE 'ongoing' END OR (decision_state='purchased' AND (converted_asset_id IS NULL OR achieved_at IS NULL)) OR (decision_state IN ('considering','dropped') AND (converted_asset_id IS NOT NULL OR achieved_at IS NOT NULL)))",
            [],
            |r| r.get(0),
        )?;
        if bad_state {
            return Err(Error::new("WISHLIST", "心愿决策状态与关联物品不一致"));
        }
    }
    if version >= 28 {
        // A live relation must reference a real item; a cleared one may keep
        // only its display name. The purchase link and the replacement
        // relation are separate columns by construction.
        let bad_relation: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM wishlist_items w WHERE w.replacement_asset_id IS NOT NULL AND (w.replacement_asset_name!='' OR NOT EXISTS(SELECT 1 FROM assets a WHERE a.id=w.replacement_asset_id)))",
            [],
            |r| r.get(0),
        )?;
        if bad_relation {
            return Err(Error::new("WISHLIST", "待替换物品关系无效"));
        }
    }
    let mut stmt = c.prepare("SELECT status,converted_asset_id,achieved_at FROM wishlist_items")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (status, asset, achieved_at) = row?;
        match (status.as_str(), asset, achieved_at) {
            ("achieved", asset, Some(at)) if asset.is_some() || version >= 13 => {
                chrono::DateTime::parse_from_rfc3339(&at)
                    .map_err(|_| Error::new("WISHLIST", "心愿实现时间无效"))?;
            }
            ("ongoing" | "abandoned", None, None) => {}
            _ => return Err(Error::new("WISHLIST", "心愿实现状态与关联物品不一致")),
        }
    }
    Ok(())
}
