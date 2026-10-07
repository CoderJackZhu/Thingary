import { useMemo } from 'react';
import { money } from './asset';
import { Info } from './FormControls';
import { rateText } from './plan';
import { summaryBasis, summaryRetire, usualSaving, yuan } from './plan-summary';
import type { PlanSources } from './plan-summary';
import type { ReviewPage } from './review';
import type { PlanningTab } from './PlanningPage';
import { RequirementLine } from './PlanningRequirement';
import { usePlanningSources, useCapabilities } from './planning-basic-data';
import { needsContribution, terminalText } from './planning-basic-view';

/** 首页右侧「规划」摘要（只读）：复用目标页的计算与文案投影，缺项、错误与历史储蓄各自独立降级。 */
export function ReviewPlanSummary({ data, today, onReload: reload, onNavigate, onGotoPlanning }: {
  data: PlanSources | null; today: string; onReload: () => void;
  onNavigate: (page: ReviewPage) => void;
  onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void;
}) {
  const retire = useMemo(() => (data ? summaryRetire(data, today) : { kind: 'loading' } as const), [data, today]);
  const saving = useMemo(() => (data ? (data.review.status === 'ready' ? usualSaving(data.review.value) : { kind: 'error' } as const) : { kind: 'loading' } as const), [data]);
  const basis = retire.kind === 'ready' ? summaryBasis(retire) : null;
  const basicPlan = !!(data && data.profile.status === 'ready' && data.profile.value.saved?.profile.retire.basic);

  const actions: { label: string; run: () => void }[] = retire.kind === 'ready' ? [
    { label: '查看目标 →', run: () => onGotoPlanning('goals') },
    { label: '收入与复盘 →', run: () => onGotoPlanning('savings') },
  ] : retire.kind === 'blocked' ? (
    retire.step === 'snapshot' ? [{ label: '查看账户与盘点 →', run: () => onNavigate('wealth') }] :
    retire.step === 'profile' ? [{ label: '填写个人资料 →', run: () => onGotoPlanning('pension', 'profile') }] :
    retire.step === 'budget' ? [{ label: '补充退休预算 →', run: () => onGotoPlanning('goals', 'budget') }, { label: '收入与复盘 →', run: () => onGotoPlanning('savings') }] :
    retire.step === 'saving' ? [{ label: '确认未来净投入 →', run: () => onGotoPlanning('goals', 'budget') }, { label: '收入与复盘 →', run: () => onGotoPlanning('savings') }] :
    [{ label: '查看目标 →', run: () => onGotoPlanning('goals') }]
  ) : [];
  return <article className="ui-card review-plan" aria-label="规划摘要">
    <div className="ui-section-head"><h3>规划</h3>{retire.kind === 'ready' && <span className="ui-aside">按当前假设估算</span>}</div>
    <p className="review-plan-goal">退休与财务自由{retire.kind === 'ready' && <small> · {retire.mode === 'fire' ? 'FIRE' : '传统'}</small>}</p>
    {basicPlan ? <BasicSummaryBody onGotoPlanning={onGotoPlanning}/> : retire.kind === 'ready' ? <>
      <p className="review-plan-main">{retire.headline.main}</p>
      {retire.headline.sub && <p className="review-plan-sub">{retire.headline.sub}</p>}
      {retire.headline.warn && <p className="review-plan-warn" role="status">{retire.headline.warn}</p>}
      <div className="review-plan-cov">
        <div className="review-plan-cov-head">
          <span>当前可支配资产／今天退休所需<Info text={`当前可支配资产 ${yuan(retire.coverage.assets)}（明确可用资产份额；受限资金与余债另列），今天退休所需 ${yuan(retire.coverage.requiredNow)}。这是资产比例，不是时间进度或成功概率。`}/></span>
          <b>{rateText(retire.coverage.percent)}</b>
        </div>
        <div className="review-plan-bar" role="img" aria-label={`当前可支配资产约为今天退休所需的 ${rateText(retire.coverage.percent)}`}><div style={{ width: `${retire.coverage.percent / 100}%` }}/></div>
      </div>
    </> : retire.kind === 'loading' ? <p className="review-plan-main muted" role="status">正在读取规划…</p>
      : retire.kind === 'error' ? <div className="review-error" role="alert"><p>退休估算暂时无法读取：{retire.message}</p><button onClick={reload}>重新读取</button></div>
      : <>
        <p className="review-plan-main">{retire.main}</p>
        <p className="review-plan-sub">{retire.note}</p>
      </>}
    <div className="review-plan-divide">
      <div className="review-plan-save">
        <span>历史月均净资产变化（含估值变化）<Info text="近12个月可比盘点的金融净资产变化，按区间天数加权；含估值变化。历史参考不会自动成为未来净投入。"/></span>
        {saving.kind === 'known' ? <b className={saving.negative ? 'neg' : undefined}>{money(saving.monthly_cents)}<small>／月</small></b> : null}
      </div>
      {saving.kind === 'known' ? <p className="review-plan-source">
        {saving.low_sample ? `样本少 · ${saving.count} 个区间` : `近 12 个月按天数加权 · ${saving.count} 个区间`}{saving.window_from ? ` · ${saving.window_from} 起` : ''}{retire.kind !== 'ready' && saving.latest_date ? ` · 截至 ${saving.latest_date}` : ''}
        {saving.negative && ' · 近期净资产下降（含估值变化）'}
      </p> : saving.kind === 'unknown' ? <p className="review-plan-source">待补充 · {saving.reason}</p>
      : saving.kind === 'error' ? <p className="review-plan-source">历史资产参考暂时无法读取。</p>
      : <p className="review-plan-source" role="status">正在读取…</p>}
    </div>
    {!basicPlan && basis && <p className="review-plan-source">{basis.join(' · ')}</p>}
    {!basicPlan && actions.length > 0 && <div className="review-plan-actions">{actions.map(a => <button key={a.label} className="review-action" onClick={a.run}>{a.label}</button>)}</div>}
  </article>;
}

