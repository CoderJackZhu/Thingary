import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { careerPensionSources } from '../src/career-preview/pension-fixture.ts';
import { previewAnswers, pensionCheckInput, fictionalPensionCheck, decimalIndex } from '../src/career-preview/pension-check.ts';
import { calculateBeijingBenefit } from '../src/plan-pension-policy.ts';

test('all Beijing career questions block even with complete insurance; no fallback results', () => {
  const sources = careerPensionSources(), draft = careerDraft();
  draft.recovery.monthly_cents = '1000000';
  const before = structuredClone({ sources, draft });
  for (const question of ['rest', 'lower', 'switch']) {
    const r = previewAnswers(sources, draft, question, { kind: 'gap', months: 18 });
    assert.equal(r.status, 'pool_blocked'); // This sample also has future housing-fund contributions.
    assert.equal('rest' in r, false); assert.equal('comparison' in r, false);
  }
  assert.deepEqual({ sources, draft }, before);
});

test('source failure and empty profile take priority over any financial result', () => {
  for (const source of [{ status: 'error', value: { code: 'UNAVAILABLE', message: 'fictional' } }, { status: 'ready', value: { generation: 'fictional', saved: null } }]) {
    const s = careerSources(); s.profile = source;
    assert.equal(previewAnswers(s, careerDraft(), 'switch', { kind: 'gap', months: 18 }).status, 'source_blocked');
  }
});

test('ordinary no-pension preview still calculates the recovery requirement', () => {
  const r = previewAnswers(careerSources(), careerDraft(), 'switch', { kind: 'gap', months: 18 });
  assert.equal(r.status, 'ready'); assert.equal(r.comparison.baseline.requirement.status, 'ready');
});

test('seed reuses identity only; past facts never become retirement forecasts', () => {
  const s = careerPensionSources(), before = structuredClone(s), p = pensionCheckInput(s);
  assert.equal(p.birth_month, '1994-10'); assert.equal(p.worker, 'male'); assert.equal(p.flex_months, 0);
  for (const field of ['scope','paid_months_at_retirement','average_index','benefit_base','account_at_retirement','disbursement']) assert.equal(p[field], null);
  assert.equal(calculateBeijingBenefit(p).status, 'blocked'); assert.deepEqual(s, before);
});

test('explicit fictional check reaches new kernel and cannot unlock career search', () => {
  const input = fictionalPensionCheck(), r = calculateBeijingBenefit(input);
  assert.equal(r.status, 'ready');
  assert.equal(r.value.total_monthly_cents, 366042);
  assert.equal(r.value.retirement_month, '2057-10'); assert.equal(r.value.payable_from_month, '2057-11');
  assert.equal(r.value.sources.average_index.basis, 'assumption');
  assert.equal(previewAnswers(careerPensionSources(), careerDraft(), 'rest', { kind: 'gap', months: 18 }).status, 'pool_blocked');
  input.average_index = null; assert.equal(calculateBeijingBenefit(input).status, 'blocked');
});

test('decimal index preserves four places, zero and invalid precision without silent rounding', () => {
  assert.equal(decimalIndex('0.9200'), 9200); assert.equal(decimalIndex('0'), 0);
  assert.equal(decimalIndex('1.2345'), 12345);
  for (const value of ['','1.23456','-1','abc','1e2']) assert.ok(Number.isNaN(decimalIndex(value)));
});
