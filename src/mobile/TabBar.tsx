import { visibleTabs } from './routes';
import type { ModuleFlags, TabId } from './routes';
import { Icon } from './ui';
import type { IconName } from './ui';

const icons: Record<TabId, IconName> = { overview: 'home', items: 'box', wealth: 'wallet', plan: 'chart', me: 'user' };

/** Bottom tab bar (总览 / 物品 / 财富 / 规划 / 我的). Tabs of switched-off modules are not rendered. */
export function TabBar({ tab, modules, disabled, onSelect }: { tab: TabId; modules: ModuleFlags | null; disabled: boolean; onSelect: (tab: TabId) => void }) {
  return <nav className="m-tabbar" aria-label="主导航">{visibleTabs(modules).map(item => <button key={item.id} type="button" disabled={disabled} aria-current={tab === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}><Icon name={icons[item.id]} size={26}/><span>{item.label}</span></button>)}</nav>;
}
