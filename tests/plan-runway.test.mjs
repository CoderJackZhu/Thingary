import test from 'node:test';
import assert from 'node:assert/strict';
import { runway } from '../src/plan-runway.ts';
import { runwayLines } from '../src/planning-basic-view.ts';
const run = (start, income, spend, floor = null, months = 60) => runway({ start_cents: start * 100, income_cents: income * 100, spend_cents: spend * 100, floor_cents: floor === null ? null : floor * 100, months });
const fmt = c => `¥${Number(c) / 100}`;
test('20 complete payments without income; exact zero is distinct from a payment gap', () => {
  const r = run(100000, 0, 5000, 0);
  assert.equal(r.status, 'payment_gap'); assert.equal(r.covered_months, 20);
  assert.equal(r.remaining_cents, 0); assert.equal(r.floor_month, 20);
});
test('month-end income does not fund month-start payment: 48 complete months, cash remains', () => {
  const r = run(100000, 3000, 5000);
  assert.equal(r.status, 'payment_gap'); assert.equal(r.covered_months, 48);
  assert.equal(r.remaining_cents, 400000);
  assert.match(runwayLines(r, { set: false, cents: '0' }, fmt).main, /第 49 个月月初尚余 ¥4000/);
});
test('income equal to or above spending still checks first payment and floor', () => {
  for (const income of [5000, 8000]) {
    assert.equal(run(100000, income, 5000).status, 'not_reached');
    assert.equal(run(20000, income, 5000, 30000).floor_month, 0);
    const r = run(32000, income, 5000, 30000);
    assert.equal(r.status, 'not_reached'); assert.equal(r.floor_month, 1);
    assert.match(runwayLines(r, { set: true, cents: '3000000' }, fmt).floor, /第 1 个月月初付款后触及/);
  }
  assert.equal(run(3000, 8000, 5000).covered_months, 0);
});
test('floor checked before end income, including 14th payment and exact boundary', () => {
  assert.equal(run(100000, 0, 5000, 30000).floor_month, 14);
  assert.equal(run(100000, 3000, 5000, 30000).floor_month, 34);
  assert.equal(run(100000, 3000, 5000, 0).floor_month, null); // stops before failing payment, no invented zero
  const r = run(20000, 0, 5000, 30000);
  assert.equal(r.floor_month, 0); assert.equal(r.floor_gap_cents, 1000000);
});
test('chosen horizon bounds claims and never suppresses an earlier floor breach', () => {
  const r = run(100000, 0, 5000, 30000, 12);
  assert.equal(r.status, 'not_reached'); assert.equal(r.checked_months, 12); assert.equal(r.floor_month, null);
  const r2 = run(100000, 0, 5000, 30000, 15);
  assert.equal(r2.status, 'not_reached'); assert.equal(r2.floor_month, 14);
});
test('bad inputs, unsafe balances and invalid horizons are rejected', () => {
  for (const bad of [{ spend_cents: 0 }, { spend_cents: -1 }, { income_cents: -1 }, { floor_cents: -1 }, { start_cents: -1 }, { income_cents: 1.5 }, { months: 0 }, { months: 1201 }, { months: 1.5 }]) {
    assert.equal(runway({ start_cents: 1000000, income_cents: 0, spend_cents: 100000, floor_cents: null, ...bad }).status, 'invalid');
  }
  assert.equal(runway({ start_cents: Number.MAX_SAFE_INTEGER, income_cents: 100, spend_cents: 1, floor_cents: null }).status, 'invalid');
});
test('wording distinguishes no floor, known floor breach and unknown future after a gap', () => {
  assert.match(runwayLines(run(100000, 5000, 5000), { set: false, cents: '0' }, fmt).floor, /只检查支付能力/);
  assert.match(runwayLines(run(100000, 5000, 5000), { set: false, cents: '0' }, fmt).main, /60 个月.*不保证未来安全/);
  assert.match(runwayLines(run(20000, 0, 5000, 30000), { set: true, cents: '3000000' }, fmt).floor, /差 ¥10000/);
  assert.match(runwayLines(run(100000, 3000, 5000, 0), { set: true, cents: '0' }, fmt).floor, /无法支付之后的余额不再推演/);
});
