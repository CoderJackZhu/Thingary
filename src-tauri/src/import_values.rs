//! Friendly values accepted by human-edited exports. Exports use deliberate
//! canonical text, but imports tolerate common spreadsheet date and money
//! spellings without guessing ambiguous numbers.
use chrono::{Datelike, NaiveDate};

/// Normalize a human-entered calendar date to `YYYY-MM-DD`.
///
/// Accepted separators are `-`, `/` and `.`, plus Chinese `年` / `月` / `日`.
/// Month and day may omit leading zeroes. A validated clock time after `T` or
/// a space is ignored without shifting the calendar day. Years have four digits.
pub fn day(value: &str) -> Option<String> {
    let mut value = value.trim();
    if let Some((date, time)) = value.split_once(['T', 't', ' ']) {
        if !clock_time(time.trim()) {
            return None;
        }
        value = date;
    }
    let (year, month, date) = if let Some((year, rest)) = value.split_once('年') {
        let (month, date) = rest.split_once('月')?;
        (year, month, date.strip_suffix('日').unwrap_or(date))
    } else {
        let separator = value.chars().find(|c| matches!(c, '-' | '/' | '.'))?;
        let mut parts = value.split(separator);
        let result = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        result
    };
    if year.len() != 4
        || month.is_empty()
        || date.is_empty()
        || month.len() > 2
        || date.len() > 2
        || !year.bytes().all(|b| b.is_ascii_digit())
        || !month.bytes().all(|b| b.is_ascii_digit())
        || !date.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let parsed =
        NaiveDate::from_ymd_opt(year.parse().ok()?, month.parse().ok()?, date.parse().ok()?)?;
    (1900..=9999)
        .contains(&parsed.year())
        .then(|| parsed.format("%Y-%m-%d").to_string())
}

fn clock_time(value: &str) -> bool {
    let clock = if let Some(clock) = value.strip_suffix(['Z', 'z']) {
        clock
    } else if let Some((clock, zone)) = value.split_once(['+', '-']) {
        let Some((hour, minute)) = zone.split_once(':') else {
            return false;
        };
        if !two_digits(hour, 23) || !two_digits(minute, 59) {
            return false;
        }
        clock
    } else {
        value
    };
    let parts: Vec<_> = clock.split(':').collect();
    let (hour, minute, second) = match parts.as_slice() {
        [hour, minute] => (*hour, *minute, None),
        [hour, minute, second] => (*hour, *minute, Some(*second)),
        _ => return false,
    };
    if !two_digits(hour, 23) || !two_digits(minute, 59) {
        return false;
    }
    second.is_none_or(|second| {
        let second = if let Some((second, fraction)) = second.split_once('.') {
            if fraction.is_empty()
                || fraction.len() > 9
                || !fraction.bytes().all(|b| b.is_ascii_digit())
            {
                return false;
            }
            second
        } else {
            second
        };
        two_digits(second, 59)
    })
}

