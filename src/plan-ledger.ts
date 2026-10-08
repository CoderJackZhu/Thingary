// 退休逐月账本（PLANNING_DESIGN §6）：纯函数，全程「今天的钱」（实际口径），不碰数据库。
// 与 plan-fire.ts 的区别：支出分桶（起止年龄、独立通胀、必需/灵活）、退休收入流、
// FIRE／传统两种计划类型、所需资金下滑曲线、逐年快照与覆盖拆分。名义值只用于展示：实际值 × (1+通胀)^年数。
import type { Pension, Spend } from './plan-fire.ts';
import { elapsedMonths } from './plan-core.ts';
import type { PlanningCore } from './plan-core.ts';

export type Mode = 'fire' | 'traditional';

/** 支出桶：金额按今天的钱每月；start 为空表示从退休当月开始，end 为空表示到规划终点；
 *  inflation 为空沿用总体通胀，否则该桶按自己的通胀率上涨（实际口径下就是相对总体通胀的实际增长）。 */
export type SpendItem = { id: string; label: string; monthly_cents: number; start_age: number | null; end_age: number | null; inflation_hundredths: number | null; essential: boolean };
/** 退休收入流（税后，每月，今天的钱）：indexed 为真随通胀上涨，否则固定名义金额（实际口径下逐年缩水）。 */
export type IncomeItem = { id: string; label: string; monthly_cents: number; start_age: number; end_age: number | null; indexed: boolean };

export type SavingPhase = { from_month: number; cents: number };

/** 持续的月度收支流（买房月供、持有成本、少付的房租等）：to_month 为空表示到规划终点。
 *  saving_flows 的 cents 是对退休前每月储蓄的增减（负数是多花）；spend_flows 的 cents 是退休后多出的月支出（正数是多花）。
 *  nominal 为真表示固定名义金额（房贷月供），按通胀折成今天的钱；否则已是今天的钱。 */
export type Flow = { source_id?: string; label: string; from_month: number; to_month: number | null; cents: number; nominal: boolean; essential: boolean; prorate_first?: boolean; timing?: 'start' | 'end' };

export type LoanSchedule = { id: string; from_offset: number; principal_cents: number; rate_hundredths: number; months: number; payment_cents: number; existing?: boolean };
export type Plan = {
  input_mode?: 'basic' | 'legacy';
  anchor_date?: string; calculation_date?: string; monetary_basis_date?: string; basis_factor?: number; first_month_fraction?: number;
  core?: PlanningCore | null;
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
  /** 国家养老金：在某个辞职年龄（月）下的月养老金与一次性解锁额，由养老金计算器给出。 */
  pension_at: (ageMonths: number) => Pension;
  spends: Spend[];
  /** 退休后每月已经在付的房租（今天的钱，分）；买房事件在购买月起把它取消，不超过这个数。 */
  rent_cents?: number;
};

const rate = (h: number) => h / 10000;
const monthlyGrowth = (h: number) => (1 + rate(h)) ** (1 / 12);

/** 到某月龄的名义换算系数：(1+通胀)^年数。 */
export const nominalFactor = (P: Pick<Plan, 'now_months' | 'inflation_hundredths' | 'basis_factor' | 'first_month_fraction'>, months: number) => (P.basis_factor ?? 1) * (1 + rate(P.inflation_hundredths)) ** (elapsedMonths(months - P.now_months, P.first_month_fraction) / 12);

