import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as asset from '../src/asset.ts';
import * as currency from '../src/currency.ts';
import * as foreignAmount from '../src/foreign-amount.ts';
import * as currencyPicker from '../src/currency-picker.ts';
import * as preferences from '../src/preferences.ts';
import * as media from '../src/asset-media.ts';
import * as model from '../src/mobile/items/edit-model.ts';
import * as format from '../src/mobile/format.ts';
import * as layout from '../src/asset-editor-layout.ts';

const generation = 'fictional-edit-generation';
const catalog = () => ({ generation, categories: [], channels: [] });
const photo = { id: 'prepared-fictional-photo', name: '虚构图片.png' };
const result = { asset: { id: 'saved-fictional-asset' } };
function sessionState() {
  return { today: '2026-10-21', data: { summary: { generation } }, navBlocked: false, busy: false, settled: null, pending: false, reloads: 0,
    reload() { this.reloads++; }, setBusy(value) { this.busy = value; this.navBlocked = value || this.pending; },
    refreshPending() { this.navBlocked = this.busy || this.pending; },
  };
}
function leaves(session, nav, invoke, submit) {
  return { './CurrencyPicker': { CurrencyPicker: 'CurrencyPicker' }, './ForeignAmount': { applyFa: (s, f, v) => foreignAmount.editFa(s, f, v), changeFaCode: (s, c) => foreignAmount.editFa(s, 'code', c), CurrencyButton: 'CurrencyButton', OriginalInput: 'OriginalInput', RateRow: 'RateRow' }, './foreign-amount': foreignAmount, './currency': currency, './currency-picker': currencyPicker, './asset': asset, './mobile/format': format, './preferences': preferences, './asset-media': media, './mobile/items/edit-model': model, './asset-editor-layout': layout, './mobile/items/glyphs': { Glyph() {} }, './mobile/items/PhotoViewer': { PhotoThumbs: 'PhotoThumbs', PhotoViewer: 'PhotoViewer' },
    './NotificationNotice': { allowReminders: async () => {} }, './materials': { materialArt: () => '<svg/>' }, './mobile/items/CategoryFallback': { CategoryFallback: 'CategoryFallback' },
    './mobile/session': { useSession: () => session }, './mobile/nav-context': { useNav: () => nav, useDirtyGuard() {}, useFormChanged: () => false },
    './wealth': { submit }, '@tauri-apps/api/core': { invoke },
  };
}
async function editor(options = {}) {
  const session = sessionState(), calls = [], navigations = [], requests = [];
  const nav = { push: (...args) => navigations.push(['push', ...args]), replace: (...args) => navigations.push(['replace', ...args]), pop: () => navigations.push(['pop']) };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (options.invoke) { const response = await options.invoke(command, args); if (response !== undefined) return response; }
    if (command === 'taxonomy_snapshot') return catalog();
    if (command === 'choice_list') return { items: [] };
    if (command === 'saved_request') return result;
    throw new Error('Unexpected command: ' + command);
  };
  const submit = async request => { requests.push(request); return options.save ? options.save(request, session) : result; };
  const r = runtime('mobile/items/ItemEdit', { params: options.id ? { id: options.id } : {} }, undefined, undefined, { exportName: 'default', components: [], modules: leaves(session, nav, invoke, submit) });
  await r.settle();
  return { r, session, calls, navigations, requests };
}
const field = (r, label) => r.find('TextField', p => p.label === label);
// 保存只在右上 NavBar（底部重复按钮已移除）；测试里仍用「保存物品」指这个动作。
const action = (r, text) => text === '保存物品' ? { props: r.nodes().find(n => n.type === 'NavBar').props.primary } : r.nodes().find(n => n.type === 'Button' && r.text(n) === text);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('mobile edit material callback preserves later form edits and is discarded with the editor', async () => {
  const { r, navigations, requests } = await editor();
  field(r, '名称').props.onChange('最初名称'); r.render();
  r.nodes().find(n => n.type === 'button' && n.props['aria-label'] === '更换图标').props.onClick();
  const key = navigations[0][2].channel;
  const picker = model.getIconSession(key);
  assert.ok(picker);
  field(r, '名称').props.onChange('后续名称'); r.render();
  r.find('MoneyField', p => p.label === '购买价格').props.onChange('12345'); r.render();
  picker.choose(photo, true); r.render();
  assert.equal(field(r, '名称').props.value, '后续名称');
  assert.equal(r.find('MoneyField', p => p.label === '购买价格').props.value, '12345');
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.equal(requests[0].input.base.name, '后续名称');
  assert.equal(requests[0].input.base.price_cents, '12345');
  assert.deepEqual(Array.from(requests[0].input.photos.ids), [photo.id]);
  assert.equal(requests[0].input.photos.cover_id, photo.id);
  r.unmount();
  assert.equal(model.getIconSession(key), undefined);
});

