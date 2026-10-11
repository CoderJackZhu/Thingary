import { money } from './asset.ts';
import { reasonIsInflow } from './plan.ts';
import type { Interval, Reasons } from './plan.ts';
import type { OccurrenceIssue, OccurrenceIssueKind } from './plan-core.ts';
import type { Point } from './wealth.ts';

export type ReviewAction = { kind: 'snapshot'; id: string } | { kind: 'accounts' | 'income' | 'plan' } | { kind: 'occurrence'; event_id: string; issue_kind?: OccurrenceIssueKind };
export type ReviewObservation = { id: string; text: string; action?: ReviewAction };
export const reviewActionLabel = { snapshot: '补录', accounts: '查看账户', income: '记一笔收入', occurrence: '去核对', plan: '查看当前计划' };
export type ReviewObservationsInput = {
  interval: Interval; reasons: Reasons | null; pending: OccurrenceIssue[];
  snapshots: { incomplete_count: number; points: Point[] } | null;
};

/** Recorded facts only. Missing sources are null, never inferred as zero. */
export function buildReviewObservations({ interval: i, reasons, pending, snapshots }: ReviewObservationsInput): { items: ReviewObservation[]; checks: ReviewObservation[] } {
  const items: ReviewObservation[] = [], checks: ReviewObservation[] = [];
  const incomplete = snapshots?.points.find(p => !p.complete);
  if (snapshots && snapshots.incomplete_count > 0) checks.push({ id: 'incomplete', text: `有 ${snapshots.incomplete_count} 次盘点还缺账户金额，未计入变化比较。`, ...(incomplete ? { action: { kind: 'snapshot' as const, id: incomplete.snapshot_id } } : {}) });
  if (i.status === 'scope_changed') checks.push({ id: 'scope_changed', text: '这期有账户改变了计入设置，变化不能与上期直接比较。', action: { kind: 'accounts' } });
  if ((i.status === 'no_income' || i.income_records === 0)) checks.push({ id: 'no_income', text: '这期还没有收入记录；有收入时可补录。', action: { kind: 'income' } });
  const eventIds = [...new Set(pending.flatMap(p => p.event_id ? [p.event_id] : []))];
  if (eventIds.length) checks.push({ id: 'pending_events', text: `有 ${eventIds.length} 项计划安排的日期已过或付款待核对，可展开逐项核对。`, action: { kind: 'occurrence', event_id: eventIds[0] } });
  if (i.delta_nw_cents !== null && i.status !== 'scope_changed') {
    const delta = BigInt(i.delta_nw_cents);
    items.push({ id: 'change', text: delta === 0n ? '金融净资产没有变化，含估值变化。' : `金融净资产${delta < 0n ? '减少' : '增加'}了 ${money((delta < 0n ? -delta : delta).toString())}，含估值变化。` });
  } else items.push({ id: 'change', text: i.status === 'scope_changed' ? '账户计入范围已变，本期金融净资产变化不可直接比较。' : '这期暂无可比较的资产变化。' });
  items.push({ id: 'income', text: (i.status === 'no_income' || i.income_records === 0) ? '这期尚无已记录收入，不代表实际收入为零。' : `这期已记录税后收入 ${money(i.income_cents)}；不代表收入已记全。` });
  if (reasons?.lines.length) {
    let total = 0n, unknown = 0, known = 0;
    for (const line of reasons.lines) {
      if (line.amount_cents === null) { unknown++; continue; }
      known++;
      total += BigInt(line.amount_cents) * (reasonIsInflow(line) ? -1n : 1n);
    }
    items.push({ id: 'records', text: `这期有 ${reasons.lines.length} 条已记录的购入、支出或周期付款，合计约 ${known ? money(total.toString()) : '—／未知'}（退款与售出回收已扣除）${unknown ? `；其中 ${unknown} 条金额未知，合计不含这些` : ''}；这些记录只用于解释，不调整资产数字。` });
  } else items.push({ id: 'records', text: reasons ? '这期暂无已记录的购入、支出或周期付款，不代表实际没有支出。' : '这期付款记录尚未读取，合计暂不可用。' });
  return { items, checks };
}
