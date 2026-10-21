import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { RuntimeModules } from '../modules';

type ModulesValue = { modules: RuntimeModules | null; reload: () => void };
const Context = createContext<ModulesValue>({ modules: null, reload: () => {} });

/** Reads the feature-module switches (`modules_get`). `null` means not read yet or unreadable: show everything. */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<RuntimeModules | null>(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    invoke<RuntimeModules>('modules_get').then(next => { if (live) setModules(next); }).catch(() => { /* Keep the last known switches; tabs stay visible. */ });
    return () => { live = false; };
  }, [revision]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const value = useMemo(() => ({ modules, reload }), [modules, reload]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
/** Current module switches; call `reload()` after changing them so tabs and segments update. */
export const useModules = (): ModulesValue => useContext(Context);
