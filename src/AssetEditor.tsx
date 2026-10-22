import { CloseButton } from './CloseButton';
import {persistSubmission} from './editor-session';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, inputMoney, localDay, money, validate } from './asset';
import { PhotoView, PhotoPreview } from './Photos';
import { DefaultAssetIcon, IconPicker, type IconChoice } from './IconPicker';
import { replaceDraftCover } from './asset-media';
import { FormRow, ChoiceField, AddImageButton } from './FormControls';
import { AssetOptionsFields } from './AssetOptionsFields';
import { changeNewAssetWarrantyPurchase, defaultPreferences, type AssetOptions } from './preferences';
import { DateInput } from './DateInput';
import { identityFoldOpen, supplementalField } from './asset-editor-layout';
import type { TaxonomySnapshot } from './taxonomy';
import type { Classification } from './asset';
import type { Photo } from './asset';
import type { AssetRecord, Fields, SaveAsset } from './asset';
import { t } from './i18n.ts';
export const draftKey = 'thingary.asset-draft.v1';
// Older drafts predate photoErrorKind; a missing kind means the file picker flow.
// A conversion draft creates the asset through convert_wishlist; the estimate is shown, never copied into the price.
export type Conversion = { wishlist_id: string; expected_revision: number; wish_name: string; estimated_price_cents: string | null; cover_notice?: string };
export type Draft = { warrantyEndEdited?:boolean; options?:AssetOptions; originalOptions?:AssetOptions; transientCover?: string; conversion?: Conversion; classification?: Classification; originalClassification?: Classification; photos?: Photo[]; cover?: string | null; originalMedia?: {photos: Photo[]; cover: string | null}; photoError?: string; photoErrorKind?: 'material' | 'file'; fields: Fields; original: Fields; generation: string; id: string | null; revision: number | null; pending: SaveAsset | null };
export type CloseIntent = 'form' | 'window' | 'quit';
export function AssetEditor({ initial, taxonomy, closeIntent, onKeep, onClose, onSaved, onDelete }: { initial: Draft; taxonomy: TaxonomySnapshot | null; closeIntent: CloseIntent | null; onKeep: () => void; onClose: (intent: CloseIntent) => void; onSaved: (record: AssetRecord) => void; onDelete?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<Photo | null>(null);
  const pickerWasOpen = useRef(false);
  useLayoutEffect(() => {
    if (!pickerOpen && pickerWasOpen.current) dialog.current?.querySelector<HTMLButtonElement>('.asset-avatar-button')?.focus();
    pickerWasOpen.current = pickerOpen;
  }, [pickerOpen]);
  const [moreOpen, setMoreOpen] = useState(() => identityFoldOpen(initial.fields));
  const lock = useRef(false);
  const [notice, setNotice] = useState(initial.pending ? '上次提交结果待核对，请先检查，避免重复建档。' : initial.conversion?.cover_notice ?? '');
  const conversion = draft.conversion;
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<AssetRecord | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const photos = draft.photos ?? [];
  const options = draft.options ?? {preferences:defaultPreferences()};
  const disabled = busy || !!draft.pending;
  useEffect(() => { dialog.current?.showModal(); document.getElementById('field-name')?.focus(); return () => dialog.current?.close(); }, []);  useEffect(() => { if (closeIntent) askClose(closeIntent); }, [closeIntent]);
  function remember(next: Draft) { persistSubmission(draftKey, next); setDraft(next); }
  function change(key: keyof Fields, value: string) {
    const next = { ...draft, fields: { ...draft.fields, [key]: value } };
    if (key === 'date' && !draft.id && options.warranty && !validate(next.fields,localDay()).date) {
      next.options = {...options,warranty:changeNewAssetWarrantyPurchase(options.warranty,value || null,localDay(),draft.warrantyEndEdited)};
    }
    setDraft(next); setErrors(e => ({ ...e, [key]: undefined }));
    try { persistSubmission(draftKey, next); } catch { setNotice('暂时无法更新编辑状态，请重试。'); }
  }
  function classify(key: keyof Classification, value: string | null) {
    const next = {...draft, classification: {...(draft.classification ?? {category_id:null,channel_id:null}),[key]:value}};
    setDraft(next);
    try { persistSubmission(draftKey, next); } catch { setNotice('暂时无法更新编辑状态，请重试。'); }
  }
  function media(next: Draft) { setDraft(next); try { persistSubmission(draftKey, next); return true; } catch { setNotice('暂时无法更新图片编辑状态，请重试。'); return false; } }
  async function pickPhoto() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const photo = await invoke<Photo | null>('pick_photo', { generation: draft.generation, repair: null });
      if (photo && media({ ...draft, photos: [...photos, photo], cover: draft.cover, photoError: '', photoErrorKind: undefined })) setNotice('图片已准备好，将随资料一起保存。');
    } catch (e) { media({ ...draft, photoError: errorMessage(e), photoErrorKind: 'file' }); }
    finally { lock.current = false; setBusy(false); }
  }
  function openPicker() { setPickerOpen(true); }
  function closePicker() {
    setPickerOpen(false);
  }
  async function applyIcon(choice: IconChoice) {
    if (lock.current || draft.pending) throw new Error(t('请先完成当前操作。'));
    lock.current = true; setBusy(true);
    try {
      const photo = choice.kind === 'default' ? null : choice.kind === 'photo' ? choice.photo : await invoke<Photo>('prepare_material', { input: { id: choice.entry.id, generation: draft.generation } });
      const next = replaceDraftCover(photos, draft.transientCover, photo, !!photo && !photos.some(p => p.id === photo.id));
      if (media({ ...draft, ...next, ...(draft.photoErrorKind === 'material' ? { photoError: '', photoErrorKind: undefined } : {}) })) setNotice('物品图标已选择，保存物品后生效。');
    } finally { lock.current = false; setBusy(false); }
  }
  function askClose(intent: CloseIntent) {
    if (pickerOpen) { setNotice('请先完成或取消图标选择，再关闭表单。'); onKeep(); return; }
    if (lock.current || draft.pending) { setNotice('请先核对这次保存结果，再关闭表单。'); onKeep(); return; }
    onClose(intent);
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
    const checked = validate(draft.fields, localDay()); setErrors(checked);
    const first = Object.keys(checked)[0];
    if (first) {
      if (Object.keys(checked).some(supplementalField)) setMoreOpen(true);
      requestAnimationFrame(() => document.getElementById('field-' + first)?.focus());
      return;
    }
    lock.current = true; setBusy(true); setNotice('正在保存…'); setConflict(false);
    const { name, price, date, ...details } = draft.fields;
    const input: SaveAsset = { options, classification: draft.classification, base: { request_id: crypto.randomUUID(), generation: draft.generation, asset_id: draft.id, expected_revision: draft.revision, name, price_cents: inputMoney(price), purchase_date: date || null }, details, photos: { ids: photos.map(p => p.id), cover_id: draft.cover ?? null } };
    try { remember({ ...draft, pending: input }); }
    catch { lock.current = false; setBusy(false); setNotice('无法暂存本次请求，尚未提交。请检查可用空间后重试。'); return; }
    try { success(conversion ? await invoke<AssetRecord>('convert_wishlist', { input: { wishlist_id: conversion.wishlist_id, expected_revision: conversion.expected_revision, asset: input } }) : await invoke<AssetRecord>('save_asset', { input })); }
    catch (e) {
      try {
        const result = await invoke<AssetRecord | null>('saved_request', { request: input.base.request_id, generation: input.base.generation });
        if (result) { success(result); return; }
        remember({ ...draft, pending: null });
        setConflict(!conversion && typeof e === 'object' && e !== null && 'code' in e && e.code === 'REVISION_CONFLICT');
        setNotice(errorMessage(e) + (conversion ? ' 心愿未被转换，输入已保留；如心愿已变化，请取消后回到心愿清单重新读取。' : ' 输入已保留。'));
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
    if (key === 'date') return <div className="field" key={key}>
      <label htmlFor="field-date">{label}</label><DateInput yearIntent="past" id="field-date" value={draft.fields.date} onChange={value => change('date', value)} disabled={busy || !!draft.pending} max={localDay()} allowClear invalid={!!errors.date} describedBy="help-date"/>
      <small id="help-date" className={errors.date ? 'error' : ''}>{errors.date || hint}</small>
    </div>;
    return <label className={'field ' + (key === 'name' || key === 'notes' ? 'wide' : '')} htmlFor={'field-' + key} key={key}>
      <span>{label}</span>{key === 'notes' ? <textarea id={'field-' + key} placeholder={t('例如：存放在书房左侧柜；保修卡在抽屉')} rows={8} value={draft.fields[key]} onChange={e => change(key, e.target.value)} disabled={busy || !!draft.pending} aria-invalid={!!errors[key]} aria-describedby={'help-' + key}/> : <input id={'field-' + key} autoFocus={key === 'name'} type={type} placeholder={key === 'name' ? t('请输入物品名称') : key==='price'?t('请输入物品价格'):undefined} value={draft.fields[key]} onChange={e => change(key, e.target.value)} disabled={busy || !!draft.pending} aria-invalid={!!errors[key]} aria-describedby={'help-' + key} autoComplete="off"/>}
      <small id={'help-' + key} className={errors[key] ? 'error' : ''}>{errors[key] || hint}</small>
    </label>;
  }
  const coverPhoto = photos.find(p => p.id === draft.cover);
  const attachments = photos.filter(p => p.id !== draft.cover);
  return <dialog ref={dialog} className={pickerOpen ? "icon-picker-host" : `editor asset-editor${draft.id ? ' asset-editor-existing' : ''}`} aria-labelledby={pickerOpen ? "icon-picker-title" : "editor-title"} onCancel={e => { e.preventDefault(); askClose('form'); }}>
    <form hidden={pickerOpen} noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
      <header><div><p className="eyebrow">{conversion ? t('心愿清单 · 记录这次购入') : t('物品档案')}</p><h2 id="editor-title">{conversion ? t('记录这次购入') : draft.id ? t('编辑资料') : t('新增物品')}</h2></div><CloseButton type="button" className="icon-button" aria-label={t('关闭表单')} onClick={() => askClose('form')}/><div className="editor-header-actions">
        {draft.id && !conversion && onDelete && <button type="button" className="danger" disabled={busy || !!draft.pending || pickerOpen} onClick={onDelete}>{t('删除物品')}</button>}
        {conflict && <button type="button" onClick={() => void reloadLatest()}>{t('核对最新版本')}</button>}
        {draft.pending ? <button type="button" className="primary" disabled={busy} onClick={() => void resolvePending()}>{t('检查提交结果')}</button> : <button type="submit" className="primary" disabled={busy || conflict || !!draft.photoError}>{busy ? t('正在保存…') : conversion ? t('保存购入记录') : t('保存物品')}</button>}
      </div></header>
      {notice && <p className="notice editor-notice" role="status" aria-live="polite" aria-atomic="true">{notice}</p>}
      <div className="editor-body">
      {conversion ? <p className="muted">{t('由心愿「{wish_name}」转入。', { wish_name: conversion.wish_name })}{conversion.estimated_price_cents === null ? t('心愿未填预计价格。') : t('预计 {v1} 仅作参考，不会当作实付金额。', { v1: money(conversion.estimated_price_cents) })}{t('请填写实际购入金额和日期；留空表示未知，相关成本指标将无法计算。保存后确认为已购入。')}</p> : <p className="muted">{t('只填写名称也可以。其余资料，想起时再补。')}</p>}
      <div className="asset-identity-editor"><button type="button" className="asset-avatar-button" aria-label={t('选择物品图标')} title={t('选择物品图标')} disabled={busy || !!draft.pending} onClick={openPicker}>{coverPhoto ? <PhotoView photo={coverPhoto} generation={draft.generation}/> : <DefaultAssetIcon/>}<span className="avatar-edit">{t('更换图标')}</span></button>{field('name', '物品名称')}</div>
      <section className="form-block"><FormRow label={t('购买价格（元）')}>{field('price','购买价格','留空为未知；0 为免费。')}</FormRow><FormRow label={t('购买日期')}>{field('date','购买日期','留空为未知。')}</FormRow><FormRow label={t('分类')}><ChoiceField kind="category" label={t('分类')} generation={draft.generation} value={draft.classification?.category_id??null} onChange={id=>classify('category_id',id)} disabled={disabled}/></FormRow><FormRow label={t('标签')}><ChoiceField kind="label" label={t('标签')} domain="physical" generation={draft.generation} value={options.preferences.label_id} onChange={label_id=>remember({...draft,options:{...options,preferences:{...options.preferences,label_id}}})} disabled={disabled}/></FormRow><FormRow label={t('购买渠道')}><ChoiceField kind="channel" label={t('购买渠道')} generation={draft.generation} value={draft.classification?.channel_id??null} onChange={id=>classify('channel_id',id)} disabled={disabled}/></FormRow></section>
      <section className="form-block form-notes">{field('notes','备注')}<div className="photo-strip">{attachments.map(photo=><div className="photo-tile" key={photo.id}><button type="button" className="photo-open" aria-label={'查看图片'+photo.name} onClick={()=>setPreview(photo)}><PhotoView photo={photo} generation={draft.generation} compact/></button><button type="button" className="photo-remove" disabled={disabled} aria-label={'移除图片'+photo.name} onClick={()=>media({...draft,photos:photos.filter(p=>p.id!==photo.id)})}>{t('移除')}</button></div>)}<AddImageButton tile disabled={disabled||photos.length>=20} onClick={()=>void pickPhoto()}/></div></section>
      <AssetOptionsFields options={options} generation={draft.generation} disabled={disabled} existing={!!draft.id} purchaseDate={draft.fields.date||null} onChange={options=>remember({...draft,options,warrantyEndEdited:!!options.warranty && (!!draft.warrantyEndEdited || !!draft.options?.warranty && options.warranty.end_date !== draft.options.warranty.end_date)})}>
        <details className="more-fields" open={moreOpen} onToggle={e => setMoreOpen(e.currentTarget.open)}><summary>{t('品牌 · 型号 · 序列号')}</summary><div className="fields">{field('brand', '品牌')}{field('model', '型号')}{field('serial_number', '序列号')}</div></details>
      </AssetOptionsFields>
        {draft.photoError && <div role="alert" className="confirm"><p>{t('{photoError}。请重试，或明确取消这次选图后再保存。', { photoError: draft.photoError })}</p><button type="button" disabled={busy} onClick={() => draft.photoErrorKind === 'material' ? openPicker() : void pickPhoto()}>{t('重新选择')}</button><button type="button" disabled={busy} onClick={() => media({ ...draft, photoError: '', photoErrorKind: undefined })}>{draft.photoErrorKind === 'material' ? t('不使用这次未添加的素材') : t('不使用这次未读取的图片')}</button></div>}
      {latest && <div className="confirm"><strong>{t('当前已保存：{name}', { name: latest.asset.name })}</strong><p>{t('购入金额：')}{latest.asset.price_cents === null ? t('待补充') : (Number(latest.asset.price_cents) / 100).toFixed(2)} {t('元；日期：')}{latest.asset.purchase_date || t('待补充')}</p><p>{t('品牌：')}{latest.details.brand || t('待补充')}{t('；型号：')}{latest.details.model || t('待补充')}{t('；序列号：')}{latest.details.serial_number || t('待补充')}</p><p className="notes">{t('备注：')}{latest.details.notes || t('无')}</p><p>{t('分类：')}{taxonomy?.categories.find(e => e.id === latest.classification?.category_id)?.name || t('未分类')}{t('；渠道：')}{taxonomy?.channels.find(e => e.id === latest.classification?.channel_id)?.name || t('未记录')}</p><p>{t('图片：{length} 张；确认替换时，将以表单中的图片和封面为准。', { length: latest.photos.length })}</p><button type="button" onClick={() => { remember({ ...draft, revision: latest.asset.revision }); setConflict(false); setLatest(null); setNotice('已确认以表单中的输入替换该版本，请点击保存资料。'); }}>{t('确认用我的输入替换此版本')}</button></div>}

    </div></form>
  {preview && <PhotoPreview photo={preview} generation={draft.generation} onClose={() => setPreview(null)}/>}
  {pickerOpen && <IconPicker generation={draft.generation} photos={photos} cover={draft.cover ?? null} onClose={closePicker} onUse={applyIcon}/>}</dialog>;
}
