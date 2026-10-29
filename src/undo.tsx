import { modKey } from './undo-shortcut';
import { privacyMenuAllowed } from './privacy-lock';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './asset';
import { listen } from '@tauri-apps/api/event';
import { undoTarget } from './undo-shortcut';
import { t } from './i18n.ts';
import { pausableTimer } from './pausable-timer';
// D17 rule 6: right after a deletion, one click puts it back. Recently Deleted
// stays the durable path; this bar only covers a click made by mistake.
type Offer = { label: string; run: () => Promise<void | string> };
const offerEvent = 'thingary-undo', restoredEvent = 'thingary-restored';

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
  const timer = useRef<ReturnType<typeof pausableTimer> | null>(null);
  if (!timer.current) timer.current = pausableTimer(() => { setOffer(null); setMessage(''); });
  const version = useRef(0);
  function hideLater(ms: number) { timer.current!.start(ms); }
  useEffect(() => {
    const listener = (e: Event) => { ++version.current; setOffer((e as CustomEvent<Offer>).detail); setMessage(''); setBusy(false); hideLater(10000); };
    window.addEventListener(offerEvent, listener);
    return () => { ++version.current; window.removeEventListener(offerEvent, listener); timer.current!.reset(); };
  }, []);
  useEffect(() => { if (!offer) timer.current!.reset(); }, [offer]);
  const latest = useRef<{ offered: boolean; undo: () => void }>({ offered: false, undo: () => {} });
  useEffect(() => {
    const off = listen<string>('asset-action', event => {
      if (!privacyMenuAllowed() || event.payload !== 'undo') return;
      const target = undoTarget(document.activeElement, !!document.querySelector('dialog[open]'), latest.current.offered);
      // execCommand is WebKit's route into the field's own undo stack.
      if (target === 'text') document.execCommand('undo');
      if (target === 'deletion') latest.current.undo();
    });
    return () => { void off.then(stop => stop()); };
  }, []);
  async function undo() {
    if (!offer || busy) return;
    const current = version.current;
    setBusy(true); timer.current!.cancel();
    try {
      const result = await offer.run();
      if (current === version.current) setMessage(result || t('已撤销删除。'));
      window.dispatchEvent(new Event(restoredEvent));
    }
    catch (e) { if (current === version.current) setMessage(errorMessage(e) + t(' 可以到“最近删除”恢复。')); }
    finally { if (current === version.current) { setBusy(false); hideLater(4000); } }
  }
  latest.current = { offered: !!offer && !message && !busy, undo: () => void undo() };
  if (!offer) return null;
  return <div className="undo-bar" role="status"
    onMouseEnter={() => timer.current!.pause('hover')} onMouseLeave={() => timer.current!.resume('hover')}
    onFocusCapture={() => timer.current!.pause('focus')} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) timer.current!.resume('focus'); }}>
    <span>{message || offer.label}</span>
    {!message && <button type="button" disabled={busy} onClick={() => void undo()}>{busy ? t('正在撤销…') : <>{t('撤销')}<kbd>{modKey()}Z</kbd></>}</button>}
  </div>;
}
