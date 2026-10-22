import { t } from '../i18n.ts';
// Unsaved-change tracking for modal forms. Pure, no React: the nav provider owns one registry and asks it
// whether the page on top of the stack has changes before a cancel or a swipe back throws them away.

/** Dirty flags per stack entry id. */
export class DirtyRegistry {
  private flags = new Map<number, boolean>();
  set(entryId: number, dirty: boolean): void { if (dirty) this.flags.set(entryId, true); else this.flags.delete(entryId); }
  clear(entryId: number): void { this.flags.delete(entryId); }
  isDirty(entryId: number | undefined): boolean { return entryId !== undefined && this.flags.get(entryId) === true; }
}

/** Text of the discard question, shared by every form. */
export const discardTitle = t('放弃这次修改？');
export const discardMessage = t('已填写的内容不会保存。');

/** Stable text snapshot of a form value; null when it cannot be serialised (then the form is treated as unchanged). */
export function snapshot(value: unknown): string | null {
  try { return JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? `${v}n` : v) ?? null; } catch { return null; }
}
/** True when `current` differs from the first value that was loaded. A form that has not loaded yet (`undefined`/`null` baseline) is clean. */
export function changedSince(baseline: string | null, current: unknown): boolean {
  if (baseline === null) return false;
  const now = snapshot(current);
  return now !== null && now !== baseline;
}
