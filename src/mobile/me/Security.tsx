import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { looksLikeRecoveryKey, securitySummary, STATE_LABELS } from '../../backup-security-format';
import type { KeySetupStarted, SecurityStatus } from '../../backup-security-format';
import { Button, FormGroup, ListGroup, ListRow, Notice, Sheet, TextAreaField } from '../ui';
import { useBackupTask } from './backup-task';
import { MeIcon } from './icons';
import { downloadText, recoveryKeyFile } from './files';

type Props = { demo: boolean; blocked: boolean; onStatusChange: (status: SecurityStatus) => void; onBusyChange: (busy: boolean) => void };

/** Re-entering a recovery key: type, paste or pick the saved key file (read in the page only to fill the same field). */
function KeyInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const request = useRef(0);
  useEffect(() => () => { ++request.current; }, []);
  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const mine = ++request.current, file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) { onChange('__TOO_LARGE__'); return; }
    try { const text = await file.text(); if (mine === request.current) onChange(text); } catch { if (mine === request.current) onChange('__UNREADABLE__'); }
  }
  return <>
    <FormGroup><TextAreaField label="恢复密钥" rows={2} value={value.startsWith('__') ? '' : value} disabled={disabled} placeholder="AGE-SECRET-KEY-1…" onChange={onChange}/></FormGroup>
    {value === '__UNREADABLE__' && <Notice tone="danger">恢复密钥文件无法读取，请重新选择</Notice>}
    {value === '__TOO_LARGE__' && <Notice tone="danger">恢复密钥文件过大，无法识别</Notice>}
    {value && !value.startsWith('__') && !looksLikeRecoveryKey(value).ok && <Notice tone="danger">{looksLikeRecoveryKey(value).reason}</Notice>}
    <label className="me-file"><span className="m-button m-button-secondary m-block">选择密钥文件</span><input type="file" accept=".txt,text/plain" disabled={disabled} onChange={event => void pick(event)}/></label>
  </>;
}

