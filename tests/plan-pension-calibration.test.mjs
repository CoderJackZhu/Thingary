import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateBeijingBenefit } from '../src/plan-pension-policy.ts';
import { project } from '../src/plan-pension.ts';
import { beijing } from '../src/plan-params.ts';

// Frozen outputs of the official historical calculator's amount functions,
// not production-derived expectations. Source/hash/method travel with the data.
const samples = JSON.parse(fs.readFileSync(new URL('./fixtures/beijing-pension-calibration.json', import.meta.url), 'utf8'));
const source = { basis: 'assumption', source: 'Fictional calibration input; not approved entitlement' };
const cents = s => s.replace('.', '');
for (const c of samples.cases) {
  test(`Beijing explicit amount matches official calculator sample: ${c.id}`, () => {
    const r = calculateBeijingBenefit({ scope: 'beijing-enterprise-post-1998', birth_month: '1965-01', worker: 'male', flex_months: -1,
      paid_months_at_retirement: c.paid, average_index: { ten_thousandths: Math.round(c.index * 10000), ...source },
      benefit_base: { cents: cents(c.base), year: 2025, ...source }, account_at_retirement: { cents: cents(c.account), ...source },
      disbursement: { months: 139, ...source } });
    assert.equal(r.status, 'ready');
    assert.deepEqual([r.value.base_monthly_cents, r.value.account_monthly_cents, r.value.total_monthly_cents],
      [c.expected.base_cents, c.expected.account_cents, c.expected.total_cents]);
  });
}
test('ordinary projection preserves supplied low/high historical indices in the supported no-future whole-year case', () => {
  for (const c of samples.cases.filter(c => ['whole-years', 'low-confirmed-index', 'high-confirmed-index'].includes(c.id))) {
    const p = { birth_month: '1965-01', worker: 'male', flex_months: -1, paid_months: c.paid,
      account_balance_cents: cents(c.account), base_cents: '1204900', past_index_hundredths: Math.round(c.index * 100),
      personal_pension_annual_cents: '0', marginal_tax_hundredths: 0,
      assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 } };
    const r = project(p, { ...beijing, avg_wage_cents: cents(c.base), avg_wage_year: 2024, notional_rate_hundredths: 0 },
      '2025-01-01', 720, { hpf_balance_cents: '0', hpf_monthly_cents: '0' });
    assert.deepEqual([r.base_pension_nominal_cents, r.account_pension_nominal_cents, r.total_nominal_cents],
      [c.expected.base_cents, c.expected.account_cents, c.expected.total_cents], c.id);
  }
});