fn two_digits(value: &str, maximum: u8) -> bool {
    value.len() == 2
        && value.bytes().all(|b| b.is_ascii_digit())
        && value.parse::<u8>().is_ok_and(|v| v <= maximum)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum YuanError {
    Invalid,
    Range,
}

/// Parse yuan text into integer cents. Empty means unknown. Accepts an
/// optional `¥`/`￥`, ASCII or Unicode minus, and correctly grouped
/// thousands separators. Values are never rounded.
pub fn yuan(value: &str) -> Result<Option<i64>, String> {
    parse_yuan(value).map_err(|error| match error {
        YuanError::Invalid => format!("金额「{}」须为数字，最多两位小数", value.trim()),
        YuanError::Range => "金额超出范围".into(),
    })
}

/// Keep overflow distinct from malformed text for the financial parser's codes.
pub(crate) fn parse_yuan(value: &str) -> Result<Option<i64>, YuanError> {
    let mut value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let currency_first = value.starts_with(['¥', '￥']);
    if currency_first {
        value = value.strip_prefix(['¥', '￥']).unwrap().trim();
    }
    let negative = value.starts_with(['-', '−']);
    if negative {
        value = value.strip_prefix(['-', '−']).unwrap().trim();
    }
    if !currency_first {
        value = value.strip_prefix(['¥', '￥']).unwrap_or(value).trim();
    }
    let (whole, fraction) = match value.split_once('.') {
        Some((whole, fraction))
            if !fraction.is_empty()
                && fraction.len() <= 2
                && fraction.bytes().all(|b| b.is_ascii_digit()) =>
        {
            (whole, fraction)
        }
        Some(_) => return Err(YuanError::Invalid),
        None => (value, ""),
    };
    if whole.is_empty() {
        return Err(YuanError::Invalid);
    }
    let mut groups = whole.split(',');
    let first = groups.next().unwrap();
    if first.is_empty()
        || (whole.contains(',') && first.len() > 3)
        || !first.bytes().all(|b| b.is_ascii_digit())
        || groups.any(|group| group.len() != 3 || !group.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(YuanError::Invalid);
    }
    let whole: i128 = whole
        .replace(',', "")
        .parse()
        .map_err(|_| YuanError::Range)?;
    let fraction: i128 = if fraction.is_empty() {
        0
    } else {
        format!("{fraction:0<2}")
            .parse()
            .map_err(|_| YuanError::Invalid)?
    };
    let cents = whole
        .checked_mul(100)
        .and_then(|v| v.checked_add(fraction))
        .ok_or(YuanError::Range)?;
    let cents = if negative { -cents } else { cents };
    i64::try_from(cents).map(Some).map_err(|_| YuanError::Range)
}

#[cfg(test)]
mod tests {
    use super::{day, yuan};

    #[test]
    fn dates_are_friendly_but_unambiguous() {
        for value in ["2026-10-28", "2026/10/28", "2026.10.28", "2026年10月28日"] {
            assert_eq!(day(value).as_deref(), Some("2026-10-28"), "{value}");
        }
        for value in ["2026-1-2", "2026/1/2 08:30", "2026-01-02T08:30:00+08:00"] {
            assert_eq!(day(value).as_deref(), Some("2026-01-02"), "{value}");
        }
        assert_eq!(day(" 2026年1月2日 ").as_deref(), Some("2026-01-02"));
        assert_eq!(day("2025-02-29"), None);
        assert_eq!(day("26-01-02"), None);
        assert_eq!(day("2026-01"), None);
        assert_eq!(day("1,000"), None);
    }

    #[test]
    fn money_is_exact_and_rejects_ambiguous_grouping() {
        for (value, expected) in [
            ("1000", 100_000),
            ("123456789.01", 12_345_678_901),
            ("1,000", 100_000),
            ("¥1,234.56", 123_456),
            ("￥0.5", 50),
            (" 12 ", 1_200),
            ("−12.34", -1_234),
        ] {
            assert_eq!(yuan(value), Ok(Some(expected)), "{value}");
        }
        assert_eq!(yuan(""), Ok(None));
        assert_eq!(yuan(" \t "), Ok(None));
        assert_eq!(yuan("0"), Ok(Some(0)));
        for value in [
            "1,2", "12,34", "1,2345", "1.234", "1e3", "一千", "¥¥1", "+1", "1.",
        ] {
            assert!(yuan(value).is_err(), "{value}");
        }
    }

    #[test]
    fn date_suffixes_must_be_valid_clock_times() {
        for value in [
            "2026-1-2T00:00:00",
            "2026/1/2 23:59:59.123456789",
            "2026.1.2T08:30:00Z",
            "2026年1月2日 08:30:00+08:00",
        ] {
            assert_eq!(day(value).as_deref(), Some("2026-01-02"), "{value}");
        }
        for value in [
            "2026-1-2Trash",
            "2026-1-2 time:anything",
            "2026-1-2T08:30bad",
            "2026-1-2T24:00",
            "2026-1-2T08:60",
            "2026-1-2T08:30:60",
            "2026-1-2T08:30:00.1234567890",
            "2026-1-2T08:30:00+08:60",
            "2026-1/2",
            "2026年1月2日日",
        ] {
            assert_eq!(day(value), None, "{value}");
        }
        assert_eq!(day("1900-1-1").as_deref(), Some("1900-01-01"));
        assert_eq!(day("9999-12-31").as_deref(), Some("9999-12-31"));
        assert_eq!(day("1899-12-31"), None);
    }

    #[test]
    fn amounts_preserve_exact_integer_limits_and_classify_overflow() {
        use super::{parse_yuan, YuanError};
        assert_eq!(yuan("92233720368547758.07"), Ok(Some(i64::MAX)));
        assert_eq!(yuan("-92233720368547758.08"), Ok(Some(i64::MIN)));
        for value in [
            "92233720368547758.08",
            "-92233720368547758.09",
            "999999999999999999999999999999999999999999999999",
        ] {
            assert_eq!(parse_yuan(value), Err(YuanError::Range), "{value}");
        }
        assert_eq!(
            parse_yuan("999999999999999999999.001"),
            Err(YuanError::Invalid)
        );
    }
}
