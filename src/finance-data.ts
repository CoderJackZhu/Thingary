import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './asset';
import type { FinancePeriod } from './finance-contract';
import type { RuntimeModules } from './modules';
import { financeReadSession, type FinanceSources, type FinanceView } from './finance-service';
import { t } from './i18n.ts';
export type FinanceLoad = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; sources: FinanceSources };
/** Scope identity is checked during render, so old facts disappear before effects run. */
export function useFinanceSources(generation: string, period: FinancePeriod, modules: RuntimeModules, view: FinanceView = 'standard') {
  const sessionRef = useRef<ReturnType<typeof financeReadSession> | null>(null);
  if (!sessionRef.current) sessionRef.current = financeReadSession();
  const session = sessionRef.current;
  const scope = JSON.stringify([generation, period, modules, view]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ scope: string; attempt: number; load: FinanceLoad } | null>(null);
  const reloadRef = useRef(() => setAttempt(n => n + 1));
  useEffect(() => {
    let live = true;
    session.load(generation, period, modules, view).then(sources => {
      if (live) setState({ scope, attempt, load: sources ? { status: 'ready', sources } : { status: 'error', message: t('资料库、期间或功能模块已变化，请重新读取。') } });
    }).catch(error => { if (live) setState({ scope, attempt, load: { status: 'error', message: errorMessage(error) } }); });
    return () => { live = false; session.invalidate(); };
  }, [scope, attempt, session]);
  const load: FinanceLoad = state?.scope === scope && state.attempt === attempt ? state.load : { status: 'loading' };
  return { load, reload: reloadRef.current };
}
