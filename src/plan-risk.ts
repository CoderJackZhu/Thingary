// 退休风险实验室（纯函数）：市场路径模拟、压力测试、两张决策矩阵与崩盘路径。
// 全程「今天的钱」（实际口径）：实际收益率取对数正态、中位数等于假设收益率；不建模通胀的随机波动。
import { brokeAfter, oneOffsOf, outcome, project, requiredAt, retiredMonth, savingsOf, startPaymentsOf, scaleSaving, scaleSpend, table } from './plan-ledger.ts';
import type { Outcome, Plan } from './plan-ledger.ts';

const rate = (h: number) => h / 10000;

// ---- 随机数：固定种子，同一份计划每次点击结果一致 ----
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (rand: () => number) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
/** 计划的数值指纹（FNV-1a）：同一计划得同一种子。 */
export function seedOf(P: Plan): number {
  const text = [P.now_months, P.horizon_months, P.target_months, P.mode, P.assets_cents, P.saving_cents, JSON.stringify(P.saving_phases ?? []), P.r_before_hundredths, P.r_after_hundredths, P.volatility_hundredths, P.items.map(i => `${i.monthly_cents}:${i.start_age}:${i.end_age}`).join(',')].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const quantile = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

export type Bands = { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
export type MonteCarlo = {
  n: number;
  /** 完整预算全程无缺口（终点可以为零）（FIRE 另需达成 FI）的路径占比。 */
  success_rate: number;
  /** 至少一半路径达成 FI 时的中位数 FI 月龄，否则为 null。 */
  median_fi_month: number | null;
  /** 各取样点的年龄（岁，可带小数）与各百分位的资产；最后一个取样点是规划终点。 */
  ages: number[];
  bands: Bands;
  final: { p10: number; p25: number; p50: number; p75: number; p90: number };
};

type Pen = { monthly_cents: number; lump_cents: number; unlock_age_months: number };

/** 逐月推演 n 条路径；每年抽一次收益（对数正态，中位数＝假设值），年内按月摊开。分块让出线程，界面不卡。 */
export async function monteCarlo(P: Plan, n: number, opts: { seed?: number; progress?: (done: number) => void } = {}): Promise<MonteCarlo> {
  const N = Math.max(1, P.horizon_months - P.now_months), T = table(P), reqArr = requiredAt(P), savings = savingsOf(P), due = startPaymentsOf(P);
  const S = Math.floor((N - 1) / 12) + 1;
  const values = new Float64Array((S + 1) * n), finals = new Float64Array(n);
  const rand = mulberry32(opts.seed ?? seedOf(P));
  const sigma = rate(P.volatility_hundredths), cap = Math.min(P.search_cap_months, P.horizon_months);
  const med = (h: number) => Math.max(0.01, 1 + rate(h));
  const sLn = (h: number) => Math.sqrt(Math.log(1 + (sigma / med(h)) ** 2));
  const muB = Math.log(med(P.r_before_hundredths)), muA = Math.log(med(P.r_after_hundredths)), sB = sLn(P.r_before_hundredths), sA = sLn(P.r_after_hundredths);
  const oneOff = oneOffsOf(P);
  const pens = new Map<number, Pen>();
  const penAt = (m: number) => { let p = pens.get(m); if (!p) { p = P.pension_at(m); pens.set(m, p); } return p; };
  let ok = 0;
  const fiMonths: number[] = [];
  for (let i = 0; i < n; i++) {
    let a = P.assets_cents - oneOff[0], retire = -1, fi = -1, unlocked = false, pen: Pen | null = null;
    let failed = a < 0, gb = 1, ga = 1;
    for (let t = 0; t < N; t++) {
      const m = P.now_months + t;
      if (t % 12 === 0) { const z = normal(rand); gb = Math.exp(muB + sB * z) ** (1 / 12); ga = Math.exp(muA + sA * z) ** (1 / 12); }
      if (retire < 0) {
        const good = a >= reqArr[t];
        if (fi < 0 && m <= cap && good) fi = m;
        if (P.mode === 'fire' ? m >= P.target_months && good : m >= P.target_months) { retire = m; pen = penAt(m); }
      }
      if (t % 12 === 0) values[(t / 12) * n + i] = Math.max(0, a);
      const upfront=due[t], paidUpfront=Math.min(Math.max(0,a),upfront);
      a-=upfront; if (a<0) failed=true;
      if (retire >= 0 && !unlocked && pen!.unlock_age_months <= m) { unlocked = true; a += pen!.lump_cents; }
      if (retire < 0) { a = (a > 0 ? a * gb ** (t === 0 ? P.first_month_fraction ?? 1 : 1) : a) + savings[t] + upfront; if (a < 0) failed = true; }
      else {
        const spend = T.spend[t], income = T.income[t] + (m >= pen!.unlock_age_months ? pen!.monthly_cents * (t === 0 ? P.first_month_fraction ?? 1 : 1) : 0);
        const step = retiredMonth(a, ga ** (t === 0 ? P.first_month_fraction ?? 1 : 1), 0, Math.max(0,spend-upfront), income), w = step.withdrawal;
        a = step.a;
        if (Math.max(0, T.essential[t] - income) - w - paidUpfront > Math.max(100, spend * 0.001)) failed = true;
        if (brokeAfter(a, step.gap)) failed = true;
      }
      a -= oneOff[t + 1];
      if (a < 0) failed = true;
    }
    if (retire >= 0 && a < 0) failed = true;
    values[S * n + i] = Math.max(0, a);
    finals[i] = Math.max(0, a);
    if (fi >= 0) fiMonths.push(fi);
    // 与逐月推演同一判据：必须真的开始了退休（曾经达到 FI 但后来动用存款、始终没退成的路径不算成功）。
    if (!failed && retire >= 0 && (P.mode === 'traditional' || fi >= 0)) ok++;
    if (opts.progress && (i + 1) % 500 === 0) { opts.progress(i + 1); await new Promise(r => setTimeout(r, 0)); }
  }
  const bands: Bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  for (let j = 0; j <= S; j++) {
    const col = values.slice(j * n, (j + 1) * n).sort();
    bands.p10.push(quantile(col, 0.1)); bands.p25.push(quantile(col, 0.25)); bands.p50.push(quantile(col, 0.5)); bands.p75.push(quantile(col, 0.75)); bands.p90.push(quantile(col, 0.9));
  }
  const sorted = finals.slice().sort();
  fiMonths.sort((x, y) => x - y);
  return {
    n, success_rate: ok / n,
    median_fi_month: fiMonths.length * 2 >= n ? fiMonths[Math.floor(fiMonths.length / 2)] : null,
    ages: Array.from({ length: S + 1 }, (_, j) => (j < S ? P.now_months + 12 * j : P.horizon_months) / 12),
    bands,
    final: { p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9) },
  };
}

// ---- 压力测试 ----
export type StressId = 'return-drag' | 'inflation-shock' | 'spending-shock' | 'retire-earlier' | 'save-less' | 'income-drop' | 'job-gap' | 'raise-30' | 'raise-double' | 'early-crash';
export type Severity = 'low' | 'medium' | 'high';
export type StressResult = {
  id: StressId; label: string; description: string;
  baseline: Outcome; stressed: Outcome;
  /** 财务独立推迟的月数（任一边没达成则为 null）、退休缺口增加、期末剩余资金变化。 */
  fi_delay_months: number | null; shortfall_delta: number; horizon_delta: number;
  severity: Severity;
};

export const stressLabels: Record<StressId, { label: string; description: string }> = {
  'return-drag': { label: '收益率降低', description: '退休前和退休期间的收益率降低 2 个百分点。' },
  'inflation-shock': { label: '通胀升高', description: '总体通胀率提高 1.5 个百分点。' },
  'spending-shock': { label: '支出增加', description: '所有退休支出金额增加 10%。' },
  'retire-earlier': { label: '提前 2 年退休', description: '目标退休年龄提前两年，不早于现在。' },
  'save-less': { label: '缴款减少', description: '每月缴款减少 25%。' },
  'income-drop': { label: '收入骤降', description: '三年后起，每月储蓄减半（已经为负的阶段不变）。' },
  'raise-30': { label: '跳槽涨薪 30%', description: '三年后起，每月储蓄在有收入的阶段增加 30%（上行情形）。' },
  'raise-double': { label: '收入翻倍', description: '五年后起，有收入阶段的每月储蓄翻倍（上行情形，行业好、晋升或跳槽成功）。' },
  'job-gap': { label: '一年后失业一年', description: '一年后有 12 个月没有收入，期间每月动用存款付全部必需支出（日常生活、房租、续缴社保、房贷等）。' },
  'early-crash': { label: '退休初期市场下跌', description: '假设退休第一年市场下跌 30%。' },
};

const evaluate = (P: Plan, year: number): Outcome => outcome(P, project(P, year));
const shift = (h: number, delta: number) => Math.round((1 + rate(h) + rate(delta)) * 10000) - 10000;

/** 通胀上升而名义收益、名义工资增长不变：实际收益与实际储蓄增长按比例下降。 */
function withInflation(P: Plan, extra: number): Plan {
  const next = P.inflation_hundredths + extra, ratio = (1 + rate(P.inflation_hundredths)) / (1 + rate(next));
  const real = (h: number) => Math.round(((1 + rate(h)) * ratio - 1) * 10000);
  return { ...P, inflation_hundredths: next, r_before_hundredths: real(P.r_before_hundredths), r_after_hundredths: real(P.r_after_hundredths), saving_growth_hundredths: real(P.saving_growth_hundredths) };
}

const severityOf = (base: Outcome, s: Outcome, fiDelay: number | null): Severity => {
  const scale = Math.max(1, base.required_at_goal), growth = Math.max(0, s.shortfall_at_goal - base.shortfall_at_goal);
  if (s.failure_month !== null || s.shortfall_month !== null || (base.fi_month !== null && s.fi_month === null) || (fiDelay !== null && fiDelay >= 36) || growth >= scale * 0.15) return 'high';
  if ((fiDelay !== null && fiDelay >= 12) || growth >= scale * 0.05) return 'medium';
  return 'low';
};

/** 退休后第 y 年的实际收益：用于「第一年下跌」等路径。 */
export const crashReturns = (P: Plan, drops: Record<number, number>) => (y: number) => drops[y] ?? rate(P.r_after_hundredths);

// ---- 储蓄时间线的改写：压力测试与矩阵用 ----
type Phase = { from_month: number; cents: number };
const phasesOf = (P: Plan): Phase[] => (P.saving_phases && P.saving_phases.length ? P.saving_phases : [{ from_month: P.now_months, cents: P.saving_cents }]);
const valueAt = (ph: Phase[], m: number) => { let v = ph[0].cents; for (const x of ph) if (x.from_month <= m) v = x.cents; return v; };
/** 在 breaks 处切开时间线，再对每一段重新取值；再并掉相邻相同金额。 */
function reshape(P: Plan, breaks: number[], f: (cents: number, from: number) => number): Plan {
  const ph = phasesOf(P), starts = [...new Set([ph[0].from_month, ...ph.map(x => x.from_month), ...breaks.filter(b => b > ph[0].from_month)])].sort((a, b) => a - b);
  const out: Phase[] = [];
  for (const m of starts) { const cents = f(valueAt(ph, m), m); if (!out.length || out[out.length - 1].cents !== cents) out.push({ from_month: m, cents }); }
  return { ...P, saving_phases: out };
}
/** 从 from 月龄起，正储蓄乘以 factor。 */
export const saveFrom = (P: Plan, from: number, factor: number): Plan => reshape(P, [from], (c, m) => (m >= from && c > 0 ? c * factor : c));
/** 从 from 月龄起连续 months 个月，储蓄变成 cents（负数表示动用存款），之后恢复原来的阶段。 */
export const gapAt = (P: Plan, from: number, months: number, cents: number): Plan => reshape(P, [from, from + months], (c, m) => (m >= from && m < from + months ? cents : c));
/** 反推：从现在起到 untilMonth（月龄）每月至少存多少，才能在目标年龄达标（资产不低于所需、没有支出缺口）。
 *  untilMonth 之后沿用原来的储蓄安排；已经够了返回 0，每月存到 100 万也不够返回 null。今天的钱，精确到分。 */
export function requiredSaving(P: Plan, year: number, untilMonth: number): number | null {
  const ph = phasesOf(P), until = Math.max(untilMonth, P.now_months + 1);
  const later = ph.filter((x, i) => i > 0 && x.from_month > until), resume = valueAt(ph, until);
  const trial = (s: number): Plan => ({ ...P, saving_phases: [{ from_month: P.now_months, cents: s }, ...(valueAt(ph, until) === s ? [] : [{ from_month: until, cents: resume }]), ...later] });
  const ok = (s: number) => { const o = evaluate(trial(s), year); return o.funded_at_goal && o.shortfall_month === null && o.failure_month === null; };
  if (ok(0)) return 0;
  let lo = 0, hi = 100_000_000;
  if (!ok(hi)) return null;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid; }
  return hi;
}

