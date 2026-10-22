// Route registry for the iPhone UI. One line per route; every module task edits only its own lines.
// Pure data (no React imports) so node tests can load it. Pages load lazily through `load`.
import type { ComponentType } from 'react';
import { financeOff } from '../modules.ts';
import type { Modules } from '../modules.ts';

export type TabId = 'overview' | 'items' | 'wealth' | 'plan' | 'me';
/** page: pushed with a back button. modal: full screen, 取消 + primary action. sheet: bottom sheet over the page. */
export type RouteKind = 'page' | 'modal' | 'sheet';
/** Serializable route arguments, for example { id: 'asset-1' }. */
export type Params = Record<string, string | number | boolean | null | undefined>;
export type PageProps = { params: Params };
export type RouteDef = {
  /** Tab whose page stack owns this route. */
  tab: TabId;
  kind?: RouteKind;
  /** Shown as the back label of pages above it and as the screen's accessible name. */
  title: string;
  /** Design mockup number in docs/design/mobile, shown by the placeholder page. */
  design?: string;
  /** Lazy page module with a default export. Without it the shared placeholder renders. */
  load?: () => Promise<{ default: ComponentType<PageProps> }>;
  /** Hide the tab bar (first-run screens). */
  fullscreen?: boolean;
};

// Replace a placeholder by adding `load: () => import('./<module>/<Page>')` to its line.
export const routes = {
  // 总览
  'home.overview': { tab: 'overview', title: '总览', design: '01', load: () => import('./home/Overview') },
  'welcome': { tab: 'overview', title: '首次打开', design: '25', fullscreen: true, load: () => import('./home/Welcome') },
  // 物品
  'items.list': { tab: 'items', title: '物品', design: '02', load: () => import('./items/ItemList') },
  'items.filter': { tab: 'items', kind: 'sheet', title: '筛选与排序', design: '03', load: () => import('./items/ItemFilter') },
  'items.detail': { tab: 'items', title: '物品详情', design: '04', load: () => import('./items/ItemDetail') },
  'items.edit': { tab: 'items', kind: 'modal', title: '新增物品', design: '05', load: () => import('./items/ItemEdit') },
  'items.icon': { tab: 'items', kind: 'sheet', title: '图标与素材', design: '06', load: () => import('./items/ItemIcon') },
  'items.stats': { tab: 'items', title: '统计', design: '09', load: () => import('./items/ItemStats') },
  'wishes.list': { tab: 'items', title: '心愿', design: '07', load: () => import('./wishes/WishList') },
  'wishes.detail': { tab: 'items', title: '心愿详情', design: '08', load: () => import('./wishes/WishDetail') },
  'wishes.edit': { tab: 'items', kind: 'modal', title: '新增心愿', design: '08', load: () => import('./wishes/WishEdit') },
  'wishes.purchase': { tab: 'items', kind: 'modal', title: '记录购入', design: '08', load: () => import('./wishes/WishPurchase') },
  // 财富
  'wealth.overview': { tab: 'wealth', title: '财富', design: '10', load: () => import('./wealth/Overview') },
  'wealth.accounts': { tab: 'wealth', title: '账户', design: '10', load: () => import('./wealth/Accounts') },
  'wealth.snapshots': { tab: 'wealth', title: '盘点记录', design: '13', load: () => import('./wealth/Snapshots') },
  'wealth.account': { tab: 'wealth', title: '账户详情', design: '11', load: () => import('./wealth/Account') },
  'wealth.accountEdit': { tab: 'wealth', kind: 'modal', title: '新增账户', design: '11', load: () => import('./wealth/AccountEdit') },
  'wealth.groups': { tab: 'wealth', kind: 'modal', title: '管理分组', design: '10', load: () => import('./wealth/Groups') },
  'wealth.checkin': { tab: 'wealth', kind: 'modal', title: '完整盘点', design: '12', load: () => import('./wealth/CheckIn') },
  'wealth.compare': { tab: 'wealth', title: '盘点比较', design: '13', load: () => import('./wealth/Compare') },
  'spending.home': { tab: 'wealth', title: '支出与周期费用', design: '14', load: () => import('./spending/SpendingHome') },
  'spending.recurring': { tab: 'wealth', title: '周期费用', design: '15', load: () => import('./spending/PlanDetail') },
  'spending.virtual': { tab: 'wealth', title: '虚拟资产', design: '16', load: () => import('./spending/VirtualHome') },
  'spending.virtualDetail': { tab: 'wealth', title: '虚拟资产详情', design: '16', load: () => import('./spending/VirtualDetail') },
  'spending.expenseEdit': { tab: 'wealth', kind: 'modal', title: '记一笔支出', design: '14', load: () => import('./spending/ExpenseEdit') },
  'spending.recurringEdit': { tab: 'wealth', kind: 'modal', title: '周期计划', design: '15', load: () => import('./spending/PlanEdit') },
  'spending.payment': { tab: 'wealth', kind: 'modal', title: '确认付款', design: '15', load: () => import('./spending/PaymentEdit') },
  'spending.paymentRange': { tab: 'wealth', kind: 'modal', title: '补记往期付款', design: '15', load: () => import('./spending/PaymentRange') },
  'spending.planResume': { tab: 'wealth', kind: 'modal', title: '重新订阅', design: '15', load: () => import('./spending/PlanResume') },
  'spending.virtualEdit': { tab: 'wealth', kind: 'modal', title: '虚拟资产', design: '16', load: () => import('./spending/VirtualEdit') },
  'spending.topup': { tab: 'wealth', kind: 'modal', title: '记录充值', design: '16', load: () => import('./spending/TopupEdit') },
  'spending.balance': { tab: 'wealth', kind: 'modal', title: '记录余额', design: '16', load: () => import('./spending/BalanceEdit') },
  'spending.incomeEdit': { tab: 'wealth', kind: 'modal', title: '收入记录', load: () => import('./spending/IncomeEdit') },
  'spending.review': { tab: 'wealth', title: '财务复盘', load: () => import('./spending/ReviewPage') },
  // 规划
  'plan.goal': { tab: 'plan', title: '目标', design: '17', load: () => import('./plan/Goal') },
  'plan.detail': { tab: 'plan', title: '测算详情', design: '18', load: () => import('./plan/Detail') },
  'plan.whatif': { tab: 'plan', title: '假设分析', design: '19', load: () => import('./plan/WhatIf') },
  'plan.trials': { tab: 'plan', title: '试算', design: '20', load: () => import('./plan/Trials') },
  'plan.events': { tab: 'plan', title: '大额支出', load: () => import('./plan/EventsPage') },
  'plan.debts': { tab: 'plan', title: '贷款还款安排', load: () => import('./plan/Debts') },
  'plan.setup': { tab: 'plan', kind: 'modal', title: '设置条件', design: '21', load: () => import('./plan/Setup') },
  // 我的
  'me.home': { tab: 'me', title: '我的', design: '22', load: () => import('./me/Me') },
  'me.timeline': { tab: 'me', title: '时间轴', design: '23', load: () => import('./me/Timeline') },
  'me.search': { tab: 'me', title: '搜索全部资料', load: () => import('./me/Search') },
  'me.settings': { tab: 'me', title: '设置', design: '22', load: () => import('./me/Settings') },
  'me.data': { tab: 'me', title: '数据管理', design: '24', load: () => import('./me/Data') },
} satisfies Record<string, RouteDef>;
export type RouteName = keyof typeof routes;

