import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { submit as submitWealth, storedPending } from './wealth';
import type { AssetRecord } from './asset';
import type { CloseIntent } from './AssetEditor';
import { usePageBar } from './topbar';
import { Info } from './FormControls';
import { contentsText, entryDisplay, recordKindLabel, recordPendingKey, restoresViaWealth, stateText, storedRecordTrash, trashFilters } from './unified-trash';
import type { RecordTrashAction, RecordTrashChange, TrashEntry, TrashPage } from './unified-trash';
export type { RecordKind, RecordTrashAction, RecordTrashChange, TrashEntry, TrashPage } from './unified-trash';
export { entryDisplay, recordKindLabel, storedRecordTrash, trashFilters } from './unified-trash';
export type TrashChange = { request_id: string; generation: string; asset_id: string; expected_revision: number; deleted: boolean };
export type TrashAction = { input: TrashChange; record: AssetRecord; pending: boolean };
const pendingKey = 'possio.trash-request.v1';
export function storedTrash(): TrashAction | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey) || 'null');
    if (value?.pending === true && typeof value.input?.request_id === 'string' && typeof value.input?.generation === 'string' && typeof value.input?.deleted === 'boolean' && typeof value.record?.asset?.name === 'string' && value.input.asset_id === value.record.asset.id) return value;
  } catch { /* A corrupt local reminder must not hide the library. */ }
  return null;
}

