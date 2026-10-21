import { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { ModulesProvider, useModules } from './modules-context';
import { EntryProvider, NavProvider, useNavState } from './nav-context';
import type { InitialRoute } from './nav-context';
import { activeStack } from './nav';
import { routeDef, routeKind, visibleSegments, visibleTabs } from './routes';
import { SessionProvider, useSession } from './session';
import { ErrorBoundary } from './ErrorBoundary';
import { pageFor } from './router';
import { TabBar } from './TabBar';
import { Loading, Notice, SegmentedControl, Sheet } from './ui';
import { Button } from './ui';

/** The whole iPhone app: module switches, wealth session, per-tab page stacks, tab bar. */
export function MobileApp({ initial }: { initial?: InitialRoute }) {
  const recovery = useRef<HTMLElement>(null);
  return <ModulesProvider><SessionProvider onFocusRecovery={() => setTimeout(() => recovery.current?.focus(), 0)}><Gate initial={initial} recovery={recovery}/></SessionProvider></ModulesProvider>;
}

function Gate({ initial, recovery }: { initial?: InitialRoute; recovery: RefObject<HTMLElement | null> }) {
  const { modules } = useModules(), { navBlocked } = useSession();
  return <NavProvider modules={modules} blocked={navBlocked} initial={initial}><Shell recovery={recovery}/></NavProvider>;
}

function Page({ stack, index }: { stack: ReturnType<typeof activeStack>; index: number }) {
  const entry = stack[index], Component = pageFor(entry.route);
  return <EntryProvider stack={stack} index={index}><ErrorBoundary resetKey={entry.id}><Suspense fallback={<Loading/>}><Component params={entry.params}/></Suspense></ErrorBoundary></EntryProvider>;
}

function Shell({ recovery }: { recovery: RefObject<HTMLElement | null> }) {
  const { state, nav } = useNavState(), session = useSession(), { modules } = useModules();
  const stack = activeStack(state);
  // The page shown is the topmost 'page' entry; modals and sheets above it layer over it.
  let base = stack.length - 1;
  while (base > 0 && routeKind(stack[base].route) !== 'page') base--;
  const overlays = stack.slice(base + 1), baseEntry = stack[base];
  const fullscreen = !!routeDef(baseEntry.route)?.fullscreen;
  const segments = visibleSegments(state.tab, modules);

  // A tab whose module was switched off is no longer reachable: fall back to the overview.
  const tabs = visibleTabs(modules);
  useEffect(() => { if (!tabs.some(tab => tab.id === state.tab)) nav.switchTab('overview'); }, [tabs.length, state.tab]);
  useEffect(() => { session.setNotice(''); }, [state.tab]);

  // Scroll position is remembered per page entry; focus moves to the new page for VoiceOver.
  const scrolls = useRef(new Map<number, number>()), current = useRef(baseEntry.id), first = useRef(true), main = useRef<HTMLElement>(null);
  useEffect(() => {
    const onScroll = () => scrolls.current.set(current.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    current.current = baseEntry.id;
    window.scrollTo(0, scrolls.current.get(baseEntry.id) ?? 0);
    if (first.current) first.current = false; else main.current?.focus({ preventScroll: true });
  }, [baseEntry.id]);

  const covered = overlays.length > 0, locked = !!session.pending;
  return <div className="m-app">
    <main id="mobile-content" className="m-main" tabIndex={-1} ref={main} inert={covered || locked} data-tab={state.tab}>
      {baseEntry.id === stack[0].id && segments.length > 1 && <div className="m-segment-bar"><SegmentedControl label="分段" items={segments.map(segment => ({ id: segment.route, label: segment.label }))} value={segments.some(segment => segment.route === baseEntry.route) ? baseEntry.route : segments[0].route} onChange={route => nav.setSegment(route)}/></div>}
      <Page stack={stack} index={base}/>
    </main>
    {overlays.map((entry, i) => {
      const index = base + 1 + i, last = i === overlays.length - 1, def = routeDef(entry.route);
      const title = entry.title ?? def?.title ?? '';
      return routeKind(entry.route) === 'sheet'
        ? <div key={entry.id} inert={!last || locked}><Sheet title={title} onClose={() => nav.pop()}><Page stack={stack} index={index}/></Sheet></div>
        : <div key={entry.id} className="m-modal" role="dialog" aria-modal="true" aria-label={title} inert={!last || locked}><Page stack={stack} index={index}/></div>;
    })}
    {!fullscreen && <div inert={covered || locked}><TabBar tab={state.tab} modules={modules} disabled={nav.blocked} onSelect={nav.switchTab}/></div>}
    {session.pending && <div className="m-recovery-layer"><section className="m-card m-recovery" role="alertdialog" aria-modal="true" aria-label="保存结果核对" tabIndex={-1} ref={recovery}>
      <h2>保存结果未确定</h2><p role="status">「{session.pending.label}」的结果尚未确认。原请求已保留，核对前暂停编辑和切页。</p>
      {session.pending.command === 'financial_import_commit' ? <p>请在桌面版的数据管理中核对金融导入。</p> : <Button variant="primary" block disabled={session.busy} onClick={() => void session.verify()}>{session.busy ? '正在核对…' : '核对结果'}</Button>}
      {session.notice && <Notice>{session.notice}</Notice>}
    </section></div>}
  </div>;
}