/** 有收入时的储蓄（所有阶段里最大的正数）：矩阵的缴款轴以它为基准。 */
export const workSaving = (P: Plan) => Math.max(0, ...phasesOf(P).map(x => x.cents));
const withWorkSaving = (P: Plan, cents: number): Plan => { const base = workSaving(P); return base > 0 ? scaleSaving(P, cents / base) : { ...P, saving_cents: cents, saving_phases: undefined }; };

export function stressTests(P: Plan, year: number): StressResult[] {
  const baseProj = project(P, year), baseline = outcome(P, baseProj);
  const make = (id: StressId, stressed: Outcome): StressResult => {
    const delay = baseline.fi_month !== null && stressed.fi_month !== null ? stressed.fi_month - baseline.fi_month : null;
    return { id, ...stressLabels[id], baseline, stressed, fi_delay_months: delay, shortfall_delta: stressed.shortfall_at_goal - baseline.shortfall_at_goal, horizon_delta: stressed.at_horizon - baseline.at_horizon, severity: severityOf(baseline, stressed, delay) };
  };
  const earlier = Math.max(P.now_months + 12, P.target_months - 24);
  const crash = baseProj.retire_month === null ? baseline : outcome(P, project(P, year, { after: crashReturns(P, { 0: -0.3 }) }));
  return [
    make('return-drag', evaluate({ ...P, r_before_hundredths: P.r_before_hundredths - 200, r_after_hundredths: P.r_after_hundredths - 200 }, year)),
    make('inflation-shock', evaluate(withInflation(P, 150), year)),
    make('spending-shock', evaluate(scaleSpend(P, 1.1), year)),
    make('retire-earlier', evaluate({ ...P, target_months: earlier }, year)),
    make('save-less', evaluate(scaleSaving(P, 0.75), year)),
    make('income-drop', evaluate(saveFrom(P, P.now_months + 36, 0.5), year)),
    make('raise-30', evaluate(saveFrom(P, P.now_months + 36, 1.3), year)),
    make('raise-double', evaluate(saveFrom(P, P.now_months + 60, 2), year)),
    make('job-gap', evaluate(gapAt(P, P.now_months + 12, 12, -(table(P).essential[12] ?? P.items[0]?.monthly_cents ?? 0)), year)),
    make('early-crash', crash),
  ];
}

