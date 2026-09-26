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
}
#[derive(Serialize, Deserialize)]
pub struct Snapshot {
    pub revision: i64,
    pub items: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Create { name: String },
    Enable { id: String, enabled: bool },
    Reorder { ids: Vec<String> },
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
        let items = c
            .prepare(&sql)?
            .query_map([kind], |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    enabled: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
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
            Action::Create { name } => {
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
                    }
                }
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
        tx.commit()?;
        self.choices(&input.kind)
    }
}
