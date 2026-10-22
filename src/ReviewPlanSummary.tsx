import { useMemo } from 'react';
import { money } from './asset';
import { Info } from './FormControls';
import { rateText } from './plan';
import { summaryBasis, summaryRetire, usualSaving } from './plan-summary';
import type { PlanSources, SummaryRetire } from './plan-summary';
import type { ReviewPage } from './review';
import type { PlanningTab } from './PlanningPage';
import { CoverageNote } from './CoverageNote';
import { RequirementLine } from './PlanningRequirement';
import { needsContribution, terminalText } from './planning-basic-view';
import { t } from './i18n.ts';
/** 首页右侧「规划」摘要（只读）：复用目标页的计算与文案投影，缺项、错误与历史储蓄各自独立降级。 */
export function ReviewPlanSummary({ data, today, onReload: reload, onNavigate, onGotoPlanning }: {
  data: PlanSources | null; today: string; onReload: () => void;
  onNavigate: (page: ReviewPage) => void;
  onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void;
}) {
  const retire = useMemo(() => (data ? summaryRetire(data, today) : { kind: 'loading' } as const), [data, today]);
  const saving = useMemo(() => (data ? (data.review.status === 'ready' ? usualSaving(data.review.value) : { kind: data.review.value.code === 'MODULE_DISABLED' ? 'disabled' : 'error' } as const) : { kind: 'loading' } as const), [data]);
  const basis = retire.kind === 'ready' ? summaryBasis(retire) : null;
  const basicPlan = !!(data && data.profile.status === 'ready' && data.profile.value.saved?.profile.retire.basic);
  const summaryAnnotations = retire.kind === 'ready' ? retire.calc.annotations : retire.kind === 'blocked' ? retire.capabilities?.annotations : undefined;
  const estimateInfo = [t('按已保存条件估算，不保证未来一定够用；条件、遗漏或待确认事项会影响结果。'), ...(basis ?? []), ...(!basicPlan && retire.kind === 'ready' ? [t('当前可支配资产与今天退休所需的比例只表示资产覆盖，不是时间进度或成功概率。')] : [])].join(' ');

  const actions: { label: string; run: () => void }[] = retire.kind === 'ready' ? [
    { label: t('查看目标 →'), run: () => onGotoPlanning('goals') },
    { label: t('财务复盘 →'), run: () => onGotoPlanning('savings') },
  ] : retire.kind === 'blocked' ? (
    retire.step === 'snapshot' ? [{ label: t('查看账户与盘点 →'), run: () => onNavigate('wealth') }] :
    retire.step === 'profile' ? [{ label: t('设置退休计划 →'), run: () => onGotoPlanning('goals', 'profile') }] :
    retire.step === 'budget' ? [{ label: t('补充退休预算 →'), run: () => onGotoPlanning('goals', 'budget') }, { label: t('财务复盘 →'), run: () => onGotoPlanning('savings') }] :
    retire.step === 'saving' ? [{ label: t('估一估每月能存多少 →'), run: () => onGotoPlanning('goals', 'budget') }, { label: t('财务复盘 →'), run: () => onGotoPlanning('savings') }] :
    [{ label: t('查看目标 →'), run: () => onGotoPlanning('goals') }]
  ) : [];
  return <article className="ui-card review-plan" aria-label={t('目标摘要')}>
    <div className="ui-section-head"><h3>{t('规划')}<Info text={estimateInfo}/></h3></div>
    <CoverageNote annotations={summaryAnnotations} compact/>
    <p className="review-plan-goal">{t('退休与财务自由')}{retire.kind === 'ready' && <small> · {retire.mode === 'fire' ? t('钱够用后退休') : t('按时间退休')}</small>}</p>
    {basicPlan ? <BasicSummaryBody sources={data!} retire={retire} onGotoPlanning={onGotoPlanning}/> : retire.kind === 'ready' ? <>
      <p className="review-plan-main">{retire.headline.main}</p>
      {retire.headline.sub && retire.headline.sub !== '估算' && <p className="review-plan-sub">{retire.headline.sub}</p>}
      {retire.headline.warn && <p className="review-plan-warn" role="status">{retire.headline.warn}</p>}
      <div className="review-plan-cov">
        <div className="review-plan-cov-head">
          <span>{t('当前可支配资产／今天退休所需')}</span>
          <b>{rateText(retire.coverage.percent)}</b>
        </div>
        <div className="review-plan-bar" role="img" aria-label={t('当前可支配资产约为今天退休所需的 {v1}', { v1: rateText(retire.coverage.percent) })}><div style={{ width: `${retire.coverage.percent / 100}%` }}/></div>
      </div>
    </> : retire.kind === 'loading' ? <p className="review-plan-main muted" role="status">{t('正在读取目标…')}</p>
      : retire.kind === 'error' ? <div className="review-error" role="alert"><p>{t('退休估算暂时无法读取：{message}', { message: retire.message })}</p><button onClick={reload}>{t('重新读取')}</button></div>
      : <>
        <p className="review-plan-main">{retire.main}</p>
        <p className="review-plan-sub">{retire.note}</p>
      </>}
    {saving.kind !== 'disabled' && <details className="review-plan-divide" open={saving.kind === 'error' ? true : undefined}><summary>{t('过去每月家底变化（含投资涨跌）')}</summary>
      <div className="review-plan-save">
        <span>{t('每月平均变化')}<Info text={t('近 12 个月里、前后都是完整盘点的区间，金融净资产的平均变化（按天数加权，含投资涨跌）。这只是过去的参考，不会自动当成以后每月能存的钱。')}/></span>
        {saving.kind === 'known' ? <b className={saving.negative ? 'neg' : undefined}>{money(saving.monthly_cents)}<small>{t('／月')}</small></b> : null}
      </div>
      {saving.kind === 'known' ? <p className="review-plan-source">
        {saving.low_sample ? t('样本少 · {count} 个区间', { count: saving.count }) : t('按天数加权 · {count} 个区间', { count: saving.count })}{saving.window_from ? t(' · 统计最近 12 个月（{v1} 起）', { v1: saving.window_from.slice(0, 7) }) : ''}{retire.kind !== 'ready' && saving.latest_date ? t(' · 截至 {latest_date}', { latest_date: saving.latest_date }) : ''}
        {saving.negative && t(' · 近期净资产下降（含估值变化）')}
      </p> : saving.kind === 'unknown' ? <p className="review-plan-source">{t('待补充 · {reason}', { reason: saving.reason })}</p>
      : saving.kind === 'error' ? <div className="review-error" role="alert"><p className="review-plan-source">{t('历史资产参考暂时无法读取。')}</p><button onClick={reload}>{t('重新读取历史资产参考')}</button></div>
      : <p className="review-plan-source" role="status">{t('正在读取…')}</p>}
    </details>}
    {!basicPlan && actions.length > 0 && <div className="review-plan-actions">{actions.map(a => <button key={a.label} className="review-action" onClick={a.run}>{a.label}</button>)}</div>}
  </article>;
}