/** 每个月的计划支出、必需支出与收入流（不含国家养老金）。退休当月起算：未写起始年龄的桶视为一直生效。 */
type Table = { spend: Float64Array; essential: Float64Array; income: Float64Array };
const tables = new WeakMap<Plan, Table>();
export function table(P: Plan): Table {
  let t = tables.get(P);
  if (t) return t;
  const n = Math.max(0, P.horizon_months - P.now_months);
  const spend = new Float64Array(n), essential = new Float64Array(n), income = new Float64Array(n);
  const infl = 1 + rate(P.inflation_hundredths);
  for (const it of P.items) {
    const real = (1 + rate(it.inflation_hundredths ?? P.inflation_hundredths)) / infl;
    const from = it.start_age === null ? 0 : Math.max(0, it.start_age * 12 - P.now_months);
    const to = it.end_age === null ? n : Math.min(n, it.end_age * 12 - P.now_months);
    for (let i = from; i < to; i++) { const a = it.monthly_cents * real ** (elapsedMonths(i, P.first_month_fraction) / 12); spend[i] += a; if (it.essential) essential[i] += a; }
  }
  for (const f of P.spend_flows ?? []) {
    const from = Math.max(0, f.from_month - P.now_months), to = f.to_month === null ? n : Math.min(n, f.to_month - P.now_months);
    for (let i = from; i < to; i++) { const a = f.nominal ? f.cents / nominalFactor(P, P.now_months + i) : f.cents; spend[i] += a; if (f.essential) essential[i] += a; }
  }
  for (const it of P.incomes) {
    const from = Math.max(0, it.start_age * 12 - P.now_months);
    const to = it.end_age === null ? n : Math.min(n, it.end_age * 12 - P.now_months);
    for (let i = from; i < to; i++) income[i] += it.indexed ? it.monthly_cents : it.monthly_cents / nominalFactor(P, P.now_months + i);
  }
  if (n && P.first_month_fraction !== undefined) {
    // Regular income/budget uses remaining days; known monthly flows remain due once.
    const f = P.first_month_fraction;
    for (const it of P.items) if (it.start_age === null || it.start_age * 12 <= P.now_months) { spend[0] -= it.monthly_cents * (1 - f); if (it.essential) essential[0] -= it.monthly_cents * (1 - f); }
    for (const flow of P.spend_flows ?? []) if (flow.prorate_first && flow.from_month <= P.now_months && (flow.to_month === null || flow.to_month > P.now_months)) {
      const amount = flow.nominal ? flow.cents / nominalFactor(P, P.now_months) : flow.cents;
      spend[0] -= amount * (1 - f); if (flow.essential) essential[0] -= amount * (1 - f);
    }
    income[0] *= f;
    if (f === 0) { spend[0] = 0; essential[0] = 0; }
  }
  t = { spend, essential, income };
  tables.set(P, t);
  return t;
}

/** 每个月（距现在 t 个月）的退休前储蓄：阶段金额 × 实际增长；同一份计划只算一次。 */
const savingSeries = new WeakMap<Plan, Float64Array>();
export function savingsOf(P: Plan): Float64Array {
  let s = savingSeries.get(P);
  if (s) return s;
  const n = Math.max(0, P.horizon_months - P.now_months), g = 1 + rate(P.saving_growth_hundredths);
  s = new Float64Array(n);
  const phases = P.saving_phases && P.saving_phases.length ? P.saving_phases : null;
  let k = 0;
  for (let t = 0; t < n; t++) {
    let cents = P.saving_cents;
    if (phases) { while (k + 1 < phases.length && phases[k + 1].from_month <= P.now_months + t) k++; cents = phases[k].cents; }
    s[t] = cents * g ** Math.floor(t / 12);
  }
  if (n) s[0] *= P.first_month_fraction ?? 1;
  for (const f of P.saving_flows ?? []) {
    const from = Math.max(0, f.from_month - P.now_months), to = f.to_month === null ? n : Math.min(n, f.to_month - P.now_months);
    for (let t = from; t < to; t++) if (t > 0 || P.first_month_fraction !== 0) s[t] += (f.nominal ? f.cents / nominalFactor(P, P.now_months + t) : f.cents) * (t === 0 && f.prorate_first ? P.first_month_fraction ?? 1 : 1);
  }
  savingSeries.set(P, s);
  return s;
}
/** 现在这个月的储蓄金额（阶段里的第一段）。 */
export const savingNow = (P: Plan) => (P.saving_phases && P.saving_phases.length ? P.saving_phases[0].cents : P.saving_cents);
/** 所有正储蓄按比例缩放；空窗期的负数（动用存款）不缩放。 */
export const scaleSaving = (P: Plan, factor: number): Plan => ({
  ...P, saving_cents: P.saving_cents > 0 ? P.saving_cents * factor : P.saving_cents,
  saving_phases: P.saving_phases?.map(x => ({ ...x, cents: x.cents > 0 ? x.cents * factor : x.cents })),
});

/** 把退休预算分项按比例缩放，固定事件付款不变（Lean 70%、Fat 150%、压力测试 +10%）。 */
export const scaleSpend = (P: Plan, factor: number): Plan => ({ ...P, items: P.items.map(it => ({ ...it, monthly_cents: it.monthly_cents * factor })) });

/** 大额一次性支出按「距现在的月数」汇总，下标 0..月数；同一份计划只算一次，所需资金、逐月推演与市场路径共用。 */
const oneOffSeries = new WeakMap<Plan, Float64Array>();
export function oneOffsOf(P: Plan): Float64Array {
  let s = oneOffSeries.get(P);
  if (!s) {
    s = new Float64Array(Math.max(0, P.horizon_months - P.now_months) + 1);
    for (const e of P.spends) if (e.offset_months >= 0 && e.offset_months < s.length) s[e.offset_months] += e.cents;
    oneOffSeries.set(P, s);
  }
  return s;
}

