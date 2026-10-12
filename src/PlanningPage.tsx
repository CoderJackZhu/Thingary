import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { Info, Segments } from './FormControls';
import { IncomeDialog } from './IncomeDialog';
import { IncomeRecords } from './IncomeRecords';
import { HeaderSlot } from './HeaderSlot';
import { PlanningReviewSummary } from './PlanningReviewSummary';
import type { ReviewAction } from './review-observations';
import type { PlanningSources } from './plan';
import type { Summary } from './wealth';
import { PlanningBasicGoals } from './PlanningBasicGoals';
import { PlanningSetupDialog } from './PlanningSetup';
import { FollowupSection } from './planning-followup-ui/FollowupSection';
import { nativePlanningFollowupPortV1 } from './planning-followup-port';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import './planning-followup-ui/planning-followup-ui.css';
import { usePlanningSources } from './planning-basic-data';
import { modeOf } from './planning-basic-view';
import { ready } from './review';
import { HISTORY_MIN_INTERVALS, SAVING_BASIS_CAVEAT } from './planning-basic-defaults';
import { cashTotals, monthly } from './plan';
/** 结余超过已记录收入时，推算花销为负没有意义，通常是收入没记全或有一次性进账。 */
const NEGATIVE_SPEND = '暂时算不出：存下的比记录的收入还多，收入可能没记全';
import { FinancialImportDialog } from './FinancialImportDialog';
import { latestHpf, hpfSummary, reasonIsInflow, reasonSourceLabel, statusText } from './plan';
import type { Income, IncomeList, Interval, Mark, PlanReview, Reasons } from './plan';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useRestored } from './undo';
import { storedPending, submit } from './wealth';
import { usePendingReceipt } from './WealthPage';
import './wealth.css';
import './planning.css';

const dateRange = (i: Interval) => `${i.from} → ${i.to}`;

export type PlanningTab = 'goals' | 'savings';
export const planningTabs: [PlanningTab, string][] = [['goals', '目标'], ['savings', '收入与复盘']];

