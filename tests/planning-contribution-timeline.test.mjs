import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionTimeline, ageAtMonth, shiftMonth } from '../src/planning-goal/contribution-timeline.ts';
import { fictionalSources } from './helpers/planning-fixtures.mjs';

test('contribution guide separates work-stop age, statutory retirement and exclusive payment end', () => {
  const p = fictionalSources('1000000').profile.value.saved.profile;
  Object.assign(p, { birth_month: '1990-06', worker: 'male', flex_months: 0 });
  p.retire.target_age = 45;
  p.retire.basic.pension_contributions.start_month = '2026-10';
  const t = contributionTimeline(p, '2050-06', '2026-10-12');
  assert.equal(t.work, '2035-06');
  assert.equal(t.statutory, '2053-06');
  assert.equal(t.retirement, '2053-06');
  assert.equal(t.last, '2050-05');
  assert.equal(t.months, 180);
  assert.equal(ageAtMonth(p.birth_month, t.last), '59 岁 11 个月');
  assert.equal(shiftMonth('2050-12', 1), '2051-01');
  p.retire.target_age = 63;
  assert.equal(contributionTimeline(p, '2050-06', '2026-10-12').months, 0);
  assert.equal(contributionTimeline(p, '2053-07', '2026-10-12').months, 1);
  assert.equal(contributionTimeline(p, null, '2026-10-12').months, null);
});
