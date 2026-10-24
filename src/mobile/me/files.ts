// Everything that hands a file to or takes a file from the person goes through this module, so the iOS
// native share sheet, document picker and report hand-off have one platform boundary.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { t } from '../../i18n.ts';
type ShareOutcome = { completed: boolean; error: string | null };
type Platform = { native_file_sharing: boolean; pdf_export?: boolean };
let platform: Promise<Platform> | undefined;
const nativeSharing = async () => {
  // Browser previews keep their existing download behaviour. Do not cache a
  // failed native probe as desktop: an unavailable bridge is an actual error.
  if (!isTauri()) return false;
  platform ??= invoke<Platform>('platform_capabilities').catch(error => { platform = undefined; throw error; });
  return (await platform).native_file_sharing;
};
export async function pdfExportAvailable(): Promise<boolean> {
  if (!isTauri()) return true;
  platform ??= invoke<Platform>('platform_capabilities').catch(error => { platform = undefined; throw error; });
  return (await platform).pdf_export !== false;
}

async function shareNotice(name: string, share?: ShareOutcome): Promise<void> {
  if (!share || share.completed) return;
  if (!(await pdfExportAvailable())) {
    window.alert(t('导出文件只保存在物谱内，尚未保存到其他位置；需要保存时请重新导出并在分享面板选择保存位置'));
    return;
  }
  window.alert(t('已生成并保留「{name}」，可在“文件”App 的物谱目录找到。{v2}', { name, v2: share.error || '已取消分享，尚未保存到其他位置。' }));
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
  if (done) await shareNotice(done.name, done.share);
  return done;
}
/** 选择备份文件 (.thingary / .thingary.age) and open an inspection session. `null` when the person cancels. */
export function pickBackupFile(taskId: string): Promise<Inspected | null> {
  return invoke<Inspected | null>('inspect_backup', { taskId });
}
/** 导出表格: one .xlsx workbook through the same hand-off as the backup. */
export async function shareWorkbook(): Promise<WorkbookDone | null> {
  const done = await invoke<(WorkbookDone & { share?: ShareOutcome }) | null>('export_workbook');
  if (done) await shareNotice(done.path.split('/').pop() || t('表格'), done.share);
  return done;
}

/** Same hand-off for the frozen report; only the native bridge renders PDF. */
export async function shareReport(name: string, html: string): Promise<string> {
  if (await nativeSharing()) {
    const done = await invoke<{ name: string; share: ShareOutcome }>('ios_export_pdf', { name: name.replace(/\.html$/i, '.pdf'), html });
    return done.share.completed ? t('已生成 PDF 并完成分享。') : t('已生成「{name}」并保留在“文件”App 的物谱目录。{v2}', { name: done.name, v2: done.share.error || '已取消分享。' });
  }
  downloadBlob(name, new Blob([html], { type: 'text/html;charset=utf-8' }));
  return t('已生成可打印的 HTML 报告。');
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
  name: t('物谱恢复密钥-{v1}.txt', { v1: recipientId.slice(0, 8) }),
  text: t('# 物谱备份恢复密钥。请与备份文件分开保管，丢失后无法找回。\n# 公钥标识 {recipientId}\n{key}\n', { recipientId, key }),
});
