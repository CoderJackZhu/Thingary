import { CostsDialog } from './PlanningCosts';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { money } from './asset';
import { CentInput, Info } from './FormControls';
import { CapabilityNotice, MissingList, RequirementCard } from './PlanningRequirement';
import { RetireOverview, Snapshot, useValueMode } from './RetireOverview';
import { RiskLab } from './RiskLab';
import { rateText } from './plan';
import { ageText } from './planning-simplified-ui/income-view';


import type { BasicCapabilities, PlanningMissing, PlanningSources, ProfileState } from './plan';
import { toEvent } from './plan-retire-calc';
import { contributionSection } from './planning-basic-forms';
import { ContributionHelper } from './PlanningContributionHelper';
import { useCapabilities, useSectionSaver } from './planning-basic-data';
import { amountState, SAVE_CONTRIBUTION_HINT } from './planning-basic-view';
import { snapshotRows } from './plan-view';
import { AssumptionsSummary } from './planning-followup-ui/AssumptionsSummary';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import './retire.css';

type Saved = NonNullable<ProfileState['saved']>
const incomeModeText = { unconfirmed: '还没确认收入计入方式', excluded: '本次不计未来收入', manual: '手填的未来收入' } as const;
const treatmentText = { included: '已含在总预算', extra: '另外计入', excluded: '本次不计' } as const;
const contributionText = (cents: string | null) => { const s = amountState(cents); return s === 'unknown' ? '以后再估计' : s === 'zero' ? '每月存 0 元（本次估计）' : `${money(cents!)}/月`; };

