import { useEffect, useRef, useState } from 'react';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow } from './FormControls';
import { errorMessage, money } from './asset';
import { intervals, intervalUnit } from './recurring';
import type { Plan, ResumeSave } from './recurring';
import type { LinkView } from './link';
import { firstSubscriptionPeriod, shiftDays } from './recurring-model';
import { submit, Unresolved } from './wealth';

export function ResumeSubscriptionDialog({ plan, link, today, onClose }: {
  plan: Plan; link: LinkView; today: string; onClose: (saved: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState(today);
  const [amount, setAmount] = useState(plan.fields.amount_cents);
  const [cycle, setCycle] = useState(plan.fields.interval_days ? 'days' : String(plan.fields.interval_months));
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const f = { ...plan.fields, service_start: start, coverage_start: start, first_due: start, end_date: null, trial_days: null, interval_months: cycle === 'days' ? 1 : Number(cycle), interval_days: cycle === 'days' ? plan.fields.interval_days : null };
  const period = firstSubscriptionPeriod(f);
  async function save() {
    if (busy || stuck) return;
    if (!period || start <= (plan.fields.end_date ?? '') || start > today) { setError('开始日期须晚于上次结束日，且不能晚于今天。'); return; }
    if (!amount || BigInt(amount) <= 0n) { setError('请填写本次每期价格。'); return; }
    const input: ResumeSave = { request_id: crypto.randomUUID(), generation: link.generation, plan_id: plan.id, expected_revision: plan.revision, asset_id: link.asset?.id ?? null, asset_expected_revision: link.asset?.revision ?? null, start_date: start, amount_cents: amount, interval_months: f.interval_months, interval_days: f.interval_days ?? null };
    setBusy(true); setError('');
    try { await submit({ command: 'recurring_resume', input, label: '重新订阅 ' + plan.fields.name }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setError(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="resume-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">继续使用原订阅</p><h2 id="resume-title">重新订阅 {plan.fields.name}</h2><p className="muted">上次使用至 {plan.fields.end_date}。旧付款保留在这里，中间停订的时间不计费。</p></div><CloseButton type="button" aria-label="关闭重新订阅" disabled={busy} onClick={() => onClose(false)} /></header>
    <section className="form-block">
      <FormRow label="重新开始日期" hint="填写本次实际开通日"><DateInput label="重新开始日期" yearIntent="past" value={start} min={shiftDays(plan.fields.end_date!, 1)} max={today} disabled={busy || stuck} onChange={v => v && setStart(v)} /></FormRow>
      <FormRow label="付款周期"><select aria-label="付款周期" value={cycle} disabled={busy || stuck} onChange={e => setCycle(e.target.value)}>{intervals.map(([v,l]) => <option key={v} value={v}>{l}</option>)}{plan.fields.interval_days && <option value="days">每 {plan.fields.interval_days} 天</option>}</select></FormRow>
      <FormRow label="每期价格"><CentInput label="每期价格" value={amount} disabled={busy || stuck} onChange={setAmount} /></FormRow>
      {period && <p className="subscription-summary">本次首期：{period[0]} 至 {period[1]}<br/>{money(amount || null)}／{intervalUnit(f)}，之后按此周期续费。</p>}
      <p className="muted small">保存后，再按实际扣款记录付款。此操作只更新物谱中的安排；平台订阅需在服务方开通。</p>
    </section>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>{stuck ? '关闭，稍后核对' : '返回'}</button><button className="primary" disabled={busy || stuck}>{busy ? '保存中…' : '确认重新订阅'}</button></div>
  </form></dialog>;
}
