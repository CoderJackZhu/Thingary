import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/DataManagement.tsx', import.meta.url), 'utf8');

test('restore is inspect-then-confirm and bound to the checked hash', () => {
  assert.match(src, /invoke<Inspected \| null>\('inspect_backup'\)/);
  assert.match(src, /invoke<string>\('restore_backup', \{ path: candidate\.path, hash: candidate\.summary\.hash, generation \}\)/);
  assert.match(src, /确认替换当前资料/);
  assert.match(src, /当前资料会先保存保护副本/);
});

test('after a restore only old-generation work is cleared, appearance stays', () => {
  assert.match(src, /k\?\.startsWith\('thingary\.'\) && k !== 'thingary\.theme'/);
  assert.match(src, /location\.reload\(\)/);
});

test('three data operations are named and not interchangeable', () => {
  for (const title of ['完整备份', '从备份恢复', '导出资料表格（Excel）', '最近删除']) assert.ok(src.includes(`<h3>${title}</h3>`), title);
  assert.match(src, /不能用于恢复/);
});

test('the restore warning counts drafts and pending requests, not other local keys', () => {
  assert.match(src, /filter\(k => \/draft\|request\|abandon\|upload\/\.test\(k\)\)/);
});

test('Excel export is enabled, explains its scope and cannot be mistaken for a backup', () => {
  assert.match(src, /invoke<\{ path: string; files: \{ name: string; rows: number \}\[\] \} \| null>\('export_workbook'\)/);
  assert.match(src, /不能用于恢复/);
  assert.match(src, /一个 Excel 文件/);
  assert.doesNotMatch(src, /下一阶段提供/);
});

test('item import states it only adds and cannot batch-modify existing assets', () => {
  assert.match(src, /导入物品表（Excel）/);
  assert.match(src, /不能用于批量修改/);
  assert.match(src, /与已有物品或文件内其他行相同/);
});

test('a lost item import reply is checked by its original request, never re-submitted blindly', () => {
  assert.match(src, /item-import-pending\.v1/);
  assert.match(src, /invoke<ImportDone \| null>\('item_import_receipt'/);
  assert.match(src, /核对物品导入结果/);
  assert.doesNotMatch(src, /导入未完成，当前资料保持原样/);
  assert.match(src, /导入未提交，资料未改变/);
});
