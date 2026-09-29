import test from 'node:test';
import assert from 'node:assert/strict';
import { contentsText, entryDisplay, restoresViaWealth, storedRecordTrash, recordKindLabel, trashFilters, stateText } from '../src/unified-trash.ts';

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
  assert.deepEqual(known.facts, ['2026-09-03 · 费用 ¥200']);
  assert.equal(known.parentBlocked, false);
  const unknown = entryDisplay(entry({ kind: 'maintenance', title: '检修', subtype: 'service', date: null, cost_cents: null }));
  assert.deepEqual(unknown.facts, ['日期未知 · 费用 待补录']);
  const free = entryDisplay(entry({ kind: 'maintenance', title: '免费清洁', subtype: 'cleaning', date: '2026-09-04', cost_cents: '0' }));
  assert.deepEqual(free.facts, ['2026-09-04 · 费用 ¥0']);
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

test('unified filters expose the agreed views plus wishes (D17) and wealth (W03)', () => {
  assert.deepEqual(trashFilters.map(([key]) => key), ['all', 'asset', 'maintenance', 'warranty', 'wish', 'wealth']);
});

test('D17: a row says what its deletion took along', () => {
  assert.equal(contentsText([]), '');
  assert.equal(contentsText([{ kind: 'maintenance', count: 3 }, { kind: 'photo', count: 5 }]), '含 3 条维护、5 张图片');
  assert.equal(contentsText([{ kind: 'expense', count: 1 }, { kind: 'payment', count: 2 }]), '含 1 笔关联支出、2 条付款记录');
});

test('D17: wish rows name the realized item and restore like wealth rows', () => {
  const wish = entryDisplay(entry({ kind: 'wish', title: '虚构台灯', subtype: 'achieved', date: '2026-09-20', asset_name: '虚构台灯', asset_deleted: false }));
  assert.deepEqual([wish.typeLabel, wish.title, wish.parentBlocked], ['心愿', '虚构台灯', false]);
  assert.deepEqual(wish.facts, ['已实现 · 2026-09-20', '实现的物品「虚构台灯」仍在我的物品中']);
  assert.deepEqual(entryDisplay(entry({ kind: 'wish', title: '想要的书', subtype: 'ongoing', asset_name: null })).facts, ['未实现']);
  assert.equal(restoresViaWealth('wish'), true);
  assert.equal(restoresViaWealth('asset'), false);
  assert.equal(restoresViaWealth('maintenance'), false);
});

test('wealth rows describe themselves without an owning asset', () => {
  const snapshot = entryDisplay(entry({ kind: 'snapshot', title: '2026-09-30', date: '2026-09-30', asset_id: null }));
  assert.equal(snapshot.typeLabel, '盘点');
  assert.equal(snapshot.title, '2026-09-30 盘点');
  assert.equal(snapshot.parentBlocked, false);
  const account = entryDisplay(entry({ kind: 'account', title: '误建账户', asset_id: null }));
  assert.equal(account.title, '误建账户');
});

test('expense rows show their date and category label', () => {
  const row = entryDisplay(entry({ kind: 'expense', title: '虚构旅行', subtype: 'travel', date: '2026-08-01', asset_id: null }));
  assert.deepEqual([row.typeLabel, row.title, row.facts[0], row.parentBlocked], ['支出', '虚构旅行', '2026-08-01 · 旅行', false]);
});

test('recurring rows name their plan, period and a deleted parent', () => {
  const plan = entryDisplay(entry({ kind: 'plan', title: '虚构房租', subtype: 'rent', asset_id: null }));
  assert.deepEqual([plan.typeLabel, plan.title, plan.facts[0]], ['周期计划', '虚构房租', '房租 · 恢复后付款记录一并显示']);
  const paid = entryDisplay(entry({ kind: 'payment', title: '虚构房租', subtype: 'paid', date: '2026-09-01', cost_cents: '300000', asset_id: null, asset_deleted: true }));
  assert.equal(paid.title, '虚构房租 · 2026-09-01 期');
  assert.deepEqual(paid.facts, ['已付 ¥3,000', '所属计划也在最近删除中，请先恢复计划']);
});
