/** Local screen privacy, deliberately independent of library data and IPC. */
export const coverKey = 'thingary.privacy-cover.v1';
export const lockKey = 'thingary.privacy-lock.v1';
export const idleMinutes = [0, 5, 15, 60] as const;
export type LockPreference = { enabled: boolean; idleMinutes: number };
export type PrivacyStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function parseLockPreference(value: string | null): LockPreference {
  try {
    const parsed = JSON.parse(value ?? 'null');
    if (typeof parsed?.enabled === 'boolean' && idleMinutes.includes(parsed.idleMinutes)) return { enabled: parsed.enabled, idleMinutes: parsed.idleMinutes };
  } catch { /* Damaged preferences default to off. */ }
  return { enabled: false, idleMinutes: 0 };
}
export function readLockPreference(storage: PrivacyStorage | null): LockPreference {
  try { return parseLockPreference(storage?.getItem(lockKey) ?? null); } catch { return parseLockPreference(null); }
}
export function readCoverPreference(storage: PrivacyStorage | null): boolean {
  try { return storage?.getItem(coverKey) === 'true'; } catch { return false; }
}
export function writePrivacyPreference(storage: PrivacyStorage | null, key: string, value: boolean | LockPreference): boolean {
  try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export type PrivacyState = { locked: boolean; mounted: boolean; away: boolean; lastActivity: number; deferred: boolean };
export type PrivacyEvent = { type: 'away' | 'activity' | 'unlock' | 'disable'; now: number } | { type: 'return' | 'settled'; now: number; busy: boolean };
export function initialPrivacyState(preference: LockPreference, now: number): PrivacyState {
  return { locked: preference.enabled, mounted: !preference.enabled, away: false, lastActivity: now, deferred: false };
}
export function privacyTransition(state: PrivacyState, event: PrivacyEvent, preference: LockPreference): PrivacyState {
  if (event.type === 'unlock' || event.type === 'disable') return { ...state, locked: false, mounted: true, lastActivity: event.now, deferred: false };
  if (event.type === 'away') return { ...state, away: true };
  if (event.type === 'activity') return state.locked || state.away ? state : { ...state, lastActivity: event.now };
  const busy = 'busy' in event && event.busy;
  const expired = preference.enabled && preference.idleMinutes > 0 && event.now - state.lastActivity >= preference.idleMinutes * 60000;
  const requested = state.deferred || (event.type === 'return' && state.away && expired);
  return { ...state, away: event.type === 'return' ? false : state.away, deferred: requested && busy, locked: state.locked || (requested && !busy) };
}
export const shouldCover = (enabled: boolean, state: PrivacyState): boolean => enabled && state.away;
export const mayReadLibrary = (state: PrivacyState): boolean => state.mounted && !state.locked;

// Event callbacks consult this synchronously so menu actions received while
// locked are discarded, including the interval before React commits the view.
let screenBlocked = false;
export function setPrivacyScreenBlocked(value: boolean) { screenBlocked = value; }
export function privacyMenuAllowed(): boolean { return !screenBlocked; }
