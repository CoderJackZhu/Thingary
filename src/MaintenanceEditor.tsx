import {persistSubmission} from './editor-session';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, type AssetRecord, type Photo } from './asset';
import { PhotoView } from './Photos';
import { AddImageButton } from './FormControls';
import { DateInput } from './DateInput';
import { maintenanceChange, maintenanceKey, maintenanceKinds, money, recoverMaintenance, validateMaintenance, type MaintenanceDraft, type MaintenanceState, type MaintenanceSession, type MaintenanceRecoveryResult } from './maintenance';
import type { CloseIntent } from './AssetEditor';

export function MaintenanceEditor({ initial, today, closeIntent, onKeep, onSaved, onClose }: { initial: MaintenanceSession; today: string; closeIntent: CloseIntent | null; onKeep: () => void; onSaved: (record: AssetRecord) => void; onClose: (intent: CloseIntent, keepDraft?: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [state, setState] = useState(initial.state), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initial.issue?.message ?? '');
  const [issue, setIssue] = useState(initial.issue);
  const blocked = issue?.kind === 'blocked', conflict = issue?.kind === 'conflict';
  const frozen = busy || !!state.pending || blocked || conflict;

  useEffect(() => { dialog.current?.showModal(); document.getElementById('maintenance-title')?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) askClose(closeIntent); }, [closeIntent]);

  function remember(next: MaintenanceState) {
    persistSubmission(maintenanceKey, next);
    setState(next);
  }
  function edit<K extends keyof MaintenanceDraft>(name: K, value: MaintenanceDraft[K]) {
    const next = { ...state, fields: { ...state.fields, [name]: value } };
    try { remember(next); } catch { setNotice('暂时无法记录保存请求，请重试。'); }
  }
  function askClose(intent: CloseIntent) {
    if (blocked && !lock.current) { onClose(intent, true); return; }
    if (lock.current || state.pending) { setNotice('请先核对维护保存结果，再关闭表单。'); onKeep(); return; }
    onClose(intent);
  }
  function success(record: AssetRecord) { localStorage.removeItem(maintenanceKey); onSaved(record); }
  async function pickPhoto() {
    if (lock.current || state.pending || blocked || conflict) return;
    lock.current = true; setBusy(true);
    try {
      const photo = await invoke<Photo | null>('pick_photo', { generation: state.generation, repair: null });
      if (photo) remember({ ...state, photos: [...state.photos, photo], fields: { ...state.fields, photo_ids: [...state.fields.photo_ids, photo.id] } });
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  function applyRecovery(result: MaintenanceRecoveryResult) {
    if (result.kind === 'saved') { success(result.record); return; }
    remember(result.state); setIssue(result.issue);
    setNotice(result.issue?.message ?? '已核对当前资料和原请求。输入已保留，可以继续编辑。');
  }
  async function recover(saved = state) {
    const current = await invoke<{ generation: string }>('taxonomy_snapshot');
    return recoverMaintenance(saved, current.generation, id => invoke<AssetRecord | null>('read_asset', { id }), (request, generation) => invoke<AssetRecord | null>('saved_request', { request, generation }));
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
    const issue = validateMaintenance(state.fields, state.record, today);
    if (issue) { setNotice(issue); document.getElementById('maintenance-title')?.focus(); return; }
    const input = maintenanceChange(state.record, state.generation, state.fields, state.maintenance_id);
    lock.current = true; setBusy(true); setNotice('');
    try { remember({ ...state, pending: input }); }
    catch { lock.current = false; setBusy(false); setNotice('无法持久保存本次请求，尚未提交，请检查可用空间后重试。'); return; }
    try { success(await invoke<AssetRecord>('change_maintenance', { input })); }
    catch (e) {
      try {
        const result = await recover({ ...state, pending: input });
        applyRecovery(result);
        if (result.kind === 'edit' && !result.issue) setNotice(errorMessage(e) + ' 已确认未提交，输入已保留。');
      } catch { setNotice('暂时无法确认结果。原请求和输入已保留，请核对维护保存结果。'); }
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

  return <dialog ref={dialog} className="editor maintenance-editor" aria-labelledby="maintenance-heading" onCancel={event => { event.preventDefault(); askClose('form'); }}><form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">维护档案</p><h2 id="maintenance-heading">{state.maintenance_id ? '更正维护记录' : '新增维护记录'}</h2><p className="muted">更正保留原记录标识与审计轨迹；空费用表示未知，0 表示免费。</p></div><button type="button" aria-label="关闭维护表单" disabled={busy || (!!state.pending && !blocked)} onClick={() => askClose('form')}>×</button><div className="editor-header-actions">{blocked ? <>
      <button type="button" disabled={busy} onClick={() => onClose('form', !!state.pending)}>关闭</button>
      <button type="button" disabled={busy} onClick={() => void check()}>重新核对资料库</button>
    </> : <>
      {state.pending ? <button type="button" disabled={busy} onClick={() => void check()}>核对维护保存结果</button> : conflict ? <button type="button" disabled={busy} onClick={() => void check()}>重新读取当前记录</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存维护记录'}</button>}
    </>}</div></header>
    <div className="fields maintenance-fields"><div className="field"><label htmlFor="maintenance-date">日期（可留空）</label><DateInput id="maintenance-date" max={state.record.sale?.fields.date ?? today} min={state.record.asset.purchase_date ?? undefined} value={state.fields.date ?? ''} disabled={frozen} allowClear onChange={value => edit('date', value || null)}/></div><label className="field">类型<select value={state.fields.kind} disabled={frozen} onChange={event => edit('kind', event.target.value as MaintenanceDraft['kind'])}>{maintenanceKinds.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label className="field">标题<input id="maintenance-title" maxLength={200} value={state.fields.title} disabled={frozen} onChange={event => edit('title', event.target.value)}/></label><label className="field">服务方<input maxLength={200} value={state.fields.provider} disabled={frozen} onChange={event => edit('provider', event.target.value)}/></label><label className="field">费用（元）<input inputMode="decimal" placeholder="留空表示未知；0 表示免费" value={state.fields.cost} disabled={frozen} onChange={event => edit('cost', event.target.value)}/></label></div>
    <section className="form-block form-notes editor-media-notes"><label htmlFor="maintenance-description">说明</label><textarea id="maintenance-description" placeholder="请输入维护说明" maxLength={10000} value={state.fields.description} disabled={frozen} onChange={event => edit('description', event.target.value)}/><div className="photo-strip">{state.photos.map(photo => <span className="photo-tile" key={photo.id}>{blocked ? <span>原资料库图片 · {photo.name}</span> : <PhotoView photo={photo} generation={state.generation}/>}<span className="photo-name">{photo.name}</span><button type="button" disabled={frozen} onClick={() => removePhoto(photo.id)}>移除</button></span>)}<AddImageButton disabled={frozen} onClick={()=>void pickPhoto()}/></div></section>
    <aside className="settlement"><span>当前已知维护</span><strong>{money(state.record.costs.known_maintenance_cents)}</strong><span>{state.record.costs.unknown_maintenance_count ? `${state.record.costs.unknown_maintenance_count} 条费用待补录` : '费用完整'}</span></aside>
    {notice && <p className="notice" role="status">{notice}</p>}
    {conflict && issue?.latest && <div className="confirm">
      <strong>当前已保存版本 {issue.latest.asset.revision} · {issue.latest.asset.name}</strong>
      <p>购入日期：{issue.latest.asset.purchase_date ?? '待补充'}；购入金额：{money(issue.latest.asset.price_cents)}</p>
      <p>当前维护：{state.maintenance_id ? (() => { const item = issue.latest!.maintenances.find(item => item.id === state.maintenance_id)!; return `${item.fields.title} · ${item.fields.date ?? '日期未知'} · ${money(item.fields.cost_cents)}`; })() : `${issue.latest.maintenances.length} 条`}</p>
      <p>上方保留你的原输入，尚未覆盖当前记录。</p>
      <button type="button" disabled={busy} onClick={acceptLatest}>确认保留我的输入并使用最新版本</button>
    </div>}


  </form></dialog>;
}
