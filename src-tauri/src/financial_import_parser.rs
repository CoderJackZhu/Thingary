//! Financial history CSV import parser (PLANNING_COMPONENT_CONTRACTS §2).
//!
//! Standalone component: turns one UTF-8 CSV document into a contract
//! version 1 preview — standard rows, per-group validation for check-ins,
//! locatable issues and accurate counts. It never touches the Store, SQLite,
//! the file system or the network, and it never claims anything about
//! database-side duplicates or completeness that it cannot see.
//!
//! # Entry points
//!
//! - [`parse_import_v1`]: typed entry, takes a decoded [`ImportRequestV1`].
//! - [`parse_import_request_json`]: convenience entry that decodes the request
//!   JSON first and maps decode failures to stable codes.
//! - [`template_csv`]: header-only template text for one `kind` (with BOM).
//! - [`KINDS`], [`ACCOUNT_KINDS`], [`template_columns`]: the fixed kind and
//!   column vocabulary shared by templates and UI.
//!
//! # Call example
//!
//! ```text
//! use thingary_lib::financial_import_parser::{parse_import_request_json, ImportContext};
//!
//! let request = r#"{
//!     "contract_version": 1,
//!     "kind": "incomes",
//!     "csv_text": "income_key,date,net_income,hpf_deposit,note\ni1,2026-09-30,12000.50,2400,\"工资,含奖金\"\n"
//! }"#;
//! let ctx = ImportContext { today: "2026-10-07", cancel: &|| false };
//! let preview = parse_import_request_json(request, &ctx)?;
//! // preview.rows[0] → Incomes { income_key: "i1", net_income_cents: "120050",
//! //                             hpf_deposit_cents: Some("240000"), … }
//! ```
//!
//! (The block above is documentation; the integration test
//! `tests/financial_import_parser.rs` exercises the same call for real.)
//!
//! # Fixed semantics
//!
//! - `contract_version` other than 1 is a hard [`ImportContractError`]
//!   (`CONTRACT_VERSION_UNSUPPORTED`); an unknown `kind` is `KIND_UNKNOWN`.
//!   Content problems stay in-band: the preview carries [`IssueV1`] entries
//!   even when nothing parsed, so an empty result is never mistaken for
//!   success. Callers must treat any `error`-severity issue as blocking.
//! - `source_row` is the 1-based physical line where a CSV record starts. A
//!   record quoted across several physical lines keeps that starting line for
//!   all of its issues; a `CSV_FORMAT` message states the exact physical line
//!   and character column of the offending character, which may be a
//!   continuation line.
//! - Amount columns are yuan with at most two decimals, parsed into integer
//!   cents without floating point. Output fields are `*_cents` decimal
//!   strings, or null where the design allows unknown (only `hpf_deposit`).
//!   Exponent notation, thousands separators, currency symbols, NaN/Infinity
//!   and silent rounding are rejected; cleanup rules like "strip ¥" or
//!   "convert from cents" belong to the caller's preview step, not here.
//!   Negative amounts are accepted only for `net_worth_history`.
//! - Dates are strict calendar-valid `YYYY-MM-DD`; anything after the explicit
//!   `today` context is a future-date issue. `today` is a separate entry
//!   parameter, never part of the v1 payload.
//! - External keys (`account_key`, `snapshot_key`, `income_key`,
//!   `history_key`) are 1–100 characters after trimming. A repeated key with
//!   identical field values becomes a `DUPLICATE_KEY_SAME` warning and the
//!   later row is dropped; with different values it becomes a
//!   `DUPLICATE_KEY_CONFLICT` error and the later row is dropped, so standard
//!   rows stay unique by key. Same-day incomes with different keys are always
//!   kept as two records.
//! - For `snapshots` the commit unit is the group, not the row:
//!   [`SnapshotGroupV1`] carries `valid` / `invalid` /
//!   `requires_account_context`, and `source_rows` lists every member row
//!   including rejected ones. Without an account catalog no group is ever
//!   declared complete; with a catalog, accounts that are due (enabled and not
//!   disabled on the group date) and absent from the group make it invalid.
//!   Accounts without an external key cannot be referenced by key, so they are
//!   outside import-side completeness checks — the write layer still checks
//!   completeness against the real database.
//! - Limits (20 MiB, 50000 data rows) reject the whole request instead of
//!   truncating. The `cancel` callback is polled at checkpoints; cancellation
//!   is a hard `CANCELLED` error, never a successful preview. Repeated
//!   warnings (`GROUP_REQUIRES_CONTEXT`, `ACCOUNT_NAME_CANDIDATE`,
//!   `ACCOUNT_KEY_MAPPED`, `COVERAGE_OVERLAP`, `EXTRA_COLUMN_IGNORED`) are
//!   capped at 100 emissions each to keep previews bounded; counts are
//!   unaffected.
//! - Notes reuse the live caps: accounts and check-ins 10000 characters,
//!   incomes and coverage 500 characters. Platform (institution) is capped at
//!   80 characters like the live account form.
//!
//! Component documentation and fictional sample files live in
//! `src-tauri/src/financial_import_parser/`. Tests compile this module
//! directly via `#[path = "../src/financial_import_parser.rs"]`, so it must
//! stay free of `crate::` and Store dependencies.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

// Explicit child paths so the layout works both from lib.rs and when the
// module is compiled standalone via `#[path = "../src/financial_import_parser.rs"]`.
#[path = "financial_import_parser/csv.rs"]
mod csv;
#[path = "financial_import_parser/fields.rs"]
mod fields;

use fields::{
    parse_amount_cents, validate_date_strict, AmountError, MAX_ACCOUNT_NOTE_CHARS,
    MAX_INCOME_NOTE_CHARS, MAX_KEY_CHARS, MAX_NAME_CHARS, MAX_PLATFORM_CHARS,
    MAX_SNAPSHOT_NOTE_CHARS,
};

/// Contract version implemented by this module.
pub const CONTRACT_VERSION: u32 = 1;
/// Kinds supported by import contract v1, in template order.
pub const KINDS: [&str; 5] = [
    "accounts",
    "snapshots",
    "incomes",
    "income_coverage",
    "net_worth_history",
];
/// Hard file size limit for one batch (design §4).
pub const MAX_BYTES: usize = 20 * 1024 * 1024;
/// Hard data-row limit for one file (design §4).
pub const MAX_DATA_ROWS: usize = 50_000;
/// Emission cap per repeated warning code.
const WARNING_CAP: usize = 100;

/// One canonical account kind: key, current Chinese label and the balance side
/// the kind implies. Mirrors the live account taxonomy; a kind decides the
/// side, so templates carry no separate side column.
pub struct AccountKindInfo {
    pub key: &'static str,
    pub label: &'static str,
    pub side: &'static str,
}
/// The account kinds a template accepts, in stable display order.
pub const ACCOUNT_KINDS: [AccountKindInfo; 10] = [
    AccountKindInfo {
        key: "cash",
        label: "现金与存款",
        side: "asset",
    },
    AccountKindInfo {
        key: "investment",
        label: "投资账户",
        side: "asset",
    },
    AccountKindInfo {
        key: "mixed",
        label: "混合投资",
        side: "asset",
    },
    AccountKindInfo {
        key: "fund",
        label: "基金",
        side: "asset",
    },
    AccountKindInfo {
        key: "bond",
        label: "债券",
        side: "asset",
    },
    AccountKindInfo {
        key: "housing_fund",
        label: "公积金",
        side: "asset",
    },
    AccountKindInfo {
        key: "other_asset",
        label: "其他资产",
        side: "asset",
    },
    AccountKindInfo {
        key: "credit_card",
        label: "信用卡",
        side: "liability",
    },
    AccountKindInfo {
        key: "loan",
        label: "贷款",
        side: "liability",
    },
    AccountKindInfo {
        key: "other_liability",
        label: "其他负债",
        side: "liability",
    },
];

/// Template (canonical) column names per kind, in template order.
pub fn template_columns(kind: &str) -> Option<&'static [&'static str]> {
    match kind {
        "accounts" => Some(&[
            "account_key",
            "name",
            "kind",
            "enabled_from",
            "disabled_from",
            "counted",
            "platform",
            "note",
        ]),
        "snapshots" => Some(&[
            "snapshot_key",
            "date",
            "account_key",
            "amount",
            "note",
            "kind_at_date",
            "counted_at_date",
        ]),
        "incomes" => Some(&["income_key", "date", "net_income", "hpf_deposit", "note"]),
        "income_coverage" => Some(&["from_date", "to_date", "state", "note"]),
        "net_worth_history" => Some(&["history_key", "date", "net_worth", "note"]),
        _ => None,
    }
}

/// Columns that may be left empty; all other template columns are required.
fn optional_columns(kind: &str) -> &'static [&'static str] {
    match kind {
        "accounts" => &["disabled_from", "platform", "note"],
        "snapshots" => &["note", "kind_at_date", "counted_at_date"],
        "incomes" => &["hpf_deposit", "note"],
        "income_coverage" => &["note"],
        "net_worth_history" => &["note"],
        _ => &[],
    }
}

/// Header-only template text (BOM + CRLF), matching the live export style.
pub fn template_csv(kind: &str) -> Result<String, ImportContractError> {
    let columns = template_columns(kind).ok_or_else(|| ImportContractError {
        code: CODE_KIND_UNKNOWN.into(),
        message: format!("未知的导入类型「{kind}」，支持：{}", KINDS.join("、")),
    })?;
    Ok(format!("\u{feff}{}\r\n", columns.join(",")))
}

// ---- Stable issue codes -----------------------------------------------------

