//! Shared desktop choice management. Disabling never rewrites existing records.
use crate::{
    domain::{Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// References in the physical domain (item preferences, including trashed).
    pub references: i64,
    /// Label scope: `physical`, `virtual` or `both`; `None` for other kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// References in the virtual domain (including trashed rows).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub virtual_references: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct Snapshot {
    pub revision: i64,
    pub items: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Create {
        name: String,
        /// Label only: scope of a newly created label; defaults to `physical`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
    },
    Enable {
        id: String,
        enabled: bool,
    },
    Reorder {
        ids: Vec<String>,
    },
    Rename {
        id: String,
        name: String,
    },
    Remove {
        id: String,
        replacement: Option<String>,
        /// Physical references (including trashed rows) at read time.
        expected_references: i64,
        /// Virtual references at read time; part of the same confirmation
        /// (review R9).
        #[serde(default)]
        expected_virtual_references: i64,
    },
    /// Label only: which domains may pick this label (design §2). Narrowing is
    /// refused while the other domain still references it.
    Scope {
        id: String,
        scope: String,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: i64,
    pub kind: String,
    pub action: Action,
}
fn table(kind: &str) -> Result<Option<&'static str>> {
    match kind {
        "category" => Ok(Some("categories")),
        "channel" => Ok(Some("channels")),
        "label" | "sale_channel" => Ok(None),
        _ => Err(Error::new("CHOICE", "未知的选项类型")),
    }
}
impl Store {
    pub fn choices(&self, kind: &str) -> Result<Snapshot> {
        let c = self.conn()?;
        let sql=match table(kind)?{Some(t)=>format!("SELECT id,name,NOT EXISTS(SELECT 1 FROM disabled_choices d WHERE d.kind=?1 AND d.id=t.id) FROM {t} t ORDER BY position,id"),None=>"SELECT id,name,enabled FROM named_choices WHERE kind=?1 ORDER BY position,id".into()};
        let mut items = c
            .prepare(&sql)?
            .query_map([kind], |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    enabled: r.get(2)?,
                    references: 0,
                    scope: None,
                    virtual_references: None,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for item in &mut items {
            match kind {
                "label" => {
                    item.references = c.query_row("SELECT count(*) FROM asset_preferences WHERE json_extract(payload,'$.label_id')=?1", [&item.id], |r| r.get(0))?;
                    item.virtual_references = Some(c.query_row(
                        "SELECT count(*) FROM virtual_assets WHERE label_id=?1",
                        [&item.id],
                        |r| r.get(0),
                    )?);
                    item.scope = Some(
                        c.query_row(
                            "SELECT scope FROM label_scopes WHERE label_id=?1",
                            [&item.id],
                            |r| r.get(0),
                        )
                        .optional()?
                        .unwrap_or_else(|| "physical".into()),
                    );
                }
                "sale_channel" => {
                    item.references = c.query_row(
                        "SELECT count(*) FROM sales WHERE platform=?1 AND revoked_at IS NULL",
                        [&item.name],
                        |r| r.get(0),
                    )?;
                }
                _ => {}
            }
        }
        Ok(Snapshot {
            revision: c.query_row("SELECT revision FROM taxonomy_state WHERE id=1", [], |r| {
                r.get(0)
            })?,
            items,
        })
    }
    pub fn change_choices(&mut self, input: &Change) -> Result<Snapshot> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let t = table(&input.kind)?;
        let fp = digest(&serde_json::to_vec(&("choices", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let saved: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM feature_requests WHERE id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(prior) = saved {
            if prior != fp {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已被使用"));
            }
            return self.choices(&input.kind);
        }
        let current = self.choices(&input.kind)?;
        if current.revision != input.expected_revision {
            return Err(Error::new("TAXONOMY_STALE", "选项已变化，请重新读取"));
        }
        match &input.action {
            Action::Create { name, scope } => {
                let name = crate::taxonomy::canonical_name(crate::taxonomy::Kind::Channel, name)?;
                if ["全部", "未设置", "未选择"].contains(&name.as_str())
                    || (input.kind == "label"
                        && ["保障中", "已退役", "已售出"].contains(&name.as_str()))
                {
                    return Err(Error::new("CHOICE_NAME", "此名称由系统保留"));
                }
                let key = name.to_ascii_lowercase();
                if current
                    .items
                    .iter()
                    .any(|e| e.name.to_ascii_lowercase() == key)
                {
                    return Err(Error::new("CHOICE_NAME", "已存在同名选项"));
                }
                let id = uid();
                let position = current.items.len() as i64;
                match t {
                    Some("categories") => {
                        tx.execute("INSERT INTO categories(id,name,name_key,icon,position) VALUES(?1,?2,?3,'box',?4)",params![id,name,key,position])?;
                    }
                    Some("channels") => {
                        tx.execute(
                            "INSERT INTO channels(id,name,name_key,position) VALUES(?1,?2,?3,?4)",
                            params![id, name, key, position],
                        )?;
                    }
                    _ => {
                        tx.execute(
                            "INSERT INTO named_choices VALUES(?1,?2,?3,?4,?5,1)",
                            params![id, input.kind, name, key, position],
                        )?;
                        if input.kind == "label" {
                            let scope = scope.as_deref().unwrap_or("physical");
                            if !["physical", "virtual", "both"].contains(&scope) {
                                return Err(Error::new("CHOICE_SCOPE", "标签适用范围无效"));
                            }
                            tx.execute(
                                "INSERT INTO label_scopes(label_id,scope) VALUES(?1,?2)",
                                params![id, scope],
                            )?;
                        }
                    }
                }
            }
            Action::Rename { id, name } => {
                if t.is_some() {
                    return Err(Error::new("CHOICE", "分类与购买渠道请使用对应的管理入口"));
                }
                let old = current
                    .items
                    .iter()
                    .find(|e| &e.id == id)
                    .ok_or_else(|| Error::new("CHOICE", "选项已不存在"))?;
                let name = crate::taxonomy::canonical_name(crate::taxonomy::Kind::Channel, name)?;
                if ["全部", "未设置", "未选择"].contains(&name.as_str())
                    || (input.kind == "label"
                        && ["保障中", "已退役", "已售出"].contains(&name.as_str()))
                {
                    return Err(Error::new("CHOICE_NAME", "此名称由系统保留"));
                }
                if current
                    .items
                    .iter()
                    .any(|e| e.id != *id && e.name.eq_ignore_ascii_case(&name))
                {
                    return Err(Error::new("CHOICE_NAME", "已存在同名选项"));
                }
                if input.kind == "sale_channel" && old.name != name {
                    self.rewrite_choice_sales(&tx, &old.name, &name)?;
                }
                tx.execute(
                    "UPDATE named_choices SET name=?1,name_key=?2 WHERE id=?3 AND kind=?4",
                    params![name, name.to_ascii_lowercase(), id, input.kind],
                )?;
            }
            Action::Remove {
                id,
                replacement,
                expected_references,
                expected_virtual_references,
            } => {
                if t.is_some() {
                    return Err(Error::new("CHOICE", "分类与购买渠道请使用对应的管理入口"));
                }
                let old = current
                    .items
                    .iter()
                    .find(|e| &e.id == id)
                    .ok_or_else(|| Error::new("CHOICE", "选项已不存在"))?;
                // Both domains are confirmed together; a stale request that
                // missed new references of either side is rejected (R9).
                if old.references != *expected_references
                    || old.virtual_references.unwrap_or(0) != *expected_virtual_references
                {
                    return Err(Error::new(
                        "CHOICE_REFERENCES",
                        "关联数量已变化，请重新查看后删除",
                    ));
                }
                let target = replacement
                    .as_ref()
                    .map(|target| {
                        current
                            .items
                            .iter()
                            .find(|e| &e.id == target && e.id != *id && e.enabled)
                            .ok_or_else(|| Error::new("CHOICE", "替换选项已不可用，请重新选择"))
                    })
                    .transpose()?;
                // 迁移目标必须兼容每一个仍有引用的领域（review R9）：跨域
                // 引用不能迁到单域标签。
                if let Some(target) = target {
                    let scope = target.scope.as_deref().unwrap_or("physical");
                    if old.references > 0 && !matches!(scope, "physical" | "both") {
                        return Err(Error::new(
                            "CHOICE_SCOPE",
                            "替换标签的适用范围不包含实物引用，请选择通用标签或清空",
                        ));
                    }
                    if old.virtual_references.unwrap_or(0) > 0
                        && !matches!(scope, "virtual" | "both")
                    {
                        return Err(Error::new(
                            "CHOICE_SCOPE",
                            "替换标签的适用范围不包含虚拟引用，请选择通用标签或清空",
                        ));
                    }
                }
                if input.kind == "label" {
                    let now = chrono::Utc::now().to_rfc3339();
                    tx.execute("UPDATE assets SET revision=revision+1 WHERE id IN (SELECT asset_id FROM asset_preferences WHERE json_extract(payload,'$.label_id')=?1)", [id])?;
                    tx.execute("UPDATE asset_profiles SET updated_at=?2 WHERE asset_id IN (SELECT asset_id FROM asset_preferences WHERE json_extract(payload,'$.label_id')=?1)", params![id,now])?;
                    tx.execute("UPDATE asset_preferences SET payload=json_set(payload,'$.label_id',?2) WHERE json_extract(payload,'$.label_id')=?1",params![id,replacement])?;
                    // Both domains migrate together in this transaction; the
                    // virtual references counted above included trashed rows.
                    tx.execute("UPDATE virtual_assets SET label_id=?2,revision=revision+1,updated_at=?3 WHERE label_id=?1", params![id, replacement, now])?;
                    tx.execute("DELETE FROM label_scopes WHERE label_id=?1", [id])?;
                } else {
                    self.rewrite_choice_sales(
                        &tx,
                        &old.name,
                        target.map(|e| e.name.as_str()).unwrap_or(""),
                    )?;
                }
                tx.execute(
                    "DELETE FROM named_choices WHERE id=?1 AND kind=?2",
                    params![id, input.kind],
                )?;
            }
            Action::Enable { id, enabled } => {
                if !current.items.iter().any(|e| &e.id == id) {
                    return Err(Error::new("CHOICE", "选项已不存在"));
                }
                if t.is_some() {
                    if *enabled {
                        tx.execute(
                            "DELETE FROM disabled_choices WHERE kind=?1 AND id=?2",
                            params![input.kind, id],
                        )?;
                    } else {
                        tx.execute(
                            "INSERT OR IGNORE INTO disabled_choices VALUES(?1,?2)",
                            params![input.kind, id],
                        )?;
                    }
                } else {
                    tx.execute(
                        "UPDATE named_choices SET enabled=?1 WHERE id=?2 AND kind=?3",
                        params![enabled, id, input.kind],
                    )?;
                }
            }
            Action::Scope { id, scope } => {
                if input.kind != "label" {
                    return Err(Error::new("CHOICE", "只有标签有适用范围"));
                }
                let entry = current
                    .items
                    .iter()
                    .find(|e| &e.id == id)
                    .ok_or_else(|| Error::new("CHOICE", "选项已不存在"))?;
                if !["physical", "virtual", "both"].contains(&scope.as_str()) {
                    return Err(Error::new("CHOICE_SCOPE", "标签适用范围无效"));
                }
                if scope != "both" {
                    // Narrowing needs the other domain's references gone first;
                    // counts include rows in Recently Deleted.
                    let blocked = if scope == "physical" {
                        entry.virtual_references.unwrap_or(0)
                    } else {
                        entry.references
                    };
                    if blocked > 0 {
                        return Err(Error::new(
                            "CHOICE_SCOPE",
                            "此标签在另一领域仍有引用；请先迁移或清空那些引用，再收窄适用范围",
                        ));
                    }
                }
                tx.execute(
                    "INSERT INTO label_scopes(label_id,scope) VALUES(?1,?2) ON CONFLICT(label_id) DO UPDATE SET scope=excluded.scope",
                    params![id, scope],
                )?;
            }
            Action::Reorder { ids } => {
                if ids.len() != current.items.len()
                    || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
                    || ids
                        .iter()
                        .any(|id| !current.items.iter().any(|e| &e.id == id))
                {
                    return Err(Error::new("CHOICE_ORDER", "排序必须包含全部选项"));
                }
                for (position, id) in ids.iter().enumerate() {
                    if let Some(t) = t {
                        tx.execute(
                            &format!("UPDATE {t} SET position=?1 WHERE id=?2"),
                            params![position as i64, id],
                        )?;
                    } else {
                        tx.execute(
                            "UPDATE named_choices SET position=?1 WHERE id=?2 AND kind=?3",
                            params![position as i64, id, input.kind],
                        )?;
                    }
                }
            }
        }
        tx.execute(
            "UPDATE taxonomy_state SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fp, input.kind],
        )?;
        self.hit("choice.before_commit")?;
        tx.commit()?;
        self.hit("choice.after_commit")?;
        self.choices(&input.kind)
    }
    // A channel is stored as text in sales. Append corrections instead of rewriting
    // immutable audit snapshots; this also keeps backup validation and stale editors safe.
    fn rewrite_choice_sales(
        &self,
        tx: &rusqlite::Transaction<'_>,
        old: &str,
        new: &str,
    ) -> Result<()> {
        let ids = tx
            .prepare("SELECT asset_id FROM sales WHERE platform=?1 AND revoked_at IS NULL")?
            .query_map([old], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let now = chrono::Utc::now().to_rfc3339();
        for id in ids {
            let mut sale = crate::sales::read(tx, &id)?
                .ok_or_else(|| Error::new("CHOICE", "售出记录已变化"))?;
            sale.fields.platform = new.to_owned();
            let request = uid();
            tx.execute(
                "UPDATE sales SET platform=?1,updated_at=?2 WHERE id=?3",
                params![new, now, sale.id],
            )?;
            tx.execute("UPDATE assets SET revision=revision+1 WHERE id=?1", [&id])?;
            tx.execute(
                "UPDATE asset_profiles SET updated_at=?1 WHERE asset_id=?2",
                params![now, id],
            )?;
            let asset = self
                .asset(&id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))?;
            tx.execute(
                "INSERT INTO requests VALUES(?1,?2,?3)",
                params![
                    request,
                    digest(request.as_bytes()),
                    serde_json::to_string(&asset)?
                ],
            )?;
            tx.execute("INSERT INTO sale_audit(request_id,sale_id,action,snapshot,created_at) VALUES(?1,?2,'correct',?3,?4)",params![request,sale.id,serde_json::to_string(&sale)?,now])?;
        }
        Ok(())
    }
}
