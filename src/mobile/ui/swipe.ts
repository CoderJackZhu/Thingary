// Pure helpers for SwipeRow so the snap rules can be tested without a DOM.
/** Keep the row between fully closed (0) and fully open (-width). */
export const clampSwipe = (x: number, width: number): number => Math.min(0, Math.max(-width, x));
/** Decide whether a released drag ends open. `velocity` is px/ms, negative toward the actions. */
export function settleSwipe(x: number, width: number, velocity: number): boolean {
  if (velocity <= -0.4) return true;
  if (velocity >= 0.4) return false;
  return clampSwipe(x, width) <= -width / 2;
}
