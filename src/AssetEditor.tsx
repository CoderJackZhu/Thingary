import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, inputMoney, localDay, validate } from './asset';
import { PhotoView } from './Photos';
import { CategorySelect, ChannelSelect } from './TaxonomyFields';
import type { TaxonomySnapshot } from './taxonomy';
import type { Classification } from './asset';
import type { Photo } from './asset';
import type { AssetRecord, Fields, SaveAsset } from './asset';
export const draftKey = 'possio.asset-draft.v1';
export type Draft = { classification?: Classification; originalClassification?: Classification; photos?: Photo[]; cover?: string | null; originalMedia?: {photos: Photo[]; cover: string | null}; photoError?: string; fields: Fields; original: Fields; generation: string; id: string | null; revision: number | null; pending: SaveAsset | null };
export type CloseIntent = 'form' | 'window' | 'quit';
export function AssetEditor({ initial, taxonomy, closeIntent, onKeep, onClose, onSaved }: { initial: Draft; taxonomy: TaxonomySnapshot | null; closeIntent: CloseIntent | null; onKeep: () => void; onClose: (intent: CloseIntent) => void; onSaved: (record: AssetRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => ['brand', 'model', 'serial_number', 'notes'].some(k => !!initial.fields[k as keyof Fields]) || !!initial.classification?.channel_id);
  const lock = useRef(false);
  const [notice, setNotice] = useState(initial.pending ? '上次提交结果待核对，请先检查，避免重复建档。' : '');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<AssetRecord | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [confirm, setConfirm] = useState<CloseIntent | null>(null);
  const photos = draft.photos ?? [];
  const dirty = JSON.stringify(draft.classification) !== JSON.stringify(draft.originalClassification) || JSON.stringify(draft.fields) !== JSON.stringify(draft.original) || !!draft.photoError || JSON.stringify({photos, cover: draft.cover ?? null}) !== JSON.stringify(draft.originalMedia ?? {photos: [], cover: null});
  useEffect(() => { dialog.current?.showModal(); document.getElementById('field-name')?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) askClose(closeIntent); }, [closeIntent]);
  function remember(next: Draft) { localStorage.setItem(draftKey, JSON.stringify(next)); setDraft(next); }
  function change(key: keyof Fields, value: string) {
    const next = { ...draft, fields: { ...draft.fields, [key]: value } };
    setDraft(next); setErrors(e => ({ ...e, [key]: undefined }));
    try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { setNotice('草稿暂存失败，请保持窗口打开并保存资料。'); }
  }
  function classify(key: keyof Classification, value: string | null) {
    const next = {...draft, classification: {...(draft.classification ?? {category_id:null,channel_id:null}),[key]:value}};
    setDraft(next);
    try { localStorage.setItem(draftKey,JSON.stringify(next)); } catch { setNotice('草稿暂存失败，请保持窗口打开并保存。'); }
  }
  function media(next: Draft) { setDraft(next); try { localStorage.setItem(draftKey, JSON.stringify(next)); return true; } catch { setNotice('图片草稿暂存失败，请保持窗口打开并保存。'); return false; } }
  async function pickPhoto() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const photo = await invoke<Photo | null>('pick_photo', { generation: draft.generation, repair: null });
      if (photo && media({ ...draft, photos: [...photos, photo], cover: photos.length === 0 ? photo.id : draft.cover, photoError: '' })) setNotice('图片已准备好，将随资料一起保存。');
    } catch (e) { media({ ...draft, photoError: errorMessage(e) }); }
    finally { lock.current = false; setBusy(false); }
  }
  function askClose(intent: CloseIntent) {
    if (lock.current || draft.pending) { setNotice('请先核对这次保存结果，再关闭表单。'); onKeep(); return; }
    if (dirty) setConfirm(intent); else onClose(intent);
  }
  function success(record: AssetRecord) { localStorage.removeItem(draftKey); onSaved(record); }
  async function resolvePending() {
    if (!draft.pending || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await invoke<AssetRecord | null>('saved_request', { request: draft.pending.base.request_id, generation: draft.pending.base.generation });
      if (result) success(result);
      else { remember({ ...draft, pending: null }); setNotice('确认尚未保存。输入已保留，可修改或再次保存。'); }
    } catch (e) { setNotice(errorMessage(e) + ' 输入与原请求已保留。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current || draft.pending || draft.photoError) return;
    if (!taxonomy) { setNotice('分类与渠道尚未读取，请稍后重试。'); return; }
    for (const [id, entries] of [[draft.classification?.category_id, taxonomy.categories], [draft.classification?.channel_id, taxonomy.channels]] as const) {
      if (id && !entries.some(e => e.id === id)) { setNotice('分类或购买渠道已不可用，请重新选择。'); setMoreOpen(true); return; }
    }
    const checked = validate(draft.fields, localDay()); setErrors(checked);
    const first = Object.keys(checked)[0];
    if (first) {
      if (['brand', 'model', 'serial_number', 'notes'].includes(first)) setMoreOpen(true);
      requestAnimationFrame(() => document.getElementById('field-' + first)?.focus());
      return;
    }
    lock.current = true; setBusy(true); setNotice('正在保存…'); setConflict(false);
    const { name, price, date, ...details } = draft.fields;
    const input: SaveAsset = { classification: draft.classification, base: { request_id: crypto.randomUUID(), generation: draft.generation, asset_id: draft.id, expected_revision: draft.revision, name, price_cents: inputMoney(price), purchase_date: date || null }, details, photos: { ids: photos.map(p => p.id), cover_id: draft.cover ?? null } };
    try { remember({ ...draft, pending: input }); }
    catch { lock.current = false; setBusy(false); setNotice('无法暂存本次请求，尚未提交。请检查可用空间后重试。'); return; }
    try { success(await invoke<AssetRecord>('save_asset', { input })); }
    catch (e) {
      try {
        const result = await invoke<AssetRecord | null>('saved_request', { request: input.base.request_id, generation: input.base.generation });
        if (result) { success(result); return; }
        remember({ ...draft, pending: null });
        setConflict(typeof e === 'object' && e !== null && 'code' in e && e.code === 'REVISION_CONFLICT');
        setNotice(errorMessage(e) + ' 输入已保留。');
      } catch { setNotice('暂时无法确认保存结果。输入与原请求已保留，请点击“检查提交结果”。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reloadLatest() {
    if (!draft.id) return;
    try {
      const record = await invoke<AssetRecord | null>('read_asset', { id: draft.id });
      if (!record || record.deleted) { setNotice(record ? '这件物品已移入最近删除，无法覆盖。' : '找不到这件物品，输入仍保留。'); return; }
      setLatest(record);
      setNotice('下方是当前已保存的资料。你的输入仍保留在表单中；请比较后决定。');
    } catch (e) { setNotice(errorMessage(e)); }
  }
  function field(key: keyof Fields, label: string, hint?: string, type = 'text') {
    return <label className={'field ' + (key === 'name' || key === 'notes' ? 'wide' : '')} htmlFor={'field-' + key} key={key}>
      <span>{label}</span>{key === 'notes' ? <textarea id={'field-' + key} rows={4} value={draft.fields[key]} onChange={e => change(key, e.target.value)} disabled={busy || !!draft.pending} aria-invalid={!!errors[key]} aria-describedby={'help-' + key}/> : <input id={'field-' + key} autoFocus={key === 'name'} type={type} placeholder={key === 'date' ? 'YYYY-MM-DD（可留空）' : undefined} value={draft.fields[key]} onChange={e => change(key, e.target.value)} disabled={busy || !!draft.pending} aria-invalid={!!errors[key]} aria-describedby={'help-' + key} autoComplete="off"/>}
      <small id={'help-' + key} className={errors[key] ? 'error' : ''}>{errors[key] || hint}</small>
    </label>;
  }
  return <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onCancel={e => { e.preventDefault(); askClose('form'); }}>
    <form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
      <header><div><p className="eyebrow">物品档案</p><h2 id="editor-title">{draft.id ? '编辑资料' : '记录一件物品'}</h2></div><button type="button" className="icon-button" aria-label="关闭表单" onClick={() => askClose('form')}>×</button></header>
      <p className="muted">只填写名称也可以。其余资料，想起时再补。</p>
      <div className="fields">{field('name', '名称（必填）')}{field('price', '购入金额（元）', '留空表示未知；0 表示确实免费。')}{field('date', '购入日期', '不确定时留空，不自动填写今天。')}<CategorySelect id="field-category" entries={taxonomy?.categories ?? []} value={draft.classification?.category_id ?? null} onChange={id => classify('category_id',id)} disabled={busy || !!draft.pending || !taxonomy}/>
      </div>
      <section className="photo-section" aria-labelledby="photo-title"><div className="photo-heading"><h3 id="photo-title">封面与图片</h3><button type="button" disabled={busy || !!draft.pending || photos.length >= 20} onClick={() => void pickPhoto()}>添加图片</button></div>
        <p className="muted small">JPEG、PNG、HEIC、WebP · 最多 20 张，每张 20 MiB。</p>
        <div className="photo-strip">{photos.map(photo => <div className="photo-tile" key={photo.id}><PhotoView photo={photo} generation={draft.generation}/><span className="photo-name">{photo.name}</span><div className="photo-actions"><button type="button" disabled={busy || !!draft.pending} aria-pressed={draft.cover === photo.id} onClick={() => media({ ...draft, cover: draft.cover === photo.id ? null : photo.id })}>{draft.cover === photo.id ? '✓ 封面' : '设为封面'}</button><button type="button" disabled={busy || !!draft.pending} aria-label={'移除图片 ' + photo.name} onClick={() => media({ ...draft, photos: photos.filter(p => p.id !== photo.id), cover: draft.cover === photo.id ? null : draft.cover })}>移除</button></div></div>)}</div>
        {draft.photoError && <div role="alert" className="confirm"><p>{draft.photoError}。请重试，或明确取消这次选图后再保存。</p><button type="button" disabled={busy} onClick={() => void pickPhoto()}>重新选择</button><button type="button" disabled={busy} onClick={() => media({ ...draft, photoError: '' })}>不使用这次未读取的图片</button></div>}
      </section>
      <details className="more-fields" open={moreOpen} onToggle={e => setMoreOpen(e.currentTarget.open)}><summary>更多资料<span>品牌、型号、渠道、序列号与备注</span></summary><div className="fields">{field('brand', '品牌')}{field('model', '型号')}{field('serial_number', '序列号')}<ChannelSelect id="field-channel" entries={taxonomy?.channels ?? []} value={draft.classification?.channel_id ?? null} onChange={id => classify('channel_id',id)} disabled={busy || !!draft.pending || !taxonomy}/>{field('notes', '备注')}</div></details>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {latest && <div className="confirm"><strong>当前已保存：{latest.asset.name}</strong><p>购入金额：{latest.asset.price_cents === null ? '待补充' : (Number(latest.asset.price_cents) / 100).toFixed(2)} 元；日期：{latest.asset.purchase_date || '待补充'}</p><p>品牌：{latest.details.brand || '待补充'}；型号：{latest.details.model || '待补充'}；序列号：{latest.details.serial_number || '待补充'}</p><p className="notes">备注：{latest.details.notes || '无'}</p><p>分类：{taxonomy?.categories.find(e => e.id === latest.classification?.category_id)?.name || '未分类'}；渠道：{taxonomy?.channels.find(e => e.id === latest.classification?.channel_id)?.name || '未记录'}</p><p>图片：{latest.photos.length} 张；确认替换时，将以表单中的图片和封面为准。</p><button type="button" onClick={() => { remember({ ...draft, revision: latest.asset.revision }); setConflict(false); setLatest(null); setNotice('已确认以表单中的输入替换该版本，请点击保存资料。'); }}>确认用我的输入替换此版本</button></div>}
      {confirm ? <div className="confirm" role="alert"><strong>放弃未保存的修改？</strong><p>这次输入还没有写入资产档案。</p><div className="actions"><button type="button" onClick={() => { setConfirm(null); onKeep(); }}>继续编辑</button><button type="button" className="danger" onClick={() => onClose(confirm)}>放弃修改</button></div></div> : <footer className="actions">
        {conflict && <button type="button" onClick={() => void reloadLatest()}>核对最新版本</button>}
        {draft.pending ? <button type="button" className="primary" disabled={busy} onClick={() => void resolvePending()}>检查提交结果</button> : <><button type="button" disabled={busy} onClick={() => askClose('form')}>取消</button><button type="submit" className="primary" disabled={busy || conflict || !!draft.photoError}>{busy ? '正在保存…' : '保存资料'}</button></>}
      </footer>}
    </form>
  </dialog>;
}
