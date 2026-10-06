import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvents, eventImpact, eventParts, monthlyPayment, offsetOf, totalImpact } from '../src/plan-events.ts';
import { project, savingsOf } from '../src/plan-ledger.ts';

const none = () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 });
const plan = (over = {}) => ({
  now_months: 360, horizon_months: 1080, search_cap_months: 840, target_months: 360, mode: 'fire', assets_cents: 0, saving_cents: 1000, saving_growth_hundredths: 0,
  r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 0,
  items: [{ id: 'l', label: '生活', monthly_cents: 1000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }], incomes: [], pension_at: none, spends: [], ...over,
});
const ev = (over = {}) => ({ id: 'e', label: '房', kind: 'house', date: '2033-10', included: true, price_cents: 450_000_000, down_cents: 150_000_000, extra_cents: 10_000_000, loan_rate_hundredths: 350, loan_years: 30, holding_cents: 150_000, rent_saved_cents: 270_000, cycle_years: null, until_age: null, resale_cents: 0, ...over });

test('offset in months is calendar based and preserves overdue dates', () => {
  assert.equal(offsetOf('2033-10', '2026-10-06'), 84);
  assert.equal(offsetOf('2026-10', '2026-10-31'), 0);
  assert.equal(offsetOf('2025-01', '2026-10-06'), -21);
});

test('the monthly payment amortises the loan to zero', () => {
  const principal = 3_000_000_00, rate = 350, n = 360, pay = monthlyPayment(principal, rate, n);
  let balance = principal;
  for (let k = 0; k < n; k++) balance = balance * (1 + rate / 10000 / 12) - pay;
  assert.ok(Math.abs(balance) < 1, `left ${balance}`);
  assert.equal(monthlyPayment(1200, 0, 12), 100);
  assert.equal(monthlyPayment(0, 350, 360), 0);
});

test('a house becomes a cash outlay now and, after purchase, a nominal mortgage, holding cost and saved rent', () => {
  const P = plan(), x = eventParts(P, ev(), 84);
  assert.deepEqual(x.spends, [{ offset_months: 84, cents: 150_000_000 + 10_000_000 }]);
  const m0 = 360 + 84;
  const mort = x.spend_flows.find(f => f.label === '房月供');
  assert.deepEqual([mort.from_month, mort.to_month, mort.nominal, mort.essential], [m0, m0 + 360, true, true]);
  assert.ok(Math.abs(x.principal_cents - 300_000_000 * 1.02 ** 7) < 1);
  assert.equal(x.saving_flows.find(f => f.label === '房月供').cents, -x.payment_cents);
  const hold = x.spend_flows.find(f => f.label === '房持有成本');
  assert.deepEqual([hold.cents, hold.to_month, hold.nominal], [150_000, null, false]);
  assert.equal(x.saving_flows.find(f => f.label === '房省下的房租').cents, 270_000);
  assert.equal(x.spend_flows.some(f => f.label.includes('房租')), false);
  // 全款没有月供。
  assert.equal(eventParts(P, ev({ down_cents: 450_000_000 }), 84).spend_flows.some(f => f.label.endsWith('月供')), false);
});

test('a car is bought once and replaced every cycle until the stop age, each time at the price minus the old car', () => {
  const P = plan(), c = ev({ kind: 'car', label: '车', price_cents: 7_000_000, down_cents: 7_000_000, extra_cents: 0, holding_cents: 120_000, rent_saved_cents: 0, cycle_years: 5, until_age: 50, resale_cents: 2_000_000 });
  // 现在 30 岁，24 个月后买；到 50 岁（600 月龄）：购买 384，换车 444、504、564。
  const x = eventParts(P, c, 24);
  assert.deepEqual(x.spends.map(s => [s.offset_months, s.cents]), [[24, 7_000_000], [84, 5_000_000], [144, 5_000_000], [204, 5_000_000]]);
  const hold = x.spend_flows[0];
  assert.deepEqual([hold.label, hold.from_month, hold.to_month, hold.essential], ['车养车', 384, 600, false]);
  assert.equal(eventParts(P, { ...c, cycle_years: null }, 24).spends.length, 1);
});

test('applying events leaves the base plan untouched and moves financial independence later', () => {
  const P = plan({ assets_cents: 100_000, saving_cents: 5000 }), e = ev({ price_cents: 200_000, down_cents: 200_000, extra_cents: 0, holding_cents: 0, rent_saved_cents: 0, date: '2028-10' });
  const with1 = applyEvents(P, [{ e, offset: 24 }]);
  assert.equal(P.spends.length, 0);
  assert.equal(with1.spends.length, 1);
  assert.ok(project(with1, 0).fi_month > project(P, 0).fi_month);
  const t = totalImpact(P, [{ e, offset: 24 }]);
  assert.equal(t.delay_months, project(with1, 0).fi_month - project(P, 0).fi_month);
  // 持续支出也会推迟；省下的房租会抵消一部分。
  const mortgage = ev({ price_cents: 300_000, down_cents: 100_000, extra_cents: 0, loan_rate_hundredths: 0, loan_years: 10, holding_cents: 0, rent_saved_cents: 0 });
  const withRent = { ...mortgage, rent_saved_cents: 800 };
  const a = totalImpact(P, [{ e: mortgage, offset: 12 }]), b = totalImpact(P, [{ e: withRent, offset: 12 }]);
  assert.ok(b.delay_months < a.delay_months);
});

test('impact: can the down payment be afforded, when at the earliest, and does the payment leave any saving', () => {
  const P = plan({ saving_cents: 1000 });
  const e = ev({ price_cents: 20_000, down_cents: 5000, extra_cents: 0, loan_rate_hundredths: 0, loan_years: 1, holding_cents: 0, rent_saved_cents: 0, date: '2027-04' });
  const i = eventImpact(P, e, 6, 0);
  assert.equal(i.cash_needed, 5000);
  assert.equal(i.assets_at_date, 6000);
  assert.equal(i.short, 0);
  assert.equal(i.earliest_offset, 5);
  assert.ok(i.payment_nominal > 0);
  // 月供 15000/12 > 每月储蓄 1000：买后每月储蓄为负，需要收入支撑。
  assert.equal(i.saving_not_positive, true);
  const short = eventImpact(P, ev({ ...e, down_cents: 20_000 }), 6, 3000);
  assert.equal(short.short, 20_000 + 3000 - 6000);
  assert.equal(short.earliest_offset, 23);
  assert.deepEqual(i.sweep.map(s => s.years), [5, 7, 10]);
  const rich = plan({ assets_cents: 10_000_000, saving_cents: 100_000 });
  assert.equal(eventImpact(rich, e, 6, 0).saving_not_positive, false);
  assert.ok(savingsOf(applyEvents(rich, [{ e, offset: 6 }]))[6] < savingsOf(rich)[6]);
});
