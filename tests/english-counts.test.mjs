import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Fresh processes select the real locale table, without the Chinese-only test preloader.
const countKeys = [
  '{count} 条记录',
  '{count} 件',
  '{count} 笔',
  '{length} 项',
  '{length} 个账户',
  '{total} 条心愿',
  '{n} 天',
  '{n} 个月',
  '{days} 天前',
  '{length} 张',
  '{length} 个素材',
  '{unknown} 件金额未知，未计入；不含已售出',
  '{date} 盘点尚缺 {missing} 个账户 ·',
  '{n} 个账户已按上次金额预填（沿用），没变的不用动；金额变了直接改。预填的账户在历史里会标为沿用。',
];
const labelKeys = ['账户与盘点', '收支记录', '财务复盘', '周期费用', '虚拟资产', '本地档案 · 仅本机'];

function display(lang) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.localStorage = { getItem: () => ${JSON.stringify(lang)} };
    const { t } = await import('./src/i18n.ts');
    const keys = ${JSON.stringify(countKeys)};
    const labels = ${JSON.stringify(labelKeys)};
    const params = n => ({ count: n, length: n, total: n, n, days: n, unknown: n, missing: n, date: '2026-10-01', v2: '' });
    console.log(JSON.stringify({
      counts: Object.fromEntries(keys.map(key => [key, [0, 1, 2].map(n => t(key, params(n)))])),
      labels: labels.map(key => t(key))
    }));
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));
}

test('English counts read correctly for 0, 1 and 2', () => {
  const { counts, labels } = display('en');
  assert.deepEqual(counts['{count} 条记录'], ['Records: 0', 'Records: 1', 'Records: 2']);
  assert.deepEqual(counts['{count} 件'], ['Items: 0', 'Items: 1', 'Items: 2']);
  assert.deepEqual(counts['{count} 笔'], ['Entries: 0', 'Entries: 1', 'Entries: 2']);
  assert.deepEqual(counts['{length} 项'], ['Items: 0', 'Items: 1', 'Items: 2']);
  assert.deepEqual(counts['{length} 个账户'], ['Accounts: 0', 'Accounts: 1', 'Accounts: 2']);
  assert.deepEqual(counts['{total} 条心愿'], ['Wishes: 0', 'Wishes: 1', 'Wishes: 2']);
  assert.deepEqual(counts['{n} 天'], ['0 day(s)', '1 day(s)', '2 day(s)']);
  assert.deepEqual(counts['{n} 个月'], ['0 month(s)', '1 month(s)', '2 month(s)']);
  assert.deepEqual(counts['{days} 天前'], ['0 day(s) ago', '1 day(s) ago', '2 day(s) ago']);
  assert.deepEqual(counts['{length} 张'], ['Photos: 0', 'Photos: 1', 'Photos: 2']);
  assert.deepEqual(counts['{length} 个素材'], ['Media items: 0', 'Media items: 1', 'Media items: 2']);
  assert.deepEqual(counts['{unknown} 件金额未知，未计入；不含已售出'], [
    '0 item(s) with unknown amount, excluded; sold items not included',
    '1 item(s) with unknown amount, excluded; sold items not included',
    '2 item(s) with unknown amount, excluded; sold items not included',
  ]);
  assert.deepEqual(counts['{date} 盘点尚缺 {missing} 个账户 ·'], [
    '2026-10-01 check-in · Accounts missing: 0 ·',
    '2026-10-01 check-in · Accounts missing: 1 ·',
    '2026-10-01 check-in · Accounts missing: 2 ·',
  ]);
  assert.deepEqual(counts['{n} 个账户已按上次金额预填（沿用），没变的不用动；金额变了直接改。预填的账户在历史里会标为沿用。'], [0, 1, 2].map(n =>
    `Accounts prefilled with last time's amounts: ${n}. Leave the unchanged ones alone and only edit the amounts that changed. Prefilled accounts are marked as carried over in history.`
  ));
  assert.deepEqual(labels, ['Accounts', 'Cash Flow', 'Review', 'Recurring', 'Virtual', 'Local only']);
});

test('Chinese count and sidebar output is fixed verbatim', () => {
  const { counts, labels } = display('zh-CN');
  assert.deepEqual(counts['{count} 条记录'], ['0 条记录', '1 条记录', '2 条记录']);
  assert.deepEqual(counts['{count} 件'], ['0 件', '1 件', '2 件']);
  assert.deepEqual(counts['{count} 笔'], ['0 笔', '1 笔', '2 笔']);
  assert.deepEqual(counts['{length} 项'], ['0 项', '1 项', '2 项']);
  assert.deepEqual(counts['{length} 个账户'], ['0 个账户', '1 个账户', '2 个账户']);
  assert.deepEqual(counts['{total} 条心愿'], ['0 条心愿', '1 条心愿', '2 条心愿']);
  assert.deepEqual(counts['{n} 天'], ['0 天', '1 天', '2 天']);
  assert.deepEqual(counts['{n} 个月'], ['0 个月', '1 个月', '2 个月']);
  assert.deepEqual(counts['{days} 天前'], ['0 天前', '1 天前', '2 天前']);
  assert.deepEqual(counts['{length} 张'], ['0 张', '1 张', '2 张']);
  assert.deepEqual(counts['{length} 个素材'], ['0 个素材', '1 个素材', '2 个素材']);
  assert.deepEqual(counts['{unknown} 件金额未知，未计入；不含已售出'], [
    '0 件金额未知，未计入；不含已售出',
    '1 件金额未知，未计入；不含已售出',
    '2 件金额未知，未计入；不含已售出',
  ]);
  assert.deepEqual(counts['{date} 盘点尚缺 {missing} 个账户 ·'], [
    '2026-10-01 盘点尚缺 0 个账户 ·',
    '2026-10-01 盘点尚缺 1 个账户 ·',
    '2026-10-01 盘点尚缺 2 个账户 ·',
  ]);
  assert.deepEqual(counts['{n} 个账户已按上次金额预填（沿用），没变的不用动；金额变了直接改。预填的账户在历史里会标为沿用。'], [0, 1, 2].map(n =>
    `${n} 个账户已按上次金额预填（沿用），没变的不用动；金额变了直接改。预填的账户在历史里会标为沿用。`
  ));
  assert.deepEqual(labels, ['账户与盘点', '收支记录', '财务复盘', '周期费用', '虚拟资产', '本地档案 · 仅本机']);
});
