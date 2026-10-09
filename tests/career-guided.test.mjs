import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources } from '../src/career-preview/fixtures.ts';
import { careerPensionSources } from '../src/career-preview/pension-fixture.ts';
import { prepareIncomeScope } from '../src/career-preview/income-scope.ts';
import { guidedDraft, guidedIncome, restLevers, sayLower, sayRest, saySwitch, yuan } from '../src/career-preview/guided-model.ts';
import { maxGap, minWindow, missingItems } from '../src/plan-career-map.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';

const scoped = (s = careerSources(), d = guidedDraft()) => { const x = prepareIncomeScope(s, d, guidedIncome(s)); assert.equal(x.status, 'ready', JSON.stringify(x.issues)); return x; };

test('G01 the guided defaults are complete and visible: nothing is missing, social insurance is inside the spending, pools and pension are left out', () => {
  const d = guidedDraft(), s = careerSources(), inc = guidedIncome(s);
  assert.deepEqual(missingItems(d, true), []);
  assert.equal(inc.mode, 'excluded'); assert.equal(inc.excludePools, true);
  assert.deepEqual(d.gap.insurance, { monthly_cents: '0', included: true });
  const frozen = structuredClone({ s, d }); scoped(s, d); assert.deepEqual({ s, d }, frozen);
});

test('G02 a source with housing fund and personal pension still works under the guided defaults', () => {
  const s = careerPensionSources(); s.profile.value.saved.profile.personal_pension_annual_cents = '1200000';
  const x = scoped(s), r = maxGap(x.sources, x.draft);
  assert.equal(r.status, 'found');
});

test('G03 rest: plain sentences for found, none, blocked and the odd non-monotone case', () => {
  const x = scoped(), found = sayRest(maxGap(x.sources, x.draft), 50);
  assert.equal(found.headline, '最多能撑 26 个月'); assert.match(found.sub, /50岁退休时，钱就不够/); assert.equal(found.tone, 'good');
  const d = guidedDraft(); d.recovery.monthly_cents = '300000';
  const none = sayRest(maxGap(...(y => [y.sources, y.draft])(scoped(careerSources(), d))), 50);
  assert.equal(none.tone, 'bad'); assert.match(none.headline, /保不住/);
  assert.equal(sayRest({ status: 'blocked', message: 'x' }, 50).tone, 'wait');
  assert.equal(sayRest({ status: 'found', months: 54, limit: 'goal', ranges: [{ from: 8, to: 54 }] }, 50).tone, 'warn');
});

test('G04 levers: each row changes one thing; the numbers match direct searches and never go backwards', () => {
  const x = scoped(), base = maxGap(x.sources, x.draft).months, rows = restLevers(x.sources, x.draft);
  assert.equal(base, 26);
  assert.deepEqual(rows.map(r => r.text), ['多撑约 9 个月（共 35 个月）', '多撑约 2 个月（共 28 个月）', '多撑约 7 个月（共 33 个月）']);
  const d = structuredClone(x.draft); d.recovery.monthly_cents = String(Number(d.recovery.monthly_cents) + 100_000);
  assert.equal(maxGap(x.sources, d).months, 35);
});

test('G05 levers when nothing is feasible say so instead of inventing months', () => {
  const d = guidedDraft(); d.recovery.monthly_cents = '300000';
  const x = scoped(careerSources(), d), rows = restLevers(x.sources, x.draft);
  assert.equal(rows.find(r => r.label.startsWith('不工作期间')).text, '仍然保不住');
});

test('G06 lower and switch sentences', () => {
  const x = scoped();
  const d = structuredClone(x.draft); d.gap_months = 0; d.recovery.monthly_cents = '0';
  const low = sayLower(minWindow(x.sources, d), x.sources);
  assert.match(low.headline, /2033-06/); assert.match(low.headline, /38 岁/);
  assert.equal(sayLower({ status: 'already_met' }, x.sources).headline, '现在就可以');
  const sw = saySwitch(evaluateCareerScenario(x.sources, x.draft), '300000');
  assert.equal(sw.headline, `每月至少要攒 ${yuan(464286)}`); assert.equal(sw.tone, 'bad'); assert.match(sw.sub, /还差/);
  assert.equal(saySwitch(evaluateCareerScenario(x.sources, x.draft), '600000').tone, 'good');
  assert.equal(saySwitch(evaluateCareerScenario(x.sources, x.draft), null).tone, 'warn');
});
