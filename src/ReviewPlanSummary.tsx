import { useMemo } from 'react';
import { money } from './asset';
import { Info } from './FormControls';
import { rateText } from './plan';
import { summaryBasis, summaryRetire, usualSaving, yuan } from './plan-summary';
import type { PlanSources } from './plan-summary';
import type { ReviewPage } from './review';
import type { PlanningTab } from './PlanningPage';

/** 首页右侧「规划」摘要（只读）：复用目标页的计算与文案投影，缺项、错误与历史储蓄各自独立降级。 */
export function ReviewPlanSummary({ data, today, onReload: reload, onNavigate, onGotoPlanning }: {
  data: PlanSources | null; today: string; onReload: () => void;
  onNavigate: (page: ReviewPage) => void;
  onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void;
}) {
  const retire = useMemo(() => (data ? summaryRetire(data, today) : { kind: 'loading' } as const), [data, today]);
  const saving = useMemo(() => (data ? (data.review.status === 'ready' ? usualSaving(data.review.value) : { kind: 'error' } as const) : { kind: 'loading' } as const), [data]);
  const basis = retire.kind === 'ready' ? summaryBasis(retire) : null;

  const actions: { label: string; run: () => void }[] = retire.kind === 'ready' ? [
    { label: '查看目标 →', run: () => onGotoPlanning('goals') },
    { label: '储蓄与收入 →', run: () => onGotoPlanning('savings') },
  ] : retire.kind === 'blocked' ? (
    retire.step === 'snapshot' ? [{ label: '查看账户与盘点 →', run: () => onNavigate('wealth') }] :
    retire.step === 'profile' ? [{ label: '填写个人资料 →', run: () => onGotoPlanning('pension', 'profile') }] :
    retire.step === 'budget' ? [{ label: '补充退休预算 →', run: () => onGotoPlanning('goals', 'budget') }, { label: '储蓄与收入 →', run: () => onGotoPlanning('savings') }] :
    retire.step === 'saving' ? [{ label: '储蓄与收入 →', run: () => onGotoPlanning('savings') }] :
    [{ label: '查看目标 →', run: () => onGotoPlanning('goals') }]
  ) : [];
  return <article className="ui-card review-plan" aria-label="规划摘要">
    <div className="ui-section-head"><h3>规划</h3>{retire.kind === 'ready' && <span className="ui-aside">按当前假设估算</span>}</div>
    <p className="review-plan-goal">退休与财务自由{retire.kind === 'ready' && <small> · {retire.mode === 'fire' ? 'FIRE' : '传统'}</small>}</p>
    {retire.kind === 'ready' ? <>
      <p className="review-plan-main">{retire.headline.main}</p>
      {retire.headline.sub && <p className="review-plan-sub">{retire.headline.sub}</p>}
      {retire.headline.warn && <p className="review-plan-warn" role="status">{retire.headline.warn}</p>}
      <div className="review-plan-cov">
        <div className="review-plan-cov-head">
          <span>当前可支配资产／今天退休所需<Info text={`当前可支配资产 ${yuan(retire.coverage.assets)}（最近完整盘点里计入的资产 − 负债 − 公积金类账户），今天退休所需 ${yuan(retire.coverage.requiredNow)}。这是资产比例，不是时间进度或成功概率。`}/></span>
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
        <span>常态月储蓄<Info text="由最近 12 个月内结束的可比盘点区间推出的月储蓄中位数（净资产变化 − 公积金余额变化），包含利息和投资涨跌，不等同于工资结余；标记为一次性变动的区间不参与。它是历史参考，不是退休测算用的未来储蓄。"/></span>
        {saving.kind === 'known' ? <b className={saving.negative ? 'neg' : undefined}>{money(saving.monthly_cents)}<small>／月</small></b> : null}
      </div>
      {saving.kind === 'known' ? <p className="review-plan-source">
        {saving.low_sample ? `样本少 · ${saving.count} 个区间` : `近 12 个月可比区间中位数 · ${saving.count} 个区间`}{saving.window_from ? ` · ${saving.window_from} 起` : ''}{retire.kind !== 'ready' && saving.latest_date ? ` · 截至 ${saving.latest_date}` : ''}
        {saving.negative && ' · 近期在动用积累'}
      </p> : saving.kind === 'unknown' ? <p className="review-plan-source">待补充 · {saving.reason}</p>
      : saving.kind === 'error' ? <p className="review-plan-source">历史储蓄暂时无法读取。</p>
      : <p className="review-plan-source" role="status">正在读取…</p>}
    </div>
    {basis && <p className="review-plan-source">{basis.join(' · ')}</p>}
    {actions.length > 0 && <div className="review-plan-actions">{actions.map(a => <button key={a.label} className="review-action" onClick={a.run}>{a.label}</button>)}</div>}
  </article>;
}
