import { useEffect, useRef, useState } from 'react';
import { CloseButton } from '../CloseButton';
import { FormRow } from '../FormControls';
import { MonthInput, DateInput } from '../DateInput';
import { useSectionSaver } from '../planning-basic-data';
import { overlayPlanningDrafts } from '../planning-draft';
import { buildBasicCapabilities } from '../plan-basic';
import { medicalCheck } from '../plan-medical';
import { forecastMoney } from '../plan-format';
import type { PlanningSources } from '../plan';
import { basicFields, medicalFields, goalInput, editTitles } from './inputs';
import type { GoalEdit, Saved } from './inputs';
import { medicalView } from './medical-view';
import { GoalMoneyInput } from './MoneyInput';

export function GoalEditor({ kind, sources, saved, reload, onPending, onClose }: { kind: GoalEdit; sources: PlanningSources; saved: Saved; reload: () => void; onPending: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [draft, setDraft] = useState(() => basicFields(saved)), [medical, setMedical] = useState(() => medicalFields(saved)), [error, setError] = useState('');
  const frozen = saver.busy || saver.stuck;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const patch = (v: Partial<typeof draft>) => setDraft(d => ({ ...d, ...v }));
  const number = (label: string, value: number | null, onChange: (v: number | null) => void, min: number, max: number, step = 1) => <FormRow label={label}><input type="number" aria-label={label} disabled={frozen} min={min} max={max} step={step} value={value != null && Number.isFinite(value) ? value : ''} onWheel={e => e.currentTarget.blur()} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}/></FormRow>;
  const amount = (label: string, value: string | null | undefined, onChange: (v: string | null) => void, signed = false, step = 10000) => <FormRow label={label}><GoalMoneyInput label={label} value={value ?? ''} disabled={frozen} onChange={v => onChange(v || null)} signed={signed} step={step}/></FormRow>;
  let preview = '补充条件后可试算。';
  try { const c = buildBasicCapabilities(overlayPlanningDrafts(sources, [goalInput(kind, saved, draft, medical)])); if (c.requirement.status === 'ready' && 'monthly_cents' in c.requirement.value.set) preview = `按未保存的修改，目标需要每月存约 ${forecastMoney(c.requirement.value.set.monthly_cents)}。`; else if (c.requirement.status === 'blocked') preview = c.requirement.missing.map(m => m.message).join(' '); } catch (e) { preview = e instanceof Error ? e.message : String(e); }
  async function save() {
    if (frozen) return;
    try {
      const input = goalInput(kind, saved, draft, medical);
      const c = buildBasicCapabilities(overlayPlanningDrafts(sources, [input]));
      const invalid = c.requirement.status === 'blocked' && c.requirement.missing.find(m => m.kind === 'constraint' || m.code === 'INPUT_INVALID');
      if (invalid) throw new Error(invalid.message);
      setError(''); if (await saver.save(input)) onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  const med = medicalCheck({ ...saved.profile, ...medical }, draft.basic, sources.today), medView = medicalView(med, medical.medical_topup_cents);
  const sim = draft.basic.start.kind === 'simulation' ? draft.basic.start : null;
  return <dialog ref={dialog} className="editor wealth-account-editor goal-editor" aria-labelledby="goal-editor-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><h2 id="goal-editor-heading">{editTitles[kind]}</h2><CloseButton disabled={saver.busy} onClick={onClose} type="button" aria-label={`关闭${editTitles[kind]}`}/></header>
    <div className="goal-editor-body"><section className="form-block">
      {kind === 'time' && <><FormRow label="出生年月"><MonthInput label="出生年月" value={draft.birth_month ?? ''} allowClear disabled={frozen} onChange={v => patch({ birth_month: v || null })}/></FormRow>{number('几岁起不再工作', draft.target_age, v => patch({ target_age: v }), 20, 109)}{number('生活费安排到几岁', draft.horizon_age, v => patch({ horizon_age: v ?? NaN }), 21, 110)}<FormRow label="停止工作方式"><select aria-label="停止工作方式" value={draft.mode} disabled={frozen} onChange={e => patch({ mode: e.target.value as typeof draft.mode })}><option value="traditional">按填写的年龄停止工作</option><option value="fire">达到财务独立条件可提前停止工作</option></select></FormRow><p className="muted">停止工作不等于开始领养老金；未来缴费截止保持原来的选择，请在缴费安排中单独调整。</p></>}
      {kind === 'spend' && <>{amount('每月生活费（元，按现在物价）', draft.spend_cents, v => patch({ spend_cents: v }))}<p>填写生活费总额。社保、租金等是否包含，在对应费用安排中核对，避免重复计算。</p></>}
      {kind === 'saving' && <>{amount('每月能存多少钱（元）', draft.basic.contribution.monthly_cents, v => patch({ basic: { ...draft.basic, contribution: { ...draft.basic.contribution, monthly_cents: v } } }), true)}<p>扣除日常开支和缴费后的净存入；不知道留空，负数表示每月需要取用已有资金。</p></>}
      {kind === 'assumptions' && <>{number('退休前实际年收益（%）', draft.real_return_before_hundredths / 100, v => patch({ real_return_before_hundredths: v === null ? NaN : Math.round(v * 100) }), -8, 18, .1)}{number('退休后实际年收益（%）', draft.real_return_after_hundredths / 100, v => patch({ real_return_after_hundredths: v === null ? NaN : Math.round(v * 100) }), -8, 18, .1)}{number('年通胀（%）', draft.inflation_hundredths / 100, v => patch({ inflation_hundredths: v === null ? NaN : Math.round(v * 100) }), 0, 10, .1)}<p>实际收益已扣除通胀。0% 表示购买力不变，不是银行利息为零；未来收益属于假设。</p></>}
      {kind === 'start' && <><FormRow label="资金来源"><select aria-label="资金来源" disabled={frozen} value={draft.basic.start.kind} onChange={e => patch({ basic: { ...draft.basic, start: e.target.value === 'live' ? { kind: 'live' } : { kind: 'simulation', id: crypto.randomUUID(), available_cents: null, date: null, notes: '' } } })}><option value="live">按账户盘点与已确认的用途</option><option value="simulation">手填一个模拟金额</option></select></FormRow>{sim && <>{amount('用于规划的模拟金额（元）', sim.available_cents, v => patch({ basic: { ...draft.basic, start: { ...sim, available_cents: v } } }), false, 1000000)}<FormRow label="金额截至日期"><DateInput label="金额截至日期" value={sim.date ?? ''} allowClear disabled={frozen} onChange={v => patch({ basic: { ...draft.basic, start: { ...sim, date: v || null } } })}/></FormRow></>}<p>模拟金额替代盘点起点，不修改实际账户余额。使用盘点时，可在目标页单独核对账户用途。</p></>}
      {kind === 'medical' && <><p><strong>{medView.title}</strong></p><p>{medView.explanation}</p>{number('职工医保累计缴费月数', medical.medical_paid_months ?? null, v => setMedical(m => ({ ...m, medical_paid_months: v })), 0, 1200)}{number(`其中在${saved.profile.region === 'beijing' ? '北京' : '退休待遇领取地'}实际缴费月数`, medical.medical_local_paid_months ?? null, v => setMedical(m => ({ ...m, medical_local_paid_months: v })), 0, 1200)}<p>本地实缴是累计中的一部分，不是再加一遍。如果只交过 15 个月且都在同一地，两项可以相同；不确定留空。</p><h3>适用于你的政策门槛</h3><p>下面是政策要求，不是已经交了多少。留空可保存并继续试算，但医保年限会显示“待确认”。</p>{saved.profile.region !== 'beijing' && number('当地要求的医保累计月数', medical.medical_required_months ?? null, v => setMedical(m => ({ ...m, medical_required_months: v })), 0, 1200)}{number('当地要求至少在本地实际缴费月数', medical.medical_local_required_months ?? null, v => setMedical(m => ({ ...m, medical_local_required_months: v })), 0, 1200)}<p>这是政策最低要求，不是你已交的月数。北京不同户籍情况可能适用不同门槛，不能统一默认 60 或 120 个月。若已核实适用 5 年要求，填 60；只有确认没有单独本地要求时才填 0。</p><details><summary>在哪里查缴费记录与政策？</summary><a href="https://banshi.beijing.gov.cn/pubtask/task/1/110113000000/53193448-1617-4fb5-94f0-09d133fce9d0_cjwt.html" target="_blank" rel="noreferrer">北京官方适用条件</a> · <a href="https://ybfw.ybj.beijing.gov.cn/" target="_blank" rel="noreferrer">北京医保缴费查询</a><p>其他地区请查当地医保经办机构；累计可能包括已认定的异地转入、视同缴费。</p></details>{amount('一次性医保补缴估算（元）', medical.medical_topup_cents, v => setMedical(m => ({ ...m, medical_topup_cents: v })))}<p>不知道补缴金额就留空；不按缺少月数自动猜价格。填入金额只代表纳入支出，不代表资格已核定。未来医保缴费目前沿用养老的排期，并假设在同一地续缴。缺少未来起止月份时，先保存已填资料，再核对目标页的缴费安排。</p></>}
    </section>
    <section className="form-block"><h3>本次修改试算</h3><p>{preview}</p><p className="muted small">尚未保存。请点击下方“保存并更新结果”；其他已填条件保持不变。</p></section>
    {(error || saver.notice) && <p role="alert" className="notice">{error || saver.notice}</p>}
    </div><footer><button type="button" disabled={saver.busy} onClick={onClose}>取消</button><button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : '保存并更新结果'}</button></footer>
  </form></dialog>;
}
