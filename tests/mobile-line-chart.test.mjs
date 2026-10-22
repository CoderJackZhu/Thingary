import test from 'node:test';
import assert from 'node:assert/strict';
import { areaPath, axisLabel, lineAxis, monotonePath, nearestIndex, runsOf, xTicks } from '../src/mobile/ui/chart-model.ts';
import { trendKinds, trendSummary, trendTip, trendValues } from '../src/mobile/wealth/trend-model.ts';

test('纵轴标签：整万用「万」，小额按元，亿以上用「亿」，负数带减号', () => {
  assert.equal(axisLabel(12_000_000), '12万');
  assert.equal(axisLabel(1_500_000), '1.5万');
  assert.equal(axisLabel(1_000_000), '1万');
  assert.equal(axisLabel(80_000), '800');
  assert.equal(axisLabel(0), '0');
  assert.equal(axisLabel(-50_000_000), '−50万');
  assert.equal(axisLabel(-500_000), '−5000');
  assert.equal(axisLabel(25_000_000_000), '2.5亿');
});
test('刻度：最多 4 条网格线，覆盖全部已知值，小额也有合理刻度', () => {
  for (const line of [[1_000_000, 1_250_000, 1_900_000], [5_000, 8_000, 12_000], [-300_000, 400_000], [0, 0]]) {
    const axis = lineAxis([line]);
    assert.ok(axis.grid.length >= 2 && axis.grid.length <= 4, JSON.stringify(axis));
    assert.ok(axis.bottom <= Math.min(...line) && axis.top >= Math.max(...line));
  }
  assert.deepEqual(lineAxis([[null, null]]).grid, [0, 1]);
});
test('曲线：缺项断开，不连线也不补零', () => {
  const runs = runsOf([{ x: 0, y: 5 }, { x: 1, y: 4 }, null, { x: 3, y: 2 }, null, null, { x: 6, y: 1 }, { x: 7, y: 1 }]);
  assert.deepEqual(runs.map(run => run.length), [2, 1, 2]);
  assert.equal(areaPath(runs[1], 10), '');
});
test('单调三次曲线：不越过相邻数据点（无过冲）', () => {
  const run = [[0, 10], [10, 10], [20, 0], [30, 0], [40, 5]].map(([x, y]) => ({ x, y }));
  const d = monotonePath(run);
  const ys = [...d.matchAll(/C[\d.-]+,([\d.-]+) [\d.-]+,([\d.-]+) /g)].flatMap(m => [Number(m[1]), Number(m[2])]);
  assert.ok(ys.every(y => y >= 0 && y <= 10), d);
  assert.equal(monotonePath([{ x: 1, y: 2 }]), 'M1,2');
  assert.equal(monotonePath([{ x: 1, y: 2 }, { x: 3, y: 4 }]), 'M1,2L3,4');
});
test('触摸定位与横轴标签', () => {
  assert.equal(nearestIndex([0, 100, 200], 140), 1);
  assert.equal(nearestIndex([], 5), -1);
  assert.deepEqual(xTicks(1), [0]); assert.deepEqual(xTicks(2), [0, 1]); assert.deepEqual(xTicks(7), [0, 3, 6]);
});

const point = (over) => ({ snapshot_id: 's', date: '2026-10-01', complete: true, missing: 0, net_cents: '1000000', assets_cents: '1500000', liabilities_cents: '500000', ...over });
test('财富趋势：一次一条线，不完整盘点是缺口，负债为同一日期的欠款', () => {
  const points = [point(), point({ date: '2026-10-05', complete: false, missing: 2 }), point({ date: '2026-10-09', net_cents: '1200000', liabilities_cents: '300000' })];
  assert.deepEqual(trendKinds.map(k => k.label), ['净资产', '资产', '负债']);
  assert.deepEqual(trendValues(points, 'net'), [1000000, null, 1200000]);
  assert.deepEqual(trendValues(points, 'liabilities'), [500000, null, 300000]);
  assert.deepEqual(trendValues(points, 'assets'), [1500000, null, 1500000]);
});
test('财富趋势：浮层列出三项金额，隐藏金额时不含数字', () => {
  const tip = trendTip(point(), false);
  assert.deepEqual(tip.rows.map(r => r.name), ['净资产', '资产', '负债']);
  assert.match(tip.rows[0].value, /10,000/);
  const hidden = trendTip(point(), true);
  assert.ok(hidden.rows.every(r => r.value === '******'));
  assert.match(trendTip(point({ complete: false, missing: 2 }), false).note, /缺 2 个账户/);
  assert.doesNotMatch(trendSummary([point()], 'net', true), /¥|\d{4,}/);
  assert.match(trendSummary([point()], 'liabilities', false), /负债趋势，1 次完整盘点/);
});
