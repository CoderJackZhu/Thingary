import test from 'node:test';
import assert from 'node:assert/strict';
import { quickAvailable, quickBalance, quickChanges, quickPrevious, quickCounted, quickTransfer, quickTransferPairs, quickDateMin, quickDeltaLabel, accountUpdateAge } from '../src/wealth.ts';
const account = (id, side = 'asset', counted = true) => ({ id, fields: { name: `虚构${id}`, side, kind: side === 'asset' ? 'cash' : 'loan', counted } });
const fixture = () => ({ generation: '虚构资料', date: '2026-10-17', existing: null, rows: [account('cash'), account('fund'), account('card', 'liability'), account('house', 'asset', false), account('unknown')].map((a, i) => ({ account: a, previous: i === 4 ? null : { amount_cents: ['10000', '5000', '3000', '20000'][i], date: '2026-10-01' } })) });

test('虚构整数分增减：负值、零、上界、未知和负债方向', () => {
  assert.equal(quickBalance('10000', '-500'), '9500');
  assert.equal(quickBalance('0', '0'), '0');
  assert.equal(quickBalance('99999999998', '1'), '99999999999');
  for (const [old, delta] of [['3', '-4'], [null, '1'], ['99999999999', '1'], ['2', '1.1'], ['2', '']]) assert.throws(() => quickBalance(old, delta));
  assert.equal(quickDeltaLabel('liability'), '增加欠款／减少欠款');
  const draft = fixture();
  assert.deepEqual(quickChanges(draft, 'card', 'delta', '-1000', '', ''), [{ account_id: 'card', amount_cents: '2000', expected_previous: '3000' }]);
  assert.deepEqual(quickChanges(draft, 'unknown', 'balance', '0', '', ''), [{ account_id: 'unknown', amount_cents: '0' }]);
});
test('虚构当天未知：不回退历史金额，entered零与unchanged原记录优先', () => {
  const draft = fixture();
  draft.existing = { entries: [{ account_id: 'cash', amount_cents: null, counted: false }, { account_id: 'fund', amount_cents: '0', counted: true }, { account_id: 'card', state: 'unchanged', amount_cents: '2222', counted: true }] };
  assert.equal(quickPrevious(draft, 'cash'), null);
  assert.equal(quickPrevious(draft, 'fund'), '0');
  assert.equal(quickPrevious(draft, 'card'), '2222');
  assert.equal(quickCounted(draft, 'cash'), false);
  assert.throws(() => quickChanges(draft, 'cash', 'delta', '1', '', ''));
});
test('虚构转账：资产互转和还款抵消；未知、不同计入、负债转出、负余额均拒绝', () => {
  const draft = fixture(), pairs = quickTransferPairs(draft);
  assert.deepEqual(pairs, [{ from: 'cash', to: 'fund' }, { from: 'cash', to: 'card' }, { from: 'fund', to: 'cash' }, { from: 'fund', to: 'card' }]);
  assert.deepEqual(quickTransfer(draft, 'cash', 'fund', '2500').map(c => c.amount_cents), ['7500', '7500']);
  assert.deepEqual(quickTransfer(draft, 'cash', 'card', '3000').map(c => c.amount_cents), ['7000', '0']);
  for (const args of [['cash', 'house', '1'], ['card', 'cash', '1'], ['cash', 'unknown', '1'], ['cash', 'cash', '1'], ['cash', 'fund', '10001'], ['cash', 'card', '3001'], ['cash', 'fund', '0']]) assert.throws(() => quickTransfer(draft, ...args));
});
test('虚构历史计入范围：当天记录优先于当前账户偏好，两个未计入账户也可转账', () => {
  const draft = fixture();
  draft.existing = { entries: [{ account_id: 'cash', counted: false, amount_cents: '10000' }, { account_id: 'fund', counted: true, amount_cents: '5000' }, { account_id: 'house', counted: false, amount_cents: '20000' }] };
  assert.ok(!quickTransferPairs(draft).some(p => p.from === 'cash' && p.to === 'fund'));
  assert.ok(quickTransferPairs(draft).some(p => p.from === 'cash' && p.to === 'house'));
  assert.deepEqual(quickTransfer(draft, 'cash', 'house', '10').map(c => c.amount_cents), ['9990', '20010']);
});
test('虚构日期下限包括最新不完整盘点；更新时间来自entered日期', () => {
  assert.equal(quickDateMin([]), '1900-01-01');
  assert.equal(quickDateMin([{ date: '2026-09-01', complete: true }, { date: '2026-10-17', complete: false }, { date: '2026-10-01', complete: true }]), '2026-10-17');
  assert.deepEqual(accountUpdateAge('2026-07-18', '2026-10-17'), { text: '91 天前更新', old: true });
  assert.deepEqual(accountUpdateAge(null, '2026-10-17'), { text: '尚未填写金额', old: false });
});


test('虚构Quick入口可用日期：最近盘点、开户、停用与今天的交集必须非空', () => {
  const a = { fields: { opened_on: '2026-01-01', closed_on: null } };
  const points = [{ date: '2026-10-10' }, { date: '2026-10-15' }];
  assert.equal(quickAvailable(a, points, '2026-10-17'), true);
  assert.equal(quickAvailable({ fields: { opened_on: '2026-10-18', closed_on: null } }, points, '2026-10-17'), false);
  assert.equal(quickAvailable({ fields: { opened_on: '2026-01-01', closed_on: '2026-10-15' } }, points, '2026-10-17'), false);
  assert.equal(quickAvailable({ fields: { opened_on: '2026-01-01', closed_on: '2026-10-16' } }, points, '2026-10-17'), true);
  assert.equal(quickAvailable(a, [{ date: '2026-10-18' }], '2026-10-17'), false);
  assert.equal(quickAvailable({ fields: { opened_on: '2026-10-17', closed_on: null } }, [], '2026-10-17'), true);
  assert.equal(quickAvailable({ fields: { opened_on: '2026-10-17', closed_on: '2026-10-17' } }, [], '2026-10-17'), false);
});
