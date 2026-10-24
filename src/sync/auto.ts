// Conventional "it just syncs" behaviour on top of the manual commands: when the app opens,
// comes back to the foreground or goes to the background it looks at the cloud (read-only),
// uploads local changes when that is a plain fast-forward and the passphrase is remembered,
// and otherwise only reports. It never replaces local data: a newer cloud version or a
// conflict is surfaced for the person to confirm in 设置 › 数据管理.
import { useEffect, useSyncExternalStore } from 'react';
import { syncConfigGet, syncPush, syncStatus } from './api';

export type AutoSyncPhase = 'off' | 'idle' | 'syncing' | 'synced' | 'remote_ahead' | 'conflict' | 'local_ahead' | 'error';
export type AutoSyncState = { phase: AutoSyncPhase; at: number | null };

const RECHECK_MS = 5 * 60 * 1000;
let state: AutoSyncState = { phase: 'off', at: null };
let running = false;
let lastRun = 0;
const listeners = new Set<() => void>();
const set = (next: AutoSyncState) => { state = next; listeners.forEach(listener => listener()); };

const phaseOf = (state: string): AutoSyncPhase => state === 'up_to_date' ? 'synced'
  : state === 'remote_ahead' ? 'remote_ahead'
  : state === 'conflict' ? 'conflict'
  : state === 'local_ahead' || state === 'empty_remote' ? 'local_ahead' : 'idle';

/** Lets the settings screen keep the sidebar status in step with what it just did. */
export function reportSync(enabled: boolean, state: string | null): void {
  set(!enabled ? { phase: 'off', at: null } : state ? { phase: phaseOf(state), at: Date.now() } : { phase: 'idle', at: state === null ? null : Date.now() });
}

/** Runs one cycle; safe to call often, it never overlaps itself. */
export async function runAutoSync(force = false): Promise<void> {
  if (running || (!force && Date.now() - lastRun < RECHECK_MS)) return;
  running = true; lastRun = Date.now();
  try {
    const config = await syncConfigGet();
    if (!config.enabled || !config.auto_check || config.has_pending_push) { set({ phase: config.enabled ? 'idle' : 'off', at: null }); return; }
    set({ phase: 'syncing', at: state.at });
    let status = await syncStatus();
    if (status.state === 'local_ahead' && config.has_remembered_passphrase) {
      await syncPush();
      status = await syncStatus();
    }
    set({ phase: phaseOf(status.state), at: Date.now() });
  } catch {
    set({ phase: 'error', at: state.at });
  } finally {
    running = false;
  }
}

export function useAutoSync(): AutoSyncState {
  useEffect(() => {
    void runAutoSync(true);
    const onVisibility = () => { void runAutoSync(document.visibilityState === 'hidden'); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
}
