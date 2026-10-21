import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Bottom sheet over the current page: dimmed backdrop, grab handle, title with a 完成 button.
 * Escape and a backdrop tap close it. Routed sheets (kind 'sheet') get this frame from the shell;
 * use it directly for small in-page choices. `onClose` is required, content scrolls inside.
 */
export function Sheet({ title, onClose, doneLabel = '完成', children }: { title: string; onClose: () => void; doneLabel?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus?.({ preventScroll: true }); };
  }, []);
  return <div className="m-sheet-layer">
    <div className="m-sheet-scrim" onClick={onClose} aria-hidden="true"/>
    <div className="m-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
      <div className="m-sheet-handle" aria-hidden="true"/>
      <div className="m-sheet-head"><h2>{title}</h2><button type="button" className="m-navbar-button m-navbar-primary" onClick={onClose}>{doneLabel}</button></div>
      <div className="m-sheet-body">{children}</div>
    </div>
  </div>;
}
