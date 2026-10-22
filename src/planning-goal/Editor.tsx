import { TimeFields } from '../planning-simplified-ui/TimeFields';
import { PartnerShareField } from '../planning-simplified-ui/HouseholdFields';
import { householdIssues, householdOf, isCouple } from '../planning-simplified-ui/household-view';
import { useEffect, useRef, useState } from 'react';
import { CloseButton } from '../CloseButton';
import { FormRow } from '../FormControls';
import { DateInput } from '../DateInput';
import { useSectionSaver } from '../planning-basic-data';
import { overlayPlanningDrafts } from '../planning-draft';
import { buildBasicCapabilities } from '../plan-basic';
import { forecastMoney } from '../plan-format';
import type { PlanningSources } from '../plan';
import { basicFields, goalInput, editTitles } from './inputs';
import type { GoalEdit, Saved } from './inputs';
import { GoalMoneyInput } from './MoneyInput';

export function GoalEditor({ kind, sources, saved, reload, onPending, onClose }: { kind: GoalEdit; sources: PlanningSources; saved: Saved; reload: () => void; onPending: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [draft, setDraft] = useState(() => basicFields(saved)), [simplified, setSimplified] = useState(() => structuredClone(saved.profile.retire.simplified)), [error, setError] = useState(''), [householdShown, setHouseholdShown] = useState(false);
  const household = householdOf(simplified), couple = isCouple(household), problems = householdIssues(simplified, sources.today);
  const frozen = saver.busy || saver.stuck;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const patch = (v: Partial<typeof draft>) => setDraft(d => ({ ...d, ...v }));
  const number = (label: string, value: number | null, onChange: (v: number | null) => void, min: number, max: number, step = 1) => <FormRow label={label}><input type="number" aria-label={label} disabled={frozen} min={min} max={max} step={step} value={value != null && Number.isFinite(value) ? value : ''} onWheel={e => e.currentTarget.blur()} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}/></FormRow>;
  const amount = (label: string, value: string | null | undefined, onChange: (v: string | null) => void, signed = false, step = 10000) => <FormRow label={label}><GoalMoneyInput label={label} value={value ?? ''} disabled={frozen} onChange={v => onChange(v || null)} signed={signed} step={step}/></FormRow>;
  let preview = '补充条件后可试算。';
  try { const c = buildBasicCapabilities(overlayPlanningDrafts(sources, [goalInput(kind, saved, draft, simplified)])); if (c.requirement.status === 'ready' && 'monthly_cents' in c.requirement.value.set) preview = `按未保存的修改，目标需要每月存约 ${forecastMoney(c.requirement.value.set.monthly_cents)}。`; else if (c.requirement.status === 'blocked') preview = c.requirement.missing.map(m => m.message).join(' '); } catch (e) { preview = e instanceof Error ? e.message : String(e); }
  async function save() {
    if (frozen) return;
    try {
      if ((kind === 'time' || kind === 'saving') && problems.length) { setHouseholdShown(true); throw new Error(problems[0].message); }
      const input = goalInput(kind, saved, draft, simplified);
      if (kind === 'emergency' && (!Number.isInteger(draft.emergency_months) || draft.emergency_months < 0 || draft.emergency_months > 36)) throw new Error('应急金月数须是 0 到 36 的整数。');
      const c = buildBasicCapabilities(overlayPlanningDrafts(sources, [input]));
      const invalid = c.requirement.status === 'blocked' && c.requirement.missing.find(m => m.kind === 'constraint' || m.code === 'INPUT_INVALID');
      if (invalid) throw new Error(invalid.message);
      setError(''); if (await saver.save(input)) onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  const sim = draft.basic.start.kind === 'simulation' ? draft.basic.start : null;
  return <dialog ref={dialog} className="editor wealth-account-editor goal-editor" aria-labelledby="goal-editor-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><h2 id="goal-editor-heading">{editTitles[kind]}</h2><CloseButton disabled={saver.busy} onClick={onClose} type="button" aria-label={`关闭${editTitles[kind]}`}/></header>
    <div className="goal-editor-body"><section className="form-block">
      {kind === 'mode' && <><FormRow label="目标类型"><select aria-label="目标类型" disabled={frozen} value={draft.mode} onChange={e => patch({ mode: e.target.value as 'fire' | 'traditional' })}><option value="fire">钱够用后退休</option><option value="traditional">按计划时间退休</option></select></FormRow><p>选“钱够用后退休”，会从你希望的时间起寻找钱够用的月份；选“按计划时间退休”，会检查你选的时间是否可行。每月需要存多少，都按你希望的退休时间来算。</p></>}
      {kind === 'time' && <TimeFields value={simplified.time} issues={householdShown ? problems : []} busy={frozen} today={sources.today} onChange={time => setSimplified(v => ({ ...v, time }))} household={household} onHouseholdChange={next => setSimplified(v => ({ ...v, household: next }))}/>}
      {kind === 'spend' && <>{amount(couple ? '两人每月生活费（元，按现在物价）' : '每月生活费（元，按现在物价）', draft.spend_cents, v => patch({ spend_cents: v }))}<p>填写生活费总额。社保、租金等是否包含，在对应费用安排中核对，避免重复计算。</p></>}
      {kind === 'saving' && <>{amount(couple ? '两人每月一共能存多少钱（元）' : '每月能存多少钱（元）', draft.basic.contribution.monthly_cents, v => patch({ basic: { ...draft.basic, contribution: { ...draft.basic.contribution, monthly_cents: v } } }), true)}<p>扣除日常开支和缴费后的净存入；不知道留空，负数表示每月需要取用已有资金。</p><PartnerShareField value={household} issues={householdShown ? problems : []} busy={frozen} onChange={next => setSimplified(v => ({ ...v, household: next }))}/></>}
      {kind === 'assumptions' && <>{number('退休前实际年收益（%）', draft.real_return_before_hundredths / 100, v => patch({ real_return_before_hundredths: v === null ? NaN : Math.round(v * 100) }), -8, 18, .1)}{number('退休后实际年收益（%）', draft.real_return_after_hundredths / 100, v => patch({ real_return_after_hundredths: v === null ? NaN : Math.round(v * 100) }), -8, 18, .1)}{number('年通胀（%）', draft.inflation_hundredths / 100, v => patch({ inflation_hundredths: v === null ? NaN : Math.round(v * 100) }), 0, 10, .1)}<p>实际收益已扣除通胀。0% 表示购买力不变，不是银行利息为零；未来收益属于假设。</p></>}
      {kind === 'emergency' && <>{number('应急金月数', draft.emergency_months, v => patch({ emergency_months: v === null ? NaN : v }), 0, 36)}<p>按退休后每月必需支出计算的参考月数，用于心愿与大额计划的“低于应急金线”提示；不会从退休月账本另外扣除。</p></>}
      {kind === 'start' && <><FormRow label="资金来源"><select aria-label="资金来源" disabled={frozen} value={draft.basic.start.kind} onChange={e => patch({ basic: { ...draft.basic, start: e.target.value === 'live' ? { kind: 'live' } : { kind: 'simulation', id: crypto.randomUUID(), available_cents: null, date: null, notes: '' } } })}><option value="live">按账户盘点与已确认的用途</option><option value="simulation">手填一个模拟金额</option></select></FormRow>{sim && <>{amount('用于规划的模拟金额（元）', sim.available_cents, v => patch({ basic: { ...draft.basic, start: { ...sim, available_cents: v } } }), false, 1000000)}<FormRow label="金额截至日期"><DateInput yearIntent="past" label="金额截至日期" value={sim.date ?? ''} allowClear disabled={frozen} onChange={v => patch({ basic: { ...draft.basic, start: { ...sim, date: v || null } } })}/></FormRow></>}<p>模拟金额替代盘点起点，不修改实际账户余额。使用盘点时，可在目标页单独核对账户用途。</p></>}
    </section>
    <section className="form-block"><h3>本次修改试算</h3><p>{preview}</p><p className="muted small">尚未保存。请点击下方“保存并更新结果”；其他已填条件保持不变。</p></section>
    {(error || saver.notice) && <p role="alert" className="notice">{error || saver.notice}</p>}
    </div><footer><button type="button" disabled={saver.busy} onClick={onClose}>取消</button><button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : '保存并更新结果'}</button></footer>
  </form></dialog>;
}
