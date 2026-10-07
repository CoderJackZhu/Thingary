//! Field-level validation shared by all five templates: strict decimal
//! amounts, strict calendar dates, template booleans and the account kind
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
    /// Wrong shape: exponent, separator, symbol, more than two decimals…
    Invalid(&'static str),
    /// A minus sign where only non-negative amounts are allowed.
    Negative,
    /// Beyond ±MAX_CENTS.
    Range,
}

const AMOUNT_SHAPE: &str =
    "须为最多两位小数的十进制金额（元），如 1234.56；不能含指数、千分位、货币符号或空格";

/// Parse a yuan amount into integer cents. `-0` normalizes to `0` where
/// negatives are allowed. There is no rounding: more than two decimals, an
/// exponent or any other character is an error.
pub(super) fn parse_amount_cents(value: &str, allow_negative: bool) -> Result<String, AmountError> {
    const INVALID: AmountError = AmountError::Invalid(AMOUNT_SHAPE);
    let (negative, rest) = match value.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, value),
    };
    if negative && !allow_negative {
        return Err(AmountError::Negative);
    }
    let (whole, frac) = match rest.split_once('.') {
        Some((w, f)) => (w, Some(f)),
        None => (rest, None),
    };
    if whole.is_empty() || whole.len() > 18 || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return Err(INVALID);
    }
    let frac_cents = match frac {
        None => 0i64,
        Some(f) if (1..=2).contains(&f.len()) && f.bytes().all(|b| b.is_ascii_digit()) => {
            // "5" means 0.50 yuan; exact decimal placement, no rounding.
            format!("{f:0<2}").parse::<i64>().unwrap_or(0)
        }
        Some(_) => return Err(INVALID),
    };
    let whole: i128 = whole.parse().map_err(|_| AmountError::Range)?;
    let mut cents = whole * 100 + i128::from(frac_cents);
    if negative && cents != 0 {
        cents = -cents;
    }
    if cents.abs() > i128::from(MAX_CENTS) {
        return Err(AmountError::Range);
    }
    Ok((cents as i64).to_string())
}

/// Strict `YYYY-MM-DD`: canonical shape only (no `2026-9-1`, no separators),
/// years 1900–9999, real calendar days including leap-day rules. Returns the
/// input unchanged when valid.
pub(super) fn validate_date_strict(value: &str) -> Result<String, &'static str> {
    let b = value.as_bytes();
    let shape = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit());
    if !shape {
        return Err("须为 YYYY-MM-DD 格式的日期，如 2026-09-30");
    }
    let y: u32 = value[..4].parse().unwrap_or(0);
    let m: u32 = value[5..7].parse().unwrap_or(0);
    let d: u32 = value[8..10].parse().unwrap_or(0);
    if !(1900..=9999).contains(&y) {
        return Err("年份须在 1900–9999 之间");
    }
    if m == 0 || m > 12 {
        return Err("月份须为 01–12");
    }
    if d == 0 || d > days_in_month(y, m) {
        return Err("不是日历上存在的日期");
    }
    Ok(value.to_string())
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(y) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap(y: u32) -> bool {
    y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400))
}

/// Template booleans are explicit; empty never guesses.
pub(super) fn parse_bool(value: &str) -> Result<bool, &'static str> {
    match value.to_ascii_lowercase().as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err("须写 true 或 false"),
    }
}

/// The canonical kind key when `value` is a currently supported account kind.
pub(super) fn account_kind(value: &str) -> Option<&'static str> {
    ACCOUNT_KINDS.iter().map(|k| k.key).find(|k| *k == value)
}