/** Basic results use the overview's committed batch; refreshing it refreshes every planning number together. */
function BasicSummaryBody({ sources, retire, onGotoPlanning }: { sources: PlanSources; retire: SummaryRetire; onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void }) {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null, r = saved?.profile.retire;
  const caps = retire.kind === 'ready' ? retire.calc.capabilities : retire.kind === 'blocked' ? retire.capabilities : null;
  if (!caps) return <p className="review-plan-main muted" role="status">{retire.kind === 'error' ? t('目标结果读取失败：{message}', { message: retire.message }) : t('正在读取目标…')}</p>;
  const pred = caps.prediction.status === 'ready' ? caps.prediction.value : null;
  return <>
    <p className="review-plan-main">{retire.kind === 'ready' ? retire.headline.main : r?.simplified.time.target_month == null ? t('目标月份还没有设定') : t('目标 {target_month}{v2}', { target_month: r.simplified.time.target_month, v2: r.mode === 'fire' ? t(' 财务自由') : t(' 退休') })}</p>
    {retire.kind === 'ready' && retire.headline.sub && retire.headline.sub !== '估算' && <p className="review-plan-sub">{retire.headline.sub}</p>}
    {caps.requirement.status === 'ready' ? <RequirementLine value={caps.requirement.value} annotations={caps.annotations} showCoverage={false}/> : <p className="review-plan-sub">{t('需求还算不出：{message}', { message: caps.requirement.missing[0]?.message })}</p>}
    {pred ? <p className="review-plan-sub">{t('按你估计每月能存下的钱：{v1}。', { v1: terminalText[pred.terminal] })}</p>
      : needsContribution(caps) ? <p className="review-plan-sub">{t('还没估计每月能存多少钱，先看目标需要的钱即可。')}</p> : null}
    <div className="review-plan-actions"><button className="review-action" onClick={() => onGotoPlanning('goals')}>{t('查看目标 →')}</button>{caps.requirement.status === 'blocked' && <button className="review-action" onClick={() => onGotoPlanning('goals', 'budget')}>{t('补充条件 →')}</button>}</div>
  </>;
}