const severityRank: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
/** 影响最大的一项：先比严重程度，再比缺口增加，再比财务独立推迟。没有任何实质影响时返回 null。 */
export function largestRisk(results: StressResult[]): StressResult | null {
  const sorted = results.filter(r => r.id !== 'raise-30' && r.id !== 'raise-double').sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.shortfall_delta - a.shortfall_delta || (b.fi_delay_months ?? 0) - (a.fi_delay_months ?? 0));
  const top = sorted[0];
  return top && (top.severity !== 'low' || top.shortfall_delta > 0 || (top.fi_delay_months ?? 0) > 0) ? top : null;
}

// ---- 决策矩阵 ----
export type Cell = { fi_month: number | null; retire_month: number | null; funded_at_goal: boolean; shortfall_at_goal: number; at_horizon: number; failed: boolean };
export type Matrix = { rows: number[]; cols: number[]; cells: Cell[][]; base_row: number | null; base_col: number | null };

const cellOf = (P: Plan, year: number): Cell => { const o = evaluate(P, year); return { fi_month: o.fi_month, retire_month: o.retire_month, funded_at_goal: o.funded_at_goal, shortfall_at_goal: o.shortfall_at_goal, at_horizon: o.at_horizon, failed: o.failure_month !== null || o.shortfall_month !== null }; };
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
/** 以基准为中心的五个互不相同的金额（分）；基准不为正时给固定档位。 */
function moneyAxis(base: number, multipliers: number[], step: number, fallback: number[]): number[] {
  if (base <= 0) return fallback;
  const values = new Set<number>(multipliers.map(m => (m === 1 ? base : Math.max(0, roundTo(base * m, step)))));
  for (let k = 1; values.size < 5; k++) values.add(Math.max(0, roundTo(base, step)) + k * step);
  return [...values].sort((x, y) => x - y);
}