pub const CODE_CSV_FORMAT: &str = "CSV_FORMAT";
pub const CODE_CSV_COLUMN_COUNT: &str = "CSV_COLUMN_COUNT";
pub const CODE_EMPTY_FILE: &str = "EMPTY_FILE";
pub const CODE_NO_DATA_ROWS: &str = "NO_DATA_ROWS";
pub const CODE_DUPLICATE_HEADER: &str = "DUPLICATE_HEADER";
pub const CODE_MISSING_COLUMN: &str = "MISSING_COLUMN";
pub const CODE_COLUMN_MAPPING_CONFLICT: &str = "COLUMN_MAPPING_CONFLICT";
pub const CODE_COLUMN_MAPPING_UNKNOWN_TARGET: &str = "COLUMN_MAPPING_UNKNOWN_TARGET";
pub const CODE_COLUMN_MAPPING_UNKNOWN_SOURCE: &str = "COLUMN_MAPPING_UNKNOWN_SOURCE";
pub const CODE_EXTRA_COLUMN_IGNORED: &str = "EXTRA_COLUMN_IGNORED";
pub const CODE_KEY_REQUIRED: &str = "KEY_REQUIRED";
pub const CODE_KEY_LENGTH: &str = "KEY_LENGTH";
pub const CODE_NAME_REQUIRED: &str = "NAME_REQUIRED";
pub const CODE_NAME_LENGTH: &str = "NAME_LENGTH";
pub const CODE_KIND_INVALID: &str = "KIND_INVALID";
pub const CODE_BOOL_INVALID: &str = "BOOL_INVALID";
pub const CODE_PLATFORM_LENGTH: &str = "PLATFORM_LENGTH";
pub const CODE_NOTE_LENGTH: &str = "NOTE_LENGTH";
pub const CODE_FIELD_NUL: &str = "FIELD_NUL";
pub const CODE_DATE_INVALID: &str = "DATE_INVALID";
pub const CODE_DATE_REQUIRED: &str = "DATE_REQUIRED";
pub const CODE_DATE_FUTURE: &str = "DATE_FUTURE";
pub const CODE_ACCOUNT_DATE_ORDER: &str = "ACCOUNT_DATE_ORDER";
pub const CODE_AMOUNT_REQUIRED: &str = "AMOUNT_REQUIRED";
pub const CODE_AMOUNT_INVALID: &str = "AMOUNT_INVALID";
pub const CODE_AMOUNT_NEGATIVE: &str = "AMOUNT_NEGATIVE";
pub const CODE_AMOUNT_RANGE: &str = "AMOUNT_RANGE";
pub const CODE_STATE_INVALID: &str = "STATE_INVALID";
pub const CODE_COVERAGE_RANGE_INVALID: &str = "COVERAGE_RANGE_INVALID";
pub const CODE_COVERAGE_OVERLAP: &str = "COVERAGE_OVERLAP";
pub const CODE_DUPLICATE_KEY_SAME: &str = "DUPLICATE_KEY_SAME";
pub const CODE_DUPLICATE_KEY_CONFLICT: &str = "DUPLICATE_KEY_CONFLICT";
pub const CODE_SNAPSHOT_DUPLICATE_ACCOUNT: &str = "SNAPSHOT_DUPLICATE_ACCOUNT";
pub const CODE_SNAPSHOT_GROUP_DATE_CONFLICT: &str = "SNAPSHOT_GROUP_DATE_CONFLICT";
pub const CODE_SNAPSHOT_GROUP_NOTE_CONFLICT: &str = "SNAPSHOT_GROUP_NOTE_CONFLICT";
pub const CODE_SNAPSHOT_DATE_CONFLICT: &str = "SNAPSHOT_DATE_CONFLICT";
pub const CODE_ACCOUNT_UNMAPPED: &str = "ACCOUNT_UNMAPPED";
pub const CODE_ACCOUNT_NOT_ACTIVE: &str = "ACCOUNT_NOT_ACTIVE";
pub const CODE_SNAPSHOT_MISSING_ACCOUNT: &str = "SNAPSHOT_MISSING_ACCOUNT";
pub const CODE_GROUP_REQUIRES_CONTEXT: &str = "GROUP_REQUIRES_CONTEXT";
pub const CODE_ACCOUNT_KEY_MAPPED: &str = "ACCOUNT_KEY_MAPPED";
pub const CODE_ACCOUNT_NAME_CANDIDATE: &str = "ACCOUNT_NAME_CANDIDATE";

// ---- Hard (out-of-band) error codes ----------------------------------------

pub const CODE_CONTRACT_VERSION_UNSUPPORTED: &str = "CONTRACT_VERSION_UNSUPPORTED";
pub const CODE_CONTRACT_INVALID: &str = "CONTRACT_INVALID";
pub const CODE_KIND_UNKNOWN: &str = "KIND_UNKNOWN";
pub const CODE_CONTEXT_INVALID: &str = "CONTEXT_INVALID";
pub const CODE_LIMIT_SIZE: &str = "LIMIT_SIZE";
pub const CODE_LIMIT_ROWS: &str = "LIMIT_ROWS";
pub const CODE_CANCELLED: &str = "CANCELLED";

/// Contract-level failure: the request or the entry context itself is unusable,
/// so no v1 preview can be produced. Content problems are in-band issues
/// instead. Serializes as `{"code":…,"message":…}`.
#[derive(Debug, Clone, Serialize)]
pub struct ImportContractError {
    pub code: String,
    pub message: String,
}
impl ImportContractError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for ImportContractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for ImportContractError {}

/// Explicit entry context. `today` is the validation "now" (strict
/// `YYYY-MM-DD`) so tests can pin dates; `cancel` is a stateless checkpoint
/// callback polled during parsing and validation; returning true aborts with
/// `CANCELLED`.
pub struct ImportContext<'a> {
    pub today: &'a str,
    pub cancel: &'a dyn Fn() -> bool,
}

/// Import contract v1 request. `column_mapping` maps source column names to
/// template column names (direction fixed: source → template); a source column
/// whose name equals the template name is matched automatically.
#[derive(Debug, Clone, Deserialize)]
pub struct ImportRequestV1 {
    pub contract_version: u32,
    pub kind: String,
    pub csv_text: String,
    #[serde(default)]
    pub column_mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub existing_accounts: Option<Vec<ExistingAccountV1>>,
}

/// Read-only catalog of one already known account. `external_key` is the
/// external key previously mapped for that account; accounts without one
/// cannot be referenced by key and stay outside import-side completeness
/// checks (the write layer still checks against the real database).
#[derive(Debug, Clone, Deserialize)]
pub struct ExistingAccountV1 {
    pub external_key: Option<String>,
    pub account_id: String,
    pub name: String,
    pub kind: String,
    pub enabled_from: String,
    pub disabled_from: Option<String>,
}

/// Group-level validation outcome for check-in imports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupValidationV1 {
    Valid,
    Invalid,
    RequiresAccountContext,
}

/// Issue severity. `error` blocks committing the affected data; `warning` is
/// informational.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SeverityV1 {
    Error,
    Warning,
}

/// A locatable problem. `source_row` is the record's starting physical line
/// (null only for file-level issues such as an empty file). `column` carries
/// the source column name for field issues, the template column name when no
/// source column exists (missing columns), and the 1-based character column as
/// a decimal string for raw `CSV_FORMAT` errors — those messages always state
/// the exact physical line too.
#[derive(Debug, Clone, Serialize)]
pub struct IssueV1 {
    pub code: &'static str,
    pub severity: SeverityV1,
    pub source_row: Option<u32>,
    pub column: Option<String>,
    pub group_key: Option<String>,
    pub message: String,
}

/// Counts. When the header resolves:
/// `rows_read == rows_valid + rows_error + duplicates_same +
/// duplicates_conflict`. Snapshot rows are account-level lines; inventory
/// counts are the group fields, never derived from row counts. Coverage
/// conflicts remain normalized in `rows` for preview but count as row errors;
/// message limits never change the complete unique error-row count.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CountsV1 {
    pub rows_read: u32,
    pub rows_valid: u32,
    pub rows_error: u32,
    pub groups_valid: u32,
    pub groups_invalid: u32,
    pub groups_requires_account_context: u32,
    pub duplicates_same: u32,
    pub duplicates_conflict: u32,
}

/// Import contract v1 preview.
#[derive(Debug, Clone, Serialize)]
pub struct ImportPreviewV1 {
    pub contract_version: u32,
    pub kind: String,
    pub rows: Vec<StandardRowV1>,
    pub groups: Vec<SnapshotGroupV1>,
    pub issues: Vec<IssueV1>,
    pub counts: CountsV1,
}

/// Standard rows are to-be-committed data, not written facts. Rows are unique
/// by external key where a key exists; `row_kind` discriminates the payload.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "row_kind", rename_all = "snake_case")]
pub enum StandardRowV1 {
    Accounts(AccountRowV1),
    Snapshots(SnapshotRowV1),
    Incomes(IncomeRowV1),
    IncomeCoverage(CoverageRowV1),
    NetWorthHistory(NetWorthRowV1),
}

impl StandardRowV1 {
    fn source_row(&self) -> u32 {
        match self {
            StandardRowV1::Accounts(r) => r.source_row,
            StandardRowV1::Snapshots(r) => r.source_row,
            StandardRowV1::Incomes(r) => r.source_row,
            StandardRowV1::IncomeCoverage(r) => r.source_row,
            StandardRowV1::NetWorthHistory(r) => r.source_row,
        }
    }

