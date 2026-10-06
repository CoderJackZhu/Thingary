import { useState } from 'react';
import { money } from './asset';
import { ageText, rateText } from './plan';
import type { Income, PlanReview } from './plan';
import { monthsLeftText, progressHundredths } from './plan-fire';
import { PlanningWishes } from './PlanningWishes';
import { RetireDetail, useRetirePlan } from './PlanningRetire';
import './planning.css';

const yuan = (c: number) => money(String(Math.round(c)));
const yearOf = (today: string, offset: number) => Math.floor((Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset) / 12);

/** 目标首页：每个目标一张卡片，点开看详情。目前只有「退休」；不为目标划拨资产，进展由盘点与收入自动推出。 */
export function PlanningGoals({ today, review, incomes, onEditingChange, onPending, onGoto }: { today: string; review: PlanReview; incomes: Income[]; onEditingChange: (v: boolean) => void; onPending: () => void; onGoto: (tab: 'savings' | 'pension') => void }) {
  const plan = useRetirePlan(today, review, incomes);
  const [detail, setDetail] = useState(false);
  const { state, snapshot, error, calc, reload } = plan;
  if (error) return <article className="ui-card ui-content" role="alert"><p>目标读取失败：{error}</p><button onClick={reload}>重新读取</button></article>;
  if (!state || snapshot === undefined) return <p role="status" className="muted">正在读取目标…</p>;
  if (detail && calc) return <>
    <p><button type="button" className="ui-link" onClick={() => setDetail(false)}>← 返回目标</button></p>
    <RetireDetail plan={plan} today={today} onEditingChange={onEditingChange} onPending={onPending}/>
  </>;
  if (!state.saved || !calc) return <div className="plan-goals"><article className="ui-card ui-content plan-goal" aria-label="退休目标">
    <div className="ui-section-head"><h3>退休</h3><span className="ui-tag">未设置</span></div>
    <p>先填写个人资料（出生年月、社保缴费情况），就能估算多久之后可以不再工作。</p>
    <button className="primary" onClick={() => onGoto('pension')}>去填个人资料</button></article></div>;
  const { fire, required_now: need, assets, saving } = calc;
  const percent = assets !== null && need !== undefined ? progressHundredths(assets, need) : null;
  return <div className="plan-goals">
    <article className="ui-card ui-content plan-goal" aria-label="退休目标">
      <div className="ui-section-head"><h3>退休</h3><span>{ageText(calc.start)}起可领养老金</span></div>
      {calc.missing.length > 0 || fire === undefined ? <>
        {calc.missing.map(m => <p key={m} className="notice" role="status">{m}</p>)}
        <div className="plan-goal-actions"><button type="button" className="ui-btn" onClick={() => onGoto('savings')}>去记录收入</button><button type="button" className="ui-btn" onClick={() => setDetail(true)} disabled={!calc}>退休假设</button></div>
      </> : <>
        <p className="plan-goal-headline">{fire === null ? <strong>{70} 岁前达不到</strong> : fire.offset_months === 0 ? <strong>按现在的资产已经够了</strong> : <><strong>还要 {monthsLeftText(fire.offset_months)}</strong><span className="muted">　约 {yearOf(today, fire.offset_months)} 年，{ageText(fire.age_months)}</span></>}</p>
        {percent !== null && <div className="plan-progress" role="img" aria-label={`进展 ${rateText(percent)}`}><div style={{ width: `${percent / 100}%` }}/></div>}
        <dl className="plan-facts">
          <div><dt>已有（可支配）</dt><dd>{yuan(assets!)}</dd></div>
          <div><dt>今天就退所需</dt><dd>{need === undefined ? '—' : yuan(need)}</dd></div>
          <div><dt>还差</dt><dd>{need === undefined ? '—' : yuan(Math.max(0, need - assets!))}</dd></div>
          <div><dt>进展</dt><dd>{rateText(percent)}</dd></div>
        </dl>
        <p className="muted small">按常态月储蓄 {saving === null ? '—' : yuan(saving)}、退休前后实际收益率 {rateText(calc.r.real_return_before_hundredths)} / {rateText(calc.r.real_return_after_hundredths)} 推算（今天的钱）。进展是现在的资产相对「今天就退休」所需资产的比例，起步阶段看着低很正常，更看「还要几年」。</p>
        <div className="plan-goal-actions"><button type="button" className="primary" onClick={() => setDetail(true)}>查看详情</button></div>
      </>}
    </article>
    <PlanningWishes calc={calc} today={today}/>
  </div>;
}