export function PlanningPage({ today, tab, onTab, onEditingChange, focus = null, onFocusDone, reviewSnapshotId, onReviewFocusDone, onGotoWealth, followupPort: injectedPort }: { reviewSnapshotId?: string | null; onReviewFocusDone?: () => void; onGotoWealth?: (action: ReviewAction) => void; focus?: 'budget' | 'profile' | null; onFocusDone: () => void; today: string; tab: PlanningTab; onTab: (tab: PlanningTab) => void; onEditingChange: (value: boolean) => void; followupPort?: PlanningFollowupPortV1 }) {
  const nativePort = useMemo(() => nativePlanningFollowupPortV1(), []);
  const followupPort = injectedPort ?? nativePort;
  const { load, reload } = usePlanningSources(today);
  const [editing, setEditing] = useState<Income | 'new' | null>(null), [setup, setSetup] = useState<{ step: number; editMode: boolean; completionId?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [goalEditing, setGoalEditing] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [view, setView] = useState<'review' | 'income'>('review');
  const [selected, setSelected] = useState<string | null>(null);
  const [marking, setMarking] = useState(false), [markError, setMarkError] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!pending || busy || marking || !!setup || reviewEditing || goalEditing || importing); return () => onEditingChange(false); }, [editing, pending, busy, marking, setup, reviewEditing, goalEditing, importing, onEditingChange]);

  const sources = load.status === 'ready' ? load.sources : null;
  const saved = sources && sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const mode = modeOf(saved);
  const review = sources ? ready(sources.review) : undefined, incomeRows = sources ? ready(sources.incomes) : undefined;
  const incomes: IncomeList | null = sources && incomeRows ? { generation: sources.generation, rows: incomeRows } : null;
  const newest = review ? [...review.intervals].reverse() : [];
  const targetSnapshot = reviewSnapshotId ?? selected;
  const shown = targetSnapshot ? newest.find(i => i.snapshot_id === targetSnapshot) ?? null : newest[0] ?? null;

  useEffect(() => {
    if (!reviewSnapshotId || !review) return;
    setView('review'); setSelected(reviewSnapshotId); onReviewFocusDone?.();
  }, [reviewSnapshotId, review, onReviewFocusDone]);
  const action = (a: ReviewAction) => { if (a.kind === 'income') setEditing('new'); else if (a.kind === 'plan') onTab('goals'); else onGotoWealth?.(a); };
  const openNew = { label: '记一笔收入', plus: true, disabled: !!pending || !incomes, run: () => { onTab('savings'); setView('income'); setEditing('new'); } };
  usePageBar('planning', { primary: openNew, newRecord: openNew });
  // WebKit does not focus a button on click, so the caller passes the clicked element; the heading is the last resort.
  const openSetup = (step = 0, from?: HTMLElement | null, editMode = false, completionId?: string) => { opener.current = from ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null); setSetup({ step, completionId, editMode: editMode || step >= 4 }); };
  const closeSetup = (ok: boolean) => { setSetup(null); setPending(storedPending()); if (ok) reload(); requestAnimationFrame(() => { const back = opener.current?.isConnected ? opener.current : document.getElementById('plan-budget-entry'); if (back) back.focus(); else refocusHeading(); }); };

  async function mark(interval: Interval) {
    if (!review) return;
    const input: Mark = { request_id: crypto.randomUUID(), generation: review.generation, snapshot_id: interval.snapshot_id, excluded: !interval.excluded };
    setMarking(true); setMarkError('');
    try { await submit({ command: 'plan_baseline_mark', input, label: '一次性变动标记' }); reload(); }
    catch (e) { setMarkError(e instanceof Error ? e.message : errorMessage(e)); setPending(storedPending()); }
    finally { setMarking(false); }
  }
  const onPending = useCallback(() => setPending(storedPending()), [setPending]);
  const reviewError = sources && sources.review.status === 'error' ? (sources.review.value.code === 'MODULE_DISABLED' ? '资产与盘点已关闭，历史复盘暂不可用；仍可记录实际收入。' : `历史复盘读取失败：${sources.review.value.message}`) : '';

  return <section className="stats-section wealth-section planning-section" aria-label="规划">
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <HeaderSlot><div className="wealth-toolbar">
      {tab === 'savings' && view === 'income' && <button className="ui-btn" disabled={!incomes || !!pending} onClick={() => setImporting(true)}>导入收入历史…</button>}
      <Info text={tab === 'goals' ? '按你的条件，估算为目标月份每月需要准备多少资金。都是估算，条件随时可以改。' : '资产涨了，不一定都是存下来的钱，也可能是投资涨跌。收入只展示已记录的金额。'}/>
    </div></HeaderSlot>
    {load.status === 'error' ? <article className="ui-card ui-content" role="alert"><p>规划读取失败：{load.message}</p><button onClick={reload}>重新读取</button></article>
      : !sources ? <p role="status" className="muted">正在读取规划…</p>
      : tab === 'goals' ? <PlanningBasicGoals key={sources.generation + ":" + sources.write_version} sources={sources} mode={mode} today={today} reload={reload} onPending={onPending} onEditingChange={setGoalEditing} onGoto={onTab} openSetup={openSetup} focus={focus === 'budget'} onFocusDone={onFocusDone} assumptionsPort={followupPort}/>
      : <>
        <div className="review-navigation">
          <Segments label="收入与复盘视图" value={view} options={[{ value: 'review', label: '复盘' }, { value: 'income', label: '收入记录' }]} disabled={!!pending || reviewEditing || marking} onChange={setView}/>
          <p className="muted small">{view === 'review' ? '每次盘点后，看看钱发生了什么变化。' : '持续记录实际到账；预期的养老金等收入在目标中维护。'}</p>
        </div>
        {view === 'review' ? <>
          {review ? <>
            {newest.length > 0 && <label className="review-period-picker">盘点区间 <select aria-label="选择复盘区间" value={shown?.snapshot_id ?? ''} disabled={!!pending || reviewEditing || marking} onChange={e => setSelected(e.target.value)}>{!shown && <option value="">原区间已不可用，请重新选择</option>}{newest.map(i => <option key={i.snapshot_id} value={i.snapshot_id}>{dateRange(i)}</option>)}</select><span className="muted small">{shown ? `${shown.days} 天 · 两次完整盘点之间` : ''}</span></label>}
            {shown ? <ReviewPeriod key={sources.generation + ":" + shown.snapshot_id + ":" + sources.write_version} interval={shown} sources={sources} today={today} reload={reload} onPending={onPending} onEditingChange={setReviewEditing} onAction={action} busy={marking || !!pending} markError={markError} onMark={() => void mark(shown)} followupPort={followupPort}/>
                  : <div className="empty"><h2>还没有可比较的盘点区间</h2><p>至少完成两次完整盘点后，就能查看这段时间的变化。现在也可以先记录收入。</p><button className="ui-btn" onClick={() => onGotoWealth?.({ kind: 'accounts' })}>去账户与盘点</button>
                    {followupPort && sources && <FollowupSection port={followupPort} generation={sources.generation} pair={null} writeVersion={sources.write_version} today={today} blocked={!!pending || marking} onPending={onPending} onEditingChange={setReviewEditing} onSaved={reload}/>}</div>}
            <details className="plan-explanation"><summary>历史参考与全部区间</summary><Usual review={review}/>{newest.length > 0 && <Intervals intervals={newest} selected={shown?.snapshot_id ?? null} onSelect={setSelected}/>}</details>
          </> : <article className="ui-card ui-content" role="status"><p>{reviewError || '正在读取复盘…'}</p>{sources.modules.wealth && <button onClick={reload}>重新读取</button>}</article>}
        </> : incomes ? <IncomeRecords incomes={incomes} onOpen={setEditing} onNew={() => setEditing('new')} disabled={!!pending}/> : <article className="ui-card ui-content" role="alert"><p>收入记录读取失败。</p><button onClick={reload}>重新读取</button></article>}
      </>}
    {setup && sources && <PlanningSetupDialog key={sources.generation} completionId={setup.completionId} sources={sources} snapshot={ready(sources.snapshot) ?? null} accounts={ready(sources.accounts) ?? []} today={today} reload={reload} onPending={onPending} onClose={ok => { closeSetup(ok); if (ok) onTab('goals'); }} initialStep={setup.step} editMode={setup.editMode} assumptionsPort={followupPort}/>}
    {importing && incomes && <FinancialImportDialog mode="incomes" generation={incomes.generation} onClose={saved => { setImporting(false); setPending(storedPending()); if (saved) reload(); refocusHeading(); }}/>}
    {editing && incomes && <IncomeDialog income={editing === 'new' ? null : editing} generation={incomes.generation} today={today} accounts={sources ? ready(sources.accounts) ?? [] : []} hpfDefault={latestHpf(incomes.rows)} onClose={saved => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(null); setPending(storedPending()); if (saved) reload(); refocusHeading(); }}/>}
  </section>;
}

