//! Monthly income records for the planning module (PLANNING_DESIGN §3): the
//! after-tax amount and the housing fund deposit that actually arrived. A
//! monthly summary, not a ledger and not classified by source.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fields {
    pub date: String,
    pub net_cents: String,
    pub hpf_cents: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: Fields,
}

#[derive(Debug, Clone, Serialize)]
pub struct Income {
    pub id: String,
    pub fields: Fields,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct List {
    pub generation: String,
    /// Newest first, same-day rows in a stable order.
    pub rows: Vec<Income>,
}

/// Zero is a stated fact (nothing arrived, no deposit); unknown is not allowed
/// here because both amounts are required.
fn amount(value: &str, code: &'static str, label: &str) -> Result<i64> {
    cents(Some(value))
        .ok()
        .flatten()
        .filter(|v| *v >= 0)
        .ok_or_else(|| Error::new(code, &format!("{label}须为不小于 0 的金额")))
}

fn validate(f: &Fields, today: &str) -> Result<(i64, i64)> {
    date(&f.date)?;
    if f.date.as_str() > today {
        return Err(Error::new("INCOME_DATE", "到账日期不能晚于今天"));
    }
    if f.notes.chars().count() > 500 || f.notes.contains('\0') {
        return Err(Error::new(
            "INCOME_NOTES",
            "备注最多 500 字，且不能含空字符",
        ));
    }
    Ok((
        amount(&f.net_cents, "INCOME_NET", "税后到账")?,
        amount(&f.hpf_cents, "INCOME_HPF", "公积金缴存")?,
    ))
}

const COLUMNS: &str = "id,date,net_cents,hpf_cents,notes,revision";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Income> {
    Ok(Income {
        id: r.get(0)?,
        fields: Fields {
            date: r.get(1)?,
            net_cents: r.get::<_, i64>(2)?.to_string(),
            hpf_cents: r.get::<_, i64>(3)?.to_string(),
            notes: r.get(4)?,
        },
        revision: r.get(5)?,
    })
}

fn read(c: &Connection, id: &str) -> Result<Option<Income>> {
    Ok(c.query_row(
        &format!("SELECT {COLUMNS} FROM plan_income WHERE id=?1 AND deleted_at IS NULL"),
        [id],
        row,
    )
    .optional()?)
}

impl Store {
    pub fn plan_income(&self, id: &str) -> Result<Option<Income>> {
        read(self.conn()?, id)
    }

    pub fn plan_income_list(&self) -> Result<List> {
        let c = self.conn()?;
        let mut q = c.prepare(&format!(
            "SELECT {COLUMNS} FROM plan_income WHERE deleted_at IS NULL ORDER BY date DESC,id"
        ))?;
        let rows = q
            .query_map([], row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(List {
            generation: self.generation(),
            rows,
        })
    }

    pub fn plan_income_save(&mut self, input: &Save, today: &str) -> Result<Income> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("plan_income", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((f, id)) = prior {
            if f != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"));
            }
            return read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条收入记录"));
        }
        let f = &input.fields;
        let (net, hpf) = validate(f, today)?;
        let old = input
            .id
            .as_deref()
            .map(|id| read(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条收入记录")))
            .transpose()?;
        if old.as_ref().map(|e| e.revision) != input.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "收入记录已变化，请重新读取",
            ));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute(
                "UPDATE plan_income SET date=?2,net_cents=?3,hpf_cents=?4,notes=?5,revision=revision+1,updated_at=?6 WHERE id=?1",
                params![id, f.date, net, hpf, f.notes, now],
            )?;
        } else {
            tx.execute(
                "INSERT INTO plan_income(id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)",
                params![id, f.date, net, hpf, f.notes, now],
            )?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result =
            read(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条收入记录"))?;
        self.hit("plan_income.before_commit")?;
        tx.commit()?;
        self.hit("plan_income.after_commit")?;
        Ok(result)
    }
}

/// Backup validation beyond what the SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法收入记录");
    let mut q = c.prepare(
        "SELECT id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at FROM plan_income",
    )?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let f = Fields {
            date: r.get(1)?,
            net_cents: r.get::<_, i64>(2)?.to_string(),
            hpf_cents: r.get::<_, i64>(3)?.to_string(),
            notes: r.get(4)?,
        };
        if uuid::Uuid::parse_str(&id).is_err() || r.get::<_, i64>(5)? < 1 {
            return Err(bad());
        }
        validate(&f, "9999-12-31").map_err(|_| bad())?;
        for i in [6, 7] {
            chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(i)?).map_err(|_| bad())?;
        }
    }
    Ok(())
}
