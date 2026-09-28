import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './asset';

// D17 rule 6: right after a deletion, one click puts it back. Recently Deleted
// stays the durable path; this bar only covers a click made by mistake.
type Offer = { label: string; run: () => Promise<void> };
const offerEvent = 'possio-undo', restoredEvent = 'possio-restored';

export function offerUndo(label: string, run: () => Promise<void>) {
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
  async function undo() {
    if (!offer || busy) return;
    setBusy(true); window.clearTimeout(timer.current);
    try { await offer.run(); setMessage('已撤销删除。'); window.dispatchEvent(new Event(restoredEvent)); }
    catch (e) { setMessage(errorMessage(e) + ' 可以到“最近删除”恢复。'); }
    finally { setBusy(false); hideLater(4000); }
  }
  if (!offer) return null;
  return <div className="undo-bar" role="status">
    <span>{message || offer.label}</span>
    {!message && <button type="button" disabled={busy} onClick={() => void undo()}>{busy ? '正在撤销…' : '撤销'}</button>}
  </div>;
}
