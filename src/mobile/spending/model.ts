// Pure projections for the iPhone spending screens (支出、周期费用、虚拟资产). No React, no IPC.
// Every amount is an integer-cent string; unknown stays null and is never shown as zero.
// Business rules come from the desktop modules (expenses.ts, recurring*.ts, virtual.ts, finance-*.ts).
import { money } from '../../asset.ts';
import { categoryText, countsAsSpending, expensePeriodLabel, expenseSourceTarget, sourceLabel, spendDisplay } from '../../expenses.ts';
import type { ExpenseView, Line } from '../../expenses.ts';
import { financePeriodContains } from '../../finance-contract.ts';
import type { FinancePeriod } from '../../finance-contract.ts';
import { financePeriodFromDraft, initialFinancePeriodDraft } from '../../finance-period-control.ts';
import { planStatus, intervalUnit, recurringCategoryText } from '../../recurring.ts';
import type { Due, Payment, Plan } from '../../recurring.ts';
import { coverageFor, planScheduleDates, shiftDays, shiftMonth } from '../../recurring-model.ts';
import { billingOf, billingText, cumulativeCost, paymentScheduleText, topupSpendText, validityText, virtualKindText, virtualStatusText } from '../../virtual.ts';
import type { BillingMode, VirtualAsset } from '../../virtual.ts';
import { incomeCategories, incomeCategoryTotals } from '../../income-classification.ts';
import { incomeHpfTotals } from '../../plan.ts';
import type { Income } from '../../plan.ts';

// ---------------------------------------------------------------- 期间

export type PeriodKey = 'month' | 'year' | 'all' | 'custom';
export const periodChoices: { id: PeriodKey; label: string }[] = [{ id: 'month', label: '本月' }, { id: 'year', label: '今年' }, { id: 'all', label: '全部' }, { id: 'custom', label: '自选' }];
export type PeriodResult = { ok: true; value: FinancePeriod } | { ok: false; error: string };

/** 本月 / 今年 / 全部 / 自选 映射为契约里的自然日期间；自选日期由桌面的同一校验器检查。 */
export function periodFromKey(key: PeriodKey, today: string, custom?: { from: string; to: string }): PeriodResult {
  const draft = initialFinancePeriodDraft(today);
  switch (key) {
    case 'all': return financePeriodFromDraft({ ...draft, kind: 'all' });
    case 'year': return financePeriodFromDraft({ ...draft, kind: 'year' });
    case 'month': return financePeriodFromDraft({ ...draft, kind: 'month' });
    case 'custom': return financePeriodFromDraft({ ...draft, kind: 'range', from: custom?.from ?? '', to: custom?.to ?? '', includeFrom: true });
  }
}
/** 汇总卡标签里的时间词：本月已付、今年已付、累计已付、区间已付。 */
export const periodWord = (key: PeriodKey): string => ({ month: '本月', year: '今年', all: '累计', custom: '区间' })[key];
export const periodTitle = (period: FinancePeriod): string => expensePeriodLabel(period);
/** The host answers for the period it was asked about; a different period must not be drawn. */
export function samePeriod(a: FinancePeriod, b: FinancePeriod): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'all': return true;
    case 'year': return a.year === (b as typeof a).year;
    case 'month': return a.month === (b as typeof a).month;
    case 'range': { const r = b as typeof a; return a.from === r.from && a.to === r.to && a.includeFrom === r.includeFrom; }
  }
}

// ---------------------------------------------------------------- 日期小工具

const dayMs = (day: string) => Date.parse(day + 'T12:00:00Z');
/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / 86400000);
export const shortDay = (day: string): string => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
export const monthDay = (day: string): string => day.slice(5);
export type Tone = 'warn' | 'positive' | 'neutral' | 'danger';
/** 「4 天后」「今天」「已逾期 3 天」。 */
export function dueBadge(due: string, today: string): { text: string; tone: Tone } {
  const days = daysBetween(today, due);
  if (days < 0) return { text: `已逾期 ${-days} 天`, tone: 'danger' };
  if (days === 0) return { text: '今天', tone: 'warn' };
  return { text: `${days} 天后`, tone: days <= 7 ? 'warn' : 'neutral' };
}

// ---------------------------------------------------------------- 重要支出

