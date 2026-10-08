// 退休风险实验室（纯函数）：市场路径模拟、压力测试、两张决策矩阵与崩盘路径。
// 全程「今天的钱」（实际口径）：实际收益率取对数正态、中位数等于假设收益率；不建模通胀的随机波动。
import { elapsedMonths } from './plan-core.ts';
import { outcome, project, scaleSaving, scaleSpend, table } from './plan-ledger.ts';
import type { Outcome, Plan } from './plan-ledger.ts';

const rate = (h: number) => h / 10000;

// Mulberry32 algorithm: Tommy Ettinger (2017), CC0 original C implementation.
// https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
// JavaScript reference by bryc declares public domain:
// https://github.com/bryc/code/blob/master/jshash/PRNGs.md
// Original-development retrieval route is unknown; these are verified algorithm references.
// Fixed seed is for reproducible simulations, never for cryptography.
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

/** Random returns are inputs to the production ledger, not a second cash-flow engine.
 * G = exp(log(1+r) + sZ). Given median m=1+r and standard deviation v,
 * u=exp(s²) solves m²u(u−1)=v². Annual draws share a market shock across phases.
 * No random inflation or career process is assumed. */
export async function monteCarlo(P: Plan, n: number, opts: { seed?: number; progress?: (done: number) => void } = {}): Promise<MonteCarlo> {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('路径数必须是正整数');
  const months = Math.max(0, P.horizon_months - P.now_months);
  const offsets = Array.from({ length: Math.ceil(months / 12) }, (_, i) => i * 12);
  offsets.push(months);
  const samples = offsets.map(() => new Float64Array(n));
  const endings = samples[samples.length - 1];
  const reached: number[] = [];
  const random = mulberry32(opts.seed ?? seedOf(P));
  const volatility = Math.max(0, rate(P.volatility_hundredths));
  const distribution = (hundredths: number) => {
    const median = Math.max(0.01, 1 + rate(hundredths));
    const varianceRatio = (volatility / median) ** 2;
    return { center: Math.log(median), spread: Math.sqrt(Math.log((1 + Math.sqrt(1 + 4 * varianceRatio)) / 2)) };
  };
  const before = distribution(P.r_before_hundredths), after = distribution(P.r_after_hundredths);
  // Retirement age can vary between runs. Cache only the pension calculation,
  // never a path's funds, contributions or success result.
  const pensions = new Map<number, ReturnType<Plan['pension_at']>>();
  const simulated: Plan = { ...P, pension_at: age => {
    if (!pensions.has(age)) pensions.set(age, P.pension_at(age));
    return pensions.get(age)!;
  } };
  let covered = 0;
  for (let run = 0; run < n; run++) {
    const shocks = Array.from({ length: Math.ceil(months / 12) }, () => normal(random));
    const projection = project(simulated, 0, { annualReturnAt: (offset, phase) => {
      if (volatility === 0) return rate(phase === 'accumulation' ? P.r_before_hundredths : P.r_after_hundredths);
      const d = phase === 'accumulation' ? before : after;
      return Math.exp(d.center + d.spread * shocks[Math.floor(offset / 12)]) - 1;
    } });
    const result = outcome(simulated, projection);
    covered += Number(result.success);
    if (projection.fi_month !== null) reached.push(projection.fi_month);
    offsets.forEach((offset, sample) => { samples[sample][run] = Math.max(0, projection.assets[offset]); });
    if ((run + 1) % 250 === 0 && opts.progress) {
      opts.progress(run + 1);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  const bands: Bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  const levels = { p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9 } as const;
  for (const sample of samples) {
    sample.sort();
    for (const key of Object.keys(levels) as (keyof Bands)[]) bands[key].push(quantile(sample, levels[key]));
  }
  reached.sort((a, b) => a - b);
  opts.progress?.(n);
  return {
    n, success_rate: covered / n,
    median_fi_month: reached.length >= Math.ceil(n / 2) ? reached[Math.floor(reached.length / 2)] : null,
    ages: offsets.map(offset => (P.now_months + offset) / 12), bands,
    final: { p10: quantile(endings, 0.1), p25: quantile(endings, 0.25), p50: quantile(endings, 0.5), p75: quantile(endings, 0.75), p90: quantile(endings, 0.9) },
  };
}

// ---- 压力测试 ----
export type StressId = 'return-drag' | 'inflation-shock' | 'spending-shock' | 'retire-earlier' | 'save-less' | 'early-crash';
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
  'spending-shock': { label: '支出增加', description: '退休预算分项增加 10%，固定事件付款保持原额。' },
  'retire-earlier': { label: '提前 2 年退休', description: '目标退休年龄提前两年，不早于现在。' },
  'save-less': { label: '缴款减少', description: '每月缴款减少 25%。' },
  'early-crash': { label: '退休初期市场下跌', description: '假设退休第一年市场下跌 30%。' },
};

const evaluate = (P: Plan, year: number): Outcome => outcome(P, project(P, year));

/** 通胀上升而名义收益、名义工资增长不变：实际收益与实际储蓄增长按比例下降。 */
function withInflation(P: Plan, extra: number): Plan {
  const next = P.inflation_hundredths + extra, ratio = (1 + rate(P.inflation_hundredths)) / (1 + rate(next));
  const real = (h: number) => Math.round(((1 + rate(h)) * ratio - 1) * 10000);
  return { ...P, inflation_hundredths: next, r_before_hundredths: real(P.r_before_hundredths), r_after_hundredths: real(P.r_after_hundredths), saving_growth_hundredths: real(P.saving_growth_hundredths) };
}

/** Severity describes a change in payable obligations, not arbitrary delay/ratio cut-offs.
 * High: the test loses coverage, a goal or FI, or moves a cash shortfall earlier.
 * Medium: coverage is unchanged but needed money, timing or terminal reserve worsens. */
export function stressSeverity(base: Outcome, tested: Outcome): Severity {
  const earlierFailure = (before: number | null, after: number | null) => after !== null && (before === null || after < before);
  const lostCoverage = base.success && !tested.success;
  const lostGoal = base.funded_at_goal && !tested.funded_at_goal;
  const lostFI = base.fi_month !== null && tested.fi_month === null;
  if (lostCoverage || lostGoal || lostFI || earlierFailure(base.failure_month, tested.failure_month) || earlierFailure(base.shortfall_month, tested.shortfall_month)) return 'high';
  const moreRequired = tested.shortfall_at_goal > base.shortfall_at_goal + 0.5;
  const lessReserve = tested.at_horizon < base.at_horizon - 0.5;
  const laterFI = base.fi_month !== null && tested.fi_month !== null && tested.fi_month > base.fi_month;
  return moreRequired || lessReserve || laterFI ? 'medium' : 'low';
}

/** 退休后第 y 年的实际收益：用于「第一年下跌」等路径。 */
export const crashReturns = (P: Plan, drops: Record<number, number>) => (y: number) => drops[y] ?? rate(P.r_after_hundredths);

// ---- 通用缴款矩阵的金额轴 ----
type Phase = { from_month: number; cents: number };
const phasesOf = (P: Plan): Phase[] => (P.saving_phases && P.saving_phases.length ? P.saving_phases : [{ from_month: P.now_months, cents: P.saving_cents }]);
/** 内部金额时间线的最大正投入，作为矩阵缴款轴基准；不推断职业或收入。 */
export const workSaving = (P: Plan) => Math.max(0, ...phasesOf(P).map(x => x.cents));
const withWorkSaving = (P: Plan, cents: number): Plan => { const base = workSaving(P); return base > 0 ? scaleSaving(P, cents / base) : { ...P, saving_cents: cents, saving_phases: undefined }; };

// Locally specified one-variable tests. Values are explicit product assumptions,
// not population estimates. The registry drives both descriptions and calculations.
type StressCase = { id: StressId; apply: (P: Plan) => Plan; after?: (y: number) => number };
export function stressTests(P: Plan, year: number): StressResult[] {
  const baseline = evaluate(P, year);
  const cases: StressCase[] = [
    { id: 'return-drag', apply: p => ({ ...p, r_before_hundredths: p.r_before_hundredths - 200, r_after_hundredths: p.r_after_hundredths - 200 }) },
    { id: 'inflation-shock', apply: p => withInflation(p, 150) },
    { id: 'spending-shock', apply: p => scaleSpend(p, 1.1) },
    { id: 'retire-earlier', apply: p => ({ ...p, target_months: Math.max(p.now_months + 12, p.target_months - 24) }) },
    { id: 'save-less', apply: p => scaleSaving(p, 0.75) },
    { id: 'early-crash', apply: p => p, after: crashReturns(P, { 0: -0.3 }) },
  ];
  return cases.map(test => {
    const candidate = test.apply(P);
    const stressed = outcome(candidate, project(candidate, year, test.after ? { after: test.after } : {}));
    return {
      id: test.id, ...stressLabels[test.id], baseline, stressed,
      fi_delay_months: baseline.fi_month === null || stressed.fi_month === null ? null : stressed.fi_month - baseline.fi_month,
      shortfall_delta: stressed.shortfall_at_goal - baseline.shortfall_at_goal,
      horizon_delta: stressed.at_horizon - baseline.at_horizon,
      severity: stressSeverity(baseline, stressed),
    };
  });
}

const severityRank: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
/** 影响最大的一项：先比严重程度，再比缺口增加，再比财务独立推迟。没有任何实质影响时返回 null。 */
export function largestRisk(results: StressResult[]): StressResult | null {
  const sorted = results.slice().sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.shortfall_delta - a.shortfall_delta || (b.fi_delay_months ?? 0) - (a.fi_delay_months ?? 0));
  const top = sorted[0];
  return top && (top.severity !== 'low' || top.shortfall_delta > 0 || (top.fi_delay_months ?? 0) > 0) ? top : null;
}

