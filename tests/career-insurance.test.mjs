import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedPension, blankInsuranceSelection } from '../src/career-preview/insurance.ts';
import { careerPensionSources } from '../src/career-preview/pension-fixture.ts';
import { careerDraft } from '../src/career-preview/fixtures.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { assumeInsurance } from '../src/plan-career-map.ts';
import { beijing } from '../src/plan-params.ts';

const employer = { ...blankInsuranceSelection(), method: 'employer', base: 'original', hpf: 'original' };
const select = (form, base = '1000000', hpf = '100000') => selectedPension(form, beijing.base_lower_cents, base, hpf);
const evaluate = (s, pension) => {
  const d = careerDraft(); d.recovery.monthly_cents = '600000'; d.recovery.pension = pension;
  return evaluateCareerScenario(s, d);
};
test('same employer base and housing-fund arrangement reproduce unchanged results through original/custom/floor choices', () => {
  for (const base of ['1000000', beijing.base_lower_cents]) {
    const s = careerPensionSources(), p = s.profile.value.saved.profile;
    p.retire.basic.pension_contributions.base_cents = base;
    const baseline = evaluate(s, 'unchanged');
    for (const choice of ['original', 'custom', ...(base === beijing.base_lower_cents ? ['floor'] : [])]) {
      const result = evaluate(s, select({ ...employer, base: choice, custom: base }, base));
      assert.equal(result.prediction.status, 'ready');
      assert.deepEqual(result.prediction.value.projection, baseline.prediction.value.projection);
      assert.deepEqual(result.requirement, baseline.requirement);
    }
  }
});
test('housing-fund changes affect only the locked pool, preserving cash and pension monthly benefit', () => {
  const s = careerPensionSources(), frozen = structuredClone(s);
  const a = evaluate(s, select(employer)), b = evaluate(s, select({ ...employer, hpf: 'none' }));
  const ap = a.prediction.value.plan.pension_at(600), bp = b.prediction.value.plan.pension_at(600);
  assert.equal(ap.monthly_cents, bp.monthly_cents);
  assert.ok(ap.lump_cents > bp.lump_cents);
  assert.deepEqual(a.cash, b.cash);
  assert.equal(a.prediction.value.outcome.assets_at_goal, b.prediction.value.outcome.assets_at_goal);
  assert.deepEqual(s, frozen);
});
test('zero/invalid bases and housing-fund amounts stay blocked even in opt-in exploration', () => {
  for (const form of [
    { ...employer, base: 'custom', custom: '0' }, { ...employer, base: 'custom', custom: '100' },
    { ...employer, hpf: 'custom', hpfCustom: '' }, { ...employer, hpf: 'custom', hpfCustom: '-1' },
  ]) {
    const d = careerDraft(); d.recovery.monthly_cents = '600000'; d.recovery.pension = select(form);
    for (const input of [d, assumeInsurance(d).draft]) assert.equal(evaluateCareerScenario(careerPensionSources(), input).prediction.status, 'blocked');
  }
  assert.equal(evaluate(careerPensionSources(), select(employer, '1000000', null)).prediction.status, 'blocked');
});