test('mobile icon preparation locks global navigation and pops only after release', async () => {
  const wait = deferred(), session = sessionState(), chosen = [], pops = [], calls = [];
  const key = 'fictional-runtime-picker';
  model.setIconSession(key, { generation, photos: [], cover: null, choose: (...args) => chosen.push(args) });
  const materials = { materialArt: () => '<svg/>', materialCategories: ['全部'], readRecentMaterials: () => [], rememberMaterial() {}, filterMaterials: entries => entries };
  const nav = { pop() { assert.equal(session.navBlocked, false, 'navigation must be released first'); pops.push('pop'); } };
  const r = runtime('mobile/items/ItemIcon', { params: { channel: key } }, undefined, undefined, { exportName: 'default', components: [], globals: { localStorage: {} }, modules: {
    ...leaves(session, nav, async (command, args) => { calls.push([command, args]); if (command === 'list_materials') return [{ id: 'icon-camera', name: '相机', builtin: true }]; if (command === 'prepare_material') return wait.promise; throw new Error('Unexpected ' + command); }, async () => {}), './materials': materials,
  } });
  await r.settle();
  const choose = r.button('选择图标：相机').props.onClick;
  choose(); r.render();
  assert.equal(session.navBlocked, true);
  assert.equal(r.button('选择图标：相机').props.disabled, true);
  choose(); await r.settle();
  assert.equal(calls.filter(([c]) => c === 'prepare_material').length, 1);
  assert.equal(chosen.length, 0); assert.equal(pops.length, 0);
  wait.resolve(photo); await r.settle();
  assert.equal(session.navBlocked, false); assert.equal(chosen.length, 1); assert.equal(chosen[0][0].id, photo.id); assert.equal(chosen[0][1], true); assert.deepEqual(pops, ['pop']);
  r.unmount(); model.clearIconSession(key);
});

test('mobile edit keeps unknown submission input, blocks resubmission, and follows the verified receipt', async () => {
  const { r, session, requests, navigations, calls } = await editor({ save: async (_request, session) => { session.pending = true; throw new Error('保存结果未确定'); } });
  field(r, '名称').props.onChange('待核对虚构物品'); r.render();
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.equal(requests.length, 1); assert.equal(session.navBlocked, true);
  assert.equal(field(r, '名称').props.value, '待核对虚构物品');
  assert.equal(action(r, '保存物品').props.disabled, true);
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.equal(requests.length, 1); assert.equal(navigations.length, 0);
  session.pending = false; session.navBlocked = false;
  session.settled = { command: 'save_asset', input: requests[0].input, label: '新增物品' };
  r.render(); await r.settle();
  const lookup = calls.find(([command]) => command === 'saved_request');
  assert.equal(lookup[1].request, requests[0].input.base.request_id); assert.equal(lookup[1].generation, generation);
  assert.deepEqual(JSON.parse(JSON.stringify(navigations.at(-1))), ['replace', 'items.detail', { id: result.asset.id }]);
  assert.equal(session.reloads, 1); r.unmount();
});

