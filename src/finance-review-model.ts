import type { AssetInterval, FinanceRead } from './finance-service';
import type { Point } from './wealth';
import type { Income } from './plan';
import type { ExpenseView } from './expenses.ts';
import { countsAsSpending } from './expenses.ts';
import { t } from './i18n.ts';
/** The domain interval identifies its closing snapshot; opening ID comes from dated facts. */
export function reviewInterval(intervals: AssetInterval[], points: Point[], toSnapshotId?: string, fromSnapshotId?: string) {
  const candidates = intervals.map(interval => {
    const from = points.find(p => p.date === interval.from && p.complete);
    const to = points.find(p => p.snapshot_id === interval.snapshot_id && p.complete);
    return from && to ? { interval, pair: { fromSnapshotId: from.snapshot_id, toSnapshotId: to.snapshot_id } } : null;
  }).filter((v): v is NonNullable<typeof v> => v !== null);
  if (toSnapshotId) return candidates.find(v => v.pair.toSnapshotId === toSnapshotId && (!fromSnapshotId || v.pair.fromSnapshotId === fromSnapshotId)) ?? null;
  return candidates.at(-1) ?? null;
}
export type FactMetric = { cents: string | null; note: string };
export function incomeMetric(source: FinanceRead<Income[]>): FactMetric {
  if (source.status === 'disabled') return { cents: null, note: source.reason };
  if (source.status === 'error') return { cents: null, note: source.message };
  if (!source.value.length) return { cents: null, note: t('尚未记录收入，不代表本期无收入') };
  return { cents: source.value.reduce((sum, i) => sum + BigInt(i.fields.net_cents), 0n).toString(), note: t('{length} 笔已记录到账；公积金缴存单列', { length: source.value.length }) };
}
export function expenseMetric(source: FinanceRead<ExpenseView>): FactMetric {
  if (source.status === 'disabled') return { cents: null, note: source.reason };
  if (source.status === 'error') return { cents: null, note: source.message };
  const lines = source.value.lines.filter(countsAsSpending);
  if (!lines.length) return { cents: null, note: t('尚未记录重要支出，不代表本期无支出') };
  const unknown = lines.filter(l => l.amount_cents === null).length;
  return { cents: unknown === lines.length ? null : source.value.spent_cents, note: unknown ? t('仅已知部分；{unknown} 笔金额待补', { unknown }) : t('退款前；仅已启用来源') };
}
