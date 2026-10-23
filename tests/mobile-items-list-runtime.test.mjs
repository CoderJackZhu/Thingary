import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as asset from '../src/asset.ts';
import * as preferences from '../src/preferences.ts';
import * as lifecycle from '../src/lifecycle.ts';
import * as navigation from '../src/collection-navigation.ts';
import * as batch from '../src/batch-select.ts';
import * as list from '../src/mobile/items/list-model.ts';
import * as format from '../src/mobile/format.ts';

const day = '2026-10-21', generation = 'fictional-library';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (r, label) => r.nodes().find(n => n.type === 'Button' && r.text(n) === label);
const selectedCount = r => r.nodes().find(n => n.type === 'span' && /^已选 \d+ 件$/.test(r.text(n))) && r.text(r.nodes().find(n => n.type === 'span' && /^已选 \d+ 件$/.test(r.text(n))));
const record = (id, state = 'active') => ({ asset: { id, name: `虚构物品${id}`, revision: 4, price_cents: '10000', purchase_date: '2026-01-01' }, details: { brand: '', model: '', serial_number: '', notes: '' }, lifecycle: { state, events: [] }, preferences: preferences.defaultPreferences(), photos: [], cover_id: null, maintenances: [], warranties: [], costs: { daily_cents: '100', known_maintenance_cents: '0', held_days: 100, unknown_maintenance_count: 0, total_investment_cents: '10000' } });
function session() {
  return { today: day, data: { summary: { generation } }, navBlocked: false, settled: null, setBusy(value) { this.navBlocked = value; }, refreshPending() {} };
}
async function listRuntime({ idsResponse, countsGeneration = () => generation } = {}) {
  let query = list.initialQuery();
  const assets = [record('a'), record('b', 'retired')], calls = [], s = session();
  const r = runtime('mobile/items/ItemList', {}, undefined, undefined, { exportName: 'default', components: [], globals: { IntersectionObserver: class { observe() {} disconnect() {} }, window: { setTimeout, clearTimeout } }, modules: {
    './asset': asset, './mobile/format': format, './preferences': preferences, './lifecycle': lifecycle, './collection-navigation': navigation, './batch-select': batch, './mobile/items/list-model': list,
    './mobile/items/list-store': { useItemQuery: () => query, setItemQuery: change => { query = list.changeQuery(query, change); } },
    './mobile/items/ItemBatch': { __esModule: true, default: 'ItemBatch' },
    './mobile/session': { useSession: () => s }, './mobile/nav-context': { useNav: () => ({ push() {} }), useReveal: () => 0 },
    '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push([command, args]);
      if (command === 'list_assets') { const items = args.query.filter === 'retired' ? assets.filter(a => a.lifecycle.state === 'retired') : assets; return { generation, today: day, total: items.length, items }; }
      if (command === 'asset_counts') return { generation: countsGeneration(), all: 2, active: 1, retired: 1, sold: 0 };
      if (command === 'taxonomy_snapshot') return { generation, categories: [], channels: [] };
      if (command === 'overview') return { generation, today: day, held_count: 2, held_known_cents: '20000', held_unknown_price_count: 0, sold_count: 1, held_daily: { known_cents: '200', included_count: 2, unknown_count: 0, per_use_count: 0, excluded_count: 0 } };
      if (command === 'asset_ids') return idsResponse ? await idsResponse(args) : ['a', 'b'];
      throw new Error('unexpected ' + command);
    } },
  } });
  await r.settle();
  const toggleSelecting = () => { r.find('IconButton', p => p.label === '批量选择').props.onClick(); r.render(); };
  return { r, calls, session: s, toggleSelecting };
}

