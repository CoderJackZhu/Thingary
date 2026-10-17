//! Accounts, liabilities and dated check-ins (ADR-001 §17). Amounts are
//! non-negative cents whose sign comes from the account side; completeness and
//! comparability are derived on read so later account edits cannot leave a
//! stale stored flag behind.
use crate::{
    domain::{cents, date, Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const ASSET_KINDS: [&str; 13] = [
    "cash",
    "investment",
    "mixed",
    "fund",
    "bond",
    "housing_fund",
    "other_asset",
    "property",
    "pension",
    "insurance",
    "precious_metal",
    "receivable",
    "vehicle",
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase_cents: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchased_on: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(
        default = "crate::currency::cny",
        skip_serializing_if = "crate::currency::is_cny"
    )]
    pub currency: String,
    #[serde(default, skip_serializing_if = "crate::holdings::is_false")]
    pub holding_mode: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holding_unit: Option<String>,
}
impl AccountFields {
    fn validate(&self, today: &str) -> Result<()> {
        if !crate::currency::valid(&self.currency) {
            return Err(Error::new("ACCOUNT_CURRENCY", "币种须为三位大写字母"));
        }
        if (self.holding_mode && !crate::holdings::supported(&self.kind))
            || (!self.holding_mode && self.holding_unit.is_some())
            || self.holding_unit.as_ref().is_some_and(|u| {
                u.trim().is_empty() || u.chars().count() > 8 || u.chars().any(char::is_control)
            })
        {
            return Err(Error::new(
                "ACCOUNT_HOLDING",
                "仅投资类账户可按持仓记录；单位须为1–8字",
            ));
        }
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
        validate_kind_counted(&self.kind, self.counted)?;
        if (self.purchase_cents.is_some() || self.purchased_on.is_some())
            && !matches!(self.kind.as_str(), "property" | "vehicle")
        {
            return Err(Error::new(
                "ACCOUNT_PURCHASE",
                "只有房产和车辆可以填写购入价和购入日期",
            ));
        }
        cents(self.purchase_cents.as_deref())?;
        if let Some(day) = &self.purchased_on {
            date(day)?;
            if day.as_str() < "1900-01-01" || day.as_str() > today {
                return Err(Error::new(
                    "ACCOUNT_PURCHASE",
                    "购入日期须在 1900-01-01 至今天之间",
                ));
            }
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

/// Shared invariant for current accounts and independently recorded historical entries.
pub(crate) fn validate_kind_counted(kind: &str, counted: bool) -> Result<()> {
    if kind == "property" && counted {
        return Err(Error::new(
            "PROPERTY_COUNTED",
            "房产仅单独记录估值，不能计入金融净资产",
        ));
    }
    Ok(())
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_minor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx_rate_micro: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity_e8: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price_e6: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: String,
    pub fields: AccountFields,
    pub position: i64,
    pub revision: i64,
    /// Latest known amount from a live check-in, with that check-in's date.
    pub latest: Option<Observation>,
    /// Date of the latest explicitly entered balance in a live check-in.
    pub last_entered_on: Option<String>,
    #[serde(default)]
    pub has_entries: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryInput {
    pub account_id: String,
    pub state: String,
    pub amount_cents: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_minor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx_rate_micro: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity_e8: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price_e6: Option<String>,
}

/// One account's new balance in a quick update. `expected_previous` is the
/// amount the user saw; it is required for adjustments and transfers so a
/// stale screen cannot overwrite a newer balance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickChange {
    pub account_id: String,
    pub amount_cents: String,
    #[serde(default)]
    pub expected_previous: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_minor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx_rate_micro: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity_e8: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price_e6: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_original_minor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_quantity_e8: Option<String>,
}

/// Update one account (or two, for a transfer) without a full check-in. It is
/// saved as a check-in on `date`: other accounts carry their latest amount as
/// `unchanged`, or keep their row when that day already has a check-in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickUpdate {
    pub request_id: String,
    pub generation: String,
    pub date: String,
    #[serde(default)]
    pub note: String,
    pub changes: Vec<QuickChange>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_minor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx_rate_micro: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity_e8: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price_e6: Option<String>,
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
pub struct RateSuggestion {
    pub rate: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Draft {
    pub generation: String,
    #[serde(default)]
    pub rate_suggestions: BTreeMap<String, RateSuggestion>,
    pub date: String,
    pub existing: Option<Snapshot>,
    pub rows: Vec<DraftRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Point {
    pub snapshot_id: String,
    pub date: String,
    pub notes: String,
    pub assets_cents: String,
    pub liabilities_cents: String,
    pub net_cents: String,
    /// Counted cash balance using entry-time kind/counting; unknown if incomplete.
    pub liquid_cents: Option<String>,
    /// Counted investment/mixed/fund/bond/precious-metal balance; unlike
    /// market_change_cents this includes precious metals. Unknown if incomplete.
    pub invested_cents: Option<String>,
    pub complete: bool,
    #[serde(default)]
    pub has_unchanged: bool,
    pub missing: usize,
    /// Earlier complete check-in this point is compared with.
    pub compared_to: Option<String>,
    /// True when a shared account changed whether it counts; no change is given.
    pub scope_changed: bool,
    pub change_cents: Option<String>,
    /// Change of the counted housing fund accounts alone; `None` when no such
    /// account is counted at either end (or the change is not given).
    pub hpf_change_cents: Option<String>,
    /// Change of the counted investment, mixed, fund and bond accounts alone
    /// (transfers in and market moves are not told apart); `None` when none is
    /// counted at either end or the change is not given.
    pub market_change_cents: Option<String>,
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
    #[serde(default)]
    pub structure_entries: Vec<Entry>,
    #[serde(default)]
    pub latest_entries: Vec<Entry>,
    pub structure: Vec<Share>,
    pub liabilities: Vec<Share>,
}

// ---- U20 账户变化与盘点比较（产品设计 17.14，只读） ------------------------

/// One account's recorded cell at one end of a comparison.
#[derive(Debug, Clone, Serialize)]
pub struct CompareCell {
    /// entered | unchanged | missing | not_open | closed
    pub state: String,
    /// entered/unchanged carry the amount; not_open/closed are None but count as zero.
    pub amount_cents: Option<String>,
    /// The check-in row's recorded setting; None without a row.
    pub counted: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompareRow {
    pub account_id: String,
    pub name: String,
    pub institution: String,
    pub side: String,
    /// The to-end row's kind, else the from-end's, else the account's current one.
    pub kind: String,
    pub from: CompareCell,
    pub to: CompareCell,
    /// Own-direction change (to − from); None while either end is unknown.
    pub change_cents: Option<String>,
    /// Assets equal the change, liabilities are negated (17.14.4.2).
    pub effect_cents: Option<String>,
    /// Only for assets whose starting amount is known and positive.
    pub rate_hundredths: Option<i64>,
    /// counted | uncounted | scope_changed
    pub group: String,
    /// new（起点未启用）| closed（终点已停用）| None
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompareEnd {
    pub snapshot_id: String,
    pub date: String,
    pub notes: String,
    pub complete: bool,
    pub missing: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StructurePair {
    pub kind: String,
    pub from_cents: Option<String>,
    pub from_share: Option<i64>,
    pub to_cents: Option<String>,
    pub to_share: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Compare {
    pub generation: String,
    pub from: CompareEnd,
    pub to: CompareEnd,
    /// Both ends complete and no scope_changed row; only then do the totals
    /// and the rate carry values.
    pub reconciled: bool,
    pub net_change_cents: Option<String>,
    pub assets_change_cents: Option<String>,
    pub liabilities_change_cents: Option<String>,
    pub net_rate_hundredths: Option<i64>,
    /// Sum of known effects in the counted group; always present.
    pub known_effect_cents: String,
    /// Counted-group accounts unknown at either end.
    pub missing_names: Vec<String>,
    /// In account position order; the front end sorts for display.
    pub rows: Vec<CompareRow>,
    /// Assets by kind, ASSET_KINDS order, union of both ends.
    pub structure: Vec<StructurePair>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryRow {
    pub snapshot_id: String,
    pub date: String,
    pub state: String,
    pub amount_cents: Option<String>,
    pub counted: bool,
    /// Own-direction change from the immediately preceding row, when both are known.
    pub change_cents: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_minor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fx_rate_micro: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity_e8: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price_e6: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountHistory {
    pub generation: String,
    pub account: Account,
    pub rows: Vec<HistoryRow>,
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
            purchase_cents: r.get::<_, Option<i64>>(11)?.map(|v| v.to_string()),
            purchased_on: r.get(12)?,
            group_id: r.get(13)?,
            currency: r.get(14)?,
            holding_mode: r.get(15)?,
            holding_unit: r.get(16)?,
        },
        position: r.get(9)?,
        revision: r.get(10)?,
        latest: None,
        last_entered_on: None,
        has_entries: false,
    })
}
const ACCOUNT_COLUMNS: &str =
    "id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,purchase_cents,purchased_on,group_id,currency,holding_mode,holding_unit";

fn account_columns(c: &Connection) -> Result<&'static str> {
    // Old backup validation and historical planning reads can precede migration.
    // Schema 43+ always reads real columns, preserving strict structure checks.
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    Ok(if version < 43 {
        "id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,NULL,NULL,NULL,'CNY',0,NULL"
    } else {
        ACCOUNT_COLUMNS
    })
}

pub(crate) fn accounts(c: &Connection) -> Result<Vec<Account>> {
    accounts_cancellable(c, &|| Ok(()))
}
/// Import previews may cancel while scanning an already populated directory.
/// Ordinary reads retain the same ordering and observations without cancellation.
pub(crate) fn accounts_cancellable(
    c: &Connection,
    check: &dyn Fn() -> Result<()>,
) -> Result<Vec<Account>> {
    let columns = account_columns(c)?;
    let mut q = c.prepare(&format!(
        "SELECT {columns} FROM fin_accounts WHERE deleted_at IS NULL ORDER BY position,id"
    ))?;
    let mut list = Vec::new();
    for row in q.query_map([], account_row)? {
        check()?;
        list.push(row?);
    }
    for a in &mut list {
        check()?;
        a.latest = observation_before(c, &a.id, None)?;
        a.last_entered_on = last_entered_on(c, &a.id)?;
        a.has_entries = has_entries(c, &a.id)?;
    }
    Ok(list)
}

pub(crate) fn account(c: &Connection, id: &str) -> Result<Option<Account>> {
    let columns = account_columns(c)?;
    let found = c
        .query_row(
            &format!("SELECT {columns} FROM fin_accounts WHERE id=?1 AND deleted_at IS NULL"),
            [id],
            account_row,
        )
        .optional()?;
    found
        .map(|mut a| {
            a.latest = observation_before(c, &a.id, None)?;
            a.last_entered_on = last_entered_on(c, &a.id)?;
            a.has_entries = has_entries(c, &a.id)?;
            Ok(a)
        })
        .transpose()
}

fn has_entries(c: &Connection, id: &str) -> Result<bool> {
    Ok(c.query_row(
        "SELECT EXISTS(SELECT 1 FROM fin_snapshot_entries WHERE account_id=?1)",
        [id],
        |r| r.get(0),
    )?)
}
fn fx_columns(c: &Connection) -> Result<&'static str> {
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    Ok(if v < 43 {
        "NULL,NULL,NULL,NULL"
    } else {
        "e.original_minor,e.fx_rate_micro,e.quantity_e8,e.unit_price_e6"
    })
}
/// Latest explicit balance date; carried observations do not refresh it.
fn last_entered_on(c: &Connection, account: &str) -> Result<Option<String>> {
    Ok(c.query_row(
        "SELECT max(s.date) FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND e.state='entered' AND s.deleted_at IS NULL",
        [account], |r| r.get(0),
    )?)
}

/// Latest known amount in a live check-in strictly before `before` (or ever).
fn observation_before(
    c: &Connection,
    account: &str,
    before: Option<&str>,
) -> Result<Option<Observation>> {
    let fx = fx_columns(c)?;
    Ok(c.query_row(
        &format!("SELECT e.amount_cents,s.date,{fx} FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL AND e.amount_cents IS NOT NULL AND (?2 IS NULL OR s.date<?2) ORDER BY s.date DESC LIMIT 1"),
        params![account, before],
        |r| Ok(Observation { amount_cents: r.get::<_, i64>(0)?.to_string(), date: r.get(1)?, original_minor: r.get::<_, Option<i64>>(2)?.map(|v|v.to_string()), fx_rate_micro: r.get::<_, Option<i64>>(3)?.map(|v|v.to_string()), quantity_e8: r.get::<_, Option<i64>>(4)?.map(|v|v.to_string()), unit_price_e6: r.get::<_, Option<i64>>(5)?.map(|v|v.to_string()) }),
    ).optional()?)
}

pub(crate) fn due(a: &Account, day: &str) -> bool {
    a.fields.opened_on.as_str() <= day && a.fields.closed_on.as_deref().is_none_or(|c| day < c)
}

pub(crate) fn snapshot(c: &Connection, id: &str, live: &[Account]) -> Result<Option<Snapshot>> {
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
    let fx = fx_columns(c)?;
    let mut q = c.prepare(&format!("SELECT e.account_id,e.state,e.amount_cents,e.side,e.kind,e.counted,{fx} FROM fin_snapshot_entries e JOIN fin_accounts a ON a.id=e.account_id WHERE e.snapshot_id=?1 ORDER BY a.position,a.id"))?;
    let entries = q
        .query_map([id], |r| {
            Ok(Entry {
                account_id: r.get(0)?,
                state: r.get(1)?,
                amount_cents: r.get::<_, Option<i64>>(2)?.map(|v| v.to_string()),
                side: r.get(3)?,
                kind: r.get(4)?,
                counted: r.get(5)?,
                original_minor: r.get::<_, Option<i64>>(6)?.map(|v| v.to_string()),
                fx_rate_micro: r.get::<_, Option<i64>>(7)?.map(|v| v.to_string()),
                quantity_e8: r.get::<_, Option<i64>>(8)?.map(|v| v.to_string()),
                unit_price_e6: r.get::<_, Option<i64>>(9)?.map(|v| v.to_string()),
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

/// Validate an entire stored currency fact, preserving CNY as the sole downstream amount.
pub(crate) fn validate_fx(
    code: &str,
    value: Option<i64>,
    original: Option<&str>,
    rate: Option<&str>,
) -> Result<(Option<i64>, Option<i64>)> {
    let error = |m| Error::new("FX_MISMATCH", m);
    if code == "CNY" || value.is_none() {
        if original.is_some() || rate.is_some() {
            return Err(error("人民币或未知金额不能同时填写原币金额和汇率"));
        }
        return Ok((None, None));
    }
    let original = original.ok_or_else(|| error("外币金额和汇率都须填写"))?;
    let rate = rate.ok_or_else(|| error("外币金额和汇率都须填写"))?;
    let original = crate::currency::integer(original).map_err(error)?;
    let rate = crate::currency::integer(rate).map_err(error)?;
    let converted = crate::currency::convert(code, original, rate).map_err(error)?;
    if value != Some(converted) {
        return Err(error("原币金额与汇率折算的人民币金额不一致"));
    }
    Ok((Some(original), Some(rate)))
}

/// Validate historical facts independently of the account's current input mode.
pub(crate) fn validate_holding(
    code: &str,
    value: Option<i64>,
    original: Option<i64>,
    quantity: Option<&str>,
    price: Option<&str>,
) -> Result<(Option<i64>, Option<i64>)> {
    let err = |m| Error::new("HOLDING_MISMATCH", m);
    if quantity.is_none() && price.is_none() {
        return Ok((None, None));
    }
    if value.is_none() {
        return Err(err("未知金额不能填写份额和单价"));
    }
    let q = crate::currency::integer(quantity.ok_or_else(|| err("请同时填写份额和单价"))?)
        .map_err(err)?;
    let p =
        crate::currency::integer(price.ok_or_else(|| err("请同时填写份额和单价"))?).map_err(err)?;
    let minor = crate::holdings::minor(q, p, crate::currency::decimals(code)).map_err(err)?;
    if Some(minor) != if code == "CNY" { value } else { original } {
        return Err(err("份额与单价计算的金额不一致"));
    }
    Ok((Some(q), Some(p)))
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

fn overflow_error() -> Error {
    Error::new("WEALTH_OVERFLOW", "金额合计超出范围")
}

/// Counted known (assets, liabilities) of one check-in; unknown amounts are
/// never treated as zero.
fn net_of(s: &Snapshot) -> Result<(i64, i64)> {
    let known = |side: &'static str| {
        s.entries
            .iter()
            .filter(move |e| e.counted && e.side == side)
            .filter_map(|e| e.amount_cents.as_deref()?.parse::<i64>().ok())
    };
    Ok((sum(known("asset"))?, sum(known("liability"))?))
}

/// Counted housing fund balance of a check-in; `None` when none is counted.
fn hpf_of(s: &Snapshot) -> Result<Option<i64>> {
    let kind = |e: &&Entry| e.counted && e.side == "asset" && e.kind == "housing_fund";
    if !s.entries.iter().any(|e| kind(&e)) {
        return Ok(None);
    }
    Ok(Some(sum(s.entries.iter().filter(kind).filter_map(|e| {
        e.amount_cents.as_deref()?.parse::<i64>().ok()
    }))?))
}

/// Counted balance of the accounts whose value moves with markets (investment,
/// mixed, fund, bond and precious metals); `None` when none is counted.
fn market_of(s: &Snapshot) -> Result<Option<i64>> {
    let kind = |e: &&Entry| {
        e.counted
            && e.side == "asset"
            && matches!(
                e.kind.as_str(),
                "investment" | "mixed" | "fund" | "bond" | "precious_metal"
            )
    };
    if !s.entries.iter().any(|e| kind(&e)) {
        return Ok(None);
    }
    Ok(Some(sum(s.entries.iter().filter(kind).filter_map(|e| {
        e.amount_cents.as_deref()?.parse::<i64>().ok()
    }))?))
}

/// Per-kind totals of counted known amounts in kind-list order. `wealth_summary`
/// only feeds it complete check-ins (every counted entry then has an amount);
/// `wealth_compare` also feeds partial ones, where unknown amounts are skipped,
/// not zeroed (17.14.4.4).
fn structure_of(s: &Snapshot, side: &str) -> Result<Vec<Share>> {
    let mut by_kind: BTreeMap<&str, i64> = BTreeMap::new();
    for e in s
        .entries
        .iter()
        .filter(|e| e.counted && e.side == side && e.amount_cents.is_some())
    {
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
    let mut out = Vec::new();
    for kind in order {
        if let Some(v) = by_kind.get(kind) {
            out.push(Share {
                kind: (*kind).into(),
                amount_cents: v.to_string(),
                share_hundredths: (total > 0).then(|| hundredths(*v as i128, total as i128)),
            });
        }
    }
    Ok(out)
}

pub(crate) fn write_account_tx(
    tx: &Transaction<'_>,
    input: &AccountSave,
    today: &str,
    new_id: Option<&str>,
    defer_history: bool,
    new_position: Option<i64>,
) -> Result<Account> {
    let f = &input.fields;
    let old = input
        .id
        .as_deref()
        .map(|id| account(tx, id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到账户")))
        .transpose()?;
    if old.as_ref().map(|a| a.revision) != input.expected_revision {
        return Err(Error::new("REVISION_CONFLICT", "账户已变化，请重新读取"));
    }
    if old.as_ref().is_some_and(|a| {
        matches!(a.fields.kind.as_str(), "property" | "vehicle")
            && !matches!(f.kind.as_str(), "property" | "vehicle")
            && (a.fields.purchase_cents.is_some() || a.fields.purchased_on.is_some())
    }) {
        return Err(Error::new(
            "ACCOUNT_PURCHASE",
            "请先清空并保存购入价和购入日期，再更改类型",
        ));
    }
    f.validate(today)?;
    if let Some(group) = &f.group_id {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM fin_account_groups WHERE id=?1)",
            [group],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(Error::new("GROUP_NOT_FOUND", "分组已删除，请重新选择"));
        }
    }
    if old
        .as_ref()
        .is_some_and(|a| a.fields.currency != f.currency && a.has_entries)
    {
        return Err(Error::new(
            "ACCOUNT_CURRENCY",
            "已有记录的账户不能更改币种，请新建一个外币账户，再停用旧账户。",
        ));
    }
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| new_id.map(str::to_owned).unwrap_or_else(uid));
    if old.as_ref().is_some_and(|old| old.fields.side != f.side) {
        return Err(Error::new("ACCOUNT_SIDE", "资产/负债方向建立后不能更改"));
    }
    if !defer_history {
        validate_account_history_tx(tx, &id, f, old.is_some())?;
    }
    let now = chrono::Utc::now().to_rfc3339();
    if old.is_some() {
        tx.execute("UPDATE fin_accounts SET name=?2,institution=?3,kind=?4,counted=?5,opened_on=?6,closed_on=?7,notes=?8,purchase_cents=?10,purchased_on=?11,group_id=?12,currency=?13,holding_mode=?14,holding_unit=?15,revision=revision+1,updated_at=?9 WHERE id=?1",
                params![id, f.name.trim(), f.institution.trim(), f.kind, f.counted, f.opened_on, f.closed_on, f.notes, now, cents(f.purchase_cents.as_deref())?, f.purchased_on, f.group_id, f.currency, f.holding_mode, f.holding_unit])?;
    } else {
        let position = match new_position {
            Some(p) => p,
            None => tx.query_row(
                "SELECT coalesce(max(position)+1,0) FROM fin_accounts",
                [],
                |r| r.get::<_, i64>(0),
            )?,
        };
        tx.execute("INSERT INTO fin_accounts(id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,created_at,updated_at,purchase_cents,purchased_on,group_id,currency,holding_mode,holding_unit) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11,?12,?13,?14,?15,?16,?17)",
                params![id, f.name.trim(), f.institution.trim(), f.side, f.kind, f.counted, f.opened_on, f.closed_on, f.notes, position, now, cents(f.purchase_cents.as_deref())?, f.purchased_on, f.group_id, f.currency, f.holding_mode, f.holding_unit])?;
    }
    account(tx, &id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到账户"))
}

pub(crate) fn validate_account_history_tx(
    tx: &Transaction<'_>,
    id: &str,
    f: &AccountFields,
    existing: bool,
) -> Result<()> {
    if existing {
        let outside: Option<String> = tx.query_row("SELECT s.date FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL AND (s.date<?2 OR (?3 IS NOT NULL AND s.date>=?3)) ORDER BY s.date LIMIT 1", params![id, f.opened_on, f.closed_on], |r| r.get(0)).optional()?;
        if let Some(day) = outside {
            return Err(Error::new(
                "ACCOUNT_DATE",
                &format!("{day} 的盘点已记录该账户，启用/停用日期须包含该日"),
            ));
        }
    }
    if let Some(closed) = &f.closed_on {
        let last: Option<Option<i64>> = tx.query_row("SELECT e.amount_cents FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL AND s.date<?2 ORDER BY s.date DESC LIMIT 1", params![id, closed], |r| r.get(0)).optional()?;
        if matches!(last, Some(v) if v != Some(0)) {
            return Err(Error::new(
                "ACCOUNT_CLOSE_BALANCE",
                "停用前请先在盘点中记录余额为 0",
            ));
        }
    }
    Ok(())
}

pub(crate) type HistoricalOverrides = BTreeMap<String, (Option<String>, Option<bool>)>;
/// Translate a quick update into the full check-in that `write_snapshot_tx`
/// validates and writes, so both paths share every invariant.
fn quick_update_plan(
    tx: &Transaction<'_>,
    input: &QuickUpdate,
    today: &str,
    live: &[Account],
) -> Result<SnapshotSave> {
    date(&input.date)?;
    if input.date.as_str() > today {
        return Err(Error::new("SNAPSHOT_DATE", "盘点日期不能晚于今天"));
    }
    let latest: Option<String> = tx.query_row(
        "SELECT max(date) FROM fin_snapshots WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )?;
    if latest.as_deref().is_some_and(|d| input.date.as_str() < d) {
        return Err(Error::new("QUICK_DATE", "历史金额请到盘点记录里更正"));
    }
    if input.note.chars().count() > 500 || input.note.contains('\0') {
        return Err(Error::new("QUICK_NOTE", "备注最多 500 字，且不能含空字符"));
    }
    if !(1..=2).contains(&input.changes.len()) {
        return Err(Error::new(
            "QUICK_CHANGES",
            "一次只能更新一个账户或一笔转账",
        ));
    }
    let due_accounts: BTreeMap<&str, &Account> = live
        .iter()
        .filter(|a| due(a, &input.date))
        .map(|a| (a.id.as_str(), a))
        .collect();
    let existing: Option<Snapshot> = tx
        .query_row(
            "SELECT id FROM fin_snapshots WHERE date=?1 AND deleted_at IS NULL",
            [&input.date],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .map(|id| snapshot(tx, &id, live))
        .transpose()?
        .flatten();
    let kept: BTreeMap<&str, &Entry> = existing
        .iter()
        .flat_map(|s| s.entries.iter())
        .map(|e| (e.account_id.as_str(), e))
        .collect();
    let mut changed: BTreeMap<&str, &QuickChange> = BTreeMap::new();
    let mut effect: i128 = 0;
    if input.changes.len() == 2 {
        let first = &input.changes[0];
        let second = &input.changes[1];
        if let (Some(a), Some(b)) = (
            due_accounts.get(first.account_id.as_str()),
            due_accounts.get(second.account_id.as_str()),
        ) {
            // Validate the scope that this write will actually preserve, not
            // just the current account settings or an earlier UI preview.
            let counted = |account: &Account| {
                kept.get(account.id.as_str())
                    .map_or(account.fields.counted, |entry| entry.counted)
            };
            if counted(a) != counted(b) {
                return Err(Error::new(
                    "QUICK_TRANSFER",
                    "账户计入范围不同，请重新打开核对或分别修改余额",
                ));
            }
            if a.fields.holding_mode || b.fields.holding_mode {
                return Err(Error::new("QUICK_HOLDING", "持仓账户请用增减持仓"));
            }
            if a.fields.currency != b.fields.currency {
                return Err(Error::new(
                    "QUICK_CURRENCY",
                    "转账仅支持相同币种，请分别修改余额",
                ));
            }
            if a.fields.currency != "CNY" && first.fx_rate_micro != second.fx_rate_micro {
                return Err(Error::new(
                    "QUICK_CURRENCY",
                    "外币转账须共用同一汇率，请分别修改余额",
                ));
            }
        }
    }
    for change in &input.changes {
        let account = due_accounts
            .get(change.account_id.as_str())
            .ok_or_else(|| Error::new("SNAPSHOT_ACCOUNT", "这个账户不在该日期的盘点范围内"))?;
        let new = amount(Some(&change.amount_cents))?
            .ok_or_else(|| Error::new("WEALTH_AMOUNT", "请填写金额"))?;
        // The balance this day currently shows: the same-day row when there is
        // one (an unchanged row already holds its carried amount), else the
        // latest earlier amount.
        let current: Option<i64> = match kept.get(change.account_id.as_str()) {
            Some(e) => e
                .amount_cents
                .as_deref()
                .map(str::parse)
                .transpose()
                .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?,
            None => observation_before(tx, &change.account_id, Some(&input.date))?
                .map(|o| o.amount_cents.parse())
                .transpose()
                .map_err(|_| Error::new("FORMAT", "资料格式不兼容或损坏"))?,
        };
        validate_fx(
            &account.fields.currency,
            Some(new),
            change.original_minor.as_deref(),
            change.fx_rate_micro.as_deref(),
        )?;
        let original = match kept.get(change.account_id.as_str()) {
            Some(e) => e.original_minor.clone(),
            None => observation_before(tx, &change.account_id, Some(&input.date))?
                .and_then(|o| o.original_minor),
        };
        if account.fields.currency == "CNY" && change.expected_original_minor.is_some() {
            return Err(Error::new("FX_MISMATCH", "人民币账户不能填写原币金额"));
        }
        if account.fields.currency != "CNY" && change.expected_previous.is_some() {
            let expected = change
                .expected_original_minor
                .as_deref()
                .map(crate::currency::integer)
                .transpose()
                .map_err(|m| Error::new("FX_MISMATCH", m))?;
            let original = original
                .as_deref()
                .map(crate::currency::integer)
                .transpose()
                .map_err(|m| Error::new("FX_MISMATCH", m))?;
            if expected.is_none() || expected != original {
                return Err(Error::new("QUICK_STALE", "原币金额已经变化，请重新读取"));
            }
        }
        let quantity = match kept.get(change.account_id.as_str()) {
            Some(e) => e.quantity_e8.clone(),
            None => observation_before(tx, &change.account_id, Some(&input.date))?
                .and_then(|o| o.quantity_e8),
        };
        if account.fields.holding_mode
            && change.expected_previous.is_some()
            && (change.expected_quantity_e8.is_none() || change.expected_quantity_e8 != quantity)
        {
            return Err(Error::new("QUICK_STALE", "份额已经变化，请重新读取"));
        }
        let expected = amount(change.expected_previous.as_deref())?;
        if input.changes.len() == 2 && expected.is_none() {
            return Err(Error::new("QUICK_TRANSFER", "转账须基于两个账户的已知金额"));
        }
        if let Some(expected) = expected {
            if current != Some(expected) {
                return Err(Error::new(
                    "QUICK_STALE",
                    "账户金额已经变化，请重新打开后再试",
                ));
            }
        }
        if changed.insert(account.id.as_str(), change).is_some() {
            return Err(Error::new("SNAPSHOT_ACCOUNT", "同一账户只能填写一次"));
        }
        let delta = i128::from(new) - i128::from(current.unwrap_or(0));
        effect += if account.fields.side == "asset" {
            delta
        } else {
            -delta
        };
    }
    if input.changes.len() == 2 && effect != 0 {
        return Err(Error::new(
            "QUICK_TRANSFER",
            "折算或舍入使人民币变化无法抵消，请分别修改余额",
        ));
    }
    let mut entries = Vec::new();
    for id in due_accounts.keys() {
        let entry = if let Some(new) = changed.get(id) {
            EntryInput {
                account_id: (*id).into(),
                state: "entered".into(),
                amount_cents: Some(new.amount_cents.clone()),
                original_minor: new.original_minor.clone(),
                fx_rate_micro: new.fx_rate_micro.clone(),
                quantity_e8: new.quantity_e8.clone(),
                unit_price_e6: new.unit_price_e6.clone(),
            }
        } else if let Some(e) = kept.get(id) {
            // Same-day rows stay exactly as recorded; an unchanged row without
            // an amount keeps its recorded value (A22).
            EntryInput {
                account_id: (*id).into(),
                state: e.state.clone(),
                original_minor: e.original_minor.clone(),
                fx_rate_micro: e.fx_rate_micro.clone(),
                quantity_e8: e.quantity_e8.clone(),
                unit_price_e6: e.unit_price_e6.clone(),
                amount_cents: if e.state == "entered" {
                    e.amount_cents.clone()
                } else {
                    None
                },
            }
        } else if observation_before(tx, id, Some(&input.date))?.is_some() {
            EntryInput {
                account_id: (*id).into(),
                state: "unchanged".into(),
                amount_cents: None,
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            }
        } else {
            EntryInput {
                account_id: (*id).into(),
                state: "missing".into(),
                amount_cents: None,
                original_minor: None,
                fx_rate_micro: None,
                quantity_e8: None,
                unit_price_e6: None,
            }
        };
        entries.push(entry);
    }
    let mut notes = existing
        .as_ref()
        .map(|s| s.notes.clone())
        .unwrap_or_default();
    let note = input.note.trim();
    if !note.is_empty() {
        let names: Vec<&str> = input
            .changes
            .iter()
            .map(|c| due_accounts[c.account_id.as_str()].fields.name.as_str())
            .collect();
        if !notes.is_empty() {
            notes.push('\n');
        }
        notes.push_str(&format!("{}：{note}", names.join(" → ")));
    }
    Ok(SnapshotSave {
        request_id: input.request_id.clone(),
        generation: input.generation.clone(),
        id: existing.as_ref().map(|s| s.id.clone()),
        expected_revision: existing.as_ref().map(|s| s.revision),
        date: input.date.clone(),
        notes,
        entries,
    })
}

pub(crate) fn write_snapshot_tx(
    tx: &Transaction<'_>,
    input: &SnapshotSave,
    today: &str,
    new_id: Option<&str>,
    overrides: Option<&HistoricalOverrides>,
    live_override: Option<&[Account]>,
) -> Result<Snapshot> {
    let loaded = if live_override.is_none() {
        accounts(tx)?
    } else {
        Vec::new()
    };
    let live = live_override.unwrap_or(&loaded);
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
        .map(|id| snapshot(tx, id, live)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点")))
        .transpose()?;
    if old.as_ref().map(|s| s.revision) != input.expected_revision {
        return Err(Error::new("REVISION_CONFLICT", "盘点已变化，请重新读取"));
    }
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| new_id.map(str::to_owned).unwrap_or_else(uid));
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
        let a = expected[e.account_id.as_str()];
        let (value, original, rate, quantity, price) = match e.state.as_str() {
            "entered" => {
                let value = Some(
                    given.ok_or_else(|| Error::new("WEALTH_AMOUNT", "请填写金额，或标为未知"))?,
                );
                let (original, rate) = validate_fx(
                    &a.fields.currency,
                    value,
                    e.original_minor.as_deref(),
                    e.fx_rate_micro.as_deref(),
                )?;
                let historical = kept.get(e.account_id.as_str()).is_some_and(|k| {
                    k.amount_cents == e.amount_cents
                        && k.original_minor == e.original_minor
                        && k.fx_rate_micro == e.fx_rate_micro
                        && k.quantity_e8 == e.quantity_e8
                        && k.unit_price_e6 == e.unit_price_e6
                });
                if !historical
                    && overrides.is_none()
                    && (a.fields.holding_mode != e.quantity_e8.is_some()
                        || e.quantity_e8.is_some() != e.unit_price_e6.is_some())
                {
                    return Err(Error::new(
                        "HOLDING_MISMATCH",
                        "请按账户当前方式录入；持仓须同时填写份额和单价",
                    ));
                }
                let (q, p) = validate_holding(
                    &a.fields.currency,
                    value,
                    original,
                    e.quantity_e8.as_deref(),
                    e.unit_price_e6.as_deref(),
                )?;
                (value, original, rate, q, p)
            }
            "missing" => {
                if given.is_some() {
                    return Err(Error::new("WEALTH_AMOUNT", "未知金额不能同时填写数字"));
                }
                validate_fx(
                    &a.fields.currency,
                    None,
                    e.original_minor.as_deref(),
                    e.fx_rate_micro.as_deref(),
                )?;
                validate_holding(
                    &a.fields.currency,
                    None,
                    None,
                    e.quantity_e8.as_deref(),
                    e.unit_price_e6.as_deref(),
                )?;
                (None, None, None, None, None)
            }
            "unchanged" => {
                // A22: preserve this saved observation, even after earlier facts change.
                let source = if let Some(k) = kept
                    .get(e.account_id.as_str())
                    .filter(|k| k.state == "unchanged" && given.is_none())
                {
                    Observation {
                        amount_cents: k.amount_cents.clone().ok_or_else(|| {
                            Error::new("SNAPSHOT_UNCHANGED", "没有已保存金额可沿用")
                        })?,
                        date: input.date.clone(),
                        original_minor: k.original_minor.clone(),
                        fx_rate_micro: k.fx_rate_micro.clone(),
                        quantity_e8: k.quantity_e8.clone(),
                        unit_price_e6: k.unit_price_e6.clone(),
                    }
                } else {
                    observation_before(tx, &e.account_id, Some(&input.date))?.ok_or_else(|| {
                        Error::new("SNAPSHOT_UNCHANGED", "没有更早的金额可确认未变")
                    })?
                };
                let value = amount(Some(&source.amount_cents))?;
                if given.is_some() && given != value {
                    return Err(Error::new(
                        "SNAPSHOT_UNCHANGED",
                        "确认未变的金额须与上次相同",
                    ));
                }
                if e.original_minor
                    .as_ref()
                    .is_some_and(|v| Some(v) != source.original_minor.as_ref())
                    || e.fx_rate_micro
                        .as_ref()
                        .is_some_and(|v| Some(v) != source.fx_rate_micro.as_ref())
                {
                    return Err(Error::new(
                        "FX_MISMATCH",
                        "沿用金额须保留原记录的原币金额和汇率",
                    ));
                }
                let (original, rate) = validate_fx(
                    &a.fields.currency,
                    value,
                    source.original_minor.as_deref(),
                    source.fx_rate_micro.as_deref(),
                )?;
                if e.quantity_e8
                    .as_ref()
                    .is_some_and(|v| Some(v) != source.quantity_e8.as_ref())
                    || e.unit_price_e6
                        .as_ref()
                        .is_some_and(|v| Some(v) != source.unit_price_e6.as_ref())
                {
                    return Err(Error::new(
                        "HOLDING_MISMATCH",
                        "沿用须保留原记录的份额和单价",
                    ));
                }
                let (q, p) = validate_holding(
                    &a.fields.currency,
                    value,
                    original,
                    source.quantity_e8.as_deref(),
                    source.unit_price_e6.as_deref(),
                )?;
                (value, original, rate, q, p)
            }
            _ => return Err(Error::new("SNAPSHOT_STATE", "请选择填写、未变或未知")),
        };
        let (side, mut kind, mut counted) = kept
            .get(e.account_id.as_str())
            .map(|k| (k.side.clone(), k.kind.clone(), k.counted))
            .unwrap_or((
                a.fields.side.clone(),
                a.fields.kind.clone(),
                a.fields.counted,
            ));
        if let Some((historical_kind, historical_counted)) =
            overrides.and_then(|o| o.get(&e.account_id))
        {
            if let Some(k) = historical_kind {
                let supported = crate::financial_import_parser::ACCOUNT_KINDS
                    .iter()
                    .find(|info| info.key == k);
                if supported.is_none_or(|info| info.side != a.fields.side) {
                    return Err(Error::new(
                        "HISTORY_KIND_SIDE",
                        "历史类型不受支持或与账户方向不一致",
                    ));
                }
                kind = k.clone();
            }
            if let Some(c) = historical_counted {
                counted = *c;
            }
        }
        validate_kind_counted(&kind, counted)?;
        rows.push((
            e, value, side, kind, counted, original, rate, quantity, price,
        ));
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
    for (e, value, side, kind, counted, original, rate, quantity, price) in rows {
        tx.execute(
            "INSERT INTO fin_snapshot_entries(snapshot_id,account_id,state,amount_cents,side,kind,counted,original_minor,fx_rate_micro,quantity_e8,unit_price_e6) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![id, e.account_id, e.state, value, side, kind, counted, original, rate, quantity, price],
        )?;
    }
    snapshot(tx, &id, live)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"))
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
        let result = write_account_tx(&tx, input, today, None, false, None)?;
        let id = &result.id;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
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
        let mut rate_suggestions: BTreeMap<String, RateSuggestion> = BTreeMap::new();
        // A retired account can still hold the latest recorded rate for a new account.
        for a in &live {
            if a.fields.currency == "CNY" {
                continue;
            }
            let recorded = existing
                .as_ref()
                .and_then(|s| s.entries.iter().find(|e| e.account_id == a.id))
                .and_then(|e| {
                    e.fx_rate_micro.as_ref().map(|rate| RateSuggestion {
                        rate: rate.clone(),
                        date: day.into(),
                    })
                });
            let source = match recorded {
                Some(v) => Some(v),
                None => observation_before(c, &a.id, Some(day))?.and_then(|o| {
                    o.fx_rate_micro
                        .map(|rate| RateSuggestion { rate, date: o.date })
                }),
            };
            if let Some(source) = source {
                if rate_suggestions
                    .get(&a.fields.currency)
                    .is_none_or(|old| source.date > old.date)
                {
                    rate_suggestions.insert(a.fields.currency.clone(), source);
                }
            }
        }
        let mut rows = Vec::new();
        for a in live.into_iter().filter(|a| due(a, day)) {
            let previous = observation_before(c, &a.id, Some(day))?;
            rows.push(DraftRow {
                account: a,
                previous,
            });
        }
        Ok(Draft {
            rate_suggestions,
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
        let result = write_snapshot_tx(&tx, input, today, None, None, None)?;
        let id = &result.id;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, id],
        )?;
        self.hit("wealth_snapshot.before_commit")?;
        tx.commit()?;
        self.hit("wealth_snapshot.after_commit")?;
        Ok(result)
    }

    pub fn wealth_quick_update(&mut self, input: &QuickUpdate, today: &str) -> Result<Snapshot> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wealth_quick_update", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        let live = accounts(&tx)?;
        if let Some(id) = receipt(&tx, &input.request_id, &fingerprint)? {
            return snapshot(&tx, &id, &live)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"));
        }
        let save = quick_update_plan(&tx, input, today, &live)?;
        let result = write_snapshot_tx(&tx, &save, today, None, None, Some(&live))?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?3)",
            params![input.request_id, fingerprint, result.id],
        )?;
        self.hit("wealth_quick_update.before_commit")?;
        tx.commit()?;
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
        let mut latest_entries = Vec::new();
        let mut last_complete: Option<(Snapshot, i64)> = None;
        for id in ids {
            let s = snapshot(c, &id, &live)?
                .ok_or_else(|| Error::new("NOT_FOUND", "找不到这次盘点"))?;
            latest_entries = s.entries.clone();
            let (assets, liabilities) = net_of(&s)?;
            let net = assets - liabilities;
            let complete = s.missing.is_empty();
            let balance = |kinds: &[&str]| -> Result<Option<String>> {
                if !complete {
                    return Ok(None);
                }
                Ok(Some(
                    sum(s
                        .entries
                        .iter()
                        .filter(|e| {
                            e.counted && e.side == "asset" && kinds.contains(&e.kind.as_str())
                        })
                        .filter_map(|e| e.amount_cents.as_deref()?.parse::<i64>().ok()))?
                    .to_string(),
                ))
            };
            let mut point = Point {
                has_unchanged: s.entries.iter().any(|e| e.state == "unchanged"),
                snapshot_id: s.id.clone(),
                date: s.date.clone(),
                notes: s.notes.clone(),
                assets_cents: assets.to_string(),
                liabilities_cents: liabilities.to_string(),
                net_cents: net.to_string(),
                liquid_cents: balance(&["cash"])?,
                invested_cents: balance(&[
                    "investment",
                    "mixed",
                    "fund",
                    "bond",
                    "precious_metal",
                ])?,
                complete,
                missing: s.missing.len(),
                compared_to: None,
                scope_changed: false,
                change_cents: None,
                hpf_change_cents: None,
                market_change_cents: None,
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
                        point.hpf_change_cents = match (hpf_of(prev)?, hpf_of(&s)?) {
                            (None, None) => None,
                            (a, b) => Some((b.unwrap_or(0) - a.unwrap_or(0)).to_string()),
                        };
                        point.market_change_cents = match (market_of(prev)?, market_of(&s)?) {
                            (None, None) => None,
                            (a, b) => Some((b.unwrap_or(0) - a.unwrap_or(0)).to_string()),
                        };
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
            structure = structure_of(s, "asset")?;
            liabilities = structure_of(s, "liability")?;
        }
        Ok(Summary {
            generation: self.generation(),
            points,
            structure_date,
            latest_entries,
            structure_entries: last_complete
                .as_ref()
                .map(|(s, _)| s.entries.clone())
                .unwrap_or_default(),
            structure,
            liabilities,
        })
    }

    /// Per-account comparison of two check-ins (17.14.4). Read-only; the two
    /// ids must be live check-ins with `from` earlier than `to`.
    pub fn wealth_compare(&self, from_id: &str, to_id: &str) -> Result<Compare> {
        let c = self.conn()?;
        let live = accounts(c)?;
        let from = snapshot(c, from_id, &live)?
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到起点盘点"))?;
        let to =
            snapshot(c, to_id, &live)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到终点盘点"))?;
        if from.date.as_str() >= to.date.as_str() {
            return Err(Error::new("WEALTH_COMPARE_RANGE", "起点盘点须早于终点"));
        }
        let cell_of =
            |a: &Account, s: &Snapshot| match s.entries.iter().find(|e| e.account_id == a.id) {
                Some(e) => CompareCell {
                    state: if e.amount_cents.is_some() {
                        e.state.clone()
                    } else {
                        "missing".into()
                    },
                    amount_cents: e.amount_cents.clone(),
                    counted: Some(e.counted),
                },
                None => {
                    let state = if a.fields.opened_on.as_str() > s.date.as_str() {
                        "not_open"
                    } else if a
                        .fields
                        .closed_on
                        .as_deref()
                        .is_some_and(|closed| closed <= s.date.as_str())
                    {
                        "closed"
                    } else {
                        "missing"
                    };
                    CompareCell {
                        state: state.into(),
                        amount_cents: None,
                        counted: None,
                    }
                }
            };
        let outside = |cell: &CompareCell| cell.state == "not_open" || cell.state == "closed";
        let value = |cell: &CompareCell| -> Option<i64> {
            match cell.state.as_str() {
                // Outside the account's open period it participates as zero.
                "not_open" | "closed" => Some(0),
                "missing" => None,
                _ => cell.amount_cents.as_deref().and_then(|v| v.parse().ok()),
            }
        };
        let mut rows = Vec::new();
        for a in &live {
            let from_cell = cell_of(a, &from);
            let to_cell = cell_of(a, &to);
            if outside(&from_cell) && outside(&to_cell) {
                continue;
            }
            let from_entry = from.entries.iter().find(|e| e.account_id == a.id);
            let to_entry = to.entries.iter().find(|e| e.account_id == a.id);
            let (side, kind) = to_entry
                .or(from_entry)
                .map(|e| (e.side.clone(), e.kind.clone()))
                .unwrap_or((a.fields.side.clone(), a.fields.kind.clone()));
            let group = match (from_cell.counted, to_cell.counted) {
                (Some(f), Some(t)) if f != t => "scope_changed",
                (Some(f), Some(_)) if f => "counted",
                (Some(_), Some(_)) => "uncounted",
                (Some(f), None) | (None, Some(f)) if f => "counted",
                (Some(_), None) | (None, Some(_)) => "uncounted",
                (None, None) if a.fields.counted => "counted",
                (None, None) => "uncounted",
            };
            let change = match (value(&from_cell), value(&to_cell)) {
                (Some(f), Some(t)) => Some(t.checked_sub(f).ok_or_else(overflow_error)?),
                _ => None,
            };
            let effect = match change {
                Some(c) if side == "liability" => Some(c.checked_neg().ok_or_else(overflow_error)?),
                other => other,
            };
            let rate = match (side.as_str(), value(&from_cell), change) {
                ("asset", Some(f), Some(c)) if f > 0 => Some(hundredths(c as i128, f as i128)),
                _ => None,
            };
            let tag = if from_cell.state == "not_open" {
                Some("new")
            } else if to_cell.state == "closed" {
                Some("closed")
            } else {
                None
            };
            rows.push(CompareRow {
                account_id: a.id.clone(),
                name: a.fields.name.clone(),
                institution: a.fields.institution.clone(),
                side,
                kind,
                from: from_cell,
                to: to_cell,
                change_cents: change.map(|c| c.to_string()),
                effect_cents: effect.map(|c| c.to_string()),
                rate_hundredths: rate,
                group: group.into(),
                tag: tag.map(Into::into),
            });
        }
        let known_effect = sum(rows
            .iter()
            .filter(|r| r.group == "counted")
            .filter_map(|r| r.effect_cents.as_deref().and_then(|v| v.parse().ok())))?;
        let missing_names: Vec<String> = rows
            .iter()
            .filter(|r| {
                r.group == "counted" && (r.from.state == "missing" || r.to.state == "missing")
            })
            .map(|r| r.name.clone())
            .collect();
        let scope_changed = rows.iter().any(|r| r.group == "scope_changed");
        let reconciled = from.missing.is_empty() && to.missing.is_empty() && !scope_changed;
        let (net_change, assets_change, liabilities_change, net_rate) = if reconciled {
            let (from_assets, from_liabilities) = net_of(&from)?;
            let (to_assets, to_liabilities) = net_of(&to)?;
            let from_net = from_assets
                .checked_sub(from_liabilities)
                .ok_or_else(overflow_error)?;
            let to_net = to_assets
                .checked_sub(to_liabilities)
                .ok_or_else(overflow_error)?;
            let diff = to_net.checked_sub(from_net).ok_or_else(overflow_error)?;
            // 内部一致性：计入组已知影响之和必须等于净资产变化（17.14.4.3）。
            if diff != known_effect {
                return Err(Error::new(
                    "WEALTH_COMPARE_MISMATCH",
                    "账户变化与净资产变化对不上，请反馈",
                ));
            }
            (
                Some(diff),
                Some(
                    to_assets
                        .checked_sub(from_assets)
                        .ok_or_else(overflow_error)?,
                ),
                Some(
                    to_liabilities
                        .checked_sub(from_liabilities)
                        .ok_or_else(overflow_error)?,
                ),
                (from_net > 0).then(|| hundredths(diff as i128, from_net as i128)),
            )
        } else {
            (None, None, None, None)
        };
        let from_shares = structure_of(&from, "asset")?;
        let to_shares = structure_of(&to, "asset")?;
        let mut structure = Vec::new();
        for kind in ASSET_KINDS {
            let f = from_shares.iter().find(|s| s.kind == kind);
            let t = to_shares.iter().find(|s| s.kind == kind);
            if f.is_none() && t.is_none() {
                continue;
            }
            structure.push(StructurePair {
                kind: kind.into(),
                from_cents: f.map(|s| s.amount_cents.clone()),
                from_share: f.and_then(|s| s.share_hundredths),
                to_cents: t.map(|s| s.amount_cents.clone()),
                to_share: t.and_then(|s| s.share_hundredths),
            });
        }
        Ok(Compare {
            generation: self.generation(),
            from: CompareEnd {
                snapshot_id: from.id.clone(),
                date: from.date.clone(),
                notes: from.notes.clone(),
                complete: from.missing.is_empty(),
                missing: from.missing.len(),
            },
            to: CompareEnd {
                snapshot_id: to.id.clone(),
                date: to.date.clone(),
                notes: to.notes.clone(),
                complete: to.missing.is_empty(),
                missing: to.missing.len(),
            },
            reconciled,
            net_change_cents: net_change.map(|v| v.to_string()),
            assets_change_cents: assets_change.map(|v| v.to_string()),
            liabilities_change_cents: liabilities_change.map(|v| v.to_string()),
            net_rate_hundredths: net_rate,
            known_effect_cents: known_effect.to_string(),
            missing_names,
            rows,
            structure,
        })
    }

    /// Every live check-in row of one account, date ascending, with the
    /// adjacent-row change (unknown rows are never skipped over).
    pub fn wealth_account_history(&self, account_id: &str) -> Result<AccountHistory> {
        let c = self.conn()?;
        let account =
            account(c, account_id)?.ok_or_else(|| Error::new("NOT_FOUND", "找不到账户"))?;
        let fx = fx_columns(c)?;
        let mut q = c.prepare(
            &format!("SELECT s.id,s.date,e.state,e.amount_cents,e.counted,{fx} FROM fin_snapshot_entries e JOIN fin_snapshots s ON s.id=e.snapshot_id WHERE e.account_id=?1 AND s.deleted_at IS NULL ORDER BY s.date,s.id"),
        )?;
        let raw = q
            .query_map([account_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, bool>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<i64>>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                    r.get::<_, Option<i64>>(8)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut rows = Vec::new();
        let mut previous: Option<i64> = None;
        for (snapshot_id, day, state, amount, counted, original, rate, quantity, price) in raw {
            let change = match (amount, previous) {
                (Some(v), Some(p)) => Some(v.checked_sub(p).ok_or_else(overflow_error)?),
                _ => None,
            };
            rows.push(HistoryRow {
                original_minor: original.map(|v| v.to_string()),
                fx_rate_micro: rate.map(|v| v.to_string()),
                quantity_e8: quantity.map(|v| v.to_string()),
                unit_price_e6: price.map(|v| v.to_string()),
                snapshot_id,
                date: day,
                state,
                amount_cents: amount.map(|v| v.to_string()),
                counted,
                change_cents: change.map(|v| v.to_string()),
            });
            previous = amount;
        }
        Ok(AccountHistory {
            generation: self.generation(),
            account,
            rows,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashChange {
    pub request_id: String,
    pub generation: String,
    /// `snapshot`, `account`, `expense`, `income`, `plan`, `payment`, `wish` or `virtual`.
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
    /// Internal domain operation. IPC uses wealth_trash_with_incomes instead.
    pub fn wealth_trash(&mut self, input: &TrashChange) -> Result<()> {
        self.wealth_trash_with_incomes(input, true)
    }

    /// Income delete/restore requires income capability; receipts remain readable.
    pub fn wealth_trash_with_incomes(&mut self, input: &TrashChange, incomes: bool) -> Result<()> {
        self.check_generation(&input.generation)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let fingerprint = digest(&serde_json::to_vec(&("wealth_trash", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if receipt(&tx, &input.request_id, &fingerprint)?.is_some() {
            return Ok(());
        }
        if input.kind == "income" {
            crate::plan_income::require_enabled(incomes)?;
        }
        let table = match input.kind.as_str() {
            "snapshot" => "fin_snapshots",
            "account" => "fin_accounts",
            "expense" => "expenses",
            "income" => "plan_income",
            "plan" => "recurring_plans",
            "payment" => "plan_payments",
            "wish" => "wishlist_items",
            "virtual" => "virtual_assets",
            "topup" => "virtual_topups",
            "balance" => "virtual_balances",
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
        if input.deleted {
            crate::plan_core::protect_reference(&tx, &input.kind, &input.id)?;
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
        // 关联组识别（设计 §7/§8）：已关联订阅的删除走整组 link_trash；
        // 组成员的恢复走整组 link_restore；双方分别历史删除时不能走旧的单
        // 对象恢复留下半组，须在核对中明确选择。
        if input.kind == "virtual" || input.kind == "plan" {
            let live_partner: Option<String> = match input.kind.as_str() {
                "virtual" => tx
                    .query_row(
                        "SELECT r.id FROM virtual_assets v JOIN recurring_plans r ON r.id=v.plan_id WHERE v.id=?1 AND v.deleted_at IS NULL AND r.deleted_at IS NULL",
                        [&input.id],
                        |r| r.get(0),
                    )
                    .optional()?,
                _ => tx
                    .query_row(
                        "SELECT v.id FROM recurring_plans r JOIN virtual_assets v ON v.plan_id=r.id WHERE r.id=?1 AND r.deleted_at IS NULL AND v.deleted_at IS NULL",
                        [&input.id],
                        |r| r.get(0),
                    )
                    .optional()?,
            };
            if input.deleted {
                if live_partner.is_some() {
                    return Err(Error::new(
                        "LINK_GROUP_REQUIRED",
                        "这项记录已关联订阅，删除请使用「移入最近删除」的整组删除",
                    ));
                }
            } else {
                if crate::link::open_group_for(&tx, &input.id)?.is_some() {
                    return Err(Error::new(
                        "LINK_GROUP_STALE",
                        "这组记录属于一个关联订阅删除组，请在最近删除中整组恢复",
                    ));
                }
                // 对方也在最近删除：单边恢复会留下半组，须整组核对。
                // （对方若已有删除组，本对象必为同组成员，上面的整组恢复
                // 提示已先触发；这里覆盖双方均无组的历史分别删除。）
                let partner_trashed: bool = match input.kind.as_str() {
                    "virtual" => tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM virtual_assets v JOIN recurring_plans r ON r.id=v.plan_id WHERE v.id=?1 AND r.deleted_at IS NOT NULL)",
                        [&input.id],
                        |r| r.get(0),
                    )?,
                    _ => tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM recurring_plans r JOIN virtual_assets v ON v.plan_id=r.id WHERE r.id=?1 AND v.deleted_at IS NOT NULL)",
                        [&input.id],
                        |r| r.get(0),
                    )?,
                };
                if partner_trashed {
                    return Err(Error::new(
                        "LINK_HALF_GROUP",
                        "它的关联对象也在最近删除；请在最近删除中整组恢复，或在核对中登记为一组",
                    ));
                }
            }
        }
        if (input.kind == "topup" || input.kind == "balance") && !input.deleted {
            // A fact returns only under its live account.
            let parent_live: bool = tx.query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM virtual_assets v JOIN {table} t ON t.asset_id=v.id WHERE t.id=?1 AND v.deleted_at IS NULL)"
                ),
                [&input.id],
                |r| r.get(0),
            )?;
            if !parent_live {
                return Err(Error::new(
                    "PARENT_DELETED",
                    "所属虚拟资产仍在最近删除中，请先恢复它",
                ));
            }
        }
        if input.kind == "virtual" && !input.deleted {
            // Its plan may have been linked to another item meanwhile.
            let taken: Option<String> = tx
                .query_row(
                    "SELECT o.name FROM virtual_assets v JOIN virtual_assets o ON o.plan_id=v.plan_id AND o.id!=v.id AND o.deleted_at IS NULL WHERE v.id=?1",
                    [&input.id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(name) = taken {
                return Err(Error::new(
                    "VIRTUAL_PLAN_TAKEN",
                    &format!("它关联的计划已改由「{name}」使用，不能恢复；可先解除那边的关联"),
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
        if ["income", "expense"].contains(&input.kind.as_str()) {
            crate::cash_movement::source_changed(&tx, &input.kind, &input.id)?;
        }
        self.hit("wealth_trash.before_commit")?;
        tx.commit()?;
        Ok(())
    }
}

/// Backup validation for schema 15 data beyond what SQL CHECKs cover.
pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let bad = |m: &str| Error::new("DATA_CONSTRAINT", m);
    let version: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version >= 43 {
        for group in crate::account_groups::list(c)? {
            if uuid::Uuid::parse_str(&group.id).is_err()
                || crate::account_groups::name(&group.name)? != group.name
            {
                return Err(bad("备份含非法分组资料"));
            }
        }
    }
    let columns = account_columns(c)?;
    let mut q = c.prepare(&format!(
        "SELECT {columns},created_at,updated_at FROM fin_accounts"
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
        for i in [17, 18] {
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
    let mut entries = c.prepare("SELECT side,kind,counted FROM fin_snapshot_entries")?;
    let mut rows = entries.query([])?;
    while let Some(r) = rows.next()? {
        let side: String = r.get(0)?;
        let kind: String = r.get(1)?;
        let counted: bool = r.get(2)?;
        let supported = match side.as_str() {
            "asset" => ASSET_KINDS.contains(&kind.as_str()),
            "liability" => LIABILITY_KINDS.contains(&kind.as_str()),
            _ => false,
        };
        if !supported || validate_kind_counted(&kind, counted).is_err() {
            return Err(bad("备份含非法盘点账户类型或计入设置"));
        }
    }
    let fx = fx_columns(c)?;
    let old: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let code = if old < 43 { "'CNY'" } else { "a.currency" };
    let mut q = c.prepare(&format!("SELECT e.amount_cents,{fx},{code} FROM fin_snapshot_entries e JOIN fin_accounts a ON a.id=e.account_id"))?;
    let mut rows = q.query([])?;
    while let Some(r) = rows.next()? {
        let value: Option<i64> = r.get(0)?;
        let original = r.get::<_, Option<i64>>(1)?.map(|v| v.to_string());
        let rate = r.get::<_, Option<i64>>(2)?.map(|v| v.to_string());
        let quantity = r.get::<_, Option<i64>>(3)?.map(|v| v.to_string());
        let price = r.get::<_, Option<i64>>(4)?.map(|v| v.to_string());
        let code: String = r.get(5)?;
        validate_fx(&code, value, original.as_deref(), rate.as_deref())
            .map_err(|_| bad("备份含不一致的原币金额或汇率"))?;
        validate_holding(
            &code,
            value,
            original.as_deref().and_then(|v| v.parse().ok()),
            quantity.as_deref(),
            price.as_deref(),
        )
        .map_err(|_| bad("备份含不一致的份额或单价"))?;
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
