use crate::{
    catalog::AssetRecord,
    domain::{date, Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Active,
    Retired,
    Sold,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Retire,
    Activate,
}
impl Kind {
    fn key(&self) -> &'static str {
        match self {
            Self::Retire => "retire",
            Self::Activate => "activate",
        }
    }
    fn state(&self) -> &'static str {
        match self {
            Self::Retire => "retired",
            Self::Activate => "active",
        }
    }
    fn label(&self) -> &'static str {
        match self {
            Self::Retire => "退役",
            Self::Activate => "重新启用",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: String,
    pub sequence: i64,
    pub kind: Kind,
    pub date: String,
    pub notes: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Lifecycle {
    pub state: State,
    pub events: Vec<Event>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Append {
        kind: Kind,
        date: String,
        notes: String,
    },
    CorrectDate {
        event_id: String,
        date: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub generation: String,
    pub asset_id: String,
    pub expected_revision: i64,
    pub action: Action,
}

pub(crate) fn validate_purchase_date(
    c: &Connection,
    id: &str,
    purchase: Option<&str>,
) -> Result<()> {
    if let Some(purchase) = purchase {
        let mut stmt=c.prepare("SELECT kind,date FROM lifecycle_events WHERE asset_id=?1 AND date<?2 ORDER BY sequence")?;
        let conflicts = stmt
            .query_map(params![id, purchase], |r| {
                Ok(format!(
                    "{}（{}）",
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if !conflicts.is_empty() {
            return Err(Error::new(
                "DATE_CONFLICT",
                &format!(
                    "购入日期晚于已有状态记录：{}。请先更正相关动作日期。",
                    conflicts
                        .join("、")
                        .replace("retire", "退役")
                        .replace("activate", "重新启用")
                ),
            ));
        }
    }
    Ok(())
}
impl Store {
    pub fn lifecycle(&self, id: &str) -> Result<Lifecycle> {
        let raw: String = self.conn()?.query_row(
            "SELECT lifecycle_state FROM assets WHERE id=?1",
            [id],
            |r| r.get(0),
        )?;
        let state = match raw.as_str() {
            "active" => State::Active,
            "retired" => State::Retired,
            "sold" => State::Sold,
            _ => return Err(Error::new("LIFECYCLE", "状态资料损坏")),
        };
        let mut stmt=self.conn()?.prepare("SELECT id,sequence,kind,date,notes FROM lifecycle_events WHERE asset_id=?1 ORDER BY sequence")?;
        let events = stmt
            .query_map([id], |r| {
                Ok(Event {
                    id: r.get(0)?,
                    sequence: r.get(1)?,
                    kind: if r.get::<_, String>(2)? == "retire" {
                        Kind::Retire
                    } else {
                        Kind::Activate
                    },
                    date: r.get(3)?,
                    notes: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Lifecycle { state, events })
    }
    pub fn change_lifecycle(&mut self, input: &Change, today: &str) -> Result<AssetRecord> {
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
        let fingerprint = digest(&serde_json::to_vec(&("asset-lifecycle", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT fingerprint FROM requests WHERE id=?1",
                [&input.request_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(previous) = previous {
            if previous != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return self
                .record(&input.asset_id)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"));
        }
        let record = self
            .record(&input.asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))?;
        if record.deleted || record.asset.revision != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "物品已更改或移入最近删除，请重新读取后决定",
            ));
        }
        let requested_date = match &input.action {
            Action::Append { date, .. } | Action::CorrectDate { date, .. } => date,
        };
        if date(requested_date)? > date(today)? {
            return Err(Error::new("FUTURE", "动作日期不能晚于今天"));
        }
        if record
            .asset
            .purchase_date
            .as_ref()
            .is_some_and(|p| requested_date < p)
        {
            return Err(Error::new("DATE_CONFLICT", "动作日期不能早于购入日期"));
        }
        let events = &record.lifecycle.events;
        let now = chrono::Utc::now().to_rfc3339();
        match &input.action {
            Action::Append { kind, date, notes } => {
                if !matches!(
                    (&record.lifecycle.state, kind),
                    (State::Active, Kind::Retire) | (State::Retired, Kind::Activate)
                ) {
                    return Err(Error::new("STATE_CONFLICT","当前状态不能执行此动作：使用中可退役，退役可重新启用；已售出须先处理售出记录，真实购回需另建档案。"));
                }
                if notes.chars().count() > 10000 || notes.contains('\0') {
                    return Err(Error::new("NOTES", "备注最多 10000 字，且不能含空字符"));
                }
                if let Some(last) = events.last() {
                    if date < &last.date {
                        return Err(Error::new(
                            "DATE_CONFLICT",
                            &format!(
                                "动作日期不能早于前一次{}（{}）",
                                last.kind.label(),
                                last.date
                            ),
                        ));
                    }
                }
                let sequence = events.last().map_or(1, |e| e.sequence + 1);
                tx.execute(
                    "INSERT INTO lifecycle_events VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
                    params![
                        uid(),
                        input.asset_id,
                        sequence,
                        kind.key(),
                        date,
                        notes,
                        now
                    ],
                )?;
                tx.execute(
                    "UPDATE assets SET lifecycle_state=?1 WHERE id=?2",
                    params![kind.state(), input.asset_id],
                )?;
            }
            Action::CorrectDate { event_id, date } => {
                // Sold date bounds belong to T08; never guess or alter a sale here.
                if record.lifecycle.state == State::Sold {
                    return Err(Error::new(
                        "STATE_CONFLICT",
                        "请先核对售出记录及其日期，当前不能更正此状态历史。",
                    ));
                }
                let index = events
                    .iter()
                    .position(|e| &e.id == event_id)
                    .ok_or_else(|| Error::new("NOT_FOUND", "找不到这条状态记录"))?;
                let prev = index.checked_sub(1).and_then(|i| events.get(i));
                let next = events.get(index + 1);
                for (neighbor, before) in [(prev, true), (next, false)] {
                    if let Some(e) = neighbor {
                        if (before && date < &e.date) || (!before && date > &e.date) {
                            return Err(Error::new(
                                "DATE_CONFLICT",
                                &format!(
                                    "日期与相邻{}（{}）冲突；同日保留原动作顺序。",
                                    e.kind.label(),
                                    e.date
                                ),
                            ));
                        }
                    }
                }
                tx.execute(
                    "UPDATE lifecycle_events SET date=?1,updated_at=?2 WHERE id=?3",
                    params![date, now, event_id],
                )?;
            }
        }
        tx.execute(
            "UPDATE assets SET revision=?1 WHERE id=?2",
            params![next, input.asset_id],
        )?;
        tx.execute(
            "UPDATE asset_profiles SET updated_at=?1 WHERE asset_id=?2",
            params![now, input.asset_id],
        )?;
        let mut result = record.asset;
        result.revision = next;
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&result)?
            ],
        )?;
        self.hit("lifecycle.before_commit")?;
        tx.commit()?;
        self.hit("lifecycle.after_commit")?;
        self.record(&input.asset_id)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut assets = c.prepare("SELECT id,purchase_date,lifecycle_state FROM assets")?;
    let mut rows = assets.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let mut previous: Option<String> = row.get(1)?;
        let state: String = row.get(2)?;
        let mut expected = "retire";
        let mut last_state = "active";
        let mut stmt=c.prepare("SELECT id,sequence,kind,date,notes,created_at,updated_at FROM lifecycle_events WHERE asset_id=?1 ORDER BY sequence")?;
        let mut events = stmt.query([id])?;
        let mut sequence = 1;
        while let Some(e) = events.next()? {
            let event_id: String = e.get(0)?;
            let kind: String = e.get(2)?;
            let d: String = e.get(3)?;
            let notes: String = e.get(4)?;
            date(&d)?;
            if uuid::Uuid::parse_str(&event_id).is_err()
                || e.get::<_, i64>(1)? != sequence
                || kind != expected
                || previous.as_ref().is_some_and(|p| &d < p)
                || notes.chars().count() > 10000
                || notes.contains('\0')
            {
                return Err(Error::new("LIFECYCLE", "备份状态历史不一致"));
            }
            for col in [5, 6] {
                chrono::DateTime::parse_from_rfc3339(&e.get::<_, String>(col)?)
                    .map_err(|_| Error::new("LIFECYCLE", "状态记录时间无效"))?;
            }
            last_state = if kind == "retire" {
                "retired"
            } else {
                "active"
            };
            expected = if kind == "retire" {
                "activate"
            } else {
                "retire"
            };
            previous = Some(d);
            sequence += 1;
        }
        if state != last_state {
            return Err(Error::new("LIFECYCLE", "备份当前状态与历史不一致"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_five_upgrade_is_atomic_and_existing_assets_stay_active() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(crate::storage::SCHEMA).unwrap();
        crate::storage::migrate_to(&c, 5, &|_| Ok(())).unwrap();
        c.execute("INSERT INTO assets(id,name,revision,deleted_at) VALUES('legacy','虚构旧档案',7,'2026-09-20')",[]).unwrap();
        assert!(crate::storage::migrate(&c, &|_| Err(Error::new("INJECTED", "中断"))).is_err());
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            5
        );
        assert!(c.prepare("SELECT * FROM lifecycle_events").is_err());
        crate::storage::migrate(&c, &|_| Ok(())).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT lifecycle_state,revision,deleted_at FROM assets",
                [],
                |r| Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?
                ))
            )
            .unwrap(),
            ("active".into(), 7, "2026-09-20".into())
        );
    }
    #[test]
    fn sold_cannot_activate_and_unknown_purchase_still_obeys_history() {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::open(root.path()).unwrap();
        let a = s
            .save(
                &crate::domain::Save {
                    request_id: uid(),
                    generation: s.generation(),
                    asset_id: None,
                    expected_revision: None,
                    name: "虚构".into(),
                    price_cents: None,
                    purchase_date: None,
                },
                "2026-09-25",
            )
            .unwrap();
        let mut q = Change {
            request_id: uid(),
            generation: s.generation(),
            asset_id: a.id.clone(),
            expected_revision: 1,
            action: Action::Append {
                kind: Kind::Retire,
                date: "2026-09-01".into(),
                notes: "".into(),
            },
        };
        let b = s.change_lifecycle(&q, "2026-09-25").unwrap();
        assert_eq!(b.asset.purchase_date, None);
        s.conn()
            .unwrap()
            .execute(
                "UPDATE assets SET lifecycle_state='sold' WHERE id=?1",
                [&a.id],
            )
            .unwrap();
        q.request_id = uid();
        q.expected_revision = 2;
        q.action = Action::Append {
            kind: Kind::Activate,
            date: "2026-09-02".into(),
            notes: "".into(),
        };
        assert_eq!(
            s.change_lifecycle(&q, "2026-09-25").unwrap_err().code,
            "STATE_CONFLICT"
        );
        assert_eq!(s.lifecycle(&a.id).unwrap().events.len(), 1);
    }
}
