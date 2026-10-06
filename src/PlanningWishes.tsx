import { useEffect, useMemo, useState } from 'react';
import { errorMessage, money } from './asset';
import { loadConsideringWishes } from './plan-data';
import type { RetireCalc } from './plan-retire-calc';
import { classifyWishes, counted, impactOf, isReady } from './plan-wishes';
import type { WishLike } from './plan-wishes';

const yuan = (c: number) => money(String(Math.round(c)));

/** 目标页的「大额支出」卡：把「考虑中」的心愿当作一次性支出，看对 FIRE 日期的影响。只读，不改心愿。 */
export function PlanningWishes({ calc, today }: { calc: RetireCalc; today: string }) {
  const [wishes, setWishes] = useState<WishLike[] | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    loadConsideringWishes().then(w => { if (live) setWishes(w); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const view = useMemo(() => {
    if (!wishes || !isReady(calc)) return null;
    const spends = classifyWishes(wishes, today);
    return { spends, rows: spends.map(s => ({ s, impact: counted([s]).length ? impactOf(calc, [s]) : null })), total: counted(spends).length > 1 ? impactOf(calc, spends) : null };
  }, [wishes, calc, today]);
  if (error) return <article className="ui-card ui-content" role="alert"><p>心愿读取失败：{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></article>;
  if (!view || !view.spends.length) return null;
  const delayText = (d: number | null, base: number | null, withSpend: number | null) => base === null ? '本来就达不到' : withSpend === null ? '70 岁前达不到' : d === 0 ? '几乎无影响' : `推迟约 ${d} 个月`;
  return <article className="ui-card ui-content plan-goal" aria-label="大额支出">
    <div className="ui-section-head"><h3>大额支出</h3><span>来自「考虑中」的心愿</span></div>
    <table className="ui-table plan-wish-table"><thead><tr><th>心愿</th><th className="amount">预计价格</th><th>计划日期</th><th>对 FIRE 的影响</th></tr></thead>
      <tbody>{view.rows.map(({ s, impact }) => <tr key={s.id} className={s.status === 'expired' || s.status === 'no_price' ? 'closed' : undefined}>
        <td>{s.name}</td>
        <td className="amount">{s.status === 'no_price' ? <span className="muted">未填价格</span> : yuan(s.cents)}</td>
        <td>{s.status === 'today' ? <span className="muted">未设，按今天</span> : s.status === 'expired' ? <span className="ui-tag warn">已过，未计入</span> : s.status === 'dated' ? s.date : '—'}</td>
        <td>{impact ? <>{delayText(impact.delay_months, impact.base_offset, impact.with_offset)}{impact.breaches_emergency && <span className="ui-tag warn"> 低于应急金线</span>}</> : <span className="muted">—</span>}</td></tr>)}</tbody></table>
    {view.total && <p>全部同时发生：<strong>{delayText(view.total.delay_months, view.total.base_offset, view.total.with_offset)}</strong>{view.total.breaches_emergency && '，中途会低于应急金线'}。</p>}
    <p className="muted small">每一行是只买这一件的影响（其他心愿不发生）。没有计划日期的按今天买下估算，计划日期已过的不计入，更新日期后重新估算；没有填预计价格的无法估算。这是估算，不改变心愿的状态，也不替代「已买到，记录购入」。</p>
  </article>;
}
