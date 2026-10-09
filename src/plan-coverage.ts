// Read-only, component-level occurrence coverage. Persisted facts are never replaced with zeros.
import type { Snapshot } from './wealth.ts';
import type { PlanningCore } from './plan-core.ts';
import type { StoredLifeEvent } from './plan.ts';
import type { PlanningAnnotation } from './plan-basic-contract.ts';
import { occurrenceHasFacts } from './plan-occurrence-actions.ts';

export type EventCoverage = { paused: boolean; payment_ids: string[]; loan: boolean; holding: boolean; cycle: boolean };
export function eventCoverage(events: readonly StoredLifeEvent[], core: PlanningCore | null | undefined, snapshot: Snapshot | null, today: string, referenceIssues: readonly string[] = []) {
  const coverage: Record<string, EventCoverage> = {}, annotations: PlanningAnnotation[] = [], coveredDebts = new Set<string>();
  for (const e of events) {
    const o = core?.occurrences.find(o => o.event_id === e.id);
    const add = (reason_code: PlanningAnnotation['reason_code'], message: string, missing_fields: string[], effect: PlanningAnnotation['effect'] = 'requirement_lower') => annotations.push({ id: `${e.id}:${reason_code}`, reason_code, message: `${e.label}：${message}`, effect, treatment: 'omitted', source_ids: [`event:${e.id}`], missing_fields, refinement: { owner: 'events', field: 'core.occurrences', event_id: e.id } });
    if (!o) {
      const paused = e.date < today.slice(0, 7) || (!!snapshot && e.date < snapshot.date.slice(0, 7));
      coverage[e.id] = { paused, payment_ids: [], loan: !paused, holding: !paused, cycle: !paused };
      if (paused) add('EVENT_OVERDUE', '日期已过，待核对；未来付款和持有费未计入。', ['现实状态'], Number(e.rent_saved_cents) > 0 ? 'uncertain' : 'requirement_lower');
      continue;
    }
    if (o.status === 'cancelled') { coverage[e.id] = { paused: true, payment_ids: [], loan: false, holding: false, cycle: false }; continue; }
    const fields = new Set<string>(), payment_ids: string[] = [];
    for (const p of o.payments) {
      if (p.amount_cents === null) fields.add('付款金额');
      if (!p.account_id) fields.add('付款账户');
      const rule = core?.fund_rules.find(r => r.account_id === p.account_id);
      const entry = snapshot?.entries.find(x => x.account_id === p.account_id && x.counted && x.side === 'asset' && x.amount_cents !== null);
      const source = !!entry && rule?.availability === 'available' && rule.share_hundredths === 10000;
      if (p.account_id && !source) fields.add('付款来源范围');
      const absorbed = !!snapshot && p.date <= snapshot.date && p.absorbed_snapshot_id === snapshot.id && p.absorbed_revision === snapshot.revision;
      const after = !!snapshot && p.date > snapshot.date && !p.absorbed_snapshot_id && p.absorbed_revision === null;
      if (!absorbed && !after) fields.add('盘点吸收关系');
      const staleReference = !!p.source_id && referenceIssues.length > 0;
      if (staleReference) fields.add('实际来源引用');
      if (p.amount_cents !== null && source && (absorbed || after) && !staleReference) payment_ids.push(p.id);
    }
    if (!o.payments.length || !o.payments_complete) fields.add('剩余付款安排');
    if (fields.size) add('PAYMENT_PENDING', '部分付款未计入；还差：' + [...fields].join('、') + '。', [...fields]);
    const l = o.loan, entry = snapshot?.entries.find(x => x.account_id === l?.account_id && x.side === 'liability' && x.counted);
    const needsLoan = Number(e.price_cents) > Number(e.down_cents) || l !== null;
    const loan = !!l && !!snapshot && l.as_of === snapshot.date && entry?.amount_cents === l.principal_cents && (l.principal_cents === '0' || l.remaining_months > 0);
    if (loan) coveredDebts.add(l!.account_id);
    if (needsLoan && !loan) add('LOAN_PENDING', '还款接续未计入；还差：贷款余额、剩余期数或截至日/来源核对。', ['贷款余额/剩余期/截至日']);
    // A blank accidental occurred row cannot start maintenance or recurring replacement.
    const hasFacts = occurrenceHasFacts(o);
    coverage[e.id] = { paused: false, payment_ids, loan, holding: hasFacts, cycle: hasFacts && fields.size === 0 && (!needsLoan || loan) };
  }
  for (const e of snapshot?.entries ?? []) if (e.counted && e.side === 'liability' && e.amount_cents !== null && Number(e.amount_cents) > 0 && !coveredDebts.has(e.account_id)) {
    // One stable debt, one omission; do not count the linked event's unresolved debt again.
    if (events.some(event => core?.occurrences.some(o => o.event_id === event.id && o.loan?.account_id === e.account_id))) continue;
    annotations.push({ id: `debt:${e.account_id}`, reason_code: 'DEBT_UNLINKED', message: '已有负债尚未建立还款接续，未来还款未计入；负债余额保留。', effect: 'requirement_lower', treatment: 'omitted', source_ids: [`debt:${e.account_id}`], missing_fields: ['还款接续'], refinement: { owner: 'events', field: 'core.occurrences' } });
  }
  if (referenceIssues.length) annotations.push({ id: 'references', reason_code: 'REFERENCE_PENDING', message: '实际来源待核对：' + referenceIssues.join('；'), effect: 'uncertain', treatment: 'omitted', source_ids: ['references'], missing_fields: ['实际来源引用'], refinement: { owner: 'events', field: 'reference_issues' } });
  return { coverage, annotations };
}