/**
 * Basic plans read through the shared service: the requirement and the person's own target time, never a saved-contribution
 * projection while the contribution is unknown. Temporary trials live only in the goal detail and never reach this card.
 */
function BasicSummaryBody({ onGotoPlanning }: { onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void }) {
  const { load, reload } = usePlanningSources();
  if (load.status === 'loading') return <p className="review-plan-main muted" role="status">正在读取规划…</p>;
  if (load.status === 'error') return <div className="review-error" role="alert"><p>规划暂时无法读取：{load.message}</p><button onClick={reload}>重新读取</button></div>;
  return <BasicSummaryReady sources={load.sources} onGotoPlanning={onGotoPlanning}/>;
}
function BasicSummaryReady({ sources, onGotoPlanning }: { sources: import('./plan').PlanningSources; onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void }) {
  const result = useCapabilities(sources);
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null, r = saved?.profile.retire;
  if (result.status !== 'ready') return <p className="review-plan-main muted" role="status">{result.status === 'unbound' ? '规划结果服务尚未接入。' : `规划结果计算失败：${result.message}`}</p>;
  const caps = result.caps, pred = caps.prediction.status === 'ready' ? caps.prediction.value : null;
  return <>
    <p className="review-plan-main">{r?.target_age == null ? '目标年龄还没有设定' : `目标 ${r.target_age} 岁${r.mode === 'fire' ? ' 财务自由' : ' 退休'}`}</p>
    {caps.requirement.status === 'ready' ? <RequirementLine value={caps.requirement.value}/> : <p className="review-plan-sub">需求还算不出：{caps.requirement.missing[0]?.message}</p>}
    {pred ? <p className="review-plan-sub">按已保存的预计投入：{terminalText[pred.terminal]}。</p>
      : needsContribution(caps) ? <p className="review-plan-sub">预计投入未填写：不显示推算的达成时间。</p> : null}
    <div className="review-plan-actions"><button className="review-action" onClick={() => onGotoPlanning('goals')}>查看目标 →</button>{caps.requirement.status === 'blocked' && <button className="review-action" onClick={() => onGotoPlanning(caps.requirement.status === 'blocked' && caps.requirement.missing.some(m => m.owner === 'pension') ? 'pension' : 'goals', caps.requirement.status === 'blocked' && caps.requirement.missing.some(m => m.owner === 'pension') ? 'profile' : 'budget')}>补充条件 →</button>}</div>
  </>;
}
