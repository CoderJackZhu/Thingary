use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Debug, Clone, Serialize)]
pub struct Error {
    pub code: String,
    pub message: String,
}
impl Error {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::new("IO", "无法读写本地资料，请检查磁盘空间和权限")
    }
}
impl From<rusqlite::Error> for Error {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("DATABASE", "本地数据操作失败，原资料已保留")
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::new("FORMAT", "资料格式不兼容或损坏")
    }
}
pub const MAX_CENTS: i64 = 99_999_999_999;
pub fn cents(value: Option<&str>) -> Result<Option<i64>> {
    value
        .map(|v| {
            if v.is_empty() || v.len() > 11 || !v.bytes().all(|c| c.is_ascii_digit()) {
                return Err(Error::new("PRICE", "金额须为整数分或留空"));
            }
            let n = v
                .parse::<i64>()
                .map_err(|_| Error::new("PRICE", "金额超出范围"))?;
            if n > MAX_CENTS {
                return Err(Error::new("PRICE", "金额超出范围"));
            }
            Ok(n)
        })
        .transpose()
}
pub fn date(value: &str) -> Result<NaiveDate> {
    let d = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| Error::new("DATE", "日期格式应为 YYYY-MM-DD"))?;
    if d.year() < 1900 || d.year() > 9999 || d.format("%Y-%m-%d").to_string() != value {
        return Err(Error::new("DATE", "日期超出范围或格式错误"));
    }
    Ok(d)
}
pub fn held_days(start: Option<&str>, end: &str) -> Result<Option<i64>> {
    start
        .map(|s| {
            let days = (date(end)? - date(s)?).num_days() + 1;
            if days < 1 {
                return Err(Error::new("DATE_ORDER", "结束日期不能早于购买日期"));
            }
            Ok(days)
        })
        .transpose()
}
// Round the exact integer ratio, half away from zero; no floating point amounts.
pub fn daily_cents(
    purchase: Option<i64>,
    maintenance: i64,
    proceeds: i64,
    days: Option<i64>,
) -> Result<Option<i64>> {
    let (Some(p), Some(d)) = (purchase, days) else {
        return Ok(None);
    };
    if d < 1 {
        return Err(Error::new("DATE_ORDER", "持有天数须为正数"));
    }
    let net = p
        .checked_add(maintenance)
        .and_then(|n| n.checked_sub(proceeds))
        .ok_or_else(|| Error::new("OVERFLOW", "金额超出范围"))?;
    let n = i128::from(net);
    let d = i128::from(d);
    Ok(Some(((n.abs() + d / 2) / d * n.signum()) as i64))
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub price_cents: Option<String>,
    pub purchase_date: Option<String>,
    pub revision: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub asset_id: Option<String>,
    pub expected_revision: Option<i64>,
    pub name: String,
    pub price_cents: Option<String>,
    pub purchase_date: Option<String>,
}
impl Save {
    pub fn validate(&self, today: &str) -> Result<()> {
        if self.name.trim().is_empty() || self.name.trim().chars().count() > 200 {
            return Err(Error::new("NAME", "名称须为 1–200 字"));
        }
        uuid::Uuid::parse_str(&self.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        if let Some(id) = &self.asset_id {
            uuid::Uuid::parse_str(id).map_err(|_| Error::new("ID", "档案标识无效"))?;
        }
        if self.asset_id.is_some() != self.expected_revision.is_some()
            || self.expected_revision.is_some_and(|r| r < 1)
        {
            return Err(Error::new("REVISION", "版本标识无效"));
        }
        cents(self.price_cents.as_deref())?;
        if let Some(d) = &self.purchase_date {
            if date(d)? > date(today)? {
                return Err(Error::new("FUTURE", "购买日期不能晚于今天"));
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_free_and_invalid_money() {
        assert_eq!(cents(None).unwrap(), None);
        assert_eq!(cents(Some("0")).unwrap(), Some(0));
        for x in ["-1", "1.1", "1e3", "100000000000", ""] {
            assert!(cents(Some(x)).is_err());
        }
    }
    #[test]
    fn inclusive_leap_and_order() {
        assert_eq!(
            held_days(Some("2024-02-28"), "2024-03-01").unwrap(),
            Some(3)
        );
        assert_eq!(
            held_days(Some("2026-09-24"), "2026-09-24").unwrap(),
            Some(1)
        );
        assert!(held_days(Some("2026-09-25"), "2026-09-24").is_err());
        assert!(date("2026-2-03").is_err());
        assert!(date("2025-02-29").is_err());
    }
    #[test]
    fn cost_examples_and_negative_rounding() {
        assert_eq!(
            daily_cents(Some(100000), 20000, 30000, Some(10)).unwrap(),
            Some(9000)
        );
        assert_eq!(
            daily_cents(Some(100000), 20000, 140000, Some(10)).unwrap(),
            Some(-2000)
        );
        assert_eq!(daily_cents(None, 0, 0, Some(1)).unwrap(), None);
        assert_eq!(daily_cents(Some(1), 0, 0, Some(2)).unwrap(), Some(1));
        assert_eq!(daily_cents(Some(0), 0, 1, Some(2)).unwrap(), Some(-1));
        assert!(daily_cents(Some(i64::MAX), 1, 0, Some(1)).is_err());
    }
}
