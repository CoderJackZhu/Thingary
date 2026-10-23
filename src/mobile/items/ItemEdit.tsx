import { useEffect, useRef, useState } from 'react';
import './date.css';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, type AssetRecord, type Fields, type Photo } from '../../asset';
import { applyFa, changeFaCode, CurrencyButton, OriginalInput, RateRow } from '../../ForeignAmount';
import { currencyCode, decimalUnits, parseDecimal } from '../../currency';
import { rememberCurrency, rememberRate } from '../../currency-picker.ts';
import { isForeign, type FaField, type FaState } from '../../foreign-amount.ts';
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
import { Button, DateField, ErrorState, FormGroup, FormRow, Loading, MoneyField, NavBar, Notice, SelectField, Switch, TextField } from '../ui';
import { clearIconSession, itemDraft, itemPriceOrigin, itemSaveInput, setIconSession, type ItemDraft } from './edit-model';
import { Glyph } from './glyphs';
import { PhotoThumbs, PhotoViewer } from './PhotoViewer';
import './edit.css';
import { t } from '../../i18n.ts';
type Choice = { id: string; name: string; enabled: boolean; scope?: string | null };
type Catalog = TaxonomySnapshot & { generation: string };
export default function ItemEdit({ params }: PageProps) {
  const nav = useNav(), session = useSession(), id = typeof params.id === 'string' ? params.id : null;
  const [draft, setDraft] = useState<ItemDraft | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null), [labels, setLabels] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState(''), [photoError, setPhotoError] = useState(''), [retry, setRetry] = useState(0), [savedId, setSavedId] = useState(''), [foldOpen, setFoldOpen] = useState(false), [viewing, setViewing] = useState<Photo | null>(null);
  const [localBusy, setLocalBusy] = useState(false), lock = useRef(false), album = useRef<HTMLInputElement>(null), channel = useRef(crypto.randomUUID()), submitted = useRef<string | null>(null);
  useDirtyGuard(useFormChanged(draft));
  const contextChanged=!!catalog && !!session.data && catalog.generation!==session.data.summary.generation;
  const disabled = session.navBlocked || localBusy || contextChanged;
  useEffect(() => {
    let live = true; setLoading(true); setLoadError('');
    (async () => {
      const nextCatalog=await invoke<Catalog>('taxonomy_snapshot');
      const [nextLabels,record]=await Promise.all([invoke<{items:Choice[]}>('choice_list',{kind:'label'}),id?invoke<AssetRecord|null>('read_asset',{id}):Promise.resolve(null)]);
      const after=await invoke<Catalog>('taxonomy_snapshot');
      if(after.generation!==nextCatalog.generation)throw new Error(t('资料库已切换，请重新读取物品。'));
      return {nextCatalog,nextLabels,record};
    })().then(({nextCatalog,nextLabels,record}) => {
      if (!live) return;
      if (id && (!record || record.deleted)) throw new Error(t('这件物品已删除或无法读取。请返回物品列表核对。'));
      setCatalog(nextCatalog); setLabels(nextLabels.items.filter(entry => (entry.enabled && entry.scope !== 'virtual') || entry.id === record?.preferences?.label_id)); { const next = itemDraft(record); setDraft(next); setFoldOpen(identityFoldOpen(next.fields)); }
    }).catch(cause => { if (live) setLoadError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, retry]);
  useEffect(() => () => clearIconSession(channel.current), []);
  useEffect(() => { if (savedId && !session.navBlocked) { session.reload(); if (id) nav.pop(); else nav.replace('items.detail', { id: savedId }); } }, [savedId, session.navBlocked]);
  useEffect(() => {
    const settled = session.settled;
    if (!settled || settled.command !== 'save_asset' || !('base' in settled.input) || !submitted.current || !catalog || settled.input.base.request_id !== submitted.current || settled.input.base.generation !== catalog.generation) return;
    session.setNotice?.(t('已确认物品保存，请核对保存后的档案。'));
    const request = submitted.current;
    let live = true;
    invoke<AssetRecord | null>('saved_request', { request, generation: catalog.generation }).then(async record => { if (live && record) { await keepOrigin(record); setSavedId(record.asset.id); } }).catch(cause => { if (live) setNotice(errorMessage(cause) + t(' 请重试读取保存后的物品。')); });
    return () => { live = false; };
  }, [session.settled, catalog]);
  const cur = currencyCode(draft?.fields.currency);
  const faOf = (f: Fields): FaState => ({ code: currencyCode(f.currency), text: f.price, fx: f.fx ?? '', paid: f.paid ?? '' });
  function changePrice(field: FaField | 'unit', value: string) {
    if (field === 'unit') rememberCurrency(value);
    setDraft(current => {
      if (!current) return current;
      const cur = faOf(current.fields), n = field === 'unit' ? changeFaCode(cur, value) : applyFa(cur, field, value);
      return { ...current, fields: { ...current.fields, currency: n.code, price: n.text, fx: n.fx, paid: n.paid } };
    });
  }
  /** After the CNY price is saved: keep (or clear) the original-currency record. A failure here leaves the saved CNY price intact. */
  async function keepOrigin(record: AssetRecord): Promise<void> {
    if (!draft || !catalog) return;
    const origin = itemPriceOrigin(draft);
    if (!origin && !record.price_origin) return;
    try { await invoke('set_price_origin', { input: { generation: catalog.generation, asset_id: record.asset.id, origin } }); if (origin) rememberRate(origin.currency, draft.fields.fx ?? ''); } catch { /* annotation only */ }
  }
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
    if (list.length + draft.photos.length > 20) { setPhotoError(t('最多保存 20 张图片，请减少所选图片。')); return; }
    if (list.some(file => file.size > 20 * 1024 * 1024)) { setPhotoError(t('每张图片不得超过 20 MiB。')); return; }
    lock.current = true; setLocalBusy(true); session.setBusy(true); setPhotoError('');
    try {
      for (const file of list) {
        const photo = await invoke<Photo>('import_photo_bytes', { generation: catalog.generation, name: file.name || t('拍摄的图片.jpg'), bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
        setDraft(current => current && ({ ...current, photos: [...current.photos, photo] }));
      }
      setNotice(t('图片已准备好，保存物品后生效。'));
    } catch (cause) { setPhotoError(errorMessage(cause) + t(' 已成功读取的图片保留，请检查后重试。')); }
    finally { lock.current = false; setLocalBusy(false); session.setBusy(false); }
  }
  async function save() {
    if (!draft || !catalog || lock.current || disabled || photoError) return;
    let input;
    try { input = itemSaveInput(draft, catalog.generation, session.today, crypto.randomUUID()); }
    catch (cause) { setNotice(errorMessage(cause)); return; }
    lock.current = true; session.setBusy(true); setNotice(''); submitted.current = input.base.request_id;
    try { const record = await submit<AssetRecord>({ command: 'save_asset', input, label: draft.id ? t('编辑物品') : t('新增物品') }); await keepOrigin(record); setSavedId(record.asset.id); }
    catch (cause) { setNotice(errorMessage(cause) + t(' 当前输入已保留。')); }
    finally { lock.current = false; session.setBusy(false); session.refreshPending(); }
  }
  async function enableReminder(checked: boolean) {
    if (!draft?.options.warranty) return;
    const warranty = draft.options.warranty;
    setDraft({ ...draft, options: { ...draft.options, warranty: { ...warranty, reminder: checked ? { date: warranty.end_date, notes: '' } : null } } });
    if (checked) { try { await allowReminders(); } catch (cause) { setNotice(errorMessage(cause)); } }
  }
  // One tap opens the system picker, which already offers 照片图库 and 拍照 (a second sheet of our own only repeated it).
  function openAddPhoto() { if (disabled || !draft || draft.photos.length >= 20) return; album.current?.click(); }
  const p = draft?.options.preferences, coverPhoto = draft?.photos.find(photo => photo.id === draft.cover), attachments = draft?.photos.filter(photo => photo.id !== draft.cover) ?? [];
  const setOptions = (patch: Partial<ItemDraft['options']>) => setDraft(current => current && ({ ...current, options: { ...current.options, ...patch } }));
  return <div className="m-page m-item-edit">
    <NavBar title={id ? t('编辑物品') : t('新增物品')} primary={{ label: t('保存'), onClick: () => void save(), disabled: disabled || loading || !!loadError || !!photoError, busy: session.busy }}/>
    {contextChanged && <ErrorState message={t('资料库已切换，当前输入不能提交。请关闭后重新打开物品。')}/>}
    {loading ? <Loading/> : loadError ? <ErrorState message={loadError} onRetry={() => setRetry(value => value + 1)}/> : draft && catalog && p && <>
      <input ref={album} type="file" accept="image/*" multiple hidden onChange={event => { void upload(event.target.files); event.target.value = ''; }}/>
      <div className="m-item-icon-slot"><button type="button" className="m-item-icon-tile" aria-label={t('更换图标')} onClick={openIcons} disabled={disabled}>{coverPhoto ? <PhotoView photo={coverPhoto} generation={catalog.generation}/> : <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt={t('默认物品图标')}/>}<span className="m-item-icon-badge" aria-hidden="true"><Glyph name="swap" size={14} strokeWidth={2.4}/></span></button></div>
      {photoError && <ErrorState title={t('图片未全部读取')} message={photoError}/>}{photoError && <Button onClick={() => setPhotoError('')}>{t('不使用未读取的图片')}</Button>}
      {notice && <Notice>{notice}</Notice>}
      <FormGroup><TextField label={t('名称')} value={draft.fields.name} onChange={value => change('name', value)} disabled={disabled} placeholder={t('物品名称')} maxLength={200}/><MoneyField label={t('购买价格')} value={cur === 'CNY' && draft.fields.price ? unitsOf(draft.fields.price, 2) : ''} onChange={value => changePrice('text', value ? decimalUnits(value, 2) : '')} disabled={disabled} hint={t('留空为未知；0 为免费。')} unit={<CurrencyButton code={cur} onChange={code => changePrice('unit', code)} label={t('购买价格的币种')} disabled={disabled}/>} replaceInput={isForeign(faOf(draft.fields)) ? <OriginalInput s={faOf(draft.fields)} onText={value => changePrice('text', value)} label={t('购买价格')} disabled={disabled}/> : undefined} below={isForeign(faOf(draft.fields)) ? <RateRow s={faOf(draft.fields)} onFx={value => changePrice('fx', value)} onPaid={value => changePrice('paid', value)} disabled={disabled}/> : undefined}/><DateField label={t('购买日期')} value={draft.fields.date} onChange={value => change('date', value)} disabled={disabled} max={session.today} allowClear hint={t('留空为未知')}/><SelectField label={t('分类')} value={draft.classification.category_id ?? ''} options={[{ id: '', label: t('未分类') }, ...catalog.categories.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => setDraft({ ...draft, classification: { ...draft.classification, category_id: value || null } })} disabled={disabled}/><SelectField label={t('标签')} value={p.label_id ?? ''} options={[{ id: '', label: t('无标签') }, ...labels.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => preferences({ label_id: value || null })} disabled={disabled}/><SelectField label={t('购买渠道')} value={draft.classification.channel_id ?? ''} options={[{ id: '', label: t('未记录') }, ...catalog.channels.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => setDraft({ ...draft, classification: { ...draft.classification, channel_id: value || null } })} disabled={disabled}/></FormGroup>
      <section className="m-form-group" aria-label={t('备注')}><h2 className="m-group-title">{t('备注')}</h2><div className="m-card m-item-notes"><textarea className="m-item-notes-text" aria-label={t('备注')} rows={4} placeholder={t('例如：存放在书房左侧柜；保修卡在抽屉')} value={draft.fields.notes} disabled={disabled} onChange={event => change('notes', event.target.value)}/><PhotoThumbs photos={attachments} generation={catalog.generation} onOpen={setViewing} onAdd={openAddPhoto} addDisabled={disabled || draft.photos.length >= 20}/></div></section>
      {!draft.id && <FormGroup footer={draft.options.warranty ? t('默认从购买日期起一年；购买日期未知时从今天起。') : undefined}>
        <FormRow label={t('保障时间')}><Switch label={t('设置保障时间')} checked={!!draft.options.warranty} onChange={checked => setDraft({ ...draft, options: { ...draft.options, warranty: checked ? newAssetWarranty(draft.fields.date || null, session.today) : null } })} disabled={disabled}/></FormRow>
        {draft.options.warranty && <><DateField label={t('保障结束日期')} value={draft.options.warranty.end_date} disabled={disabled} onChange={end_date => setDraft({ ...draft, warrantyEndEdited: true, options: { ...draft.options, warranty: { ...draft.options.warranty!, end_date } } })}/><FormRow label={t('到期通知')}><Switch label={t('到期通知')} checked={!!draft.options.warranty.reminder} onChange={checked => void enableReminder(checked)} disabled={disabled}/></FormRow>{draft.options.warranty.reminder && <DateField label={t('通知日期')} value={draft.options.warranty.reminder.date} onChange={date => setDraft({ ...draft, options: { ...draft.options, warranty: { ...draft.options.warranty!, reminder: { ...draft.options.warranty!.reminder!, date } } } })} disabled={disabled}/>}</>}
        <FormRow label={t('已退役')}><Switch label={t('已退役')} checked={!!draft.options.retired_date} onChange={checked => setOptions({ retired_date: checked ? session.today : null })} disabled={disabled}/></FormRow>
        {draft.options.retired_date && <DateField label={t('退役日期')} value={draft.options.retired_date} max={session.today} disabled={disabled} onChange={retired_date => setOptions({ retired_date })}/>}
        <FormRow label={t('已售出')}><Switch label={t('已售出')} checked={!!draft.options.sale} onChange={checked => setOptions({ sale: checked ? { date: session.today, price_cents: '', platform: '', buyer: '', notes: '' } : null })} disabled={disabled}/></FormRow>
        {draft.options.sale && <><MoneyField label={t('售出价格')} value={draft.options.sale.price_cents} onChange={price_cents => setOptions({ sale: { ...draft.options.sale!, price_cents } })} disabled={disabled}/><TextField label={t('售出渠道')} value={draft.options.sale.platform} onChange={platform => setOptions({ sale: { ...draft.options.sale!, platform } })} disabled={disabled}/><DateField label={t('售出日期')} value={draft.options.sale.date} max={session.today} disabled={disabled} onChange={date => setOptions({ sale: { ...draft.options.sale!, date } })}/></>}
      </FormGroup>}
      {draft.id && <Notice>{t('保障、维护、售出和退役记录请在物品详情中管理。')}</Notice>}
      <FormGroup><SelectField label={t('成本计算模式')} value={p.cost_mode} options={[{ id: 'daily', label: t('按日计算') }, { id: 'per_use', label: t('按次计算') }]} onChange={value => preferences({ cost_mode: value as AssetPreferences['cost_mode'] })} disabled={disabled}/>{p.cost_mode === 'per_use' && <TextField label={t('已使用次数')} value={String(p.use_count)} inputMode="numeric" disabled={disabled} onChange={value => { if (/^\d{0,10}$/.test(value)) preferences({ use_count: Number(value) }); }}/>}<SelectField label={t('目标设定')} value={p.goal.mode} options={[{ id: 'none', label: t('不设定') }, { id: 'cost', label: t('目标单位成本') }, { id: 'date', label: t('目标日期') }]} disabled={disabled} onChange={value => preferences({ goal: value === 'cost' ? { mode: 'cost', cents: '' } : value === 'date' ? { mode: 'date', date: '' } : { mode: 'none' } })}/>{p.goal.mode === 'cost' && <MoneyField label={t('目标单位成本')} value={p.goal.cents} onChange={cents => preferences({ goal: { mode: 'cost', cents } })} disabled={disabled}/>}{p.goal.mode === 'date' && <DateField label={t('目标日期')} value={p.goal.date} onChange={date => preferences({ goal: { mode: 'date', date } })} disabled={disabled}/>}</FormGroup>
      <details className="m-card m-item-fold" open={foldOpen} onToggle={event => setFoldOpen(event.currentTarget.open)}><summary>{t('品牌 · 型号 · 序列号')}</summary><TextField label={t('品牌')} value={draft.fields.brand} onChange={value => change('brand', value)} disabled={disabled}/><TextField label={t('型号')} value={draft.fields.model} onChange={value => change('model', value)} disabled={disabled}/><TextField label={t('序列号')} value={draft.fields.serial_number} onChange={value => change('serial_number', value)} disabled={disabled}/></details>
      <FormGroup><FormRow label={t('置顶物品')}><Switch label={t('置顶物品')} checked={p.pinned} onChange={pinned => preferences({ pinned })} disabled={disabled}/></FormRow><FormRow label={t('不计入统计')}><Switch label={t('不计入统计')} checked={Object.values(p.exclude).some(Boolean)} onChange={checked => preferences({ exclude: { total: checked, daily: checked, statistics: checked, timeline: checked } })} disabled={disabled}/></FormRow>{Object.values(p.exclude).some(Boolean) && (['total', 'daily', 'statistics', 'timeline'] as const).map((key, index) => <FormRow key={key} label={[t('不计入总金额'), t('不计入日均成本'), t('不计入统计页面'), t('不在时间轴显示')][index]}><Switch label={[t('不计入总金额'), t('不计入日均成本'), t('不计入统计页面'), t('不在时间轴显示')][index]} checked={p.exclude[key]} onChange={checked => preferences({ exclude: { ...p.exclude, [key]: checked } })} disabled={disabled}/></FormRow>)}</FormGroup>
      {viewing && <PhotoViewer photo={viewing} generation={catalog.generation} onClose={() => setViewing(null)} onRemove={disabled ? undefined : () => { setDraft(current => current && ({ ...current, photos: current.photos.filter(item => item.id !== viewing.id) })); setViewing(null); }}/>}
    </>}
  </div>;
}
function unitsOf(price: string, places: number): string { try { return parseDecimal(price, places); } catch { return ''; } }