export function TrashPanel({ version, search, onSearch, onRestoreAsset, onRestoreRecord }: { version: number; search: string; onSearch: (value: string) => void; onRestoreAsset: (id: string, generation: string) => void; onRestoreRecord: (entry: TrashEntry, generation: string) => void }) {
  const [page, setPage] = useState<TrashPage | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [wealthNotice, setWealthNotice] = useState(''), [wealthBusy, setWealthBusy] = useState(false);
  // Permanent deletion asks twice: the armed row (or 'all') must be clicked again.
  const [armed, setArmed] = useState<string | null>(null);
  async function purge(entry: TrashEntry | null, generation: string) {
    setWealthBusy(true); setWealthNotice(''); setArmed(null);
    try {
      const result = await invoke<{ removed: number; kept: number }>('purge_trash', { input: { request_id: crypto.randomUUID(), generation, kind: entry?.kind ?? null, id: entry?.id ?? '' } });
      setWealthNotice(entry ? `已永久删除「${entryDisplay(entry).title}」。` : `已永久删除 ${result.removed} 项${result.kept ? `；${result.kept} 件由心愿实现的物品保留，需先永久删除对应心愿` : ''}。`);
    } catch (e) { setWealthNotice(errorMessage(e)); }
    finally { setWealthBusy(false); setRetry(n => n + 1); }
  }
  async function restoreWealth(entry: TrashEntry, generation: string) {
    if (entry.kind === 'asset' || entry.kind === 'maintenance' || entry.kind === 'warranty') return;
    if (storedPending()) { setWealthNotice('财富页有一次保存结果待核对，请先到“账户与盘点”处理。'); return; }
    setWealthBusy(true); setWealthNotice('');
    try { await submitWealth({ command: 'wealth_trash', input: { request_id: crypto.randomUUID(), generation, kind: entry.kind, id: entry.id, expected_revision: entry.asset_revision, deleted: false }, label: '恢复' + entryDisplay(entry).title }); setWealthNotice(`已恢复「${entryDisplay(entry).title}」。`); setRetry(n => n + 1); }
    catch (e) { setWealthNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setWealthBusy(false); }
  }
  // A new keyword restarts the list from its first page.
  useEffect(() => { setOffset(0); }, [search]);
  // 最近删除 takes a search box but never a new-record entry (3.5.1).
  usePageBar('trash', { search: { key: 'trash', placeholder: '搜索已删除记录' } });
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void invoke<TrashPage>('list_trash', { query: { filter, offset, search } })
      .then(result => { if (!current) return; if (offset > 0 && !result.items.length) setOffset(Math.max(0, Math.ceil(result.total / 100) * 100 - 100)); else setPage(result); })
      .catch(e => { if (current) setError(errorMessage(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [filter, offset, version, retry, search]);
  const total = page?.total ?? 0;
  return <section className="trash-panel" aria-label="最近删除">
    <div className="trash-header"><div className="segmented trash-filter" role="group" aria-label="按类型筛选最近删除">
      {trashFilters.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setOffset(0); }}>{label}</button>)}
    </div><Info text="误删的物品、维护、保障记录、心愿以及盘点、账户、支出和周期费用都会在这里，可以随时找回。资料与图片会保留，不会自动清空；只有永久删除才会真正移除。"/><span className="trash-spacer"/>
      {!!page?.total && filter === 'all' && (armed === 'all' ? <button className="primary danger" disabled={wealthBusy} onClick={() => void purge(null, page.generation)}>确认永久删除全部 {page.total} 项</button> : <button disabled={wealthBusy} onClick={() => setArmed('all')}>清空最近删除…</button>)}</div>
    {wealthNotice && <p className="notice" role="status">{wealthNotice}</p>}
    {error ? <div className="empty" role="alert"><h2>最近删除读取失败</h2><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></div> : loading ? <p role="status">正在读取最近删除…</p> : !page?.items.length ? (search.trim() ? <div className="empty"><h2>当前条件下没有找到记录</h2><p>试试其他关键词。</p><button onClick={() => onSearch('')}>清除搜索</button>{filter !== 'all' && <button onClick={() => { onSearch(''); setFilter('all'); setOffset(0); }}>重置筛选</button>}</div> : <div className="empty"><h2>最近删除是空的</h2><p>{filter === 'all' ? '删除的物品和记录会出现在这里。' : '这一类目前没有删除项。'}</p></div>) : <>
      <p className="collection-caption">{search.trim() ? `找到 ${total} 条` : `${total} 项`} · 按删除时间从新到旧</p>
      <div className="ui-card trash-table-wrap"><table className="ui-table trash-table"><thead><tr><th>名称与说明</th><th>类型</th><th>删除日期</th><th>操作</th></tr></thead><tbody>{page.items.map(entry => {
        const display = entryDisplay(entry);
        return <tr key={entry.kind + entry.id}>
          <td><span className="ui-avatar" aria-hidden="true">{display.title.slice(0,1)}</span><div>
            <h2>{display.title}</h2>
            <p className="muted small">{display.typeLabel}{entry.kind !== 'asset' && entry.asset_name ? ` · 所属：${entry.asset_name}` : ''}{entry.asset_id ? ` · 状态：${stateText[entry.asset_state ?? 'active'] ?? '使用中'}` : ''}</p>
            {display.facts.map(fact => <p className="small" key={fact}>{fact}</p>)}
            {contentsText(entry.contents) && <p className="small">{contentsText(entry.contents)}，恢复时一起回来</p>}
            {display.parentBlocked && <p className="small" role="note">所属物品仍在最近删除中，请先恢复所属物品。</p>}
            </div></td><td><span className="ui-tag">{display.typeLabel}</span></td><td className="trash-date">{entry.deleted_at ? entry.deleted_at.slice(0,10) : '时间待补充'}</td>
          <td><div className="trash-actions">{display.parentBlocked
            ? <button onClick={() => entry.asset_id && onRestoreAsset(entry.asset_id, page.generation)} aria-label={'恢复所属物品 ' + (entry.asset_name ?? '')}>先恢复所属物品</button>
            : restoresViaWealth(entry.kind)
              ? <button disabled={wealthBusy} onClick={() => void restoreWealth(entry, page.generation)} aria-label={'恢复 ' + display.title}>恢复{display.typeLabel}</button>
            : entry.kind === 'asset'
              ? <button onClick={() => onRestoreAsset(entry.id, page.generation)} aria-label={'恢复 ' + entry.title}>恢复物品</button>
              : <button onClick={() => onRestoreRecord(entry, page.generation)} aria-label={'恢复 ' + display.title}>恢复记录</button>}
            {armed === entry.kind + entry.id ? <button className="primary danger" disabled={wealthBusy} onClick={() => void purge(entry, page.generation)}>确认永久删除</button> : <button className="danger" disabled={wealthBusy} onClick={() => setArmed(entry.kind + entry.id)} aria-label={'永久删除 ' + display.title}>永久删除…</button>}</div></td>
        </tr>; })}
      </tbody></table></div><div className="pagination"><button disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 100))}>上一页</button><span>第 {Math.floor(offset / 100) + 1} 页</span><button disabled={offset + 100 >= total} onClick={() => setOffset(n => n + 100)}>下一页</button></div>
    </>}
  </section>;
}

