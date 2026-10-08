import test from 'node:test';
import assert from 'node:assert/strict';
import { accountVisible, changeVisible } from '../src/wealth-display.ts';
import { spacedLabels } from '../src/chart-labels.ts';

test('account filters preserve archived records and historical contributions', () => {
  const active = { id: 'a', fields: { closed_on: null } }, closed = { id: 'c', fields: { closed_on: '2026-10-01' } };
  assert.equal(accountVisible(active, 'active'), true);
  assert.equal(accountVisible(closed, 'active'), false);
  assert.equal(accountVisible(closed, 'closed'), true);
  assert.equal(accountVisible(closed, 'all'), true);
  const row = { account_id: 'c', group: 'counted', effect_cents: '0', change_cents: '0', from: { amount_cents: '0' }, to: { amount_cents: null, state: 'closed' } };
  assert.equal(changeVisible(row, [active, closed], 'active'), false);
  assert.equal(changeVisible({ ...row, change_cents: '-10000' }, [closed], 'active'), true);
  assert.equal(changeVisible({ ...row, effect_cents: null }, [closed], 'active'), true);
  assert.equal(changeVisible({ ...row, group: 'scope_changed' }, [closed], 'active'), true);
  assert.equal(changeVisible({ ...row, from: { amount_cents: '10000' } }, [closed], 'active'), true);
  assert.equal(changeVisible(row, [closed], 'all'), true);
});

test('date labels avoid clustered dates at any width without changing data', () => {
  const data = [{ x: 0 }, { x: 100 }, { x: 102 }, { x: 350 }, { x: 600 }];
  for (const scale of [0.4, 0.75, 1, 2]) {
    const labels = spacedLabels(data, v => v.x * scale, () => 76, 8);
    assert.equal(labels.at(-1), data.at(-1));
    for (let i = 1; i < labels.length; i++) assert.ok((labels[i].x - labels[i-1].x) * scale >= 84);
  }
  assert.equal(data.length, 5);
  assert.deepEqual(spacedLabels([], () => 0, () => 76), []);
  assert.equal(spacedLabels([{ x: 0 }], v => v.x, () => 76).length, 1);
});
