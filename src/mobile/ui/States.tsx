import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { t } from '../../i18n.ts';
/** Nothing here yet: icon, one-line title, one sentence of help and an optional first action. */
export function EmptyState({ icon = 'box', title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  return <section className="m-state"><span className="m-state-icon"><Icon name={icon} size={26}/></span><h2>{title}</h2>{message && <p>{message}</p>}{action}</section>;
}
/** The value cannot be known (never recorded, source unreadable). Shows 未知 in a dashed pill so it is never mistaken for zero. */
export function UnknownState({ title = t('未知'), message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return <section className="m-state m-state-unknown"><span className="m-unknown-pill">{title}</span>{message && <p>{message}</p>}{action}</section>;
}
/** A read or save failed. `message` is shown as-is; `onRetry` adds a 重试 button. */
export function ErrorState({ title = t('读取失败'), message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return <section className="m-state m-state-error" role="alert"><span className="m-state-icon"><Icon name="warning" size={26}/></span><h2>{title}</h2>{message && <p>{message}</p>}{onRetry && <button type="button" className="m-button m-button-secondary" onClick={onRetry}>{t('重试')}</button>}</section>;
}
/** Spinner with a status message, for pages that are reading data. */
export function Loading({ label = t('正在读取…') }: { label?: string }) {
  return <p className="m-loading" role="status"><span className="m-spinner" aria-hidden="true"/>{label}</p>;
}
/** Inline notice strip: `tone="warn"` for caveats, `danger` for errors, `positive` for confirmations. */
export function Notice({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'danger' | 'positive' }) {
  return <p className={`m-notice m-notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</p>;
}
