import { money } from './asset.ts';
import { reasonIsInflow } from './plan.ts';
import type { Interval, Reasons } from './plan.ts';
import type { OccurrenceIssue, OccurrenceIssueKind } from './plan-core.ts';
import type { Point } from './wealth.ts';
import { t } from './i18n.ts';
export type ReviewAction = { kind: 'snapshot'; id: string } | { kind: 'accounts' | 'income' | 'plan' } | { kind: 'occurrence'; event_id: string; issue_kind?: OccurrenceIssueKind };
export type ReviewObservation = { id: string; text: string; action?: ReviewAction };
export const reviewActionLabel = { snapshot: t('补录'), accounts: t('查看账户'), income: t('记一笔收入'), occurrence: t('去核对'), plan: t('查看当前计划') };
export type ReviewObservationsInput = {
  interval: Interval; reasons: Reasons | null; pending: OccurrenceIssue[];
  snapshots: { incomplete_count: number; points: Point[] } | null;
};

/** Recorded facts only. Missing sources are null, never inferred as zero. */
export function buildReviewObservations({ interval: i, reasons, pending, snapshots }: ReviewObservationsInput): { items: ReviewObservation[]; checks: ReviewObservation[] } {
  const items: ReviewObservation[] = [], checks: ReviewObservation[] = [];
  const incomplete = snapshots?.points.find(p => !p.complete);
  if (snapshots && snapshots.incomplete_count > 0) checks.push({ id: 'incomplete', text: t('有 {incomplete_count} 次盘点还缺账户金额，未计入变化比较。', { incomplete_count: snapshots.incomplete_count }), ...(incomplete ? { action: { kind: 'snapshot' as const, id: incomplete.snapshot_id } } : {}) });
  if (i.status === 'scope_changed') checks.push({ id: 'scope_changed', text: t('这期有账户改变了计入设置，变化不能与上期直接比较。'), action: { kind: 'accounts' } });
  if ((i.status === 'no_income' || i.income_records === 0)) checks.push({ id: 'no_income', text: t('这期还没有收入记录；有收入时可补录。'), action: { kind: 'income' } });
  const eventIds = [...new Set(pending.flatMap(p => p.event_id ? [p.event_id] : []))];
  if (eventIds.length) checks.push({ id: 'pending_events', text: t('有 {length} 项安排的日期已过或付款资料需确认，可展开逐项查看。', { length: eventIds.length }), action: { kind: 'occurrence', event_id: eventIds[0] } });
  if (i.delta_nw_cents !== null && i.status !== 'scope_changed') {
    const delta = BigInt(i.delta_nw_cents);
    items.push({ id: 'change', text: delta === 0n ? t('金融净资产没有变化，含估值变化。') : t('金融净资产{v1}了 {v2}，含估值变化。', { v1: delta < 0n ? t('减少') : t('增加'), v2: money((delta < 0n ? -delta : delta).toString()) }) });
  } else items.push({ id: 'change', text: i.status === 'scope_changed' ? t('参与比较的账户已变，本期金融净资产变化不可直接比较。') : t('这期暂无可比较的资产变化。') });
  items.push({ id: 'income', text: (i.status === 'no_income' || i.income_records === 0) ? t('这期尚无已记录收入，不代表实际收入为零。') : t('这期已记录税后收入 {v1}；不代表收入已记全。', { v1: money(i.income_cents) }) });
  if (reasons?.lines.length) {
    let total = 0n, unknown = 0, known = 0;
    for (const line of reasons.lines) {
      if (line.amount_cents === null) { unknown++; continue; }
      known++;
      total += BigInt(line.amount_cents) * (reasonIsInflow(line) ? -1n : 1n);
    }
    items.push({ id: 'records', text: t('这期有 {length} 条已记录的购入、支出或周期付款，合计约 {v2}（退款与售出回收已扣除）{v3}；这些记录只用于解释，不调整资产数字。', { length: reasons.lines.length, v2: known ? money(total.toString()) : t('—／未知'), v3: unknown ? t('；其中 {unknown} 条金额未知，合计不含这些', { unknown }) : '' }) });
  } else items.push({ id: 'records', text: reasons ? t('这期暂无已记录的购入、支出或周期付款，不代表实际没有支出。') : t('这期付款记录尚未读取，合计暂不可用。') });
  return { items, checks };
}
