import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as asset from '../src/asset.ts';
import * as maintenance from '../src/maintenance.ts';
import * as warranty from '../src/warranty.ts';
import * as sales from '../src/sales.ts';
import * as lifecycle from '../src/lifecycle.ts';
import * as detail from '../src/mobile/items/detail-model.ts';
import { defaultPreferences } from '../src/preferences.ts';
import * as format from '../src/mobile/format.ts';
function fixture() {
  return { asset: { id: 'fictional-camera', name: '虚构相机', price_cents: '10000', purchase_date: '2026-01-01', revision: 7 }, details: { brand: '', model: '', serial_number: '', notes: '' }, photos: [], cover_id: null, maintenances: [], warranties: [], warranty_summary: { status: 'none', total: 0 }, deleted: false, lifecycle: { state: 'active', events: [] }, preferences: defaultPreferences(), costs: { total_investment_cents: '10000', net_cost_cents: null, held_days: 80, daily_cents: '125', known_maintenance_cents: '0', unknown_maintenance_count: 0 } };
}
async function mounted({ save, readError, importPhoto } = {}) {
  const record = fixture(), requests = [], calls = [];
  const session = { today: '2026-10-21', data: { summary: { generation: 'fixture-generation' } }, navBlocked: false, settled: null, reload() {}, setBusy(value) { this.navBlocked = value; }, refreshPending() { calls.push('refreshPending'); } };
  const r = runtime('mobile/items/ItemDetail', { params: { id: record.asset.id } }, undefined, undefined, { exportName: 'default', components: [], modules: {
    './asset': asset, './mobile/format': format, './maintenance': maintenance, './warranty': warranty, './sales': sales, './lifecycle': lifecycle, './materials': { materialArt: () => '<svg/>' }, './NotificationNotice': { allowReminders: async () => {} }, './mobile/items/detail-model': detail,
    './mobile/session': { useSession: () => session }, './mobile/nav-context': { useNav: () => ({ push() {}, pop() {} }), useReveal: () => 0 },
    './wealth': { submit: async input => { requests.push(input); return save ? await save(input, record) : record; } },
    '@tauri-apps/api/core': { invoke: async (command, args) => { if (readError) throw new Error('虚构读取失败'); if (command === 'taxonomy_snapshot') return { generation: 'fixture-generation', categories: [], channels: [] }; if (command === 'read_asset') return record; if (command === 'import_photo_bytes' && importPhoto) return importPhoto(args); throw new Error('unexpected ' + command); } },
  } });
  await r.settle();
  return { r, session, record, requests, calls };
}
const action = (r, text) => r.nodes().find(n => n.type === 'Button' && r.text(n) === text);
test('mobile detail runtime shows read failure with retry and no stale asset actions', async () => {
  const { r } = await mounted({ readError: true });
  assert.equal(r.find('ErrorState').props.message, '虚构读取失败');
  assert.equal(action(r, '记录售出'), undefined);
  r.unmount();
});
test('mobile detail maintenance editor saves free accessory cost through the shared request builder', async () => {
  const { r, requests } = await mounted();
  r.find('ListGroup', p => p.title === '维护记录').props.action.props.onClick(); r.render();
  r.find('TextField', p => p.label === '维护标题').props.onChange('虚构免费配件'); r.render();
  r.find('SelectField', p => p.label === '维护类型').props.onChange('accessory'); r.render();
  assert.equal(r.find('MoneyField').props.value, '');
  r.find('MoneyField').props.onChange('0'); r.render();
  action(r, '保存').props.onClick(); await r.settle();
  assert.equal(requests.length, 1); assert.equal(requests[0].command, 'change_maintenance');
  assert.equal(requests[0].input.action.fields.cost_cents, '0');
  assert.equal(requests[0].input.action.fields.kind, 'accessory');
  assert.equal(requests[0].input.expected_revision, 7);
  r.unmount();
});
test('mobile detail unknown save retains editor input and refuses another write while session is blocked', async () => {
  const { r, session, requests, calls } = await mounted({ save: async () => { throw new Error('保存结果未确定'); } });
  r.find('ListGroup', p => p.title === '维护记录').props.action.props.onClick(); r.render();
  r.find('TextField', p => p.label === '维护标题').props.onChange('待核对维护'); r.render();
  action(r, '保存').props.onClick(); await r.settle();
  assert.equal(requests.length, 1); assert.equal(r.find('TextField', p => p.label === '维护标题').props.value, '待核对维护');
  assert.equal(r.find('Notice', p => p.tone === 'danger').props.children, '保存结果未确定');
  assert.deepEqual(calls, ['refreshPending']);
  session.navBlocked = true; r.render();
  assert.equal(r.find('fieldset').props.disabled, true);
  action(r, '保存').props.onClick(); await r.settle();
  assert.equal(requests.length, 1);
  r.unmount();
});

test('mobile detail photo multi-select keeps successful imports and requires acknowledging a failed file', async () => {
  const uploads = [];
  const { r, requests } = await mounted({ importPhoto: async args => {
    uploads.push(args);
    if (uploads.length === 2) throw new Error('虚构图片读取失败');
    return { id: 'prepared-photo', name: args.name };
  } });
  r.find('ListGroup', p => p.title === '维护记录').props.action.props.onClick(); r.render();
  const camera = r.find('input', p => p.capture === 'environment');
  assert.equal(camera.props.accept, 'image/*');
  const file = name => ({ name, size: 2, arrayBuffer: async () => Uint8Array.from([1, 2]).buffer });
  r.find('input', p => p.multiple).props.onChange({ target: { files: [file('虚构凭证1.png'), file('虚构凭证2.png')], value: 'temporary' } });
  await r.settle();
  assert.equal(uploads.length, 2); assert.deepEqual(Array.from(uploads[0].bytes), [1, 2]);
  assert.equal(action(r, '保存').props.disabled, true);
  assert.equal(r.find('ErrorState', p => p.title === '凭证未全部读取').props.message.includes('虚构图片读取失败'), true);
  action(r, '不使用未读取的图片').props.onClick(); r.render();
  r.find('TextField', p => p.label === '维护标题').props.onChange('虚构附件维护'); r.render();
  action(r, '保存').props.onClick(); await r.settle();
  assert.deepEqual(Array.from(requests[0].input.action.photos.ids), ['prepared-photo']);
  r.unmount();
});

test('mobile detail shows the four visible actions, no bottom button grid, and saves the pin switch immediately', async () => {
  const { r, requests } = await mounted();
  const labels = r.nodes().filter(n => n.type === 'button' && n.props.className === 'mi-action').map(n => r.text(n));
  assert.deepEqual(labels, ['记维护', '加保障', '记录售出', '退役']);
  assert.equal(r.nodes().some(n => n.type === 'Button' && ['编辑', '删除物品', '记录售出', '退役'].includes(r.text(n))), false);
  r.find('ListRow', p => p.title === '置顶').props.trailing.props.onChange(true); await r.settle();
  const save = requests.find(request => request.command === 'save_asset');
  assert.equal(save.input.options.preferences.pinned, true); assert.equal(save.input.base.expected_revision, 7);
  await r.settle(); r.render();
  r.nodes().find(n => n.type === 'button' && n.props.className === 'mi-action' && r.text(n) === '记录售出').props.onClick(); r.render();
  assert.ok(r.find('Sheet', p => p.title === '记录售出'));
  r.unmount();
});