/** Known plan payments happen before any month-end contribution or income.
 * Saving/spending totals already contain these amounts; use them only to order the same flows. */
type PaymentPhase = 'accumulation' | 'retired';
const startPaymentCache = new WeakMap<Plan, Partial<Record<PaymentPhase, Float64Array>>>();
export function startPaymentsOf(P: Plan, phase: PaymentPhase = 'accumulation'): Float64Array {
  const cached = startPaymentCache.get(P) ?? {};
  if (cached[phase]) return cached[phase];
  const n = Math.max(0, P.horizon_months - P.now_months);
  const result = new Float64Array(n);
  // Basic expense scopes are independently confirmed before and after retirement.
  // Legacy plans keep their original shared ordering contract.
  const spending = P.input_mode === 'basic' && phase === 'retired';
  for (const f of (spending ? P.spend_flows : P.saving_flows) ?? []) if (f.timing === 'start' && (spending ? f.cents > 0 : f.cents < 0)) {
    const from = Math.max(0, f.from_month - P.now_months), to = f.to_month === null ? n : Math.min(n, f.to_month - P.now_months);
    for (let t = from; t < to; t++) if (t > 0 || P.first_month_fraction !== 0) {
      const amount = f.nominal ? f.cents / nominalFactor(P, P.now_months + t) : f.cents;
      result[t] += (spending ? amount : -amount) * (t === 0 && f.prorate_first ? P.first_month_fraction ?? 1 : 1);
    }
  }
  cached[phase] = result;
  startPaymentCache.set(P, cached);
  return result;
}

/** 退休后过一个月（逐月推演与市场路径共用）：资产为负是没付上的欠款，不增值、不清零，先用解锁额与收入偿还；
 *  返回新资产、从组合提取的钱与没有资金支持的部分。 */
export function retiredMonth(a: number, g: number, lump: number, spend: number, income: number): { a: number; withdrawal: number; gap: number } {
  const avail = a >= 0 ? a * g + lump : a + lump;
  const need = Math.max(0, spend - income), w = Math.min(Math.max(0, avail), need);
  return { a: avail - w + Math.max(0, income - spend), withdrawal: w, gap: need - w };
}
/** 退休后这个月是否资金耗尽：资产为负（欠款），或资产用完仍有缺口。 */
export const brokeAfter = (a: number, gap: number) => a < 0 || (a <= 0 && gap > 0);

/** 在 from（月龄）开始动用资产所需的最低资产：退休后实际收益率折现，且此后任何一个月资产都不能为负。
 *  retire 决定国家养老金按哪个辞职年龄计算（默认就是 from）；pension 可直接指定（退休后下滑曲线用）。 */
export function required(P: Plan, from: number, retire: number = from, pension?: Pension): number {
  const n = P.horizon_months - from;
  if (n <= 0) return 0;
  const T = table(P), pen = pension ?? P.pension_at(retire), out = oneOffsOf(P), due = startPaymentsOf(P, 'retired');
  const base = from-P.now_months;
  const unlock = P.input_mode === 'basic' ? Math.max(P.now_months, pen.unlock_age_months) : pen.unlock_age_months;
  let need = 0;
  for (let k=n-1;k>=0;k--) {
    const i=base+k,m=from+k;
    const upfront=due[i] ?? 0, fraction=i===0 ? P.first_month_fraction ?? 1 : 1;
    const income=T.income[i]+(m>=pen.unlock_age_months ? pen.monthly_cents*fraction : 0);
    const receivesPool = P.input_mode === 'basic' ? m === unlock : (k === 0 && unlock <= from) || m === unlock;
    const lump = receivesPool ? pen.lump_cents : 0;
    const g=monthlyGrowth(P.r_after_hundredths)**fraction;
    // A month begins after its one-off; known payments precede unlock and income.
    need=Math.max(upfront,upfront-lump+(need+(out[i+1] ?? 0)+T.spend[i]-upfront-income)/g,0);
  }
  return need;
}