function Usual({ review }: { review: PlanReview }) {
  const s = review.stats, m = (v: string | null | undefined) => v == null ? '—' : money(v);
  const estimate = (v: string | null | undefined, count: number) => count < HISTORY_MIN_INTERVALS ? '区间太少，暂不给出' : v == null ? '暂时算不出：缺少可用的区间金额' : money(v);
  return <><div className="ui-metrics ui-card" aria-label="历史资产参考">
    <article><span>月均净资产变化（含估值变化）</span><strong>{m(s.mean_monthly_change_cents)}</strong></article>
    <article><span>历史中位数（含估值变化）</span><strong>{m(s.median_monthly_change_cents)}</strong></article>
    <article><span>每月估计存下（中位数）</span><strong>{estimate(s.median_monthly_cash_saving_cents, s.count)}</strong></article>
    <article><span>每月推算花销（中位数）</span><strong>{s.median_monthly_cash_spend_cents != null && BigInt(s.median_monthly_cash_spend_cents) < 0n && (s.spend_count ?? s.count) >= HISTORY_MIN_INTERVALS ? NEGATIVE_SPEND : estimate(s.median_monthly_cash_spend_cents, s.spend_count ?? s.count)}</strong></article>
    <article><span>最近完整盘点</span><strong>{s.latest_date ?? '待补充'}</strong></article>
  </div><p className="muted small">取近 12 个月里前后都是完整盘点的区间：平均值按天数加权，中位数每个区间算一次。{SAVING_BASIS_CAVEAT}</p></>;
}

