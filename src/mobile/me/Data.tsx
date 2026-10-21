import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { autoBackupSummary, extraSummary, formatBytes, formatWhen } from '../../auto-backup-format';
import type { AutoBackupStatus } from '../../auto-backup-format';
import { looksLikeRecoveryKey, pauseNotice, RESTORE_DISCLOSURE } from '../../backup-security-format';
import type { SecurityStatus } from '../../backup-security-format';
import { preserveImportReceipt } from '../../financial-import';
import { SupportLink } from '../../SupportLink';
import { code, pendingKey, storedPending } from '../../wealth';
import { readGate } from '../home/read';
import type { Gate } from '../home/read';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import { Button, Card, ErrorState, FormGroup, ListGroup, ListRow, Loading, NavBar, LargeTitle, Notice, Sheet, Switch, TextAreaField } from '../ui';
import type { PageProps } from '../routes';
import { useBackupTask } from './backup-task';
import { pickBackupFile, shareBackup } from './files';
import type { Inspected } from './files';
import { MeIcon } from './icons';
import { autoBackupLabel, countLocalWork, restoreClearKeys, restoreLines, restoreTime, settingsTitles, writeLastBackup } from './model';
import { browserStorage } from './shared';
import Security from './Security';
import './me.css';

type Task = { kind: 'idle' } | { kind: 'running'; label: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };
const localKeys = (): string[] => { const keys: string[] = []; try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key) keys.push(key); } } catch { /* storage unavailable: nothing to clear */ } return keys; };

