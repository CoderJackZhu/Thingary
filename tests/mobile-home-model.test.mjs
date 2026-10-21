import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyView, heroView, netWorthView, overdueWishes, pendingEntries, pendingSourcesFailed, recentRows, warrantyAlert } from '../src/mobile/home/model.ts';
import { allModules } from '../src/modules.ts';

const point = (over) => ({ snapshot_id: 's', date: '2026-10-01', complete: true, missing: 0, net_cents: '1000000', change_cents: null, compared_to: null, scope_changed: false, ...over });
const off = (...keys) => ({ ...allModules, ...Object.fromEntries(keys.map(key => [key, false])) });

test('hero：读取中、出错、未设置条件和被挡住各自有明确文字', () => {
  assert.equal(heroView({ kind: 'loading' }).state, 'blocked');
  const error = heroView({ kind: 'error', message: '读取失败' });
  assert.equal(error.state, 'error'); assert.equal(error.subtitle, '读取失败');
  const setup = heroView({ kind: 'blocked', step: 'profile', main: '先设置条件', note: '' });
  assert.equal(setup.state, 'setup'); assert.match(setup.subtitle, /还要上几年班/);
  assert.equal(heroView({ kind: 'blocked', step: 'goal', main: '缺目标', note: '请补充' }).state, 'blocked');
});
test('hero：财务自由按 fi_month 算剩余月数，未知不当作零', () => {
  const base = (fi) => ({ kind: 'ready', mode: 'fire', calc: { plan: { now_months: 100, target_months: 400 }, proj: { fi_month: fi } }, headline: { main: '无法达到', sub: '估算', warn: null }, coverage: { percent: 3500 } });
  assert.match(heroView(base(124)).title, /还要上.*班/);
  assert.equal(heroView(base(null)).title, '无法达到');
  assert.equal(heroView(base(90)).title, '当前资产已覆盖退休所需');
  assert.deepEqual(heroView(base(124)).tags, ['资产覆盖今天退休所需的 35%']);
});
test('净资产：没有完整盘点就是未知；不完整的最新盘点沿用上次完整并提示缺口', () => {
  assert.equal(netWorthView({ points: [] }, false).state, 'unknown');
  assert.equal(netWorthView({ points: [point({ complete: false, missing: 1 })] }, false).state, 'unknown');
  const view = netWorthView({ points: [point(), point({ date: '2026-10-10', complete: false, missing: 2 })] }, false);
  assert.equal(view.state, 'known'); assert.match(view.incomplete, /缺 2 个账户/);
});
test('净资产：隐藏金额后界面文字和图表摘要都不含金额', () => {
  const summary = { points: [point({ date: '2026-09-01', net_cents: '900000' }), point({ change_cents: '100000', compared_to: 's0' })] };
  const shown = netWorthView(summary, false), hidden = netWorthView(summary, true);
  assert.notEqual(shown.net, '******'); assert.equal(hidden.net, '******');
  assert.equal(hidden.changeTone, null); assert.doesNotMatch(hidden.summary, /¥|万|\d{4,}/);
  assert.match(shown.change, /较上次/);
});
test('日均成本：全未知显示 —，资料不全时说明只是已知部分', () => {
  const none = dailyView({ known_cents: null, included_count: 0, unknown_count: 2, per_use_count: 0, excluded_count: 0 });
  assert.equal(none.unknown, true); assert.equal(none.value, '—');
  const some = dailyView({ known_cents: 1234, included_count: 3, unknown_count: 1, per_use_count: 1, excluded_count: 0 });
  assert.equal(some.unknown, false); assert.match(some.sub, /仅已知部分/); assert.match(some.sub, /1 件按次计费/);
});
test('保修提醒：只取 30 天内到期的，最近一件排在前', () => {
  const item = (id, end) => ({ asset: { id, name: id }, warranties: [{ fields: { start_date: '2025-01-01', end_date: end } }] });
  const alert = warrantyAlert({ total: 2, items: [item('b', '2026-11-10'), item('a', '2026-10-25')] }, '2026-10-21');
  assert.equal(alert.count, 2); assert.equal(alert.first.id, 'a'); assert.equal(alert.first.days, 4);
  assert.equal(warrantyAlert({ total: 0, items: [] }, '2026-10-21').first, null);
});
test('心愿过期：只看考虑中且计划日期早于今天', () => {
  const list = [
    { id: '1', name: '甲', target_date: '2026-10-01', decision_state: 'considering' }, { id: '2', name: '乙', target_date: '2026-10-21', decision_state: 'considering' },
    { id: '3', name: '丙', target_date: '2026-09-01', decision_state: 'achieved' }, { id: '4', name: '丁', target_date: null, decision_state: 'considering' },
    { id: '5', name: '戊', target_date: '2026-08-01', decision_state: 'considering' },
  ];
  assert.deepEqual(overdueWishes(list, '2026-10-21').map(w => w.id), ['5', '1']);
});
test('待处理：关闭的模块不出现，本月未盘点给出去盘点入口', () => {
  const review = { wealth: { status: 'ready', value: { points: [point({ date: '2026-09-01' })] } } };
  const reviewReady = { ...review, wealth: { status: 'ready', value: { points: [point({ date: '2026-09-01' })] } } };
  const entries = pendingEntries({ today: '2026-10-21', modules: allModules, review: reviewReady, warranty: null, wishes: [] });
  assert.ok(entries.some(e => e.id === 'checkin' && e.route === 'wealth.checkin'));
  assert.equal(pendingEntries({ today: '2026-10-21', modules: off('wealth'), review: reviewReady, warranty: null, wishes: [] }).some(e => e.id === 'checkin'), false);
  const wish = [{ id: 'w', name: '相机', target_date: '2026-10-01', decision_state: 'considering' }];
  assert.equal(pendingEntries({ today: '2026-10-21', modules: off('wishlist'), review: null, warranty: null, wishes: wish }).length, 0);
  assert.equal(pendingEntries({ today: '2026-10-21', modules: allModules, review: null, warranty: null, wishes: wish })[0].route, 'wishes.detail');
});
test('待处理：保修只有一件时直达详情，多件时去列表', () => {
  const one = pendingEntries({ today: '2026-10-21', modules: allModules, review: null, warranty: { count: 1, first: { id: 'a', name: '相机', end: '2026-10-25', days: 4 } }, wishes: null });
  assert.deepEqual([one[0].route, one[0].params], ['items.detail', { id: 'a' }]);
  const many = pendingEntries({ today: '2026-10-21', modules: allModules, review: null, warranty: { count: 3, first: null }, wishes: null });
  assert.equal(many[0].route, 'items.list');
});
test('待处理读取失败时能被识别，页面据此说明列表可能不完整', () => {
  assert.equal(pendingSourcesFailed(allModules, null, true, false), true);
  assert.equal(pendingSourcesFailed(off('wishlist'), null, false, true), false);
  assert.equal(pendingSourcesFailed(allModules, { wealth: { status: 'error' }, recurring: { status: 'ready' }, virtual_assets: { status: 'ready' } }, false, false), true);
});
test('近期记录：隐藏关闭模块的事件，盘点金额跟随隐藏开关，最多五条', () => {
  const ev = (id, kind, extra = {}) => ({ id, kind, date: '2026-10-1' + id, title: 't' + id, amount_cents: 500, asset_id: 'a', wishlist_id: null, ...extra });
  const events = [ev('1', 'snapshot'), ev('2', 'purchase'), ev('3', 'expense'), ev('4', 'purchase'), ev('5', 'purchase'), ev('6', 'purchase'), ev('7', 'purchase')];
  const describe = (e) => ({ label: e.kind, detail: '明细' });
  const rows = recentRows(events, off('expenses'), describe, true);
  assert.equal(rows.length, 5); assert.equal(rows.some(r => r.kind === 'expense'), false);
  assert.equal(rows[0].detail, '金融金额已隐藏'); assert.equal(rows[0].amount, null);
  assert.equal(rows[1].target.route, 'items.detail');
});
