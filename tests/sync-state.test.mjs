import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lastSyncInfo, reconcileNotice, syncView } from '../src/sync/state.ts';
import { createSyncPreview, SYNC_PREVIEW_MODES } from '../src/sync/preview.ts';

const remote = (over = {}) => ({
  version: 7,
  deviceName: '虚构平板',
  createdAt: '2026-10-22T09:30:00Z',
  schemaVersion: 46,
  snapshotBytes: 4_800_000,
  slowSyncWarning: false,
  ...over,
});

const status = (state, over = {}) => ({
  state,
  local: { changed: false, schema: 46, empty: false, table_counts: { assets: 9 } },
  remote: state === 'unconfigured' ? null : remote(),
  ...over,
});

const actionIds = view => [
  ...(view.primaryAction ? [view.primaryAction.id] : []),
  ...view.secondaryActions.map(action => action.id),
];

test('every sync state has a headline, readable detail and a tone', () => {
  const cases = {
    unconfigured: '同步未开启',
    up_to_date: '已是最新',
    local_ahead: '本机有未上传的更改',
    remote_ahead: '云端有新版本',
    conflict: '本机与云端都有改动',
    empty_remote: '云端还没有同步资料',
  };
  for (const [state, headline] of Object.entries(cases)) {
    const view = syncView(status(state));
    assert.equal(view.headline, headline, state);
    assert.ok(view.detail.length > 0, state);
    assert.ok(['neutral', 'positive', 'attention', 'danger'].includes(view.tone), state);
    for (const action of [view.primaryAction, ...view.secondaryActions].filter(Boolean)) {
      assert.ok(action.label.length > 0, state);
    }
  }
  assert.equal(syncView(status('conflict')).blocking, true);
  assert.equal(syncView(status('up_to_date')).blocking, false);
  const idle = syncView(status('up_to_date')).primaryAction;
  assert.deepEqual([idle.id, idle.label, idle.destructive], ['reconcile', '检查云端', undefined], 'existing consumers retain their read-only action contract');
  assert.equal(syncView(status('local_ahead')).blocking, false);
});

test('conflict defaults to cancel; both overwrite actions are destructive and explain themselves', () => {
  const view = syncView(status('conflict'));
  assert.equal(view.primaryAction.id, 'cancel');
  assert.equal(view.primaryAction.destructive, undefined);
  assert.deepEqual(
    view.secondaryActions.map(action => [action.id, action.label, action.consequence, action.destructive]),
    [
      ['keep_local', '保留本机', '用本机资料覆盖云端；旧云端快照仍保留。', true],
      ['use_remote', '采用云端', '用云端快照覆盖本机；本机资料会先保存一份保护副本。', true],
    ],
  );
});

test('a result-unknown error is read-only reconciliation, never a blind retry', () => {
  const view = syncView(status('local_ahead'), { code: 'SYNC_RESULT_UNKNOWN' });
  assert.equal(view.headline, '上次同步结果未知');
  assert.equal(view.primaryAction.id, 'reconcile');
  assert.equal(view.primaryAction.label, '核对云端状态');
  assert.ok(!actionIds(view).includes('retry'));
  assert.ok(!actionIds(view).includes('sync'));
  assert.match(view.detail, /不要直接重试/);
  assert.equal(view.blocking, true);
});

test('a newer remote schema asks for an upgrade instead of transfer', () => {
  const view = syncView(status('remote_ahead'), { code: 'SYNC_SCHEMA_NEWER' });
  assert.equal(view.headline, '需要先升级应用');
  assert.equal(view.primaryAction.id, 'upgrade');
  assert.equal(view.primaryAction.label, '查看更新');
  assert.match(view.detail, /升级应用/);
  assert.match(view.detail, /本机资料不受影响/);
  assert.equal(view.blocking, true);
  assert.deepEqual(actionIds(view), ['upgrade']);
});

