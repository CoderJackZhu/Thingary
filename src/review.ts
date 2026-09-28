import type { OverviewData } from './Overview';
import type { Summary, Point } from './wealth';
import type { ExpenseView } from './expenses';
import type { Overview as Recurring } from './recurring';
import type { VirtualOverview } from './virtual';
import type { TimelineEvent } from './Timeline';
import type { SourceTarget } from './source';
export type Read<T> = { status: 'ready'; value: T } | { status: 'error'; value: { code: string; message: string } };
export type Review = { generation: string; today: string; year: number | null; physical: Read<OverviewData>; wealth: Read<Summary>; expenses: Read<ExpenseView>; recurring: Read<Recurring>; virtual_assets: Read<VirtualOverview>; recent: Read<TimelineEvent[]> };
export type ReviewPage = 'wealth' | 'assets' | 'expenses' | 'recurring' | 'virtual' | 'timeline';
export const ready = <T,>(r: Read<T> | undefined): T | undefined => r?.status === 'ready' ? r.value : undefined;
export const overviewView = (value: string | null) => value === 'physical' ? 'physical' : 'combined';
export function latestComplete(points: Point[]) { return points.filter(p => p.complete).at(-1); }
/** One precise entry per meaning: a merged plan/entitlement group keeps both. */
export type AttentionEntry = { action: string; target: SourceTarget };
export type Attention = { id: string; priority: number; date: string; title: string; details: string[]; entries: AttentionEntry[] };
/** Presentation grouping only; statuses, windows and all amounts come from domain readers. */
export function attention(review: Review): Attention[] {
  const groups = new Map<string, Attention>();
  const latest = ready(review.wealth)?.points.at(-1);
  if (latest && !latest.complete) groups.set('snapshot:' + latest.snapshot_id, { id: 'snapshot:' + latest.snapshot_id, priority: 0, date: latest.date, title: '最新盘点尚未完整', details: [`${latest.date} · 缺 ${latest.missing} 个账户`], entries: [{ action: '查看盘点', target: { kind: 'snapshot', id: latest.snapshot_id } }] });
  const recurring = ready(review.recurring);
  for (const [rows, priority, label] of [[recurring?.due ?? [], 1, '付款待确认'], [recurring?.upcoming ?? [], 2, '即将到期付款']] as const) {
    for (const r of rows) {
      const id = 'plan:' + r.plan_id;
      if (!groups.has(id)) groups.set(id, { id, priority, date: r.due_date, title: r.plan_name, details: [`${label} · ${r.due_date}`], entries: [{ action: '进入计划', target: { kind: 'plan', id: r.plan_id } }] });
    }
  }
  for (const v of ready(review.virtual_assets)?.items ?? []) {
    if (v.status !== 'expired' && v.status !== 'expiring') continue;
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
