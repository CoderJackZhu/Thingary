import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Segments, Switch } from './FormControls';
import { Icon } from './AssetViews';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import { intervals, intervalText, planStatus, recurringCategories, recurringCategoryText } from './recurring';
import type { Due, Overview, Payment, PaymentSave, Plan, PlanFields, PlanSave } from './recurring';
import './wealth.css';

type PaymentTarget = { plan_id: string; plan_name: string; due_date: string; plan_amount: string; record: Payment | null };

export function RecurringPage({ today }: { today: string }) {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [paying, setPaying] = useState<PaymentTarget | null>(null);
  const reload = () => setRetry(n => n + 1);
  const { pending, setPending, notice, setNotice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => {
    let live = true; setError('');
    invoke<Overview>('recurring_overview').then(o => { if (live) setData(o); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const closed = (saved: boolean) => { setEditing(null); setPaying(null); setPending(storedPending()); if (saved) reload(); };
  const target = (d: Due): PaymentTarget => ({ plan_id: d.plan_id, plan_name: d.plan_name, due_date: d.due_date, plan_amount: d.amount_cents, record: null });
  async function skip(d: Due) {
    if (!data) return;
    const input: PaymentSave = { request_id: crypto.randomUUID(), generation: data.generation, id: null, expected_revision: null, plan_id: d.plan_id, due_date: d.due_date, state: 'skipped', paid_date: null, amount_cents: null, notes: '' };
    try { await submit({ command: 'recurring_payment_save', input, label: `${d.plan_name} ${d.due_date} 本期不付` }); setNotice(`已标记「${d.plan_name}」${d.due_date} 本期不付。`); reload(); }
    catch (e) { setPending(storedPending()); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
  }
  return <section className="stats-section wealth-section" aria-label="周期费用">
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="wealth-toolbar"><span className="muted small">计划只代表以后；到期不会自动记成已付，需逐期确认。</span>
      <div className="wealth-actions"><button className="primary" disabled={!!pending || !data} onClick={() => setEditing('new')}><Icon name="plus"/><span>新增计划</span></button></div></div>
    {error ? <article className="detail-section" role="alert"><p>周期费用读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !data ? <p role="status" className="muted">正在读取周期费用…</p>
      : !data.plans.length ? <div className="empty"><span className="empty-mark">¥</span><h2>还没有周期费用</h2><p>把房租、订阅、保险这类定期付的钱记成计划，就能看到每年的固定负担和下次什么时候付。</p><button className="primary" disabled={!!pending} onClick={() => setEditing('new')}>新增计划</button></div>
      : <>
        <div className="stats-kpis wealth-kpis">
          <article><span>待确认</span><strong>{data.due.length}<small> 期</small></strong><em>{data.upcoming.length ? `另有 ${data.upcoming.length} 期 7 天内到期` : '7 天内没有到期'}</em></article>
          <article><span>当前年化负担</span><strong>{money(data.annual_cents)}</strong><em>进行中的计划，不是已付</em></article>
          <article><span>月均</span><strong>{money(data.monthly_cents)}</strong><em>年化 ÷ 12</em></article>
          <article><span>未来 12 个月预计</span><strong>{money(data.next12_cents)}</strong><em>按实际到期日，含结束与暂停</em></article>
        </div>
        {(data.due.length > 0 || data.upcoming.length > 0) && <article className="detail-section overview-card"><div className="section-heading"><h3>到期</h3><span>确认已付后才计入重要支出</span></div>
          <table className="distribution-table recurring-due"><thead><tr><th>到期日</th><th>计划</th><th>分类</th><th>计划金额</th><th/></tr></thead><tbody>
            {[...data.due.map(d => [d, true] as const), ...data.upcoming.map(d => [d, false] as const)].map(([d, overdue]) => <tr key={d.plan_id + d.due_date} data-overdue={overdue}>
              <td>{d.due_date}{overdue ? <small className="muted"> 待确认</small> : <small className="muted"> 即将到期</small>}</td><td>{d.plan_name}</td><td>{recurringCategoryText(d.category)}</td><td className="amount">{money(d.amount_cents)}</td>
              <td><div className="check-in-state"><button disabled={!!pending} onClick={() => setPaying(target(d))}>确认已付</button><SkipButton disabled={!!pending} onSkip={() => void skip(d)}/></div></td>
            </tr>)}
          </tbody></table></article>}
        <article className="detail-section overview-card"><div className="section-heading"><h3>计划</h3><span>点名称编辑；改金额或周期只影响尚未记录的期</span></div>
          <table className="distribution-table"><thead><tr><th>名称</th><th>分类</th><th>周期</th><th>每期金额</th><th>下次</th><th>状态</th></tr></thead><tbody>
            {data.plans.map(p => <tr key={p.id} className={p.fields.paused || (p.fields.end_date && p.fields.end_date < today) ? 'closed' : undefined}>
              <td><button className="link-cell" onClick={() => setEditing(p)}>{p.fields.name}</button></td><td>{recurringCategoryText(p.fields.category)}</td><td>{intervalText(p.fields.interval_months)}</td>
              <td className="amount">{money(p.fields.amount_cents)}</td><td>{p.fields.paused ? '—' : p.next_due ?? '—'}</td><td>{planStatus(p, today)}</td></tr>)}
          </tbody></table></article>
        {data.payments.length > 0 && <article className="detail-section overview-card"><div className="section-heading"><h3>付款记录</h3><span>点期次更正；实付金额可与计划不同</span></div>
          <table className="distribution-table"><thead><tr><th>期次</th><th>计划</th><th>状态</th><th>实付日期</th><th>实付金额</th></tr></thead><tbody>
            {data.payments.map(p => <tr key={p.id} className={p.state === 'skipped' ? 'closed' : undefined}>
              <td><button className="link-cell" onClick={() => { const plan = data.plans.find(x => x.id === p.plan_id); setPaying({ plan_id: p.plan_id, plan_name: p.plan_name, due_date: p.due_date, plan_amount: plan?.fields.amount_cents ?? '', record: p }); }}>{p.due_date}</button>{p.off_schedule && <small className="muted"> 计划外</small>}</td>
              <td>{p.plan_name}</td><td>{p.state === 'paid' ? '已付' : '本期不付'}</td><td>{p.paid_date ?? '—'}</td><td className="amount">{p.amount_cents === null ? '—' : money(p.amount_cents)}</td></tr>)}
          </tbody></table></article>}
      </>}
    {editing && data && <PlanDialog plan={editing === 'new' ? null : editing} generation={data.generation} today={today} onClose={closed}/>}
    {paying && data && <PaymentDialog target={paying} generation={data.generation} today={today} onClose={closed}/>}
  </section>;
}

function SkipButton({ disabled, onSkip }: { disabled: boolean; onSkip: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? <button className="danger" disabled={disabled} onClick={() => { setArmed(false); onSkip(); }}>确认不付</button> : <button disabled={disabled} onClick={() => setArmed(true)}>本期不付</button>;
}

const blankPlan = (today: string): PlanFields => ({ name: '', category: 'subscription', amount_cents: '', interval_months: 1, first_due: today, end_date: null, paused: false, notes: '' });

function PlanDialog({ plan, generation, today, onClose }: { plan: Plan | null; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<PlanFields>(plan?.fields ?? blankPlan(today));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('plan-name')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof PlanFields>(k: K, v: PlanFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  async function save() {
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    if (!f.name.trim()) return stop('计划名称', '请填写名称。');
    if (!f.amount_cents || f.amount_cents === '0') return stop('每期金额', '请填写每期金额。');
    const input: PlanSave = { request_id: crypto.randomUUID(), generation, id: plan?.id ?? null, expected_revision: plan?.revision ?? null, fields: { ...f, name: f.name.trim() } };
    setBusy(true); setNotice('');
    try { await submit({ command: 'recurring_plan_save', input, label: `计划 ${input.fields.name}` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="plan-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 周期费用</p><h2 id="plan-heading">{plan ? '编辑计划' : '新增计划'}</h2><p className="muted">改动只影响尚未记录的期；已确认的付款保持原样。删除计划会连同付款记录一起移入最近删除。</p></div><button type="button" aria-label="关闭计划表单" disabled={busy} onClick={() => onClose(false)}>×</button><div className="editor-header-actions">{plan && !stuck && <DeleteButton label="删除计划" disabled={busy} kind="plan" id={plan.id} revision={plan.revision} generation={generation} name={`计划 ${plan.fields.name}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存计划'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="名称"><input id="plan-name" aria-label="计划名称" maxLength={80} value={f.name} disabled={frozen} onChange={e => set('name', e.target.value)} placeholder="例如 房租、视频会员"/></FormRow>
      <FormRow label="分类"><select aria-label="分类" value={f.category} disabled={frozen} onChange={e => set('category', e.target.value)}>{recurringCategories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormRow>
      <FormRow label="每期金额"><CentInput label="每期金额" value={f.amount_cents} disabled={frozen} placeholder="0.00" onChange={v => set('amount_cents', v)}/></FormRow>
      <FormRow label="周期"><Segments label="周期" value={String(f.interval_months) as '1' | '3' | '6' | '12'} disabled={frozen} options={intervals.map(([k, l]) => ({ value: String(k) as '1' | '3' | '6' | '12', label: l }))} onChange={v => set('interval_months', Number(v))}/></FormRow>
      <FormRow label="首次付款日" hint="通常填下一次付款日；更早的日期会把之后各期列为待确认"><DateInput id="plan-first-due" value={f.first_due} disabled={frozen} onChange={v => v && set('first_due', v)}/></FormRow>
      <FormRow label="结束日期" hint="到期不再续费时填写；可留空"><DateInput id="plan-end" value={f.end_date ?? ''} min={f.first_due} allowClear disabled={frozen} onChange={v => set('end_date', v || null)}/></FormRow>
      {plan && <FormRow label="暂停" hint="暂停期间不提示；恢复后从当天起算，不补暂停期间"><Switch label="暂停" value={f.paused} disabled={frozen} onChange={v => set('paused', v)}/></FormRow>}
    </section>
    <section className="form-block form-notes"><label htmlFor="plan-notes">备注</label><textarea id="plan-notes" maxLength={10000} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}

function PaymentDialog({ target, generation, today, onClose }: { target: PaymentTarget; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const r = target.record;
  const [state, setState] = useState<'paid' | 'skipped'>(r?.state ?? 'paid');
  const [paid, setPaid] = useState(r?.paid_date ?? (target.due_date < today ? target.due_date : today));
  const [amount, setAmount] = useState(r?.amount_cents ?? target.plan_amount);
  const [notes, setNotes] = useState(r?.notes ?? '');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const frozen = busy || stuck;
  async function save() {
    if (state === 'paid' && (!amount || amount === '0')) { setNotice('请填写实付金额。'); document.querySelector<HTMLElement>('dialog [aria-label="实付金额"]')?.focus(); return; }
    const input: PaymentSave = { request_id: crypto.randomUUID(), generation, id: r?.id ?? null, expected_revision: r?.revision ?? null, plan_id: target.plan_id, due_date: target.due_date, state, paid_date: state === 'paid' ? paid : null, amount_cents: state === 'paid' ? amount : null, notes };
    setBusy(true); setNotice('');
    try { await submit({ command: 'recurring_payment_save', input, label: `${target.plan_name} ${target.due_date}` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="payment-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 周期费用</p><h2 id="payment-heading">{r ? '更正付款记录' : '确认已付'}</h2><p className="muted">{target.plan_name} · {target.due_date} 这一期。计划金额 {money(target.plan_amount)}，按实际付款填写。</p></div><button type="button" aria-label="关闭付款表单" disabled={busy} onClick={() => onClose(false)}>×</button><div className="editor-header-actions">{r && !stuck && <DeleteButton label="删除记录" disabled={busy} kind="payment" id={r.id} revision={r.revision} generation={generation} name={`${target.plan_name} ${target.due_date} 付款`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="这一期"><Segments label="这一期" value={state} disabled={frozen} options={[{ value: 'paid', label: '已付' }, { value: 'skipped', label: '本期不付' }]} onChange={setState}/></FormRow>
      {state === 'paid' && <><FormRow label="实付日期"><DateInput id="payment-date" value={paid} max={today} disabled={frozen} onChange={v => v && setPaid(v)}/></FormRow>
        <FormRow label="实付金额"><CentInput label="实付金额" value={amount} disabled={frozen} placeholder="0.00" onChange={setAmount}/></FormRow></>}
    </section>
    <section className="form-block form-notes"><label htmlFor="payment-notes">备注</label><textarea id="payment-notes" maxLength={10000} value={notes} disabled={frozen} onChange={e => setNotes(e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