/** 备份安全: encrypt exported backups with a recovery key. The key is generated in a short backend session, shown once, and only the re-entered copy is accepted back. */
export default function Security({ demo, blocked, onStatusChange, onBusyChange }: Props) {
  const [status, setStatus] = useState<SecurityStatus | null>(null), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [setup, setSetup] = useState<KeySetupStarted | null>(null), [reentered, setReentered] = useState(''), [saved, setSaved] = useState(false), [copied, setCopied] = useState(false);
  const [plaintext, setPlaintext] = useState(false), [fromKey, setFromKey] = useState(false), [enableKey, setEnableKey] = useState('');
  const task = useBackupTask(), alive = task.alive, lock = useRef(false), setupRef = useRef<KeySetupStarted | null>(null), request = useRef(0);
  setupRef.current = setup;
  useEffect(() => () => { const active = setupRef.current; if (active) void invoke('backup_security_cancel_setup', { sessionId: active.session_id }).catch(() => undefined); }, []);
  useEffect(() => { onBusyChange(busy || !!setup || plaintext || fromKey); return () => onBusyChange(false); }, [busy, setup, plaintext, fromKey, onBusyChange]);
  const reload = useCallback(async () => {
    const mine = ++request.current;
    try { const next = await invoke<SecurityStatus>('backup_security_status'); if (alive.current && mine === request.current) { setStatus(next); setLoadError(''); } }
    catch (cause) { if (alive.current && mine === request.current) setLoadError(errorMessage(cause)); }
  }, [alive]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (status) { onStatusChange(status); window.dispatchEvent(new Event('thingary-backup-security-changed')); } }, [status, onStatusChange]);

  function closeSetup(cancelled?: boolean) {
    if (setup && cancelled) void invoke('backup_security_cancel_setup', { sessionId: setup.session_id }).catch(() => undefined);
    setupRef.current = null; setSetup(null); setReentered(''); setSaved(false); setCopied(false); setFromKey(false); setEnableKey('');
    if (cancelled) void reload();
  }
  async function run<T>(action: () => Promise<T>, done?: (value: T) => void) {
    if (lock.current || blocked || demo) return;
    lock.current = true; setBusy(true); setError('');
    try { const value = await action(); if (alive.current) done?.(value); }
    catch (cause) {
      if (alive.current) {
        if ((cause as { code?: string })?.code === 'CANCELLED') { closeSetup(true); setError('已取消本次备份，原成品保留。加密策略可能已验证提交，请核对当前最新状态与首份备份结果。'); }
        else setError(errorMessage(cause));
      }
    } finally { lock.current = false; if (alive.current) { setBusy(false); void reload(); } }
  }
  const beginSetup = async () => {
    const started = await invoke<KeySetupStarted>('backup_security_begin_setup');
    if (!alive.current) { await invoke('backup_security_cancel_setup', { sessionId: started.session_id }).catch(() => undefined); return; }
    setupRef.current = started; setSetup(started);
  };
  async function copyKey() {
    if (!setup) return;
    try { await navigator.clipboard.writeText(setup.recovery_key); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError('未能复制，请手动选中密钥文本复制。'); }
  }
  function saveKey() {
    if (!setup) return;
    const file = recoveryKeyFile(setup.recovery_key, setup.recipient_id);
    downloadText(file.name, file.text); setSaved(true);
  }
  const disabled = busy || blocked || demo;
  const state = status?.state;
  return <ListGroup title="备份安全" footer="用恢复密钥加密导出的备份；密钥由你保管，应用只保存公钥。">
    <ListRow icon="shield" tone={state === 'enabled' ? 'positive' : state === 'needs_attention' ? 'danger' : 'warn'} title={status ? STATE_LABELS[status.state] : '正在读取…'} subtitle={status ? securitySummary(status) : undefined}/>
    {state === 'unconfigured' && <>
      <ListRow icon={<MeIcon name="lock"/>} title="启用加密…" subtitle="自动备份已暂停，选择后才会继续" disabled={disabled} onClick={() => void run(beginSetup)}/>
      <ListRow icon="doc" title="继续明文" disabled={disabled} onClick={() => setPlaintext(true)}/>
    </>}
    {state === 'restore_review_required' && <>
      <ListRow icon={<MeIcon name="lock"/>} title="用恢复密钥启用…" subtitle="刚从加密备份恢复，请确认后续备份方式" disabled={disabled} onClick={() => setFromKey(true)}/>
      <ListRow icon="refresh" title="生成新密钥…" disabled={disabled} onClick={() => void run(beginSetup)}/>
      <ListRow icon="doc" title="以后明文备份" disabled={disabled} onClick={() => setPlaintext(true)}/>
    </>}
    {state === 'needs_attention' && <>
      <ListRow icon="refresh" title="重新读取配置" subtitle={`${status?.reason ?? '备份安全配置异常'}。自动备份已暂停，不会回退明文`} disabled={disabled} onClick={() => void reload()}/>
      <ListRow icon="doc" title="修复为明文" disabled={disabled} onClick={() => setPlaintext(true)}/>
    </>}
    {state === 'disabled' && <ListRow icon={<MeIcon name="lock"/>} title="开启加密…" disabled={disabled} onClick={() => void run(beginSetup)}/>}
    {state === 'enabled' && <>
      <ListRow icon="refresh" title="轮换密钥…" disabled={disabled} onClick={() => void run(beginSetup)}/>
      <ListRow icon={<MeIcon name="lock"/>} tone="danger" title="关闭加密" disabled={disabled} onClick={() => setPlaintext(true)}/>
    </>}
    {(loadError || error) && <div className="me-pad"><Notice tone="danger">{error || `备份安全状态读取失败：${loadError}`}</Notice></div>}
    {task.activeTask && <div className="me-pad"><Button onClick={() => void task.cancel()} disabled={!!task.notice}>取消本次加密备份</Button>{task.notice && <p role="status" className="me-hint">{task.notice}</p>}</div>}

    {plaintext && status && <Sheet title={status.state === 'enabled' ? '关闭加密备份？' : status.state === 'needs_attention' ? '修复为明文？' : '今后的备份将为明文？'} doneLabel="取消" onClose={() => setPlaintext(false)}>
      <div className="m-page">
        <Notice>云盘或外接盘上只会得到未加密的备份文件。已有的加密备份不会被删除或改写，仍需要对应的恢复密钥才能打开。自动备份开关保持现状。</Notice>
        <Button variant="danger" block disabled={disabled} onClick={() => { setPlaintext(false); void run(() => invoke<SecurityStatus>(status.state === 'enabled' ? 'backup_security_disable' : 'backup_security_choose_plaintext')); }}>确认{status.state === 'enabled' ? '关闭加密' : status.state === 'needs_attention' ? '修复为明文' : '继续明文'}</Button>
      </div>
    </Sheet>}
    {fromKey && <Sheet title="用恢复密钥启用" doneLabel="取消" onClose={() => { if (!busy) closeSetup(); }}>
      <div className="m-page">
        <Notice>重新输入恢复密钥进行验证。应用只保存派生的公钥，不保留这份私钥。</Notice>
        <KeyInput value={enableKey} onChange={setEnableKey} disabled={disabled}/>
        <Button variant="primary" block disabled={disabled || !looksLikeRecoveryKey(enableKey).ok} onClick={() => void run(() => task.withTask(taskId => invoke<SecurityStatus>('backup_security_enable_from_key', { keyText: enableKey, taskId })), () => closeSetup())}>验证并启用</Button>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>}
    {setup && <Sheet title={status?.state === 'enabled' ? '轮换恢复密钥' : '启用加密备份'} doneLabel="取消" onClose={() => { if (!busy) closeSetup(true); }}>
      <div className="m-page">
        <Notice>下面是这次生成的恢复密钥，只显示一次。丢失后无法找回，也无法解密已生成的备份；请勿与备份文件存放在一起。</Notice>
        <FormGroup footer={`公钥标识 ${setup.recipient_id.slice(0, 8)}（界面只显示前 8 位）`}><p className="me-key" aria-label="恢复密钥">{setup.recovery_key}</p></FormGroup>
        <div className="me-stack"><Button block onClick={() => void copyKey()}>{copied ? '已复制' : '复制密钥'}</Button><Button block disabled={disabled} onClick={saveKey}>{saved ? '已保存密钥文件' : '保存密钥文件'}</Button></div>
        <p className="m-group-footer">确认已自行保存后，重新输入或选择这份恢复密钥完成验证。</p>
        <KeyInput value={reentered} onChange={setReentered} disabled={disabled}/>
        <Button variant="primary" block disabled={disabled || !looksLikeRecoveryKey(reentered).ok} onClick={() => void run(
          () => task.withTask(taskId => invoke<SecurityStatus>('backup_security_confirm_setup', { sessionId: setup.session_id, keyText: reentered, taskId })),
          next => { setupRef.current = null; setSetup(null); setReentered(''); setSaved(false); if (next.first_backup?.state === 'failed') setError('加密已开启，但首份加密备份失败：' + next.first_backup.message); },
        )}>验证并开启加密</Button>
        <p className="m-group-footer">验证通过后会立即生成首份加密备份。验证成功不等于备份成功，两者分别显示。</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button variant="plain" block disabled={busy} onClick={() => closeSetup(true)}>作废本次密钥</Button>
      </div>
    </Sheet>}
  </ListGroup>;
}
