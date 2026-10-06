import { useState } from 'react';
import { money } from './asset';
import { ageText, rateText } from './plan';
import type { Income, PlanReview } from './plan';
import { monthsLeftText, progressHundredths } from './plan-fire';
import { required } from './plan-ledger';
import { PlanningWishes } from './PlanningWishes';
import { RetireDetail, isReady, useRetirePlan } from './PlanningRetire';
import './planning.css';

const yuan = (c: number | null | undefined) => c == null ? '待补充' : money(String(Math.round(c)));
const yearOf = (today: string, offset: number) => Math.floor((Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset) / 12);
const ageOf = (months: number) => `${Math.floor(months / 12)} 岁`;

/** 目标页由退休测算与心愿购买计划组成；预算必须明确填写，不为目标划拨真实资产。 */
export function PlanningGoals({ today, review, incomes, onEditingChange, onPending, onGoto }: { today: string; review: PlanReview; incomes: Income[]; onEditingChange: (v: boolean) => void; onPending: () => void; onGoto: (tab: 'savings' | 'pension') => void }) {
  const plan = useRetirePlan(today, review, incomes);
  const [detail, setDetail] = useState(false);
  const { state, snapshot, error, calc, reload } = plan;
  if (error) return <article className="ui-card ui-content" role="alert"><p>目标读取失败：{error}</p><button onClick={reload}>重新读取</button></article>;
  if (!state || snapshot === undefined) return <p role="status" className="muted">正在读取目标…</p>;
  if (detail && calc) return <>
    <p><button type="button" className="ui-link" onClick={() => setDetail(false)}>← 返回目标</button></p>
    <RetireDetail plan={plan} initialEditing={calc.spend === null} today={today} onEditingChange={onEditingChange} onPending={onPending}/>
  </>;
  const ready = !!calc && calc.missing.length === 0 && isReady(calc);
  const P = ready ? calc.plan : null, proj = ready ? calc.proj : null, out = ready ? calc.out : null;
  const requiredNow = P ? required(P, P.now_months) : null, fire = P?.mode === 'fire';
  const percent = ready && calc.assets !== null && requiredNow !== null ? progressHundredths(calc.assets, requiredNow) : null;
  const toFi = proj && P && proj.fi_month !== null ? proj.fi_month - P.now_months : null;
  return <div className="plan-goals">
    <article className="ui-card ui-content plan-goal plan-retirement-goal" aria-label="退休目标">
      <div className="ui-section-head"><div><p className="eyebrow">长期生活计划</p><h3>退休与财务自由</h3></div><span className="ui-tag">{ready ? '按当前假设估算' : '待补齐资料'}</span></div>
      <div className="plan-goal-overview">
        <div>
          <p className="plan-goal-headline">{!ready ? <strong>{calc?.spend === null ? '先确定每月的生活预算' : '从自己的生活计划开始'}</strong>
            : !fire ? <><strong>{ageOf(P!.target_months)}退休：{out!.funded_at_goal ? `预计盈余 ${yuan(Math.max(0, out!.assets_at_goal - out!.required_at_goal))}` : `预计缺口 ${yuan(out!.shortfall_at_goal)}`}</strong><span>传统模式 · {out!.funded_at_goal ? '按当前储蓄够用' : '按当前储蓄尚不够'}</span></>
            : toFi === null ? <strong>当前假设下，70 岁前尚未达成</strong> : toFi <= 0 ? <strong>当前资产已覆盖退休所需</strong>
            : <><strong>预计还需 {monthsLeftText(toFi)}</strong><span>约 {yearOf(today, toFi)} 年 · {ageOf(proj!.fi_month!)}{proj!.fi_month! > P!.target_months ? `（比期望的 ${ageOf(P!.target_months)}晚）` : ''}</span></>}</p>
          <p className="muted">{ready ? `按今天的购买力，覆盖到 ${calc.r.horizon_age} 岁；养老金从 ${ageText(calc.start)}起领取。` : '退休预算由你决定。历史里的医疗、一次性购买与其他特殊支出，不会自动成为未来每个月的预算。'}</p>
          <div className="plan-goal-actions"><button type="button" className="primary" onClick={() => calc ? setDetail(true) : onGoto('pension')}>{!calc ? '填写个人资料' : ready ? '查看退休测算' : '设置月预算与假设'}</button><button type="button" className="ui-btn" onClick={() => onGoto('savings')}>查看储蓄依据</button></div>
        </div>
        <dl className="plan-facts plan-goal-inputs">
          <div><dt>退休后月预算</dt><dd>{yuan(calc?.spend)}</dd><small className="muted">按今天的物价，自己填写</small></div>
          <div><dt>常态月储蓄</dt><dd>{yuan(calc?.saving)}</dd><small className="muted">来自收入与完整盘点</small></div>
          <div><dt>当前可支配资产</dt><dd>{yuan(calc?.assets)}</dd><small className="muted">扣除负债与公积金</small></div>
        </dl>
      </div>
      {ready && <div className="plan-goal-progress">
        <div className="plan-progress-caption"><span>当前资产 / 今天退休所需</span><strong>{rateText(percent)}</strong></div>
        {percent !== null && <div className="plan-progress" role="img" aria-label={`进展 ${rateText(percent)}`}><div style={{ width: `${percent / 100}%` }}/></div>}
        <dl className="plan-facts"><div><dt>今天退休所需</dt><dd>{yuan(requiredNow)}</dd></div><div><dt>资产缺口</dt><dd>{yuan(requiredNow === null || calc.assets === null ? null : Math.max(0, requiredNow - calc.assets))}</dd></div><div><dt>实际年收益假设 · 退休前 / 后</dt><dd>{rateText(calc.r.real_return_before_hundredths)} / {rateText(calc.r.real_return_after_hundredths)}</dd></div></dl>
      </div>}
      {!ready && <div className="plan-goal-next" role="status">{calc ? <ul>{calc.missing.map(m => <li key={m}>{m}</li>)}</ul> : <p>先在养老金页填写出生年月与缴费资料，再设置月预算。购买计划可以先查看。</p>}</div>}
    </article>
    <PlanningWishes calc={calc} today={today}/>
  </div>;
}
