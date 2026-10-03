import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import type { CommandResult, TaxonomyCommand, TaxonomySnapshot } from './taxonomy';

export interface StoredTaxonomy extends TaxonomySnapshot { generation: string; revision: number }
type Request = { request_id: string; generation: string; expected_revision: number; command: TaxonomyCommand };
const pendingKey = 'thingary.taxonomy-request.v1';
function pendingRequest(): Request | null {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey) || 'null');
    if (typeof value?.request_id === 'string' && typeof value.generation === 'string' && typeof value.expected_revision === 'number' && value.command) return value;
  } catch { /* Invalid reminders never authorize a replay. */ }
  return null;
}
export function useTaxonomy(onChange: () => void) {
  const [snapshot, setSnapshot] = useState<StoredTaxonomy | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pending = useRef<Request | null>(pendingRequest());
  const [blocked, setBlocked] = useState(!!pending.current);
  const lock = useRef(false), current = useRef<StoredTaxonomy | null>(null), changed = useRef(onChange);
  changed.current = onChange;
  function publish(value: StoredTaxonomy) { current.current = value; setSnapshot(value); setLoadError(null); }
  function clearPending() { localStorage.removeItem(pendingKey); pending.current = null; setBlocked(false); }
  async function reload() {
    if (lock.current) throw new Error('请等待当前操作完成。');
    lock.current = true; setLoading(true); setLoadError(null);
    try {
      const fresh = await invoke<StoredTaxonomy>('taxonomy_snapshot');
      if (pending.current) {
        // Changed library: old requests are never replayed into the new generation.
        if (pending.current.generation === fresh.generation) await invoke<boolean>('taxonomy_request', {request: pending.current.request_id, generation: pending.current.generation});
        clearPending();
      }
      publish(fresh); changed.current();
    } catch (e) { setLoadError(errorMessage(e)); throw new Error(errorMessage(e)); }
    finally { lock.current = false; setLoading(false); }
  }
  useEffect(() => { void reload().catch(() => {}); const changed=()=>void reload().catch(()=>{}); window.addEventListener("thingary-choices-changed",changed);return()=>window.removeEventListener("thingary-choices-changed",changed); }, []);
  async function command(command: TaxonomyCommand): Promise<CommandResult> {
    if (lock.current || !current.current || pending.current) return {status:'error',message:'请先重新加载并核对上次操作。',recovery:'reload'};
    lock.current = true; setBusy(true);
    const input: Request = {request_id:crypto.randomUUID(),generation:current.current.generation,expected_revision:current.current.revision,command};
    try {
      // Persist before submitting, and keep this exact request if the response is unknown.
      localStorage.setItem(pendingKey,JSON.stringify(input)); pending.current = input; setBlocked(true);
    } catch {
      lock.current = false; setBusy(false);
      return {status:'error',message:'无法暂存操作请求，尚未提交。请检查可用空间。',recovery:'retry'};
    }
    try {
      const result = await invoke<StoredTaxonomy>('change_taxonomy',{input});
      publish(result); clearPending(); changed.current();
      return {status:'success'};
    } catch (e) {
      try {
        const committed = await invoke<boolean>('taxonomy_request',{request:input.request_id,generation:input.generation});
        if (committed) {
          publish(await invoke<StoredTaxonomy>('taxonomy_snapshot')); clearPending(); changed.current();
          return {status:'success'};
        }
        clearPending();
        const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : '';
        return {status:'error',message:errorMessage(e),recovery:['TAXONOMY_CONFLICT','TAXONOMY_STALE','STALE_DATASET'].includes(String(code)) ? 'reload' : 'retry'};
      } catch { return {status:'error',message:'暂时无法确认操作结果，请重新加载核对；原请求已保留。',recovery:'reload'}; }
    } finally { lock.current = false; setBusy(false); }
  }
  return {snapshot,loading,busy,loadError,blocked,reload,command};
}
