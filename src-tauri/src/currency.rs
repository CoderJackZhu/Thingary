//! Offline currency input. Values are integers; no quote service or historical revaluation.
pub const CURRENCIES: [(&str, &str, u32); 12] = [
    ("CNY", "人民币", 2),
    ("HKD", "港币", 2),
    ("USD", "美元", 2),
    ("EUR", "欧元", 2),
    ("JPY", "日元", 0),
    ("GBP", "英镑", 2),
    ("SGD", "新加坡元", 2),
    ("AUD", "澳元", 2),
    ("CAD", "加元", 2),
    ("CHF", "瑞士法郎", 2),
    ("TWD", "新台币", 2),
    ("MOP", "澳门元", 2),
];
pub fn cny() -> String {
    "CNY".into()
}
pub fn is_cny(code: &str) -> bool {
    code == "CNY"
}
pub fn valid(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())
}
pub fn decimals(code: &str) -> u32 {
    CURRENCIES.iter().find(|c| c.0 == code).map_or(2, |c| c.2)
}
/// Decimal text to integer units, without floating-point arithmetic.
pub fn parse_decimal(text: &str, places: u32) -> Result<i64, &'static str> {
    let text = text.trim();
    let mut pieces = text.split('.');
    let whole = pieces.next().unwrap_or("");
    let fraction = pieces.next();
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || pieces.next().is_some()
        || fraction.is_some_and(|v| {
            v.is_empty() || v.len() > places as usize || !v.bytes().all(|b| b.is_ascii_digit())
        })
    {
        return Err("金额或汇率的小数位不正确");
    }
    let w = whole.parse::<i128>().map_err(|_| "数值超出范围")?;
    let f = fraction.unwrap_or("");
    let v = w
        .checked_mul(10i128.pow(places))
        .and_then(|v| {
            v.checked_add(f.parse::<i128>().unwrap_or(0) * 10i128.pow(places - f.len() as u32))
        })
        .ok_or("数值超出范围")?;
    i64::try_from(v).map_err(|_| "数值超出范围")
}
pub fn integer(text: &str) -> Result<i64, &'static str> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err("须为非负整数");
    }
    text.parse().map_err(|_| "数值超出范围")
}
pub fn convert(code: &str, original: i64, rate: i64) -> Result<i64, &'static str> {
    if !valid(code) || rate <= 0 {
        return Err("币种须为三位大写字母，汇率须大于0");
    }
    let n = i128::from(original)
        .checked_mul(10i128.pow(2 - decimals(code)))
        .and_then(|v| v.checked_mul(i128::from(rate)))
        .ok_or("换算超出范围")?;
    let magnitude = n.checked_abs().ok_or("换算超出范围")?;
    // Divide before rounding: adding half a unit to a near-i128::MAX product can overflow.
    let rounded = magnitude / 1_000_000 + i128::from(magnitude % 1_000_000 >= 500_000);
    let result = rounded * n.signum();
    if result.abs() > 99_999_999_999 {
        return Err("换算金额超出可记录范围");
    }
    Ok(result as i64)
}
pub fn decimal(value: i64, places: u32) -> String {
    if places == 0 {
        return value.to_string();
    }
    let n = i128::from(value).abs();
    let scale = 10i128.pow(places);
    format!(
        "{}{}.{:0width$}",
        if value < 0 { "-" } else { "" },
        n / scale,
        n % scale,
        width = places as usize
    )
}
