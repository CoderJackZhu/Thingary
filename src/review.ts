import { monthsBeforeDay, REVIEW_PERIOD_PRESETS } from './finance-period-control.ts';
import type { PlanSources } from './plan-summary';
import { allModules, type Modules } from './modules.ts';
import type { OverviewData } from './Overview';
import type { Summary, Point } from './wealth';
import type { ExpenseView } from './expenses';
import type { Overview as Recurring } from './recurring';
import { paymentReminders } from './recurring.ts';
import type { VirtualOverview } from './virtual';
import type { TimelineEvent } from './Timeline';
import type { SourceTarget } from './source';
export type Read<T> = { status: 'ready'; value: T } | { status: 'error'; value: { code: string; message: string } };
export type AccountAvailability = { total: number; due_today: number };
export type Review = { generation: string; today: string; year: number | null; physical: Read<OverviewData>; wealth: Read<Summary>; account_availability?: Read<AccountAvailability>; expenses: Read<ExpenseView>; recurring: Read<Recurring>; virtual_assets: Read<VirtualOverview>; recent: Read<TimelineEvent[]>; planning?: PlanSources | null };
export type ReviewPage = 'wealth' | 'assets' | 'expenses' | 'recurring' | 'virtual' | 'timeline' | 'wishlist';
export const ready = <T,>(r: Read<T> | undefined): T | undefined => r?.status === 'ready' ? r.value : undefined;
/** Disabled modules are intentionally unread; only enabled attention sources can fail. */
export function attentionSourcesReady(review: Review, modules: Modules = allModules): boolean {
  return (!modules.wealth || review.wealth.status === 'ready')
    && (!modules.recurring || review.recurring.status === 'ready')
    && (!modules.virtual || review.virtual_assets.status === 'ready');
}
export const overviewView = (value: string | null) => value === 'physical' ? 'physical' : 'combined';
export function latestComplete(points: Point[]) { return points.filter(p => p.complete).at(-1); }

/** 净资产曲线的时间范围：与首页总览、区间回顾共用同一组预设标签。 */
export const trendRanges = REVIEW_PERIOD_PRESETS.map(({ value, label }) => [value, label, value === '6m' ? 6 : value === '1y' ? 12 : 0] as const);
export type TrendRange = typeof trendRanges[number][0];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** `today` 往前推 N 个月的自然日；目标月没有该日（如 8/31 → 2/28）取当月最后一天，不顺延到下月。 */
export const monthsBefore = monthsBeforeDay;
export type CustomTrendRange = { from: string; to: string };
export function customRangeError(custom: CustomTrendRange, today: string): string | null {
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) > 0 && Number(v.slice(5, 7)) >= 1 && Number(v.slice(5, 7)) <= 12 && +v.slice(8) >= 1 && +v.slice(8) <= daysIn(+v.slice(0, 4), +v.slice(5, 7));
  if (!valid(custom.from) || !valid(custom.to)) return '请填写有效的起止日期（YYYY-MM-DD）。';
  if (custom.from > custom.to) return '开始日期不能晚于结束日期。';
  if (custom.to > today) return '结束日期不能晚于今天。';
  return null;
}
export function rangePoints(points: Point[], range: TrendRange, today: string, custom?: CustomTrendRange) {
  if (range === 'all') return points;
  if (range === 'custom') return custom && !customRangeError(custom, today) ? points.filter(p => p.date >= custom.from && p.date <= custom.to) : [];
  // Today minus 30 natural days, inclusive: 31 calendar days including today.
  const before = new Date(today + 'T00:00:00Z'); before.setUTCDate(before.getUTCDate() - 30);
  const from = range === '30d' ? before.toISOString().slice(0, 10) : range === 'ytd' ? today.slice(0, 4) + '-01-01' : monthsBefore(today, range === '6m' ? 6 : 12);
  return points.filter(p => p.date >= from && p.date <= today);
}
/** A range needs at least two complete check-ins; unknown points never become zero. */
export const rangeUsable = (points: Point[], range: TrendRange, today: string, custom?: CustomTrendRange) => rangePoints(points, range, today, custom).filter(p => p.complete).length >= 2;
export type TrendSelection = { range: TrendRange; custom?: CustomTrendRange };
let trendRangeMemory: { generation: string; selection: TrendSelection; legends: Record<string, boolean[]> } | null = null;
const memory = (generation: string) => {
  if (trendRangeMemory?.generation !== generation) trendRangeMemory = { generation, selection: { range: 'all' }, legends: {} };
  return trendRangeMemory!;
};
export const recallTrendSelection = (generation: string): TrendSelection => structuredClone(memory(generation).selection);
export const recallTrendRange = (generation: string): TrendRange => recallTrendSelection(generation).range;
export const clearTrendRange = (): void => { trendRangeMemory = null; };
export const rememberTrendRange = (generation: string, range: TrendRange, custom?: CustomTrendRange): void => { memory(generation).selection = { range, ...(custom ? { custom: { ...custom } } : {}) }; };
export const defaultTrendLegend = (kind: string): boolean[] => kind === 'net' ? [true, false, false] : [true, true];
export const recallTrendLegend = (generation: string, kind: string): boolean[] => { const saved = memory(generation).legends[kind], base = defaultTrendLegend(kind); return saved?.length === base.length ? [...saved] : base; };
export const rememberTrendLegend = (generation: string, kind: string, visible: boolean[]): void => { memory(generation).legends[kind] = [...visible]; };
export type PeriodChange = { status: 'insufficient' } | { status: 'scope_changed' } | { status: 'ready'; from: string; to: string; cents: string; rate_hundredths: number | null };
/** The first point's scope_changed refers outside the selected range. */
export function periodChange(points: Point[]): PeriodChange {
  const full = points.filter(p => p.complete), first = full[0], last = full.at(-1);
  if (full.length < 2 || !last) return { status: 'insufficient' };
  if (points.some(p => p.date > first.date && p.date <= last.date && p.scope_changed)) return { status: 'scope_changed' };
  const start = BigInt(first.net_cents), delta = BigInt(last.net_cents) - start;
  const rate = start > 0n ? Number((delta * 20000n / start + (delta >= 0n ? 1n : -1n)) / 2n) : null;
  return { status: 'ready', from: first.date, to: last.date, cents: String(delta), rate_hundredths: rate };
}

