import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentText, previewResaleRate } from '../src/resale.ts';

// 与 docs/ui/U19_RESALE_RATE_DESIGN.md §7 及 Rust 测试同一份虚构样例（单位：分）。
const rec = (name, price, sale, over = {}) => ({
  deleted: false,
  asset: { id: `id-${name}`, name, price_cents: price },
  lifecycle: { state: sale === null ? 'retired' : 'sold' },
  sale: sale === null ? null : { fields: { price_cents: sale, date: '2026-09-05' } },
  ...over,
});
const sample = () => [
  rec('A', '1000000', '650000'), rec('B', '200000', '240000'), rec('C', '80000', '0'),
  rec('D', null, '100000'), rec('E', '0', '5000'),
  rec('F', '100000', '90000', { preferences: { exclude: { statistics: true } } }),
  rec('G', '100000', '80000', { deleted: true }),
  rec('H', '100000', null, { lifecycle: { state: 'active' } }),
  rec('I', '100000', null),
];

test('preview resale rate reproduces the documented sample', () => {
  const r = previewResaleRate(sample());
  assert.equal(r.included_count, 3);
  assert.deepEqual([r.total_purchase_cents, r.total_sale_cents, r.total_gain_cents], ['1280000', '890000', '-390000']);
  assert.equal(r.average_rate_hundredths, 6167);
  assert.equal(r.weighted_rate_hundredths, 6953);
  assert.deepEqual(r.rows.map(x => [x.name, x.rate_hundredths, x.gain_cents]), [['B', 12000, '40000'], ['A', 6500, '-350000'], ['C', 0, '-80000']]);
  assert.deepEqual(r.excluded.map(x => [x.name, x.reason]).sort(), [['D', '购入金额未知'], ['E', '购入价为 ¥0，不计算']]);
});

test('nothing rateable gives no percentages and no division', () => {
  const none = previewResaleRate([]);
  assert.deepEqual([none.included_count, none.average_rate_hundredths, none.weighted_rate_hundredths, none.total_gain_cents], [0, null, null, '0']);
  const only = previewResaleRate([rec('D', null, '100000')]);
  assert.equal(only.average_rate_hundredths, null);
  assert.equal(only.excluded.length, 1);
});

test('ratios order by exact value, ties by id, and are not capped', () => {
  const r = previewResaleRate([rec('X', '1000', '333'), rec('Y', '10000', '3334'), rec('Q', '600', '200'), rec('P', '300', '100'), rec('Z', '100', '50000')]);
  assert.deepEqual(r.rows.map(x => x.name), ['Z', 'Y', 'P', 'Q', 'X']);
  assert.deepEqual(r.rows.map(x => x.rate_hundredths), [5000000, 3334, 3333, 3333, 3330]);
  const big = previewResaleRate([rec('M', '1', '99999999999')]);
  assert.equal(big.rows[0].rate_hundredths, 999999999990000);
});

test('percent text keeps two decimals and a real minus sign', () => {
  assert.equal(percentText(6167), '61.67%');
  assert.equal(percentText(0), '0.00%');
  assert.equal(percentText(12000), '120.00%');
  assert.equal(percentText(-5), '−0.05%');
});

test('stats page shows the resale card with its states and never re-sorts rounded values', () => {
  const src = readFileSync(new URL('../src/Stats.tsx', import.meta.url), 'utf8');
  assert.match(src, /invoke<ResaleRate>\('resale_rate'\)/);
  assert.match(src, /<ResaleCard onOpenAsset=\{onOpenAsset\}\/>/);
  for (const text of ['售出保值率读取失败', '还没有售出记录', '没有可计算保值率的售出物品', '平均保值率', '总回收率', '总盈亏', '购入价未知或为 ¥0']) assert.ok(src.includes(text), text);
  assert.match(src, /const list = descending \? data\.rows : data\.rows\.slice\(\)\.reverse\(\);/);
  // 回收分析卡脚注与新口径一致
  assert.match(src, /sold_unknown_price_count\+data\.sold_zero_price_count/);
  assert.doesNotMatch(src.slice(src.indexOf('function ResaleCard')), /\.sort\(/);
});
