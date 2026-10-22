// Everything that hands a file to or takes a file from the person goes through this module, so the iOS
// native share sheet, document picker and report hand-off have one platform boundary.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { t } from '../../i18n.ts';
type ShareOutcome = { completed: boolean; error: string | null };
type Platform = { native_file_sharing: boolean };
let platform: Promise<Platform> | undefined;
const nativeSharing = async () => {
  // Browser previews keep their existing download behaviour. Do not cache a
  // failed native probe as desktop: an unavailable bridge is an actual error.
  if (!isTauri()) return false;
  platform ??= invoke<Platform>('platform_capabilities').catch(error => { platform = undefined; throw error; });
  return (await platform).native_file_sharing;
};

function shareNotice(name: string, share?: ShareOutcome): void {
  if (share && !share.completed) window.alert(`已生成并保留「${name}」，可在“文件”App 的物谱目录找到。${share.error || '已取消分享，尚未保存到其他位置。'}`);
}

export type BackupDone = { name: string; folder: string };
export type Inspected = { path: string; name: string; encrypted: boolean; token: string | null; summary: import('./model').BackupSummary | null };
export type WorkbookDone = { path: string; files: { name: string; rows: number }[] };

/**
 * 立即备份并分享: create and verify a full backup, then hand it to the person.
 * The desktop command keeps its save panel. iOS publishes to its sandbox then
 * opens the system share sheet; sharing cancellation never undoes publication.
 */
export async function shareBackup(forcePlaintext: boolean, taskId: string): Promise<BackupDone | null> {
  const done = await invoke<(BackupDone & { share?: ShareOutcome }) | null>('create_backup', { forcePlaintext, taskId });
  if (done) shareNotice(done.name, done.share);
  return done;
}
/** 选择备份文件 (.thingary / .thingary.age) and open an inspection session. `null` when the person cancels. */
export function pickBackupFile(taskId: string): Promise<Inspected | null> {
  return invoke<Inspected | null>('inspect_backup', { taskId });
}
/** 导出表格: one .xlsx workbook through the same hand-off as the backup. */
export async function shareWorkbook(): Promise<WorkbookDone | null> {
  const done = await invoke<(WorkbookDone & { share?: ShareOutcome }) | null>('export_workbook');
  if (done) shareNotice(done.path.split('/').pop() || '表格', done.share);
  return done;
}

/** Same hand-off for the frozen report; only the native bridge renders PDF. */
export async function shareReport(name: string, html: string): Promise<string> {
  if (await nativeSharing()) {
    const done = await invoke<{ name: string; share: ShareOutcome }>('ios_export_pdf', { name: name.replace(/\.html$/i, '.pdf'), html });
    return done.share.completed ? '已生成 PDF 并完成分享。' : `已生成「${done.name}」并保留在“文件”App 的物谱目录。${done.share.error || '已取消分享。'}`;
  }
  downloadBlob(name, new Blob([html], { type: 'text/html;charset=utf-8' }));
  return '已生成可打印的 HTML 报告。';
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
/** Browser download of text the page already holds (the recovery key file). */
export async function downloadText(name: string, text: string): Promise<boolean> {
  if (await nativeSharing()) return invoke<boolean>('ios_share_text', { name, text });
  downloadBlob(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
  return true;
}
export const recoveryKeyFile = (key: string, recipientId: string): { name: string; text: string } => ({
  name: `物谱恢复密钥-${recipientId.slice(0, 8)}.txt`,
  text: t('# 物谱备份恢复密钥。请与备份文件分开保管，丢失后无法找回。\n# 公钥标识 {recipientId}\n{key}\n', { recipientId, key }),
});