function ReviewPeriod({ interval, sources, today, reload, onPending, onEditingChange, onAction, followupPort, ...steps }: { interval: Interval; sources: PlanningSources; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; onAction: (a: ReviewAction) => void; followupPort?: PlanningFollowupPortV1; busy: boolean; markError: string; onMark: () => void }) {
  const [reasons, setReasons] = useState<Reasons | null>(null), [reasonError, setReasonError] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null), [summaryError, setSummaryError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setReasons(null); setReasonError(''); setSummary(null); setSummaryError('');
    if (!sources.modules.wealth) return;
    invoke<Reasons>('plan_interval_reasons', { snapshotId: interval.snapshot_id })
      .then(r => { if (live) { if (r.generation !== sources.generation || r.snapshot_id !== interval.snapshot_id) setReasonError('资料已变化，请重试。'); else setReasons(r); } }).catch(e => { if (live) setReasonError(errorMessage(e)); });
    invoke<Summary>('wealth_summary').then(r => { if (live) { if (r.generation !== sources.generation) setSummaryError('资料已变化，请重试。'); else setSummary(r); } }).catch(e => { if (live) setSummaryError(errorMessage(e)); });
    return () => { live = false; };
  }, [interval.snapshot_id, sources.generation, sources.write_version, sources.modules.wealth, retry]);
  return <><PlanningReviewSummary interval={interval} reasons={reasons} reasonError={reasonError} summary={summary} summaryError={summaryError} sources={sources} today={today} reload={reload} onPending={onPending} onEditingChange={onEditingChange} onAction={onAction} blocked={steps.busy} onRetry={() => setRetry(n => n + 1)} followupPort={followupPort}/><details className="ui-card ui-content"><summary>查看付款记录与历史估计</summary><Steps interval={interval} {...steps} reasons={reasons} reasonError={reasonError}/></details></>;
}