test('mobile edit refuses mixed initial library reads and later generation changes', async () => {
  let reads = 0;
  const mixed = await editor({ invoke: command => command === 'taxonomy_snapshot' ? { ...catalog(), generation: ++reads === 1 ? generation : 'other-generation' } : undefined });
  assert.match(mixed.r.find('ErrorState').props.message, /资料库已切换/);
  assert.equal(field(mixed.r, '名称'), undefined); assert.equal(mixed.requests.length, 0); mixed.r.unmount();
  const current = await editor();
  field(current.r, '名称').props.onChange('不能跨库提交'); current.r.render();
  current.session.data = { summary: { generation: 'other-generation' } }; current.r.render();
  assert.match(current.r.find('ErrorState').props.message, /当前输入不能提交/);
  assert.equal(field(current.r, '名称').props.value, '不能跨库提交');
  assert.equal(action(current.r, '保存物品').props.disabled, true);
  action(current.r, '保存物品').props.onClick(); await current.r.settle();
  assert.equal(current.requests.length, 0); current.r.unmount();
});

test('mobile edit photo multi-select keeps photos as attachments (not the cover) and discloses partial failure before saving', async () => {
  let uploads = 0;
  const { r, requests, session } = await editor({ invoke: async command => { if (command !== 'import_photo_bytes') return undefined; if (++uploads === 2) throw new Error('虚构图片读取失败'); return photo; } });
  field(r, '名称').props.onChange('虚构照片物品'); r.render();
  const file = name => ({ name, size: 2, arrayBuffer: async () => Uint8Array.from([1, 2]).buffer });
  assert.equal(r.find('input', p => p.capture === 'environment'), undefined, 'the system picker already offers the camera');
  assert.equal(r.find('input', p => p.multiple).props.accept, 'image/*');
  r.find('input', p => p.multiple).props.onChange({ target: { files: [file('一.png'), file('二.png')], value: 'temporary' } });
  await r.settle();
  assert.equal(uploads, 2); assert.equal(session.navBlocked, false);
  assert.equal(r.nodes().some(n => n.type === 'PhotoThumbs'), true, 'photos appear as a row under the notes');
  assert.equal(action(r, '保存物品').props.disabled, true);
  assert.match(r.find('ErrorState', p => p.title === '图片未全部读取').props.message, /已成功读取的图片保留/);
  action(r, '不使用未读取的图片').props.onClick(); r.render();
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.deepEqual(Array.from(requests[0].input.photos.ids), [photo.id]);
  assert.equal(requests[0].input.photos.cover_id, null, 'an added photo is an attachment; the icon is chosen separately');
  assert.equal(requests[0].input.base.price_cents, null); assert.equal(requests[0].input.base.purchase_date, null);
  r.unmount();
});

test('mobile edit shows a missing-name error in the viewport and does not submit', async () => {
  const { r, requests } = await editor();
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.equal(requests.length, 0);
  const alert = r.nodes().find(node => node.type === 'div' && node.props.role === 'alert' && r.text(node).includes('请填写名称'));
  assert.ok(alert, 'a fixed alert carries the validation message');
  assert.equal(field(r, '名称').props.error, '请填写名称，最多 200 字。');
  field(r, '名称').props.onChange('虚构后来补上的名称'); r.render();
  assert.equal(field(r, '名称').props.error, undefined);
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.equal(requests.length, 1);
  r.unmount();
});

