// Fictional planning inputs shared by regression tests and executable model audits.
import { defaultRetire } from '../../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../../src/plan-params.ts';
import { unknownBasicUpdate } from '../../src/plan-basic-fixtures.ts';
const ready = value => ({ status: 'ready', value });
const error = { status: 'error', value: { code: 'FICTIONAL', message: '虚构独立来源故障' } };
export function fictionalSources(contribution = null) {
  const f = structuredClone(unknownBasicUpdate.fields);
  f.basic.contribution.monthly_cents = contribution;
  const profile = { birth_month: f.birth_month, worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null, assumptions: { ...defaultAssumptions, inflation_hundredths: 0 }, overrides: noOverrides, retire: { ...structuredClone(defaultRetire), spend_cents: f.spend_cents, target_age: f.target_age, horizon_age: f.horizon_age, mode: f.mode, real_return_before_hundredths: f.real_return_before_hundredths, real_return_after_hundredths: f.real_return_after_hundredths, volatility_hundredths: f.volatility_hundredths, emergency_months: f.emergency_months, basic: f.basic, core: { contract_version: 1, monetary_basis_date: f.monetary_basis_date, fund_rules: [], hpf_monthly_cents: null, occurrences: [] } } };
  return { generation: 'fictional', write_version: 1, today: '2026-10-07', modules: { planning: true, wealth: false }, profile: ready({ generation: 'fictional', saved: { revision: 1, updated_at: '2026-10-07', profile } }), snapshot: error, accounts: error, review: error, incomes: error };
}
