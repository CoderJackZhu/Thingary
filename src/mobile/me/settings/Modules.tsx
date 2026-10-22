import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import { moduleList } from '../../../modules';
import type { Modules, RuntimeModules } from '../../../modules';
import { useModules } from '../../modules-context';
import { Button, ErrorState, FormGroup, ListGroup, ListRow, Loading, Notice, Switch } from '../../ui';
import { SettingsShell } from './Shell';

/** 功能模块: the desktop module switches (`modules_set`), including the separate 收入记录 / 资金流动 preferences and their repair path. */
export default function ModulesPage() {
  const { modules, reload } = useModules();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [repairIncome, setRepairIncome] = useState(false), [repairMovements, setRepairMovements] = useState(false);
  async function update(payload: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await invoke<RuntimeModules>('modules_set', payload); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { reload(); setBusy(false); } // Legacy and finance preferences are separate files: one write may have succeeded, so always read back.
  }
  if (!modules) return <SettingsShell title="功能模块"><Loading label="正在读取开关…"/><ErrorState title="开关暂时读不到" message="读到之前所有模块都显示。" onRetry={reload}/></SettingsShell>;
  const ready = modules.finance_status === 'ready';
  const core = (({ wishlist, timeline, stats, wealth, expenses, recurring, virtual, planning }) => ({ wishlist, timeline, stats, wealth, expenses, recurring, virtual, planning }) as Modules)(modules);
  return <SettingsShell title="功能模块" lead="关掉不用的模块，标签栏、总览和时间轴会隐藏它；资料不会删除，重新打开即恢复。">
    <ListGroup footer="总览和我的物品始终开启。关闭心愿清单会同时暂停心愿提醒。">
      {moduleList.map(([key, name, hint]) => <ListRow key={key} title={name} subtitle={hint} trailing={<Switch label={'启用' + name} checked={modules[key]} disabled={busy} onChange={on => void update({ modules: { ...core, [key]: on } })}/>}/>)}
    </ListGroup>
    <ListGroup title="财务记录" footer={ready && modules.movements && !modules.wealth ? '资金流动偏好已保留；开启账户与盘点后恢复使用。' : undefined}>
      {([['incomes', '收入记录', '记录实际到账，与目标开关独立'], ['movements', '资金流动', '记录资金转入转出；需要开启账户与盘点']] as const).map(([key, name, hint]) =>
        <ListRow key={key} title={name} subtitle={hint} trailing={<Switch label={'启用' + name} checked={ready && !!modules[key]} disabled={busy || !ready} onChange={on => void update({ modules: core, [key]: on })}/>}/>)}
    </ListGroup>
    {!ready && <FormGroup title="财务开关需要处理" footer={`财务资料没有删除。${modules.finance_status === 'unsupported_version' ? '偏好版本较新，请使用支持该版本的应用。' : '请重新读取，或明确选择修复后的开关状态。'}`}>
      <div className="me-pad me-stack">
        <Button disabled={busy} onClick={reload}>重新读取开关</Button>
        {modules.finance_status !== 'unsupported_version' && <>
          <ListRow title="修复后启用收入记录" trailing={<Switch label="修复后启用收入记录" checked={repairIncome} disabled={busy} onChange={setRepairIncome}/>}/>
          <ListRow title="修复后启用资金流动" trailing={<Switch label="修复后启用资金流动" checked={repairMovements} disabled={busy} onChange={setRepairMovements}/>}/>
          <Button variant="primary" disabled={busy} onClick={() => void update({ modules: core, repair: true, incomes: repairIncome, movements: repairMovements })}>按以上选择修复开关</Button>
        </>}
      </div>
    </FormGroup>}
    {error && <Notice tone="danger">{error}</Notice>}
  </SettingsShell>;
}
