import { useEffect, useRef, useState } from 'react';
import './date.css';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, inputMoney, type AssetRecord, type Fields, type Photo } from '../../asset';
import { changeNewAssetWarrantyPurchase, newAssetWarranty, type AssetPreferences } from '../../preferences';
import { replaceDraftCover } from '../../asset-media';
import { allowReminders } from '../../NotificationNotice';
import { materialArt } from '../../materials';
import { PhotoView } from '../../Photos';
import { submit } from '../../wealth';
import type { TaxonomySnapshot } from '../../taxonomy';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import type { PageProps } from '../routes';
import { Button, DateField, ErrorState, FormGroup, FormRow, Icon, Loading, MoneyField, NavBar, Notice, SelectField, Switch, TextAreaField, TextField } from '../ui';
import { clearIconSession, itemDraft, itemSaveInput, setIconSession, type ItemDraft } from './edit-model';
import './edit.css';

type Choice = { id: string; name: string; enabled: boolean; scope?: string | null };
type Catalog = TaxonomySnapshot & { generation: string };
export default function ItemEdit({ params }: PageProps) {
  const nav = useNav(), session = useSession(), id = typeof params.id === 'string' ? params.id : null;
  const [draft, setDraft] = useState<ItemDraft | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null), [labels, setLabels] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState(''), [photoError, setPhotoError] = useState(''), [retry, setRetry] = useState(0), [savedId, setSavedId] = useState('');
  const [localBusy, setLocalBusy] = useState(false), lock = useRef(false), camera = useRef<HTMLInputElement>(null), album = useRef<HTMLInputElement>(null), channel = useRef(crypto.randomUUID()), submitted = useRef<string | null>(null);
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
      setCatalog(nextCatalog); setLabels(nextLabels.items.filter(entry => (entry.enabled && entry.scope !== 'virtual') || entry.id === record?.preferences?.label_id)); setDraft(itemDraft(record));
    }).catch(cause => { if (live) setLoadError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, retry]);
  useEffect(() => () => clearIconSession(channel.current), []);
  useEffect(() => { if (savedId && !session.navBlocked) { session.reload(); nav.replace('items.detail', { id: savedId }); } }, [savedId, session.navBlocked]);
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
        setDraft(current => current && ({ ...current, photos: [...current.photos, photo], cover: current.cover ?? photo.id }));
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
  const p = draft?.options.preferences;
  return <div className="m-page m-item-edit">
    <NavBar title={id ? '编辑物品' : '新增物品'} primary={{ label: '保存', onClick: () => void save(), disabled: disabled || loading || !!loadError || !!photoError, busy: session.busy }}/>
    {contextChanged && <ErrorState message="资料库已切换，当前输入不能提交。请关闭后重新打开物品。"/>}
    {loading ? <Loading/> : loadError ? <ErrorState message={loadError} onRetry={() => setRetry(value => value + 1)}/> : draft && catalog && p && <>
      <p className="m-item-edit-intro">只填名称也可以，其余资料想起时再补。</p>
      <div className="m-item-photo-entry"><button type="button" className="m-item-camera" disabled={disabled || draft.photos.length >= 20} onClick={() => camera.current?.click()}><Icon name="camera" size={30}/><strong>拍照建档</strong><small>拍下实物，第一张作为封面</small></button><Button disabled={disabled || draft.photos.length >= 20} onClick={() => album.current?.click()}>从相册选（可多选）</Button></div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => { void upload(event.target.files); event.target.value = ''; }}/>
      <input ref={album} type="file" accept="image/*" multiple hidden onChange={event => { void upload(event.target.files); event.target.value = ''; }}/>
      <button type="button" className="m-item-cover-button" onClick={openIcons} disabled={disabled}>{draft.photos.find(photo => photo.id === draft.cover) ? <PhotoView photo={draft.photos.find(photo => photo.id === draft.cover)!} generation={catalog.generation}/> : <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt="默认物品图标"/>}<span>更换图标与素材 ›</span></button>
      {!!draft.photos.length && <div className="m-item-photo-strip">{draft.photos.map(photo => <div key={photo.id}><button type="button" disabled={disabled} aria-pressed={photo.id === draft.cover} aria-label={'设为封面：' + photo.name} onClick={() => setDraft({ ...draft, cover: photo.id })}><PhotoView photo={photo} generation={catalog.generation}/><span>{photo.id === draft.cover ? '封面' : '设为封面'}</span></button><button type="button" disabled={disabled} aria-label={'移除图片：' + photo.name} onClick={() => setDraft({ ...draft, photos: draft.photos.filter(item => item.id !== photo.id), cover: draft.cover === photo.id ? null : draft.cover })}>移除</button></div>)}</div>}
      {photoError && <ErrorState title="图片未全部读取" message={photoError}/>}{photoError && <Button onClick={() => setPhotoError('')}>不使用未读取的图片</Button>}
      {notice && <Notice>{notice}</Notice>}
      <FormGroup title="基本信息"><TextField label="名称" value={draft.fields.name} onChange={value => change('name', value)} disabled={disabled} placeholder="物品名称" maxLength={200}/><MoneyField label="购买价格" value={draft.fields.price ? inputCents(draft.fields.price) : ''} onChange={value => change('price', centsInput(value))} disabled={disabled} hint="留空为未知；0 为免费。"/><DateField label="购买日期" value={draft.fields.date} onChange={value => change('date', value)} disabled={disabled} max={session.today} allowClear hint="留空为未知"/><TextAreaField label="备注" value={draft.fields.notes} onChange={value => change('notes', value)} disabled={disabled}/></FormGroup>
      <details className="m-item-edit-more"><summary>补充更多<span>分类、标签、渠道、成本、保障、品牌型号</span></summary>
        <FormGroup title="分类与渠道"><SelectField label="分类" value={draft.classification.category_id ?? ''} options={[{ id: '', label: '未分类' }, ...catalog.categories.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => setDraft({ ...draft, classification: { ...draft.classification, category_id: value || null } })} disabled={disabled}/><SelectField label="标签" value={p.label_id ?? ''} options={[{ id: '', label: '无标签' }, ...labels.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => preferences({ label_id: value || null })} disabled={disabled}/><SelectField label="购买渠道" value={draft.classification.channel_id ?? ''} options={[{ id: '', label: '未记录' }, ...catalog.channels.map(entry => ({ id: entry.id, label: entry.name }))]} onChange={value => setDraft({ ...draft, classification: { ...draft.classification, channel_id: value || null } })} disabled={disabled}/></FormGroup>
        <FormGroup title="成本与目标"><SelectField label="成本计算" value={p.cost_mode} options={[{ id: 'daily', label: '按日计算' }, { id: 'per_use', label: '按次计算' }]} onChange={value => preferences({ cost_mode: value as AssetPreferences['cost_mode'] })} disabled={disabled}/>{p.cost_mode === 'per_use' && <TextField label="已使用次数" value={String(p.use_count)} inputMode="numeric" disabled={disabled} onChange={value => { if (/^\d{0,10}$/.test(value)) preferences({ use_count: Number(value) }); }}/>}<SelectField label="目标" value={p.goal.mode} options={[{ id: 'none', label: '不设定' }, { id: 'cost', label: '目标单位成本' }, { id: 'date', label: '目标日期' }]} disabled={disabled} onChange={value => preferences({ goal: value === 'cost' ? { mode: 'cost', cents: '' } : value === 'date' ? { mode: 'date', date: '' } : { mode: 'none' } })}/>{p.goal.mode === 'cost' && <MoneyField label="目标单位成本" value={p.goal.cents} onChange={cents => preferences({ goal: { mode: 'cost', cents } })} disabled={disabled}/>} {p.goal.mode === 'date' && <DateField label="目标日期" value={p.goal.date} onChange={date => preferences({ goal: { mode: 'date', date } })} disabled={disabled}/>}</FormGroup>
        {!draft.id && <FormGroup title="保障" footer="默认从购买日期起一年；购买日期未知时从今天起。"><FormRow label="设置保障"><Switch label="设置保障" checked={!!draft.options.warranty} onChange={checked => setDraft({ ...draft, options: { ...draft.options, warranty: checked ? newAssetWarranty(draft.fields.date || null, session.today) : null } })} disabled={disabled}/></FormRow>{draft.options.warranty && <><DateField label="保障结束日期" value={draft.options.warranty.end_date} disabled={disabled} onChange={end_date => setDraft({ ...draft, warrantyEndEdited: true, options: { ...draft.options, warranty: { ...draft.options.warranty!, end_date } } })}/><FormRow label="到期通知"><Switch label="到期通知" checked={!!draft.options.warranty.reminder} onChange={checked => void enableReminder(checked)} disabled={disabled}/></FormRow>{draft.options.warranty.reminder && <DateField label="通知日期" value={draft.options.warranty.reminder.date} onChange={date => setDraft({ ...draft, options: { ...draft.options, warranty: { ...draft.options.warranty!, reminder: { ...draft.options.warranty!.reminder!, date } } } })} disabled={disabled}/>}</>}</FormGroup>}
        {draft.id && <Notice>保障、维护、售出和退役记录请在物品详情中管理。</Notice>}
        <FormGroup title="资料"><TextField label="品牌" value={draft.fields.brand} onChange={value => change('brand', value)} disabled={disabled}/><TextField label="型号" value={draft.fields.model} onChange={value => change('model', value)} disabled={disabled}/><TextField label="序列号" value={draft.fields.serial_number} onChange={value => change('serial_number', value)} disabled={disabled}/></FormGroup>
        <FormGroup title="展示与统计"><FormRow label="置顶"><Switch label="置顶" checked={p.pinned} onChange={pinned => preferences({ pinned })} disabled={disabled}/></FormRow><FormRow label="不计入统计"><Switch label="不计入统计" checked={Object.values(p.exclude).some(Boolean)} onChange={checked => preferences({ exclude: { total: checked, daily: checked, statistics: checked, timeline: checked } })} disabled={disabled}/></FormRow>{Object.values(p.exclude).some(Boolean) && (['total', 'daily', 'statistics', 'timeline'] as const).map((key, index) => <FormRow key={key} label={['不计入总金额', '不计入日均成本', '不计入统计页面', '不在时间轴显示'][index]}><Switch label={['不计入总金额', '不计入日均成本', '不计入统计页面', '不在时间轴显示'][index]} checked={p.exclude[key]} onChange={checked => preferences({ exclude: { ...p.exclude, [key]: checked } })} disabled={disabled}/></FormRow>)}</FormGroup>
      </details>
      <Button variant="primary" block onClick={() => void save()} disabled={disabled || !!photoError}>保存物品</Button>
    </>}
  </div>;
}
function inputCents(value: string) { return inputMoney(value) ?? ''; }
function centsInput(value: string) { return value ? (Number(value) / 100).toFixed(2) : ''; }