test('a push failure stays retryable and says the local library is unchanged', () => {
  const view = syncView(status('local_ahead'), {
    code: 'SYNC_NETWORK',
    message: '无法连接 WebDAV 服务器。',
  });
  assert.equal(view.headline, '推送失败');
  assert.equal(view.primaryAction.id, 'retry');
  assert.equal(view.primaryAction.label, '重试');
  assert.match(view.detail, /无法连接 WebDAV 服务器。/);
  assert.match(view.detail, /本机资料没有改变，可以重试。/);
  assert.equal(view.blocking, false);
  assert.equal(view.tone, 'danger');

  const pull = syncView(status('remote_ahead'), { code: 'SYNC_NETWORK' });
  assert.equal(pull.headline, '同步失败');
});

test('missing status and unavailable passphrase have their own safe views', () => {
  const unknown = syncView(null);
  assert.equal(unknown.headline, '无法读取同步状态');
  assert.equal(unknown.primaryAction.id, 'retry');
  assert.equal(unknown.primaryAction.label, '重新读取');

  const unconfigured = syncView(null, { code: 'SYNC_UNCONFIGURED' });
  assert.equal(unconfigured.headline, '同步未开启');

  const locked = syncView(status('local_ahead'), { code: 'SYNC_LOCKED' });
  assert.equal(locked.headline, '需要同步口令');
  assert.equal(locked.primaryAction.id, 'unlock');
  assert.equal(locked.blocking, true);
});

test('remote-ahead details name the device, version, size and the table counts step', () => {
  const view = syncView(status('remote_ahead'));
  assert.match(view.detail, /虚构平板/);
  assert.match(view.detail, /版本 7/);
  assert.match(view.detail, /各表数量/);
  assert.match(view.detail, /4\.6 MB/);
  assert.doesNotMatch(view.detail, /同步会变慢/);

  const slow = syncView(
    status('remote_ahead', { remote: remote({ slowSyncWarning: true }) }),
  );
  assert.match(slow.detail, /同步会变慢/);
});

test('each preview mode reports the matching status', async () => {
  const expected = {
    unconfigured: 'unconfigured',
    synced: 'up_to_date',
    local_ahead: 'local_ahead',
    remote_ahead: 'remote_ahead',
    conflict: 'conflict',
    push_error: 'local_ahead',
    unknown: 'conflict',
    unknown_not_landed: 'local_ahead',
    unknown_remote_changed: 'conflict',
    unknown_error: 'conflict',
    locked: 'local_ahead',
    schema_newer: null,
    unchecked: 'up_to_date',
  };
  assert.deepEqual(Object.keys(expected), [...SYNC_PREVIEW_MODES]);
  for (const [mode, state] of Object.entries(expected)) {
    const preview = createSyncPreview(mode);
    if (mode === 'schema_newer') {
      await assert.rejects(() => preview.command('sync_status'), error => error.code === 'SYNC_SCHEMA_NEWER');
      continue;
    }
    const result = await preview.command('sync_status', {});
    assert.equal(result.state, state, mode);
    const config = await preview.command('sync_config_get', {});
    assert.equal(config.enabled, mode !== 'unconfigured', mode);
    assert.equal(config.has_password, mode !== 'unconfigured', mode);
    assert.equal('password' in config, false, 'the preview never exposes a password');
    if (mode === 'unconfigured') {
      assert.deepEqual(result.local.table_counts, {});
      assert.equal(result.remote, null);
    } else {
      assert.equal(result.local.schema, 46);
      assert.ok(result.remote, mode);
    }
  }
});

test('reconciliation settles all four outcomes without uploading a new cloud version', async () => {
  for (const [mode, outcome, nextState] of [
    ['unknown', 'landed', 'up_to_date'],
    ['unknown_not_landed', 'not_landed', 'local_ahead'],
    ['unknown_remote_changed', 'remote_changed', 'conflict'],
    ['synced', 'nothing_pending', 'up_to_date'],
  ]) {
    const preview = createSyncPreview(mode);
    const before = await preview.command('sync_status');
    const result = await preview.command('sync_reconcile');
    assert.equal(result.outcome, outcome);
    assert.ok(reconcileNotice(result).length > 0);
    assert.equal((await preview.command('sync_config_get')).has_pending_push, false);
    const after = await preview.command('sync_status');
    assert.equal(after.state, nextState);
    assert.equal(after.remote.version, before.remote.version, 'read-only reconciliation never increments the cloud version');
  }
  assert.equal(reconcileNotice({ outcome: 'landed', version: 8 }), '已确认上次同步成功（版本 8）');
  assert.match(reconcileNotice({ outcome: 'not_landed', version: null }), /本机更改仍在，可以重新同步/);
  assert.match(reconcileNotice({ outcome: 'remote_changed', version: 9 }), /请按冲突处理/);
  const failed = createSyncPreview('unknown_error');
  await assert.rejects(() => failed.command('sync_reconcile'), error => error.code === 'SYNC_NETWORK');
  assert.equal((await failed.command('sync_config_get')).has_pending_push, true);
});

