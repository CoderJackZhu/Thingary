use crate::{
    domain::{cents, date, Error, Result},
    photos::{Photo, Selection},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
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
    pub cover: Option<Photo>,
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

fn read(c: &Connection, id: &str) -> Result<Option<WishlistItem>> {
    let row = c
        .query_row(
            "SELECT id,name,category_id,estimated_price_cents,priority,target_date,external_link,notes,status,revision,created_at,updated_at,abandoned_at FROM wishlist_items WHERE id=?1",
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
                    cover: None,
                })
            },
        )
        .optional()?;
    row.map(|mut item| {
        item.cover = c
            .query_row(
                "SELECT a.id,a.name FROM wishlist_media m JOIN wishlist_attachments a ON a.id=m.cover_id WHERE m.wishlist_id=?1",
                [&item.id],
                |r| Ok(Photo { id: r.get(0)?, name: r.get(1)? }),
            )
            .optional()?;
        Ok(item)
    })
    .transpose()
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
                        "SELECT status,revision FROM wishlist_items WHERE id=?1",
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

    pub fn query_wishlist(&self, q: &Query) -> Result<Page> {
        if q.search.chars().count() > 200 {
            return Err(Error::new("SEARCH", "搜索内容最多 200 字"));
        }
        let filter = match q.filter.as_str() {
            "ongoing" | "achieved" | "abandoned" => q.filter.as_str(),
            _ => return Err(Error::new("QUERY", "不支持的心愿筛选")),
        };
        let direction = if q.descending { "DESC" } else { "ASC" };
        let order = match q.sort.as_str() {
            "created" => format!("w.created_at {direction}"),
            "priority" => "CASE w.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC".into(),
            "price" => format!("w.estimated_price_cents IS NULL ASC,w.estimated_price_cents {direction}"),
            "target" => format!("w.target_date IS NULL ASC,w.target_date {direction}"),
            _ => return Err(Error::new("QUERY", "不支持的心愿排序")),
        };
        let from = "FROM wishlist_items w LEFT JOIN categories c ON c.id=w.category_id WHERE w.status=?1 AND instr(lower(w.name || ' ' || w.external_link || ' ' || w.notes || ' ' || coalesce(c.name,'')),lower(?2))>0";
        let total = self.conn()?.query_row(
            &format!("SELECT count(*) {from}"),
            params![filter, q.search.trim()],
            |r| r.get(0),
        )?;
        let mut stmt = self.conn()?.prepare(&format!(
            "SELECT w.id {from} ORDER BY {order},w.created_at DESC,w.id ASC LIMIT 100 OFFSET ?3"
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
            "SELECT coalesce(sum(estimated_price_cents),0),coalesce(sum(estimated_price_cents IS NULL),0) FROM wishlist_items WHERE status='ongoing'",
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

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
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
            "心愿封面归属错误或与资产附件共用标识",
        ));
    }
    Ok(())
}
