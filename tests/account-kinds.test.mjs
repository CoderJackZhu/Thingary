import test from 'node:test';
import assert from 'node:assert/strict';
import { assetKinds, kindLabel, defaultAccountCounted, selectAccountKind } from '../src/wealth.ts';
import { suggestedFundAvailability } from '../src/planning-fund-scope.ts';
const initial = { name: '', institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: '2026-10-15', closed_on: null, notes: '' };
test('new category defaults, explicit scope and property exclusion remain distinct', () => {
  for (const [kind, counted] of [['property', false], ['insurance', false], ['pension', true], ['precious_metal', true], ['receivable', true], ['vehicle', false]]) {
    assert.ok(assetKinds.some(([k]) => k === kind));
    assert.notEqual(kindLabel(kind), kind);
    assert.equal(defaultAccountCounted(kind), counted);
    assert.equal(selectAccountKind(initial, kind, null).counted, counted);
    assert.equal(suggestedFundAvailability(kind), 'restricted');
  }
  assert.equal(selectAccountKind(initial, 'insurance', true).counted, true);
  assert.equal(selectAccountKind(initial, 'pension', false).counted, false);
  assert.equal(selectAccountKind(initial, 'property', true).counted, false);
  assert.equal(selectAccountKind({ ...initial, kind: 'property', counted: false }, 'cash', true).counted, true);
  assert.equal(selectAccountKind({ ...initial, counted: false }, 'cash', false).counted, false);
  assert.equal(selectAccountKind(initial, 'loan', null).side, 'liability');
  assert.equal(suggestedFundAvailability('cash'), 'available');
  assert.equal(suggestedFundAvailability('mixed'), 'available');
});
test('vehicles may be counted on request while property never is', () => {
  assert.equal(selectAccountKind(initial, 'vehicle', true).counted, true);
  assert.equal(selectAccountKind(initial, 'receivable', null).side, 'asset');
  assert.equal(assetKinds.at(-1)[0], 'other_asset');
});
