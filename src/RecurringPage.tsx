import { PaymentRangeForm } from './PaymentRangeForm';
import { SortHeader } from './SortHeader';
import { sortRecords, moneySortValue, type ListSort } from './list-sort';
import { CloseButton } from './CloseButton';
import { useSource } from './useSource';
import type { SourceProps } from './source';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info, Segments, Switch } from './FormControls';
import { RentPlanForm } from './RentPlanForm';
import { blankRent, fieldsToRent, rentPreview, rentToFields } from './rent-plan';
import type { RentForm } from './rent-plan';
import { Icon } from './AssetViews';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import { intervalUnit, planStatus, recurringCategories, recurringCategoryText } from './recurring';
import type { Due, Overview, Payment, PaymentRangeSave, PaymentSave, Plan, PlanFields, PlanSave } from './recurring';
import './wealth.css';
import { PlanFieldsForm } from './PlanFieldsForm';
import { blankPlan, periodLabel, planScheduleDates, shiftDays, suggestedFinalDay } from './recurring-model';
import { offerUndo, useRestored } from './undo';
import { linkView } from './link';
import type { LinkView } from './link';
import { EndSubscriptionDialog, LinkRepairDialog, LinkCreateDialog, LinkDeleteDialog, LinkReviewDialog, SharedReminderRow, UnifyNameDialog, relationNotice, undoLinkDelete } from './LinkDialogs';
import { renewalPayload } from './virtual';
import { SubscriptionDetail } from './SubscriptionDetail';
import { MergeNotice } from './MergeOldSubscriptions';
import type { Modules } from './modules';

export type PaymentTarget = { plan_id: string; plan_name: string; due_date: string; plan_amount: string; record: Payment | null };