export type ExpenseRow = { key: string; title: string; subtitle: string; amount: string | null; sign: '' | '-'; target: ReturnType<typeof expenseSourceTarget>; line: Line; counts: boolean };
export function expenseRows(lines: Line[], keyword = ''): ExpenseRow[] {
  const word = keyword.trim().toLowerCase();
  const match = (l: Line) => !word || [l.title, categoryText(l), l.notes ?? '', sourceLabel[l.source]].some(t => t.toLowerCase().includes(word));
  return lines.filter(match).map(l => ({
    key: l.source + ':' + l.id + ':' + (l.date ?? ''), title: l.title,
    subtitle: [l.date ?? '日期待补', sourceLabel[l.source], categoryText(l)].join(' · '),
    amount: l.amount_cents, sign: l.source === 'refund' || l.source === 'sale' ? '-' : '', target: expenseSourceTarget(l), line: l, counts: countsAsSpending(l),
  }));
}
/** 期间合计的已知／未知口径只数进入期间支出的带日期记录（同 ExpensesPage）。 */
export function expenseSummary(view: ExpenseView) {
  const spending = view.lines.filter(countsAsSpending);
  const known = spending.filter(l => l.amount_cents !== null).length;
  const display = spendDisplay({ count: spending.length, known_count: known, unknown_count: spending.length - known, spent_cents: view.spent_cents });
  return { count: spending.length, known, unknown: spending.length - known, display, netUnknown: spending.length > known };
}
export type ChartModel = { title: string; caption: string; bars: { label: string; value: number | null }[]; summary: string };
/** 全部期间画逐年柱，某一年画 12 个月柱；月度、自选区间不画图。未知金额画成缺口，不画成 0。 */
export function expenseChart(view: ExpenseView, period: FinancePeriod): ChartModel | null {
  if (period.kind === 'all' && view.annual_totals.length) {
    const bars = view.annual_totals.map(t => { const d = spendDisplay(t); return { label: String(t.year).slice(2) + '年', value: d.value === null ? null : Number(t.spent_cents), text: `${t.year} 年${d.value !== null ? ' ' + money(t.spent_cents) : ' ' + d.note}` }; });
    const top = view.annual_totals.filter(t => spendDisplay(t).value !== null).sort((a, b) => Number(b.spent_cents) - Number(a.spent_cents))[0];
    return { title: '各年支出', caption: '仅列有记录的年份 · 柱高为已知支出', bars: bars.map(b => ({ label: b.label, value: b.value })),
      summary: `各年支出：${bars.map(b => b.text).join('，')}。${top ? `${top.year} 年最多，${money(top.spent_cents)}。` : '暂无已知金额。'}` };
  }
  if (period.kind === 'year' && view.months.length) {
    const bars = view.months.map(m => { const d = spendDisplay(m); return { label: `${Number(m.month.slice(5))}`, value: m.count === 0 ? 0 : d.value === null ? null : Number(m.spent_cents), text: `${Number(m.month.slice(5))} 月${m.count === 0 ? '无记录' : d.value !== null ? ' ' + money(m.spent_cents) : ' 金额待补'}` }; });
    const top = view.months.filter(m => m.count > 0 && spendDisplay(m).value !== null).sort((a, b) => Number(b.spent_cents) - Number(a.spent_cents))[0];
    return { title: '各月支出', caption: `${period.year} 年 · 不含日期待补`, bars: bars.map(b => ({ label: b.label, value: b.value })),
      summary: `${period.year} 年各月支出：${bars.map(b => b.text).join('，')}。${top ? `${Number(top.month.slice(5))} 月最多，${money(top.spent_cents)}。` : '暂无已知金额。'}` };
  }
  return null;
}
export const signedMoney = (row: { amount: string | null; sign: '' | '-' }): string | null => row.amount === null ? null : money(row.sign === '-' ? '-' + row.amount : row.amount);

// ---------------------------------------------------------------- 周期费用

