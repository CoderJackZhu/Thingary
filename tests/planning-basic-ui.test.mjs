import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modeOf, amountState, contributionState, requirementLine, needsContribution, missingOwners, missingText, setupStepFor } from '../src/planning-basic-view.ts';
import { basicInput, budgetInput, draftOf, retirementSources } from '../src/planning-basic-forms.ts';
import { defaultRetire } from '../src/plan.ts';
import { unknownCapabilityFixture, predictionCapabilityFixture, missingCostCapabilityFixture, basicInputFixtures } from '../src/plan-basic-fixtures.ts';

const today = '2026-10-07';
const profile = (retire, over = {}) => ({ revision: 3, updated_at: '2026-10-01T00:00:00Z', profile: { birth_month: '1990-06', worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null, assumptions: { inflation_hundredths: 200, wage_growth_hundredths: 200, pp_return_hundredths: 200 }, overrides: {}, retire, ...over } });
const legacy = profile({ ...defaultRetire, setup_completed: true, spend_cents: '500000', saving_phases: [{ id: 'p1', label: '阶段', from_age_months: 0, monthly_cents: 100000 }] });
const pensionOnly = profile({ ...defaultRetire });

test('mode: a pension-only profile is not an original plan; basic wins; legacy needs a real plan', () => {
  assert.equal(modeOf(null), 'none');
  assert.equal(modeOf(pensionOnly), 'none');
  assert.equal(modeOf(legacy), 'none');
  assert.equal(modeOf(profile({ ...defaultRetire, basic: basicInputFixtures.unknown.basic })), 'basic');
});

test('contribution: unknown, explicit zero and negatives are distinct; never a truthiness test', () => {
  assert.equal(amountState(null), 'unknown');
  assert.equal(amountState('0'), 'zero');
  assert.equal(amountState('-100'), 'negative');
  assert.equal(amountState('500000'), 'positive');
  assert.equal(contributionState(undefined), 'unknown');
  assert.equal(contributionState(basicInputFixtures.zero.basic), 'zero');
});

test('requirement wording follows each real DTO status and never shows null as zero', () => {
  const fmt = c => `¥${c}`;
  assert.match(requirementLine({ status: 'found', monthly_cents: '470000', before_hundredths: 0, after_hundredths: 0 }, fmt).text, /每月约 ¥470000/);
  assert.equal(requirementLine({ status: 'no_positive_contribution', monthly_cents: '0', before_hundredths: 0, after_hundredths: 0 }, fmt).text, '按这些条件，不用再额外存钱');
  assert.match(requirementLine({ status: 'search_not_found', search_limit_cents: '9', before_hundredths: 0, after_hundredths: 0 }, fmt).text, /搜索上限/);
  assert.match(requirementLine({ status: 'payment_constraint', message: 'm', before_hundredths: 0, after_hundredths: 0 }, fmt).text, /付款/);
  assert.match(requirementLine({ status: 'out_of_bounds', message: 'm', before_hundredths: 0, after_hundredths: 0 }, fmt).text, /超出/);
  assert.match(requirementLine({ status: 'not_applicable', message: 'm', before_hundredths: 0, after_hundredths: 0 }, fmt).text, /不适用/);
});

test('gating: unknown contribution keeps the requirement and hides prediction; owners are grouped', () => {
  assert.equal(needsContribution(unknownCapabilityFixture), true);
  assert.equal(unknownCapabilityFixture.requirement.status, 'ready');
  assert.equal(needsContribution(predictionCapabilityFixture), false);
  // The missing-cost fixture is also contribution-unknown: uncertain costs are annotated without inventing a confirmed amount.
  assert.equal(missingCostCapabilityFixture.requirement.status, 'ready');
  assert.equal(needsContribution(missingCostCapabilityFixture), true);
  assert.deepEqual(missingOwners([{ owner: 'funds' }, { owner: 'funds' }, { owner: 'basic' }]), ['funds', 'basic']);
});

test('explicit zero and negative contributions are saved as values; blank stays null', () => {
  const d = draftOf(null, null);
  assert.equal(basicInput({ ...d, contribution: '0' }, null, today).fields.basic.contribution.monthly_cents, '0');
  assert.equal(basicInput({ ...d, contribution: '-200000' }, null, today).fields.basic.contribution.monthly_cents, '-200000');
});

test('cost scopes: included needs an explicit amount, extra/excluded carry none, unchosen sources are not guessed', () => {
  const r = { ...defaultRetire, rent_cents: '100000', spend_items: [{ id: 'h', label: '医疗', monthly_cents: '50000', start_age: null, end_age: null, inflation_hundredths: null, essential: true }] };
  const p = profile(r); assert.deepEqual(retirementSources(r).map(s => s.id), ['spend:h', 'rent']);
  const d = draftOf(p, null);
  assert.deepEqual(basicInput(d, p, today).fields.basic.retirement_costs, []);
  assert.throws(() => basicInput({ ...d, retScopes: { rent: { treatment: 'included', ref: '' } } }, p, today), /含多少/);
  const ok = basicInput({ ...d, retScopes: { rent: { treatment: 'included', ref: '100000' }, 'spend:h': { treatment: 'extra', ref: '999' } } }, p, today).fields.basic.retirement_costs;
  assert.deepEqual(ok, [{ source_id: 'spend:h', treatment: 'extra', reference_cents: null }, { source_id: 'rent', treatment: 'included', reference_cents: '100000' }]);
});

test('basic risk lab: no career presets, complete-budget wording; runway card is mounted and unsaved', () => {
  const risk = fs.readFileSync(new URL('../src/RiskLab.tsx', import.meta.url), 'utf8');
  assert.match(risk, /useMemo\(\(\) => stressTests\(P, year\)/);
  assert.doesNotMatch(risk, /覆盖必需支出|岁前仍有余钱/);
  const goals = fs.readFileSync(new URL('../src/PlanningBasicGoals.tsx', import.meta.url), 'utf8');
  assert.match(goals, /<RunwayCard caps=\{caps\}/);
  const runwayCard = fs.readFileSync(new URL('../src/PlanningRunway.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(runwayCard, /invoke|savePlanningSection|localStorage/);
  assert.match(runwayCard, /目前没有可靠到账/);
});