export function RecurringPage({ today, onEditingChange, source, onSourceDone, search, onSearch, autoNew, onAutoNewDone, modules, onOpenSource }: SourceProps & { today: string; onEditingChange: (value: boolean) => void; search: string; onSearch: (value: string) => void; autoNew?: boolean; onAutoNewDone?: () => void; modules: Modules; onOpenSource: (target: import('./source').SourceTarget) => void }) {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  // 浏览器预览截图入口：?recurring-tab=payments 直达付款记录（原生无此流程）。
  const [tab, setTab] = useState<'plans' | 'payments'>(() => {
    const preset = sessionStorage.getItem('thingary.recurring-tab.v1');
    if (preset !== 'payments') return 'plans';
    sessionStorage.removeItem('thingary.recurring-tab.v1');
    return 'payments';
  });
  const [paying, setPaying] = useState<PaymentTarget | null>(null);
  // 关联生命周期（设计 §5–§8）：只读详情、结束订阅、核对、统一名称、建立档案与整组删除。
  const [detail, setDetail] = useState<Plan | null>(null);
  const [detailPayment, setDetailPayment] = useState<Payment | null>(null);
  const [creating, setCreating] = useState<Plan | null>(null);
  const [ending, setEnding] = useState<{ plan: Plan; link: LinkView } | null>(null);
  const [reviewing, setReviewing] = useState<{ plan: Plan; link: LinkView } | null>(null);
  const [unifying, setUnifying] = useState<{ plan: Plan; link: LinkView } | null>(null);
  const [groupDelete, setGroupDelete] = useState<{ id: string; name: string } | null>(null);
  const [candidates, setCandidates] = useState<{ plan: Plan; list: LinkView['candidates']; partnerId: string | null } | null>(null);
  const [planSort, setPlanSort] = useState<ListSort>({ key: 'next', descending: false });
  const [paymentSort, setPaymentSort] = useState<ListSort>({ key: 'due', descending: true });
  const [dueSort, setDueSort] = useState<ListSort>({ key: 'due', descending: false });
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, setNotice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!pending || busy || !!paying || !!detail || !!creating || !!ending || !!reviewing || !!unifying || !!groupDelete || !!candidates); return () => onEditingChange(false); }, [editing, pending, busy, paying, detail, creating, ending, reviewing, unifying, groupDelete, candidates, onEditingChange]);
  useEffect(() => {
    let live = true; setError('');
    invoke<Overview>('recurring_overview').then(o => { if (live) setData(o); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const sourceError = useSource({source,onSourceDone}, data?.generation, async (target, alive) => {
    if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源记录。');
    // The rendered overview may predate a same-generation correction; re-read it.
    const fresh = await invoke<Overview>('recurring_overview');
    if (!alive()) return false;
    if (fresh.generation !== data?.generation) return false;
    setData(fresh);
    if (target.kind === 'plan') { const plan = fresh.plans.find(p => p.id === target.id); if (!plan) return false; setDetailPayment(null); setDetail(plan); return true; }
    if (target.kind !== 'payment') return false;
    // A payment target lands on its exact recorded period, never a nearby one.
    const payment = fresh.payments.find(p => p.id === target.id && p.plan_id === target.plan_id);
    const plan = fresh.plans.find(p => p.id === target.plan_id);
    if (!payment || !plan) return false;
    setDetailPayment(payment); setDetail(plan); return true;
  });
  useEffect(() => { if (sourceError) reload(); }, [sourceError]);
  const closed = (saved: boolean, warning?: string | null) => { if (warning) setNotice(warning); (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(null); setPaying(null); setDetail(null); setDetailPayment(null); setCreating(null); setEnding(null); setReviewing(null); setUnifying(null); setGroupDelete(null); setCandidates(null); setPending(storedPending()); if (saved) reload(); refocusHeading(); };
  const openNew = { label: '新增计划', plus: true, disabled: !!pending || !data, run: () => setEditing('new') };
  usePageBar('recurring', { primary: openNew, newRecord: openNew, search: { key: 'recurring', placeholder: '搜索计划' } });
  const consumedAutoNew = useRef(false);
  useEffect(() => {
    if (!autoNew || consumedAutoNew.current) return;
    consumedAutoNew.current = true;
    onAutoNewDone?.();
    setEditing('new');
  }, [autoNew]);
  const target = (d: Due): PaymentTarget => ({ plan_id: d.plan_id, plan_name: d.plan_name, due_date: d.due_date, plan_amount: d.amount_cents, record: null });
  async function skip(d: Due) {
    if (!data) return;
    const input: PaymentSave = { request_id: crypto.randomUUID(), generation: data.generation, id: null, expected_revision: null, plan_id: d.plan_id, due_date: d.due_date, state: 'skipped', paid_date: null, amount_cents: null, notes: '' };
    try { await submit({ command: 'recurring_payment_save', input, label: `${d.plan_name} ${d.due_date} 本期不付` }); setNotice(`已标记「${d.plan_name}」${d.due_date} 本期不付。`); reload(); }
    catch (e) { setPending(storedPending()); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
  }
  // Search narrows the plan list only; due rows and the payment history stay
  // complete because they are projections of the whole ledger, not the list.
  const keyword = search.trim().toLowerCase();
  const matchingPlans = data?.plans.filter(p => !keyword || [p.fields.name, recurringCategoryText(p.fields.category), p.fields.notes].some(t => t.toLowerCase().includes(keyword))) ?? [];
  const shownPlans = sortRecords(matchingPlans, planSort, (p, key) => key === 'name' ? p.fields.name : key === 'category' ? recurringCategoryText(p.fields.category) : key === 'interval' ? p.fields.interval_months : key === 'amount' ? moneySortValue(p.fields.amount_cents) : key === 'status' ? planStatus(p, today) : key === 'spent' ? moneySortValue(p.estimated_cents ?? p.paid_cents ?? null) : p.fields.paused ? null : p.next_due, p => p.id);
  const shownPayments = sortRecords(data?.payments ?? [], paymentSort, (p, key) => key === 'due' ? p.due_date : key === 'name' ? p.plan_name : key === 'state' ? p.state === 'paid' ? '已付' : '本期不付' : key === 'paid' ? p.paid_date : moneySortValue(p.amount_cents), p => p.id);
  const shownDues = sortRecords([...(data?.due ?? []).map(d => ({d, overdue:true})), ...(data?.upcoming ?? []).map(d => ({d, overdue:false}))], dueSort, ({d}, key) => key === 'due' ? d.due_date : key === 'name' ? d.plan_name : key === 'category' ? recurringCategoryText(d.category) : moneySortValue(d.amount_cents), ({d}) => d.plan_id + d.due_date);
  return <section className="stats-section wealth-section recurring-section" aria-label="周期费用">
    {sourceError && <p role="alert" className="notice">{sourceError}</p>}
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {data && <MergeNotice refresh={retry} disabled={!!pending || busy} onDone={m => { setNotice(m); reload(); }} />}
    {error ? <article className="ui-card ui-content" role="alert"><p>周期费用读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !data ? <p role="status" className="muted">正在读取周期费用…</p>
      : !data.plans.length ? <div className="empty"><span className="empty-mark">¥</span><h2>还没有周期费用</h2><p>把房租、订阅、保险这类定期付的钱记成计划，就能看到每年的固定负担和下次什么时候付。</p><button className="primary" disabled={!!pending} onClick={() => setEditing('new')}>新增计划</button></div>
      : <>
        <div className="ui-metrics ui-card">
          <article><span>待确认</span><strong>{data.due.length}<small> 期</small></strong><em>{data.upcoming.length ? `另有 ${data.upcoming.length} 期即将到期` : '近期没有即将到期'}</em></article>
          <article><span>当前年化负担</span><strong>{money(data.annual_cents)}</strong><em>进行中的计划，不是已付</em></article>
          <article><span>月均</span><strong>{money(data.monthly_cents)}</strong><em>年化 ÷ 12</em></article>
          <article><span>未来 12 个月预计</span><strong>{money(data.next12_cents)}</strong><em>按付款日与服务覆盖期，含结束与暂停</em></article>
        </div>
        {(data.due.length > 0 || data.upcoming.length > 0) && <article className="ui-card ui-content"><div className="ui-section-head"><h3>到期</h3><span>确认已付后才计入重要支出<Info text="计划代表付款安排，不代表已付。历史范围可在计划中补记。"/></span></div>
          <table className="ui-table recurring-due"><thead><tr><SortHeader field="due" label="到期日" sort={dueSort} onSort={setDueSort}/><SortHeader field="name" label="计划与覆盖期" sort={dueSort} onSort={setDueSort}/><SortHeader field="category" label="分类" sort={dueSort} onSort={setDueSort}/><SortHeader field="amount" label="计划金额" sort={dueSort} onSort={setDueSort}/><th/></tr></thead><tbody>
            {shownDues.map(({d, overdue}, index) => <tr key={d.plan_id + d.due_date} data-overdue={overdue}>
              <td>{d.due_date}{overdue ? <small className="muted"> 待确认</small> : <small className="muted"> 即将到期</small>}</td><td>{d.plan_name}{d.coverage_start && <small className="muted">服务：{periodLabel(d.coverage_start,d.coverage_end)}</small>}</td><td>{recurringCategoryText(d.category)}</td><td className="amount">{money(d.amount_cents)}</td>
              <td><div className="check-in-state"><button className={overdue&&index===0?"primary":undefined} disabled={!!pending} onClick={() => setPaying(target(d))}>确认已付</button><SkipButton disabled={!!pending} onSkip={() => void skip(d)}/></div></td>
            </tr>)}
          </tbody></table></article>}
        <div className="segmented recurring-tabs" role="group" aria-label="计划与付款记录"><button aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}>计划 {data.plans.length}</button><button aria-pressed={tab === 'payments'} onClick={() => setTab('payments')}>付款记录 {data.payments.length}</button></div>
        {tab === 'plans' && <article className="ui-card ui-content"><div className="ui-section-head"><h3>计划</h3><span>{keyword ? `找到 ${shownPlans.length} 条 · ` : ''}点名称查看详情；编辑金额或周期只影响尚未记录的期</span></div>
          {!shownPlans.length ? <p className="muted">当前条件下没有找到记录。<button onClick={() => onSearch('')}>清除搜索</button></p> : <table className="ui-table recurring-plans"><thead><tr><SortHeader field="name" label="名称" sort={planSort} onSort={setPlanSort}/><SortHeader field="category" label="分类" sort={planSort} onSort={setPlanSort}/><SortHeader field="amount" label="每期金额" sort={planSort} onSort={setPlanSort}/><SortHeader field="next" label="下次付款" sort={planSort} onSort={setPlanSort}/><SortHeader field="status" label="状态" sort={planSort} onSort={setPlanSort}/><SortHeader field="spent" label="累计费用" sort={planSort} onSort={setPlanSort} sortLabel="累计费用（估算或已确认付款）"/></tr></thead><tbody>
            {shownPlans.map(p => <tr key={p.id} tabIndex={0} aria-selected={detail?.id === p.id} className={p.fields.paused || (p.fields.end_date && p.fields.end_date < today) ? 'closed' : undefined} onClick={() => setDetail(p)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetail(p); } }}>
              <td><button className="link-cell" onClick={e => { e.stopPropagation(); setDetail(p); }} aria-label={'查看 ' + p.fields.name + ' 详情'}>{p.fields.name}</button></td><td>{recurringCategoryText(p.fields.category)}</td>              <td className="amount">{money(p.fields.amount_cents)}<span className="muted">／{intervalUnit(p.fields)}</span>{!p.fields.interval_days && p.fields.interval_months > 1 && p.monthly_cents && <small className="muted">月均 {money(p.monthly_cents)}</small>}</td><td>{p.fields.paused ? '—' : p.next_due ?? '—'}{p.current_coverage && <small className="muted">当前服务：{periodLabel(...p.current_coverage)}</small>}</td><td>{planStatus(p, today)}{p.contract_cents && <small className="muted">租期／期限预计 {money(p.contract_cents)}</small>}</td><td className="amount">{p.estimated_cents ? <>{money(p.estimated_cents)}<small className="muted">估算</small></> : money(p.paid_cents ?? '0')}</td></tr>)}
          </tbody></table>}</article>}
        {tab === 'payments' && (!data.payments.length ? <p className="muted">还没有付款记录。到期后点「确认已付」或「本期不付」就会记在这里。</p> : <article className="ui-card ui-content"><div className="ui-section-head"><h3>付款记录</h3><span>点期次更正；实付金额可与计划不同</span></div>
          <table className="ui-table recurring-payments"><thead><tr><SortHeader field="due" label="期次" sort={paymentSort} onSort={setPaymentSort}/><SortHeader field="name" label="计划" sort={paymentSort} onSort={setPaymentSort}/><SortHeader field="state" label="状态" sort={paymentSort} onSort={setPaymentSort}/><SortHeader field="paid" label="实付日期" sort={paymentSort} onSort={setPaymentSort}/><SortHeader field="amount" label="实付金额" sort={paymentSort} onSort={setPaymentSort}/></tr></thead><tbody>
            {shownPayments.map(p => <tr key={p.id} className={p.state === 'skipped' ? 'closed' : undefined}>
              <td><button className="link-cell" onClick={() => { const plan = data.plans.find(x => x.id === p.plan_id); setPaying({ plan_id: p.plan_id, plan_name: p.plan_name, due_date: p.due_date, plan_amount: plan?.fields.amount_cents ?? '', record: p }); }}>{p.due_date}</button>{p.coverage_start && <small className="muted">服务：{periodLabel(p.coverage_start,p.coverage_end)}</small>}{p.off_schedule && <small className="muted"> 计划外</small>}</td>
              <td>{p.plan_name}</td><td>{p.state === 'paid' ? '已付' : '本期不付'}</td><td>{p.paid_date ?? '—'}</td><td className="amount">{p.amount_cents === null ? '—' : money(p.amount_cents)}</td></tr>)}
          </tbody></table></article>)}
      </>}
    {editing && data && <PlanDialog plan={editing === 'new' ? null : editing} generation={data.generation} today={today} onClose={closed} modules={modules} onOpenSource={onOpenSource} onGroupDelete={(id, name) => { setEditing(null); setGroupDelete({ id, name }); }} onUnify={p => { setEditing(null); setUnifying(p); }} onEnd={p => { setEditing(null); setEnding(p); }} onReview={p => { setEditing(null); setReviewing(p); }} />}
    {paying && data && <PaymentDialog target={paying} generation={data.generation} today={today} onClose={closed}/>}
    {detail && data && <SubscriptionDetail plan={detail} today={today} modules={modules} sourcePayment={detailPayment} onCorrectPayment={payment => { setDetail(null); setDetailPayment(null); setPaying({ plan_id: payment.plan_id, plan_name: payment.plan_name, due_date: payment.due_date, plan_amount: detail.fields.amount_cents, record: payment }); }} onClose={() => closed(false)}
      onEdit={() => { const p = detail; setDetail(null); setEditing(p); }} onBackfill={() => { const p = detail; setDetail(null); setEditing(p); }}
      onPay={() => { const p = detail; setDetail(null); setPaying({ plan_id: p.id, plan_name: p.fields.name, due_date: p.next_due ?? p.fields.first_due, plan_amount: p.fields.amount_cents, record: null }); }}
      onCreate={p => { setDetail(null); setCreating(p); }} onGroupDelete={(id, name) => { setDetail(null); setGroupDelete({ id, name }); }} onEnd={p => { setDetail(null); setEnding(p); }} onReview={p => { setDetail(null); setReviewing(p); }}
      onUnify={p => { setDetail(null); setUnifying(p); }} onCandidates={(p, list) => { setDetail(null); setCandidates({ plan: p, list, partnerId: null }); }} />}
    {creating && data && <LinkCreateDialog planId={creating.id} planName={creating.fields.name} planRevision={creating.revision} today={today} generation={data.generation} onClose={closed} onDone={m => setNotice(m)} />}
    {ending && data && <EndSubscriptionDialog assetId={ending.link.asset!.id} planId={ending.plan.id} assetName={ending.link.asset!.name} assetRevision={ending.link.asset!.revision} planRevision={ending.plan.revision} fields={ending.plan.fields} suggestion={ending.plan.fields.end_date ?? ending.plan.current_coverage?.[1] ?? null} today={today} generation={data.generation} onClose={closed} onDone={m => setNotice(m)} />}
    {reviewing && data && <LinkReviewDialog assetId={reviewing.link.asset!.id} planId={reviewing.plan.id} assetName={reviewing.link.asset!.name} assetRevision={reviewing.link.asset!.revision} planRevision={reviewing.plan.revision} stoppedOn={reviewing.link.asset!.stopped_on} today={today} generation={data.generation} onClose={closed} onDone={m => setNotice(m)} />}
    {unifying && data && <UnifyNameDialog assetId={unifying.link.asset!.id} planId={unifying.plan.id} assetName={unifying.link.asset!.name} planName={unifying.plan.fields.name} assetRevision={unifying.link.asset!.revision} planRevision={unifying.plan.revision} fields={unifying.plan.fields} generation={data.generation} onClose={closed} onDone={m => setNotice(m)} />}
    {groupDelete && data && <LinkDeleteDialog side="plan" id={groupDelete.id.split('|')[0]} name={groupDelete.name} partnerId={groupDelete.id.split('|')[1] ?? null} generation={data.generation} onClose={saved => { setGroupDelete(null); if (saved) reload(); refocusHeading(); }} onDone={(groupId, name) => { offerUndo(`已整组删除「${name}」。`, async () => { await undoLinkDelete(groupId); }); reload(); }} />}
    {candidates && <LinkRepairDialog side="plan" id={candidates.plan.id} onClose={closed} onDone={m => setNotice(m)} />}
  </section>;
}

function SkipButton({ disabled, onSkip }: { disabled: boolean; onSkip: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? <button className="danger" disabled={disabled} onClick={() => { setArmed(false); onSkip(); }}>确认不付</button> : <button disabled={disabled} onClick={() => setArmed(true)}>本期不付</button>;
}



function PlanDialog({ plan, generation, today, onClose, modules, onOpenSource, onGroupDelete, onUnify, onEnd, onReview }: { plan: Plan | null; generation: string; today: string; onClose: (saved: boolean, warning?: string | null) => void; modules: Modules; onOpenSource: (target: import('./source').SourceTarget) => void; onGroupDelete: (id: string, name: string) => void; onUnify: (p: { plan: Plan; link: LinkView }) => void; onEnd: (p: { plan: Plan; link: LinkView }) => void; onReview: (p: { plan: Plan; link: LinkView }) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<PlanFields>(plan?.fields ?? blankPlan(today));
  // 关联订阅：打开时读取双方快照；已关联的计费编辑走 link_save（双方修订）。
  const initialRenewal = plan?.renewal_cents ?? '';
  const [renewal, setRenewal] = useState(initialRenewal), [renewalFrom, setRenewalFrom] = useState(plan?.renewal_from ?? '');
  const [specialOn, setSpecialOn] = useState(!!plan?.special_end), [specialEnd, setSpecialEnd] = useState(plan?.special_end ?? '');
  const extrasDirty = renewal !== initialRenewal || renewalFrom !== (plan?.renewal_from ?? '') || specialOn !== !!plan?.special_end || specialEnd !== (plan?.special_end ?? '');
  const [link, setLink] = useState<LinkView | null>(null);
  const [linkError, setLinkError] = useState(''), [linkRetry, setLinkRetry] = useState(0);
  useEffect(() => {
    if (!plan) { setLink(null); return; }
    let live = true;
    setLink(null); setLinkError('');
    linkView('plan', plan.id).then(l => { if (live) setLink(l); }).catch(e => { if (live) setLinkError(errorMessage(e)); });
    return () => { live = false; };
  }, [plan, linkRetry]);
  const linked = link?.relation === 'linked' && !!link.asset;
  const namesUnified = !!link && link.plan != null && link.asset != null && link.plan.name === link.asset.name;
  const [firstDueTouched, setFirstDueTouched] = useState(!!plan);
  // 房租用简易表单；已有的复杂计划（固定天数、试用、分段价格等）仍用完整表单。
  const initialRent = plan ? fieldsToRent(plan) : null;
  const [rent, setRent] = useState<RentForm>(initialRent ?? blankRent(today)), [backfill, setBackfill] = useState(true), [backfillTouched, setBackfillTouched] = useState(false), [forceFull, setForceFull] = useState(false);
  // 所有周期费用默认用简易表单；需要固定天数、免费试用、分段价格等高级设置时可改用完整表单。
  const rentMode = !forceFull && (!plan || initialRent !== null);
  const doBackfill = backfillTouched ? backfill : f.category === 'rent';
  const effective: PlanFields = rentMode ? { ...f, ...rentToFields(rent, f.category) } : f;
  const dirty = extrasDirty || (!plan ? true : rentMode ? JSON.stringify(rent) !== JSON.stringify(initialRent) || f.name !== plan.fields.name || f.notes !== plan.fields.notes || f.category !== plan.fields.category : JSON.stringify(f) !== JSON.stringify(plan.fields));
  const pastDues = rentMode && !plan ? (rentPreview(rent, today)?.rows.filter(r => r.due <= today).length ?? 0) : 0;
  const [late, setLate] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('plan-name')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof PlanFields>(k: K, v: PlanFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck || (!!plan && !link);
  async function save() {
    if (plan && !link) return;
    if (!dialog.current?.querySelector("form")?.reportValidity()) return;
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    if (!f.name.trim()) return stop('计划名称', '请填写名称。');
    if (!effective.amount_cents || effective.amount_cents === '0') return stop('每期金额', '请填写每期金额。');
    if (rentMode && !rentPreview(rent, today)) return stop(f.category === 'rent' ? '租期到期日' : '结束日期', '请检查开始日期和结束日期：结束日期须晚于开始日期。');
    setBusy(true); setNotice('');
    if (linked && link!.asset && plan) {
      // 共享计费编辑：一次提交维护双方与关系（设计 §5.2/§9）。
      const input = { request_id: crypto.randomUUID(), generation, asset_id: link!.asset.id, asset_expected_revision: link!.asset.revision, plan_id: plan.id, plan_expected_revision: plan.revision, fields: { ...effective, name: f.name.trim() }, billing: { renewal_price_cents: renewal === initialRenewal && renewalFrom !== (plan.renewal_from ?? '') ? renewal : renewalPayload(initialRenewal, renewal), renewal_from: renewal ? (renewalFrom || null) : null, special_end: plan.special_start ? { period_start: plan.special_start, coverage_end: specialOn ? (specialEnd || null) : null } : null } };
      try { await submit({ command: 'link_save', input, label: `计划 ${f.name.trim()}` }); onClose(true); }
      catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
      finally { setBusy(false); }
      return;
    }
    const input: PlanSave = { request_id: crypto.randomUUID(), generation, id: plan?.id ?? null, expected_revision: plan?.revision ?? null, fields: { ...effective, name: f.name.trim() } };
    try {
      const saved = await submit<Plan>({ command: 'recurring_plan_save', input, label: `计划 ${input.fields.name}` });
      if (rentMode && !plan && doBackfill && pastDues > 0) {
        // 把已过去的期次一次补记为已付；失败时计划已保存，说明如何用「补记往期实际付款」补上。
        const dates = planScheduleDates(saved, '1900-01-01', today);
        if (dates.length) {
          const range: PaymentRangeSave = { request_id: crypto.randomUUID(), generation, plan_id: saved.id, expected_revision: saved.revision, from_due: dates[0], to_due: dates[dates.length - 1], amount_cents: effective.amount_cents, confirmed: true };
          try { await submit({ command: 'recurring_payment_range_save', input: range, label: `${input.fields.name} 往期付款补记` }); }
          catch (e) { setLate(true); setNotice('计划已保存，但自动补记没有完成：' + (e instanceof Error ? e.message : errorMessage(e)) + ' 请关闭后打开这条计划，用「补记往期实际付款」补上。'); return; }
        }
      }
      onClose(true);
    }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  const billingExtras = linked && plan ? <>
    <FormRow label="后续续费价格" hint="留空沿用本期价格；只改变指定生效期起的分段"><div className="form-inline"><CentInput label="后续续费价格" value={renewal} disabled={frozen} onChange={v => { setRenewal(v); if (v && !renewalFrom) setRenewalFrom(shiftDays(suggestedFinalDay(effective, today), 1)); }} /><DateInput label="生效期" value={renewalFrom} disabled={frozen} onChange={setRenewalFrom} /></div><small className="muted">生效期须为未来服务期的开始日；已确认付款保持原样。清空后保存会撤销尚未生效的价格。</small></FormRow>
    {plan.special_start && <FormRow label="特殊到期" hint={`未确认期 ${plan.special_start} 的覆盖截止日；不改已确认付款`}><Switch label="特殊到期" value={specialOn} disabled={frozen} onChange={setSpecialOn} />{specialOn && <DateInput label="特殊到期日" value={specialEnd} disabled={frozen} onChange={setSpecialEnd} />}</FormRow>}
  </> : undefined;
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="plan-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 周期费用</p><h2 id="plan-heading">{plan ? '编辑计划' : '新增计划'}</h2><p className="muted">改动只影响尚未记录的期；已确认的付款保持原样。删除计划会连同付款记录一起移入最近删除。</p></div><CloseButton type="button" aria-label="关闭计划表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{plan && link && !stuck && !late && (linked
      ? <button type="button" disabled={busy} onClick={() => onGroupDelete(plan.id, plan.fields.name)} title="已关联订阅整组删除：服务档案与付款计划一起移入最近删除">删除…</button>
      : <DeleteButton label="删除计划" disabled={busy} kind="plan" id={plan.id} revision={plan.revision} generation={generation} name={`计划 ${plan.fields.name}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>)}{late ? <button type="button" className="primary" onClick={() => onClose(true)}>关闭</button> : stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={frozen}>{busy ? '保存中…' : '保存计划'}</button>}</div></header>
    {plan && !link && (linkError ? <p className="notice" role="alert">关联信息读取失败：{linkError} <button type="button" onClick={() => setLinkRetry(n => n + 1)}>重新读取关联</button></p> : <p className="muted" role="status">正在读取关联信息…</p>)}
    <section className="form-block">
      <FormRow label="名称" hint={linked && !namesUnified ? `服务名称为「${link!.asset!.name}」；两页名称不同，仅打开或修改价格不会自动统一` : linked ? '已关联订阅：这里修改的是两页共用的显示名称' : undefined}><input id="plan-name" aria-label="计划名称" maxLength={80} value={f.name} disabled={frozen} onChange={e => set('name', e.target.value)} placeholder="例如 房租、视频会员"/></FormRow>
      <FormRow label="分类" hint={linked ? '关联订阅的分类保持原类，不能在共享编辑中更改' : undefined}><select aria-label="分类" value={f.category} disabled={frozen || linked} onChange={e => set('category', e.target.value)}>{recurringCategories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormRow>
      {linked && !namesUnified && <p className="muted small">两页名称不同。<button type="button" className="ui-link" disabled={frozen} onClick={() => onUnify({ plan: plan!, link: link! })}>统一名称…</button></p>}
      {linked && link!.asset && <p className="muted small">已关联服务档案「{link!.asset.name}」{modules.virtual && <>。<button type="button" className="ui-link" disabled={frozen} onClick={() => onOpenSource({ kind: 'virtual', id: link!.asset!.id })}>查看服务档案</button></>}{link!.needs_review && <>；档案停用待核对 <button type="button" className="ui-link" disabled={frozen} onClick={() => onReview({ plan: plan!, link: link! })}>核对停用记录…</button></>}</p>}
      {!linked && plan && f.category === 'subscription' && !plan.fields.paused && <p className="muted small">还没有关联的服务档案。保存后从详情面板点「建立关联服务档案」，只新增档案、不动已有付款。</p>}
      {rentMode ? <>
        <RentPlanForm value={rent} onChange={setRent} disabled={frozen || late} today={today} rent={f.category === 'rent'}/>
        {billingExtras && <details className="plan-advanced"><summary>更多：后续续费价格、特殊到期</summary>{billingExtras}</details>}
        {pastDues > 0 && <FormRow label={`已过去的 ${pastDues} 期都已付清`} hint="保存时自动补记为已付（日期按付款日、金额同每期），计入重要支出；日期或金额不同，之后单独更正"><Switch label="保存后自动补记已过去的期次" value={doBackfill} disabled={frozen} onChange={v => { setBackfill(v); setBackfillTouched(true); }}/></FormRow>}
        <p className="muted small"><button type="button" className="ui-link" disabled={frozen || late} onClick={() => { setF(effective); setForceFull(true); }}>需要固定天数、免费试用、分段价格等高级设置？改用完整表单</button></p>
      </> : <PlanFieldsForm fields={f} onChange={setF} disabled={frozen} today={today} editing={!!plan} firstDueTouched={firstDueTouched} onFirstDueTouched={() => setFirstDueTouched(true)} advanced={billingExtras}/>}

    </section>
    {plan && linked && link!.asset && <SharedReminderRow assetId={link!.asset.id} assetRevision={link!.asset.revision} moduleEnabled={modules.virtual} reminder={link!.reminder} nextDue={plan.next_due} paymentDueDate={null} hasServiceStart={!!plan.fields.service_start} generation={generation} today={today} disabled={frozen || dirty} onNotice={setNotice} onStuck={() => setStuck(true)} onSaved={warning => onClose(true, warning)} onBusyChange={setBusy} />}
    {plan && !stuck && <PaymentRangeForm plan={plan} generation={generation} today={today} disabled={frozen || dirty} onBusyChange={setBusy} onSaved={() => onClose(true)} onError={(m, unresolved) => {setNotice(m); setStuck(unresolved);}}/>}
    <section className="form-block form-notes"><label htmlFor="plan-notes">备注</label><textarea id="plan-notes" maxLength={10000} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}

export function PaymentDialog({ target, generation, today, onClose }: { target: PaymentTarget; generation: string; today: string; onClose: (saved: boolean) => void }) {
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
    <header><div><p className="eyebrow">财富 · 周期费用</p><h2 id="payment-heading">{r ? '更正付款记录' : '确认已付'}</h2><p className="muted">{target.plan_name} · {target.due_date} 这一期。计划金额 {money(target.plan_amount)}，按实际付款填写。</p></div><CloseButton type="button" aria-label="关闭付款表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{r && !stuck && <DeleteButton label="删除记录" disabled={busy} kind="payment" id={r.id} revision={r.revision} generation={generation} name={`${target.plan_name} ${target.due_date} 付款`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="这一期"><Segments label="这一期" value={state} disabled={frozen} options={[{ value: 'paid', label: '已付' }, { value: 'skipped', label: '本期不付' }]} onChange={setState}/></FormRow>
      {state === 'paid' && <><FormRow label="实付日期"><DateInput id="payment-date" value={paid} max={today} disabled={frozen} onChange={v => v && setPaid(v)}/></FormRow>
        <FormRow label="实付金额"><CentInput label="实付金额" value={amount} disabled={frozen} placeholder="0.00" onChange={setAmount}/></FormRow></>}
    </section>
    <section className="form-block form-notes"><label htmlFor="payment-notes">备注</label><textarea id="payment-notes" maxLength={10000} value={notes} disabled={frozen} onChange={e => setNotes(e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
