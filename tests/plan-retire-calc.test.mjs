import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import { basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';

const saved = spend => ({ revision: 1, updated_at: '2026-10-06', profile: {
  birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
  personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: defaultAssumptions, overrides: noOverrides, retire: { ...defaultRetire, target_age:50, core: { contract_version: 1, monetary_basis_date: '2026-10-06', fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }], hpf_monthly_cents: '0', occurrences: [] }, basic: {...structuredClone(basicInputFixtures.prediction.basic),start:{kind:'live'}}, spend_cents: spend },
} });
const snapshot = {id:'snapshot',revision:1,date:'2026-10-06', entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: '20000000' }] };
const review = { intervals: [], stats: { median_monthly_saving_cents: '1000000', median_monthly_spend_cents: '1700000' } };

test('a high historical spend never silently becomes the retirement budget', () => {
  const r = buildRetireCalc(saved(null), snapshot, review, [], '2026-10-06');
  assert.equal(r.derivedSpend, null);
  assert.equal(r.spend, null);
  assert.match(r.missing.join(' '), /预算/);
  for (const key of ['plan', 'proj', 'out', 'emergency']) assert.equal(r[key], undefined);
});

test('explicit monthly budget drives retirement and purchase estimates independently of history', () => {
  const r = buildRetireCalc(saved('500000'), snapshot, review, [], '2026-10-06');
  assert.equal(r.spend, 500000);
  assert.equal(r.plan.items[0].monthly_cents, 500000);
  assert.equal(r.derivedSpend, null);
  assert.deepEqual(r.missing, []);
  assert.ok(r.out);
  const changed = buildRetireCalc(saved('500000'), snapshot, { intervals: [], stats: { ...review.stats, median_monthly_spend_cents: '-100' } }, [], '2026-10-06');
  assert.deepEqual(changed.out, r.out);
});

test('a planning horizon not after today leaves the estimate unavailable instead of drawing an empty chart', () => {
  const old = saved('500000');
  old.profile.birth_month = '1930-01';
  const r = buildRetireCalc(old, snapshot, review, [], '2026-10-06');
  assert.match(r.missing.join(' '), /终点|目标年龄/);
  assert.equal(r.plan, undefined);
});