/** 行：实际收益率偏移（−2 至 +2 个百分点，退休前后同移）；列：每月缴款。 */
export function contributionReturnMatrix(P: Plan, year: number): Matrix {
  const rows = [-200, -100, 0, 100, 200];
  const base = workSaving(P) > 0 ? workSaving(P) : P.saving_cents;
  const cols = moneyAxis(base, [0.6, 0.8, 1, 1.2, 1.4], 10000, [0, 50000, 100000, 150000, 200000]);
  return {
    rows, cols, base_row: 2, base_col: cols.indexOf(base) >= 0 ? cols.indexOf(base) : null,
    cells: rows.map(d => cols.map(c => cellOf({ ...withWorkSaving(P, c), r_before_hundredths: shift(P.r_before_hundredths, d), r_after_hundredths: shift(P.r_after_hundredths, d) }, year))),
  };
}

/** 行：退休后每月总支出（今天的钱，分）；列：期望退休年龄（岁）。 */
export function ageSpendingMatrix(P: Plan, year: number): Matrix {
  const T = table(P), idx = Math.min(Math.max(0, P.target_months - P.now_months), Math.max(0, T.spend.length - 1));
  const base = T.spend[idx] ?? 0;
  const rows = moneyAxis(base, [0.8, 0.9, 1, 1.1, 1.2], 10000, [0, 100000, 200000, 300000, 400000]);
  const target = Math.round(P.target_months / 12), lo = Math.floor(P.now_months / 12) + 1, hi = Math.floor(P.horizon_months / 12) - 1;
  const ages: number[] = [];
  for (const d of [-3, -1, 0, 2, 4]) { const a = Math.min(hi, Math.max(lo, target + d)); if (!ages.includes(a)) ages.push(a); }
  for (let up = target, down = target; ages.length < 5 && (up < hi || down > lo);) {
    if (up < hi && !ages.includes(++up)) ages.push(up);
    if (ages.length < 5 && down > lo && !ages.includes(--down)) ages.push(down);
  }
  const cols = ages.sort((x, y) => x - y);
  return {
    rows, cols, base_row: base > 0 ? rows.findIndex(r => Math.abs(r - base) < 1) : null, base_col: cols.indexOf(target) >= 0 ? cols.indexOf(target) : null,
    cells: rows.map(r => cols.map(c => cellOf({ ...(base > 0 ? scaleSpend(P, r / base) : P), target_months: c * 12 }, year))),
  };
}

