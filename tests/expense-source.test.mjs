import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseSourceTarget } from '../src/expenses.ts';

test('payment projections route by both IDs even when names and dates are identical', () => {
  const base = { source: 'payment', title: 'Same rent or subscription', date: '2026-10-07', asset_id: null };
  assert.deepEqual(expenseSourceTarget({ ...base, id: 'payment-a', plan_id: 'plan-a' }), { kind: 'payment', id: 'payment-a', plan_id: 'plan-a' });
  assert.deepEqual(expenseSourceTarget({ ...base, id: 'payment-b', plan_id: 'plan-b' }), { kind: 'payment', id: 'payment-b', plan_id: 'plan-b' });
  assert.equal(expenseSourceTarget({ ...base, id: 'payment-a', plan_id: null }), null);
});

test('virtual, topup, physical and standalone sources retain their own owner domains', () => {
  assert.deepEqual(expenseSourceTarget({ source: 'virtual', id: 'virtual-a', asset_id: null }), { kind: 'virtual', id: 'virtual-a' });
  assert.deepEqual(expenseSourceTarget({ source: 'topup', id: 'topup-a', asset_id: 'virtual-a' }), { kind: 'topup', id: 'topup-a', asset_id: 'virtual-a' });
  assert.deepEqual(expenseSourceTarget({ source: 'maintenance', id: 'maintenance-a', asset_id: 'physical-a' }), { kind: 'asset', id: 'physical-a' });
  assert.deepEqual(expenseSourceTarget({ source: 'linked', id: 'expense-a', asset_id: 'physical-a' }), { kind: 'expense', id: 'expense-a' });
  assert.equal(expenseSourceTarget({ source: 'topup', id: 'topup-a', asset_id: null }), null);
});