export type StatusInfo = { text: string; tone: Tone };
export function planStatusInfo(plan: Plan, today: string): StatusInfo {
  const text = planStatus(plan, today);
  const tone: Tone = text.startsWith('已于') ? 'neutral' : text === '已暂停' || text.startsWith('待生效') ? 'warn' : 'positive';
  return { text, tone };
}
const rank = (p: Plan, today: string) => p.fields.end_date && p.fields.end_date < today ? 2 : p.fields.paused ? 1 : 0;
/** 进行中的计划按下次付款日排前面；暂停的、已结束的依次靠后。 */
export function sortPlans(plans: Plan[], today: string): Plan[] {
  return [...plans].sort((a, b) => rank(a, today) - rank(b, today) || (a.next_due ?? '9999-99-99').localeCompare(b.next_due ?? '9999-99-99') || a.fields.name.localeCompare(b.fields.name));
}
export function matchesPlan(plan: Plan, keyword: string): boolean {
  const word = keyword.trim().toLowerCase();
  return !word || [plan.fields.name, recurringCategoryText(plan.fields.category), plan.fields.notes].some(t => t.toLowerCase().includes(word));
}
/** 累计费用：有服务期估算时用估算（标明估算），否则是已确认付款合计。 */
export function planCost(p: Pick<Plan, 'estimated_cents' | 'paid_cents'>): { cents: string; estimated: boolean } {
  return p.estimated_cents ? { cents: p.estimated_cents, estimated: true } : { cents: p.paid_cents ?? '0', estimated: false };
}
/** 「每期 ¥4,500 / 月」，非月付另列月均（待生效的计划不列）。 */
export function planAmountText(p: Plan, pendingStart: boolean): { main: string; monthly: string | null } {
  const f = p.fields;
  return { main: `每期 ${money(f.amount_cents)} / ${intervalUnit(f)}`, monthly: !pendingStart && !f.interval_days && f.interval_months > 1 && p.monthly_cents ? `月均 ${money(p.monthly_cents)}` : null };
}
/** 期间内已确认付款（按实付日期）；金额未知的付款单独计数，不按 0 算。 */
export function paidInPeriod(payments: Payment[], period: FinancePeriod): { cents: string; count: number; unknown: number } {
  let total = 0n, count = 0, unknown = 0;
  for (const p of payments) {
    if (p.state !== 'paid' || !financePeriodContains(period, p.paid_date)) continue;
    count++;
    if (p.amount_cents === null) unknown++; else total += BigInt(p.amount_cents);
  }
  return { cents: total.toString(), count, unknown };
}
export function dueTotal(dues: Due[]): string { return dues.reduce((n, d) => n + BigInt(d.amount_cents), 0n).toString(); }

export type PeriodState = 'pending' | 'paid' | 'skipped' | 'upcoming';
export type PeriodRow = { key: string; ordinal: number | null; due: string; state: PeriodState; amount: string | null; paidDate: string | null; coverage: [string, string] | null; record: Payment | null; note: string; offSchedule: boolean };
export type PeriodList = { rows: PeriodRow[]; paid: number; skipped: number; pending: number; upcoming: number; total: number | null; openEnded: boolean };
/**
 * 付款期次：计划排期 + 已记录的付款（含计划外）。待确认＝已到期或进入提醒窗口且还没有记录；
 * 暂停中的计划不列待确认。固定期限的计划数出全部期数；持续进行的只展开未来 12 个月。
 */
