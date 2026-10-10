// Development-only transform shared by browser acceptance and production-handler tests.
import type { PlanningSources } from './plan-basic-contract.ts';
export function pensionFixture(raw: PlanningSources, scenario = 'normal'): PlanningSources {
  const s = structuredClone(raw);
  s.generation = 'fictional-pension-loops';
  if (s.profile.status !== 'ready' || !s.profile.value.saved || s.snapshot.status !== 'ready' || !s.snapshot.value) return s;
  const p = s.profile.value.saved.profile, r = p.retire;
  s.profile.value.generation = s.generation;
  // Keep the same inventory batch; loans are already declared within monthly spending.
  r.core!.debt_repayments = s.snapshot.value.entries.filter(e => e.counted && e.side === 'liability').map(e => ({ account_id: e.account_id, recorded_on: s.today, as_of: s.snapshot.status === 'ready' ? s.snapshot.value!.date : s.today, balance_cents: e.amount_cents!, before: 'included', after: 'included', start_month: s.today.slice(0, 7), last_month: null, monthly_cents: null }));
  r.core!.personal_pension_balance_confirmed = true;
  if (scenario === 'unknown' || scenario === 'blocked') { r.basic!.retirement_income.mode = 'beijing'; p.worker = null; p.paid_months = null; }
  if (scenario.startsWith('transfer')) { r.basic!.retirement_income.mode = scenario === 'transfer-manual' ? 'manual' : scenario === 'transfer-excluded' ? 'excluded' : 'beijing'; p.personal_pension_annual_cents = '1200000'; r.basic!.pension_contributions.start_month = '2026-10'; r.basic!.contribution_costs = [{ source_id: 'personal_pension', treatment: 'extra', reference_cents: null }]; r.basic!.retirement_costs = [{ source_id: 'personal_pension', treatment: 'extra', reference_cents: null }]; }
  if (scenario === 'empty') s.profile.value.saved = null;
  return s;
}
