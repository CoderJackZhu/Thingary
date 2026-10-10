import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { careerSources } from '../src/career-preview/fixtures.ts';
import { realGuidedDefaults } from '../src/career-preview/guided-model.ts';
import { prepareIncomeScope } from '../src/career-preview/income-scope.ts';
import { maxGap, missingItems } from '../src/plan-career-map.ts';

const withReview = (stats) => { const s = careerSources(); s.review = { status: 'ready', value: { intervals: [], stats } }; return s; };
const stats = { count: 6, median_monthly_saving_cents: '700000', median_monthly_cash_spend_cents: '1300000' };

test('C1 real defaults come from the user facts only: history spend, current savings, next month, the plan\'s confirmed cost treatment', () => {
  const s = withReview(stats);
  s.profile.value.saved.profile.retire.basic.contribution_costs = [{ source_id: 'event:loan-1:loan', treatment: 'included', reference_cents: '500000' }];
  const x = realGuidedDefaults(s, '2026-10-09');
  assert.equal(x.draft.transition_month, '2026-11');
  assert.equal(x.draft.gap.spend_cents, '1300000'); assert.deepEqual(x.from, { spend: 'history', recovery: 'current' });
  assert.equal(x.draft.recovery.monthly_cents, '1500000');
  assert.deepEqual(x.draft.gap.costs, s.profile.value.saved.profile.retire.basic.contribution_costs);
  assert.deepEqual(x.draft.recovery.costs, x.draft.gap.costs);
  assert.equal(x.income.mode, 'excluded'); assert.equal(x.income.excludePools, true);
});

test('C2 without enough history the spend is left empty, never guessed or zero; December rolls into the next year', () => {
  const x = realGuidedDefaults(careerSources(), '2026-12-31');
  assert.equal(x.draft.gap.spend_cents, null); assert.equal(x.from.spend, null);
  assert.equal(x.draft.transition_month, '2027-01');
  const few = realGuidedDefaults(withReview({ ...stats, count: 2 }), '2026-10-09');
  assert.equal(few.draft.gap.spend_cents, null);
});

test('C3 defaults never change the source and give an answer path that is not blocked by the plan\'s own pension mode', () => {
  const s = withReview(stats), frozen = structuredClone(s);
  s.profile.value.saved.profile.retire.basic.retirement_income = { mode: 'employee', selected: [] };
  const before = structuredClone(s);
  const x = realGuidedDefaults(s, '2026-10-09');
  const scope = prepareIncomeScope(s, x.draft, x.income);
  assert.equal(scope.status, 'ready');
  assert.deepEqual(missingItems(scope.draft, true), []);
  assert.equal(maxGap(scope.sources, scope.draft).status, 'found');
  assert.deepEqual(s, before); void frozen;
});

test('C4 the card is wired as an optional, closed, non-persistent entry', () => {
  const goals = readFileSync(new URL('../src/PlanningBasicGoals.tsx', import.meta.url), 'utf8');
  assert.match(goals, /import \{ PlanningCareerCard \} from '\.\/PlanningCareerCard'/);
  assert.match(goals, /caps && <PlanningCareerCard sources=\{sources\} today=\{today\}/);
  assert.ok(goals.indexOf('<RunwayCard caps={caps}') < goals.indexOf('<PlanningCareerCard'), 'after the runway card, not before the goal');
  const card = readFileSync(new URL('../src/PlanningCareerCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /useState\(false\)/); assert.match(card, /aria-expanded/); assert.match(card, /\{defaults && <GuidedPanel/);
  for (const f of ['../src/PlanningCareerCard.tsx', '../src/career-preview/guided.tsx', '../src/career-preview/guided-model.ts']) {
    const t = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /invoke\(|localStorage|sessionStorage|indexedDB|fetch\(/, f + ' must not store or call anything');
  }
});
