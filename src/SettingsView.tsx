import { Icon } from './AssetViews';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import './settings.css';

const categories = [
  ['appearance', '外观', 'sun'], ['options', '选项管理', 'list'], ['modules', '功能模块', 'grid'],
  ['data', '资料与备份', 'archive'], ['demo', '样例', 'items'],
] as const;
export type SettingsCategory = typeof categories[number][0];

/** Keep panels mounted: switching categories must not discard a pending receipt.
 * U18：分组状态可受控（App 持有），从「素材库／最近删除」返回时恢复原分组。 */
export function SettingsView({ panels, optionsPending, demoPending, busy, group, onGroup }: {
  panels: Record<SettingsCategory, ReactNode>; optionsPending: boolean; demoPending: boolean; busy: boolean;
  group?: SettingsCategory; onGroup?: (group: SettingsCategory) => void;
}) {
  const [inner, setInner] = useState<SettingsCategory>(demoPending ? 'demo' : optionsPending ? 'options' : 'appearance');
  const selected = group ?? inner;
  const setSelected = (next: SettingsCategory) => { setInner(next); onGroup?.(next); };
  useEffect(() => { if (optionsPending) setSelected('options'); else if (demoPending) setSelected('demo'); }, [optionsPending, demoPending]);
  return <section className="settings-section settings-categories">
    <nav className="settings-categories-nav" aria-label="设置分类">{categories.map(([key, label, icon]) =>
      <button key={key} type="button" aria-current={selected === key ? 'page' : undefined} aria-controls={`settings-${key}`} disabled={busy && selected !== key} onClick={() => setSelected(key)}><Icon name={icon}/>{label}</button>
    )}</nav>
    <div className="settings-content">{categories.map(([key, label]) =>
      <div key={key} id={`settings-${key}`} role="region" aria-label={label} hidden={selected !== key}>{panels[key]}</div>
    )}</div>
  </section>;
}