test('mobile edit keeps functional controls outside the fold and saves their selected values', async () => {
  const { r, requests } = await editor();
  const labels = r.nodes().filter(n => ['TextField', 'MoneyField', 'DateField', 'SelectField'].includes(n.type)).map(n => n.props.label);
  assert.deepEqual(labels.slice(0, 4), ['名称', '购买价格', '购买日期', '分类']);
  assert.ok(labels.indexOf('标签') > labels.indexOf('分类') && labels.includes('购买渠道'));
  assert.ok(labels.indexOf('成本计算模式') < labels.indexOf('购买渠道') && labels.includes('目标设定'));
  assert.equal(r.nodes().filter(n => n.type === 'details').length, 1);
  assert.equal(r.nodes().find(n => n.type === 'details').props.open, false);
  const descendants = node => Array.isArray(node) ? node.flatMap(descendants) : node && typeof node === 'object' ? [node, ...descendants(node.props?.children)] : [];
  const folded = descendants(r.find('details'));
  assert.deepEqual(folded.filter(node => ['SelectField', 'TextField'].includes(node.type)).map(node => node.props.label), ['购买渠道', '品牌', '型号', '序列号']);
  assert.equal(folded.some(node => node.type === 'Switch'), false);
  const identity = r.find('section', p => p.className === 'm-card m-item-identity');
  assert.ok(descendants(identity).includes(field(r, '名称')));
  assert.ok(descendants(identity).includes(r.button('更换图标')));
  assert.doesNotMatch(r.text(identity), /物品图标|点图标更换/);
  assert.ok(r.nodes().find(n => n.type === 'textarea' && n.props['aria-label'] === '备注'));
  assert.equal(r.nodes().some(n => n.type === 'PhotoThumbs'), false, 'no photo row without photos');
  const add = r.button('添加图片'); assert.ok(add);
  assert.equal(r.nodes().some(n => r.text(n) === '拍照建档' || r.text(n) === '从相册选（可多选）'), false);
  r.find('Switch', p => p.label === '已售出').props.onChange(true); r.render();
  assert.ok(r.find('MoneyField', p => p.label === '售出价格'));
  let clicked = 0; r.find('input', p => p.multiple).props.ref.current = { click() { clicked++; } };
  add.props.onClick(); r.render(); assert.equal(clicked, 1);
  assert.equal(r.find('Sheet', p => p.title === '添加图片'), undefined, 'one tap goes straight to the system picker');
  field(r, '名称').props.onChange('虚构常用设置'); r.render();
  r.find('Switch', p => p.label === '设置保障时间').props.onChange(true); r.render();
  r.find('Switch', p => p.label === '已退役').props.onChange(true); r.render();
  r.find('SelectField', p => p.label === '成本计算模式').props.onChange('per_use'); r.render();
  field(r, '已使用次数').props.onChange('12'); r.render();
  r.find('SelectField', p => p.label === '目标设定').props.onChange('date'); r.render();
  r.find('DateField', p => p.label === '目标日期').props.onChange('2027-12-31'); r.render();
  r.find('Switch', p => p.label === '置顶物品').props.onChange(true); r.render();
  r.find('Switch', p => p.label === '不计入统计').props.onChange(true); r.render();
  assert.equal(r.nodes().some(node => node.type === 'Switch' && node.props.label === '不计入总金额'), false, 'detail switches stay folded by default');
  const excludeToggle = r.nodes().find(node => node.type === 'button' && r.text(node).includes('分别设置'));
  assert.ok(excludeToggle);
  excludeToggle.props.onClick(); r.render();
  assert.ok(r.find('Switch', p => p.label === '不计入总金额'));
  assert.ok(r.find('Switch', p => p.label === '不在时间轴显示'));
  action(r, '保存物品').props.onClick(); await r.settle();
  const options = requests[0].input.options;
  assert.equal(options.warranty.end_date, '2027-10-21');
  assert.equal(options.retired_date, '2026-10-21');
  assert.equal(options.sale.date, '2026-10-21');
  assert.equal(options.preferences.cost_mode, 'per_use');
  assert.equal(options.preferences.use_count, 12);
  assert.equal(options.preferences.goal.date, '2027-12-31');
  assert.equal(options.preferences.pinned, true);
  assert.ok(Object.values(options.preferences.exclude).every(Boolean));
  r.unmount();
});

