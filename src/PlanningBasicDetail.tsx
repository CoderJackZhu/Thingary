import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { money } from './asset';
import { CentInput, Info } from './FormControls';
import { CapabilityNotice, MissingList, RequirementCard } from './PlanningRequirement';
import { RetireOverview, useValueMode } from './RetireOverview';
import { RiskLab } from './RiskLab';
import { rateText } from './plan';
import type { BasicCapabilities, PlanningMissing, PlanningSources, ProfileState } from './plan';
import { toEvent } from './plan-retire-calc';
import { basicInput, draftOf } from './planning-basic-forms';
import { useCapabilities, useSectionSaver } from './planning-basic-data';
import { amountState, SAVE_CONTRIBUTION_HINT, setupStepFor } from './planning-basic-view';
import './retire.css';

type Saved = NonNullable<ProfileState['saved']>;
const incomeModeText = { excluded: '本次不计任何退休收入', manual: '手填的收入', beijing: '北京养老金估算' } as const;
const treatmentText = { included: '已含在总预算', extra: '另外计入', excluded: '本次不计' } as const;
const contributionText = (cents: string | null) => { const s = amountState(cents); return s === 'unknown' ? '未知（尚未填写）' : s === 'zero' ? '明确 0（不再新增投入）' : `${money(cents!)}/月`; };

/** Basic-plan detail: the requirement stays visible; prediction and risk tools open only for an explicit saved or trial contribution. */
export function PlanningBasicDetail({ sources, saved, today, reload, onPending, onEditingChange, openSetup, onGoto, onEvents, onBack }: { sources: PlanningSources; saved: Saved; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; openSetup: (step: number, from?: HTMLElement | null) => void; onGoto: (tab: 'savings' | 'pension') => void; onEvents: () => void; onBack: () => void }) {
  const [trial, setTrial] = useState<string | null>(null), [tab, setTab] = useState<'overview' | 'lab'>('overview'), [mode, setMode] = useValueMode();
  const result = useCapabilities(sources, { contribution: trial });
  const saver = useSectionSaver(sources, reload, onPending);
  const retire = saved.profile.retire;
  const owner = (o: PlanningMissing['owner'], field?: string) => { if (o === 'basic' || o === 'budget' || o === 'funds') openSetup(setupStepFor(o, field)); else if (o === 'pension') onGoto('pension'); else if (o === 'events') onEvents(); else if (o === 'service') reload(); };

  async function saveContribution(value: string | null) {
    const d = draftOf(saved, null, today); d.contribution = value ?? '';
    let input; try { input = basicInput(d, saved, today); } catch { return false; }
    const ok = !!(await saver.save(input)); if (ok) setTrial(null); return ok;
  }
  const caps = result.status === 'ready' ? result.caps : null;
  const pred = caps?.prediction.status === 'ready' ? caps.prediction.value : null;
  const events = retire.life_events.map(toEvent);
  return <div className="rd-detail">
    <p><button type="button" className="ui-link" onClick={onBack}>{trial !== null ? '← 返回目标（临时试算不会保存）' : '← 返回目标'}</button></p>
    <div className="rd-tabs" role="group" aria-label="退休页签"><button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>概览</button><button type="button" aria-pressed={tab === 'lab'} onClick={() => setTab('lab')}>假设分析</button></div>
    <div className="rd-grid">
      <div className="rd-main">
        <Trial trial={trial} onTrial={setTrial} saved={retire.basic?.contribution.monthly_cents ?? null} busy={saver.busy || saver.stuck} onSave={() => void saveContribution(trial)} notice={saver.notice}/>
        {result.status !== 'ready' ? <CapabilityNotice result={result}/> : tab === 'lab'
          ? (pred ? <RiskLab calc={{ plan: pred.plan, assets: pred.plan.assets_cents }} today={today} basic={{ temporary: pred.source === 'temporary', terminal: pred.terminal }}/> : <NeedContribution caps={result.caps} onOwner={owner}/>)
          : <>
            <RequirementCard caps={result.caps} onOwner={owner} busy={saver.busy}/>
            {pred ? <RetireOverview calc={{ plan: pred.plan, proj: pred.projection, out: pred.outcome, assets: pred.plan.assets_cents, plan0: pred.plan0, events, r: retire }} mode={mode} onMode={setMode} basic={{ temporary: pred.source === 'temporary', contribution: pred.contribution_cents, terminal: pred.terminal }}/> : <NeedContribution caps={result.caps} onOwner={owner}/>}
          </>}
      </div>
      <BasicSidebar saved={saved} caps={caps} openSetup={openSetup} onGoto={onGoto} contribution={<ContributionCard saved={saved} busy={saver.busy || saver.stuck} notice={saver.notice} onSave={saveContribution} onEditingChange={onEditingChange}/>}/>
    </div>
  </div>;
}

