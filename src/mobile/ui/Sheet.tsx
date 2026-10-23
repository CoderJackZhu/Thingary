import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../i18n.ts';
/**
 * Bottom sheet over the current page: dimmed backdrop, grab handle, centred title and header buttons that follow
 * one rule everywhere: a sheet that can be abandoned has `cancelLabel` (取消) on the left and, when it submits from the
 * header, `onDone` with `doneLabel` (完成 / 保存) on the right; a read-only sheet has only 关闭 on the right (the default);
 * full-width bottom buttons are for confirm-type sheets ({@link ConfirmSheet}) only.
 * Escape and a backdrop tap close it. Routed sheets (kind 'sheet') get this frame from the shell;
 * use it directly for small in-page choices. `onClose` is required, content scrolls inside.
 */
export function Sheet({ title, onClose, doneLabel = t('关闭'), cancelLabel, onDone, doneDisabled, children }: { title: string; onClose: () => void; /** Right-hand button text. Without `onDone` it closes the sheet (read-only sheet). */ doneLabel?: string; /** Left-hand button that closes the sheet, for sheets that can be abandoned. */ cancelLabel?: string; /** Submits from the header; shown as the right-hand button. */ onDone?: () => void; doneDisabled?: boolean; children: ReactNode }) {
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
      <div className="m-sheet-head">
        <div className="m-sheet-side">{cancelLabel && <button type="button" className="m-navbar-button" onClick={onClose}>{cancelLabel}</button>}</div>
        <h2>{title}</h2>
        <div className="m-sheet-side m-sheet-right">{(onDone || !cancelLabel) && <button type="button" className="m-navbar-button m-navbar-primary" disabled={doneDisabled} onClick={onDone ?? onClose}>{doneLabel}</button>}</div>
      </div>
      <div className="m-sheet-body">{children}</div>
    </div>
  </div>;
}
