// Compatibility interfaces and presentation adapters. Ledger arithmetic runs in Rust.
import type { Pension, Spend } from './plan-fire.ts';
import type { FutureIncomeV1, TimeInputV1 } from './plan-simplified-contract.ts';
import type { PlanningAnnotation } from './plan-basic-contract.ts';
import type { EventCoverage } from './plan-coverage.ts';
import type { PlanningCore } from './plan-core.ts';
import { monthTextV1, monthIndexV1 } from './plan-simplified.ts';
import { enginePlan, engineProjection, engineRequest } from './planning-engine.ts';

export type Mode = 'fire' | 'traditional';

export type SpendItem = { id: string; label: string; monthly_cents: number; start_age: number | null; end_age: number | null; inflation_hundredths: number | null; essential: boolean };

export type IncomeItem = { id: string; label: string; monthly_cents: number; start_age: number; end_age: number | null; indexed: boolean };

export type SavingPhase = { from_month: number; cents: number };

export type Flow = { source_id?: string; label: string; from_month: number; to_month: number | null; cents: number; nominal: boolean; essential: boolean; prorate_first?: boolean; timing?: 'start' | 'end' };

export type LoanSchedule = { id: string; from_offset: number; principal_cents: number; rate_hundredths: number; months: number; payment_cents: number; existing?: boolean };

export type Plan = {
  input_mode?: 'basic' | 'legacy';
  anchor_date?: string; calculation_date?: string; monetary_basis_date?: string; basis_factor?: number; first_month_fraction?: number;
  core?: PlanningCore | null;
  annotations?: PlanningAnnotation[];
  event_coverage?: Record<string, EventCoverage>;
  loans?: LoanSchedule[];
  now_months: number;
  horizon_months: number;
  /** 找 FI 年龄时的搜索上限（月龄）。 */
  search_cap_months: number;
  /** 期望退休／财务独立年龄（月龄）。 */
  target_months: number;
  mode: Mode;
  assets_cents: number;
  /** 退休前每月储蓄（今天的钱）与每年的实际增长（万分比）。 */
  saving_cents: number;
  saving_growth_hundredths: number;
  /** 储蓄分阶段：从 from_month（月龄）起每月存 cents（可为负，表示动用存款）；按 from_month 升序，第一段从现在起。缺省时全程用 saving_cents。 */
  saving_phases?: SavingPhase[];
  saving_flows?: Flow[];
  spend_flows?: Flow[];
  r_before_hundredths: number;
  r_after_hundredths: number;
  inflation_hundredths: number;
  /** 实际年收益的波动率（万分比），只用于市场路径模拟。 */
  volatility_hundredths: number;
  items: SpendItem[];
  incomes: IncomeItem[];
  future_incomes?: FutureIncomeV1[];
  transfers?: { id: string; account_id: string; month: number; cents: number; nominal_cents?: number }[];
  age_reference?: TimeInputV1['reference'];
  /** 国家养老金：在某个辞职年龄（月）下的月养老金与一次性解锁额，由养老金计算器给出。 */
  pension_at: (ageMonths: number) => Pension;
  spends: Spend[];
  /** 退休后每月已经在付的房租（今天的钱，分）；买房事件在购买月起把它取消，不超过这个数。 */
  rent_cents?: number;
};

export type Row = {
  k: number;
  /** 行首月龄、整岁标签、日历年份。 */
  start_month: number; age: number | null; year: number; calendar_month?: string;
  phase: 'accumulation' | 'retired';
  start: number; end: number;
  contribution: number;
  /** 国家养老金与收入流合计（不含一次性解锁）。 */
  income: number; unlock: number;
  spend: number; essential: number;
  /** 当年发生的大额一次性支出（心愿、买房首付、买车等）。 */
  oneoff: number;
  withdrawal: number; unfunded: number; essential_unfunded: number;
};

