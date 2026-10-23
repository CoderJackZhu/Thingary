import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldsOf, priceCents, priceOrigin, validate, emptyFields } from '../src/asset.ts';

test('a foreign price is what was actually paid; CNY and unknown stay as they were', () => {
  assert.equal(priceCents({ price: '1299', currency: 'USD', fx: '7.1234', paid: '9253.30' }), '925330');
  assert.equal(priceCents({ price: '150000', currency: 'JPY', fx: '0.0471', paid: '7065' }), '706500');
  assert.equal(priceCents({ price: '12.5', currency: 'CNY' }), '1250');
  assert.equal(priceCents({ price: '', currency: 'USD' }), null);
  assert.equal(priceCents({ price: '10', currency: 'USD', paid: '0' }), '0');
});

test('a foreign price needs a usable amount and a paid amount', () => {
  assert.throws(() => priceCents({ price: '1.234', currency: 'USD', paid: '9' }));
  assert.throws(() => priceCents({ price: '1', currency: 'USD', fx: '', paid: '' }));
  assert.throws(() => priceCents({ price: '1.5', currency: 'JPY', paid: '1' }));
  assert.ok(validate({ ...emptyFields, name: '相机', price: '1', currency: 'USD', fx: '', paid: '' }, '2026-10-21').price);
  assert.equal(validate({ ...emptyFields, name: '相机', price: '1', currency: 'USD', fx: '7', paid: '7' }, '2026-10-21').price, undefined);
});

test('the original price keeps the rate derived from the paid amount and reads back into the editor', () => {
  assert.equal(priceOrigin({ price: '12', currency: 'CNY' }), null);
  assert.equal(priceOrigin({ price: '', currency: 'USD', paid: '5' }), null);
  assert.deepEqual(priceOrigin({ price: '1299', currency: 'USD', paid: '9253.30' }), { currency: 'USD', original_minor: '129900', fx_rate_micro: '7123403' });
  const record = { asset: { name: 'x', price_cents: '925330', purchase_date: null }, details: { brand: '', model: '', serial_number: '', notes: '' }, price_origin: { currency: 'USD', original_minor: '129900', fx_rate_micro: '7123403' } };
  const f = fieldsOf(record);
  assert.deepEqual([f.price, f.currency, f.fx, f.paid], ['1299.00', 'USD', '7.123403', '9253.30']);
  assert.equal(priceCents(f), '925330');
  const cny = fieldsOf({ ...record, price_origin: null });
  assert.deepEqual([cny.price, cny.currency, cny.paid], ['9253.30', 'CNY', '']);
});
