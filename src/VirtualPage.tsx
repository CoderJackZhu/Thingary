import { PaymentDialog, type PaymentTarget } from './RecurringPage';
import { ResumeSubscriptionDialog } from './ResumeSubscriptionDialog';
import type { LinkView } from './link';
import type { Plan } from './recurring';
import { SubscriptionDetail } from './SubscriptionDetail';
import { MergeNotice } from './MergeOldSubscriptions';
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
import { CentInput, FormRow, Segments, Switch, Info, ChoiceField } from './FormControls';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import type { PlanFields } from './recurring';
import { PlanFieldsForm } from './PlanFieldsForm';
import { RentPlanForm } from './RentPlanForm';
import { blankRent, fieldsToRent, rentToFields } from './rent-plan';
import type { RentForm } from './rent-plan';
import { blankPlan, shiftDays, suggestedFinalDay } from './recurring-model';
import { billingModes, billingOf, billingText, cumulativeCost, matchesFilter, paymentScheduleText, planAssociationText, renewalPayload, topupSpendText, validityText, virtualFilters, virtualStatusText, virtualKindText } from './virtual';
import type { TopupFields, TopupRecord, VirtualAsset, VirtualFields, VirtualFilter, VirtualOverview, VirtualSave, BillingMode } from './virtual';
import { EndSubscriptionDialog, LinkDeleteDialog, LinkRepairDialog, LinkReviewDialog, SharedReminderRow, UnifyNameDialog } from './LinkDialogs';
import { undoLinkDelete } from './LinkDialogs';
import './wealth.css';
import { offerUndo, useRestored } from './undo';
import type { Modules } from './modules';
import { t as tt } from './i18n.ts';
export function VirtualPage({ today, onEditingChange, source, onSourceDone, search, onSearch, autoNew, onAutoNewDone, modules }: SourceProps & { today: string; onEditingChange: (value: boolean) => void; search: string; onSearch: (value: string) => void; autoNew?: boolean; onAutoNewDone?: () => void; modules: Modules }) {
  const [data, setData] = useState<VirtualOverview | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [backfill, setBackfill] = useState(false);
  const [paying, setPaying] = useState<PaymentTarget | null>(null);
  const pay = (item: VirtualAsset) => {
    const d = item.payment_due;
    if (d) setPaying({ plan_id: d.plan_id, plan_name: d.plan_name, due_date: d.due_date, plan_amount: d.amount_cents, record: null });
    else if (item.plan?.next_due) setPaying({ plan_id: item.plan.id, plan_name: item.plan.fields.name, due_date: item.plan.next_due, plan_amount: item.plan.fields.amount_cents, record: null });
  };
  const [maintenance, setMaintenance] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [editing, setEditing] = useState<VirtualAsset | 'new' | null>(null);
  const [returnDetailId, setReturnDetailId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [stopping, setStopping] = useState(false);
  // 关联生命周期（设计 §6/§8）：结束订阅、旧停用核对、统一名称与整组删除。
  const [repairing, setRepairing] = useState<string | null>(null);
  const [ending, setEnding] = useState<VirtualAsset | null>(null);
  const [resuming, setResuming] = useState<{ plan: Plan; link: LinkView } | null>(null);
  const [reviewing, setReviewing] = useState<VirtualAsset | null>(null);
  const [unifying, setUnifying] = useState<VirtualAsset | null>(null);
  const [groupDelete, setGroupDelete] = useState<{ id: string; name: string } | null>(null);
  const [topupFocus, setTopupFocus] = useState<string | null>(null);
  const [filter, setFilter] = useState<VirtualFilter>('all');
  const [labelFilter, setLabelFilter] = useState<string>('all');
  const [billingFilter, setBillingFilter] = useState<string>('all');
  const [sort, setSort] = useState<ListSort>({ key: 'name', descending: false });
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!paying || !!pending || busy || stopping || maintenance || !!ending || !!resuming || !!reviewing || !!unifying || !!groupDelete || !!repairing); return () => onEditingChange(false); }, [editing, paying, pending, busy, stopping, maintenance, ending, resuming, reviewing, unifying, groupDelete, repairing, onEditingChange]);
  useEffect(() => {
    let live = true; setError('');
    invoke<VirtualOverview>('virtual_overview').then(o => { if (live) setData(o); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const sourceError = useSource({ source, onSourceDone }, data?.generation, async (target, alive) => {
    if (pending || busy || maintenance || paying || editing) throw new Error(tt('请先核对上次保存结果，再打开来源档案。'));
    const fresh = await invoke<VirtualOverview>('virtual_overview');
    if (!alive()) return false;
    if (fresh.generation !== data?.generation) return false;
    setData(fresh);
    if (target.kind === 'topup') {
      const owner = fresh.items.find(v => v.id === (target as { asset_id: string }).asset_id);
      if (!owner) return false;
      setSelectedId(owner.id); setTopupFocus((target as { id: string }).id); return true;
    }
    if (target.kind !== 'virtual') return false;
    const item = fresh.items.find(v => v.id === target.id);
    if (!item) return false;
    setSelectedId(item.id); setTopupFocus(null); return true;
  });
  useEffect(() => { if (sourceError) reload(); }, [sourceError]);
  const closed = (saved: boolean, warning?: string | null) => { if (warning) setMutationError(warning); (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(null); setPaying(null); setBackfill(false); setEnding(null); setResuming(null); setRepairing(null); setReviewing(null); setUnifying(null); setGroupDelete(null); const receipt = storedPending(); setPending(receipt); if (returnDetailId && !receipt) setSelectedId(returnDetailId); setReturnDetailId(null); if (saved) reload(); refocusHeading(); };
  // 结束订阅建议日：已设置结束日或实际当前服务期末；无当前期时由用户填写。
  const suggestedEndDay = (item: VirtualAsset): string | null => item.plan?.fields.end_date ?? item.plan?.current_coverage?.[1] ?? (item.paid_until && item.paid_until >= (item.plan?.resumptions?.at(-1)?.resumed_on ?? item.plan?.fields.service_start ?? '') ? item.paid_until : null) ?? item.plan?.next_coverage?.[1] ?? null;
  const openNew = { label: tt('新增虚拟资产'), plus: true, disabled: !!pending || busy || stopping || maintenance || !data, run: () => setEditing('new') };
  usePageBar('virtual', { primary: openNew, newRecord: openNew, search: { key: 'virtual', placeholder: tt('搜索虚拟资产') } });
  const consumedAutoNew = useRef(false);
  useEffect(() => {
    if (!autoNew || consumedAutoNew.current) return;
    consumedAutoNew.current = true;
    onAutoNewDone?.();
    setEditing('new');
  }, [autoNew]);
  const keyword = search.trim().toLowerCase();
  const matches = (data?.items.filter(v => matchesFilter(v, filter)) ?? [])
    .filter(v => labelFilter === 'all' || (labelFilter === 'none' ? !v.fields.label_id : v.fields.label_id === labelFilter))
    .filter(v => billingFilter === 'all' || billingOf(v) === billingFilter)
    .filter(v => !keyword || [v.fields.name, virtualKindText(v.fields.kind), billingText(billingOf(v)), v.fields.provider, v.fields.notes].some(t => t.toLowerCase().includes(keyword)));
  const labelNames = [...new Set(data?.items.map(v => v.label_name).filter(Boolean) as string[] ?? [])];
  const perPeriodCents = (v: VirtualAsset): string | null => {
    if (billingOf(v) === 'subscription') return v.plan?.fields.amount_cents ?? null;
    if (billingOf(v) === 'topup') return null;
    return v.fields.price_cents;
  };
  const shown = sortRecords(matches, sort, (v, key) => {
    if (key === 'name') return v.fields.name;
    if (key === 'price') return moneySortValue(perPeriodCents(v));
    if (key === 'end') return v.plan && (v.plan.fields.service_start || v.fields.kind === 'subscription') ? v.plan.fields.end_date : v.status === 'ongoing' || v.status === 'perpetual' || v.status === 'paused' ? null : v.valid_until;
    if (key === 'status') return virtualStatusText(v);
    return key === 'spent' ? moneySortValue(cumulativeCost(v).cents) : null;
  }, v => v.id);
  const selected = shown.find(v => v.id === selectedId);
  // 已关联订阅与周期页、重要支出共用同一详情弹窗；储值、单次与旧版独立订阅保留右侧栏。
  const linkedDetail = selected && billingOf(selected) === 'subscription' && !!selected.fields.plan_id && !!selected.plan && !selected.plan_deleted ? selected : null;
  const closeDetail = () => { setSelectedId(null); setTopupFocus(null); };
  async function stop(item: VirtualAsset) {
    if (!data || stopping || pending || busy) return;
    setStopping(true);
    try { await submit({ command: 'virtual_save', input: { request_id: crypto.randomUUID(), generation: data.generation, id: item.id, expected_revision: item.revision, fields: { ...item.fields, stopped_on: today } } as VirtualSave, label: tt('停用 ') + item.fields.name }); reload(); }
    catch (e) { setError(errorMessage(e)); setPending(storedPending()); }
    finally { setStopping(false); }
  }
  return <section className="stats-section wealth-section" aria-label={tt('虚拟资产')}>
    {mutationError && <p role="alert" className="notice">{mutationError}</p>}
    {sourceError && <p role="alert" className="notice">{sourceError}</p>}
    {pending && <div className="notice" role="status">{tt('上次「{label}」的保存结果未确认。', { label: pending.label })}<button disabled={busy} onClick={() => void verify()}>{tt('核对结果')}</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {data && <MergeNotice refresh={retry} disabled={!!pending || busy || maintenance} onDone={m => { setMutationError(m); reload(); }} />}
    {error ? <article className="ui-card ui-content" role="alert"><p>{tt('虚拟资产读取失败：{error}', { error })}</p><button onClick={reload}>{tt('重新读取')}</button></article>
      : !data ? <p role="status" className="muted">{tt('正在读取虚拟资产…')}</p>
        : !data.items.length ? <div className="empty"><span className="empty-mark">◇</span><h2>{tt('还没有虚拟资产')}</h2><p>{tt('把买断的软件、注册的域名、订阅的服务和储值卡记下来，就能看到它们的计费方式、什么时候到期、一共花了多少。')}</p><button className="primary" disabled={!!pending} onClick={() => setEditing('new')}>{tt('新增虚拟资产')}</button></div>
          : <>
            <div className="ui-metrics ui-card">
              <article><span>{tt('使用中')}</span><strong>{data.in_use}<small> {tt('件')}</small></strong><em>{tt('共 {length} 件，不含待生效、已结束使用、停用及到期', { length: data.items.length })}</em></article>
              <article><span>{tt('即将到期')}</span><strong>{data.expiring}<small> {tt('件')}</small></strong><em>{tt('有限期权益按到期日提示')}</em></article>
              <article><span>{tt('已结束／到期')}</span><strong>{data.expired}<small> {tt('件')}</small></strong><em>{tt('订阅已结束或权益已到期')}</em></article>
              <article><span>{tt('已记录支出')}</span><strong>{money(data.spent_cents)}</strong><em>{data.unknown_price ? tt('{unknown_price} 件金额未知，未计入', { unknown_price: data.unknown_price }) : tt('一次性价格＋已确认付款＋充值实付，不含估算')}</em></article>
            </div>
            <div className="virtual-filter" role="group" aria-label={tt('筛选虚拟资产')}>
              {virtualFilters.map(([key, label]) => <button key={key} aria-pressed={filter === key} disabled={maintenance} onClick={() => setFilter(key)}>{label}</button>)}
              <select aria-label={tt('按标签筛选')} disabled={maintenance} value={labelFilter} onChange={e => setLabelFilter(e.target.value)}>
                <option value="all">{tt('全部标签')}</option>
                <option value="none">{tt('未设置标签')}</option>
                {labelNames.map(n => <option key={n} value={labelIdByName(data, n)}>{n}</option>)}
              </select>
              <select aria-label={tt('按计费方式筛选')} disabled={maintenance} value={billingFilter} onChange={e => setBillingFilter(e.target.value)}>
                <option value="all">{tt('全部计费方式')}</option>
                {billingModes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <Info text={tt('持续订阅表示当前付款安排；累计费用与已确认付款分开显示，有限期权益按到期日提示。筛选和搜索只影响列表，不改变总览数字。')}/>
            </div>
            <div className={selected && !linkedDetail ? "virtual-browser has-inspector" : "virtual-browser"}><article className="ui-card ui-content"><div className="ui-section-head"><h3>{virtualFilters.find(([k]) => k === filter)?.[1]}</h3><span>{keyword ? tt('找到 {length} 条 · ', { length: shown.length }) : ''}{tt('点名称或行查看详情；在详情中明确编辑')}</span></div>
              {!shown.length ? <p className="muted">{keyword ? <>{tt('当前条件下没有找到记录。')}<button onClick={() => onSearch('')}>{tt('清除搜索')}</button></> : tt('这一类目前没有虚拟资产。')}</p> : <table className="ui-table virtual-table"><thead><tr><SortHeader field="name" label={tt('名称')} sort={sort} onSort={setSort} /><SortHeader field="price" label={tt('金额')} sort={sort} onSort={setSort} sortLabel={tt('每期价格或单次金额（未年化原始金额；周期不同不代表负担可比）')} /><SortHeader field="end" label={tt('期限与付款安排')} sort={sort} onSort={setSort} sortLabel={tt('结束日期（无结束日期置后）')} /><SortHeader field="status" label={tt('状态')} sort={sort} onSort={setSort} /><SortHeader field="spent" label={tt('累计费用')} sort={sort} onSort={setSort} sortLabel={tt('累计费用（估算或实际投入）')} /></tr></thead><tbody>
                {shown.map(v => <tr key={v.id} tabIndex={0} aria-selected={selectedId === v.id} onClick={() => { if (!maintenance && !pending && !busy) { setSelectedId(v.id); setTopupFocus(null); } }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!maintenance && !pending && !busy) { setSelectedId(v.id); setTopupFocus(null); } } }} className={v.status === 'stopped' ? 'closed' : undefined}>
                  <td><button className="link-cell" disabled={!!pending || busy || stopping || maintenance} onClick={e => { e.stopPropagation(); setSelectedId(v.id); setTopupFocus(null); }} aria-label={tt('查看 ') + v.fields.name + tt(' 详情')}>{v.fields.name}</button>{(v.label_name || v.fields.provider || v.plan_name) && <small className="muted">{[v.label_name, v.fields.provider, v.plan_name && v.plan_name !== v.fields.name && tt('付款计划「{plan_name}」', { plan_name: v.plan_name })].filter(Boolean).join(' · ')}</small>}</td>
                  <AmountCell v={v} />
                  <td>{validityText(v)}{v.plan && billingOf(v) === 'subscription' && <small className="muted">{paymentScheduleText(v)}</small>}{billingOf(v) === 'topup' && <small className="muted">{paymentScheduleText(v)}</small>}</td>
                  <td><span className="virtual-state" data-state={v.status}>{virtualStatusText(v)}{v.status === 'stopped' && v.fields.stopped_on ? ` · ${v.fields.stopped_on}` : ''}</span>{v.needs_review && <small className="muted"> {tt('停用待核对')}</small>}{v.payment_due && <button className="ui-link" disabled={!!pending || busy || stopping || maintenance} onClick={e => { e.stopPropagation(); pay(v); }}>{tt('记录付款')}</button>}</td>
                  <CumulativeCell v={v} />
                </tr>)}
              </tbody></table>}</article>{selected && !linkedDetail && <Inspector data={data} item={selected} today={today} busy={busy} pending={!!pending} stopping={stopping} topupFocus={topupFocus} onSelect={() => { setSelectedId(null); setTopupFocus(null); }} onEdit={() => setEditing(selected)} onStop={() => void stop(selected)} onReview={() => setReviewing(selected)} onRepair={() => setRepairing(selected.id)} onMaintenanceChange={setMaintenance} onError={m => { setMutationError(m); setPending(storedPending()); }} onSaved={reload} />}</div>
          </>
    }
    {linkedDetail && data && <SubscriptionDetail plan={linkedDetail.plan!} today={today} modules={modules} onClose={closeDetail} onSaved={() => closed(true)}
      onEdit={p => { setReturnDetailId(linkedDetail.id); closeDetail(); setEditing({ ...linkedDetail, plan: p }); }} onBackfill={p => { setReturnDetailId(linkedDetail.id); closeDetail(); setBackfill(true); setEditing({ ...linkedDetail, plan: p }); }} onPay={(p, amount) => { setReturnDetailId(linkedDetail.id); closeDetail(); if (p.next_due) setPaying({ plan_id: p.id, plan_name: p.fields.name, due_date: p.next_due, plan_amount: amount, record: null, coverage_start: p.next_coverage?.[0], coverage_end: p.next_coverage?.[1] }); }}
      onCorrectPayment={payment => { setReturnDetailId(linkedDetail.id); closeDetail(); setPaying({ plan_id: payment.plan_id, plan_name: payment.plan_name, due_date: payment.due_date, plan_amount: linkedDetail.plan!.fields.amount_cents, record: payment }); }}
      onResume={p => { setReturnDetailId(linkedDetail.id); closeDetail(); setResuming(p); }}
      onGroupDelete={(_, name) => { closeDetail(); setGroupDelete({ id: linkedDetail.id, name }); }} onEnd={({plan,link}) => { setReturnDetailId(linkedDetail.id); closeDetail(); setEnding({ ...linkedDetail, revision: link.asset!.revision, paid_until: link.paid_until, plan }); }} onReview={() => { closeDetail(); setReviewing(linkedDetail); }}
      onUnify={() => { closeDetail(); setUnifying(linkedDetail); }} onCandidates={() => { closeDetail(); setRepairing(linkedDetail.id); }} />}
    {paying && data && <PaymentDialog target={paying} generation={data.generation} today={today} onClose={closed} />}
    {editing && data && <VirtualDialog item={editing === 'new' ? null : editing} data={data} today={today} backfill={backfill} onGroupDelete={(id, name) => { setEditing(null); setGroupDelete({ id, name }); }} onUnify={item => { setEditing(null); setUnifying(item); }} onClose={closed} />}
    {repairing && <LinkRepairDialog side="virtual" id={repairing} onClose={closed} onDone={m => setMutationError(m)} />}
    {ending && data && <EndSubscriptionDialog assetId={ending.id} planId={ending.plan!.id} assetName={ending.fields.name} assetRevision={ending.revision} planRevision={ending.plan!.revision} fields={ending.plan!.fields} suggestion={suggestedEndDay(ending)} today={today} generation={data.generation} onClose={closed} onDone={m => setMutationError(m)} />}
    {resuming && <ResumeSubscriptionDialog plan={resuming.plan} link={resuming.link} today={today} onClose={closed} />}
    {reviewing && data && <LinkReviewDialog assetId={reviewing.id} planId={reviewing.fields.plan_id!} assetName={reviewing.fields.name} assetRevision={reviewing.revision} planRevision={reviewing.plan!.revision} stoppedOn={reviewing.fields.stopped_on} today={today} generation={data.generation} onClose={closed} onDone={m => setMutationError(m)} />}
    {unifying && data && <UnifyNameDialog assetId={unifying.id} planId={unifying.fields.plan_id!} assetName={unifying.fields.name} planName={unifying.plan!.fields.name} assetRevision={unifying.revision} planRevision={unifying.plan!.revision} fields={unifying.plan!.fields} generation={data.generation} onClose={closed} onDone={m => setMutationError(m)} />}
    {groupDelete && data && <LinkDeleteDialog side="virtual" id={groupDelete.id} name={groupDelete.name} generation={data.generation} onClose={saved => { setGroupDelete(null); if (saved) { setEditing(null); reload(); } refocusHeading(); }} onDone={(groupId, name) => { setEditing(null); offerUndo(tt('已整组删除「{name}」。', { name }), async () => { await undoLinkDelete(groupId); }); reload(); }} />}
  </section>;
}

function labelIdByName(data: VirtualOverview, name: string): string {
  return data.items.find(v => v.label_name === name)?.fields.label_id ?? name;
}

/** 金额列：每期价格／单次金额（未年化原始金额，R14），带单位文案。 */
function AmountCell({ v }: { v: VirtualAsset }) {
  const mode = billingOf(v);
  if (mode === 'subscription') {
    const cents = v.plan?.fields.amount_cents ?? null;
    return <td className="amount">{cents != null ? <>{money(cents)}<span className="muted">／{v.plan!.fields.interval_days ? tt('{interval_days}天', { interval_days: v.plan!.fields.interval_days }) : ({ 1: tt('月'), 3: tt('季'), 6: tt('半年'), 12: tt('年') } as Record<number, string>)[v.plan!.fields.interval_months] ?? tt('期')}</span>{v.status !== 'future' && !v.plan!.fields.interval_days && v.plan!.fields.interval_months > 1 && v.plan!.monthly_cents != null && <small className="muted">{tt('月均 {v1}', { v1: money(v.plan!.monthly_cents) })}</small>}</> : <span className="muted">{tt('待补充')}</span>}</td>;
  }
  if (mode === 'topup') return <td className="amount"><small className="muted">{tt('按充值实付')}</small></td>;
  return <td className="amount">{v.fields.price_cents != null ? <>{money(v.fields.price_cents)}<small className="muted"> {tt('单次')}</small></> : <span className="muted">{tt('待补充')}</span>}</td>;
}

/** 累计费用列：订阅标估算与已记录付款；单次为实付；储值区分未知与仅已知部分。 */
function CumulativeCell({ v }: { v: VirtualAsset }) {
  const cost = cumulativeCost(v);
  if (billingOf(v) === 'topup') {
    const t = topupSpendText(v);
    return <td className="amount">{t.main != null ? tt('实付 {v1}', { v1: money(t.main) }) : <span className="muted">{v.topup_count ? tt('投入未知') : tt('尚未记录充值')}</span>}{t.note && <small className="muted">{t.note}</small>}</td>;
  }
  return <td className="amount">{cost.cents != null ? money(cost.cents) : <span className="muted">{billingOf(v) === 'single' ? tt('价格待补充') : tt('未知')}</span>}{cost.estimated && <small className="muted">{tt('估算')}</small>}</td>;
}

/** 详情面板（设计 §5.1）：只读摘要＋明确编辑入口；订阅双方信息共用一套口径。 */
function Inspector({ data, item, today, busy, pending, stopping, topupFocus, onSelect, onEdit, onStop, onReview, onRepair, onError, onSaved, onMaintenanceChange }: {
  data: VirtualOverview; item: VirtualAsset; today: string; busy: boolean; pending: boolean; stopping: boolean; topupFocus: string | null;
   onSelect: () => void; onEdit: () => void; onStop: () => void; onReview: () => void; onRepair: () => void; onError: (m: string) => void; onSaved: () => void; onMaintenanceChange: (v: boolean) => void;
}) {
  const mode = billingOf(item);
  const inspector = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.matchMedia('(max-width: 1400px)').matches) inspector.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [item.id]);
  const cost = cumulativeCost(item);
  const [maintaining, setMaintaining] = useState(false);
  const disabled = busy || pending || stopping;
  const onMaintenance = (v: boolean) => { setMaintaining(v); onMaintenanceChange(v); };
  return <aside ref={inspector} className="ui-inspector" aria-label={tt('虚拟资产摘要')}><span className="ui-avatar" style={{ background: 'var(--accent)' }}>{item.fields.name.slice(0, 1)}</span><h3 ref={heading} tabIndex={-1}>{item.fields.name}</h3><p className="muted">{billingText(mode)}{item.fields.kind !== 'general' ? ` · ${virtualKindText(item.fields.kind)}` : ''} · {item.fields.provider || tt('提供方待补充')}</p>
    {item.plan_deleted && item.fields.plan_id && <p className="notice">{tt('关联付款计划在最近删除中。')}<button className="ui-link" disabled={disabled} onClick={onRepair}>{tt('核对历史关联记录…')}</button></p>}
    {item.needs_review && <div className="notice" role="note">{tt('档案停用')}{item.fields.stopped_on ? tt('于 {stopped_on}', { stopped_on: item.fields.stopped_on }) : ''}{tt('，但关联计划仍在进行。')}<button className="ui-link" disabled={disabled} onClick={onReview}>{tt('核对停用记录…')}</button></div>}
    <div className="inspector-metrics"><div><span>{tt('有效至')}</span><strong>{validityText(item)}</strong></div><div><span>{cost.estimated ? tt('累计费用（估算）') : mode === 'topup' ? tt('累计充值实付') : tt('累计费用')}</span><strong>{cost.cents != null ? money(cost.cents) : tt('未知')}</strong></div></div>
    <dl className="facts">
      <dt>{tt('周期计划')}</dt><dd>{planAssociationText(item)}</dd>
      <dt>{tt('标签')}</dt><dd>{item.label_name || tt('未设置')}</dd>
      <dt>{tt('开始日期')}</dt><dd>{item.fields.purchase_date || tt('待补充')}</dd>
    </dl>
    {mode === 'topup' && <TopupMaintenance key={item.id} data={data} item={item} today={today} disabled={disabled} focus={topupFocus} onEditingChange={onMaintenance} onSaved={onSaved} onError={onError} />}
    <div className="ui-foot"><button disabled={disabled || maintaining} onClick={onEdit}>{tt('编辑')}</button>{item.status !== 'stopped' && <button className="ui-link" disabled={disabled || maintaining} onClick={onStop}>{stopping ? tt('保存中…') : mode === 'single' ? tt('结束使用') : tt('停用')}</button>}<button className="ui-link" disabled={disabled || maintaining} onClick={onSelect}>{tt('收起')}</button></div>
  </aside>;
}

/** 储值维护（review R13）：充值列表／新增／更正／删除与带日期的余额盘点。 */
function TopupMaintenance({ data, item, today, disabled, focus, onSaved, onError, onEditingChange }: {
  data: VirtualOverview; item: VirtualAsset; today: string; disabled: boolean; focus: string | null; onEditingChange: (v: boolean) => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const topups: TopupRecord[] = item.topups ?? [];
  const [editing, setEditing] = useState<{ id: string | null; fields: TopupFields } | null>(null);
  const [busy, setBusy] = useState(false);
  const creditTouched = useRef(false);
  const paidCents = editing?.fields.paid_cents;
  const giftCents = editing?.fields.gift_cents;
  const autoCredit = (() => {
    if (!editing || creditTouched.current) return null;
    if (!paidCents && !giftCents) return null;
    return String(BigInt(paidCents || '0') + BigInt(giftCents || '0'));
  })();
  const setEdit = (fields: TopupFields) => setEditing(x => x && { ...x, fields });
  const startNew = () => { creditTouched.current = false; setEditing({ id: null, fields: { topup_date: today, paid_cents: '', gift_cents: null, credit_cents: null, pay_method: '', notes: '' } }); };
  const startEdit = (t: TopupRecord) => { creditTouched.current = t.fields.credit_cents != null; setEditing({ id: t.id, fields: { ...t.fields } }); };
  async function saveTopup() {
    if (!editing) return;
    if (!editing.fields.paid_cents && !editing.fields.gift_cents && !editing.fields.credit_cents && autoCredit == null) { onError(tt('请至少填写实付、赠送或到账额度中的一项。')); return; }
    const credit = editing.fields.credit_cents ?? autoCredit;
    // 空串统一为 null：未知实付不落成 0（设计 §6）。
    const clean = (v: string | null) => (v === '' ? null : v);
    setBusy(true);
    try {
      await submit({ command: 'virtual_topup_save', input: { request_id: crypto.randomUUID(), generation: data.generation, asset_id: item.id, id: editing.id, expected_revision: editing.id ? (topups.find(t => t.id === editing.id)?.revision ?? null) : null, fields: { ...editing.fields, paid_cents: clean(editing.fields.paid_cents ?? null), gift_cents: clean(editing.fields.gift_cents ?? null), credit_cents: clean(credit) } }, label: (editing.id ? tt('更正充值 ') : tt('新增充值 ')) + item.fields.name });
      setEditing(null); onSaved();
    } catch (e) { if (e instanceof Unresolved) { setEditing(null); onError(tt('保存结果未确认，请核对后继续。')); } else onError(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  const [balanceDraft, setBalanceDraft] = useState<{ cents: string; date: string; notes: string } | null>(null);
  const editingChange = useRef(onEditingChange);
  editingChange.current = onEditingChange;
  useEffect(() => { editingChange.current(!!editing || !!balanceDraft || busy); return () => editingChange.current(false); }, [!!editing, !!balanceDraft, busy]);
  async function removeTopup(t: TopupRecord) {
    if (disabled || busy) return;
    setBusy(true);
    try { await submit({command:'wealth_trash', input:{request_id:crypto.randomUUID(), generation:data.generation,kind:'topup',id:t.id,expected_revision:t.revision,deleted:true},label:tt('删除充值')}); onSaved(); }
    catch(e) { onError(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function saveBalance() {
    if (!balanceDraft || !balanceDraft.cents) { onError(tt('请填写剩余额度。')); return; }
    setBusy(true);
    try {
      await submit({ command: 'virtual_balance_save', input: { request_id: crypto.randomUUID(), generation: data.generation, asset_id: item.id, id: item.balance?.id ?? null, expected_revision: item.balance?.revision ?? null, balance_cents: balanceDraft.cents, recorded_on: balanceDraft.date, notes: balanceDraft.notes }, label: tt('记录余额 ') + item.fields.name });
      setBalanceDraft(null); onSaved();
    } catch (e) { if (e instanceof Unresolved) { setBalanceDraft(null); onError(tt('保存结果未确认，请核对后继续。')); } else onError(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="topup-maintenance" aria-label={tt('充值与余额维护')}>
    <div className="ui-section-head"><h4>{tt('充值记录')}</h4><button type="button" disabled={disabled || busy} onClick={startNew}>{tt('记一笔充值')}</button></div>
    {topups.length === 0 && <p className="muted small">{tt('尚未记录充值；实付按充值日期计入重要支出。')}</p>}
    {topups.map(t => <div key={t.id} className={'topup-row' + (focus === t.id ? ' topup-focus' : '')} data-topup-id={t.id}>
      <span>{t.fields.topup_date ?? <span className="muted">{tt('日期待补充')}</span>}</span>
      <span>{t.fields.paid_cents != null ? tt('实付 {v1}', { v1: money(t.fields.paid_cents) }) : tt('实付未知')}{t.fields.gift_cents ? tt(' · 赠 {v1}', { v1: money(t.fields.gift_cents) }) : ''}{t.fields.credit_cents ? tt(' · 到账 {v1}', { v1: money(t.fields.credit_cents) }) : ''}</span>
      <span className="topup-actions"><button type="button" className="ui-link" disabled={disabled || busy} onClick={() => startEdit(t)}>{tt('更正')}</button><button type="button" className="ui-link" disabled={disabled || busy} onClick={() => void removeTopup(t)}>{tt('删除')}</button></span>
    </div>)}
    {editing && <fieldset className="form-block"><legend className="muted small">{editing.id ? tt('更正充值') : tt('新增充值')}</legend>
      <FormRow label={tt('充值日期')} hint={tt('默认今天；可清空表示未知')}><DateInput yearIntent="past" value={editing.fields.topup_date ?? ''} max={today} allowClear disabled={disabled || busy} onChange={v => setEdit({ ...editing.fields, topup_date: v || null })} /></FormRow>
      <FormRow label={tt('实付金额')} hint={tt('只有赠送且明确未支付时填 0；未知留空')}><CentInput label={tt('充值实付')} value={editing.fields.paid_cents ?? ''} disabled={disabled || busy} placeholder="0.00" onChange={v => setEdit({ ...editing.fields, paid_cents: v || null })} /></FormRow>
      <FormRow label={tt('赠送金额')} hint={tt('默认无赠送；不计入投入')}><CentInput label={tt('赠送金额')} value={editing.fields.gift_cents ?? ''} disabled={disabled || busy} placeholder="0.00" onChange={v => setEdit({ ...editing.fields, gift_cents: v || null })} /></FormRow>
      <FormRow label={tt('本次到账额度')} hint={creditTouched.current ? tt('保存的到账额度，修改实付不会自动覆盖；可恢复默认联动') : tt('默认实付＋赠送，随两项联动；手动修改后停止')}><CentInput label={tt('到账额度')} value={editing.fields.credit_cents ?? autoCredit ?? ''} disabled={disabled || busy} placeholder="0.00" onChange={v => { creditTouched.current = true; setEdit({ ...editing.fields, credit_cents: v || null }); }} /></FormRow>
      {creditTouched.current && <button type="button" className="ui-link" disabled={disabled || busy} onClick={() => { creditTouched.current = false; setEdit({...editing.fields,credit_cents:null}); }}>{tt('恢复到账额度默认联动')}</button>}
      <div className="actions"><button type="button" disabled={disabled || busy} onClick={() => setEditing(null)}>{tt('取消')}</button><button type="button" className="primary" disabled={disabled || busy} onClick={() => void saveTopup()}>{busy ? tt('保存中…') : tt('保存充值')}</button></div>
    </fieldset>}
    <div className="ui-section-head"><h4>{tt('剩余额度')}</h4>{item.balance && <small className="muted">{tt('截至 {recorded_on}', { recorded_on: item.balance.recorded_on })}</small>}</div>
    {item.balance ? <p className="muted small">{tt('当前记录 {v1}（{recorded_on}）；手动盘点值，充值与到期不会自动扣减。', { v1: money(item.balance.balance_cents), recorded_on: item.balance.recorded_on })}</p> : <p className="muted small">{tt('尚未记录余额；累计到账额度不等于当前剩余。')}</p>}
    {!balanceDraft && <button type="button" disabled={disabled || busy} onClick={() => setBalanceDraft({ cents: item.balance?.balance_cents ?? '', date: item.balance?.recorded_on ?? today, notes: item.balance?.notes ?? '' })}>{item.balance ? tt('更正余额记录') : tt('记录余额')}</button>}
    {balanceDraft && <fieldset className="form-block"><legend className="muted small">{tt('余额盘点')}</legend>
      <FormRow label={tt('剩余额度')} hint={tt('手动查看后的实际余额')}><CentInput label={tt('剩余额度')} value={balanceDraft.cents} disabled={disabled || busy} placeholder="0.00" onChange={v => setBalanceDraft(x => x && { ...x, cents: v })} /></FormRow>
      <FormRow label={tt('记录日期')} hint={tt('这份余额是哪天看到的')}><DateInput yearIntent="past" value={balanceDraft.date} max={today} disabled={disabled || busy} onChange={v => setBalanceDraft(x => x && { ...x, date: v })} /></FormRow>
      <FormRow label={tt('备注')}><input aria-label={tt('余额备注')} maxLength={10000} value={balanceDraft.notes} disabled={disabled || busy} onChange={e => setBalanceDraft(x => x && { ...x, notes: e.target.value })} /></FormRow>
      <div className="actions"><button type="button" disabled={disabled || busy} onClick={() => setBalanceDraft(null)}>{tt('取消')}</button><button type="button" className="primary" disabled={disabled || busy || !balanceDraft.cents || !balanceDraft.date} onClick={() => void saveBalance()}>{busy ? tt('保存中…') : tt('保存余额')}</button></div>
    </fieldset>}
  </section>;
}

const blank = (): VirtualFields => ({ name: '', kind: 'general', billing: 'subscription', label_id: null, provider: '', purchase_date: null, price_cents: null, expires: null, plan_id: null, url: '', notes: '', stopped_on: null });
const providerLabel: Record<string, string> = { license: tt('软件商'), domain: tt('注册商'), subscription: tt('平台'), general: tt('提供方') };

function VirtualDialog({ item, data, today, onClose, backfill, onGroupDelete, onUnify }: { backfill: boolean; item: VirtualAsset | null; data: VirtualOverview; today: string; onClose: (saved: boolean, warning?: string | null) => void; onGroupDelete: (id: string, name: string) => void; onUnify: (item: VirtualAsset) => void }) {
  // 旧记录两页名称可能不同：仅原本统一（或新建）时才一起改计划名（设计 §4）。
  const namesUnified = !item?.plan || item.plan.fields.name === item.fields.name;
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<VirtualFields>(item ? { ...item.fields, billing: billingOf(item) } : blank());
  const legacyLink = !!item && !!item.fields.plan_id && (!item.plan || !item.plan.fields.service_start);
  const [planFieldsState, setPlanFields] = useState<PlanFields>(item?.plan?.fields ?? blankPlan(today));
  // 订阅默认用简易表单；续费价格、特殊到期等分段设置在「更多」里，由原有字段处理，不影响能否使用简易表单。
  const initialSimple = item?.plan ? fieldsToRent({ ...item.plan, rules: [], period_ends: {}, special_start: null, special_end: null, renewal_cents: null }) : null;
  const [simpleState, setSimpleState] = useState<RentForm>(initialSimple ?? blankRent(today)), [forceFull, setForceFull] = useState(false);
  const simple = !forceFull && (!item?.plan || initialSimple !== null);
  const planFields: PlanFields = simple ? { ...planFieldsState, ...rentToFields(simpleState, planFieldsState.category || 'subscription') } : planFieldsState;
  const [firstDueTouched, setFirstDueTouched] = useState(!!item?.plan);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  const initialRenewal = item?.plan?.renewal_cents ?? '';
  const [renewal, setRenewal] = useState(initialRenewal);
  const [renewalFrom, setRenewalFrom] = useState(item?.plan?.renewal_from ?? '');
  const [specialOn, setSpecialOn] = useState(!!item?.plan?.special_end);
  const [specialEnd, setSpecialEnd] = useState(item?.plan?.special_end ?? '');
  const [perpetual, setPerpetual] = useState(!!item && (!!item.fields.perpetual || (item.fields.kind === 'license' && !item.fields.expires)));
  const [withTopup, setWithTopup] = useState(false);
  const creditTouched = useRef(false);
  const [firstTopup, setFirstTopup] = useState<TopupFields>({ topup_date: today, paid_cents: '', gift_cents: null, credit_cents: null, pay_method: '', notes: '' });
  const autoCredit = creditTouched.current ? null : (firstTopup.paid_cents || firstTopup.gift_cents) && String(BigInt(firstTopup.paid_cents || '0') + BigInt(firstTopup.gift_cents || '0'));
  useEffect(() => { dialog.current?.showModal(); document.getElementById('virtual-name')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof VirtualFields>(k: K, v: VirtualFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  const mode = f.billing;
  const isSubscription = mode === 'subscription';
  const summary = isSubscription ? subscriptionSummary(planFields, today) : '';
  const dirty = !!item && (renewal !== initialRenewal || renewalFrom !== (item.plan?.renewal_from ?? '') || specialOn !== !!item.plan?.special_end || specialEnd !== (item.plan?.special_end ?? '') || (simple ? JSON.stringify(simpleState) !== JSON.stringify(initialSimple) : JSON.stringify(planFields) !== JSON.stringify(item.plan?.fields ?? null)) || JSON.stringify({ ...f, billing: billingOf(item), pay_method: f.pay_method ?? null }) !== JSON.stringify({ ...item.fields, billing: billingOf(item) }));
  async function save() {
    if (!dialog.current?.querySelector("form")?.reportValidity()) return;
    if (!f.name.trim()) { setNotice(tt('请填写名称。')); document.getElementById('virtual-name')?.focus(); return; }
    const fields: VirtualFields = { ...f, name: f.name.trim(), perpetual, ...(isSubscription && !legacyLink ? { purchase_date: planFields.service_start && planFields.service_start <= today ? planFields.service_start : null, price_cents: null, expires: null } : {}), ...(mode === 'topup' ? { price_cents: null, plan_id: null, perpetual: false } : {}) };
    if (isSubscription && !legacyLink && (!planFields.amount_cents || planFields.amount_cents === '0')) { setNotice(tt('请填写每期金额。')); document.querySelector<HTMLElement>('dialog [aria-label="每期金额"]')?.focus(); return; }
    if (mode === 'single' && item?.fields.kind === 'license' && !fields.stopped_on && !perpetual && !fields.expires) { setNotice(tt('旧买断软件未设期限时按永久有效解释；有限期授权请填有效至，不再使用请选已结束使用。')); return; }
    if (mode === 'single' && perpetual && fields.expires) { setNotice(tt('选择永久有效时不要填写有效至。')); return; }
    const renewalLoad = isSubscription && !legacyLink ? (renewal === initialRenewal && renewalFrom !== (item?.plan?.renewal_from ?? '') ? renewal : renewalPayload(initialRenewal, renewal)) : null;
    const input: VirtualSave = {
      ...(isSubscription && ((item?.plan && !item.plan_deleted) || !item) ? { plan: { id: item?.plan?.id ?? null, expected_revision: item?.plan?.revision ?? null, fields: { ...(legacyLink ? planFieldsState : planFields), name: namesUnified || !item ? fields.name : item.plan!.fields.name, category: planFields.category || 'subscription' } } } : {}),
      ...(isSubscription && !legacyLink ? { renewal_price_cents: renewalLoad, renewal_from: renewal ? (renewalFrom || null) : null, special_end: item?.plan?.special_start ? { period_start: item.plan.special_start, coverage_end: specialOn ? (specialEnd || null) : null } : null } : {}),
      ...(mode === 'topup' && !item && withTopup && (firstTopup.paid_cents || firstTopup.gift_cents || firstTopup.credit_cents || autoCredit) ? { first_topup: { ...firstTopup, paid_cents: firstTopup.paid_cents || null, gift_cents: firstTopup.gift_cents || null, credit_cents: firstTopup.credit_cents ?? autoCredit ?? null } } : {}),
      request_id: crypto.randomUUID(), generation: data.generation, id: item?.id ?? null, expected_revision: item?.revision ?? null, fields,
    };
    setBusy(true); setNotice('');
    try { await submit({ command: 'virtual_save', input, label: tt('虚拟资产 {name}', { name: fields.name }) }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  const switchMode = (next: BillingMode) => {
    if (item && billingOf(item) !== next) {
      const hadFacts = billingOf(item) === 'topup' ? (item.topup_count ?? 0) > 0 : billingOf(item) === 'subscription' ? !!item.fields.plan_id : !!item.fields.price_cents;
      if (hadFacts) { setNotice(tt('已有付款或充值事实的档案不能更换计费方式；请保留原方式或新建档案。')); return; }
    }
    setF(x => ({ ...x, billing: next }));
  };
  const advanced = <>
        <FormRow label={tt('后续续费价格')} hint={tt('留空沿用本期价格；从指定生效期开始分段')}><div className="form-inline"><CentInput label={tt('后续续费价格')} value={renewal} disabled={frozen} placeholder="0.00" onChange={v => { setRenewal(v); if (v && !renewalFrom) setRenewalFrom(shiftDays(suggestedFinalDay(planFields, today), 1)); }} /><DateInput label={tt('生效期')} value={renewalFrom} disabled={frozen} onChange={setRenewalFrom} /></div>{renewal && <small className="muted">{tt('生效期须为某一期的开始日且晚于今天；已确认付款不受影响。清空并保存会撤销尚未生效的设置。')}</small>}{initialRenewal && !renewal && <small className="muted">{tt('保存后将取消尚未生效的后续价格。')}</small>}</FormRow>
        {item?.plan?.special_start && <FormRow label={tt('本期特殊到期')} hint={item.plan.special_end ? tt('当前已调整至 {special_end}', { special_end: item.plan.special_end }) : tt('只影响本期及之后的推算，不改动已确认付款')}><div className="form-inline"><Switch label={tt('调整本期到期')} value={specialOn} disabled={frozen} onChange={setSpecialOn} />{specialOn && <DateInput label={tt('本期到期日')} value={specialEnd} min={item.plan.special_start ?? undefined} disabled={frozen} onChange={setSpecialEnd} />}</div><small className="muted">{tt('本期自 {special_start} 起；关闭并保存会取消本次特殊到期。', { special_start: item.plan.special_start })}</small></FormRow>}
        {item && <ReminderRow item={item} generation={data.generation} today={today} disabled={frozen || dirty} onNotice={setNotice} onStuck={setStuck} onSaved={warning => onClose(true, warning)} onBusyChange={setBusy} />}
        <FormRow label={tt('支付方式')} hint={tt('可选文字备注；不建立支付账户')}><input aria-label={tt('支付方式')} maxLength={80} value={f.pay_method ?? ''} disabled={frozen} onChange={e => set('pay_method', e.target.value)} placeholder={tt('可留空')} /></FormRow>
  </>;
  return <dialog ref={dialog} className="editor wealth-account-editor virtual-editor" aria-labelledby="virtual-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">{tt('财富 · 虚拟资产')}</p><h2 id="virtual-heading">{item ? tt('编辑虚拟资产') : tt('新增虚拟资产')}</h2><p className="muted">{mode === 'subscription' ? tt('按每期价格与服务期间估算累计费用；确认历史付款后才计入已记录支出。') : mode === 'topup' ? tt('按充值实付累计投入；赠送与额度不计入支出。') : tt('单次购买按实付记录；完成一次性服务后可结束使用，仍保留金额和购买日期。')}</p></div><CloseButton type="button" aria-label={tt('关闭虚拟资产表单')} disabled={busy} onClick={() => onClose(false)} /><div className="editor-header-actions">{item && !stuck && (isSubscription && item.plan && !item.plan_deleted
          ? <button type="button" disabled={busy} onClick={() => onGroupDelete(item.id, item.fields.name)} title={tt('已关联订阅整组删除：服务档案与付款计划一起移入最近删除')}>{tt('删除…')}</button>
          : <DeleteButton label={tt('删除')} disabled={busy} kind="virtual" id={item.id} revision={item.revision} generation={data.generation} name={tt('虚拟资产 {name}', { name: item.fields.name })} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }} />)}{stuck ? <button type="button" onClick={() => onClose(false)}>{tt('关闭，稍后核对')}</button> : <button className="primary" disabled={busy}>{busy ? tt('保存中…') : tt('保存')}</button>}</div></header>
    <section className="form-block">
      <FormRow label={tt('名称')} hint={item?.plan && !namesUnified ? tt('付款计划名称为「{name}」；两页名称不同，仅打开或修改价格不会自动统一', { name: item.plan.fields.name }) : undefined}><input id="virtual-name" aria-label={tt('名称')} maxLength={80} value={f.name} disabled={frozen} onChange={e => set('name', e.target.value)} placeholder={tt('例如 GPT Plus、iCloud、饭卡')} /></FormRow>
      {item?.plan && !namesUnified && <p className="muted small">{tt('两页名称不同。')}<button type="button" className="ui-link" disabled={frozen} onClick={() => onUnify(item)}>{tt('统一名称…')}</button></p>}
      <FormRow label={tt('标签')} hint={tt('可留空；与实物标签同一套管理')}><ChoiceField kind="label" label={tt('标签')} domain="virtual" generation={data.generation} value={f.label_id} onChange={label_id => set('label_id', label_id)} disabled={frozen} /></FormRow>
      <FormRow label={tt('计费方式')} hint={mode === 'subscription' ? tt('订阅按周期持续计费') : mode === 'topup' ? tt('储值按充值实付累计') : tt('单次购买一次性投入')}><Segments label={tt('计费方式')} value={mode} disabled={frozen} options={billingModes.map(([value, label]) => ({ value, label }))} onChange={switchMode} /></FormRow>
      {item && mode === 'single' && item.fields.kind === 'subscription' && !item.fields.plan_id && <p className="muted small">{tt('{v1}。若要按月计费，请核对每期金额与服务期间后新建订阅，避免把旧金额误算成月费。', { v1: planAssociationText(item) })}</p>}
      {isSubscription && (legacyLink
        ? <><p className="muted small">{tt('旧版计划保留原排期；修改计费时同时核对关联双方。')}</p>{item?.plan && !item.plan_deleted && <PlanFieldsForm fields={planFieldsState} onChange={setPlanFields} disabled={frozen} today={today} editing firstDueTouched={firstDueTouched} onFirstDueTouched={() => setFirstDueTouched(true)} />}</>
        : simple ? <>
          <RentPlanForm value={simpleState} onChange={setSimpleState} disabled={frozen} today={today} rent={false} />
          <details className="plan-advanced"><summary>{tt('更多：后续续费价格、备款提醒、支付方式')}</summary>{advanced}</details>
          <p className="muted small"><button type="button" className="ui-link" disabled={frozen} onClick={() => { setPlanFields(planFields); setForceFull(true); }}>{tt('需要免费试用、固定天数、暂停续费等高级设置？改用完整表单')}</button></p>
        </>
        : <PlanFieldsForm fields={planFields} onChange={setPlanFields} disabled={frozen} today={today} advanced={advanced} editing={!!item?.plan} firstDueTouched={firstDueTouched} onFirstDueTouched={() => setFirstDueTouched(true)} />)}
      {isSubscription && !legacyLink && <p className="muted small" aria-live="polite">{summary}</p>}
      {mode === 'single' && <>
        <FormRow label={tt('实付金额')} hint={tt('计入重要支出；留空表示未知，0 为明确免费')}><CentInput label={tt('实付金额')} value={f.price_cents ?? ''} disabled={frozen} placeholder="0.00" onChange={v => set('price_cents', v || null)} /></FormRow>
        <p className="muted small">{tt('纯一次性消费也可直接记在「重要支出」，同一笔不要重复录入。还贷款本金请在账户盘点中减少负债，仅利息记为支出。')}</p>
        <FormRow label={tt('购买日期')} hint={tt('可留空')}><DateInput yearIntent="past" id="virtual-purchase" value={f.purchase_date ?? ''} max={today} allowClear disabled={frozen} onChange={v => set('purchase_date', v || null)} /></FormRow>
        <FormRow label={tt('使用情况')} hint={tt('一次性服务完成后选已结束使用；不会删除历史支出')}><Segments label={tt('使用情况')} value={f.stopped_on ? 'finished' : 'using'} disabled={frozen} options={[{ value: 'using', label: tt('仍在使用') }, { value: 'finished', label: tt('已结束使用') }]} onChange={v => set('stopped_on', v === 'finished' ? (f.stopped_on ?? today) : null)} /></FormRow>
        {f.stopped_on && <FormRow label={tt('使用结束日期')} hint={tt('实际服务完成或不再使用的日期；可填过去')}><DateInput yearIntent="past" label={tt('使用结束日期')} value={f.stopped_on} min={f.purchase_date ?? undefined} max={today} disabled={frozen} onChange={v => v && set('stopped_on', v)} /></FormRow>}
        {!f.stopped_on && <FormRow label={tt('永久有效')} hint={f.kind === 'license' && item ? tt('旧档案留空即按永久解释') : tt('明确永久与未设置有效期是两个状态')}><Switch label={tt('永久有效')} value={perpetual} disabled={frozen} onChange={v => { setPerpetual(v); if (v) set('expires', null); }} /></FormRow>}
        {!f.stopped_on && !perpetual && <FormRow label={tt('有效至')} hint={f.kind === 'license' && item ? tt('旧买断软件需填写期限；不再使用请选已结束使用') : tt('留空显示为未设置有效期，不代表永久')}><DateInput id="virtual-expires" value={f.expires ?? ''} allowClear disabled={frozen} onChange={v => set('expires', v || null)} /></FormRow>}
      </>}
      {mode === 'topup' && <>
        <FormRow label={tt('额度到期日')} hint={tt('可留空；日期过去自动到期，不退款')}><DateInput id="virtual-expires" value={f.expires ?? ''} allowClear disabled={frozen} onChange={v => set('expires', v || null)} /></FormRow>
        {!item && <FormRow label={tt('首次充值')} hint={tt('可先建档案，保存后在详情中维护每一笔')}><Switch label={tt('现在记录首次充值')} value={withTopup} disabled={frozen} onChange={setWithTopup} /></FormRow>}
        {!item && withTopup && <fieldset className="form-block"><legend className="muted small">{tt('首次充值')}</legend><FormRow label={tt('充值日期')} hint={tt('默认今天；可清空')}><DateInput yearIntent="past" value={firstTopup.topup_date ?? ''} max={today} allowClear disabled={frozen} onChange={v => setFirstTopup(x => ({ ...x, topup_date: v || null }))} /></FormRow><FormRow label={tt('实付金额')} hint={tt('只有赠送且明确未支付时填 0')}><CentInput label={tt('充值实付')} value={firstTopup.paid_cents ?? ''} disabled={frozen} placeholder="0.00" onChange={v => setFirstTopup(x => ({ ...x, paid_cents: v || null }))} /></FormRow><FormRow label={tt('赠送金额')} hint={tt('默认无赠送；不计入投入')}><CentInput label={tt('赠送金额')} value={firstTopup.gift_cents ?? ''} disabled={frozen} placeholder="0.00" onChange={v => setFirstTopup(x => ({ ...x, gift_cents: v || null }))} /></FormRow><FormRow label={tt('本次到账额度')} hint={creditTouched.current ? tt('手动值：折扣充值可这样记录') : tt('默认实付＋赠送，随两项联动；手动修改后停止')}><CentInput label={tt('到账额度')} value={firstTopup.credit_cents ?? autoCredit ?? ''} disabled={frozen} placeholder="0.00" onChange={v => { creditTouched.current = true; setFirstTopup(x => ({ ...x, credit_cents: v || null })); }} /></FormRow></fieldset>}
        {item && <p className="muted small">{tt('充值、更正与余额盘点在右侧详情面板维护；实付充值按充值日期计入重要支出。')}</p>}
      </>}
      <details className="plan-advanced" open={!isSubscription ? true : undefined}><summary>{tt('档案补充：提供方 / 链接 / 备注')}</summary>
        <FormRow label={providerLabel[f.kind] ?? tt('提供方')}><input aria-label={providerLabel[f.kind] ?? tt('提供方')} maxLength={80} value={f.provider} disabled={frozen} onChange={e => set('provider', e.target.value)} placeholder={tt('可留空')} /></FormRow>
        <FormRow label={tt('链接')} hint={tt('购买或管理页面')}><input aria-label={tt('链接')} maxLength={2000} value={f.url} disabled={frozen} onChange={e => set('url', e.target.value)} placeholder={tt('可留空')} /></FormRow>
        {/* R6：已关联订阅不再暴露旧停用开关——结束走双方一致的「结束订阅」； */}
        {/* 单次、储值和无有效关联计划的档案保留原语义。 */}
        {item && mode !== 'single' && !(isSubscription && item.plan && !item.plan_deleted) && <FormRow label={tt('停用')} hint={legacyLink ? tt('旧关联计划保持原停用语义') : tt('不再使用；可随时撤回')}><Switch label={tt('停用')} value={!!f.stopped_on} disabled={frozen} onChange={v => set('stopped_on', v ? today : null)} /></FormRow>}
        {item && mode !== 'single' && !(isSubscription && item.plan && !item.plan_deleted) && f.stopped_on && <FormRow label={tt('停用日期')}><DateInput yearIntent="past" id="virtual-stopped" value={f.stopped_on} min={f.purchase_date ?? undefined} max={today} disabled={frozen} onChange={v => v && set('stopped_on', v)} /></FormRow>}
        {item && isSubscription && item.plan && !item.plan_deleted && <p className="muted small">{tt('不再使用这项订阅时，请在详情面板用「结束订阅…」确认最后使用日；两页状态保持一致。')}</p>}
      </details>
    </section>
    {item?.plan?.fields.service_start && isSubscription && <><PaymentRangeForm plan={item.plan} generation={data.generation} today={today} initialOpen={backfill} disabled={frozen || dirty} onBusyChange={setBusy} onSaved={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }} />{dirty && <p className="muted small">{tt('请先保存本次修改，再补记历史付款。')}</p>}</>}
    <section className="form-block form-notes"><label htmlFor="virtual-notes">{tt('备注')}</label><textarea id="virtual-notes" maxLength={10000} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)} /></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}

function subscriptionSummary(f: PlanFields, today: string): string {
  if (!f.service_start) return tt('填写开始日期后显示首期与付款摘要。');
  const parts: string[] = [];
  if (f.trial_days) parts.push(tt('试用至 {v1}，计费开始 {v2}', { v1: shiftDays(f.service_start, f.trial_days - 1), v2: shiftDays(f.service_start, f.trial_days) }));
  parts.push(f.end_date ? tt('使用至 {end_date}', { end_date: f.end_date }) : tt('持续续费，无结束日期'));
  if (f.end_date && f.end_date < today) parts.push(tt('已结束，无后续付款'));
  return parts.join('；') + '。';
}

/** Reminder preferences share one transaction; recurring dates come from unpaid periods. */
function ReminderRow({ item, generation, today, disabled, onNotice, onStuck, onSaved, onBusyChange }: {
  item: VirtualAsset; generation: string; today: string; disabled: boolean; onNotice: (m: string) => void; onStuck: (v: boolean) => void; onSaved: (warning?: string | null) => void; onBusyChange?: (v: boolean) => void;
}) {
  // 与周期页共用同一编辑组件（R5/I05）：同一提醒源、同一门控。
  return <SharedReminderRow
    assetId={item.id} assetRevision={item.revision} reminder={item.reminder ?? null}
    nextDue={item.plan?.next_due ?? null} paymentDueDate={item.payment_due?.due_date ?? null}
    hasServiceStart={!!item.plan?.fields.service_start}
    generation={generation} today={today} disabled={disabled}
    onNotice={onNotice} onStuck={() => onStuck(true)} onSaved={onSaved} onBusyChange={onBusyChange} />;
}