export function TrashDialog({ initial, closeIntent, onKeep, onClose, onDone }: { initial: TrashAction; closeIntent: CloseIntent | null; onKeep: () => void; onClose: (intent: CloseIntent) => void; onDone: (record: AssetRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState(initial.pending ? '上次操作结果待确认。请先核对，避免重复操作。' : '');
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) close(closeIntent); }, [closeIntent]);
  function close(intent: CloseIntent) {
    if (lock.current || action.pending) { setNotice('请先核对这次操作结果，确认后再关闭。'); onKeep(); return; }
    onClose(intent);
  }
  function complete(record: AssetRecord) { localStorage.removeItem(pendingKey); onDone(record); }
  async function resolve() {
    const result = await invoke<AssetRecord | null>('saved_request', { request: action.input.request_id, generation: action.input.generation });
    if (result) complete(result);
    else { localStorage.removeItem(pendingKey); setAction(a => ({ ...a, pending: false })); setNotice('确认本次操作尚未提交，资料未因本次操作改变。可以重试或取消。'); }
  }
  async function check() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await resolve(); } catch (e) { setNotice(errorMessage(e) + ' 请求已保留，请稍后再核对。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit() {
    if (lock.current || action.pending || conflict) return;
    lock.current = true; setBusy(true);
    const next = { ...action, pending: true };
    try { localStorage.setItem(pendingKey, JSON.stringify(next)); }
    catch { setNotice('无法暂存操作请求，尚未提交。请检查可用空间后重试。'); lock.current = false; setBusy(false); return; }
    setAction(next);
    try { complete(await invoke<AssetRecord>('change_trash', { input: action.input })); }
    catch (e) {
      try {
        const result = await invoke<AssetRecord | null>('saved_request', { request: action.input.request_id, generation: action.input.generation });
        if (result) complete(result);
        else {
          localStorage.removeItem(pendingKey); setAction(a => ({ ...a, pending: false }));
          setConflict(typeof e === 'object' && e !== null && 'code' in e && e.code === 'REVISION_CONFLICT');
          setNotice(errorMessage(e) + ' 本次操作未提交。');
        }
      } catch { setNotice('暂时无法确认结果。请核对本次操作，原请求已保留。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const record = await invoke<AssetRecord | null>('read_asset', { id: action.input.asset_id });
      if (!record) { setNotice('找不到这件物品，请取消并重新读取列表。'); return; }
      if (record.deleted === action.input.deleted) { setNotice('物品已处于目标状态，但无法确认是本次请求完成。请取消并重新读取最近删除。'); setConflict(true); return; }
      setAction(a => ({ record, pending: false, input: { ...a.input, request_id: crypto.randomUUID(), expected_revision: record.asset.revision } }));
      setConflict(false); setNotice('已读取最新资料，请核对物品名称后重新确认。');
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="trash-title" onCancel={e => { e.preventDefault(); close('form'); }}>
    <h2 id="trash-title">{action.input.deleted ? '移入最近删除？' : '恢复这件物品？'}</h2>
    <p className="trash-name">{action.record.asset.name}</p>
    <p className="muted">{action.input.deleted ? '删除用于录错或重复的记录。这件物品及它的维护、保障、关联支出会从各处隐藏，资料和图片保留，之后可以从“最近删除”恢复。已经不用、送人或丢失了？请改用“退役”；卖掉了请用“售出”，这样历史会保留。' : '恢复后回到“我的物品”，保留原来的档案、编号和状态。'}</p>
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button ref={cancel} disabled={busy || action.pending} onClick={() => close('form')}>取消</button>
      {action.pending ? <button disabled={busy} onClick={() => void check()}>核对操作结果</button> : conflict ? <button disabled={busy} onClick={() => void reload()}>读取最新资料</button> : <button className={action.input.deleted ? 'primary danger' : 'primary'} disabled={busy} onClick={() => void submit()}>{busy ? '正在处理…' : action.input.deleted ? '移入最近删除' : '确认恢复'}</button>}
    </div>
  </dialog>;
}

export function RecordTrashDialog({ initial, closeIntent, onKeep, onClose, onDone }: { initial: RecordTrashAction; closeIntent: CloseIntent | null; onKeep: () => void; onClose: (intent: CloseIntent) => void; onDone: (record: AssetRecord, input: RecordTrashChange) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState(initial.pending ? '上次操作结果待确认。请先核对，避免重复操作。' : '');
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) close(closeIntent); }, [closeIntent]);
  function close(intent: CloseIntent) {
    if (lock.current || action.pending) { setNotice('请先核对这次操作结果，确认后再关闭。'); onKeep(); return; }
    onClose(intent);
  }
  function complete(record: AssetRecord) { localStorage.removeItem(recordPendingKey); onDone(record, action.input); }
  async function resolve() {
    const result = await invoke<AssetRecord | null>('saved_record_trash_request', { input: action.input });
    if (result && result.asset.id === action.input.asset_id) complete(result);
    else if (result) { setNotice('回执中的资料与本次操作不一致，请取消后重新读取。'); }
    else { localStorage.removeItem(recordPendingKey); setAction(a => ({ ...a, pending: false })); setNotice('确认本次操作尚未提交，资料未因本次操作改变。可以重试或取消。'); }
  }
  async function check() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await resolve(); } catch (e) { setNotice(errorMessage(e) + ' 请求已保留，请稍后再核对。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit() {
    if (lock.current || action.pending || conflict) return;
    lock.current = true; setBusy(true);
    const next = { ...action, pending: true };
    try { localStorage.setItem(recordPendingKey, JSON.stringify(next)); }
    catch { setNotice('无法暂存操作请求，尚未提交。请检查可用空间后重试。'); lock.current = false; setBusy(false); return; }
    setAction(next);
    try { complete(await invoke<AssetRecord>('change_record_trash', { input: action.input })); }
    catch (e) {
      try {
        const result = await invoke<AssetRecord | null>('saved_record_trash_request', { input: action.input });
        if (result && result.asset.id === action.input.asset_id) complete(result);
        else if (result) { setNotice('回执中的资料与本次操作不一致，请取消后重新读取。'); }
        else {
          localStorage.removeItem(recordPendingKey); setAction(a => ({ ...a, pending: false }));
          setConflict(typeof e === 'object' && e !== null && 'code' in e && (e.code === 'REVISION_CONFLICT' || e.code === 'PARENT_DELETED'));
          setNotice(errorMessage(e) + ' 本次操作未提交。');
        }
      } catch { setNotice('暂时无法确认结果。请核对本次操作，原请求已保留。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const record = await invoke<AssetRecord | null>('read_asset', { id: action.input.asset_id });
      if (!record) { setNotice('找不到所属物品，请取消并重新读取。'); return; }
      if (record.deleted) { setNotice('所属物品已在最近删除中。请先恢复所属物品，再处理这条记录。'); return; }
      const visible = action.input.kind === 'maintenance'
        ? record.maintenances.some(item => item.id === action.input.record_id)
        : (record.warranties ?? []).some(item => item.id === action.input.record_id);
      if (visible === !action.input.deleted) { setNotice('记录已处于目标状态，但无法确认是本次请求完成。请取消并重新读取最近删除。'); setConflict(true); return; }
      setAction(a => ({ ...a, pending: false, input: { ...a.input, request_id: crypto.randomUUID(), expected_revision: record.asset.revision } }));
      setConflict(false); setNotice('已读取最新资料，请核对记录后重新确认。');
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const label = recordKindLabel[action.input.kind];
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="record-trash-title" onCancel={e => { e.preventDefault(); close('form'); }}>
    <h2 id="record-trash-title">{action.input.deleted ? `移入最近删除？` : `恢复这条${label}？`}</h2>
    <p className="trash-name">{action.meta.title}</p>
    <p className="muted">{action.input.deleted
      ? `这条${label}会从「${action.meta.assetName}」的详情和统计中隐藏，费用与保障摘要会立即重算。之后可以从“最近删除”恢复；删除不代表退役或售出。`
      : `恢复后这条${label}会重新计入「${action.meta.assetName}」的详情、费用与保障摘要，保持原来的编号和内容。`}</p>
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button ref={cancel} disabled={busy || action.pending} onClick={() => close('form')}>取消</button>
      {action.pending ? <button disabled={busy} onClick={() => void check()}>核对操作结果</button> : conflict ? <button disabled={busy} onClick={() => void reload()}>读取最新资料</button> : <button className={action.input.deleted ? 'primary danger' : 'primary'} disabled={busy} onClick={() => void submit()}>{busy ? '正在处理…' : action.input.deleted ? '移入最近删除' : '确认恢复'}</button>}
    </div>
  </dialog>;
}
