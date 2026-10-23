import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceRates, referenceRatesDate } from '../src/reference-rates.ts';
import { clearRate, isReferenceRate, readRate, referenceRateOf, rememberRate, savedRate } from '../src/currency-picker.ts';
import { currencies } from '../src/currency.ts';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };

test('every reference rate is a positive micro amount for a currency the app knows, and CNY itself has none', () => {
  const known = new Set(currencies.map(c => c[0]));
  assert.match(referenceRatesDate, /^\d{4}-\d{2}-\d{2}$/);
  for (const [code, micro] of Object.entries(referenceRates)) { assert.ok(known.has(code), code); assert.match(micro, /^[1-9]\d*$/, code); }
  assert.equal(referenceRates.CNY, undefined);
  // sanity: a euro is worth more than a dollar, a yen far less than a yuan
  assert.ok(BigInt(referenceRates.EUR) > BigInt(referenceRates.USD) && BigInt(referenceRates.JPY) < 100000n);
});
test('a saved rate beats the built-in reference; clearing brings the reference back', () => {
  store.clear();
  assert.equal(savedRate('USD'), ''); assert.equal(readRate('USD'), referenceRateOf('USD')); assert.ok(isReferenceRate('USD', readRate('USD')));
  rememberRate('USD', '6.91');
  assert.equal(readRate('USD'), '6.91'); assert.equal(isReferenceRate('USD', '6.91'), false);
  clearRate('USD');
  assert.equal(readRate('USD'), referenceRateOf('USD'));
});
test('currencies the reference does not cover stay empty until a rate is saved', () => {
  store.clear();
  for (const code of ['TWD', 'VND', 'RUB']) assert.equal(readRate(code), '', code);
  rememberRate('TWD', '0.2290');
  assert.equal(readRate('TWD'), '0.2290');
});

import { checkInRates, rateMicroDefault } from '../src/currency-picker.ts';
test('a check-in uses earlier rates first, then the saved default, then the built-in reference, and never invents a CNY rate', () => {
  store.clear();
  assert.equal(rateMicroDefault('HKD'), referenceRates.HKD);
  rememberRate('HKD', '0.9');
  assert.equal(rateMicroDefault('HKD'), '900000');
  const rates = checkInRates(['CNY', 'USD', 'HKD', 'TWD'], { USD: { rate: '7000000' } });
  assert.deepEqual(rates, { USD: '7000000', HKD: '900000' });
  store.clear();
  assert.equal(checkInRates(['HKD'], {}).HKD, referenceRates.HKD);
});
