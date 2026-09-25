import test from 'node:test';
import assert from 'node:assert/strict';
import { entryDisplay, storedRecordTrash, recordKindLabel, trashFilters, stateText } from '../src/unified-trash.ts';

const entry = over => ({ kind: 'asset', id: 'e1', title: '虚构相机', subtype: null, date: null, end_date: null, cost_cents: null, provider: null, deleted_at: '2026-09-10T08:00:00+00:00', asset_id: null, asset_name: null, asset_deleted: true, asset_revision: 5, asset_state: 'sold', ...over });

test('asset entries keep their original lifecycle state', () => {
  const display = entryDisplay(entry({ asset_state: 'retired' }));
  assert.equal(display.typeLabel, '资产');
  assert.equal(display.title, '虚构相机');
  assert.deepEqual(display.facts, ['原状态：已退役']);
  assert.equal(display.parentBlocked, false);
  assert.equal(entryDisplay(entry({ asset_state: 'sold' })).facts[0], '原状态：已售出');
});

test('maintenance entries show date and cost with unknown distinct from zero', () => {
  const known = entryDisplay(entry({ kind: 'maintenance', title: '更换快门', subtype: 'repair', date: '2026-09-03', cost_cents: '20000', asset_deleted: false }));
  assert.equal(known.typeLabel, '维护');
  assert.equal(known.title, '更换快门');
  assert.deepEqual(known.facts, ['2026-09-03 · 费用 ¥200.00']);
  assert.equal(known.parentBlocked, false);
  const unknown = entryDisplay(entry({ kind: 'maintenance', title: '检修', subtype: 'service', date: null, cost_cents: null }));
  assert.deepEqual(unknown.facts, ['日期未知 · 费用 待补录']);
  const free = entryDisplay(entry({ kind: 'maintenance', title: '免费清洁', subtype: 'cleaning', date: '2026-09-04', cost_cents: '0' }));
  assert.deepEqual(free.facts, ['2026-09-04 · 费用 ¥0.00']);
  const untitled = entryDisplay(entry({ kind: 'maintenance', title: '', subtype: 'upgrade', date: null, cost_cents: null }));
  assert.equal(untitled.title, '升级');
});

test('warranty entries compose kind and provider and flag a deleted parent', () => {
  const covered = entryDisplay(entry({ kind: 'warranty', title: 'Apple', provider: 'Apple', subtype: 'applecare', date: '2026-01-01', end_date: '2026-12-31', asset_deleted: false }));
  assert.equal(covered.typeLabel, '保障');
  assert.equal(covered.title, 'AppleCare · Apple');
  assert.deepEqual(covered.facts, ['2026-01-01 – 2026-12-31']);
  assert.equal(covered.parentBlocked, false);
  const blocked = entryDisplay(entry({ kind: 'warranty', title: '', provider: '', subtype: 'other', date: null, end_date: null, asset_deleted: true }));
  assert.equal(blocked.title, '其他保障');
  assert.deepEqual(blocked.facts, ['起日期未知 – 止日期未知']);
  assert.equal(blocked.parentBlocked, true);
});

test('record trash reminder survives restart and rejects corrupt values', () => {
  const action = { pending: true, input: { request_id: 'request-1', generation: 'g1', asset_id: 'asset-1', record_id: 'record-1', kind: 'maintenance', expected_revision: 4, deleted: true }, meta: { title: '更换快门', assetName: '虚构相机' } };
  const values = new Map([['possio.record-trash-request.v1', JSON.stringify(action)]]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  try {
    const stored = storedRecordTrash();
    assert.equal(stored.input.request_id, 'request-1');
    assert.equal(stored.input.kind, 'maintenance');
    assert.equal(stored.meta.assetName, '虚构相机');
    assert.equal(recordKindLabel[stored.input.kind], '维护记录');
    for (const corrupt of [null, '{"pending":false}', '{"pending":true,"input":{"kind":"asset"}}', JSON.stringify({ ...action, input: { ...action.input, generation: undefined } }), 'not json']) {
      values.set('possio.record-trash-request.v1', corrupt);
      assert.equal(storedRecordTrash(), null, corrupt);
    }
    values.delete('possio.record-trash-request.v1');
    assert.equal(storedRecordTrash(), null);
  } finally {
    if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous;
  }
});

test('unified filters expose exactly the four agreed views', () => {
  assert.deepEqual(trashFilters.map(([key]) => key), ['all', 'asset', 'maintenance', 'warranty']);
});
