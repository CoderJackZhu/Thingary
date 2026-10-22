// Pure page-stack state for the iPhone UI: one stack per tab, no React.
import type { Params, RouteName, TabId } from './routes.ts';

export type Entry = {
  id: number; route: RouteName; params: Params;
  /** Overrides the registered title (for example an item name used as the back label). */
  title?: string;
  /** Counts how many times a covering page was dismissed, so the page below can reload. */
  reveal: number;
};
export type NavState = { tab: TabId; stacks: Partial<Record<TabId, Entry[]>>; nextId: number };
export type NavAction =
  | { type: 'push'; route: RouteName; params?: Params; title?: string }
  | { type: 'pop'; count?: number }
  | { type: 'replace'; route: RouteName; params?: Params; title?: string }
  | { type: 'root'; route: RouteName }
  | { type: 'switch'; tab: TabId; root: RouteName }
  | { type: 'popToRoot' };

const entry = (id: number, route: RouteName, params: Params = {}, title?: string): Entry => ({ id, route, params, title, reveal: 0 });

/** Start on a tab root, or directly on `route` with its tab root underneath so back works. */
export function initialNav(tab: TabId, root: RouteName, route?: { name: RouteName; params?: Params }): NavState {
  const stack = [entry(1, root)];
  if (route && route.name !== root) stack.push(entry(2, route.name, route.params));
  return { tab, stacks: { [tab]: stack }, nextId: stack.length + 1 };
}
export const activeStack = (state: NavState): Entry[] => state.stacks[state.tab] ?? [];
export const topEntry = (state: NavState): Entry => activeStack(state).at(-1)!;
export const depth = (state: NavState): number => activeStack(state).length;

export function navReducer(state: NavState, action: NavAction): NavState {
  const stack = activeStack(state);
  const set = (next: Entry[], nextId = state.nextId): NavState => ({ ...state, nextId, stacks: { ...state.stacks, [state.tab]: next } });
  switch (action.type) {
    case 'push': return set([...stack, entry(state.nextId, action.route, action.params, action.title)], state.nextId + 1);
    case 'pop': {
      const count = Math.min(action.count ?? 1, stack.length - 1);
      if (count <= 0) return state;
      const next = stack.slice(0, stack.length - count);
      next[next.length - 1] = { ...next.at(-1)!, reveal: next.at(-1)!.reveal + 1 };
      return set(next);
    }
    case 'popToRoot': return stack.length <= 1 ? state : set([{ ...stack[0], reveal: stack[0].reveal + 1 }]);
    case 'replace': return set([...stack.slice(0, -1), entry(state.nextId, action.route, action.params, action.title)], state.nextId + 1);
    case 'root': return set([entry(state.nextId, action.route)], state.nextId + 1);
    case 'switch': {
      if (action.tab === state.tab) return state;
      // Tabs always open at their root: the left tab's stack is dropped and the target starts fresh.
      const { [state.tab]: _left, ...rest } = state.stacks;
      return { tab: action.tab, stacks: { ...rest, [action.tab]: [entry(state.nextId, action.root)] }, nextId: state.nextId + 1 };
    }
  }
}