/** Basic-plan detail: the requirement stays visible; prediction and risk tools open only for an explicit saved or trial contribution. */
export function PlanningBasicDetail({ sources, saved, today, reload, onPending, onEditingChange, openSetup, onEvents, onBack, assumptionsPort, advancedOpen = false, onAdvancedOpenChange }: { sources: PlanningSources; saved: Saved; today: string; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; openSetup: (step: number, from?: HTMLElement | null) => void; onEvents: () => void; onBack: () => void; assumptionsPort?: PlanningFollowupPortV1; advancedOpen?: boolean; onAdvancedOpenChange?: (open: boolean) => void }) {
  const [costsOpen, setCostsOpen] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [contributionEditing, setContributionEditing] = useState(false);
  useEffect(() => { onEditingChange(costsOpen || assumptionsOpen || contributionEditing); return () => onEditingChange(false); }, [costsOpen, assumptionsOpen, contributionEditing, onEditingChange]);
  const [trial, setTrial] = useState<string | null>(null), [tab, setTab] = useState<'overview' | 'lab'>('overview'), [mode, setMode] = useValueMode();
  const savedContribution = saved.profile.retire.basic?.contribution.monthly_cents ?? null;
  // Unknown future contributions stay unknown even when historical estimates exist.
  const result = useCapabilities(sources, { contribution: trial });
  const saver = useSectionSaver(sources, reload, onPending);
  const retire = saved.profile.retire;
  const owner = (o: PlanningMissing['owner'], field?: string) => {
    if (field?.includes('_costs')) setCostsOpen(true);
    else if (o === 'events') onEvents();
    else if (o === 'service') reload();
    else openSetup(o === 'funds' || field?.startsWith('basic.start') ? 2 : field?.includes('income') ? 3 : field === 'spend_cents' ? 1 : 0);
  };

  async function saveContribution(value: string | null) {
    const input = contributionSection(saved, value, today); if (!input) return false;
    const ok = !!(await saver.save(input)); if (ok) setTrial(null); return ok;
  }
  const caps = result.status === 'ready' ? result.caps : null;
  const pred = caps?.prediction.status === 'ready' ? caps.prediction.value : null;
  const events = retire.life_events.map(toEvent);
  return <div className="rd-detail">
    {costsOpen && <CostsDialog sources={sources} saved={saved} reload={reload} onPending={onPending} onClose={() => { setCostsOpen(false); requestAnimationFrame(() => document.getElementById('plan-budget-entry')?.focus()); }}/>}
    <p><button type="button" className="ui-link" onClick={onBack}>{trial !== null ? '← 返回目标（临时试算不会保存）' : '← 返回目标'}</button></p>
    {assumptionsPort && <AssumptionsSummary port={assumptionsPort} generation={sources.generation} writeVersion={sources.write_version} blocked={saver.busy || saver.stuck} reload={reload} onPending={onPending} onEditingChange={setAssumptionsOpen}/>}

    <div className="rd-tabs" role="group" aria-label="切换计算详情页面"><button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}><strong>概览</strong><span>查看结果与资金轨迹</span></button><button type="button" aria-pressed={tab === 'lab'} onClick={() => setTab('lab')}><strong>假设分析</strong><span>比较收益、支出变化的影响</span></button></div>
    <p className="muted small" role="note">预测取决于你填写的生活费、收入和收益假设，实际结果可能不同，不保证未来一定够用。</p>
    <div className="rd-grid">
      <div className="rd-main">
        <Trial trial={trial} onTrial={setTrial} saved={savedContribution} busy={saver.busy || saver.stuck} onSave={() => void saveContribution(trial)} notice={saver.notice}/>
        {result.status !== 'ready' ? <CapabilityNotice result={result}/> : tab === 'lab'
          ? (pred ? <RiskLab advancedOpen={advancedOpen} onAdvancedOpenChange={onAdvancedOpenChange} calc={{ plan: pred.plan, assets: pred.plan.assets_cents }} today={today} basic={{ temporary: pred.source === 'temporary', terminal: pred.terminal }}/> : <NeedContribution caps={result.caps} onOwner={owner}/>)
          : <>
            <div id="plan-requirement-result" tabIndex={-1}><RequirementCard caps={result.caps} onOwner={owner} busy={saver.busy}/></div>
            <div id="plan-prediction-result" tabIndex={-1}>{pred ? <RetireOverview hideSnapshot calc={{ plan: pred.plan, proj: pred.projection, out: pred.outcome, assets: pred.plan.assets_cents, plan0: pred.plan0, events, r: retire }} mode={mode} onMode={setMode} basic={{ temporary: pred.source === 'temporary', contribution: pred.contribution_cents, terminal: pred.terminal }}/> : <NeedContribution caps={result.caps} onOwner={owner}/>}</div>
          </>}
      </div>
      <BasicSidebar saved={saved} caps={caps} openSetup={openSetup} contribution={<ContributionCard saved={saved} reference={null} busy={saver.busy || saver.stuck} notice={saver.notice} onSave={saveContribution} onEditingChange={setContributionEditing}/>}/>
    </div>
    {tab === 'overview' && pred && <Snapshot mode={mode} rows={snapshotRows(pred.plan, pred.projection, mode)}/>}
  </div>;
}

/** Shown instead of any projected age/date, chart or simulation share until a contribution is explicit. */
function NeedContribution({ caps, onOwner }: { caps: BasicCapabilities; onOwner: (o: PlanningMissing['owner'], field?: string) => void }) {
  const p = caps.prediction;
  if (p.status === 'ready') return null;
  return <article className="ui-card ui-content" aria-label="预测与风险">
    <h3>预测与风险</h3>
    {p.missing.some(m => m.code === 'CONTRIBUTION_UNKNOWN') ? <p>想看未来的钱够不够，可以先试一个每月能存下的金额。还没想好也没关系，上面的目标需求仍可查看。</p> : <MissingList missing={p.missing} onOwner={onOwner}/>}
  </article>;
}

