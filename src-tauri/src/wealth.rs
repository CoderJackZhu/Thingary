//! Accounts, liabilities and dated check-ins (ADR-001 §17). Amounts are
//! non-negative cents whose sign comes from the account side; completeness and
//! comparability are derived on read so later account edits cannot leave a
//! stale stored flag behind.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const ASSET_KINDS: [&str; 7] = [
    "cash",
    "investment",
    "mixed",
    "fund",
    "bond",
    "housing_fund",
    "other_asset",
];
const LIABILITY_KINDS: [&str; 3] = ["credit_card", "loan", "other_liability"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountFields {
    pub name: String,
    pub institution: String,
    pub side: String,
    pub kind: String,
    pub counted: bool,
    pub opened_on: String,
    pub closed_on: Option<String>,
    pub notes: String,
}
impl AccountFields {
    fn validate(&self, today: &str) -> Result<()> {
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.contains('\0') {
            return Err(Error::new("ACCOUNT_NAME", "账户名称须为 1–80 字"));
        }
        if self.institution.trim().chars().count() > 80
            || self.institution.contains('\0')
            || self.notes.chars().count() > 10000
            || self.notes.contains('\0')
        {
            return Err(Error::new(
                "ACCOUNT_FIELDS",
                "平台最多 80 字，备注最多 10000 字，且不能含空字符",
            ));
        }
        let kinds: &[&str] = match self.side.as_str() {
            "asset" => &ASSET_KINDS,
            "liability" => &LIABILITY_KINDS,
            _ => return Err(Error::new("ACCOUNT_SIDE", "请选择资产或负债")),
        };
        if !kinds.contains(&self.kind.as_str()) {
            return Err(Error::new("ACCOUNT_KIND", "分类与资产/负债方向不符"));
        }
        date(&self.opened_on)?;
        if self.opened_on.as_str() > today {
            return Err(Error::new("ACCOUNT_DATE", "启用日期不能晚于今天"));
        }
        if let Some(closed) = &self.closed_on {
            date(closed)?;
            if closed.as_str() > today {
                return Err(Error::new("ACCOUNT_DATE", "停用日期不能晚于今天"));
            }
            if closed <= &self.opened_on {
                return Err(Error::new("ACCOUNT_DATE", "停用日期须晚于启用日期"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSave {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub fields: AccountFields,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Observation {
    pub amount_cents: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: String,
    pub fields: AccountFields,
    pub position: i64,
    pub revision: i64,
    /// Latest known amount from a live check-in, with that check-in's date.
    pub latest: Option<Observation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryInput {
    pub account_id: String,
    pub state: String,
    pub amount_cents: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotSave {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub date: String,
    pub notes: String,
    pub entries: Vec<EntryInput>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub account_id: String,
    pub state: String,
    pub amount_cents: Option<String>,
    pub side: String,
    pub kind: String,
    pub counted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub id: String,
    pub date: String,
    pub notes: String,
    pub revision: i64,
    pub entries: Vec<Entry>,
    /// Accounts due on this date without a known amount (missing or no row).
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DraftRow {
    pub account: Account,
    /// Latest known amount before the draft date; "unchanged" confirms it.
    pub previous: Option<Observation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Draft {
    pub generation: String,
    pub date: String,
    pub existing: Option<Snapshot>,
    pub rows: Vec<DraftRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Point {
    pub snapshot_id: String,
    pub date: String,
    pub assets_cents: String,
    pub liabilities_cents: String,
    pub net_cents: String,
    pub complete: bool,
    pub missing: usize,
    /// Earlier complete check-in this point is compared with.
    pub compared_to: Option<String>,
    /// True when a shared account changed whether it counts; no change is given.
    pub scope_changed: bool,
    pub change_cents: Option<String>,
    /// Change as hundredths of a percent; only when the earlier net is positive.
    pub change_rate_hundredths: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Share {
    pub kind: String,
    pub amount_cents: String,
    pub share_hundredths: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    pub generation: String,
    pub points: Vec<Point>,
    /// Asset structure of the latest complete check-in, counted accounts only.
    pub structure_date: Option<String>,
    pub structure: Vec<Share>,
    pub liabilities: Vec<Share>,
}

fn account_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        fields: AccountFields {
            name: r.get(1)?,
            institution: r.get(2)?,
            side: r.get(3)?,
            kind: r.get(4)?,
            counted: r.get(5)?,
            opened_on: r.get(6)?,
            closed_on: r.get(7)?,
            notes: r.get(8)?,
        },
        position: r.get(9)?,
        revision: r.get(10)?,
        latest: None,
    })
}
const ACCOUNT_COLUMNS: &str =
    "id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision";

fn accounts(c: &Connection) -> Result<Vec<Account>> {
    let mut q = c.prepare(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM fin_accounts WHERE deleted_at IS NULL ORDER BY position,id"
    ))?;
    let mut list = q
        .query_map([], account_row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for a in &mut list {
        a.latest = observation_before(c, &a.id, None)?;
    }
    Ok(list)
}

fn account(c: &Connection, id: &str) -> Result<Option<Account>> {
    let found = c
        .query_row(
            &format!(
                "SELECT {ACCOUNT_COLUMNS} FROM fin_accounts WHERE id=?1 AND deleted_at IS NULL"
            ),
            [id],
            account_row,
        )
        .optional()?;
    found
        .map(|mut a| {
            a.latest = observation_before(c, &a.id, None)?;
            Ok(a)
        })
        .transpose()
}

/// Latest known amount in a live check-in strictly before `before` (or ever).
fn observation_before(
    c: &Connection,
    account: &str,
    before: Option<&str>,
) -> Result<Option<Observation>> {
    Ok(c.query_row(
        "SELECT e.amount_cents,s.date FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL AND e.amount_cents IS NOT NULL AND (?2 IS NULL OR s.date<?2) ORDER BY s.date DESC LIMIT 1",
        params![account, before],
        |r| Ok(Observation { amount_cents: r.get::<_, i64>(0)?.to_string(), date: r.get(1)? }),
    ).optional()?)
}

fn due(a: &Account, day: &str) -> bool {
    a.fields.opened_on.as_str() <= day && a.fields.closed_on.as_deref().is_none_or(|c| day < c)
}

fn snapshot(c: &Connection, id: &str, live: &[Account]) -> Result<Option<Snapshot>> {
    let head = c
        .query_row(
            "SELECT date,notes,revision FROM fin_snapshots WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((day, notes, revision)) = head else {
        return Ok(None);
    };
    let mut q = c.prepare("SELECT e.account_id,e.state,e.amount_cents,e.side,e.kind,e.counted FROM fin_snapshot_entries e JOIN fin_accounts a ON a.id=e.account_id WHERE e.snapshot_id=?1 ORDER BY a.position,a.id")?;
    let entries = q
        .query_map([id], |r| {
            Ok(Entry {
                account_id: r.get(0)?,
                state: r.get(1)?,
                amount_cents: r.get::<_, Option<i64>>(2)?.map(|v| v.to_string()),
                side: r.get(3)?,
                kind: r.get(4)?,
                counted: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let known: BTreeSet<&str> = entries
        .iter()
        .filter(|e| e.amount_cents.is_some())
        .map(|e| e.account_id.as_str())
        .collect();
    let missing = live
        .iter()
        .filter(|a| due(a, &day) && !known.contains(a.id.as_str()))
        .map(|a| a.id.clone())
        .collect();
    Ok(Some(Snapshot {
        id: id.into(),
        date: day,
        notes,
        revision,
        entries,
        missing,
    }))
}

fn receipt(c: &Connection, id: &str, fingerprint: &str) -> Result<Option<String>> {
    let prior: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match prior {
        Some((f, _)) if f != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"))
        }
        Some((_, result)) => Ok(Some(result)),
        None => Ok(None),
    }
}

fn amount(value: Option<&str>) -> Result<Option<i64>> {
    cents(value).map_err(|_| Error::new("WEALTH_AMOUNT", "金额须为非负整数分"))
}

/// `a * 10000 / b` rounded half away from zero, i.e. hundredths of a percent.
fn hundredths(a: i128, b: i128) -> i64 {
    let n = a * 10000;
    let q = n / b;
    let r = n % b;
    let bump = if 2 * r.abs() >= b.abs() {
        n.signum() * b.signum()
    } else {
        0
    };
    (q + bump) as i64
}

fn sum(mut values: impl Iterator<Item = i64>) -> Result<i64> {
    values.try_fold(0i64, |t, v| {
        t.checked_add(v)
            .ok_or_else(|| Error::new("WEALTH_OVERFLOW", "金额合计超出范围"))
    })
}

impl Store {
    pub fn wealth_accounts(&self) -> Result<Vec<Account>> {
        accounts(self.conn()?)
    }

    pub fn wealth_account_save(&mut self, input: &AccountSave, today: &str) -> Result<Account> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wealth_account", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return account(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到账户"));
        }
        let f = &input.fields;
        f.validate(today)?;
        let old = input
            .id
            .as_deref()
            .map(|id| account(&tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到账户")))
            .transpose()?;
        if old.as_ref().map(|a| a.revision) != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "账户已变化，请重新读取"));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        if let Some(old) = &old {
            if old.fields.side != f.side {
                return Err(Error::new("ACCOUNT_SIDE", "资产/负债方向建立后不能更改"));
            }
            let outside: Option<String> = tx.query_row(
                "SELECT s.date FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL AND (s.date<?2 OR (?3 IS NOT NULL AND s.date>=?3)) ORDER BY s.date LIMIT 1",
                params![id, f.opened_on, f.closed_on],
                |r| r.get(0),
            ).optional()?;
            if let Some(day) = outside {
                return Err(Error::new(
                    "ACCOUNT_DATE",
                    &format!("{day} 的盘点已记录该账户，启用/停用日期须包含该日"),
                ));
            }
        }
        if let Some(closed) = &f.closed_on {
            // A closing account must leave with a recorded zero, so its last
            // balance cannot silently vanish from later net worth.
            let last: Option<Option<i64>> = tx.query_row(
                "SELECT e.amount_cents FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL AND s.date<?2 ORDER BY s.date DESC LIMIT 1",
                params![id, closed],
                |r| r.get(0),
            ).optional()?;
            if matches!(last, Some(v) if v != Some(0)) {
                return Err(Error::new(
                    "ACCOUNT_CLOSE_BALANCE",
                    "停用前请先在盘点中记录余额为 0",
                ));
            }
        }
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE fin_accounts SET name=?2,institution=?3,kind=?4,counted=?5,opened_on=?6,closed_on=?7,notes=?8,revision=revision+1,updated_at=?9 WHERE id=?1",
                params![id, f.name.trim(), f.institution.trim(), f.kind, f.counted, f.opened_on, f.closed_on, f.notes, now])?;
        } else {
            let position: i64 = tx.query_row(
                "SELECT coalesce(max(position)+1,0) FROM fin_accounts",
                [],
                |r| r.get(0),
            )?;
            tx.execute("INSERT INTO fin_accounts(id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11)",
                params![id, f.name.trim(), f.institution.trim(), f.side, f.kind, f.counted, f.opened_on, f.closed_on, f.notes, position, now])?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result = account(&tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到账户"))?;
        self.hit("wealth_account.before_commit")?;
        tx.commit()?;
        Ok(result)
    }

    pub fn wealth_snapshot(&self, id: &str) -> Result<Option<Snapshot>> {
        let c = self.conn()?;
        snapshot(c, id, &accounts(c)?)
    }

    pub fn wealth_snapshot_draft(&self, day: &str) -> Result<Draft> {
        date(day)?;
        let c = self.conn()?;
        let live = accounts(c)?;
        let existing: Option<String> = c
            .query_row(
                "SELECT id FROM fin_snapshots WHERE date=?1 AND deleted_at IS NULL",
                [day],
                |r| r.get(0),
            )
            .optional()?;
        let existing = existing
            .map(|id| snapshot(c, &id, &live))
            .transpose()?
            .flatten();
        let mut rows = Vec::new();
        for a in live.into_iter().filter(|a| due(a, day)) {
            let previous = observation_before(c, &a.id, Some(day))?;
            rows.push(DraftRow {
                account: a,
                previous,
            });
        }
        Ok(Draft {
            generation: self.generation(),
            date: day.into(),
            existing,
            rows,
        })
    }

    pub fn wealth_snapshot_save(&mut self, input: &SnapshotSave, today: &str) -> Result<Snapshot> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wealth_snapshot", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let live = accounts(&tx)?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return snapshot(&tx, &id, &live)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"));
        }
        date(&input.date)?;
        if input.date.as_str() > today {
            return Err(Error::new("SNAPSHOT_DATE", "盘点日期不能晚于今天"));
        }
        if input.notes.chars().count() > 10000 || input.notes.contains('\0') {
            return Err(Error::new(
                "SNAPSHOT_NOTES",
                "备注最多 10000 字，且不能含空字符",
            ));
        }
        let old = input
            .id
            .as_deref()
            .map(|id| {
                snapshot(&tx, id, &live)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"))
            })
            .transpose()?;
        if old.as_ref().map(|s| s.revision) != input.expected_revision {
            return Err(Error::new("REVISION_CONFLICT", "盘点已变化，请重新读取"));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        let clash: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM fin_snapshots WHERE date=?1 AND deleted_at IS NULL AND id!=?2)",
            params![input.date, id],
            |r| r.get(0),
        )?;
        if clash {
            return Err(Error::new(
                "SNAPSHOT_DATE_TAKEN",
                "这一天已有盘点，请打开原盘点更正",
            ));
        }
        let expected: BTreeMap<&str, &Account> = live
            .iter()
            .filter(|a| due(a, &input.date))
            .map(|a| (a.id.as_str(), a))
            .collect();
        let mut seen = BTreeSet::new();
        for e in &input.entries {
            if !expected.contains_key(e.account_id.as_str()) {
                return Err(Error::new(
                    "SNAPSHOT_ACCOUNT",
                    "有账户不在该日期的盘点范围内，请重新读取",
                ));
            }
            if !seen.insert(e.account_id.as_str()) {
                return Err(Error::new("SNAPSHOT_ACCOUNT", "同一账户只能填写一次"));
            }
        }
        if seen.len() != expected.len() {
            return Err(Error::new(
                "SNAPSHOT_INCOMPLETE_ROWS",
                "盘点须包含该日期的全部账户，可标为未知",
            ));
        }
        // Corrections keep each existing row's recorded classification.
        let kept: BTreeMap<&str, &Entry> = old
            .iter()
            .flat_map(|s| s.entries.iter())
            .map(|e| (e.account_id.as_str(), e))
            .collect();
        let mut rows = Vec::new();
        for e in &input.entries {
            let given = amount(e.amount_cents.as_deref())?;
            let value = match e.state.as_str() {
                "entered" => Some(
                    given.ok_or_else(|| Error::new("WEALTH_AMOUNT", "请填写金额，或标为未知"))?,
                ),
                "missing" => {
                    if given.is_some() {
                        return Err(Error::new("WEALTH_AMOUNT", "未知金额不能同时填写数字"));
                    }
                    None
                }
                "unchanged" => {
                    let prev = observation_before(&tx, &e.account_id, Some(&input.date))?
                        .ok_or_else(|| {
                            Error::new("SNAPSHOT_UNCHANGED", "没有更早的金额可确认未变")
                        })?;
                    let prev: i64 = prev
                        .amount_cents
                        .parse()
                        .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?;
                    if given.is_some_and(|g| g != prev) {
                        return Err(Error::new(
                            "SNAPSHOT_UNCHANGED",
                            "确认未变的金额须与上次相同",
                        ));
                    }
                    Some(prev)
                }
                _ => return Err(Error::new("SNAPSHOT_STATE", "请选择填写、未变或未知")),
            };
            let a = expected[e.account_id.as_str()];
            let (side, kind, counted) = kept
                .get(e.account_id.as_str())
                .map(|k| (k.side.clone(), k.kind.clone(), k.counted))
                .unwrap_or((
                    a.fields.side.clone(),
                    a.fields.kind.clone(),
                    a.fields.counted,
                ));
            rows.push((e, value, side, kind, counted));
        }
        let now = chrono::Utc::now().to_rfc3339();
        if old.is_some() {
            tx.execute("UPDATE fin_snapshots SET date=?2,notes=?3,revision=revision+1,updated_at=?4 WHERE id=?1", params![id, input.date, input.notes, now])?;
            tx.execute(
                "DELETE FROM fin_snapshot_entries WHERE snapshot_id=?1",
                [&id],
            )?;
        } else {
            tx.execute("INSERT INTO fin_snapshots(id,date,notes,revision,created_at,updated_at) VALUES(?1,?2,?3,1,?4,?4)", params![id, input.date, input.notes, now])?;
        }
        for (e, value, side, kind, counted) in rows {
            tx.execute(
                "INSERT INTO fin_snapshot_entries VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![id, e.account_id, e.state, value, side, kind, counted],
            )?;
        }
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        let result =
            snapshot(&tx, &id, &live)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"))?;
        self.hit("wealth_snapshot.before_commit")?;
        tx.commit()?;
        self.hit("wealth_snapshot.after_commit")?;
        Ok(result)
    }

    /// Result ID of an earlier account or check-in request, for a reply that
    /// never arrived; `None` means it did not commit and may be resent as is.
    pub fn wealth_request_result(&self, request: &str, generation: &str) -> Result<Option<String>> {
        self.check_generation(generation)?;
        Ok(self
            .conn()?
            .query_row(
                "SELECT result FROM feature_requests WHERE id=?1",
                [request],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn wealth_summary(&self) -> Result<Summary> {
        let c = self.conn()?;
        let live = accounts(c)?;
        let mut q =
            c.prepare("SELECT id FROM fin_snapshots WHERE deleted_at IS NULL ORDER BY date")?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut points: Vec<Point> = Vec::new();
        let mut last_complete: Option<(Snapshot, i64)> = None;
        for id in ids {
            let s = snapshot(c, &id, &live)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"))?;
            let known = |side: &'static str| {
                s.entries
                    .iter()
                    .filter(move |e| e.counted && e.side == side)
                    .filter_map(|e| e.amount_cents.as_deref()?.parse::<i64>().ok())
            };
            let assets = sum(known("asset"))?;
            let liabilities = sum(known("liability"))?;
            let net = assets - liabilities;
            let complete = s.missing.is_empty();
            let mut point = Point {
                snapshot_id: s.id.clone(),
                date: s.date.clone(),
                assets_cents: assets.to_string(),
                liabilities_cents: liabilities.to_string(),
                net_cents: net.to_string(),
                complete,
                missing: s.missing.len(),
                compared_to: None,
                scope_changed: false,
                change_cents: None,
                change_rate_hundredths: None,
            };
            if complete {
                if let Some((prev, prev_net)) = &last_complete {
                    point.compared_to = Some(prev.date.clone());
                    let before: BTreeMap<&str, bool> = prev
                        .entries
                        .iter()
                        .map(|e| (e.account_id.as_str(), e.counted))
                        .collect();
                    point.scope_changed = s.entries.iter().any(|e| {
                        before
                            .get(e.account_id.as_str())
                            .is_some_and(|b| *b != e.counted)
                    });
                    if !point.scope_changed {
                        let change = net - prev_net;
                        point.change_cents = Some(change.to_string());
                        if *prev_net > 0 {
                            point.change_rate_hundredths =
                                Some(hundredths(change as i128, *prev_net as i128));
                        }
                    }
                }
                last_complete = Some((s, net));
            }
            points.push(point);
        }
        let (mut structure, mut liabilities, mut structure_date) = (vec![], vec![], None);
        if let Some((s, _)) = &last_complete {
            structure_date = Some(s.date.clone());
            for (side, out) in [("asset", &mut structure), ("liability", &mut liabilities)] {
                let mut by_kind: BTreeMap<&str, i64> = BTreeMap::new();
                for e in s.entries.iter().filter(|e| e.counted && e.side == side) {
                    let v: i64 = e
                        .amount_cents
                        .as_deref()
                        .unwrap_or("0")
                        .parse()
                        .unwrap_or(0);
                    let slot = by_kind.entry(e.kind.as_str()).or_default();
                    *slot = slot
                        .checked_add(v)
                        .ok_or_else(|| Error::new("WEALTH_OVERFLOW", "金额合计超出范围"))?;
                }
                let total = sum(by_kind.values().copied())?;
                let order: &[&str] = if side == "asset" {
                    &ASSET_KINDS
                } else {
                    &LIABILITY_KINDS
                };
                for kind in order {
                    if let Some(v) = by_kind.get(kind) {
                        out.push(Share {
                            kind: (*kind).into(),
                            amount_cents: v.to_string(),
                            share_hundredths: (total > 0)
                                .then(|| hundredths(*v as i128, total as i128)),
                        });
                    }
                }
            }
        }
        Ok(Summary {
            generation: self.generation(),
            points,
            structure_date,
            structure,
            liabilities,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashChange {
    pub request_id: String,
    pub generation: String,
    /// `snapshot`, `account`, `expense`, `plan`, `payment` or `wish`.
    pub kind: String,
    pub id: String,
    pub expected_revision: i64,
    pub deleted: bool,
}

impl Store {
    /// Soft delete or restore of one check-in or one mistaken account. Only an
    /// account that never appeared in any check-in may be deleted; others are
    /// closed instead. Restoring a check-in re-checks what may have changed
    /// while it was deleted: its date and the accounts' open periods.
    pub fn wealth_trash(&mut self, input: &TrashChange) -> Result<()> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wealth_trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if receipt(&tx, &input.request_id, &fingerprint)?.is_some() {
            return Ok(());
        }
        let table = match input.kind.as_str() {
            "snapshot" => "fin_snapshots",
            "account" => "fin_accounts",
            "expense" => "expenses",
            "plan" => "recurring_plans",
            "payment" => "plan_payments",
            "wish" => "wishlist_items",
            _ => return Err(Error::new("TRASH_KIND", "不支持的类型")),
        };
        let current: Option<(i64, Option<String>)> = tx
            .query_row(
                &format!("SELECT revision,deleted_at FROM {table} WHERE id=?1"),
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (revision, deleted_at) =
            current.ok_or_else(|| Error::new("NOT_FOUND", "找不到这条记录"))?;
        if revision != input.expected_revision || deleted_at.is_some() == input.deleted {
            return Err(Error::new("REVISION_CONFLICT", "记录已变化，请重新读取"));
        }
        if input.kind == "account" && input.deleted {
            let used: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM fin_snapshot_entries WHERE account_id=?1)",
                [&input.id],
                |r| r.get(0),
            )?;
            if used {
                return Err(Error::new(
                    "ACCOUNT_HAS_HISTORY",
                    "这个账户已出现在盘点中，请改为停用",
                ));
            }
        }
        if input.kind == "snapshot" && !input.deleted {
            let day: String = tx.query_row(
                "SELECT date FROM fin_snapshots WHERE id=?1",
                [&input.id],
                |r| r.get(0),
            )?;
            let taken: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM fin_snapshots WHERE date=?1 AND deleted_at IS NULL)",
                [&day],
                |r| r.get(0),
            )?;
            if taken {
                return Err(Error::new(
                    "SNAPSHOT_DATE_TAKEN",
                    &format!("{day} 已有另一份盘点，不能恢复；可打开那份盘点更正"),
                ));
            }
            let outside: Option<String> = tx.query_row(
                "SELECT a.name FROM fin_snapshot_entries e JOIN fin_accounts a ON a.id=e.account_id WHERE e.snapshot_id=?1 AND (a.deleted_at IS NOT NULL OR ?2<a.opened_on OR (a.closed_on IS NOT NULL AND ?2>=a.closed_on)) LIMIT 1",
                params![input.id, day],
                |r| r.get(0),
            ).optional()?;
            if let Some(name) = outside {
                return Err(Error::new(
                    "SNAPSHOT_ACCOUNT",
                    &format!("「{name}」的启用/停用日期已不包含 {day}，请先调整账户日期"),
                ));
            }
        }
        if input.kind == "payment" && !input.deleted {
            // A payment comes back only under a live plan and into a free period.
            let (plan_live, taken): (bool, bool) = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM recurring_plans r WHERE r.id=p.plan_id AND r.deleted_at IS NULL),EXISTS(SELECT 1 FROM plan_payments o WHERE o.plan_id=p.plan_id AND o.due_date=p.due_date AND o.deleted_at IS NULL AND o.id!=p.id) FROM plan_payments p WHERE p.id=?1",
                [&input.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            if !plan_live {
                return Err(Error::new(
                    "PARENT_DELETED",
                    "所属计划仍在最近删除中，请先恢复计划",
                ));
            }
            if taken {
                return Err(Error::new(
                    "PAYMENT_EXISTS",
                    "这一期已有新的记录，不能恢复；可打开那条记录更正",
                ));
            }
        }
        let stamp = input.deleted.then(|| chrono::Utc::now().to_rfc3339());
        tx.execute(
            &format!("UPDATE {table} SET deleted_at=?2,revision=revision+1 WHERE id=?1"),
            params![input.id, stamp],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, input.id],
        )?;
        self.hit("wealth_trash.before_commit")?;
        tx.commit()?;
        Ok(())
    }
}

/// Backup validation for schema 15 data beyond what SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = |m: &str| Error::new("DATA_CONSTRAINT", m);
    let mut q = c.prepare(&format!(
        "SELECT {ACCOUNT_COLUMNS},created_at,updated_at FROM fin_accounts"
    ))?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let a = account_row(r)?;
        if uuid::Uuid::parse_str(&a.id).is_err() || a.revision < 1 {
            return Err(bad("备份含非法账户资料"));
        }
        a.fields
            .validate("9999-12-31")
            .map_err(|_| bad("备份含非法账户资料"))?;
        for i in [11, 12] {
            chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(i)?)
                .map_err(|_| bad("账户建档或修改时间不合法"))?;
        }
    }
    let mut q = c.prepare("SELECT id,date,notes,revision FROM fin_snapshots")?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let id: String = r.get(0)?;
        let day: String = r.get(1)?;
        let notes: String = r.get(2)?;
        if uuid::Uuid::parse_str(&id).is_err()
            || date(&day).is_err()
            || notes.contains('\0')
            || r.get::<_, i64>(3)? < 1
        {
            return Err(bad("备份含非法盘点资料"));
        }
    }
    let mismatch: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM fin_snapshot_entries e JOIN fin_accounts a ON a.id=e.account_id JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.side!=a.side OR (s.deleted_at IS NULL AND (s.date<a.opened_on OR (a.closed_on IS NOT NULL AND s.date>=a.closed_on))))",
        [],
        |r| r.get(0),
    )?;
    if mismatch {
        return Err(bad("盘点条目与账户方向或启用期间不符"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::hundredths;
    #[test]
    fn rate_rounds_half_away_from_zero() {
        assert_eq!(hundredths(10_000, 330_000), 303);
        assert_eq!(hundredths(-10_000, 330_000), -303);
        assert_eq!(hundredths(1, 200), 50);
        assert_eq!(hundredths(1, 8), 1250);
        assert_eq!(hundredths(1, 80_000), 0);
        assert_eq!(hundredths(1, 20_000), 1);
    }
}
