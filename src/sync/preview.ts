// Browser-preview stand-in for the sync commands. Fictional and in-memory only:
// no WebDAV, no passphrase and no file is ever created. The desktop/mobile
// previews pick a scenario with ?sync=unconfigured|synced|local_ahead|
// remote_ahead|conflict|push_error|unknown|locked|schema_newer.
import { t as tr } from '../i18n.ts';
import type { SyncSettingsPreview } from './preview-state.ts';
import type {
  SyncBackupSummary,
  SyncPublicConfig,
  SyncPullInspection,
  SyncPushResult,
  SyncRemoteStatus,
  SyncState,
  SyncStatusResult,
} from './api.ts';

export const SYNC_PREVIEW_MODES = [
  'unconfigured',
  'synced',
  'local_ahead',
  'remote_ahead',
  'conflict',
  'push_error',
  'unknown',
  'unknown_not_landed',
  'unknown_remote_changed',
  'unknown_error',
  'locked',
  'schema_newer',
  'unchecked',
] as const;

export type SyncPreviewMode = (typeof SYNC_PREVIEW_MODES)[number];

const modeOf = (mode: string | null): SyncPreviewMode =>
  SYNC_PREVIEW_MODES.includes(mode as SyncPreviewMode)
    ? (mode as SyncPreviewMode)
    : 'unconfigured';

const SCHEMA = 46;
const SNAPSHOT_BYTES = 4_800_000;
const tableCounts: Record<string, number> = {
  assets: 9,
  wishes: 2,
  maintenances: 3,
  warranties: 4,
  accounts: 2,
  snapshots: 6,
  expenses: 5,
  plans: 2,
  payments: 12,
  virtual_assets: 3,
  files: 11,
};

const when = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60000).toISOString();

const backupSummary = (): SyncBackupSummary => ({
  hash: 'preview-fixture',
  created_at: when(90),
  schema: SCHEMA,
  assets: 9,
  deleted_assets: 0,
  wishes: 2,
  maintenances: 3,
  warranties: 4,
  accounts: 2,
  savings_goals: 1,
  snapshots: 6,
  expenses: 5,
  plans: 2,
  payments: 12,
  virtual_assets: 3,
  virtual_topups: 4,
  link_groups: 1,
  cash_movements: 2,
  investment_reviews: 1,
  assumption_checks: 1,
  import_mappings: 1,
  import_receipts: 1,
  files: 11,
  planning_conditions_reset: false,
});

const unconfiguredError = { code: 'SYNC_UNCONFIGURED', message: tr('请先配置 WebDAV 同步') };

