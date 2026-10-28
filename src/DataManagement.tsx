import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import {Icon} from './AssetViews';
import { AutoBackup } from './AutoBackup';
import { BackupSecurity, KeyInput } from './BackupSecurity';
import { looksLikeRecoveryKey, RESTORE_DISCLOSURE } from './backup-security-format';
import { SyncSettings } from './sync/SyncSettings';
import type { SyncPullInspection } from './sync/api';
import { SupportLink } from './SupportLink';
import { pendingKey, storedPending, code } from './wealth';
import { FinancialImportDialog } from './FinancialImportDialog';
import { preserveImportReceipt } from './financial-import';
import { t, numberLocale } from './i18n.ts';
import { t as tr } from './i18n.ts';
type Summary = { savings_goals?: number; planning_conditions_reset?: boolean; hash: string; created_at: string; schema: number; assets: number; deleted_assets: number; wishes: number; maintenances: number; warranties: number; accounts: number; snapshots: number; expenses: number; plans: number; payments: number; virtual_assets: number; import_mappings: number; import_receipts: number; files: number };
type Inspected = { path: string; name: string; encrypted: boolean; token: string | null; summary: Summary | null };
type Note = { line: number; name: string; reason: string };
type CsvPreview = { path: string; name: string; preview: { hash: string; valid: number; additions: number; updates: number; unchanged: number; invalid: Note[]; duplicates: Note[]; conflicts: Note[]; changes: { line: number; name: string; kind: 'add' | 'update'; changed: string[] }[]; new_categories: string[]; new_channels: string[] } };
type ImportDone = { imported: number; updated?: number; unchanged?: number; skipped_duplicates: number; invalid: number };
type Task = { kind: 'idle' } | { kind: 'running'; label: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };
/** An item import whose reply was lost stays stored until its original request is checked. */
const itemImportPendingKey = 'thingary.item-import-pending.v1';
type ItemImportPending = { request_id: string; generation: string; hash: string; include_duplicates: boolean };
export function storedItemImport(): ItemImportPending | null {
  try { const p = JSON.parse(localStorage.getItem(itemImportPendingKey) || 'null'); if (p && typeof p.request_id === 'string' && typeof p.generation === 'string' && typeof p.hash === 'string' && typeof p.include_duplicates === 'boolean') return p; } catch { /* unreadable is ignored */ }
  return null;
}
const clearItemImport = () => { try { localStorage.removeItem(itemImportPendingKey); } catch { /* nothing to clear */ } };
const importSummary = (done: ImportDone) => tr('新增 {added} 件，修改 {updated} 件，未变化 {unchanged} 件', { added: done.imported - (done.updated ?? 0), updated: done.updated ?? 0, unchanged: done.unchanged ?? 0 }) + (done.skipped_duplicates ? tr('，跳过疑似重复 {skipped_duplicates} 行', { skipped_duplicates: done.skipped_duplicates }) : '') + (done.invalid ? tr('，{invalid} 行无效未导入', { invalid: done.invalid }) : '') + '。';
/** Read-only: a stored reply confirms the write; null is a definite not-committed for this dataset. */
async function itemReceipt(input: ItemImportPending): Promise<ImportDone | null> {
  return invoke<ImportDone | null>('item_import_receipt', { input });
}

// These preferences belong to this device, not the replaced dataset. In
// particular, restoring data must never turn off the user's screen protection.
const devicePreferenceKeys = new Set([
  'thingary.theme', 'thingary.style', 'thingary.welcome.v1', 'thingary.usage-details.v1', 'thingary.privacy-cover.v1', 'thingary.privacy-lock.v1',
  'thingary.hide-financial-amounts.v1', 'thingary.overview-view.v1',
  'thingary.retire.valueMode', 'thingary.checkin-reminder-asked.v1',
]);
/** Dataset work, caches and dismissals expire on restore; device preferences remain. */
export function localWorkKeys() {
  const keys: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('thingary.') && !devicePreferenceKeys.has(k)) keys.push(k); } } catch { /* storage unavailable: nothing to clear */ }
  return keys;
}

