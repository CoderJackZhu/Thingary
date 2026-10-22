import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, localDay } from '../asset';
import { resolvePending, storedPending } from '../wealth';
import type { Pending } from '../wealth';
import { readMobile } from './service';
import type { MobileData } from './service';

export type Session = {
  today: string;
  /** Wealth read for the current day (summary, accounts, draft); null until loaded. */
  data: MobileData | null; loading: boolean; error: string; reload: () => void;
  /** A save whose outcome is unknown: pages must pause editing and navigation until it is verified. */
  pending: Pending | null; settled: Pending | null; busy: boolean; setBusy: (busy: boolean) => void;
  /** Re-read the stored receipt after a save call that may not have finished. */
  refreshPending: () => void; verify: () => Promise<void>;
  notice: string; setNotice: (text: string) => void;
  /** Navigation is paused while saving or while a receipt is unresolved. */
  navBlocked: boolean;
};
const Context = createContext<Session | null>(null);

/** Shared wealth read and the unknown-save recovery flow (`submit` / `storedPending` / `resolvePending`). */
export function SessionProvider({ children, onFocusRecovery }: { children: ReactNode; onFocusRecovery?: () => void }) {
  const [data, setData] = useState<MobileData | null>(null), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(storedPending), [notice, setNotice] = useState('');
  const [settled, setSettled] = useState<Pending | null>(null);
  const checking = useRef(false);
  const today = localDay();
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    readMobile(today).then(next => { if (live) setData(next); }).catch(cause => { if (live) setError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [revision, today]);
  useEffect(() => { setSettled(null); }, [data?.summary.generation]);
  function refreshPending() {
    const next = storedPending(); setPending(next);
    if (next) { onFocusRecovery?.(); window.scrollTo(0, 0); }
  }
  async function verify() {
    if (!pending || checking.current || pending.command === 'financial_import_commit') return;
    checking.current = true; setBusy(true); setNotice('');
    try {
      const outcome = await resolvePending(pending);
      if (outcome === 'saved') setSettled(pending);
      setNotice(outcome === 'saved' ? '已确认保存。请核对已更新余额，再继续剩余账户。' : outcome === 'unsaved' ? '已确认没有保存，当前输入保留，请核对后重新提交。' : '资料库已切换，请重新核对当前账户。');
      setPending(storedPending()); reload();
    } catch (cause) { setNotice(errorMessage(cause) + ' 原请求已保留，请稍后重试核对。'); }
    finally { checking.current = false; setBusy(false); }
  }
  const value: Session = { today, data, loading, error, reload, pending, settled, busy, setBusy, refreshPending, verify, notice, setNotice, navBlocked: busy || !!pending };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession(): Session {
  const value = useContext(Context);
  if (!value) throw new Error('useSession needs a SessionProvider');
  return value;
}
