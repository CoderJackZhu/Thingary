import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useCovered } from '../nav-context';
import { Icon } from './Icon';
import { isPull, pullDistance, pullTrigger, shouldRefresh } from './pull-refresh';

/**
 * Pull down from the top of a tab page to run `onRefresh` (the page's own reload). Adds no wrapper element:
 * it listens on the document and draws a small spinner at the top while pulling. Skipped while a sheet or
 * modal covers the page, and when the finger starts inside a horizontally swiped row.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => void | Promise<void>; children: ReactNode }) {
  const covered = useCovered();
  const [pull, setPull] = useState(0), [busy, setBusy] = useState(false);
  const refresh = useRef(onRefresh), state = useRef<{ x: number; y: number; active: boolean; distance: number } | null>(null), running = useRef(false);
  refresh.current = onRefresh;
  useEffect(() => {
    if (covered) return;
    const top = () => window.scrollY || document.documentElement.scrollTop || 0;
    const start = (event: TouchEvent) => {
      const target = event.target as Element | null;
      if (running.current || event.touches.length !== 1 || top() > 0 || target?.closest('.m-swipe-content, .m-sheet-layer, .m-modal, input[type=range], textarea')) { state.current = null; return; }
      state.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, active: false, distance: 0 };
    };
    const move = (event: TouchEvent) => {
      const s = state.current; if (!s) return;
      const dx = event.touches[0].clientX - s.x, dy = event.touches[0].clientY - s.y;
      if (!s.active) { if (Math.abs(dx) > 12 && Math.abs(dx) > dy) { state.current = null; return; } if (!isPull(top(), dx, dy)) return; s.active = true; }
      s.distance = pullDistance(dy); setPull(s.distance);
    };
    const end = () => {
      const s = state.current; state.current = null;
      if (!s?.active) return;
      if (!shouldRefresh(s.distance)) { setPull(0); return; }
      running.current = true; setBusy(true); setPull(pullTrigger);
      const minimum = new Promise(done => setTimeout(done, 600));
      Promise.resolve().then(() => refresh.current()).catch(() => undefined).then(() => minimum).finally(() => { running.current = false; setBusy(false); setPull(0); });
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end); };
  }, [covered]);
  const shown = busy || pull > 0;
  return <>
    {shown && <div className={`m-ptr${busy ? ' m-ptr-busy' : ''}`} role="status" aria-label={busy ? '正在刷新' : '下拉刷新'} style={{ transform: `translate(-50%, ${pull - 44}px)`, opacity: Math.min(1, pull / 40) }}>
      <span style={busy ? undefined : { transform: `rotate(${Math.min(pull / pullTrigger, 1) * 270}deg)` }}><Icon name="refresh" size={20} strokeWidth={2.2}/></span>
    </div>}
    {children}
  </>;
}
