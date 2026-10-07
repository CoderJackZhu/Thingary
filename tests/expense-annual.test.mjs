import test from 'node:test';
import assert from 'node:assert/strict';
import { spendDisplay, countsAsSpending, sourceLabel } from '../src/expenses.ts';

// 年度／月份桶的显示口径（设计 §3.2）：未知不冒充零。
test('spendDisplay wording follows the missing-value contract', () => {
  // 全未知：金额待补，不画成确定零支出。
  assert.deepEqual(spendDisplay({ count: 2, known_count: 0, unknown_count: 2, spent_cents: '0' }), { value: null, note: '金额待补' });
  // 混合：已知部分＋待补笔数。
  assert.deepEqual(spendDisplay({ count: 2, known_count: 1, unknown_count: 1, spent_cents: '5000' }), { value: '5000', note: '仅已知部分 · 1 笔金额待补' });
  // 明确零元是已记录事实：有金额、无提示。
  assert.deepEqual(spendDisplay({ count: 1, known_count: 1, unknown_count: 0, spent_cents: '0' }), { value: '0', note: null });
  // 只有退款或售出的一年：支出标未记录。
  assert.deepEqual(spendDisplay({ count: 0, known_count: 0, unknown_count: 0 }), { value: null, note: '未记录支出' });
});

// 支出来源去重（设计 §3）：linked/refund/sale 不参与支出聚合。
test('spend sources stay exclusive of linked refunds and sales', () => {
  assert.equal(countsAsSpending({ source: 'purchase' }), true);
  assert.equal(countsAsSpending({ source: 'topup' }), true);
  assert.equal(countsAsSpending({ source: 'linked' }), false);
  assert.equal(countsAsSpending({ source: 'refund' }), false);
  assert.equal(countsAsSpending({ source: 'sale' }), false);
  assert.equal(sourceLabel.topup, '储值充值');
});

// 前端桶聚合镜像：月桶合计等于年桶（与 Rust E01 同一约定）。
test('frontend bucket sums mirror the annual contract', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, spent_cents: '0', refund_cents: '0', count: 0, known_count: 0, unknown_count: 0 }));
  months[1] = { month: '2026-02', spent_cents: '5000', refund_cents: '0', count: 1, known_count: 1, unknown_count: 0 };
  months[6] = { month: '2026-07', spent_cents: '0', refund_cents: '0', count: 1, known_count: 0, unknown_count: 1 };
  const known = months.reduce((t, m) => t + BigInt(m.spent_cents), 0n);
  const count = months.reduce((t, m) => t + m.count, 0);
  const unknown = months.reduce((t, m) => t + m.unknown_count, 0);
  assert.equal(known, 5000n);
  assert.equal(count, 2);
  assert.equal(unknown, 1);
  assert.deepEqual(spendDisplay({ count, known_count: count - unknown, unknown_count: unknown, spent_cents: known.toString() }), { value: '5000', note: '仅已知部分 · 1 笔金额待补' });
});
