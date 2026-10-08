// Only fictional sources; this preview never imports native services or opens a library.
import type { PlanningSources, BasicInputs } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { defaultRetire } from '../plan.ts';
import { defaultAssumptions, noOverrides } from '../plan-params.ts';
import { emptyCore } from '../plan-core.ts';
import { unknownBasicUpdate } from '../plan-basic-fixtures.ts';

export function careerSources(): PlanningSources {
  const basic: BasicInputs = structuredClone(unknownBasicUpdate.fields.basic);
  basic.start = { kind: 'simulation', id: 'fictional-career', available_cents: '60000000', date: '2026-09-30', notes: '完全虚构的职业变化用例' };
  basic.contribution.monthly_cents = '1500000';
  const profile = {
    birth_month: '1994-10', worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null,
    past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null,
    assumptions: { ...defaultAssumptions, inflation_hundredths: 0 }, overrides: { ...noOverrides },
    retire: { ...structuredClone(defaultRetire), basic, spend_cents: '375000', target_age: 50, horizon_age: 90,
      real_return_before_hundredths: 0, real_return_after_hundredths: 0, volatility_hundredths: 0,
      core: emptyCore('2026-09-30') },
  };
  return { generation: 'fictional-career', write_version: 1, today: '2026-10-01', modules: { planning: true, wealth: false },
    profile: { status: 'ready', value: { generation: 'fictional-career', saved: { revision: 1, updated_at: '2026-10-01', profile } } },
    snapshot: { status: 'ready', value: null }, accounts: { status: 'ready', value: [] }, incomes: { status: 'ready', value: [] },
    review: { status: 'error', value: { code: 'UNAVAILABLE', message: '虚构样例不读取历史资料' } } };
}
export function careerDraft(): CareerDraft {
  return { transition_month: '2029-10', gap_months: 12, check_until_month: null,
    gap: { income_cents: '0', spend_cents: '1000000', budget_scope: 'complete', costs: [], pension: 'unchanged', insurance: { monthly_cents: '0', included: false } },
    recovery: { monthly_cents: null, costs: [], pension: 'unchanged', insurance: { monthly_cents: '0', included: false } },
    liquid_funds_confirmed: true, floor_cents: null };
}