    fn set_source_row(&mut self, value: u32) {
        match self {
            StandardRowV1::Accounts(r) => r.source_row = value,
            StandardRowV1::Snapshots(r) => r.source_row = value,
            StandardRowV1::Incomes(r) => r.source_row = value,
            StandardRowV1::IncomeCoverage(r) => r.source_row = value,
            StandardRowV1::NetWorthHistory(r) => r.source_row = value,
        }
    }
}

/// One account to create or map; the kind decides the asset/liability side.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AccountRowV1 {
    pub source_row: u32,
    pub account_key: String,
    pub name: String,
    pub kind: String,
    pub enabled_from: String,
    pub disabled_from: Option<String>,
    pub counted: bool,
    pub platform: Option<String>,
    pub note: Option<String>,
}

/// One account line of one check-in group. The group, not this row, is the
/// commit unit; `kind_at_date`/`counted_at_date` are explicit historical
/// overrides, null meaning "use the mapped account's data".
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SnapshotRowV1 {
    pub source_row: u32,
    pub snapshot_key: String,
    pub date: String,
    pub account_key: String,
    pub amount_cents: String,
    pub note: Option<String>,
    pub kind_at_date: Option<String>,
    pub counted_at_date: Option<bool>,
}

/// One income record. Empty `hpf_deposit` is null (unknown); an explicit `0`
/// is the string `"0"`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IncomeRowV1 {
    pub source_row: u32,
    pub income_key: String,
    pub date: String,
    pub net_income_cents: String,
    pub hpf_deposit_cents: Option<String>,
    pub note: Option<String>,
}

/// One income completeness declaration for the half-open interval
/// `(from_date, to_date]`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CoverageRowV1 {
    pub source_row: u32,
    pub from_date: String,
    pub to_date: String,
    pub state: String,
    pub note: Option<String>,
}

/// One net-worth reference point. May be negative; never a check-in and never
/// a cash starting point.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NetWorthRowV1 {
    pub source_row: u32,
    pub history_key: String,
    pub date: String,
    pub net_worth_cents: String,
    pub note: Option<String>,
}

/// One check-in group as seen in the file. `date` is null only when the member
/// rows disagree on the date; `source_rows` includes every member row, also
/// rejected ones.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotGroupV1 {
    pub group_key: String,
    pub date: Option<String>,
    pub source_rows: Vec<u32>,
    pub validation: GroupValidationV1,
}

/// Decode a request JSON string and parse it. JSON or shape failures map to
/// `CONTRACT_INVALID`; everything else behaves like [`parse_import_v1`].
pub fn parse_import_request_json(
    json: &str,
    ctx: &ImportContext<'_>,
) -> Result<ImportPreviewV1, ImportContractError> {
    let request: ImportRequestV1 = serde_json::from_str(json).map_err(|e| {
        ImportContractError::new(CODE_CONTRACT_INVALID, format!("请求无法解析：{e}"))
    })?;
    parse_import_v1(&request, ctx)
}

/// Parse one import request into a v1 preview.
pub fn parse_import_v1(
    request: &ImportRequestV1,
    ctx: &ImportContext<'_>,
) -> Result<ImportPreviewV1, ImportContractError> {
    if (ctx.cancel)() {
        return Err(ImportContractError::new(
            CODE_CANCELLED,
            "解析已取消，未产生结果",
        ));
    }
    if request.contract_version != CONTRACT_VERSION {
        return Err(ImportContractError::new(
            CODE_CONTRACT_VERSION_UNSUPPORTED,
            format!(
                "contract_version {} 不受支持，本组件只接受 {}",
                request.contract_version, CONTRACT_VERSION
            ),
        ));
    }
    let kind = request.kind.as_str();
    if !KINDS.contains(&kind) {
        return Err(ImportContractError::new(
            CODE_KIND_UNKNOWN,
            format!("未知的导入类型「{kind}」，支持：{}", KINDS.join("、")),
        ));
    }
    let today_date = validate_date_strict(ctx.today).map_err(|_| {
        ImportContractError::new(
            CODE_CONTEXT_INVALID,
            "上下文 today 不是合法的 YYYY-MM-DD 日期",
        )
    })?;
    let today = today_date.as_str();
    let catalog = match &request.existing_accounts {
        None => None,
        Some(list) => Some(build_catalog(list, today)?),
    };
    if request.csv_text.len() > MAX_BYTES {
        return Err(ImportContractError::new(
            CODE_LIMIT_SIZE,
            format!(
                "文件超过 {} MiB 上限，请拆分后分批导入",
                MAX_BYTES / 1024 / 1024
            ),
        ));
    }

    let text = request
        .csv_text
        .strip_prefix('\u{feff}')
        .unwrap_or(&request.csv_text);
    let (records, fatal) = match csv::parse_records(text, MAX_DATA_ROWS + 1, ctx.cancel) {
        Ok(pair) => pair,
        Err(csv::TokenizeStop::OverLimit) => {
            return Err(ImportContractError::new(
                CODE_LIMIT_ROWS,
                format!("数据行超过 {MAX_DATA_ROWS} 行上限，请拆分后分批导入"),
            ))
        }
        Err(csv::TokenizeStop::Cancelled) => {
            return Err(ImportContractError::new(
                CODE_CANCELLED,
                "解析已取消，未产生结果",
            ))
        }
    };

    let mut issues: Vec<IssueV1> = Vec::new();
    let mut counts = CountsV1 {
        rows_read: records.len().saturating_sub(1) as u32,
        ..Default::default()
    };

    let Some(header_record) = records.first() else {
        if let Some(f) = &fatal {
            issues.push(format_issue(f, None));
        } else {
            issues.push(file_issue(CODE_EMPTY_FILE, "文件为空，没有可导入的内容"));
        }
        return Ok(finish(
            kind.to_string(),
            Vec::new(),
            Vec::new(),
            issues,
            counts,
        ));
    };
    if let Some(f) = &fatal {
        issues.push(format_issue(f, Some(f.line as u32)));
    }

    let header = Header::resolve(kind, header_record, &request.column_mapping, &mut issues);
    let Ok(header) = header else {
        // File-level shape problems: the table cannot be read unambiguously,
        // so no standard rows are produced. The issues explain why.
        return Ok(finish(
            kind.to_string(),
            Vec::new(),
            Vec::new(),
            issues,
            counts,
        ));
    };
    if records.len() == 1 && fatal.is_none() {
        issues.push(file_issue_at(
            CODE_NO_DATA_ROWS,
            header_record.start_line as u32,
            "文件只有表头，没有数据行",
        ));
        return Ok(finish(
            kind.to_string(),
            Vec::new(),
            Vec::new(),
            issues,
            counts,
        ));
    }

    let mut rows: Vec<StandardRowV1> = Vec::new();
    let mut rejected_members: Vec<(String, u32)> = Vec::new();
    let fatal_data_row = fatal
        .as_ref()
        .filter(|f| f.record_start_line > header_record.start_line);
    let mut field_errors: u32 = u32::from(fatal_data_row.is_some());
    if let Some(f) = fatal_data_row {
        if !records.iter().any(|r| r.start_line == f.record_start_line) {
            counts.rows_read += 1;
        }
    }
    // An unassignable bad snapshot row or fatal CSV blocks every candidate group.
    let mut unresolved_snapshot_error = fatal.is_some();
    let mut post_errors = 0;
    let header_cells = header_record.cells.len();
    for record in records.iter().skip(1) {
        if (ctx.cancel)() {
            return Err(ImportContractError::new(
                CODE_CANCELLED,
                "解析已取消，未产生结果",
            ));
        }
        // The tokenizer may expose a partial EOF record; it is never a valid row.
        if fatal_data_row.is_some_and(|f| record.start_line == f.record_start_line) {
            continue;
        }
        if record.cells.len() != header_cells {
            field_errors += 1;
            let mut issue = file_issue_at(
                CODE_CSV_COLUMN_COUNT,
                record.start_line as u32,
                &format!(
                    "第 {} 行有 {} 个字段，表头有 {header_cells} 个：字段数不一致，请检查逗号或引号",
                    record.start_line,
                    record.cells.len()
                ),
            );
            if kind == "snapshots" {
                let key = header
                    .cell(record, "snapshot_key")
                    .unwrap_or_default()
                    .trim();
                if key.is_empty() {
                    unresolved_snapshot_error = true;
                } else {
                    issue.group_key = Some(key.to_string());
                    rejected_members.push((key.to_string(), record.start_line as u32));
                }
            }
            issues.push(issue);
            continue;
        }
        let parsed = match kind {
            "accounts" => parse_account_row(record, &header, today),
            "snapshots" => parse_snapshot_row(record, &header, today),
            "incomes" => parse_income_row(record, &header, today),
            "income_coverage" => parse_coverage_row(record, &header, today),
            "net_worth_history" => parse_net_worth_row(record, &header, today),
            _ => unreachable!("kind validated above"),
        };
        match parsed {
            Ok(row) => rows.push(row),
            Err(reject) => {
                field_errors += 1;
                if let Some(key) = reject.group_key {
                    rejected_members.push((key, record.start_line as u32));
                } else if kind == "snapshots" {
                    unresolved_snapshot_error = true;
                }
                issues.extend(reject.issues);
            }
        }
    }
    counts.rows_error = field_errors;

    match kind {
        "accounts" => {
            post_keyed(
                &mut rows,
                &mut issues,
                &mut counts,
                account_key_of,
                "account_key",
                &header,
            );
            post_account_candidates(&mut rows, &mut issues, &catalog);
        }
        "snapshots" => {
            let mut groups = post_snapshots(
                &mut rows,
                &rejected_members,
                &mut issues,
                &mut counts,
                &header,
                &catalog,
            );
            if unresolved_snapshot_error {
                for group in &mut groups {
                    issues.push(IssueV1 {
                        code: CODE_CSV_FORMAT,
                        severity: SeverityV1::Error,
                        source_row: group.source_rows.first().copied(),
                        column: None,
                        group_key: Some(group.group_key.clone()),
                        message: "文件含无法可靠归组的错误，所有候选盘点组需重新核对".into(),
                    });
                    group.validation = GroupValidationV1::Invalid;
                }
                counts.groups_valid = 0;
                counts.groups_requires_account_context = 0;
                counts.groups_invalid = groups.len() as u32;
            }
            counts.rows_valid = rows.len() as u32;
            return Ok(finish(kind.to_string(), rows, groups, issues, counts));
        }
        "incomes" => {
            post_keyed(
                &mut rows,
                &mut issues,
                &mut counts,
                income_key_of,
                "income_key",
                &header,
            );
        }
        "income_coverage" => post_errors = post_coverage(&mut rows, &mut issues, &header),
        "net_worth_history" => {
            post_keyed(
                &mut rows,
                &mut issues,
                &mut counts,
                history_key_of,
                "history_key",
                &header,
            );
        }
        _ => unreachable!("kind validated above"),
    }
    if (ctx.cancel)() {
        return Err(ImportContractError::new(
            CODE_CANCELLED,
            "解析已取消，未产生结果",
        ));
    }
    counts.rows_valid = rows.len() as u32 - post_errors;
    counts.rows_error += post_errors;
    Ok(finish(kind.to_string(), rows, Vec::new(), issues, counts))
}