test('mobile edit opens the fold for saved archive fields, independently of common settings', async () => {
  const saved = {
    asset: { id: 'existing-item', name: '虚构已有物品', revision: 3, price_cents: '19900', purchase_date: '2026-02-03' },
    details: { brand: '', model: '', serial_number: '', notes: '' }, lifecycle: { state: 'active', events: [] },
    preferences: { ...preferences.defaultPreferences(), label_id: 'label-work', pinned: true },
    photos: [], cover_id: null, maintenances: [], warranties: [],
    costs: { daily_cents: '100', known_maintenance_cents: '0', held_days: 100, unknown_maintenance_count: 0, total_investment_cents: '19900' },
  };
  const { r } = await editor({ id: 'existing-item', invoke: command => command === 'read_asset' ? saved : undefined });
  assert.equal(r.nodes().find(n => n.type === 'details').props.open, false);
  assert.ok(r.find('SelectField', p => p.label === '标签'));
  r.unmount();
  for (const record of [{ ...saved, details: { ...saved.details, brand: '虚构品牌' } }, { ...saved, classification: { category_id: null, channel_id: 'fictional-channel' } }]) {
    const next = await editor({ id: 'existing-item', invoke: command => command === 'read_asset' ? record : undefined });
    assert.equal(next.r.find('details').props.open, true);
    next.r.unmount();
  }
});

test('mobile default icon previews the editor category and clears the cover without preparing a material', async () => {
  const session = sessionState(), chosen = [], calls = [], key = 'fictional-default-picker';
  model.setIconSession(key, { generation, photos: [photo], cover: photo.id, defaultIcon: 'computer', choose: (...args) => chosen.push(args) });
  const materials = { materialArt: () => '<svg/>', materialCategories: ['全部'], readRecentMaterials: () => [], rememberMaterial() {}, filterMaterials: entries => entries };
  const r = runtime('mobile/items/ItemIcon', { params: { channel: key } }, undefined, undefined, { exportName: 'default', components: [], globals: { localStorage: {} }, modules: {
    ...leaves(session, { pop() {} }, async command => { calls.push(command); if (command === 'list_materials') return []; throw new Error('Unexpected ' + command); }, async () => {}), './materials': materials,
  } });
  await r.settle();
  assert.equal(r.find('CategoryFallback').props.icon, 'computer');
  assert.equal(r.nodes().some(node => node.type === 'img'), false);
  r.button('选择默认图标').props.onClick(); await r.settle();
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0][0], null);
  assert.equal(chosen[0][1], false);
  assert.deepEqual(calls, ['list_materials']);
  r.unmount(); model.clearIconSession(key);
});

test('mobile cardboard box is a distinct material, rather than a second default choice', async () => {
  const session = sessionState(), chosen = [], key = 'fictional-box-picker';
  model.setIconSession(key, { generation, photos: [], cover: null, choose: (...args) => chosen.push(args) });
  const materials = { materialArt: () => '<svg/>', materialCategories: ['全部'], readRecentMaterials: () => [], rememberMaterial() {}, filterMaterials: entries => entries };
  const calls = [];
  const r = runtime('mobile/items/ItemIcon', { params: { channel: key } }, undefined, undefined, { exportName: 'default', components: [], globals: { localStorage: {} }, modules: {
    ...leaves(session, { pop() {} }, async (command, args) => {
      calls.push([command, args]);
      if (command === 'list_materials') return [{ id: 'icon-box', name: '默认图标', builtin: true }];
      if (command === 'prepare_material') return photo;
      throw new Error('Unexpected ' + command);
    }, async () => {}), './materials': materials,
  } });
  await r.settle();
  assert.ok(r.button('选择默认图标'));
  assert.equal(r.button('选择图标：默认图标'), undefined);
  r.button('选择图标：纸箱').props.onClick(); await r.settle();
  assert.equal(calls.find(([command]) => command === 'prepare_material')[1].input.id, 'icon-box');
  assert.equal(chosen[0][0].id, photo.id);
  assert.equal(chosen[0][1], true);
  r.unmount(); model.clearIconSession(key);
});
