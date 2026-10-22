// Pure rules for PullToRefresh so the gesture maths can be tested without a DOM.
/** Distance the indicator can travel. */
export const pullMax = 96;
/** Pull distance (after damping) at which letting go refreshes. */
export const pullTrigger = 64;
/** Finger travel `dy` (px, downward) to indicator travel: damped like the system rubber band, capped at `pullMax`. */
export const pullDistance = (dy: number): number => dy <= 0 ? 0 : Math.min(pullMax, Math.round(dy * 0.5));
/** Whether releasing at this pull distance starts a refresh. */
export const shouldRefresh = (distance: number): boolean => distance >= pullTrigger;
/** A drag counts as a pull only when it starts at the very top and moves mostly downward. */
export const isPull = (scrollTop: number, dx: number, dy: number): boolean => scrollTop <= 0 && dy > 8 && dy > Math.abs(dx) * 1.5;