fn account_key_of(row: &StandardRowV1) -> &str {
    match row {
        StandardRowV1::Accounts(r) => &r.account_key,
        _ => unreachable!("post_keyed used for accounts"),
    }
}

fn income_key_of(row: &StandardRowV1) -> &str {
    match row {
        StandardRowV1::Incomes(r) => &r.income_key,
        _ => unreachable!("post_keyed used for incomes"),
    }
}

fn history_key_of(row: &StandardRowV1) -> &str {
    match row {
        StandardRowV1::NetWorthHistory(r) => &r.history_key,
        _ => unreachable!("post_keyed used for net worth history"),
    }
}

/// Sort issues deterministically and assemble the preview.
fn finish(
    kind: String,
    rows: Vec<StandardRowV1>,
    groups: Vec<SnapshotGroupV1>,
    mut issues: Vec<IssueV1>,
    counts: CountsV1,
) -> ImportPreviewV1 {
    issues.sort_by(|a, b| {
        a.source_row
            .cmp(&b.source_row)
            .then_with(|| a.code.cmp(b.code))
            .then_with(|| a.column.cmp(&b.column))
            .then_with(|| a.group_key.cmp(&b.group_key))
            .then_with(|| a.message.cmp(&b.message))
    });
    let mut groups = groups;
    groups.sort_by(|a, b| {
        (
            a.date.is_none(),
            a.date.as_deref().unwrap_or_default(),
            a.group_key.as_str(),
        )
            .cmp(&(
                b.date.is_none(),
                b.date.as_deref().unwrap_or_default(),
                b.group_key.as_str(),
            ))
    });
    ImportPreviewV1 {
        contract_version: CONTRACT_VERSION,
        kind,
        rows,
        groups,
        issues,
        counts,
    }
}

fn file_issue(code: &'static str, message: &str) -> IssueV1 {
    IssueV1 {
        code,
        severity: SeverityV1::Error,
        source_row: None,
        column: None,
        group_key: None,
        message: message.into(),
    }
}

fn file_issue_at(code: &'static str, row: u32, message: &str) -> IssueV1 {
    IssueV1 {
        code,
        severity: SeverityV1::Error,
        source_row: Some(row),
        column: None,
        group_key: None,
        message: message.into(),
    }
}

fn format_issue(f: &csv::FormatError, record_line: Option<u32>) -> IssueV1 {
    IssueV1 {
        code: CODE_CSV_FORMAT,
        severity: SeverityV1::Error,
        source_row: record_line,
        column: Some(f.column.to_string()),
        group_key: None,
        message: format!("第 {} 行第 {} 列：{}", f.line, f.column, f.reason),
    }
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        value.to_string()
    } else {
        let head: String = value.chars().take(max).collect();
        format!("{head}…")
    }
}

// ---- Catalog ----------------------------------------------------------------

struct Catalog {
    by_key: HashMap<String, usize>,
    by_name: HashMap<String, Vec<usize>>,
    entries: Vec<CatalogEntry>,
}

struct CatalogEntry {
    external_key: Option<String>,
    name: String,
    enabled_from: String,
    disabled_from: Option<String>,
}

impl Catalog {
    /// Accounts due on `date` that can be referenced by an external key.
    fn due(&self, date: &str) -> Vec<&CatalogEntry> {
        self.entries
            .iter()
            .filter(|e| e.external_key.is_some() && e.enabled_from.as_str() <= date)
            .filter(|e| e.disabled_from.as_deref().is_none_or(|d| date < d))
            .collect()
    }
}

fn build_catalog(list: &[ExistingAccountV1], today: &str) -> Result<Catalog, ImportContractError> {
    let mut catalog = Catalog {
        by_key: HashMap::new(),
        by_name: HashMap::new(),
        entries: Vec::with_capacity(list.len()),
    };
    let mut seen_ids: BTreeSet<String> = BTreeSet::new();
    for (i, a) in list.iter().enumerate() {
        let invalid = |what: String| {
            ImportContractError::new(
                CODE_CONTEXT_INVALID,
                format!("existing_accounts 第 {} 项无效：{what}", i + 1),
            )
        };
        if a.account_id.trim().is_empty() {
            return Err(invalid("account_id 不能为空".into()));
        }
        if !seen_ids.insert(a.account_id.clone()) {
            return Err(invalid(format!("稳定 ID {} 重复", a.account_id)));
        }
        if let Some(k) = a.external_key.as_deref() {
            let k = k.trim();
            if k.is_empty() || k.chars().count() > MAX_KEY_CHARS {
                return Err(invalid("external_key 为空或超过 100 字".into()));
            }
            if catalog.by_key.contains_key(k) {
                return Err(invalid(format!("外部键 {k} 重复")));
            }
            catalog.by_key.insert(k.to_string(), i);
        }
        if fields::account_kind(a.kind.trim()).is_none() {
            return Err(invalid(format!("类型 {} 不是当前支持的账户类型", a.kind)));
        }
        let enabled = validate_date_strict(a.enabled_from.trim())
            .map_err(|_| invalid("enabled_from 不是合法的 YYYY-MM-DD 日期".into()))?;
        if enabled.as_str() > today {
            return Err(invalid("enabled_from 不能晚于今天".into()));
        }
        let disabled = match a.disabled_from.as_deref() {
            None => None,
            Some(d) => {
                let d = validate_date_strict(d.trim())
                    .map_err(|_| invalid("disabled_from 不是合法的 YYYY-MM-DD 日期".into()))?;
                if d.as_str() > today {
                    return Err(invalid("disabled_from 不能晚于今天".into()));
                }
                if d.as_str() <= enabled.as_str() {
                    return Err(invalid("disabled_from 必须晚于 enabled_from".into()));
                }
                Some(d)
            }
        };
        catalog.entries.push(CatalogEntry {
            external_key: a.external_key.as_deref().map(str::trim).map(str::to_string),
            name: a.name.trim().to_string(),
            enabled_from: enabled,
            disabled_from: disabled,
        });
    }
    for (i, e) in catalog.entries.iter().enumerate() {
        catalog.by_name.entry(e.name.clone()).or_default().push(i);
    }
    Ok(catalog)
}

// ---- Header -----------------------------------------------------------------

/// Resolved header: template column → source cell index.
struct Header {
    index: HashMap<&'static str, usize>,
    /// Source column name per template column, for issue locations.
    source_name: HashMap<&'static str, String>,
}

