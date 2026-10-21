// 规划模块第一阶段：月度收入与盘点区间储蓄。
// 事实由 Rust 只读命令 plan_review 计算；这里的 computeReview 只给浏览器预览用，
// 规则与 plan_savings.rs 一致，并由 tests/plan.test.mjs 用同一组数值核对。
import { isInvestmentIncome } from './income-classification.ts';
import type { Line } from './expenses.ts';
import type { Point } from './wealth.ts';
import type { BasicInputs } from './plan-basic-contract.ts';
export type * from './plan-basic-contract.ts';
import type { PlanningCore } from './plan-core.ts';

export type IncomeCategory = 'unclassified' | 'non_investment' | 'interest' | 'cash_dividend' | 'other_investment';
export type IncomeFields = { date: string; net_cents: string; hpf_cents: string | null; notes: string; category?: IncomeCategory; source_account_id?: string | null; destination?: 'retained' | 'transferred' | 'unknown' | null; receiving_account_id?: string | null };
export type Income = { id: string; fields: IncomeFields; revision: number; classification_changed?: boolean };
export type IncomeList = { generation: string; rows: Income[] };
export type IncomeSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: IncomeFields };

export type IntervalStatus = 'ok' | 'scope_changed' | 'no_income';
export type Interval = {
  snapshot_id: string; from: string; to: string; days: number; status: IntervalStatus;
  income_cents: string; hpf_cents: string | null; hpf_known_cents?: string | null; hpf_unknown_records?: number; income_records: number;
  /** 公积金账户余额的变化与推算提取额（缴存 − 余额变化，利息算负数）；没有计入的公积金账户时为 null。 */
  hpf_change_cents: string | null; hpf_out_cents: string | null;
  /** 投资类账户（投资、混合、基金、债券）的余额变化：转入的钱与涨跌混在一起；没有计入此类账户时为 null。 */
  market_change_cents?: string | null;
  delta_nw_cents: string | null; saving_cents: string | null; spend_cents: string | null;
  monthly_saving_cents: string | null; monthly_spend_cents: string | null; rate_hundredths: number | null;
  /** 只含现金、存款与负债：不含投资类账户的变化。转进投资的钱在这里像花销，涨跌不会像储蓄。 */
  monthly_cash_saving_cents?: string | null; monthly_cash_spend_cents?: string | null;
  legacy_estimate_unavailable?: boolean; income_possibly_missing: boolean; excluded: boolean; in_window: boolean; anomaly: boolean;
};
export type Stats = {
  count: number; spend_count?: number; low_sample: boolean;
  median_monthly_saving_cents: string | null; mean_monthly_saving_cents: string | null; median_monthly_spend_cents: string | null;
  change_count?: number;
  median_monthly_change_cents?: string | null; mean_monthly_change_cents?: string | null;
  median_monthly_cash_saving_cents?: string | null; median_monthly_cash_spend_cents?: string | null; median_monthly_market_change_cents?: string | null;
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
export const monthly = (amount: bigint, days: number) => roundDiv(amount * MONTH_NUM, MONTH_DEN * BigInt(days));
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

/** 估计存下与推算花销的区间合计：去掉投资类账户变化（转入与涨跌），与 monthly_cash_* 同一算式。未知保持 null。 */
export function cashTotals(i: Pick<Interval, 'saving_cents' | 'spend_cents' | 'market_change_cents'>): { saving: string | null; spend: string | null } {
  const dm = BigInt(i.market_change_cents ?? '0');
  return { saving: i.saving_cents == null ? null : (BigInt(i.saving_cents) - dm).toString(), spend: i.spend_cents == null ? null : (BigInt(i.spend_cents) + dm).toString() };
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
    const depositRows = rows.filter(i => !isInvestmentIncome(i.fields) || i.fields.hpf_cents !== null);
    const knownRows = depositRows.filter(i => i.fields.hpf_cents !== null);
    const known = knownRows.reduce((s, i) => s + BigInt(i.fields.hpf_cents!), 0n);
    const unknown = depositRows.length - knownRows.length, hpf = unknown ? null : known;
    const iv: Interval = {
      snapshot_id: p.snapshot_id, from, to: p.date, days, status: 'ok',
      income_cents: income.toString(), hpf_cents: hpf?.toString() ?? null, hpf_known_cents: knownRows.length ? known.toString() : null, hpf_unknown_records: unknown, income_records: rows.length, hpf_change_cents: null, hpf_out_cents: null,
      delta_nw_cents: null, saving_cents: null, spend_cents: null, monthly_saving_cents: null, monthly_spend_cents: null, rate_hundredths: null,
      income_possibly_missing: true, // No persisted coverage declaration yet; row count is not coverage.
      excluded: marks.has(p.snapshot_id), in_window: cutoff !== null && p.date > cutoff, anomaly: false,
    };
    if (p.scope_changed) iv.status = 'scope_changed';
    else if (!rows.length) iv.status = 'no_income';
    else {
      if (p.change_cents == null) throw new Error('资料格式不兼容或损坏');
      const delta = BigInt(p.change_cents), dh = p.hpf_change_cents === null ? null : BigInt(p.hpf_change_cents);
      // 公积金账户有计入时只扣它的余额变化（提取进现金的算现金）；没有时缴存从未进过净资产，不扣。
      const saving = dh === null ? delta : delta - dh, spend = dh === null ? income - delta : hpf === null ? null : income + hpf - delta, out = dh === null || hpf === null ? null : hpf - dh;
      iv.delta_nw_cents = delta.toString(); iv.saving_cents = saving.toString(); iv.spend_cents = spend?.toString() ?? null;
      iv.hpf_change_cents = dh === null ? null : dh.toString(); iv.hpf_out_cents = out === null ? null : out.toString();
      iv.monthly_saving_cents = monthly(saving, days).toString(); iv.monthly_spend_cents = spend === null ? null : monthly(spend, days).toString();
      iv.market_change_cents = p.market_change_cents ?? null;
      const cash = cashTotals(iv);
      iv.monthly_cash_saving_cents = monthly(BigInt(cash.saving!), days).toString(); iv.monthly_cash_spend_cents = cash.spend === null ? null : monthly(BigInt(cash.spend), days).toString();
      const base = income + (out !== null && out > 0n ? out : 0n);
      if (base > 0n && (dh === null || out !== null)) iv.rate_hundredths = Number(roundDiv(saving * 10000n, base));
    }
    if (!p.scope_changed) { iv.delta_nw_cents = p.change_cents; iv.hpf_change_cents = p.hpf_change_cents; iv.market_change_cents = p.market_change_cents ?? null; }
    iv.legacy_estimate_unavailable = rows.some(i => isInvestmentIncome(i.fields) || i.classification_changed);
    if (iv.legacy_estimate_unavailable) {
      iv.saving_cents = null; iv.spend_cents = null; iv.monthly_saving_cents = null; iv.monthly_spend_cents = null;
      iv.monthly_cash_saving_cents = null; iv.monthly_cash_spend_cents = null; iv.rate_hundredths = null;
    }
    intervals.push(iv);
  }
  const usual = intervals.filter(i => i.status === 'ok' && !i.legacy_estimate_unavailable && !i.excluded && i.in_window);
  const spendRows = usual.filter(i => i.monthly_spend_cents !== null);
  const stats: Stats = { spend_count: spendRows.length, count: usual.length, low_sample: usual.length < 3, median_monthly_saving_cents: null, mean_monthly_saving_cents: null, median_monthly_spend_cents: null, window_from: cutoff, latest_date: latest };
  const savings = usual.map(i => BigInt(i.monthly_saving_cents!));
  const m = median(savings);
  if (m !== null) {
    const totalSaving = usual.reduce((s, i) => s + BigInt(i.saving_cents!), 0n);
    const totalIncome = usual.reduce((s, i) => s + BigInt(i.income_cents), 0n);
    const totalDays = BigInt(usual.reduce((s, i) => s + i.days, 0));
    stats.median_monthly_saving_cents = m.toString();
    stats.mean_monthly_saving_cents = roundDiv(totalSaving * MONTH_NUM, MONTH_DEN * totalDays).toString();
    stats.median_monthly_spend_cents = median(spendRows.map(i => BigInt(i.monthly_spend_cents!)))?.toString() ?? null;
    stats.median_monthly_cash_saving_cents = median(usual.map(i => BigInt(i.monthly_cash_saving_cents!)))!.toString();
    stats.median_monthly_cash_spend_cents = median(spendRows.map(i => BigInt(i.monthly_cash_spend_cents!)))?.toString() ?? null;
    stats.median_monthly_market_change_cents = median(usual.map(i => monthly(BigInt(i.market_change_cents ?? '0'), i.days)))!.toString();
    if (usual.length >= 3) {
      const incomeMonth = roundDiv(totalIncome * MONTH_NUM, MONTH_DEN * totalDays);
      const abs = (v: bigint) => (v < 0n ? -v : v);
      const scale = abs(m) > incomeMonth / 10n ? abs(m) : incomeMonth / 10n;
      usual.forEach((i, k) => { i.anomaly = abs(savings[k] - m) > 3n * scale; });
    }
  }
  const comparable = intervals.filter(i => i.delta_nw_cents !== null && !i.excluded && i.in_window);
  stats.change_count = comparable.length;
  stats.median_monthly_change_cents = median(comparable.map(i => monthly(BigInt(i.delta_nw_cents!), i.days)))?.toString() ?? null;
  stats.mean_monthly_change_cents = comparable.length ? monthly(comparable.reduce((s, i) => s + BigInt(i.delta_nw_cents!), 0n), comparable.reduce((s, i) => s + i.days, 0)).toString() : null;
  return { generation, intervals, stats, incomplete_count: points.filter(p => !p.complete).length };
}

