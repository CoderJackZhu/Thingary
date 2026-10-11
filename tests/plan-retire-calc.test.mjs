import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import { basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { defaultRetire } from '../src/plan.ts';
import { simplifiedSources } from './helpers/simplified-planning-fixtures.mjs';

const saved = spend => {const source=simplifiedSources('1000000').profile.value.saved;
 source.profile.retire.basic.start={kind:'live'};
 source.profile.retire.spend_cents=spend;
 source.profile.retire.core.monetary_basis_date='2026-10-06';
 source.profile.retire.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000}];
 source.profile.retire.simplified.time={reference:null,target_month:'2040-06',horizon_month:'2080-05'};
 return source;};
const snapshot = {id:'snapshot',revision:1,date:'2026-10-06', entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: '20000000' }] };
const review = { intervals: [], stats: { median_monthly_saving_cents: '1000000', median_monthly_spend_cents: '1700000' } };

test('a high historical spend never silently becomes the retirement budget', () => {
  const r = buildRetireCalc(saved(null), snapshot, review, [], '2026-10-06');
  assert.equal(r.derivedSpend, null);
  assert.equal(r.spend, null);
  assert.match(r.missing.join(' '), /预算/);
  for (const key of ['plan', 'proj', 'out', 'emergency']) assert.equal(r[key], undefined);
});

test('explicit monthly budget drives retirement and purchase estimates independently of history', () => {
  const r = buildRetireCalc(saved('500000'), snapshot, review, [], '2026-10-06');
  assert.equal(r.spend, 500000);
  assert.equal(r.plan.items[0].monthly_cents, 500000);
  assert.equal(r.derivedSpend, null);
  assert.deepEqual(r.missing, []);
  assert.ok(r.out);
  const changed = buildRetireCalc(saved('500000'), snapshot, { intervals: [], stats: { ...review.stats, median_monthly_spend_cents: '-100' } }, [], '2026-10-06');
  assert.deepEqual(changed.out, r.out);
});

test('a planning horizon not after today leaves the estimate unavailable instead of drawing an empty chart', () => {
  const old = saved('500000');
  old.profile.retire.simplified.time.horizon_month = '2020-01';
  const r = buildRetireCalc(old, snapshot, review, [], '2026-10-06');
  assert.match(r.missing.join(' '), /终点|结束|目标/);
  assert.equal(r.plan, undefined);
});