impl Header {
    fn cell<'a>(&self, record: &'a csv::RawRecord, column: &str) -> Option<&'a str> {
        self.index
            .get(column)
            .and_then(|i| record.cells.get(*i))
            .map(String::as_str)
    }

    /// Source column name for issue locations; falls back to the template name.
    fn column_label(&self, column: &str) -> String {
        self.source_name
            .get(column)
            .cloned()
            .unwrap_or_else(|| column.to_string())
    }

    fn resolve(
        kind: &str,
        header: &csv::RawRecord,
        mapping: &BTreeMap<String, String>,
        issues: &mut Vec<IssueV1>,
    ) -> Result<Header, ()> {
        let template = template_columns(kind).unwrap_or_default();
        let line = header.start_line as u32;
        let mut fatal = false;
        let mut first_of_name: HashMap<&str, usize> = HashMap::new();
        for (i, raw) in header.cells.iter().enumerate() {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            if first_of_name.contains_key(name) {
                issues.push(IssueV1 {
                    code: CODE_DUPLICATE_HEADER,
                    severity: SeverityV1::Error,
                    source_row: Some(line),
                    column: Some(name.to_string()),
                    group_key: None,
                    message: format!("表头中有重复的列「{name}」，无法确定数据属于哪一列"),
                });
                fatal = true;
            } else {
                first_of_name.insert(name, i);
            }
        }
        let mut index: HashMap<&'static str, usize> = HashMap::new();
        let mut source_name: HashMap<&'static str, String> = HashMap::new();
        let mut resolved_source: BTreeSet<usize> = BTreeSet::new();
        // Explicit mappings first; a source column whose name equals the
        // template name is matched automatically afterwards.
        for (source, target) in mapping {
            let source = source.trim();
            let Some(&slot) = template.iter().find(|c| **c == target.as_str()) else {
                issues.push(IssueV1 {
                    code: CODE_COLUMN_MAPPING_UNKNOWN_TARGET,
                    severity: SeverityV1::Error,
                    source_row: Some(line),
                    column: Some(target.clone()),
                    group_key: None,
                    message: format!("列映射目标「{target}」不是本类型的模板列"),
                });
                fatal = true;
                continue;
            };
            let Some(&src) = first_of_name.get(source) else {
                issues.push(IssueV1 {
                    code: CODE_COLUMN_MAPPING_UNKNOWN_SOURCE,
                    severity: SeverityV1::Error,
                    source_row: Some(line),
                    column: Some(source.to_string()),
                    group_key: None,
                    message: format!("列映射的源列「{source}」不在文件表头中"),
                });
                fatal = true;
                continue;
            };
            if let Some(prev) = index.insert(slot, src) {
                issues.push(IssueV1 {
                    code: CODE_COLUMN_MAPPING_CONFLICT,
                    severity: SeverityV1::Error,
                    source_row: Some(line),
                    column: Some(target.clone()),
                    group_key: None,
                    message: format!(
                        "「{}」和「{}」都映射到模板列「{target}」，一个模板列只能对应一个源列",
                        header.cells[prev].trim(),
                        source
                    ),
                });
                fatal = true;
                continue;
            }
            source_name.insert(slot, source.to_string());
            resolved_source.insert(src);
        }
        for column in template {
            if index.contains_key(column) {
                continue;
            }
            if let Some(&src) = first_of_name.get(*column) {
                index.insert(column, src);
                source_name.insert(column, (*column).to_string());
                resolved_source.insert(src);
            }
        }
        for column in template {
            if !optional_columns(kind).contains(column) && !index.contains_key(column) {
                issues.push(IssueV1 {
                    code: CODE_MISSING_COLUMN,
                    severity: SeverityV1::Error,
                    source_row: Some(line),
                    column: Some((*column).to_string()),
                    group_key: None,
                    message: format!("缺少必需的模板列「{column}」，请补列或在列映射中指定"),
                });
                fatal = true;
            }
        }
        let mut extra_warnings = WARNING_CAP;
        for (i, raw) in header.cells.iter().enumerate() {
            let name = raw.trim();
            if extra_warnings == 0 {
                break;
            }
            if !resolved_source.contains(&i) && !name.is_empty() {
                extra_warnings -= 1;
                issues.push(IssueV1 {
                    code: CODE_EXTRA_COLUMN_IGNORED,
                    severity: SeverityV1::Warning,
                    source_row: Some(line),
                    column: Some(name.to_string()),
                    group_key: None,
                    message: format!("列「{name}」未映射到任何模板列，将被忽略"),
                });
            }
        }
        if fatal {
            return Err(());
        }
        Ok(Header { index, source_name })
    }
}

// ---- Shared cell helpers ----------------------------------------------------

fn row_issue(
    code: &'static str,
    row: u32,
    column: String,
    group_key: Option<String>,
    message: String,
) -> IssueV1 {
    IssueV1 {
        code,
        severity: SeverityV1::Error,
        source_row: Some(row),
        column: Some(column),
        group_key,
        message,
    }
}

/// Parse a cell as a trimmed external key (1–100 chars, no NUL).
fn key_cell(
    raw: Option<&str>,
    row: u32,
    column: &str,
    label: &str,
    issues: &mut Vec<IssueV1>,
) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        issues.push(row_issue(
            CODE_KEY_REQUIRED,
            row,
            column.to_string(),
            None,
            format!("{label}不能为空"),
        ));
        return None;
    }
    if value.chars().count() > MAX_KEY_CHARS {
        issues.push(row_issue(
            CODE_KEY_LENGTH,
            row,
            column.to_string(),
            None,
            format!("{label}最多 {MAX_KEY_CHARS} 字"),
        ));
        return None;
    }
    if value.contains('\0') {
        issues.push(row_issue(
            CODE_FIELD_NUL,
            row,
            column.to_string(),
            None,
            format!("{label}不能包含空字符"),
        ));
        return None;
    }
    Some(value.to_string())
}

/// Parse a note cell: trimmed, empty → None, bounded by `max`.
fn note_cell(
    raw: Option<&str>,
    row: u32,
    column: &str,
    max: usize,
    issues: &mut Vec<IssueV1>,
) -> Option<Option<String>> {
    let value = raw?.trim();
    if value.is_empty() {
        return Some(None);
    }
    if value.chars().count() > max {
        issues.push(row_issue(
            CODE_NOTE_LENGTH,
            row,
            column.to_string(),
            None,
            format!("备注最多 {max} 字"),
        ));
        return None;
    }
    if value.contains('\0') {
        issues.push(row_issue(
            CODE_FIELD_NUL,
            row,
            column.to_string(),
            None,
            "备注不能包含空字符".into(),
        ));
        return None;
    }
    Some(Some(value.to_string()))
}

/// Parse an optional date cell: empty → `Some(None)`, invalid → `None` with an
/// issue. Future dates are rejected in every template.
fn optional_date(
    raw: Option<&str>,
    row: u32,
    column: &str,
    label: &str,
    today: &str,
    issues: &mut Vec<IssueV1>,
) -> Option<Option<String>> {
    let value = raw?.trim();
    if value.is_empty() {
        return Some(None);
    }
    match validate_date_strict(value) {
        Ok(d) if d.as_str() > today => {
            issues.push(row_issue(
                CODE_DATE_FUTURE,
                row,
                column.to_string(),
                None,
                format!("{label} {d} 晚于今天 {today}，历史导入不接受未来日期"),
            ));
            None
        }
        Ok(d) => Some(Some(d)),
        Err(reason) => {
            issues.push(row_issue(
                CODE_DATE_INVALID,
                row,
                column.to_string(),
                None,
                format!("{label}「{}」{reason}", truncate(value, 30)),
            ));
            None
        }
    }
}

/// Required date: empty is an error, never an unknown.
fn required_date(
    raw: Option<&str>,
    row: u32,
    column: &str,
    label: &str,
    today: &str,
    issues: &mut Vec<IssueV1>,
) -> Option<String> {
    match optional_date(raw, row, column, label, today, issues) {
        None => None,
        Some(None) => {
            issues.push(row_issue(
                CODE_DATE_REQUIRED,
                row,
                column.to_string(),
                None,
                format!("{label}不能为空"),
            ));
            None
        }
        Some(v) => v,
    }
}

/// Parse an amount cell in yuan into `Some(cents)`; empty → `Some(None)`;
/// malformed → `None` with an issue.
fn amount_cell(
    raw: Option<&str>,
    row: u32,
    column: &str,
    label: &str,
    allow_negative: bool,
    issues: &mut Vec<IssueV1>,
) -> Option<Option<String>> {
    let value = raw?.trim();
    if value.is_empty() {
        return Some(None);
    }
    match parse_amount_cents(value, allow_negative) {
        Ok(cents) => Some(Some(cents)),
        Err(e) => {
            let (code, message) = match e {
                AmountError::Negative => (
                    CODE_AMOUNT_NEGATIVE,
                    format!("{label}不能为负数；负债请填写正的欠款金额"),
                ),
                AmountError::Range => (CODE_AMOUNT_RANGE, format!("{label}超出可保存的金额范围")),
                AmountError::Invalid(reason) => (
                    CODE_AMOUNT_INVALID,
                    format!("{label}「{}」{reason}", truncate(value, 30)),
                ),
            };
            issues.push(row_issue(code, row, column.to_string(), None, message));
            None
        }
    }
}

/// Required amount: empty is an error, never an unknown.
fn required_amount(
    raw: Option<&str>,
    row: u32,
    column: &str,
    label: &str,
    allow_negative: bool,
    issues: &mut Vec<IssueV1>,
) -> Option<String> {
    match amount_cell(raw, row, column, label, allow_negative, issues) {
        None => None,
        Some(None) => {
            issues.push(row_issue(
                CODE_AMOUNT_REQUIRED,
                row,
                column.to_string(),
                None,
                format!("{label}不能为空；未知金额请说明后补录，明确零请写 0"),
            ));
            None
        }
        Some(v) => v,
    }
}

// ---- Row parsers ------------------------------------------------------------

struct RowRejection {
    issues: Vec<IssueV1>,
    /// For snapshots: the group key when it itself parsed, so the group can be
    /// marked invalid even though the row failed.
    group_key: Option<String>,
}

