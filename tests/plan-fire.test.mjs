import test from 'node:test';
import assert from 'node:assert/strict';
import { emergency, monthsLeftText, progressHundredths } from '../src/plan-fire.ts';

test('emergency line compares assets with months of spending', () => {
  assert.deepEqual(emergency(5000, 1000, 6), { covered_months: 5, below: true });
  assert.deepEqual(emergency(6000, 1000, 6), { covered_months: 6, below: false });
  assert.deepEqual(emergency(1, 0, 6), { covered_months: null, below: false });
});

test('goal progress and time-left wording', () => {
  assert.deepEqual([[295, 1000], [0, 1000], [2000, 1000], [5, 0], [-50, 1000]].map(([a, r]) => progressHundredths(a, r)), [2950, 0, 10000, 10000, 0]);
  assert.deepEqual([0, -3, 1, 11, 12, 13, 24, 148].map(monthsLeftText), ['已经够了', '已经够了', '1 个月', '11 个月', '1 年', '1 年 1 个月', '2 年', '12 年 4 个月']);
});
