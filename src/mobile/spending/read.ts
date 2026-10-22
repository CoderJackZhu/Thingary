// Reading and saving helpers shared by the spending screens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../asset';
import { storedPending, submit, Unresolved } from '../../wealth';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import { t } from '../../i18n.ts';
export type Read<T> = { data: T | null; error: string; loading: boolean; reload: () => void };
/**
 * Reads on mount, when `key` changes, when a covering page (an editor) is dismissed, and on `reload()`.
 * Late answers of an old request are dropped, so a slow read never overwrites a newer period.
 */
export function useRead<T>(read: () => Promise<T>, key: string): Read<T> {
  const reveal = useReveal(), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string; done: boolean }>({ key: '', data: null, error: '', done: false });
  const latest = useRef(read); latest.current = read;
  useEffect(() => {
    let live = true;
    latest.current().then(data => { if (live) setState({ key, data, error: '', done: true }); }).catch(cause => { if (live) setState({ key, data: null, error: errorMessage(cause), done: true }); });
    return () => { live = false; };
  }, [key, reveal, attempt]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : '', loading: !(current && state.done), reload };
}

export type Saver = {
  busy: boolean; error: string; setError: (message: string) => void;
  /** Runs one save. With `close` the page pops once the save is confirmed; `onDone` runs after a confirmed save. */
  run: (task: (requestId: string) => Promise<unknown>, options?: { close?: boolean; onDone?: () => void }) => Promise<boolean>;
};
/**
 * One save at a time with the shared recovery flow: the stored receipt (`submit`), the session busy flag that
 * pauses navigation, and `refreshPending` when the outcome is unknown. A save closes its page only after the
 * busy flag has been released, because navigation is blocked while saving.
 */
export function useSaver(): Saver {
  const session = useSession(), nav = useNav();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [closing, setClosing] = useState(false);
  const sending = useRef(false), sent = useRef<string | null>(null);
  useEffect(() => { if (closing && !session.busy && !session.pending) nav.pop(); }, [closing, session.busy, session.pending]);
  // A save whose outcome was unknown and has since been verified as saved closes the editor like a normal save.
  useEffect(() => {
    const settled = session.settled;
    if (settled && sent.current && settled.input.request_id === sent.current) { sent.current = null; setClosing(true); }
  }, [session.settled]);
  async function run(task: (requestId: string) => Promise<unknown>, options: { close?: boolean; onDone?: () => void } = {}): Promise<boolean> {
    if (sending.current || storedPending()) return false;
    sending.current = true; setBusy(true); session.setBusy(true); setError('');
    const requestId = crypto.randomUUID();
    sent.current = options.close ? requestId : null;
    try {
      await task(requestId);
      sent.current = null;
      options.onDone?.();
      if (options.close) setClosing(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : errorMessage(cause));
      if (!(cause instanceof Unresolved)) sent.current = null;
      session.refreshPending();
      return false;
    } finally { sending.current = false; setBusy(false); session.setBusy(false); }
  }
  return { busy, error, setError, run };
}

/** Soft delete into 最近删除, same command as the desktop 删除 buttons. */
export function trash(kind: 'expense' | 'income' | 'plan' | 'payment' | 'virtual' | 'topup', id: string, revision: number, generation: string, name: string, requestId: string) {
  return submit<void>({ command: 'wealth_trash', input: { request_id: requestId, generation, kind, id, expected_revision: revision, deleted: true }, label: t('删除') + name });
}