export function periodList(plan: Plan, payments: Payment[], dues: Due[], today: string): PeriodList {
  const f = plan.fields, own = payments.filter(p => p.plan_id === plan.id);
  const openEnded = !f.end_date;
  const from = f.service_start ? '1900-01-01' : f.first_due;
  const to = f.end_date ? shiftDays(f.end_date, 366) : shiftMonth(today, 12);
  const scheduled = planScheduleDates(plan, from, to).filter((d, i, all) => all.indexOf(d) === i);
  const ordinal = new Map(scheduled.map((d, i) => [d, i + 1]));
  const dueByDate = new Map(dues.filter(d => d.plan_id === plan.id).map(d => [d.due_date, d]));
  const dates = [...new Set([...scheduled, ...own.map(p => p.due_date)])].sort();
  const rows: PeriodRow[] = dates.map(due => {
    const record = own.find(p => p.due_date === due) ?? null, item = dueByDate.get(due);
    const state: PeriodState = record ? (record.state === 'paid' ? 'paid' : 'skipped') : !f.paused && (item || due <= today) ? 'pending' : 'upcoming';
    const coverage: [string, string] | null = record?.coverage_start && record.coverage_end ? [record.coverage_start, record.coverage_end] : item?.coverage_start && item.coverage_end ? [item.coverage_start, item.coverage_end] : coverageFor(f, due);
    return { key: due, ordinal: ordinal.get(due) ?? null, due, state, amount: record ? (record.state === 'paid' ? record.amount_cents : null) : f.amount_cents, paidDate: record?.paid_date ?? null, coverage, record, note: record?.notes ?? '', offSchedule: !!record && !ordinal.has(due) };
  });
  const count = (s: PeriodState) => rows.filter(r => r.state === s).length;
  return { rows, paid: count('paid'), skipped: count('skipped'), pending: count('pending'), upcoming: rows.filter(r => r.state === 'upcoming' && r.ordinal !== null).length, total: openEnded ? null : scheduled.length, openEnded };
}
/** 进度条分段（已确认／跳过／待确认／未到），比例按期数；没有固定期数时返回 null。 */
export function progressParts(list: PeriodList): { paid: number; skipped: number; pending: number; upcoming: number } | null {
  const total = list.rows.filter(r => r.ordinal !== null || r.state === 'paid' || r.state === 'skipped').length;
  if (list.openEnded || !total) return null;
  const share = (n: number) => Math.round((n / total) * 1000) / 10;
  return { paid: share(list.paid), skipped: share(list.skipped), pending: share(list.pending), upcoming: share(list.upcoming) };
}
/** 租期文字：2025-03 至 2027-02（24 期）；无结束日期则是持续进行。 */
export function termText(plan: Plan, list: PeriodList): string {
  const f = plan.fields, start = f.service_start ?? f.first_due;
  if (!f.end_date) return `${start.slice(0, 7)} 起，持续进行`;
  return `${start.slice(0, 7)} 至 ${f.end_date.slice(0, 7)}${list.total !== null ? `（${list.total} 期）` : ''}`;
}
export function periodLabelText(row: PeriodRow): string {
  return row.ordinal !== null ? `第 ${row.ordinal} 期` : '计划外';
}
export function nextPayment(plan: Plan, today: string): { date: string; badge: ReturnType<typeof dueBadge> } | null {
  if (plan.fields.paused || (plan.fields.end_date && plan.fields.end_date < today) || !plan.next_due) return null;
  return { date: plan.next_due, badge: dueBadge(plan.next_due, today) };
}

// ---------------------------------------------------------------- 虚拟资产

