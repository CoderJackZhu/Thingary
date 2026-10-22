import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnnualReview } from './AnnualReview';
import { HeaderSlot } from './HeaderSlot';
import { ListPagination } from './ListPagination';
import { usePageBar } from './topbar';
import { useFinanceSources } from './finance-data';
import type { RuntimeModules } from './modules';
import type { FinanceRoute } from './finance-navigation';
import type { SourceTarget } from './source';
import type { TrendRange } from './review';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import { nativePlanningFollowupPortV1 } from './planning-followup-port';
import { reviewRecordsPeriod } from './finance-contract';
import { reviewInterval, incomeMetric, expenseMetric } from './finance-review-model';
import { money } from './asset';
import { changeText } from './wealth';
import { WealthChanges } from './WealthChanges';
import { InvestmentReviewHost } from './InvestmentReviewHost';
import { useRestored } from './undo';
import { usePendingReceipt } from './WealthPage';
import { storedPending } from './wealth';
import { expenseSourceTarget, sourceLabel } from './expenses';
import { HISTORY_MIN_INTERVALS } from './planning-basic-defaults';
import { incomeCategories } from './income-classification';
import type { InvestmentReviewResultV1 } from './investment-review/model';
import './wealth.css';
import './planning.css';
import { t } from './i18n.ts';
export type FinanceReviewBrowseState = { sort?: 'impact' | 'kind'; expandedIds?: string[]; accountView?: 'active' | 'closed' | 'all' };
type ReviewRoute = Extract<FinanceRoute, {page: 'review'}>;
type Preview = {fromSnapshotId:string; toSnapshotId:string; result: InvestmentReviewResultV1} | null;
export function FinanceReviewPage({ generation, today, modules, route, onRouteChange, onRecords, onGoals, onNewAccount, onCheckIn, onOpenSource, onEditingChange, blocked = false, restoreScroll, followupPort, browseState = {}, onBrowseStateChange, onViewTrend }: {
  generation:string; today:string; modules:RuntimeModules; route:ReviewRoute; onRouteChange:(route:ReviewRoute)=>void;
  onRecords:(route:Extract<FinanceRoute,{page:'records'}>)=>void; onGoals:()=>void; onNewAccount:()=>void; onCheckIn:(date:string)=>void;
  onOpenSource:(target:SourceTarget)=>void; onEditingChange:(value:boolean)=>void; blocked?:boolean; restoreScroll?:{top:number;done:()=>void}|null;
  onViewTrend?:(selection:{range:TrendRange;custom?:{from:string;to:string}})=>void;
  followupPort?:PlanningFollowupPortV1; browseState?:FinanceReviewBrowseState; onBrowseStateChange?:(state:FinanceReviewBrowseState)=>void;
}) {
  usePageBar('finance-review', {});
  const all = useMemo(() => ({kind:'all'} as const), []);
  const facts = useFinanceSources(generation, all, modules);
  const bootstrap = facts.load.status === 'ready' ? facts.load.sources : null;
  const points = bootstrap?.wealth.status === 'ready' ? bootstrap.wealth.value.points : [];
  const completePoints = points.filter(point => point.complete);
  const firstSnapshotOnly = !route.pair && completePoints.length === 1 && route.toSnapshotId === completePoints[0].snapshot_id;
  const invalidSelection = !!(route.toSnapshotId || route.pair) && !firstSnapshotOnly;
  const requested = bootstrap?.asset_review.status === 'ready' ? reviewInterval(bootstrap.asset_review.value.intervals, points, route.toSnapshotId ?? (route.view === 'period' ? route.pair?.toSnapshotId : undefined), route.view === 'period' ? route.pair?.fromSnapshotId : undefined) : null;
  const period = useMemo(() => requested ? reviewRecordsPeriod(requested.interval.from, requested.interval.to) : all, [requested?.interval.from, requested?.interval.to, all]);
  const current = useFinanceSources(generation, period, modules);
  const periodSources = requested && current.load.status === 'ready' && current.load.sources.period.kind === 'range' && current.load.sources.period.from === requested.interval.from && current.load.sources.period.to === requested.interval.to && !current.load.sources.period.includeFrom ? current.load.sources : null;
  const verified = periodSources?.asset_review.status === 'ready' && periodSources.wealth.status === 'ready' ? reviewInterval(periodSources.asset_review.value.intervals, periodSources.wealth.value.points, requested?.pair.toSnapshotId, requested?.pair.fromSnapshotId) : null;
  const periodReady = !!verified && verified.interval.from === requested?.interval.from && verified.interval.to === requested?.interval.to;
  const selected = verified ?? requested;
  // All is only a selector bootstrap. Every displayed period fact comes from the same aggregate.
  const sources = route.view === 'compare' ? bootstrap : periodSources ?? bootstrap;
  const reload = useCallback(() => { facts.reload(); current.reload(); }, [facts.reload, current.reload]);
  useRestored(reload);
  const {pending,setPending,notice,busy,verify} = usePendingReceipt(reload);
  const [receiptResolutionVersion,setReceiptResolutionVersion] = useState(0);
  const [childEditing,setChildEditing] = useState(false);
  useEffect(() => { onEditingChange(childEditing || !!pending || busy); return () => onEditingChange(false); }, [childEditing,pending,busy,onEditingChange]);
  const [preview,setPreview] = useState<Preview>(null);
  const nativePort = useMemo(() => nativePlanningFollowupPortV1(), []);
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => { setPreview(null); }, [generation, selected?.pair.fromSnapshotId, selected?.pair.toSnapshotId]);
  useEffect(() => { if (restoreScroll && sources) { restoreScroll.done(); } }, [restoreScroll,sources]);
  const browse = useCallback((state:{sort:'impact'|'kind';expandedIds:string[]}) => onBrowseStateChange?.({...browseState,...state}), [browseState,onBrowseStateChange]);
  const investment = preview && selected && preview.fromSnapshotId === selected.pair.fromSnapshotId && preview.toSnapshotId === selected.pair.toSnapshotId ? preview.result : null;
  const frozen = blocked || busy || !!pending;
  const verifyOriginal = async () => { await verify(); if (!storedPending()) setReceiptResolutionVersion(n => n+1); };
  const records = (tab:'income'|'expenses') => { if (selected) onRecords({page:'records',tab,period}); };
  const metric = (label:string,cents:string|null,note:string,signed=false) => <article><span>{label}</span><strong>{cents === null ? t('还需补充资料') : signed ? changeText(cents) : money(cents)}</strong><em>{note}</em></article>;
  return <div ref={page} className="stats-section wealth-section planning-section finance-review" aria-label={t('财务复盘')}>
    <HeaderSlot target="page-header-tabs"><div className="page-tabs" role="group" aria-label={t('复盘视图')}>{([['period','本期复盘'],['compare','盘点比较'],['annual','区间回顾']] as const).filter(([v])=>v!=='compare'||route.view==='compare').map(([v,l])=><button key={v} type="button" aria-pressed={route.view===v} disabled={frozen || childEditing} onClick={()=>onRouteChange(v === 'period' ? {page:'review',view:'period',toSnapshotId:route.toSnapshotId} : {page:'review',view:v})}>{l}</button>)}</div></HeaderSlot>
    {pending && <div className="notice" role="status">{t('上次「{label}」的保存结果未确认。', { label: pending.label })}{pending.command === 'financial_import_commit' ? <span>{t('请到设置的数据管理核对金融导入回执。')}</span> : <button disabled={busy} onClick={()=>void verifyOriginal()}>{t('核对结果')}</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {route.view === 'annual' ? <AnnualReview key={generation} generation={generation} today={today} modules={modules} onViewTrend={onViewTrend}/> : facts.load.status === 'loading' ? <p role="status">{t('正在读取财务事实…')}</p> : facts.load.status === 'error' ? <p role="alert">{facts.load.message}<button onClick={facts.reload}>{t('重新读取')}</button></p> : sources && <>
      {sources.wealth.status !== 'ready' || sources.accounts.status !== 'ready' ? <article className="ui-card ui-content"><p>{sources.wealth.status === 'error' ? sources.wealth.message : sources.wealth.status === 'disabled' ? sources.wealth.reason : sources.accounts.status === 'error' ? sources.accounts.message : t('账户与盘点暂不可用')}</p><button onClick={facts.reload}>{t('重新读取')}</button></article> : <>
        <label>{t('账户显示范围')} <select value={browseState.accountView ?? 'active'} onChange={e=>onBrowseStateChange?.({...browseState,accountView:e.target.value as 'active'|'closed'|'all'})}><option value="active">{t('使用中')}</option><option value="closed">{t('已停用')}</option><option value="all">{t('全部')}</option></select></label>
        {route.view === 'compare' ? <WealthChanges summary={sources.wealth.value} accounts={sources.accounts.value} accountView={browseState.accountView ?? 'active'} today={today} onNewAccount={onNewAccount} onCheckIn={onCheckIn} controlledRange={route.pair ? {from:route.pair.fromSnapshotId,to:route.pair.toSnapshotId}:undefined} onRangeChange={pair=>onRouteChange({...route,pair:{fromSnapshotId:pair.from,toSnapshotId:pair.to}})} initialSort={browseState.sort} initialExpanded={browseState.expandedIds} onBrowseStateChange={browse}/> : <>
          {sources.asset_review.status !== 'ready' ? <p role="alert">{sources.asset_review.status === 'error' ? sources.asset_review.message : sources.asset_review.reason}<button onClick={facts.reload}>{t('重新读取')}</button></p> : !selected ? <article className="ui-card ui-content"><h3>{invalidSelection ? t('所选本期区间已失效') : !sources.accounts.value.length ? t('先建立要定期盘点的账户') : t('完成两次完整盘点后开始复盘')}</h3><p>{firstSnapshotOnly ? t('已完成第一期完整盘点。再完成一期不同日期的完整盘点，就能查看两期之间的变化。') : t('本期复盘只使用相邻完整盘点。任意端点可在盘点比较查看。')}</p>{!sources.accounts.value.length ? <button disabled={frozen} onClick={onNewAccount}>{t('新增账户')}</button> : <button disabled={frozen} onClick={()=>onCheckIn(today)}>{t('开始盘点')}</button>}<button onClick={()=>onRouteChange({page:'review',view:'period'})}>{t('查看最新区间')}</button><button onClick={()=>onRouteChange({...route,view:'compare'})}>{t('盘点比较')}</button></article> : <>
            <article className="ui-card ui-content"><label>{t('本期区间')} <select disabled={frozen || childEditing} value={selected.pair.toSnapshotId} onChange={e=>onRouteChange({page:'review',view:'period',toSnapshotId:e.target.value})}>{sources.asset_review.value.intervals.map(i=><option key={i.snapshot_id} value={i.snapshot_id}>{i.from} → {i.to}</option>)}</select></label><p className="muted small">{t('本期记录不含期初盘点日，包含期末当日。')}<button type="button" className="ui-link" disabled={frozen || childEditing} onClick={()=>onRouteChange({page:'review',view:'compare',pair:{fromSnapshotId:selected.pair.fromSnapshotId,toSnapshotId:selected.pair.toSnapshotId}})}>{t('比较其他两次盘点 →')}</button></p></article>
            {!periodReady ? <p role={current.load.status === 'loading' ? 'status' : 'alert'}>{current.load.status === 'loading' ? t('正在读取同一区间的财务事实…') : current.load.status === 'error' ? current.load.message : t('盘点区间已变化，请重新读取本期。')}<button onClick={reload}>{t('重新读取')}</button></p> : <>
            <div className="ui-metrics ui-card">
              {metric('金融净资产变化',selected.interval.delta_nw_cents,selected.interval.status === 'scope_changed' ? '参与比较的账户有变化，本期暂不可比' : '来自两次完整盘点',true)}
              {metric('已记录收入',periodSources ? incomeMetric(periodSources.incomes).cents : null,periodSources ? incomeMetric(periodSources.incomes).note : '正在读取本期收入')}
              {metric('已记录重要支出（退款前）',periodSources ? expenseMetric(periodSources.expenses).cents : null,periodSources ? expenseMetric(periodSources.expenses).note : '正在读取本期支出')}
              {metric('投资损益',investment?.status === 'ready' ? investment.value.profit_cents : null,investment?.status === 'ready' ? '原生核对结果；现金收入不重复计入' : '须同一区间、同一投资范围完成核对',true)}
            </div>
            <WealthChanges summary={sources.wealth.value} accounts={sources.accounts.value} accountView={browseState.accountView ?? 'active'} controlledRange={{from:selected.pair.fromSnapshotId,to:selected.pair.toSnapshotId}} hideControls today={today} onNewAccount={onNewAccount} onCheckIn={onCheckIn} initialSort={browseState.sort} initialExpanded={browseState.expandedIds} onBrowseStateChange={browse}/>
            <article className="ui-card ui-content"><h3>{t('收支来源')}</h3><p className="muted">{t('已记录收入与重要支出用于解释变化，不能推算真实结余；转账不作为收入或消费。')}</p>
              {current.load.status === 'error' ? <p role="alert">{current.load.message}<button onClick={current.reload}>{t('重新读取')}</button></p> : !periodSources ? <p role="status">{t('正在读取本期来源…')}</p> : <>
                <h4>{t('已记录到账')}</h4>{periodSources.incomes.status !== 'ready' ? <p>{incomeMetric(periodSources.incomes).note}<button onClick={current.reload}>{t('重新读取')}</button></p> : <>{!periodSources.incomes.value.length ? <p>{t('尚未记录收入。')}</p> : <ListPagination key={`${selected.pair.fromSnapshotId}:${selected.pair.toSnapshotId}:income`} rows={periodSources.incomes.value} label={t('本期收入')} render={i=><li key={i.id}><button onClick={()=>onOpenSource({kind:'income',id:i.id})}>{i.fields.date} · {incomeCategories[i.fields.category ?? 'unclassified']} · {money(i.fields.net_cents)}</button>{i.fields.hpf_cents === null ? t(' · 公积金待补') : t(' · 公积金 {v1}', { v1: money(i.fields.hpf_cents) })}</li>}/>}</>}
                <button disabled={frozen || !modules.incomes} onClick={()=>records('income')}>{t('查看／补记本期收入')}</button>
                <h4>{t('重要支出与回收')}</h4>{periodSources.expenses.status !== 'ready' ? <p>{expenseMetric(periodSources.expenses).note}<button onClick={current.reload}>{t('重新读取')}</button></p> : <><p>{t('退款 {v1} · 售出回收 {v2}', { v1: money(periodSources.expenses.value.refund_cents), v2: money(periodSources.expenses.value.sale_cents) })}</p><ListPagination key={`${selected.pair.fromSnapshotId}:${selected.pair.toSnapshotId}:expense`} rows={periodSources.expenses.value.lines} label={t('本期重要支出')} render={(line,index)=>{const target=expenseSourceTarget(line);return <li key={`${line.source}-${line.id}-${index}`}><button disabled={!target} onClick={()=>target && onOpenSource(target)}>{line.date} · {sourceLabel[line.source]} · {line.title} · {line.amount_cents === null ? t('金额待补') : money(line.amount_cents)}</button></li>;}}/>{!!periodSources.expenses.value.undated.length && <p>{t('另有 {length} 笔日期待补，未计入本期。', { length: periodSources.expenses.value.undated.length })}</p>}</>}
                <button disabled={frozen || !modules.expenses} onClick={()=>records('expenses')}>{t('查看／补记本期重要支出')}</button>
              </>}
            </article>
            <InvestmentReviewHost key={`${generation}:${selected.pair.fromSnapshotId}:${selected.pair.toSnapshotId}`} generation={generation} fromSnapshotId={selected.pair.fromSnapshotId} toSnapshotId={selected.pair.toSnapshotId} writeVersion={sources.write_version} incomes={periodSources?.incomes.status === 'ready' ? periodSources.incomes.value : null} accountNames={Object.fromEntries(sources.accounts.value.map(a=>[a.id,a.fields.name]))} blocked={frozen} reload={reload} onPending={()=>setPending(storedPending())} onEditingChange={setChildEditing} followupPort={followupPort ?? nativePort} today={today} movementPresentation="review" movementsEnabled={modules.movements && modules.wealth} onViewAllMovements={(period,ids)=>onRecords({page:'records',tab:'movements',period,movementAccountIds:ids})} receiptResolutionVersion={receiptResolutionVersion} pendingReceipt={!!pending} onPreviewChange={setPreview}/>
            <details><summary>{t('历史参考与依据')}</summary><p>{t('本期金额基于盘点和已记录事实；历史估计不充当本期结果。')}</p>{sources.history.status === 'error' ? <p>{sources.history.message}<button onClick={facts.reload}>{t('重新读取')}</button></p> : sources.history.status === 'disabled' ? <p>{sources.history.reason}</p> : <><p>{t('历史有效样本 {count} 期；仅作历史估计。', { count: sources.history.value.stats.count })}</p><p>{t('每月估计现金存下（中位数）：')}{sources.history.value.stats.count < HISTORY_MIN_INTERVALS ? t('样本不足') : sources.history.value.stats.median_monthly_cash_saving_cents == null ? t('待补充') : money(sources.history.value.stats.median_monthly_cash_saving_cents)} {t('· 每月推算现金花销（中位数）：')}{(sources.history.value.stats.spend_count ?? sources.history.value.stats.count) < HISTORY_MIN_INTERVALS ? t('样本不足') : sources.history.value.stats.median_monthly_cash_spend_cents == null ? t('待补充') : BigInt(sources.history.value.stats.median_monthly_cash_spend_cents) < 0n ? t('收入可能没记全，补齐后可查看这项估计') : money(sources.history.value.stats.median_monthly_cash_spend_cents)}</p></>}<button disabled={!modules.planning} onClick={onGoals}>{t('查看目标')}</button></details>
            </>}
          </>}
        </>}
      </>}
    </>}
  </div>;
}