// ---- 决策矩阵 ----
export type Cell = { fi_month: number | null; retire_month: number | null; funded_at_goal: boolean; shortfall_at_goal: number; at_horizon: number; failed: boolean };
export type Matrix = { rows: number[]; cols: number[]; cells: Cell[][]; base_row: number | null; base_col: number | null };

const cellOf = (P: Plan, year: number): Cell => { const o = evaluate(P, year); return { fi_month: o.fi_month, retire_month: o.retire_month, funded_at_goal: o.funded_at_goal, shortfall_at_goal: o.shortfall_at_goal, at_horizon: o.at_horizon, failed: o.failure_month !== null || o.shortfall_month !== null }; };
/** Five equally spaced, nonnegative choices including the exact current amount.
 * Step = a quarter of the reference amount, rounded up to a cent. Near zero,
 * shift the window instead of duplicating zero. No currency-specific fallback list. */
function amountWindow(base: number, reference: number): number[] {
  const step = Math.max(1, Math.ceil(Math.max(base, reference) / 4));
  const anchor = Math.min(2, Math.floor(Math.max(0, base) / step));
  return Array.from({ length: 5 }, (_, index) => base + (index - anchor) * step);
}
function matrixFor(rows: number[], cols: number[], baseRow: number, baseCol: number, candidate: (row: number, col: number) => Plan, year: number): Matrix {
  return { rows, cols, base_row: rows.includes(baseRow) ? rows.indexOf(baseRow) : null, base_col: cols.includes(baseCol) ? cols.indexOf(baseCol) : null, cells: rows.map(row => cols.map(col => cellOf(candidate(row, col), year))) };
}

