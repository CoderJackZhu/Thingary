// Fictional variant of the career fixture that counts the Beijing pension (same shape the tests use).
import type { PlanningSources } from '../plan-basic-contract.ts';
import { careerSources } from './fixtures.ts';

export function careerPensionSources(): PlanningSources {
  const s = careerSources();
  if (s.profile.status !== 'ready' || !s.profile.value.saved) return s;
  const p = s.profile.value.saved.profile, ret = p.retire, basic = ret.basic!;
  Object.assign(p, { worker: 'male', region: 'beijing', paid_months: 200, account_balance_cents: '5000000', base_cents: '1000000', past_index_hundredths: 100, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 0 });
  p.assumptions.wage_growth_hundredths = 0;
  ret.core!.hpf_monthly_cents = '100000';
  basic.retirement_income = { mode: 'beijing', selected: [] };
  basic.pension_contributions = { start_month: '2026-10', stop_month: '2044-10', base_cents: '1000000' };
  return s;
}

/** Independent no-pool example; the existing pension sample's housing fund is preserved. */
export function careerRetirementSources(): PlanningSources {
  const s = careerSources();
  if (s.profile.status === 'ready' && s.profile.value.saved) {
    const r = s.profile.value.saved.profile.retire;
    r.basic!.retirement_income = { mode: 'beijing', selected: [] };
    r.income_items = [
      { id: 'fictional-manual', label: '虚构手填养老金', monthly_cents: '100000', start_age: 63, end_age: null, indexed: true },
      { id: 'fictional-annuity', label: '虚构年金', monthly_cents: '50000', start_age: 63, end_age: 70, indexed: false },
    ];
  }
  return s;
}