// ---- 第二阶段：个人资料与养老金页的纯函数 ----

/** 与 Rust plan_profile::Profile 同形：计算用的资料加地区与参数覆盖。 */
/** 退休与 FIRE 输入；缺省字段由后端补默认值。 */
/** 退休支出项与收入项（日常生活预算另存在 spend_cents）；金额是整数分字符串，每月，今天的钱。 */
export type StoredSpendItem = { id: string; label: string; monthly_cents: string; start_month: string | null; end_month: string | null; inflation_hundredths: number | null; essential: boolean; time_unconfirmed: boolean };
export type StoredLifeEvent = {
 id: string; label: string; kind: 'house' | 'car' | 'other'; date: string; included: boolean;
 price_cents: string; down_cents: string; extra_cents: string; loan_rate_hundredths: number; loan_years: number;
 holding_cents: string; rent_saved_cents: string; cycle_years: number | null; until_month: string | null; time_unconfirmed: boolean; resale_cents: string;
};
export type RetireInputs = {
 basic?: BasicInputs; setup_completed: boolean; simplified: import('./plan-simplified-contract.ts').SimplifiedPlanningFieldsV1; core?: PlanningCore | null;
 spend_cents: string | null; real_return_before_hundredths: number; real_return_after_hundredths: number; emergency_months: number;
 mode: 'fire' | 'traditional'; volatility_hundredths: number; spend_items: StoredSpendItem[]; life_events: StoredLifeEvent[]; rent_cents: string;
};
export const defaultRetire: RetireInputs = { setup_completed: false, simplified: { contract_version: 1, time: { reference: null, target_month: null, horizon_month: null }, income_mode: 'unconfirmed', future_incomes: [], household: { mode: 'single', partner: null } }, spend_cents: null, real_return_before_hundredths: 0, real_return_after_hundredths: 0, emergency_months: 6, mode: 'fire', volatility_hundredths: 500, spend_items: [], life_events: [], rent_cents: '0' };
export type StoredProfile = { assumptions: { inflation_hundredths: number }; retire: RetireInputs };
export const planningMode = (p: StoredProfile) => p.retire.basic ? 'basic' as const : 'none' as const;
export type ProfileState = { generation: string; saved: { profile: StoredProfile; revision: number; updated_at: string; reference_issues?: string[] } | null };

