import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { HistorySync } from './history';
import { activeStack, initialNav, navReducer } from './nav';
import type { Entry, NavState } from './nav';
import { routeDef, routeKind, tabRoot } from './routes';
import type { ModuleFlags, Params, RouteName, TabId } from './routes';

/** Navigation commands for pages. All are ignored while navigation is blocked (saving or an unknown receipt). */
export type Nav = {
  tab: TabId;
  /** Open a page, modal or sheet by registered route name; its kind decides how it appears. */
  push: (route: RouteName, params?: Params, options?: { title?: string }) => void;
  /** Go back one page, or dismiss the top modal or sheet. */
  pop: () => void;
  /** Swap the top entry (for example after saving a new item, open its detail instead of the form). */
  replace: (route: RouteName, params?: Params) => void;
  popToRoot: () => void;
  /** Open a tab at its root; for the current tab, pop to its root, or scroll to top when already there. */
  switchTab: (tab: TabId) => void;
  /** Change the top segment of a tab root (物品 / 心愿 / 统计). */
  setSegment: (route: RouteName) => void;
  blocked: boolean;
};
export type NavValue = { state: NavState; nav: Nav };
const NavContext = createContext<NavValue | null>(null);
const EntryContext = createContext<{ entry: Entry; index: number; stack: Entry[] } | null>(null);

export type InitialRoute = { tab?: TabId; route?: RouteName; params?: Params };

/** Holds one page stack per tab and mirrors pushes into browser history. */
export function NavProvider({ children, modules, blocked, initial }: { children: ReactNode; modules: ModuleFlags | null; blocked: boolean; initial?: InitialRoute }) {
  const [state, dispatch] = useReducer(navReducer, undefined, () => {
    const def = initial?.route ? routeDef(initial.route) : undefined;
    const tab = def?.tab ?? initial?.tab ?? 'overview';
    return initialNav(tab, tabRoot(tab, modules), def && initial?.route ? { name: initial.route, params: initial.params } : undefined);
  });
  const live = useRef({ state, blocked, modules });
  live.current = { state, blocked, modules };
  const sync = useRef<HistorySync | null>(null);
  useEffect(() => {
    const history = new HistorySync(window.history, steps => {
      if (live.current.blocked) return false;
      dispatch({ type: 'pop', count: steps });
      return true;
    });
    sync.current = history;
    const onPop = (event: PopStateEvent) => history.handlePop(event.state);
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); sync.current = null; };
  }, []);
  const nav = useMemo<Nav>(() => ({
    tab: state.tab, blocked,
    push: (route, params, options) => { if (live.current.blocked) return; dispatch({ type: 'push', route, params, title: options?.title }); sync.current?.push(); },
    pop: () => {
      if (live.current.blocked || activeStack(live.current.state).length < 2) return;
      dispatch({ type: 'pop' }); sync.current?.back();
    },
    replace: (route, params) => { if (!live.current.blocked) dispatch({ type: 'replace', route, params }); },
    popToRoot: () => {
      const extra = activeStack(live.current.state).length - 1;
      if (live.current.blocked || extra < 1) return;
      dispatch({ type: 'popToRoot' }); sync.current?.back(extra);
    },
    switchTab: tab => {
      const { blocked: isBlocked, state: now, modules: mods } = live.current;
      if (isBlocked) return;
      const extra = activeStack(now).length - 1;
      if (tab !== now.tab) { dispatch({ type: 'switch', tab, root: tabRoot(tab, mods) }); sync.current?.back(extra); }
      else if (extra > 0) { dispatch({ type: 'popToRoot' }); sync.current?.back(extra); }
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    setSegment: route => { if (!live.current.blocked) dispatch({ type: 'root', route }); },
  }), [state.tab, blocked]);
  const value = useMemo(() => ({ state, nav }), [state, nav]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNavState(): NavValue {
  const value = useContext(NavContext);
  if (!value) throw new Error('useNav needs a NavProvider');
  return value;
}
/** Navigation commands: `const nav = useNav(); nav.push('items.detail', { id })`. */
export const useNav = (): Nav => useNavState().nav;

export function EntryProvider({ stack, index, children }: { stack: Entry[]; index: number; children: ReactNode }) {
  const value = useMemo(() => ({ entry: stack[index], index, stack }), [stack, index]);
  return <EntryContext.Provider value={value}>{children}</EntryContext.Provider>;
}
/** The stack entry the calling page is rendered for: its route, params and the title to show as a back label. */
export function useEntry() {
  const value = useContext(EntryContext);
  if (!value) throw new Error('useEntry must be used inside a page');
  const { entry, index, stack } = value;
  const previous = stack[index - 1];
  return {
    entry, params: entry.params, kind: routeKind(entry.route), isRoot: index === 0,
    /** Label for the back button: the title of the page below. */
    backTitle: previous ? previous.title ?? routeDef(previous.route)?.title ?? '返回' : undefined,
    title: entry.title ?? routeDef(entry.route)?.title ?? '',
  };
}
/** Changes each time a page or sheet opened above this one is dismissed; use it as an effect dependency to reload. */
export const useReveal = (): number => useEntry().entry.reveal;

