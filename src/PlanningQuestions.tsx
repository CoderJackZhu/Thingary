import type { BasicCapabilities, ProfileState } from './plan';
import { annotationSummary } from './plan-annotations';
import { forecastMoney } from './plan-format';
import { monthIndexV1, monthTextV1 } from './plan-simplified';
import { missingText, requirementLine } from './planning-basic-view';

/** Entries and summaries of existing capabilities; no separate calculation or saved choice. */
export function PlanningQuestions({ saved, caps, blocked = false, onSetup, onDetail, onRunway }: {
  saved: ProfileState['saved']; caps: BasicCapabilities | null; blocked?: boolean;
  onSetup: (from: HTMLElement) => void; onDetail: (target: string) => void; onRunway: () => void;
}) {
  const hasGoal = !!saved?.profile.retire.basic;
  const requirement = caps?.requirement, prediction = caps?.prediction;
  const unavailable = '计算条件暂不可用，请查看下方原因。';
  const requirementText = !hasGoal ? '先设置目标，再看每月需要准备多少。'
    : !requirement ? unavailable : requirement.status === 'ready' ? requirementLine(requirement.value.set, forecastMoney).text
    : [...new Set(requirement.missing.map(missingText))].join(' ');
  let predictionText = !hasGoal ? '先设置目标，再按你估计的每月投入推演。' : unavailable;
  if (hasGoal && prediction) {
    if (prediction.status === 'blocked') predictionText = [...new Set(prediction.missing.map(missingText))].join(' ');
    else if (saved?.profile.retire.mode === 'fire') {
      const p = prediction.value, month = p.projection.retire_month;
      predictionText = month === null ? '规划终点前尚未达成'
        : !p.plan.anchor_date ? '预计退休月份尚不能确定' : `预计 ${monthTextV1(monthIndexV1(p.plan.anchor_date) + month - p.plan.now_months)} 退休`;
    } else predictionText = prediction.value.outcome.funded_at_goal ? '按所选目标月份检查：资金已够用。' : '按所选目标月份检查：资金仍有缺口。';
    if (prediction.status === 'ready') {
      if (!prediction.value.outcome.success) predictionText += ' 按当前投入，尚未满足完整目标。';
      else if (prediction.value.terminal === 'no_margin') predictionText += ' 所选期间可覆盖，终点没有余量。';
    }
  }
  const detailBlocked = blocked || (hasGoal && !caps);
  return <section aria-label="三个规划问题">
    <div className="planning-questions">
      <article className="ui-card ui-content"><h3>每月要存多少</h3><p>{requirementText}</p><p className="muted small">按固定目标月份反求，不是未来预测。</p>
        <button type="button" className="ui-btn" disabled={detailBlocked} aria-label={hasGoal ? '查看每月要存多少' : '先设置目标：每月要存多少'} onClick={e => hasGoal ? onDetail('plan-requirement-result') : onSetup(e.currentTarget)}>{hasGoal ? '查看测算详情' : '先设置目标'}</button></article>
      <article className="ui-card ui-content"><h3>什么时候能不靠工资</h3><p>{predictionText}</p><p className="muted small">按已保存的预计投入与条件估算，不保证未来一定够用。</p>
        <button type="button" className="ui-btn" disabled={detailBlocked} aria-label={hasGoal ? '查看什么时候能不靠工资' : '先设置目标：什么时候能不靠工资'} onClick={e => hasGoal ? onDetail('plan-prediction-result') : onSetup(e.currentTarget)}>{hasGoal ? '查看预测与条件' : '先设置目标'}</button></article>
      <article className="ui-card ui-content"><h3>歇一阵能撑多久</h3><p>按当前可用资金和必要收支，看看还能支付几个月。</p><p className="muted small">独立临时试算，无需退休目标；输入不保存。</p>
        <button type="button" className="ui-btn" disabled={blocked} onClick={onRunway}>试算资金能撑多久</button></article>
    </div>
    {annotationSummary(caps?.annotations).map(line => <p className="coverage-summary muted small" key={line}>{line}</p>)}
  </section>;
}
