import { useEffect, useRef, useState } from 'react';
import './date.css';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, inputMoney, type AssetRecord, type Fields, type Photo } from '../../asset';
import { changeNewAssetWarrantyPurchase, newAssetWarranty, type AssetPreferences } from '../../preferences';
import { replaceDraftCover } from '../../asset-media';
import { allowReminders } from '../../NotificationNotice';
import { materialArt } from '../../materials';
import { PhotoView } from '../../Photos';
import { identityFoldOpen } from '../../asset-editor-layout';
import { submit } from '../../wealth';
import type { TaxonomySnapshot } from '../../taxonomy';
import { useDirtyGuard, useFormChanged, useNav } from '../nav-context';
import { useSession } from '../session';
import type { PageProps } from '../routes';
import { Button, DateField, ErrorState, FormGroup, FormRow, Loading, MoneyField, NavBar, Notice, SelectField, Sheet, Switch, TextField } from '../ui';
import { clearIconSession, itemDraft, itemSaveInput, setIconSession, type ItemDraft } from './edit-model';
import { Glyph } from './glyphs';
import { PhotoThumbs, PhotoViewer } from './PhotoViewer';
import './edit.css';

type Choice = { id: string; name: string; enabled: boolean; scope?: string | null };
type Catalog = TaxonomySnapshot & { generation: string };
export default function ItemEdit({ params }: PageProps) {
  const nav = useNav(), session = useSession(), id = typeof params.id === 'string' ? params.id : null;
  const [draft, setDraft] = useState<ItemDraft | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null), [labels, setLabels] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState(''), [photoError, setPhotoError] = useState(''), [retry, setRetry] = useState(0), [savedId, setSavedId] = useState(''), [foldOpen, setFoldOpen] = useState(false), [addSheet, setAddSheet] = useState(false), [viewing, setViewing] = useState<Photo | null>(null);
  const [localBusy, setLocalBusy] = useState(false), lock = useRef(false), camera = useRef<HTMLInputElement>(null), album = useRef<HTMLInputElement>(null), channel = useRef(crypto.randomUUID()), submitted = useRef<string | null>(null);
  useDirtyGuard(useFormChanged(draft));
  const contextChanged=!!catalog && !!session.data && catalog.generation!==session.data.summary.generation;
  const disabled = session.navBlocked || localBusy || contextChanged;
  useEffect(() => {
    let live = true; setLoading(true); setLoadError('');
    (async () => {
      const nextCatalog=await invoke<Catalog>('taxonomy_snapshot');
      const [nextLabels,record]=await Promise.all([invoke<{items:Choice[]}>('choice_list',{kind:'label'}),id?invoke<AssetRecord|null>('read_asset',{id}):Promise.resolve(null)]);
      const after=await invoke<Catalog>('taxonomy_snapshot');
      if(after.generation!==nextCatalog.generation)throw new Error('资料库已切换，请重新读取物品。');
      return {nextCatalog,nextLabels,record};
    })().then(({nextCatalog,nextLabels,record}) => {
      if (!live) return;
      if (id && (!record || record.deleted)) throw new Error('这件物品已删除或无法读取。请返回物品列表核对。');
      setCatalog(nextCatalog); setLabels(nextLabels.items.filter(entry => (entry.enabled && entry.scope !== 'virtual') || entry.id === record?.preferences?.label_id)); { const next = itemDraft(record); setDraft(next); setFoldOpen(identityFoldOpen(next.fields)); }
    }).catch(cause => { if (live) setLoadError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, retry]);
  useEffect(() => () => clearIconSession(channel.current), []);
  useEffect(() => { if (savedId && !session.navBlocked) { session.reload(); if (id) nav.pop(); else nav.replace('items.detail', { id: savedId }); } }, [savedId, session.navBlocked]);
  useEffect(() => {
    const settled = session.settled;
    if (!settled || settled.command !== 'save_asset' || !('base' in settled.input) || !submitted.current || !catalog || settled.input.base.request_id !== submitted.current || settled.input.base.generation !== catalog.generation) return;
    session.setNotice?.('已确认物品保存，请核对保存后的档案。');
    const request = submitted.current;
    let live = true;
    invoke<AssetRecord | null>('saved_request', { request, generation: catalog.generation }).then(record => { if (live && record) setSavedId(record.asset.id); }).catch(cause => { if (live) setNotice(errorMessage(cause) + ' 请重试读取保存后的物品。'); });
    return () => { live = false; };
  }, [session.settled, catalog]);
  function change(key: keyof Fields, value: string) {
    setDraft(current => {
      if (!current) return current;
      const next = { ...current, fields: { ...current.fields, [key]: value } };
      if (key === 'date' && !current.id && current.options.warranty) next.options = { ...current.options, warranty: changeNewAssetWarrantyPurchase(current.options.warranty, value || null, session.today, current.warrantyEndEdited) };
      return next;
    });
  }
  function preferences(patch: Partial<AssetPreferences>) { setDraft(current => current && ({ ...current, options: { ...current.options, preferences: { ...current.options.preferences, ...patch } } })); }
  function openIcons() {
    if (!draft || !catalog || disabled) return;
    setIconSession(channel.current, { generation: catalog.generation, photos: draft.photos, cover: draft.cover, choose: (photo, prepared) => { setDraft(current => { if(!current)return current; const next=replaceDraftCover(current.photos,current.transientCover,photo,prepared);return {...current,...next}; }); } });
    nav.push('items.icon', { channel: channel.current });
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !draft || !catalog || lock.current || disabled) return;
    const list = Array.from(files);
    if (list.length + draft.photos.length > 20) { setPhotoError('最多保存 20 张图片，请减少所选图片。'); return; }
    if (list.some(file => file.size > 20 * 1024 * 1024)) { setPhotoError('每张图片不得超过 20 MiB。'); return; }
    lock.current = true; setLocalBusy(true); session.setBusy(true); setPhotoError('');
    try {
      for (const file of list) {
        const photo = await invoke<Photo>('import_photo_bytes', { generation: catalog.generation, name: file.name || '拍摄的图片.jpg', bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
        setDraft(current => current && ({ ...current, photos: [...current.photos, photo] }));
      }
      setNotice('图片已准备好，保存物品后生效。');
    } catch (cause) { setPhotoError(errorMessage(cause) + ' 已成功读取的图片保留，请检查后重试。'); }
    finally { lock.current = false; setLocalBusy(false); session.setBusy(false); }
  }
  async function save() {
    if (!draft || !catalog || lock.current || disabled || photoError) return;
    let input;
    try { input = itemSaveInput(draft, catalog.generation, session.today, crypto.randomUUID()); }
    catch (cause) { setNotice(errorMessage(cause)); return; }
    lock.current = true; session.setBusy(true); setNotice(''); submitted.current = input.base.request_id;
    try { const record = await submit<AssetRecord>({ command: 'save_asset', input, label: draft.id ? '编辑物品' : '新增物品' }); setSavedId(record.asset.id); }
    catch (cause) { setNotice(errorMessage(cause) + ' 当前输入已保留。'); }
    finally { lock.current = false; session.setBusy(false); session.refreshPending(); }
  }
  async function enableReminder(checked: boolean) {
    if (!draft?.options.warranty) return;
    const warranty = draft.options.warranty;
    setDraft({ ...draft, options: { ...draft.options, warranty: { ...warranty, reminder: checked ? { date: warranty.end_date, notes: '' } : null } } });
    if (checked) { try { await allowReminders(); } catch (cause) { setNotice(errorMessage(cause)); } }
  }
  function openAddPhoto() { if (disabled || !draft || draft.photos.length >= 20) return; setAddSheet(true); }
  function pickFrom(input: React.RefObject<HTMLInputElement | null>) { setAddSheet(false); input.current?.click(); }
  const p = draft?.options.preferences, coverPhoto = draft?.photos.find(photo => photo.id === draft.cover), attachments = draft?.photos.filter(photo => photo.id !== draft.cover) ?? [];
  const setOptions = (patch: Partial<ItemDraft['options']>) => setDraft(current => current && ({ ...current, options: { ...current.options, ...patch } }));
  return <div className="m-page m-item-edit">
    <NavBar title={id ? '编辑物品' : '新增物品'} primary={{ label: '保存', onClick: () => void save(), disabled: disabled || loading || !!loadError || !!photoError, busy: session.busy }}/>
    {contextChanged && <ErrorState message="资料库已切换，当前输入不能提交。请关闭后重新打开物品。"/>}
    {loading ? <Loading/> : loadError ? <ErrorState message={loadError} onRetry={() => setRetry(value => value + 1)}/> : draft && catalog && p && <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => { void upload(event.target.files); event.target.value = ''; }}/>
      <input ref={album} type="file" accept="image/*" multiple hidden onChange={event => { void upload(event.target.files); event.target.value = ''; }}/>
      <div className="m-item-icon-slot"><button type="button" className="m-item-icon-tile" aria-label="更换图标" onClick={openIcons} disabled={disabled}>{coverPhoto ? <PhotoView photo={coverPhoto} generation={catalog.generation}/> : <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt="默认物品图标"/>}<span className="m-item-icon-badge" aria-hidden="true"><Glyph name="swap" size={14} strokeWidth={2.4}/></span></button></div>
      {photoError && <ErrorState title="图片未全部读取" message={photoError}/>}{photoError && <Button onClick={() => setPhotoError('')}>不使用未读取的图片</Button>}
      {notice && <Notice>{notice}</Notice>}
      <FormGroup><TextField label="名称" value={draft.fields.name} onChange={value => change('name', value)} disabled={disabled} placeholder="物品名称" maxLength={200}/><MoneyField label="购买价格" value={draft.fields.price ? inputCents(draft.fields.price) : ''} onChange={value => change('price', centsInput(value))} disabled={disabled} hint="留空为未知；0 为免费。"/><DateField label="购买日期" value={draft.fields.date} onChange={value => change('date', value)} disabled={disabled} max={session.today} allowClear hint="留空为未知"/><SelectField label="分类" value={draft.classification.category_id ?? ''} options={[{ id: '', label: '未分类' }, ...catalog.categories.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => setDraft({ ...draft, classification: { ...draft.classification, category_id: value || null } })} disabled={disabled}/><SelectField label="标签" value={p.label_id ?? ''} options={[{ id: '', label: '无标签' }, ...labels.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => preferences({ label_id: value || null })} disabled={disabled}/><SelectField label="购买渠道" value={draft.classification.channel_id ?? ''} options={[{ id: '', label: '未记录' }, ...catalog.channels.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => setDraft({ ...draft, classification: { ...draft.classification, channel_id: value || null } })} disabled={disabled}/></FormGroup>
      <section className="m-form-group" aria-label="备注"><h2 className="m-group-title">备注</h2><div className="m-card m-item-notes"><textarea className="m-item-notes-text" aria-label="备注" rows={4} placeholder="例如：存放在书房左侧柜；保修卡在抽屉" value={draft.fields.notes} disabled={disabled} onChange={event => change('notes', event.target.value)}/><PhotoThumbs photos={attachments} generation={catalog.generation} onOpen={setViewing} onAdd={openAddPhoto} addDisabled={disabled || draft.photos.length >= 20}/></div></section>
      {!draft.id && <FormGroup footer={draft.options.warranty ? '默认从购买日期起一年；购买日期未知时从今天起。' : undefined}>
        <FormRow label="保障时间"><Switch label="设置保障时间" checked={!!draft.options.warranty} onChange={checked => setDraft({ ...draft, options: { ...draft.options, warranty: checked ? newAssetWarranty(draft.fields.date || null, session.today) : null } })} disabled={disabled}/></FormRow>
        {draft.options.warranty && <><DateField label="保障结束日期" value={draft.options.warranty.end_date} disabled={disabled} onChange={end_date => setDraft({ ...draft, warrantyEndEdited: true, options: { ...draft.options, warranty: { ...draft.options.warranty!, end_date } } })}/><FormRow label="到期通知"><Switch label="到期通知" checked={!!draft.options.warranty.reminder} onChange={checked => void enableReminder(checked)} disabled={disabled}/></FormRow>{draft.options.warranty.reminder && <DateField label="通知日期" value={draft.options.warranty.reminder.date} onChange={date => setDraft({ ...draft, options: { ...draft.options, warranty: { ...draft.options.warranty!, reminder: { ...draft.options.warranty!.reminder!, date } } } })} disabled={disabled}/>}</>}
        <FormRow label="已退役"><Switch label="已退役" checked={!!draft.options.retired_date} onChange={checked => setOptions({ retired_date: checked ? session.today : null })} disabled={disabled}/></FormRow>
        {draft.options.retired_date && <DateField label="退役日期" value={draft.options.retired_date} max={session.today} disabled={disabled} onChange={retired_date => setOptions({ retired_date })}/>}
        <FormRow label="已售出"><Switch label="已售出" checked={!!draft.options.sale} onChange={checked => setOptions({ sale: checked ? { date: session.today, price_cents: '', platform: '', buyer: '', notes: '' } : null })} disabled={disabled}/></FormRow>
        {draft.options.sale && <><MoneyField label="售出价格" value={draft.options.sale.price_cents} onChange={price_cents => setOptions({ sale: { ...draft.options.sale!, price_cents } })} disabled={disabled}/><TextField label="售出渠道" value={draft.options.sale.platform} onChange={platform => setOptions({ sale: { ...draft.options.sale!, platform } })} disabled={disabled}/><DateField label="售出日期" value={draft.options.sale.date} max={session.today} disabled={disabled} onChange={date => setOptions({ sale: { ...draft.options.sale!, date } })}/></>}
      </FormGroup>}
      {draft.id && <Notice>保障、维护、售出和退役记录请在物品详情中管理。</Notice>}
      <FormGroup><SelectField label="成本计算模式" value={p.cost_mode} options={[{ id: 'daily', label: '按日计算' }, { id: 'per_use', label: '按次计算' }]} onChange={value => preferences({ cost_mode: value as AssetPreferences['cost_mode'] })} disabled={disabled}/>{p.cost_mode === 'per_use' && <TextField label="已使用次数" value={String(p.use_count)} inputMode="numeric" disabled={disabled} onChange={value => { if (/^\d{0,10}$/.test(value)) preferences({ use_count: Number(value) }); }}/>}<SelectField label="目标设定" value={p.goal.mode} options={[{ id: 'none', label: '不设定' }, { id: 'cost', label: '目标单位成本' }, { id: 'date', label: '目标日期' }]} disabled={disabled} onChange={value => preferences({ goal: value === 'cost' ? { mode: 'cost', cents: '' } : value === 'date' ? { mode: 'date', date: '' } : { mode: 'none' } })}/>{p.goal.mode === 'cost' && <MoneyField label="目标单位成本" value={p.goal.cents} onChange={cents => preferences({ goal: { mode: 'cost', cents } })} disabled={disabled}/>}{p.goal.mode === 'date' && <DateField label="目标日期" value={p.goal.date} onChange={date => preferences({ goal: { mode: 'date', date } })} disabled={disabled}/>}</FormGroup>
      <details className="m-card m-item-fold" open={foldOpen} onToggle={event => setFoldOpen(event.currentTarget.open)}><summary>品牌 · 型号 · 序列号</summary><TextField label="品牌" value={draft.fields.brand} onChange={value => change('brand', value)} disabled={disabled}/><TextField label="型号" value={draft.fields.model} onChange={value => change('model', value)} disabled={disabled}/><TextField label="序列号" value={draft.fields.serial_number} onChange={value => change('serial_number', value)} disabled={disabled}/></details>
      <FormGroup><FormRow label="置顶物品"><Switch label="置顶物品" checked={p.pinned} onChange={pinned => preferences({ pinned })} disabled={disabled}/></FormRow><FormRow label="不计入统计"><Switch label="不计入统计" checked={Object.values(p.exclude).some(Boolean)} onChange={checked => preferences({ exclude: { total: checked, daily: checked, statistics: checked, timeline: checked } })} disabled={disabled}/></FormRow>{Object.values(p.exclude).some(Boolean) && (['total', 'daily', 'statistics', 'timeline'] as const).map((key, index) => <FormRow key={key} label={['不计入总金额', '不计入日均成本', '不计入统计页面', '不在时间轴显示'][index]}><Switch label={['不计入总金额', '不计入日均成本', '不计入统计页面', '不在时间轴显示'][index]} checked={p.exclude[key]} onChange={checked => preferences({ exclude: { ...p.exclude, [key]: checked } })} disabled={disabled}/></FormRow>)}</FormGroup>
      {addSheet && <Sheet title="添加图片" cancelLabel="取消" onClose={() => setAddSheet(false)}><div className="m-item-add-sheet"><Button onClick={() => pickFrom(camera)}>拍照</Button><Button onClick={() => pickFrom(album)}>从相册选</Button></div></Sheet>}
      {viewing && <PhotoViewer photo={viewing} generation={catalog.generation} onClose={() => setViewing(null)} onRemove={disabled ? undefined : () => { setDraft(current => current && ({ ...current, photos: current.photos.filter(item => item.id !== viewing.id) })); setViewing(null); }}/>}
    </>}
  </div>;
}
function inputCents(value: string) { return inputMoney(value) ?? ''; }
function centsInput(value: string) { return value ? (Number(value) / 100).toFixed(2) : ''; }
