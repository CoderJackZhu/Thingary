// 资金流动明细列表（契约 §3；设计 §18.5）。「查看明细」面板：日期／账户筛选、
// 游标分页、修订删除与恢复；列表不依赖退休目标或两次盘点，但只有端口确认的区间才有损益。
// 空列表与读取失败分开；过期游标由领域报错，界面回到第一页重新读取，不悄悄丢行。
import { useEffect, useRef, useState } from 'react';
import type { FollowupRead, MovementAccountV1, MovementPageV1, MovementQueryV1, MovementRecordV1, PlanningFollowupPortV1 } from '../planning-followup-contract.ts';
import { formatCents, endpointText, purposeLabel, sourceStatusText } from './model.ts';
import { MovementForm } from './MovementForm.tsx';

function MovementsListContent({ port, generation, writeVersion, today, blocked = false, onPending, onEditingChange, onSaved }: {
  port: PlanningFollowupPortV1; generation: string; writeVersion: number; today: string; blocked?: boolean; onPending: () => void; onEditingChange: (v: boolean) => void; onSaved?: () => void;
}) {
  const [accountsRead, setAccountsRead] = useState<FollowupRead<{ generation: string; accounts: MovementAccountV1[] }> | null>(null);
  const [page, setPage] = useState<MovementPageV1 | null>(null), [records, setRecords] = useState<MovementRecordV1[] | null>(null);
  const [listError, setListError] = useState(''), [listLoading, setListLoading] = useState(false), [moreLoading, setMoreLoading] = useState(false);
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [account, setAccount] = useState(''), [showDeleted, setShowDeleted] = useState<'active' | 'all'>('active');
  const [editing, setEditing] = useState<MovementRecordV1 | null | 'new'>(null), [deleting, setDeleting] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [writeError, setWriteError] = useState(''), [retry, setRetry] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const lock = useRef(false), mounted = useRef(true), [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onEditingChange(editing !== null || busy); return () => onEditingChange(false); }, [editing !== null, busy, onEditingChange]);
  const [uncertain, setUncertain] = useState(false);
  const loadId = useRef(0);
  const frozen = blocked || busy || uncertain;
  const query = (cursor: string | null): MovementQueryV1 => ({ from_date: from || null, to_date: to || null, account_id: account || null, deleted: showDeleted, cursor });

  useEffect(() => { // 账户表：无账户时引导先建账户，不生成外部→外部的无归属记录。
    let live = true; setAccountsRead(null);
    port.listAccounts(generation).then(v => { if (live) setAccountsRead(v.status === 'ready' && v.value.generation !== generation ? { status: 'error', code: 'GENERATION_MISMATCH', message: '资料库已变化，请重新读取。' } : v); }).catch(e => { if (live) setAccountsRead({ status: 'error', code: 'READ_ERROR', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [port, generation, writeVersion, retry]);

  const load = (cursor: string | null) => {
    const request = ++loadId.current;
    setListLoading(true); if (cursor === null) { setRecords(null); setPage(null); }
    port.listMovements(query(cursor), generation).then(v => {
      if (!mounted.current || request !== loadId.current) return;
      if (v.status === 'ready') {
        if (v.value.generation !== generation) { setListError('资料库已变化，请重新读取。'); return; }
        setPage(v.value); setRecords(prev => cursor === null ? v.value.records : [...(prev ?? []), ...v.value.records]); setListError('');
      } else if (v.status === 'error') { setListError(v.message); }
      else setListError(v.message);
    }).catch(e => { if (mounted.current && request === loadId.current) setListError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (mounted.current && request === loadId.current) { setListLoading(false); setMoreLoading(false); } });
  };
  useEffect(() => { load(null); return () => { loadId.current++; }; }, [port, generation, writeVersion, showDeleted, from, to, account, retry]);

  async function trash(record: MovementRecordV1, unlink = false) {
    if (lock.current || frozen) return;
    lock.current = true; setBusy(true); setWriteError('');
    try {
      const context = { generation, request_id: crypto.randomUUID(), expected_revision: record.revision };
      const result = unlink ? await port.saveMovement(record.id, { ...record.fields, source: null }, context) : await port.setMovementDeleted(record.id, !record.deleted, context);
      if (!mounted.current) return;
      if (result.status === 'rejected') { setWriteError(result.issues.map(i => i.message).join(' ') || '操作被拒绝。'); return; }
      if (result.status === 'unresolved') { setUncertain(true); onPending(); setWriteError('提交结果未知，原请求已保留；请稍后在页面顶部核对结果。'); return; }
      setDeleting(null); setSavedNotice(true); load(null); onSaved?.();
    } catch (e) { if (mounted.current) setWriteError(e instanceof Error ? e.message : String(e)); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  const accounts = accountsRead?.status === 'ready' ? accountsRead.value.accounts : [];
  const names = Object.fromEntries(accounts.map(a => [a.id, a.name]));
  const selectable = accounts.filter(a => a.selectable);
  return <section className="pfu-movements" aria-label="资金流动明细">
    <div className="pfu-section-head"><h4>资金流动明细</h4>
      {accountsRead?.status === 'ready' && selectable.length > 0 && <button ref={addButton} type="button" className="pfu-btn" disabled={frozen || editing !== null} onClick={() => setEditing('new')}>记一笔资金流动</button>}
    </div>
    {accountsRead === null ? <p className="pfu-muted" role="status">正在读取账户…</p>
      : accountsRead.status === 'disabled' ? <p className="pfu-state" role="status">{accountsRead.message}</p>
      : accountsRead.status === 'error' ? <p className="pfu-notice" role="alert">账户读取失败：{accountsRead.message}<button type="button" className="pfu-btn" onClick={() => setRetry(n => n + 1)}>重试</button></p>
      : accounts.length === 0 ? <p className="pfu-muted">还没有账户。资金流动至少一端要落在真实账户上，请先在「账户与盘点」创建账户，再记录外部投入或取回。</p>
      : <>
        <div className="pfu-filters">
          <label>开始日期<input aria-label="明细开始日期" placeholder="YYYY-MM-DD（含）" disabled={frozen} value={from} onChange={e => setFrom(e.target.value)}/></label>
          <label>结束日期<input aria-label="明细结束日期" placeholder="YYYY-MM-DD（含）" disabled={frozen} value={to} onChange={e => setTo(e.target.value)}/></label>
          <label>账户<select aria-label="筛选账户" disabled={frozen} value={account} onChange={e => setAccount(e.target.value)}>
            <option value="">全部账户</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
          <label>范围<select aria-label="显示范围" disabled={frozen} value={showDeleted} onChange={e => setShowDeleted(e.target.value as 'active' | 'all')}>
            <option value="active">仅有效</option><option value="all">含已删除</option>
          </select></label>
        </div>
        {listLoading && records === null ? <p className="pfu-muted" role="status">正在读取明细…</p>
          : listError && records === null ? <p className="pfu-notice" role="alert">明细读取失败：{listError}<button type="button" className="pfu-btn" onClick={() => load(null)}>重试</button></p>
          : records === null || records.length === 0 ? <p className="pfu-muted">这个筛选条件下还没有资金流动记录。空列表不等于本期间没有流动。</p>
          : <table className="pfu-table"><thead><tr><th>日期</th><th className="pfu-num">金额</th><th>转出 → 转入</th><th>用途</th><th>来源</th><th>操作</th></tr></thead>
            <tbody>{records.map(r => <tr key={r.id} className={r.deleted ? 'pfu-deleted' : undefined}>
              <td>{r.fields.date}</td>
              <td className="pfu-num">{formatCents(r.fields.amount_cents)}</td>
              <td>{endpointText(r.fields.from, names)} → {endpointText(r.fields.to, names)}</td>
              <td>{purposeLabel[r.fields.purpose]}{r.fields.notes && <small className="pfu-muted"> {r.fields.notes}</small>}</td>
              <td><span className={`pfu-tag ${r.source_status}`}>{sourceStatusText[r.source_status]}</span></td>
              <td className="pfu-row-actions">
                <button type="button" className="pfu-btn" disabled={frozen || editing !== null || r.deleted} onClick={() => setEditing(r)}>修改</button>
                {r.deleted && r.fields.source && <button type="button" className="pfu-btn" disabled={frozen || editing !== null} onClick={() => void trash(r, true)}>解除来源关联</button>}
                {r.deleted
                  ? <button type="button" className="pfu-btn" disabled={frozen} onClick={() => void trash(r)}>恢复</button>
                  : deleting === r.id ? <><button type="button" className="pfu-btn pfu-danger" disabled={frozen} onClick={() => void trash(r)}>确认删除</button><button type="button" className="pfu-btn" disabled={busy} onClick={() => setDeleting(null)}>取消</button></>
                    : <button type="button" className="pfu-btn" disabled={frozen || editing !== null} onClick={() => setDeleting(r.id)}>删除</button>}
              </td>
            </tr>)}</tbody></table>}
        {records !== null && page?.next_cursor && <div className="pfu-more"><button type="button" className="pfu-btn" disabled={frozen || moreLoading} onClick={() => { setMoreLoading(true); load(page.next_cursor); }}>{moreLoading ? '读取中…' : '加载更多'}</button><span className="pfu-muted small">区间核对会包含所有相关明细。</span></div>}
        {listError && records !== null && <p className="pfu-notice" role="alert">继续读取失败：{listError}<button type="button" className="pfu-btn" onClick={() => load(null)}>从第一页重读</button></p>}
        {writeError && <p className="pfu-notice" role="alert">{writeError}</p>}
        <p className="pfu-muted small">一笔本人账户转账只存一条记录；金额、端点或用途无法确定时不要保存成虚构事实。记录资金流动不会改变账户余额。</p>
      </>}
    {savedNotice && <p className="pfu-notice" role="status">{listError ? "已保存，刷新失败。请重新读取，不要重复提交。" : listLoading ? "已保存，正在刷新明细…" : "已保存，明细已刷新。"}</p>}
    {editing !== null && accountsRead?.status === 'ready' && <MovementForm port={port} generation={generation} accounts={accounts} record={editing === 'new' ? null : editing} today={today} blocked={blocked} onPending={onPending}
      onClose={saved => { setEditing(null); if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => addButton.current?.focus()); if (saved) { setSavedNotice(true); load(null); onSaved?.(); } }}/>}
  </section>;
}

/** A changed library or interval starts a fresh editor; old async work stays unmounted. */
export function MovementsList(props: Parameters<typeof MovementsListContent>[0]) {
  return <MovementsListContent key={props.generation} {...props}/>;
}
