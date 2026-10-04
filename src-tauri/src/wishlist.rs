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
    pub status: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub abandoned_at: Option<String>,
    pub achieved_at: Option<String>,
    pub converted_asset: Option<LinkedAsset>,
    pub cover: Option<Photo>,
    #[serde(default)]
    pub photos: Vec<Photo>,
    #[serde(default)]
    pub preferences: crate::wish_plan::Preferences,
    /// In Recently Deleted: hidden everywhere and closed to changes (D17).
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LinkedAsset {
    pub id: String,
    pub name: String,
    pub deleted: bool,
}

/// The wish an asset was converted from, shown on the asset detail.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Origin {
    pub id: String,
    pub name: String,
    pub estimated_price_cents: Option<String>,
    pub created_at: String,
    pub achieved_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Convert {
    pub wishlist_id: String,
    pub expected_revision: i64,
    pub asset: crate::catalog::SaveAsset,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Add { fields: Fields, cover: Selection },
    Abandon { wishlist_id: String },
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
    pub ongoing_known_cents: String,
    pub ongoing_unknown_count: i64,
}

#[derive(Serialize, Deserialize)]
struct Receipt {
    wishlist_id: String,
}

pub(crate) fn read(c: &Connection, id: &str) -> Result<Option<WishlistItem>> {
    let row = c
        .query_row(
            "SELECT id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,revision,created_at,updated_at,abandoned_at,achieved_at,deleted_at IS NOT NULL FROM wishlist_items WHERE id=?1",
            [id],
            |r| {
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
                    status: r.get(8)?,
                    revision: r.get(9)?,
                    created_at: r.get(10)?,
                    updated_at: r.get(11)?,
                    abandoned_at: r.get(12)?,
                    achieved_at: r.get(13)?,
                    converted_asset: None,
                    cover: None,
                    photos: vec![],
                    preferences: Default::default(),
                    deleted: r.get(14)?,
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

/// A fulfilled wish owns one asset. The estimate remains on the wish; the asset's
/// actual purchase price is unknown until the user records it separately.
pub(crate) fn link_achieved_asset(tx: &Transaction<'_>, wish_id: &str) -> Result<Option<String>> {
    let wish = read(tx, wish_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
    if wish.status != "achieved" || wish.converted_asset.is_some() || wish.deleted {
        return Ok(None);
    }
    let asset_id = uid();
    let achieved_day = wish
        .achieved_at
        .as_deref()
        .and_then(|value| value.get(..10))
        .filter(|value| date(value).is_ok());
    tx.execute(
        "INSERT INTO assets(id,name,price_cents,purchase_date,revision,category_id,channel_id) VALUES(?1,?2,NULL,?3,1,?4,?5)",
        params![asset_id, wish.fields.name.trim(), achieved_day, wish.fields.category_id, wish.preferences.channel_id],
    )?;
    let note = match wish.preferences.achievement_source.as_deref() {
        Some("manual") => "手动实现心愿",
        Some("savings") => "攒钱实现心愿",
        _ => "实现心愿",
    };
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO asset_profiles(asset_id,brand,model,serial_number,notes,created_at,updated_at) VALUES(?1,'','','',?2,?3,?3)",
        params![asset_id, note, now],
    )?;
    let mut stmt = tx.prepare("SELECT id,file,hash,size,name,position FROM wishlist_attachments WHERE wishlist_id=?1 ORDER BY position,id")?;
    let photos = stmt
        .query_map([wish_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    let mut cover_id = None;
    for (old_id, file, hash, size, name, position) in photos {
        let photo_id = uid();
        tx.execute(
            "INSERT INTO attachments(id,asset_id,file,hash,size) VALUES(?1,?2,?3,?4,?5)",
            params![photo_id, asset_id, file, hash, size],
        )?;
        tx.execute(
            "INSERT INTO asset_photos(asset_id,attachment_id,position,name) VALUES(?1,?2,?3,?4)",
            params![asset_id, photo_id, position, name],
        )?;
        if wish.cover.as_ref().is_some_and(|cover| cover.id == old_id) {
            cover_id = Some(photo_id);
        }
    }
    tx.execute(
        "INSERT INTO asset_media(asset_id,cover_id) VALUES(?1,?2)",
        params![asset_id, cover_id],
    )?;
    let changed = tx.execute(
        "UPDATE wishlist_items SET converted_asset_id=?1 WHERE id=?2 AND status='achieved' AND converted_asset_id IS NULL",
        params![asset_id, wish_id],
    )?;
    if changed != 1 {
        return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
    }
    Ok(Some(asset_id))
}

/// A corrected savings target returns the wish to the ongoing list. Keep the
/// former asset recoverable in Recently Deleted, including any later edits.
pub(crate) fn unlink_auto_achieved_asset(tx: &Transaction<'_>, wish: &WishlistItem) -> Result<()> {
    if wish.preferences.achievement_source.as_deref() != Some("savings") {
        return Ok(());
    }
    if let Some(asset) = &wish.converted_asset {
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE wishlist_items SET converted_asset_id=NULL WHERE id=?1",
            [&wish.id],
        )?;
        tx.execute("UPDATE assets SET deleted_at=?2,revision=revision+1 WHERE id=?1 AND deleted_at IS NULL", params![asset.id, now])?;
    }
    Ok(())
}

pub(crate) fn backfill_achieved_assets(c: &Connection) -> Result<usize> {
    let mut stmt = c.prepare("SELECT id FROM wishlist_items WHERE status='achieved' AND converted_asset_id IS NULL AND deleted_at IS NULL ORDER BY created_at,id")?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = c.unchecked_transaction()?;
    for id in &ids {
        link_achieved_asset(&tx, id)?;
    }
    tx.commit()?;
    Ok(ids.len())
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
                    "INSERT INTO wishlist_items(id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,revision,created_at,updated_at,abandoned_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'ongoing',1,?9,?9,NULL)",
                    params![id, fields.name.trim(), fields.category_id, cents(fields.estimated_price_cents.as_deref())?, fields.priority, fields.target_date, fields.external_link.trim(), fields.notes, now],
                )?;
                self.commit_wishlist_cover(&tx, &id, cover)?;
                (id, "add")
            }
            Action::Abandon { wishlist_id } => {
                uuid::Uuid::parse_str(wishlist_id).map_err(|_| Error::new("ID", "心愿标识无效"))?;
                let expected = input
                    .expected_revision
                    .filter(|r| *r > 0)
                    .ok_or_else(|| Error::new("REVISION", "版本标识无效"))?;
                let status: Option<(String, i64)> = tx
                    .query_row(
                        "SELECT status,revision FROM wishlist_items WHERE id=?1 AND deleted_at IS NULL",
                        [wishlist_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                let Some((status, revision)) = status else {
                    return Err(Error::new("NOT_FOUND", "找不到这条心愿"));
                };
                if revision != expected {
                    return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
                }
                if status != "ongoing" {
                    return Err(Error::new("WISHLIST_STATUS", "这条心愿已不在进行中"));
                }
                tx.execute(
                    "UPDATE wishlist_items SET status='abandoned',revision=revision+1,updated_at=?1,abandoned_at=?1 WHERE id=?2 AND revision=?3 AND status='ongoing'",
                    params![now, wishlist_id, expected],
                )?;
                (wishlist_id.clone(), "abandon")
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

    /// Creates the asset, marks the wish Achieved and records both receipts in
    /// one transaction. The receipt is the asset JSON, so `saved_request`
    /// resolves a lost reply exactly like an ordinary asset save.
    pub fn convert_wishlist(
        &mut self,
        input: &Convert,
        today: &str,
    ) -> Result<crate::catalog::AssetRecord> {
        let base = &input.asset.base;
        self.check_generation(&base.generation)?;
        if base.asset_id.is_some() || base.expected_revision.is_some() {
            return Err(Error::new("REVISION", "转换只能新建物品"));
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
        let current: Option<(String, i64, Option<String>)> = tx
            .query_row(
                "SELECT status,revision,converted_asset_id FROM wishlist_items WHERE id=?1 AND deleted_at IS NULL",
                [&input.wishlist_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((status, revision, converted)) = current else {
            return Err(Error::new("NOT_FOUND", "找不到这条心愿"));
        };
        if converted.is_some() {
            return Err(Error::new(
                "WISHLIST_ACHIEVED",
                "这条心愿已转为物品，不能再次转换",
            ));
        }
        if !["ongoing", "achieved"].contains(&status.as_str()) {
            return Err(Error::new("WISHLIST_STATUS", "这条心愿已不在进行中"));
        }
        if revision != input.expected_revision {
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
        let now = chrono::Utc::now().to_rfc3339();
        let changed = tx.execute(
            "UPDATE wishlist_items SET status='achieved',converted_asset_id=?1,achieved_at=coalesce(achieved_at,?2),revision=revision+1,updated_at=?2 WHERE id=?3 AND revision=?4 AND status IN ('ongoing','achieved')",
            params![asset.id, now, input.wishlist_id, revision],
        )?;
        if changed != 1 {
            return Err(Error::new("REVISION_CONFLICT", "心愿已变化，请重新读取"));
        }
        tx.execute("UPDATE wishlist_preferences SET payload=json_set(payload,'$.achievement_source','conversion') WHERE wishlist_id=?1",[&input.wishlist_id])?;
        let wish = read(&tx, &input.wishlist_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条心愿"))?;
        tx.execute(
            "INSERT INTO wishlist_audit(request_id,wishlist_id,action,snapshot,created_at) VALUES(?1,?2,'convert',?3,?4)",
            params![base.request_id, input.wishlist_id, serde_json::to_string(&wish)?, now],
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
        Ok(self
            .conn()?
            .query_row(
                "SELECT id,name,estimated_price_cents,created_at,achieved_at FROM wishlist_items WHERE converted_asset_id=?1 AND deleted_at IS NULL",
                [asset_id],
                |r| {
                    Ok(Origin {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        estimated_price_cents: r.get::<_, Option<i64>>(2)?.map(|n| n.to_string()),
                        created_at: r.get(3)?,
                        achieved_at: r.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn query_wishlist(&self, q: &Query) -> Result<Page> {
        if q.search.chars().count() > 200 {
            return Err(Error::new("SEARCH", "搜索内容最多 200 字"));
        }
        let filter = match q.filter.as_str() {
            "all" | "ongoing" | "achieved" | "abandoned" => q.filter.as_str(),
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
        let from = "FROM wishlist_items w LEFT JOIN categories c ON c.id=w.category_id WHERE w.deleted_at IS NULL AND (w.status=?1 OR (?1='all' AND w.status IN ('ongoing','achieved'))) AND instr(lower(w.name || ' ' || w.external_link || ' ' || w.notes || ' ' || coalesce(c.name,'')),lower(?2))>0";
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
            "SELECT coalesce(sum(estimated_price_cents),0),coalesce(sum(estimated_price_cents IS NULL),0) FROM wishlist_items WHERE status='ongoing' AND deleted_at IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok(Page {
            generation: self.generation(),
            items,
            total,
            ongoing_known_cents: known.to_string(),
            ongoing_unknown_count: unknown,
        })
    }
}

pub(crate) fn validate_dataset(c: &Connection, version: i64) -> Result<()> {
    let mut stmt = c.prepare("SELECT id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,revision,created_at,updated_at,abandoned_at FROM wishlist_items")?;
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
            r.get::<_, i64>(9)?,
            r.get::<_, String>(10)?,
            r.get::<_, String>(11)?,
            r.get::<_, Option<String>>(12)?,
        ))
    })?;
    for row in rows {
        let (id, fields, status, revision, created, updated, abandoned) = row?;
        uuid::Uuid::parse_str(&id).map_err(|_| Error::new("WISHLIST", "心愿标识无效"))?;
        fields.validate()?;
        if !["ongoing", "achieved", "abandoned"].contains(&status.as_str()) || revision < 1 {
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
