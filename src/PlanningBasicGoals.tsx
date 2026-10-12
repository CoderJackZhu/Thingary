import { AssumptionsSummary } from './planning-followup-ui/AssumptionsSummary';
import { GoalOverview } from './planning-goal/Overview';
import type { GoalAction } from './planning-goal/Overview';
import { GoalEditor } from './planning-goal/Editor';
import type { GoalEdit } from './planning-goal/inputs';
import './planning-goal/goal.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './asset';
import type { Account, Snapshot } from './wealth';
import type { PlanningMissing, PlanningSources, StoredLifeEvent } from './plan';
import type { Occurrence } from './plan-core';
import { PlanningDebtDialog } from './PlanningDebtDialog';
import { retractOccurrence } from './plan-occurrence-actions';
import { CapabilityNotice } from './PlanningRequirement';
import { RunwayCard } from './PlanningRunway';
import { PlanningCareerCard } from './PlanningCareerCard';
import { PlanningBasicDetail } from './PlanningBasicDetail';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import { PlanningEvents } from './PlanningEvents';
import type { EventsStore } from './PlanningEvents';
import { PlanningWishes } from './PlanningWishes';
import { PlanningOccurrenceDialog } from './PlanningOccurrenceDialog';
import { CostsDialog } from './PlanningCosts';
import { FundsDialog } from './PlanningFunds';
import { PlanningRefinements } from './PlanningRefinements';
import { retireCalcFromCapabilities } from './plan-retire-calc';
import { ready } from './review';
import { eventsInput } from './planning-basic-forms';
import { useCapabilities, useSectionSaver } from './planning-basic-data';
import { needsContribution, SAVE_CONTRIBUTION_HINT } from './planning-basic-view';
import type { PlanMode } from './planning-basic-view';
import { goalState, moreToolsBadges, refinementCards } from './planning-first-run';
import type { Refinement } from './planning-first-run';
import './planning.css';

type GoalDialog =
  | { kind: 'single'; field: GoalEdit }
  | { kind: 'debt' | 'funds' | 'costs'; completion: boolean }
  | { kind: 'occurrence'; completion: boolean; event: StoredLifeEvent };

