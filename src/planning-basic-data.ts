// Loading and scoped saving for the basic planning pages. One native read, one save path, no UI-side facts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset.ts';
import type { Modules } from './modules.ts';
import type { PlanningSources, ProfileUpdate } from './plan.ts';
import { planningReadSession, readPlanningSources, savePlanningSection } from './planning-service.ts';
import { readCapabilities } from './planning-basic-port.ts';
import type { CapabilityOptions, CapabilityResult } from './planning-basic-port.ts';
import { Unresolved, storedPending } from './wealth.ts';

export type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; sources: PlanningSources };
/**
 * Reloading keeps the last good sources visible; an error replaces them so stale data is never shown as current.
 * The first read adopts the dataset generation; later reads must match it, and a library change remounts the page.
 */
export function usePlanningSources(refreshKey?: string) {
  const session = useMemo(() => planningReadSession(), []), baseline = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0), [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    (async () => {
      const modules = await invoke<Modules>('modules_get');
      const wanted = { planning: modules?.planning ?? true, wealth: modules?.wealth ?? true };
      const next = baseline.current === null ? await readPlanningSources(wanted) : await session.load(baseline.current, wanted);
      if (!live) return;
      if (next && baseline.current === null) baseline.current = next.generation;
      setLoad(next ? { status: 'ready', sources: next } : { status: 'error', message: '资料库已变化，请重新读取。' });
    })().catch(e => { if (live) setLoad({ status: 'error', message: errorMessage(e) }); });
    return () => { live = false; session.invalidate(); };
  }, [attempt, session, refreshKey]);
  return { load, reload: useCallback(() => setAttempt(n => n + 1), []) };
}

export const useCapabilities = (sources: PlanningSources, options: Partial<CapabilityOptions> = {}): CapabilityResult => useMemo(() => readCapabilities(sources, options), [sources, options.contribution, options.drafts]); // eslint-disable-line react-hooks/exhaustive-deps

type Strip<T> = T extends unknown ? Omit<T, 'request_id' | 'generation' | 'expected_revision'> : never;
export type SectionInput = Strip<ProfileUpdate>;
/**
 * One request per user action. A lost reply keeps the original request in the stored receipt (see submit);
 * `stuck` locks further writes until the receipt is checked, so retrying never creates a second request.
 */
export function useSectionSaver(sources: PlanningSources, reload: () => void, onPending: () => void) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  const lock = useRef(false);
  const revision = sources.profile.status === 'ready' ? sources.profile.value.saved?.revision ?? null : null;
  async function save(input: SectionInput, expected: number | null = revision): Promise<{ revision: number } | null> {
    if (lock.current || stuck) return null;
    if (storedPending()) { setNotice('还有提交结果待核对，请先在页面上核对原请求。'); onPending(); return null; }
    lock.current = true; setBusy(true); setNotice('');
    try {
      const saved = await savePlanningSection({ ...input, request_id: crypto.randomUUID(), generation: sources.generation, expected_revision: expected } as ProfileUpdate);
      onPending(); reload(); return saved;
    } catch (e) {
      if (e instanceof Unresolved) setStuck(true);
      setNotice(e instanceof Error ? e.message : errorMessage(e)); onPending(); return null;
    } finally { lock.current = false; setBusy(false); }
  }
  return { busy, notice, stuck, save, clear: () => setNotice('') };
}
export type SectionSaver = ReturnType<typeof useSectionSaver>;
