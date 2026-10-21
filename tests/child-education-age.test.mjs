import test from 'node:test';
import assert from 'node:assert/strict';
import { monthChildReachesAge } from '../src/planning-basic-forms.ts';

test('child age helper converts birth month and age to the end month', () => {
  assert.equal(monthChildReachesAge('2020-05', 22), '2042-05');
  assert.equal(monthChildReachesAge('2020-05', '18'), '2038-05');
  assert.equal(monthChildReachesAge('2020-12', 1), '2021-12');
  assert.equal(monthChildReachesAge('2020-01', 40), '2060-01');
});
test('child age helper rejects invalid birth month or age', () => {
  for (const b of ['', '2020', '2020-13', '2020-00', '2020-5', 'abcd-01']) assert.equal(monthChildReachesAge(b, 22), null, b);
  for (const a of [0, 41, '', '1.5', '-3', 'x', '022x']) assert.equal(monthChildReachesAge('2020-05', a), null, String(a));
  assert.equal(monthChildReachesAge('9990-05', 40), null);
});
