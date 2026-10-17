//! One manually valued position per account. This is an input method, not a trade ledger.
pub fn is_false(value: &bool) -> bool {
    !*value
}
pub fn supported(kind: &str) -> bool {
    matches!(
        kind,
        "investment" | "mixed" | "fund" | "bond" | "precious_metal"
    )
}
/// Round nonnegative quantity(1e8) * price(1e6) to account-currency minor units.
pub fn minor(quantity: i64, price: i64, decimals: u32) -> Result<i64, &'static str> {
    if quantity < 0 || price < 0 || !matches!(decimals, 0 | 2) {
        return Err("份额与单价须为非负数");
    }
    // Cancel the currency scale first; multiplying by 100 first can overflow needlessly.
    let denominator = 10i128.pow(14 - decimals);
    let product = i128::from(quantity)
        .checked_mul(i128::from(price))
        .ok_or("持仓金额超出范围")?;
    let rounded = (product / denominator)
        .checked_add(i128::from(product % denominator >= denominator / 2))
        .ok_or("持仓金额超出范围")?;
    i64::try_from(rounded).map_err(|_| "持仓金额超出范围")
}

/// Accept validated comma/space thousands groups without merging arbitrary whitespace.
pub fn parse(text: &str, places: u32) -> Result<i64, &'static str> {
    let clean = text.trim();
    let grouping_space = |c: char| matches!(c, ' ' | '\u{a0}' | '\u{202f}');
    let whole = clean.split('.').next().unwrap_or("");
    if clean
        .split('.')
        .skip(1)
        .any(|v| v.contains(',') || v.chars().any(char::is_whitespace))
    {
        return Err("千分位分隔符只能用于整数部分");
    }
    if whole.contains(',') || whole.chars().any(grouping_space) {
        let comma = whole.contains(',');
        let parts: Vec<_> = whole
            .split(|c| if comma { c == ',' } else { grouping_space(c) })
            .collect();
        if parts[0].is_empty()
            || parts[0].len() > 3
            || parts.iter().any(|p| !p.bytes().all(|b| b.is_ascii_digit()))
            || parts[1..].iter().any(|p| p.len() != 3)
        {
            return Err("千分位须按三位分组，不能混用逗号和空格");
        }
    }
    let normalized: String = clean
        .chars()
        .filter(|&c| c != ',' && !grouping_space(c))
        .collect();
    super::currency::parse_decimal(&normalized, places)
}