/** Goal states are a presentation projection; current calculation gates remain unchanged. */
export function PlanningBasicGoals({ sources, mode: _mode, today, reload, onPending, onEditingChange, onGoto, openSetup, focus = false, onFocusDone, assumptionsPort }: { sources: PlanningSources; mode: PlanMode; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; onGoto: (tab: 'savings') => void; openSetup: (step?: number, from?: HTMLElement | null, editMode?: boolean, completionId?: string) => void; focus?: boolean; onFocusDone: () => void; assumptionsPort?: PlanningFollowupPortV1 }) {
  const [dialog, setDialog] = useState<GoalDialog | null>(null);
  const [detail, setDetail] = useState(false), [toolsOpen, setToolsOpen] = useState(false), opener = useRef<HTMLElement | null>(null);
  const [assumptionEditing, setAssumptionEditing] = useState(false);
  const editing = dialog !== null || assumptionEditing;
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const snapshot: Snapshot | null = ready(sources.snapshot) ?? null, accounts: Account[] = ready(sources.accounts) ?? [];
  const result = useCapabilities(sources), saver = useSectionSaver(sources, reload, onPending);
  const caps = result.status === 'ready' ? result.caps : null, pred = caps?.prediction.status === 'ready' ? caps.prediction.value : null;
  const state = goalState(saved, caps);
  const debtLabels = Object.fromEntries((snapshot?.entries ?? []).filter(e => e.side === 'liability').map(e => [`debt:${e.account_id}`, { name: accounts.find(a => a.id === e.account_id)?.fields.name ?? '负债账户', balance: e.amount_cents === null ? '未知' : money(e.amount_cents) }]));
  const cards = saved && caps ? refinementCards(saved, caps, today, debtLabels) : [];
  const goEvents = () => { setDetail(false); setToolsOpen(true); requestAnimationFrame(() => { const el = document.getElementById('plan-events-section'); el?.scrollIntoView({ block: 'start' }); el?.focus(); }); };
  useEffect(() => { if (focus) { const entry = document.getElementById('plan-budget-entry'); if (entry) { entry.focus(); onFocusDone(); } } }, [focus, onFocusDone, saved]);
  const wishCalc = useMemo(() => saved && caps && pred?.source === 'saved'
    ? retireCalcFromCapabilities(saved, caps, today)
    : null, [saved, caps, pred, today]);
  const events: EventsStore | null = saved && caps ? { retire: saved.profile.retire, snapshot, accounts, busy: saver.busy, stuck: saver.stuck, notice: saver.notice,
    ready: pred?.source === 'saved' ? { plan: pred.plan, plan0: pred.plan0 } : null, blocked: needsContribution(caps) ? SAVE_CONTRIBUTION_HINT : '资料待补齐',
    onContribution: needsContribution(caps) ? () => openSetup(4, null, true) : undefined,
    write: async (life_events, core) => !!core && !!(await saver.save(eventsInput({ life_events, occurrences: core.occurrences }))) } : null;
  function openDialog(next: GoalDialog, from: HTMLElement | null = document.activeElement as HTMLElement | null) {
    opener.current = from;
    setDialog(next);
  }
  function closeRefinement() {
    const from = opener.current;
    opener.current = null;
    setDialog(null);
    requestAnimationFrame(() => {
      if (from?.isConnected) from.focus();
      else document.getElementById('plan-budget-entry')?.focus();
    });
  }
  function editGoal(field: GoalAction, from: HTMLElement) {
    if (field === 'income') openSetup(3, from, true);
    else if (field === 'funds' || field === 'costs') openDialog({ kind: field, completion: false }, from);
    else if (field === 'debt') openDialog({ kind: 'debt', completion: false }, from);
    else if (field === 'events') goEvents();
    else openDialog({ kind: 'single', field }, from);
  }
  function owner(o: PlanningMissing['owner'], field?: string) {
    if (field === 'core.debt_repayments') openDialog({ kind: 'debt', completion: false });
    else if (field?.includes('_costs')) openDialog({ kind: 'costs', completion: false });
    else if (o === 'events') goEvents();
    else if (o === 'service') reload();
    else openSetup(o === 'funds' ? 2 : 0, null, true);
  }
  function action(card: Refinement, from: HTMLElement | null) {
    if (card.action === 'debts') openDialog({ kind: 'debt', completion: true }, from);
    else if (card.action === 'costs' || card.action === 'funds') openDialog({ kind: card.action, completion: true }, from);
    else if (card.action === 'event' && card.event) openDialog({ kind: 'occurrence', completion: true, event: card.event }, from);
    else if (card.action === 'events') goEvents();
    else if (card.action === 'contribution') openDialog({ kind: 'single', field: 'saving' }, from);
    else if (card.action === 'setup') openSetup(card.step ?? 0, from, true, card.id === 'invalid' ? undefined : card.id);
    else reload();
  }
  async function saveOccurrence(o: Occurrence | null) {
    if (!saved?.profile.retire.core || dialog?.kind !== 'occurrence') return;
    const r = saved.profile.retire;
    if (await saver.save(eventsInput({ life_events: r.life_events, occurrences: o ? [...r.core!.occurrences.filter(x => x.event_id !== o.event_id), o] : retractOccurrence(r.core!.occurrences, r.core!.occurrences.find(x => x.event_id === dialog.event.id)?.id ?? '') }))) closeRefinement();
  }
  if (sources.profile.status === 'error') return <article className="ui-card ui-content" role="alert"><p>规划资料读取失败：{sources.profile.value.message}</p><button onClick={reload}>重新读取</button></article>;
  if (detail && saved?.profile.retire.basic) return <PlanningBasicDetail sources={sources} saved={saved} today={today} reload={reload} onPending={onPending} onEditingChange={onEditingChange} openSetup={(step, from) => openSetup(step, from, true)} onEvents={goEvents} onBack={() => { setDetail(false); requestAnimationFrame(() => document.getElementById('plan-detail-entry')?.focus()); }} assumptionsPort={assumptionsPort}/>;
  return <div className="plan-goals" data-goal-state={state}>
    {saved && assumptionsPort && <AssumptionsSummary port={assumptionsPort} generation={sources.generation} writeVersion={sources.write_version} blocked={saver.busy || saver.stuck} reload={reload} onPending={onPending} onEditingChange={setAssumptionEditing}/>}
    {!!caps?.reset_reasons?.length && <article className="ui-card ui-content" role="status"><h3>规划条件需要重新确认</h3><p>规划已改为通用时间、资金和预计收入。请核对{caps.reset_reasons.map(r => ({ time_unconfirmed: '目标与终点月份', income_unconfirmed: '未来收入', funds_unconfirmed: '可用资金' })[r]).join('、')}；账户、盘点和实际记录不受影响。</p><button className="ui-btn" onClick={e => openSetup(0, e.currentTarget, true)}>核对规划条件</button></article>}
    {dialog?.kind === 'debt' && saved && <PlanningDebtDialog completion={dialog.completion} sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={closeRefinement}/>}
    {dialog?.kind === 'funds' && saved && <FundsDialog completion={dialog.completion} sources={sources} saved={saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onClose={closeRefinement}/>}
    {dialog?.kind === 'costs' && saved && <CostsDialog completion={dialog.completion} sources={sources} saved={saved} reload={reload} onPending={onPending} onClose={closeRefinement}/>}
    {dialog?.kind === 'occurrence' && saved && <PlanningOccurrenceDialog fundRules={saved.profile.retire.core?.fund_rules} completion={dialog.completion} event={dialog.event} existing={saved.profile.retire.core?.occurrences.find(o => o.event_id === dialog.event.id)} snapshot={snapshot} accounts={accounts} today={today} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} onClose={closeRefinement} onSave={o => void saveOccurrence(o)}/>}
    {dialog?.kind === 'single' && saved && <GoalEditor kind={dialog.field} sources={sources} saved={saved} reload={reload} onPending={onPending} onClose={closeRefinement}/>}
    {saved?.profile.retire.basic && caps ? <GoalOverview saved={saved} caps={caps} today={today} cards={cards} onEdit={editGoal} onRefine={action} onDetail={() => setDetail(true)}/> : <article className="ui-card ui-content plan-goal planning-first-result" aria-label="退休目标">
      {!saved?.profile.retire.basic ? <>
        <h3>想知道：要攒多少钱才够？</h3>
        <p className="planning-first-promise">回答 4 个问题，算出“从目标月份起使用资金，每月大约要存多少钱”。</p><p className="muted">可以只算自己，也可以按全家算：生活费、资金和收入按同一范围填。没想好的可以先留空，随时退出，不保存草稿。</p>
        <div className="plan-goal-actions"><button type="button" id="plan-budget-entry" className="primary" onClick={e => openSetup(0, e.currentTarget)}>开始（约 2 分钟）</button><button type="button" className="ui-link" onClick={() => onGoto('savings')}>先看收入与复盘</button></div>
      </> : <p>正在读取你的规划条件…</p>}
    </article>}
    {result.status !== 'ready' && <><CapabilityNotice result={result}/><button className="ui-btn" onClick={reload}>重新读取</button></>}
    {(state === '2' || state === '2b') && <>
      <details className="ui-card ui-content"><summary>全部待核对事项</summary><PlanningRefinements cards={cards} busy={saver.busy || saver.stuck} onAction={action}/></details>
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
