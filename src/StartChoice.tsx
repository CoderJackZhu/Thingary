import { useEffect, useRef, useState } from 'react';
import { Icon } from './AssetViews';
import { usageCount, type UsageSelection } from './start-choice';
import './start-choice.css';
import { t } from './i18n.ts';
const purposes = [
  { key: 'money', title: t('盘一盘我的钱'), hint: t('我现在一共有多少钱？这几个月变了多少？'), example: '银行卡、支付宝、基金、信用卡…', icon: 'wallet' },
  { key: 'physical', title: t('整理我的物品'), hint: t('这件东西花了多少、保修还有没有？'), example: '电脑、相机、家电、日常用品…', icon: 'items' },
  { key: 'planning', title: t('为以后做计划'), hint: t('每月要存多少，什么时候能不靠工资？'), example: '攒钱、退休、大额购买…', icon: 'plan' },
] as const;

export function StartChoice({ initial, ready, loading = false, error = '', onApply, onSkip, onReload, onBusyChange }: {
  initial?: UsageSelection; ready: boolean; loading?: boolean; error?: string;
  onApply: (selection: UsageSelection) => Promise<void>; onSkip: () => void; onReload: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [selection, setSelection] = useState<UsageSelection>(() => initial ?? { money: true, physical: true, planning: true });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  async function apply() {
    if (lock.current || !ready || !usageCount(selection)) return;
    lock.current = true; setBusy(true); setFailure('');
    try { await onApply(selection); }
    catch (e) { if (alive.current) setFailure(e instanceof Error ? e.message : '设置没有完成，请重试。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="usage-choice usage-choice-settings" aria-labelledby="start-choice-title">
    <header><p className="usage-kicker">{t('按自己的需要调整')}</p><h1 id="start-choice-title">{t('保留你想用的功能')}</h1><p>{t('可以多选或全部保留，以后随时能在设置中调整。')}</p></header>
    <fieldset disabled={busy} className="usage-options"><legend className="sr-only">{t('选择用途，可多选')}</legend>{purposes.map(purpose => <label key={purpose.key} className={`usage-option${selection[purpose.key] ? ' selected' : ''}`}>
      <input type="checkbox" checked={selection[purpose.key]} onChange={e => setSelection(value => ({ ...value, [purpose.key]: e.target.checked }))}/>
      <span className="usage-option-icon" aria-hidden="true"><Icon name={purpose.icon}/></span><span className="usage-option-body"><strong>{purpose.title}</strong><span>{purpose.hint}</span><small>{purpose.example}</small></span>
    </label>)}</fieldset>
    <p className="usage-choice-note">{t('关闭入口会保留已有资料，重新开启后可以继续使用。其他细节可在功能开关中调整。')}</p>
    {(!selection.physical || !selection.money) && <p className="usage-choice-note" role="status">{!selection.physical && t('不选“整理我的物品”，心愿提醒也会暂停。')}{!selection.money && t('不选“盘一盘我的钱”，订阅续期提醒和盘点提醒也会暂停。')}{t('重新开启后按原设置安排提醒；保障提醒不受影响。')}</p>}
    {(error || failure) && <div className="notice" role="alert"><p>{failure || error}</p>{!ready && <button type="button" className="ui-btn" disabled={busy || loading} onClick={onReload}>{t('重新读取设置')}</button>}</div>}
    {loading && <p className="muted" role="status">{t('正在读取功能设置…')}</p>}
    <footer className="usage-choice-actions"><button type="button" className="usage-skip" disabled={busy} onClick={onSkip}>{t('取消')}</button><div><span className="muted small" aria-live="polite">{usageCount(selection) ? t('已选 {v1} 项', { v1: usageCount(selection) }) : t('选择常用功能，或直接跳过')}</span><button type="button" className="primary" disabled={busy || !ready || !usageCount(selection)} onClick={() => void apply()}>{busy ? t('正在应用…') : t('保存选择')}</button></div></footer>
  </section>;
}
