import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import type { AssetRecord, Photo } from '../../asset';
import { replaceDraftCover } from '../../asset-media';
import { allowReminders, openNotificationSettings } from '../../NotificationNotice';
import { PhotoView } from '../../Photos';
import { draftPhotos, draftPreferences, draftReplacementId, wishPlanSave } from '../../wish-save';
import type { WishlistDraft, WishlistItem } from '../../wishlist';
import { useDirtyGuard, useFormChanged, useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, ErrorState, FormGroup, FormRow, Icon, Loading, NavBar, Notice, SelectField, Switch, TextAreaField, TextField } from '../ui';
import { assetStateText, editWishDraft, newWishDraft } from './model';
import { CandidateSheet, IconSheet, ReceiptCards, WishIcon, useReceipts, useTaxonomy } from './parts';
import type { IconChoice } from './parts';
import { readWish, saveDraft, submitOp } from './service';
import './wishes.css';

type Legacy = { category: boolean; channel: boolean; pinned: boolean };

/** 新增与编辑心愿（模态页）：字段与规则同电脑端 WishEditor，保存走 save_wish_plan 并用回执核对。 */
export default function WishEdit({ params }: PageProps) {
  const id = params.id ? String(params.id) : null, nav = useNav(), session = useSession();
  const taxonomy = useTaxonomy(), generation = taxonomy.data?.generation ?? null;
  const [draft, setDraft] = useState<WishlistDraft | null>(null), [loadError, setLoadError] = useState(''), [tick, setTick] = useState(0);
  const [legacy, setLegacy] = useState<Legacy>({ category: false, channel: false, pinned: false });
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [notice, setNotice] = useState(''), [done, setDone] = useState<WishlistItem | null>(null);
  const [more, setMore] = useState(false), [iconOpen, setIconOpen] = useState(false), [pickOpen, setPickOpen] = useState(false), [permission, setPermission] = useState('');
  const [replacement, setReplacement] = useState<AssetRecord | null>(null), [replacementError, setReplacementError] = useState(''), [replacementTick, setReplacementTick] = useState(0);
  const lock = useRef(false);
  useDirtyGuard(useFormChanged(draft));
  const receipts = useReceipts(generation, outcome => { if (outcome.status === 'saved') setDone(outcome.value as WishlistItem); }, id);

  // 打开时只初始化一次草稿；之后的编辑只在内存里，关闭不存草稿。
  useEffect(() => {
    if (draft || !generation) return;
    let live = true;
    if (!id) { setDraft(newWishDraft(generation, session.today)); return; }
    readWish(id).then(item => {
      if (!live) return;
      if (!item) { setLoadError('找不到这条心愿，可能已被删除。'); return; }
      const next = editWishDraft(item, generation);
      setLegacy({ category: !!next.fields.category_id, channel: !!next.preferences?.channel_id, pinned: !!next.preferences?.pinned });
      setDraft(next); setMore(!!(next.fields.target_date || item.replacement_asset || next.photos?.some(p => p.id !== next.cover?.id)));
    }).catch(cause => { if (live) setLoadError(errorMessage(cause)); });
    return () => { live = false; };
  }, [generation, id, tick, draft]);
  const pending = receipts.ops.length > 0, disabled = busy || pending || receipts.busy;
  // 保存中或结果未确定时暂停切页与返回。
  useEffect(() => { session.setBusy(busy || receipts.busy || pending); }, [busy, receipts.busy, pending]);
  useEffect(() => () => session.setBusy(false), []);
  // 保存成功后等忙碌状态解除再离开：新增换成详情，编辑回到详情。
  useEffect(() => { if (done && !nav.blocked) { if (id) nav.pop(); else nav.replace('wishes.detail', { id: done.id }); } }, [done, nav.blocked]);

  const replacementId = draft ? draftReplacementId(draft) : null;
  useEffect(() => {
    setReplacement(null); setReplacementError('');
    if (!replacementId) return;
    let live = true;
    invoke<AssetRecord | null>('read_asset', { id: replacementId }).then(record => { if (!live) return; setReplacement(record); if (!record) setReplacementError('原物品已删除或不存在，请重新读取心愿。'); }).catch(cause => { if (live) setReplacementError(errorMessage(cause)); });
    return () => { live = false; };
  }, [replacementId, replacementTick]);

  if (loadError || taxonomy.error) return <div className="m-page"><NavBar title={id ? '编辑心愿' : '新增心愿'}/><ErrorState title="读取失败" message={loadError || taxonomy.error} onRetry={() => { setLoadError(''); taxonomy.retry(); setTick(n => n + 1); }}/></div>;
  if (!draft) return <div className="m-page"><NavBar title={id ? '编辑心愿' : '新增心愿'}/><Loading label="正在读取…"/></div>;

  const p = draftPreferences(draft), photos = draftPhotos(draft), item = draft.item;
  const set = (part: Partial<WishlistDraft>) => setDraft(old => old && { ...old, ...part });
  const field = <K extends keyof WishlistDraft['fields']>(key: K, value: WishlistDraft['fields'][K]) => setDraft(old => old && { ...old, fields: { ...old.fields, [key]: value } });
  const prefs = (part: Partial<typeof p>) => setDraft(old => old && { ...old, preferences: { ...draftPreferences(old), ...part } });
  const cancel = () => { if (disabled) { setNotice('请先完成当前操作或核对保存结果。'); return; } nav.close(); };

  async function save() {
    if (lock.current || disabled || !draft) return;
    const built = wishPlanSave(draft, crypto.randomUUID());
    if (!built.input) { setErrors(Object.values(built.errors)); return; }
    lock.current = true; setBusy(true); setErrors([]); setNotice('');
    try {
      const outcome = await submitOp({ kind: 'save', label: item ? '保存心愿修改' : '新增心愿', input: built.input, draft: saveDraft(draft, built.input) });
      if (outcome.status === 'saved') setDone(outcome.value as WishlistItem);
      else if (outcome.status === 'failed') setErrors([outcome.message]);
      else { setErrors([]); receipts.refresh(); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function useIcon(choice: IconChoice) {
    if (!draft || !generation) return;
    const cover = choice.kind === 'default' ? null : choice.kind === 'photo' ? choice.photo : await invoke<Photo>('prepare_material', { input: { id: choice.entry.id, generation } });
    const next = replaceDraftCover(photos, draft.transientCover, cover, !!cover && !photos.some(x => x.id === cover.id));
    set({ cover, photos: next.photos, transientCover: next.transientCover, photoError: '' });
  }
  async function addPhoto() {
    if (lock.current || !draft) return;
    lock.current = true; setBusy(true);
    try { const photo = await invoke<Photo | null>('pick_photo', { generation: draft.generation, repair: null }); if (photo) set({ photos: [...photos, photo], photoError: '' }); }
    catch (cause) { set({ photoError: errorMessage(cause) }); }
    finally { lock.current = false; setBusy(false); }
  }
  async function toggleReminder(on: boolean) {
    prefs({ reminder: on }); setPermission('');
    if (!on) return;
    try { await allowReminders(); } catch (cause) { setPermission(errorMessage(cause)); }
  }
  const categoryOptions = [{ id: '', label: '未分类' }, ...(taxonomy.data?.categories ?? []).map(c => ({ id: c.id, label: c.name }))];
  const channelOptions = [{ id: '', label: '未设置' }, ...(taxonomy.data?.channels ?? []).map(c => ({ id: c.id, label: c.name }))];
  const replacementName = replacement?.asset.id === replacementId ? `${replacement.asset.name} · ${replacement.asset.purchase_date ?? '购入日期未知'} · ${assetStateText(replacement.lifecycle?.state ?? 'active')}` : item?.replacement_asset?.id === replacementId ? item?.replacement_asset?.name ?? '…' : '…';

  return <div className="m-page">
    <NavBar title={item ? '编辑心愿' : '新增心愿'} onCancel={cancel} primary={{ label: '保存', onClick: () => void save(), busy, disabled: pending || receipts.busy }}/>
    <div className="w-stack">
      <p className="w-foot">名称之外都可以留空，之后回来再补；保存不会生成物品，也不产生支出。</p>
      <ReceiptCards ops={receipts.ops} busy={receipts.busy} notice={receipts.notice} onResolve={op => void receipts.resolve(op)}/>
      <FormGroup>
        <div className="w-identity">
          <button type="button" className="w-identity-button" aria-label="选择心愿图标" disabled={disabled} onClick={() => setIconOpen(true)}><WishIcon photo={draft.cover} generation={draft.generation} large/><span className="w-identity-label">更换图标</span></button>
          <input className="m-input" aria-label="物品名称" placeholder="请输入物品名称" value={draft.fields.name} maxLength={200} disabled={disabled} autoFocus onChange={event => field('name', event.target.value)}/>
        </div>
        <TextField label="预计价格（元）" value={draft.fields.estimated_price} onChange={value => field('estimated_price', value)} inputMode="decimal" placeholder="可留空" disabled={disabled} hint="留空表示价格未知，不会当作 0。"/>
        <TextAreaField label="想买的理由与顾虑" value={draft.fields.notes} onChange={value => field('notes', value)} placeholder="为什么想买？还有什么顾虑？以后回来时提醒自己" disabled={disabled} rows={4}/>
        <TextField label="相关链接" value={draft.fields.external_link} onChange={value => field('external_link', value)} placeholder="https://example.com/item" hint="http:// 或 https://，可留空" disabled={disabled}/>
      </FormGroup>

      <button type="button" className="m-card w-more-toggle" aria-expanded={more} onClick={() => setMore(open => !open)}><span>更多资料<br/><small>计划日期、提醒、图片、替换物品</small></span><Icon name={more ? 'chevronUp' : 'chevronDown'} size={20}/></button>
      {more && <>
        <FormGroup>
          {legacy.category && <SelectField label="分类" value={draft.fields.category_id ?? ''} onChange={value => field('category_id', value || null)} options={categoryOptions} disabled={disabled}/>}
          {legacy.channel && <SelectField label="可能购买的渠道" value={p.channel_id ?? ''} onChange={value => prefs({ channel_id: value || null })} options={channelOptions} disabled={disabled}/>}
          <DateField label="计划日期" value={draft.fields.target_date} onChange={value => { field('target_date', value); if (!value && p.reminder) prefs({ reminder: false }); }} allowClear disabled={disabled} hint="准备再次考虑或购买的日期，可留空"/>
          {draft.fields.target_date && <FormRow label="计划日期提醒" hint="所选日期上午 9:00 单次通知，不会自动购买"><Switch label="计划日期提醒" checked={p.reminder} disabled={disabled} onChange={on => void toggleReminder(on)}/></FormRow>}
          {legacy.pinned && <FormRow label="置顶心愿"><Switch label="置顶心愿" checked={p.pinned} disabled={disabled} onChange={pinned => prefs({ pinned })}/></FormRow>}
          <FormRow label="考虑替换的物品" hint="可选；关系独立于购入关联，不会改变该物品的资料">
            <span className="w-value-row">{replacementId ? <><span>{replacementName}{item?.replacement_asset?.deleted && replacementId === item.replacement_asset.id ? '（在最近删除）' : ''}</span><button type="button" disabled={disabled} onClick={() => set({ replacementAssetId: null })}>清除</button></>
              : <>{item?.replacement_asset_name && draft.replacementAssetId !== null && <span>原物品「{item.replacement_asset_name}」已永久删除 <button type="button" disabled={disabled} onClick={() => set({ replacementAssetId: null })}>清除</button></span>}<button type="button" disabled={disabled} onClick={() => setPickOpen(true)}>选择物品…</button></>}</span>
          </FormRow>
        </FormGroup>
        {permission && <Notice tone="danger">提醒需要通知权限：{permission}<Button onClick={() => void openNotificationSettings().catch(() => undefined)}>打开系统通知设置</Button></Notice>}
        {replacementError && replacementId && <Notice tone="danger">原物品资料读取失败：{replacementError}<Button disabled={disabled} onClick={() => setReplacementTick(n => n + 1)}>重新读取物品</Button></Notice>}
        {item?.preferences?.mode === 'savings' && item.preferences.saved_cents !== '0' && <Notice>旧版攒钱记录保留为只读历史，不能在这里修改。</Notice>}
        <FormGroup title="图片">
          <div className="w-photos" style={{ padding: '12px 0' }}>
            {photos.filter(photo => photo.id !== draft.cover?.id).map(photo => <span className="w-photo" key={photo.id}><PhotoView photo={photo} generation={draft.generation} compact/><button type="button" aria-label={'移除图片 ' + photo.name} disabled={disabled} onClick={() => set({ photos: photos.filter(x => x.id !== photo.id) })}><span><Icon name="close" size={14}/></span></button></span>)}
            <button type="button" className="w-photo" aria-label="添加图片" disabled={disabled || photos.length >= 20} onClick={() => void addPhoto()}><Icon name="plus" size={24}/></button>
          </div>
        </FormGroup>
      </>}
      {draft.photoError && <Notice tone="danger">{draft.photoError}<Button onClick={() => set({ photoError: '' })}>取消这次失败选图</Button></Notice>}
      {errors.length > 0 && <Notice tone="danger">{errors.join(' ')}</Notice>}
      {notice && <Notice>{notice}</Notice>}
    </div>
    {iconOpen && <IconSheet generation={draft.generation} photos={photos} cover={draft.cover?.id ?? null} onUse={useIcon} onClose={() => setIconOpen(false)}/>}
    {pickOpen && <CandidateSheet title="考虑替换的物品" intro="选择想替换的在册物品；这只是一条关系，不会改动该物品。" onPick={candidate => { set({ replacementAssetId: candidate.id }); setPickOpen(false); }} onClose={() => setPickOpen(false)}/>}
  </div>;
}
