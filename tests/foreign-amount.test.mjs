import test from 'node:test';
import assert from 'node:assert/strict';
import { blankFa, editFa, faCents, faFrom, faOrigin } from '../src/foreign-amount.ts';

const usd = () => editFa(blankFa(), 'code', 'USD', '7.12');
test('switching to a foreign currency brings the remembered rate; back to CNY clears everything', () => {
  assert.deepEqual(usd(), { code: 'USD', text: '', fx: '7.12', paid: '' });
  assert.deepEqual(editFa(usd(), 'code', 'CNY'), blankFa('CNY'));
});
test('typing the original amount with a rate gives the paid amount', () => {
  let s = editFa(usd(), 'text', '1299');
  assert.equal(s.paid, '9248.88');
  s = editFa(s, 'fx', '7.1234');
  assert.equal(s.paid, '9253.30');
  assert.equal(faCents(s), '925330');
});
test('typing what was actually paid derives the rate and keeps the paid amount exactly', () => {
  let s = editFa(usd(), 'text', '1299');
  s = editFa(s, 'paid', '9261.55');
  assert.equal(s.paid, '9261.55');
  assert.equal(s.fx, '7.129754');
  assert.equal(faCents(s), '926155');
  assert.deepEqual(faOrigin(s), { currency: 'USD', original_minor: '129900', fx_rate_micro: '7129754' });
});
test('without a remembered rate the paid amount alone is enough', () => {
  let s = editFa(blankFa(), 'code', 'USD');
  s = editFa(s, 'text', '50'); s = editFa(s, 'paid', '360');
  assert.equal(s.fx, '7.2');
  assert.equal(faCents(s), '36000');
});
test('zero-decimal currencies and incomplete input', () => {
  let s = editFa(blankFa(), 'code', 'JPY'); s = editFa(s, 'text', '150000'); s = editFa(s, 'paid', '7065');
  assert.equal(s.fx, '0.0471');
  assert.deepEqual(faOrigin(s), { currency: 'JPY', original_minor: '150000', fx_rate_micro: '47100' });
  assert.equal(faCents(editFa(blankFa(), 'code', 'USD')), '');
  assert.equal(faCents(blankFa()), null);
});
test('a saved record reads back into the editor', () => {
  const s = faFrom({ currency: 'USD', original_minor: '129900', fx_rate_micro: '7123400' }, '925330');
  assert.deepEqual(s, { code: 'USD', text: '1299.00', fx: '7.1234', paid: '9253.30' });
  assert.deepEqual(faFrom(null, null), blankFa());
});
