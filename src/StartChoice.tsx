import { useRef, useState } from 'react';
import './start-choice.css';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import type { RuntimeModules } from './modules';
import { choiceStorage, dismissStartChoice, startChoiceDismissed, starterModules, type StartChoice as Choice } from './start-choice';

export function StartChoice({ generation, active, started, modules, modulesLoaded, disabled, onModules, onBusyChange, onStart, onNotice }: {
  generation: string | null; active: boolean; started: boolean; modules: RuntimeModules; modulesLoaded: boolean; disabled: boolean;
  onNotice?: (message: string) => void; onModules: (modules: RuntimeModules) => void; onBusyChange: (busy: boolean) => void; onStart: (choice: Choice) => void | boolean | Promise<void | boolean>;
}) {
  const [hideExtras, setHideExtras] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const lastFailure = useRef('');
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (active || started || dismissed === generation && generation !== null || startChoiceDismissed(choiceStorage(), generation)) return null;
  function failure(message: string) { lastFailure.current = message; setError(message); onNotice?.(message); }
  function dismiss() { if (dismissStartChoice(choiceStorage(), generation)) setDismissed(generation); }
  async function start(choice: Choice) {
    if (lock.current || busy || disabled) return;
    lock.current = true;
    lastFailure.current = '';
    setBusy(true); onBusyChange(true); setError('');
    let updated = true;
    try {
      if (hideExtras) {
        const payload = starterModules(modules, modulesLoaded);
        if (!payload) {
          updated = false;
          failure('模块开关尚未可靠读取，本次没有隐藏辅助模块。可以继续记录，也可在设置中重新读取开关后再试。');
        } else {
          try { onModules(await invoke<RuntimeModules>('modules_set', payload)); }
          catch (e) {
            updated = false;
            failure('辅助模块设置未完成：' + errorMessage(e) + ' 可以继续记录，起步选择将保留。');
            // Preference files are separate; refresh any part already written.
            try { onModules(await invoke<RuntimeModules>('modules_get')); }
            catch (readError) { failure('辅助模块设置未完成：' + errorMessage(e) + '；当前开关无法读取：' + errorMessage(readError) + '。可以继续记录，起步选择将保留。'); }
          }
        }
      }
    } finally { setBusy(false); onBusyChange(false); }
    try { const completed = await onStart(choice); if (updated && completed !== false) dismiss(); }
    catch (e) { failure(errorMessage(e)); }
    finally { if (lastFailure.current) onNotice?.(lastFailure.current); lock.current = false; }
  }
  return <section className="ui-card ui-content start-choice" aria-labelledby="start-choice-title">
    <h2 id="start-choice-title">你想先做哪件事？</h2>
    <p className="muted">只做其中一件也完全可以，另一件随时再开始。</p>
    <div className="review-start-actions"><button type="button" className="ui-btn" disabled={disabled || busy} onClick={() => void start('physical')}>先整理物品</button><button type="button" className="ui-btn" disabled={disabled || busy} onClick={() => void start('combined')}>先盘点账户</button></div>
    <label className="start-choice-extras"><input type="checkbox" checked={hideExtras} disabled={busy} onChange={e => setHideExtras(e.target.checked)}/>先隐藏周期费用和虚拟资产（可在设置 › 功能模块中打开）</label>
    {error && <p className="notice" role="alert">{error}</p>}
    <button type="button" className="ui-link" disabled={disabled || busy} onClick={dismiss}>跳过</button>
  </section>;
}
