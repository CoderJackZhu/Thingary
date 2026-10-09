import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceCareer, referenceMaxGap } from './helpers/career-reference.mjs';
import { inputs, cases } from './helpers/career-benchmark.mjs';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { maxGap } from '../src/plan-career-map.ts';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.02, `${message}: ${actual} vs ${expected}`);
for (const [name, o] of cases) test(`independent reference: ${name}`, () => {
  const { s, d } = inputs(o), expected = referenceCareer(o), result = evaluateCareerScenario(s, d);
  assert.equal(result.prediction.status, 'ready', JSON.stringify(result.prediction));
  const v = result.prediction.value;
  // Compare every accumulation month's start/end, not merely the final integer month.
  for (let m = 0; m < expected.rows.length; m++) {
    near(v.projection.assets[m + (o.firstFraction === undefined ? 1 : 0)], expected.rows[m].start, `month ${m} opening`);
    near(v.projection.assets[m + (o.firstFraction === undefined ? 2 : 1)], expected.rows[m].end, `month ${m} closing`);
  }
  for (const row of expected.retirementRows) {
    const offset = expected.rows.length + (o.firstFraction === undefined ? 1 : 0) + row.k;
    near(v.projection.assets[offset], row.start, `retirement month ${row.k} opening`);
    near(v.projection.assets[offset + 1], row.end, `retirement month ${row.k} closing`);
    near(v.projection.unfunded[offset], row.unfunded, `retirement month ${row.k} unmet budget`);
  }
  near(v.outcome.assets_at_goal, expected.assets, 'goal assets');
  near(v.outcome.required_at_goal, expected.required, 'discounted retirement budget');
  if ((o.gap ?? 12) > 0) near(Number(result.cash.value.minimum_cents), Math.round(expected.minimum), 'gap minimum');
});

test('independent max-gap oracle and closed form agree, including the next-month failure', () => {
  for (const [o, expected] of [[{}, 26], [{ gapInsurance: 200_000 }, 23], [{ gapInsurance: 200_000, gapIncluded: true }, 26], [{ recovery: 500_000 }, 16], [{ gapInsurance: 200_000, recovery: 500_000 }, 14], [{ gapInsurance: 200_000, spend: 1_100_000 }, 22]]) {
    assert.equal(referenceMaxGap(o), expected);
    assert.equal(referenceCareer({ ...o, gap: expected }).meets, true);
    assert.equal(referenceCareer({ ...o, gap: expected + 1 }).meets, false);
    const { s, d } = inputs(o); assert.equal(maxGap(s, d).months, expected);
  }
});

test('independent month-start shortfall cannot be repaired by month-end benefit or severance', () => {
  const o = { start: 500_000, preMonths: 0, gap: 1, spend: 1_000_000, lump: 2_000_000, income: 1_000_000 };
  const ref = referenceCareer(o), { s, d } = inputs(o), result = evaluateCareerScenario(s, d);
  assert.equal(ref.firstFailure, 0); assert.equal(ref.minimum, -500_000);
  assert.equal(result.cash.value.first_shortfall_month, '2026-10');
  assert.equal(result.cash.value.minimum_cents, '-500000');
  assert.equal(result.requirement.value.status, 'prefix_payment_gap');
});

test('independent purchasing-power conversion at a different basis date', () => {
  const { s, d } = inputs({ inflation: .025 });
  s.profile.value.saved.profile.retire.core.monetary_basis_date = '2025-09-30';
  const ref = referenceCareer({ start: 60_000_000 / 1.025 ** (365 / 365.25) });
  const v = evaluateCareerScenario(s, d).prediction.value;
  near(v.outcome.assets_at_goal, ref.assets, 'converted start flows to goal');
});

test('independent closed-form required contribution and one-cent boundary', () => {
  // 60万 + 36*1.5万 - 12*1万 = 102万; (180万 - 102万)/168.
  const required = Math.ceil((180_000_000 - (60_000_000 + 36 * 1_500_000 - 12 * 1_000_000)) / 168);
  const { s, d } = inputs();
  assert.equal(evaluateCareerScenario(s, d).requirement.value.monthly_cents, String(required));
  assert.equal(referenceCareer({ recovery: required }).meets, true);
  assert.equal(referenceCareer({ recovery: required - 1 }).meets, false);
});

test('independent local reference preserves unknown recovery without manufacturing long-term answers', () => {
  const { s, d } = inputs({ preMonths: 0, gap: 6, gapInsurance: 200_000 });
  const ref = referenceCareer({ preMonths: 0, gap: 6, gapInsurance: 200_000 });
  d.gap_months = null; d.check_until_month = '2027-04'; d.recovery.pension = null;
  const result = evaluateCareerScenario(s, d);
  assert.equal(result.cash.value.minimum_cents, String(Math.round(ref.minimum)));
  assert.equal(result.cash.value.until_month, '2027-04');
  assert.equal(result.requirement.status, 'blocked'); assert.equal(result.prediction.status, 'blocked');
});

test('independent benefit ledger enumerates feasible gaps that do not start at zero', () => {
  const o = { recovery: 0, benefit: 10_000_000, benefitMonths: 12 };
  const feasible = [];
  for (let gap = 0; gap < 180; gap++) if (referenceCareer({ ...o, gap }).meets) feasible.push(gap);
  assert.deepEqual(feasible, Array.from({ length: 47 }, (_, i) => i + 8));
  const { s, d } = inputs(o), result = maxGap(s, d);
  assert.deepEqual(result.ranges, [{ from: feasible[0], to: feasible.at(-1) }]);
  assert.equal(result.months, feasible.at(-1));
});

test('independent delayed inflow creates two separated feasible gap ranges', () => {
  const o = { start: 1_000_000, preMonths: 0, spend: 100_000, recovery: 1_000_000, recoveryInsurance: 900_000, recoveryIncluded: true, retirementSpend: 100_000, lumps: [{ month: 4, cents: 2_000_000 }] };
  const ranges = [];
  for (let gap = 0; gap < 216; gap++) if (referenceCareer({ ...o, gap }).meets) {
    const last = ranges.at(-1);
    if (last && last.to === gap - 1) last.to = gap;
    else ranges.push({ from: gap, to: gap });
  }
  assert.deepEqual(ranges, [{ from: 0, to: 1 }, { from: 5, to: 21 }]);
  const { s, d } = inputs(o), result = maxGap(s, d);
  assert.deepEqual(result.ranges, ranges); assert.equal(result.months, 21);
});
