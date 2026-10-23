import test from 'node:test';
import assert from 'node:assert/strict';
import { fxSplit } from '../src/wealth-display.ts';
import { rateHint } from '../src/currency.ts';

const cell = (original_minor, fx_rate_micro) => ({ state: 'entered', amount_cents: null, counted: true, original_minor, fx_rate_micro });
test('a foreign account change splits into its own movement and the exchange rate, adding up to the change', () => {
  // 1,000.00 USD at 7.00 -> 1,100.00 USD at 7.20: CNY 7,000.00 -> 7,920.00 (+920.00)
  const row = { side: 'asset', currency: 'USD', from: cell('100000', '7000000'), to: cell('110000', '7200000'), change_cents: '92000' };
  assert.deepEqual(fxSplit(row), { own_cents: '70000', fx_cents: '22000' });
  assert.equal(BigInt(fxSplit(row).own_cents) + BigInt(fxSplit(row).fx_cents), 92000n);
});
test('liabilities keep the direction of their net-worth effect; CNY and missing data give nothing', () => {
  const row = { side: 'liability', currency: 'USD', from: cell('100000', '7000000'), to: cell('100000', '7200000'), change_cents: '20000' };
  assert.deepEqual(fxSplit(row), { own_cents: '0', fx_cents: '-20000' });
  assert.equal(fxSplit({ ...row, currency: 'CNY' }), null);
  assert.equal(fxSplit({ ...row, from: cell(null, null) }), null);
});
test('an old suggested rate is flagged', () => {
  assert.match(rateHint('USD', { rate: '7120000', date: '2026-10-01' }, '2026-10-20'), /上次 1 USD = 7.12（2026-10-01），可修改/);
  assert.match(rateHint('USD', { rate: '7120000', date: '2026-06-01' }, '2026-10-20'), /已是 141 天前/);
  assert.match(rateHint('USD', undefined, '2026-10-20'), /没有历史汇率/);
});