test('mobile list: batch-select icon button replaces the text button, FAB replaces the title plus, both follow selection', async () => {
  const { r, toggleSelecting } = await listRuntime();
  assert.equal(r.find('LargeTitle').props.actions, undefined, 'title row has no 选择 or + button');
  assert.equal(r.find('LargeTitle').props.segments, undefined);
  assert.equal(r.find('IconButton', p => p.label === '新增物品'), undefined);
  assert.equal(button(r, '选择'), undefined);
  assert.equal(r.find('IconButton', p => p.label === '批量选择').props.pressed, false);
  assert.equal(r.find('Fab').props.label, '新增物品'); assert.equal(r.find('Fab').props.hidden, false);
  toggleSelecting();
  assert.equal(r.find('IconButton', p => p.label === '批量选择').props.pressed, true);
  assert.equal(r.find('Fab').props.hidden, true, 'FAB hides while selecting');
  toggleSelecting(); assert.equal(r.find('Fab').props.hidden, false);
  r.unmount();
});

test('mobile list: search is a hidden field behind the magnifier, shown with 取消, kept while a query is active', async () => {
  const { r } = await listRuntime();
  assert.equal(r.find('SearchField'), undefined);
  r.find('IconButton', p => p.label === '搜索').props.onClick(); r.render();
  assert.equal(r.find('SearchField').props.autoFocus, true);
  const cancel = r.nodes().find(n => n.type === 'button' && r.text(n) === '取消'); assert.ok(cancel);
  r.find('SearchField').props.onChange('键盘'); r.render();
  cancel.props.onClick(); r.render();
  assert.equal(r.find('SearchField'), undefined);
  r.find('SearchField'); r.unmount();
});

test('mobile list: long-pressing a row enters selection with that row selected', async () => {
  const { r } = await listRuntime();
  const wrap = r.nodes().find(n => n.type === 'div' && n.props.onPointerDown && n.props.onContextMenu);
  wrap.props.onPointerDown({ clientX: 10, clientY: 10 });
  await new Promise(resolve => setTimeout(resolve, 650)); r.render();
  assert.equal(selectedCount(r), '已选 1 件');
  assert.equal(r.find('IconButton', p => p.label === '批量选择').props.pressed, true);
  r.unmount();
});

test('mobile list: a short press or a drag does not start selection', async () => {
  const { r } = await listRuntime();
  const wrap = r.nodes().find(n => n.type === 'div' && n.props.onPointerDown && n.props.onContextMenu);
  wrap.props.onPointerDown({ clientX: 10, clientY: 10 }); wrap.props.onPointerUp();
  wrap.props.onPointerDown({ clientX: 10, clientY: 10 }); wrap.props.onPointerMove({ clientX: 40, clientY: 10 });
  await new Promise(resolve => setTimeout(resolve, 650)); r.render();
  assert.equal(selectedCount(r), undefined);
  r.unmount();
});

test('mobile list: the summary card shows held total, daily cost and counts from the held overview', async () => {
  const { r } = await listRuntime();
  const text = r.text(r.find('Card', p => p.label === '持有物品摘要'));
  assert.match(text, /持有物品总价/); assert.match(text, /¥200/); assert.match(text, /日均成本/); assert.match(text, /持有数量/); assert.match(text, /2 件/); assert.match(text, /1 件已售/);
  r.unmount();
});

test('mobile list all-selection discards a late result after changing the status filter', async () => {
  const pending = deferred();
  const { r, toggleSelecting } = await listRuntime({ idsResponse: () => pending.promise });
  toggleSelecting(); button(r, '全选结果').props.onClick();
  r.find('SegmentedControl', p => p.label === '物品状态').props.onChange('retired'); await r.settle();
  pending.resolve(['a', 'b']); await r.settle();
  assert.equal(selectedCount(r), '已选 0 件');
  assert.equal(button(r, '批量操作').props.disabled, true);
  r.unmount();
});

test('mobile list all-selection cannot reappear after leaving and re-entering select mode', async () => {
  const pending = deferred();
  const { r, toggleSelecting } = await listRuntime({ idsResponse: () => pending.promise });
  toggleSelecting(); button(r, '全选结果').props.onClick();
  toggleSelecting(); toggleSelecting();
  pending.resolve(['a', 'b']); await r.settle();
  assert.equal(selectedCount(r), '已选 0 件');
  r.unmount();
});

