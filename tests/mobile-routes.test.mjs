import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { isRootRoute, routeDef, routeKind, routes, tabDef, tabRoot, tabs, visibleSegments, visibleTabs } from '../src/mobile/routes.ts';
import { allModules } from '../src/modules.ts';

const required = ['items.list', 'items.filter', 'items.detail', 'items.edit', 'items.icon', 'items.stats', 'wishes.list', 'wishes.detail', 'wishes.edit', 'wishes.purchase', 'wealth.overview', 'wealth.accounts', 'wealth.snapshots', 'wealth.account', 'wealth.accountEdit', 'wealth.groups', 'wealth.checkin', 'wealth.compare', 'spending.home', 'spending.recurring', 'spending.virtual', 'spending.review', 'spending.virtualDetail', 'spending.expenseEdit', 'spending.recurringEdit', 'spending.payment', 'spending.paymentRange', 'spending.planResume', 'spending.virtualEdit', 'spending.topup', 'spending.balance', 'spending.incomeEdit', 'plan.goal', 'plan.detail', 'plan.whatif', 'plan.trials', 'plan.setup', 'home.overview', 'me.home', 'me.timeline', 'me.search', 'me.settings', 'me.data', 'welcome'];
const ids = tabs.map(tab => tab.id);
const off = (...keys) => ({ ...allModules, incomes: true, ...Object.fromEntries(keys.map(key => [key, false])) });

test('约定的路由名全部登记，且都有标题和所属标签', () => {
  for (const name of required) { const def = routeDef(name); assert.ok(def, name); assert.ok(def.title, name); assert.ok(ids.includes(def.tab), name); }
  assert.equal(Object.keys(routes).length, required.length);
  assert.equal(routeDef('constructor'), undefined);
});
test('路由类型：默认 page，模态与弹窗按设计稿', () => {
  assert.equal(routeKind('items.detail'), 'page');
  for (const name of ['items.edit', 'wishes.edit', 'wishes.purchase', 'wealth.checkin', 'wealth.accountEdit', 'wealth.groups', 'plan.setup']) assert.equal(routeKind(name), 'modal', name);
  for (const name of ['items.filter', 'items.icon']) assert.equal(routeKind(name), 'sheet', name);
  assert.equal(routeDef('welcome').fullscreen, true);
});
test('设计稿编号对应 docs/design/mobile 里的真实文件', () => {
  const files = readdirSync(new URL('../docs/design/mobile', import.meta.url));
  for (const [name, def] of Object.entries(routes)) if (def.design) assert.ok(files.some(f => f.startsWith(def.design + '-')), name);
});
test('标签顺序和文字照设计稿，分段路由属于同一标签且不是模态', () => {
  assert.deepEqual(tabs.map(tab => tab.label), ['总览', '物品', '财富', '规划', '我的']);
  for (const tab of tabs) {
    assert.equal(routeDef(tab.root).tab, tab.id);
    for (const segment of tab.segments ?? []) { assert.equal(routeDef(segment.route).tab, tab.id); assert.equal(routeKind(segment.route), 'page'); assert.ok(isRootRoute(segment.route)); }
  }
  assert.deepEqual(tabDef('items').segments.map(s => s.label), ['物品', '心愿', '统计']);
  assert.deepEqual(tabDef('wealth').segments.map(s => s.label), ['概览', '账户', '盘点记录']);
  assert.deepEqual(tabDef('plan').segments.map(s => s.label), ['目标', '测算详情', '试算']);
  assert.equal(isRootRoute('items.detail'), false);
});
test('模块全开显示五个标签；未读到开关时也全部显示', () => {
  assert.deepEqual(visibleTabs(off()).map(t => t.id), ids);
  assert.deepEqual(visibleTabs(null).map(t => t.id), ids);
});
test('财富相关模块全关隐藏财富，只要有一个开着就保留', () => {
  assert.deepEqual(visibleTabs(off('wealth', 'expenses', 'recurring', 'virtual', 'incomes')).map(t => t.id), ['overview', 'items', 'plan', 'me']);
  for (const key of ['wealth', 'expenses', 'recurring', 'virtual', 'incomes']) {
    const flags = off('wealth', 'expenses', 'recurring', 'virtual', 'incomes'); flags[key] = true;
    assert.ok(visibleTabs(flags).some(t => t.id === 'wealth'), key);
  }
});
test('规划关闭隐藏规划；物品、总览、我的始终显示', () => {
  assert.deepEqual(visibleTabs(off('planning')).map(t => t.id), ['overview', 'items', 'wealth', 'me']);
  const everything = Object.fromEntries(Object.keys(allModules).map(key => [key, false]));
  assert.deepEqual(visibleTabs({ ...everything, incomes: false }).map(t => t.id), ['overview', 'items', 'me']);
});
test('关闭的模块让对应分段消失，标签根页回落到第一个可见分段', () => {
  assert.deepEqual(visibleSegments('items', off('wishlist', 'stats')).map(s => s.route), ['items.list']);
  assert.deepEqual(visibleSegments('items', off('stats')).map(s => s.route), ['items.list', 'wishes.list']);
  assert.equal(tabRoot('items', off()), 'items.list');
  assert.equal(tabRoot('wealth', off()), 'wealth.overview');
  assert.equal(tabRoot('wealth', off('wealth')), 'spending.home');
  assert.equal(tabRoot('me', off()), 'me.home');
});
