// Everything that hands a file to or takes a file from the person goes through this module, so the iOS
// share sheet and document picker (provided by another task) replace one place only.
import { invoke } from '@tauri-apps/api/core';

export type BackupDone = { name: string; folder: string };
export type Inspected = { path: string; name: string; encrypted: boolean; token: string | null; summary: import('./model').BackupSummary | null };
export type WorkbookDone = { path: string; files: { name: string; rows: number }[] };

/**
 * 立即备份并分享: create and verify a full backup, then hand it to the person.
 * Today this is the desktop `create_backup` command (native save panel; `null` when the person cancels).
 * The iOS build replaces this function with "write into the app sandbox, open the system share sheet".
 */
export function shareBackup(forcePlaintext: boolean, taskId: string): Promise<BackupDone | null> {
  return invoke<BackupDone | null>('create_backup', { forcePlaintext, taskId });
}
/** 选择备份文件 (.thingary / .thingary.age) and open an inspection session. `null` when the person cancels. */
export function pickBackupFile(taskId: string): Promise<Inspected | null> {
  return invoke<Inspected | null>('inspect_backup', { taskId });
}
/** 导出表格: one .xlsx workbook through the same hand-off as the backup. */
export function shareWorkbook(): Promise<WorkbookDone | null> {
  return invoke<WorkbookDone | null>('export_workbook');
}
/** Browser download of text the page already holds (the recovery key file). */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const recoveryKeyFile = (key: string, recipientId: string): { name: string; text: string } => ({
  name: `物谱恢复密钥-${recipientId.slice(0, 8)}.txt`,
  text: `# 物谱备份恢复密钥。请与备份文件分开保管，丢失后无法找回。\n# 公钥标识 ${recipientId}\n${key}\n`,
});
