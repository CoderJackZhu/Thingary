import { CoverageNote } from './CoverageNote';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage, money } from './asset';
import { loadConsideringWishes } from './plan-data';
import type { RetireCalc } from './plan-retire-calc';
import { classifyWishes, counted, impactOf, isReady } from './plan-wishes';
import type { WishLike } from './plan-wishes';
import { t } from './i18n.ts';
const yuan = (c: number) => money(String(Math.round(c)));

/** 试算页的心愿影响卡：把「考虑中」的心愿当作一次性支出，看对 FIRE 日期的影响。只读，不改心愿。 */
export function PlanningWishes({ calc, today, hint = t('退休资料待补齐'), onContribution }: { calc: RetireCalc | null; today: string; hint?: string; onContribution?: () => void }) {
  const [wishes, setWishes] = useState<WishLike[] | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    loadConsideringWishes().then(w => { if (live) setWishes(w); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const view = useMemo(() => {
    if (!wishes) return null;
    const ready = isReady(calc);
    const spends = classifyWishes(wishes, today);
    return { spends, rows: spends.map(s => ({ s, impact: ready && s.offset_months !== null ? impactOf(calc, [s]) : null })), total: ready && counted(spends).length > 1 ? impactOf(calc, counted(spends)) : null };
  }, [wishes, calc, today]);
  if (error) return <article className="ui-card ui-content" role="alert"><p>{t('心愿读取失败：{error}', { error })}</p><button onClick={() => setRetry(n => n + 1)}>{t('重新读取')}</button></article>;
  if (!view) return <article className="ui-card ui-content plan-goal" role="status">{t('正在读取心愿…')}</article>;
  if (!view.spends.length) return <article className="ui-card ui-content plan-goal" aria-label={t('心愿对目标的影响')}><div className="ui-section-head"><h3>{t('心愿对目标的影响')}</h3><span>{t('来自心愿清单')}</span></div><p className="muted small">{t('只比较影响，不计入目标；决定后可加入大额计划。')}</p><p className="muted">{t('还没有考虑中的心愿。在心愿清单记录打算买的东西、预计价格与计划日期，就能在这里查看。')}</p></article>;
  const delayText = (d: number | null, base: number | null, withSpend: number | null) => base === null ? t('本来就达不到') : withSpend === null ? t('所选规划终点前达不到') : d === 0 ? t('几乎无影响') : t('推迟约 {d} 个月', { d });
  return <article className="ui-card ui-content plan-goal" aria-label={t('心愿对目标的影响')}>
    <div className="ui-section-head"><h3>{t('心愿对目标的影响')}</h3><span>{t('来自「考虑中」的心愿')}</span></div>
    <p className="muted small">{t('只比较影响，不计入目标；决定后可加入大额计划。')}</p>
    <CoverageNote annotations={calc?.annotations} compact/><div className="plan-table-scroll" tabIndex={0} role="region" aria-label={t('心愿列表')}><table className="ui-table plan-wish-table"><thead><tr><th>{t('心愿')}</th><th className="amount">{t('预计价格')}</th><th>{t('计划日期')}</th><th>{t('对退休计划的影响')}</th></tr></thead>
      <tbody>{view.rows.map(({ s, impact }) => <tr key={s.id} className={s.status === 'expired' || s.status === 'no_price' ? 'closed' : undefined}>
        <td>{s.name}</td>
        <td className="amount">{s.status === 'no_price' ? <span className="muted">{t('未填价格')}</span> : yuan(s.cents)}</td>
        <td>{s.status === 'today' ? <span className="muted">{t('未设（仅作假设）')}</span> : s.status === 'expired' ? <span className="ui-tag warn">{t('已过，未计入')}</span> : s.status === 'dated' ? s.date : '—'}</td>
        <td>{impact ? <>{delayText(impact.delay_months, impact.base_offset, impact.with_offset)}{impact.breaches_emergency && <span className="ui-tag warn"> {t('低于应急金线')}</span>}</> : <><span className="muted">{s.status === 'expired' ? t('未计入') : s.status === 'no_price' ? t('需填预计价格') : hint}</span>{onContribution && s.status !== 'expired' && s.status !== 'no_price' && <button type="button" className="ui-link" onClick={onContribution}>{t('估计每月能存多少钱')}</button>}</>}</td></tr>)}</tbody></table></div>
    {view.total && <p>{t('若有计划日期的这几件都按计划买下：')}<strong>{delayText(view.total.delay_months, view.total.base_offset, view.total.with_offset)}</strong>{view.total.breaches_emergency && t('，中途会低于应急金线')}。</p>}
    <details className="plan-explanation"><summary>{t('估算如何比较心愿影响')}</summary><p className="muted small">{t('每一行是「如果买下」的影响，只算这一件（其他心愿不发生）。合计只计入填了计划日期、也就是打算买的；没填日期的只作「如果今天买」的假设，不进合计；计划日期已过的不计入，更新日期后重新估算；没填预计价格的无法估算。这些只是估算，不扣你真实的资产，不改变心愿的状态，也不替代「已买到，记录购入」；还没决定的心愿不要填计划日期，价格建议填偏保守的。')}</p></details>
  </article>;
}
