//! Investment interval review: pure validation and profit computation.
//!
//! Contract: `docs/PLANNING_SIMPLIFICATION_CONTRACT.md` §4; product design:
//! `docs/PRODUCT_BOUNDARIES_DESIGN.md` §13. This module only validates an
//! already-assembled [`ReviewInput`] and computes the interval profit in
//! memory. It never touches the database, the file system or IPC.
//!
//! Everything the product still owes lives outside this module: overlap
//! queries, reading current facts, transactions/receipts and persistence all
//! belong to a future Store adapter. A review computed here is a draft view
//! over caller-provided endpoints; it is not a saved record.
//!
//! The module is intentionally not registered in `lib.rs`. The contract
//! example `src-tauri/examples/investment_review_contract.rs` includes it via
//! `#[path]`; first-batch integration decides how (and whether) to wire it
//! into the IPC surface.
//!
//! Money rules: amounts are integer cents (`i64`). Input amounts are
//! non-negative and capped at [`MAX_CENTS`], matching the live domain layer.
//! `unknown` is `None` and never becomes `0`. The only formula is
//! `closing − opening − inflow + outflow`; no rates, annualisation, TWR or
//! IRR are produced.

mod review;
mod validate;

pub use review::{review_interval, BlockedStatus};

use serde_json::json;

/// Wire contract version accepted by this module (`contract_version = 1`).
pub const CONTRACT_VERSION: i64 = 1;
/// Same cap as the live domain layer (`domain::MAX_CENTS`): 99999999999 分.
pub const MAX_CENTS: i64 = 99_999_999_999;
/// Account kinds that may take part in an investment scope. Cash/deposit,
/// housing-fund and liability kinds are rejected as invalid payload: the fact
/// adapter must pick the scope, and the core never silently includes a kind
/// it cannot interpret.
pub const SUPPORTED_KINDS: [&str; 4] = ["investment", "mixed", "fund", "bond"];
/// Flow notes share the live 500-character income-note cap.
pub const MAX_FLOW_NOTE_CHARS: usize = 500;
/// Stable IDs and keys share the live 100-character key cap.
pub const MAX_ID_CHARS: usize = 100;
/// Defensive payload bound: keeps counted totals provably inside `i64` and is
/// far beyond any real investment scope. Not a product rule.
pub const MAX_SCOPE_MEMBERS: usize = 1_000;

pub const REASON_MISSING_FLOW: &str = "missing_flow";
pub const REASON_INCOMPLETE_FLOW: &str = "incomplete_flow";
pub const REASON_STALE_ENDPOINTS: &str = "stale_endpoints";
pub const REASON_SCOPE_CHANGED: &str = "scope_changed";
pub const REASON_MISSING_BALANCE: &str = "missing_balance";
pub const REASON_OVERLAPPING_FLOW: &str = "overlapping_flow";
pub const REASON_UNSUPPORTED_MOVEMENT: &str = "unsupported_movement";
pub const REASON_EMPTY_SCOPE: &str = "empty_scope";

/// Field-level error: `path` uses stable account/flow ids, never array
/// indexes that would move when members are reordered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldIssue {
    pub path: String,
    pub code: String,
    pub message: String,
}

impl FieldIssue {
    pub fn new(path: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            path: path.to_string(),
            code: code.to_string(),
            message: message.into(),
        }
    }
}

/// One account inside an endpoint snapshot, as picked by the fact adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeMember {
    pub account_id: String,
    pub kind: String,
    pub counted: bool,
    /// `None` means the balance is unknown; it never means zero.
    pub amount_cents: Option<i64>,
}

/// One endpoint snapshot of the reviewed interval.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub snapshot_id: String,
    pub revision: i64,
    /// `YYYY-MM-DD`, validated as a real calendar date.
    pub date: String,
    pub members: Vec<ScopeMember>,
}

/// User-confirmed external flow totals for the interval `(from_date, to_date]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Flow {
    pub id: String,
    pub revision: i64,
    pub from_snapshot_id: String,
    /// Audit reference only: a revision bump alone never invalidates the
    /// confirmation; only the content key does.
    pub from_revision: i64,
    pub from_value_key: String,
    pub to_snapshot_id: String,
    pub to_revision: i64,
    pub to_value_key: String,
    /// Original interval dates recorded at confirmation time.
    pub from_date: String,
    pub to_date: String,
    /// Investment scope (account id set) recorded at confirmation time.
    pub scope_account_ids: Vec<String>,
    /// External money moved into the scope; `None` = unknown, `0` = explicit.
    pub inflow_cents: Option<i64>,
    /// External money moved out of the scope, including cash distributions
    /// transferred outside; `None` = unknown, `0` = explicit.
    pub outflow_cents: Option<i64>,
    pub confirmed_complete: bool,
    /// Securities/physical transfers, leverage or unexplained adjustments the
    /// first version does not model; blocks a simple completeness claim.
    pub unsupported_movements: bool,
    pub notes: String,
}