fn parse_account_row(
    record: &csv::RawRecord,
    h: &Header,
    today: &str,
) -> Result<StandardRowV1, RowRejection> {
    let row = record.start_line as u32;
    let mut issues = Vec::new();
    let account_key = key_cell(
        h.cell(record, "account_key"),
        row,
        &h.column_label("account_key"),
        "account_key",
        &mut issues,
    );
    let name_raw = h.cell(record, "name").unwrap_or("").trim();
    let name = if name_raw.is_empty() {
        issues.push(row_issue(
            CODE_NAME_REQUIRED,
            row,
            h.column_label("name"),
            None,
            "账户名称不能为空".into(),
        ));
        None
    } else if name_raw.chars().count() > MAX_NAME_CHARS {
        issues.push(row_issue(
            CODE_NAME_LENGTH,
            row,
            h.column_label("name"),
            None,
            format!("账户名称最多 {MAX_NAME_CHARS} 字"),
        ));
        None
    } else if name_raw.contains('\0') {
        issues.push(row_issue(
            CODE_FIELD_NUL,
            row,
            h.column_label("name"),
            None,
            "账户名称不能包含空字符".into(),
        ));
        None
    } else {
        Some(name_raw.to_string())
    };
    let kind_raw = h.cell(record, "kind").unwrap_or("").trim();
    let kind = match fields::account_kind(kind_raw) {
        Some(k) => Some(k.to_string()),
        None => {
            issues.push(row_issue(
                CODE_KIND_INVALID,
                row,
                h.column_label("kind"),
                None,
                format!(
                    "账户类型「{}」不是当前支持的类型，可用：{}",
                    truncate(kind_raw, 30),
                    ACCOUNT_KINDS
                        .iter()
                        .map(|k| k.key)
                        .collect::<Vec<_>>()
                        .join("、")
                ),
            ));
            None
        }
    };
    let enabled_from = required_date(
        h.cell(record, "enabled_from"),
        row,
        &h.column_label("enabled_from"),
        "启用日期",
        today,
        &mut issues,
    );
    let disabled_from = optional_date(
        h.cell(record, "disabled_from"),
        row,
        &h.column_label("disabled_from"),
        "停用日期",
        today,
        &mut issues,
    );
    let disabled_from = disabled_from.flatten();
    if let (Some(e), Some(d)) = (&enabled_from, &disabled_from) {
        if d <= e {
            issues.push(row_issue(
                CODE_ACCOUNT_DATE_ORDER,
                row,
                h.column_label("disabled_from"),
                None,
                format!("停用日期 {d} 必须晚于启用日期 {e}"),
            ));
        }
    }
    let counted = match h.cell(record, "counted").map(str::trim) {
        Some(v) => match fields::parse_bool(v) {
            Ok(b) => Some(b),
            Err(reason) => {
                issues.push(row_issue(
                    CODE_BOOL_INVALID,
                    row,
                    h.column_label("counted"),
                    None,
                    format!("是否计入「{}」{reason}，不能从空值猜测", truncate(v, 10)),
                ));
                None
            }
        },
        None => {
            issues.push(row_issue(
                CODE_BOOL_INVALID,
                row,
                h.column_label("counted"),
                None,
                "是否计入不能为空，必须明确写 true 或 false".into(),
            ));
            None
        }
    };
    let platform = match h.cell(record, "platform").map(str::trim) {
        None | Some("") => None,
        Some(v) if v.chars().count() > MAX_PLATFORM_CHARS => {
            issues.push(row_issue(
                CODE_PLATFORM_LENGTH,
                row,
                h.column_label("platform"),
                None,
                format!("平台最多 {MAX_PLATFORM_CHARS} 字，且不接收卡号或登录凭据"),
            ));
            None
        }
        Some(v) if v.contains('\0') => {
            issues.push(row_issue(
                CODE_FIELD_NUL,
                row,
                h.column_label("platform"),
                None,
                "平台不能包含空字符".into(),
            ));
            None
        }
        Some(v) => Some(v.to_string()),
    };
    let note = note_cell(
        h.cell(record, "note"),
        row,
        &h.column_label("note"),
        MAX_ACCOUNT_NOTE_CHARS,
        &mut issues,
    );
    if issues.iter().any(|i| i.severity == SeverityV1::Error) {
        return Err(RowRejection {
            issues,
            group_key: None,
        });
    }
    Ok(StandardRowV1::Accounts(AccountRowV1 {
        source_row: row,
        account_key: account_key.expect("validated"),
        name: name.expect("validated"),
        kind: kind.expect("validated"),
        enabled_from: enabled_from.expect("validated"),
        disabled_from,
        counted: counted.expect("validated"),
        platform,
        note: note.flatten(),
    }))
}

fn parse_snapshot_row(
    record: &csv::RawRecord,
    h: &Header,
    today: &str,
) -> Result<StandardRowV1, RowRejection> {
    let row = record.start_line as u32;
    let mut issues = Vec::new();
    let snapshot_key = key_cell(
        h.cell(record, "snapshot_key"),
        row,
        &h.column_label("snapshot_key"),
        "snapshot_key",
        &mut issues,
    );
    let date = required_date(
        h.cell(record, "date"),
        row,
        &h.column_label("date"),
        "盘点日期",
        today,
        &mut issues,
    );
    let account_key = key_cell(
        h.cell(record, "account_key"),
        row,
        &h.column_label("account_key"),
        "account_key",
        &mut issues,
    );
    let amount = required_amount(
        h.cell(record, "amount"),
        row,
        &h.column_label("amount"),
        "盘点金额",
        false,
        &mut issues,
    );
    let note = note_cell(
        h.cell(record, "note"),
        row,
        &h.column_label("note"),
        MAX_SNAPSHOT_NOTE_CHARS,
        &mut issues,
    );
    let kind_at_date = match h.cell(record, "kind_at_date").map(str::trim) {
        None | Some("") => None,
        Some(v) => match fields::account_kind(v) {
            Some(k) => Some(k.to_string()),
            None => {
                issues.push(row_issue(
                    CODE_KIND_INVALID,
                    row,
                    h.column_label("kind_at_date"),
                    None,
                    format!(
                        "kind_at_date「{}」不是当前支持的类型；留空表示沿用账户的类型",
                        truncate(v, 30)
                    ),
                ));
                None
            }
        },
    };
    let counted_at_date = match h.cell(record, "counted_at_date").map(str::trim) {
        None | Some("") => None,
        Some(v) => match fields::parse_bool(v) {
            Ok(b) => Some(b),
            Err(reason) => {
                issues.push(row_issue(
                    CODE_BOOL_INVALID,
                    row,
                    h.column_label("counted_at_date"),
                    None,
                    format!(
                        "counted_at_date「{}」{reason}；留空表示沿用账户的计入设置",
                        truncate(v, 10)
                    ),
                ));
                None
            }
        },
    };
    let group_key = snapshot_key.clone();
    if issues.iter().any(|i| i.severity == SeverityV1::Error) {
        return Err(RowRejection { issues, group_key });
    }
    Ok(StandardRowV1::Snapshots(SnapshotRowV1 {
        source_row: row,
        snapshot_key: snapshot_key.expect("validated"),
        date: date.expect("validated"),
        account_key: account_key.expect("validated"),
        amount_cents: amount.expect("validated"),
        note: note.flatten(),
        kind_at_date,
        counted_at_date,
    }))
}

fn parse_income_row(
    record: &csv::RawRecord,
    h: &Header,
    today: &str,
) -> Result<StandardRowV1, RowRejection> {
    let row = record.start_line as u32;
    let mut issues = Vec::new();
    let income_key = key_cell(
        h.cell(record, "income_key"),
        row,
        &h.column_label("income_key"),
        "income_key",
        &mut issues,
    );
    let date = required_date(
        h.cell(record, "date"),
        row,
        &h.column_label("date"),
        "到账日期",
        today,
        &mut issues,
    );
    let net_income = required_amount(
        h.cell(record, "net_income"),
        row,
        &h.column_label("net_income"),
        "税后到账",
        false,
        &mut issues,
    );
    let hpf_deposit = amount_cell(
        h.cell(record, "hpf_deposit"),
        row,
        &h.column_label("hpf_deposit"),
        "公积金缴存",
        false,
        &mut issues,
    );
    let note = note_cell(
        h.cell(record, "note"),
        row,
        &h.column_label("note"),
        MAX_INCOME_NOTE_CHARS,
        &mut issues,
    );
    if issues.iter().any(|i| i.severity == SeverityV1::Error) {
        return Err(RowRejection {
            issues,
            group_key: None,
        });
    }
    Ok(StandardRowV1::Incomes(IncomeRowV1 {
        source_row: row,
        income_key: income_key.expect("validated"),
        date: date.expect("validated"),
        net_income_cents: net_income.expect("validated"),
        hpf_deposit_cents: hpf_deposit.flatten(),
        note: note.flatten(),
    }))
}

fn parse_coverage_row(
    record: &csv::RawRecord,
    h: &Header,
    today: &str,
) -> Result<StandardRowV1, RowRejection> {
    let row = record.start_line as u32;
    let mut issues = Vec::new();
    let from_date = required_date(
        h.cell(record, "from_date"),
        row,
        &h.column_label("from_date"),
        "起始日期",
        today,
        &mut issues,
    );
    let to_date = required_date(
        h.cell(record, "to_date"),
        row,
        &h.column_label("to_date"),
        "截止日期",
        today,
        &mut issues,
    );
    if let (Some(f), Some(t)) = (&from_date, &to_date) {
        if f >= t {
            issues.push(row_issue(
                CODE_COVERAGE_RANGE_INVALID,
                row,
                h.column_label("to_date"),
                None,
                format!("完整性区间表达 (from_date, to_date]，起点 {f} 必须早于终点 {t}"),
            ));
        }
    }
    let state_raw = h.cell(record, "state").unwrap_or("").trim();
    let state = match state_raw {
        "complete" | "partial" | "unknown" => Some(state_raw.to_string()),
        _ => {
            issues.push(row_issue(
                CODE_STATE_INVALID,
                row,
                h.column_label("state"),
                None,
                format!(
                    "state「{}」须为 complete、partial 或 unknown",
                    truncate(state_raw, 30)
                ),
            ));
            None
        }
    };
    let note = note_cell(
        h.cell(record, "note"),
        row,
        &h.column_label("note"),
        MAX_INCOME_NOTE_CHARS,
        &mut issues,
    );
    if issues.iter().any(|i| i.severity == SeverityV1::Error) {
        return Err(RowRejection {
            issues,
            group_key: None,
        });
    }
    Ok(StandardRowV1::IncomeCoverage(CoverageRowV1 {
        source_row: row,
        from_date: from_date.expect("validated"),
        to_date: to_date.expect("validated"),
        state: state.expect("validated"),
        note: note.flatten(),
    }))
}