/** Shown instead of any projected age/date, chart or simulation share until a contribution is explicit. */
function NeedContribution({ caps, onOwner }: { caps: BasicCapabilities; onOwner: (o: PlanningMissing['owner'], field?: string) => void }) {
  const p = caps.prediction;
  if (p.status === 'ready') return null;
  return <article className="ui-card ui-content" aria-label="预测与风险">
    <h3>预测与风险</h3>
    {p.missing.some(m => m.code === 'CONTRIBUTION_UNKNOWN') ? <p>还没有预计每月投入，所以这里不显示推算的达成年龄或日期、资产预测图、模拟比例和未来购买余额。需求与你设定的目标时间不受影响。在上方「试算每月投入」试一个数，或在右侧保存预计投入。</p> : <MissingList missing={p.missing} onOwner={onOwner}/>}
  </article>;
}

function Trial({ trial, onTrial, saved, busy, onSave, notice }: { trial: string | null; onTrial: (v: string | null) => void; saved: string | null; busy: boolean; onSave: () => void; notice: string }) {
  const [text, setText] = useState('');
  return <article className="ui-card ui-content plan-trial" aria-label="试算每月投入">
    <div className="ui-section-head"><h3>试算每月投入<Info text="只在这个页面里预览：不保存、不改变首页、心愿或已保存的投入。想保留请明确保存。"/></h3>{trial !== null && <span className="ui-tag warn">临时试算，未保存</span>}</div>
    <div className="plan-trial-row"><CentInput label="试算每月净投入" signed value={text} placeholder={saved === null ? '填一个金额试试' : money(saved)} onChange={setText}/>
      <button type="button" className="primary" disabled={text === ''} onClick={() => onTrial(text)}>试算</button>
      <button type="button" className="ui-btn" onClick={() => onTrial('0')}>试算：不再新增投入</button>
      {trial !== null && <button type="button" className="ui-btn" onClick={() => { onTrial(null); setText(''); }}>清除试算</button>}
      {trial !== null && <button type="button" className="ui-btn" disabled={busy} onClick={onSave}>保存为预计投入</button>}</div>
    <p className="muted small">日常收支后可留在所选资金范围内的净增减，投资收益另算；负数表示动用存款。</p>
    {notice && <p className="notice" role="status">{notice}</p>}
  </article>;
}

function Card({ title, onEdit, children, tip }: { title: string; onEdit?: (el: HTMLElement) => void; children: ReactNode; tip?: string }) {
  return <article className="ui-card rs-card" aria-label={title}><header><div><h3>{title}{tip && <Info text={tip}/>}</h3></div>{onEdit && <button type="button" className="ui-btn" aria-label={`编辑${title}`} onClick={e => onEdit(e.currentTarget)}>编辑</button>}</header>{children}</article>;
}
const Rows = ({ rows }: { rows: [string, ReactNode][] }) => <dl className="rs-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;