/** 每个月龄「此刻退休」所需资产，逐月一份（蒙特卡洛与逐月推演共用，同一份计划只算一次）。 */
const requiredSeries = new WeakMap<Plan, Float64Array>();
export function requiredAt(P: Plan): Float64Array {
  let s = requiredSeries.get(P);
  if (!s) {
    const n = Math.max(0, P.horizon_months - P.now_months);
    s = new Float64Array(n);
    if (P.input_mode === 'basic') {
      // Basic pension/pool conditions are fixed independently of retirement.
      // One backwards pass checks the same cash ordering as required(), while
      // an already unlocked pool is cash and never offsets requirements again.
      const T = table(P), pen = P.pension_at(P.target_months), out = oneOffsOf(P), due = startPaymentsOf(P, 'retired');
      const unlock = Math.max(P.now_months, pen.unlock_age_months);
      let next = 0;
      for (let t = n - 1; t >= 0; t--) {
        const m = P.now_months + t, fraction = t === 0 ? P.first_month_fraction ?? 1 : 1, upfront = due[t];
        const income = T.income[t] + (m >= pen.unlock_age_months ? pen.monthly_cents * fraction : 0);
        const rest = (next + out[t + 1] + T.spend[t] - upfront - income) / monthlyGrowth(P.r_after_hundredths) ** fraction;
        const lump = m === unlock ? pen.lump_cents : 0;
        next = Math.max(upfront, upfront - lump + rest, 0);
        s[t] = next;
      }
    } else for (let t = 0; t < n; t++) s[t] = required(P, P.now_months + t);
    requiredSeries.set(P, s);
  }
  return s;
}