/** Compare contributions and return assumptions around the saved plan. */
export function contributionReturnMatrix(P: Plan, year: number): Matrix {
  const base = Math.max(0, workSaving(P));
  const budget = table(P).spend[Math.max(0, Math.min(P.horizon_months - P.now_months - 1, P.target_months - P.now_months))] ?? 0;
  const contributions = amountWindow(base, base || budget);
  return matrixFor([-200, -100, 0, 100, 200], contributions, 0, base, (change, saving) => ({
    ...withWorkSaving(P, saving), r_before_hundredths: P.r_before_hundredths + change, r_after_hundredths: P.r_after_hundredths + change,
  }), year);
}

/** A symmetric two-year age grid, bounded by the available planning years. */
export function ageSpendingMatrix(P: Plan, year: number): Matrix {
  const target = Math.round(P.target_months / 12);
  const first = Math.floor(P.now_months / 12) + 1, last = Math.floor(P.horizon_months / 12) - 1;
  const ages = [...new Set(Array.from({ length: 5 }, (_, i) => Math.max(first, Math.min(last, target + (i - 2) * 2))))].sort((a, b) => a - b);
  // Compare adjustable budget items; fixed event payments keep their saved amounts.
  const t = table({ ...P, spend_flows: undefined }), index = Math.max(0, Math.min(t.spend.length - 1, P.target_months - P.now_months));
  const budget = t.spend[index] ?? 0;
  const amounts = amountWindow(budget, budget);
  return matrixFor(amounts, ages, budget, target, (spend, age) => ({
    ...(budget ? scaleSpend(P, spend / budget) : { ...P, items: [{ id: 'matrix-budget', label: '比较预算', monthly_cents: spend, start_age: null, end_age: null, inflation_hundredths: null, essential: true }] }), target_months: age * 12,
  }), year);
}

