import { CoverageNote } from './CoverageNote';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanningSources } from './plan';
import { GuidedPanel } from './career-preview/guided';
import { realGuidedDefaults } from './career-preview/guided-model';
import './planning.css';

/** Optional, read-only trial: "what if I rest or change jobs?". Closed until the user opens it; the panel is not even mounted
 *  while closed. Nothing is stored; closing, leaving the page or any change to the saved plan discards the trial. */
export function PlanningCareerCard({ sources, today }: { sources: PlanningSources; today: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null), wasOpen = useRef(false);
  const defaults = useMemo(() => (open ? realGuidedDefaults(sources, today) : null), [open, sources, today]);
  useEffect(() => { if (open) heading.current?.focus(); else if (wasOpen.current) button.current?.focus(); wasOpen.current = open; }, [open]);
  return <article className="ui-card ui-content plan-career-entry" id="plan-career-card" aria-label="职业变化试算">
    <div className="ui-section-head"><div><p className="eyebrow">可选 · 只做试算</p><h3 ref={heading} tabIndex={-1}>歇一阵或换工作，退休目标还保得住吗？</h3></div><span className="ui-tag">不保存</span></div>
    {!open ? <>
      <p className="muted">想知道被裁、辞职歇一阵能撑多久，或换成每月攒得少的工作要不要晚几年退休？填几个数就有答案。结果只在这次试算里，不会改你的目标和资料。</p>
      <div className="plan-goal-actions"><button type="button" ref={button} className="ui-btn" id="plan-career-open" aria-expanded="false" aria-controls="plan-career-panel" onClick={() => setOpen(true)}>打开职业变化试算</button></div>
    </> : <>
      <div className="plan-goal-actions"><button type="button" ref={button} className="ui-btn" aria-expanded="true" aria-controls="plan-career-panel" onClick={() => setOpen(false)}>关闭并丢弃本次填写</button></div>
      <div id="plan-career-panel"><CoverageNote sources={sources} compact/>{defaults && <GuidedPanel sources={sources} defaults={defaults} embedded/>}</div>
    </>}
  </article>;
}
