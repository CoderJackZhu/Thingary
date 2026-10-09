// Development-only fixture transform. The browser and action tests use the same batch.
import type { PlanningSources } from './plan-basic-contract.ts';
import { debtFirstMonth, debtMonth, debtMonthIndex } from './plan-debt.ts';
export function debtFixture(raw: PlanningSources, scenario = 'normal'): PlanningSources {
  const s = structuredClone(raw);
  if (s.profile.status !== 'ready' || !s.profile.value.saved || s.snapshot.status !== 'ready' || !s.snapshot.value) return s;
  const r = s.profile.value.saved.profile.retire, snapshot = s.snapshot.value;
  const debts = snapshot.entries.filter(e => e.counted && e.side === 'liability');
  if (['unknown', 'saved', 'changed', 'zero', 'empty'].includes(scenario)) r.core!.debt_repayments = debts.map(e => ({ account_id: e.account_id, recorded_on: scenario === 'changed' || scenario === 'zero' ? '2026-09-10' : s.today, as_of: scenario === 'changed' || scenario === 'zero' ? '2026-09-10' : snapshot.date, balance_cents: e.amount_cents!, before: 'scheduled', after: 'scheduled', start_month: debtFirstMonth(snapshot.date), last_month: scenario === 'unknown' ? null : debtMonth(debtMonthIndex(snapshot.date) + 24), monthly_cents: scenario === 'unknown' ? null : '200000' }));
  if (scenario === 'changed') debts[0].amount_cents = String(BigInt(debts[0].amount_cents!) / 2n);
  if (scenario === 'zero') debts[0].amount_cents = '0';
  if (scenario === 'empty') for (const e of debts) e.counted = false;
  return s;
}
