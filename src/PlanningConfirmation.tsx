import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export type ConfirmationIssue = { label: string; attempt: number };
export const CONFIRMATION_MESSAGE = '这一项还没确认，确认后才能算出结果';
/** A local form cue only: no persistence or calculation gate is changed. */
export function ConfirmationField({ label, attention = false, focus = false, issue, controlLabel, children }: { label: string; attention?: boolean; focus?: boolean; issue?: ConfirmationIssue | null; controlLabel?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), id = useId();
  const invalid = issue?.label === label;
  useEffect(() => {
    if (!invalid && !focus) return;
    const frame = requestAnimationFrame(() => {
      const el = controlLabel ? Array.from(ref.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? []).find(el => el.getAttribute('aria-label') === controlLabel) : ref.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)');
      for (let p = el?.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
      el?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, invalid, issue?.attempt, controlLabel]);
  useEffect(() => {
    const controls = ref.current?.querySelectorAll<HTMLElement>('input, select, button');
    controls?.forEach(el => {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(v => v && v !== id);
      if (invalid) ids.push(id);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
      if (invalid) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    });
  }, [invalid, id]);
  return <div ref={ref} data-confirmation={label} className={attention || invalid ? 'planning-confirmation-field' : undefined}>{children}{invalid && <p id={id} className="notice" role="alert">{CONFIRMATION_MESSAGE}</p>}</div>;
}