test('mobile list all-selection cannot reappear after filter A to B to A', async () => {
  const pending = deferred();
  const { r, toggleSelecting } = await listRuntime({ idsResponse: () => pending.promise });
  toggleSelecting(); button(r, '全选结果').props.onClick();
  r.find('SegmentedControl', p => p.label === '物品状态').props.onChange('retired'); await r.settle();
  r.find('SegmentedControl', p => p.label === '物品状态').props.onChange('all'); await r.settle();
  pending.resolve(['a', 'b']); await r.settle();
  assert.equal(selectedCount(r), '已选 0 件');
  r.unmount();
});

test('mobile list all-selection refuses a response confirmed against another generation', async () => {
  const pending = deferred(); let currentGeneration = generation;
  const { r, toggleSelecting } = await listRuntime({ idsResponse: () => pending.promise, countsGeneration: () => currentGeneration });
  toggleSelecting(); button(r, '全选结果').props.onClick(); currentGeneration = 'other-library';
  pending.resolve(['a', 'b']); await r.settle();
  assert.equal(selectedCount(r), '已选 0 件');
  r.unmount();
});

test('mobile list manual row selection supersedes an outstanding select-all request', async () => {
  const pending = deferred();
  const { r, toggleSelecting } = await listRuntime({ idsResponse: () => pending.promise });
  toggleSelecting(); button(r, '全选结果').props.onClick();
  r.find('ListRow', p => p.valueSub && r.text(p.title).includes('虚构物品a')).props.onClick(); r.render();
  assert.equal(selectedCount(r), '已选 1 件', 'row click selects exactly one before the all-selection response');
  pending.resolve(['a', 'b']); await r.settle();
  assert.equal(selectedCount(r), '已选 1 件');
  button(r, '批量操作').props.onClick(); r.render();
  assert.deepEqual(Array.from(r.find('ItemBatch').props.ids), ['a']);
  r.unmount();
});

test('mobile list only accepts the latest of overlapping select-all requests', async () => {
  const first = deferred(), second = deferred(); let requests = 0;
  const { r, toggleSelecting } = await listRuntime({ idsResponse: () => ++requests === 1 ? first.promise : second.promise });
  toggleSelecting(); button(r, '全选结果').props.onClick(); button(r, '全选结果').props.onClick();
  second.resolve(['b']); await r.settle(); first.resolve(['a', 'b']); await r.settle();
  assert.equal(selectedCount(r), '已选 1 件');
  button(r, '批量操作').props.onClick(); r.render();
  assert.deepEqual(Array.from(r.find('ItemBatch').props.ids), ['b']);
  r.unmount();
});

const row = (id, state = 'active') => ({ id, name: `虚构物品${id}`, revision: 7, state, price_cents: id === 'b' ? null : '10000', purchase_date: '2026-01-01', last_event_date: null, category_id: 'old-category', channel_id: null, label_id: null, exclude: { total: false, daily: false, statistics: false, timeline: false }, maintenance_cents: '0' });
async function batchRuntime({ rows = [row('a'), row('b', 'retired'), row('c', 'sold')], save } = {}) {
  const s = session(), requests = [], reads = [], done = [];
  const r = runtime('mobile/items/ItemBatch', { ids: rows.map(r => r.id), generation, today: day, onClose() {}, onDone() { done.push(true); } }, undefined, undefined, { exportName: 'default', components: [], modules: {
    './asset': asset, './mobile/format': format, './batch-select': batch, './mobile/session': { useSession: () => s },
    './wealth': { submit: async input => { requests.push(input); if (save) return await save(input, s); return { changed: input.input.items.length }; } },
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      if (command === 'batch_rows') { reads.push(args.ids); return args.ids.map(id => rows.find(r => r.id === id)).filter(Boolean); }
      if (command === 'choice_list') return { items: [{ id: 'new-category', name: '虚构新分类', enabled: true }, { id: 'disabled-choice', name: '停用选项', enabled: false }] };
      if (command === 'asset_counts') return { generation };
      throw new Error('unexpected ' + command);
    } },
  } });
  await r.settle(); return { r, session: s, requests, reads, done };
}

