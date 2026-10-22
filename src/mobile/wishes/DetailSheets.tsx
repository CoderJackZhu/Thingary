import { useEffect, useRef, useState } from 'react';
import { errorMessage, localDay } from '../../asset';
import type { Asset } from '../../asset';
import type { WishVerify, WishlistItem } from '../../wishlist';
import { verifyAssetPatch } from '../../wishlist';
import { Button, DateField, FormGroup, Loading, Notice, Sheet, TextAreaField, TextField } from '../ui';
import { readAsset } from './service';
import './wishes.css';

/** 不再考虑 / 重新考虑：一句备注，确认后才提交。 */
export function DecisionSheet({ kind, item, busy, error, onSubmit, onClose }: { kind: 'drop' | 'reconsider'; item: WishlistItem; busy: boolean; error: string; onSubmit: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(item.decision_note ?? '');
  const drop = kind === 'drop';
  return <Sheet title={drop ? '不再考虑' : '重新考虑'} onClose={() => { if (!busy) onClose(); }} cancelLabel="取消">
    <div className="w-sheet-stack">
      <p><strong>{drop ? `不再考虑「${item.fields.name}」？` : `重新考虑「${item.fields.name}」？`}</strong></p>
      <p>{drop ? '记录与图片保留，以后可以回看；不会产生支出。' : '回到考虑中；上一次决定备注保留，可在此更正，提醒不会自动恢复。'}</p>
      <FormGroup><TextAreaField label="为什么不买" value={note} onChange={setNote} placeholder={drop ? '这次决定的说明（可选）' : '保留或更正上次的说明'} disabled={busy} rows={3}/></FormGroup>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button variant="primary" block disabled={busy} onClick={() => onSubmit(note)}>{busy ? '正在保存…' : drop ? '确认不再考虑' : '确认重新考虑'}</Button>
    </div>
  </Sheet>;
}

/** 历史待核实：购入、尚未购入、不再考虑三种结果；确认购入时可补录原物品的价格与日期（与展示时的版本比较）。 */
export function VerifySheet({ item, busy, error, onSubmit, onClose }: { item: WishlistItem; busy: boolean; error: string; onSubmit: (outcome: WishVerify['outcome'], note: string, patch: WishVerify['asset_patch']) => void; onClose: () => void }) {
  const original = item.legacy_generated_asset ?? null;
  const base = useRef<Asset | null>(null);
  const [ready, setReady] = useState(!original), [loadError, setLoadError] = useState(''), [price, setPrice] = useState(''), [date, setDate] = useState(''), [note, setNote] = useState(''), [localError, setLocalError] = useState(''), [tick, setTick] = useState(0);
  useEffect(() => {
    if (!original) return;
    let live = true; setReady(false); setLoadError('');
    readAsset(original.id).then(record => {
      if (!live) return;
      if (!record) { setLoadError('找不到原关联物品，请重新读取。'); return; }
      base.current = record.asset; setPrice(record.asset.price_cents === null ? '' : String(Number(record.asset.price_cents) / 100)); setDate(record.asset.purchase_date ?? ''); setReady(true);
    }).catch(cause => { if (live) setLoadError(errorMessage(cause)); });
    return () => { live = false; };
  }, [original?.id, tick]);
  function submit(outcome: WishVerify['outcome']) {
    setLocalError('');
    let patch: WishVerify['asset_patch'] = null;
    if (outcome === 'purchased' && original) {
      if (!base.current) { setLocalError('请先重新读取原物品。'); return; }
      try { patch = verifyAssetPatch(base.current, price, date); } catch (cause) { setLocalError(errorMessage(cause)); return; }
    }
    onSubmit(outcome, note, patch);
  }
  return <Sheet title="核实这条旧记录" onClose={() => { if (!busy) onClose(); }} cancelLabel="取消">
    <div className="w-sheet-stack">
      <p>{item.legacy_generated_asset ? '旧版因攒钱达标标为已实现，购入情况尚未确认。' : '旧版已实现记录缺少购入确认来源，请核实。'}不急着处理，它的金额不计入考虑中合计。</p>
      {original && <>
        <p><strong>{original.name}</strong>（旧版自动生成的物品）{original.deleted ? '，在最近删除中，确认购入会先恢复它' : ''}</p>
        {!ready && !loadError && <Loading label="正在读取原物品…"/>}
        {loadError && <><Notice tone="danger">{loadError}</Notice><Button onClick={() => setTick(n => n + 1)}>重新读取物品</Button></>}
        {ready && <FormGroup title="补录（留空保留原资料）">
          <TextField label="实际价格（元）" value={price} onChange={setPrice} inputMode="decimal" placeholder="留空保留原价格" disabled={busy}/>
          <DateField label="购入日期" value={date} onChange={setDate} max={localDay()} allowClear disabled={busy}/>
        </FormGroup>}
        <Button variant="primary" block disabled={busy || !ready} onClick={() => submit('purchased')}>{busy ? '正在保存…' : '确实已购入（复用原物品）'}</Button>
      </>}
      {!original && <p>这条记录没有原关联物品；确认购入请直接记录这次购入或关联已有物品。</p>}
      <FormGroup><TextAreaField label="决定备注（可选）" value={note} onChange={setNote} placeholder="这次决定的说明" disabled={busy} rows={2}/></FormGroup>
      {(localError || error) && <Notice tone="danger">{localError || error}</Notice>}
      <Button block disabled={busy} onClick={() => submit('considering')}>尚未购入，继续考虑</Button>
      <Button block disabled={busy} onClick={() => submit('dropped')}>不再考虑</Button>
      {original && <p>确认「尚未购入」后，旧关联只作为只读的历史生成关系保留；如为误记，请前往物品核对。</p>}
    </div>
  </Sheet>;
}
