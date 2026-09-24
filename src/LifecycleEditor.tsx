import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, localDay } from './asset';
import type { AssetRecord } from './asset';
import type { CloseIntent } from './AssetEditor';
import { lifecycleError, lifecycleKey, kindLabel, stateLabel } from './lifecycle';
import type { LifecycleDraft, LifecycleChange } from './lifecycle';

export function LifecycleEditor({ initial, closeIntent, onKeep, onClose, onSaved }: { initial: LifecycleDraft; closeIntent: CloseIntent | null; onKeep: () => void; onClose: (intent: CloseIntent) => void; onSaved: (record: AssetRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initial.pending ? '上次状态保存结果待确认，请先核对。' : '');
  const [conflict, setConflict] = useState(false), [confirm, setConfirm] = useState<CloseIntent | null>(null);
  const dirty = JSON.stringify(draft.action) !== JSON.stringify(draft.original);
  const title = draft.action.type === 'correct_date' ? '更正状态日期' : draft.action.kind === 'retire' ? '标记退役' : '重新启用';
  useEffect(() => { dialog.current?.showModal(); document.getElementById('lifecycle-date')?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) askClose(closeIntent); }, [closeIntent]);
  function remember(next: LifecycleDraft) { localStorage.setItem(lifecycleKey, JSON.stringify(next)); setDraft(next); }
  function edit(date: string, notes?: string) {
    const action = draft.action.type === 'append' ? { ...draft.action, date, notes: notes ?? draft.action.notes } : { ...draft.action, date };
    const next = { ...draft, action }; setDraft(next);
    try { localStorage.setItem(lifecycleKey, JSON.stringify(next)); } catch { setNotice('草稿暂存失败，请保持窗口打开并保存。'); }
  }
  function askClose(intent: CloseIntent) {
    if (lock.current || draft.pending) { setNotice('请先核对状态保存结果，再关闭表单。'); onKeep(); return; }
    if (dirty) setConfirm(intent); else onClose(intent);
  }
  function success(record: AssetRecord) { localStorage.removeItem(lifecycleKey); onSaved(record); }
  async function check() {
    if (!draft.pending || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await invoke<AssetRecord | null>('saved_request', { request: draft.pending.request_id, generation: draft.generation });
      if (result) success(result);
      else { remember({ ...draft, pending: null }); setNotice('确认尚未提交。输入已保留，可以重试或修改。'); }
    } catch (e) { setNotice(errorMessage(e) + ' 原请求与输入已保留，请稍后核对。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current || draft.pending || conflict) return;
    const error = lifecycleError(draft.record, draft.action, localDay());
    if (error) { setNotice(error); document.getElementById('lifecycle-date')?.focus(); return; }
    const input: LifecycleChange = { request_id: crypto.randomUUID(), generation: draft.generation, asset_id: draft.record.asset.id, expected_revision: draft.record.asset.revision, action: draft.action };
    lock.current = true; setBusy(true);
    try { remember({ ...draft, pending: input }); }
    catch { lock.current = false; setBusy(false); setNotice('无法暂存本次请求，尚未提交，请检查可用空间后重试。'); return; }
    try { success(await invoke<AssetRecord>('change_lifecycle', { input })); }
    catch (e) {
      try {
        const result = await invoke<AssetRecord | null>('saved_request', { request: input.request_id, generation: input.generation });
        if (result) success(result);
        else { remember({ ...draft, pending: null }); setConflict(typeof e === 'object' && e !== null && 'code' in e && ['REVISION_CONFLICT','STATE_CONFLICT'].includes(String(e.code))); setNotice(errorMessage(e) + ' 输入已保留。'); }
      } catch { setNotice('暂时无法确认结果。原请求和输入已保留，请核对状态保存结果。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const record = await invoke<AssetRecord | null>('read_asset', { id: draft.record.asset.id });
      if (!record || record.deleted) { setNotice('档案已删除或不可用，请取消后重新读取。'); return; }
      remember({ ...draft, record }); setConflict(false);
      setNotice(`已读取最新状态：${stateLabel(record)}。你的日期输入仍保留，请核对下方历史后再保存。`);
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor lifecycle-editor" aria-labelledby="lifecycle-title" onCancel={e => { e.preventDefault(); askClose('form'); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><h2 id="lifecycle-title">{title}</h2><button type="button" aria-label="关闭状态表单" onClick={() => askClose('form')}>×</button></header>
    <p>{draft.record.asset.name}</p><p className="muted">{draft.action.type === 'correct_date' ? '只更正这条动作的日期，保留原有状态顺序和备注。' : '退役仍计入持有，日均持有成本继续计算。重新启用不会重置购入日期或已有历史。'}</p>
    <label className="field" htmlFor="lifecycle-date">动作日期（必填）<input id="lifecycle-date" placeholder="YYYY-MM-DD" value={draft.action.date} disabled={busy || !!draft.pending} onChange={e => edit(e.target.value)} autoComplete="off"/></label>
    {draft.action.type === 'append' && <label className="field" htmlFor="lifecycle-notes">备注（可选）<textarea id="lifecycle-notes" rows={3} value={draft.action.notes} disabled={busy || !!draft.pending} onChange={e => edit(draft.action.date,e.target.value)}/></label>}
    {!!draft.record.lifecycle?.events.length && <details><summary>已有状态记录与日期</summary><ol>{draft.record.lifecycle.events.map(e => <li key={e.id}>{e.date} · {kindLabel(e.kind)}{draft.action.type === 'correct_date' && draft.action.event_id === e.id ? '（正在更正）' : ''}</li>)}</ol></details>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {confirm ? <div className="confirm" role="alert"><strong>放弃未保存的状态修改？</strong><div className="actions"><button type="button" onClick={() => { setConfirm(null); onKeep(); }}>继续编辑</button><button type="button" onClick={() => onClose(confirm)}>放弃修改</button></div></div> : <footer className="actions"><button type="button" disabled={busy || !!draft.pending} onClick={() => askClose('form')}>取消</button>{draft.pending ? <button type="button" disabled={busy} onClick={() => void check()}>核对状态保存结果</button> : conflict ? <button type="button" disabled={busy} onClick={() => void reload()}>读取最新状态</button> : <button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存状态'}</button>}</footer>}
  </form></dialog>;
}
