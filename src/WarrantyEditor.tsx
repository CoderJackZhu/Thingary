import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, type AssetRecord, type Photo } from './asset';
import { PhotoView } from './Photos';
import { DateInput } from './DateInput';
import { blankWarranty, recoverWarranty, statusLabel, warrantyChange, warrantyKinds, warrantyKey, warrantySummaryText, type WarrantyDraft, type WarrantyState, type WarrantySession, type WarrantyRecoveryResult } from './warranty';
import { validateWarranty } from './warranty';
import type { CloseIntent } from './AssetEditor';

export function WarrantyEditor({ initial, closeIntent, onKeep, onSaved, onClose }: { initial: WarrantySession; closeIntent: CloseIntent | null; onKeep: () => void; onSaved: (record: AssetRecord) => void; onClose: (intent: CloseIntent, keepDraft?: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [state, setState] = useState(initial.state), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initial.issue?.message ?? '');
  const [issue, setIssue] = useState(initial.issue), [confirmClose, setConfirmClose] = useState<CloseIntent | null>(null);
  const blocked = issue?.kind === 'blocked', conflict = issue?.kind === 'conflict';
  const frozen = busy || !!state.pending || blocked || conflict;
  const dirty = JSON.stringify(state.fields) !== JSON.stringify(state.original) || JSON.stringify(state.fields.photo_ids) !== JSON.stringify(state.original.photo_ids);

  useEffect(() => { dialog.current?.showModal(); document.getElementById('warranty-provider')?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) askClose(closeIntent); }, [closeIntent]);

  function remember(next: WarrantyState) {
    localStorage.setItem(warrantyKey, JSON.stringify(next));
    setState(next);
  }
  function edit<K extends keyof WarrantyDraft>(name: K, value: WarrantyDraft[K]) {
    const next = { ...state, fields: { ...state.fields, [name]: value } };
    try { remember(next); } catch { setNotice('草稿持久保存失败，请保持窗口打开并保存。'); }
  }
  function askClose(intent: CloseIntent) {
    if (blocked && !lock.current) { onClose(intent, true); return; }
    if (lock.current || state.pending) { setNotice('请先核对保障保存结果，再关闭表单。'); onKeep(); return; }
    if (dirty) setConfirmClose(intent); else onClose(intent);
  }
  function success(record: AssetRecord) { localStorage.removeItem(warrantyKey); onSaved(record); }
  async function pickPhoto() {
    if (lock.current || state.pending || blocked || conflict) return;
    lock.current = true; setBusy(true);
    try {
      const photo = await invoke<Photo | null>('pick_photo', { generation: state.generation, repair: null });
      if (photo) remember({ ...state, photos: [...state.photos, photo], fields: { ...state.fields, photo_ids: [...state.fields.photo_ids, photo.id] } });
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  function applyRecovery(result: WarrantyRecoveryResult) {
    if (result.kind === 'saved') { success(result.record); return; }
    remember(result.state); setIssue(result.issue);
    setNotice(result.issue?.message ?? '已核对当前资料和原请求。输入已保留，可以继续编辑。');
  }
  async function recover(saved = state) {
    const current = await invoke<{ generation: string }>('taxonomy_snapshot');
    return recoverWarranty(saved, current.generation, id => invoke<AssetRecord | null>('read_asset', { id }), (request, generation) => invoke<AssetRecord | null>('saved_request', { request, generation }));
  }
  async function check() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { applyRecovery(await recover()); }
    catch (e) { setNotice(errorMessage(e) + ' 原请求与输入已保留，请稍后核对。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current || state.pending || blocked || conflict) return;
    const problem = validateWarranty(state.fields);
    if (problem) { setNotice(problem); document.getElementById('warranty-provider')?.focus(); return; }
    const input = warrantyChange(state.record, state.generation, state.fields, state.warranty_id);
    lock.current = true; setBusy(true); setNotice('');
    try { remember({ ...state, pending: input }); }
    catch { lock.current = false; setBusy(false); setNotice('无法持久保存本次请求，尚未提交，请检查可用空间后重试。'); return; }
    try { success(await invoke<AssetRecord>('change_warranty', { input })); }
    catch (e) {
      try {
        const result = await recover({ ...state, pending: input });
        applyRecovery(result);
        if (result.kind === 'edit' && !result.issue) setNotice(errorMessage(e) + ' 已确认未提交，输入已保留。');
      } catch { setNotice('暂时无法确认结果。原请求和输入已保留，请核对保障保存结果。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  function acceptLatest() {
    if (lock.current || state.pending || issue?.kind !== 'conflict' || !issue.latest) return;
    try {
      remember({ ...state, record: issue.latest }); setIssue(null);
      setNotice('已确认在最新版本上保留你的输入，请核对后保存。');
    } catch (e) { setNotice(errorMessage(e)); }
  }
  function removePhoto(id: string) {
    remember({ ...state, photos: state.photos.filter(photo => photo.id !== id), fields: { ...state.fields, photo_ids: state.fields.photo_ids.filter(photoId => photoId !== id) } });
  }
  function clear() {
    const fields = blankWarranty();
    remember({ ...state, fields, photos: [] });
  }

  return <dialog ref={dialog} className="editor warranty-editor" aria-labelledby="warranty-heading" onCancel={event => { event.preventDefault(); askClose('form'); }}><form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">保障档案</p><h2 id="warranty-heading">{state.warranty_id ? '更正保障记录' : '添加保障记录'}</h2><p className="muted">更正保留原记录标识；保障可以未来开始或到期，未知日期保持留空。</p></div><button type="button" aria-label="关闭保障表单" disabled={busy || (!!state.pending && !blocked)} onClick={() => askClose('form')}>×</button></header>
    <div className="fields warranty-fields"><label className="field">类型<select value={state.fields.kind} disabled={frozen} onChange={event => edit('kind', event.target.value as WarrantyDraft['kind'])}>{warrantyKinds.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className="field">提供方（可留空）<input id="warranty-provider" maxLength={200} value={state.fields.provider} disabled={frozen} onChange={event => edit('provider', event.target.value)}/></label><div className="field"><label htmlFor="warranty-start">开始日期（可留空）</label><DateInput id="warranty-start" value={state.fields.start} disabled={frozen} allowClear onChange={value => edit('start', value)}/></div><div className="field"><label htmlFor="warranty-end">结束日期（可留空）</label><DateInput id="warranty-end" value={state.fields.end} disabled={frozen} allowClear onChange={value => edit('end', value)}/></div><label className="field wide">备注<textarea maxLength={10000} value={state.fields.notes} disabled={frozen} onChange={event => edit('notes', event.target.value)}/></label></div>
    <section className="photo-section"><h3>保障图片 <small>{state.photos.length}</small></h3><div className="photo-strip">{state.photos.map(photo => <span className="photo-tile" key={photo.id}>{blocked ? <span>原资料库图片 · {photo.name}</span> : <PhotoView photo={photo} generation={state.generation}/>}<span className="photo-name">{photo.name}</span><button type="button" disabled={frozen} onClick={() => removePhoto(photo.id)}>移除</button></span>)}</div><button type="button" disabled={frozen} onClick={() => void pickPhoto()}>添加图片</button></section>
    <aside className="settlement"><span>当前保障</span><strong>{warrantySummaryText(state.record.warranty_summary ?? { status: 'none', total: 0, active_count: 0, expiring_count: 0, upcoming_count: 0, expired_count: 0, pending_count: 0 })}</strong><span>保障独立于持有状态，不计入成本。</span></aside>
    {notice && <p className="notice" role="status">{notice}</p>}
    {conflict && issue?.latest && <div className="confirm">
      <strong>当前已保存版本 {issue.latest.asset.revision} · {issue.latest.asset.name}</strong>
      <p>当前保障：{state.warranty_id ? (() => { const item = issue.latest!.warranties?.find(item => item.id === state.warranty_id); return item ? `${item.fields.provider || '未记录提供方'} · ${item.fields.start_date ?? '起未知'} – ${item.fields.end_date ?? '止未知'} · ${statusLabel[item.status]}` : '原记录已不可用'; })() : `${issue.latest.warranties?.length ?? 0} 份`}</p>
      <p>上方保留你的原输入，尚未覆盖当前记录。</p>
      <button type="button" disabled={busy} onClick={acceptLatest}>确认保留我的输入并使用最新版本</button>
    </div>}
    {confirmClose ? <div className="confirm" role="alert">
      <strong>保障修改尚未保存</strong><p>可以保留草稿后关闭，下次启动再恢复；放弃会删除草稿。</p>
      <div className="actions"><button type="button" onClick={() => { setConfirmClose(null); onKeep(); }}>继续编辑</button><button type="button" onClick={() => onClose(confirmClose, true)}>保留草稿并关闭</button><button type="button" onClick={() => onClose(confirmClose)}>放弃修改</button></div>
    </div> : <footer className="actions">{blocked ? <>
      <button type="button" disabled={busy} onClick={() => onClose('form', true)}>保留草稿并关闭</button>
      <button type="button" disabled={busy} onClick={() => void check()}>重新核对资料库</button>
    </> : <>
      <button type="button" disabled={frozen} onClick={clear}>清空</button>
      <button type="button" disabled={busy || !!state.pending} onClick={() => askClose('form')}>取消</button>
      {state.pending ? <button type="button" disabled={busy} onClick={() => void check()}>核对保障保存结果</button> : conflict ? <button type="button" disabled={busy} onClick={() => void check()}>重新读取当前记录</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存保障记录'}</button>}
    </>}</footer>}

  </form></dialog>;
}
