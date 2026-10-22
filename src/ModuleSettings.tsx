import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { StartChoice } from './StartChoice';
import { selectedUsage, usageModules } from './start-choice';
import { Switch } from './FormControls';
import { moduleList, type Modules, type RuntimeModules } from './modules';
import { t } from './i18n.ts';
export function ModuleSettings({ modules, onChange, onBusyChange }: { onBusyChange?: (busy: boolean) => void; modules: Modules & Partial<RuntimeModules>; onChange: (m: RuntimeModules) => void }) {
  const [choosing, setChoosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), chooserButton = useRef<HTMLButtonElement>(null), restoreChooserFocus = useRef(false);
  useEffect(() => {
    if (!choosing) return;
    const opened = dialog.current;
    opened?.showModal();
    return () => { opened?.close(); restoreChooserFocus.current = true; };
  }, [choosing]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!choosing && !busy && restoreChooserFocus.current) { restoreChooserFocus.current = false; chooserButton.current?.focus(); }
  }, [choosing, busy]);
  useEffect(() => { onBusyChange?.(busy || choosing); return () => onBusyChange?.(false); }, [busy, choosing, onBusyChange]);
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
    <div className="data-heading"><div><p className="eyebrow">{t('界面')}</p><h2 id="module-heading">{t('功能模块')}</h2></div><span>{t('总览与设置始终可用')}</span></div>
    <p className="data-intro">{t('关掉不用的模块，会隐藏相关入口，已有资料保留。心愿、订阅续期和盘点提醒随对应模块暂停；保障提醒不受影响，重新开启后按原设置安排。')}</p>
    <div className="usage-settings-entry"><div><strong>{t('按用途整理界面')}</strong><p className="muted">{t('选择你常用的功能，可以多选，也可以全部使用。')}</p></div><button ref={chooserButton} className="ui-btn" disabled={busy} onClick={() => setChoosing(true)}>{t('重新选择用途')}</button></div>
    <ul className="module-list">{moduleList.map(([key, name, hint]) => <li key={key}><div><strong>{name}</strong><span className="muted">{hint}</span></div><Switch label={'启用' + name} value={modules[key]} disabled={busy || (key === 'stats' && !modules.physical)} onChange={on => void toggle(key, on)}/></li>)}</ul>
    <ul className="module-list">{([['incomes', '收入记录', '记录实际到账，与目标开关独立'], ['movements', '资金流动', '记录资金转入转出；需要开启账户与盘点']] as const).map(([key, name, hint]) => <li key={key}><div><strong>{name}</strong><span className="muted">{hint}</span></div><Switch label={'启用' + name} value={ready && !!modules[key]} disabled={busy || !ready} onChange={on => void update({ modules, [key]: on })}/></li>)}</ul>
    {ready && modules.movements && !modules.wealth && <p className="notice">{t('资金流动偏好已保留；开启账户与盘点后恢复使用。')}</p>}
    {!ready && <div className="notice" role="alert"><p>{t('收入与资金流动开关暂不可用，财务资料没有删除。')}{modules.finance_status === 'unsupported_version' ? t('偏好版本较新，请使用支持该版本的应用。') : t('请重新读取，或明确选择修复后的开关状态。')}</p><button disabled={busy} onClick={() => { setBusy(true); void invoke<RuntimeModules>('modules_get').then(onChange).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)); }}>{t('重新读取开关')}</button>{modules.finance_status && modules.finance_status !== 'unsupported_version' && <><label><input type="checkbox" checked={repairIncome} disabled={busy} onChange={e => setRepairIncome(e.target.checked)}/>{t('修复后启用收入记录')}</label><label><input type="checkbox" checked={repairMovements} disabled={busy} onChange={e => setRepairMovements(e.target.checked)}/>{t('修复后启用资金流动')}</label><button disabled={busy} onClick={() => void update({ modules, repair: true, incomes: repairIncome, movements: repairMovements })}>{t('按以上选择修复开关')}</button></>}</div>}
    {!modules.physical && modules.stats && <p className="notice">{t('物品统计的偏好已保留，开启物品档案后恢复入口。')}</p>}
    {choosing && <dialog ref={dialog} className="usage-settings-dialog" aria-labelledby="start-choice-title" onCancel={event => { event.preventDefault(); if (!busy) setChoosing(false); }}><StartChoice initial={selectedUsage(modules as RuntimeModules)} ready={ready && !!modules.finance_revision} error={error || (!ready || !modules.finance_revision ? t('功能偏好暂不可用，请重新读取；也可以取消后在下方修复。') : '')} onBusyChange={setBusy} onReload={() => { void invoke<RuntimeModules>('modules_get').then(onChange).catch(e => setError(errorMessage(e))); }} onSkip={() => setChoosing(false)} onApply={async selection => {
      if (!ready) throw new Error(t('功能偏好尚未可靠读取，请先重新读取。'));
      const payload = usageModules(modules as RuntimeModules, ready, selection);
      if (!payload) throw new Error(t('功能偏好尚未可靠读取，请先重新读取。'));
      try { onChange(await invoke<RuntimeModules>('modules_set', payload)); setChoosing(false); }
      catch (e) { try { onChange(await invoke<RuntimeModules>('modules_get')); } catch { /* Keep the failed draft open for retry. */ } throw new Error(errorMessage(e)); }
    }}/></dialog>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
