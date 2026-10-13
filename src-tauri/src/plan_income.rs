//! Monthly income records for the planning module (rules: docs/PRODUCT_RULES.md): the
//! after-tax amount and the housing fund deposit that actually arrived. A
//! monthly summary, not a ledger and classified by explicit source; never added to asset balances.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct Defaults {
    pub generation: String,
    pub hpf_cents: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fields {
    pub date: String,
    pub net_cents: String,
    pub hpf_cents: Option<String>,
    pub notes: String,
    #[serde(default = "unclassified", skip_serializing_if = "is_unclassified")]
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receiving_account_id: Option<String>,
}
impl Default for Fields {
    fn default() -> Self {
        Self {
            date: String::new(),
            net_cents: String::new(),
            hpf_cents: None,
            notes: String::new(),
            category: "unclassified".into(),
            source_account_id: None,
            destination: None,
            receiving_account_id: None,
        }
    }
}
fn unclassified() -> String {
    "unclassified".into()
}
fn is_unclassified(s: &str) -> bool {
    s == "unclassified"
}
pub fn investment_category(s: &str) -> bool {
    ["interest", "cash_dividend", "other_investment"].contains(&s)
}
pub(crate) fn validate_classification(f: &Fields) -> Result<()> {
    if ![
        "unclassified",
        "non_investment",
        "interest",
        "cash_dividend",
        "other_investment",
    ]
    .contains(&f.category.as_str())
    {
        return Err(Error::new("INCOME_CATEGORY", "收入分类无效"));
    }
    if f.destination
        .as_ref()
        .is_some_and(|v| !["retained", "transferred", "unknown"].contains(&v.as_str()))
        || (!investment_category(&f.category) && f.destination.is_some())
        || (f.receiving_account_id.is_some() && f.destination.as_deref() != Some("transferred"))
        || (f.source_account_id.is_some() && f.source_account_id == f.receiving_account_id)
    {
        return Err(Error::new("INCOME_DESTINATION", "收入去向与账户不一致"));
    }
    for id in [&f.source_account_id, &f.receiving_account_id]
        .into_iter()
        .flatten()
    {
        uuid::Uuid::parse_str(id).map_err(|_| Error::new("INCOME_ACCOUNT", "收入账户标识无效"))?;
    }
    Ok(())
}
fn validate_references(
    c: &Connection,
    f: &Fields,
    old: Option<&Fields>,
    historical: bool,
) -> Result<()> {
    for (id, prior) in [
        (
            &f.source_account_id,
            old.and_then(|o| o.source_account_id.as_ref()),
        ),
        (
            &f.receiving_account_id,
            old.and_then(|o| o.receiving_account_id.as_ref()),
        ),
    ] {
        if let Some(id) = id {
            let account: Option<(String, String, Option<String>, Option<String>)> = c
                .query_row(
                    "SELECT side,opened_on,closed_on,deleted_at FROM fin_accounts WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            let Some((side, opened, closed, deleted)) = account else {
                return Err(Error::new("INCOME_ACCOUNT", "收入引用账户不存在"));
            };
            if side != "asset"
                || (!historical
                    && prior != Some(id)
                    && (deleted.is_some() || opened > f.date || closed.is_some_and(|d| d < f.date)))
            {
                return Err(Error::new("INCOME_ACCOUNT", "请选择到账时有效的资产账户"));
            }
        }
    }
    Ok(())
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
    pub classification_changed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct List {
    pub generation: String,
    /// Newest first, same-day rows in a stable order.
    pub rows: Vec<Income>,
}

/// Net arrival is required; an absent housing fund deposit is unknown, not zero.
fn amount(value: &str, code: &'static str, label: &str) -> Result<i64> {
    cents(Some(value))
        .ok()
        .flatten()
        .filter(|v| *v >= 0)
        .ok_or_else(|| Error::new(code, &format!("{label}须为不小于 0 的金额")))
}

fn validate(f: &Fields, today: &str) -> Result<(i64, Option<i64>)> {
    validate_classification(f)?;
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
        f.hpf_cents
            .as_deref()
            .map(|v| amount(v, "INCOME_HPF", "公积金缴存"))
            .transpose()?,
    ))
}

const COLUMNS: &str = "id,date,net_cents,hpf_cents,notes,revision,category,source_account_id,destination,receiving_account_id,classification_changed";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Income> {
    Ok(Income {
        id: r.get(0)?,
        fields: Fields {
            date: r.get(1)?,
            net_cents: r.get::<_, i64>(2)?.to_string(),
            hpf_cents: r.get::<_, Option<i64>>(3)?.map(|v| v.to_string()),
            notes: r.get(4)?,
            category: r.get(6)?,
            source_account_id: r.get(7)?,
            destination: r.get(8)?,
            receiving_account_id: r.get(9)?,
        },
        revision: r.get(5)?,
        classification_changed: r.get(10)?,
    })
}

pub(crate) fn read(c: &Connection, id: &str) -> Result<Option<Income>> {
    Ok(c.query_row(
        &format!("SELECT {COLUMNS} FROM plan_income WHERE id=?1 AND deleted_at IS NULL"),
        [id],
        row,
    )
    .optional()?)
}

pub(crate) fn require_enabled(enabled: bool) -> Result<()> {
    if enabled {
        Ok(())
    } else {
        Err(Error::new("MODULE_DISABLED", "实际收入功能已关闭"))
    }
}

