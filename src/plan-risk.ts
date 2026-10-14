// Risk presentation and cancellable transport; numeric experiments live in Rust.
import type { Plan, Outcome } from './plan-ledger.ts';
import { enginePlan, engineRequest, engineRequestAsync } from './planning-engine.ts';
export type StressId = string;
export type SorrId = 'base' | 'early' | 'late';

export type Bands = { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };

export type MonteCarlo = {
  n: number;
  /** 完整预算全程无缺口（终点可以为零）（FIRE 另需达成 FI）的路径占比。 */
  success_rate: number;
  /** 至少一半路径达成 FI 时的中位数 FI 月龄，否则为 null。 */
  median_fi_month: number | null;
  /** 各取样点的年龄（岁，可带小数）与各百分位的资产；最后一个取样点是规划终点。 */
  ages: (number | null)[];
  months: number[];
  calendar_months: string[];
  bands: Bands;
  final: { p10: number; p25: number; p50: number; p75: number; p90: number };
};

export type Severity = 'low' | 'medium' | 'high';

export type StressResult = {
  id: StressId; label: string; description: string;
  baseline: Outcome; stressed: Outcome;
  /** 财务独立推迟的月数（任一边没达成则为 null）、退休缺口增加、期末剩余资金变化。 */
  fi_delay_months: number | null; shortfall_delta: number; horizon_delta: number;
  severity: Severity;
};

export type Cell = { fi_month: number | null; retire_month: number | null; funded_at_goal: boolean; shortfall_at_goal: number; at_horizon: number; failed: boolean };

export type Matrix = { column_kind?: 'month' | 'age'; column_labels?: string[]; rows: number[]; cols: number[]; cells: Cell[][]; base_row: number | null; base_col: number | null };

export type SorrPath = { id: SorrId; label: string; years: number[]; months: number[]; calendar_months: string[]; path: number[]; final: number; survived: boolean; /** Ledger month positions, on the same axis as months; use timeLabel(plan, month) for calendar display. */ failure_month: number | null; shortfall_month: number | null; failure_age: number | null; shortfall_age: number | null };

/** Common seed makes independently indexed scenarios reproducible and comparable. */
export function seedOf(_plan: Plan): number { return 0; }
type Samples = {
  months: number[]; ages: (number | null)[]; calendar_months: string[];
  paths: { index: number; assets: number[]; fi_month: number | null; success: boolean }[];
};
export async function monteCarlo(plan: Plan, n: number, opts: { seed?: number; signal?: AbortSignal; progress?: (done: number) => void } = {}): Promise<MonteCarlo> {
  opts.signal?.throwIfAborted();
  if (!Number.isInteger(n) || n < 1 || n > 20000) throw new RangeError('路径数必须是 1–20000 的整数');
  const input = enginePlan(plan);
  let samples: Samples | undefined;
  // A bounded native task can finish, but cancellation stops all further batches and publication.
  for (let start = 0; start < n; start += 40) {
    const batch = await engineRequestAsync<Samples>({ op: 'simulate_paths', plan: input,
      seed: opts.seed ?? seedOf(plan), start_index: start, paths: Math.min(40, n - start) }, opts.signal);
    if (!samples) samples = batch;
    else samples.paths.push(...batch.paths);
    opts.signal?.throwIfAborted();
    opts.progress?.(samples.paths.length);
  }
  return engineRequestAsync<MonteCarlo>({ op: 'summarize_paths', samples }, opts.signal);
}
export function stressTests(plan: Plan, year: number): StressResult[] {
  const parameters = sensitivityParameters(plan);
  const money = (cents: number) => (cents / 100).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 });
  const descriptions: Record<string, string> = {
    saving: `每月正投入参照减少 ${money(parameters.saving_reduction_cents)}；分阶段正投入按比例调整，负投入和约定付款保留。`,
    necessary: `必要生活预算每月增加 ${money(parameters.necessary_increase_cents)}，固定事件付款保留。`,
    return: `积累期和退休期的年实际收益率各降低 ${parameters.return_reduction_hundredths / 100} 个百分点。`,
    inflation: `一般通胀率提高 ${parameters.inflation_increase_hundredths / 100} 个百分点，重新换算固定名义收入与付款。`,
    timing: `目标推迟 ${parameters.target_delay_months} 个月，最多到规划终点。`,
    market: `退休起始年度的年实际收益率设为 ${(parameters.adverse_return * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%；未退休时从起点检查。`,
  };
  return engineRequest<StressResult[]>({ op: 'sensitivity', plan: enginePlan(plan), year, parameters })
    .map(result => ({ ...result, description: descriptions[result.id] ?? result.description }));
}
export function sensitivityParameters(plan: Plan): Record<string, number> {
  return engineRequest({ op: 'sensitivity_parameters', plan: enginePlan(plan) });
}
export function stressSeverity(baseline: Outcome, stressed: Outcome): Severity {
  return engineRequest({ op: 'sensitivity_severity', baseline, stressed });
}
export function largestRisk(results: StressResult[]): StressResult | null {
  const priorities: Severity[] = ['high', 'medium', 'low'];
  const candidates = results.filter(r => r.severity !== 'low' || r.shortfall_delta > 0 || (r.fi_delay_months ?? 0) > 0);
  candidates.sort((a, b) => priorities.indexOf(a.severity) - priorities.indexOf(b.severity)
    || b.shortfall_delta - a.shortfall_delta || (b.fi_delay_months ?? 0) - (a.fi_delay_months ?? 0));
  return candidates[0] ?? null;
}
export function contributionReturnMatrix(plan: Plan, year: number): Matrix {
  return engineRequest({ op: 'matrix', kind: 'contribution_return', plan: enginePlan(plan), year });
}
export function targetSpendingMatrix(plan: Plan, year: number): Matrix {
  return engineRequest({ op: 'matrix', kind: 'target_spending', plan: enginePlan(plan), year });
}
export function ageSpendingMatrix(plan: Plan, year: number): Matrix {
  const result = targetSpendingMatrix(plan, year);
  return plan.age_reference === undefined ? { ...result, column_kind: 'age', cols: result.cols.map(m => m / 12) } : result;
}
export function sorr(plan: Plan, year: number, shock = sensitivityParameters(plan).adverse_return): SorrPath[] | null {
  return engineRequest({ op: 'sequence', plan: enginePlan(plan), year, shock });
}
