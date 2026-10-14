use serde::Deserialize;
use serde_json::Value;
pub const LIMIT: f64 = 9e15;
pub const EPS: f64 = 1e-6;
pub type Res<T> = Result<T, String>;
pub fn err<T>(s: &str) -> Res<T> {
    Err(s.to_owned())
}
pub fn bounded(x: f64) -> Res<f64> {
    if x.is_finite() && x.abs() <= LIMIT {
        Ok(x)
    } else {
        err("nonfinite or out-of-bound amount/intermediate")
    }
}
pub fn factor(gross: f64, years: f64) -> Res<f64> {
    let x = gross.powf(years);
    if x.is_finite() && x > 0. {
        Ok(x)
    } else {
        err("nonfinite or underflowed denomination factor")
    }
}
pub fn amount(x: f64, positive: bool) -> Res<()> {
    bounded(x)?;
    if positive && x < 0. {
        return err("amount must be nonnegative");
    }
    Ok(())
}
pub fn pos(x: i64) -> Res<()> {
    if !(0..=120000).contains(&x) {
        err("month position outside 0..120000")
    } else {
        Ok(())
    }
}
pub fn rate(x: f64) -> Res<()> {
    if !x.is_finite() || x <= -10000. {
        err("compounded rate must exceed -10000 hundredths")
    } else {
        Ok(())
    }
}
pub fn date(s: &str) -> Res<i64> {
    let b = s.as_bytes();
    if !(b.len() == 7 || b.len() == 10)
        || b[4] != b'-'
        || (b.len() == 10 && b[7] != b'-')
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || (i == 7 && b.len() == 10) || c.is_ascii_digit())
    {
        return err("date must be YYYY-MM[-DD]");
    }
    let y = s[..4].parse::<i64>().map_err(|_| "invalid year")?;
    let m = s[5..7].parse::<i64>().map_err(|_| "invalid month")?;
    if y == 0 || !(1..=12).contains(&m) {
        return err("invalid calendar date");
    }
    if b.len() == 10 {
        let d = s[8..].parse::<i64>().map_err(|_| "invalid day")?;
        let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
        let max = match m {
            2 => {
                if leap {
                    29
                } else {
                    28
                }
            }
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
        if d < 1 || d > max {
            return err("invalid calendar day");
        }
    }
    Ok(y * 12 + m - 1)
}
pub fn month_string(m: i64) -> String {
    format!("{:04}-{:02}", m.div_euclid(12), m.rem_euclid(12) + 1)
}
pub fn age_month(a: f64) -> Res<i64> {
    item_month(a, false)
}
fn item_month(a: f64, signed: bool) -> Res<i64> {
    let m = a * 12.;
    let minimum = if signed { -120000. } else { 0. };
    if !m.is_finite() || (m - m.round()).abs() > 1e-8 || !(minimum..=120000.).contains(&m) {
        err("age must resolve to integral month")
    } else {
        Ok(m.round() as i64)
    }
}
fn one() -> f64 {
    1.
}
fn legacy() -> String {
    "legacy".into()
}
#[derive(Clone, Deserialize)]
pub struct Item {
    pub id: String,
    pub label: String,
    pub monthly_cents: f64,
    pub start_age: Option<f64>,
    pub end_age: Option<f64>,
    pub inflation_hundredths: Option<f64>,
    pub essential: bool,
}
#[derive(Clone, Deserialize)]
#[allow(dead_code)]
pub struct Income {
    pub id: String,
    pub label: String,
    pub monthly_cents: f64,
    pub start_age: f64,
    pub end_age: Option<f64>,
    pub indexed: bool,
}
#[derive(Clone, Deserialize)]
pub struct Phase {
    pub from_month: i64,
    pub cents: f64,
}
#[derive(Clone, Deserialize)]
#[allow(dead_code)]
pub struct Flow {
    pub source_id: Option<String>,
    pub label: String,
    pub from_month: i64,
    pub to_month: Option<i64>,
    pub cents: f64,
    pub nominal: bool,
    pub essential: bool,
    #[serde(default)]
    pub prorate_first: bool,
    #[serde(default)]
    pub timing: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct Spend {
    pub offset_months: i64,
    pub cents: f64,
}
#[derive(Clone, Deserialize)]
#[allow(dead_code)]
pub struct Transfer {
    pub id: String,
    pub account_id: String,
    pub month: i64,
    pub cents: f64,
    pub nominal_cents: Option<f64>,
}
#[derive(Clone, Deserialize)]
#[allow(dead_code)]
pub struct Future {
    pub id: String,
    pub name: String,
    pub role: String,
    pub included: bool,
    pub monthly_cents: Option<String>,
    pub start_month: Option<String>,
    pub end_month: Option<String>,
    pub basis: Option<String>,
    pub basis_month: Option<String>,
    pub growth: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct AgeRef {
    pub month: String,
    pub age_months: i64,
}
#[derive(Clone, Deserialize)]
pub struct Loan {
    pub id: String,
    pub from_offset: i64,
    pub principal_cents: f64,
    pub rate_hundredths: f64,
    pub months: usize,
    pub payment_cents: f64,
    #[serde(default)]
    pub existing: bool,
}
#[derive(Clone, Deserialize, serde::Serialize, PartialEq)]
pub struct Pension {
    pub monthly_cents: f64,
    pub lump_cents: f64,
    pub unlock_age_months: i64,
    #[serde(default)]
    pub eligible: Option<bool>,
    #[serde(default)]
    pub short_months: Option<f64>,
    #[serde(default)]
    pub income_start_age_months: Value,
}
impl Pension {
    pub fn start(&self) -> Option<i64> {
        if self.income_start_age_months.is_null() {
            None
        } else {
            self.income_start_age_months.as_i64()
        }
    }
    pub fn enabled(&self) -> bool {
        self.eligible.unwrap_or(true)
    }
}
// Omission and explicit null have different meanings for pension start.
pub fn parse_pension(v: &Value) -> Res<Pension> {
    let mut q = v.clone();
    if let Some(o) = q.as_object_mut() {
        if !o.contains_key("income_start_age_months") {
            o.insert(
                "income_start_age_months".into(),
                o.get("unlock_age_months").cloned().unwrap_or(Value::Null),
            );
        }
    }
    let p: Pension = serde_json::from_value(q).map_err(|e| e.to_string())?;
    amount(p.monthly_cents, true)?;
    amount(p.lump_cents, true)?;
    pos(p.unlock_age_months)?;
    if !p.income_start_age_months.is_null() {
        pos(p.start().ok_or("invalid pension income start")?)?;
    }
    if let Some(x) = p.short_months {
        amount(x, true)?;
    }
    Ok(p)
}
#[derive(Clone, Deserialize)]
pub struct Plan {
    pub now_months: i64,
    pub horizon_months: i64,
    pub target_months: i64,
    pub search_cap_months: i64,
    pub mode: String,
    #[serde(default = "legacy")]
    pub input_mode: String,
    pub assets_cents: f64,
    pub saving_cents: f64,
    pub saving_growth_hundredths: f64,
    pub r_before_hundredths: f64,
    pub r_after_hundredths: f64,
    pub inflation_hundredths: f64,
    pub volatility_hundredths: f64,
    #[serde(default)]
    pub saving_phases: Vec<Phase>,
    pub items: Vec<Item>,
    pub incomes: Vec<Income>,
    #[serde(default)]
    pub saving_flows: Vec<Flow>,
    #[serde(default)]
    pub spend_flows: Vec<Flow>,
    pub spends: Vec<Spend>,
    #[serde(default)]
    pub transfers: Vec<Transfer>,
    pub anchor_date: Option<String>,
    pub monetary_basis_date: Option<String>,
    pub calculation_date: Option<String>,
    #[serde(default = "one")]
    pub basis_factor: f64,
    #[serde(default = "one")]
    pub first_month_fraction: f64,
    #[serde(default)]
    pub future_incomes: Vec<Future>,
    #[serde(default)]
    pub age_reference: Value,
    #[serde(default)]
    pub loans: Vec<Loan>,
    pub pensions: Vec<Value>,
    #[serde(skip)]
    pub pension_data: Vec<Pension>,
    #[serde(skip)]
    pub age_absent: bool,
}
pub fn unique<'a>(ids: impl Iterator<Item = &'a String>) -> Res<()> {
    let mut set = std::collections::HashSet::new();
    for s in ids {
        if !set.insert(s) {
            return err("duplicate id");
        }
    }
    Ok(())
}
impl Plan {
    pub fn parse(v: &Value) -> Res<Self> {
        let mut normalized = v.clone();
        if let Some(o) = normalized.as_object_mut() {
            for key in [
                "items",
                "incomes",
                "saving_phases",
                "saving_flows",
                "spend_flows",
                "spends",
                "transfers",
                "future_incomes",
                "loans",
                "pensions",
            ] {
                if o.get(key)
                    .and_then(Value::as_array)
                    .is_some_and(|a| a.len() > 10000)
                {
                    return err("array too large");
                }
            }
            if let Some(a) = o.get_mut("future_incomes").and_then(Value::as_array_mut) {
                a.retain(|x| x.get("included") != Some(&Value::Bool(false)));
            }
        }
        let mut p: Self =
            serde_json::from_value(normalized).map_err(|e| format!("invalid plan: {e}"))?;
        p.age_absent = v.get("age_reference").is_none();
        p.validate()?;
        Ok(p)
    }
    pub fn n(&self) -> usize {
        (self.horizon_months - self.now_months) as usize
    }
    pub fn basic(&self) -> bool {
        self.input_mode == "basic"
    }
    pub fn elapsed(&self, i: usize) -> f64 {
        if i == 0 {
            0.
        } else {
            i as f64 - 1. + self.first_month_fraction
        }
    }
    pub fn duration(&self, i: usize) -> f64 {
        if i == 0 {
            self.first_month_fraction / 12.
        } else {
            1. / 12.
        }
    }
    pub fn saving_weight(&self, i: usize) -> f64 {
        (1. + self.saving_growth_hundredths / 10000.).powf((self.elapsed(i) / 12.).floor())
            * if i == 0 {
                self.first_month_fraction
            } else {
                1.
            }
    }
    pub fn anchor(&self) -> Option<i64> {
        self.anchor_date.as_ref().and_then(|s| date(s).ok())
    }
    pub fn basis(&self) -> Option<i64> {
        self.monetary_basis_date.as_ref().and_then(|s| date(s).ok())
    }
    pub fn calendar(&self, m: i64) -> String {
        self.anchor()
            .map(|a| month_string(a + m - self.now_months))
            .unwrap_or_else(|| format!("{} years", m.div_euclid(12)))
    }
    pub fn age(&self, m: i64) -> Option<f64> {
        if self.age_absent {
            Some(m as f64 / 12.)
        } else if self.age_reference.is_null() {
            None
        } else {
            let a: AgeRef = serde_json::from_value(self.age_reference.clone()).ok()?;
            Some(
                (a.age_months + self.anchor()? + m - self.now_months - date(&a.month).ok()?) as f64
                    / 12.,
            )
        }
    }
    pub fn legacy_position(&self, age: f64) -> Res<i64> {
        let a = age_month(age)?;
        if self.age_absent || self.age_reference.is_null() {
            Ok(a)
        } else {
            let r: AgeRef =
                serde_json::from_value(self.age_reference.clone()).map_err(|e| e.to_string())?;
            Ok(self.now_months + date(&r.month)?
                - self.anchor().ok_or("age reference requires anchor")?
                + a
                - r.age_months)
        }
    }
    pub fn item_position(&self, age: f64) -> Res<i64> {
        if self.basic() {
            item_month(age, true)
        } else {
            self.legacy_position(age)
        }
    }
    pub fn pension_position(&self, a: i64) -> i64 {
        if self.basic() {
            a
        } else {
            self.legacy_position(a as f64 / 12.).unwrap_or(a)
        }
    }
    pub fn nominal(&self, i: usize) -> Res<f64> {
        factor(
            1. + self.inflation_hundredths / 10000.,
            self.elapsed(i) / 12.,
        )
        .and_then(|g| {
            let x = self.basis_factor * g;
            if x.is_finite() && x > 0. {
                Ok(x)
            } else {
                err("nominal factor overflow")
            }
        })
    }
    pub fn pension(&self, retire: i64) -> Pension {
        self.pension_data[if self.pension_data.len() == 1 {
            0
        } else {
            (retire - self.now_months).clamp(0, self.n() as i64) as usize
        }]
        .clone()
    }
    fn validate(&mut self) -> Res<()> {
        for m in [
            self.now_months,
            self.horizon_months,
            self.target_months,
            self.search_cap_months,
        ] {
            pos(m)?
        }
        if self.horizon_months < self.now_months
            || self.n() > 1440
            || self.target_months > self.horizon_months
        {
            return err("invalid horizon/target/span");
        }
        if !["fire", "traditional"].contains(&self.mode.as_str())
            || !["basic", "legacy"].contains(&self.input_mode.as_str())
        {
            return err("unknown mode");
        }
        amount(self.assets_cents, false)?;
        amount(self.saving_cents, false)?;
        for r in [
            self.saving_growth_hundredths,
            self.r_before_hundredths,
            self.r_after_hundredths,
            self.inflation_hundredths,
        ] {
            rate(r)?
        }
        if !self.volatility_hundredths.is_finite()
            || !(0. ..=100000.).contains(&self.volatility_hundredths)
        {
            return err("invalid volatility");
        }
        if !self.first_month_fraction.is_finite()
            || !(0. ..=1.).contains(&self.first_month_fraction)
            || !self.basis_factor.is_finite()
            || self.basis_factor <= 0.
        {
            return err("invalid fraction/basis factor");
        }
        for d in [
            &self.anchor_date,
            &self.monetary_basis_date,
            &self.calculation_date,
        ]
        .into_iter()
        .flatten()
        {
            date(d)?;
        }
        if !self.age_reference.is_null() {
            let a: AgeRef =
                serde_json::from_value(self.age_reference.clone()).map_err(|e| e.to_string())?;
            if a.month.len() != 7 {
                return err("age reference requires monthly date");
            }
            date(&a.month)?;
            pos(a.age_months)?;
            if self.anchor().is_none() {
                return err("age reference needs anchor");
            }
        }
        for len in [
            self.items.len(),
            self.incomes.len(),
            self.saving_phases.len(),
            self.saving_flows.len(),
            self.spend_flows.len(),
            self.spends.len(),
            self.transfers.len(),
            self.future_incomes.len(),
            self.loans.len(),
        ] {
            if len > 10000 {
                return err("array too large");
            }
        }
        unique(self.items.iter().map(|x| &x.id))?;
        unique(self.incomes.iter().map(|x| &x.id))?;
        unique(self.transfers.iter().map(|x| &x.id))?;
        unique(self.future_incomes.iter().map(|x| &x.id))?;
        unique(self.loans.iter().map(|x| &x.id))?;
        for x in &self.items {
            amount(x.monthly_cents, true)?;
            let a = x.start_age.map(|a| self.item_position(a)).transpose()?;
            let b = x.end_age.map(|a| self.item_position(a)).transpose()?;
            if a.zip(b).is_some_and(|(a, b)| b < a) {
                return err("reversed item range");
            }
            if let Some(r) = x.inflation_hundredths {
                rate(r)?
            }
        }
        for x in &self.incomes {
            amount(x.monthly_cents, true)?;
            let a = age_month(x.start_age)?;
            if x.end_age.map(age_month).transpose()?.is_some_and(|b| b < a) {
                return err("reversed income range");
            }
        }
        let mut dates = std::collections::HashSet::new();
        for x in &self.saving_phases {
            pos(x.from_month)?;
            amount(x.cents, false)?;
            if !dates.insert(x.from_month) {
                return err("duplicate saving phase date");
            }
        }
        self.saving_phases.sort_by_key(|x| x.from_month);
        for x in self.saving_flows.iter().chain(&self.spend_flows) {
            pos(x.from_month)?;
            if let Some(b) = x.to_month {
                pos(b)?;
                if b < x.from_month {
                    return err("reversed flow range");
                }
            }
            amount(x.cents, false)?;
            if x.timing
                .as_ref()
                .is_some_and(|s| s != "start" && s != "end")
            {
                return err("unknown flow timing");
            }
        }
        for x in &self.spends {
            if x.offset_months.unsigned_abs() > 120000 {
                return err("invalid event offset");
            }
            amount(x.cents, true)?
        }
        for x in &self.transfers {
            pos(x.month)?;
            amount(x.cents, true)?;
            if let Some(a) = x.nominal_cents {
                amount(a, true)?;
                if self.anchor().is_none() || self.basis().is_none() {
                    return err("nominal calendar release needs anchor and monetary basis");
                }
            }
        }
        for x in &self.future_incomes {
            if !x.included {
                continue;
            }
            if self.anchor().is_none() || self.basis().is_none() {
                return err("calendar income requires anchor and monetary basis");
            }
            let a = x
                .monthly_cents
                .as_ref()
                .ok_or("incomplete included income")?;
            if a.is_empty() || !a.bytes().all(|b| b.is_ascii_digit()) {
                return err("saved amount string must be nonnegative integer cents");
            }
            amount(a.parse::<f64>().map_err(|_| "invalid income amount")?, true)?;
            let start = x.start_month.as_ref().ok_or("missing income start")?;
            if start.len() != 7 {
                return err("income date must be YYYY-MM");
            }
            let l = date(start)?;
            if let Some(e) = &x.end_month {
                if e.len() != 7 || date(e)? < l {
                    return err("invalid income end");
                }
            }
            match x.basis.as_deref() {
                Some("start_month") => {}
                Some("reference_month") => {
                    let s = x.basis_month.as_ref().ok_or("missing basis month")?;
                    if s.len() != 7 {
                        return err("basis month must be YYYY-MM");
                    }
                    date(s)?;
                }
                _ => return err("unknown income basis"),
            }
            if !matches!(
                x.growth.as_deref(),
                Some("fixed_nominal" | "constant_purchasing_power")
            ) {
                return err("unknown income growth");
            }
        }
        for x in &self.loans {
            if x.from_offset.unsigned_abs() > 120000
                || x.from_offset < 0 && !x.existing
                || x.months > 1440
            {
                return err("invalid loan dates/count");
            }
            amount(x.principal_cents, true)?;
            amount(x.payment_cents, true)?;
            if !x.rate_hundredths.is_finite() || x.rate_hundredths < -120000. {
                return err("invalid simple loan rate");
            }
        }
        if self.pensions.len() != 1 && self.pensions.len() != self.n() + 1 {
            return err("pensions must have one or N+1 entries");
        }
        self.pension_data = self
            .pensions
            .iter()
            .map(parse_pension)
            .collect::<Res<_>>()?;
        if self.basic() && self.pension_data.iter().any(|p| p != &self.pension_data[0]) {
            return err("basic pension entries must be identical");
        }
        Ok(())
    }
}