function Trial({ trial, onTrial, saved, busy, onSave, notice }: { trial: string | null; onTrial: (v: string | null) => void; saved: string | null; busy: boolean; onSave: () => void; notice: string }) {
  const [text, setText] = useState('');
  return <article className="ui-card ui-content plan-trial" aria-label="每月存钱的依据">
    {trial !== null && <div className="ui-section-head"><h3>临时试算<Info text="只在这个页面里预览：不保存、不改变首页、心愿或已保存的投入。想保留请明确保存。"/></h3><span className="ui-tag warn">临时试算，未保存</span></div>}
    <details open={trial !== null}><summary>试试每月存不同的金额</summary>
      <div className="plan-trial-row"><CentInput label="试算每月能存下的钱" signed value={text} placeholder={saved === null ? '填一个金额试试' : money(saved)} onChange={setText}/>
        <button type="button" className="primary" disabled={text === ''} onClick={() => onTrial(text)}>试算</button>
        <button type="button" className="ui-btn" onClick={() => onTrial('0')}>按每月存 0 元试算</button>
        {trial !== null && <button type="button" className="ui-btn" onClick={() => { onTrial(null); setText(''); }}>清除试算</button>}
        {trial !== null && <button type="button" className="ui-btn" disabled={busy} onClick={onSave}>保存这个储蓄估计</button>}</div>
      <p className="muted small">每月到账减去全部开销后剩下的钱。买基金等投入也算，投资涨跌不算；取用存款填负数。只试算不会保存。</p>
    </details>
    {notice && <p className="notice" role="status">{notice}</p>}
  </article>;
}

function Card({ title, onEdit, children, tip }: { title: string; onEdit?: (el: HTMLElement) => void; children: ReactNode; tip?: string }) {
  return <article className="ui-card rs-card" aria-label={title}><header><div><h3>{title}{tip && <Info text={tip}/>}</h3></div>{onEdit && <button type="button" className="ui-btn" aria-label={`编辑${title}`} onClick={e => onEdit(e.currentTarget)}>编辑</button>}</header>{children}</article>;
}
const Rows = ({ rows }: { rows: [string, ReactNode][] }) => <dl className="rs-rows">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;

/** Basic groups only: goal, budget and income, funds, optional contribution, more assumptions. No phases, routes or careers. */
function BasicSidebar({ saved, caps, openSetup, contribution }: { saved: Saved; caps: BasicCapabilities | null; openSetup: (step: number, from?: HTMLElement | null) => void; contribution: ReactNode }) {
  const p = saved.profile, r = p.retire, b = r.basic!;
  const funds = caps?.funds;
  const scope = (id: string) => { const c = b.retirement_costs.find(x => x.source_id === id); return c ? treatmentText[c.treatment] : '这笔钱是否已含在生活费里，待确认'; };
  return <div className="rd-side">
    <Card title="目标与预算" onEdit={el => openSetup(0, el)}>
      <Rows rows={[['计划类型', r.mode === 'fire' ? '财务自由' : '按月份退休'], ['目标月份', r.simplified.time.target_month ?? '未设定'], [r.simplified.time.reference?.age_months === 0 ? '出生年月' : '年龄参考', r.simplified.time.reference ? r.simplified.time.reference.age_months === 0 ? r.simplified.time.reference.month : `${r.simplified.time.reference.month} 时 ${ageText(r.simplified.time.reference.age_months)}` : '未填写（可选）'], ['退休后每月预算', r.spend_cents === null ? '未填写' : money(r.spend_cents)], ['应急金参考线', `${r.emergency_months} 个月`]]}/>
      {(r.spend_items.length > 0 || Number(r.rent_cents) > 0) && <><p className="muted small">已有的支出明细（阶段性支出可在「每月生活费」一步增删）：</p>
        <ul className="rs-list">{r.spend_items.map(i => <li key={i.id}><span>{i.label}<small>{i.essential ? '必需' : '灵活'} · {scope(`spend:${i.id}`)}</small></span><b>{money(i.monthly_cents)}/月</b></li>)}
          {Number(r.rent_cents) > 0 && <li><span>房租<small>{scope('rent')}</small></span><b>{money(r.rent_cents)}/月</b></li>}</ul></>}
    </Card>
    <Card title="资金起点" onEdit={el => openSetup(2, el)}>
      {funds?.status === 'ready' ? <Rows rows={[['来源', funds.value.kind === 'simulation' ? '手填金额' : '实际盘点'], ['截至', funds.value.date], ['可以动用', money(funds.value.available_cents)], ['暂不能动用 / 欠款', `${money(funds.value.restricted_cents)} / ${money(funds.value.debt_cents)}`]]}/> : funds ? <ul className="plan-missing-list">{funds.missing.map(m => <li key={m.code + m.field}>{m.message}</li>)}</ul> : <p className="muted small">读取中…</p>}
    </Card>
    <Card title="未来收入" onEdit={el => openSetup(3, el)} tip="官方工具的测算结果或其他手填收入假设；不在本应用计算领取资格。">
      <p>{incomeModeText[r.simplified.income_mode]}</p>
      {r.simplified.income_mode === 'manual' && <ul className="rs-list">{r.simplified.future_incomes.filter(i => i.included).map(i => <li key={i.id}><span>{i.name || '未命名收入'}<small>{i.start_month ?? '开始月待填'} → {i.end_month ?? '规划终点'}</small></span><b>{i.monthly_cents === null ? '金额待填' : `${money(i.monthly_cents)}/月`}</b></li>)}</ul>}
    </Card>
    {contribution}
    <Card title="更多假设" onEdit={el => openSetup(5, el)} tip="全部是假设，不是事实。收益按扣除通胀后的实际收益填写。">
      <Rows rows={[['退休前 / 后实际收益', `${rateText(r.real_return_before_hundredths)} / ${rateText(r.real_return_after_hundredths)}`], ['通胀', rateText(p.assumptions.inflation_hundredths)], ['规划终点', r.simplified.time.horizon_month ?? '未设定']]}/>
    </Card>

  </div>;
}

