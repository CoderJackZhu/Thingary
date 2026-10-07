import { useEffect, useRef, useState } from 'react';
import { DateInput } from './DateInput';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow } from './FormControls';
import { kindLabel } from './wealth';
import type { Account, Snapshot } from './wealth';
import type { StoredLifeEvent } from './plan';
import type { Occurrence, Payment } from './plan-core';
const blankPayment = (date: string): Payment => ({ id: crypto.randomUUID(), date, amount_cents: null, account_id: null, absorbed_snapshot_id: null, absorbed_revision: null, source_kind: null, source_id: null });
export function PlanningOccurrenceDialog({ event, existing, snapshot, accounts, today, busy, stuck, notice, onClose, onSave }: { event: StoredLifeEvent; existing?: Occurrence; snapshot: Snapshot | null | undefined; accounts: Account[]; today: string; busy: boolean; stuck: boolean; notice: string; onClose: () => void; onSave: (o: Occurrence) => void }) {
  const name = (id: string, kind: string) => accounts.find(a => a.id === id)?.fields.name ?? `${kindLabel(kind)}（历史账户）`;
  const dialog = useRef<HTMLDialogElement>(null);
  const [o, setO] = useState<Occurrence>(() => structuredClone(existing ?? { id: crypto.randomUUID(), event_id: event.id, status: 'occurred', actual_date: today, payments_complete: false, payments: [blankPayment(today)], loan: null }));
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const patch = (p: Partial<Occurrence>) => setO(x => ({ ...x, ...p }));
  const pay = (id: string, fields: Partial<Payment>) => patch({ payments: o.payments.map(p => p.id === id ? { ...p, ...fields } : p) });
  const financed = Number(event.price_cents) > Number(event.down_cents);
  const save = () => { if (!o.actual_date || o.actual_date > today) return setError('实际日期须不晚于今天。'); if (o.payments.some(p => !p.date)) return setError('请填写付款日期。'); onSave(o.status === 'cancelled' ? { ...o, payments: [], loan: null, payments_complete: false } : o); };
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="occurrence-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); save(); }}>
    <header><div><p className="eyebrow">规划 · 现实核对</p><h2 id="occurrence-heading">{event.label} · 发生核对</h2><p className="muted">保存发生及来源关系，不改账户余额，不创建物品或复制支出。</p></div><CloseButton type="button" aria-label="关闭发生核对" disabled={busy} onClick={onClose}/><button className="primary" disabled={busy || stuck}>{busy ? '保存中…' : '保存核对'}</button></header>
    <section className="form-block"><FormRow label="现实状态"><select aria-label="现实状态" value={o.status} disabled={busy || existing?.status === 'occurred'} onChange={e => patch({ status: e.target.value as Occurrence['status'] })}><option value="occurred">已确认发生</option><option value="cancelled">已取消</option></select></FormRow>
      <FormRow label={o.status === 'occurred' ? '实际发生日期' : '取消日期'}><DateInput label="实际发生日期" max={today} value={o.actual_date} disabled={busy} onChange={value => patch({ actual_date: value })}/></FormRow>
      {o.status === 'occurred' && <><h3>实际付款分项</h3>{o.payments.map((p, i) => <div key={p.id} className="form-block"><h4>付款 {i + 1}</h4>
        <FormRow label="付款日期"><DateInput label={`付款${i + 1}日期`} value={p.date} disabled={busy} onChange={value => pay(p.id, { date: value, absorbed_snapshot_id: null, absorbed_revision: null })}/></FormRow>
        <FormRow label="实际付款金额" hint="留空表示未知，明确零可以保存。只保存核对，不再记一笔账。"><CentInput label={`付款${i + 1}金额`} value={p.amount_cents ?? ''} disabled={busy} onChange={v => pay(p.id, { amount_cents: v === '' ? null : v })}/></FormRow>
        <FormRow label="付款账户"><select aria-label={`付款${i + 1}账户`} value={p.account_id ?? ''} disabled={busy} onChange={e => pay(p.id, { account_id: e.target.value || null, absorbed_snapshot_id: null, absorbed_revision: null })}><option value="">来源待核对</option>{snapshot?.entries.filter(e => e.side === 'asset' && e.counted).map(e => <option key={e.account_id} value={e.account_id}>{name(e.account_id, e.kind)}</option>)}</select></FormRow>
        {snapshot && p.date <= snapshot.date && <FormRow label="已被起点盘点吸收" hint={`${snapshot.date} · 修订 ${snapshot.revision}。需核对金额与相同付款来源；新盘点或更正后重新核对。`}><label><input type="checkbox" aria-label={`付款${i + 1}已吸收`} disabled={busy || !p.account_id} checked={p.absorbed_snapshot_id === snapshot.id && p.absorbed_revision === snapshot.revision} onChange={e => pay(p.id, { absorbed_snapshot_id: e.target.checked ? snapshot.id : null, absorbed_revision: e.target.checked ? snapshot.revision : null })}/> 确认这笔已反映在该盘点</label></FormRow>}
        <details><summary>关联已有物品、支出或愿望（稳定ID）</summary><p className="muted small">已有记录只关联，不复制。愿望购入仍须在心愿清单确认／关联物品。</p><select aria-label={`付款${i + 1}来源类型`} value={p.source_kind ?? ''} disabled={busy} onChange={e => pay(p.id, { source_kind: (e.target.value || null) as Payment['source_kind'], source_id: null })}><option value="">暂无外部来源关联</option><option value="asset">物品</option><option value="expense">重要支出</option><option value="wish">已购入愿望</option></select>{p.source_kind && <input aria-label={`付款${i + 1}来源ID`} placeholder="已有记录的稳定ID" value={p.source_id ?? ''} disabled={busy} onChange={e => pay(p.id, { source_id: e.target.value || null })}/>}</details>
        <button type="button" className="ui-btn" disabled={busy} onClick={() => patch({ payments: o.payments.filter(x => x.id !== p.id), payments_complete: false })}>移除此核对分项</button></div>)}
      <button type="button" className="ui-btn" disabled={busy || o.payments.length >= 50} onClick={() => patch({ payments: [...o.payments, blankPayment(today)], payments_complete: false })}>添加付款分项</button>
      <FormRow label="付款覆盖"><label><input type="checkbox" aria-label="付款分项完整" checked={o.payments_complete} disabled={busy} onChange={e => patch({ payments_complete: e.target.checked })}/> 已核对全部一次性付款（首付、杂费等）；仅部分付款请保持未勾选</label></FormRow>
      {financed && <><h3>截至起点的剩余贷款</h3><p className="muted">仅核对余款与余期，不重新开始原贷款期限。月供与维护费分别延续。</p><FormRow label="负债账户"><select aria-label="贷款账户" value={o.loan?.account_id ?? ''} disabled={busy} onChange={e => { const a = snapshot?.entries.find(a => a.account_id === e.target.value); patch({ loan: a && snapshot ? { account_id: a.account_id, as_of: snapshot.date, principal_cents: a.amount_cents ?? '0', remaining_months: 0 } : null }); }}><option value="">待核对</option>{snapshot?.entries.filter(e => e.counted && e.side === 'liability').map(e => <option key={e.account_id} value={e.account_id}>{name(e.account_id, e.kind)}</option>)}</select></FormRow>
      {o.loan && <><FormRow label="余债截至日"><DateInput label="余债截至日" value={o.loan.as_of} disabled={busy} onChange={value => patch({ loan: { ...o.loan!, as_of: value } })}/></FormRow><FormRow label="剩余本金"><CentInput label="剩余本金" value={o.loan.principal_cents} disabled={busy} onChange={v => patch({ loan: { ...o.loan!, principal_cents: v } })}/></FormRow><FormRow label="剩余期数（月）"><input aria-label="剩余期数" type="number" min="0" max="480" value={o.loan.remaining_months} disabled={busy} onChange={e => patch({ loan: { ...o.loan!, remaining_months: Number(e.target.value) } })}/></FormRow></>}
      </>}
      </>}
    </section>{(error || notice) && <p role="status" className="notice">{error || notice}</p>}
  </form></dialog>;
}