/** The observations and the existing reason table share one guarded read. */
function Steps({ interval: i, busy, markError, onMark, reasons, reasonError }: { interval: Interval; busy: boolean; markError: string; onMark: () => void; reasons: Reasons | null; reasonError: string }) {
  const ok = i.delta_nw_cents !== null;
  const unavailable = i.legacy_estimate_unavailable ? '此区间暂不提供旧口径估计' : i.status === 'scope_changed' ? '暂时算不出：账户范围变化' : i.status === 'no_income' ? '暂时算不出：这一期没有收入记录' : null;
  const period = (total: string | null, perMonth: string | null | undefined) => total == null || perMonth == null ? '暂时算不出：缺少可用的区间金额' : <>{money(total)}<small className="muted"> · 约每月 {money(perMonth)}</small></>;
  const market = i.market_change_cents;
  const { saving, spend } = cashTotals(i);
  return <article className="ui-card ui-content plan-steps" aria-label="这一期的复盘">
    <div className="ui-section-head"><h3>{dateRange(i)}</h3><span>{i.days} 天 · 两次完整盘点之间</span></div>
    <section aria-labelledby="plan-step-1"><h4 id="plan-step-1">现状</h4>
      {ok ? <dl className="plan-facts">
        <div><dt>净资产变化</dt><dd>{money(i.delta_nw_cents)}</dd></div>
        <div><dt>已记录到账收入</dt><dd>{money(i.income_cents)}</dd></div>
        <div><dt>已记录公积金缴存</dt><dd>{hpfSummary(i.hpf_cents, i.hpf_known_cents ?? null, i.hpf_unknown_records ?? 0, money)}</dd></div>
        <div><dt>公积金账户变化</dt><dd>{money(i.hpf_change_cents)}</dd></div>
      </dl> : <p className="muted">{statusText[i.status]}；已记录收入 {money(i.income_cents)}，公积金缴存 {hpfSummary(i.hpf_cents, i.hpf_known_cents ?? null, i.hpf_unknown_records ?? 0, money)}。</p>}
      <dl className="plan-facts">
        <div><dt>估计存下</dt><dd>{unavailable ?? period(saving, i.monthly_cash_saving_cents)}</dd></div>
        <div><dt>推算花销</dt><dd>{unavailable ?? (spend === null && (i.hpf_unknown_records ?? 0) > 0 ? '暂时算不出：有缴存金额未知' : spend !== null && BigInt(spend) < 0n ? NEGATIVE_SPEND : period(spend, i.monthly_cash_spend_cents))}</dd></div>
        <div><dt>投资账户变化 <small>含转入和涨跌</small></dt><dd>{unavailable ?? (market == null ? '没有投资账户' : period(market, monthly(BigInt(market), i.days).toString()))}</dd></div>
      </dl>
      <p className="muted small">{SAVING_BASIS_CAVEAT}</p>
    </section>
    <section aria-labelledby="plan-step-2"><h4 id="plan-step-2">变化</h4>
      {ok ? <>
        <p>本期金融净资产变化 {money(i.delta_nw_cents)}（含估值变化）。</p>
        <button type="button" className="ui-btn" disabled={busy} onClick={onMark}>{i.excluded ? '取消「一次性变动」标记' : '标记为一次性变动（不计入历史参考）'}</button>
        {markError && <p className="error" role="alert">{markError}</p>}
      </> : <p className="muted">—</p>}
    </section>
    <section aria-labelledby="plan-step-3"><h4 id="plan-step-3">原因</h4>
      {reasonError ? <p className="error" role="alert">读取失败：{reasonError}</p> : !reasons ? <p className="muted" role="status">正在读取…</p> : <>
        <p>{reasons.notes.trim() ? <><span className="muted">这次盘点备注：</span>{reasons.notes}</> : <span className="muted">这次盘点没有备注。</span>}</p>
        {reasons.lines.length ? <table className="ui-table plan-reasons"><thead><tr><th>日期</th><th>来源</th><th>名称</th><th className="amount">金额</th></tr></thead>
          <tbody>{reasons.lines.map(l => <tr key={l.source + l.id}><td>{l.date}</td><td><span className="ui-tag">{reasonSourceLabel[l.source] ?? l.source}</span></td><td>{l.title}</td><td className="amount">{l.amount_cents === null ? <span className="muted">金额未知</span> : money(reasonIsInflow(l) ? '-' + l.amount_cents : l.amount_cents)}</td></tr>)}</tbody></table>
          : <p className="muted">这段时间没有已记录的物品购入、重要支出或周期付款。</p>}
        <p className="muted small">这些记录只用于解释，不会调整上面的数字。</p>
      </>}
    </section>
  </article>;
}

function Intervals({ intervals, selected, onSelect }: { intervals: Interval[]; selected: string | null; onSelect: (id: string) => void }) {
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>各区间</h3><span>点一行查看复盘</span></div>
    <table className="ui-table plan-intervals"><thead><tr><th>期间</th><th className="amount">税后到账</th><th className="amount">金融净资产变化</th><th>覆盖</th><th>说明</th></tr></thead>
      <tbody>{intervals.map(i => <tr key={i.snapshot_id} className={i.snapshot_id === selected ? 'selected' : i.excluded || i.status !== 'ok' ? 'closed' : undefined}>
        <td><button className="link-cell" aria-pressed={i.snapshot_id === selected} onClick={() => onSelect(i.snapshot_id)}>{dateRange(i)}</button><small className="muted"> {i.days} 天</small></td>
        <td className="amount">{i.status === 'ok' || i.status === 'scope_changed' ? money(i.income_cents) : <span className="muted">—</span>}</td>
        <td className="amount">{money(i.delta_nw_cents)}</td><td>收入可能没记全</td>
        <td>{i.status !== 'ok' && <span className="ui-tag">{statusText[i.status]}</span>}{i.excluded && <span className="ui-tag">一次性变动</span>}{i.income_possibly_missing && i.status === 'ok' && <span className="ui-tag">可能漏记收入</span>}</td>
      </tr>)}</tbody></table></article>;
}
