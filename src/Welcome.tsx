import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StartChoice } from './StartChoice';
import { errorMessage } from './asset';
import { financeModulesReady, type RuntimeModules } from './modules';
import { choiceStorage, persistOverviewChoice, rememberWelcome, usageModules, usageOverview } from './start-choice';
import { newAssetKey, sectionKey, type DemoStatus } from './library-mode';

export function Welcome({ status, onDone, onBusyChange }: { status: DemoStatus; onDone: (status: DemoStatus) => void; onBusyChange: (busy: boolean) => void }) {
  const [modules, setModules] = useState<RuntimeModules | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function reload() {
    setLoading(true); setError('');
    try { setModules(await invoke<RuntimeModules>('modules_get')); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  const ready = !!modules && !loading && financeModulesReady(modules);
  return <main className="usage-screen"><StartChoice ready={ready} loading={loading} error={error || (!loading && !ready ? '功能偏好暂时无法读取。请重新读取，或先跳过，在设置里处理。' : '')} onReload={() => void reload()} onBusyChange={onBusyChange} onSkip={() => { rememberWelcome(choiceStorage(), 'skipped'); onDone(status); }} onApply={async selection => {
    if (!modules || !ready) throw new Error('请先重新读取功能偏好。');
    const payload = usageModules(modules, ready, selection, true);
    if (!payload) throw new Error('请先重新读取功能偏好。');
    try {
      const saved = await invoke<RuntimeModules>('modules_set', payload);
      setModules(saved);
      // Record the explicit choice before switching; a restart can safely retry the switch.
      if (!rememberWelcome(choiceStorage(), 'completed')) throw new Error('无法保存起步偏好，请检查本机存储后重试，也可以先跳过。');
      const next = status.active ? await invoke<DemoStatus>('switch_demo', { demo: false }) : status;
      sessionStorage.removeItem(sectionKey); sessionStorage.removeItem(newAssetKey);
      persistOverviewChoice(choiceStorage(), usageOverview(selection));
      onDone(next);
    } catch (e) {
      try { setModules(await invoke<RuntimeModules>('modules_get')); } catch { /* Preserve the visible error and explicit choices for retry. */ }
      throw new Error(errorMessage(e));
    }
  }}/></main>;
}
