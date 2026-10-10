import { useEffect, useRef, useState } from 'react';
import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import type { Draft } from './planning-basic-forms';
import type { PlanningSources } from './plan';
import { basicConstraintMessages } from './plan-basic-validation';
import { overlayPlanningDrafts } from './planning-draft';
import { setupDraft } from './planning-first-run';
import { useSectionSaver } from './planning-basic-data';
import { IncomeQuestion } from './PlanningRetirementIncome';
import { PensionContributionsEditor } from './PlanningPensionContributions';
import { PlanningProfileFields } from './PlanningProfileFields';
import { comparePensionRefinement, missingPensionFields, needsPensionFacts, pensionRefinementFields } from './planning-pension-refinement';
import type { PensionComparison } from './planning-pension-refinement';

const titles = ['要把哪些退休收入算进去？', '以后打算怎么缴费？', '还缺哪些社保资料？', '确认后再保存'];
const why = ['选好后，就能按你愿意计入的收入重新算每月要存多少。', '以后缴多久、按多少交，会影响北京养老金估算和公积金积累。', '补齐社保记录，才能估算北京养老金；不知道的仍可留空。', '保存后重新计算；跳过的必要资料仍会提示补齐。'];

export function PlanningPensionRefinementDialog({ sources, today, reload, onPending, onClose, onSaved, initialDraft, onApply, reviewContributions = false, startStep = 0, completion = false, switchIncome = false }: {
  sources: PlanningSources; today: string; reload: () => void; onPending: () => void; onClose: () => void; onSaved?: (c: PensionComparison) => void;
  initialDraft?: Draft; onApply?: (d: Draft) => void; reviewContributions?: boolean; startStep?: number; completion?: boolean; switchIncome?: boolean;
}) {
  const [captured] = useState(() => structuredClone({ ...sources, today }));
  const saved = captured.profile.status === 'ready' ? captured.profile.value.saved : null;
  const [d, setD] = useState(() => structuredClone(initialDraft ?? setupDraft(saved, captured.snapshot.status === 'ready' ? captured.snapshot.value : null, today, captured.modules.wealth)));
  const [step, setStep] = useState(() => completion && !switchIncome && (d.incomeMode === 'beijing' || reviewContributions) ? (missingPensionFields(d).length && d.incomeMode === 'beijing' ? 2 : 1) : startStep), [notice, setNotice] = useState('');
  const [issue, setIssue] = useState<ConfirmationIssue | null>(null);
  const [factKeys] = useState(() => missingPensionFields(d));
  const [factsNeeded] = useState(() => needsPensionFacts(d, saved));
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const saver = useSectionSaver(captured, reload, onPending), frozen = saver.busy || saver.stuck;
  const patch = (v: Partial<Draft>) => setD(old => ({ ...old, ...v }));
  const steps = d.incomeMode === 'beijing' || reviewContributions ? [0, 1, ...(d.incomeMode === 'beijing' && factsNeeded ? [2] : []), 3] : [0, 3];
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.planning-pension-body')?.scrollTo(0, 0); }, [step]);
  useEffect(() => { if (completion && !issue && step !== 3) requestAnimationFrame(() => { const missing = requiredField(); if (missing?.step === step) dialog.current?.querySelector<HTMLElement>(`[aria-label="${missing.label}"]`)?.focus(); }); }, [step]);
  function move(delta: number) { setNotice(''); const index = steps.indexOf(step); setStep(steps[Math.max(0, Math.min(steps.length - 1, index + delta))]); }
  const requiredField = () => {
    if (completion && switchIncome && d.incomeMode === 'beijing') return { step: 0, label: '退休收入计入方式' };
    if (!completion || !(d.incomeMode === 'beijing' || reviewContributions)) return null;
    const keys = missingPensionFields(d);
    if (d.incomeMode === 'beijing' && keys.length) {
      const labels = { birth: '出生日期', worker: '性别与职工类型', paid: '累计缴费月数', balance: '个人账户余额', base: '当前月缴费基数', flex: '弹性领取月数', pp: '个人养老金每年缴存', tax: '个税边际税率' };
      return { step: 2, label: labels[keys[0] as keyof typeof labels] };
    }
    if (!d.pcStart) return { step: 1, label: '未来缴费开始月份' };
    if (!d.pcStop) return { step: 1, label: '未来缴费停止月份' };
    if (d.incomeMode === 'beijing' && d.pcBase === '') return { step: 1, label: '未来月缴费基数' };
    if (d.incomeMode === 'beijing' && d.hpf === '') return { step: 1, label: '未来公积金每月缴存' };
    return null;
  };
  async function finish() {
    if (frozen) return;
    const missing = requiredField();
    if (missing) { setStep(missing.step); setIssue(old => ({ label: missing.label, attempt: (old?.attempt ?? 0) + 1 })); return; }
    setIssue(null);
    if (onApply) { onApply(d); return; }
    try {
      if (!saved) throw new Error('请先回答目标页的四个问题。');
      const fields = pensionRefinementFields(d, saved, captured.today);
      const errors = basicConstraintMessages(overlayPlanningDrafts(captured, [{ section: 'setup', fields }]));
      if (errors.length) throw new Error(errors.join(' '));
      const comparison = comparePensionRefinement(captured, fields);
      setNotice('');
      if (await saver.save({ section: 'setup', fields }, saved.revision)) { onSaved?.(comparison); onClose(); }
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor planning-pension-dialog" aria-labelledby="pension-refinement-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); if (step === 3) void finish(); else move(1); }}>
    <header><div><p className="eyebrow">国家养老金 · {step === 3 ? '确认' : `第 ${steps.indexOf(step) + 1} 步`}</p><h2 id="pension-refinement-heading" ref={heading} tabIndex={-1}>{titles[step]}</h2><p className="muted">{step === 1 && d.incomeMode !== 'beijing' ? '确认以后缴存多久，就能把这部分付款算进结果里；退休收入仍按你的选择。' : why[step]}</p></div><CloseButton type="button" aria-label="关闭国家养老金精修" disabled={saver.busy} onClick={onClose}/></header>
    <div className="planning-pension-body">
      {step === 0 && <ConfirmationField label="退休收入计入方式" attention={switchIncome} issue={issue}><IncomeQuestion d={d} setD={setD} patch={patch} frozen={frozen} onPension={() => patch({ incomeMode: 'beijing' })} savedBeijing={saved?.profile.retire.basic?.retirement_income.mode === 'beijing'} fullChoice/></ConfirmationField>}
      {step === 1 && <PensionContributionsEditor completion={completion} issue={issue} d={d} patch={patch} frozen={frozen} today={captured.today}/>}
      {step === 2 && <><PlanningProfileFields completion={completion} issue={issue} f={{ ...d.pension, birth: d.birth }} setF={next => setD(old => { const f = typeof next === 'function' ? next({ ...old.pension, birth: old.birth }) : next; return { ...old, birth: f.birth, pension: f }; })} today={captured.today} frozen={frozen} missingKeys={factKeys}/>{!factKeys.length && <p>本次使用北京估算，已填写的社保数字会保留。</p>}</>}
      {step === 3 && <section className="form-block"><p>退休收入：{d.incomeMode === 'beijing' ? '北京养老金估算' : d.incomeMode === 'manual' ? '手填收入' : '先不算'}</p>{(d.incomeMode === 'beijing' || reviewContributions) && <><p>未来缴费：{d.pcStart || '尚未填开始月份'} → {d.pcStop || '尚未填停止月份'}；基数 {d.pcBase === '' ? '未知' : money(d.pcBase)}；公积金月缴存 {d.hpf === '' ? '未知' : money(d.hpf)}。</p></>}{d.incomeMode === 'beijing' && <><p className="muted small">资料不完整仍会阻止北京估算，可以补齐或改选“先不算”。</p><button type="button" className="ui-btn" disabled={frozen} onClick={() => { patch({ incomeMode: 'excluded' }); setStep(0); }}>改选先不算</button></>}{onApply && <p className="muted small">这次填写先保留在窗口里；回到第四问点“保存，查看结果”才会保存。</p>}</section>}
    </div>
    {(notice || saver.notice) && <p className="notice" role="alert">{notice || saver.notice}</p>}
    <footer><button type="button" disabled={saver.busy} onClick={onClose}>取消</button><span>{step !== 0 && <button type="button" disabled={frozen} onClick={() => move(-1)}>上一步</button>}{step !== 3 && <button type="button" disabled={frozen} onClick={() => move(1)}>跳过这一步</button>}<button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : step === 3 ? onApply ? '完成，返回第四问' : '保存，查看结果' : '下一步'}</button></span></footer>
  </form></dialog>;
}

