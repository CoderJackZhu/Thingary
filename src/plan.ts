// 规划模块第一阶段（PLANNING_DESIGN §3–§4）：月度收入与盘点区间储蓄。
// 事实由 Rust 只读命令 plan_review 计算；这里的 computeReview 只给浏览器预览用，
// 规则与 plan_savings.rs 一致，并由 tests/plan.test.mjs 用同一组数值核对。
import type { Line } from './expenses.ts';
import type { Point } from './wealth.ts';

export type IncomeFields = { date: string; net_cents: string; hpf_cents: string; notes: string };
export type Income = { id: string; fields: IncomeFields; revision: number };
export type IncomeList = { generation: string; rows: Income[] };
export type IncomeSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: IncomeFields };

export type IntervalStatus = 'ok' | 'scope_changed' | 'no_income';
export type Interval = {
  snapshot_id: string; from: string; to: string; days: number; status: IntervalStatus;
  income_cents: string; hpf_cents: string; income_records: number;
  delta_nw_cents: string | null; saving_cents: string | null; spend_cents: string | null;
  monthly_saving_cents: string | null; monthly_spend_cents: string | null; rate_hundredths: number | null;
  income_possibly_missing: boolean; excluded: boolean; in_window: boolean; anomaly: boolean;
};
export type Stats = {
  count: number; low_sample: boolean;
  median_monthly_saving_cents: string | null; mean_monthly_saving_cents: string | null; median_monthly_spend_cents: string | null;
  window_from: string | null; latest_date: string | null;
};
export type PlanReview = { generation: string; intervals: Interval[]; stats: Stats; incomplete_count: number };
/** 与重要支出页同一行结构：区间内带日期与金额的购入、支出、周期付款等。 */
export type ReasonLine = Line;
export type Reasons = { generation: string; snapshot_id: string; from: string; to: string; notes: string; lines: ReasonLine[] };
export type Mark = { request_id: string; generation: string; snapshot_id: string; excluded: boolean };

export const statusText: Record<IntervalStatus, string> = { ok: '', scope_changed: '账户范围变化，暂不可比', no_income: '收入未记录' };
export const reasonSourceLabel: Record<string, string> = {
  purchase: '物品购入', maintenance: '维护', expense: '重要支出', linked: '已并入物品', refund: '退款', sale: '售出回收', payment: '周期付款', virtual: '虚拟资产', topup: '充值',
};
/** 退款与售出是回流，不是支出。 */
export const reasonIsInflow = (l: ReasonLine) => l.source === 'refund' || l.source === 'sale';

/** 万分比转百分数文字，例如 4750 → 47.5%。 */
export function rateText(hundredths: number | null): string {
  if (hundredths === null) return '—';
  const sign = hundredths < 0 ? '−' : '';
  const n = Math.abs(hundredths);
  const whole = Math.floor(n / 100), frac = n % 100;
  return sign + whole + (frac ? '.' + String(frac).padStart(2, '0').replace(/0$/, '') : '') + '%';
}

/** 复盘「变化」一句话：本区间月储蓄与常态中位数比较。常态为空或不为正时不按比例说。 */
export function changeSentence(interval: Interval, stats: Stats): string {
  if (interval.status !== 'ok' || interval.monthly_saving_cents === null) return '';
  if (interval.excluded) return '这一期已标记为一次性变动，不计入常态储蓄。';
  const usual = stats.median_monthly_saving_cents;
  if (usual === null) return '';
  const m = BigInt(interval.monthly_saving_cents), u = BigInt(usual);
  if (u <= 0n) return '常态月储蓄不为正，无法按比例比较。';
  const percent = Number(((m - u) * 10000n) / u) / 100;
  const rounded = Math.round(Math.abs(percent));
  if (rounded < 5) return '本期储蓄与常态基本持平。';
  return `本期储蓄比常态${percent < 0 ? '少' : '多'} ${rounded}%。`;
}

// ---- 以下仅供浏览器预览：与 plan_savings.rs::compute 同一规则，整数运算 ----