/** One fictional sync scenario with the same command names as the Rust layer. */
export function createSyncPreview(mode: string | null) {
  const selected = modeOf(mode);
  const numericMode = ['remote_ahead', 'conflict'].includes(selected);

  let enabled = selected !== 'unconfigured';
  let baseUrl = enabled ? 'https://dav.example.com/remote.php/dav/files/preview' : '';
  let username = enabled ? 'preview' : '';
  let basePath = enabled ? 'ThingaryPreview' : '';
  let deviceName = '虚构 MacBook';
  let hasPassword = enabled;
  let localEmpty = !enabled;
  let localChanged = ['local_ahead', 'conflict', 'push_error', 'locked'].includes(selected) || selected.startsWith('unknown');
  let remoteVersion: number | null = enabled ? (numericMode ? 8 : 7) : null;
  if (selected === 'unknown' || selected === 'unknown_error') remoteVersion = 8;
  if (selected === 'unknown_remote_changed') remoteVersion = 9;
  let lastSyncedVersion: number | null = enabled ? 7 : null;
  let lastSyncedAt: string | null = enabled ? when(90) : null;
  let pending = selected.startsWith('unknown');
  let unlocked = selected !== 'locked';
  let remembered = false;
  let autoCheck = true;
  let rememberedValue = '';
  let remoteDeviceName = '虚构平板';
  let remoteCreatedAt = when(numericMode ? 12 : 90);

  const remoteStatus = (): SyncRemoteStatus | null =>
    remoteVersion === null
      ? null
      : {
          version: remoteVersion,
          deviceName: remoteDeviceName,
          createdAt: remoteCreatedAt,
          schemaVersion: selected === 'schema_newer' ? SCHEMA + 1 : SCHEMA,
          snapshotBytes: SNAPSHOT_BYTES,
          slowSyncWarning: false,
        };

  const state = (): SyncState => {
    if (!enabled) return 'unconfigured';
    if (remoteVersion === null) return localEmpty ? 'up_to_date' : 'empty_remote';
    const remoteChanged =
      lastSyncedVersion === null ? true : remoteVersion !== lastSyncedVersion;
    if (remoteChanged) return localChanged ? 'conflict' : 'remote_ahead';
    return localChanged ? 'local_ahead' : 'up_to_date';
  };

  const status = (): SyncStatusResult => ({
    state: state(),
    local: {
      changed: localChanged,
      schema: SCHEMA,
      empty: localEmpty,
      table_counts: localEmpty ? {} : { ...tableCounts },
    },
    remote: enabled ? remoteStatus() : null,
  });

  const config = (): SyncPublicConfig => ({
    enabled,
    base_url: baseUrl,
    username,
    base_path: basePath,
    device_id: 'preview-sync-device',
    device_name: deviceName,
    has_password: hasPassword,
    last_synced_remote_version: lastSyncedVersion,
    last_synced_at: lastSyncedAt,
    has_pending_push: pending,
    has_remembered_passphrase: remembered,
    auto_check: autoCheck,
  });

  const inspection = (): SyncPullInspection => {
    const remote = remoteStatus()!;
    return {
      token: 'preview-sync-token',
      summary: backupSummary(),
      version: remote.version,
      device_name: remote.deviceName,
      created_at: remote.createdAt,
    };
  };

  // Successful upload: the snapshot and manifest are accepted, so the local
  // baseline moves to the new remote version.
  const commitPush = (): SyncPushResult => {
    remoteVersion = (remoteVersion ?? 0) + 1;
    lastSyncedVersion = remoteVersion;
    lastSyncedAt = new Date().toISOString();
    remoteDeviceName = deviceName;
    remoteCreatedAt = lastSyncedAt;
    localChanged = false;
    localEmpty = false;
    pending = false;
    return { version: remoteVersion };
  };

  const command = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    switch (name) {
      case 'sync_config_get':
        return config();
      case 'sync_config_set': {
        const input = (args.input ?? {}) as {
          baseUrl?: string;
          username?: string;
          password?: string;
          basePath?: string;
          deviceName?: string;
        };
        const nextUrl = (input.baseUrl ?? '').trim().replace(/\/+$/, '');
        const nextUser = (input.username ?? '').trim();
        const nextPath = (input.basePath ?? '').trim().replace(/^\/+|\/+$/g, '');
        const nextDevice = (input.deviceName ?? '').trim();
        if (!nextUrl || !nextUser || !nextDevice)
          throw { code: 'SYNC_CONFIG', message: tr('请完整填写 WebDAV 同步设置') };
        if (input.password === '')
          throw { code: 'SYNC_CONFIG', message: tr('应用密码不能为空') };
        if (!hasPassword && !input.password)
          throw { code: 'SYNC_CONFIG', message: tr('请填写 WebDAV 应用密码') };
        const endpointChanged =
          nextUrl !== baseUrl || nextUser !== username || nextPath !== basePath;
        enabled = true;
        baseUrl = nextUrl;
        username = nextUser;
        basePath = nextPath;
        deviceName = nextDevice;
        if (input.password) hasPassword = true;
        localEmpty = false;
        if (endpointChanged) {
          remoteVersion = null;
          lastSyncedVersion = null;
          lastSyncedAt = null;
          pending = false;
          localChanged = true;
        }
        return null;
      }
      case 'sync_test_connection':
        if (!enabled) throw unconfiguredError;
        return { ok: true, supports_etag: true, free_space: null };
      case 'sync_disable': {
        const input = (args.input ?? {}) as { forgetCredentials?: boolean };
        enabled = false;
        pending = false;
        unlocked = false;
        if (input.forgetCredentials) {
          baseUrl = '';
          username = '';
          basePath = '';
          hasPassword = false;
          lastSyncedVersion = null;
          lastSyncedAt = null;
        }
        return null;
      }
      case 'sync_status':
        if (enabled && selected === 'schema_newer')
          throw { code: 'SYNC_SCHEMA_NEWER', message: tr('云端资料由较新版本的物谱创建。请先升级应用再同步；本机资料不受影响。') };
        return status();
      case 'sync_unlock': {
        const input = (args.input ?? {}) as { passphrase?: string };
        if (!(input.passphrase ?? '').trim())
          throw { code: 'SYNC_PASSPHRASE', message: tr('同步口令不能为空') };
        if (selected === 'locked' && input.passphrase !== 'preview-pass')
          throw { code: 'SYNC_PASSPHRASE', message: tr('同步口令不正确') };
        unlocked = true;
        remembered = !!(args.input as { remember?: boolean }).remember;
        rememberedValue = remembered ? (input.passphrase as string) : '';
        return null;
      }
      case 'sync_passphrase_reveal':
        if (!rememberedValue) throw { code: 'SYNC_LOCKED', message: tr('请先解锁同步口令') };
        return rememberedValue;
      case 'sync_forget_passphrase':
        remembered = false; rememberedValue = ''; unlocked = false;
        return null;
      case 'sync_set_auto_check':
        autoCheck = !!args.enabled;
        return null;
      case 'sync_push': {
        if (!enabled) throw unconfiguredError;
        if (!unlocked) throw { code: 'SYNC_LOCKED', message: tr('请输入同步口令。口令只保留在本次运行的内存中，10 分钟后自动失效。') };
        if (selected === 'push_error')
          throw {
            code: 'SYNC_NETWORK',
            message: tr('虚构 WebDAV 连接失败，请检查地址与应用密码。'),
          };
        if (pending)
          throw {
            code: 'SYNC_RESULT_UNKNOWN',
            message: tr('虚构模拟：远端可能已经接收同步清单；下次同步会先核对结果。'),
          };
        if (state() !== 'local_ahead' && state() !== 'empty_remote')
          throw {
            code: 'SYNC_DIRECTION',
            message: tr('当前同步状态不能直接同步，请先处理远端变化。'),
          };
        return commitPush();
      }
      case 'sync_reconcile': {
        if (!enabled) throw unconfiguredError;
        if (!pending) return { outcome: 'nothing_pending', version: null };
        if (selected === 'unknown_error')
          throw { code: 'SYNC_NETWORK', message: tr('虚构 WebDAV 连接失败，请检查地址与应用密码。') };
        pending = false;
        if (selected === 'unknown_not_landed') return { outcome: 'not_landed', version: null };
        if (selected === 'unknown_remote_changed') return { outcome: 'remote_changed', version: remoteVersion };
        // The cloud already received version 8 before this page opened.
        // Reconciliation only settles this device's baseline, never the cloud.
        lastSyncedVersion = remoteVersion;
        lastSyncedAt = new Date().toISOString();
        localChanged = false;
        return { outcome: 'landed', version: remoteVersion };
      }
      case 'sync_pull_inspect': {
        if (!enabled) throw unconfiguredError;
        if (remoteVersion === null)
          throw { code: 'SYNC_EMPTY_REMOTE', message: tr('远端没有可拉取的快照') };
        if (state() !== 'remote_ahead')
          throw {
            code: 'SYNC_DIRECTION',
            message: tr('当前同步状态不能直接拉取，请先处理本机变化。'),
          };
        return inspection();
      }
      case 'sync_resolve_conflict': {
        if (!enabled) throw unconfiguredError;
        if (state() !== 'conflict')
          throw { code: 'SYNC_DIRECTION', message: tr('当前没有需要处理的冲突。') };
        const input = (args.input ?? {}) as { choice?: string };
        if (input.choice === 'keep_local') return commitPush();
        if (input.choice === 'use_remote') return inspection();
        throw { code: 'SYNC_CONFIG', message: tr('请选择保留本机或采用云端。') };
      }
      default:
        throw { message: '此操作需在原生 App 验证：' + name };
    }
  };

  const initialView = (): SyncSettingsPreview | null => selected === 'unchecked' ? null : selected === 'schema_newer'
    ? { status: null, error: { code: 'SYNC_SCHEMA_NEWER', message: tr('云端资料由较新版本的物谱创建。请先升级应用再同步；本机资料不受影响。') } }
    : { status: status(), error: null };
  return { mode: selected, command, initialView };
}
