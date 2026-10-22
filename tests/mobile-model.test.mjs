import test from 'node:test';
import assert from 'node:assert/strict';
import { availableAccounts, balanceChange, balanceRequests, emptyBalance, homeView, saveInOrder } from '../src/mobile/model.ts';

const account = (id, extra = {}) => ({ id, fields: { name: `虚构${id}`, institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: '2026-01-01', closed_on: null, notes: '', ...extra }, position: 0, revision: 1, latest: null });
const accounts = [account('cash'), account('card', { side: 'liability', kind: 'credit_card' })];
const draft = () => ({ generation: 'fictional-mobile', date: '2026-10-21', existing: null, rows: accounts.map(a => ({ account: a, previous: null })) });
const point = (date, extra = {}) => ({ date, complete: true, assets_cents: '10000', liabilities_cents: '0', net_cents: '10000', change_cents: null, compared_to: null, scope_changed: false, ...extra });

test('家底投影复用完整盘点和后端比较，不把最近不完整盘点拼入总额', () => {
  const complete = point('2026-09-21', { change_cents: '0', compared_to: '2026-08-21' });
  const partial = point('2026-10-21', { complete: false, assets_cents: '1' });
  const view = homeView({ points: [complete, partial] });
  assert.equal(view.latest, partial); assert.equal(view.shown, complete); assert.equal(view.change, '持平');
  assert.equal(homeView({ points: [point('2026-10-21', { scope_changed: true, compared_to: '2026-09-21', change_cents: '999' })] }).change, '不可比');
});
test('无盘点与不完整盘点不伪造完整总额或比较', () => {
  assert.deepEqual(homeView({ points: [] }), { latest: undefined, shown: undefined, change: '—', comparedTo: null });
  const partial = point('2026-10-21', { complete: false });
  assert.equal(homeView({ points: [partial] }).shown, partial);
  assert.equal(homeView({ points: [partial] }).change, '—');
});
test('快速账户同时遵守桌面可用日期规则和当天草稿范围', () => {
  const closed = account('closed', { closed_on: '2026-10-20' });
  const future = account('future', { opened_on: '2026-10-22' });
  const d = draft(); d.rows.push({ account: closed }, { account: future });
  assert.deepEqual(availableAccounts([...accounts, closed, future, account('not-in-draft')], [], d, d.date).map(a => a.id), ['cash', 'card']);
  assert.deepEqual(availableAccounts(accounts, [point('2026-10-22')], d, d.date), []);
});
test('明确零可保存；空值、负数和超上限不转成零，负债仍记录正欠款', () => {
  assert.deepEqual(balanceChange(draft(), accounts[0], { ...emptyBalance(), amount: '0' }), { account_id: 'cash', amount_cents: '0' });
  assert.equal(balanceChange(draft(), accounts[1], { ...emptyBalance(), amount: '2500' }).amount_cents, '2500');
  for (const amount of ['', '-1', '1.5', '100000000000']) assert.throws(() => balanceChange(draft(), accounts[0], { ...emptyBalance(), amount }));
});
test('外币和持仓复用桌面整数事实构建器，缺少汇率或单价时拒绝', () => {
  const foreign = account('usd', { currency: 'USD' });
  const holding = account('fund', { kind: 'fund', holding_mode: true });
  const d = draft(); d.rows.push({ account: foreign }, { account: holding });
  assert.equal(balanceChange(d, foreign, { ...emptyBalance(), amount: '12345', rate: '7000000' }).amount_cents, '86415');
  assert.throws(() => balanceChange(d, foreign, { ...emptyBalance(), amount: '100' }));
  assert.equal(balanceChange(d, holding, { ...emptyBalance(), quantity: '100000000', price: '2500000' }).amount_cents, '250');
  assert.throws(() => balanceChange(d, holding, { ...emptyBalance(), quantity: '100000000' }));
});
test('整批校验通过后构造独立请求；未编辑行不提交，输入不被修改', () => {
  const values = { cash: { ...emptyBalance(), amount: '123' }, card: { ...emptyBalance(), amount: '0' } };
  const before = structuredClone(values); let n = 0;
  const requests = balanceRequests(draft(), accounts, values, () => `request-${++n}`);
  assert.deepEqual(requests.map(r => [r.request_id, r.generation, r.date, r.changes.length]), [['request-1', 'fictional-mobile', '2026-10-21', 1], ['request-2', 'fictional-mobile', '2026-10-21', 1]]);
  assert.deepEqual(values, before);
  assert.equal(balanceRequests(draft(), accounts, { cash: values.cash }, () => 'one').length, 1);
  assert.throws(() => balanceRequests(draft(), accounts, { ...values, card: emptyBalance() }, () => 'unused'));
});
test('串行写入只在上一笔明确成功后继续，失败或未知均停止，不重放原请求', async () => {
  const requests = ['one', 'two', 'three'].map(id => ({ request_id: id, generation: 'fictional', date: '2026-10-21', changes: [{ account_id: id }] }));
  const sent = [], saved = [];
  const unknown = new Error('结果未知');
  await assert.rejects(saveInOrder(requests, async input => { sent.push(input); if (input.request_id === 'two') throw unknown; }, id => saved.push(id)), unknown);
  assert.deepEqual(sent, requests.slice(0, 2)); assert.deepEqual(saved, ['one']);
  const order = [];
  await saveInOrder(requests, async input => { order.push(`send:${input.request_id}`); await Promise.resolve(); }, id => order.push(`saved:${id}`));
  assert.deepEqual(order, ['send:one', 'saved:one', 'send:two', 'saved:two', 'send:three', 'saved:three']);
});
