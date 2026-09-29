// Pure text helpers for the automatic backup section; the browser preview
// and `npm run test:ui` exercise them without a native library.
export type AutoBackupItem = { name: string; date: string; size: number };
export type AutoBackupFailure = { at: string; message: string };
export type AutoBackupStatus = {
  enabled: boolean;
  folder: string;
  last_success_at: string | null;
  last_error: AutoBackupFailure | null;
  items: AutoBackupItem[];
  total_size: number;
  extra_dir: string | null;
  extra_last_at: string | null;
  extra_last_error: AutoBackupFailure | null;
};
/** Compact local size like the Finder: 512 B, 68 KB, 4.2 MB, 1 GB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // Whole numbers stay exact; fractional sizes keep one decimal.
  const text = value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}
export function formatWhen(at: string | null): string {
  if (!at) return '';
  const time = new Date(at);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}
/** The one-line status under the switch: when, how many, how much. */
export function autoBackupSummary(status: AutoBackupStatus): string {
  if (!status.items.length) return '尚未自动备份';
  const when = status.last_success_at ? `上次自动备份：${formatWhen(status.last_success_at)}` : '上次自动备份时间未知';
  return `${when} · ${status.items.length} 份 · 共 ${formatBytes(status.total_size)}`;
}
/** The extra-location line: last copy outcome, or what is still missing. */
export function extraSummary(status: AutoBackupStatus): string {
  if (status.extra_last_error) return `上次复制失败（${formatWhen(status.extra_last_error.at)}）：${status.extra_last_error.message}`;
  if (status.extra_last_at) return `上次复制：${formatWhen(status.extra_last_at)}`;
  return '尚未复制';
}
