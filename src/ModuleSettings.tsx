import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { Switch } from './FormControls';
import { moduleList, type Modules } from './modules';
export function ModuleSettings({ modules, onChange }: { modules: Modules; onChange: (m: Modules) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function toggle(key: keyof Modules, on: boolean) {
    setBusy(true); setError('');
    try { onChange(await invoke<Modules>('modules_set', { modules: { ...modules, [key]: on } })); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="card module-settings" aria-labelledby="module-heading">
    <div className="data-heading"><div><p className="eyebrow">界面</p><h2 id="module-heading">功能模块</h2></div><span>总览与我的物品始终开启</span></div>
    <p className="data-intro">关掉不用的模块，侧栏、总览和时间轴会隐藏它，心愿提醒随之暂停。资料不会删除，重新打开即恢复。</p>
    <ul className="module-list">{moduleList.map(([key, name, hint]) => <li key={key}><div><strong>{name}</strong><span className="muted">{hint}</span></div><Switch label={'启用' + name} value={modules[key]} disabled={busy} onChange={on => void toggle(key, on)}/></li>)}</ul>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