/** The only place a contribution is saved from the detail. Blank is unknown; 0 and negatives are explicit values. */
function ContributionCard({ saved, reference, busy, notice, onSave, onEditingChange }: { saved: Saved; reference: string | null; busy: boolean; notice: string; onSave: (v: string | null) => Promise<boolean>; onEditingChange: (v: boolean) => void }) {
  const current = saved.profile.retire.basic?.contribution.monthly_cents ?? null;
  const [editing, setEditing] = useState(false), [text, setText] = useState(current ?? ''), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  const close = () => { setEditing(false); requestAnimationFrame(() => button.current?.focus()); };
  return <article className="ui-card rs-card" id="plan-contribution-card" aria-label="每月能存的钱"><header><div><h3>每月能存的钱（选填）<Info text="例如每月到账 10000 元、全部开销 6000 元，就填 4000 元。包括买基金等留下的钱，不包含投资涨跌。没想好可以不填，以后再修改。"/></h3></div>
    {editing ? <span className="rs-actions"><button type="button" className="ui-btn" disabled={busy} onClick={() => { setText(current ?? ''); close(); }}>取消</button><button type="button" className="primary" disabled={busy} onClick={async () => { if (await onSave(text === '' ? null : text)) close(); }}>{busy ? '保存中…' : '保存'}</button></span>
      : <button ref={button} type="button" className="ui-btn" aria-label="编辑每月能存的钱" onClick={() => { setText(current ?? ''); setEditing(true); }}>编辑</button>}</header>
    {editing ? <div className="rs-form"><label className="rs-field"><span>每月大约能存下多少钱？</span><CentInput label="每月大约能存下多少钱" signed value={text} disabled={busy} placeholder="没想好可以留空" onChange={setText}/><small>每月到账减去全部开销后剩下的钱。取用存款填负数；填 0 只表示本次按每月不存钱计算。</small>{reference && <small className="plan-reference">仅供参考：{reference}资产增减混有估值涨跌，不等于日常收支留下的钱，不会自动填入。</small>}</label><ContributionHelper disabled={busy} onPick={setText}/>{notice && <p className="notice" role="status">{notice}</p>}</div>
      : <><p>{contributionText(current)}</p>{current === null && <p className="muted small">{SAVE_CONTRIBUTION_HINT}：关联的心愿与大额计划会在保存后显示影响。</p>}</>}
  </article>;
}
