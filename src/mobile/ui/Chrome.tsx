import type { ReactNode } from 'react';
import { useEntry, useNav } from '../nav-context';
import { Icon } from './Icon';

/** Large page title (32px) with optional round icon buttons or a primary button on the right. Use it first on a tab root. */
export function LargeTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <header className="m-large-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="m-large-actions">{actions}</div>}</header>;
}

/** Round white 44px icon button for LargeTitle actions. `label` is its accessible name. */
export function IconButton({ label, children, onClick, pressed, disabled }: { label: string; children: ReactNode; onClick?: () => void; pressed?: boolean; disabled?: boolean }) {
  return <button type="button" className="m-icon-button" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}

/**
 * Top bar of a pushed page or modal. Left side is chosen from the stack: `‹ 上一页标题` on pages,
 * `取消` on modals (override with `back` / `cancel`). `primary` is the right-hand action such as 保存.
 * Leave `title` empty when a LargeTitle follows.
 */
export function NavBar({ title, primary, back, cancelLabel = '取消', onCancel, right }: {
  title?: string;
  primary?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean };
  back?: { label: string; onClick: () => void };
  cancelLabel?: string; onCancel?: () => void;
  /** Extra right-side content when there is no primary action. */
  right?: ReactNode;
}) {
  const nav = useNav(), { kind, backTitle, isRoot } = useEntry();
  const close = onCancel ?? (() => nav.pop());
  return <div className="m-navbar" role="banner">
    <div className="m-navbar-side">
      {kind === 'modal' ? <button type="button" className="m-navbar-button" disabled={nav.blocked} onClick={close}>{cancelLabel}</button>
        : back ? <button type="button" className="m-navbar-button" onClick={back.onClick}><Icon name="chevronLeft" size={20} strokeWidth={2.2}/><span className="m-navbar-back">{back.label}</span></button>
        : !isRoot && <button type="button" className="m-navbar-button" disabled={nav.blocked} aria-label={`返回${backTitle ?? ''}`} onClick={() => nav.pop()}><Icon name="chevronLeft" size={20} strokeWidth={2.2}/><span className="m-navbar-back">{backTitle}</span></button>}
    </div>
    {title ? <h1 className="m-navbar-title">{title}</h1> : <span/>}
    <div className="m-navbar-side m-navbar-right">{primary ? <button type="button" className="m-navbar-button m-navbar-primary" disabled={primary.disabled || primary.busy} onClick={primary.onClick}>{primary.busy ? '保存中…' : primary.label}</button> : right}</div>
  </div>;
}

/** Top segmented control (物品 / 心愿 / 统计). Tab roots get it from the shell; use it directly for in-page switches. */
export function SegmentedControl<T extends string>({ items, value, onChange, label, variant }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void; label: string; /** `chips`: borderless pills with a tinted selected state, for range pickers inside a card. */ variant?: 'chips' }) {
  return <div className={`m-segmented${variant ? ` m-segmented-${variant}` : ''}`} role="group" aria-label={label}>{items.map(item => <button key={item.id} type="button" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>;
}

/** Bottom bar pinned above the tab bar (pages) or the screen edge (modals), for the main action and a short status line. */
export function ActionBar({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return <div className="m-actionbar">{status && <div className="m-actionbar-status" role="status">{status}</div>}<div className="m-actionbar-row">{children}</div></div>;
}
