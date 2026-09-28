import { useState } from 'react';
import type { DemoStatus } from './library-mode';
import { resetKey } from './library-mode';
import { Icon } from './AssetViews';
export function DemoSettings({ status, blocked, onSwitch, onReset }: { status: DemoStatus; blocked: boolean; onSwitch: () => void; onReset: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const pending = !!localStorage.getItem(resetKey);
  return <section className="card demo-settings" aria-labelledby="demo-heading">
    <div className="data-heading"><div><p className="eyebrow">熟悉物志</p><h2 id="demo-heading">样例体验</h2></div><span>{status.active ? '正在查看样例' : '独立虚构资料'}</span></div>
    <p className="data-intro">用一套完整样例体验物品、心愿、账户盘点和周期费用。可以放心编辑和删除，所有变化只留在样例中；样例不接受新增资产（实现心愿也会新增资产），点“新增资产”会回到自己的资料。</p>
    <div className="data-actions"><div className="data-action"><span className="data-action-icon"><Icon name="overview"/></span><div className="data-action-copy"><h3>{status.active ? '我的资料' : '查看样例'}</h3><p>{status.active ? '回到自己的记录，保留这次样例体验。' : '保留上次样例中的修改，随时回来看看。'}</p></div><button disabled={blocked || pending} onClick={onSwitch}>{status.active ? '返回我的资料' : '查看样例'}</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="back"/></span><div className="data-action-copy"><h3>重置样例</h3><p>重新生成完整样例；自己的资料不受影响。</p></div><button disabled={blocked} onClick={() => pending ? onReset() : setConfirm(true)}>{pending ? '核对重置结果' : '重置…'}</button></div></div>
    {confirm && !pending && <div className="confirm" role="alert"><strong>重置样例中的所有修改？</strong><p>样例中的编辑和删除会清除，恢复为以今天为基准的完整虚构资料。</p><div className="actions"><button disabled={blocked} onClick={() => setConfirm(false)}>取消</button><button className="danger" disabled={blocked} onClick={onReset}>确认重置样例</button></div></div>}
    {pending && <p role="status" className="notice">上次重置的结果尚待核对，请按原操作核对；自己的资料不会被替换。</p>}
    {blocked && <p className="muted">请先完成当前操作或核对保存结果，再切换或重置样例。</p>}
  </section>;
}
