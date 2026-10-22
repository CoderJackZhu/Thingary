import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldsOf, priceCents, priceOrigin, validate, emptyFields } from '../src/asset.ts';

test('a foreign price converts at the typed rate; CNY and unknown stay as they were', () => {
  assert.equal(priceCents({ price: '1299', currency: 'USD', fx: '7.1234' }), '925330');
  assert.equal(priceCents({ price: '150000', currency: 'JPY', fx: '0.0471' }), '706500');
  assert.equal(priceCents({ price: '12.5', currency: 'CNY' }), '1250');
  assert.equal(priceCents({ price: '', currency: 'USD' }), null);
  assert.equal(priceCents({ price: '0', currency: 'USD', fx: '7' }), '0');
});

test('a foreign price needs a usable amount and rate', () => {
  assert.throws(() => priceCents({ price: '1.234', currency: 'USD', fx: '7' }));
  assert.throws(() => priceCents({ price: '1', currency: 'USD', fx: '' }));
  assert.throws(() => priceCents({ price: '1', currency: 'USD', fx: '0' }));
  assert.throws(() => priceCents({ price: '1.5', currency: 'JPY', fx: '1' }));
  assert.ok(validate({ ...emptyFields, name: '相机', price: '1', currency: 'USD', fx: '' }, '2026-10-21').price);
  assert.equal(validate({ ...emptyFields, name: '相机', price: '1', currency: 'USD', fx: '7' }, '2026-10-21').price, undefined);
});

test('the original price is only kept for a known foreign amount and reads back into the editor', () => {
  assert.equal(priceOrigin({ price: '12', currency: 'CNY' }), null);
  assert.equal(priceOrigin({ price: '', currency: 'USD', fx: '7' }), null);
  assert.deepEqual(priceOrigin({ price: '1299', currency: 'USD', fx: '7.1234' }), { currency: 'USD', original_minor: '129900', fx_rate_micro: '7123400' });
  const record = { asset: { name: 'x', price_cents: '925330', purchase_date: null }, details: { brand: '', model: '', serial_number: '', notes: '' }, price_origin: { currency: 'USD', original_minor: '129900', fx_rate_micro: '7123400' } };
  const f = fieldsOf(record);
  assert.deepEqual([f.price, f.currency, f.fx], ['1299.00', 'USD', '7.1234']);
  assert.equal(priceCents(f), '925330');
  assert.deepEqual([fieldsOf({ ...record, price_origin: null }).price, fieldsOf({ ...record, price_origin: null }).currency], ['9253.30', 'CNY']);
});
