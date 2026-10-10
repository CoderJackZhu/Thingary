import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import { buildBasicCapabilities } from './plan-basic';
import { overlayPlanningDrafts } from './planning-draft';
import { refinementCards } from './planning-first-run';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput, MonthInput } from './DateInput';
import { CentInput, FormRow, Segments } from './FormControls';
import { FundsEditor } from './PlanningFunds';
import { ready } from './review';
import { ContributionHelper } from './PlanningContributionHelper';
import { SAVING_BASIS_CAVEAT, historyHints } from './planning-basic-defaults';
import type { Account, Snapshot } from './wealth';
import type { PlanningSources } from './plan';
import type { Draft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { IncomeQuestion } from './PlanningRetirementIncome';
import { SpendItems } from './PlanningSpendItems';
import { PlanningPensionRefinementDialog } from './PlanningPensionRefinement';
import { comparePensionRefinement, withPensionRefinement } from './planning-pension-refinement';
import type { PensionComparison } from './planning-pension-refinement';
import { questions, retirementMonth, setupDraft, setupFields, setupErrorLocation } from './planning-first-run';

const stepLabels = ['退休年龄', '每月生活费', '可用资金', '退休收入'];
/** 实际收益（已扣通胀）档位只是填写起点，不是预测。 */
export const returnPresets = [{ label: '存款为主', before: '0', after: '0' }, { label: '稳健理财', before: '1.5', after: '1' }, { label: '含股票基金', before: '3', after: '2' }] as const;
const hints = ['这个年龄是你的设想，不是系统替你决定的。', '按今天的物价，吃饭、住房、日常开销合计；按全家规划就填全家的。', '默认只动用现金类账户，确认后保存即可。不会改变实际余额。', '先看只靠自己准备需要多少，之后可以随时加上。', '这是你自己的估计；没想好可以留空。', '这些是假设，随时可以修改。'];
/** 第三问没有可用完整盘点（手填金额）时的副标题。 */
const manualStartHint = '还没有完整盘点：先填现在能用来准备退休的钱和截至日期，不会创建盘点，也不会和账户余额相加。';

/** Four questions and one existing setup transaction. Close, Esc and skip discard unsaved input. */
export function PlanningSetupDialog({ sources, snapshot, accounts, today, reload, onPending, onClose, onComparison, initialStep = 0, editMode = false, completionId }: { sources: PlanningSources; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void; onComparison?: (c: PensionComparison) => void; initialStep?: number; editMode?: boolean; completionId?: string }) {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const steps = editMode ? [...questions, '每月能存多少（选填）', '更多假设'] : [...questions];
  const [step, setStep] = useState(Math.min(initialStep, steps.length - 1));
  const [d, setD] = useState(() => setupDraft(saved, snapshot, today, sources.modules.wealth));
  const [captured] = useState(() => structuredClone({ ...sources, today }));
  const [pensionOpen, setPensionOpen] = useState(false), [pensionTouched, setPensionTouched] = useState(false);
  const [confirmationIssue, setConfirmationIssue] = useState<ConfirmationIssue | null>(null);
  const [notice, setNotice] = useState('');
  const [errorFocus, setErrorFocus] = useState<ReturnType<typeof setupErrorLocation>>(null);
  const saver = useSectionSaver(sources, reload, onPending);
  const history = useMemo(() => historyHints(ready(sources.review)), [sources.review]);
  const patch = (v: Partial<Draft>) => setD(x => ({ ...x, ...v }));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.planning-setup-body')?.scrollTo(0, 0); }, [step]);
  const frozen = saver.busy || saver.stuck, wealthOn = sources.modules.wealth && snapshot !== null;
  function locateError(message: string) {
    const location = setupErrorLocation(message);
    if (location && location.step < steps.length) { setErrorFocus(location); setStep(location.step); }
  }
  useEffect(() => {
    if (errorFocus?.step === step) dialog.current?.querySelector<HTMLElement>(`[aria-label="${errorFocus.label}"]`)?.focus();
  }, [step, errorFocus]);
  // Native validation arrives via the existing saver notice; an unresolved receipt stays frozen.
  useEffect(() => { if (saver.notice && !frozen) locateError(saver.notice); }, [saver.notice, frozen]);
  function showError(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    setNotice(message); locateError(message);
  }
  async function save() {
    if (frozen) return;
    try { const base = setupFields(d, saved, today, wealthOn); const fields = pensionTouched ? withPensionRefinement(base, d, saved, today) : base; if (completionId) {
      const after = overlayPlanningDrafts(sources, [{ section: 'setup', fields }]);
      const nextSaved = after.profile.status === 'ready' ? after.profile.value.saved : null;
      const remaining = nextSaved && refinementCards(nextSaved, buildBasicCapabilities(after), today).some(c => c.id === completionId);
      if (remaining || completionId === 'income' && (!d.incomeMode || d.incomeMode === 'manual' && !d.incomeItems.some(i => d.picks[i.id]?.on))) {
        const target = completionId === 'contribution' ? { step: 4, label: '每月大约能存下多少钱' } : completionId === 'income' ? { step: 3, label: '退休收入计入方式' } : completionId === 'funds' ? { step: 2, label: d.start === 'live' ? '资金起点' : !d.simAmount ? '模拟起点可用资金' : '模拟起点截至日期' } : { step: 5, label: '规划到几岁' };
        setStep(target.step); setConfirmationIssue(old => ({ label: target.label, attempt: (old?.attempt ?? 0) + 1 })); return;
      }
    }
    setConfirmationIssue(null); const comparison = pensionTouched ? comparePensionRefinement(captured, fields) : null; setNotice(''); if (await saver.save({ section: 'setup', fields })) { if (comparison) onComparison?.(comparison); onClose(true); } }
    catch (e) { showError(e); }
  }
  function next() {
    try { setupFields(d, saved, today, wealthOn); setNotice(''); setStep(n => n + 1); }
    catch (e) { showError(e); }
  }
  const month = retirementMonth(d.birth, d.target);
  const live = d.start === 'live' && wealthOn;
  const available = live ? snapshot!.entries.filter(e => e.counted && e.side === 'asset').reduce((sum, e) => { const f = d.funds.find(f => f.account_id === e.account_id); return e.amount_cents !== null && f?.availability === 'available' ? sum + (BigInt(e.amount_cents) * BigInt(f.share_hundredths) ) / 10000n : sum; }, 0n) : null;
  return <><dialog ref={dialog} className="editor wealth-account-editor planning-setup-dialog" aria-labelledby="setup-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); if (step === 3 || step === 5) void save(); else next(); }}>
    <header><div><p className="eyebrow">{editMode ? '修改规划' : '开始规划'} · {step < 4 ? `问题 ${step + 1} / 4` : '选填'}</p><h2 id="setup-heading" ref={heading} tabIndex={-1}>{steps[step]}</h2><p className="muted">{step === 2 && !live ? manualStartHint : hints[step]}</p></div><CloseButton type="button" aria-label="关闭规划设置" disabled={saver.busy} onClick={() => onClose(false)}/></header>
    <nav className="planning-question-progress" aria-label="四个问题">{questions.map((q, i) => <button type="button" key={q} aria-label={`${i + 1}. ${q}`} aria-current={i === step ? 'step' : undefined} disabled={frozen} onClick={() => setStep(i)}>{i + 1}. {stepLabels[i]}</button>)}</nav>
    {editMode && <nav className="planning-edit-extras" aria-label="选填设置"><button type="button" className="ui-link" disabled={frozen} onClick={() => setStep(4)}>每月能存多少（选填）</button><button type="button" className="ui-link" disabled={frozen} onClick={() => setStep(5)}>更多假设</button></nav>}
    <div className="planning-setup-body">
      {step === 0 && <section className="form-block">
        <ConfirmationField label="出生年月" issue={confirmationIssue}><FormRow label="出生年月" hint="只使用年份和月份"><MonthInput label="出生年月" value={d.birth.slice(0, 7)} max={today.slice(0, 7)} disabled={frozen} allowClear onChange={v => patch({ birth: v })}/></FormRow></ConfirmationField>
        <ConfirmationField label="想在几岁退休？" issue={confirmationIssue}><FormRow label="退休年龄" hint="还没想好可以先留空"><input aria-label="想在几岁退休？" inputMode="numeric" value={d.target} disabled={frozen} placeholder="例如 60" onChange={e => patch({ target: e.target.value })}/></FormRow></ConfirmationField>
        <p className="planning-date-echo" role="status">{month ? `约 ${month}退休` : '填好出生年月与年龄，就能看到预计退休月份。'}</p>
      </section>}
      {step === 1 && <section className="form-block"><ConfirmationField label="退休后每月生活预算" issue={confirmationIssue}><FormRow label="每月生活费总额" hint="没想好可以留空；留空不会当作 0"><CentInput label="退休后每月生活预算" value={d.budget} disabled={frozen} placeholder="例如 4000.00" onChange={v => patch({ budget: v })}/></FormRow></ConfirmationField>
        {history.spend !== null && d.budget === '' && <p className="muted small plan-suggest" role="status">按过去 {history.spend_count} 个盘点区间，你每月推算花销的中位数约 {money(history.spend)}（估计）。{SAVING_BASIS_CAVEAT}<button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ budget: history.spend! })}>采用</button></p>}
        <SpendItems d={d} setD={setD} frozen={frozen} today={today}/>
      </section>}
      {step === 2 && <section className="form-block">
        {live && <p className="planning-selected-funds"><strong>用最近一次盘点（截至 {snapshot!.date}）：可动用 {money(String(available))}</strong><span className="ui-tag">已选择</span></p>}
        {d.start === 'simulation' && <><ConfirmationField label="模拟起点可用资金" attention={completionId === 'funds' && !d.simAmount} issue={confirmationIssue}><FormRow label="可用资金" hint="不会创建盘点或叠加账户余额"><CentInput label="模拟起点可用资金" value={d.simAmount} disabled={frozen} placeholder="例如 100000.00" onChange={v => patch({ simAmount: v })}/></FormRow></ConfirmationField><ConfirmationField label="模拟起点截至日期" attention={completionId === 'funds' && !d.simDate} issue={confirmationIssue}><FormRow label="截至日期"><DateInput id="setup-sim-date" label="模拟起点截至日期" value={d.simDate} max={today} disabled={frozen} allowClear onChange={v => patch({ simDate: v })}/></FormRow></ConfirmationField></>}
        {!live && d.start === 'live' && <p className="notice">当前没有可用的完整盘点，请改为手填金额和日期。</p>}
        <details open={completionId === 'funds' && !live ? true : undefined}><summary>{live ? '调整哪些账户可动用' : '选择其他准备方式'}</summary>
          {wealthOn && <ConfirmationField label="资金起点" attention={completionId === 'funds' && !live} issue={confirmationIssue}><FormRow label="准备方式"><Segments label="资金起点" value={d.start} disabled={frozen} options={[{ value: 'live', label: '最近一次盘点' }, { value: 'simulation', label: '手填金额' }]} onChange={v => patch({ start: v })}/></FormRow></ConfirmationField>}
          {live && <FundsEditor accountsOnly d={d} patch={patch} frozen={frozen} snapshot={snapshot} accounts={accounts} live hideHpf/>}
          {!wealthOn && <button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ start: 'simulation' })}>改为手填金额</button>}
        </details>
      </section>}
      {step === 3 && <ConfirmationField label="退休收入计入方式" attention={completionId === 'income'} issue={confirmationIssue}><IncomeQuestion today={today} d={d} setD={setD} patch={patch} frozen={frozen} onPension={() => setPensionOpen(true)} savedEmployee={saved?.profile.retire.basic?.retirement_income.mode === 'employee'}/></ConfirmationField>}
      {editMode && step === 4 && <section className="form-block"><ConfirmationField label="每月大约能存下多少钱" issue={confirmationIssue} attention={completionId === 'contribution'}><FormRow label="每月大约能存下多少钱？" hint="每月到账减去全部开销后剩下的钱；买基金等投入也算，每月取用存款则填负数。没想好可以不填"><span className="plan-contribution"><CentInput label="每月大约能存下多少钱" signed value={d.contribution} disabled={frozen} placeholder="暂不填写" onChange={v => patch({ contribution: v })}/><button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ contribution: '0' })}>按每月存 0 元试算</button></span></FormRow></ConfirmationField><ContributionHelper history={history} disabled={frozen} onPick={v => patch({ contribution: v })}/></section>}
      {editMode && step === 5 && <section className="form-block">
        <ConfirmationField label="生活目标" issue={confirmationIssue}><FormRow label="生活目标"><select aria-label="生活目标" value={d.mode} disabled={frozen} onChange={e => patch({ mode: e.target.value as Draft['mode'] })}><option value="fire">财务自由：资金够用后退休</option><option value="traditional">按计划年龄退休：检查是否够用</option></select></FormRow></ConfirmationField>
      <p className="muted small">这些是可以修改的假设。规划终点默认 90 岁；实际收益默认 0%，表示钱只跑平通胀。可以选一档作为起点，再按自己的判断改。</p>
      <div className="plan-goal-actions plan-return-presets" role="group" aria-label="收益假设档位">{returnPresets.map(x => <button key={x.label} type="button" className="ui-btn" aria-pressed={d.before.trim() !== '' && d.after.trim() !== '' && Number(d.before) === Number(x.before) && Number(d.after) === Number(x.after)} disabled={frozen} onClick={() => patch({ before: x.before, after: x.after })}>{x.label}（{x.before}% / {x.after}%）</button>)}</div>
      <ConfirmationField label="规划到几岁" issue={confirmationIssue} attention={completionId === 'assumptions'}><FormRow label="规划到几岁"><input aria-label="规划到几岁" inputMode="numeric" value={d.horizon} disabled={frozen} onChange={e => patch({ horizon: e.target.value })}/></FormRow></ConfirmationField>
      <ConfirmationField label="退休前实际年收益" issue={confirmationIssue}><FormRow label="退休前实际年收益（%）" hint="扣除通胀与费用后"><input aria-label="退休前实际年收益" inputMode="decimal" value={d.before} disabled={frozen} onChange={e => patch({ before: e.target.value })}/></FormRow></ConfirmationField>
      <ConfirmationField label="退休后实际年收益" issue={confirmationIssue}><FormRow label="退休后实际年收益（%）"><input aria-label="退休后实际年收益" inputMode="decimal" value={d.after} disabled={frozen} onChange={e => patch({ after: e.target.value })}/></FormRow></ConfirmationField>
      <ConfirmationField label="通胀" issue={confirmationIssue}><FormRow label="通胀（%）" hint="用于把未来金额换算回今天的购买力"><input aria-label="通胀" inputMode="decimal" value={d.infl} disabled={frozen} onChange={e => patch({ infl: e.target.value })}/></FormRow></ConfirmationField>
      <ConfirmationField label="应急金月数" issue={confirmationIssue}><FormRow label="应急金月数"><input aria-label="应急金月数" inputMode="numeric" value={d.emergency} disabled={frozen} onChange={e => patch({ emergency: e.target.value })}/></FormRow></ConfirmationField>

      </section>}
      <p className="muted small setup-draft-note">没想好的可以先留空，随时退出，不保存草稿。</p>
    </div>
    {(notice || saver.notice) && <p className="notice setup-notice" role="alert">{[notice, saver.notice].filter(Boolean).join(' ')}</p>}
    <footer className="planning-setup-footer"><div className="planning-setup-exit"><button type="button" disabled={saver.busy} onClick={() => onClose(false)}>{saver.stuck ? '关闭，稍后核对保存结果' : editMode ? '取消本次修改' : '暂时跳过'}</button>{!editMode && !saver.stuck && <small className="muted">不保存本次填写。</small>}</div><span>{step > 0 && <button type="button" disabled={frozen} onClick={() => { setNotice(''); setStep(n => n - 1); }}>上一步</button>}{(!editMode || (step !== 3 && step !== 5)) && <button type="button" disabled={frozen} onClick={() => void save()}>{editMode ? '保存，查看结果' : '先保存，稍后继续'}</button>}<button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : step === 3 || step === 5 ? '保存，查看结果' : '下一步'}</button></span></footer>
  </form></dialog>{pensionOpen && <PlanningPensionRefinementDialog sources={captured} today={today} reload={reload} onPending={onPending} initialDraft={d} onClose={() => setPensionOpen(false)} onApply={next => { setD(next); setPensionTouched(true); setPensionOpen(false); }}/>}</>;
}
