import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openSourceRequest } from './source';
import type { SourceProps, SourceResolver } from './source';
/**
 * Consume a stable-ID source once the page has its own data (generation set).
 * The resolver contract: re-read by ID (a previously loaded list may be older
 * than a same-generation correction), check alive() after every await, and only
 * then open the record. A late or superseded request publishes nothing.
 */
export function useSource({ source, onSourceDone }: SourceProps, generation: string | undefined, resolve: SourceResolver) {
  const resolver = useRef(resolve); resolver.current = resolve;
  const done = useRef(onSourceDone); done.current = onSourceDone;
  const [error, setError] = useState('');
  useEffect(() => {
    if (!source || !generation) return;
    let live = true;
    setError('');
    void openSourceRequest(
      source,
      generation,
      (target, g) => invoke('validate_source', { target, generation: g }),
      (target, alive) => resolver.current(target, alive),
      () => live,
    ).then(outcome => {
      if (!live) return;
      if (outcome.state === 'failed') { setError(outcome.message); done.current?.(outcome.message); }
      else if (outcome.state === 'applied') done.current?.();
    });
    return () => { live = false; };
  }, [source?.token, generation]);
  return error;
}
