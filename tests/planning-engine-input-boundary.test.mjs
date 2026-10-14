import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareBasicPlan } from '../src/plan-basic.ts';
import { project, savingsOf } from '../src/plan-ledger.ts';
import { simplifiedSources } from './helpers/simplified-planning-fixtures.mjs';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';

const retire = s => s.profile.value.saved.profile.retire;
const compile = s => {
  const prepared = prepareBasicPlan(s);
  assert.equal(prepared.plan.status, 'ready', JSON.stringify(prepared.plan));
  return prepared.plan.value.compile(100000, 0, 0);
};

test('inclusive 1440-month horizon is accepted; the next month is a correctable constraint', () => {
  const sources = simplifiedSources('100000');
  retire(sources).simplified.time.horizon_month = '2146-09';
  assert.equal(compile(sources).horizon_months, 1440);
  retire(sources).simplified.time.horizon_month = '2146-10';
  const before = structuredClone(sources);
  const prepared = prepareBasicPlan(sources);
  assert.equal(prepared.plan.status, 'blocked');
  assert.ok(prepared.plan.missing.some(m => m.code === 'HORIZON_INVALID'
    && m.owner === 'basic' && m.field === 'time.horizon_month' && m.kind === 'constraint'));
  assert.deepEqual(sources, before);
});

test('an expired independent loan schedule does not crash planning or erase the liability', () => {
  const sources = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
  const liability = sources.snapshot.value.entries.find(e => e.counted && e.side === 'liability' && Number(e.amount_cents) > 0);
  const core = retire(sources).core;
  core.debt_repayments = [{ account_id: liability.account_id, recorded_on: '2025-01-01', as_of: '2025-01-01',
    balance_cents: liability.amount_cents, start_month: '2025-01', last_month: '2025-12',
    monthly_cents: '200000', before: 'scheduled', after: 'scheduled' }];
  const before = structuredClone(sources), plan = compile(sources);
  for (const flows of [plan.saving_flows, plan.spend_flows]) assert.ok(!flows.some(f => f.source_id === `debt:${liability.account_id}`));
  assert.doesNotThrow(() => project(plan, 2026));
  assert.deepEqual(sources, before);
  core.debt_repayments[0].last_month = '2026-12';
  const ongoing = compile(sources);
  const flow = ongoing.saving_flows.find(f => f.source_id === `debt:${liability.account_id}`);
  assert.equal(flow.from_month, 1);
  assert.equal(flow.to_month, 3);
  assert.ok(savingsOf(ongoing)[1] < savingsOf(plan)[1]);
});

test('ended occurred-car holding costs are omitted, while an ongoing holding schedule remains', () => {
  const sources = simplifiedSources('100000'), r = retire(sources);
  r.life_events = [{ id: 'fictional-car', label: '虚构旧车', kind: 'car', date: '2020-01', included: true,
    price_cents: '1000000', down_cents: '1000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1,
    holding_cents: '10000', rent_saved_cents: '0', cycle_years: null, until_month: '2025-11', time_unconfirmed: false, resale_cents: '0' }];
  r.core.occurrences = [{ id: 'fictional-occurrence', event_id: 'fictional-car', status: 'occurred', actual_date: '2020-01-01',
    payments_complete: false, loan: null, payments: [{ id: 'fictional-payment', date: '2020-01-01', amount_cents: '1000000',
      account_id: null, absorbed_snapshot_id: null, absorbed_revision: null, source_kind: null, source_id: null }] }];
  const before = structuredClone(sources), plan = compile(sources);
  for (const flows of [plan.saving_flows, plan.spend_flows]) assert.ok(!flows.some(f => f.source_id === 'event:fictional-car:holding'));
  assert.doesNotThrow(() => project(plan, 2026));
  assert.deepEqual(sources, before);
  r.life_events[0].until_month = '2027-01';
  const ongoing = compile(sources);
  for (const flows of [ongoing.saving_flows, ongoing.spend_flows]) {
    const flow = flows.find(f => f.source_id === 'event:fictional-car:holding');
    assert.equal(flow.from_month, 0);
    assert.equal(flow.to_month, 4);
  }
  // A malformed future interval must reach validation, not disappear as if it
  // were an ended historical obligation.
  r.core.occurrences = [];
  r.life_events[0].date = '2027-06';
  const malformed = compile(sources);
  const future = malformed.saving_flows.find(f => f.source_id === 'event:fictional-car:holding');
  assert.equal(future.from_month, 8);
  assert.equal(future.to_month, 4);
  assert.throws(() => project(malformed, 2026), /reversed flow range/);
});

test('career stages sharing the origin use the later stage without dropping fixed flows', () => {
  const sources = careerSources(), draft = careerDraft();
  draft.transition_month = '2026-09';
  draft.gap_months = 0;
  draft.recovery.monthly_cents = '900000';
  draft.recovery.insurance = { monthly_cents: '30000', included: false };
  draft.lumps = [{ month: '2026-10', cents: '123000' }];
  const before = structuredClone({ sources, draft });
  const result = evaluateCareerScenario(sources, draft, { requirement: 'skip' });
  assert.equal(result.prediction.status, 'ready', JSON.stringify(result.prediction));
  const plan = result.prediction.value.plan;
  assert.deepEqual(plan.saving_phases, [{ from_month: 0, cents: 900000 }]);
  assert.ok(plan.saving_flows.some(f => f.label === '本次自缴现金费用' && f.cents === -30000 && f.from_month === 0));
  assert.ok(plan.saving_flows.some(f => f.label === '一次性到账' && f.cents === 123000 && f.from_month === 1 && f.to_month === 2));
  assert.equal(savingsOf(plan)[1], 900000 - 30000 + 123000);
  assert.deepEqual({ sources, draft }, before);
});

test('career gap at origin replaces current savings; distinct later stage dates remain', () => {
  for (const transition of ['2026-09', '2026-10']) {
    const sources = careerSources(), draft = careerDraft();
    draft.transition_month = transition;
    draft.gap_months = 2;
    draft.gap.income_cents = '200000';
    draft.recovery.monthly_cents = '900000';
    const result = evaluateCareerScenario(sources, draft, { requirement: 'skip' });
    assert.equal(result.prediction.status, 'ready', JSON.stringify(result.prediction));
    const phases = result.prediction.value.plan.saving_phases;
    assert.deepEqual(phases, transition === '2026-09'
      ? [{ from_month: 0, cents: -800000 }, { from_month: 2, cents: 900000 }]
      : [{ from_month: 0, cents: 1500000 }, { from_month: 1, cents: -800000 }, { from_month: 3, cents: 900000 }]);
  }
});
