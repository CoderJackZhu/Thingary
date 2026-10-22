import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceSummary, autoBackupLabel, backupReminder, countLocalWork, daysAgoText, enabledModuleCount, groupByMonth, isSettingsPage, keywordError, lastBackupKey, monthSpendingText, monthTitle, timelineDetail, readLastBackup, restoreClearKeys, restoreLines, settingsTitles, writeLastBackup } from '../src/mobile/me/model.ts';
import { daysBetween, dayText, eventTarget, hideAmountsKey, mask, openRoute, readHideAmounts, targetRoute, writeHideAmounts } from '../src/mobile/me/shared.ts';
import { routes } from '../src/mobile/routes.ts';
import { allModules } from '../src/modules.ts';

const store = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data }; };

test('设置子页都在 me.settings 一个路由下，标题齐全', () => {
  for (const page of ['modules', 'appearance', 'options', 'materials', 'checkin', 'notifications', 'privacy', 'trash', 'export', 'demo', 'about', 'feedback', 'license']) { assert.ok(isSettingsPage(page), page); assert.ok(settingsTitles[page]); }
  assert.equal(isSettingsPage('constructor'), false); assert.equal(isSettingsPage(undefined), false);
  assert.ok(routes['me.settings'].load && routes['me.data'].load && routes['me.search'].load && routes['me.timeline'].load && routes['me.home'].load);
  assert.ok(routes['home.overview'].load && routes.welcome.load);
});
test('模块计数与外观摘要', () => {
  assert.equal(enabledModuleCount(allModules), 8);
  assert.equal(enabledModuleCount({ ...allModules, wealth: false, planning: false }), 6);
  assert.equal(appearanceSummary('bento', 'system'), '柔和卡片 · 跟随系统');
  assert.equal(appearanceSummary('olive', 'dark'), '暖米橄榄 · 深色');
});
test('备份提醒：没备份过、30 天内、超过 30 天', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  assert.equal(backupReminder(null, now, true).tone, 'warn');
  assert.equal(backupReminder(null, now, false).tone, 'positive');
  const fresh = backupReminder('2026-10-18T08:00:00Z', now, true);
  assert.equal(fresh.tone, 'positive'); assert.equal(fresh.daysAgo, 3); assert.match(fresh.text, /下次提醒/);
  const old = backupReminder('2026-08-01T08:00:00Z', now, true);
  assert.equal(old.tone, 'warn'); assert.match(old.text, /建议再备份一次/);
  assert.equal(daysAgoText(null), '未备份'); assert.equal(daysAgoText(0), '今天'); assert.equal(daysAgoText(5), '5 天前');
});
test('上次备份时间：坏值读作没有，写入失败返回 false', () => {
  const s = store();
  assert.equal(readLastBackup(s), null);
  assert.equal(writeLastBackup(s, new Date('2026-10-18T00:00:00Z')), true);
  assert.equal(readLastBackup(s), '2026-10-18T00:00:00.000Z');
  s.data.set(lastBackupKey, 'xx'); assert.equal(readLastBackup(s), null);
  assert.equal(writeLastBackup(null, new Date()), false);
  assert.equal(writeLastBackup({ setItem() { throw new Error('full'); } }, new Date()), false);
  assert.equal(readLastBackup({ getItem() { throw new Error('denied'); } }), null);
});
test('时间轴按月分组：支出计购入维护支出付款，退款冲减，盘点不计，未知金额单独计数', () => {
  const ev = (id, kind, date, amount) => ({ id, kind, date, title: id, amount_cents: amount });
  const groups = groupByMonth([ev('a', 'purchase', '2026-10-05', 10000), ev('b', 'refund', '2026-10-03', 2500), ev('c', 'snapshot', '2026-10-02', 99999999), ev('d', 'expense', '2026-10-01', null), ev('e', 'maintenance', '2026-09-30', 500), ev('u', 'purchase', null, 1)]);
  assert.deepEqual(groups.map(g => g.key), ['2026-10', '2026-09']);
  assert.equal(groups[0].spendingCents, '7500'); assert.equal(groups[0].unknownCount, 1); assert.equal(groups[0].events.length, 4);
  assert.equal(groups[1].spendingCents, '500');
  assert.match(monthSpendingText(groups[0], '2026-10'), /^本月支出.*1 笔金额未知/);
  assert.match(monthSpendingText(groups[1], '2026-10'), /^当月支出/);
});
test('搜索关键词校验：200 字、空字符', () => {
  assert.equal(keywordError('相机'), null);
  assert.match(keywordError('a'.repeat(201)), /200/);
  assert.equal(keywordError('😀'.repeat(200)), null);
  assert.match(keywordError('a\0b'), /空字符/);
});
test('恢复摘要列出全部计数，缺省的字段按 0', () => {
  const lines = restoreLines({ hash: 'h', created_at: '2026-10-01T00:00:00Z', schema: 3, assets: 5, deleted_assets: 1, wishes: 2, maintenances: 3, warranties: 4, accounts: 2, snapshots: 6, expenses: 7, plans: 1, payments: 9, virtual_assets: 2, files: 11 });
  assert.equal(lines.length, 14); assert.ok(lines.includes('物品 5 件（其中最近删除 1）')); assert.ok(lines.includes('存钱目标 0 个')); assert.ok(lines.includes('原图 11 个'));
});
test('恢复后清理：保留外观、隐私、备份提醒与导入请求，清掉草稿和请求', () => {
  const keys = ['thingary.theme', 'thingary.style', 'thingary.privacy-lock.v1', 'thingary.privacy-cover.v1', lastBackupKey, hideAmountsKey, 'thingary.item-import-pending.v1', 'thingary.asset-draft.v1', 'thingary.trash-request.v1', 'other.key'];
  assert.deepEqual(restoreClearKeys(keys), ['thingary.asset-draft.v1', 'thingary.trash-request.v1']);
  assert.equal(countLocalWork(keys), 2);
});
test('自动备份列表：今天、昨天、日期，加密标记，时间取自文件名', () => {
  const item = (name, date) => ({ name, date, size: 1 });
  assert.deepEqual(autoBackupLabel(item('thingary-20261021-0930-abc123.thingary', '2026-10-21'), '2026-10-21'), { title: '今天 09:30', sub: '' });
  assert.equal(autoBackupLabel(item('x-1800-abcdef.thingary.age', '2026-10-20'), '2026-10-21').title, '昨天 18:00');
  assert.equal(autoBackupLabel(item('x-1800-abcdef.thingary.age', '2026-10-20'), '2026-10-21').sub, '已加密');
  assert.equal(autoBackupLabel(item('weird.thingary', '2026-09-03'), '2026-10-21').title, '9月3日');
});
test('记录跳转：每种来源对应的路由都已登记，参数只含 ID', () => {
  const targets = [{ kind: 'asset', id: 'a' }, { kind: 'wish', id: 'w' }, { kind: 'snapshot', id: 's' }, { kind: 'account', id: 'c' }, { kind: 'plan', id: 'p' }, { kind: 'payment', id: 'y', plan_id: 'p' }, { kind: 'virtual', id: 'v' }, { kind: 'topup', id: 't', asset_id: 'v' }, { kind: 'expense', id: 'e' }, { kind: 'income', id: 'i' }, { kind: 'movement', id: 'm' }];
  for (const target of targets) { const r = targetRoute(target); assert.ok(routes[r.route], target.kind); for (const v of Object.values(r.params)) assert.equal(typeof v, 'string'); }
  assert.deepEqual(targetRoute({ kind: 'payment', id: 'y', plan_id: 'p' }), { route: 'spending.recurring', params: { id: 'p', payment: 'y' } });
  assert.deepEqual(targetRoute({ kind: 'topup', id: 't', asset_id: 'v' }), { route: 'spending.virtual', params: { id: 'v', topup: 't' } });
  assert.equal(eventTarget({ asset_id: null, wishlist_id: null }), null);
  assert.equal(eventTarget({ asset_id: 'a', wishlist_id: null }).route, 'items.detail');
  assert.equal(eventTarget({ target: { kind: 'wish', id: 'w' }, asset_id: 'a', wishlist_id: null }).route, 'wishes.detail');
});
test('openRoute：分段根页切标签和分段，其余页压栈', () => {
  const calls = [];
  const nav = { tab: 'overview', push: (...a) => calls.push(['push', ...a]), switchTab: t => calls.push(['tab', t]), setSegment: r => calls.push(['seg', r]) };
  openRoute(nav, 'items.list'); openRoute(nav, 'items.detail', { id: 'a' });
  assert.deepEqual(calls, [['tab', 'items'], ['seg', 'items.list'], ['push', 'items.detail', { id: 'a' }]]);
});
test('隐藏金额：读写、遮挡文字、存储不可用', () => {
  const s = store();
  assert.equal(readHideAmounts(s), false); assert.equal(writeHideAmounts(s, true), true); assert.equal(readHideAmounts(s), true);
  assert.equal(mask('¥1', true), '******'); assert.equal(mask('¥1', false), '¥1');
  assert.equal(readHideAmounts(null), false); assert.equal(writeHideAmounts(null, true), false);
  assert.equal(readHideAmounts({ getItem() { throw new Error('x'); } }), false);
});
test('日期工具', () => {
  assert.equal(dayText('2026-10-05', '2026-10-21'), '10月5日'); assert.equal(dayText('2025-10-05', '2026-10-21'), '2025年10月5日'); assert.equal(dayText('未知'), '未知');
  assert.equal(daysBetween('2026-10-21', '2026-10-25'), 4); assert.equal(daysBetween('2026-10-21', '2026-10-20'), -1);
});

test('时间轴：月份标题不带「年」（今年），行说明不重复金额', () => {
  assert.equal(monthTitle('2026-10', '2026-10-21'), '10月'); assert.equal(monthTitle('2025-03', '2026-10-21'), '2025年3月');
  assert.equal(groupByMonth([{ id: 'a', kind: 'purchase', date: '2025-03-05', amount_cents: '100', title: 'x', note: '', asset_id: null, wishlist_id: null }], '2026-10-21')[0].title, '2025年3月');
  const event = (kind, amount_cents) => ({ kind, amount_cents });
  assert.equal(timelineDetail('实付 ¥6,490', event('purchase', '649000')), '实付');
  assert.equal(timelineDetail('来自心愿「耳机」 · 实付 ¥1,280.50', event('purchase', '128050')), '来自心愿「耳机」 · 实付');
  assert.equal(timelineDetail('金额待补充', event('purchase', null)), '金额未知');
  assert.equal(timelineDetail('金融净资产 ¥88,000', event('snapshot', '8800000')), '金融净资产 ¥88,000');
});
