import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './asset';
import { listen } from '@tauri-apps/api/event';
import { undoTarget } from './undo-shortcut';

// D17 rule 6: right after a deletion, one click puts it back. Recently Deleted
// stays the durable path; this bar only covers a click made by mistake.
type Offer = { label: string; run: () => Promise<void | string> };
const offerEvent = 'possio-undo', restoredEvent = 'possio-restored';

/** `run` may return its own result line, e.g. how many items were skipped. */
export function offerUndo(label: string, run: () => Promise<void | string>) {
  window.dispatchEvent(new CustomEvent<Offer>(offerEvent, { detail: { label, run } }));
}

/** Pages reload their data after an undo made elsewhere. */
export function useRestored(reload: () => void) {
  const latest = useRef(reload); latest.current = reload;
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(restoredEvent, listener);
    return () => window.removeEventListener(restoredEvent, listener);
  }, []);
}

export function UndoBar() {
  const [offer, setOffer] = useState<Offer | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  function hideLater(ms: number) { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { setOffer(null); setMessage(''); }, ms); }
  useEffect(() => {
    const listener = (e: Event) => { setOffer((e as CustomEvent<Offer>).detail); setMessage(''); hideLater(10000); };
    window.addEventListener(offerEvent, listener);
    return () => { window.removeEventListener(offerEvent, listener); window.clearTimeout(timer.current); };
  }, []);
  const latest = useRef<{ offered: boolean; undo: () => void }>({ offered: false, undo: () => {} });
  useEffect(() => {
    const off = listen<string>('asset-action', event => {
      if (event.payload !== 'undo') return;
      const target = undoTarget(document.activeElement, !!document.querySelector('dialog[open]'), latest.current.offered);
      // execCommand is WebKit's route into the field's own undo stack.
      if (target === 'text') document.execCommand('undo');
      if (target === 'deletion') latest.current.undo();
    });
    return () => { void off.then(stop => stop()); };
  }, []);
  async function undo() {
    if (!offer || busy) return;
    setBusy(true); window.clearTimeout(timer.current);
    try { setMessage((await offer.run()) || '已撤销删除。'); window.dispatchEvent(new Event(restoredEvent)); }
    catch (e) { setMessage(errorMessage(e) + ' 可以到“最近删除”恢复。'); }
    finally { setBusy(false); hideLater(4000); }
  }
  latest.current = { offered: !!offer && !message && !busy, undo: () => void undo() };
  if (!offer) return null;
  return <div className="undo-bar" role="status">
    <span>{message || offer.label}</span>
    {!message && <button type="button" disabled={busy} onClick={() => void undo()}>{busy ? '正在撤销…' : <>撤销<kbd>⌘Z</kbd></>}</button>}
  </div>;
}
