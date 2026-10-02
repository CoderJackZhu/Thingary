import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellText, defaultRange, sortRows } from '../src/wealth.ts';

const point = (id, date, over = {}) => ({
  snapshot_id: id, date, assets_cents: '0', liabilities_cents: '0', net_cents: '0',
  complete: true, missing: 0, compared_to: null, scope_changed: false, change_cents: null,
  change_rate_hundredths: null, ...over,
});
const row = (over = {}) => ({
  account_id: 'a', name: 'A', institution: '', side: 'asset', kind: 'cash',
  from: { state: 'entered', amount_cents: '100', counted: true },
  to: { state: 'entered', amount_cents: '250', counted: true },
  change_cents: '150', effect_cents: '150', rate_hundredths: 15000,
  group: 'counted', tag: null, ...over,
});

test('defaultRange prefers the overview pair, then the last two check-ins, else null', () => {
  // 与概览「与上次比较」同一对：最近完整盘点与其上一次完整盘点。
  const points = [
    point('a', '2026-09-30'),
    point('b', '2026-10-15', { complete: false, missing: 1 }),
    point('c', '2026-10-31', { compared_to: '2026-09-30' }),
  ];
  assert.deepEqual(defaultRange(points), { from: 'a', to: 'c' });
  // 没有可比的完整对时用最后两次盘点（可以是不完整的）。
  const pair = [point('a', '2026-09-30'), point('b', '2026-10-31', { complete: false, missing: 2 })];
  assert.deepEqual(defaultRange(pair), { from: 'a', to: 'b' });
  // 只有一次盘点（或空）时不比较。
  assert.equal(defaultRange([point('a', '2026-09-30')]), null);
  assert.equal(defaultRange([]), null);
  // compared_to 指向的盘点已不存在时不再杜撰一对。
  assert.equal(defaultRange([point('c', '2026-10-31', { compared_to: '2026-09-30' })]), null);
});

test('sortRows orders by absolute effect with unknowns last, or by kind then position', () => {
  const big = row({ account_id: 'big', effect_cents: '30000' });
  const small = row({ account_id: 'small', effect_cents: '-10000' });
  const negativeBig = row({ account_id: 'neg', effect_cents: '-30000' });
  const unknown = row({ account_id: 'unk', effect_cents: null, change_cents: null });
  const tie = row({ account_id: 'tie', effect_cents: '30000' });
  assert.deepEqual(
    sortRows([small, unknown, big, tie, negativeBig], 'impact').map(r => r.account_id),
    ['big', 'tie', 'neg', 'small', 'unk'],
    '｜影响｜降序，同值保持账户位置，未知最后',
  );
  const investment = row({ account_id: 'i', kind: 'investment' });
  const card = row({ account_id: 'cc', kind: 'credit_card', side: 'liability' });
  const housing = row({ account_id: 'h', kind: 'housing_fund' });
  const cash = row({ account_id: 'c', kind: 'cash' });
  assert.deepEqual(
    sortRows([investment, card, housing, cash], 'kind').map(r => r.account_id),
    ['c', 'i', 'h', 'cc'],
    '先资产类型顺序再负债类型顺序，同类型保持账户位置',
  );
});

test('cellText renders amounts, liabilities and the three textual states', () => {
  const cell = (over = {}) => ({ state: 'entered', amount_cents: '123400', counted: true, ...over });
  assert.equal(cellText(cell(), 'asset'), '¥1,234');
  assert.equal(cellText(cell({ amount_cents: '500000' }), 'liability'), '欠 ¥5,000');
  assert.equal(cellText(cell({ state: 'not_open', amount_cents: null }), 'asset'), '未启用');
  assert.equal(cellText(cell({ state: 'closed', amount_cents: null }), 'liability'), '已停用');
  assert.equal(cellText(cell({ state: 'missing', amount_cents: null }), 'asset'), '未知');
  assert.equal(cellText(cell({ amount_cents: null }), 'asset'), '未知');
});
