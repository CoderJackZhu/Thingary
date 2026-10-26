import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSyncPreview } from '../src/sync/preview.ts';
import { syncView } from '../src/sync/state.ts';
import { syncCandidateParam, syncRestoreCandidate } from '../src/mobile/me/settings/sync-candidate.ts';
import { isSettingsPage, settingsTitles } from '../src/mobile/me/model.ts';
import { initialNav, navReducer, topEntry } from '../src/mobile/nav.ts';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const page = read('src/mobile/me/settings/Sync.tsx');
const shared = read('src/sync/SyncSettings.tsx');
const data = read('src/mobile/me/Data.tsx');
const preview = read('src/mobile/preview.ts');
const pull = () => createSyncPreview('remote_ahead').command('sync_pull_inspect');

test('a sync inspection crosses the primitive route boundary and becomes the existing restore candidate', async () => {
  const inspection = await pull();
  const param = syncCandidateParam(inspection);
  assert.equal(typeof param, 'string');
  assert.deepEqual(JSON.parse(param), inspection);
  const nav = navReducer(initialNav('me', 'me.home'), { type: 'push', route: 'me.data', params: { syncCandidate: param } });
  const candidate = syncRestoreCandidate(topEntry(nav).params.syncCandidate);
  assert.equal(candidate.token, inspection.token);
  assert.deepEqual(candidate.summary, inspection.summary);
  assert.equal(candidate.encrypted, false);
  assert.equal(candidate.path, '');
  assert.equal(candidate.name, '云端快照（虚构平板）');
  assert.match(page, /nav\.push\('me\.data', \{ syncCandidate \}/);
});

test('no route parameter or an invalid one leaves the original null candidate alone', async () => {
  const inspection = await pull();
  for (const value of [undefined, null, '', 12, true, {}, 'null', '[]', '{}', '{', JSON.stringify(inspection).repeat(100)]) {
    assert.equal(syncRestoreCandidate(value), null);
  }
  // Candidate initialization is additive and guarded; the default state and the file picker stay intact.
  assert.match(data, /\[candidate, setCandidate\] = useState<Inspected \| null>\(null\)/);
  assert.match(data, /useEffect\(\(\) => \{\s*const found = syncRestoreCandidate\(params\.syncCandidate\);\s*if \(found\) \{ candidateRef\.current = found; setCandidate\(found\); \}\s*\}, \[\]\)/);
  assert.match(data, /const found = await task\.withTask\(taskId => pickBackupFile\(taskId\)\)/);
});

test('invalid inspection metadata and incomplete/unknown counts cannot open a restore confirmation', async () => {
  const inspection = await pull();
  for (const patch of [{ token: '' }, { token: null }, { version: -1 }, { version: 0 }, { version: 1.5 }, { device_name: 3 }, { created_at: 'invalid' }, { summary: null }]) {
    assert.equal(syncRestoreCandidate(JSON.stringify({ ...inspection, ...patch })), null, JSON.stringify(patch));
  }
  for (const patch of [{ assets: null }, { accounts: -1 }, { files: 1.1 }, { hash: '' }, { schema: 0 }, { created_at: '' }, { planning_conditions_reset: 'yes' }, { cash_movements: -1 }]) {
    assert.equal(syncRestoreCandidate(JSON.stringify({ ...inspection, summary: { ...inspection.summary, ...patch } })), null, JSON.stringify(patch));
  }
  assert.equal(syncCandidateParam({ ...inspection, summary: null }), null);
});

test('zero counts and an unnamed device are valid; routing does not add persistence or credentials', async () => {
  const inspection = await pull();
  const summary = { ...inspection.summary, assets: 0, accounts: 0, snapshots: 0, files: 0 };
  const encoded = syncCandidateParam({ ...inspection, device_name: '', summary, password: 'not-route-data' });
  assert.equal(syncRestoreCandidate(encoded).name, '云端同步快照');
  assert.equal(syncRestoreCandidate(encoded).summary.accounts, 0);
  assert.ok(!encoded.includes('not-route-data'));
  assert.doesNotMatch(page + read('src/mobile/me/settings/sync-candidate.ts'), /localStorage|sessionStorage|restore_backup_session/);
});

test('the shared sync screen is reused, and all restore/unknown/cancel/cleanup operations remain in Data', () => {
  assert.match(page, /import \{ SyncSettings \} from '\.\.\/\.\.\/\.\.\/sync\/SyncSettings'/);
  assert.match(page, /<SyncSettings blocked=\{blocked\} onPull=\{inspectSync\}\/>/);
  assert.doesNotMatch(page, /syncPush\(|syncResolveConflict\(|syncStatus\(|syncUnlock\(/);
  assert.equal(data.match(/'restore_backup_session'/g)?.length, 1);
  assert.match(data, /invoke<string>\('restore_backup_session', \{ token: candidate\.token \}\)/);
  assert.match(data, /invoke<string \| null>\('backup_session_result', \{ token: candidate\.token \}\)/);
  assert.match(data, /if \(restoreUnknown \|\| restoreLock\.current\) return/);
  assert.match(data, /cancel_backup_session/);
  assert.match(data, /restoreClearKeys\(localKeys\(\)\)/);
  assert.match(data, /candidate && !candidate\.encrypted && candidate\.summary && <Sheet/);
});

test('sync registers as a standard me.settings subpage with one data-management entry', () => {
  assert.equal(isSettingsPage('sync'), true);
  assert.equal(settingsTitles.sync, '同步');
  assert.equal(isSettingsPage('syncCandidate'), false);
  assert.match(read('src/mobile/me/Settings.tsx'), /sync: lazy\(\(\) => import\('\.\/settings\/Sync'\)\)/);
  assert.equal(data.match(/page: 'sync'/g)?.length, 1);
  assert.match(data, /disabled=\{locked\} onClick=\{\(\) => nav\.push\('me\.settings', \{ page: 'sync' \}/);
});

test('conflict defaults to cancel before both destructive buttons with explicit consequences', async () => {
  const state = await createSyncPreview('conflict').command('sync_status');
  const view = syncView(state);
  assert.equal(view.primaryAction.id, 'cancel');
  assert.equal(view.primaryAction.destructive, undefined);
  assert.deepEqual(view.secondaryActions.map(a => [a.id, a.destructive]), [['compare', undefined], ['keep_local', true], ['use_remote', true]]);
  assert.match(view.secondaryActions[1].consequence, /覆盖云端/);
  assert.match(view.secondaryActions[2].consequence, /保护副本/);
  assert.match(shared, /\.\.\.\(view\.primaryAction \? \[view\.primaryAction\] : \[\]\), \.\.\.view\.secondaryActions/);
  assert.match(shared, /action\.destructive \? 'danger'/);
  assert.doesNotMatch(page + shared, /autoFocus/);
});

test('password and passphrase stay blank, masked and out of storage; forgotten-passphrase warning is visible', () => {
  assert.match(shared, /password: ''/);
  assert.doesNotMatch(shared, /password: config|localStorage|sessionStorage/);
  assert.match(shared, /type="password" autoComplete="off"/);
  assert.match(shared, /忘记口令后云端副本无法恢复，本机资料不受影响。/);
  assert.match(shared, /firstTime && <label/);
  assert.match(shared, /两次输入的口令不一致。/);
});

test('unknown results offer only read-only reconciliation; schema-incompatible data requires an upgrade', async () => {
  const status = await createSyncPreview('unknown').command('sync_status');
  const unknown = syncView(status, { code: 'SYNC_RESULT_UNKNOWN' });
  assert.equal(unknown.primaryAction.id, 'reconcile');
  assert.equal(unknown.secondaryActions.length, 0);
  const synced = syncView({ ...status, state: 'up_to_date' });
  assert.equal(synced.primaryAction.label, '检查云端');
  assert.equal(synced.primaryAction.id, 'reconcile');
  const schema = syncView(status, { code: 'SYNC_SCHEMA_NEWER' });
  assert.match(schema.detail, /先升级应用/);
  assert.ok(![schema.primaryAction, ...schema.secondaryActions].some(a => a.id === 'sync' || a.id === 'pull'));
});

test('all seven mobile preview modes use the existing fictional sync implementation', async () => {
  assert.match(preview, /const value = await handle\(command, args\)/);
  assert.match(preview, /createSyncPreview\(params\.get\('sync'\)\)/);
  assert.match(preview, /command\.startsWith\('sync_'\).*syncPreview\.command/);
  assert.match(preview, /params\.has\('sync'\).*'me\.settings'/);
  assert.match(preview, /routeParams\.page = 'sync'/);
  for (const mode of ['unconfigured', 'synced', 'local_ahead', 'remote_ahead', 'conflict', 'push_error', 'unknown']) {
    const mock = createSyncPreview(mode);
    assert.equal(mock.mode, mode);
    assert.ok((await mock.command('sync_status')).state);
    assert.equal('password' in await mock.command('sync_config_get'), false);
  }
});

test('mobile styles keep touch targets, inputs and dialogs within the existing viewport tokens', () => {
  const css = read('src/mobile/me/settings/sync.css');
  assert.match(css, /min-height:var\(--m-touch\)/);
  assert.match(css, /font-size:16px/);
  assert.match(css, /--m-viewport-height/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /\.sync-actions[^}]*\border\s*:/);
});
