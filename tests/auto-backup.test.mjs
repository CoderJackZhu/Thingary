import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatBytes, autoBackupSummary, extraSummary } from '../src/auto-backup-format.ts';

test('sizes format in compact local units without fake precision', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(68 * 1024 * 1024), '68 MB');
  assert.equal(formatBytes(4.2 * 1024 * 1024 * 1024), '4.2 GB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(formatBytes(11 * 1024), '11 KB');
});

const status = over => ({
  enabled: true, folder: '/虚构/auto-backups', last_success_at: null, last_error: null,
  items: [], total_size: 0, extra_dir: null, extra_last_at: null, extra_last_error: null, ...over,
});

test('the status line states when, how many and how much, or that none exist yet', () => {
  assert.equal(autoBackupSummary(status({})), '尚未自动备份');
  const at = new Date(2026, 8, 29, 14, 32).toISOString();
  const line = autoBackupSummary(status({ last_success_at: at, items: [{ name: '物谱自动备份-2026-09-29.possio', date: '2026-09-29', size: 1 }, { name: '物谱自动备份-2026-09-28.possio', date: '2026-09-28', size: 2 }], total_size: 68 * 1024 * 1024 }));
  assert.ok(line.includes('上次自动备份：'), line);
  assert.ok(line.includes('2 份'), line);
  assert.ok(line.includes('68 MB'), line);
  // Items exist but no recorded success time still shows a usable line.
  assert.ok(autoBackupSummary(status({ items: [{ name: '物谱自动备份-2026-09-29.possio', date: '2026-09-29', size: 5 }], total_size: 5 })).includes('1 份'));
});

test('the extra line distinguishes never copied, copied and failed', () => {
  assert.equal(extraSummary(status({})), '尚未复制');
  assert.ok(extraSummary(status({ extra_dir: '/虚构/额外', extra_last_at: new Date(2026, 8, 29, 15, 0).toISOString() })).startsWith('上次复制：'));
  const failed = extraSummary(status({ extra_dir: '/虚构/额外', extra_last_error: { at: new Date(2026, 8, 29, 15, 0).toISOString(), message: '外接盘未连接' } }));
  assert.ok(failed.includes('上次复制失败'), failed);
  assert.ok(failed.includes('外接盘未连接'), failed);
});

const dataManagement = readFileSync(new URL('../src/DataManagement.tsx', import.meta.url), 'utf8');
const autoBackup = readFileSync(new URL('../src/AutoBackup.tsx', import.meta.url), 'utf8');

test('automatic backups live inside data management and reuse the shared confirm flow', () => {
  assert.match(autoBackup, /invoke<AutoBackupStatus>\('auto_backup_status'\)/);
  assert.match(dataManagement, /invoke<Inspected>\('inspect_auto_backup', \{ name \}\)/);
  assert.match(dataManagement, /<AutoBackup generation=\{generation\}/);
  // Restoring an automatic backup is the same replace flow as a manual one.
  assert.match(dataManagement, /确认替换当前资料/);
});

test('the switch reuses the shared control and restores are disabled like the manual button', () => {
  assert.match(autoBackup, /from '\.\/FormControls'/);
  assert.match(autoBackup, /<Switch label="自动备份"/);
  assert.match(autoBackup, /busy \|\| candidateOpen \|\| blocked \|\| demo \|\| !generation/);
});

test('the extra location offers change and cancel, and errors do not block the main backup', () => {
  assert.match(autoBackup, /'auto_backup_choose_extra'/);
  assert.match(autoBackup, /'auto_backup_clear_extra'/);
  assert.match(autoBackup, /'auto_backup_open_folder'/);
  assert.match(autoBackup, /已有备份保留，稍后自动重试/);
});

test('preview simulates the four automatic backup states', () => {
  const preview = readFileSync(new URL('../src/visual-preview.ts', import.meta.url), 'utf8');
  for (const state of ['never', 'ok', 'error', 'extra-error']) assert.ok(preview.includes(`'${state}'`), state);
  assert.match(preview, /autoBackupPreview\(command, args\)/);
  assert.match(preview, /\?autobackup=|params\.get\('autobackup'\)/);
});
