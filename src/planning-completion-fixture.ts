// Development-only fixtures shared by the preview and handler acceptance tests.
import type { PlanningSources } from './plan.ts';
import { pensionFixture } from './planning-pension-fixture.ts';
export function completionFixture(raw: PlanningSources, scenario = 'funds'): PlanningSources {
  const s = pensionFixture(raw);
  if (s.profile.status !== 'ready' || !s.profile.value.saved) return s;
  const p = s.profile.value.saved.profile, r = p.retire, b = r.basic!, c = r.core!;
  if (['funds', 'pension'].includes(scenario)) {
    b.retirement_income.mode = 'employee';
    b.pension_contributions = { start_month: '2026-10', stop_month: '2050-06', base_cents: '2000000' }; c.hpf_monthly_cents = '0';
  }
  if (scenario === 'funds') { p.personal_pension_annual_cents = '1200000'; c.personal_pension_balance_confirmed = false; b.contribution_costs = [{ source_id: 'personal_pension', treatment: 'extra', reference_cents: null }]; b.retirement_costs = [{ source_id: 'personal_pension', treatment: 'extra', reference_cents: null }]; }
  if (scenario === 'pension') { p.worker = null; p.paid_months = null; }
  if (scenario === 'transfer') { p.personal_pension_annual_cents = '1200000'; b.pension_contributions.start_month = '2026-10'; b.contribution_costs = [{ source_id: 'personal_pension', treatment: 'extra', reference_cents: null }]; b.retirement_costs = [{ source_id: 'personal_pension', treatment: 'extra', reference_cents: null }]; }
  if (scenario === 'contribution') b.contribution.monthly_cents = null;
  if (scenario === 'income') b.retirement_income = { mode: 'manual', selected: [{ id: 'missing-income', source_id: 'missing-income', role: 'other' }] };
  if (scenario === 'assumptions') { p.birth_month = '1940-06'; r.target_age = 80; r.horizon_age = 81; }
  if (scenario === 'debts') c.debt_repayments = [];
  if (scenario === 'costs') r.rent_cents = '50000';
  if (scenario.startsWith('event')) r.life_events = [{ id: 'fictional-overdue', label: '虚构旧车计划', kind: 'other', date: '2026-09', price_cents: '1000000', down_cents: '1000000', extra_cents: '0', loan_years: 1, loan_rate_hundredths: 0, holding_cents: '0', resale_cents: '0', cycle_years: null, until_age: null, rent_saved_cents: '0', included: true }];
  if (scenario === 'debt-balance') c.debt_repayments![0].balance_cents = '1';
  if (scenario === 'event-actual' && s.snapshot.status === 'ready' && s.snapshot.value) {
    const snap = s.snapshot.value, account = snap.entries.find(e => e.kind === 'cash' && e.counted && e.side === 'asset')!;
    c.occurrences = [{ id: 'fictional-actual', event_id: 'fictional-overdue', status: 'occurred', actual_date: s.today, payments_complete: true, payments: [{ id: 'fictional-payment', date: s.today, amount_cents: null, account_id: account.account_id, absorbed_snapshot_id: snap.id, absorbed_revision: snap.revision, source_kind: null, source_id: null }], loan: null }];
  }
  return s;
}