test('mobile batch retire sends only applicable rows with original revisions and common date', async () => {
  const { r, requests, done } = await batchRuntime();
  r.find('SelectField', p => p.label === '操作').props.onChange('retire'); r.render();
  button(r, '保存更改').props.onClick(); await r.settle();
  assert.equal(requests.length, 1); assert.equal(requests[0].command, 'batch_change'); assert.equal(requests[0].input.action, 'retire');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].input.items)), [{ asset_id: 'a', expected_revision: 7, date: day }]);
  assert.equal(requests[0].input.generation, generation); assert.equal(typeof requests[0].input.request_id, 'string'); assert.equal(done.length, 1);
  r.unmount();
});

test('mobile batch classification distinguishes keep from explicit clear without changing channel', async () => {
  const { r, requests } = await batchRuntime();
  r.find('SelectField', p => p.label === '操作').props.onChange('classify'); r.render();
  r.find('SelectField', p => p.label === '虚构物品a 新分类').props.onChange(''); r.render();
  r.find('SelectField', p => p.label === '虚构物品b 新分类').props.onChange('new-category'); r.render();
  button(r, '保存更改').props.onClick(); await r.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].input.items)), [{ asset_id: 'a', expected_revision: 7, category_id: null }, { asset_id: 'b', expected_revision: 7, category_id: 'new-category' }]);
  assert.equal(r.find('SelectField', p => p.label === '全部设为').props.options.some(o => o.id === 'disabled-choice'), false);
  r.unmount();
});

test('mobile batch refuses invalid lifecycle date before submission', async () => {
  const { r, requests } = await batchRuntime();
  r.find('SelectField', p => p.label === '操作').props.onChange('retire'); r.render();
  r.find('DateField').props.onChange('2025-12-31'); r.render();
  assert.equal(button(r, '保存更改').props.disabled, true);
  button(r, '保存更改').props.onClick(); await r.settle();
  assert.equal(requests.length, 0);
  r.unmount();
});

test('mobile batch rereads rows when selected ids change and does not submit removed ids', async () => {
  const { r, requests, reads } = await batchRuntime();
  r.props.ids = ['b']; r.render(); await r.settle();
  assert.equal(r.find('SelectField', p => p.label === '操作').props.value, 'none', '批量操作默认不选任何动作');
  r.find('SelectField', p => p.label === '操作').props.onChange('delete'); r.render();
  button(r, '移入最近删除').props.onClick(); await r.settle();
  assert.deepEqual(Array.from(reads.at(-1)), ['b']);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].input.items)), [{ asset_id: 'b', expected_revision: 7 }]);
  r.unmount();
});

test('mobile batch sale preserves explicit zero cents and skips already sold rows', async () => {
  const { r, requests } = await batchRuntime();
  r.find('SelectField', p => p.label === '操作').props.onChange('sell'); r.render();
  assert.equal(r.find('MoneyField', p => p.label === '虚构物品c 售价'), undefined);
  r.find('MoneyField', p => p.label === '虚构物品a 售价').props.onChange('0'); r.render();
  r.find('MoneyField', p => p.label === '虚构物品b 售价').props.onChange('2350'); r.render();
  r.find('TextField', p => p.label === '统一售出平台').props.onChange('虚构平台'); r.render();
  assert.equal(button(r, '保存更改').props.disabled, false);
  button(r, '保存更改').props.onClick(); await r.settle();
  assert.equal(requests[0].input.action, 'sell');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].input.items)), [
    { asset_id: 'a', expected_revision: 7, sale: { date: day, price_cents: '0', platform: '虚构平台', buyer: '', notes: '' } },
    { asset_id: 'b', expected_revision: 7, sale: { date: day, price_cents: '2350', platform: '虚构平台', buyer: '', notes: '' } },
  ]);
  r.unmount();
});

test('mobile batch sale does not treat an unknown sale price as zero', async () => {
  const { r, requests } = await batchRuntime();
  r.find('SelectField', p => p.label === '操作').props.onChange('sell'); r.render();
  r.find('MoneyField', p => p.label === '虚构物品a 售价').props.onChange('0'); r.render();
  assert.equal(r.find('MoneyField', p => p.label === '虚构物品b 售价').props.value, '');
  assert.equal(button(r, '保存更改').props.disabled, true);
  button(r, '保存更改').props.onClick(); await r.settle();
  assert.equal(requests.length, 0);
  r.unmount();
});