/** 个人资料多久没更新（整月数）；超过 STALE_MONTHS 个月提醒对一次社保记录。 */
export const STALE_MONTHS = 6;
export function staleMonths(updatedAt: string, today: string): number {
  const m = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  return Math.max(0, m(today) - m(updatedAt.slice(0, 10)));
}
export type ProfileSave = { request_id: string; generation: string; expected_revision: number | null; profile: StoredProfile };

/** 百分数输入（可带一位以上小数）转万分比整数；空或无效返回 null。 */
export function pctToHundredths(text: string): number | null {
  const t = text.trim().replace(/%$/, '');
  if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const hundredthsToPct = (v: number): string => String(v / 100);

/** 新增收入时默认带上的公积金缴存：取日期最近的一条（同一天取先出现的）；没有记录返回空串。 */
export function latestHpf(rows: { fields: { date: string; hpf_cents: string | null; category?: IncomeCategory } }[]): string {
  let any: { date: string; hpf_cents: string | null } | null = null;
  for (const r of rows) {
    if (isInvestmentIncome(r.fields)) continue;
    if (!any || r.fields.date > any.date) any = r.fields;
  }
  return any?.hpf_cents ?? '';
}

/** 年龄（月）显示为「63 岁 1 个月」。 */
export const ageText = (months: number) => `${Math.floor(months / 12)} 岁${months % 12 ? ` ${months % 12} 个月` : ''}`;

/** 区间里的大额一次性支出：物品购入与重要支出，单笔不低于阈值（分）。只用来解释，不改变储蓄统计。 */
export function largeOneOffs(lines: ReasonLine[], thresholdCents: number): { count: number; total: bigint } {
  let count = 0, total = 0n;
  for (const l of lines) if ((l.source === 'purchase' || l.source === 'expense') && l.amount_cents !== null && BigInt(l.amount_cents) >= BigInt(thresholdCents)) { count++; total += BigInt(l.amount_cents); }
  return { count, total };
}
/** 剔除这些大额之后，这一期折合的每月储蓄（分）；这一期不可比时为 null。 */
export function monthlyWithoutOneOffs(interval: Interval, oneOffs: bigint): bigint | null {
  if (interval.status !== 'ok' || interval.saving_cents === null || interval.days <= 0) return null;
  return monthly(BigInt(interval.saving_cents) + oneOffs, interval.days);
}

/** Full deposit sum and its completeness share one display rule across review and income list. */
export function hpfSummary(total: string | null, known: string | null, unknown: number, money: (v: string | null) => string): string {
  return unknown ? `未知／不完整（已知 ${known === null ? '金额未知' : money(known)}，另有 ${unknown} 条未知）` : money(total);
}

export function incomeHpfTotals(rows: Pick<Income, 'fields'>[]): { total: string | null; known: string | null; unknown: number } {
  const depositRows = rows.filter(r => !isInvestmentIncome(r.fields) || r.fields.hpf_cents !== null);
  const known = depositRows.filter(r => r.fields.hpf_cents !== null), unknown = depositRows.length - known.length;
  const sum = known.reduce((s, r) => s + BigInt(r.fields.hpf_cents!), 0n).toString();
  return { total: unknown ? null : sum, known: known.length ? sum : null, unknown };
}
