use crate::{
    catalog::AssetRecord,
    domain::{date, Error, Result},
    photos::{Photo, Selection},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Fields {
    pub kind: String,
    pub provider: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub notes: String,
}
impl Fields {
    pub fn validate(&self) -> Result<()> {
        if !["manufacturer", "extended", "applecare", "store", "other"]
            .contains(&self.kind.as_str())
        {
            return Err(Error::new("WARRANTY_KIND", "请选择有效的保障类型"));
        }
        if self.provider.chars().count() > 200
            || self.provider.contains('\0')
            || self.notes.chars().count() > 10000
            || self.notes.contains('\0')
        {
            return Err(Error::new(
                "WARRANTY_FIELDS",
                "提供方最多 200 字，备注最多 10000 字，且不能含空字符",
            ));
        }
        if let Some(value) = &self.start_date {
            date(value)?;
        }
        if let Some(value) = &self.end_date {
            date(value)?;
        }
        // Warranties may start or end in the future; unlike maintenance dates
        // there is no today/purchase/sale clamp (S03, T10 contract §3).
        if let (Some(start), Some(end)) = (&self.start_date, &self.end_date) {
            if date(end)? < date(start)? {
                return Err(Error::new("DATE_CONFLICT", "保障结束日期不能早于开始日期"));
            }
        }
        Ok(())
    }
}

/// Per-record status derived at query time; never persisted as a fact.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pending,
    Upcoming,
    Active,
    Expiring,
    Expired,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Warranty {
    pub id: String,
    pub fields: Fields,
    pub status: Status,
    pub remaining_days: Option<i64>,
    pub photos: Vec<Photo>,
    pub created_at: String,
    pub updated_at: String,
}

/// Asset-level summary over all non-deleted warranties. `NotCovered` keeps the
/// per-kind facts (upcoming/expired/pending counts) so mixed states never read
/// as currently covered; `None` means no records at all.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SummaryStatus {
    #[default]
    None,
    Covered,
    ExpiringSoon,
    NotCovered,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct WarrantySummary {
    pub status: SummaryStatus,
    pub total: i64,
    pub active_count: i64,
    pub expiring_count: i64,
    pub upcoming_count: i64,
    pub expired_count: i64,
    pub pending_count: i64,
}

pub fn derive_status(
    start: Option<&str>,
    end: Option<&str>,
    today: &str,
) -> Result<(Status, Option<i64>)> {
    let (Some(start), Some(end)) = (start, end) else {
        // Any unknown date means the facts cannot confirm current coverage.
        return Ok((Status::Pending, None));
    };
    let (start, end, today) = (date(start)?, date(end)?, date(today)?);
    if start > today {
        return Ok((Status::Upcoming, None));
    }
    if end < today {
        return Ok((Status::Expired, None));
    }
    // Inclusive on both ends: the end date itself still counts as covered.
    let remaining = (end - today).num_days();
    if (0..=30).contains(&remaining) {
        Ok((Status::Expiring, Some(remaining)))
    } else {
        Ok((Status::Active, Some(remaining)))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Add {
        fields: Fields,
        photos: Selection,
    },
    Correct {
        warranty_id: String,
        fields: Fields,
        photos: Selection,
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

pub(crate) fn read(c: &Connection, id: &str, today: &str) -> Result<Vec<Warranty>> {
    let mut stmt = c.prepare("SELECT id,kind,provider,start_date,end_date,notes,created_at,updated_at FROM warranties WHERE asset_id=?1 AND deleted_at IS NULL ORDER BY end_date IS NULL,end_date,start_date IS NULL,start_date,created_at DESC,id")?;
    let rows = stmt
        .query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Fields {
                    kind: r.get(1)?,
                    provider: r.get(2)?,
                    start_date: r.get(3)?,
                    end_date: r.get(4)?,
                    notes: r.get(5)?,
                },
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(warranty_id, fields, created_at, updated_at)| {
            let (status, remaining_days) = derive_status(
                fields.start_date.as_deref(),
                fields.end_date.as_deref(),
                today,
            )?;
            Ok(Warranty {
                photos: warranty_photos(c, &warranty_id)?,
                id: warranty_id,
                fields,
                status,
                remaining_days,
                created_at,
                updated_at,
            })
        })
        .collect()
}

fn warranty_photos(c: &Connection, id: &str) -> Result<Vec<Photo>> {
    let mut stmt = c.prepare("SELECT attachment_id,name FROM warranty_photos WHERE warranty_id=?1 ORDER BY position,attachment_id")?;
    let photos = stmt
        .query_map([id], |r| {
            Ok(Photo {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(photos)
}

pub(crate) fn summarize(items: &[Warranty]) -> WarrantySummary {
    let mut summary = WarrantySummary {
        total: items.len() as i64,
        ..Default::default()
    };
    for item in items {
        match item.status {
            Status::Active => summary.active_count += 1,
            Status::Expiring => summary.expiring_count += 1,
            Status::Upcoming => summary.upcoming_count += 1,
            Status::Expired => summary.expired_count += 1,
            Status::Pending => summary.pending_count += 1,
        }
    }
    summary.status = if summary.total == 0 {
        SummaryStatus::None
    } else if summary.active_count > 0 {
        // A >30-day effective warranty covers the asset; near-expiry hints stay.
        SummaryStatus::Covered
    } else if summary.expiring_count > 0 {
        SummaryStatus::ExpiringSoon
    } else {
        SummaryStatus::NotCovered
    };
    summary
}

impl Store {
    pub fn change_warranty(&mut self, input: &Change, today: &str) -> Result<AssetRecord> {
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
        let fingerprint = digest(&serde_json::to_vec(&("asset-warranty", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(previous) = tx
            .query_row(
                "SELECT fingerprint FROM requests WHERE id=?1",
                [&input.request_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            if previous != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return self
                .record_at(&input.asset_id, today)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"));
        }
        let record = self
            .record_at(&input.asset_id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))?;
        if record.deleted || record.asset.revision != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "物品已更改或移入最近删除，请重新读取后决定",
            ));
        }
        let (warranty_id, fields, photos, action, created_at) = match &input.action {
            Action::Add { fields, photos } => (uid(), fields.clone(), photos, "add", None),
            Action::Correct {
                warranty_id,
                fields,
                photos,
            } => {
                uuid::Uuid::parse_str(warranty_id)
                    .map_err(|_| Error::new("ID", "保障记录标识无效"))?;
                let created: String = tx.query_row("SELECT created_at FROM warranties WHERE id=?1 AND asset_id=?2 AND deleted_at IS NULL", params![warranty_id, input.asset_id], |r| r.get(0)).optional()?.ok_or_else(|| Error::new("NOT_FOUND", "保障记录已变化，请重新读取"))?;
                (
                    warranty_id.clone(),
                    fields.clone(),
                    photos,
                    "correct",
                    Some(created),
                )
            }
        };
        fields.validate()?;
        let now = chrono::Utc::now().to_rfc3339();
        if action == "add" {
            tx.execute("INSERT INTO warranties(id,asset_id,kind,provider,start_date,end_date,notes,created_at,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,NULL)", params![warranty_id,input.asset_id,fields.kind,fields.provider.trim(),fields.start_date,fields.end_date,fields.notes,now])?;
        } else {
            tx.execute("UPDATE warranties SET kind=?1,provider=?2,start_date=?3,end_date=?4,notes=?5,updated_at=?6 WHERE id=?7", params![fields.kind,fields.provider.trim(),fields.start_date,fields.end_date,fields.notes,now,warranty_id])?;
        }
        self.commit_warranty_photos(&tx, &input.asset_id, &warranty_id, photos)?;
        let (snapshot_status, snapshot_remaining) = derive_status(
            fields.start_date.as_deref(),
            fields.end_date.as_deref(),
            today,
        )?;
        let snapshot = Warranty {
            id: warranty_id.clone(),
            fields,
            status: snapshot_status,
            remaining_days: snapshot_remaining,
            photos: warranty_photos(&tx, &warranty_id)?,
            created_at: created_at.unwrap_or_else(|| now.clone()),
            updated_at: now.clone(),
        };
        tx.execute("INSERT INTO warranty_audit(request_id,warranty_id,action,snapshot,created_at) VALUES(?1,?2,?3,?4,?5)", params![input.request_id,warranty_id,action,serde_json::to_string(&snapshot)?,now])?;
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
        self.hit("warranty.before_commit")?;
        tx.commit()?;
        self.hit("warranty.after_commit")?;
        self.record_at(&input.asset_id, today)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到这件物品"))
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut stmt = c.prepare("SELECT id,asset_id,kind,provider,start_date,end_date,notes,created_at,updated_at,deleted_at FROM warranties")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let asset_id: String = r.get(1)?;
        if uuid::Uuid::parse_str(&id).is_err() || uuid::Uuid::parse_str(&asset_id).is_err() {
            return Err(Error::new("WARRANTY", "保障记录标识无效"));
        }
        Fields {
            kind: r.get(2)?,
            provider: r.get(3)?,
            start_date: r.get(4)?,
            end_date: r.get(5)?,
            notes: r.get(6)?,
        }
        .validate()?;
        for i in [7, 8] {
            chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(i)?)
                .map_err(|_| Error::new("WARRANTY", "保障记录时间无效"))?;
        }
        if let Some(v) = r.get::<_, Option<String>>(9)? {
            chrono::DateTime::parse_from_rfc3339(&v)
                .map_err(|_| Error::new("WARRANTY", "保障删除时间无效"))?;
        }
    }
    let invalid: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM warranty_photos w JOIN warranties t ON t.id=w.warranty_id JOIN attachments a ON a.id=w.attachment_id WHERE a.asset_id!=t.asset_id OR EXISTS(SELECT 1 FROM asset_photos p WHERE p.attachment_id=a.id) OR EXISTS(SELECT 1 FROM maintenance_photos m WHERE m.attachment_id=a.id))", [], |r| r.get(0))?;
    if invalid {
        return Err(Error::new(
            "REFERENCE",
            "保障图片归属错误或与其他记录共用附件标识",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_boundaries_follow_natural_days() {
        // E04 with a fixed observation day: 0/30 days are near expiry, 31+ covered.
        for (end, status, remaining) in [
            ("2026-09-10", Status::Expiring, Some(0)),
            ("2026-10-10", Status::Expiring, Some(30)),
            ("2026-10-11", Status::Active, Some(31)),
        ] {
            let got = derive_status(Some("2026-09-01"), Some(end), "2026-09-10").unwrap();
            assert_eq!(got, (status, remaining), "end {end}");
        }
        // Same-day start and end is a legal, effective warranty.
        assert_eq!(
            derive_status(Some("2026-09-10"), Some("2026-09-10"), "2026-09-10").unwrap(),
            (Status::Expiring, Some(0))
        );
        // The day after, the 9/10 warranty has expired; no timezone drift.
        assert_eq!(
            derive_status(Some("2026-09-01"), Some("2026-09-10"), "2026-09-11").unwrap(),
            (Status::Expired, None)
        );
        // Unknown dates are never treated as covered, future starts wait.
        assert_eq!(
            derive_status(None, Some("2026-12-31"), "2026-09-10").unwrap(),
            (Status::Pending, None)
        );
        assert_eq!(
            derive_status(Some("2026-09-11"), None, "2026-09-10").unwrap(),
            (Status::Pending, None)
        );
        assert_eq!(
            derive_status(Some("2026-09-11"), Some("2027-01-01"), "2026-09-10").unwrap(),
            (Status::Upcoming, None)
        );
    }
    #[test]
    fn summary_mixes_keep_facts_separate() {
        let items = |statuses: &[Status]| {
            statuses
                .iter()
                .map(|&status| Warranty {
                    id: uid(),
                    fields: Fields {
                        kind: "manufacturer".into(),
                        provider: String::new(),
                        start_date: None,
                        end_date: None,
                        notes: String::new(),
                    },
                    status,
                    remaining_days: None,
                    photos: vec![],
                    created_at: String::new(),
                    updated_at: String::new(),
                })
                .collect::<Vec<_>>()
        };
        // E05: future + expired + incomplete has no confirmable coverage.
        let summary = summarize(&items(&[
            Status::Upcoming,
            Status::Expired,
            Status::Pending,
        ]));
        assert_eq!(summary.status, SummaryStatus::NotCovered);
        assert_eq!(
            (
                summary.upcoming_count,
                summary.expired_count,
                summary.pending_count
            ),
            (1, 1, 1)
        );
        // A long-valid warranty covers the asset while the near-expiry hint stays.
        let summary = summarize(&items(&[
            Status::Active,
            Status::Expiring,
            Status::Upcoming,
        ]));
        assert_eq!(summary.status, SummaryStatus::Covered);
        assert_eq!(summary.expiring_count, 1);
        // Only near-expiry effective warranties surface the expiry warning.
        let summary = summarize(&items(&[Status::Expiring, Status::Expired]));
        assert_eq!(summary.status, SummaryStatus::ExpiringSoon);
        // No records is a distinct state, not the same as unknown dates.
        assert_eq!(summarize(&[]).status, SummaryStatus::None);
        assert_eq!(
            summarize(&items(&[Status::Pending])).status,
            SummaryStatus::NotCovered
        );
    }
}