/// Everything the core needs; assembled by the (future) fact adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewInput {
    pub contract_version: i64,
    pub from: Endpoint,
    pub to: Endpoint,
    pub flow: Option<Flow>,
    /// Active flow summaries overlapping this interval, as reported by the
    /// Store; the core itself never queries overlaps.
    pub overlapping_active_flow_ids: Vec<String>,
}

/// Ready values, all integer cents; `change` and `profit` are signed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewValue {
    pub opening_cents: i64,
    pub closing_cents: i64,
    pub change_cents: i64,
    pub inflow_cents: i64,
    pub outflow_cents: i64,
    /// `closing − opening − inflow + outflow`. Includes valuation changes,
    /// reflected income and costs; it is an amount, never a rate.
    pub profit_cents: i64,
}

/// Error returned by [`parse_cents`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CentsError {
    /// Not a canonical non-negative integer string (`0` or `[1-9][0-9]*`).
    Invalid,
    /// Beyond [`MAX_CENTS`].
    Range,
}

/// Outcome of one interval review. Priority: invalid → not_comparable →
/// not_recorded/needs_review → ready. `change_cents` is present exactly when
/// both endpoints are comparable and their counted balances are complete,
/// independent of flow completeness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewResult {
    Ready {
        value: ReviewValue,
    },
    Blocked {
        status: BlockedStatus,
        reasons: Vec<&'static str>,
        change_cents: Option<i64>,
    },
    Invalid {
        issues: Vec<FieldIssue>,
    },
}

/// Parse a canonical non-negative integer-cents string (`"0"`, `"1200"`).
/// Leading zeros, signs, separators and unknown sentinels are errors: the
/// future Store adapter uses this so string handling exists exactly once.
pub fn parse_cents(raw: &str) -> Result<i64, CentsError> {
    if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CentsError::Invalid);
    }
    if raw.len() > 1 && raw.starts_with('0') {
        return Err(CentsError::Invalid);
    }
    if raw.len() > 19 {
        return Err(CentsError::Range);
    }
    let mut value: i64 = 0;
    for b in raw.bytes() {
        value = value
            .checked_mul(10)
            .and_then(|v| v.checked_add((b - b'0') as i64))
            .ok_or(CentsError::Range)?;
    }
    if value > MAX_CENTS {
        return Err(CentsError::Range);
    }
    Ok(value)
}

/// Integer cents → canonical decimal string (signed).
pub fn format_cents(cents: i64) -> String {
    cents.to_string()
}

/// Content key of the endpoint's computation-relevant content: compact JSON
/// `[snapshot_id,date,[[account_id,kind,counted,amount_cents],…]]` with
/// members sorted by `account_id` (ascending) and unknown amounts kept as
/// `null`. Generated and re-checked here only; the UI never builds it. Notes
/// and revisions are excluded on purpose: editing them must not invalidate a
/// confirmation, while amount/date/scope/kind corrections must.
pub fn endpoint_value_key(endpoint: &Endpoint) -> String {
    let mut members: Vec<&ScopeMember> = endpoint.members.iter().collect();
    members.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    let rows = members
        .iter()
        .map(|m| {
            json!([
                m.account_id,
                m.kind,
                m.counted,
                m.amount_cents.map(format_cents)
            ])
        })
        .collect::<Vec<_>>();
    // Compact JSON over plain strings/numbers cannot fail.
    serde_json::to_string(&json!([endpoint.snapshot_id, endpoint.date, rows]))
        .expect("value key serialization is infallible")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_parsing_is_canonical_and_capped() {
        assert_eq!(parse_cents("0"), Ok(0));
        assert_eq!(parse_cents("1200"), Ok(1200));
        assert_eq!(parse_cents("99999999999"), Ok(MAX_CENTS));
        assert_eq!(parse_cents(""), Err(CentsError::Invalid));
        assert_eq!(parse_cents("01"), Err(CentsError::Invalid));
        assert_eq!(parse_cents("+1"), Err(CentsError::Invalid));
        assert_eq!(parse_cents("-5"), Err(CentsError::Invalid));
        assert_eq!(parse_cents("1.5"), Err(CentsError::Invalid));
        assert_eq!(parse_cents("12 "), Err(CentsError::Invalid));
        assert_eq!(parse_cents("100000000000"), Err(CentsError::Range));
    }

    #[test]
    fn value_key_sorts_members_and_keeps_null() {
        let endpoint = Endpoint {
            snapshot_id: "snap-2".to_string(),
            revision: 3,
            date: "2026-10-31".to_string(),
            members: vec![
                ScopeMember {
                    account_id: "acc-b".to_string(),
                    kind: "fund".to_string(),
                    counted: true,
                    amount_cents: Some(1200),
                },
                ScopeMember {
                    account_id: "acc-a".to_string(),
                    kind: "investment".to_string(),
                    counted: false,
                    amount_cents: None,
                },
            ],
        };
        assert_eq!(
            endpoint_value_key(&endpoint),
            r#"["snap-2","2026-10-31",[["acc-a","investment",false,null],["acc-b","fund",true,"1200"]]]"#
        );
    }
}
