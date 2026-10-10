import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './asset';
import type { Account, Snapshot } from './wealth';
import type { PlanningAnnotation, PlanningMissing, PlanningSources, StoredLifeEvent } from './plan';
import type { Occurrence } from './plan-core';
import { CoverageNote } from './CoverageNote';
import { actionableAnnotations } from './plan-annotations';
import { PlanningPensionRefinementDialog, PensionComparisonNote } from './PlanningPensionRefinement';
import type { PensionComparison } from './planning-pension-refinement';
import { PlanningDebtDialog } from './PlanningDebtDialog';
import { retractOccurrence } from './plan-occurrence-actions';
import { CapabilityNotice } from './PlanningRequirement';
import { RunwayCard } from './PlanningRunway';
import { PlanningCareerCard } from './PlanningCareerCard';
import { PlanningBasicDetail } from './PlanningBasicDetail';
import { PlanningEvents } from './PlanningEvents';
import type { EventsStore } from './PlanningEvents';
import { PlanningWishes } from './PlanningWishes';
import { PlanningOccurrenceDialog } from './PlanningOccurrenceDialog';
import { CostsDialog } from './PlanningCosts';
import { FundsDialog } from './PlanningFunds';
import { PlanningRefinements } from './PlanningRefinements';
import { buildRetireCalc } from './plan-retire-calc';
import { ready } from './review';
import { eventsInput } from './planning-basic-forms';
import { useCapabilities, useSectionSaver } from './planning-basic-data';
import { needsContribution, requirementLine, SAVE_CONTRIBUTION_HINT } from './planning-basic-view';
import type { PlanMode } from './planning-basic-view';
import { conditionChips, goalState, moreToolsBadges, questionProgress, questions, refinementCards } from './planning-first-run';
import type { Refinement } from './planning-first-run';
import './planning.css';

