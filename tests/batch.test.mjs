import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { batchSummary, dateError, earliestAction, nextSelection, stateBlock } from '../src/batch-select.ts';

const order = ['a', 'b', 'c', 'd', 'e'];
const click = (prev, anchor, id, mod, current = null) => nextSelection(prev, anchor, id, order, { meta: false, shift: false, toggle: false, ...mod }, current);

test('D19: ⌘-click toggles, starting from the item already in the summary', () => {
  assert.deepEqual(click([], null, 'c', { meta: true }, 'a').ids, ['a', 'c']);
  assert.deepEqual(click(['a', 'c'], 'c', 'a', { meta: true }).ids, ['c']);
  assert.deepEqual(click([], null, 'b', { toggle: true }, 'a').ids, ['b'], 'select mode starts empty');
});

test('D19: ⇧-click adds the range from the anchor in list order', () => {
  assert.deepEqual(click(['b'], 'b', 'd', { shift: true }).ids, ['b', 'c', 'd']);
  assert.deepEqual(click(['e'], 'e', 'c', { shift: true }).ids, ['e', 'c', 'd']);
});

const row = over => ({ id: 'x', name: '虚构', revision: 1, state: 'active', price_cents: '100', purchase_date: '2026-01-01', last_event_date: null, category_id: null, channel_id: null, label_id: null, exclude: { total: false, daily: false, statistics: false, timeline: false }, ...over });

test('D19: panel total leaves unknown prices out instead of counting 0', () => {
  const s = batchSummary([row(), row({ state: 'retired', price_cents: null }), row({ state: 'sold', price_cents: '250' })]);
  assert.deepEqual(s, { count: 3, total: '350', unknown: 1, states: { active: 1, retired: 1, sold: 1 } });
});

test('D19: state actions follow the single-item rules', () => {
  assert.equal(stateBlock(row({ state: 'sold' }), 'retire'), '已售出 · 不适用');
  assert.equal(stateBlock(row({ state: 'retired' }), 'retire'), '已退役 · 不适用');
  assert.equal(stateBlock(row(), 'retire'), '');
  assert.equal(earliestAction(row({ last_event_date: '2026-03-01' })), '2026-03-01');
  assert.equal(dateError(row(), '2025-12-31', '2026-09-28'), '不能早于 2026-01-01');
  assert.equal(dateError(row(), '2026-09-29', '2026-09-28'), '不能晚于今天');
  assert.equal(dateError(row(), '2026-09-28', '2026-09-28'), '');
});

test('D19: ⌘A is a native menu item routed to the page, like ⌘Z', () => {
  const menu = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(menu, /MenuItem::with_id\(app, "select-all", "全选", true, Some\("CmdOrCtrl\+A"\)\)/);
  assert.match(menu, /\| "select-all"/);
});