test('locked preview refuses a wrong passphrase and accepts preview-pass', async () => {
  const preview = createSyncPreview('locked');
  await assert.rejects(() => preview.command('sync_push'), error => error.code === 'SYNC_LOCKED');
  await assert.rejects(() => preview.command('sync_unlock', { input: { passphrase: 'wrong' } }), error => error.code === 'SYNC_PASSPHRASE');
  await assert.rejects(() => preview.command('sync_push'), error => error.code === 'SYNC_LOCKED');
  await preview.command('sync_unlock', { input: { passphrase: 'preview-pass' } });
  assert.deepEqual(await preview.command('sync_push'), { version: 8 });
});

test('last sync info uses the saved baseline and never invents a device or zero version', async () => {
  const preview = createSyncPreview('synced');
  const config = await preview.command('sync_config_get');
  const current = await preview.command('sync_status');
  const info = lastSyncInfo(config, current);
  assert.ok(info.time.length > 0);
  assert.equal(info.version, '7');
  assert.equal(info.device, '虚构平板');
  assert.equal(lastSyncInfo(config, null).device, '虚构 MacBook', 'offline uses the locally configured device name');
  assert.equal(lastSyncInfo(config, { ...current, remote: remote({ version: 8, deviceName: '新设备' }) }).device, '虚构 MacBook', 'never attributes a newer cloud version to the saved baseline');
  assert.deepEqual(lastSyncInfo({ ...config, last_synced_at: null, last_synced_remote_version: null }, null), { time: '尚未同步', version: '尚未同步', device: '尚未同步' });
  assert.deepEqual(lastSyncInfo({ ...config, last_synced_at: 'invalid', last_synced_remote_version: 0 }, current), { time: '尚未同步', version: '尚未同步', device: '尚未同步' });
});

test('configured but unchecked is neutral, while an outstanding push remains read-only', async () => {
  const config = await createSyncPreview('synced').command('sync_config_get');
  const view = syncView(null, null, config);
  assert.equal(view.headline, '尚未检查云端');
  assert.equal(view.tone, 'neutral');
  assert.deepEqual(actionIds(view), ['sync', 'check']);
  assert.equal(view.primaryAction.label, '立即同步');
  assert.equal(syncView(status('up_to_date'), null, config).primaryAction.id, 'check');
  assert.match(view.detail, /打开页面和保存设置不会联网/);
  assert.equal(syncView(null, null, { ...config, enabled: false }).headline, '同步未开启');
  assert.deepEqual(actionIds(syncView(null, null, { ...config, has_pending_push: true })), ['reconcile']);
});

test('disable can retain or forget credentials and returns an unconfigured preview', async () => {
  for (const forgetCredentials of [false, true]) {
    const preview = createSyncPreview('synced');
    const before = await preview.command('sync_config_get');
    await preview.command('sync_disable', { input: { forgetCredentials } });
    const config = await preview.command('sync_config_get');
    assert.equal(config.enabled, false);
    assert.equal(config.has_password, !forgetCredentials);
    assert.equal(config.base_url, forgetCredentials ? '' : before.base_url);
    assert.equal(config.device_name, before.device_name);
    const after = await preview.command('sync_status');
    assert.equal(after.state, 'unconfigured');
    assert.equal(after.remote, null);
    await assert.rejects(() => preview.command('sync_test_connection'), error => error.code === 'SYNC_UNCONFIGURED');
  }
});