/** Goal states are a presentation projection; current calculation gates remain unchanged. */
export function PlanningBasicGoals({ sources, mode: _mode, today, reload, onPending, onEditingChange, onGoto, openSetup, comparison, onPensionComparison, focus = false, onFocusDone }: { sources: PlanningSources; mode: PlanMode; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; onGoto: (tab: 'savings' | 'pension') => void; openSetup: (step?: number, from?: HTMLElement | null, editMode?: boolean) => void; comparison?: PensionComparison | null; onPensionComparison?: (c: PensionComparison) => void; focus?: boolean; onFocusDone: () => void }) {
  const [fundsOpen, setFundsOpen] = useState(false), [costsOpen, setCostsOpen] = useState(false), [occurring, setOccurring] = useState<StoredLifeEvent | null>(null);
  const [pensionContributions, setPensionContributions] = useState(false);
  const [pensionOpen, setPensionOpen] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  const [detail, setDetail] = useState(false), [toolsOpen, setToolsOpen] = useState(false), opener = useRef<HTMLElement | null>(null);
  useEffect(() => { onEditingChange(fundsOpen || costsOpen || debtOpen || pensionOpen || occurring !== null); return () => onEditingChange(false); }, [fundsOpen, costsOpen, debtOpen, pensionOpen, occurring, onEditingChange]);
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const snapshot: Snapshot | null = ready(sources.snapshot) ?? null, accounts: Account[] = ready(sources.accounts) ?? [];
  const result = useCapabilities(sources), saver = useSectionSaver(sources, reload, onPending);
  const caps = result.status === 'ready' ? result.caps : null, pred = caps?.prediction.status === 'ready' ? caps.prediction.value : null;
  const state = goalState(saved, caps), progress = questionProgress(saved, caps);
  const debtLabels = Object.fromEntries((snapshot?.entries ?? []).filter(e => e.side === 'liability').map(e => [`debt:${e.account_id}`, { name: accounts.find(a => a.id === e.account_id)?.fields.name ?? '负债账户', balance: e.amount_cents === null ? '未知' : money(e.amount_cents) }]));
  const cards = saved && caps ? refinementCards(saved, caps, today, debtLabels) : [];
  const goEvents = () => { setDetail(false); setToolsOpen(true); requestAnimationFrame(() => { const el = document.getElementById('plan-events-section'); el?.scrollIntoView({ block: 'start' }); el?.focus(); }); };
  useEffect(() => { if (focus) { const entry = document.getElementById('plan-budget-entry'); if (entry) { entry.focus(); onFocusDone(); } } }, [focus, onFocusDone, saved]);
  const wishCalc = useMemo(() => saved && pred?.source === 'saved' ? buildRetireCalc(saved, snapshot, ready(sources.review) ?? null, ready(sources.incomes) ?? [], today, sources) : null, [saved, pred, snapshot, sources, today]);
  const events: EventsStore | null = saved && caps ? { retire: saved.profile.retire, snapshot, accounts, busy: saver.busy, stuck: saver.stuck, notice: saver.notice,
    ready: pred?.source === 'saved' ? { plan: pred.plan, plan0: pred.plan0 } : null, blocked: needsContribution(caps) ? SAVE_CONTRIBUTION_HINT : '资料待补齐',
    onContribution: needsContribution(caps) ? () => openSetup(4, null, true) : undefined,
    write: async (life_events, core) => !!core && !!(await saver.save(eventsInput({ life_events, occurrences: core.occurrences }))) } : null;
  const openPension = (contributions = false) => { setPensionContributions(contributions); setPensionOpen(true); };
  const owner = (o: PlanningMissing['owner'], field?: string) => { if (field === 'core.debt_repayments') setDebtOpen(true); else if (field?.includes('_costs')) setCostsOpen(true); else if (o === 'pension' || field === 'basic.pension_contributions') openPension(field === 'basic.pension_contributions'); else if (o === 'events') goEvents(); else if (o === 'service') reload(); else openSetup(o === 'funds' ? 2 : 0, null, true); };
  const closeRefinement = () => { setFundsOpen(false); setCostsOpen(false); setDebtOpen(false); setPensionOpen(false); setOccurring(null); requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); else document.getElementById('plan-budget-entry')?.focus(); }); };
  function action(card: Refinement, from: HTMLElement) {
    opener.current = from;
    if (card.action === 'pension') openPension(card.id === 'transfer');
    else if (card.action === 'debts') setDebtOpen(true);
    else if (card.action === 'costs') setCostsOpen(true);
    else if (card.action === 'funds') setFundsOpen(true);
    else if (card.action === 'events') goEvents();
    else if (card.action === 'event') setOccurring(card.event!);
    else if (card.action === 'contribution') openSetup(4, from, true);
    else if (card.action === 'setup') openSetup(card.step ?? 0, from, true);
    else reload();
  }
  function refineAnnotation(annotation: PlanningAnnotation) {
    if (annotation.refinement.owner === 'pension' || annotation.refinement.field === 'basic.pension_contributions') { openPension(annotation.refinement.field === 'basic.pension_contributions'); return; }
    const card = annotation.refinement.field === 'core.debt_repayments'
      ? cards.find(c => c.action === 'debts')
      : cards.find(c => c.event?.id === annotation.refinement.event_id || annotation.refinement.field.includes('_costs') && c.action === 'costs');
    if (card) action(card, document.getElementById('plan-budget-entry')!);
    else owner(annotation.refinement.owner, annotation.refinement.field);
  }
  async function saveOccurrence(o: Occurrence | null) {
    if (!saved?.profile.retire.core) return;
    const r = saved.profile.retire;
    if (await saver.save(eventsInput({ life_events: r.life_events, occurrences: o ? [...r.core!.occurrences.filter(x => x.event_id !== o.event_id), o] : retractOccurrence(r.core!.occurrences, r.core!.occurrences.find(x => x.event_id === occurring?.id)?.id ?? '') }))) closeRefinement();
  }
  if (sources.profile.status === 'error') return <article className="ui-card ui-content" role="alert"><p>规划资料读取失败：{sources.profile.value.message}</p><button onClick={reload}>重新读取</button></article>;
  if (detail && saved?.profile.retire.basic) return <PlanningBasicDetail sources={sources} saved={saved} today={today} reload={reload} onPending={onPending} onEditingChange={onEditingChange} openSetup={(step, from) => openSetup(step, from, true)} onGoto={onGoto} onEvents={goEvents} onBack={() => { setDetail(false); requestAnimationFrame(() => document.getElementById('plan-detail-entry')?.focus()); }}/>;
  const req = caps?.requirement.status === 'ready' ? caps.requirement.value : null;
  const line = req ? requirementLine(req.set, money) : null;
  return <div className="plan-goals" data-goal-state={state}>
    {pensionOpen && saved && <PlanningPensionRefinementDialog reviewContributions={pensionContributions} sources={sources} today={today} reload={reload} onPending={onPending} onSaved={onPensionComparison} onClose={closeRefinement}/>}
    {comparison && <PensionComparisonNote comparison={comparison}/>}
    {debtOpen && saved && <PlanningDebtDialog sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={closeRefinement}/>}
    {fundsOpen && saved && <FundsDialog sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={() => closeRefinement()}/>}
    {costsOpen && saved && <CostsDialog sources={sources} saved={saved} today={today} reload={reload} onPending={onPending} onClose={closeRefinement}/>}
    {occurring && saved && <PlanningOccurrenceDialog event={occurring} existing={saved.profile.retire.core?.occurrences.find(o => o.event_id === occurring.id)} snapshot={snapshot} accounts={accounts} today={today} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} onClose={closeRefinement} onSave={o => void saveOccurrence(o)}/>}
    <article className="ui-card ui-content plan-goal planning-first-result" aria-label="退休目标">
      {state === '0' ? <>
        <h3>想知道：要攒多少钱才够？</h3>
        <p className="planning-first-promise">回答 4 个问题，算出“想在 X 岁退休，每月大约要存多少钱”。</p><p className="muted">没想好的可以先留空，随时退出，不保存草稿。</p>
        <div className="plan-goal-actions"><button type="button" id="plan-budget-entry" className="primary" onClick={e => openSetup(0, e.currentTarget)}>开始（约 2 分钟）</button><button type="button" className="ui-link" onClick={() => onGoto('savings')}>先看收入与复盘</button></div>
      </> : state === '1' ? <>
        <h3>还差 {progress.remaining} 个问题，就能算出每月要存多少</h3>
        <div className="planning-question-checklist">{questions.map((q, i) => <p key={q}><span className="ui-tag">{progress.answered[i] ? '已回答' : '还需要'}</span><span>{q}</span></p>)}</div>
        <button type="button" id="plan-budget-entry" className="primary" onClick={e => openSetup(progress.first, e.currentTarget)}>继续回答</button>
      </> : <>
        {state === '2' && req && line ? <><p className="muted">如果想在 {req.target_month.slice(0, 4)} 年 {Number(req.target_month.slice(5, 7))} 月退休：</p><p className={`planning-result-number ${line.tone}`}><strong>{line.text}</strong></p><CoverageNote annotations={caps?.annotations} onRefine={refineAnnotation}/><p className="muted small">这是参考金额，不用填写，不保证未来一定够用。按今天的物价，准备支付生活费到 {req.horizon_month.slice(0, 4)} 年 {Number(req.horizon_month.slice(5, 7))} 月。</p></>
          : <><h3>还有 {cards.filter(c => c.required).length} 项需要确认，才能算出结果</h3><p className="muted">四个问题已回答。核对下面这些事项后，再按已保存的条件计算。</p></>}
        {saved && caps && <div className="planning-condition-chips" aria-label="计算条件">{conditionChips(saved, caps, money).map(chip => <button type="button" className={chip.prominent ? 'planning-chip prominent' : 'planning-chip'} key={chip.step} onClick={e => openSetup(chip.step, e.currentTarget, true)}>{chip.text}</button>)}<button type="button" id="plan-budget-entry" className="ui-link" onClick={e => openSetup(0, e.currentTarget, true)}>修改</button></div>}
        {state === '2' && <p><button type="button" id="plan-detail-entry" className="ui-link" onClick={() => setDetail(true)}>查看测算详情 ›</button></p>}
      </>}
    </article>
    {result.status !== 'ready' && <><CapabilityNotice result={result}/><button className="ui-btn" onClick={reload}>重新读取</button></>}
    {(state === '2' || state === '2b') && <>
      <PlanningRefinements cards={cards.filter(c => c.required)} blocked busy={saver.busy || saver.stuck} onAction={action}/>
      <PlanningRefinements cards={cards.filter(c => !c.required && c.impacts)} title={`影响结果的待核对项（${new Set(actionableAnnotations(caps?.annotations).flatMap(a => a.source_ids)).size} 项）`} busy={saver.busy || saver.stuck} onAction={action}/>
      <PlanningRefinements cards={cards.filter(c => !c.required && !c.impacts)} busy={saver.busy || saver.stuck} onAction={action}/>
      {snapshot && sources.modules.wealth && (snapshot.entries.some(e => e.counted && e.side === 'liability') || saved?.profile.retire.core?.debt_repayments?.length) && <p><button type="button" className="ui-link" disabled={saver.busy || saver.stuck} onClick={e => { opener.current = e.currentTarget; setDebtOpen(true); }}>查看或修改贷款还款安排</button></p>}
    </>}
    {(state === '2' || state === '2b') && <details className="ui-card ui-content planning-more-tools" open={toolsOpen} onToggle={e => setToolsOpen(e.currentTarget.open)}>
      <summary><strong>更多工具与试算</strong>{moreToolsBadges(saved).map(text => <span className="ui-tag" key={text}>{text}</span>)}<span className="planning-more-tools-hint muted small">查看资金能撑多久、职业变化试算，以及大额计划和心愿购买的影响。</span></summary>
      <div className="planning-more-tools-body">
        <RunwayCard caps={caps} today={today} onOwner={owner}/>
        {saved?.profile.retire.basic && caps && <PlanningCareerCard sources={sources} today={today}/>}
        {events && <div id="plan-events-section" tabIndex={-1}><PlanningEvents store={events} today={today} onEditingChange={onEditingChange}/></div>}
        <PlanningWishes calc={wishCalc} today={today} hint={caps && needsContribution(caps) ? SAVE_CONTRIBUTION_HINT : '退休资料待补齐'} onContribution={saved?.profile.retire.basic ? () => openSetup(4, null, true) : undefined}/>
      </div>
    </details>}
  </div>;
}
