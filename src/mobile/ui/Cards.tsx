import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { clampSwipe, settleSwipe } from './swipe';

export type Tone = 'accent' | 'warn' | 'positive' | 'danger' | 'neutral';

/** White rounded card. Use `tone="warn"` for a notice card; put several rows in a ListGroup instead. */
export function Card({ children, tone, label, className = '' }: { children: ReactNode; tone?: 'warn'; label?: string; className?: string }) {
  return <section className={`m-card${tone ? ` m-card-${tone}` : ''} ${className}`} aria-label={label}>{children}</section>;
}

/** Group heading above a card (`记录`, `设置`); `action` is a small text button on the right. */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="m-section"><div className="m-section-head"><h2>{title}</h2>{action}</div>{children}</section>;
}

/** Hero card with a tinted gradient: eyebrow, big conclusion, supporting line, tag pills and a footnote. */
export function HeroCard({ eyebrow, action, title, subtitle, tags, footnote, onClick, children }: { eyebrow?: string; action?: string; title: ReactNode; subtitle?: ReactNode; tags?: { text: string; tone?: 'positive' | 'neutral' }[]; footnote?: string; onClick?: () => void; children?: ReactNode }) {
  const body = <>
    {(eyebrow || action) && <span className="m-hero-top"><span>{eyebrow}</span>{action && <span className="m-hero-action">{action}<Icon name="chevronRight" size={16}/></span>}</span>}
    <span className="m-hero-title">{title}</span>
    {subtitle && <span className="m-hero-sub">{subtitle}</span>}
    {children}
    {!!tags?.length && <span className="m-tags">{tags.map(tag => <span key={tag.text} className={`m-tag m-tag-${tag.tone ?? 'neutral'}`}>{tag.text}</span>)}</span>}
    {footnote && <span className="m-hero-foot">{footnote}</span>}
  </>;
  return onClick ? <button type="button" className="m-card m-hero" onClick={onClick}>{body}</button> : <section className="m-card m-hero">{body}</section>;
}

/** Metric tile: small label, large value, optional trend line and a chart below. Put two in a MetricGrid. Unknown values pass `value="未知"` with `unknown`. */
export function Metric({ label, value, sub, subTone, unknown, children, onClick }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: 'positive' | 'danger'; unknown?: boolean; children?: ReactNode; onClick?: () => void }) {
  const body = <><span className="m-metric-label">{label}</span><span className={`m-metric-value${unknown ? ' m-unknown' : ''}`}>{value}</span>{sub && <span className={`m-metric-sub${subTone ? ` m-${subTone}` : ''}`}>{sub}</span>}{children}</>;
  return onClick ? <button type="button" className="m-card m-metric" onClick={onClick}>{body}</button> : <div className="m-card m-metric">{body}</div>;
}
/** Two-column grid of Metric tiles; collapses to one column below 340px. */
export function MetricGrid({ children }: { children: ReactNode }) { return <div className="m-metric-grid">{children}</div>; }

