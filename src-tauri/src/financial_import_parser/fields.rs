//! Field-level validation shared by all five templates: exact decimal
//! amounts, tolerant human dates, template booleans and the account kind
//! vocabulary. No floating point ever touches an amount.
use super::ACCOUNT_KINDS;

/// Same cap as the live domain layer (`domain::MAX_CENTS`): 99999999999 分.
pub(super) const MAX_CENTS: i64 = 99_999_999_999;
pub(super) const MAX_KEY_CHARS: usize = 100;
pub(super) const MAX_NAME_CHARS: usize = 80;
pub(super) const MAX_PLATFORM_CHARS: usize = 80;
/// Account notes and check-in notes share the live 10000-character cap.
pub(super) const MAX_ACCOUNT_NOTE_CHARS: usize = 10_000;
pub(super) const MAX_SNAPSHOT_NOTE_CHARS: usize = 10_000;
/// Income and coverage notes share the live 500-character cap.
pub(super) const MAX_INCOME_NOTE_CHARS: usize = 500;

pub(super) enum AmountError {
    /// Wrong shape: exponent, malformed separator/symbol, more than two decimals…
    Invalid(&'static str),
    /// A minus sign where only non-negative amounts are allowed.
    Negative,
    /// Beyond ±MAX_CENTS.
    Range,
}

const AMOUNT_SHAPE: &str =
    "须为最多两位小数的金额（元），如 1234.56；可用千分位和人民币符号，不能含指数";

/// Parse a yuan amount into integer cents. `-0` normalizes to `0` where
/// negatives are allowed. There is no rounding: more than two decimals, an
/// exponent or any other character is an error.
pub(super) fn parse_amount_cents(value: &str, allow_negative: bool) -> Result<String, AmountError> {
    const INVALID: AmountError = AmountError::Invalid(AMOUNT_SHAPE);
    let value = value.trim();
    let signed = value.strip_prefix(['¥', '￥']).unwrap_or(value).trim();
    let negative = signed.starts_with(['-', '−']);
    if negative && !allow_negative {
        return Err(AmountError::Negative);
    }
    let cents = crate::import_values::parse_yuan(value)
        .map_err(|error| match error {
            crate::import_values::YuanError::Invalid => INVALID,
            crate::import_values::YuanError::Range => AmountError::Range,
        })?
        .ok_or(INVALID)?;
    if cents.unsigned_abs() > MAX_CENTS as u64 {
        return Err(AmountError::Range);
    }
    Ok(cents.to_string())
}

/// Normalize common human date spellings to `YYYY-MM-DD`. Years are limited to
/// 1900–9999 and real calendar days, including leap-day rules, are required.
pub(super) fn validate_date_strict(value: &str) -> Result<String, &'static str> {
    crate::import_values::day(value).ok_or("须为日期，如 2026-09-30、2026/9/30 或 2026年9月30日")
}

/// Template booleans are explicit; empty never guesses.
pub(super) fn parse_bool(value: &str) -> Result<bool, &'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "是" | "1" | "true" => Ok(true),
        "否" | "0" | "false" => Ok(false),
        _ => Err("须写 是、否、1、0、true 或 false"),
    }
}

/// Resolve a supported account kind key or its Chinese display label.
pub(super) fn account_kind(value: &str) -> Option<&'static str> {
    let value = value.trim();
    ACCOUNT_KINDS
        .iter()
        .find(|kind| kind.key == value || kind.label == value)
        .map(|kind| kind.key)
}
