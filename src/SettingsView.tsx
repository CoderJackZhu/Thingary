import { Icon } from './AssetViews';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import './settings.css';
import { t } from './i18n.ts';
const categories = [
  ['appearance', t('外观'), 'sun'], ['privacy', t('屏幕隐私'), 'circle'], ['materials', t('素材库'), 'image'], ['options', t('选项管理'), 'list'], ['modules', t('功能模块'), 'grid'],
  ['data', t('数据管理'), 'archive'], ['demo', t('样例'), 'items'], ['support', t('关于与帮助'), 'circle'],
] as const;
export type SettingsCategory = typeof categories[number][0];

/** Keep panels mounted: switching categories must not discard a pending receipt.
 * U18：分组状态可受控（App 持有），从「素材库／最近删除」返回时恢复原分组。 */
export function SettingsView({ panels, optionsPending, demoPending, busy, group, onGroup, supportBadge }: {
  panels: Record<SettingsCategory, ReactNode>; optionsPending: boolean; demoPending: boolean; busy: boolean;
  group?: SettingsCategory; onGroup?: (group: SettingsCategory) => void; supportBadge?: ReactNode;
}) {
  const [inner, setInner] = useState<SettingsCategory>(demoPending ? 'demo' : optionsPending ? 'options' : 'appearance');
  const selected = group ?? inner;
  const setSelected = (next: SettingsCategory) => { setInner(next); onGroup?.(next); };
  useEffect(() => { if (optionsPending) setSelected('options'); else if (demoPending) setSelected('demo'); }, [optionsPending, demoPending]);
  return <section className="settings-section settings-categories">
    <nav className="settings-categories-nav" aria-label={t('设置分类')}>{categories.map(([key, label, icon]) =>
      <button key={key} type="button" aria-current={selected === key ? 'page' : undefined} aria-controls={`settings-${key}`} disabled={busy && selected !== key} onClick={() => setSelected(key)}><Icon name={icon}/>{label}{key === 'support' && supportBadge}</button>
    )}</nav>
    <div className="settings-content">{categories.map(([key, label]) =>
      <div key={key} id={`settings-${key}`} role="region" aria-label={label} hidden={selected !== key}>{panels[key]}</div>
    )}</div>
  </section>;
}
