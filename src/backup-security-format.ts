import { numberLocale } from './i18n.ts';
import { t } from './i18n.ts';
/** Backup-security display types and pure text helpers. All states come from
 * the backend's machine-local policy; nothing here is secret. */

export type FirstBackup =
  | { state: 'waiting' }
  | { state: 'running' }
  | { state: 'success'; at: string }
  | { state: 'failed'; at: string; message: string };

export type SecurityStatus = {
  state: 'unconfigured' | 'disabled' | 'enabled' | 'needs_attention' | 'restore_review_required';
  reason: string | null;
  paused: boolean;
  recipient_id: string | null;
  recipient_short: string | null;
  verified_at: string | null;
  changed_at: string | null;
  first_backup: FirstBackup | null;
  setup_active: boolean;
};

export type KeySetupStarted = {
  session_id: string;
  recipient: string;
  recipient_id: string;
  recovery_key: string;
};

export const STATE_LABELS: Record<SecurityStatus['state'], string> = {
  unconfigured: t('等待设置确认'),
  disabled: t('未加密'),
  enabled: t('加密已开启'),
  needs_attention: t('配置异常'),
  restore_review_required: t('待确认本机策略'),
};

function formatWhen(at: string): string {
  return new Date(at).toLocaleString(numberLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

/** The one-line status next to the panel heading. */
export function securitySummary(status: SecurityStatus): string {
  switch (status.state) {
    case 'enabled':
      return t('密钥标识 {v1} · {v2}', { v1: status.recipient_short ?? '未知', v2: firstBackupSummary(status.first_backup) });
    case 'disabled':
      return t('备份在本机与额外位置均为明文；旧加密备份仍需对应恢复密钥。');
    case 'unconfigured':
      return t('首次使用本版本：自动与额外备份已暂停，请选择加密或继续明文。');
    case 'needs_attention':
      return t('备份安全配置异常（{v1}），自动与额外备份已暂停。', { v1: status.reason ?? '原因未知' });
    case 'restore_review_required':
      return t('刚从加密备份恢复，请确认本机后续备份策略。');
  }
}

/** Independent first-backup line; verifying a key never counts as a backup. */
export function firstBackupSummary(first: FirstBackup | null): string {
  if (!first) return t('首份加密备份：无记录');
  switch (first.state) {
    case 'waiting':
      return t('首份加密备份：等待');
    case 'running':
      return t('首份加密备份：进行中');
    case 'success':
      return t('首份加密备份：成功（{v1}）', { v1: formatWhen(first.at) });
    case 'failed':
      return t('首份加密备份：失败（{v1}）— {message}', { v1: formatWhen(first.at), message: first.message });
  }
}

/** The pause notice for the automatic-backup block. */
export function pauseNotice(status: SecurityStatus | null): string | null {
  if (!status?.paused) return null;
  switch (status.state) {
    case 'unconfigured':
      return t('自动备份等待备份安全设置确认；选择前不会生成新备份，也不会复制到额外位置。');
    case 'needs_attention':
      return t('备份安全配置异常（{v1}），自动与额外备份已暂停，已有备份保持原样。', { v1: status.reason ?? '原因未知' });
    case 'restore_review_required':
      return t('刚从加密备份恢复，自动与额外备份暂停中；请先确认本机备份策略。');
    default:
      return null;
  }
}

/** Short app-wide text while the policy pauses automatic and extra backups;
 * null when nothing is paused. Never includes backend reason strings. */
export function globalPauseText(status: SecurityStatus): string | null {
  if (!status.paused) return null;
  switch (status.state) {
    case 'unconfigured':
      return t('首次使用本版本，请选择加密或继续明文；选择前不会生成新的自动备份。已有备份不受影响。');
    case 'needs_attention':
      return t('备份安全配置异常，自动与额外备份已暂停；已有备份保持原样。');
    case 'restore_review_required':
      return t('刚从加密备份恢复，请先确认本机后续备份策略；确认前自动与额外备份暂停。');
    default:
      return t('自动与额外备份已暂停，请到数据管理查看原因。');
  }
}

/** Checks pasted or file-read recovery-key text before sending it to the
 * backend; the backend re-validates with the same strictness. */
export function looksLikeRecoveryKey(text: string): { ok: boolean; reason?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: t('请输入恢复密钥') };
  if (text.length > 64 * 1024) return { ok: false, reason: t('恢复密钥文件过大，无法识别') };
  const lines = trimmed.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
  if (lines.length === 0) return { ok: false, reason: t('文件中只有注释，没有恢复密钥') };
  if (lines.length > 1) return { ok: false, reason: t('文件包含多个身份，无法确定使用哪一个') };
  if (!lines[0].startsWith('AGE-SECRET-KEY-1')) return { ok: false, reason: t('不是受支持的恢复密钥格式') };
  return { ok: true };
}

/** Shared disclosure shown on restore confirmation: the machine keeps
 * plaintext working copies; encryption only protects exported files. */
export const RESTORE_DISCLOSURE =
  t('恢复前会在本机保存未加密的保护副本；当前资料本身与图片也未加密。加密只保护导出的备份文件。');
