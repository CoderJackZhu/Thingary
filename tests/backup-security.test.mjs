import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstBackupSummary, looksLikeRecoveryKey, pauseNotice, securitySummary, STATE_LABELS } from '../src/backup-security-format.ts';

const status = over => ({
  state: 'enabled', reason: null, paused: false, recipient_id: 'a1b2c3d4'.repeat(8), recipient_short: 'a1b2c3d4',
  verified_at: '2026-10-15T10:00:00+08:00', changed_at: '2026-10-15T10:00:00+08:00', first_backup: null, setup_active: false, ...over,
});

test('every policy state has a label and a readable summary', () => {
  for (const state of ['unconfigured', 'disabled', 'enabled', 'needs_attention', 'restore_review_required']) {
    const line = securitySummary(status({ state, paused: state !== 'disabled' && state !== 'enabled' }));
    assert.ok(line.length > 0, state);
    assert.ok(STATE_LABELS[state].length > 0);
  }
});

test('the enabled line shows the short key id and the independent first-backup outcome', () => {
  const at = new Date(2026, 9, 15, 10, 5).toISOString();
  const line = securitySummary(status({ first_backup: { state: 'success', at } }));
  assert.ok(line.includes('a1b2c3d4'), line);
  assert.ok(line.includes('首份加密备份：成功'), line);
  assert.ok(!line.includes('a1b2c3d4a1'), 'only the short form is shown');
  assert.equal(firstBackupSummary({ state: 'waiting' }), '首份加密备份：等待');
  assert.equal(firstBackupSummary(null), '首份加密备份：无记录');
  const failed = firstBackupSummary({ state: 'failed', at, message: '磁盘已满' });
  assert.ok(failed.includes('失败') && failed.includes('磁盘已满'), failed);
});

test('pause notices explain why and never claim a backup happened', () => {
  assert.ok(pauseNotice(status({ state: 'unconfigured', paused: true })).includes('等待备份安全设置确认'));
  assert.ok(pauseNotice(status({ state: 'needs_attention', paused: true, reason: '安全配置不是有效的格式' })).includes('安全配置不是有效的格式'));
  assert.ok(pauseNotice(status({ state: 'restore_review_required', paused: true })).includes('刚从加密备份恢复'));
  assert.equal(pauseNotice(status()), null);
  assert.equal(pauseNotice(null), null);
});

test('recovery-key prechecks mirror the backend strictness', () => {
  assert.equal(looksLikeRecoveryKey('AGE-SECRET-KEY-1ABC').ok, true);
  assert.equal(looksLikeRecoveryKey('# comment\n\nAGE-SECRET-KEY-1ABC\n').ok, true);
  const two = looksLikeRecoveryKey('AGE-SECRET-KEY-1A\nAGE-SECRET-KEY-1B');
  assert.equal(two.ok, false);
  assert.ok(two.reason.includes('多个身份'));
  assert.equal(looksLikeRecoveryKey('AGE-PLUGIN-QUIRK-1X').ok, false);
  assert.equal(looksLikeRecoveryKey('').ok, false);
  assert.equal(looksLikeRecoveryKey('# only comments').ok, false);
  assert.equal(looksLikeRecoveryKey(`# ${'x'.repeat(70_000)}`).ok, false);
});

const dataManagement = readFileSync(new URL('../src/DataManagement.tsx', import.meta.url), 'utf8');
const securityPanel = readFileSync(new URL('../src/BackupSecurity.tsx', import.meta.url), 'utf8');
const autoBackup = readFileSync(new URL('../src/AutoBackup.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/preview-ipc.ts', import.meta.url), 'utf8');

test('encrypted restore goes through unlock then the session token, never a path', () => {
  assert.match(dataManagement, /'unlock_backup_session', \{ token: candidate\.token, keyText: unlockKey, taskId \}/);
  assert.match(dataManagement, /'restore_backup_session', \{ token: candidate\.token \}/);
  assert.match(dataManagement, /'cancel_backup_session', \{ token \}/);
  assert.doesNotMatch(dataManagement, /'restore_backup', \{ path: candidate\.path/);
});

test('the restore confirmation discloses local plaintext copies', () => {
  assert.match(dataManagement, /RESTORE_DISCLOSURE/);
  assert.match(readFileSync(new URL('../src/backup-security-format.ts', import.meta.url), 'utf8'), /未加密的保护副本/);
});

test('the security panel wires every policy action to its backend command', () => {
  assert.match(securityPanel, /'backup_security_status'/);
  assert.match(securityPanel, /'backup_security_choose_plaintext'/);
  assert.match(securityPanel, /'backup_security_begin_setup'/);
  assert.match(securityPanel, /'backup_security_confirm_setup'/);
  assert.match(securityPanel, /'backup_security_cancel_setup'/);
  assert.match(securityPanel, /'backup_security_export_key'/);
  assert.match(securityPanel, /'backup_security_disable'/);
  assert.match(securityPanel, /'backup_security_enable_from_key'/);
  // The one-time key is shown once and only the re-entered text goes back.
  assert.match(securityPanel, /setup\.recovery_key/);
  assert.match(securityPanel, /只显示一次/);
});

test('manual export follows the policy and offers the explicit plaintext exception', () => {
  assert.match(dataManagement, /'create_backup', \{ forcePlaintext, taskId \}/);
  assert.match(dataManagement, /导出未加密副本/);
  assert.match(dataManagement, /security\?\.state === 'enabled'/);
});

test('the automatic block surfaces the pause and marks encrypted archives', () => {
  assert.match(autoBackup, /paused\?: boolean/);
  assert.match(autoBackup, /item\.name\.endsWith\('\.thingary\.age'\)/);
  assert.match(autoBackup, /等待备份安全设置确认/);
});

test('preview simulates the security states without touching real files', () => {
  for (const state of ['disabled', 'enabled', 'needs_attention', 'restore_review_required', 'enabled-waiting', 'enabled-failed']) {
    assert.ok(preview.includes(`'${state}'`), state);
  }
  assert.match(preview, /backupSecurityPreview\(command, args\)/);
  assert.match(preview, /'backup_security_status'/);
  assert.match(preview, /PREVIEWFICTIONAL/);
  assert.match(preview, /物谱自动备份-\\d\{4\}-\\d\{2\}-\\d\{2\}\(-\\d\{4\}-\[0-9a-f\]\{6\}\)\?\\\.thingary\(\\\.age\)\?/);
});