impl Store {
    /// Only the latest eligible deposit is needed to prepare a new income form.
    pub fn plan_income_defaults_with_enabled(&self, enabled: bool) -> Result<Defaults> {
        require_enabled(enabled)?;
        let deposit: Option<Option<i64>> = self
            .conn()?
            .query_row(
                "SELECT hpf_cents FROM plan_income WHERE deleted_at IS NULL
             AND category IN ('unclassified','non_investment') ORDER BY date DESC,id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        Ok(Defaults {
            generation: self.generation(),
            hpf_cents: deposit.flatten().map(|value| value.to_string()),
        })
    }

    /// UI read wrapper; checks capability before touching the income table.
    pub fn plan_income_with_enabled(&self, id: &str, enabled: bool) -> Result<Option<Income>> {
        require_enabled(enabled)?;
        self.plan_income(id)
    }

    pub fn plan_income_list_with_enabled(&self, enabled: bool) -> Result<List> {
        require_enabled(enabled)?;
        self.plan_income_list()
    }

    /// Internal complete-data read for imports, backups and integrity validation.
    pub fn plan_income(&self, id: &str) -> Result<Option<Income>> {
        read(self.conn()?, id)
    }

    /// Internal complete-data read; UI must use the capability wrapper.
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

    /// Internal domain write for imports/tests; UI must use the capability wrapper.
    pub fn plan_income_save(&mut self, input: &Save, today: &str) -> Result<Income> {
        self.plan_income_save_with_enabled(input, today, true)
    }

    /// Existing request replay is read-only and remains available when disabled.
    pub fn plan_income_save_with_enabled(
        &mut self,
        input: &Save,
        today: &str,
        enabled: bool,
    ) -> Result<Income> {
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
        require_enabled(enabled)?;
        let result = write_tx(&tx, input, today, None)?;
        let id = &result.id;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        self.hit("plan_income.before_commit")?;
        tx.commit()?;
        self.hit("plan_income.after_commit")?;
        Ok(result)
    }
}

pub(crate) fn write_tx(
    tx: &Transaction<'_>,
    input: &Save,
    today: &str,
    new_id: Option<&str>,
) -> Result<Income> {
    let f = &input.fields;
    let (net, hpf) = validate(f, today)?;
    let old = input
        .id
        .as_deref()
        .map(|id| read(tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条收入记录")))
        .transpose()?;
    validate_references(tx, f, old.as_ref().map(|o| &o.fields), false)?;
    if old.as_ref().map(|e| e.revision) != input.expected_revision {
        return Err(Error::new(
            "REVISION_CONFLICT",
            "收入记录已变化，请重新读取",
        ));
    }
    let id = input
        .id
        .clone()
        .or_else(|| new_id.map(str::to_owned))
        .unwrap_or_else(uid);
    let now = chrono::Utc::now().to_rfc3339();
    if old.is_some() {
        tx.execute(
                "UPDATE plan_income SET date=?2,net_cents=?3,hpf_cents=?4,notes=?5,revision=revision+1,updated_at=?6,category=?7,source_account_id=?8,destination=?9,receiving_account_id=?10,classification_changed=CASE WHEN category!=?7 THEN 1 ELSE classification_changed END WHERE id=?1",
                params![id, f.date, net, hpf, f.notes, now, f.category, f.source_account_id, f.destination, f.receiving_account_id],
            )?;
    } else {
        tx.execute(
                "INSERT INTO plan_income(id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,category,source_account_id,destination,receiving_account_id) VALUES(?1,?2,?3,?4,?5,1,?6,?6,?7,?8,?9,?10)",
                params![id, f.date, net, hpf, f.notes, now, f.category, f.source_account_id, f.destination, f.receiving_account_id],
            )?;
    }
    if old.as_ref().is_some_and(|o| {
        o.fields.date != f.date
            || o.fields.net_cents != f.net_cents
            || o.fields.category != f.category
            || o.fields.source_account_id != f.source_account_id
            || o.fields.receiving_account_id != f.receiving_account_id
            || o.fields.destination != f.destination
    }) {
        crate::cash_movement::source_changed(tx, "income", &id)?;
    }
    read(tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条收入记录"))
}

/// Backup validation beyond what the SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = || Error::new("DATA_CONSTRAINT", "备份含非法收入记录");
    let current: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('plan_income') WHERE name='category')",
        [],
        |r| r.get(0),
    )?;
    let sql = if current {
        "SELECT id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,category,source_account_id,destination,receiving_account_id,classification_changed FROM plan_income"
    } else {
        "SELECT id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,'unclassified',NULL,NULL,NULL,0 FROM plan_income"
    };
    let mut q = c.prepare(sql)?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let f = Fields {
            date: r.get(1)?,
            net_cents: r.get::<_, i64>(2)?.to_string(),
            hpf_cents: r.get::<_, Option<i64>>(3)?.map(|v| v.to_string()),
            notes: r.get(4)?,
            category: r.get(8)?,
            source_account_id: r.get(9)?,
            destination: r.get(10)?,
            receiving_account_id: r.get(11)?,
        };
        if uuid::Uuid::parse_str(&id).is_err() || r.get::<_, i64>(5)? < 1 {
            return Err(bad());
        }
        validate(&f, "9999-12-31").map_err(|_| bad())?;
        validate_references(c, &f, None, true).map_err(|_| bad())?;
        if ![0, 1].contains(&r.get::<_, i64>(12)?) {
            return Err(bad());
        }
        for i in [6, 7] {
            chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(i)?).map_err(|_| bad())?;
        }
    }
    Ok(())
}