// ---- 崩盘路径 ----
export type SorrId = 'base' | 'crash-1' | 'crash-5' | 'double' | 'lost-decade';
export type SorrPath = { id: SorrId; label: string; years: number[]; path: number[]; final: number; survived: boolean; failure_age: number | null; shortfall_age: number | null };
export const sorrLabels: Record<SorrId, string> = { base: '基准情形', 'crash-1': '第 1 年下跌（−30%）', 'crash-5': '第 5 年下跌（−30%）', double: '两次下跌', 'lost-decade': '失落的十年' };

/** 从退休当月起，五种退休期收益序列各推演一次。没有退休（未达成）或退休时没钱时不可用。 */
export function sorr(P: Plan, year: number): SorrPath[] | null {
  const base = project(P, year);
  if (base.retire_month === null) return null;
  const R = base.retire_month - P.now_months;
  if (base.assets[R] <= 0) return null;
  const r = rate(P.r_after_hundredths), years = Math.floor((P.horizon_months - base.retire_month) / 12);
  if (years <= 0) return null;
  const defs: [SorrId, Record<number, number>][] = [
    ['base', {}], ['crash-1', { 0: -0.3 }], ['crash-5', years >= 5 ? { 4: -0.3 } : {}], ['double', years >= 5 ? { 0: -0.25, 4: -0.2 } : { 0: -0.25 }],
    ['lost-decade', Object.fromEntries(Array.from({ length: Math.min(10, years) }, (_, y) => [y, 0]))],
  ];
  return defs.map(([id, drops]) => {
    const proj = project(P, year, { after: y => drops[y] ?? r }), end = proj.assets.length - 1;
    const path = Array.from({ length: years + 1 }, (_, y) => Math.max(0, proj.assets[Math.min(end, R + 12 * y)]));
    const final = Math.max(0, proj.assets[end]);
    return { id, label: sorrLabels[id], years: path.map((_, y) => (base.retire_month! + 12 * y) / 12), path, final, survived: proj.failure_month === null && proj.shortfall_month === null && final > 0, failure_age: proj.failure_month === null ? null : Math.floor(proj.failure_month / 12), shortfall_age: proj.shortfall_month === null ? null : Math.floor(proj.shortfall_month / 12) };
  });
}
