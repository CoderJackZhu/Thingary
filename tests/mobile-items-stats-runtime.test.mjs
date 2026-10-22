import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as format from '../src/mobile/format.ts';
import * as stats from '../src/mobile/items/stats.ts';
import * as distribution from '../src/distribution.ts';

const today = '2026-10-21', generation = 'g';
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function replies(granularity = 'month', scope = 'held') {
  return {
    overview: { generation, today, held_daily: { known_cents: '100' } },
    stats_snapshot: { period: 'all', start: null, end: today, total: 3, active: 2, retired: 1, sold: 0, known_cents: '3000', unknown_price_count: 0, sale_proceeds_cents: '0', sold_purchase_cents: '0', sold_unknown_price_count: 0, sold_zero_price_count: 0, categories: [] },
    purchase_trend: { generation, today, granularity, buckets: [], known_cents: '0', unknown_price_count: 0, unknown_date_count: 0, unknown_date_known_cents: '0' },
    holding: { scope, groups: [], dated_count: 0, unknown_date_count: 0, average_days: null, median_days: null, longest: null, held_ranking: [], sold_ranking: [], excluded: [] },
    resale_rate: { rows: [], excluded: [], included_count: 0, average_rate_hundredths: null, weighted_rate_hundredths: null },
  };
}
async function mount() {
  let gate = null;
  const r = runtime('mobile/items/ItemStats', {}, undefined, undefined, { exportName: 'default', components: [], modules: {
    './mobile/format': format, './mobile/items/stats': stats, './distribution': distribution,
    './mobile/nav-context': { useNav: () => ({ push() {}, setSegment() {} }), useReveal: () => 0 },
    './mobile/session': { useSession: () => ({ today, data: { summary: { generation } } }) },
    '@tauri-apps/api/core': { invoke: async (command, args) => { if (gate) await gate.promise; const d = replies(args?.granularity ?? 'month', args?.scope ?? 'held'); return d[command]; } },
  } });
  await r.settle(); await r.settle();
  return { r, hold() { gate = deferred(); return gate; }, release() { gate.resolve(); gate = null; } };
}

test('stats: switching a lower segment keeps the page content mounted while new data loads', async () => {
  const { r, hold, release } = await mount();
  assert.ok(r.find('div', p => /mi-stats-body/.test(p.className ?? '')), 'content is shown after first load');
  assert.equal(r.find('Loading'), undefined);
  hold();
  r.find('SegmentedControl', p => p.label === '购买趋势粒度').props.onChange('year'); r.render();
  assert.equal(r.find('Loading'), undefined, 'no Loading placeholder replaces the page, so its height and scroll position stay');
  const body = r.find('div', p => /mi-stats-body/.test(p.className ?? ''));
  assert.ok(body, 'sections stay mounted'); assert.match(body.props.className, /mi-stats-loading/); assert.equal(body.props['aria-busy'], true);
  assert.ok(r.find('SegmentedControl', p => p.label === '持有范围'), 'the holding switch is still on the page');
  release(); await r.settle(); await r.settle();
  const after = r.find('div', p => /mi-stats-body/.test(p.className ?? ''));
  assert.doesNotMatch(after.props.className, /mi-stats-loading/);
  assert.equal(r.find('SegmentedControl', p => p.label === '购买趋势粒度').props.value, 'year');
  r.unmount();
});

test('stats: the 持有范围 switch also keeps content during reload', async () => {
  const { r, hold, release } = await mount();
  hold(); r.find('SegmentedControl', p => p.label === '持有范围').props.onChange('history'); r.render();
  assert.equal(r.find('Loading'), undefined);
  assert.ok(r.find('SegmentedControl', p => p.label === '购买趋势粒度'));
  release(); await r.settle(); await r.settle(); r.unmount();
});

test('stats: the page no longer repeats the list headline numbers', async () => {
  const { r } = await mount();
  assert.equal(r.find('Metric', p => p.label === '当前物品日均成本'), undefined);
  assert.equal(r.find('HeroCard'), undefined);
  r.unmount();
});