test('the preview push fixture fails in the requested mode only', async () => {
  const pushError = createSyncPreview('push_error');
  await assert.rejects(
    () => pushError.command('sync_push', {}),
    error => error.code === 'SYNC_NETWORK' && /虚构 WebDAV 连接失败/.test(error.message),
  );
  await assert.rejects(
    () => createSyncPreview('unknown').command('sync_push', {}),
    error => error.code === 'SYNC_RESULT_UNKNOWN',
  );
  assert.equal(
    (await createSyncPreview('unknown').command('sync_config_get', {})).has_pending_push,
    true,
  );

  const synced = createSyncPreview('synced');
  await assert.rejects(
    () => synced.command('sync_push', {}),
    error => error.code === 'SYNC_DIRECTION',
  );
});

test('configuring an empty preview leads to the first push, then up to date', async () => {
  const preview = createSyncPreview('unconfigured');
  await preview.command('sync_config_set', {
    input: {
      baseUrl: 'https://dav.example.com/remote.php/dav/files/preview/',
      username: 'preview',
      password: 'fictional-app-password',
      basePath: '/ThingaryPreview/',
      deviceName: '虚构 MacBook',
    },
  });
  const configured = await preview.command('sync_config_get', {});
  assert.equal(configured.enabled, true);
  assert.equal(configured.base_url, 'https://dav.example.com/remote.php/dav/files/preview');
  assert.equal(configured.base_path, 'ThingaryPreview');
  assert.equal((await preview.command('sync_status', {})).state, 'empty_remote');

  assert.deepEqual(await preview.command('sync_push', {}), { version: 1 });
  const after = await preview.command('sync_status', {});
  assert.equal(after.state, 'up_to_date');
  assert.equal(after.remote.version, 1);

  await preview.command('sync_disable', { input: { forgetCredentials: true } });
  assert.equal((await preview.command('sync_status', {})).state, 'unconfigured');
  const forgotten = await preview.command('sync_config_get', {});
  assert.equal(forgotten.has_password, false);
  assert.equal(forgotten.base_url, '');
});

test('remote-ahead preview inspects before restoring and conflict keeps local on request', async () => {
  const pull = createSyncPreview('remote_ahead');
  const inspected = await pull.command('sync_pull_inspect', {});
  assert.equal(inspected.token, 'preview-sync-token');
  assert.equal(inspected.version, 8);
  assert.equal(inspected.summary.assets, 9);
  assert.equal(inspected.device_name, '虚构平板');

  const conflict = createSyncPreview('conflict');
  const remoteChoice = await conflict.command('sync_resolve_conflict', {
    input: { choice: 'use_remote' },
  });
  assert.equal(remoteChoice.token, 'preview-sync-token');
  const keep = createSyncPreview('conflict');
  assert.deepEqual(
    await keep.command('sync_resolve_conflict', { input: { choice: 'keep_local' } }),
    { version: 9 },
  );
  assert.equal((await keep.command('sync_status', {})).state, 'up_to_date');
});

test('preview IPC routes sync commands from the ?sync= fixture', () => {
  const ipc = readFileSync(new URL('../src/preview-ipc.ts', import.meta.url), 'utf8');
  assert.match(ipc, /createSyncPreview\(params\.get\('sync'\)\)/);
  assert.match(ipc, /command\.startsWith\('sync_'\)/);
});

test('the command wrappers keep the Rust field names, not the design draft', () => {
  const api = readFileSync(new URL('../src/sync/api.ts', import.meta.url), 'utf8');
  for (const command of [
    'sync_config_get',
    'sync_config_set',
    'sync_test_connection',
    'sync_disable',
    'sync_status',
    'sync_unlock',
    'sync_push',
    'sync_reconcile',
    'sync_pull_inspect',
    'sync_resolve_conflict',
  ]) {
    assert.ok(api.includes(`'${command}'`), command);
  }
  assert.match(api, /base_path: string/);
  assert.match(api, /table_counts: Record<string, number>/);
  assert.match(api, /deviceName: string/);
  assert.match(api, /schemaVersion: number/);
  assert.match(api, /snapshotBytes: number/);
  assert.match(api, /slowSyncWarning: boolean/);
  assert.match(api, /device_name: string/);
});
