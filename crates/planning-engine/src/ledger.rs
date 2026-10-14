use crate::model::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone)]
pub struct Schedule {
    pub spend: Vec<f64>,
    pub essential: Vec<f64>,
    pub income: Vec<f64>,
    pub generic: Vec<f64>,
    pub saving: Vec<f64>,
    pub base: Vec<f64>,
    pub oneoffs: Vec<f64>,
    pub transfers: Vec<f64>,
    pub start_a: Vec<f64>,
    pub start_r: Vec<f64>,
    pub essential_a: Vec<f64>,
    pub essential_r: Vec<f64>,
    pub end_out_a: Vec<f64>,
    pub end_essential_a: Vec<f64>,
    pub debt: Vec<f64>,
    pub expense_items: Vec<Source>,
    pub income_items: Vec<Source>,
    pub future_items: Vec<Source>,
    pub flow_items: Vec<Source>,
}
#[derive(Clone)]
pub struct Source {
    id: String,
    label: String,
    values: Vec<f64>,
    active: Vec<bool>,
}
impl Source {
    fn new(id: String, label: String, n: usize) -> Self {
        Self {
            id,
            label,
            values: vec![0.; n],
            active: vec![false; n],
        }
    }
    fn set(&mut self, i: usize, value: f64, recurring: bool) {
        self.values[i] = value;
        self.active[i] = recurring;
    }
    pub fn at(&self, i: usize, phase: bool) -> Value {
        json!({"id":self.id,"label":self.label,"monthly":if phase {self.values[i]} else {0.},"active":phase&&self.active[i]})
    }
}
fn sum(dst: &mut f64, x: f64) -> Res<()> {
    *dst = bounded(*dst + x)?;
    Ok(())
}
pub fn clamp(x: f64) -> f64 {
    if x.abs() <= EPS {
        0.
    } else {
        x
    }
}
impl Schedule {
    pub fn compile(p: &Plan) -> Res<Self> {
        let n = p.n();
        let mut s = Self {
            spend: vec![0.; n],
            essential: vec![0.; n],
            income: vec![0.; n],
            generic: vec![0.; n],
            saving: vec![0.; n],
            base: vec![0.; n],
            oneoffs: vec![0.; n + 1],
            transfers: vec![0.; n + 1],
            start_a: vec![0.; n],
            start_r: vec![0.; n],
            essential_a: vec![0.; n],
            essential_r: vec![0.; n],
            end_out_a: vec![0.; n],
            end_essential_a: vec![0.; n],
            debt: vec![0.; n + 1],
            expense_items: p
                .items
                .iter()
                .map(|x| Source::new(x.id.clone(), x.label.clone(), n))
                .collect(),
            income_items: p
                .incomes
                .iter()
                .map(|x| Source::new(x.id.clone(), x.label.clone(), n))
                .collect(),
            future_items: p
                .future_incomes
                .iter()
                .map(|x| Source::new(x.id.clone(), x.name.clone(), n))
                .collect(),
            flow_items: p
                .spend_flows
                .iter()
                .enumerate()
                .map(|(j, x)| {
                    Source::new(
                        x.source_id
                            .clone()
                            .unwrap_or_else(|| format!("spend_flow_{j}")),
                        x.label.clone(),
                        n,
                    )
                })
                .collect(),
        };
        for i in 0..n {
            let m = p.now_months + i as i64;
            let fraction = if i == 0 { p.first_month_fraction } else { 1. };
            let nominal = p.nominal(i)?;
            if nominal <= 0. {
                return err("nominal factor underflow");
            }
            for (j, x) in p.items.iter().enumerate() {
                let a = x
                    .start_age
                    .map(|a| p.item_position(a))
                    .transpose()?
                    .unwrap_or(i64::MIN);
                let b = x
                    .end_age
                    .map(|a| p.item_position(a))
                    .transpose()?
                    .unwrap_or(i64::MAX);
                if m >= a && m < b {
                    let own = x.inflation_hundredths.unwrap_or(p.inflation_hundredths);
                    let v = bounded(
                        x.monthly_cents
                            * ((1. + own / 10000.) / (1. + p.inflation_hundredths / 10000.))
                                .powf(p.elapsed(i) / 12.)
                            * fraction,
                    )?;
                    s.expense_items[j].set(i, v, fraction > 0.);
                    sum(&mut s.spend[i], v)?;
                    if x.essential {
                        sum(&mut s.essential[i], v)?
                    }
                }
            }
            for (j, x) in p.incomes.iter().enumerate() {
                if m >= p.legacy_position(x.start_age)?
                    && x.end_age
                        .map(|a| p.legacy_position(a))
                        .transpose()?
                        .is_none_or(|b| m < b)
                {
                    let v = bounded(
                        x.monthly_cents * if x.indexed { 1. } else { 1. / nominal } * fraction,
                    )?;
                    s.income_items[j].set(i, v, fraction > 0.);
                    sum(&mut s.income[i], v)?
                }
            }
            let mut base = p.saving_cents;
            for x in &p.saving_phases {
                if x.from_month <= m {
                    base = x.cents
                } else {
                    break;
                }
            }
            s.base[i] = bounded(base * p.saving_weight(i))?;
            s.saving[i] = s.base[i];
            s.end_out_a[i] = (-s.base[i]).max(0.);
            for (retired, flows) in [(false, &p.saving_flows), (true, &p.spend_flows)] {
                for (j, x) in flows.iter().enumerate() {
                    if m < x.from_month || x.to_month.is_some_and(|b| m >= b) {
                        continue;
                    }
                    let f = if fraction == 0. {
                        0.
                    } else if x.prorate_first {
                        fraction
                    } else {
                        1.
                    };
                    let v = bounded(x.cents * f * if x.nominal { 1. / nominal } else { 1. })?;
                    if retired {
                        s.flow_items[j].set(i, v, fraction > 0.);
                        sum(&mut s.spend[i], v)?;
                        if x.essential {
                            sum(&mut s.essential[i], v)?
                        }
                        if p.basic() && x.timing.as_deref() == Some("start") && v > 0. {
                            sum(&mut s.start_r[i], v)?;
                            if x.essential {
                                sum(&mut s.essential_r[i], v)?
                            }
                        }
                    } else {
                        sum(&mut s.saving[i], v)?;
                        if v < 0. && x.timing.as_deref() != Some("start") {
                            sum(&mut s.end_out_a[i], -v)?;
                            if x.essential {
                                sum(&mut s.end_essential_a[i], -v)?
                            }
                        }
                        if x.timing.as_deref() == Some("start") && v < 0. {
                            sum(&mut s.start_a[i], -v)?;
                            if x.essential {
                                sum(&mut s.essential_a[i], -v)?
                            }
                            if !p.basic() {
                                sum(&mut s.start_r[i], -v)?;
                                if x.essential {
                                    sum(&mut s.essential_r[i], -v)?
                                }
                            }
                        }
                    }
                }
            }
            for (j, x) in p.future_incomes.iter().enumerate() {
                if !x.included {
                    continue;
                }
                let l = date(x.start_month.as_ref().ok_or("income start")?)?;
                let end = x.end_month.as_ref().map(|s| date(s)).transpose()?;
                let mcal = p.anchor().ok_or("anchor")? + i as i64;
                if mcal < l || end.is_some_and(|e| mcal > e) {
                    continue;
                }
                let t = p.basis().ok_or("basis")?;
                let reference = if x.basis.as_deref() == Some("start_month") {
                    l
                } else {
                    date(x.basis_month.as_ref().ok_or("basis month")?)?
                };
                let a = x
                    .monthly_cents
                    .as_ref()
                    .ok_or("income amount")?
                    .parse::<f64>()
                    .map_err(|_| "income amount")?;
                let gross = 1. + p.inflation_hundredths / 10000.;
                let v = if x.growth.as_deref() == Some("constant_purchasing_power") {
                    a * factor(gross, (t - reference) as f64 / 12.)?
                } else {
                    a * factor(gross, (l - reference) as f64 / 12.)?
                        / factor(gross, (mcal - t) as f64 / 12.)?
                };
                let v = bounded(v * fraction)?;
                s.future_items[j].set(i, v, fraction > 0.);
                sum(&mut s.generic[i], v)?;
            }
        }
        for x in &p.spends {
            if x.offset_months >= 0 && (x.offset_months as usize) <= n {
                sum(&mut s.oneoffs[x.offset_months as usize], x.cents)?
            }
        }
        for x in &p.transfers {
            if x.month >= p.now_months && x.month <= p.horizon_months {
                let i = (x.month - p.now_months) as usize;
                let v = if let Some(a) = x.nominal_cents {
                    a / factor(
                        1. + p.inflation_hundredths / 10000.,
                        (p.anchor().ok_or("anchor")? + i as i64 - p.basis().ok_or("basis")?) as f64
                            / 12.,
                    )?
                } else {
                    x.cents
                };
                sum(&mut s.transfers[i], bounded(v)?)?
            }
        }
        for x in &p.loans {
            let begin = if x.existing {
                0
            } else {
                x.from_offset as usize
            };
            if begin > n {
                continue;
            }
            let mut principal = x.principal_cents;
            sum(&mut s.debt[begin], principal)?;
            let mut paid = 0;
            for i in begin..n {
                if !(i == 0 && p.first_month_fraction == 0.) {
                    let payment = if paid < x.months {
                        paid += 1;
                        x.payment_cents
                    } else {
                        0.
                    };
                    principal = bounded(
                        (principal * (1. + x.rate_hundredths / 120000.) - payment).max(0.),
                    )?;
                }
                sum(&mut s.debt[i + 1], principal)?
            }
        }
        for i in 0..n {
            bounded(s.income[i] + s.generic[i])?;
        }
        Ok(s)
    }
    pub fn tables(&self) -> Value {
        json!( {
            "spend":self.spend,
            "essential":self.essential,
            "income":self.income.iter().zip(&self.generic).map(|(a, b)|a+b).collect::<Vec<_>>(),
            "saving":self.saving,
            "oneoffs":self.oneoffs,
            "transfers":&self.transfers[..self.spend.len()],
            "start_accumulation":self.start_a,
            "start_retired":self.start_r,
            "debt":self.debt
        })
    }
}
pub fn pension_release(p: &Plan, pen: &Pension, retire: i64, m: i64) -> f64 {
    if !pen.enabled() {
        return 0.;
    }
    let release = p.pension_position(pen.unlock_age_months).max(if p.basic() {
        p.now_months
    } else {
        retire
    });
    if m == release {
        pen.lump_cents
    } else {
        0.
    }
}
pub fn pension_income(p: &Plan, pen: &Pension, m: i64) -> f64 {
    if pen.enabled() && pen.start().is_some_and(|s| m >= p.pension_position(s)) {
        pen.monthly_cents
            * if m == p.now_months {
                p.first_month_fraction
            } else {
                1.
            }
    } else {
        0.
    }
}
// Match forward arithmetic at each inverse boundary. A nearest-rounded inverse
// can lie one representable value below exact funding after many months.
fn retired_end(balance: f64, spend: f64, income: f64) -> Res<(f64, f64, f64, f64)> {
    let available = bounded(balance + income)?;
    let paid = if spend >= 0. {
        spend.min(available.max(0.))
    } else {
        spend
    };
    Ok((
        clamp(bounded(available - paid)?),
        clamp((spend - paid).max(0.)),
        paid,
        available,
    ))
}
fn inverse_retired(
    p: &Plan,
    s: &Schedule,
    i: usize,
    retire: i64,
    pen: &Pension,
    next: f64,
) -> Res<f64> {
    let m = p.now_months + i as i64;
    let g = (1. + p.r_after_hundredths / 10000.).powf(p.duration(i));
    if g <= 0. || !g.is_finite() {
        return err("growth underflow");
    }
    let income = bounded(s.income[i] + s.generic[i] + pension_income(p, pen, m))?;
    let spend = bounded(s.spend[i] - s.start_r[i])?;
    let release = bounded(s.transfers[i] + pension_release(p, pen, retire, m))?;
    let end = bounded(next + s.oneoffs[i + 1] + spend - income)?;
    let mut need = bounded(
        (s.start_r[i] + end.max(0.) / g - release)
            .max(s.start_r[i])
            .max(0.),
    )?;
    let evaluate = |balance: f64| -> Res<(bool, f64)> {
        let paid = clamp(bounded(balance - s.start_r[i])?);
        let unlocked = clamp(bounded(paid + release)?);
        let grown = if unlocked > 0. {
            clamp(bounded(unlocked * g)?)
        } else {
            unlocked
        };
        let (a, _, _, available) = retired_end(grown, spend, income)?;
        let actual = bounded(a - s.oneoffs[i + 1])?;
        let gap = (spend - available.max(0.)).max(0.);
        Ok((
            actual >= next && gap == 0.,
            (next - actual).max(gap).max(0.) / g,
        ))
    };
    for _ in 0..16 {
        let (funded, correction) = evaluate(need)?;
        if funded {
            // Find the adjoining lower representable boundary, rather than letting
            // upward inversion errors accumulate into a material cent surplus.
            for _ in 0..16 {
                let previous = need.next_down();
                if previous < s.start_r[i] || previous < 0. || !evaluate(previous)?.0 {
                    break;
                }
                need = previous;
            }
            return Ok(need);
        }
        need = bounded((need + correction).next_up())?;
    }
    err("unable to represent funding boundary")
}
pub fn required(p: &Plan, s: &Schedule, from: i64, retire: i64, pen: &Pension) -> Res<f64> {
    if from < p.now_months {
        return err("required from before origin");
    }
    if from >= p.horizon_months {
        return Ok(0.);
    }
    let mut need = 0.;
    for i in ((from - p.now_months) as usize..p.n()).rev() {
        need = inverse_retired(p, s, i, retire, pen, need)?;
    }
    Ok(need)
}
pub fn requirements(p: &Plan, s: &Schedule) -> Res<Vec<f64>> {
    if p.basic() {
        let pen = p.pension(p.now_months);
        let n = p.n();
        let mut r = vec![0.; n + 1];
        for i in (0..n).rev() {
            r[i] = inverse_retired(p, s, i, p.now_months, &pen, r[i + 1])?;
        }
        Ok(r)
    } else {
        (0..=p.n())
            .map(|i| {
                let m = p.now_months + i as i64;
                required(p, s, m, m, &p.pension(m))
            })
            .collect()
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Audit {
    pub month: i64,
    pub start_cents: f64,
    pub after_payments_cents: f64,
    pub after_unlock_cents: f64,
    pub end_cents: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Row {
    pub k: usize,
    pub start_month: i64,
    pub age: Option<i64>,
    pub year: i64,
    pub calendar_month: Option<String>,
    pub phase: String,
    pub start: f64,
    pub end: f64,
    pub contribution: f64,
    pub income: f64,
    pub unlock: f64,
    pub spend: f64,
    pub essential: f64,
    pub oneoff: f64,
    pub withdrawal: f64,
    pub unfunded: f64,
    #[serde(default)]
    pub unfunded_carried: f64,
    pub essential_unfunded: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Projection {
    pub assets: Vec<f64>,
    pub debt: Vec<f64>,
    pub withdrawn: Vec<f64>,
    pub unfunded: Vec<f64>,
    pub fi_month: Option<i64>,
    pub retire_month: Option<i64>,
    pub reason: Option<String>,
    pub funded_at_retire: bool,
    pub pension: Option<Pension>,
    pub failure_month: Option<i64>,
    pub shortfall_month: Option<i64>,
    pub audit: Vec<Audit>,
    pub rows: Vec<Row>,
}
#[derive(Default)]
pub struct Options {
    pub year: i64,
    pub before: Option<Vec<f64>>,
    pub after: Option<Vec<f64>>,
    pub gross_before: Option<Vec<f64>>,
    pub gross_after: Option<Vec<f64>>,
    pub retirement: Option<Vec<f64>>,
    pub forced_retire: Option<i64>,
}
impl Options {
    pub fn parse(v: &Value, p: &Plan) -> Res<Self> {
        let mut o = Self {
            year: arg_int(v, "year", 0)?,
            ..Self::default()
        };
        bounded(o.year as f64)?;
        for (key, out) in [
            ("returns_before", &mut o.before),
            ("returns_after", &mut o.after),
            ("retirement_returns", &mut o.retirement),
        ] {
            if let Some(x) = v.get(key) {
                let arr = x.as_array().ok_or("returns must be array")?;
                if (key == "retirement_returns"
                    && (arr.is_empty() || arr.len() > p.n().div_ceil(12)))
                    || (key != "retirement_returns" && arr.len() != p.n())
                {
                    return err("return override length");
                };
                let mut a = Vec::new();
                for x in arr {
                    let r = x.as_f64().ok_or("invalid return")?;
                    if !r.is_finite() || r < -1. || r.abs() > LIMIT {
                        return err("invalid return gross");
                    };
                    a.push(r);
                }
                *out = Some(a)
            }
        }
        Ok(o)
    }
    pub fn growth(&self, p: &Plan, i: usize, retire: Option<i64>) -> Res<f64> {
        let gross = if let Some(m) = retire {
            let year = ((p.now_months + i as i64 - m) / 12) as usize;
            if let Some(a) = &self.retirement {
                1. + a
                    .get(year)
                    .copied()
                    .unwrap_or(p.r_after_hundredths / 10000.)
            } else {
                self.gross_after.as_ref().map(|a| a[i]).unwrap_or_else(|| {
                    1. + self
                        .after
                        .as_ref()
                        .map(|a| a[i])
                        .unwrap_or(p.r_after_hundredths / 10000.)
                })
            }
        } else {
            self.gross_before.as_ref().map(|a| a[i]).unwrap_or_else(|| {
                1. + self
                    .before
                    .as_ref()
                    .map(|a| a[i])
                    .unwrap_or(p.r_before_hundredths / 10000.)
            })
        };
        let g = gross.powf(p.duration(i));
        if !g.is_finite() {
            return err("growth overflow");
        }
        Ok(g)
    }
}
pub fn arg_int(v: &Value, key: &str, default: i64) -> Res<i64> {
    v.get(key)
        .map(|x| x.as_i64().ok_or_else(|| format!("{key} must be integer")))
        .unwrap_or(Ok(default))
}
pub fn arg_num(v: &Value, key: &str, default: f64) -> Res<f64> {
    let x = v
        .get(key)
        .map(|x| x.as_f64().ok_or_else(|| format!("{key} must be number")))
        .unwrap_or(Ok(default))?;
    if !x.is_finite() {
        return err("nonfinite argument");
    }
    Ok(x)
}
#[derive(Serialize)]
pub struct Step {
    pub a: f64,
    pub withdrawal: f64,
    pub gap: f64,
}
pub fn step(balance: f64, growth: f64, lump: f64, spend: f64, income: f64) -> Res<Step> {
    for x in [balance, lump, spend, income] {
        bounded(x)?;
    }
    if !growth.is_finite() || growth < 0. || lump < 0. || spend < 0. || income < 0. {
        return err("invalid retirement step");
    }
    let unlocked = bounded(balance + lump)?;
    let grown = bounded(if unlocked > 0. {
        unlocked * growth
    } else {
        unlocked
    })?;
    let (a, gap, paid, _) = retired_end(grown, spend, income)?;
    Ok(Step {
        a,
        withdrawal: clamp((paid - income).max(0.)),
        gap,
    })
}
// A balance is always after its dated purchase, but before this month's releases.
pub fn project(p: &Plan, s: &Schedule, req: &[f64], o: &Options) -> Res<Projection> {
    let n = p.n();
    let mut a = bounded(p.assets_cents - s.oneoffs[0])?;
    let mut out = Projection {
        assets: vec![a],
        debt: s.debt.clone(),
        withdrawn: vec![0.; n],
        unfunded: vec![0.; n],
        fi_month: None,
        retire_month: None,
        reason: None,
        funded_at_retire: false,
        pension: None,
        failure_month: None,
        shortfall_month: None,
        audit: Vec::with_capacity(n),
        rows: Vec::new(),
    };
    if a < -EPS {
        out.failure_month = Some(p.now_months)
    }
    for (i, requirement) in req.iter().enumerate().take(n + 1) {
        let m = p.now_months + i as i64;
        let funded = a + EPS >= *requirement;
        if out.retire_month.is_none() {
            if funded && m <= p.search_cap_months.min(p.horizon_months) && out.fi_month.is_none() {
                out.fi_month = Some(m)
            }
            let retire = if let Some(f) = o.forced_retire {
                m == f
            } else {
                m >= p.target_months && (p.mode == "traditional" || funded)
            };
            if retire && i < n {
                out.retire_month = Some(m);
                out.funded_at_retire = funded;
                out.reason = Some(if funded { "funded" } else { "target_forced" }.into());
                out.pension = Some(p.pension(m));
            }
        }
        if i == n {
            let pen = if p.basic() {
                p.pension(p.now_months)
            } else {
                out.pension
                    .clone()
                    .unwrap_or_else(|| p.pension(p.now_months))
            };
            let release = bounded(
                s.transfers[i]
                    + if p.basic() || out.retire_month.is_some() {
                        pension_release(p, &pen, out.retire_month.unwrap_or(p.now_months), m)
                    } else {
                        0.
                    },
            )?;
            a = clamp(bounded(a + release)?);
            out.assets[i] = a;
            if let Some(row) = out.rows.last_mut() {
                row.unlock = bounded(row.unlock + release)?;
                row.end = a;
            }
            break;
        }
        if i % 12 == 0 {
            out.rows.push(Row {
                k: i / 12,
                start_month: m,
                age: p.age(m).map(|a| a.floor() as i64),
                year: o
                    .year
                    .checked_add(i as i64 / 12)
                    .ok_or("display year overflow")?,
                calendar_month: p.anchor().map(|_| p.calendar(m)),
                phase: "accumulation".into(),
                start: if i == 0 { p.assets_cents } else { a },
                end: 0.,
                contribution: 0.,
                income: 0.,
                unlock: 0.,
                spend: 0.,
                essential: 0.,
                oneoff: if i == 0 { s.oneoffs[0] } else { 0. },
                withdrawal: 0.,
                unfunded: 0.,
                essential_unfunded: 0.,
                unfunded_carried: 0.,
            });
        }
        let retired = out.retire_month.is_some();
        let start = a;
        let upfront = if retired { s.start_r[i] } else { s.start_a[i] };
        let upfront_essential = if retired {
            if p.basic() {
                s.essential_r[i]
            } else {
                s.essential[i].max(0.).min(upfront)
            }
        } else {
            s.essential_a[i]
        };
        let available_before = a.max(0.);
        let unpaid_upfront = clamp((upfront - available_before).max(0.));
        let unpaid_necessary = clamp((upfront_essential - available_before).max(0.));
        a = clamp(bounded(a - upfront)?);
        let payments = a;
        if a < -EPS && out.failure_month.is_none() {
            out.failure_month = Some(m)
        }
        if unpaid_necessary > EPS && out.shortfall_month.is_none() {
            out.shortfall_month = Some(m)
        }
        let pen = if p.basic() {
            p.pension(p.now_months)
        } else {
            out.pension
                .clone()
                .unwrap_or_else(|| p.pension(p.now_months))
        };
        let release = bounded(
            s.transfers[i]
                + if p.basic() || retired {
                    pension_release(p, &pen, out.retire_month.unwrap_or(p.now_months), m)
                } else {
                    0.
                },
        )?;
        a = clamp(bounded(a + release)?);
        let unlock = a;
        let growth = o.growth(p, i, out.retire_month)?;
        if a > 0. {
            a = clamp(bounded(a * growth)?)
        }
        let row = out.rows.last_mut().ok_or("missing row")?;
        row.unlock = bounded(row.unlock + release)?;
        if retired {
            row.phase = "retired".into();
            let inc = bounded(s.income[i] + s.generic[i] + pension_income(p, &pen, m))?;
            let remaining = bounded(s.spend[i] - upfront)?;
            let necessary = (s.essential[i] - upfront_essential)
                .max(0.)
                .min(remaining.max(0.));
            let (end, gap, end_paid, available) = retired_end(a, remaining, inc)?;
            let essential_gap = clamp((necessary - available.max(0.)).max(0.));
            let withdrawal = clamp((end_paid - inc).max(0.) + upfront.min(available_before));
            a = end;
            out.withdrawn[i] = withdrawal;
            out.unfunded[i] = bounded(unpaid_upfront + gap)?;
            if gap > EPS && out.failure_month.is_none() {
                out.failure_month = Some(m)
            }
            if essential_gap > EPS && out.shortfall_month.is_none() {
                out.shortfall_month = Some(m)
            }
            row.income = bounded(row.income + inc)?;
            row.spend = bounded(row.spend + s.spend[i])?;
            row.essential = bounded(row.essential + s.essential[i])?;
            row.withdrawal = bounded(row.withdrawal + withdrawal)?;
            row.unfunded = bounded(row.unfunded + gap)?;
            row.unfunded_carried = bounded(row.unfunded_carried + unpaid_upfront)?;
            row.essential_unfunded =
                bounded(row.essential_unfunded + essential_gap + unpaid_necessary)?;
            // An unpaid upfront payment is a persistent liability already in a; only
            // end-of-month unpaid living expense is added back in row conservation.
        } else {
            let end_available = bounded(a + s.saving[i] + upfront + s.generic[i] + s.end_out_a[i])?;
            let end_unpaid = clamp((s.end_out_a[i] - end_available.max(0.)).max(0.));
            let necessary_unpaid = clamp((s.end_essential_a[i] - end_available.max(0.)).max(0.));
            if necessary_unpaid > EPS && out.shortfall_month.is_none() {
                out.shortfall_month = Some(m)
            }
            a = clamp(bounded(end_available - s.end_out_a[i])?);
            row.contribution = bounded(row.contribution + s.saving[i])?;
            row.income = bounded(row.income + s.generic[i])?;
            out.unfunded[i] = bounded(unpaid_upfront + end_unpaid)?;
            row.unfunded_carried = bounded(row.unfunded_carried + out.unfunded[i])?;
            row.essential_unfunded =
                bounded(row.essential_unfunded + unpaid_necessary + necessary_unpaid)?;
        }
        if a < -EPS && out.failure_month.is_none() {
            out.failure_month = Some(m)
        }
        out.audit.push(Audit {
            month: m,
            start_cents: start,
            after_payments_cents: payments,
            after_unlock_cents: unlock,
            end_cents: a,
        });
        a = clamp(bounded(a - s.oneoffs[i + 1])?);
        row.oneoff = bounded(row.oneoff + s.oneoffs[i + 1])?;
        row.end = a;
        if a < -EPS && out.failure_month.is_none() {
            out.failure_month = Some(m + 1)
        }
        out.assets.push(a);
    }
    Ok(out)
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Outcome {
    pub fi_month: Option<i64>,
    pub retire_month: Option<i64>,
    pub assets_at_goal: f64,
    pub required_at_goal: f64,
    pub funded_at_goal: bool,
    pub shortfall_at_goal: f64,
    pub at_horizon: f64,
    pub failure_month: Option<i64>,
    pub shortfall_month: Option<i64>,
    pub success: bool,
}
pub fn outcome(p: &Plan, s: &Schedule, req: &[f64], q: &Projection) -> Res<Outcome> {
    let goal = p.target_months.max(p.now_months);
    let i = (goal - p.now_months).min(p.n() as i64) as usize;
    let r = if let Some(m) = q.retire_month.filter(|m| *m <= goal) {
        required(
            p,
            s,
            goal,
            m,
            &q.pension.clone().unwrap_or_else(|| p.pension(m)),
        )?
    } else {
        req[i]
    };
    let a = q.assets[i];
    Ok(Outcome {
        fi_month: q.fi_month,
        retire_month: q.retire_month,
        assets_at_goal: a,
        required_at_goal: r,
        funded_at_goal: a + EPS >= r,
        shortfall_at_goal: clamp((r - a).max(0.)),
        at_horizon: *q.assets.last().ok_or("empty assets")?,
        failure_month: q.failure_month,
        shortfall_month: q.shortfall_month,
        success: q.retire_month.is_some()
            && q.failure_month.is_none()
            && q.shortfall_month.is_none(),
    })
}
pub fn projection_arg(v: &Value, p: &Plan, s: &Schedule, req: &[f64]) -> Res<Projection> {
    if let Some(x) = v.get("projection") {
        let q: Projection =
            serde_json::from_value(x.clone()).map_err(|e| format!("invalid projection: {e}"))?;
        if q.assets.len() != p.n() + 1
            || q.debt.len() != p.n() + 1
            || q.withdrawn.len() != p.n()
            || q.unfunded.len() != p.n()
            || q.audit.len() != p.n()
            || q.rows.len() != p.n().div_ceil(12)
        {
            return err("projection shape mismatch");
        }
        for x in q
            .assets
            .iter()
            .chain(&q.debt)
            .chain(&q.withdrawn)
            .chain(&q.unfunded)
        {
            bounded(*x)?;
        }
        if let Some(pen) = &q.pension {
            parse_pension(&serde_json::to_value(pen).map_err(|e| e.to_string())?)?;
        }
        for (i, a) in q.audit.iter().enumerate() {
            if a.month != p.now_months + i as i64 {
                return err("audit month mismatch");
            }
            for x in [
                a.start_cents,
                a.after_payments_cents,
                a.after_unlock_cents,
                a.end_cents,
            ] {
                bounded(x)?;
            }
        }
        for (k, r) in q.rows.iter().enumerate() {
            if r.k != k
                || r.start_month != p.now_months + 12 * k as i64
                || !["accumulation", "retired"].contains(&r.phase.as_str())
            {
                return err("row shape mismatch");
            }
            for x in [
                r.start,
                r.end,
                r.contribution,
                r.income,
                r.unlock,
                r.spend,
                r.essential,
                r.oneoff,
                r.withdrawal,
                r.unfunded,
                r.essential_unfunded,
                r.unfunded_carried,
                r.year as f64,
            ] {
                bounded(x)?;
            }
        }
        for m in [
            q.fi_month,
            q.retire_month,
            q.failure_month,
            q.shortfall_month,
        ]
        .into_iter()
        .flatten()
        {
            if m < p.now_months || m > p.horizon_months {
                return err("projection month outside horizon");
            }
        }
        if q.retire_month.is_some_and(|m| m >= p.horizon_months) {
            return err("projection retirement needs a recurring interval");
        }
        Ok(q)
    } else {
        project(p, s, req, &Options::parse(v, p)?)
    }
}
pub fn coast(p: &Plan, s: &Schedule, from: i64, planned: bool) -> Res<f64> {
    if from < p.now_months {
        return err("coast before origin");
    }
    if from >= p.horizon_months {
        return Ok(0.);
    }
    let target = p.target_months.max(from);
    let pen = p.pension(target);
    let mut need = required(p, s, target, target, &pen)?;
    if target <= from {
        return Ok(need);
    }
    for i in ((from - p.now_months) as usize..(target - p.now_months) as usize).rev() {
        let m = p.now_months + i as i64;
        let contribution = if planned {
            s.saving[i]
        } else {
            s.saving[i] - s.base[i].max(0.)
        };
        let g = (1. + p.r_before_hundredths / 10000.).powf(p.duration(i));
        let after = bounded(need + s.oneoffs[i + 1] - contribution - s.start_a[i] - s.generic[i])?;
        let release = bounded(
            s.transfers[i]
                + if p.basic() {
                    pension_release(p, &pen, m, m)
                } else {
                    0.
                },
        )?;
        need = bounded(
            (s.start_a[i] + after.max(0.) / g - release)
                .max(s.start_a[i])
                .max(0.),
        )?;
    }
    Ok(need)
}
