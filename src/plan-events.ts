// 大额计划（买房、买车、其他）：把一件事拆成一次性现金支出（首付、杂费、换车净支出）和持续的月度收支流
// （月供、持有成本、不再付的房租），并入同一个退休账本，不另起一套计算。纯函数，按已保存的金额基准 T 计算。
import { project, savingsOf, nominalFactor } from './plan-ledger.ts';
import type { Flow, Plan, LoanSchedule } from './plan-ledger.ts';
import type { PlanningAnnotation } from './plan-basic-contract.ts';
import type { Spend } from './plan-fire.ts';

export type EventKind = 'house' | 'car' | 'other';
/** 金额一律是今天的钱（分）。house：总价、首付、贷款、每月物业维修、买房后不再付的月房租。car：总价、每月养车费、换车周期、每次卖旧车回收。 */
export type LifeEvent = {
  id: string; label: string; kind: EventKind;
  /** 计划购买月份 YYYY-MM。 */
  date: string;
  /** 计入规划；关掉就当没有这件事（仍保留，方便比较）。 */
  included: boolean;
  price_cents: number; down_cents: number; extra_cents: number;
  loan_rate_hundredths: number; loan_years: number;
  holding_cents: number; rent_saved_cents: number;
  cycle_years: number | null; until_age: number | null; resale_cents: number;
};

export const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
/** 计划月份距起点的有符号月数；逾期不移动至当月。 */
export const offsetOf = (date: string, today: string) => monthIndex(date) - monthIndex(today);

type Ctx = Pick<Plan, 'now_months' | 'horizon_months' | 'inflation_hundredths' | 'rent_cents' | 'core' | 'anchor_date' | 'basis_factor' | 'first_month_fraction' | 'event_coverage'>;
export type EventParts = { spends: Spend[]; saving_flows: Flow[]; spend_flows: Flow[]; principal_cents: number | null; payment_cents: number | null; loan_months: number | null; loans: LoanSchedule[] };

/** 等额本息月供（名义）：本金、年利率（万分比）、期数；利率为 0 时平均分。 */
export function monthlyPayment(principal: number, rateHundredths: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = rateHundredths / 10000 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months);
}

export function eventParts(c: Ctx, e: LifeEvent, offset: number): EventParts {
  const occurrence = c.core?.occurrences.find(x => x.event_id === e.id);
  const coverage = c.event_coverage?.[e.id];
  const empty: EventParts = { spends: [], saving_flows: [], spend_flows: [], principal_cents: 0, payment_cents: 0, loan_months: 0, loans: [] };
  if (coverage?.paused || occurrence?.status === 'cancelled' || (!occurrence && offset < 0)) return empty;
  const originOffset = occurrence && c.anchor_date ? offsetOf(occurrence.actual_date, c.anchor_date) : offset;
  const effectiveOffset = Math.max(0, originOffset);
  const m0 = c.now_months + effectiveOffset;
  const loanOffset = effectiveOffset === 0 && c.first_month_fraction === 0 ? 1 : effectiveOffset;
  const loanFrom = c.now_months + loanOffset;
  const down = Math.min(e.down_cents, e.price_cents), real = e.price_cents - down;
  const spends: Spend[] = occurrence ? occurrence.payments.filter(p => (!coverage || coverage.payment_ids.includes(p.id)) && p.date > (c.anchor_date ?? '') && p.amount_cents !== null).map(p => ({ offset_months: Math.max(0, offsetOf(p.date, c.anchor_date!)), cents: Number(p.amount_cents) / nominalFactor(c, c.now_months + offsetOf(p.date, c.anchor_date!)) })) : [{ offset_months: offset, cents: down + e.extra_cents }];
  const saving_flows: Flow[] = [], spend_flows: Flow[] = [];
  const both = (source_id: string, label: string, from: number, to: number | null, cents: number, nominal: boolean, essential: boolean) => {
    saving_flows.push({ source_id, label, from_month: from, to_month: to, cents: -cents, nominal, essential, timing: 'start' });
    spend_flows.push({ source_id, label, from_month: from, to_month: to, cents, nominal, essential, timing: 'start' });
  };
  // 贷款：本金按购买那天的名义价格算，月供固定名义金额，到期结束。
  const needsLoan = real > 0 || occurrence?.loan != null;
  const knownLoan = occurrence?.loan && (!coverage || coverage.loan) ? occurrence.loan : null;
  const principal = occurrence ? knownLoan ? Number(knownLoan.principal_cents) : needsLoan ? null : 0 : real * nominalFactor(c, c.now_months + offset);
  const n = occurrence ? knownLoan ? knownLoan.remaining_months : needsLoan ? null : 0 : Math.round(e.loan_years * 12);
  const pay = principal === null || n === null ? null : monthlyPayment(principal, e.loan_rate_hundredths, n);
  if (pay !== null && n !== null && pay > 0) both(`event:${e.id}:loan`, `${e.label}月供`, loanFrom, loanFrom + n, pay, true, true);
  const until = e.until_age === null ? null : e.until_age * 12;
  if ((!coverage || coverage.holding) && e.holding_cents > 0) both(`event:${e.id}:holding`, `${e.label}${e.kind === 'car' ? '养车' : '持有成本'}`, m0, e.kind === 'car' ? until : null, e.holding_cents, false, e.kind === 'house');
  // 退休后的房租在计划里是一条持续的必需支出；买房之后不再付，取消额不超过房租本身。
  if ((!coverage || coverage.holding) && e.kind === 'house' && e.rent_saved_cents > 0 && (c.rent_cents ?? 0) > 0) spend_flows.push({ label: `${e.label}后不再付房租`, from_month: m0, to_month: null, cents: -Math.min(e.rent_saved_cents, c.rent_cents!), nominal: false, essential: true });
  if (!occurrence && e.rent_saved_cents > 0) saving_flows.push({ label: `${e.label}省下的房租`, from_month: m0, to_month: null, cents: e.rent_saved_cents, nominal: false, essential: false });
  if ((!coverage || coverage.cycle) && e.cycle_years !== null && e.cycle_years > 0) {
    const end = until ?? c.horizon_months, step = e.cycle_years * 12;
    for (let k = 1; c.now_months + originOffset + k * step < end; k++) if (originOffset + k * step > 0) spends.push({ offset_months: originOffset + k * step, cents: Math.max(0, e.price_cents - e.resale_cents) });
  }
  return { spends, saving_flows, spend_flows, principal_cents: principal, payment_cents: pay, loan_months: pay === null ? null : pay > 0 ? n : 0, loans: pay !== null && n !== null && principal !== null && pay > 0 ? [{ id: e.id, from_offset: loanOffset, principal_cents: principal, rate_hundredths: e.loan_rate_hundredths, months: n, payment_cents: pay, existing: !!occurrence }] : [] };
}

