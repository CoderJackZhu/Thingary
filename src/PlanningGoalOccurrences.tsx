import { useEffect, useRef, useState } from 'react';
import { PlanningOccurrenceDialog } from './PlanningOccurrenceDialog';
import { useSectionSaver } from './planning-basic-data';
import { eventsInput } from './planning-basic-forms';
import { occurrenceIssues } from './plan-core';
import type { Occurrence, OccurrenceIssueKind } from './plan-core';
import type { PlanningSources, StoredLifeEvent } from './plan';
import { retractOccurrence } from './plan-occurrence-actions';
import { ready } from './review';

/** Goal facts remain reachable without an income read or a selected financial interval. */
export function PlanningGoalOccurrences({ sources, today, reload, onPending, onEditingChange, blocked = false }: {
  sources: PlanningSources; today: string; reload: () => void; onPending: () => void;
  onEditingChange: (value: boolean) => void; blocked?: boolean;
}) {
  const [occurring, setOccurring] = useState<{ event: StoredLifeEvent; issue?: OccurrenceIssueKind } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const saver = useSectionSaver(sources, reload, onPending);
  useEffect(() => { onEditingChange(!!occurring || saver.busy || saver.stuck); return () => onEditingChange(false); }, [occurring, saver.busy, saver.stuck, onEditingChange]);
  const retire = ready(sources.profile)?.saved?.profile.retire;
  const snapshot = ready(sources.snapshot) ?? null;
  const issues = retire && snapshot ? occurrenceIssues(snapshot, retire.core, retire.life_events, today) : [];
  const unavailable = sources.accounts.status !== 'ready' || sources.snapshot.status !== 'ready' || !snapshot;
  const locked = blocked || saver.busy || saver.stuck;
  const close = () => {
    if (saver.busy) return;
    setOccurring(null); onPending();
    requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
  };
  async function saveOccurrence(o: Occurrence | null) {
    if (!retire || !occurring || unavailable || locked) return;
    const existing = retire.core?.occurrences ?? [];
    const occurrences = o ? [...existing.filter(x => x.event_id !== o.event_id), o]
      : retractOccurrence(existing, existing.find(x => x.event_id === occurring.event.id)?.id ?? '');
    if (await saver.save(eventsInput({ life_events: retire.life_events, occurrences }))) {
      setOccurring(null);
      requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
    }
  }
  return <article className="ui-card ui-content" aria-label="安排发生核对">
    <h3>安排发生核对</h3>
    <p className="muted small">核对实际发生、付款是否已计入起点盘点及剩余欠款。保存只维护来源关系，不改变账户余额或复制支出。</p>
    {sources.profile.status !== 'ready' ? <p role="alert">目标资料暂不可用。<button disabled={locked} onClick={reload}>重新读取</button></p>
      : !retire?.life_events.length ? <p className="muted">尚无购买安排，可在目标条件中添加。</p>
      : <>
        {unavailable && <p role="status">账户或完整起点盘点暂不可用，仍保留已保存的发生资料；补齐后才能保存核对。<button disabled={locked} onClick={reload}>重新读取</button></p>}
        <ul className="plan-review-events">{retire.life_events.map(event => {
          const existing = retire.core?.occurrences.find(o => o.event_id === event.id);
          const pending = issues.filter(p => p.event_id === event.id);
          const open = (from: HTMLElement, issue?: OccurrenceIssueKind) => { if (locked) return; opener.current = from; setOccurring({ event, issue }); };
          return <li key={event.id}><div><strong>{event.label}</strong><p className="muted small">预计 {event.date} · {existing ? existing.status === 'occurred' ? `已发生 · ${existing.actual_date}` : `已取消 · ${existing.actual_date}` : '尚未确认发生'}</p>
            {pending.map((p, n) => <p key={n} className="muted small">{p.message}{(p.kind === 'absorption' || p.kind === 'loan') && <button className="ui-link" disabled={locked} onClick={e => open(e.currentTarget, p.kind)}>{p.kind === 'loan' ? '核对剩余欠款' : '核对付款是否已计入盘点'}</button>}</p>)}
          </div><button className="ui-btn" disabled={locked} onClick={e => open(e.currentTarget, pending[0]?.kind)}>{existing ? '查看／更正发生核对' : '核对是否已发生'}</button></li>;
        })}</ul>
      </>}
    {occurring && <PlanningOccurrenceDialog event={occurring.event} existing={retire?.core?.occurrences.find(o => o.event_id === occurring.event.id)} snapshot={snapshot} accounts={ready(sources.accounts) ?? []} today={today} busy={saver.busy} stuck={saver.stuck} saveDisabled={blocked || unavailable} notice={unavailable ? '账户或完整起点盘点暂不可用，当前仅能查看；补齐后才能保存核对。' : saver.notice} initialIssue={occurring.issue} onClose={close} onSave={o => void saveOccurrence(o)}/>}
  </article>;
}
