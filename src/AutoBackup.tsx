import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { Switch } from './FormControls';
import { autoBackupSummary, extraSummary, formatBytes, formatWhen, type AutoBackupStatus } from './auto-backup-format';
import { t } from './i18n.ts';
/** The automatic backup block inside 资料管理. Settings and the folder list
 * are machine-local, so they stay readable in sample mode; restoring follows
 * the shared inspect-then-confirm flow and needs 我的资料. */
export function AutoBackup({ generation, demo, blocked, busy, candidateOpen, paused, securityRevision, onInspect }: { generation: string | null; demo: boolean; blocked: boolean; busy: boolean; candidateOpen: boolean; paused?: boolean; securityRevision?: unknown; onInspect: (name: string) => void }) {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null), [loadError, setLoadError] = useState('');
  const [busyButton, setBusyButton] = useState<'toggle' | 'extra' | null>(null), [actionError, setActionError] = useState('');
  const reload = useCallback(() => invoke<AutoBackupStatus>('auto_backup_status').then(s => { setStatus(s); setLoadError(''); }).catch(e => setLoadError(errorMessage(e))), []);
  // Backups finish in the background, so re-read while the page stays open.
  useEffect(() => { void reload(); const timer = setInterval(() => void reload(), 30_000); return () => clearInterval(timer); }, [reload, generation, securityRevision]);
  async function toggle(on: boolean) {
    setBusyButton('toggle'); setActionError('');
    try { setStatus(await invoke<AutoBackupStatus>('auto_backup_set_enabled', { enabled: on })); }
    catch (e) { setActionError(errorMessage(e)); void reload(); }
    finally { setBusyButton(null); }
  }
  async function openFolder() {
    setActionError('');
    try { await invoke('auto_backup_open_folder'); }
    catch (e) { setActionError('未能打开备份文件夹：' + errorMessage(e)); }
  }
  async function chooseExtra() {
    setBusyButton('extra'); setActionError('');
    try { const next = await invoke<AutoBackupStatus | null>('auto_backup_choose_extra'); if (next) setStatus(next); }
    catch (e) { setActionError('额外备份位置未更新：' + errorMessage(e)); void reload(); }
    finally { setBusyButton(null); }
  }
  async function clearExtra() {
    setBusyButton('extra'); setActionError('');
    try { setStatus(await invoke<AutoBackupStatus>('auto_backup_clear_extra')); }
    catch (e) { setActionError('额外备份位置未取消：' + errorMessage(e)); void reload(); }
    finally { setBusyButton(null); }
  }
  const restoreDisabled = busy || candidateOpen || blocked || demo || !generation;
  return <div className="auto-backup" aria-labelledby="auto-backup-heading">
    <div className="auto-backup-head">
      <div><h3 id="auto-backup-heading">{t('自动备份')}</h3><p>{t('有改动时自动保存在这台电脑，保留最近 7 份。')}</p></div>
      {status && <Switch label={t('自动备份')} value={status.enabled} disabled={busyButton === 'toggle'} onChange={on => void toggle(on)}/>}
    </div>
    {status && <p className="auto-backup-status">{autoBackupSummary(status)}<button disabled={busyButton !== null} onClick={() => void openFolder()}>{t('打开备份文件夹')}</button></p>}
    {paused && <p className="notice" role="status">{t('自动备份等待备份安全设置确认：确认前不生成新备份，也不复制到额外位置。请在上方「备份安全」中选择。')}</p>}
    {status?.last_error && <p className="notice error" role="alert">{t('上次自动备份未完成（{v1}）：{message}。已有备份保留，稍后自动重试。', { v1: formatWhen(status.last_error.at), message: status.last_error.message })}</p>}
    {status && status.items.length > 0 && <ul className="auto-backup-list">
      {status.items.map(item => <li key={item.name}><span>{item.date}{item.name.endsWith('.thingary.age') ? t(' · 已加密') : ''}</span><span className="muted">{formatBytes(item.size)}</span><button disabled={restoreDisabled} onClick={() => onInspect(item.name)}>{t('恢复…')}</button></li>)}
    </ul>}
    <div className="auto-backup-extra">
      <h3>{t('额外备份位置')}</h3>
      {status?.extra_dir
        ? <><p className="auto-backup-path" title={status.extra_dir}>{status.extra_dir}</p><p className={status.extra_last_error ? 'auto-backup-extra-error' : 'muted'}>{extraSummary(status)}</p><div className="auto-backup-extra-actions"><button disabled={busyButton !== null} onClick={() => void chooseExtra()}>{t('更改…')}</button><button disabled={busyButton !== null} onClick={() => void clearExtra()}>{t('取消')}</button></div></>
        : <><p className="muted">{t('未设置。可另选一个文件夹（如 iCloud 云盘、外接盘），每次自动备份后再复制一份过去。')}</p><button disabled={busyButton !== null} onClick={() => void chooseExtra()}>{t('选择…')}</button></>}
    </div>
    {loadError && <p className="notice error" role="alert">{t('自动备份状态读取失败：{loadError}', { loadError })}</p>}
    {actionError && <p className="notice error" role="alert">{actionError}</p>}
  </div>;
}
