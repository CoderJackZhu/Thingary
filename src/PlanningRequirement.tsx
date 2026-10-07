import { money } from './asset';
import { Info } from './FormControls';
import type { BasicCapabilities, PlanningMissing } from './plan';
import type { CapabilityResult } from './planning-basic-port';
import { missingOwners, ownerAction, requirementLine, returnDropText } from './planning-basic-view';

const monthText = (m: string) => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;
const yuanOf = (c: string) => money(c);

/** Each missing item says what is unknown and which owner fixes it; one action per owner, never a UUID list. */
export function MissingList({ missing, onOwner, disabled }: { missing: PlanningMissing[]; onOwner: (owner: PlanningMissing['owner'], field?: string) => void; disabled?: boolean }) {
  return <div className="plan-missing" role="status">
    <ul>{missing.map(m => <li key={m.code + m.field}>{m.message}</li>)}</ul>
    <div className="plan-missing-actions">{missingOwners(missing).map(o => <button key={o} type="button" className="ui-btn" disabled={disabled} onClick={() => onOwner(o, missing.find(m => m.owner === o)?.field)}>{ownerAction[o]}</button>)}</div>
  </div>;
}

/** The capability service itself is unavailable or failed: distinct from an unknown fact. */
export function CapabilityNotice({ result }: { result: Exclude<CapabilityResult, { status: 'ready' }> }) {
  return <article className="ui-card ui-content" role="alert"><p>{result.status === 'unbound' ? '规划结果服务尚未接入，暂时无法显示需求。已保存的目标与资料不受影响。' : `规划结果计算失败：${result.message}`}</p></article>;
}

/** The primary result. Shows the real DTO status for both return conditions; a candidate is never a saved contribution. */
export function RequirementCard({ caps, onOwner, busy }: { caps: BasicCapabilities; onOwner: (owner: PlanningMissing['owner'], field?: string) => void; busy?: boolean }) {
  const req = caps.requirement;
  return <article className="ui-card ui-content plan-req" aria-label="所需投入">
    <div className="ui-section-head"><div><p className="eyebrow">按这些条件</p><h3>需要每月投入多少<Info text="只回答「要在目标时间达到，需要每月投入多少」。投入指日常收支后可留在所选资金范围内的净增减，投资收益另算；这个数不会自动成为你的预计投入。"/></h3></div></div>
    {req.status === 'blocked' ? <>
      <p className="plan-req-main muted">还算不出需要多少</p>
      <MissingList missing={req.missing} onOwner={onOwner} disabled={busy}/>
    </> : <RequirementBody value={req.value}/>}
  </article>;
}

function RequirementBody({ value }: { value: Extract<BasicCapabilities['requirement'], { status: 'ready' }>['value'] }) {
  const set = requirementLine(value.set, yuanOf), lower = requirementLine(value.lower, yuanOf);
  return <>
    <p className={`plan-req-main ${set.tone}`}><span>按所设收益，要在 {monthText(value.target_month)} 达到目标：</span><strong>{set.text}</strong></p>
    <p className="muted small">按完整预算覆盖至 {monthText(value.horizon_month)}（规划终点）。金额按今天的购买力。</p>
    <details className="plan-req-lower"><summary>收益偏低时需要多少</summary>
      <p><span className="muted">{returnDropText(value.lower.before_hundredths, value.lower.after_hundredths)}：</span><strong className={lower.tone}>{lower.text}</strong></p>
      <p className="muted small">这是把两段实际收益都调低后重新反求的压力条件，不是中位结果，也不对应某个成功概率。</p></details>
  </>;
}

/** One line for compact places (home): the same wording as the card, without the comparison row. */
export function RequirementLine({ value }: { value: Extract<BasicCapabilities['requirement'], { status: 'ready' }>['value'] }) {
  const set = requirementLine(value.set, yuanOf);
  return <p className={`review-plan-sub plan-req-line ${set.tone}`}>按这些条件，要在 {monthText(value.target_month)} 达到目标：<strong>{set.text}</strong></p>;
}