/** 把这些事件并入计划（不改原计划）。events 里的 offset 由调用方按今天算好。 */
export function applyEvents(P: Plan, events: { e: LifeEvent; offset: number }[]): Plan {
  let loans = [...(P.loans ?? [])];
  let spends = [...P.spends], sf = [...(P.saving_flows ?? [])], pf = [...(P.spend_flows ?? [])];
  for (const { e, offset } of events) { const x = eventParts(P, e, offset); loans = loans.concat(x.loans); spends = spends.concat(x.spends); sf = sf.concat(x.saving_flows); pf = pf.concat(x.spend_flows); }
  return { ...P, loans, spends, saving_flows: sf, spend_flows: pf };
}

export type EventImpact = {
  annotations?: PlanningAnnotation[];
  base_fi: number | null; with_fi: number | null;
  /** 财务独立推迟的月数；任一边没达成时为 null。 */
  delay_months: number | null;
  /** 首付、杂费与应急金线合计；计划日期时的可支配资产（不含这件事）；差多少（够则 0）；最早哪个月（距今月数）够。 */
  cash_needed: number; assets_at_date: number; short: number; earliest_offset: number | null;
  /** 名义月供；买后那个月的每月储蓄（今天的钱）；每月储蓄不为正说明要靠收入支撑。 */
  payment_nominal: number; saving_after: number; saving_not_positive: boolean;
  /** 若改在 5、7、10 年后买，财务独立推迟多少月。 */
  sweep: { years: number; delay_months: number | null }[];
};

const delay = (a: number | null, b: number | null) => (a !== null && b !== null ? b - a : null);

/** 只算这一件事（其他事件不发生）：对财务独立的影响、付不付得起首付、月供压力。P0 是不含任何事件的计划。 */
export function eventImpact(P0: Plan, e: LifeEvent, offset: number, emergencyCents: number): EventImpact {
  const base = project(P0, 0), withE = project(applyEvents(P0, [{ e, offset }]), 0);
  const need = Math.min(e.down_cents, e.price_cents) + e.extra_cents + emergencyCents;
  const at = base.assets[Math.max(0, Math.min(offset, base.assets.length - 1))];
  let earliest: number | null = null;
  for (let t = 0; t < base.assets.length; t++) if (base.assets[t] >= need) { earliest = t; break; }
  const parts = eventParts(P0, e, offset), P1 = applyEvents(P0, [{ e, offset }]);
  if (parts.payment_cents === null) throw new Error('贷款接续待核对，不能输出完整单项影响。');
  const sv = savingsOf(P1), after = sv[Math.min(offset, sv.length - 1)] ?? 0;
  return {
    annotations: P0.annotations ?? [],
    base_fi: base.fi_month, with_fi: withE.fi_month, delay_months: delay(base.fi_month, withE.fi_month),
    cash_needed: need, assets_at_date: at, short: Math.max(0, need - at), earliest_offset: earliest,
    payment_nominal: parts.payment_cents, saving_after: after, saving_not_positive: after <= 0 && (parts.payment_cents > 0 || e.holding_cents > 0),
    sweep: [5, 7, 10].map(years => { const o = years * 12, w = project(applyEvents(P0, [{ e, offset: o }]), 0); return { years, delay_months: delay(base.fi_month, w.fi_month) }; }),
  };
}

/** 全部计入的事件一起发生：FI 月份的变化。 */
export function totalImpact(P0: Plan, events: { e: LifeEvent; offset: number }[]) {
  const base = project(P0, 0), all = project(applyEvents(P0, events), 0);
  return { annotations: P0.annotations ?? [], base_fi: base.fi_month, with_fi: all.fi_month, delay_months: delay(base.fi_month, all.fi_month) };
}
