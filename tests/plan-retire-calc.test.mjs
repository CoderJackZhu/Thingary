import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetireCalc, expectedSaving } from '../src/plan-retire-calc.ts';
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
  for (const key of ['plan', 'proj', 'out', 'emergency']) assert.equal(r[key], undefined);
});

test('explicit monthly budget drives retirement and purchase estimates independently of history', () => {
  const r = buildRetireCalc(saved('500000'), snapshot, review, [], '2026-10-06');
  assert.equal(r.spend, 500000);
  assert.equal(r.plan.items[0].monthly_cents, 500000);
  assert.equal(r.derivedSpend, 1700000);
  assert.deepEqual(r.missing, []);
  assert.ok(r.out);
  const changed = buildRetireCalc(saved('500000'), snapshot, { stats: { ...review.stats, median_monthly_spend_cents: '-100' } }, [], '2026-10-06');
  assert.deepEqual(changed.out, r.out);
});

test('a planning horizon not after today leaves the estimate unavailable instead of drawing an empty chart', () => {
  const old = saved('500000');
  old.profile.birth_month = '1930-01';
  const r = buildRetireCalc(old, snapshot, review, [], '2026-10-06');
  assert.match(r.missing.join(' '), /规划终点年龄至少要比当前年龄晚一年/);
  assert.equal(r.plan, undefined);
});

test('saving phases replace the measured median, and the average gap share weighs working phases only', () => {
  const s = saved('500000');
  s.profile.retire = { ...s.profile.retire, saving_phases: [
    { id: 'a', label: '空窗期', from_age_months: 0, monthly_cents: -600000 },
    { id: 'b', label: '有收入', from_age_months: 440, monthly_cents: 1700000 },
    { id: 'c', label: '清闲', from_age_months: 540, monthly_cents: 800000 },
  ], gap_share_hundredths: 1000 };
  const r = buildRetireCalc(s, snapshot, { stats: { median_monthly_saving_cents: null, median_monthly_spend_cents: null } }, [], '2026-10-06');
  assert.deepEqual(r.missing, []);
  assert.equal(r.saving, -600000);
  assert.equal(r.measured, null);
  // 10% 的月份没有收入、那时按日常生活预算 5000 元花存款：17000×0.9 − 5000×0.1 = 14800 元。
  assert.deepEqual(r.plan.saving_phases.map(p => p.cents), [-600000, 1480000, 670000]);
  assert.equal(expectedSaving(1700000, 0, 500000), 1700000);
  assert.equal(expectedSaving(-100, 1000, 500000), -100);
  // 不分阶段时仍用盘点中位数，空窗比例不起作用。
  const plain = buildRetireCalc(saved('500000'), snapshot, review, [], '2026-10-06');
  assert.equal(plain.plan.saving_phases, undefined);
  assert.equal(plain.plan.saving_cents, 1000000);
});
