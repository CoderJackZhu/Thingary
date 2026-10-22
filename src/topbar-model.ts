import { t } from './i18n.ts';

/** Pages whose topbar search box is backed by the App's session search words. */
export const searchSections = ['assets', 'wealth', 'expenses', 'finance-records', 'recurring', 'virtual', 'wishlist', 'timeline', 'materials', 'trash'] as const;
export type SearchSection = (typeof searchSections)[number];
export const emptySearches: Record<SearchSection, string> = { assets: '', wealth: '', expenses: '', 'finance-records': '', recurring: '', virtual: '', wishlist: '', timeline: '', materials: '', trash: '' };

export type BarAction = { label: string; plus?: boolean; disabled?: boolean; run: () => void };
export type BarMenuItem = { key: string; label: string; run: () => void };
export type BarMenu = { label: string; items: BarMenuItem[] };
/** `key` names the session search word this box edits; the App owns the value. */
export type BarSearch = { key: SearchSection; placeholder: string };
export type PageBar = {
  primary?: BarAction;
  secondary?: BarAction;
  menu?: BarMenu;
  /** What ⌘N dispatches to; absent means the page takes no ⌘N. */
  newRecord?: BarAction;
  search?: BarSearch;
};

export type NewTarget = 'asset' | 'wishlist' | 'wealth' | 'income' | 'expenses' | 'movement' | 'recurring' | 'virtual';
/** Fixed order per 产品设计 3.5.1; each target appears only if its module is on. */
export function buildNewMenu(modules: { physical?: boolean; wishlist: boolean; wealth: boolean; expenses: boolean; recurring: boolean; virtual: boolean; incomes?: boolean; movements?: boolean }, run: (target: NewTarget) => void): BarMenu {
  const defs: [NewTarget, string, boolean][] = [
    ['asset', '新增物品', modules.physical !== false],
    ['wishlist', '新增心愿', modules.wishlist],
    ['wealth', '新增账户', modules.wealth],
    ['income', '记一笔收入', modules.incomes === true],
    ['expenses', '记一笔支出', modules.expenses],
    ['movement', '记一笔资金流动', modules.wealth && modules.movements === true],
    ['recurring', '新增计划', modules.recurring],
    ['virtual', '新增虚拟资产', modules.virtual],
  ];
  return { label: t('新增记录'), items: defs.filter(([, , on]) => on).map(([key, label]) => ({ key, label, run: () => run(key) })) };
}

/** Return focus to the page heading after a modal closes — only when the
 * native dialog could not (its opener is gone, e.g. after a menu hand-off).
 * Two frames: the first may still race the dialog's unmount cleanup. */
export function refocusHeading() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (document.activeElement !== document.body) return;
    const heading = document.getElementById('page-heading') as HTMLElement | null;
    if (heading) heading.focus();
  }));
}
