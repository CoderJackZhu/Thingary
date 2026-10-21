import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import { pendingGenerations, resetKey } from '../../../library-mode';
import type { DemoStatus } from '../../../library-mode';
import { storedPending } from '../../../wealth';
import { useSession } from '../../session';
import { Button, ErrorState, ListGroup, ListRow, Loading, Notice, Sheet } from '../../ui';
import { useEffect } from 'react';
import { MeIcon } from '../icons';
import { SettingsShell } from './Shell';

/** 样例体验: switch to or from the fictional sample library and reset it (`switch_demo`, `reset_demo`). */
export default function DemoPage() {
  const session = useSession();
  const [status, setStatus] = useState<DemoStatus | null>(null), [readError, setReadError] = useState('');
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(() => { try { return !!localStorage.getItem(resetKey); } catch { return false; } });
  const load = () => invoke<DemoStatus>('demo_status').then(setStatus).catch(cause => setReadError(errorMessage(cause)));
  useEffect(() => { void load(); }, []);
  const blocked = session.navBlocked || !!storedPending() || pendingGenerations(localStorage).length > 0;
  async function run(action: 'switch' | 'reset') {
    if (busy || !status) return;
    if (blocked) { setError('请先完成当前操作或核对保存结果，再切换或重置样例。'); return; }
    setBusy(true); setError('');
    try {
      if (action === 'reset') {
        const requestId = localStorage.getItem(resetKey) || crypto.randomUUID();
        localStorage.setItem(resetKey, requestId);
        await invoke('reset_demo', { requestId });
        localStorage.removeItem(resetKey);
      } else await invoke('switch_demo', { demo: !status.active });
      location.reload();
    } catch (cause) { setError(errorMessage(cause)); setBusy(false); setPending(!!localStorage.getItem(resetKey)); setConfirm(false); }
  }
  return <SettingsShell title="样例体验" lead="用一套完整的虚构样例体验物品、心愿、账户盘点和周期费用。可以放心编辑和删除，样例不影响自己的资料。">
    {readError ? <ErrorState title="样例状态读取失败" message={readError} onRetry={() => { setReadError(''); void load(); }}/> : !status ? <Loading/> : <>
      <ListGroup title={status.active ? '正在查看样例' : '独立虚构资料'} footer="样例不接受新增物品；点新增物品会回到自己的资料。">
        <ListRow icon={<MeIcon name="home"/>} title={status.active ? '返回我的资料' : '查看样例'} subtitle={status.active ? '回到自己的记录，保留这次样例体验' : '保留上次样例中的修改，随时回来看看'} disabled={busy || blocked || pending} onClick={() => void run('switch')}/>
        <ListRow icon="refresh" tone="danger" title={pending ? '核对重置结果' : '重置样例…'} subtitle="重新生成完整样例；自己的资料不受影响" disabled={busy || blocked} onClick={() => pending ? void run('reset') : setConfirm(true)}/>
      </ListGroup>
      {pending && <Notice>上次重置的结果尚待核对，请按原操作核对；自己的资料不会被替换。</Notice>}
      {blocked && <Notice>请先完成当前操作或核对保存结果，再切换或重置样例。</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </>}
    {confirm && !pending && <Sheet title="重置样例" doneLabel="取消" onClose={() => { if (!busy) setConfirm(false); }}>
      <div className="m-page">
        <Notice>样例中的编辑和删除会清除，恢复为以今天为基准的完整虚构资料。</Notice>
        <Button variant="danger" block disabled={busy || blocked} onClick={() => void run('reset')}>{busy ? '正在重置…' : '确认重置样例'}</Button>
      </div>
    </Sheet>}
  </SettingsShell>;
}
