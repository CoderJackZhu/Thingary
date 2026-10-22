import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { moneyText } from '../format';
import { currencyAmount, currencyCode, rateLabel } from '../../currency';
import type { CurrencyFact } from '../../currency';
import { holdingText } from '../../holdings';
import { storedPending, submit } from '../../wealth';
import type { Account, Pending } from '../../wealth';
import type { AccountGroupList } from '../../account-groups';
import { useSession } from '../session';
import { useReveal } from '../nav-context';
import { ErrorState, Loading, Notice } from '../ui';
import './wealth.css';
import { t } from '../../i18n.ts';
/** Hide old values while a key or generation changes; cancel every late response. */
export function useRead<T>(key: string, read: () => Promise<T>) {
  const reveal = useReveal(), [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key: '' });
  useEffect(() => { let live = true; setState(old => old.key === key ? {key,value:old.value} : {key}); read().then(value => { if (live) setState({ key, value }); }).catch(e => { if (live) setState({ key, error: errorMessage(e) }); }); return () => { live = false; }; }, [key, reveal, retry]);
  return { value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined, reload: () => setRetry(n => n + 1) };
}
export function useGroups() {
  const session = useSession(), generation = session.data?.summary.generation;
  return useRead(`groups:${generation}:${session.data?.summary.points.at(-1)?.snapshot_id}`, async () => {
    const result = await invoke<AccountGroupList>('account_groups_list');
    if (!generation || result.generation !== generation) throw Error(t('账户资料已变化，请重新读取。'));
    return result.groups;
  });
}
export function ReadState({ error, reload, loading }: { error?: string; reload: () => void; loading?: boolean }) {
  return error ? <ErrorState title={t('资料读取失败')} message={error} onRetry={reload}/> : loading ? <Loading label={t('正在读取账户资料…')}/> : null;
}
export function WealthGate({ children }: { children: ReactNode }) {
  const s = useSession();
  return <>{s.notice && <Notice>{s.notice}</Notice>}<ReadState error={s.error} reload={s.reload} loading={s.loading && !s.data}/>{!s.error && s.data && children}</>;
}
export function factText(fact: CurrencyFact | null | undefined, account?: Account): string {
  if (fact?.amount_cents == null) return t('未知');
  const currency = currencyCode(account?.fields.currency), holding = holdingText(fact, account?.fields.holding_mode ? account.fields.holding_unit ?? t('份') : null, currency);
  const amount = currency === 'CNY' ? moneyText(fact.amount_cents) : t('{v1} ≈ {v2} · 汇率 {v3}', { v1: fact.original_minor == null ? '原币未知' : currencyAmount(currency, fact.original_minor), v2: moneyText(fact.amount_cents), v3: fact.fx_rate_micro ? rateLabel(fact.fx_rate_micro) : '未知' });
  return holding ? `${holding} = ${amount}` : amount;
}
/** Extra facts behind a CNY amount that is already shown elsewhere (hero title): holding, original currency and rate. */
export function factDetail(fact: CurrencyFact | null | undefined, account?: Account): string | undefined {
  if (fact?.amount_cents == null) return undefined;
  const currency = currencyCode(account?.fields.currency), holding = holdingText(fact, account?.fields.holding_mode ? account.fields.holding_unit ?? t('份') : null, currency);
  const parts: string[] = [];
  if (holding) parts.push(holding);
  if (currency !== 'CNY') {
    if (!holding) parts.push(fact.original_minor == null ? t('原币未知') : currencyAmount(currency, fact.original_minor));
    parts.push(t('汇率 {v1}', { v1: fact.fx_rate_micro ? rateLabel(fact.fx_rate_micro) : '未知' }));
  }
  return parts.join(' · ') || undefined;
}
/** A single write, a single request identity, shared receipt recovery. Navigation waits for busy to clear. */
export function useWrite(onSaved: () => void, onFailure?: (error: unknown) => void) {
  const session = useSession(), lock = useRef(false), request = useRef<string | null>(null);
  const [done, setDone] = useState(false), [error, setError] = useState('');
  const callback = useRef(onSaved); callback.current = onSaved;
  const failure = useRef(onFailure); failure.current = onFailure;
  useEffect(() => {
    if (!session.navBlocked && (done || (request.current && session.settled?.input.request_id === request.current))) {
      request.current = null; setDone(false); session.reload(); callback.current();
    }
  }, [done, session.navBlocked, session.settled]);
  async function write(pending: Pending) {
    if (lock.current || session.navBlocked || session.loading || storedPending()) return;
    lock.current = true; request.current = pending.input.request_id; session.setBusy(true); setError('');
    try { await submit(pending); setDone(true); }
    catch (e) { setError(errorMessage(e)); session.refreshPending(); failure.current?.(e); }
    finally { lock.current = false; session.setBusy(false); }
  }
  return { write, error, setError, frozen: session.navBlocked || session.loading || done };
}
