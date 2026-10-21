import test from 'node:test';
import assert from 'node:assert/strict';
import { submitOp, resolveOp, storedOps, dropChange, linkRequest, opKey } from '../src/mobile/wishes/service.ts';

function setup(handler) {
  const store = new Map(), calls = [];
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => { calls.push({ command, args: structuredClone(args) }); return handler(command, args); } } };
  return { store, calls };
}
const item = { id: 'w1', revision: 4, fields: { name: '耳机' } };
const drop = () => ({ kind: 'decision', label: '不再考虑', input: dropChange(item, 'g1', ' 太贵 ', 'req-1') });
const saved = { id: 'w1', decision_state: 'dropped' };

test('决定：成功后清除回执，备注去掉首尾空白', async () => {
  const { store, calls } = setup(() => saved);
  const out = await submitOp(drop());
  assert.equal(out.status, 'saved'); assert.equal(store.size, 0);
  assert.equal(calls[0].command, 'change_wishlist'); assert.equal(calls[0].args.input.action.decision_note, '太贵'); assert.equal(calls[0].args.input.expected_revision, 4);
  delete globalThis.window; delete globalThis.localStorage;
});
test('命令失败但核对确认已保存：取回结果；确认没保存：失败并清除回执', async () => {
  let found = saved;
  const { store, calls } = setup(command => { if (command === 'change_wishlist') throw new Error('响应丢失'); return found; });
  assert.equal((await submitOp(drop())).status, 'saved'); assert.equal(store.size, 0);
  assert.equal(calls.at(-1).command, 'saved_wishlist_request');
  found = null;
  const out = await submitOp(drop());
  assert.equal(out.status, 'failed'); assert.match(out.message, /响应丢失/); assert.equal(store.size, 0);
  delete globalThis.window; delete globalThis.localStorage;
});
test('核对也失败：结果未知，回执保留且重启后可读取，只读核对不重放', async () => {
  let online = false;
  const { store, calls } = setup(command => { if (command === 'change_wishlist') throw new Error('断网'); if (!online) throw new Error('回执暂不可用'); return saved; });
  const out = await submitOp(drop());
  assert.equal(out.status, 'unknown'); assert.equal(store.size, 1);
  const [op] = storedOps();
  assert.equal(op.kind, 'decision'); assert.equal(op.input.request_id, 'req-1');
  const before = calls.filter(c => c.command === 'change_wishlist').length;
  assert.equal((await resolveOp(op, 'g1')).status, 'unknown'); assert.equal(store.size, 1);
  online = true;
  assert.equal((await resolveOp(op, 'g1')).status, 'saved'); assert.equal(store.size, 0);
  assert.equal(calls.filter(c => c.command === 'change_wishlist').length, before, '核对不重发写入');
  delete globalThis.window; delete globalThis.localStorage;
});
test('另一笔回执未核对时不覆盖原请求；资料库切换的回执直接放弃', async () => {
  const { store } = setup(command => { if (command === 'change_wishlist') throw new Error('断网'); throw new Error('不可用'); });
  assert.equal((await submitOp(drop())).status, 'unknown');
  const original = store.get(opKey(drop()));
  const other = { kind: 'decision', label: '重新考虑', input: dropChange(item, 'g1', '', 'req-2') };
  const out = await submitOp(other);
  assert.equal(out.status, 'failed'); assert.equal(store.get(opKey(drop())), original);
  assert.equal((await resolveOp(storedOps()[0], 'g2')).status, 'stale'); assert.equal(store.size, 0);
  delete globalThis.window; delete globalThis.localStorage;
});
test('关联：用 saved_wish_feature 核对；购入：用 convert_wishlist 与 saved_request 核对', async () => {
  const link = { kind: 'link', label: '关联已有物品', input: linkRequest(item, 'g1', { id: 'a1', revision: 7 }, 'req-l') };
  let c = setup(command => { if (command === 'link_wish_asset') throw new Error('x'); return saved; });
  assert.equal((await submitOp(link)).status, 'saved');
  assert.deepEqual(c.calls.at(-1), { command: 'saved_wish_feature', args: { request: 'req-l', generation: 'g1' } });
  assert.equal(c.calls[0].args.input.expected_asset_revision, 7);
  const base = { request_id: 'req-p', generation: 'g1', asset_id: null, expected_revision: null, name: '耳机', price_cents: null, purchase_date: '2026-10-01' };
  const purchase = { kind: 'purchase', label: '记录购入', wishlistId: 'w1', expectedRevision: 4, input: { base, details: {}, photos: { ids: [], cover_id: null } }, draft: { conversion: { wishlist_id: 'w1', expected_revision: 4 }, pending: { base }, generation: 'g1' } };
  c = setup(command => { if (command === 'convert_wishlist') throw new Error('x'); return null; });
  const out = await submitOp(purchase);
  assert.equal(out.status, 'failed');
  assert.equal(c.calls[0].command, 'convert_wishlist'); assert.equal(c.calls[0].args.input.wishlist_id, 'w1'); assert.equal(c.calls[0].args.input.expected_revision, 4);
  assert.deepEqual(c.calls.at(-1), { command: 'saved_request', args: { request: 'req-p', generation: 'g1' } });
  assert.equal(c.store.size, 0, '失败不留半条记录');
  delete globalThis.window; delete globalThis.localStorage;
});
