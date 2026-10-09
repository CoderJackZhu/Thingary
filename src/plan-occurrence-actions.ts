import type { Occurrence } from './plan-core.ts';

/** Check the saved record, not a draft that might have cleared its facts. Explicit zero is a fact. */
export function occurrenceHasFacts(o: Occurrence): boolean {
  return o.loan != null || o.payments.some(p => p.amount_cents != null || p.account_id != null || p.absorbed_snapshot_id != null || p.absorbed_revision != null || p.source_kind != null || p.source_id != null);
}
export function canRetractOccurrence(o: Occurrence): boolean {
  return o.status === 'occurred' && !occurrenceHasFacts(o);
}
/** Existing events partition and receipt protocol apply; this helper never changes event definitions. */
export function retractOccurrence(occurrences: readonly Occurrence[], id: string): Occurrence[] {
  const saved = occurrences.find(o => o.id === id);
  if (saved && !canRetractOccurrence(saved)) throw new Error('这条发生记录已有实际事实，请在原来源核对更正。');
  return occurrences.filter(o => o.id !== id);
}
