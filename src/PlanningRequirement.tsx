import { CoverageNote } from './CoverageNote';
import { money } from './asset';
import { Info } from './FormControls';
import type { BasicCapabilities, PlanningMissing } from './plan';
import type { CapabilityResult } from './planning-basic-port';
import { missingOwners, missingAction, missingText, requirementLine, returnDropText, returnRiseText, returnBasisText } from './planning-basic-view';

const monthText = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;
const yuanOf = (c: string) => money(c);

/** Each missing item says what is unknown and which owner fixes it; one action per owner, never a UUID list. */
export function MissingList({ missing, onOwner, disabled }: { missing: PlanningMissing[]; onOwner: (owner: PlanningMissing['owner'], field?: string) => void; disabled?: boolean }) {
  return <div className="plan-missing" role="status">
    <ul>{[...new Set(missing.map(missingText))].map(text => <li key={text}>{text}</li>)}</ul>
    <div className="plan-missing-actions">{missingOwners(missing).map(o => <button key={o} type="button" className="ui-btn" disabled={disabled} onClick={() => onOwner(o, missing.find(m => m.owner === o)?.field)}>{missingAction(missing.find(m => m.owner === o)!)}</button>)}</div>
  </div>;
}

/** The capability service itself is unavailable or failed: distinct from an unknown fact. */
export function CapabilityNotice({ result }: { result: Exclude<CapabilityResult, { status: 'ready' }> }) {
  return <article className="ui-card ui-content" role="alert"><p>{result.status === 'unbound' ? '规划结果服务尚未接入，暂时无法显示需求。已保存的目标与资料不受影响。' : `规划结果计算失败：${result.message}`}</p></article>;
}

/** The primary result. Shows the real DTO status for both return conditions; a candidate is never a saved contribution. */
export function RequirementCard({ caps, onOwner, busy }: { caps: BasicCapabilities; onOwner: (owner: PlanningMissing['owner'], field?: string) => void; busy?: boolean }) {
  const req = caps.requirement;
  return <article className="ui-card ui-content plan-req" aria-label="每月需要存多少钱">
    <div className="ui-section-head"><div><p className="eyebrow">软件帮你算</p><h3>为这个目标，每月大约要存多少钱？<Info text="这是软件算出的参考金额，不用你填写，也不会自动保存成你每月能存的钱。这里的存钱是收入减去开销后留下的钱，买基金等投入也算，投资涨跌另算。"/></h3></div></div>
    {req.status === 'blocked' ? <>
      <p className="plan-req-main muted">再补几项，就能算了</p>
      <MissingList missing={req.missing} onOwner={onOwner} disabled={busy}/>
    </> : <RequirementBody value={req.value} annotations={caps.annotations}/>}
  </article>;
}

function RequirementBody({ value, annotations }: { annotations?: BasicCapabilities['annotations']; value: Extract<BasicCapabilities['requirement'], { status: 'ready' }>['value'] }) {
  const set = requirementLine(value.set, yuanOf), lower = requirementLine(value.lower, yuanOf), upper = requirementLine(value.upper, yuanOf);
  return <>
    <p className={`plan-req-main ${set.tone}`}><span>如果想在 {monthText(value.target_month)} 退休：</span><strong>{set.text}</strong></p><CoverageNote annotations={annotations}/>
    <p className="muted small">准备支付生活费到 {monthText(value.horizon_month)}。金额按今天的物价计算。</p>
    <p className="muted small">这是计算结果，不用填写。它取决于生活费和收益假设，不保证未来一定够用。</p>
    <details className="plan-req-lower"><summary>查看计算假设，以及收益变化的影响</summary>
      <p className="muted small">当前假设：{returnBasisText(value.set.before_hundredths, value.set.after_hundredths)}，已扣除通胀。投资不保证收益，之后随时可以修改。</p>
      <p><span className="muted">{returnDropText(value.lower.before_hundredths, value.lower.after_hundredths)}：</span><strong className={lower.tone}>{lower.text}</strong></p>
      <p><span className="muted">{returnRiseText(value.upper.before_hundredths, value.upper.after_hundredths)}：</span><strong className={upper.tone}>{upper.text}</strong></p>
      <p className="muted small">这是把两段实际收益各调低或调高 2 个百分点后重新计算的对照，不代表发生的概率。</p></details>
  </>;
}

/** One line for compact places (home): the same wording as the card, without the comparison row. */
export function RequirementLine({ value, annotations }: { annotations?: BasicCapabilities['annotations']; value: Extract<BasicCapabilities['requirement'], { status: 'ready' }>['value'] }) {
  const set = requirementLine(value.set, yuanOf);
  return <><p className={`review-plan-sub plan-req-line ${set.tone}`}>按这些条件，想在 {monthText(value.target_month)} 退休，每月需要存：<strong>{set.text}</strong></p><CoverageNote annotations={annotations} compact/></>;
}