fn parse_net_worth_row(
    record: &csv::RawRecord,
    h: &Header,
    today: &str,
) -> Result<StandardRowV1, RowRejection> {
    let row = record.start_line as u32;
    let mut issues = Vec::new();
    let history_key = key_cell(
        h.cell(record, "history_key"),
        row,
        &h.column_label("history_key"),
        "history_key",
        &mut issues,
    );
    let date = required_date(
        h.cell(record, "date"),
        row,
        &h.column_label("date"),
        "参考日期",
        today,
        &mut issues,
    );
    let net_worth = required_amount(
        h.cell(record, "net_worth"),
        row,
        &h.column_label("net_worth"),
        "净资产总额",
        true,
        &mut issues,
    );
    let note = note_cell(
        h.cell(record, "note"),
        row,
        &h.column_label("note"),
        MAX_INCOME_NOTE_CHARS,
        &mut issues,
    );
    if issues.iter().any(|i| i.severity == SeverityV1::Error) {
        return Err(RowRejection {
            issues,
            group_key: None,
        });
    }
    Ok(StandardRowV1::NetWorthHistory(NetWorthRowV1 {
        source_row: row,
        history_key: history_key.expect("validated"),
        date: date.expect("validated"),
        net_worth_cents: net_worth.expect("validated"),
        note: note.flatten(),
    }))
}

// ---- Cross-row processing ---------------------------------------------------

/// Content equality ignoring `source_row`, for same-vs-conflict duplicates.
fn same_row_content(a: &StandardRowV1, b: &StandardRowV1) -> bool {
    let mut x = a.clone();
    let mut y = b.clone();
    x.set_source_row(0);
    y.set_source_row(0);
    x == y
}

/// Drop later rows that repeat an external key: identical content is a
/// `DUPLICATE_KEY_SAME` candidate, different content is a conflict. Standard
/// rows stay unique by key.
fn post_keyed(
    rows: &mut Vec<StandardRowV1>,
    issues: &mut Vec<IssueV1>,
    counts: &mut CountsV1,
    key_of: fn(&StandardRowV1) -> &str,
    key_column: &str,
    h: &Header,
) {
    let column = h.column_label(key_column);
    let mut first: HashMap<String, usize> = HashMap::new();
    let mut keep = vec![true; rows.len()];
    for (i, row) in rows.iter().enumerate() {
        let key = key_of(row).to_string();
        match first.get(&key) {
            Some(&j) => {
                let (source_row, same) = (row.source_row(), same_row_content(&rows[j], row));
                keep[i] = false;
                if same {
                    counts.duplicates_same += 1;
                    issues.push(IssueV1 {
                        code: CODE_DUPLICATE_KEY_SAME,
                        severity: SeverityV1::Warning,
                        source_row: Some(source_row),
                        column: Some(column.clone()),
                        group_key: None,
                        message: format!(
                            "外部键「{key}」与第 {} 行内容完全一致，按同一条记录处理，此行忽略",
                            rows[j].source_row()
                        ),
                    });
                } else {
                    counts.duplicates_conflict += 1;
                    issues.push(row_issue(
                        CODE_DUPLICATE_KEY_CONFLICT,
                        source_row,
                        column.clone(),
                        None,
                        format!(
                            "外部键「{key}」与第 {} 行内容不同：同一外部键只能对应一条记录，请核对后统一",
                            rows[j].source_row()
                        ),
                    ));
                }
            }
            None => {
                first.insert(key, i);
            }
        }
    }
    // Duplicate rows are counted under duplicates_*, not rows_error.
    let dropped = apply_mask(rows, &mut keep);
    rows.truncate(rows.len() - dropped as usize);
}

/// Same-name and already-mapped candidates against the account catalog.
/// Same name is only a candidate; nothing merges automatically.
fn post_account_candidates(
    rows: &mut [StandardRowV1],
    issues: &mut Vec<IssueV1>,
    catalog: &Option<Catalog>,
) {
    let Some(catalog) = catalog else { return };
    let mut mapped = WARNING_CAP;
    let mut named = WARNING_CAP;
    for row in rows.iter_mut() {
        let StandardRowV1::Accounts(a) = row else {
            continue;
        };
        if mapped > 0 {
            if let Some(&i) = catalog.by_key.get(a.account_key.as_str()) {
                mapped -= 1;
                issues.push(IssueV1 {
                    code: CODE_ACCOUNT_KEY_MAPPED,
                    severity: SeverityV1::Warning,
                    source_row: Some(a.source_row),
                    column: Some("account_key".into()),
                    group_key: None,
                    message: format!(
                        "外部键「{}」已映射到已有账户「{}」，将作为复用或更正候选，不会自动创建重复账户",
                        a.account_key, catalog.entries[i].name
                    ),
                });
            }
        }
        if named > 0 {
            if let Some(idxs) = catalog.by_name.get(a.name.as_str()) {
                let others = idxs
                    .iter()
                    .filter(|&&i| {
                        catalog.entries[i].external_key.as_deref() != Some(a.account_key.as_str())
                    })
                    .count();
                if others > 0 {
                    named -= 1;
                    issues.push(IssueV1 {
                        code: CODE_ACCOUNT_NAME_CANDIDATE,
                        severity: SeverityV1::Warning,
                        source_row: Some(a.source_row),
                        column: Some("name".into()),
                        group_key: None,
                        message: format!(
                            "与已有账户「{}」同名：同名只是候选，不会自动合并；如需复用请在账户映射中选择",
                            a.name
                        ),
                    });
                }
            }
        }
    }
}

struct GroupState {
    first_line: u32,
    first_date: Option<String>,
    dates_conflict: bool,
    note: Option<String>,
    note_conflict: bool,
    member_lines: Vec<u32>,
    member_idxs: Vec<usize>,
    seen_keys: BTreeSet<String>,
    has_rejected_member: bool,
    invalid: bool,
}

impl GroupState {
    fn new() -> Self {
        Self {
            first_line: 0,
            first_date: None,
            dates_conflict: false,
            note: None,
            note_conflict: false,
            member_lines: Vec::new(),
            member_idxs: Vec::new(),
            seen_keys: BTreeSet::new(),
            has_rejected_member: false,
            invalid: false,
        }
    }
}

fn group_entry<'a>(
    key: &str,
    order: &mut Vec<String>,
    groups: &'a mut HashMap<String, GroupState>,
) -> &'a mut GroupState {
    if !groups.contains_key(key) {
        order.push(key.to_string());
        groups.insert(key.to_string(), GroupState::new());
    }
    groups.get_mut(key).expect("just inserted")
}

