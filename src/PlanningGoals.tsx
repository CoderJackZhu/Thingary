import { useEffect, useState } from 'react';
import { money } from './asset';
import { ageText, rateText } from './plan';
import type { Income, PlanReview } from './plan';
import { coverageNow, goalHeadline } from './plan-summary';
import { PlanningCoreCard } from './PlanningCoreCard';
import { PlanningEvents } from './PlanningEvents';
import { PlanningWishes } from './PlanningWishes';
import { RetireDetail, isReady, useRetirePlan } from './PlanningRetire';
import './planning.css';

const yuan = (c: number | null | undefined) => c == null ? '待补充' : money(String(Math.round(c)));

/** 目标页由退休测算与心愿购买计划组成；预算必须明确填写，不为目标划拨真实资产。 */
export function PlanningGoals({ focus = false, onFocusDone, today, review, incomes, onEditingChange, onPending, onGoto }: { focus?: boolean; onFocusDone: () => void; today: string; review: PlanReview; incomes: Income[]; onEditingChange: (v: boolean) => void; onPending: () => void; onGoto: (tab: 'savings' | 'pension') => void }) {
  const plan = useRetirePlan(today, review, incomes);
  const [detail, setDetail] = useState(false);
  const { state, snapshot, error, calc, reload } = plan;
  // Wait for the real entry to render; navigation away drops the parent's intent.
  useEffect(() => {
    if (!focus || !state || snapshot === undefined || error) return;
    const entry = document.getElementById('plan-budget-entry');
    if (entry) { entry.focus(); onFocusDone(); }
  }, [focus, state, snapshot, error, onFocusDone]);
  if (error) return <article className="ui-card ui-content" role="alert"><p>目标读取失败：{error}</p><button onClick={reload}>重新读取</button></article>;
  if (!state || snapshot === undefined) return <p role="status" className="muted">正在读取目标…</p>;
  if (detail && calc) return <>
    <p><button type="button" className="ui-link" onClick={() => setDetail(false)}>← 返回目标</button></p>
    <RetireDetail plan={plan} initialEditing={calc.spend === null} today={today} onEditingChange={onEditingChange} onPending={onPending}/>
  </>;
  const ready = !!calc && isReady(calc);
  const P = ready ? calc.plan : null, out = ready ? calc.out : null;
  const fire = P?.mode === 'fire';
  // 结论与首页摘要共用同一投影：月龄不取整、搜索终点按实际值，两页不得一个取整一个不取整。
  const headline = ready ? goalHeadline(calc, today) : null;
  const cov = ready ? coverageNow(calc) : null;
  const requiredNow = cov?.requiredNow ?? null, percent = cov?.percent ?? null;
  const usesPlanSaving = !!calc && (calc.r.saving_phases.length > 0 || calc.r.route_id !== null);
  return <div className="plan-goals">
    <article className="ui-card ui-content plan-goal plan-retirement-goal" aria-label="退休目标">
      <div className="ui-section-head"><div><p className="eyebrow">长期生活计划</p><h3>退休与财务自由</h3></div><span className="ui-tag">{ready ? '按当前假设估算' : '待补齐资料'}</span></div>
      <div className="plan-goal-overview">
        <div>
          <p className="plan-goal-headline">{!ready ? <strong>{calc?.spend === null ? '先确定每月的生活预算' : '从自己的生活计划开始'}</strong>
            : !fire ? <><strong>{headline!.main}：{headline!.sub}</strong><span>传统模式 · {out!.funded_at_goal ? '按当前储蓄够用' : '按当前储蓄尚不够'}</span></>
            : <><strong>{headline!.main}</strong>{headline!.sub && <span>{headline!.sub}</span>}</>}</p>
          {headline?.warn && <p className="ui-note" role="status">{headline.warn}</p>}
          <p className="muted">{ready ? `按 ${calc.plan.monetary_basis_date ?? today} 的购买力，覆盖到 ${calc.r.horizon_age} 岁；养老金从 ${ageText(calc.start)}起领取。` : '退休预算由你决定。历史里的医疗、一次性购买与其他特殊支出，不会自动成为未来每个月的预算。'}</p>
          <div className="plan-goal-actions"><button type="button" id="plan-budget-entry" className="primary" onClick={() => calc ? setDetail(true) : onGoto('pension')}>{!calc ? '填写个人资料' : ready ? '查看退休测算' : '设置月预算与假设'}</button><button type="button" className="ui-btn" onClick={() => onGoto('savings')}>查看储蓄依据</button></div>
        </div>
        <dl className="plan-facts plan-goal-inputs">
          <div><dt>退休后月预算</dt><dd>{yuan(calc?.spend)}</dd><small className="muted">按今天的物价，自己填写</small></div>
          <div><dt>未来每月净投入</dt><dd>{yuan(calc?.saving)}</dd><small className="muted">{usesPlanSaving ? '显式阶段假设' : '旧自动参考待确认'}</small></div>
          <div><dt>当前可支配资产</dt><dd>{yuan(calc?.assets)}</dd><small className="muted">仅明确可用资金；债务另列</small></div>
        </dl>
      </div>
      {ready && <div className="plan-goal-progress">
        <div className="plan-progress-caption"><span>当前资产 / 今天退休所需</span><strong>{rateText(percent)}</strong></div>
        {percent !== null && <div className="plan-progress" role="img" aria-label={`进展 ${rateText(percent)}`}><div style={{ width: `${percent / 100}%` }}/></div>}
        <dl className="plan-facts"><div><dt>今天退休所需</dt><dd>{yuan(requiredNow)}</dd></div><div><dt>资产缺口</dt><dd>{yuan(requiredNow === null || calc.assets === null ? null : Math.max(0, requiredNow - calc.assets))}</dd></div><div><dt>实际年收益假设 · 退休前 / 后</dt><dd>{rateText(calc.r.real_return_before_hundredths)} / {rateText(calc.r.real_return_after_hundredths)}</dd></div></dl>
      </div>}
      {!ready && <div className="plan-goal-next" role="status">{calc ? <ul>{calc.missing.map(m => <li key={m}>{m}</li>)}</ul> : <p>先在养老金页填写出生年月与缴费资料，再设置月预算。购买计划可以先查看。</p>}</div>}
    </article>
    <PlanningCoreCard state={state} snapshot={snapshot} today={today} reload={reload} onPending={onPending} onEditingChange={onEditingChange}/>
    <PlanningEvents plan={plan} today={today} onEditingChange={onEditingChange} onPending={onPending}/>
    <PlanningWishes calc={calc} today={today}/>
  </div>;
}