const MONTH_NUM = 487n, MONTH_DEN = 16n;
const roundDiv = (n: bigint, d: bigint): bigint => {
  const q = n / d, r = n % d;
  const sign = (n < 0n ? -1n : 1n) * (d < 0n ? -1n : 1n);
  return 2n * (r < 0n ? -r : r) >= (d < 0n ? -d : d) ? q + sign : q;
};
const monthly = (amount: bigint, days: number) => roundDiv(amount * MONTH_NUM, MONTH_DEN * BigInt(days));
const median = (values: bigint[]): bigint | null => {
  const v = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : roundDiv(v[v.length / 2 - 1] + v[v.length / 2], 2n);
};
const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
/** 与 chrono 的 checked_sub_months(12) 相同：同月同日，二月底顺延到月末。 */
export function yearBefore(d: string): string {
  const y = +d.slice(0, 4) - 1, m = +d.slice(5, 7), day = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function computeReview(points: Point[], incomes: Income[], marks: Set<string>, generation: string): PlanReview {
  const latest = [...points].reverse().find(p => p.complete)?.date ?? null;
  const cutoff = latest ? yearBefore(latest) : null;
  const intervals: Interval[] = [];
  for (const p of points) {
    if (!p.complete || !p.compared_to) continue;
    const from = p.compared_to, days = dayNumber(p.date) - dayNumber(from);
    const rows = incomes.filter(i => i.fields.date > from && i.fields.date <= p.date);
    const income = rows.reduce((s, i) => s + BigInt(i.fields.net_cents), 0n);
    const hpf = rows.reduce((s, i) => s + BigInt(i.fields.hpf_cents), 0n);
    const iv: Interval = {
      snapshot_id: p.snapshot_id, from, to: p.date, days, status: 'ok',
      income_cents: income.toString(), hpf_cents: hpf.toString(), income_records: rows.length,
      delta_nw_cents: null, saving_cents: null, spend_cents: null, monthly_saving_cents: null, monthly_spend_cents: null, rate_hundredths: null,
      income_possibly_missing: BigInt(rows.length) < (BigInt(days) * MONTH_DEN) / MONTH_NUM,
      excluded: marks.has(p.snapshot_id), in_window: cutoff !== null && p.date > cutoff, anomaly: false,
    };
    if (p.scope_changed) iv.status = 'scope_changed';
    else if (!rows.length) iv.status = 'no_income';
    else {
      const delta = BigInt(p.change_cents ?? '0'), saving = delta - hpf, spend = income + hpf - delta;
      iv.delta_nw_cents = delta.toString(); iv.saving_cents = saving.toString(); iv.spend_cents = spend.toString();
      iv.monthly_saving_cents = monthly(saving, days).toString(); iv.monthly_spend_cents = monthly(spend, days).toString();
      if (income > 0n) iv.rate_hundredths = Number(roundDiv(saving * 10000n, income));
    }
    intervals.push(iv);
  }
  const usual = intervals.filter(i => i.status === 'ok' && !i.excluded && i.in_window);
  const stats: Stats = { count: usual.length, low_sample: usual.length < 3, median_monthly_saving_cents: null, mean_monthly_saving_cents: null, median_monthly_spend_cents: null, window_from: cutoff, latest_date: latest };
  const savings = usual.map(i => BigInt(i.monthly_saving_cents!));
  const m = median(savings);
  if (m !== null) {
    const totalSaving = usual.reduce((s, i) => s + BigInt(i.saving_cents!), 0n);
    const totalIncome = usual.reduce((s, i) => s + BigInt(i.income_cents), 0n);
    const totalDays = BigInt(usual.reduce((s, i) => s + i.days, 0));
    stats.median_monthly_saving_cents = m.toString();
    stats.mean_monthly_saving_cents = roundDiv(totalSaving * MONTH_NUM, MONTH_DEN * totalDays).toString();
    stats.median_monthly_spend_cents = median(usual.map(i => BigInt(i.monthly_spend_cents!)))!.toString();
    if (usual.length >= 3) {
      const incomeMonth = roundDiv(totalIncome * MONTH_NUM, MONTH_DEN * totalDays);
      const abs = (v: bigint) => (v < 0n ? -v : v);
      const scale = abs(m) > incomeMonth / 10n ? abs(m) : incomeMonth / 10n;
      usual.forEach((i, k) => { i.anomaly = abs(savings[k] - m) > 3n * scale; });
    }
  }
  return { generation, intervals, stats, incomplete_count: points.filter(p => !p.complete).length };
}
