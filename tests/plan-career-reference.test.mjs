import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceCareer, referenceMaxGap } from './helpers/career-reference.mjs';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { maxGap } from '../src/plan-career-map.ts';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.02, `${message}: ${actual} vs ${expected}`);
function inputs(o = {}) {
  const s = careerSources(), d = careerDraft(), p = s.profile.value.saved.profile, r = p.retire;
  if (o.preMonths === 0) d.transition_month = '2026-10';
  r.basic.start.available_cents = String(o.start ?? 60_000_000);
  r.real_return_before_hundredths = Math.round((o.beforeRate ?? 0) * 10000);
  r.real_return_after_hundredths = Math.round((o.afterRate ?? 0) * 10000);
  p.assumptions.inflation_hundredths = Math.round((o.inflation ?? 0) * 10000);
  d.gap_months = o.gap ?? 12;
  d.recovery.monthly_cents = String(o.recovery ?? 600_000);
  d.gap.spend_cents = String(o.spend ?? 1_000_000); d.gap.income_cents = String(o.income ?? 0);
  d.gap.insurance = { monthly_cents: String(o.gapInsurance ?? 0), included: o.gapIncluded ?? false };
  d.recovery.insurance = { monthly_cents: String(o.recoveryInsurance ?? 0), included: o.recoveryIncluded ?? false };
  d.gap.extra_income = { lump_cents: o.lump ? String(o.lump) : null, benefit_monthly_cents: o.benefit ? String(o.benefit) : null, benefit_months: o.benefitMonths ?? null };
  d.floor_cents = o.floor === undefined ? null : String(o.floor);
  if (o.pension) {
    r.income_items = [{ id: 'manual-pension', label: '虚构手填养老金', monthly_cents: String(o.pension), start_age: 63, end_age: null, indexed: o.pensionIndexed ?? true }];
    r.basic.retirement_income = { mode: 'manual', selected: [{ id: 'manual-pension', source_id: 'manual-pension', role: 'state_pension' }] };
  }
  return { s, d };
}
const cases = [
  ['zero-return closed form', {}],
  ['gap self-pay extra', { gapInsurance: 200_000 }],
  ['gap self-pay included', { gapInsurance: 200_000, gapIncluded: true }],
  ['recovery self-pay extra', { recoveryInsurance: 200_000 }],
  ['included insurance still paid before interest', { gapInsurance: 200_000, gapIncluded: true, recoveryInsurance: 200_000, recoveryIncluded: true, beforeRate: .01 }],
  ['lump and six-month benefit', { lump: 12_000_000, benefit: 500_000, benefitMonths: 6 }],
  ['benefit stops on early recovery', { gap: 3, benefit: 500_000, benefitMonths: 6 }],
  ['zero gap receives no benefit but does receive severance', { gap: 0, lump: 12_000_000, benefit: 500_000, benefitMonths: 6 }],
  ['different accumulation and retirement returns', { beforeRate: .02, afterRate: .01 }],
  ['inflation with fixed purchasing-power budgets', { inflation: .025, beforeRate: .01 }],
  ['manual pension starts at 63, not target 50', { pension: 100_000 }],
  ['nominal pension loses purchasing power', { pension: 100_000, pensionIndexed: false, inflation: .025 }],
];
for (const [name, o] of cases) test(`independent reference: ${name}`, () => {
  const { s, d } = inputs(o), expected = referenceCareer(o), result = evaluateCareerScenario(s, d);
  assert.equal(result.prediction.status, 'ready', JSON.stringify(result.prediction));
  const v = result.prediction.value;
  // Compare every accumulation month's start/end, not merely the final integer month.
  for (let m = 0; m < 216; m++) {
    near(v.projection.assets[m + 1], expected.rows[m].start, `month ${m} opening`);
    near(v.projection.assets[m + 2], expected.rows[m].end, `month ${m} closing`);
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
