import test from 'node:test';
import assert from 'node:assert/strict';
import { prefillCheckInRow, prefilledCount, snapshotEntryInput } from '../src/wealth.ts';

const account = (fields = {}) => ({ fields: { currency: 'CNY', ...fields } });
const previous = { amount_cents: '12345', date: '2026-09-30' };
test('an earlier amount is carried over as unchanged and is saved as such, with no amount of its own', () => {
  const row = prefillCheckInRow(account(), previous);
  assert.deepEqual([row.state, row.cents, row.edited], ['unchanged', '12345', false]);
  assert.equal(snapshotEntryInput('a', row).amount_cents, null);
  assert.equal(snapshotEntryInput('a', row).state, 'unchanged');
});
test('no earlier amount, an unknown one, or a holding is never carried over', () => {
  assert.equal(prefillCheckInRow(account(), null), null);
  assert.equal(prefillCheckInRow(account(), { amount_cents: null, date: '2026-09-30' }), null);
  assert.equal(prefillCheckInRow(account({ holding_mode: true }), { ...previous, quantity_e8: '100000000', unit_price_e6: '1000000' }), null);
});
test('only untouched carried rows are counted as prefilled', () => {
  const carried = prefillCheckInRow(account(), previous);
  assert.equal(prefilledCount({ a: carried, b: { state: 'entered', cents: '1' }, c: { state: null, cents: '' }, d: { ...carried, edited: true } }), 1);
});