export type VirtualSegment = 'all' | BillingMode;
export const virtualSegments: { id: VirtualSegment; label: string }[] = [{ id: 'all', label: '全部' }, { id: 'subscription', label: '订阅' }, { id: 'single', label: '一次买断' }, { id: 'topup', label: '储值' }];
export const segmentOf = (v: VirtualAsset): BillingMode => billingOf(v);
export function inSegment(v: VirtualAsset, segment: VirtualSegment): boolean { return segment === 'all' || billingOf(v) === segment; }
const activeSub = (v: VirtualAsset) => billingOf(v) === 'subscription' && !!v.plan && (v.status === 'ongoing' || v.status === 'active' || v.status === 'expiring');
/** 单个订阅的年化费用（分）：按计划每期金额折成 12 个月或 365 天，不是已付。 */
export function annualCents(v: VirtualAsset): bigint | null {
  const f = v.plan?.fields;
  if (!f || !activeSub(v)) return null;
  return f.interval_days ? BigInt(f.amount_cents) * 365n / BigInt(f.interval_days) : BigInt(f.amount_cents) * 12n / BigInt(f.interval_months);
}
/** 顶部两块汇总：订阅年化费用（含月均）与储值余额（仅按已记录的余额盘点，没有记录就是未知）。 */
export function virtualSummary(items: VirtualAsset[]) {
  const subs = items.filter(activeSub);
  const annual = subs.reduce((n, v) => n + (annualCents(v) ?? 0n), 0n);
  const topups = items.filter(v => billingOf(v) === 'topup' && v.status !== 'stopped' && v.status !== 'expired');
  const withBalance = topups.filter(v => v.balance);
  const balance = withBalance.reduce((n, v) => n + BigInt(v.balance!.balance_cents), 0n);
  return {
    subscriptions: subs.length, annual: annual.toString(), monthly: (annual / 12n).toString(),
    topups: topups.length, balance: withBalance.length ? balance.toString() : null, balanceUnknown: topups.length - withBalance.length,
  };
}
export const virtualFilterChips = [['all', '全部'], ['valid', '有效'], ['expiring', '即将到期'], ['expired', '已结束／到期'], ['stopped', '已停用']] as const;
export type VirtualLine = { detail: string; flag: { text: string; tone: Tone } | null; cost: { text: string | null; note: string; label: string }; typeLabel: string; status: string };
/** 列表行：类型、计费方式、期限／续费日期、累计费用；金额未知写明原因。 */
export function virtualLine(v: VirtualAsset, today: string): VirtualLine {
  const mode = billingOf(v), cost = cumulativeCost(v);
  let detail: string;
  if (mode === 'subscription') {
    const f = v.plan?.fields;
    detail = f ? `${f.interval_days ? `每 ${f.interval_days} 天` : ({ 1: '月付', 3: '季付', 6: '半年付', 12: '年付' } as Record<number, string>)[f.interval_months] ?? '周期付'} ${money(f.amount_cents)}${v.status !== 'future' && !f.interval_days && f.interval_months > 1 && v.plan?.monthly_cents ? `（月均 ${money(v.plan.monthly_cents)}）` : ''} · ${validityText(v)}` : '每期价格待补充';
  } else if (mode === 'topup') {
    detail = `${v.balance ? `余额 ${money(v.balance.balance_cents)}` : '余额未记录'} · ${v.topup_count ? `累计充值 ${v.topup_known_cents != null ? money(v.topup_known_cents) : '金额未知'}` : '尚未记录充值'}`;
  } else {
    detail = `${v.fields.price_cents != null ? `单次 ${money(v.fields.price_cents)}` : '单次 价格待补充'} · ${validityText(v)}`;
  }
  let flag: VirtualLine['flag'] = null;
  if (v.payment_due) { const b = dueBadge(v.payment_due.due_date, today); flag = { text: `${monthDay(v.payment_due.due_date)} 续费 · ${b.text}`, tone: b.tone === 'danger' ? 'danger' : 'warn' }; }
  else if (v.status === 'expiring' && v.valid_until) { const b = dueBadge(v.valid_until, today); flag = { text: `${v.valid_until} 到期 · ${b.text}`, tone: 'warn' }; }
  else if (v.needs_review) flag = { text: '停用待核对', tone: 'warn' };
  const t = billingOf(v) === 'topup' ? topupSpendText(v) : null;
  const text = t ? t.main : cost.cents;
  const note = t ? (t.note ?? '') : cost.estimated ? '估算' : mode === 'single' && cost.cents === null ? '价格待补充' : '';
  return { detail, flag, cost: { text, note, label: mode === 'topup' ? '累计充值' : '累计费用' }, typeLabel: mode === 'single' ? '一次买断' : billingText(mode), status: virtualStatusText(v) };
}
export function matchesVirtual(v: VirtualAsset, keyword: string): boolean {
  const word = keyword.trim().toLowerCase();
  return !word || [v.fields.name, virtualKindText(v.fields.kind), billingText(billingOf(v)), v.fields.provider, v.fields.notes].some(t => t.toLowerCase().includes(word));
}
export function scheduleLine(v: VirtualAsset): string { return paymentScheduleText(v); }

// ---------------------------------------------------------------- 收入

export type IncomeView = { rows: Income[]; shown: Income[]; count: number; net: string | null; hpf: ReturnType<typeof incomeHpfTotals>; categories: { label: string; count: number; cents: string }[] };
export function incomeView(all: Income[], period: FinancePeriod, keyword = ''): IncomeView {
  const rows = all.filter(i => financePeriodContains(period, i.fields.date)).sort((a, b) => b.fields.date.localeCompare(a.fields.date) || b.id.localeCompare(a.id));
  const word = keyword.trim().toLowerCase();
  const shown = word ? rows.filter(r => [r.fields.date, incomeCategories[r.fields.category ?? 'unclassified'], r.fields.notes ?? ''].some(t => t.toLowerCase().includes(word))) : rows;
  return { rows, shown, count: rows.length, net: rows.length ? rows.reduce((n, i) => n + BigInt(i.fields.net_cents), 0n).toString() : null, hpf: incomeHpfTotals(rows),
    categories: incomeCategoryTotals(rows).map(c => ({ label: incomeCategories[c.category], count: c.count, cents: c.cents })) };
}
