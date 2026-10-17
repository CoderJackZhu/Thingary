import { useEffect, useRef, useState } from 'react';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Switch } from './FormControls';
import { errorMessage, money } from './asset';
import { intervals, intervalUnit, pendingSubscriptionStart } from './recurring';
import type { Plan, ResumeSave } from './recurring';
import type { LinkView } from './link';
import { firstSubscriptionPeriod, shiftDays, shiftPeriod } from './recurring-model';
import { submit, Unresolved } from './wealth';

export function ResumeSubscriptionDialog({ plan, link, today, onClose }: {
  plan: Plan; link: LinkView; today: string; onClose: (saved: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = pendingSubscriptionStart(plan, today);
  const replacing = !!pending && !!plan.resumptions?.length;
  const previousEnd = replacing ? plan.resumptions!.at(-1)!.previous_end : plan.fields.end_date!;
  const minimum = shiftDays(previousEnd, 1);
  const [start, setStart] = useState(pending ?? (today > minimum ? today : minimum));
  const [separateDue, setSeparateDue] = useState(replacing && plan.fields.first_due !== pending);
  const [due, setDue] = useState(replacing ? plan.fields.first_due : today);
  const [amount, setAmount] = useState(plan.fields.amount_cents);
  const [cycle, setCycle] = useState(plan.fields.interval_days ? 'days' : String(plan.fields.interval_months));
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const firstDue = separateDue ? due : start;
  const f = { ...plan.fields, service_start: start, coverage_start: start, first_due: firstDue, end_date: null, trial_days: null, interval_months: cycle === 'days' ? 1 : Number(cycle), interval_days: cycle === 'days' ? plan.fields.interval_days : null };
  const period = firstSubscriptionPeriod(f);
  const dueValid = shiftDays(firstDue, 0) === firstDue && firstDue >= minimum;
  async function save() {
    if (busy || stuck) return;
    if (!period?.[1] || period[1] < start || start < minimum) { setError('请填写有效的服务生效日期，须晚于上段最后使用日。'); return; }
    if (!dueValid) { setError('请填写有效的首期计划付款日，须晚于上段最后使用日。'); return; }
    if (!amount || BigInt(amount) <= 0n) { setError('请填写本次每期价格。'); return; }
    const input: ResumeSave = { request_id: crypto.randomUUID(), generation: link.generation, plan_id: plan.id, expected_revision: plan.revision, asset_id: link.asset?.id ?? null, asset_expected_revision: link.asset?.revision ?? null, start_date: start, ...(firstDue !== start ? { first_due: firstDue } : {}), ...(replacing ? { replace_pending: true } : {}), amount_cents: amount, interval_months: f.interval_months, interval_days: f.interval_days ?? null };
    setBusy(true); setError('');
    try { await submit({ command: 'recurring_resume', input, label: '重新订阅 ' + plan.fields.name }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setError(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="resume-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">{replacing ? '调整尚未生效的安排' : '继续使用原订阅'}</p><h2 id="resume-title">{replacing ? '调整订阅安排' : '重新订阅'} {plan.fields.name}</h2><p className="muted">上段使用至 {previousEnd}。本次重新确定日期、周期与价格，旧付款保持原样。</p></div><CloseButton type="button" aria-label="关闭重新订阅" disabled={busy} onClick={() => onClose(false)} /></header>
    <section className="form-block">
      <FormRow label="本次服务生效日期" hint="从哪天开始使用这段服务；可以是未来日期，不是实际扣款日。"><DateInput label="本次服务生效日期" value={start} min={minimum} disabled={busy || stuck} onChange={setStart} /></FormRow>
      <FormRow label="付款周期"><select aria-label="付款周期" value={cycle} disabled={busy || stuck} onChange={e => setCycle(e.target.value)}>{intervals.map(([v,l]) => <option key={v} value={v}>{l}</option>)}{plan.fields.interval_days && <option value="days">每 {plan.fields.interval_days} 天</option>}</select></FormRow>
      <FormRow label="每期价格"><CentInput label="每期价格" value={amount} disabled={busy || stuck} onChange={setAmount} /></FormRow>
      <FormRow label="每期付款日与生效日不同" hint="仅这一次提前付了钱，无需开启；保存后填写实际扣款日即可。"><Switch label="每期付款日与生效日不同" value={separateDue} disabled={busy || stuck} onChange={setSeparateDue} /></FormRow>
      {separateDue && <FormRow label="本段首期计划付款日" hint="用于安排本段每期的付款日期；实际扣款记录仍按真实日期填写。"><DateInput label="本段首期计划付款日" value={due} min={minimum} disabled={busy || stuck} onChange={setDue} /></FormRow>}
      {period && dueValid && <div className="subscription-summary" aria-label="本次订阅安排预览"><p>首期服务：{period[0]} 至 {period[1]}</p><p>首期计划付款：{firstDue} · {money(amount || null)}／{intervalUnit(f)}</p><p>下一期计划付款：{shiftPeriod(firstDue, f, 1)}<br/>下一期服务从 {shiftPeriod(start, f, 1)} 开始</p></div>}
      <p className="muted small">保存只建立本段安排，不自动记为已付。已经扣款的话，保存后点「记录实际扣款」；提前付款不会改变服务生效日或后续续费日。平台订阅需在服务方办理。</p>
    </section>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>{stuck ? '关闭，稍后核对' : '返回'}</button><button className="primary" disabled={busy || stuck}>{busy ? '保存中…' : replacing ? '保存调整' : '确认重新订阅'}</button></div>
  </form></dialog>;
}