export type Projection = {
  rows: Row[];
  /** 逐月资产（长度 = 月数 + 1）。 */
  assets: Float64Array;
  debt: Float64Array;
  /** 逐月从投资组合提取的金额与没有资金支持的支出（长度 = 月数；退休前为 0）。 */
  withdrawn: Float64Array; unfunded: Float64Array;
  /** 资产第一次达到「此刻退休所需」的月龄；搜索上限内没有则为 null。 */
  fi_month: number | null;
  retire_month: number | null;
  reason: 'funded' | 'target_forced' | null;
  funded_at_retire: boolean;
  pension: Pension | null;
  /** 退休后第一个资金耗尽的月龄；必需支出第一次没钱付的月龄。 */
  failure_month: number | null;
  shortfall_month: number | null;
};

export type MonthAudit = { month: number; start_cents: number; after_payments_cents: number; after_unlock_cents: number; end_cents: number };

export type ProjectOptions = {
  onMonth?: (point: MonthAudit) => void;
  /** 退休后第 y 年（0 起）的实际年收益率；不给就用假设的退休后收益率。 */
  after?: (yearsSinceRetire: number) => number;
  /** Annual real return for the calendar interval starting at offset_months.
   * Used by market sampling; does not change obligations, FI thresholds or storage. */
  annualReturnAt?: (offset_months: number, phase: 'accumulation' | 'retired') => number;
};

export type Outcome = {
  fi_month: number | null;
  retire_month: number | null;
  /** 目标年龄那一刻的资产与所需（今天的钱）；退休前资产为 0 时也照实给出。 */
  assets_at_goal: number; required_at_goal: number;
  funded_at_goal: boolean; shortfall_at_goal: number;
  at_horizon: number;
  failure_month: number | null; shortfall_month: number | null;
  /** 完整预算全程无缺口（终点可以为零），FIRE 另需达成 FI。 */
  success: boolean;
};

export type CoverageItem = { id: string; label: string; monthly: number; active: boolean };
export type Coverage = { spend: number; essential: number; items: CoverageItem[]; expense_items: CoverageItem[]; flow_items: CoverageItem[]; pension: number; withdrawal: number; unfunded: number };

type Schedule = Record<'spend' | 'essential' | 'income' | 'saving' | 'oneoffs' | 'transfers' | 'start_accumulation' | 'start_retired' | 'debt', Float64Array>;
const schedules = new WeakMap<Plan, Schedule>();
function schedule(plan: Plan): Schedule {
  let cached = schedules.get(plan);
  if (!cached) {
    const raw = engineRequest<Record<keyof Schedule, number[]>>({ op: 'tables', plan: enginePlan(plan) });
    cached = Object.fromEntries(Object.entries(raw).map(([key, values]) => [key, Float64Array.from(values)])) as Schedule;
    schedules.set(plan, cached);
  }
  return cached;
}
export function table(plan: Plan): Pick<Schedule, 'spend' | 'essential' | 'income'> { return schedule(plan); }
export function savingsOf(plan: Plan): Float64Array { return schedule(plan).saving; }
export function oneOffsOf(plan: Plan): Float64Array { return schedule(plan).oneoffs; }
export function transfersOf(plan: Plan): Float64Array { return schedule(plan).transfers; }
export function debtSeries(plan: Plan): Float64Array { return schedule(plan).debt; }
export type PaymentPhase = 'accumulation' | 'retired';
export function startPaymentsOf(plan: Plan, phase: PaymentPhase = 'accumulation'): Float64Array {
  return phase === 'accumulation' ? schedule(plan).start_accumulation : schedule(plan).start_retired;
}
export const savingSeries = savingsOf;
export const oneOffSeries = oneOffsOf;
export function savingNow(plan: Plan): number { return savingsOf(plan)[0] ?? 0; }