export function routeDef(name: string): RouteDef | undefined {
  return Object.hasOwn(routes, name) ? (routes as Record<string, RouteDef>)[name] : undefined;
}
export const routeKind = (name: string): RouteKind => routeDef(name)?.kind ?? 'page';

export type Segment = { label: string; route: RouteName; /** Hidden when this module switch is off. */ module?: keyof Modules };
export type TabDef = {
  id: TabId; label: string;
  /** Root page when the tab has no visible segment, or no segments at all. */
  root: RouteName;
  segments?: Segment[];
  /** Hidden when every one of these is off; planning and finance use their own rules below. */
  visible?: (modules: ModuleFlags) => boolean;
};
/** Module switches as the app reads them; `incomes` is the independent finance switch. */
export type ModuleFlags = Modules & { incomes?: boolean };

// Order, labels and icons follow design mockup 01. 物品、总览、我的 are always shown.
export const tabs: TabDef[] = [
  { id: 'overview', label: '总览', root: 'home.overview' },
  { id: 'items', label: '物品', root: 'items.list', segments: [
    { label: '物品', route: 'items.list' }, { label: '心愿', route: 'wishes.list', module: 'wishlist' }, { label: '统计', route: 'items.stats', module: 'stats' }] },
  { id: 'wealth', label: '财富', root: 'spending.home', visible: m => !financeOff(m), segments: [
    { label: '概览', route: 'wealth.overview', module: 'wealth' }, { label: '账户', route: 'wealth.accounts', module: 'wealth' }, { label: '盘点记录', route: 'wealth.snapshots', module: 'wealth' }] },
  { id: 'plan', label: '规划', root: 'plan.goal', visible: m => m.planning, segments: [
    { label: '目标', route: 'plan.goal' }, { label: '测算详情', route: 'plan.detail' }, { label: '试算', route: 'plan.trials' }] },
  { id: 'me', label: '我的', root: 'me.home' },
];

export const tabDef = (id: TabId): TabDef => tabs.find(tab => tab.id === id)!;
/** Tabs to show. `null` (switches not read yet or unreadable) shows all so nothing disappears by accident. */
export function visibleTabs(modules: ModuleFlags | null): TabDef[] {
  return tabs.filter(tab => !modules || !tab.visible || tab.visible(modules));
}
/** Segments to show for a tab; modules that are off drop their segment. */
export function visibleSegments(id: TabId, modules: ModuleFlags | null): Segment[] {
  return (tabDef(id).segments ?? []).filter(segment => !segment.module || !modules || modules[segment.module]);
}
/** The page a tab opens on: its first visible segment, or the tab's fallback root. */
export function tabRoot(id: TabId, modules: ModuleFlags | null): RouteName {
  return visibleSegments(id, modules)[0]?.route ?? tabDef(id).root;
}
/** True for pages that sit at the bottom of a tab stack (tab roots and segment pages). */
export function isRootRoute(name: string): boolean {
  return tabs.some(tab => tab.root === name || tab.segments?.some(segment => segment.route === name));
}
