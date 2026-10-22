import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import type { AssetRecord, Photo } from '../../asset';
import { localDay } from '../../asset';
import type { WishlistItem } from '../../wishlist';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { DateField, ErrorState, FormGroup, Icon, Loading, MoneyField, NavBar, Notice, SelectField, TextAreaField, TextField } from '../ui';
import { inputMoney } from '../../asset';
import { detailActions, newPurchaseDraft, purchaseHint, purchaseSave, yuanText } from './model';
import type { PurchaseDraft } from './model';
import { ReceiptCards, WishIcon, useReceipts, useTaxonomy } from './parts';
import { purchaseDraft, readWish, submitOp } from './service';
import './wishes.css';

/** 已买到，记录购入（模态页）：预填心愿的名称、分类和图标；一次保存同时完成物品、心愿状态和关联（convert_wishlist）。 */
/** 心愿草稿里的实付金额是元文本；输入框用分。无法解析时视为未填。 */
const priceCents = (text: string): string => { try { return inputMoney(text) ?? ''; } catch { return ''; } };

export default function WishPurchase({ params }: PageProps) {
  const id = String(params.id ?? ''), nav = useNav(), session = useSession(), today = session.today;
  const taxonomy = useTaxonomy(), generation = taxonomy.data?.generation ?? null;
  const [draft, setDraft] = useState<PurchaseDraft | null>(null), [loadError, setLoadError] = useState(''), [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]), [more, setMore] = useState(false), [done, setDone] = useState<AssetRecord | null>(null);
  const lock = useRef(false);
  const receipts = useReceipts(generation, outcome => { if (outcome.status === 'saved') setDone(outcome.value as AssetRecord); }, id);

  useEffect(() => {
    if (draft || !generation) return;
    let live = true;
    (async () => {
      const wish: WishlistItem | null = await readWish(id);
      if (!live) return;
      if (!wish) { setLoadError('找不到这条心愿，可能已被删除。'); return; }
      if (!detailActions(wish).record) { setLoadError('这条心愿当前不能记录购入，可能已经处理过，请返回重新读取。'); return; }
      // 心愿封面带入新物品：失败时可不带封面继续。
      let staged: Photo | null = null, notice = '';
      if (wish.cover) { try { staged = await invoke<Photo>('stage_wishlist_cover', { wishlistId: wish.id, generation }); } catch (cause) { notice = '心愿封面暂无法带入（' + errorMessage(cause) + '），可不带封面继续，之后再补图。'; } }
      if (live) setDraft({ ...newPurchaseDraft(wish, generation, today, staged, notice), wishRevision: wish.revision });
    })().catch(cause => { if (live) setLoadError(errorMessage(cause)); });
    return () => { live = false; };
  }, [generation, id, tick, draft, today]);
  const pending = receipts.ops.length > 0, disabled = busy || pending || receipts.busy;
  useEffect(() => { session.setBusy(busy || receipts.busy || pending); }, [busy, receipts.busy, pending]);
  useEffect(() => () => session.setBusy(false), []);
  // 保存成功后直接进入新建的物品详情，并带一条简短提示。
  useEffect(() => { if (done && !nav.blocked) nav.replace('items.detail', { id: done.asset.id, notice: `已记录购入「${done.asset.name}」，心愿已标为已购入。` }); }, [done, nav.blocked]);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (errors.length) errorBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [errors]);

  if (loadError || taxonomy.error) return <div className="m-page"><NavBar title="记录购入"/><ErrorState title="读取失败" message={loadError || taxonomy.error} onRetry={() => { setLoadError(''); taxonomy.retry(); setTick(n => n + 1); }}/></div>;
  if (!draft) return <div className="m-page"><NavBar title="记录购入"/><Loading label="正在读取心愿…"/></div>;

  const field = (key: keyof PurchaseDraft['fields'], value: string) => setDraft(old => old && { ...old, fields: { ...old.fields, [key]: value } });
  const cancel = () => { if (disabled) { setErrors(['请先完成当前操作或核对保存结果。']); return; } nav.pop(); };
  async function save() {
    if (lock.current || disabled || !draft) return;
    const built = purchaseSave(draft, localDay(), crypto.randomUUID());
    if (!built.input) { setErrors(Object.values(built.errors)); if (built.errors.brand || built.errors.model || built.errors.notes) setMore(true); return; }
    lock.current = true; setBusy(true); setErrors([]);
    try {
      const outcome = await submitOp({ kind: 'purchase', label: '记录购入', input: built.input, wishlistId: draft.wishId, expectedRevision: draft.wishRevision, draft: purchaseDraft(draft, built.input) });
      if (outcome.status === 'saved') setDone(outcome.value as AssetRecord);
      else if (outcome.status === 'failed') setErrors([outcome.message + ' 心愿未被转换，输入已保留；如心愿已变化，请返回重新读取。']);
      else receipts.refresh();
    } finally { lock.current = false; setBusy(false); }
  }
  const categories = [{ id: '', label: '未分类' }, ...(taxonomy.data?.categories ?? []).map(c => ({ id: c.id, label: c.name }))];
  const channels = [{ id: '', label: '未设置' }, ...(taxonomy.data?.channels ?? []).map(c => ({ id: c.id, label: c.name }))];
  return <div className="m-page">
    <NavBar title="记录购入" onCancel={cancel} primary={{ label: '保存', onClick: () => void save(), busy, disabled: pending || receipts.busy }}/>
    <div className="w-stack">
      <p className="w-foot">由心愿「{draft.wishName}」转入。{purchaseHint(draft.estimate)}请填写实际购入金额和日期；留空表示未知，相关成本指标将无法计算。保存后心愿确认为已购入。</p>
      {errors.length > 0 && <div ref={errorBox}><Notice tone="danger">{errors.join(' ')}</Notice></div>}
      <ReceiptCards ops={receipts.ops} busy={receipts.busy} notice={receipts.notice} onResolve={op => void receipts.resolve(op)}/>
      {draft.coverNotice && <Notice>{draft.coverNotice}</Notice>}
      <FormGroup>
        <div className="w-identity"><WishIcon photo={draft.photos.find(p => p.id === draft.cover) ?? null} generation={draft.generation} large/>
          <input className="m-input" aria-label="物品名称" placeholder="请输入物品名称" value={draft.fields.name} maxLength={200} disabled={disabled} onChange={event => field('name', event.target.value)}/></div>
        <MoneyField label="实付金额" value={priceCents(draft.fields.price)} onChange={value => field('price', yuanText(value || null))} disabled={disabled} hint="留空表示金额未知，不会当作 0。"/>
        <DateField label="购入日期" value={draft.fields.date} onChange={value => field('date', value)} max={localDay()} allowClear disabled={disabled}/>
      </FormGroup>
      <button type="button" className="m-card w-more-toggle" aria-expanded={more} onClick={() => setMore(open => !open)}><span>更多资料<br/><small>分类、渠道、品牌、型号、备注</small></span><Icon name={more ? 'chevronUp' : 'chevronDown'} size={20}/></button>
      {more && <FormGroup>
        <SelectField label="分类" value={draft.classification.category_id ?? ''} onChange={value => setDraft(old => old && { ...old, classification: { ...old.classification, category_id: value || null } })} options={categories} disabled={disabled}/>
        <SelectField label="购买渠道" value={draft.classification.channel_id ?? ''} onChange={value => setDraft(old => old && { ...old, classification: { ...old.classification, channel_id: value || null } })} options={channels} disabled={disabled}/>
        <TextField label="品牌" value={draft.fields.brand} onChange={value => field('brand', value)} disabled={disabled}/>
        <TextField label="型号" value={draft.fields.model} onChange={value => field('model', value)} disabled={disabled}/>
        <TextAreaField label="备注" value={draft.fields.notes} onChange={value => field('notes', value)} disabled={disabled} rows={3}/>
      </FormGroup>}
    </div>
  </div>;
}