export function nominalFactor(plan: Pick<Plan, 'now_months' | 'inflation_hundredths' | 'basis_factor' | 'first_month_fraction'>, month: number): number {
  return engineRequest<number>({ op: 'nominal_factor', month, plan: {
    ...plan, input_mode: 'basic', horizon_months: Math.max(month, plan.now_months), target_months: plan.now_months,
    search_cap_months: plan.now_months, mode: 'traditional', assets_cents: 0,
    saving_cents: 0, saving_growth_hundredths: 0, r_before_hundredths: 0,
    r_after_hundredths: 0, volatility_hundredths: 0, items: [], incomes: [], spends: [],
    pensions: [{ monthly_cents: 0, lump_cents: 0, unlock_age_months: plan.now_months }],
  }});
}
export function required(plan: Plan, from: number, retire = from, pension?: Pension): number {
  return engineRequest<number>({ op: 'required', plan: enginePlan(plan), from, retire, pension });
}
export function requiredAt(plan: Plan): Float64Array {
  return Float64Array.from(engineRequest<number[]>({ op: 'required_series', plan: enginePlan(plan) }));
}
export const requiredSeries = requiredAt;
export function project(plan: Plan, year: number, options: ProjectOptions = {}): Projection {
  const input = enginePlan(plan), n = plan.horizon_months - plan.now_months;
  const raw = engineRequest<Omit<Projection, 'assets' | 'debt' | 'withdrawn' | 'unfunded'> & {
    assets: number[]; debt: number[]; withdrawn: number[]; unfunded: number[]; audit: MonthAudit[];
  }>({ op: 'project', plan: input, year,
    returns_before: options.annualReturnAt ? Array.from({ length: n }, (_, i) => options.annualReturnAt!(i, 'accumulation')) : undefined,
    returns_after: options.annualReturnAt ? Array.from({ length: n }, (_, i) => options.annualReturnAt!(i, 'retired')) : undefined,
    retirement_returns: options.after && n ? Array.from({ length: Math.ceil(n / 12) }, (_, i) => options.after!(i)) : undefined,
  });
  for (const point of raw.audit) options.onMonth?.(point);
  return { ...raw, assets: Float64Array.from(raw.assets), debt: Float64Array.from(raw.debt),
    withdrawn: Float64Array.from(raw.withdrawn), unfunded: Float64Array.from(raw.unfunded) };
}
export function outcome(plan: Plan, projection: Projection): Outcome {
  return engineRequest<Outcome>({ op: 'outcome', plan: enginePlan(plan), projection: engineProjection(projection) });
}
export function coastAt(plan: Plan, month: number): number {
  return engineRequest<number>({ op: 'coast', plan: enginePlan(plan), from: month });
}
export function coastAmount(plan: Plan): number { return coastAt(plan, plan.now_months); }
export function glide(plan: Plan, projection: Projection): number[] {
  return engineRequest<number[]>({ op: 'glide', plan: enginePlan(plan), projection: engineProjection(projection) });
}
export function coverageAt(plan: Plan, projection: Projection, month: number): Coverage {
  return engineRequest<Coverage>({ op: 'coverage_at', plan: enginePlan(plan), projection: engineProjection(projection), month });
}
export function retiredMonth(balance: number, growth: number, lump: number, spend: number, income: number): { a: number; withdrawal: number; gap: number } {
  return engineRequest({ op: 'retirement_step', balance, growth, lump, spend, income });
}

// Scenario input edits and labels; no cash-flow simulation is performed here.
export function scaleSaving(plan: Plan, factor: number): Plan {
  if (!Number.isFinite(factor) || factor < 0) throw new RangeError('投入比例必须为非负有限数');
  const change = (value: number) => value > 0 ? value * factor : value;
  return { ...plan, saving_cents: change(plan.saving_cents), saving_phases: plan.saving_phases?.map(p => ({ ...p, cents: change(p.cents) })) };
}
export function scaleSpend(plan: Plan, factor: number): Plan {
  if (!Number.isFinite(factor) || factor < 0) throw new RangeError('预算比例必须为非负有限数');
  return { ...plan, items: plan.items.map(item => ({ ...item, monthly_cents: item.monthly_cents * factor })) };
}
export function timeLabel(plan: Plan, month: number): string {
  return plan.anchor_date ? monthTextV1(monthIndexV1(plan.anchor_date) + month - plan.now_months) : String(Math.floor(month / 12)) + ' 岁';
}
export function ageAt(plan: Plan, month: number): number | null {
  if (plan.age_reference === undefined) return month;
  if (!plan.age_reference || !plan.anchor_date) return null;
  return plan.age_reference.age_months + monthIndexV1(plan.anchor_date) + month - plan.now_months - monthIndexV1(plan.age_reference.month);
}