export function DataManagement({ generation, blocked, demo, onTrash, onBusyChange, onImported, onViewFinance, financeImportRequested, onFinanceImportRequestDone }: { generation: string | null; blocked: boolean; demo: boolean; onTrash: () => void; onBusyChange: (busy: boolean) => void; onImported: () => void; onViewFinance?: (target: 'income' | 'accounts' | 'snapshots') => void; financeImportRequested?: boolean; onFinanceImportRequestDone?: () => void }) {
  const [task, setTask] = useState<Task>({ kind: 'idle' }), [candidate, setCandidate] = useState<Inspected | null>(null);
  const [sheet, setSheet] = useState<CsvPreview | null>(null), [withDuplicates, setWithDuplicates] = useState(false), [importId, setImportId] = useState('');
  const [financeImport, setFinanceImport] = useState<{ generation: string; recoveryOnly: boolean } | null>(null);
  const [activeTask, setActiveTask] = useState<string | null>(null), [taskNotice, setTaskNotice] = useState('');
  const activeTaskRef = useRef<{ id: string; requested: boolean } | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false), [restoreUnknown, setRestoreUnknown] = useState(false);
  const alive = useRef(true), candidateRef = useRef<Inspected | null>(null), scopeRef = useRef(''), restoreLock = useRef(false);
  const scope = JSON.stringify([generation, demo]);
  scopeRef.current = scope; candidateRef.current = candidate;
  useEffect(() => { alive.current = true; return () => { alive.current = false; const active = activeTaskRef.current; if (active && !active.requested) { active.requested = true; void invoke('backup_task_cancel', { taskId: active.id }).catch(() => undefined); } const token = candidateRef.current?.token; if (token && !restoreLock.current) void invoke('cancel_backup_session', { token }).catch(() => undefined); }; }, []);
  useEffect(() => { const active = activeTaskRef.current; if (active && !active.requested) { active.requested = true; void invoke('backup_task_cancel', { taskId: active.id }).catch(() => undefined); } if (restoreUnknown || restoreLock.current || active) return; setTask({ kind: 'idle' }); const token = candidateRef.current?.token; if (token && !restoreLock.current) void invoke('cancel_backup_session', { token }).catch(() => undefined); setCandidate(null); setUnlockKey(''); }, [scope]);
  const [unlockKey, setUnlockKey] = useState(''), [security, setSecurity] = useState<import('./backup-security-format').SecurityStatus | null>(null);
  // Pending receipt metadata is a separate global lock, not an open settings operation.
  const [, refreshPending] = useState(0);
  const savedPending = storedPending();
  const financePending = savedPending?.command === 'financial_import_commit' ? savedPending : null;
  // Item imports keep the same rule: a lost reply is checked by its original request.
  const [, refreshItemPending] = useState(0);
  const itemPending = storedItemImport();
  const busy = task.kind === 'running';
  const operationLocked = securityBusy || restoreUnknown || busy || !!candidate || !!sheet || !!financeImport || !!savedPending || !!itemPending;
  function canStart() { return !securityBusy && !restoreUnknown && !busy && !candidate && !sheet && !financeImport && !blocked && !demo && !!generation && !storedPending() && !storedItemImport(); }
  function openFinance() {
    if (securityBusy || restoreUnknown || busy || candidate || sheet || financeImport) return;
    const pending = storedPending();
    if (pending?.command === 'financial_import_commit') {
      // Recovery must keep the original dataset identity even after a restore.
      setFinanceImport({ generation: pending.input.generation, recoveryOnly: true });
    } else if (canStart()) setFinanceImport({ generation: generation!, recoveryOnly: false });
  }
  useEffect(() => {
    const refresh = () => { refreshPending(n => n + 1); refreshItemPending(n => n + 1); };
    window.addEventListener('thingary-restored', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('thingary-restored', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  useEffect(() => {
    if (!financeImportRequested) return;
    openFinance();
    onFinanceImportRequestDone?.();
  }, [financeImportRequested]);
  useEffect(() => { onBusyChange(securityBusy || restoreUnknown || busy || !!candidate || !!sheet || !!financeImport); return () => onBusyChange(false); }, [securityBusy, restoreUnknown, busy, candidate, sheet, financeImport, onBusyChange]);
  async function withBackupTask<T>(action: (taskId: string) => Promise<T>): Promise<T> {
    const owner = scope;
    const taskId = await invoke<string>('backup_task_begin');
    if (!alive.current || scopeRef.current !== owner) {
      await invoke('backup_task_cancel', { taskId }).catch(() => undefined);
      throw { code: 'CANCELLED', message: t('已取消，原成品保留') };
    }
    activeTaskRef.current = { id: taskId, requested: false }; setActiveTask(taskId); setTaskNotice('');
    try { return await action(taskId); }
    finally {
      if (activeTaskRef.current?.id === taskId) { activeTaskRef.current = null; if (alive.current) { setActiveTask(null); setTaskNotice(''); if (scopeRef.current !== owner) setTask({ kind: 'idle' }); } }
    }
  }
  async function cancelTask() {
    const active = activeTaskRef.current;
    if (!active || active.requested) return;
    active.requested = true;
    setTaskNotice(tr('正在请求取消，请等待原操作收尾'));
    try {
      const accepted = await invoke<boolean>('backup_task_cancel', { taskId: active.id });
      if (alive.current && activeTaskRef.current?.id === active.id) setTaskNotice(accepted ? tr('正在取消，请等待清理') : tr('本次操作已发布或完成，请等待原结果'));
    } catch { if (alive.current && activeTaskRef.current?.id === active.id) setTaskNotice(tr('未能确认取消请求，请等待原操作结果')); }
  }
  async function saveTemplate() {
    if (!canStart()) return;
    setTask({ kind: 'running', label: t('正在保存导入模板…') });
    try {
      const path = await invoke<string | null>('save_spreadsheet_template');
      setTask(path ? { kind: 'done', text: t('模板已保存到 {path}。按表头填写后，用「选择表格…」导入。', { path }) } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: tr('模板未保存：') + errorMessage(e) }); }
  }
  async function inspectCsv() {
    if (!canStart()) return;
    setCandidate(null); setSheet(null); setTask({ kind: 'running', label: t('正在检查表格，当前资料不会改变…') });
    try {
      const found = await invoke<CsvPreview | null>('inspect_item_workbook');
      setSheet(found); setWithDuplicates(false); setImportId(crypto.randomUUID()); setTask({ kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: tr('这个表格不能导入，当前资料未改变：') + errorMessage(e) }); }
  }
  async function commitCsv() {
    if (!sheet || !generation || busy || demo || financeImport || candidate || storedPending() || storedItemImport()) return;
    const pending: ItemImportPending = { request_id: importId, generation, hash: sheet.preview.hash, include_duplicates: withDuplicates };
    try { localStorage.setItem(itemImportPendingKey, JSON.stringify(pending)); }
    catch { setTask({ kind: 'error', text: t('无法保存这次操作的编号，尚未开始导入，请检查可用空间后重试。') }); return; }
    refreshItemPending(n => n + 1);
    setTask({ kind: 'running', label: t('正在导入…') });
    try {
      const done = await invoke<ImportDone>('commit_item_workbook', { path: sheet.path, input: pending });
      clearItemImport(); refreshItemPending(n => n + 1);
      setSheet(null);
      setTask({ kind: 'done', text: importSummary(done) });
      onImported();
    } catch (e) {
      // A definite backend error wrote nothing; a lost reply is told apart by checking the original request.
      const checked = await itemReceipt(pending).catch(() => undefined);
      if (checked) {
        clearItemImport(); refreshItemPending(n => n + 1);
        setSheet(null);
        setTask({ kind: 'done', text: t('已核对上次导入：{v1}', { v1: importSummary(checked) }) });
        onImported();
      } else if (checked === null) {
        clearItemImport(); refreshItemPending(n => n + 1); window.dispatchEvent(new Event('thingary-restored'));
        setTask({ kind: 'error', text: tr('导入未提交，资料未改变：') + errorMessage(e) });
      } else {
        setTask({ kind: 'error', text: tr('导入结果未知：') + errorMessage(e) + tr(' 上次操作编号已保留，请点「核对物品导入结果」，不要重新选择同一文件重复导入。') });
      }
    }
  }
  async function verifyItemImport() {
    const pending = storedItemImport();
    if (!pending || busy) return;
    setTask({ kind: 'running', label: t('正在核对上次物品导入结果…') });
    try {
      const checked = await itemReceipt(pending);
      clearItemImport(); refreshItemPending(n => n + 1); window.dispatchEvent(new Event('thingary-restored'));
      if (checked) {
        setTask({ kind: 'done', text: t('已核对上次导入：{v1}', { v1: importSummary(checked) }) });
        onImported();
      } else {
        setTask({ kind: 'done', text: t('核对完成：上次没有导入，资料未改变。可重新选择表格导入。') });
      }
    } catch (e) {
      setTask({ kind: 'error', text: code(e) === 'STALE_DATASET' ? t('已经切换资料，上次操作编号仍保留。请回到原来的资料中核对，不要在这里重复导入同一文件。') : tr('暂时无法核对，上次操作编号仍保留：') + errorMessage(e) });
    }
  }
  async function backup(forcePlaintext = false) {
    if (!canStart()) return;
    setCandidate(null); setTask({ kind: 'running', label: forcePlaintext ? t('正在导出未加密副本…') : t('正在生成并校验完整备份…') });
    try {
      const done = await withBackupTask(taskId => invoke<{ name: string; folder: string } | null>('create_backup', { forcePlaintext, taskId }));
      setTask(done
        ? { kind: 'done', text: forcePlaintext
            ? t('已导出未加密副本「{name}」，位于 {folder}。仅本次例外；自动与额外备份仍按已开启的加密策略执行。', { name: done.name, folder: done.folder })
            : t('已保存并校验「{name}」，位于 {folder}。', { name: done.name, folder: done.folder }) }
        : { kind: 'idle' });
    } catch (e) { if (alive.current) setTask({ kind: 'error', text: code(e) === 'CANCELLED' ? t('已取消，原成品保留。') : tr('备份未完成，当前资料未改变：') + errorMessage(e) }); }
  }
  async function exportAll() {
    if (!canStart()) return;
    setCandidate(null); setTask({ kind: 'running', label: t('正在导出资料表格…') });
    try {
      const done = await invoke<{ path: string; files: { name: string; rows: number }[] } | null>('export_workbook');
      setTask(done ? { kind: 'done', text: `已导出到 Excel「${done.path}」：${done.files.map(f => tr('{name} {rows} 行', { name: f.name, rows: f.rows })).join('、')}。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: tr('导出未完成：') + errorMessage(e) }); }
  }
  async function inspect() {
    if (!canStart()) return;
    setCandidate(null); setTask({ kind: 'running', label: t('正在检查备份，当前资料不会改变…') });
    try {
      const startedScope = scope;
      const found = await withBackupTask(taskId => invoke<Inspected | null>('inspect_backup', { taskId }));
      if (!alive.current || scopeRef.current !== startedScope) { if (found?.token) void invoke('cancel_backup_session', { token: found.token }).catch(() => undefined); return; }
      if (found) { candidateRef.current = found; setCandidate(found); setUnlockKey(''); }
      setTask({ kind: 'idle' });
    } catch (e) { if (alive.current) setTask({ kind: 'error', text: code(e) === 'CANCELLED' ? t('已取消，原成品保留。') : tr('这个备份不能用于恢复，当前资料未改变：') + errorMessage(e) }); }
  }
  async function unlock() {
    if (!candidate?.encrypted || !candidate.token) return;
    setTask({ kind: 'running', label: t('正在用恢复密钥解密并检查备份…') });
    try {
      const startedScope = scope, token = candidate.token;
      const unlocked = await withBackupTask(taskId => invoke<Inspected>('unlock_backup_session', { token: candidate.token, keyText: unlockKey, taskId }));
      if (!alive.current || scopeRef.current !== startedScope || candidateRef.current?.token !== token) return;
      setCandidate({ ...candidate, encrypted: false, summary: unlocked.summary });
      setUnlockKey(''); setTask({ kind: 'idle' });
    } catch (e) { if (alive.current) { setUnlockKey(''); setTask({ kind: 'error', text: code(e) === 'CANCELLED' ? t('已取消，原成品保留。') : t('无法解密，请核对恢复密钥或备份完整性。当前资料未改变。') }); } }
  }
  async function cancelCandidate() {
    if (restoreUnknown || restoreLock.current) return;
    const token = candidate?.token;
    setCandidate(null); setUnlockKey('');
    if (token) { try { await invoke('cancel_backup_session', { token }); } catch { /* session cleanup is best effort */ } }
  }
  // A sync pull returns the same opaque session token as a backup inspection,
  // so the existing confirmation and restore command do the restore.
  function inspectSync(inspection: SyncPullInspection): boolean {
    if (!inspection.summary || !alive.current || demo || restoreLock.current || restoreUnknown || !generation) {
      if (inspection.token) void invoke('cancel_backup_session', { token: inspection.token }).catch(() => undefined);
      return false;
    }
    const found: Inspected = { path: '', name: inspection.device_name ? t('云端快照（{device}）', { device: inspection.device_name }) : t('云端同步快照'), encrypted: false, token: inspection.token, summary: inspection.summary };
    candidateRef.current = found; setCandidate(found); setUnlockKey(''); setTask({ kind: 'idle' });
    return true;
  }
  async function inspectAuto(name: string) {
    if (!canStart()) return;
    setCandidate(null); setTask({ kind: 'running', label: t('正在检查自动备份，当前资料不会改变…') });
    try {
      const startedScope = scope;
      const found = await withBackupTask(taskId => invoke<Inspected>('inspect_auto_backup', { name, taskId }));
      if (!alive.current || scopeRef.current !== startedScope) { if (found.token) void invoke('cancel_backup_session', { token: found.token }).catch(() => undefined); return; }
      candidateRef.current = found; setCandidate(found); setUnlockKey(''); setTask({ kind: 'idle' });
    } catch (e) { if (alive.current) setTask({ kind: 'error', text: code(e) === 'CANCELLED' ? t('已取消，原成品保留。') : tr('这个备份不能用于恢复，当前资料未改变：') + errorMessage(e) }); }
  }
  async function restore() {
    if (restoreUnknown || restoreLock.current || securityBusy || !candidate || !candidate.token || !candidate.summary || !generation || busy || demo || financeImport || sheet || storedPending()) return;
    restoreLock.current = true;
    setTask({ kind: 'running', label: t('正在恢复：先保护当前资料，再整体切换…') });
    try {
      await invoke<string>('restore_backup_session', { token: candidate.token });
      completeRestore();
    } catch (e) {
      if (alive.current) { setRestoreUnknown(true); setTask({ kind: 'error', text: tr('恢复结果尚未确认：') + errorMessage(e) + tr(' 请先核对这次恢复是否完成，核对不会写入资料，不要重新恢复。') }); }
    } finally { restoreLock.current = false; }
  }
  function completeRestore() {
    for (const key of localWorkKeys()) { try { if (key === pendingKey && preserveImportReceipt(localStorage.getItem(key))) continue; if (key === itemImportPendingKey) continue; localStorage.removeItem(key); } catch { /* reload still invalidates by generation */ } }
    location.reload();
  }
  async function verifyRestore() {
    if (!candidate?.token || restoreLock.current || busy) return;
    restoreLock.current = true;
    setTask({ kind: 'running', label: t('正在核对这次恢复结果（不写入资料）…') });
    try {
      const result = await invoke<string | null>('backup_session_result', { token: candidate.token });
      if (!alive.current) return;
      if (result) completeRestore();
      else { setRestoreUnknown(false); setTask({ kind: 'done', text: t('核对完成：这次尚未恢复。可取消，或再次确认替换。') }); }
    } catch (e) { if (alive.current) setTask({ kind: 'error', text: tr('暂时无法确认恢复结果；这次检查的信息仍保留，请重新启动后核对当前资料。') + errorMessage(e) }); }
    finally { restoreLock.current = false; }
  }
  // Ordinary drafts are cleared; unknown import request metadata remains for read-only receipt verification.
  const pending = localWorkKeys().filter(k => /draft|request|abandon|upload/.test(k)).length;
  return <section className="ui-card ui-content data-management" aria-labelledby="data-heading">
    <div className="data-heading"><div><p className="eyebrow">{t('本地资料')}</p><h2 id="data-heading" tabIndex={-1}>{t('数据管理')}</h2></div><span>{t('主资料保存在本机')}</span></div>
    <p className="data-intro">{demo ? t('当前是独立样例库。切换到“我的资料”后可备份、恢复与导出。') : t('给资料留一份完整备份，也可导出表格或找回误删记录。')} <SupportLink target="backup">{t('备份与恢复说明')}</SupportLink></p>
    <div className="data-actions">
      <div className="data-action"><span className="data-action-icon"><Icon name="archive"/></span><div className="data-action-copy"><h3>{t('完整备份')}</h3><p>{t('保存物品、财富记录和图片等全部资料。')}{security?.state === 'enabled' ? t('已按备份安全设置加密导出。') : ''}</p></div><span className="data-action-buttons"><button disabled={operationLocked || blocked || demo} onClick={() => void backup()}>{t('备份…')}</button>{security?.state === 'enabled' && <button disabled={operationLocked || blocked || demo} onClick={() => void backup(true)}>{t('导出未加密副本…')}</button>}</span></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="back"/></span><div className="data-action-copy"><h3>{t('从备份恢复')}</h3><p>{t('先检查文件，再确认是否替换当前资料。')}</p></div><button disabled={operationLocked || blocked || demo || !generation} onClick={() => void inspect()}>{t('选择…')}</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>{t('导出资料表格（Excel）')}</h3><p>{t('一个 Excel 文件，多张工作表。物品、账户、完整盘点与月度收入可在对应入口导入，其余仅供查看分析；不能用于恢复。')}</p></div><button disabled={operationLocked || blocked || demo} onClick={() => void exportAll()}>{t('导出…')}</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>{t('导入物品表（Excel）')}</h3><p>{t('填写模板可新增物品；修改导出的物品表可批量更新常规资料，导入前先预览。')}</p></div>{itemPending ? <button disabled={busy} onClick={() => void verifyItemImport()}>{t('核对物品导入结果')}</button> : <span className="data-action-buttons"><button disabled={operationLocked || blocked || demo} onClick={() => void saveTemplate()}>{t('下载模板…')}</button><button disabled={operationLocked || blocked || demo || !generation} onClick={() => void inspectCsv()}>{t('选择表格…')}</button></span>}</div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>{t('导入金融历史（Excel）')}</h3><p>{t('账户、完整盘点与月度收入共用导入向导；模板与虚构样例在向导内。日常记收入请到收支记录。')}</p></div><button disabled={financePending ? busy || !!candidate || !!sheet || !!financeImport : operationLocked || blocked || demo || !generation} onClick={openFinance}>{financePending ? t('核对金融导入结果') : t('选择金融历史…')}</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="trash"/></span><div className="data-action-copy"><h3>{t('最近删除')}</h3><p>{t('找回误删的物品、心愿、维护、保障、账户、盘点、存钱目标、支出、周期费用与虚拟资产。')}</p></div><button id="settings-open-trash" disabled={operationLocked || blocked} onClick={onTrash}>{t('打开')}</button></div>
    </div>
    <BackupSecurity key={scope} onBusyChange={setSecurityBusy} demo={demo} blocked={busy || restoreUnknown || blocked || !!candidate || !!sheet || !!financeImport || !!savedPending || !!itemPending} onStatusChange={setSecurity}/>
    <fieldset disabled={securityBusy || restoreUnknown || busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}><AutoBackup generation={generation} demo={demo} blocked={blocked || !!savedPending || !!itemPending} busy={busy || !!sheet || !!financeImport} candidateOpen={!!candidate} paused={!!security?.paused} securityRevision={security} onInspect={name => void inspectAuto(name)}/></fieldset>
    <SyncSettings blocked={operationLocked || blocked || demo || !generation} onPull={inspectSync}/>
    <details className="data-explainer"><summary>{t('备份、导出导入和最近删除有什么区别？')}</summary><p>{t('完整备份包含物品、维护、保障、心愿、账户与盘点、重要支出与退款、周期计划与付款、虚拟资产、分类渠道、素材、最近删除及托管原图，可用于恢复。恢复前会检查所选备份，并保护当前资料。')}</p><p>{t('自动备份在资料有改动后自动生成，保留最近 7 份，放在本机资料目录旁；与手动备份格式相同，都可用于恢复。额外备份位置由你选择，可保存副本到云盘或外接盘。')}</p><p>{t('导出资料表格保存为一个 .xlsx 文件，各类数据分工作表；其中物品、账户、完整盘点与月度收入可在对应入口预览导入，只有部分工作表支持导入，盘点记录、重要支出与周期费用等其余表仅供查看分析。文字、编号、日期和金额按文本保存，空金额仍为未知。Excel 不能用于恢复全部资料。最近删除仅用于找回误删记录。')}</p><p>{t('物品表支持新增，以及修改名称、分类、品牌、型号、序列号、购入价、购入日期、渠道和备注。保留隐藏的档案编号和版本会更新原物品；新增行请将两格留空。导出后物品又有修改时须重新核对。退役、重新启用和售出请在物品详情处理。新增行只有名称必填，疑似重复默认跳过。日期可填 2026-10-28、2026/10/28 或 2026年10月28日；金额可用合法千分位和人民币符号，空白表示未知。金融历史入口读取账户、完整盘点和月度收入，有差异时可选择更正。结果未知时保留原编号，只核对上次导入是否成功；整体恢复请用完整备份。')}</p></details>
    {blocked && <p className="notice">{t('请先处理正在编辑或待核对的内容，再进行备份或恢复。')}</p>}
    {activeTask && <div className="actions"><button disabled={!!taskNotice} onClick={() => void cancelTask()}>{t('取消本次备份操作')}</button>{taskNotice && <p role="status">{taskNotice}</p>}</div>}
    {task.kind === 'running' && <p role="status" className="notice">{task.label}</p>}
    {task.kind === 'done' && <p role="status" className="notice">{task.text}</p>}
    {restoreUnknown && <button disabled={busy} onClick={() => void verifyRestore()}>{t('核对恢复结果')}</button>}
    {task.kind === 'error' && <p role="alert" className="notice error">{task.text}</p>}
    {financeImport && <FinancialImportDialog generation={financeImport.generation} currentGeneration={generation} recoveryOnly={financeImport.recoveryOnly} onViewFinance={onViewFinance} onClose={saved => { setFinanceImport(null); refreshPending(n => n + 1); if (saved) onImported(); }}/>}
    {sheet && <CsvConfirm sheet={sheet} busy={busy} withDuplicates={withDuplicates} onDuplicates={setWithDuplicates} onCancel={() => setSheet(null)} onConfirm={() => void commitCsv()}/>}
    {candidate && candidate.encrypted && <div className="confirm" role="alert">
      <strong>{t('「{name}」是加密备份', { name: candidate.name })}</strong>
      <p>{t('输入对应的恢复密钥，或选择保存的密钥文件。密钥只在本次解密中使用，不会保存。')}</p>
      <KeyInput key={candidate.token} busy={busy} value={unlockKey} onChange={setUnlockKey}/>
      {unlockKey && !looksLikeRecoveryKey(unlockKey).ok && <p className="notice error" role="alert">{looksLikeRecoveryKey(unlockKey).reason}</p>}
      <div className="actions"><button disabled={busy} onClick={() => void cancelCandidate()}>{t('取消')}</button><button className="primary" disabled={busy || !looksLikeRecoveryKey(unlockKey).ok} onClick={() => void unlock()}>{t('解密并检查')}</button></div>
    </div>}
    {candidate && !candidate.encrypted && candidate.summary && <div className="confirm" role="alert">
      <strong>{t('用「{name}」替换当前全部资料？', { name: candidate.name })}</strong>
      <p>{t('备份时间 {v1} · 格式版本 {schema}', { v1: new Date(candidate.summary.created_at).toLocaleString(numberLocale()), schema: candidate.summary.schema })}</p>
      <p>{t('物品 {assets} 件（其中最近删除 {deleted_assets}）· 心愿 {wishes} 条 · 维护 {maintenances} 条 · 保障 {warranties} 份 · 账户 {accounts} 个 · 存钱目标', { assets: candidate.summary.assets, deleted_assets: candidate.summary.deleted_assets, wishes: candidate.summary.wishes, maintenances: candidate.summary.maintenances, warranties: candidate.summary.warranties, accounts: candidate.summary.accounts })} {candidate.summary.savings_goals ?? 0} {t('个 · 盘点 {snapshots} 次 · 支出 {expenses} 笔 · 周期计划 {plans} 项 · 周期付款 {payments} 条 · 虚拟资产 {virtual_assets} 件 · 导入对应关系', { snapshots: candidate.summary.snapshots, expenses: candidate.summary.expenses, plans: candidate.summary.plans, payments: candidate.summary.payments, virtual_assets: candidate.summary.virtual_assets })} {candidate.summary.import_mappings ?? 0} {t('条 · 导入成功记录')} {candidate.summary.import_receipts ?? 0} {t('份 · 原图 {files} 个', { files: candidate.summary.files })}</p>
      <p className="muted">{t('检查已通过。当前资料会先保存保护副本，失败时保持原样。')}{pending > 0 && t('本机还有 {pending} 份属于当前资料的草稿或待核对操作，恢复后旧输入失效；结果未知的导入操作仍保留原编号供核对。', { pending })}</p>
      <p className="muted">{RESTORE_DISCLOSURE}</p>
      {candidate.summary.planning_conditions_reset && <p className="notice">{t('恢复时会保留物品、账户、盘点及实际发生记录；旧退休政策资料会移除，规划时间和未来收入请重新确认。')}</p>}
      <div className="actions"><button disabled={busy || restoreUnknown} onClick={() => void cancelCandidate()}>{t('取消')}</button><button className="primary danger" disabled={busy || restoreUnknown} onClick={() => void restore()}>{t('确认替换当前资料')}</button></div>
    </div>}
  </section>;
}

function NoteList({ title, notes }: { title: string; notes: Note[] }) {
  if (!notes.length) return null;
  return <details className="csv-notes"><summary>{t('{title} {length} 行', { title, length: notes.length })}</summary><ul>{notes.slice(0, 50).map(n => <li key={n.line}>{t('第 {line} 行', { line: n.line })}{n.name && `「${n.name}」`}：{n.reason}</li>)}{notes.length > 50 && <li>{t('还有')} {notes.length - 50} {t('行未列出。')}</li>}</ul></details>;
}

function CsvConfirm({ sheet, busy, withDuplicates, onDuplicates, onCancel, onConfirm }: { sheet: CsvPreview; busy: boolean; withDuplicates: boolean; onDuplicates: (v: boolean) => void; onCancel: () => void; onConfirm: () => void }) {
  const p = sheet.preview, count = p.additions + p.updates - (withDuplicates ? 0 : p.duplicates.length);
  return <div className="confirm" role="alert">
    <strong>{t('从「{name}」导入 {count} 件物品？', { name: sheet.name, count })}</strong>
    <p>{t('新增 {added} 件，修改 {updated} 件，未变化 {unchanged} 件', { added: p.additions - (withDuplicates ? 0 : p.duplicates.length), updated: p.updates, unchanged: p.unchanged })}{p.invalid.length > 0 && t('，{length} 行有问题不会导入', { length: p.invalid.length })}{p.duplicates.length > 0 && t('，其中 {length} 行疑似重复', { length: p.duplicates.length })}</p>
    <p>{t('修改行保留隐藏的档案编号和版本；新增行请将这两格留空。空白单元格会清空对应字段，删去整列则保留现有值。')}</p>
    <NoteList title={t('需要重新核对（处理后才能导入）')} notes={p.conflicts}/>
    <NoteList title={t('将修改的资料')} notes={p.changes.filter(c => c.kind === 'update').map(c => ({ line: c.line, name: c.name, reason: c.changed.map(label => t(label)).join('、') }))}/>
    {p.new_categories.length > 0 && <p>{t('将新建分类：{v1}', { v1: p.new_categories.join('、') })}</p>}
    {p.new_channels.length > 0 && <p>{t('将新建购买渠道：{v1}', { v1: p.new_channels.join('、') })}</p>}
    <NoteList title={t('有问题的行')} notes={p.invalid}/>
    <NoteList title={t('疑似重复（名称、购入日期和购入价与已有物品或文件内其他行相同）')} notes={p.duplicates}/>
    {p.duplicates.length > 0 && <label className="csv-duplicates"><input type="checkbox" checked={withDuplicates} disabled={busy} onChange={e => onDuplicates(e.target.checked)}/>{t('疑似重复的行也导入')}</label>}
    <p className="muted">{t('全部成功才写入；确定失败时资料不变，结果未知时只核对上次导入是否成功，不重复写入。')}</p>
    <div className="actions"><button disabled={busy} onClick={onCancel}>{t('取消')}</button><button className="primary" disabled={busy || count === 0 || p.conflicts.length > 0} onClick={onConfirm}>{count === 0 ? t('没有可导入的行') : t('导入 {count} 件', { count })}</button></div>
  </div>;
}
