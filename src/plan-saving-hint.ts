import type { PlanReview } from './plan.ts';

/** The hint only appears when the gap is both large in money and in proportion. */
export const HINT_MIN_GAP_CENTS = 100_000;
export const HINT_MIN_GAP_RATIO = 0.25;

export type SavingHint = {
  count: number;
  /** Median monthly cash saving of the comparable intervals, cents. */
  historical_cents: string;
  entered_cents: string;
  direction: 'higher' | 'lower';
  window_from: string | null;
  latest_date: string;
};

/**
 * A reminder, never a replacement: the user's own estimate stays authoritative and
 * the history is never copied into the plan. Needs at least three comparable
 * intervals (same bar as the review's historical reference) and a recorded estimate.
 */
export function savingHint(review: PlanReview | null, enteredCents: string | null): SavingHint | null {
  const stats = review?.stats;
  if (!stats || enteredCents === null || stats.low_sample || !stats.latest_date) return null;
  const historical = stats.median_monthly_cash_saving_cents;
  if (historical == null) return null;
  const h = Number(historical), e = Number(enteredCents);
  if (!Number.isFinite(h) || !Number.isFinite(e)) return null;
  const gap = Math.abs(h - e);
  if (gap < HINT_MIN_GAP_CENTS || gap < HINT_MIN_GAP_RATIO * Math.max(Math.abs(h), Math.abs(e))) return null;
  return { count: stats.count, historical_cents: historical, entered_cents: enteredCents, direction: h > e ? 'higher' : 'lower', window_from: stats.window_from, latest_date: stats.latest_date };
}

export const savingHintKey = 'thingary.saving-hint.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** Dismissal lasts until the next check-in changes the statistics. Per-viewer convenience only. */
export function savingHintDismissed(storage: Store | null, generation: string, hint: SavingHint): boolean {
  try { return storage?.getItem(savingHintKey) === `${generation}:${hint.latest_date}`; } catch { return false; }
}
export function dismissSavingHint(storage: Store | null, generation: string, hint: SavingHint) {
  try { storage?.setItem(savingHintKey, `${generation}:${hint.latest_date}`); } catch { /* the hint simply returns next visit */ }
}
