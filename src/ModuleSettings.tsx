import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { Switch } from './FormControls';
import { moduleList, type Modules, type RuntimeModules } from './modules';
export function ModuleSettings({ modules, onChange }: { modules: Modules & Partial<RuntimeModules>; onChange: (m: RuntimeModules) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [repairIncome, setRepairIncome] = useState(false), [repairMovements, setRepairMovements] = useState(false);
  const ready = modules.finance_status === 'ready';
  async function update(payload: Record<string, unknown>) {
    setBusy(true); setError('');
    try { onChange(await invoke<RuntimeModules>('modules_set', payload)); }
    catch (e) {
      setError(errorMessage(e));
      // Legacy and finance preferences are separate files: one write may have succeeded.
      try { onChange(await invoke<RuntimeModules>('modules_get')); }
      catch (readError) { setError(errorMessage(e) + '；当前开关状态无法读取：' + errorMessage(readError)); }
    } finally { setBusy(false); }
  }
  const toggle = (key: keyof Modules, on: boolean) => update({ modules: { ...modules, [key]: on } });
  return <section className="ui-card ui-content module-settings" aria-labelledby="module-heading">
    <div className="data-heading"><div><p className="eyebrow">界面</p><h2 id="module-heading">功能模块</h2></div><span>总览与我的物品始终开启</span></div>
    <p className="data-intro">关掉不用的模块，侧栏、总览和时间轴会隐藏它，心愿提醒随之暂停。资料不会删除，重新打开即恢复。</p>
    <ul className="module-list">{moduleList.map(([key, name, hint]) => <li key={key}><div><strong>{name}</strong><span className="muted">{hint}</span></div><Switch label={'启用' + name} value={modules[key]} disabled={busy} onChange={on => void toggle(key, on)}/></li>)}</ul>
    <ul className="module-list">{([['incomes', '收入记录', '记录实际到账，与目标开关独立'], ['movements', '资金流动', '记录资金转入转出；需要开启账户与盘点']] as const).map(([key, name, hint]) => <li key={key}><div><strong>{name}</strong><span className="muted">{hint}</span></div><Switch label={'启用' + name} value={ready && !!modules[key]} disabled={busy || !ready} onChange={on => void update({ modules, [key]: on })}/></li>)}</ul>
    {ready && modules.movements && !modules.wealth && <p className="notice">资金流动偏好已保留；开启账户与盘点后恢复使用。</p>}
    {!ready && <div className="notice" role="alert"><p>收入与资金流动开关暂不可用，财务资料没有删除。{modules.finance_status === 'unsupported_version' ? '偏好版本较新，请使用支持该版本的应用。' : '请重新读取，或明确选择修复后的开关状态。'}</p><button disabled={busy} onClick={() => { setBusy(true); void invoke<RuntimeModules>('modules_get').then(onChange).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)); }}>重新读取开关</button>{modules.finance_status && modules.finance_status !== 'unsupported_version' && <><label><input type="checkbox" checked={repairIncome} disabled={busy} onChange={e => setRepairIncome(e.target.checked)}/>修复后启用收入记录</label><label><input type="checkbox" checked={repairMovements} disabled={busy} onChange={e => setRepairMovements(e.target.checked)}/>修复后启用资金流动</label><button disabled={busy} onClick={() => void update({ modules, repair: true, incomes: repairIncome, movements: repairMovements })}>按以上选择修复开关</button></>}</div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