/** Rounded card holding ListRows, with an optional heading above. Rows are separated by hairlines. */
export function ListGroup({ title, action, footer, children }: { title?: string; action?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return <section className="m-list-group" aria-label={title}>{(title || action) && <div className="m-section-head">{title && <h2>{title}</h2>}{action}</div>}<div className="m-card m-list">{children}</div>{footer && <p className="m-group-footer">{footer}</p>}</section>;
}

type RowProps = {
  title: ReactNode; subtitle?: ReactNode;
  /** Right-hand value (amount, count); `valueSub` is a smaller line below it. */
  value?: ReactNode; valueSub?: ReactNode; unknown?: boolean;
  icon?: IconName | ReactNode; tone?: Tone;
  /** Shows › and makes the row a button. */
  onClick?: () => void; chevron?: boolean;
  /** Replaces the value area, for a Switch or a small button. */
  trailing?: ReactNode; disabled?: boolean;
};
/** Grouped-list row: left icon tile, title, subtitle, right value and ›. At least 64px tall when it has a subtitle, 48px otherwise. */
export function ListRow({ title, subtitle, value, valueSub, unknown, icon, tone = 'accent', onClick, chevron = !!onClick, trailing, disabled }: RowProps) {
  const body = <>
    {icon != null && <span className={`m-row-icon m-tone-${tone}`}>{typeof icon === 'string' ? <Icon name={icon as IconName} size={20}/> : icon}</span>}
    <span className="m-row-main"><span className="m-row-title">{title}</span>{subtitle && <span className="m-row-sub">{subtitle}</span>}</span>
    {trailing ?? ((value != null || valueSub != null) && <span className="m-row-value"><span className={unknown ? 'm-unknown' : undefined}>{value}</span>{valueSub && <small>{valueSub}</small>}</span>)}
    {chevron && <span className="m-row-chevron"><Icon name="chevronRight" size={18}/></span>}
  </>;
  const cls = `m-row${subtitle ? ' m-row-tall' : ''}`;
  return onClick ? <button type="button" className={cls} disabled={disabled} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

export type SwipeAction = { label: string; icon?: IconName; tone?: 'accent' | 'danger'; onAction: () => void };
/**
 * List row that slides left to reveal actions (置顶 / 删除). Actions are real buttons, so keyboard and
 * VoiceOver users can reach them: focusing one opens the row. Wrap a ListRow or any content.
 */
export function SwipeRow({ children, actions, label }: { children: ReactNode; actions: SwipeAction[]; label?: string }) {
  const width = actions.length * 88;
  const [x, setX] = useState(0), [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; origin: number; last: number; lastTime: number; velocity: number; active: boolean | null } | null>(null);
  const root = useRef<HTMLDivElement>(null), dragged = useRef(false);
  const open = x <= -width / 2;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setX(0); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return <div className="m-swipe" ref={root} role="group" aria-label={label} onFocus={event => { if ((event.target as HTMLElement).closest('.m-swipe-actions')) setX(-width); }} onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node)) setX(0); }}>
    <div className="m-swipe-actions" style={{ width }}>{actions.map(action => <button key={action.label} type="button" className={`m-swipe-action m-swipe-${action.tone ?? 'accent'}`} tabIndex={open ? 0 : -1} onClick={() => { setX(0); action.onAction(); }}>{action.icon && <Icon name={action.icon} size={20}/>}<span>{action.label}</span></button>)}</div>
    <div className={`m-swipe-content${dragging ? ' m-dragging' : ''}`} style={{ transform: `translateX(${x}px)` }}
      onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; drag.current = { startX: event.clientX, startY: event.clientY, origin: x, last: event.clientX, lastTime: event.timeStamp, velocity: 0, active: null }; }}
      onPointerMove={event => {
        const d = drag.current; if (!d) return;
        const dx = event.clientX - d.startX, dy = event.clientY - d.startY;
        if (d.active === null && Math.hypot(dx, dy) > 8) { d.active = Math.abs(dx) > Math.abs(dy); if (d.active) { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); } }
        if (!d.active) return;
        const dt = Math.max(1, event.timeStamp - d.lastTime); d.velocity = (event.clientX - d.last) / dt; d.last = event.clientX; d.lastTime = event.timeStamp;
        setX(clampSwipe(d.origin + dx, width));
      }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d?.active) { dragged.current = true; setTimeout(() => { dragged.current = false; }, 0); setDragging(false); setX(settleSwipe(x, width, d.velocity) ? -width : 0); } }}
      onPointerCancel={() => { drag.current = null; setDragging(false); setX(x <= -width / 2 ? -width : 0); }}
      onClickCapture={event => { if (dragged.current || open) { event.preventDefault(); event.stopPropagation(); setX(0); } }}>{children}</div>
  </div>;
}
