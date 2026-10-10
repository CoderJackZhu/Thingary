import test from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/plan-pension.ts';
import { beijing } from '../src/plan-params.ts';

// 虚构资料，数字好算。
const profile = { birth_month: '1990-06', worker: 'male', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 } };
const region = { ...beijing, notional_rate_hundredths: 0, hpf_rate_hundredths: 0 };
const funds = { hpf_balance_cents: '0', hpf_monthly_cents: '300000' };
const TODAY = '2026-10-06';

test('gap months that stop contributions lower the contribution months, the provident fund and the pension', () => {
  const full = project(profile, region, TODAY, 756, funds);
  const gappy = project(profile, region, TODAY, 756, funds, [], m => (m < 600 ? 1 : 0));
  assert.ok(gappy.total_paid_months < full.total_paid_months);
  assert.equal(full.total_paid_months - gappy.total_paid_months, 600 - 436);
  assert.ok(gappy.hpf_at_start_cents < full.hpf_at_start_cents && gappy.total_today_cents < full.total_today_cents);
  const half = project(profile, region, TODAY, 756, funds, [], () => 0.5);
  assert.equal(full.total_paid_months - half.total_paid_months, Math.round((756 - 436) / 2));
  assert.deepEqual(project(profile, region, TODAY, 756, funds, [], () => 0), full, 'no idle share changes nothing');
});
