import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncView } from '../src/sync/state.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const src = read('../src/sync/SyncSettings.tsx');
const data = read('../src/DataManagement.tsx');

const remote = {
  version: 8,
  deviceName: '虚构平板',
  createdAt: '2026-10-22T09:30:00Z',
  schemaVersion: 46,
  snapshotBytes: 4_800_000,
  slowSyncWarning: false,
};

test('sync is off by default and the connection form is always available', () => {
  assert.match(src, /只在你点同步时联网，只连接你自己的 WebDAV，服务器只看到加密数据。/);
  for (const label of ['地址', '用户名', '应用密码', '路径', '设备名']) {
    assert.ok(src.includes(`label="${label}"`), `missing form label: ${label}`);
  }
  assert.match(src, /测试连接/);
  assert.match(src, /保存/);
  assert.match(src, /syncConfigSet/);
  assert.match(src, /syncTestConnection/);
});

test('the WebDAV password is a password field, never prefilled and never stored', () => {
  assert.match(src, /<input type="password" autoComplete="off"/);
  assert.match(src, /value=\{form\.password\}/);
  assert.match(src, /placeholder=\{config\?\.has_password \? '已保存' : '请输入应用密码'\}/);
  // The form starts blank and the saved config only carries has_password.
  assert.match(src, /password: ''/);
  assert.doesNotMatch(src, /form\.password\s*=\s*config|password: config/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});

test('destructive actions follow the default action and are never auto-focused', () => {
  const primary = src.indexOf('...(view.primaryAction ? [view.primaryAction] : [])');
  const secondary = src.indexOf('...view.secondaryActions');
  assert.ok(primary > -1 && secondary > primary, 'default action must be rendered before secondary actions');
  assert.match(src, /action\.destructive \? 'danger'/);
  assert.match(src, /className=\{\[action\.id === 'cancel' \|\| action\.destructive \? '' : 'primary'/);
  assert.doesNotMatch(src, /action\.destructive \? 'primary danger'/);
  assert.doesNotMatch(src, /autoFocus/);
});

test('a conflict offers cancel, keep local and use cloud in that order', () => {
  const view = syncView({
    state: 'conflict',
    local: { changed: true, schema: 46, empty: false, table_counts: {} },
    remote,
  });
  const labels = [view.primaryAction.label, ...view.secondaryActions.map(action => action.label)];
  assert.deepEqual(labels, ['取消', '保留本机', '采用云端']);
  assert.deepEqual(view.secondaryActions.map(action => action.destructive), [true, true]);
  assert.match(src, /syncView\(status, error, config\)/);
  assert.match(src, /syncResolveConflict\(choice\)/);
  assert.match(src, /'keep_local'/);
  assert.match(src, /'use_remote'/);
});

test('the passphrase dialog asks twice on first setup and states the forgotten-passphrase consequence', () => {
  assert.match(src, /<dialog/);
  assert.match(src, /syncUnlock\(passphrase, remember\)/);
  assert.match(src, /忘记口令后云端副本无法恢复，本机资料不受影响。/);
  assert.match(src, /再次输入同步口令/);
  assert.match(src, /firstTime/);
  assert.match(src, /两次输入的口令不一致。/);
  assert.match(src, /type="password" autoComplete="off"/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});

test('a pulled cloud snapshot uses the existing backup restore session, not new restore logic', () => {
  assert.match(src, /syncPullInspect\(\)/);
  assert.match(src, /onPull\(inspection\)/);
  assert.doesNotMatch(src, /restore_backup_session/);
  // The token is handed to DataManagement, whose existing confirmation consumes it.
  assert.match(data, /import \{ SyncSettings \} from '\.\/sync\/SyncSettings'/);
  assert.match(data, /<SyncSettings blocked=\{operationLocked \|\| blocked \|\| demo \|\| !generation\} onPull=\{inspectSync\}\/>/);
  assert.match(data, /invoke<string>\('restore_backup_session', \{ token: candidate\.token \}\)/);
  assert.equal(data.match(/restore_backup_session/g)?.length, 1);
  assert.match(data, /candidateRef\.current = found; setCandidate\(found\)/);
});

test('a result-unknown state only reconciles read-only, never retries blindly', () => {
  const unknown = syncView({
    state: 'local_ahead',
    local: { changed: true, schema: 46, empty: false, table_counts: {} },
    remote,
  }, { code: 'SYNC_RESULT_UNKNOWN' });
  assert.equal(unknown.primaryAction.id, 'reconcile');
  assert.equal(unknown.secondaryActions.length, 0);
  assert.doesNotMatch(src, /id: 'reconcile'[\s\S]*syncPush/);
  const reconcile = src.slice(src.indexOf('async function reconcile'), src.indexOf('async function resolve'));
  assert.match(reconcile, /refreshStatus\(\)/);
  assert.match(reconcile, /await syncReconcile\(\)/);
  assert.match(reconcile, /reconcileNotice\(result\)/);
  assert.doesNotMatch(reconcile, /await syncStatus\(/);
  assert.doesNotMatch(reconcile, /syncPush|syncPullInspect|syncResolveConflict/);
});

test('sync actions are driven by the shared view model and disabled while busy', () => {
  assert.match(src, /const view = syncView\(status, error, config\)/);
  assert.match(src, /const disabled = busy !== null \|\| blocked/);
  assert.match(src, /disabled=\{disabled\}/);
  assert.match(src, /if \(next\.state === 'local_ahead' \|\| next\.state === 'empty_remote'\) \{[\s\S]*syncPush\(\)/);
  assert.match(src, /else if \(next\.state === 'remote_ahead'\) \{[\s\S]*pullSnapshot\(\)/);
  // Errors keep their message inline instead of a toast.
  assert.match(src, /role="alert">\{error\.message\}/);
});
