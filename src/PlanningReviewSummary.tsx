import { retractOccurrence } from './plan-occurrence-actions';
import { useEffect, useState } from 'react';
import { PlanningOccurrenceDialog } from './PlanningOccurrenceDialog';
import { useSectionSaver } from './planning-basic-data';
import { eventsInput } from './planning-basic-forms';
import { occurrenceIssues } from './plan-core';
import type { Occurrence, OccurrenceIssueKind } from './plan-core';
import type { Interval, PlanningSources, Reasons, StoredLifeEvent } from './plan';
import { ready } from './review';
import { buildReviewObservations, reviewMissing } from './review-observations';
import type { ReviewAction } from './review-observations';
import type { Summary } from './wealth';

export function PlanningReviewSummary({ interval, reasons, reasonError, summary, summaryError, sources, today, reload, onPending, onEditingChange, onAction, onRetry, blocked }: {
  blocked: boolean; interval: Interval; reasons: Reasons | null; reasonError: string; summary: Summary | null; summaryError: string;
  sources: PlanningSources; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; onAction: (a: ReviewAction) => void; onRetry: () => void;
}) {
  const [occurring, setOccurring] = useState<{ event: StoredLifeEvent; issue?: OccurrenceIssueKind } | null>(null);
  const saver = useSectionSaver(sources, reload, onPending);
  useEffect(() => { onEditingChange(!!occurring || saver.busy || saver.stuck); return () => onEditingChange(false); }, [occurring, saver.busy, saver.stuck, onEditingChange]);
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
  const missing = reviewMissing(interval, summary?.points.filter(p => !p.complete).length ?? 0);
  async function saveOccurrence(o: Occurrence | null) {
    if (!retire) return;
    if (await saver.save(eventsInput({ life_events: retire.life_events, occurrences: o ? [...(retire.core?.occurrences ?? []).filter(x => x.event_id !== o.event_id), o] : retractOccurrence(retire.core?.occurrences ?? [], retire.core?.occurrences.find(x => x.event_id === occurring?.event.id)?.id ?? '') }))) setOccurring(null);
  }
  return <article className="ui-card ui-content plan-review-summary" aria-label="这一期要核对的事">
    <div className="ui-section-head"><div><h3>这一期要核对的事</h3><p className="muted small">{interval.from} → {interval.to} · 可以全部跳过，清单随资料重新计算。</p></div></div>
    <ul className="plan-review-checklist">
      <li><div><strong>核对账户与资料</strong><span>{accountError ? '读取失败，重试' : !summary ? '正在读取…' : missing ? `有 ${missing} 项待补` : '已就绪'}</span></div>
        <button type="button" className="ui-btn" disabled={blocked || !accountError && (!summary || (interval.status === 'no_income' && sources.incomes.status !== 'ready'))} onClick={() => accountError ? (summaryError ? onRetry() : reload()) : act(summary?.points.find(p => !p.complete) ? { kind: 'snapshot', id: summary.points.find(p => !p.complete)!.snapshot_id } : interval.status === 'no_income' ? { kind: 'income' } : { kind: 'accounts' })}>{accountError ? '重试' : summary?.points.some(p => !p.complete) ? '补录' : interval.status === 'no_income' ? '记一笔收入' : '查看账户'}</button></li>
      {(hasPlan || profileError) && <>
        <li><div><strong>确认重要发生</strong><span>{profileError || snapshotError ? '读取失败，重试' : !snapshot ? '需要完整盘点' : eventIds.length ? `${eventIds.length} 项待核对` : '无待核对'}</span></div>
          <button type="button" className="ui-btn" disabled={blocked || hasPlan && !profileError && !snapshotError && sources.accounts.status !== 'ready'} onClick={() => profileError || snapshotError ? reload() : eventIds.length ? act({ kind: 'occurrence', event_id: eventIds[0] }) : onAction({ kind: 'plan' })}>{profileError || snapshotError ? '重试' : eventIds.length ? '去核对' : '查看计划'}</button></li>
        <li><div><strong>复核当前计划</strong><span>{profileError ? '读取失败' : '已保存计划'}</span></div><button type="button" className="ui-btn" disabled={blocked} onClick={() => profileError ? reload() : onAction({ kind: 'plan' })}>{profileError ? '重试' : '查看当前计划'}</button></li>
      </>}
    </ul>
    {eventIds.length > 0 && <details className="plan-explanation"><summary>待核对的安排（{eventIds.length} 项）</summary><ul className="plan-review-events">{eventIds.map(id => <li key={id}><div><strong>{retire?.life_events.find(e => e.id === id)?.label}</strong>{pending.filter(p => p.event_id === id).map((p, n) => <p key={n} className="muted small">{p.message}{(p.kind === 'absorption' || p.kind === 'loan') && <> <button type="button" className="ui-link" disabled={blocked} onClick={() => act({ kind: 'occurrence', event_id: id, issue_kind: p.kind })}>{p.kind === 'loan' ? '核对剩余欠款' : '核对付款是否已计入盘点'}</button></>}</p>)}</div><button type="button" className="ui-btn" disabled={blocked} onClick={() => act({ kind: 'occurrence', event_id: id })}>去核对</button></li>)}</ul><p className="muted small">暂不处理可直接关闭；调整预计日期请到当前计划编辑。</p></details>}
    <ul className="plan-review-observations" aria-label="本期观察">{observations.items.map(item => <li key={item.id}>{item.text}</li>)}</ul>
    {reasonError && <p role="alert" className="error">原因记录读取失败：{reasonError} <button type="button" onClick={onRetry}>重试</button></p>}
    {observations.next && <div className="plan-review-next"><span>下一步</span><button type="button" className="ui-btn" disabled={blocked} onClick={() => act(observations.next!.action)}>{observations.next.label}</button></div>}
    {occurring && <PlanningOccurrenceDialog event={occurring.event} existing={retire?.core?.occurrences.find(o => o.event_id === occurring.event.id)} snapshot={snapshot} accounts={ready(sources.accounts) ?? []} today={today} busy={saver.busy} stuck={saver.stuck} notice={saver.notice} initialIssue={occurring.issue} onClose={() => { setOccurring(null); onPending(); }} onSave={o => void saveOccurrence(o)}/>}
  </article>;
}