export type Row = {
  k: number;
  /** 行首月龄、整岁标签、日历年份。 */
  start_month: number; age: number; year: number;
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

const rowYear = (todayYear: number, k: number) => todayYear + k;

/** Optional observation of the same ledger, before next month's one-off payments. */
export type MonthAudit = { month: number; start_cents: number; after_payments_cents: number; after_unlock_cents: number; end_cents: number };
export type ProjectOptions = {
  onMonth?: (point: MonthAudit) => void;
  /** 退休后第 y 年（0 起）的实际年收益率；不给就用假设的退休后收益率。 */
  after?: (yearsSinceRetire: number) => number;
  /** Annual real return for the calendar interval starting at offset_months.
   * Used by market sampling; does not change obligations, FI thresholds or storage. */
  annualReturnAt?: (offset_months: number, phase: 'accumulation' | 'retired') => number;
};
/** 逐月推演。FIRE 达到目标且资金满足才退休；传统模式在目标年龄开始退休。 */
export function project(P: Plan, todayYear: number, opts: ProjectOptions = {}): Projection {
  const T = table(P), N = Math.max(0, P.horizon_months - P.now_months);
  const gb = monthlyGrowth(P.r_before_hundredths), ga = monthlyGrowth(P.r_after_hundredths);
  const oneOff = oneOffsOf(P);
  const assets = new Float64Array(N + 1), withdrawn = new Float64Array(N), unfunded = new Float64Array(N);
  let a = P.assets_cents - oneOff[0];
  let fi: number | null = null, retire: number | null = null, reason: Projection['reason'] = null, funded = false, pension: Pension | null = null;
  let failure: number | null = a < 0 ? P.now_months : null, shortfall: number | null = null, unlocked = false;
  const basicPension = P.input_mode === 'basic' ? P.pension_at(P.target_months) : null;
  const rows: Row[] = [];
  let row: Row | null = null;
  const cap = Math.min(P.search_cap_months, P.horizon_months), reqArr = requiredAt(P), savings = savingsOf(P), due = startPaymentsOf(P), retiredDue = startPaymentsOf(P, 'retired');
  for (let t = 0; t < N; t++) {
    const m = P.now_months + t;
    if (t % 12 === 0) {
      row = { k: t / 12, start_month: m, age: Math.floor(P.now_months / 12) + t / 12, year: rowYear(todayYear, t / 12), phase: retire === null ? 'accumulation' : 'retired', start: a + (t === 0 ? oneOff[0] : 0), end: a, contribution: 0, income: 0, unlock: 0, spend: 0, essential: 0, oneoff: 0, withdrawal: 0, unfunded: 0, essential_unfunded: 0 };
      rows.push(row);
    }
    const r = row!;
    if (t === 0) r.oneoff += oneOff[0];
    if (retire === null) {
      const req = reqArr[t];
      const ok = a >= req;
      if (fi === null && m <= cap && ok) fi = m;
      if (P.mode === 'fire' ? m >= P.target_months && ok : m >= P.target_months) {
        retire = m; reason = ok ? 'funded' : 'target_forced'; funded = ok; pension = P.pension_at(m);
        r.phase = 'retired';
      }
    }
    assets[t] = a;
    const monthStart = a;
    const upfront = retire === null ? due[t] : retiredDue[t], paidUpfront = Math.min(Math.max(0,a),upfront);
    a-=upfront;
    const afterPayments = a;
    if (failure===null && a<0) failure=m;
    // Basic pools unlock at their confirmed date; legacy pools keep the retirement trigger.
    // Known month-start payments precede unlock, and each pool enters cash only once.
    const pool = basicPension ?? pension;
    if (!unlocked && pool && pool.unlock_age_months <= m && (basicPension !== null || retire !== null)) { unlocked = true; a += pool.lump_cents; r.unlock += pool.lump_cents; }
    const afterUnlock = a;
    if (retire === null) {
      const c = savings[t];
      // 现金不足照实保留，不因月底投入或后续月份恢复而抹去已发生的缺口。
      const growth = opts.annualReturnAt ? (1 + opts.annualReturnAt(t, 'accumulation')) ** (1 / 12) : gb;
      a = (a > 0 ? a * growth ** (t === 0 ? P.first_month_fraction ?? 1 : 1) : a) + c + upfront;
      if (failure === null && a < 0) failure = m;
      r.contribution += c;
    } else {
      const spend = T.spend[t], essential = T.essential[t];
      const income = T.income[t] + (m >= pension!.unlock_age_months ? pension!.monthly_cents * (t === 0 ? P.first_month_fraction ?? 1 : 1) : 0);
      const annual = opts.annualReturnAt?.(t, 'retired') ?? opts.after?.(Math.floor((m - retire) / 12));
      const g = (annual === undefined ? ga : (1 + annual) ** (1 / 12)) ** (t === 0 ? P.first_month_fraction ?? 1 : 1);
      const step = retiredMonth(a, g, 0, Math.max(0,spend-upfront), income), w = step.withdrawal, gap = step.gap;
      a = step.a;
      r.income += income; r.spend += spend; r.essential += essential; r.withdrawal += w + paidUpfront; r.unfunded += gap;
      withdrawn[t] = w + paidUpfront; unfunded[t] = gap;
      const essentialGap = Math.max(0, essential - income) - w - paidUpfront;
      if (essentialGap > 0) { r.essential_unfunded += essentialGap; if (shortfall === null && essentialGap > Math.max(100, spend * 0.001)) shortfall = m; }
      if (failure === null && brokeAfter(a, gap)) failure = m;
    }
    opts.onMonth?.({ month: m, start_cents: monthStart, after_payments_cents: afterPayments, after_unlock_cents: afterUnlock, end_cents: a });
    const out = oneOff[t + 1];
    a -= out;
    if (failure === null && a < 0) failure = m + 1;
    r.oneoff += out;
    r.end = a;
  }
  assets[N] = a;
  // 最后一个月的大额支出付不起：没有下个月可以检出，这里补记。
  if (retire !== null && failure === null && a < 0) failure = P.horizon_months;
  return { rows, assets, debt: debtSeries(P), withdrawn, unfunded, fi_month: fi, retire_month: retire, reason, funded_at_retire: funded, pension, failure_month: failure, shortfall_month: shortfall };
}

/** 到目标年龄的结论：用于判词、压力测试与矩阵。 */
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

export function outcome(P: Plan, proj: Projection): Outcome {
  const gi = Math.min(Math.max(0, P.target_months - P.now_months), proj.assets.length - 1);
  const assetsAt = proj.assets[gi], req = required(P, Math.max(P.target_months, P.now_months));
  const horizon = proj.assets[proj.assets.length - 1];
  const funded = assetsAt >= req;
  const reached = P.mode === 'traditional' || proj.fi_month !== null;
  return { fi_month: proj.fi_month, retire_month: proj.retire_month, assets_at_goal: assetsAt, required_at_goal: req, funded_at_goal: funded, shortfall_at_goal: Math.max(0, req - assetsAt), at_horizon: horizon, failure_month: proj.failure_month, shortfall_month: proj.shortfall_month, success: proj.shortfall_month === null && proj.failure_month === null && reached && proj.retire_month !== null };
}

/** 所需资金下滑曲线：行首每个月龄「至少要有多少」。目标年龄之前折算剩余储蓄（仍能在目标年龄达标），之后是此刻退休所需；
 *  已经退休则是按已定养老金继续支撑到终点所需。 */
export function glide(P: Plan, proj: Projection): number[] {
  const G = P.target_months, R = proj.retire_month;
  const atGoal = required(P, Math.max(G, P.now_months));
  const sv = savingsOf(P);
  return proj.rows.map(row => {
    const m = row.start_month;
    if (R !== null && m >= R) {
      // 解锁额到账后已经在资产里，不能再当作未来收入重复计入。
      const pen = proj.pension!, owed = pen.unlock_age_months > m || (m === R && pen.unlock_age_months === m);
      return required(P, m, R, owed ? pen : { ...pen, lump_cents: 0 });
    }
    if (m >= G) return required(P, m);
    return accumulationNeed(P, m, G, atGoal, sv);
  });
}

/** Coast：在 month 月龄手里至少有多少，从此一分不存也能在目标年龄达标。 */
function accumulationNeed(P: Plan, from: number, goal: number, atGoal: number, saving: Float64Array): number {
  const due = startPaymentsOf(P), out = oneOffsOf(P);
  const pool = P.input_mode === 'basic' ? P.pension_at(P.target_months) : null;
  let need = atGoal;
  for (let m = goal - 1; m >= from; m--) {
    const t = m - P.now_months, upfront = due[t] ?? 0;
    const g = monthlyGrowth(P.r_before_hundredths) ** (t === 0 ? P.first_month_fraction ?? 1 : 1);
    const lump = pool && m === Math.max(P.now_months, pool.unlock_age_months) ? pool.lump_cents : 0;
    need = Math.max(upfront, upfront - lump + (need + (out[t + 1] ?? 0) - (saving[t] ?? 0) - upfront) / g, 0);
  }
  return need;
}
export const coastAt = (P: Plan, month: number) => accumulationNeed(P, month, Math.max(P.target_months, P.now_months), required(P, Math.max(P.target_months, P.now_months)), savingsOf({ ...P, saving_cents: 0, saving_phases: undefined }));
/** Coast FIRE：现在手里至少有多少。 */
export const coastAmount = (P: Plan) => coastAt(P, P.now_months);

/** 某月龄的资金支持拆分（每月，今天的钱）：支出、各收入流、养老金、投资组合提取与无资金部分。 */
export type Coverage = { spend: number; essential: number; items: { id: string; label: string; monthly: number; active: boolean }[]; pension: number; withdrawal: number; unfunded: number };
export function coverageAt(P: Plan, proj: Projection, month: number): Coverage {
  const T = table(P), i = Math.min(Math.max(0, month - P.now_months), Math.max(0, T.spend.length - 1));
  const items = P.incomes.map(s => {
    const active = month >= s.start_age * 12 && (s.end_age === null || month < s.end_age * 12);
    return { id: s.id, label: s.label, monthly: active ? (s.indexed ? s.monthly_cents : s.monthly_cents / nominalFactor(P, P.now_months + i)) : 0, active };
  });
  const retired = proj.retire_month !== null && month >= proj.retire_month;
  const pension = retired && month >= proj.pension!.unlock_age_months ? proj.pension!.monthly_cents : 0;
  const spend = T.spend[i] ?? 0, essential = T.essential[i] ?? 0;
  const retiredNow = retired && i < proj.withdrawn.length;
  const withdrawal = retiredNow ? proj.withdrawn[i] : 0, unfunded = retiredNow ? proj.unfunded[i] : 0;
  return { spend, essential, items, pension, withdrawal, unfunded };
}

/** 按平均空窗比例折算有收入阶段的储蓄：(1−g)·储蓄 − g·空窗时的月支出；已经为负的阶段（本身就是空窗）不动。 */
export const expectedSaving = (cents: number, gapHundredths: number, livingCents: number) => {
  if (cents <= 0 || gapHundredths <= 0) return cents;
  const g = gapHundredths / 10000;
  return Math.round((1 - g) * cents - g * livingCents);
};

/** Nominal remaining principal. Cash payments are already the corresponding source flows. */
export function debtSeries(P: Plan): Float64Array {
  const n = Math.max(0, P.horizon_months - P.now_months), out = new Float64Array(n + 1);
  for (const loan of P.loans ?? []) {
    let principal = loan.principal_cents, paid = 0;
    for (let t = loan.existing ? 0 : Math.max(0, loan.from_offset); t <= n; t++) {
      out[t] += principal;
      if (t < n && t >= loan.from_offset && paid < loan.months && (t > 0 || P.first_month_fraction !== 0)) {
        principal = Math.max(0, principal * (1 + loan.rate_hundredths / 120000) - loan.payment_cents);
        paid++;
      }
    }
  }
  return out;
}
