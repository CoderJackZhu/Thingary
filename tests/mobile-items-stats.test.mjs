import test from 'node:test';
import assert from 'node:assert/strict';
import { readStatistics } from '../src/mobile/items/stats.ts';

const options = { period: 'week', granularity: 'month', scope: 'held', today: '2026-10-21', generation: 'fictional' };
function fixture(overrides = {}) {
  const replies = {
    overview: { generation: 'fictional', today: options.today, held_daily: { known_cents: null, unknown_count: 1, included_count: 0 } },
    stats_snapshot: { period: 'week', end: options.today, total: 1, known_cents: '0', unknown_price_count: 1, categories: [] },
    purchase_trend: { generation: 'fictional', today: options.today, granularity: 'month', buckets: [], known_cents: '0', unknown_price_count: 0, unknown_date_count: 1 },
    holding: { scope: 'held', average_days: null, median_days: null, groups: [], longest: null, held_ranking: [], sold_ranking: [], excluded: [] },
    resale_rate: { rows: [], excluded: [], included_count: 0, average_rate_hundredths: null, weighted_rate_hundredths: null },
    ...overrides,
  };
  const calls = [];
  return { replies, calls, invoke: async (command, args) => { calls.push([command, args]); return replies[command]; } };
}

test('手机统计读取桌面命令，不把未知金额、日期、保值率补成零', async () => {
  const f = fixture();
  const result = await readStatistics(f.invoke, options);
  assert.equal(result.overview.held_daily.known_cents, null);
  assert.equal(result.snapshot.known_cents, '0');
  assert.equal(result.snapshot.unknown_price_count, 1);
  assert.equal(result.holding.average_days, null);
  assert.equal(result.resale.average_rate_hundredths, null);
  assert.deepEqual(f.calls.map(([command]) => command), ['overview', 'stats_snapshot', 'purchase_trend', 'holding', 'resale_rate', 'overview']);
  assert.deepEqual(f.calls[1], ['stats_snapshot', { period: 'week' }]);
  assert.deepEqual(f.calls[2], ['purchase_trend', { granularity: 'month' }]);
  assert.deepEqual(f.calls[3], ['holding', { scope: 'held' }]);
});

test('统计开始时资料库与手机会话不一致即停止，不继续读取其他结果', async () => {
  const f = fixture({ overview: { generation: 'changed', today: options.today } });
  await assert.rejects(readStatistics(f.invoke, options), /资料已变化/);
  assert.equal(f.calls.length, 1);
});

test('统计读取途中切库，拒绝展示混合资料', async () => {
  const f = fixture(); let n = 0;
  const call = async (command, args) => command === 'overview' && ++n === 2 ? { ...f.replies.overview, generation: 'changed' } : f.invoke(command, args);
  await assert.rejects(readStatistics(call, options), /资料已变化/);
});

test('日期、时间范围、趋势粒度或持有范围迟到不匹配时拒绝', async () => {
  for (const [command, patch] of [
    ['overview', { today: '2026-10-20' }],
    ['stats_snapshot', { end: '2026-10-20' }],
    ['stats_snapshot', { period: 'all' }],
    ['purchase_trend', { generation: 'old' }],
    ['purchase_trend', { today: '2026-10-20' }],
    ['purchase_trend', { granularity: 'year' }],
    ['holding', { scope: 'history' }],
  ]) {
    const f = fixture(); Object.assign(f.replies[command], patch);
    await assert.rejects(readStatistics(f.invoke, options), /资料已变化/);
  }
});

test('真实读取错误保留错误，不转换为空统计', async () => {
  const f = fixture(), failure = new Error('虚构统计读取失败');
  await assert.rejects(readStatistics(async (command, args) => { if (command === 'holding') throw failure; return f.invoke(command, args); }, options), failure);
});
