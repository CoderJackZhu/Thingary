import test from 'node:test';
import assert from 'node:assert/strict';
import { blankFa, editFa, faCents, faEstimate, faFrom, faOrigin } from '../src/foreign-amount.ts';

const usd = () => editFa(blankFa(), 'code', 'USD', '7.12');
test('switching to a foreign currency brings the remembered rate; back to CNY clears everything', () => {
  assert.deepEqual(usd(), { code: 'USD', text: '', fx: '7.12', paid: '' });
  assert.deepEqual(editFa(usd(), 'code', 'CNY'), blankFa('CNY'));
});
test('the original amount alone gives a grey estimate that is saved when nothing else is typed', () => {
  const s = editFa(usd(), 'text', '1299');
  assert.equal(s.paid, '');
  assert.equal(faEstimate(s), '924888');
  assert.equal(faCents(s), '924888');
  assert.deepEqual(faOrigin(s), { currency: 'USD', original_minor: '129900', fx_rate_micro: '7120000' });
});
test('typing what was actually paid wins and the rate follows it', () => {
  let s = editFa(usd(), 'text', '1299');
  s = editFa(s, 'paid', '9261.55');
  assert.equal(s.fx, '7.129754');
  assert.equal(faCents(s), '926155');
  assert.deepEqual(faOrigin(s), { currency: 'USD', original_minor: '129900', fx_rate_micro: '7129754' });
  // editing the amount afterwards keeps the explicit paid amount and re-derives the rate
  s = editFa(s, 'text', '1300');
  assert.equal(faCents(s), '926155');
  assert.equal(s.fx, '7.124269');
});
test('editing the rate drops an earlier paid amount so the estimate follows the new rate', () => {
  let s = editFa(editFa(usd(), 'text', '100'), 'paid', '700');
  s = editFa(s, 'fx', '7.5');
  assert.equal(s.paid, '');
  assert.equal(faCents(s), '75000');
});
test('without any rate the paid amount alone is enough, and nothing is saved before it', () => {
  let s = editFa(blankFa(), 'code', 'USD');
  s = editFa(s, 'text', '50');
  assert.equal(faCents(s), '');
  assert.equal(faOrigin(s), null);
  s = editFa(s, 'paid', '360');
  assert.equal(s.fx, '7.2');
  assert.equal(faCents(s), '36000');
});
test('zero-decimal currencies and CNY', () => {
  let s = editFa(blankFa(), 'code', 'JPY'); s = editFa(s, 'text', '150000'); s = editFa(s, 'paid', '7065');
  assert.equal(s.fx, '0.0471');
  assert.deepEqual(faOrigin(s), { currency: 'JPY', original_minor: '150000', fx_rate_micro: '47100' });
  assert.equal(faCents(blankFa()), null);
});
test('a saved record reads back into the editor with its paid amount', () => {
  const s = faFrom({ currency: 'USD', original_minor: '129900', fx_rate_micro: '7123400' }, '925330');
  assert.deepEqual(s, { code: 'USD', text: '1299.00', fx: '7.1234', paid: '9253.30' });
  assert.deepEqual(faFrom(null, null), blankFa());
});
