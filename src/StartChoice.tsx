import { useEffect, useRef, useState } from 'react';
import { Icon } from './AssetViews';
import { LogoMark } from './LogoMark';
import { usageCount, type UsageSelection } from './start-choice';
import './start-choice.css';

const purposes = [
  { key: 'money', title: '盘一盘我的钱', hint: '我现在一共有多少钱？这几个月变了多少？', example: '银行卡、支付宝、基金、信用卡…', icon: 'wallet' },
  { key: 'physical', title: '整理我的物品', hint: '这件东西花了多少、保修还有没有？', example: '电脑、相机、家电、日常用品…', icon: 'items' },
  { key: 'planning', title: '为以后做计划', hint: '每月要存多少，什么时候能不靠工资？', example: '攒钱、退休、大额购买…', icon: 'plan' },
] as const;

export function StartChoice({ initial, ready, loading = false, error = '', settings = false, onApply, onSkip, onReload, onBusyChange }: {
  initial?: UsageSelection; ready: boolean; loading?: boolean; error?: string; settings?: boolean;
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
  return <section className={`usage-choice${settings ? ' usage-choice-settings' : ''}`} aria-labelledby="start-choice-title">
    {!settings && <div className="usage-brand"><LogoMark/><span>物谱 <small>THINGARY</small></span></div>}
    <header><p className="usage-kicker">{settings ? '按自己的需要调整' : '从你想做的事开始'}</p><h1 id="start-choice-title">保留你想用的功能</h1><p>{settings ? '可以多选或全部保留，以后随时能在设置中调整。' : '默认已选好全部功能，可以取消暂时不用的。以后随时能在设置中调整。'}</p></header>
    <fieldset disabled={busy} className="usage-options"><legend className="sr-only">选择用途，可多选</legend>{purposes.map(purpose => <label key={purpose.key} className={`usage-option${selection[purpose.key] ? ' selected' : ''}`}>
      <input type="checkbox" checked={selection[purpose.key]} onChange={e => setSelection(value => ({ ...value, [purpose.key]: e.target.checked }))}/>
      <span className="usage-option-icon" aria-hidden="true"><Icon name={purpose.icon}/></span><span className="usage-option-body"><strong>{purpose.title}</strong><span>{purpose.hint}</span><small>{purpose.example}</small></span>
    </label>)}</fieldset>
    <p className="usage-choice-note">{settings ? '关闭入口会保留已有资料，重新开启后可以继续使用。其他细节可在功能开关中调整。' : '保留全部即可直接开始，也可以先精简界面。不需要现在填写资料。'}</p>
    {!settings && <p className="usage-choice-note">资料只保存在这台电脑上，不上传、不同步，文件本身没有加密。有改动时会自动备份在本机；换电脑或硬盘损坏时备份会一起丢失，建议之后在「设置 › 数据管理」添加额外备份位置。</p>}
    {(!selection.physical || !selection.money) && <p className="usage-choice-note" role="status">{!selection.physical && '不选“整理我的物品”，心愿提醒也会暂停。'}{!selection.money && '不选“盘一盘我的钱”，订阅续期提醒和盘点提醒也会暂停。'}重新开启后按原设置安排提醒；保障提醒不受影响。</p>}
    {(error || failure) && <div className="notice" role="alert"><p>{failure || error}</p>{!ready && <button type="button" className="ui-btn" disabled={busy || loading} onClick={onReload}>重新读取设置</button>}</div>}
    {loading && <p className="muted" role="status">正在读取功能设置…</p>}
    <footer className="usage-choice-actions"><button type="button" className="usage-skip" disabled={busy} onClick={onSkip}>{settings ? '取消' : '跳过，直接使用'}</button><div><span className="muted small" aria-live="polite">{usageCount(selection) ? `已选 ${usageCount(selection)} 项` : '选择常用功能，或直接跳过'}</span><button type="button" className="primary" disabled={busy || !ready || !usageCount(selection)} onClick={() => void apply()}>{busy ? '正在应用…' : settings ? '保存选择' : '开始使用'}</button></div></footer>
  </section>;
}
