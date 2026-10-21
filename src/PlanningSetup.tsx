import { TimeFields } from './planning-simplified-ui/TimeFields';
import { PartnerShareField } from './planning-simplified-ui/HouseholdFields';
import { householdIssues, householdOf, isCouple } from './planning-simplified-ui/household-view';
import './planning-simplified-ui/simplified-ui.css';
import { useEffect, useRef, useState } from 'react';
import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import { buildBasicCapabilities } from './plan-basic';
import { overlayPlanningDrafts } from './planning-draft';
import { refinementCards } from './planning-first-run';
import { rateText } from './plan';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Segments } from './FormControls';
import { FundsEditor } from './PlanningFunds';
import { ContributionHelper } from './PlanningContributionHelper';
import type { Account, Snapshot } from './wealth';
import type { PlanningSources } from './plan';
import type { Draft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { IncomeQuestion } from './PlanningRetirementIncome';
import { SpendItems } from './PlanningSpendItems';
import { questions, setupDraft, setupFields, setupErrorLocation } from './planning-first-run';
import { AssumptionsEditor } from './planning-followup-ui/AssumptionsEditor';
import { hundredthsToPctText } from './planning-followup-ui/model';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import './planning-followup-ui/planning-followup-ui.css';

const setupQuestions = [...questions, '每月大约能存下多少钱？'];
const stepLabels = ['目标与时间', '每月生活费', '可用资金', '退休收入', '每月净投入'];
const hints = ['填写出生年月和年龄，软件自动换算退休月份及规划终点。', '按今天的物价，吃饭、住房、日常开销合计；按全家规划就填全家的。', '确认可动用的现金和投资账户，保存后用于规划，不改变实际余额。', '先看只靠自己准备需要多少，之后可以随时加上。', '这是你自己的估计；没想好可以留空。', '这些是假设，随时可以修改。'];
/** 第三问没有可用完整盘点（手填金额）时的副标题。 */
const manualStartHint = '还没有完整盘点：先填现在能用来准备退休的钱和截至日期，不会创建盘点，也不会和账户余额相加。';

/** Five visible steps and one existing setup transaction. Net contribution remains optional. */
export function PlanningSetupDialog({ sources, snapshot, accounts, today, reload, onPending, onClose, initialStep = 0, editMode = false, completionId, assumptionsPort }: { sources: PlanningSources; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void; initialStep?: number; editMode?: boolean; completionId?: string; assumptionsPort?: PlanningFollowupPortV1 }) {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const steps = editMode ? [...setupQuestions, '收益与其他假设'] : [...setupQuestions];
  const [step, setStep] = useState(Math.min(initialStep, steps.length - 1));
  const [d, setD] = useState(() => setupDraft(saved, snapshot, sources.modules.wealth));
  const [incomeEditing, setIncomeEditing] = useState(false);
  const [confirmationIssue, setConfirmationIssue] = useState<ConfirmationIssue | null>(null);
  const [notice, setNotice] = useState('');
  const [householdShown, setHouseholdShown] = useState(false);
  const [errorFocus, setErrorFocus] = useState<ReturnType<typeof setupErrorLocation>>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [assumptionsStale, setAssumptionsStale] = useState(false);
  const saver = useSectionSaver(sources, reload, onPending);
  const patch = (v: Partial<Draft>) => setD(x => ({ ...x, ...v }));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.planning-setup-body')?.scrollTo(0, 0); }, [step]);
  const frozen = saver.busy || saver.stuck || assumptionsStale || assumptionsOpen, wealthOn = sources.modules.wealth && snapshot !== null;
  function locateError(message: string) {
    const location = setupErrorLocation(message);
    if (location && location.step < steps.length) { setErrorFocus(location); setStep(location.step); }
  }
  useEffect(() => {
    if (errorFocus?.step === step) {
      const control = dialog.current?.querySelector<HTMLElement>(`[aria-label="${errorFocus.label}"]`);
      const disclosure = control?.closest?.('details'); if (disclosure) disclosure.open = true;
      control?.focus();
    }
  }, [step, errorFocus]);
  // Native validation arrives via the existing saver notice; an unresolved receipt stays frozen.
  useEffect(() => { if (saver.notice && !frozen) locateError(saver.notice); }, [saver.notice, frozen]);
  const household = householdOf(d.simplified), couple = isCouple(household);
  const householdProblems = householdIssues(d.simplified, today);
  /** Partner facts that cannot be saved send the user back to the field instead of a native error. */
  function householdBlocked() {
    if (!householdProblems.length) return false;
    setHouseholdShown(true); setNotice(householdProblems[0].message); setStep(0); return true;
  }
  function showError(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    setNotice(message); locateError(message);
  }
  async function save() {
    if (frozen || incomeEditing || householdBlocked()) return;
    try { const fields = setupFields(d, saved, today, wealthOn); if (completionId) {
      const after = overlayPlanningDrafts(sources, [{ section: 'setup', fields }]);
      const nextSaved = after.profile.status === 'ready' ? after.profile.value.saved : null;
      const remaining = nextSaved && refinementCards(nextSaved, buildBasicCapabilities(after), today).some(c => c.id === completionId);
      if (remaining || completionId === 'income' && d.simplified.income_mode === 'unconfirmed') {
        const target = completionId === 'contribution' ? { step: 4, label: '每月大约能存下多少钱' } : completionId === 'income' ? { step: 3, label: '未来收入计入方式' } : completionId === 'funds' ? { step: 2, label: d.start === 'live' ? '资金起点' : !d.simAmount ? '模拟起点可用资金' : '模拟起点截至日期' } : { step: 0, label: '出生年月' };
        setNotice('这一项还没确认，请补充后再保存。'); setStep(target.step); setConfirmationIssue(old => ({ label: target.label, attempt: (old?.attempt ?? 0) + 1 })); return;
      }
    }
    setConfirmationIssue(null); setNotice(''); if (await saver.save({ section: 'setup', fields })) { onClose(true); } }
    catch (e) { showError(e); }
  }
  function next() {
    if (frozen || incomeEditing || householdBlocked()) return;
    try { setupFields(d, saved, today, wealthOn); setNotice(''); setStep(n => n + 1); }
    catch (e) { showError(e); }
  }
  const live = d.start === 'live' && wealthOn;
  const available = live && !snapshot!.entries.some(e => e.counted && e.side === 'asset' && e.amount_cents === null) ? snapshot!.entries.filter(e => e.counted && e.side === 'asset').reduce((sum, e) => { const f = d.funds.find(f => f.account_id === e.account_id); return e.amount_cents !== null && f?.availability === 'available' ? sum + (BigInt(e.amount_cents) * BigInt(f.share_hundredths) ) / 10000n : sum; }, 0n) : null;
  return <><dialog ref={dialog} className="editor wealth-account-editor planning-setup-dialog" aria-labelledby="setup-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); if (step === 4 || step === 5 || (editMode && step === 3)) void save(); else next(); }}>
    <header><div><p className="eyebrow">{editMode ? '修改规划' : '开始规划'} · {step < 5 ? `步骤 ${step + 1} / 5${step === 4 ? ' · 可暂不填写' : ''}` : '计算假设'}</p><h2 id="setup-heading" ref={heading} tabIndex={-1}>{steps[step]}</h2><p className="muted">{step === 2 && !live ? manualStartHint : hints[step]}</p></div><CloseButton type="button" aria-label="关闭规划设置" disabled={saver.busy} onClick={() => onClose(false)}/></header>
    <nav className="planning-question-progress" aria-label="规划主要条件">{setupQuestions.map((q, i) => <button type="button" key={q} aria-label={`${i + 1}. ${q}`} aria-current={i === step ? 'step' : undefined} disabled={frozen || incomeEditing} onClick={() => setStep(i)}>{i + 1}. {stepLabels[i]}</button>)}</nav>
    {editMode && <nav className="planning-edit-extras" aria-label="计算假设"><button type="button" className="ui-btn" disabled={frozen || incomeEditing} onClick={() => setStep(5)}>收益与波动假设</button></nav>}
    <div className="planning-setup-body">
      {step === 0 && <><section className="form-block"><FormRow label="你想怎样退休？"><Segments label="生活目标" value={d.mode} disabled={frozen} options={[{ value: 'fire', label: '财务自由' }, { value: 'traditional', label: '按计划退休' }]} onChange={mode => patch({ mode })}/></FormRow><p className="muted">财务自由：从希望的时间起，资金够用后停止工作。按计划退休：按指定时间停止工作，检查资金是否够用。</p></section><TimeFields value={d.simplified.time} issues={householdShown ? householdProblems : []} busy={frozen} today={today} onChange={time => patch({ simplified: { ...d.simplified, time } })} household={household} onHouseholdChange={household => patch({ simplified: { ...d.simplified, household } })}/></>}
      {step === 1 && <section className="form-block"><ConfirmationField label="退休后每月生活预算" issue={confirmationIssue}><FormRow label={couple ? '两人每月生活费总额' : '每月生活费总额'} hint="没想好可以留空；留空不会当作 0"><CentInput label="退休后每月生活预算" value={d.budget} disabled={frozen} placeholder="例如 4000.00" onChange={v => patch({ budget: v })}/></FormRow></ConfirmationField>
        <SpendItems d={d} setD={setD} frozen={frozen} today={today}/>
        <ConfirmationField label="应急金月数" issue={confirmationIssue}><FormRow label="应急金准备几个月？" hint="用于应急金参考，不从本次退休测算的可用资金中另行扣除"><input type="number" min="0" max="36" aria-label="应急金月数" inputMode="numeric" value={d.emergency} disabled={frozen} onChange={e => patch({ emergency: e.target.value })}/></FormRow></ConfirmationField>
      </section>}
      {step === 2 && <section className="form-block">
        {live && <p className="planning-selected-funds"><strong>用最近一次盘点（截至 {snapshot!.date}）：可动用 {available === null ? '待确认' : money(String(available))}</strong><span className="ui-tag">已选择</span></p>}
        {d.start === 'simulation' && <><ConfirmationField label="模拟起点可用资金" attention={completionId === 'funds' && !d.simAmount} issue={confirmationIssue}><FormRow label="可用资金" hint="不会创建盘点或叠加账户余额"><CentInput label="模拟起点可用资金" value={d.simAmount} disabled={frozen} placeholder="例如 100000.00" onChange={v => patch({ simAmount: v })}/></FormRow></ConfirmationField><ConfirmationField label="模拟起点截至日期" attention={completionId === 'funds' && !d.simDate} issue={confirmationIssue}><FormRow label="截至日期"><DateInput yearIntent="past" id="setup-sim-date" label="模拟起点截至日期" value={d.simDate} max={today} disabled={frozen} allowClear onChange={v => patch({ simDate: v })}/></FormRow></ConfirmationField></>}
        {!live && d.start === 'live' && <p className="notice">当前没有可用的完整盘点，请改为手填金额和日期。</p>}
        <details open={completionId === 'funds' && !live ? true : undefined}><summary>{live ? '调整哪些账户可动用' : '选择其他准备方式'}</summary>
          {wealthOn && <ConfirmationField label="资金起点" attention={completionId === 'funds' && !live} issue={confirmationIssue}><FormRow label="准备方式"><Segments label="资金起点" value={d.start} disabled={frozen} options={[{ value: 'live', label: '最近一次盘点' }, { value: 'simulation', label: '手填金额' }]} onChange={v => patch({ start: v })}/></FormRow></ConfirmationField>}
          {live && <FundsEditor accountsOnly d={d} patch={patch} frozen={frozen} snapshot={snapshot} accounts={accounts} live hideHpf/>}
          {!wealthOn && <button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ start: 'simulation' })}>改为手填金额</button>}
        </details>
      </section>}
      {step === 3 && <IncomeQuestion today={today} d={d} patch={patch} frozen={frozen} onEditingChange={setIncomeEditing}/>}
      {step === 4 && <section className="form-block"><p>填写后可以判断按当前投入能否达成目标。暂不填写也能估算目标要求每月存多少，但不能预测你目前的投入能力。</p><ConfirmationField label="每月大约能存下多少钱" issue={confirmationIssue} attention={completionId === 'contribution'}><FormRow label={couple ? '两人每月一共能存多少钱？' : '每月大约能存下多少钱？'} hint={(couple ? '两个人加起来，' : '') + "每月到账减去全部开销后剩下的钱；买基金等投入也算，每月取用存款则填负数。没想好可以不填"}><span className="plan-contribution"><CentInput label="每月大约能存下多少钱" signed value={d.contribution} disabled={frozen} placeholder="暂不填写" onChange={v => patch({ contribution: v })}/><button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ contribution: '0' })}>按每月存 0 元试算</button></span></FormRow></ConfirmationField><PartnerShareField value={household} issues={householdShown ? householdProblems : []} busy={frozen} onChange={household => patch({ simplified: { ...d.simplified, household } })}/><ContributionHelper disabled={frozen} onPick={v => patch({ contribution: v })}/></section>}
      {editMode && step === 5 && <section className="form-block">
      <div className="plan-assumption-summary">
        <p className="muted small">实际收益默认 0%，表示钱只跑平通胀；默认波动率 5% 是程序试算值，不是资产配置的风险估计。收益、通胀和波动率在独立的「假设核对」编辑器里修改和确认；编辑预算、投入等其他分区只会原样携带这些值，不会顺带确认。</p>
        <dl className="plan-assumption-rows"><div><dt>退休前／后实际收益</dt><dd>{rateText(saved?.profile.retire.real_return_before_hundredths ?? 0)} / {rateText(saved?.profile.retire.real_return_after_hundredths ?? 0)}</dd></div>
          <div><dt>通胀</dt><dd>{rateText(saved?.profile.assumptions.inflation_hundredths ?? 200)}</dd></div>
          <div><dt>市场模拟年波动率</dt><dd>{rateText(saved?.profile.retire.volatility_hundredths ?? 500)}</dd></div></dl>
        {assumptionsPort && <button type="button" className="ui-btn" disabled={frozen || !saved} onClick={() => { setNotice(''); setAssumptionsOpen(true); }}>核对收益与波动假设…</button>}
      </div>

      </section>}
      <p className="muted small setup-draft-note">没想好的可以先留空，随时退出，不保存草稿。</p>
    </div>
    {(notice || saver.notice) && <p className="notice setup-notice" role="alert">{[notice, saver.notice].filter(Boolean).join(' ')}</p>}
    <footer className="planning-setup-footer"><div className="planning-setup-exit"><button type="button" disabled={saver.busy} onClick={() => onClose(false)}>{saver.stuck ? '关闭，稍后核对保存结果' : editMode ? '取消本次修改' : '暂时跳过'}</button>{!editMode && !saver.stuck && <small className="muted">不保存本次填写。</small>}</div><span>{step > 0 && <button type="button" disabled={frozen || incomeEditing} onClick={() => { setNotice(''); setStep(n => n - 1); }}>上一步</button>}{(step < 4 && !(editMode && step === 3)) && <button type="button" disabled={frozen || incomeEditing} onClick={() => void save()}>{editMode ? '保存，查看结果' : '先保存，稍后继续'}</button>}<button className="primary" disabled={frozen || incomeEditing}>{saver.busy ? '保存中…' : step >= 4 || (editMode && step === 3) ? '保存，查看结果' : '下一步'}</button></span></footer>
  </form></dialog>
  {assumptionsOpen && assumptionsPort && <AssumptionsEditor port={assumptionsPort} generation={sources.generation} onPending={onPending} onClose={(savedNow, read) => {
    setAssumptionsOpen(false);
    if (savedNow) {
      // 编辑器保存的是独立分区；这里只把草稿携带的试算值对齐，避免下一次四问保存用旧值覆盖。
      if (read?.status === 'ready') patch({ before: hundredthsToPctText(read.value.values.real_return_before_hundredths), after: hundredthsToPctText(read.value.values.real_return_after_hundredths), infl: hundredthsToPctText(read.value.values.inflation_hundredths), volatility: hundredthsToPctText(read.value.values.volatility_hundredths) });
      else { setAssumptionsStale(true); setNotice('假设已保存，但刷新失败。请关闭后重新打开，避免用旧值继续保存。'); }
      reload();
    }
  }}/>}
  </>;
}