// ---- 崩盘路径 ----
export type SorrId = 'base' | 'shock-first' | 'shock-last';
export type SorrPath = { id: SorrId; label: string; years: number[]; path: number[]; final: number; survived: boolean; failure_age: number | null; shortfall_age: number | null };

/** Sequence risk isolates timing: both stress runs contain exactly one −30% year
 * and the same remaining returns. Move that year from the start to the end.
 * The return product is identical; different cash outcomes come from withdrawals. */
export function sorr(P: Plan, year: number): SorrPath[] | null {
  const initial = project(P, year), retirement = initial.retire_month;
  if (retirement === null || initial.assets[retirement - P.now_months] <= 0) return null;
  const span = P.horizon_months - retirement;
  if (span <= 0) return null;
  const retireOffset = retirement - P.now_months;
  const fraction = P.first_month_fraction ?? 1;
  const retireElapsed = elapsedMonths(retireOffset, fraction);
  const duration = elapsedMonths(P.horizon_months - P.now_months, fraction) - retireElapsed;
  const shockDuration = Math.min(12, duration);
  const lastStart = Math.max(0, (Math.floor(duration / 12) - 1) * 12);
  const runs: { id: SorrId; label: string; shock: number | null }[] = [
    { id: 'base', label: '所设收益持续不变', shock: null },
    { id: 'shock-first', label: '下跌发生在退休开头（年率 −30%）', shock: 0 },
    { id: 'shock-last', label: '同一次下跌移到末段（年率 −30%）', shock: lastStart },
  ];
  const offsets = Array.from({ length: Math.ceil(span / 12) }, (_, i) => i * 12);
  offsets.push(span);
  return runs.map(run => {
    const projection = project(P, year, { annualReturnAt: (offset, phase) => {
      if (phase === 'accumulation') return rate(P.r_before_hundredths);
      const baseline = rate(P.r_after_hundredths);
      if (run.shock === null) return baseline;
      const start = elapsedMonths(offset, fraction) - retireElapsed;
      const end = elapsedMonths(offset + 1, fraction) - retireElapsed;
      const interval = end - start;
      if (interval === 0) return baseline;
      // Split a calendar month at the elapsed-time boundary. This keeps the
      // shock duration identical even when the first calendar month is partial.
      const overlap = Math.max(0, Math.min(end, run.shock + shockDuration) - Math.max(start, run.shock));
      return Math.expm1((Math.log(0.7) * overlap + Math.log1p(baseline) * (interval - overlap)) / interval);
    } });
    const result = outcome(P, projection);
    return {
      id: run.id, label: run.label, years: offsets.map(offset => (retirement + offset) / 12),
      path: offsets.map(offset => Math.max(0, projection.assets[retirement - P.now_months + offset])),
      final: Math.max(0, result.at_horizon), survived: result.success,
      failure_age: result.failure_month === null ? null : Math.floor(result.failure_month / 12),
      shortfall_age: result.shortfall_month === null ? null : Math.floor(result.shortfall_month / 12),
    };
  });
}
