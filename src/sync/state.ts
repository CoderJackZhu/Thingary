// Pure presentation model for the sync status. No React and no IPC here, so
// the copy and the available actions can be unit-tested; T2's desktop/mobile
// screens only render this view model.
import { formatBytes, formatWhen } from '../auto-backup-format.ts';
import { t } from '../i18n.ts';
import type { SyncRemoteStatus, SyncStatusResult } from './api.ts';

export type SyncTone = 'neutral' | 'positive' | 'attention' | 'danger';

export type SyncActionId =
  | 'configure'
  | 'sync'
  | 'pull'
  | 'retry'
  | 'reconcile'
  | 'keep_local'
  | 'use_remote'
  | 'cancel'
  | 'unlock'
  | 'upgrade';

export type SyncAction = {
  id: SyncActionId;
  label: string;
  /** What the button will do, including anything irreversible. */
  consequence?: string;
  /** Overwrites data on one side; never the default or auto-focused action. */
  destructive?: boolean;
};

export type SyncViewModel = {
  headline: string;
  detail: string;
  primaryAction: SyncAction | null;
  secondaryActions: SyncAction[];
  tone: SyncTone;
  /** True while another sync must not start until the user resolves this. */
  blocking: boolean;
};

/** A rejected sync command: Tauri's `Error::new(code, 中文消息)`. */
export type SyncErrorLike = { code?: string | null; message?: string | null };

const otherDevice = () => t('另一台设备');

function upToDateDetail(remote: SyncRemoteStatus | null): string {
  const when = remote ? formatWhen(remote.createdAt) : '';
  if (!remote || !when) return t('本机与云端一致。');
  return t('本机与云端一致。云端版本 {v1}，由「{v2}」于 {v3} 更新。', {
    v1: remote.version,
    v2: remote.deviceName || otherDevice(),
    v3: when,
  });
}

function remoteAheadDetail(remote: SyncRemoteStatus | null): string {
  const when = remote ? formatWhen(remote.createdAt) : '';
  if (!remote || !when) return t('云端有新版本。拉取前会先展示各表数量并请你确认。');
  const line = t(
    '云端由「{v1}」于 {v2} 更新（版本 {v3}，{v4}）。拉取前会先展示各表数量并请你确认。',
    {
      v1: remote.deviceName || otherDevice(),
      v2: when,
      v3: remote.version,
      v4: formatBytes(remote.snapshotBytes),
    },
  );
  return remote.slowSyncWarning
    ? `${line} ${t('云端快照较大，同步会变慢。')}`
    : line;
}

function unconfiguredView(): SyncViewModel {
  return {
    headline: t('同步未开启'),
    detail: t('WebDAV 同步默认关闭，只有你点「立即同步」时才会联网。'),
    primaryAction: {
      id: 'configure',
      label: t('配置同步'),
      consequence: t('填写 WebDAV 地址与应用密码，测试连接后再开始同步。'),
    },
    secondaryActions: [],
    tone: 'neutral',
    blocking: false,
  };
}

function statusUnknownView(): SyncViewModel {
  return {
    headline: t('无法读取同步状态'),
    detail: t('请检查网络和 WebDAV 设置后重新读取；本机资料未改变。'),
    primaryAction: { id: 'retry', label: t('重新读取') },
    secondaryActions: [],
    tone: 'neutral',
    blocking: false,
  };
}

function unknownResultView(): SyncViewModel {
  return {
    headline: t('上次同步结果未知'),
    detail: t(
      '远端可能已经收到本次同步清单。请先只读核对云端版本，确认结果后再决定；不要直接重试。',
    ),
    primaryAction: {
      id: 'reconcile',
      label: t('核对云端状态'),
      consequence: t('只读取云端清单并与本机记录比对，不写入云端或本机。'),
    },
    secondaryActions: [],
    tone: 'attention',
    blocking: true,
  };
}

function schemaView(): SyncViewModel {
  return {
    headline: t('需要先升级应用'),
    detail: t('云端资料由较新版本的物谱创建。请先升级应用再同步；本机资料不受影响。'),
    primaryAction: {
      id: 'upgrade',
      label: t('查看更新'),
      consequence: t('打开更新检查；升级前可先做完整备份。'),
    },
    secondaryActions: [],
    tone: 'attention',
    blocking: true,
  };
}

