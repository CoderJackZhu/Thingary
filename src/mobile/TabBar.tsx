import { visibleTabs } from './routes';
import type { ModuleFlags, TabId } from './routes';
import { Icon } from './ui';
import type { IconName } from './ui';
import { t } from '../i18n.ts';
const icons: Record<TabId, IconName> = { overview: 'tabHome', items: 'tabBox', wealth: 'tabWallet', plan: 'tabTarget', me: 'tabUser' };
const tones: Record<TabId, string> = { overview: 'indigo', items: 'blue', wealth: 'orange', plan: 'slate', me: 'slate' };

/** Bottom tab bar (总览 / 物品 / 财富 / 规划 / 我的). Tabs of switched-off modules are not rendered. */
export function TabBar({ tab, modules, disabled, onSelect }: { tab: TabId; modules: ModuleFlags | null; disabled: boolean; onSelect: (tab: TabId) => void }) {
  return <nav className="m-tabbar" aria-label={t('主导航')}>{visibleTabs(modules).map(item => <button key={item.id} type="button" className={`m-tab-${tones[item.id]}`} disabled={disabled} aria-current={tab === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}><span className="m-tab-icon"><Icon name={icons[item.id]} size={20} strokeWidth={1.9}/></span><span>{item.label}</span></button>)}</nav>;
}