/** 总览资产结构的“较上次变化”只比最近一次完整盘点与它的上一次完整盘点（账户计入范围变化时不可比）。 */
export function structureCompareRange(points: Point[]): { from: string; to: string } | null {
  const latest = latestComplete(points);
  if (!latest?.compared_to || latest.scope_changed || latest.change_cents === null) return null;
  const from = points.find(p => p.complete && p.date === latest.compared_to);
  return from ? { from: from.snapshot_id, to: latest.snapshot_id } : null;
}
export type StructureRow = { kind: string; amount_cents: string; share_hundredths: number | null; change_cents: string | null; added: boolean };
/**
 * `pairs` 来自 wealth_compare：起点没有该类别（from_cents 为 null）表示那次盘点没有这类计入资产，
 * 该类别是新增，变化即现有金额；终点没有的类别不在当前结构里，不显示。pairs 为 null 表示不可比，所有变化为未知而非零。
 */
export function structureRows(structure: { kind: string; amount_cents: string; share_hundredths: number | null }[], pairs: { kind: string; from_cents: string | null; to_cents: string | null }[] | null): StructureRow[] {
  return structure.map(s => {
    const pair = pairs?.find(p => p.kind === s.kind);
    if (!pairs || !pair || pair.to_cents === null) return { ...s, change_cents: null, added: false };
    if (pair.from_cents === null) return { ...s, change_cents: pair.to_cents, added: true };
    return { ...s, change_cents: (BigInt(pair.to_cents) - BigInt(pair.from_cents)).toString(), added: false };
  });
}
/** One precise entry per meaning: a merged plan/entitlement group keeps both. */
export type AttentionEntry = { action: string; target: SourceTarget };
export type Attention = { id: string; priority: number; date: string; title: string; details: string[]; entries: AttentionEntry[] };
/** Presentation grouping only; statuses, windows and all amounts come from domain readers. */
export function attention(review: Review, m: Modules = allModules): Attention[] {
  const groups = new Map<string, Attention>();
  const latest = m.wealth ? ready(review.wealth)?.points.at(-1) : undefined;
  if (latest && !latest.complete) groups.set('snapshot:' + latest.snapshot_id, { id: 'snapshot:' + latest.snapshot_id, priority: 0, date: latest.date, title: '最新盘点尚未完整', details: [`${latest.date} · 缺 ${latest.missing} 个账户`], entries: [{ action: '查看盘点', target: { kind: 'snapshot', id: latest.snapshot_id } }] });
  const recurring = m.recurring ? ready(review.recurring) : undefined;
  const reminders = recurring ? paymentReminders(recurring) : { due: [], upcoming: [] };
  for (const [rows, priority, label] of [[reminders.due, 1, '付款待确认'], [reminders.upcoming, 2, '即将到期付款']] as const) {
    for (const r of rows) {
      const id = 'plan:' + r.plan_id;
      if (!groups.has(id)) groups.set(id, { id, priority, date: r.due_date, title: r.plan_name, details: [`${label} · ${r.due_date}`], entries: [{ action: '进入计划', target: { kind: 'plan', id: r.plan_id } }] });
    }
  }
  for (const v of m.virtual ? ready(review.virtual_assets)?.items ?? [] : []) {
    if (v.status !== 'expired' && v.status !== 'expiring') continue;
    // Ended subscriptions are history, not an outstanding renewal task.
    if (v.status === 'expired' && (v.fields.kind === 'subscription' || v.fields.billing === 'subscription' || v.plan?.fields.category === 'subscription')) continue;
    const linked = v.fields.plan_id && !v.plan_deleted;
    const id = linked ? 'plan:' + v.fields.plan_id : 'virtual:' + v.id;
    const priority = v.status === 'expired' ? 1 : 2, date = v.valid_until!;
    const detail = `${v.fields.name} · 权益${v.status === 'expired' ? '已到期' : '即将到期'} · ${date}`;
    const entry: AttentionEntry = { action: '打开虚拟档案', target: { kind: 'virtual', id: v.id } };
    const group = groups.get(id);
    if (group) { group.details.push(detail); group.entries.push(entry); group.priority = Math.min(priority, group.priority); group.date = date < group.date ? date : group.date; }
    else groups.set(id, { id, priority, date, title: v.fields.name, details: [detail], entries: [entry] });
  }
  return [...groups.values()].sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
/** Invalidated on request, library change and unmount; generations alone are not write versions. */
export function requestGate() {
  let sequence = 0;
  return { next: () => ++sequence, invalidate: () => { ++sequence; }, accepts: (ticket: number, expected: string, received: string) => ticket === sequence && expected === received };
}
