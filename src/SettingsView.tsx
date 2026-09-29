import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import './settings.css';

const categories = [
  ['appearance', '外观'], ['options', '选项管理'], ['modules', '功能模块'],
  ['data', '资料与备份'], ['demo', '样例'],
] as const;
type Category = typeof categories[number][0];

/** Keep panels mounted: switching categories must not discard a pending receipt. */
export function SettingsView({ panels, optionsPending, demoPending, busy }: {
  panels: Record<Category, ReactNode>; optionsPending: boolean; demoPending: boolean; busy: boolean;
}) {
  const [selected, setSelected] = useState<Category>(demoPending ? 'demo' : optionsPending ? 'options' : 'appearance');
  useEffect(() => { if (optionsPending) setSelected('options'); else if (demoPending) setSelected('demo'); }, [optionsPending, demoPending]);
  return <section className="settings-section settings-categories">
    <nav className="settings-categories-nav" aria-label="设置分类">{categories.map(([key, label]) =>
      <button key={key} type="button" aria-current={selected === key ? 'page' : undefined} aria-controls={`settings-${key}`} disabled={busy && selected !== key} onClick={() => setSelected(key)}>{label}</button>
    )}</nav>
    <div className="settings-content">{categories.map(([key, label]) =>
      <div key={key} id={`settings-${key}`} role="region" aria-label={label} hidden={selected !== key}>{panels[key]}</div>
    )}</div>
  </section>;
}
