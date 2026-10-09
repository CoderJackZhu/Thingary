import type { Refinement } from './planning-first-run';

/** Shared by results and the transitional blocked result (2b). No editor is introduced here. */
export function PlanningRefinements({ cards, blocked = false, busy, onAction }: { cards: Refinement[]; blocked?: boolean; busy: boolean; onAction: (card: Refinement, from: HTMLElement) => void }) {
  const shown = blocked ? cards.filter(c => c.required) : cards;
  if (!shown.length) return null;
  return <section className="planning-refinements" aria-label={blocked ? '需要确认的事项' : '让结果更准'}>
    {!blocked && <h3>让结果更准（可选）</h3>}
    <div className="planning-refinement-grid">{shown.map(card => <article key={card.id} className="ui-card ui-content planning-refinement-card">
      <h4>{card.title}</h4><p>{card.benefit}</p><div><span className="muted small">{card.duration}</span><button type="button" className="ui-btn" disabled={busy} onClick={e => onAction(card, e.currentTarget)}>{card.action === 'reload' ? '重新读取' : card.action === 'event' ? `去确认：${card.event!.label}` : card.action === 'costs' ? '去核对' : card.action === 'contribution' ? '去估计' : '去做'}</button></div>
    </article>)}</div>
  </section>;
}
