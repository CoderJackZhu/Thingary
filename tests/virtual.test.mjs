import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter, statusText, validityText } from '../src/virtual.ts';
import { entryDisplay, restoresViaWealth } from '../src/unified-trash.ts';

const item = (over = {}, fields = {}) => ({ id: 'v1', revision: 1, plan_name: null, plan_deleted: false, valid_until: null, status: 'active', spent_cents: null,
  fields: { name: '虚构软件', kind: 'license', provider: '', purchase_date: null, price_cents: null, expires: null, plan_id: null, url: '', notes: '', stopped_on: null, ...fields }, ...over });

test('“有效” keeps every still-usable item, other filters match one status', () => {
  for (const status of ['active', 'perpetual', 'unknown']) assert.ok(matchesFilter(item({ status }), 'valid'));
  for (const status of ['expiring', 'expired', 'stopped']) assert.ok(!matchesFilter(item({ status }), 'valid'));
  assert.ok(matchesFilter(item({ status: 'stopped' }), 'stopped') && matchesFilter(item({ status: 'stopped' }), 'all'));
  assert.equal(statusText.unknown, '有效期待补充');
});

test('validity says where the date comes from', () => {
  assert.equal(validityText(item({ status: 'perpetual' })), '永久有效');
  assert.equal(validityText(item({ valid_until: '2026-10-01' }, { kind: 'domain' })), '2026-10-01');
  assert.equal(validityText(item({ status: 'unknown' }, { kind: 'domain' })), '待补充');
  const linked = { kind: 'subscription', plan_id: 'p1' };
  assert.equal(validityText(item({ valid_until: '2026-10-29' }, linked)), '2026-10-29（按已付期推算）');
  assert.equal(validityText(item({ status: 'unknown' }, linked)), '待首次付款');
  assert.equal(validityText(item({ plan_deleted: true, status: 'unknown' }, linked)), '关联计划在最近删除中');
});

test('deleted virtual assets restore through the shared wealth command', () => {
  assert.ok(restoresViaWealth('virtual'));
  const d = entryDisplay({ kind: 'virtual', id: 'v1', title: 'example-notes.cn', subtype: 'domain', date: '2025-10-18', end_date: null, cost_cents: null, provider: null, deleted_at: '2026-09-28T08:00:00+00:00', asset_id: null, asset_name: null, asset_deleted: false, asset_revision: 2, asset_state: null, contents: [] });
  assert.deepEqual([d.typeLabel, d.title, d.facts], ['虚拟资产', 'example-notes.cn', ['域名 · 购于 2025-10-18']]);
});

test('ending a single service takes priority over perpetual validity without losing its cost', async () => {
  const { virtualStatusText, cumulativeCost } = await import('../src/virtual.ts');
  const ended = item({ status: 'stopped', spent_cents: '2500000' }, { billing: 'single', perpetual: true, purchase_date: '2026-01-20', stopped_on: '2026-06-30', price_cents: '2500000' });
  assert.equal(virtualStatusText(ended), '已结束使用');
  assert.equal(validityText(ended), '使用结束于 2026-06-30');
  assert.equal(matchesFilter(ended, 'valid'), false);
  assert.equal(matchesFilter(ended, 'stopped'), true);
  assert.equal(cumulativeCost(ended).cents, '2500000');
  const reopened = { ...ended, status: 'perpetual', fields: { ...ended.fields, stopped_on: null } };
  assert.equal(validityText(reopened), '永久有效');
  assert.equal(matchesFilter(reopened, 'valid'), true);
});