function lockedView(error: SyncErrorLike): SyncViewModel {
  return {
    headline: t('需要同步口令'),
    detail: error.message || t('请输入同步口令。口令只保留在本次运行的内存中，10 分钟后自动失效。'),
    primaryAction: {
      id: 'unlock',
      label: t('输入口令'),
      consequence: t('口令只用于本次同步，不会保存到磁盘。'),
    },
    secondaryActions: [],
    tone: 'neutral',
    blocking: true,
  };
}

function failureView(status: SyncStatusResult | null, error: SyncErrorLike): SyncViewModel {
  const pushing = status?.state === 'local_ahead' || status?.state === 'empty_remote';
  const message = error.message ?? '';
  return {
    headline: pushing ? t('推送失败') : t('同步失败'),
    detail: message
      ? t('{v1} 本机资料没有改变，可以重试。', { v1: message })
      : t('本机资料没有改变，可以重试。'),
    primaryAction: {
      id: 'retry',
      label: t('重试'),
      consequence: t('重新尝试同一方向，不会先改动本机资料。'),
    },
    secondaryActions: [],
    tone: 'danger',
    blocking: false,
  };
}

/**
 * Maps `sync_status` plus the last command error to everything the screen
 * shows. An error is the latest outcome and wins over the status snapshot;
 * a result-unknown error only offers a read-only reconcile, never a retry.
 */
export function syncView(
  status: SyncStatusResult | null,
  error?: SyncErrorLike | null,
): SyncViewModel {
  if (error) {
    switch (error.code) {
      case 'SYNC_RESULT_UNKNOWN':
        return unknownResultView();
      case 'SYNC_SCHEMA_NEWER':
        return schemaView();
      case 'SYNC_UNCONFIGURED':
        return unconfiguredView();
      case 'SYNC_PASSPHRASE':
      case 'SYNC_LOCKED':
        return lockedView(error);
      default:
        return failureView(status, error);
    }
  }
  if (!status) return statusUnknownView();
  switch (status.state) {
    case 'unconfigured':
      return unconfiguredView();
    case 'up_to_date':
      return {
        headline: t('已是最新'),
        detail: upToDateDetail(status.remote),
        primaryAction: null,
        secondaryActions: [],
        tone: 'positive',
        blocking: false,
      };
    case 'local_ahead':
      return {
        headline: t('本机有未上传的更改'),
        detail: t('云端仍是上次同步的版本。同步只上传本机快照，不改动本机资料。'),
        primaryAction: {
          id: 'sync',
          label: t('立即同步'),
          consequence: t('先解锁同步口令，再把加密快照上传到云端。'),
        },
        secondaryActions: [],
        tone: 'attention',
        blocking: false,
      };
    case 'empty_remote':
      return {
        headline: t('云端还没有同步资料'),
        detail: t('第一次同步会把本机资料加密上传。云端服务只能看到密文，口令不会保存。'),
        primaryAction: {
          id: 'sync',
          label: t('立即同步'),
          consequence: t('上传本机资料作为云端第一份快照。'),
        },
        secondaryActions: [],
        tone: 'neutral',
        blocking: false,
      };
    case 'remote_ahead':
      return {
        headline: t('云端有新版本'),
        detail: remoteAheadDetail(status.remote),
        primaryAction: {
          id: 'pull',
          label: t('检查云端资料'),
          consequence: t('只读下载并核对云端快照，不会改动本机资料；确认后才进入恢复流程。'),
        },
        secondaryActions: [],
        tone: 'attention',
        blocking: false,
      };
    case 'conflict':
      return {
        headline: t('本机与云端都有改动'),
        detail: t('同步不会自动合并。未做选择前不会写入任何资料。'),
        // Cancel is the default so Enter or a stray tap never overwrites either side.
        primaryAction: {
          id: 'cancel',
          label: t('取消'),
          consequence: t('不做任何改动，保持冲突状态。'),
        },
        secondaryActions: [
          {
            id: 'keep_local',
            label: t('保留本机'),
            consequence: t('用本机资料覆盖云端；旧云端快照仍保留。'),
            destructive: true,
          },
          {
            id: 'use_remote',
            label: t('采用云端'),
            consequence: t('用云端快照覆盖本机；本机资料会先保存一份保护副本。'),
            destructive: true,
          },
        ],
        tone: 'danger',
        blocking: true,
      };
    default:
      return statusUnknownView();
  }
}
