// Pure helpers shared by the 总览 and 我的 modules: where a record opens, how to jump to a route, hidden amounts.
import { isRootRoute, routeDef } from '../routes.ts';
import type { Params, RouteName } from '../routes.ts';
import type { SourceTarget } from '../../source.ts';
import type { Nav } from '../nav-context';
import { dayLabel } from '../format.ts';

export type RouteTarget = { route: RouteName; params: Params };

/**
 * The mobile page that opens a stable-ID source record (timeline rows, search results, overview items).
 * Parameters are only IDs; the target page reads the record itself. Pages that are still placeholders ignore them.
 */
export function targetRoute(target: SourceTarget): RouteTarget {
  switch (target.kind) {
    case 'asset': return { route: 'items.detail', params: { id: target.id } };
    case 'wish': return { route: 'wishes.detail', params: { id: target.id } };
    case 'snapshot': return { route: 'wealth.snapshots', params: { id: target.id } };
    case 'account': return { route: 'wealth.account', params: { id: target.id } };
    case 'plan': return { route: 'spending.recurring', params: { id: target.id } };
    case 'payment': return { route: 'spending.recurring', params: { id: target.plan_id, payment: target.id } };
    case 'virtual': return { route: 'spending.virtual', params: { id: target.id } };
    case 'topup': return { route: 'spending.virtual', params: { id: target.asset_id, topup: target.id } };
    case 'expense': case 'income': case 'movement': return { route: 'spending.home', params: { id: target.id, kind: target.kind } };
  }
}

/** Timeline event to a record route: stable target first, then the asset or wish it belongs to. */
export function eventTarget(event: { target?: SourceTarget; asset_id: string | null; wishlist_id: string | null }): RouteTarget | null {
  if (event.target) return targetRoute(event.target);
  if (event.asset_id) return { route: 'items.detail', params: { id: event.asset_id } };
  if (event.wishlist_id) return { route: 'wishes.detail', params: { id: event.wishlist_id } };
  return null;
}

type Navigator = Pick<Nav, 'tab' | 'push' | 'switchTab' | 'setSegment'>;
/**
 * Open a route from anywhere. Tab roots and segment pages (items.list, wealth.overview, plan.goal) switch to
 * their tab and segment; every other page is pushed on the current tab so back returns to where the user was.
 */
export function openRoute(nav: Navigator, route: RouteName, params?: Params): void {
  const def = routeDef(route);
  if (def && isRootRoute(route)) {
    if (def.tab !== nav.tab) nav.switchTab(def.tab);
    nav.setSegment(route);
    return;
  }
  nav.push(route, params);
}

/** Financial amounts the user chose to hide (总览「隐藏金融金额」) read as ****** everywhere on the page. */
export const hiddenAmountText = '******';
export const hideAmountsKey = 'thingary.hide-financial-amounts.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readHideAmounts(storage: Store | null): boolean {
  try { return storage?.getItem(hideAmountsKey) === '1'; } catch { return false; }
}
export function writeHideAmounts(storage: Store | null, hidden: boolean): boolean {
  try { if (!storage) return false; storage.setItem(hideAmountsKey, hidden ? '1' : '0'); return true; } catch { return false; }
}
export const mask = (text: string, hidden: boolean): string => hidden ? hiddenAmountText : text;
export function browserStorage(): Storage | null { try { return localStorage; } catch { return null; } }

/** `2026-10-18` to `10月18日` (with the year when it is not the current one); other text is returned as is. */
export function dayText(date: string, today?: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayLabel(date, today) : date;
}
/** Calendar days from `from` to `to` (both YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