export function PensionComparisonNote({ comparison }: { comparison: PensionComparison }) {
  const amount = (r: PensionComparison['before']) => r?.status === 'found' || r?.status === 'no_positive_contribution' ? money(r.monthly_cents) : null;
  const a = amount(comparison.before), b = amount(comparison.after);
  const label = comparison.mode === 'beijing' ? '纳入北京估算及本次缴费安排' : comparison.mode === 'manual' ? '手填退休收入及本次缴存安排' : '先不算退休收入及本次缴存安排';
  return <aside className="ui-card ui-content planning-pension-comparison" role="status" aria-label="退休收入调整前后对比"><p><strong>{label}的变化</strong></p><p>{a !== null && b !== null ? a === b ? `每月要存 ${b}，结果不变。` : `每月要存 ${a} → ${b}` : b !== null ? `${comparison.reason || '原结果暂不可计算'} → 每月要存 ${b}` : `${a !== null ? `原来每月要存 ${a}；` : `${comparison.reason || '原结果暂不可计算'}；`}保存后暂不可计算，请补齐必要资料。`}</p>{comparison.statePensionMonthlyCents !== null && <p>估算的国家养老金每月约 {money(comparison.statePensionMonthlyCents)}<span className="muted small">，不代表待遇核定结果。</span></p>}<p className="muted small">两边使用同一盘点{comparison.snapshotDate ? `（${comparison.snapshotDate}）` : ''}、同一日期（{comparison.today}）与这次的其他条件。</p></aside>;
}
