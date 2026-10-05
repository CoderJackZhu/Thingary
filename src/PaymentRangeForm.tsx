import { useEffect, useRef, useState } from 'react';
import type { Plan, PaymentRangeSave } from './recurring';
import { planScheduleDates } from './recurring-model';
import { CentInput, FormRow } from './FormControls';
import { submit, Unresolved } from './wealth';
import { errorMessage } from './asset';

export function PaymentRangeForm({ plan, generation, today, disabled, onBusyChange, onSaved, onError, initialOpen = false }: { initialOpen?: boolean; plan: Plan; generation: string; today: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void; onError: (message: string, unresolved: boolean) => void }) {
  const detail = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!initialOpen) return;
    const frame = requestAnimationFrame(() => { detail.current?.scrollIntoView({ block: 'nearest' }); detail.current?.querySelector('select')?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [initialOpen]);
  const dates = planScheduleDates(plan, plan.fields.service_start ? '1900-01-01' : plan.fields.first_due, today).slice(-600);
  const [from, setFrom] = useState(dates[0] ?? ''), [to, setTo] = useState(dates.at(-1) ?? '');
  const [amount, setAmount] = useState(plan.fields.amount_cents), [confirmed, setConfirmed] = useState(false), [saving, setSaving] = useState(false);
  const count = dates.filter(d => d >= from && d <= to).length;
  async function saveRange() {
    if (!confirmed || !count || !amount || amount === '0') {onError('请选择有效范围、填写每期实付，并明确确认已付。',false);return;}
    const input: PaymentRangeSave = {request_id:crypto.randomUUID(),generation,plan_id:plan.id,expected_revision:plan.revision,from_due:from,to_due:to,amount_cents:amount,confirmed};
    setSaving(true); onBusyChange(true);
    try { await submit({command:'recurring_payment_range_save',input,label:`${plan.fields.name} 往期付款补记`}); onSaved(); }
    catch(e) {onError(e instanceof Error ? e.message : errorMessage(e),e instanceof Unresolved);}
    finally {setSaving(false); onBusyChange(false);}
  }
  return <details ref={detail} className="form-block plan-backfill" open={initialOpen || undefined}><summary>补记往期实际付款</summary><p className="muted small">可选操作。仅补尚未记录的期，不覆盖已付或跳过记录。按每期付款日记实付日期；若日期或金额不同，请保存后单独更正。请先保存对计划的修改。</p>{!dates.length ? <p className="muted">还没有可补记的往期。</p> : <><FormRow label="从哪一期"><select aria-label="补记开始期" value={from} disabled={disabled||saving} onChange={e=>setFrom(e.target.value)}>{dates.map(d=><option key={d}>{d}</option>)}</select></FormRow><FormRow label="到哪一期"><select aria-label="补记结束期" value={to} disabled={disabled||saving} onChange={e=>setTo(e.target.value)}>{dates.filter(d=>d>=from).map(d=><option key={d}>{d}</option>)}</select></FormRow><FormRow label="每期实付"><CentInput label="每期实付" value={amount} disabled={disabled||saving} onChange={setAmount}/></FormRow><label className="small"><input type="checkbox" checked={confirmed} disabled={disabled||saving} onChange={e=>setConfirmed(e.target.checked)}/>我确认所选范围确实已付，每期金额如上</label><p className="muted small">所选 {count} 期；已有记录将跳过。此次补记会计入重要支出。</p><button type="button" disabled={disabled||saving||!confirmed||!count} onClick={()=>void saveRange()}>{saving?'正在补记…':'确认补记付款'}</button></>}</details>;
}
