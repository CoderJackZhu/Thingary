import { incomeCategories, incomeCategoryTotals } from './income-classification';
import { money } from './asset';
import { InvestmentReviewHost } from './InvestmentReviewHost';
import { retractOccurrence } from './plan-occurrence-actions';
import { useEffect, useState } from 'react';
import { PlanningOccurrenceDialog } from './PlanningOccurrenceDialog';
import { useSectionSaver } from './planning-basic-data';
import { eventsInput } from './planning-basic-forms';
import { occurrenceIssues } from './plan-core';
import type { Occurrence, OccurrenceIssueKind } from './plan-core';
import type { Interval, PlanningSources, Reasons, StoredLifeEvent } from './plan';
import { ready } from './review';
import { buildReviewObservations, reviewActionLabel } from './review-observations';
import type { ReviewAction } from './review-observations';
import type { Summary } from './wealth';

export function PlanningReviewSummary({ interval, reasons, reasonError, summary, summaryError, sources, today, reload, onPending, onEditingChange, onAction, onRetry, blocked }: {
  blocked: boolean; interval: Interval; reasons: Reasons | null; reasonError: string; summary: Summary | null; summaryError: string;
  sources: PlanningSources; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; onAction: (a: ReviewAction) => void; onRetry: () => void;
}) {
  const [occurring, setOccurring] = useState<{ event: StoredLifeEvent; issue?: OccurrenceIssueKind } | null>(null);
  const [investmentEditing, setInvestmentEditing] = useState(false);
  const saver = useSectionSaver(sources, reload, onPending);
  useEffect(() => { onEditingChange(!!occurring || investmentEditing || saver.busy || saver.stuck); return () => onEditingChange(false); }, [occurring, investmentEditing, saver.busy, saver.stuck, onEditingChange]);
  const saved = ready(sources.profile)?.saved, retire = saved?.profile.retire;
  const hasPlan = !!retire?.basic;
  const snapshot = ready(sources.snapshot);
  const issues = hasPlan && snapshot ? occurrenceIssues(snapshot, retire?.core, retire?.life_events ?? [], today) : [];
  const pending = issues.filter(x => x.event_id !== null);
  const eventIds = [...new Set(pending.map(x => x.event_id!))];
  const profileError = sources.profile.status === 'error', snapshotError = sources.snapshot.status === 'error';
  const observations = buildReviewObservations({ interval, reasons, pending, snapshots: summary ? { incomplete_count: summary.points.filter(p => !p.complete).length, points: summary.points } : null });
  const act = (action: ReviewAction) => {
    if (blocked) return;
    if (action.kind === 'occurrence') { if (sources.accounts.status !== 'ready') return; const event = retire?.life_events.find(e => e.id === action.event_id); if (event) setOccurring({ event, issue: action.issue_kind ?? pending.find(p => p.event_id === event.id)?.kind }); }
    else if (action.kind !== 'income' || sources.incomes.status === 'ready') onAction(action);
  };
  const accountError = summaryError || (sources.accounts.status === 'error' ? sources.accounts.value.message : '');
  const disabledAction = (a: ReviewAction) => blocked || a.kind === 'income' && sources.incomes.status !== 'ready' || a.kind === 'occurrence' && sources.accounts.status !== 'ready';
  async function saveOccurrence(o: Occurrence | null) {
    if (!retire) return;
    if (await saver.save(eventsInput({ life_events: retire.life_events, occurrences: o ? [...(retire.core?.occurrences ?? []).filter(x => x.event_id !== o.event_id), o] : retractOccurrence(retire.core?.occurrences ?? [], retire.core?.occurrences.find(x => x.event_id === occurring?.event.id)?.id ?? '') }))) setOccurring(null);
  }
  return <article className="ui-card ui-content plan-review-summary" aria-label="本期复盘">
    <div className="ui-section-head"><div><h3>本期复盘</h3><p className="muted small">{interval.from} → {interval.to}</p></div></div>
    <ul className="plan-review-observations" aria-label="本期事实">{observations.items.map(item => <li key={item.id}>{item.text}</li>)}</ul>
    <dl className="plan-facts" aria-label="本期已记录收入分类">{incomeCategoryTotals((ready(sources.incomes) ?? []).filter(i => i.fields.date > interval.from && i.fields.date <= interval.to)).map(row => <div key={row.category}><dt>{incomeCategories[row.category]}</dt><dd>{money(row.cents)} · {row.count} 笔</dd></div>)}</dl>
    <p className="muted small">这些记录是核对资产变化的线索，尚未逐笔对应；估值变化、转账与未记录收支仍可能影响差额，不能据此反推消费或真实储蓄。</p>
    {reasonError && <p role="alert" className="error">付款记录读取失败：{reasonError} <button type="button" disabled={blocked} onClick={onRetry}>重试</button></p>}
    {summary && <InvestmentReviewHost key={generationKey(sources.generation, interval.snapshot_id)} generation={sources.generation} fromSnapshotId={summary.points.find(p => p.date === interval.from && p.complete)?.snapshot_id ?? null} toSnapshotId={interval.snapshot_id} writeVersion={sources.write_version} incomes={ready(sources.incomes) ?? null} accountNames={Object.fromEntries((ready(sources.accounts) ?? []).map(a => [a.id, a.fields.name]))} blocked={blocked || saver.busy || saver.stuck || !!occurring} reload={reload} onPending={onPending} onEditingChange={setInvestmentEditing}/>}
    <h4>待核对事项</h4>
    <ul className="plan-review-checklist">
      {(accountError || !summary) && <li><div><strong>账户与盘点</strong><span>{accountError ? '读取失败，已读取的本期事实仍可查看。' : '正在读取…'}</span></div>{accountError && <button type="button" disabled={blocked} onClick={() => summaryError ? onRetry() : reload()}>重试</button>}</li>}
      {observations.checks.filter(item => item.id !== 'pending_events').map(item => <li key={item.id}><div>{item.text}</div>{item.action && <button type="button" className="ui-btn" disabled={disabledAction(item.action) || item.action.kind !== 'income' && !!accountError} onClick={() => act(item.action!)}>{reviewActionLabel[item.action.kind]}</button>}</li>)}
      {(hasPlan || profileError) && <li><div><strong>当前计划</strong><span>{profileError || snapshotError ? '资料读取失败，待核对安排暂不可用。' : !snapshot ? '需要完整盘点才能核对安排。' : eventIds.length ? `${eventIds.length} 项安排待核对，见下方清单。` : '无待核对安排。'}</span></div><button type="button" className="ui-btn" disabled={blocked} onClick={() => profileError || snapshotError ? reload() : onAction({ kind: 'plan' })}>{profileError || snapshotError ? '重试' : '查看当前计划'}</button></li>}
    </ul>
    {!observations.checks.length && !hasPlan && !profileError && summary && !accountError && <p className="muted small">当前没有待核对事项。</p>}
    {eventIds.length > 0 && <details className="plan-explanation"><summary>待核对的安排（{eventIds.length} 项）</summary><ul className="plan-review-events">{eventIds.map(id => <li key={id}><div><strong>{retire?.life_events.find(e => e.id === id)?.label}</strong>{pending.filter(p => p.event_id === id).map((p, n) => <p key={n} className="muted small">{p.message}{(p.kind === 'absorption' || p.kind === 'loan') && <> <button type="button" className="ui-link" disabled={blocked || sources.accounts.status !== 'ready'} onClick={() => act({ kind: 'occurrence', event_id: id, issue_kind: p.kind })}>{p.kind === 'loan' ? '核对剩余欠款' : '核对付款是否已计入盘点'}</button></>}</p>)}</div><button type="button" className="ui-btn" disabled={blocked || sources.accounts.status !== 'ready'} onClick={() => act({ kind: 'occurrence', event_id: id })}>去核对</button></li>)}</ul><p className="muted small">暂不处理可直接关闭；调整预计日期请到当前计划编辑。</p></details>}
    {occurring && <PlanningOccurrenceDialog event={occurring.event} existing={retire?.core?.occurrences.find(o => o.event_id === occurring.event.id)} snapshot={snapshot} accounts={ready(sources.accounts) ?? []} today={today} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} initialIssue={occurring.issue} onClose={() => { setOccurring(null); onPending(); }} onSave={o => void saveOccurrence(o)}/>}
  </article>;
}

const generationKey = (generation: string, snapshot: string) => `${generation}:${snapshot}`;
