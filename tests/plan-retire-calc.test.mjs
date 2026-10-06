import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import { defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';

const saved = spend => ({ revision: 1, updated_at: '2026-10-06', profile: {
  birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
  personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: defaultAssumptions, overrides: noOverrides, retire: { ...defaultRetire, spend_cents: spend },
} });
const snapshot = { entries: [{ counted: true, side: 'asset', kind: 'cash', amount_cents: '20000000' }] };
const review = { stats: { median_monthly_saving_cents: '1000000', median_monthly_spend_cents: '1700000' } };

test('a high historical spend never silently becomes the retirement budget', () => {
  const r = buildRetireCalc(saved(null), snapshot, review, [], '2026-10-06');
  assert.equal(r.derivedSpend, 1700000);
  assert.equal(r.spend, null);
  assert.match(r.missing.join(' '), /请填写退休后月预算/);
  for (const key of ['L', 'fire', 'trad', 'sens', 'emergency', 'required_now']) assert.equal(r[key], undefined);
});

test('explicit monthly budget drives retirement and purchase estimates independently of history', () => {
  const r = buildRetireCalc(saved('500000'), snapshot, review, [], '2026-10-06');
  assert.equal(r.spend, 500000);
  assert.equal(r.L.spend_cents, 500000);
  assert.equal(r.derivedSpend, 1700000);
  assert.deepEqual(r.missing, []);
  assert.ok(r.fire);
  const changed = buildRetireCalc(saved('500000'), snapshot, { stats: { ...review.stats, median_monthly_spend_cents: '-100' } }, [], '2026-10-06');
  assert.deepEqual(changed.fire, r.fire);
});