/** Basic groups only: goal, budget and income, funds, optional contribution, more assumptions. No phases, routes or careers. */
function BasicSidebar({ saved, caps, openSetup, onGoto, contribution }: { saved: Saved; caps: BasicCapabilities | null; openSetup: (step: number, from?: HTMLElement | null) => void; onGoto: (tab: 'savings' | 'pension') => void; contribution: ReactNode }) {
  const p = saved.profile, r = p.retire, b = r.basic!;
  const funds = caps?.funds, pension = caps?.pension;
  const scope = (id: string) => { const c = b.retirement_costs.find(x => x.source_id === id); return c ? treatmentText[c.treatment] : '包含关系待确认'; };
  return <div className="rd-side">
    <Card title="目标与预算" onEdit={el => openSetup(0, el)}>
      <Rows rows={[['计划类型', r.mode === 'fire' ? '财务自由' : '按年龄退休'], ['目标年龄', r.target_age === null ? '未设定' : `${r.target_age} 岁`], ['出生年月', p.birth_month ?? '未填写'], ['退休后每月预算', r.spend_cents === null ? '未填写' : money(r.spend_cents)]]}/>
      {(r.spend_items.length > 0 || Number(r.rent_cents) > 0) && <><p className="muted small">已有的支出明细（保留标记，已含的不再叠加）：</p>
        <ul className="rs-list">{r.spend_items.map(i => <li key={i.id}><span>{i.label}<small>{i.essential ? '必需' : '灵活'} · {scope(`spend:${i.id}`)}</small></span><b>{money(i.monthly_cents)}/月</b></li>)}
          {Number(r.rent_cents) > 0 && <li><span>房租<small>{scope('rent')}</small></span><b>{money(r.rent_cents)}/月</b></li>}</ul></>}
    </Card>
    <Card title="资金起点" onEdit={el => openSetup(1, el)}>
      {funds?.status === 'ready' ? <Rows rows={[['来源', funds.value.kind === 'simulation' ? '模拟起点' : '实际盘点'], ['截至', funds.value.date], ['规划可用', money(funds.value.available_cents)], ['受限 / 余债', `${money(funds.value.restricted_cents)} / ${money(funds.value.debt_cents)}`]]}/> : funds ? <ul className="plan-missing-list">{funds.missing.map(m => <li key={m.code + m.field}>{m.message}</li>)}</ul> : <p className="muted small">读取中…</p>}
    </Card>
    <Card title="退休收入" onEdit={el => openSetup(1, el)} tip="未选择、本次不计、手填、北京估算含义不同；本次不计不会删除原有收入资料。">
      <p>{b.retirement_income.mode === null ? '暂不选择（需求暂不计退休收入）' : incomeModeText[b.retirement_income.mode]}</p>
      {b.retirement_income.selected.length > 0 && <ul className="rs-list">{b.retirement_income.selected.map(s => { const i = r.income_items.find(x => x.id === s.id); return <li key={s.id}><span>{i?.label ?? '已删除的收入'}<small>{s.role === 'state_pension' ? '国家养老金' : '其他收入'}</small></span><b>{i ? `${money(i.monthly_cents)}/月` : '—'}</b></li>; })}</ul>}
      {b.retirement_income.mode === 'beijing' && (pension?.status === 'ready' ? <p className="muted small">{pension.value.included ? `政策养老金 ${pension.value.monthly_cents === null ? '' : money(pension.value.monthly_cents) + '/月，'}${pension.value.start_month ? `${pension.value.start_month} 起领` : ''}` : '政策估算未计入'}</p> : pension ? <><ul className="plan-missing-list">{pension.missing.map(m => <li key={m.code + m.field}>{m.message}</li>)}</ul><div className="rs-actions"><button type="button" className="ui-btn" onClick={() => onGoto('pension')}>填写养老金事实</button><button type="button" className="ui-btn" onClick={() => openSetup(1)}>改为手填或本次不计</button></div></> : null)}
    </Card>
    {contribution}
    <Card title="更多假设" onEdit={el => openSetup(0, el)} tip="全部是假设，不是事实。收益按扣除通胀后的实际收益填写。">
      <Rows rows={[['退休前 / 后实际收益', `${rateText(r.real_return_before_hundredths)} / ${rateText(r.real_return_after_hundredths)}`], ['通胀', rateText(p.assumptions.inflation_hundredths)], ['规划终点', `${r.horizon_age} 岁`], ['应急金', `${r.emergency_months} 个月`]]}/>
    </Card>
    {r.legacy_definition && <Card title="原规划假设（只读）" tip="改用通用方式前的原规划定义，原样保留可核对；不再参与通用测算。">
      <Rows rows={[['记录于', r.legacy_definition.recorded_at], ['原目标', r.legacy_definition.target_age === null ? '未设定' : `${r.legacy_definition.target_age} 岁`], ['原储蓄阶段', `${r.legacy_definition.saving_phases.length} 段${r.legacy_definition.route_id ? ' · 含路线' : ''}`], ['原退休后预算', r.legacy_definition.spend_cents === null ? '未填写' : money(r.legacy_definition.spend_cents)]]}/></Card>}
  </div>;
}

/** The only place a contribution is saved from the detail. Blank is unknown; 0 and negatives are explicit values. */
function ContributionCard({ saved, busy, notice, onSave, onEditingChange }: { saved: Saved; busy: boolean; notice: string; onSave: (v: string | null) => Promise<boolean>; onEditingChange: (v: boolean) => void }) {
  const current = saved.profile.retire.basic?.contribution.monthly_cents ?? null;
  const [editing, setEditing] = useState(false), [text, setText] = useState(current ?? ''), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  const close = () => { setEditing(false); requestAnimationFrame(() => button.current?.focus()); };
  return <article className="ui-card rs-card" id="plan-contribution-card" aria-label="预计投入"><header><div><h3>预计每月投入<Info text="选填。日常收支后可留在所选资金范围内的净增减，投资收益另算。不填也能看需求；填写后才开放预测与风险工具。"/></h3></div>
    {editing ? <span className="rs-actions"><button type="button" className="ui-btn" disabled={busy} onClick={() => { setText(current ?? ''); close(); }}>取消</button><button type="button" className="primary" disabled={busy} onClick={async () => { if (await onSave(text === '' ? null : text)) close(); }}>{busy ? '保存中…' : '保存'}</button></span>
      : <button ref={button} type="button" className="ui-btn" aria-label="编辑预计投入" onClick={() => { setText(current ?? ''); setEditing(true); }}>编辑</button>}</header>
    {editing ? <div className="rs-form"><label className="rs-field"><span>每月净投入</span><CentInput label="预计每月净投入" signed value={text} disabled={busy} placeholder="留空表示未知" onChange={setText}/><small>负数表示动用存款；0 是「明确不再新增投入」，与留空不同。</small></label>{notice && <p className="notice" role="status">{notice}</p>}</div>
      : <><p>{contributionText(current)}</p>{current === null && <p className="muted small">{SAVE_CONTRIBUTION_HINT}：关联的心愿与大额计划会在保存后显示影响。</p>}</>}
  </article>;
}
