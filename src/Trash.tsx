import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import type { AssetRecord, Page } from './asset';
import type { CloseIntent } from './AssetEditor';
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
export function TrashPanel({ version, onRestore }: { version: number; onRestore: (r: AssetRecord, generation: string) => void }) {
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void invoke<Page>('list_assets', { query: { search: '', filter: 'deleted', sort: 'deleted', descending: true, offset } })
      .then(result => { if (!current) return; if (offset > 0 && !result.items.length) setOffset(Math.max(0, Math.ceil(result.total / 100) * 100 - 100)); else setPage(result); })
      .catch(e => { if (current) setError(errorMessage(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [offset, version, retry]);
  return <section aria-label="最近删除的资产">
    <p className="muted">误删的物品可以在这里找回。资料与图片会保留，不会自动永久清空。</p>
    {error ? <div className="empty" role="alert"><h2>最近删除读取失败</h2><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></div> : loading ? <p role="status">正在读取最近删除…</p> : !page?.items.length ? <div className="empty"><h2>最近删除是空的</h2><p>删除的物品会出现在这里。</p></div> : <>
      <p className="collection-caption">{page.total} 件物品 · 按删除时间从新到旧</p>
      <ul className="trash-list">{page.items.map(record => <li key={record.asset.id}>
        <div><h2>{record.asset.name}</h2><p className="muted small">资产 · 原状态：活跃</p><p className="small">购入金额 {money(record.asset.price_cents)} · 购入日期 {record.asset.purchase_date || '待补充'}</p><p className="muted small">删除于 {record.deleted_at ? new Date(record.deleted_at).toLocaleString('zh-CN') : '时间待补充'}</p></div>
        <button onClick={() => onRestore(record, page.generation)} aria-label={'恢复 ' + record.asset.name}>恢复物品</button>
      </li>)}</ul><div className="pagination"><button disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 100))}>上一页</button><span>第 {Math.floor(offset / 100) + 1} 页</span><button disabled={offset + 100 >= page.total} onClick={() => setOffset(n => n + 100)}>下一页</button></div>
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
      if (record.deleted === action.input.deleted) { complete(record); return; }
      setAction(a => ({ record, pending: false, input: { ...a.input, request_id: crypto.randomUUID(), expected_revision: record.asset.revision } }));
      setConflict(false); setNotice('已读取最新资料，请核对物品名称后重新确认。');
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="trash-title" onCancel={e => { e.preventDefault(); close('form'); }}>
    <h2 id="trash-title">{action.input.deleted ? '移入最近删除？' : '恢复这件物品？'}</h2>
    <p className="trash-name">{action.record.asset.name}</p>
    <p className="muted">{action.input.deleted ? '这件物品会从普通列表中隐藏。资料和图片会保留，之后可以从“最近删除”恢复。删除不代表退役或售出。' : '恢复后回到“我的物品”，保留原来的档案、编号和状态。'}</p>
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button ref={cancel} disabled={busy || action.pending} onClick={() => close('form')}>取消</button>
      {action.pending ? <button disabled={busy} onClick={() => void check()}>核对操作结果</button> : conflict ? <button disabled={busy} onClick={() => void reload()}>读取最新资料</button> : <button className={action.input.deleted ? 'danger' : 'primary'} disabled={busy} onClick={() => void submit()}>{busy ? '正在处理…' : action.input.deleted ? '移入最近删除' : '确认恢复'}</button>}
    </div>
  </dialog>;
}