/// Group check-in rows by `snapshot_key` and validate them as inventories:
/// one date per group, consistent non-empty notes, one row per account, one
/// group per day, and — only with a catalog — the full set of due accounts.
fn post_snapshots(
    rows: &mut Vec<StandardRowV1>,
    rejected_members: &[(String, u32)],
    issues: &mut Vec<IssueV1>,
    counts: &mut CountsV1,
    h: &Header,
    catalog: &Option<Catalog>,
) -> Vec<SnapshotGroupV1> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, GroupState> = HashMap::new();
    for (idx, row) in rows.iter().enumerate() {
        let StandardRowV1::Snapshots(r) = row else {
            continue;
        };
        let g = group_entry(&r.snapshot_key, &mut order, &mut groups);
        if g.member_lines.is_empty() {
            g.first_line = r.source_row;
        }
        g.member_lines.push(r.source_row);
        g.member_idxs.push(idx);
        g.seen_keys.insert(r.account_key.clone());
        match &g.first_date {
            None => g.first_date = Some(r.date.clone()),
            Some(d) if d != &r.date => {
                g.dates_conflict = true;
            }
            _ => {}
        }
        if let Some(n) = &r.note {
            match &g.note {
                None => g.note = Some(n.clone()),
                Some(prev) if prev != n => {
                    g.note_conflict = true;
                }
                _ => {}
            }
        }
    }
    for (key, line) in rejected_members {
        let g = group_entry(key, &mut order, &mut groups);
        if g.member_lines.is_empty() {
            g.first_line = *line;
        }
        g.member_lines.push(*line);
        g.has_rejected_member = true;
    }

    // One row per account inside a group: later duplicates are dropped.
    let mut keep = vec![true; rows.len()];
    for key in &order {
        let g = groups.get_mut(key).expect("group exists");
        let mut seen: HashMap<String, u32> = HashMap::new();
        for &idx in &g.member_idxs {
            let StandardRowV1::Snapshots(r) = &rows[idx] else {
                continue;
            };
            if seen.insert(r.account_key.clone(), r.source_row).is_some() {
                keep[idx] = false;
                g.invalid = true;
                issues.push(IssueV1 {
                    code: CODE_SNAPSHOT_DUPLICATE_ACCOUNT,
                    severity: SeverityV1::Error,
                    source_row: Some(r.source_row),
                    column: Some(h.column_label("account_key")),
                    group_key: Some(key.clone()),
                    message: format!(
                        "盘点组「{key}」中账户 {} 重复：同一盘点组一个账户只能一行",
                        r.account_key
                    ),
                });
            }
        }
    }

    // Same day cannot carry two groups.
    let mut by_date: HashMap<String, Vec<String>> = HashMap::new();
    for key in &order {
        let g = groups.get(key).expect("group exists");
        if let Some(d) = &g.first_date {
            if !g.dates_conflict {
                by_date.entry(d.clone()).or_default().push(key.clone());
            }
        }
    }
    for keys in by_date.values() {
        if keys.len() < 2 {
            continue;
        }
        for (pos, key) in keys.iter().enumerate() {
            let g = groups.get_mut(key).expect("group exists");
            g.invalid = true;
            let other = keys
                .iter()
                .enumerate()
                .find(|(p, _)| *p != pos)
                .map(|(_, k)| k.as_str())
                .unwrap_or_default();
            issues.push(IssueV1 {
                code: CODE_SNAPSHOT_DATE_CONFLICT,
                severity: SeverityV1::Error,
                source_row: Some(g.first_line),
                column: Some(h.column_label("date")),
                group_key: Some(key.clone()),
                message: format!("同一天已有另一个盘点组「{other}」：同一日期只能对应一个盘点组"),
            });
        }
    }

    let mut context_warnings = WARNING_CAP;
    let mut out = Vec::with_capacity(order.len());
    for key in &order {
        let g = groups.get_mut(key).expect("group exists");
        let date = if g.dates_conflict {
            issues.push(IssueV1 {
                code: CODE_SNAPSHOT_GROUP_DATE_CONFLICT,
                severity: SeverityV1::Error,
                source_row: Some(g.first_line),
                column: Some(h.column_label("date")),
                group_key: Some(key.clone()),
                message: format!("盘点组「{key}」内各行日期不一致，无法确定盘点日"),
            });
            g.invalid = true;
            None
        } else {
            g.first_date.clone()
        };
        if g.note_conflict {
            issues.push(IssueV1 {
                code: CODE_SNAPSHOT_GROUP_NOTE_CONFLICT,
                severity: SeverityV1::Error,
                source_row: Some(g.first_line),
                column: Some(h.column_label("note")),
                group_key: Some(key.clone()),
                message: format!("盘点组「{key}」内非空备注不一致，一次盘点只保存一条备注"),
            });
            g.invalid = true;
        }
        // Catalog checks: account keys must resolve, dates must fall inside
        // each account's validity, and every due account must be present.
        if let Some(catalog) = catalog {
            if let Some(d) = &date {
                for &idx in &g.member_idxs {
                    if !keep[idx] {
                        continue;
                    }
                    let StandardRowV1::Snapshots(r) = &rows[idx] else {
                        continue;
                    };
                    match catalog.by_key.get(r.account_key.as_str()) {
                        None => {
                            keep[idx] = false;
                            g.invalid = true;
                            issues.push(IssueV1 {
                                code: CODE_ACCOUNT_UNMAPPED,
                                severity: SeverityV1::Error,
                                source_row: Some(r.source_row),
                                column: Some(h.column_label("account_key")),
                                group_key: Some(key.clone()),
                                message: format!(
                                    "账户 {} 不在已知账户目录中：请先映射或导入该账户",
                                    r.account_key
                                ),
                            });
                        }
                        Some(&i) => {
                            let e = &catalog.entries[i];
                            if d.as_str() < e.enabled_from.as_str() {
                                keep[idx] = false;
                                g.invalid = true;
                                issues.push(IssueV1 {
                                    code: CODE_ACCOUNT_NOT_ACTIVE,
                                    severity: SeverityV1::Error,
                                    source_row: Some(r.source_row),
                                    column: Some(h.column_label("date")),
                                    group_key: Some(key.clone()),
                                    message: format!(
                                        "账户「{}」在盘点日 {d} 尚未启用（启用日期 {}），不应出现在该组",
                                        e.name, e.enabled_from
                                    ),
                                });
                            } else if e
                                .disabled_from
                                .as_deref()
                                .is_some_and(|disabled| d.as_str() >= disabled)
                            {
                                keep[idx] = false;
                                g.invalid = true;
                                issues.push(IssueV1 {
                                    code: CODE_ACCOUNT_NOT_ACTIVE,
                                    severity: SeverityV1::Error,
                                    source_row: Some(r.source_row),
                                    column: Some(h.column_label("date")),
                                    group_key: Some(key.clone()),
                                    message: format!(
                                        "账户「{}」已于 {} 停用，盘点日 {d} 不要求也不应出现该账户",
                                        e.name,
                                        e.disabled_from.as_deref().unwrap_or_default()
                                    ),
                                });
                            }
                        }
                    }
                }
                let missing: Vec<&CatalogEntry> = catalog
                    .due(d)
                    .into_iter()
                    .filter(|e| {
                        !g.seen_keys
                            .contains(e.external_key.as_deref().unwrap_or_default())
                    })
                    .collect();
                if !missing.is_empty() {
                    g.invalid = true;
                    let mut names: Vec<&str> = missing.iter().map(|e| e.name.as_str()).collect();
                    names.sort_unstable();
                    let shown: Vec<String> =
                        names.iter().take(5).map(|n| format!("「{n}」")).collect();
                    let more = if names.len() > 5 {
                        format!(" 等 {} 个账户", names.len())
                    } else {
                        String::new()
                    };
                    issues.push(IssueV1 {
                        code: CODE_SNAPSHOT_MISSING_ACCOUNT,
                        severity: SeverityV1::Error,
                        source_row: Some(g.first_line),
                        column: None,
                        group_key: Some(key.clone()),
                        message: format!(
                            "盘点组「{key}」（{d}）缺少应盘点的账户：{}{more}；缺行不能补零或复制前值",
                            shown.join("")
                        ),
                    });
                }
            }
        }
        let validation = if g.invalid || g.has_rejected_member {
            GroupValidationV1::Invalid
        } else if catalog.is_none() {
            if context_warnings > 0 {
                context_warnings -= 1;
                issues.push(IssueV1 {
                    code: CODE_GROUP_REQUIRES_CONTEXT,
                    severity: SeverityV1::Warning,
                    source_row: Some(g.first_line),
                    column: None,
                    group_key: Some(key.clone()),
                    message: format!(
                        "盘点组「{key}」缺少账户目录，无法核对应盘点的账户范围；本组未标记为完整"
                    ),
                });
            }
            GroupValidationV1::RequiresAccountContext
        } else {
            GroupValidationV1::Valid
        };
        match validation {
            GroupValidationV1::Valid => counts.groups_valid += 1,
            GroupValidationV1::Invalid => counts.groups_invalid += 1,
            GroupValidationV1::RequiresAccountContext => {
                counts.groups_requires_account_context += 1
            }
        }
        out.push(SnapshotGroupV1 {
            group_key: key.clone(),
            date,
            source_rows: std::mem::take(&mut g.member_lines),
            validation,
        });
    }
    // Excluded rows (duplicate account, unmapped, not active) are row errors.
    let dropped = apply_mask(rows, &mut keep);
    rows.truncate(rows.len() - dropped as usize);
    counts.rows_error += dropped;
    out
}

/// Sweep-sorted interval overlap detection for coverage declarations: each
/// overlapping row reports one partner, so every conflict is locatable without
/// emitting quadratic issues.
fn post_coverage(rows: &mut [StandardRowV1], issues: &mut Vec<IssueV1>, h: &Header) -> u32 {
    let mut idxs: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter(|(_, r)| matches!(r, StandardRowV1::IncomeCoverage(_)))
        .map(|(i, _)| i)
        .collect();
    idxs.sort_by(|&a, &b| {
        let (StandardRowV1::IncomeCoverage(x), StandardRowV1::IncomeCoverage(y)) =
            (&rows[a], &rows[b])
        else {
            unreachable!("filtered above")
        };
        x.from_date
            .cmp(&y.from_date)
            .then_with(|| x.to_date.cmp(&y.to_date))
            .then_with(|| x.source_row.cmp(&y.source_row))
    });
    let mut flagged: BTreeSet<u32> = BTreeSet::new();
    let mut emitted = 2 * WARNING_CAP;
    let mut best = match idxs.first() {
        Some(&i) => i,
        None => return 0,
    };
    for &i in idxs.iter().skip(1) {
        let (StandardRowV1::IncomeCoverage(b), StandardRowV1::IncomeCoverage(c)) =
            (&rows[best], &rows[i])
        else {
            unreachable!("filtered above")
        };
        if c.from_date < b.to_date {
            for (row, other, from, to) in [
                (c.source_row, b.source_row, &c.from_date, &c.to_date),
                (b.source_row, c.source_row, &b.from_date, &b.to_date),
            ] {
                if flagged.insert(row) && emitted > 0 {
                    emitted -= 1;
                    issues.push(IssueV1 {
                        code: CODE_COVERAGE_OVERLAP,
                        severity: SeverityV1::Error,
                        source_row: Some(row),
                        column: Some(h.column_label("from_date")),
                        group_key: None,
                        message: format!(
                            "区间 ({from}, {to}] 与第 {other} 行的完整性区间重叠：同一段收入不能出现在两个声明里"
                        ),
                    });
                }
            }
        }
        if c.to_date > b.to_date {
            best = i;
        }
    }
    flagged.len() as u32
}

/// Compact kept rows to the front preserving order and return how many rows
/// at the tail the caller must truncate away.
fn apply_mask(rows: &mut [StandardRowV1], keep: &mut [bool]) -> u32 {
    let (mut w, mut dropped) = (0usize, 0u32);
    for (r, k) in keep.iter_mut().enumerate() {
        if *k {
            if w != r {
                rows.swap(w, r);
            }
            w += 1;
        } else {
            dropped += 1;
        }
    }
    dropped
}