/** 数据管理 (design 24): 完整备份, 自动备份, 从备份恢复 and 备份安全, on the desktop backup commands. */
export default function Data({ params }: PageProps) {
  const nav = useNav(), session = useSession(), task = useBackupTask(), alive = task.alive;
  const [gate, setGate] = useState<Gate | null>(null), [demo, setDemo] = useState(false), [readError, setReadError] = useState('');
  const [state, setState] = useState<Task>({ kind: 'idle' }), [candidate, setCandidate] = useState<Inspected | null>(null), [unlockKey, setUnlockKey] = useState('');
  const [security, setSecurity] = useState<SecurityStatus | null>(null), [securityBusy, setSecurityBusy] = useState(false), [restoreUnknown, setRestoreUnknown] = useState(false);
  const [auto, setAuto] = useState<AutoBackupStatus | null>(null), [autoError, setAutoError] = useState(''), [autoBusy, setAutoBusy] = useState(false);
  const restoreLock = useRef(false), candidateRef = useRef<Inspected | null>(null);
  candidateRef.current = candidate;
  const focus = typeof params.focus === 'string' ? params.focus : '';

  const load = useCallback(() => {
    setReadError('');
    Promise.all([readGate(), invoke<{ active: boolean }>('demo_status')]).then(([nextGate, status]) => { setGate(nextGate); setDemo(status.active); }).catch(cause => setReadError(errorMessage(cause)));
  }, []);
  useEffect(load, [load]);
  const loadAuto = useCallback(() => invoke<AutoBackupStatus>('auto_backup_status').then(next => { setAuto(next); setAutoError(''); }).catch(cause => setAutoError(errorMessage(cause))), []);
  useEffect(() => { void loadAuto(); const timer = setInterval(() => void loadAuto(), 30_000); return () => clearInterval(timer); }, [loadAuto, security]);
  useEffect(() => () => { const token = candidateRef.current?.token; if (token && !restoreLock.current) void invoke('cancel_backup_session', { token }).catch(() => undefined); }, []);
  useEffect(() => { if (focus && gate) document.getElementById('data-' + focus)?.scrollIntoView({ block: 'start' }); }, [focus, gate]);

  const generation = gate?.counts.generation ?? null;
  const blocked = session.navBlocked || !!storedPending();
  const busy = state.kind === 'running';
  const locked = securityBusy || restoreUnknown || busy || !!candidate || blocked || demo || !generation;

  async function backup(plaintext: boolean) {
    if (locked) return;
    setCandidate(null); setState({ kind: 'running', label: plaintext ? '正在导出未加密副本…' : '正在生成并校验完整备份…' });
    try {
      const done = await task.withTask(taskId => shareBackup(plaintext, taskId));
      if (done) writeLastBackup(browserStorage(), new Date());
      setState(done ? { kind: 'done', text: plaintext ? `已导出未加密副本「${done.name}」。仅本次例外；自动备份仍按已开启的加密策略执行。` : `已保存并校验「${done.name}」。` } : { kind: 'idle' });
    } catch (cause) { if (alive.current) setState({ kind: 'error', text: code(cause) === 'CANCELLED' ? '已取消，原成品保留。' : '备份未完成，当前资料未改变：' + errorMessage(cause) }); }
  }
  async function inspect() {
    if (locked) return;
    setCandidate(null); setState({ kind: 'running', label: '正在检查备份，当前资料不会改变…' });
    try {
      const found = await task.withTask(taskId => pickBackupFile(taskId));
      if (!alive.current) { if (found?.token) void invoke('cancel_backup_session', { token: found.token }).catch(() => undefined); return; }
      if (found) { candidateRef.current = found; setCandidate(found); setUnlockKey(''); }
      setState({ kind: 'idle' });
    } catch (cause) { if (alive.current) setState({ kind: 'error', text: code(cause) === 'CANCELLED' ? '已取消，原成品保留。' : '这个备份不能用于恢复，当前资料未改变：' + errorMessage(cause) }); }
  }
  async function inspectAuto(name: string) {
    if (locked) return;
    setCandidate(null); setState({ kind: 'running', label: '正在检查自动备份，当前资料不会改变…' });
    try {
      const found = await task.withTask(taskId => invoke<Inspected>('inspect_auto_backup', { name, taskId }));
      if (!alive.current) { if (found.token) void invoke('cancel_backup_session', { token: found.token }).catch(() => undefined); return; }
      candidateRef.current = found; setCandidate(found); setUnlockKey(''); setState({ kind: 'idle' });
    } catch (cause) { if (alive.current) setState({ kind: 'error', text: code(cause) === 'CANCELLED' ? '已取消，原成品保留。' : '这个备份不能用于恢复，当前资料未改变：' + errorMessage(cause) }); }
  }
  async function unlock() {
    if (!candidate?.encrypted || !candidate.token) return;
    const token = candidate.token;
    setState({ kind: 'running', label: '正在用恢复密钥解密并检查备份…' });
    try {
      const unlocked = await task.withTask(taskId => invoke<Inspected>('unlock_backup_session', { token, keyText: unlockKey, taskId }));
      if (!alive.current || candidateRef.current?.token !== token) return;
      setCandidate({ ...candidate, encrypted: false, summary: unlocked.summary }); setUnlockKey(''); setState({ kind: 'idle' });
    } catch (cause) { if (alive.current) { setUnlockKey(''); setState({ kind: 'error', text: code(cause) === 'CANCELLED' ? '已取消，原成品保留。' : '无法解密，请核对恢复密钥或备份完整性。当前资料未改变。' }); } }
  }
  async function cancelCandidate() {
    if (restoreUnknown || restoreLock.current) return;
    const token = candidate?.token;
    setCandidate(null); setUnlockKey('');
    if (token) { try { await invoke('cancel_backup_session', { token }); } catch { /* session cleanup is best effort */ } }
  }
  function completeRestore() {
    for (const key of restoreClearKeys(localKeys())) { try { if (key === pendingKey && preserveImportReceipt(localStorage.getItem(key))) continue; localStorage.removeItem(key); } catch { /* reload still invalidates by generation */ } }
    location.reload();
  }
  async function restore() {
    if (restoreUnknown || restoreLock.current || securityBusy || !candidate?.token || !candidate.summary || !generation || busy || demo || storedPending()) return;
    restoreLock.current = true;
    setState({ kind: 'running', label: '正在恢复：先保护当前资料，再整体切换…' });
    try { await invoke<string>('restore_backup_session', { token: candidate.token }); completeRestore(); }
    catch (cause) { if (alive.current) { setRestoreUnknown(true); setState({ kind: 'error', text: '恢复结果尚未确认：' + errorMessage(cause) + ' 请只读核对原检查会话，不要重新恢复。' }); } }
    finally { restoreLock.current = false; }
  }
  async function verifyRestore() {
    if (!candidate?.token || restoreLock.current || busy) return;
    restoreLock.current = true;
    setState({ kind: 'running', label: '正在只读核对原恢复会话…' });
    try {
      const result = await invoke<string | null>('backup_session_result', { token: candidate.token });
      if (!alive.current) return;
      if (result) completeRestore(); else { setRestoreUnknown(false); setState({ kind: 'done', text: '核对完成：原会话尚未恢复。可取消，或重新明确确认替换。' }); }
    } catch (cause) { if (alive.current) setState({ kind: 'error', text: '暂时无法确认恢复结果；原会话已保留，请重新启动后核对当前资料。' + errorMessage(cause) }); }
    finally { restoreLock.current = false; }
  }
  async function toggleAuto(enabled: boolean) {
    setAutoBusy(true); setAutoError('');
    try { setAuto(await invoke<AutoBackupStatus>('auto_backup_set_enabled', { enabled })); } catch (cause) { setAutoError(errorMessage(cause)); void loadAuto(); } finally { setAutoBusy(false); }
  }

  const pendingWork = countLocalWork(localKeys());
  const pause = pauseNotice(security);
  const encrypted = security?.state === 'enabled';
  return <div className="m-page">
    <NavBar/>
    <LargeTitle title="数据管理" subtitle="主资料保存在这台手机"/>
    {readError ? <ErrorState title="资料库读取失败" message={readError} onRetry={load}/> : !gate ? <Loading/> : <>
      {demo && <Notice>当前是独立样例库。切换到「我的资料」后可备份、恢复与导出。</Notice>}
      {blocked && !demo && <Notice>请先处理正在编辑或待核对的内容，再进行备份或恢复。</Notice>}
      <p className="m-group-footer"><SupportLink target="backup">备份与恢复说明</SupportLink></p>

      <section id="data-backup" className="m-list-group" aria-label="完整备份">
        <Card label="完整备份">
          <div className="me-card-head"><span className="m-row-icon m-tone-accent"><MeIcon name="database"/></span><div><h2>完整备份</h2><p>保存物品、财富记录和图片等全部资料。{encrypted ? '已按备份安全设置加密导出。' : ''}</p></div></div>
          <div className="me-stack">
            <Button variant="primary" block disabled={locked} onClick={() => void backup(false)}>立即备份并分享…</Button>
            {encrypted && <Button block disabled={locked} onClick={() => void backup(true)}>导出未加密副本…</Button>}
          </div>
        </Card>
      </section>

      <ListGroup title="自动备份" footer="有改动时自动保存在这台手机，保留最近 7 份。与手动备份格式相同，都可用于恢复。">
        <ListRow icon="refresh" tone="positive" title="自动备份" subtitle={auto ? autoBackupSummary(auto) : autoError ? '状态读取失败' : '正在读取…'} trailing={auto ? <Switch label="自动备份" checked={auto.enabled} disabled={autoBusy} onChange={on => void toggleAuto(on)}/> : undefined}/>
        {auto?.items.map(item => { const label = autoBackupLabel(item, session.today); return <ListRow key={item.name} icon="clock" tone="neutral" title={label.title} subtitle={`${label.sub} · ${formatBytes(item.size)}`} value="恢复…" disabled={locked} onClick={() => void inspectAuto(item.name)}/>; })}
      </ListGroup>
      {pause && <Notice>{pause}</Notice>}
      {auto?.last_error && <Notice tone="danger">上次自动备份未完成（{formatWhen(auto.last_error.at)}）：{auto.last_error.message}。已有备份保留，稍后自动重试。</Notice>}
      {auto?.extra_dir && <Notice>{extraSummary(auto)}</Notice>}
      {autoError && <Notice tone="danger">自动备份状态读取失败：{autoError}</Notice>}

      <section id="data-restore" className="m-list-group" aria-label="从备份恢复">
        <Card label="从备份恢复">
          <div className="me-card-head"><span className="m-row-icon m-tone-warn"><MeIcon name="download"/></span><div><h2>从备份恢复</h2><p>先检查文件，再确认是否替换当前资料。</p></div></div>
          <Button block disabled={locked} onClick={() => void inspect()}>选择备份文件…</Button>
        </Card>
      </section>

      <Security demo={demo} blocked={busy || restoreUnknown || blocked || !!candidate} onStatusChange={setSecurity} onBusyChange={setSecurityBusy}/>

      <ListGroup title="更多">
        <ListRow icon="trash" tone="danger" title="最近删除" subtitle="找回误删的物品、心愿、记录与账户" disabled={locked && !demo && (busy || restoreUnknown)} onClick={() => nav.push('me.settings', { page: 'trash' }, { title: settingsTitles.trash })}/>
        <ListRow icon={<MeIcon name="table"/>} tone="positive" title="导出表格" subtitle="一份 Excel 工作簿，不能用于恢复" onClick={() => nav.push('me.settings', { page: 'export' }, { title: settingsTitles.export })}/>
        <ListRow icon={<MeIcon name="sparkles"/>} tone="accent" title="样例体验" onClick={() => nav.push('me.settings', { page: 'demo' }, { title: settingsTitles.demo })}/>
      </ListGroup>

      {task.activeTask && <div className="me-pad"><Button disabled={!!task.notice} onClick={() => void task.cancel()}>取消本次备份操作</Button>{task.notice && <p role="status" className="me-hint">{task.notice}</p>}</div>}
      {state.kind === 'running' && <Notice>{state.label}</Notice>}
      {state.kind === 'done' && <Notice tone="positive">{state.text}</Notice>}
      {state.kind === 'error' && <Notice tone="danger">{state.text}</Notice>}
      {restoreUnknown && <Button block disabled={busy} onClick={() => void verifyRestore()}>核对恢复结果</Button>}
      <p className="m-group-footer">完整备份包含物品、维护、保障、心愿、账户与盘点、支出、周期计划、虚拟资产、分类渠道、素材、最近删除及托管原图，可用于恢复。恢复前会检查所选备份，并保护当前资料。</p>
    </>}

    {candidate?.encrypted && <Sheet title="加密备份" doneLabel="取消" onClose={() => { if (!busy) void cancelCandidate(); }}>
      <div className="m-page">
        <Notice>「{candidate.name}」是加密备份。输入对应的恢复密钥后才能检查内容；密钥只在本次解密中使用，不会保存。</Notice>
        <FormGroup><TextAreaField label="恢复密钥" rows={2} value={unlockKey} disabled={busy} placeholder="AGE-SECRET-KEY-1…" onChange={setUnlockKey}/></FormGroup>
        {unlockKey && !looksLikeRecoveryKey(unlockKey).ok && <Notice tone="danger">{looksLikeRecoveryKey(unlockKey).reason}</Notice>}
        <Button variant="primary" block disabled={busy || !looksLikeRecoveryKey(unlockKey).ok} onClick={() => void unlock()}>解密并检查</Button>
        {state.kind === 'running' && <Notice>{state.label}</Notice>}
        {state.kind === 'error' && <Notice tone="danger">{state.text}</Notice>}
      </div>
    </Sheet>}
    {candidate && !candidate.encrypted && candidate.summary && <Sheet title="替换当前资料？" doneLabel="取消" onClose={() => { if (!busy && !restoreUnknown) void cancelCandidate(); }}>
      <div className="m-page">
        <Notice tone="danger">用「{candidate.name}」替换当前全部资料？备份时间 {restoreTime(candidate.summary)} · 格式版本 {candidate.summary.schema}</Notice>
        <ListGroup title="这个备份包含">{restoreLines(candidate.summary).map(line => <ListRow key={line} title={line}/>)}</ListGroup>
        <p className="m-group-footer">检查已通过。当前资料会先保存保护副本，失败时保持原样。{pendingWork > 0 && `本机还有 ${pendingWork} 份属于当前资料的草稿或待核对操作，恢复后旧输入失效；结果未知的导入请求仍保留供核对。`}</p>
        <p className="m-group-footer">{RESTORE_DISCLOSURE}</p>
        {candidate.summary.planning_conditions_reset && <Notice>恢复时会保留物品、账户、盘点及实际发生记录；旧退休政策资料会移除，规划时间和未来收入请重新确认。</Notice>}
        <Button variant="danger" block disabled={busy || restoreUnknown} onClick={() => void restore()}>确认替换当前资料</Button>
        {state.kind === 'running' && <Notice>{state.label}</Notice>}
        {state.kind === 'error' && <Notice tone="danger">{state.text}</Notice>}
        {restoreUnknown && <Button block disabled={busy} onClick={() => void verifyRestore()}>核对恢复结果</Button>}
      </div>
    </Sheet>}
  </div>;
}
