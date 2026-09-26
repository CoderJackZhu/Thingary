use crate::{
    domain::{Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Category,
    Channel,
}
impl Kind {
    fn table(self) -> &'static str {
        match self {
            Self::Category => "categories",
            Self::Channel => "channels",
        }
    }
    fn field(self) -> &'static str {
        match self {
            Self::Category => "category_id",
            Self::Channel => "channel_id",
        }
    }
    fn reserved(self) -> &'static str {
        match self {
            Self::Category => "未分类",
            Self::Channel => "未记录",
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Icon {
    Box,
    Computer,
    Phone,
    Camera,
    Audio,
    Home,
}
impl Icon {
    fn key(self) -> &'static str {
        match self {
            Self::Box => "box",
            Self::Computer => "computer",
            Self::Phone => "phone",
            Self::Camera => "camera",
            Self::Audio => "audio",
            Self::Home => "home",
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Down,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Command {
    Create {
        kind: Kind,
        name: String,
        icon: Option<Icon>,
    },
    Rename {
        kind: Kind,
        id: String,
        name: String,
    },
    SetIcon {
        id: String,
        icon: Icon,
    },
    Reorder {
        kind: Kind,
        ids: Vec<String>,
    },
    MoveCategory {
        id: String,
        direction: Direction,
    },
    Remove {
        kind: Kind,
        id: String,
        #[serde(rename = "targetId", deserialize_with = "required_target")]
        target_id: Option<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub generation: String,
    pub expected_revision: i64,
    pub command: Command,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Classification {
    pub category_id: Option<String>,
    pub channel_id: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub enum CategoryFilter {
    #[default]
    All,
    Uncategorized,
    Category {
        id: String,
    },
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct References {
    pub active_assets: i64,
    pub deleted_assets: i64,
    pub ongoing_wishlist: i64,
    pub abandoned_wishlist: i64,
}
#[derive(Debug, Serialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub references: References,
}
#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub generation: String,
    pub revision: i64,
    pub categories: Vec<Entry>,
    pub channels: Vec<Entry>,
}
// ECMAScript trim's exact whitespace set, also used by the TypeScript validator.
pub fn canonical_name(kind: Kind, value: &str) -> Result<String> {
    let name: String = value.trim_matches(|c| matches!(c, '\u{0009}'..='\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')).nfc().collect();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(Error::new(
            "TAXONOMY_NAME",
            "名称须为 1–80 字，不能包含控制字符",
        ));
    }
    if name == kind.reserved() {
        return Err(Error::new(
            "TAXONOMY_NAME",
            "该名称用于未选择时的显示，请换一个名称",
        ));
    }
    Ok(name)
}
fn assert_exists(c: &Connection, kind: Kind, id: &str) -> Result<()> {
    let exists: bool = c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {} WHERE id=?1)", kind.table()),
        [id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(Error::new(
            "TAXONOMY_STALE",
            "分类或渠道已不可用，请重新读取并选择",
        ));
    }
    Ok(())
}
pub(crate) fn validate_classification(c: &Connection, value: &Classification) -> Result<()> {
    for (kind, id) in [
        (Kind::Category, &value.category_id),
        (Kind::Channel, &value.channel_id),
    ] {
        if let Some(id) = id {
            assert_exists(c, kind, id)?;
        }
    }
    Ok(())
}
fn available_name(c: &Connection, kind: Kind, name: &str, editing: Option<&str>) -> Result<String> {
    let name = canonical_name(kind, name)?;
    let duplicate: bool = c.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE name_key=?1 AND (?2 IS NULL OR id!=?2))",
            kind.table()
        ),
        params![name.to_ascii_lowercase(), editing],
        |r| r.get(0),
    )?;
    if duplicate {
        return Err(Error::new("TAXONOMY_NAME", "已有同名项，请更换"));
    }
    Ok(name)
}
fn entries(c: &Connection, kind: Kind) -> Result<Vec<Entry>> {
    let icon = if matches!(kind, Kind::Category) {
        "t.icon"
    } else {
        "NULL"
    };
    let schema: i64 = c.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let wishlist_references = if schema >= 11 && matches!(kind, Kind::Category) {
        ", (SELECT count(*) FROM wishlist_items w WHERE w.category_id=t.id AND w.status='ongoing'), (SELECT count(*) FROM wishlist_items w WHERE w.category_id=t.id AND w.status='abandoned')"
    } else {
        ", 0, 0"
    };
    let sql = format!("SELECT t.id,t.name,{icon},(SELECT count(*) FROM assets a WHERE a.{}=t.id AND a.deleted_at IS NULL),(SELECT count(*) FROM assets a WHERE a.{}=t.id AND a.deleted_at IS NOT NULL){wishlist_references} FROM {} t ORDER BY position,id",kind.field(),kind.field(),kind.table());
    let mut stmt = c.prepare(&sql)?;
    let result = stmt
        .query_map([], |r| {
            Ok(Entry {
                id: r.get(0)?,
                name: r.get(1)?,
                icon: r.get(2)?,
                references: References {
                    active_assets: r.get(3)?,
                    deleted_assets: r.get(4)?,
                    ongoing_wishlist: r.get(5)?,
                    abandoned_wishlist: r.get(6)?,
                },
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(result)
}
impl Store {
    pub fn taxonomy_snapshot(&self) -> Result<Snapshot> {
        Ok(Snapshot {
            generation: self.generation(),
            revision: self.conn()?.query_row(
                "SELECT revision FROM taxonomy_state WHERE id=1",
                [],
                |r| r.get(0),
            )?,
            categories: entries(self.conn()?, Kind::Category)?,
            channels: entries(self.conn()?, Kind::Channel)?,
        })
    }
    pub fn taxonomy_request(&self, request: &str, generation: &str) -> Result<bool> {
        if generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        Ok(self.conn()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM taxonomy_requests WHERE id=?1)",
            [request],
            |r| r.get(0),
        )?)
    }
    pub fn change_taxonomy(&mut self, input: &Change) -> Result<Snapshot> {
        if input.generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已切换，请重新读取"));
        }
        uuid::Uuid::parse_str(&input.request_id).map_err(|_| Error::new("ID", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(input)?);
        let tx = self.conn()?.unchecked_transaction()?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM taxonomy_requests WHERE id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(previous) = previous {
            if previous != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return self.taxonomy_snapshot();
        }
        let revision: i64 =
            tx.query_row("SELECT revision FROM taxonomy_state WHERE id=1", [], |r| {
                r.get(0)
            })?;
        if input.expected_revision != revision {
            return Err(Error::new(
                "TAXONOMY_CONFLICT",
                "分类、渠道或引用已变化，请重新加载核对后再决定",
            ));
        }
        match &input.command {
            Command::Create { kind, name, icon } => {
                let name = available_name(&tx, *kind, name, None)?;
                let count: i64 =
                    tx.query_row(&format!("SELECT count(*) FROM {}", kind.table()), [], |r| {
                        r.get(0)
                    })?;
                if count >= 500 {
                    return Err(Error::new("TAXONOMY_LIMIT", "每类最多 500 项"));
                }
                let position: i64 = tx.query_row(
                    &format!("SELECT coalesce(max(position),-1)+1 FROM {}", kind.table()),
                    [],
                    |r| r.get(0),
                )?;
                match kind {
                    Kind::Category => {
                        tx.execute(
                            "INSERT INTO categories VALUES(?1,?2,?3,?4,?5)",
                            params![
                                uid(),
                                name,
                                name.to_ascii_lowercase(),
                                icon.unwrap_or(Icon::Box).key(),
                                position
                            ],
                        )?;
                    }
                    Kind::Channel => {
                        tx.execute(
                            "INSERT INTO channels VALUES(?1,?2,?3,?4)",
                            params![uid(), name, name.to_ascii_lowercase(), position],
                        )?;
                    }
                }
            }
            Command::Rename { kind, id, name } => {
                assert_exists(&tx, *kind, id)?;
                let name = available_name(&tx, *kind, name, Some(id))?;
                tx.execute(
                    &format!(
                        "UPDATE {} SET name=?1,name_key=?2 WHERE id=?3",
                        kind.table()
                    ),
                    params![name, name.to_ascii_lowercase(), id],
                )?;
            }
            Command::SetIcon { id, icon } => {
                assert_exists(&tx, Kind::Category, id)?;
                tx.execute(
                    "UPDATE categories SET icon=?1 WHERE id=?2",
                    params![icon.key(), id],
                )?;
            }
            Command::Reorder { kind, ids } => {
                let list = entries(&tx, *kind)?;
                let requested: std::collections::HashSet<_> = ids.iter().collect();
                if ids.len() != list.len()
                    || requested.len() != list.len()
                    || list.iter().any(|e| !requested.contains(&e.id))
                {
                    return Err(Error::new("TAXONOMY_STALE", "排序列表已变化，请重新加载"));
                }
                for (position, id) in ids.iter().enumerate() {
                    tx.execute(
                        &format!("UPDATE {} SET position=?1 WHERE id=?2", kind.table()),
                        params![position as i64, id],
                    )?;
                }
            }
            Command::MoveCategory { id, direction } => {
                let list = entries(&tx, Kind::Category)?;
                let index = list
                    .iter()
                    .position(|e| e.id == *id)
                    .ok_or_else(|| Error::new("TAXONOMY_STALE", "分类已不可用"))?;
                let target = match direction {
                    Direction::Up => index.checked_sub(1),
                    Direction::Down => (index + 1 < list.len()).then_some(index + 1),
                };
                if let Some(target) = target {
                    let mut ids: Vec<_> = list.iter().map(|e| &e.id).collect();
                    ids.swap(index, target);
                    for (position, id) in ids.iter().enumerate() {
                        tx.execute(
                            "UPDATE categories SET position=?1 WHERE id=?2",
                            params![position as i64, id],
                        )?;
                    }
                }
            }
            Command::Remove {
                kind,
                id,
                target_id,
            } => {
                assert_exists(&tx, *kind, id)?;
                if let Some(target) = target_id {
                    if target == id {
                        return Err(Error::new("TAXONOMY_TARGET", "不能迁移到自身"));
                    }
                    assert_exists(&tx, *kind, target)?;
                }
                // Cover both live and trashed assets; increment their revisions in this same transaction.
                tx.execute(
                    &format!(
                        "UPDATE assets SET {}=?1,revision=revision+1 WHERE {}=?2",
                        kind.field(),
                        kind.field()
                    ),
                    params![target_id, id],
                )?;
                if matches!(kind, Kind::Category) {
                    // Wishlist has no channel field. Category migration covers
                    // both ongoing and historical rows in this same receipt transaction.
                    tx.execute(
                        "UPDATE wishlist_items SET category_id=?1,revision=revision+1,updated_at=?2 WHERE category_id=?3",
                        params![target_id, chrono::Utc::now().to_rfc3339(), id],
                    )?;
                }
                if matches!(kind, Kind::Channel) {
                    tx.execute("UPDATE wishlist_items SET revision=revision+1 WHERE id IN (SELECT wishlist_id FROM wishlist_preferences WHERE json_extract(payload,'$.channel_id')=?1)",[id])?;
                    tx.execute("UPDATE wishlist_preferences SET payload=json_set(payload,'$.channel_id',?1) WHERE json_extract(payload,'$.channel_id')=?2",params![target_id,id])?;
                }
                tx.execute(
                    "DELETE FROM disabled_choices WHERE kind=?1 AND id=?2",
                    params![
                        if matches!(kind, Kind::Channel) {
                            "channel"
                        } else {
                            "category"
                        },
                        id
                    ],
                )?;
                self.hit("taxonomy.after_migrate")?;
                tx.execute(&format!("DELETE FROM {} WHERE id=?1", kind.table()), [id])?;
            }
        }
        tx.execute(
            "UPDATE taxonomy_state SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.execute(
            "INSERT INTO taxonomy_requests VALUES(?1,?2)",
            params![input.request_id, fingerprint],
        )?;
        self.hit("taxonomy.before_commit")?;
        tx.commit()?;
        self.hit("taxonomy.after_commit")?;
        self.taxonomy_snapshot()
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let state: i64 = c.query_row(
        "SELECT count(*) FROM taxonomy_state WHERE id=1 AND revision>=0",
        [],
        |r| r.get(0),
    )?;
    if state != 1 {
        return Err(Error::new("DATA_CONSTRAINT", "分类版本资料缺失"));
    }
    for kind in [Kind::Category, Kind::Channel] {
        let list = entries(c, kind)?;
        if list.len() > 500 {
            return Err(Error::new("DATA_CONSTRAINT", "分类或渠道数量超出限制"));
        }
        for entry in list {
            uuid::Uuid::parse_str(&entry.id)
                .map_err(|_| Error::new("DATA_CONSTRAINT", "分类或渠道编号不合法"))?;
            let canonical = canonical_name(kind, &entry.name)?;
            let key: String = c.query_row(
                &format!("SELECT name_key FROM {} WHERE id=?1", kind.table()),
                [&entry.id],
                |r| r.get(0),
            )?;
            if canonical != entry.name || key != canonical.to_ascii_lowercase() {
                return Err(Error::new("DATA_CONSTRAINT", "分类或渠道名称不符合规范"));
            }
        }
    }
    Ok(())
}

fn required_target<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_match_javascript_trim_nfc_and_ascii_rules() {
        assert_eq!(
            canonical_name(Kind::Category, "\u{feff}Cafe\u{301}\u{3000}").unwrap(),
            "Café"
        );
        assert!(canonical_name(Kind::Category, "未分类").is_err());
        assert!(canonical_name(Kind::Category, &"物".repeat(81)).is_err());
        assert!(canonical_name(Kind::Channel, "a\nb").is_err());
        assert_eq!(canonical_name(Kind::Channel, "未分类").unwrap(), "未分类");
    }
}
