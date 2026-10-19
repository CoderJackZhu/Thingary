import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { looksLikeRecoveryKey, securitySummary, STATE_LABELS, type KeySetupStarted, type SecurityStatus } from './backup-security-format';

/** The backup-security panel inside 数据管理. Policy is machine-local and
 * readable in sample mode; changing it needs 我的资料. The recovery key is
 * generated in a short backend session, shown exactly once, and only the
 * re-entered copy is accepted back. */
export function BackupSecurity({ demo, blocked, onStatusChange, onBusyChange }: { demo: boolean; blocked: boolean; onStatusChange: (status: SecurityStatus) => void; onBusyChange: (busy: boolean) => void }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null), [loadError, setLoadError] = useState('');
  const [activeTask, setActiveTask] = useState<string | null>(null), [taskNotice, setTaskNotice] = useState('');
  const activeTaskRef = useRef<{ id: string; requested: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  // The key-setup dialog holds the one-time secret until the user confirms.
  const [setup, setSetup] = useState<KeySetupStarted | null>(null), [reentered, setReentered] = useState('');
  const [savedKeyFile, setSavedKeyFile] = useState<string | null>(null), [copied, setCopied] = useState(false);
  const [confirmPlaintext, setConfirmPlaintext] = useState(false);
  const [enableFromKey, setEnableFromKey] = useState(false), [enableKey, setEnableKey] = useState('');
  const alive = useRef(true), actionLock = useRef(false), setupRef = useRef<KeySetupStarted | null>(null), statusRequest = useRef(0);
  setupRef.current = setup;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; ++statusRequest.current;
      const task = activeTaskRef.current;
      if (task && !task.requested) { task.requested = true; void invoke('backup_task_cancel', { taskId: task.id }).catch(() => undefined); }
      const active = setupRef.current;
      if (active) void invoke('backup_security_cancel_setup', { sessionId: active.session_id }).catch(() => undefined);
    };
  }, []);
  useEffect(() => { onBusyChange(busy || !!setup || confirmPlaintext || enableFromKey); return () => onBusyChange(false); }, [busy, setup, confirmPlaintext, enableFromKey, onBusyChange]);
  const reenteredRef = useRef<HTMLTextAreaElement | null>(null);
  const reload = useCallback(async () => {
    const request = ++statusRequest.current;
    try { const next = await invoke<SecurityStatus>('backup_security_status'); if (alive.current && request === statusRequest.current) { setStatus(next); setLoadError(''); } }
    catch (e) { if (alive.current && request === statusRequest.current) setLoadError(errorMessage(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (status) { onStatusChange(status); window.dispatchEvent(new Event('thingary-backup-security-changed')); } }, [status, onStatusChange]);
  async function run<T>(action: () => Promise<T>, onDone?: (value: T) => void) {
    if (actionLock.current || blocked || demo) return;
    actionLock.current = true; setBusy(true); setActionError('');
    try { const value = await action(); if (alive.current) onDone?.(value); }
    catch (e) { if (alive.current) { if ((e as { code?: string })?.code === 'CANCELLED') { closeSetup('cancel'); setActionError('已取消本次备份，原成品保留。加密策略可能已验证提交，请核对当前最新状态与首份备份结果。'); } else setActionError(errorMessage(e)); } }
    finally { actionLock.current = false; if (alive.current) { setBusy(false); void reload(); } }
  }
  async function withBackupTask<T>(action: (taskId: string) => Promise<T>): Promise<T> {
    const taskId = await invoke<string>('backup_task_begin');
    if (!alive.current) { await invoke('backup_task_cancel', { taskId }).catch(() => undefined); throw { code: 'CANCELLED', message: '已取消' }; }
    activeTaskRef.current = { id: taskId, requested: false }; setActiveTask(taskId); setTaskNotice('');
    try { return await action(taskId); }
    finally { if (activeTaskRef.current?.id === taskId) { activeTaskRef.current = null; if (alive.current) { setActiveTask(null); setTaskNotice(''); } } }
  }
  async function cancelTask() {
    const task = activeTaskRef.current;
    if (!task || task.requested) return;
    task.requested = true; setTaskNotice('正在请求取消，请等待原操作收尾');
    try {
      const accepted = await invoke<boolean>('backup_task_cancel', { taskId: task.id });
      if (alive.current && activeTaskRef.current?.id === task.id) setTaskNotice(accepted ? '正在取消，请等待清理' : '本次操作已发布或完成，请等待原结果');
    } catch { if (alive.current && activeTaskRef.current?.id === task.id) setTaskNotice('未能确认取消请求，请等待原操作结果'); }
  }
  async function beginSetup() {
    const started = await invoke<KeySetupStarted>('backup_security_begin_setup');
    if (!alive.current) { await invoke('backup_security_cancel_setup', { sessionId: started.session_id }).catch(() => undefined); return; }
    setupRef.current = started; setSetup(started);
  }
  function closeSetup(cancelled?: string) {
    if (setup && cancelled) void invoke('backup_security_cancel_setup', { sessionId: setup.session_id }).catch(() => undefined);
    setupRef.current = null; setSetup(null); setReentered(''); setSavedKeyFile(null); setCopied(false); setEnableFromKey(false); setEnableKey('');
    if (cancelled) void reload();
  }
  async function copyKey() {
    if (!setup) return;
    try { await navigator.clipboard.writeText(setup.recovery_key); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setActionError('未能复制，请手动选中密钥文本复制。'); }
  }
  async function saveKeyFile() {
    if (!setup || actionLock.current || blocked || demo) return;
    actionLock.current = true; setBusy(true);
    try {
      const id = setup.session_id;
      const path = await invoke<string | null>('backup_security_export_key', { sessionId: id });
      if (alive.current && setupRef.current?.session_id === id && path) setSavedKeyFile(path);
    } catch (e) { if (alive.current) setActionError('恢复密钥文件未保存：' + errorMessage(e)); }
    finally { actionLock.current = false; if (alive.current) setBusy(false); }
  }
  const disabled = busy || blocked || demo;
  return <div className="backup-security" aria-labelledby="backup-security-heading">
    <div className="backup-security-head">
      <div><h3 id="backup-security-heading">备份安全</h3><p>用恢复密钥加密导出的备份；密钥由你保管，应用只保存公钥。</p></div>
      {status && <span className={'backup-security-state ' + status.state}>{STATE_LABELS[status.state]}</span>}
    </div>
    {status && <p className="backup-security-summary">{securitySummary(status)}</p>}
    {status?.state === 'unconfigured' && <div className="backup-security-choice" role="group" aria-label="选择备份安全方式">
      <p className="notice">自动与额外备份已暂停。选择后才会继续；已有备份不受影响。</p>
      <div className="backup-security-choice-actions">
        <button className="primary" disabled={disabled} onClick={() => void run(() => beginSetup())}>启用加密…</button>
        <button disabled={disabled} onClick={() => setConfirmPlaintext(true)}>继续明文</button>
      </div>
    </div>}
    {status?.state === 'restore_review_required' && <div className="backup-security-choice" role="group" aria-label="确认本机备份策略">
      <p className="notice">刚从加密备份恢复，本机没有可用的加密策略。自动与额外备份保持暂停，直到你确认后续备份方式。</p>
      <div className="backup-security-choice-actions">
        <button className="primary" disabled={disabled} onClick={() => setEnableFromKey(true)}>用恢复密钥启用…</button>
        <button disabled={disabled} onClick={() => void run(() => beginSetup())}>生成新密钥…</button>
        <button disabled={disabled} onClick={() => setConfirmPlaintext(true)}>以后明文备份</button>
      </div>
    </div>}
    {status?.state === 'needs_attention' && <div className="backup-security-choice">
      <p className="notice error" role="alert">{status.reason ?? '备份安全配置异常'}。自动与额外备份已暂停，不会回退明文；旧备份保持原样。</p>
      <div className="backup-security-choice-actions">
        <button disabled={disabled} onClick={() => void reload()}>重新读取配置</button>
        <button disabled={disabled} onClick={() => setConfirmPlaintext(true)}>修复为明文</button>
      </div>
    </div>}
    {status?.state === 'disabled' && <div className="backup-security-choice-actions">
      <button disabled={disabled} onClick={() => void run(() => beginSetup())}>开启加密…</button>
    </div>}
    {status?.state === 'enabled' && <div className="backup-security-choice-actions">
      <button disabled={disabled} onClick={() => void run(() => beginSetup())}>轮换密钥…</button>
      <button disabled={disabled} onClick={() => setConfirmPlaintext(true)}>关闭加密</button>
    </div>}
    {loadError && <p className="notice error" role="alert">备份安全状态读取失败：{loadError}</p>}
    {activeTask && <div className="actions"><button disabled={!!taskNotice} onClick={() => void cancelTask()}>取消本次加密备份</button>{taskNotice && <p role="status">{taskNotice}</p>}</div>}
    {actionError && <p className="notice error" role="alert">{actionError}</p>}
    {confirmPlaintext && status && <div className="confirm" role="alert">
      <strong>{status.state === 'enabled' ? '关闭加密备份？' : status.state === 'needs_attention' ? '修复为明文并继续？' : '今后的自动与额外备份将为明文？'}</strong>
      <p>云盘或外接盘上只会得到未加密的备份文件。已有的加密备份不会被删除或改写，仍需要对应的恢复密钥才能打开。</p>
      <p className="muted">自动备份开关保持现状；这一选择只决定是否加密，不会替你开启或关闭自动备份。</p>
      <div className="actions">
        <button disabled={busy} onClick={() => setConfirmPlaintext(false)}>取消</button>
        <button className="primary danger" disabled={disabled} onClick={() => { setConfirmPlaintext(false); void run(() => invoke<SecurityStatus>(status.state === 'enabled' ? 'backup_security_disable' : 'backup_security_choose_plaintext')); }}>确认{status.state === 'enabled' ? '关闭加密' : status.state === 'needs_attention' ? '修复为明文' : '继续明文'}</button>
      </div>
    </div>}
    {enableFromKey && <div className="confirm" role="alert">
      <strong>用恢复密钥启用本机加密</strong>
      <p>重新输入恢复密钥进行验证。应用只保存派生的公钥，不保留这份私钥。</p>
      <KeyInput busy={disabled} value={enableKey} onChange={setEnableKey} ref={reenteredRef}/>
      <div className="actions">
        <button disabled={busy} onClick={() => closeSetup()}>取消</button>
        <button className="primary" disabled={disabled || !looksLikeRecoveryKey(enableKey).ok} onClick={() => void run(() => withBackupTask(taskId => invoke<SecurityStatus>('backup_security_enable_from_key', { keyText: enableKey, taskId })), () => closeSetup())}>验证并启用</button>
      </div>
    </div>}
    {setup && <div className="confirm backup-security-setup" role="alert">
      <strong>{status?.state === 'enabled' ? '轮换恢复密钥' : '启用加密备份'}</strong>
      {savedKeyFile === null && <>
        <p className="notice">下面是这次生成的恢复密钥，只显示一次。丢失后无法找回，也无法解密已生成的备份；请勿与备份文件存放在一起。</p>
        <p className="backup-security-key" aria-label="恢复密钥">{setup.recovery_key}</p>
        <div className="backup-security-choice-actions">
          <button onClick={() => void copyKey()}>{copied ? '已复制' : '复制密钥'}</button>
          <button disabled={disabled} onClick={() => void saveKeyFile()}>保存密钥文件…</button>
        </div>
        <p className="muted">公钥标识 {setup.recipient_id.slice(0, 8)}（界面只显示前 8 位，核对始终使用完整摘要）。</p>
      </>}
      {savedKeyFile !== null && <p>密钥已保存到「{savedKeyFile}」。请妥善保管这份文件；它不会随应用或备份一起转移。</p>}
      <p>确认已自行保存后，重新输入或选择这份恢复密钥完成验证。</p>
      <KeyInput busy={disabled} value={reentered} onChange={setReentered} ref={reenteredRef}/>
      {reentered && !looksLikeRecoveryKey(reentered).ok && <p className="notice error" role="alert">{looksLikeRecoveryKey(reentered).reason}</p>}
      <div className="actions">
        <button disabled={busy} onClick={() => closeSetup('cancel')}>取消，作废本次密钥</button>
        <button className="primary" disabled={disabled || !looksLikeRecoveryKey(reentered).ok} onClick={() => void run(
          () => withBackupTask(taskId => invoke<SecurityStatus>('backup_security_confirm_setup', { sessionId: setup.session_id, keyText: reentered, taskId })),
          next => { setupRef.current = null; setSetup(null); setReentered(''); setSavedKeyFile(null); if (next.first_backup?.state === 'failed') setActionError('加密已开启，但首份加密备份失败：' + (next.first_backup.state === 'failed' ? next.first_backup.message : '')); },
        )}>验证并开启加密</button>
      </div>
      <p className="muted">验证通过后会立即生成首份加密备份，即使资料没有变化。验证成功不等于备份成功，两者分别显示。</p>
    </div>}
  </div>;
}

/** Re-entering a recovery key: paste, type, or pick an identity file. The
 * file is read in the page only to fill the same text field. */
export function KeyInput({ busy, value, onChange, ref }: { busy: boolean; value: string; onChange: (v: string) => void; ref?: React.RefObject<HTMLTextAreaElement | null> }) {
  const fileRequest = useRef(0);
  useEffect(() => () => { ++fileRequest.current; }, []);
  useEffect(() => { if (busy) ++fileRequest.current; }, [busy]);
  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const request = ++fileRequest.current;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) { onChange('__TOO_LARGE__'); return; }
    try { const text = await file.text(); if (request === fileRequest.current) onChange(text); }
    catch { if (request === fileRequest.current) onChange('__UNREADABLE__'); }
  }
  return <div className="backup-security-key-input">
    <textarea ref={ref} rows={2} spellCheck={false} autoComplete="off" disabled={busy} value={value.startsWith('__') ? '' : value} placeholder="AGE-SECRET-KEY-1…" onChange={e => { ++fileRequest.current; onChange(e.target.value); }} aria-label="恢复密钥"/>
    {value === '__UNREADABLE__' && <p className="notice error" role="alert">恢复密钥文件无法读取，请重新选择</p>}
    {value.startsWith('__TOO_LARGE__') && <p className="notice error" role="alert">恢复密钥文件过大，无法识别</p>}
    <label className="muted">或选择密钥文件 <input type="file" accept=".txt,text/plain" disabled={busy} onChange={e => void pickFile(e)}/></label>
  </div>;
}
