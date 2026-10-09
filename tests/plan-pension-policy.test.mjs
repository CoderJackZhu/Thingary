import test from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/plan-pension.ts';
import { beijing } from '../src/plan-params.ts';

// Fictional inputs. These tests check specific policy clauses, not an approval
// to retire or the completeness of Beijing's benefit calculation.
// 人社部发〔2024〕94号 §7: early uses chosen year; delayed uses statutory year.
const profile = over => ({
  birth_month: '1970-01', worker: 'male', flex_months: 0,
  paid_months: 192, account_balance_cents: '0', base_cents: '1204900',
  past_index_hundredths: 100, personal_pension_annual_cents: '0', marginal_tax_hundredths: 0,
  assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 }, ...over,
});
const flat = { ...beijing, notional_rate_hundredths: 0, hpf_rate_hundredths: 0 };
const funds = { hpf_balance_cents: '0', hpf_monthly_cents: '0' };

test('flexible retirement uses the correct minimum-contribution reference year', () => {
  // Dates/month counts transcribed from the statutory schedule and §7, rather
  // than obtained from another production helper. No future months are added.
  const cases = [
    ['male', '1968-01', 36, '2031-11', 2028, 180],
    ['male', '1970-01', 36, '2034-05', 2031, 192],
    ['male', '1970-01', 0, '2031-05', 2031, 192],
    ['male', '1970-01', -16, '2030-01', 2030, 186],
    ['male', '1970-01', -36, '2030-01', 2030, 186],
    ['female_cadre', '1975-01', 36, '2034-05', 2031, 192],
    ['female_worker', '1980-01', 36, '2035-08', 2032, 198],
    ['male', '1990-01', 36, '2056-01', 2053, 240],
  ];
  for (const [worker, birth_month, flex_months, start, year, required] of cases) {
    for (const paid_months of [required - 1, required]) {
      const r = project(profile({ worker, birth_month, flex_months, paid_months }), flat, '2026-10-01', 0, funds);
      assert.deepEqual([r.start_month, r.required_year, r.required_months, r.eligible],
        [start, year, required, paid_months >= required], `${worker}/${birth_month}/${flex_months}/${paid_months}`);
    }
  }
});

test('2025 closed-form amount uses an explicitly supplied benefit base, not contribution upper bound / 3', () => {
  // Beijing 京人社发〔2025〕13号: 2025 benefit base = 12049 yuan.
  // Whole age 60, index 1, 20 years, account 139000 yuan / 139 months.
  // No historical gaps, deemed years, future interest, or future contributions.
  const r = project(profile({ birth_month: '1965-01', flex_months: -1, paid_months: 240, account_balance_cents: '13900000' }),
    { ...flat, avg_wage_cents: '1204900', avg_wage_year: 2024 }, '2025-01-01', 720, funds);
  assert.deepEqual([r.base_pension_nominal_cents, r.account_pension_nominal_cents, r.total_nominal_cents], [240980, 100000, 340980]);
  assert.equal(r.eligible, true);
});

test('pausing contributions preserves the account and its assumed interest; only paid months add 8%', () => {
  const p = profile({ birth_month: '1990-01', paid_months: 240, account_balance_cents: '1000000' });
  const phases = [{ from_age_months: 744, base_cents: 1204900, hpf_monthly_cents: 0 }];
  const r = project(p, flat, '2052-01-01', 756, funds, phases, age => age < 750 ? 1 : 0);
  assert.equal(r.total_paid_months, 246);
  assert.equal(r.account_at_start_cents, 1000000 + 6 * 1204900 * .08);
  const idle = project(p, { ...flat, notional_rate_hundredths: 300 }, '2052-01-01', 756, funds, phases, () => 1);
  assert.equal(idle.account_at_start_cents, 1030000);
  assert.equal(idle.total_paid_months, 240);
  assert.equal(idle.pots_today_cents, 0, 'social pension account is not an automatically refundable liquid pool');
});
