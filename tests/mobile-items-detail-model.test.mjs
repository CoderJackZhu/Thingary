import test from 'node:test';
import assert from 'node:assert/strict';
import { detailGoal, detailLifecycleInput, detailMaintenanceInput, detailSaleInput, detailWarrantyInput, decimalFromMinor, minorFromDecimal } from '../src/mobile/items/detail-model.ts';
import { defaultPreferences } from '../src/preferences.ts';
import { blankWarranty } from '../src/warranty.ts';
import { blankMaintenance } from '../src/maintenance.ts';
import { saleFields } from '../src/sales.ts';
function record() {
  return { asset: { id: 'fictional-camera', name: '虚构相机', price_cents: '10000', purchase_date: '2026-01-01', revision: 7 }, details: { brand: '', model: '', serial_number: '', notes: '' }, photos: [], cover_id: null, maintenances: [], warranties: [], deleted: false, lifecycle: { state: 'active', events: [] }, preferences: { ...defaultPreferences(), goal: { mode: 'cost', cents: '100' } }, costs: { total_investment_cents: '10000', net_cost_cents: null, held_days: 80, daily_cents: '125', known_maintenance_cents: '0', unknown_maintenance_count: 0 } };
}
test('mobile detail goal freezes at retirement and refuses incomplete maintenance costs', () => {
  const r = record();
  assert.equal(detailGoal(r).progress.hundredths, 8000);
  r.lifecycle = { state: 'retired', events: [{ id: 'retirement', kind: 'retire', date: '2026-01-10', sequence: 1, notes: '' }] };
  assert.equal(detailGoal(r).progress.hundredths, 1000);
  assert.equal(detailGoal(r).frozen, '2026-01-10');
  r.costs.unknown_maintenance_count = 1;
  assert.equal(detailGoal(r).progress, null);
});
test('mobile detail preserves zero and unknown in currency controls and maintenance requests', () => {
  assert.equal(decimalFromMinor(''), ''); assert.equal(decimalFromMinor('0'), '0.00');
  assert.equal(minorFromDecimal(''), ''); assert.equal(minorFromDecimal('0.00'), '0');
  assert.equal(decimalFromMinor('99999999999'), '999999999.99');
  for (const [cost, expected] of [['', null], ['0', '0'], ['1.25', '125']]) {
    const input = detailMaintenanceInput(record(), 'generation-a', { ...blankMaintenance(), kind: 'accessory', title: '虚构配件', cost }, '2026-10-21');
    assert.equal(input.action.fields.cost_cents, expected);
    assert.equal(input.expected_revision, 7);
    assert.equal(input.generation, 'generation-a');
  }
});
test('mobile detail rejects backdated sale and state dates using the desktop rules', () => {
  const r = record(), fields = { ...saleFields(r, '2026-10-21'), date: '2025-12-31', price: '0' };
  const draft = { record: r, generation: 'generation-a', mode: 'sell', fields, original: fields, pending: null };
  assert.throws(() => detailSaleInput(draft, '2026-10-21'), /不能早于购入日期/);
  assert.throws(() => detailLifecycleInput(r, 'generation-a', { type: 'append', kind: 'retire', date: '2025-12-31', notes: '' }, '2026-10-21'), /不能早于购入日期/);
  const input = detailSaleInput({ ...draft, fields: { ...fields, date: '2026-10-21' } }, '2026-10-21');
  assert.equal(input.action.fields.price_cents, '0');
  assert.equal(input.asset_id, r.asset.id);
});
test('mobile warranty correction preserves attachments and reminder identity', () => {
  const fields = { ...blankWarranty(), start: '2026-01-01', end: '2027-01-01', photo_ids: ['fictional-photo'], reminder: { date: '2026-12-30', notes: '虚构提醒' } };
  const input = detailWarrantyInput(record(), 'generation-a', fields, 'warranty-a');
  assert.equal(input.action.type, 'correct'); assert.equal(input.action.warranty_id, 'warranty-a');
  assert.deepEqual(input.action.photos.ids, ['fictional-photo']);
  assert.deepEqual(input.reminder, { value: fields.reminder });
  assert.throws(() => detailWarrantyInput(record(), 'generation-a', { ...fields, end: '2025-01-01' }), /不能早于/);
});
test('mobile refuses revoking historical state events or state under an effective sale', () => {
  const r = record();
  r.lifecycle.events = [{ id: 'old', kind: 'retire', date: '2026-01-10' }, { id: 'last', kind: 'activate', date: '2026-01-11' }];
  assert.throws(() => detailLifecycleInput(r, 'generation-a', { type: 'correct_date', event_id: 'old', date: '2026-01-10' }, '2026-10-21', true), /只能撤销最近/);
  r.sale = { id: 'sale', previous_state: 'active', fields: { date: '2026-10-20', price_cents: '1000' } };
  assert.throws(() => detailLifecycleInput(r, 'generation-a', { type: 'correct_date', event_id: 'last', date: '2026-01-11' }, '2026-10-21', true), /请先撤销误记售出/);
});
