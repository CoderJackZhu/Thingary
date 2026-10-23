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
    './NotificationNotice': { allowReminders: async () => {} }, './materials': { materialArt: () => '<svg/>' },
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
  const r = runtime('mobile/items/ItemEdit', { params: {} }, undefined, undefined, { exportName: 'default', components: [], modules: leaves(session, nav, invoke, submit) });
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
  assert.equal(r.find('input', p => p.capture === 'environment').props.accept, 'image/*');
  r.find('input', p => p.multiple).props.onChange({ target: { files: [file('一.png'), file('二.png')], value: 'temporary' } });
  await r.settle();
  assert.equal(uploads, 2); assert.equal(session.navBlocked, false);
  assert.equal(action(r, '保存物品').props.disabled, true);
  assert.match(r.find('ErrorState', p => p.title === '图片未全部读取').props.message, /已成功读取的图片保留/);
  action(r, '不使用未读取的图片').props.onClick(); r.render();
  action(r, '保存物品').props.onClick(); await r.settle();
  assert.deepEqual(Array.from(requests[0].input.photos.ids), [photo.id]);
  assert.equal(requests[0].input.photos.cover_id, null, 'an added photo is an attachment; the icon is chosen separately');
  assert.equal(requests[0].input.base.price_cents, null); assert.equal(requests[0].input.base.purchase_date, null);
  r.unmount();
});

test('mobile edit shows the common fields in order, notes with photos, and folds only brand/model/serial', async () => {
  const { r } = await editor();
  const labels = r.nodes().filter(n => ['TextField', 'MoneyField', 'DateField', 'SelectField'].includes(n.type)).map(n => n.props.label);
  assert.deepEqual(labels.slice(0, 6), ['名称', '购买价格', '购买日期', '分类', '标签', '购买渠道']);
  assert.ok(labels.indexOf('成本计算模式') > labels.indexOf('购买渠道') && labels.includes('目标设定'));
  assert.equal(r.nodes().filter(n => n.type === 'details').length, 1);
  assert.equal(r.nodes().find(n => n.type === 'details').props.open, false);
  assert.ok(r.nodes().find(n => n.type === 'textarea' && n.props['aria-label'] === '备注'));
  const strip = r.nodes().find(n => n.type === 'PhotoThumbs'); assert.ok(strip.props.onAdd);
  assert.equal(r.nodes().some(n => r.text(n) === '拍照建档' || r.text(n) === '从相册选（可多选）'), false);
  r.find('Switch', p => p.label === '已售出').props.onChange(true); r.render();
  assert.ok(r.find('MoneyField', p => p.label === '售出价格'));
  strip.props.onAdd(); r.render();
  assert.ok(r.find('Sheet', p => p.title === '添加图片'));
  r.unmount();
});
