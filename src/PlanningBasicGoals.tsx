import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './asset';
import type { Account, Snapshot } from './wealth';
import type { PlanningMissing, PlanningSources, ProfileState } from './plan';
import { CapabilityNotice, RequirementCard } from './PlanningRequirement';
import { FundsCard } from './PlanningFunds';
import { PlanningBasicDetail } from './PlanningBasicDetail';
import { PlanningEvents } from './PlanningEvents';
import type { EventsStore } from './PlanningEvents';
import { PlanningWishes } from './PlanningWishes';
import { ready } from './review';
import { eventsInput } from './planning-basic-forms';
import { useCapabilities, useSectionSaver } from './planning-basic-data';
import { amountState, needsContribution, setupStepFor, SAVE_CONTRIBUTION_HINT, terminalText } from './planning-basic-view';
import type { PlanMode } from './planning-basic-view';
import './planning.css';

type Saved = NonNullable<ProfileState['saved']>;

/** Goals for the basic and not-yet-set-up cases. The original plan has its own compatible page. */
export function PlanningBasicGoals({ sources, mode, today, reload, onPending, onEditingChange, onGoto, openSetup, focus = false, onFocusDone }: { sources: PlanningSources; mode: Exclude<PlanMode, 'legacy'>; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; onGoto: (tab: 'savings' | 'pension') => void; openSetup: (step?: number, from?: HTMLElement | null) => void; focus?: boolean; onFocusDone: () => void }) {
  const [detail, setDetail] = useState<{ contribution: boolean } | null>(null);
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const snapshot: Snapshot | null = ready(sources.snapshot) ?? null, accounts: Account[] = ready(sources.accounts) ?? [];
  const result = useCapabilities(sources);
  const saver = useSectionSaver(sources, reload, onPending);
  const fundsOpen = useRef<(() => void) | null>(null);
  useEffect(() => { if (focus) { const entry = document.getElementById('plan-budget-entry'); if (entry) { entry.focus(); onFocusDone(); } } }, [focus, onFocusDone, saved]);
  useEffect(() => { if (detail?.contribution) document.querySelector<HTMLElement>('#plan-contribution-card button')?.focus(); }, [detail]);

  const caps = result.status === 'ready' ? result.caps : null;
  const pred = caps?.prediction.status === 'ready' ? caps.prediction.value : null;
  const events: EventsStore | null = useMemo(() => {
    if (!saved || !caps) return null;
    const r = saved.profile.retire;
    return { retire: r, snapshot, accounts, busy: saver.busy, stuck: saver.stuck, notice: saver.notice,
      ready: pred && pred.source === 'saved' ? { plan: pred.plan, plan0: pred.plan0 } : null, blocked: needsContribution(caps) ? SAVE_CONTRIBUTION_HINT : '资料待补齐',
      onContribution: needsContribution(caps) ? () => setDetail({ contribution: true }) : undefined,
      write: async (life_events, core) => !!core && !!(await saver.save(eventsInput({ life_events, occurrences: core.occurrences, costs: core.costs }))) };
  }, [saved, caps, pred, snapshot, accounts, saver.busy, saver.stuck, saver.notice]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sources.profile.status === 'error') return <article className="ui-card ui-content" role="alert"><p>规划资料读取失败：{sources.profile.value.message}</p><button onClick={reload}>重新读取</button></article>;
  const wishHint = caps && needsContribution(caps) ? SAVE_CONTRIBUTION_HINT : '退休资料待补齐';
  const goContribution = caps && needsContribution(caps) ? () => setDetail({ contribution: true }) : undefined;

  if (mode === 'none' || !saved) return <div className="plan-goals">
    <article className="ui-card ui-content plan-goal plan-retirement-goal" aria-label="退休目标">
      <div className="ui-section-head"><div><p className="eyebrow">长期生活计划</p><h3>退休与财务自由</h3></div><span className="ui-tag">还没有设置</span></div>
      <p className="plan-goal-headline"><strong>先说说你的目标，没想好的可以留空</strong></p>
      <p className="muted">只需要目标、预算和这次用哪些资金。预计每月投入不是必填；不填也能看到需要每月投入多少。想先记录收入或看复盘，可以直接跳过。</p>
      <div className="plan-goal-actions"><button type="button" id="plan-budget-entry" className="primary" onClick={e => openSetup(0, e.currentTarget)}>开始设置</button><button type="button" className="ui-btn" onClick={() => onGoto('savings')}>先看收入与复盘</button></div>
    </article>
    <PlanningWishes calc={null} today={today} hint="设置目标后可查看"/>
  </div>;

  if (detail && saved.profile.retire.basic) return <PlanningBasicDetail key={detail.contribution ? 'c' : 'd'} sources={sources} saved={saved as Saved} today={today} reload={reload} onPending={onPending} onEditingChange={onEditingChange} openSetup={openSetup} onGoto={onGoto} onBack={() => setDetail(null)}/>;

  const r = saved.profile.retire, b = r.basic!;
  const contribution = amountState(b.contribution.monthly_cents);
  const owner = (o: PlanningMissing['owner'], field?: string) => { if (o === 'funds') fundsOpen.current?.(); else if (o === 'pension') onGoto('pension'); else if (o === 'service') reload(); else openSetup(setupStepFor(o, field)); };
  return <div className="plan-goals">
    <article className="ui-card ui-content plan-goal plan-retirement-goal" aria-label="退休目标">
      <div className="ui-section-head"><div><p className="eyebrow">长期生活计划</p><h3>退休与财务自由</h3></div><span className="ui-tag">{caps?.requirement.status === 'ready' ? '按这些条件估算' : '待补齐条件'}</span></div>
      <div className="plan-goal-overview">
        <div>
          <p className="plan-goal-headline"><strong>目标：{r.target_age === null ? '还没有设定年龄' : `${r.target_age} 岁${r.mode === 'fire' ? ' 财务自由' : ' 退休'}`}</strong>{caps?.requirement.status === 'ready' && <span>{r.mode === 'fire' ? '期望时间' : '目标时间'}：{caps.requirement.value.target_month}</span>}</p>
          {pred ? <p className="muted">按已保存的预计投入 {money(pred.contribution_cents)}/月：{terminalText[pred.terminal]}。</p>
            : contribution === 'unknown' ? <p className="muted">你还没有填写预计投入，所以不显示推算的达成年龄或日期、预测图和模拟比例；需要多少投入和你设定的目标时间不受影响。</p> : null}
          <div className="plan-goal-actions"><button type="button" id="plan-budget-entry" className="primary" onClick={() => setDetail({ contribution: false })}>查看测算详情</button><button type="button" className="ui-btn" onClick={e => openSetup(0, e.currentTarget)}>编辑目标与设置</button><button type="button" className="ui-btn" onClick={() => onGoto('savings')}>收入与复盘</button></div>
        </div>
        <dl className="plan-facts plan-goal-inputs">
          <div><dt>退休后月预算</dt><dd>{r.spend_cents === null ? '待补充' : money(r.spend_cents)}</dd><small className="muted">按今天的物价，完整预算</small></div>
          <div><dt>预计每月投入</dt><dd>{contribution === 'unknown' ? '未填写' : contribution === 'zero' ? '明确 0' : money(b.contribution.monthly_cents!)}</dd><small className="muted">{contribution === 'unknown' ? '选填，不填也能看需求' : '你保存的假设，不含投资收益'}</small></div>
          <div><dt>规划可用资金</dt><dd>{caps?.funds.status === 'ready' ? money(caps.funds.value.available_cents) : '待补充'}</dd><small className="muted">{caps?.funds.status === 'ready' ? `${caps.funds.value.kind === 'simulation' ? '模拟起点' : '实际盘点'} · 截至 ${caps.funds.value.date}` : '仅明确可用资金'}</small></div>
        </dl>
      </div>
    </article>
    {result.status !== 'ready' ? <CapabilityNotice result={result}/> : <RequirementCard caps={result.caps} onOwner={owner} busy={saver.busy}/>}
    {caps && !pred && contribution === 'unknown' && <article className="ui-card ui-content plan-contribution-prompt" aria-label="预计投入"><div className="ui-section-head"><h3>预计每月投入（选填）</h3><button type="button" className="ui-btn" onClick={() => setDetail({ contribution: true })}>填写预计投入</button></div><p className="muted">填写后才会开放预测与风险工具；未填写时它保持「未知」，不会当作 0。</p></article>}
    {caps && <FundsCard caps={caps} sources={sources} saved={saved as Saved} snapshot={snapshot} accounts={accounts} today={today} reload={reload} onPending={onPending} onEditingChange={onEditingChange} openRef={fundsOpen}/>}
    {events && <PlanningEvents store={events} today={today} onEditingChange={onEditingChange}/>}
    <PlanningWishes calc={null} today={today} hint={pred ? '影响待共享计算接入' : wishHint} onContribution={goContribution}/>
  </div>;
}
