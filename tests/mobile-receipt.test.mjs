import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceRequests, emptyBalance, saveInOrder } from '../src/mobile/model.ts';
import { pendingKey, resolvePending, storedPending, submit, Unresolved } from '../src/wealth.ts';

test('手机串行保存使用真实 submit：部分成功、未知保留原请求、重启读取、只读核对后继续', async () => {
  const store = new Map(), calls = [], committed = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  let receiptAvailable = false;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === 'wealth_quick_update') {
      committed.set(args.input.request_id, args.input.changes[0].account_id);
      if (args.input.request_id === 'r2') throw new Error('虚构响应丢失');
      return { id: args.input.request_id };
    }
    if (!receiptAvailable) throw new Error('虚构回执读取失败');
    return committed.get(args.request) ?? null;
  } } };
  const accounts = ['a', 'b', 'c'].map(id => ({ id, fields: { side: 'asset' } }));
  const draft = { generation: 'fictional-only', date: '2026-10-21', rows: accounts.map(account => ({ account, previous: null })), existing: null };
  let n = 0;
  const requests = balanceRequests(draft, accounts, Object.fromEntries(accounts.map(a => [a.id, { ...emptyBalance(), amount: '100' }])), () => `r${++n}`);
  const saved = [];
  await assert.rejects(saveInOrder(requests, input => submit({ command: 'wealth_quick_update', label: '虚构手机盘点', input }), id => saved.push(id)), Unresolved);
  assert.deepEqual(saved, ['a']);
  const original = store.get(pendingKey), pending = storedPending();
  assert.deepEqual(pending.input, requests[1]);
  assert.equal(calls.filter(c => c.command === 'wealth_quick_update').length, 2);
  await assert.rejects(submit({ command: 'wealth_quick_update', label: '不能覆盖原请求', input: requests[2] }), Unresolved);
  assert.equal(store.get(pendingKey), original);
  receiptAvailable = true;
  assert.equal(await resolvePending(JSON.parse(original)), 'saved');
  assert.equal(storedPending(), null);
  assert.equal(calls.filter(c => c.command === 'wealth_quick_update').length, 2, '核对只读，不重放或自动提交剩余行');
  assert.deepEqual(calls.at(-1).args, { request: 'r2', generation: 'fictional-only' });
  delete globalThis.window; delete globalThis.localStorage;
});
