import type { Refinement } from './planning-first-run';

/** Shared by annotated results and genuinely blocked results (2b). */
export function PlanningRefinements({ cards, blocked = false, title, busy, onAction }: { cards: Refinement[]; blocked?: boolean; title?: string; busy: boolean; onAction: (card: Refinement, from: HTMLElement) => void }) {
  const shown = blocked ? cards.filter(c => c.required) : cards;
  if (!shown.length) return null;
  return <section className="planning-refinements" aria-label={blocked ? '需要确认的事项' : '让结果更准'}>
    <h3>{title ?? (blocked ? '需要补全才能计算' : '可选精修')}</h3>
    <div className="planning-refinement-grid">{shown.map(card => <article key={card.id} className={`ui-card ui-content planning-refinement-card${card.condition ? ' planning-condition-note' : ''}`} data-refinement={card.id} data-condition={card.condition || undefined}>
      <h4>{card.title}</h4><p>{card.benefit}</p><div><span className="muted small">{card.duration}</span><button type="button" className="ui-btn" disabled={busy} onClick={e => onAction(card, e.currentTarget)}>{card.condition ? '修改计入方式' : card.action === 'reload' ? '重新读取' : card.action === 'event' ? `去确认：${card.event!.label}` : card.action === 'costs' ? '去核对' : card.action === 'contribution' ? '去估计' : '去做'}</button></div>
    </article>)}</div>
  </section>;
}
