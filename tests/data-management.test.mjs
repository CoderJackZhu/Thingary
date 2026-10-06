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
  for (const title of ['完整备份', '从备份恢复', '导出全部表格（CSV）', '最近删除']) assert.ok(src.includes(`<h3>${title}</h3>`), title);
  assert.match(src, /不能用于恢复/);
});

test('the restore warning counts drafts and pending requests, not other local keys', () => {
  assert.match(src, /filter\(k => \/draft\|request\|abandon\|upload\/\.test\(k\)\)/);
});

test('CSV export is enabled, explains its scope and cannot be mistaken for a backup', () => {
  assert.match(src, /invoke<\{ folder: string; files: \{ name: string; rows: number \}\[\] \} \| null>\('export_all_csv'\)/);
  assert.match(src, /不能用于恢复/);
  assert.match(src, /放进一个新文件夹/);
  assert.doesNotMatch(src, /下一阶段提供/);
});
