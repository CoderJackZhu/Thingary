use crate::ledger::*;
use crate::model::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
// SplitMix64: independent path state, then Box-Muller normals. Not cryptographic.
struct Rng(u64);
impl Rng {
    fn word(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn uniform(&mut self) -> f64 {
        ((self.word() >> 11) as f64 + 0.5) / 9007199254740992.
    }
    fn normal(&mut self) -> f64 {
        (-2. * self.uniform().ln()).sqrt() * (std::f64::consts::TAU * self.uniform()).cos()
    }
}
fn sigma(median: f64, sd: f64) -> f64 {
    let a = sd / median;
    let t = (1. + (1. + 4. * a * a).sqrt()) / 2.;
    t.ln().sqrt()
}
#[derive(Serialize, Deserialize)]
pub struct PathSample {
    pub index: u32,
    pub assets: Vec<f64>,
    pub fi_month: Option<i64>,
    pub success: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Samples {
    pub months: Vec<i64>,
    pub ages: Vec<Option<f64>>,
    pub calendar_months: Vec<String>,
    pub paths: Vec<PathSample>,
}
pub fn axis(n: usize) -> Vec<usize> {
    let mut a: Vec<usize> = (0..=n).step_by(12).collect();
    if a.last() != Some(&n) {
        a.push(n)
    }
    a
}
fn u32_arg(v: &Value, key: &str, default: u32) -> Res<u32> {
    let x = v
        .get(key)
        .map(|x| x.as_u64().ok_or("expected u32"))
        .unwrap_or(Ok(default as u64))?;
    u32::try_from(x).map_err(|_| format!("{key} out of u32 range"))
}
pub fn simulate_paths(p: &Plan, s: &Schedule, req: &[f64], v: &Value) -> Res<Samples> {
    let n = u32_arg(v, "paths", 1000)?;
    let seed = u32_arg(v, "seed", 1)?;
    let start = u32_arg(v, "start_index", 0)?;
    if n == 0 || n > 20000 || start.checked_add(n - 1).is_none() {
        return err("invalid paths/index range");
    }
    let samples = axis(p.n());
    let months: Vec<i64> = samples.iter().map(|i| p.now_months + *i as i64).collect();
    let mut out = Samples {
        ages: months.iter().map(|m| p.age(*m)).collect(),
        calendar_months: months.iter().map(|m| p.calendar(*m)).collect(),
        months,
        paths: Vec::with_capacity(n as usize),
    };
    let mb = 1. + p.r_before_hundredths / 10000.;
    let ma = 1. + p.r_after_hundredths / 10000.;
    let sb = sigma(mb, p.volatility_hundredths / 10000.);
    let sa = sigma(ma, p.volatility_hundredths / 10000.);
    for index in start..=start + (n - 1) {
        let mut o = Options::default();
        if p.volatility_hundredths > 0. {
            let mut rng = Rng(((seed as u64) << 32 | index as u64) ^ 0xd1b54a32d192ed03);
            let mut b = vec![0.; p.n()];
            let mut a = b.clone();
            for block in 0..p.n().div_ceil(12) {
                let z = rng.normal();
                let rb = mb * (sb * z).exp();
                let ra = ma * (sa * z).exp();
                if !rb.is_finite() || !ra.is_finite() || rb <= 0. || ra <= 0. {
                    return err("sampled return overflow");
                };
                for i in block * 12..((block + 1) * 12).min(p.n()) {
                    b[i] = rb;
                    a[i] = ra;
                }
            }
            o.gross_before = Some(b);
            o.gross_after = Some(a);
        }
        let q = project(p, s, req, &o)?;
        let success =
            q.retire_month.is_some() && q.failure_month.is_none() && q.shortfall_month.is_none();
        out.paths.push(PathSample {
            index,
            assets: samples.iter().map(|i| q.assets[*i]).collect(),
            fi_month: q.fi_month,
            success,
        });
    }
    Ok(out)
}
fn quantile(sorted: &[f64], q: f64) -> f64 {
    let x = q * (sorted.len() - 1) as f64;
    let i = x.floor() as usize;
    let j = x.ceil() as usize;
    sorted[i] + (sorted[j] - sorted[i]) * (x - i as f64)
}
pub fn summarize(s: Samples) -> Res<Value> {
    let n = s.paths.len();
    let l = s.months.len();
    if n == 0 || n > 20000 || l == 0 || l > 121 || s.ages.len() != l || s.calendar_months.len() != l
    {
        return err("invalid sample dimensions");
    };
    for (i, m) in s.months.iter().enumerate() {
        pos(*m)?;
        if i > 0 && *m <= s.months[i - 1] {
            return err("sample months must increase");
        }
    }
    if s.months[l - 1] - s.months[0] > 1440 {
        return err("sample horizon exceeds 1440 months");
    }
    for a in s.ages.iter().flatten() {
        if !a.is_finite() {
            return err("nonfinite sample age");
        }
    }
    let mut indices = std::collections::HashSet::new();
    for p in &s.paths {
        if p.assets.len() != l || !indices.insert(p.index) {
            return err("invalid sampled path shape/index");
        };
        for x in &p.assets {
            bounded(*x)?;
        }
        if let Some(m) = p.fi_month {
            if m < s.months[0] || m > *s.months.last().ok_or("axis")? {
                return err("sample FI outside axis");
            }
        }
    }
    let mut bands = vec![vec![0.; l]; 5];
    for (i, _) in s.months.iter().enumerate() {
        let mut values: Vec<f64> = s.paths.iter().map(|p| p.assets[i]).collect();
        values.sort_by(f64::total_cmp);
        for (k, q) in [0.1, 0.25, 0.5, 0.75, 0.9].iter().enumerate() {
            bands[k][i] = quantile(&values, *q);
        }
    }
    let mut fi: Vec<i64> = s.paths.iter().filter_map(|p| p.fi_month).collect();
    fi.sort_unstable();
    let median = if fi.len() >= n.div_ceil(2) {
        Some(fi[fi.len() / 2])
    } else {
        None
    };
    let success = s.paths.iter().filter(|p| p.success).count();
    Ok(json!( {
        "n":n,
        "success_rate":success as f64/n as f64,
        "median_fi_month":median,
        "months":s.months,
        "ages":s.ages,
        "calendar_months":s.calendar_months,
        "bands": {
            "p10":bands[0],
            "p25":bands[1],
            "p50":bands[2],
            "p75":bands[3],
            "p90":bands[4]
        },
        "final": {
            "p10":bands[0][l-1],
            "p25":bands[1][l-1],
            "p50":bands[2][l-1],
            "p75":bands[3][l-1],
            "p90":bands[4][l-1]
        }
    }))
}
pub fn sequence(p: &Plan, s: &Schedule, req: &[f64], v: &Value) -> Res<Value> {
    let base = project(p, s, req, &Options::parse(v, p)?)?;
    let Some(retire) = base.retire_month else {
        return Ok(Value::Null);
    };
    let start = (retire - p.now_months) as usize;
    if base.assets[start] <= EPS {
        return Ok(Value::Null);
    }
    let shock = arg_num(v, "shock", (1. + p.r_after_hundredths / 10000.) * 0.9 - 1.)?;
    if !(-1. ..=LIMIT).contains(&shock) {
        return err("invalid sequence shock");
    };
    let total = (start..p.n()).map(|i| p.duration(i)).sum::<f64>();
    if total == 0. {
        return Ok(Value::Null);
    }
    let d = total.min(1.);
    let adverse = 1. + shock;
    let ordinary = 1. + p.r_after_hundredths / 10000.;
    let mut indices: Vec<usize> = (start..=p.n()).step_by(12).collect();
    if indices.last() != Some(&p.n()) {
        indices.push(p.n())
    }
    let months: Vec<i64> = indices.iter().map(|i| p.now_months + *i as i64).collect();
    let mut results = Vec::new();
    for (id, label, interval) in [
        ("base", "原定回报", None),
        ("early", "退休初期承受下跌", Some((0., d))),
        ("late", "退休末期承受下跌", Some((total - d, total))),
    ] {
        let mut after = vec![ordinary; p.n()];
        if let Some((left, right)) = interval {
            let mut t: f64 = 0.;
            for (i, r) in after.iter_mut().enumerate().skip(start) {
                let duration = p.duration(i);
                let overlap = ((t + duration).min(right) - t.max(left)).max(0.);
                if duration > 0. {
                    let gross = adverse.powf(overlap / duration)
                        * ordinary.powf((duration - overlap) / duration);
                    *r = gross;
                }
                t += duration;
            }
        }
        let o = Options {
            year: arg_int(v, "year", 0)?,
            gross_after: Some(after),
            forced_retire: Some(retire),
            ..Options::default()
        };
        let q = project(p, s, req, &o)?;
        results.push(json!( {
            "id":id,
            "label":label,
            "months":months,
            "calendar_months":months.iter().map(|m|p.calendar(*m)).collect::<Vec<_>>(),
            "years":indices.iter().map(|i|p.age(p.now_months+*i as i64).unwrap_or_else(||(start..*i).map(|j|p.duration(j)).sum())).collect::<Vec<_>>(),
            "path":indices.iter().map(|i|q.assets[*i]).collect::<Vec<_>>(),
            "final":q.assets[p.n()],
            "survived":q.failure_month.is_none()&&q.shortfall_month.is_none(),
            "failure_month":q.failure_month,
            "shortfall_month":q.shortfall_month,
            "failure_age":q.failure_month.and_then(|m|if p.age_absent {
                None
            }
            else {
                p.age(m)
            }),
            "shortfall_age":q.shortfall_month.and_then(|m|if p.age_absent {
                None
            }
            else {
                p.age(m)
            })
        }));
    }
    Ok(Value::Array(results))
}
