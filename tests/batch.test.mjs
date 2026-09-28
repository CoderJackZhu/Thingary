import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addYears, batchSummary, dateError, earliestAction, nextSelection, saleNet, stateBlock, warrantyDefault, warrantyPreview } from '../src/batch-select.ts';

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

const row = over => ({ id: 'x', name: '虚构', revision: 1, state: 'active', price_cents: '100', purchase_date: '2026-01-01', last_event_date: null, category_id: null, channel_id: null, label_id: null, exclude: { total: false, daily: false, statistics: false, timeline: false }, maintenance_cents: '0', ...over });

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

test('D19: batch warranty defaults to purchase date plus one year', () => {
  assert.deepEqual(warrantyDefault(row({ purchase_date: '2025-10-01' }), '2026-09-28'), { start: '2025-10-01', end: '2026-10-01' });
  assert.deepEqual(warrantyDefault(row({ purchase_date: null }), '2026-09-28'), { start: '2026-09-28', end: '2027-09-28' });
  assert.equal(addYears('2024-02-29', 1), '2025-02-28');
  assert.equal(addYears('2025-10-01', 2), '2027-10-01');
});

test('D19: warranty preview and sale net cost', () => {
  assert.deepEqual(warrantyPreview('2026-09-28', '2027-09-28', '2026-09-28'), { text: '保障中 · 还剩 365 天', percent: 0 });
  assert.equal(warrantyPreview('2025-01-01', '2025-12-31', '2026-09-28').text, '已过期');
  assert.equal(warrantyPreview('2026-10-01', '2027-10-01', '2026-09-28').percent, 0);
  assert.equal(saleNet(row({ price_cents: '100000', maintenance_cents: '5000' }), '30000'), '75000');
  assert.equal(saleNet(row({ price_cents: null }), '30000'), null);
});
