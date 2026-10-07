import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info, Segments, Switch } from './FormControls';
import { FundsEditor } from './PlanningFunds';
import { PlanningProfileFields } from './PlanningProfileFields';
import { CapabilityNotice, RequirementCard } from './PlanningRequirement';
import { ageMonthsAt } from './plan-pension';
import { defaultRetire } from './plan';
import type { Account, Snapshot } from './wealth';
import type { PlanningMissing, PlanningSources, ProfileState } from './plan';
import { basicInput, budgetInput, contributionSources, draftOf, fundsInput, incomeItemsChanged, pensionInput, retirementSources } from './planning-basic-forms';
import type { CostSource, Draft, IncomeMode, ScopeDraft } from './planning-basic-forms';
import { useCapabilities, useSectionSaver } from './planning-basic-data';
import type { SectionInput } from './planning-basic-data';
import { amountState, hasLegacyPlan, missingText, setupStepFor } from './planning-basic-view';

const steps = ['想过怎样的生活', '用哪些钱来准备', '看看每月要存多少', '确认计划'];
type Saved = ProfileState['saved'];

/** Skippable four-step setup. Nothing is written until the last step; closing, Esc and "skip" never save a draft. */
export function PlanningSetupDialog({ sources, snapshot, accounts, today, reload, onPending, onClose, initialStep = 0 }: { sources: PlanningSources; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void; initialStep?: number }) {
  const saved: Saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const legacy = !!saved && !saved.profile.retire.basic && hasLegacyPlan(saved.profile.retire);
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(initialStep), [d, setD] = useState(() => draftOf(saved, snapshot, today)), [notice, setNotice] = useState('');
  const saver = useSectionSaver(sources, reload, onPending);
  const patch = (v: Partial<Draft>) => setD(x => ({ ...x, ...v }));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.planning-setup-body')?.scrollTo(0, 0); }, [step]);
  const frozen = saver.busy || saver.stuck;
  const wealthOn = sources.modules.wealth && snapshot !== null;
  const r = saved?.profile.retire;

  // Step 3 and the summary preview the unsaved draft through the shared service; nothing is written.
  const built = useMemo(() => {
    if (step < 2) return { sections: [] as { label: string; input: SectionInput }[], error: '' };
    try {
      const sections: { label: string; input: SectionInput }[] = [];
      if (incomeItemsChanged(d, r ?? defaultRetire)) sections.push({ label: '退休收入明细', input: budgetInput(d, r ?? defaultRetire) });
      sections.push({ label: '目标与预算', input: basicInput(d, saved, today) });
      if (d.start === 'live' ? wealthOn : d.hpf !== '') sections.push({ label: '资金范围', input: fundsInput(d, saved, today) });
      if (d.incomeMode === 'beijing') sections.push({ label: '养老金事实', input: pensionInput({ ...d.pension, birth: d.birth }) });
      return { sections, error: '' };
    } catch (e) { return { sections: [], error: e instanceof Error ? e.message : String(e) }; }
  }, [step, d, saved, today, wealthOn, r]);
  const drafts = useMemo(() => built.sections.map(s => s.input), [built]);
  const preview = useCapabilities(sources, { drafts });

  const now = /^\d{4}-\d{2}-\d{2}$/.test(d.birth) ? Math.floor(ageMonthsAt(d.birth.slice(0, 7), today) / 12) : null;
  function next() {
    try { basicInput(d, saved, today); setNotice(''); setStep(n => n + 1); }
    catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  }
  async function save() {
    if (frozen) return;
    if (legacy && !d.confirmLegacy) { setNotice('请先确认改用通用方式，原规划的假设会保留为只读。'); return; }
    if (built.error) { setNotice(built.error); return; }
    const fields: import('./plan').SetupFields = { basic: (basicInput(d, saved, today) as Extract<SectionInput, { section: 'basic' }>).fields, budget: null, funds: null, pension: null };
    for (const { input } of built.sections) {
      if (input.section === 'budget') fields.budget = input.fields;
      if (input.section === 'funds') fields.funds = input.fields;
      if (input.section === 'pension') fields.pension = input.fields;
    }
    if (await saver.save({ section: 'setup', fields })) onClose(true);
  }
  const jump = (owner: PlanningMissing['owner'], field?: string) => { if (owner === 'pension') setStep(1); else if (owner !== 'service' && owner !== 'events') setStep(setupStepFor(owner, field)); };
  const missing = preview.status === 'ready' ? [...(preview.caps.requirement.status === 'blocked' ? preview.caps.requirement.missing : []), ...(preview.caps.funds.status === 'blocked' ? preview.caps.funds.missing : [])] : [];

  return <dialog ref={dialog} className="editor wealth-account-editor planning-setup-dialog" aria-labelledby="setup-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); if (step === 3) void save(); else if (step === 2) setStep(3); else next(); }}>
    <header><div><p className="eyebrow">{legacy ? '使用简化规划' : '开始规划'} · {step + 1} / {steps.length}</p><h2 id="setup-heading" ref={heading} tabIndex={-1}>{steps[step]}</h2><p className="muted">{step === 0 ? '没想好的先留空，不会当作 0 保存。可以随时关闭，先去记录收入或查看复盘。' : step === 3 ? '直接确认就可以。每月能存多少是选填，没想好可以以后再说。' : '这里设置的是假设，随时可以修改。'}</p></div><CloseButton type="button" aria-label="关闭规划设置" disabled={saver.busy} onClick={() => onClose(false)}/></header>
    <nav className="planning-setup-steps" aria-label="设置步骤">{steps.map((s, i) => <span key={s} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</span>)}</nav>
    <div className="planning-setup-body">
      {step === 0 && <GoalStep d={d} patch={patch} frozen={frozen} now={now} sources={r ? retirementSources(r, d.incomeMode === 'beijing' ? d.pension.pp || null : saved?.profile.personal_pension_annual_cents ?? null) : []}/>}
      {step === 1 && <ConditionStep d={d} setD={setD} patch={patch} frozen={frozen} snapshot={snapshot} accounts={accounts} wealthOn={wealthOn} wealthModule={sources.modules.wealth} today={today}/>}
      {step === 2 && <>
        <p className="notice">仅按当前输入试算，尚未保存。</p>
        {built.error ? <article className="ui-card ui-content" role="alert"><p>{built.error}</p><button type="button" className="ui-btn" onClick={() => setStep(0)}>回到目标与预算</button></article>
          : preview.status === 'ready' ? <RequirementCard caps={preview.caps} onOwner={jump} busy={frozen}/> : <CapabilityNotice result={preview}/>}
      </>}
      {step === 3 && <ConfirmStep d={d} patch={patch} frozen={frozen} legacy={legacy} previewMissing={missing} sources={r ? contributionSources(r, saved?.profile.personal_pension_annual_cents ?? null) : []} hasBeijing={d.incomeMode === 'beijing'}/>}
    </div>
    {(notice || saver.notice) && <p className="notice setup-notice" role="alert">{[notice, saver.notice].filter(Boolean).join(' ')}</p>}
    <footer className="planning-setup-footer"><button type="button" disabled={saver.busy} onClick={() => onClose(false)}>{saver.stuck ? '关闭，稍后核对保存结果' : saved?.profile.retire.basic ? '取消本次修改' : legacy ? '取消，保持原规划' : '暂时跳过'}</button><span>{step > 0 && <button type="button" disabled={frozen} onClick={() => { setNotice(''); setStep(n => n - 1); }}>上一步</button>}<button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : step === 3 ? (legacy ? '确认并使用简化规划' : '确认并保存') : step === 2 ? '下一步：确认计划' : '下一步'}</button></span></footer>
  </form></dialog>;
}

function GoalStep({ d, patch, frozen, now, sources }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; now: number | null; sources: CostSource[] }) {
  return <section className="form-block">
    <FormRow label="生活目标"><select aria-label="生活目标" value={d.mode} disabled={frozen} onChange={e => patch({ mode: e.target.value as Draft['mode'] })}><option value="fire">财务自由：资金够用后退休</option><option value="traditional">按计划年龄退休：检查是否够用</option></select></FormRow>
    <FormRow label="出生年月" hint="目标是年龄、或要引用政策估算时才需要；点日历选择，只用到年和月"><DateInput id="setup-birth" label="出生日期" value={d.birth} max={new Date().toISOString().slice(0, 10)} disabled={frozen} allowClear onChange={v => patch({ birth: v })}/></FormRow>
    <FormRow label="想在几岁退休？" hint={now === null ? '你期望的年龄，不是系统替你决定的退休日期。留空表示还没想好' : `当前约 ${now} 岁。留空表示还没想好`}><input aria-label="想在几岁退休？" inputMode="numeric" value={d.target} disabled={frozen} placeholder="例如 55" onChange={e => patch({ target: e.target.value })}/></FormRow>
    <FormRow label="退休后，每月生活费大约多少？" hint="按现在的物价，合计吃饭、住房、日常生活等开销。还没想好可以先留空"><CentInput label="退休后每月生活预算" value={d.budget} disabled={frozen} placeholder="0.00" onChange={v => patch({ budget: v })}/></FormRow>
    {sources.length > 0 && <fieldset className="plan-scope"><legend>核对已保存的费用<Info text="这里只看以后要付的钱，过去已经交过的社保等费用不会再扣一次。生活费里已经包括的，选「已包含」；还要额外支付的，选「另外加上」。"/></legend><p className="muted small">这些是以前保存的费用假设。请确认它们是否包含在上面填写的生活费里，避免算两次。</p>
      {sources.map(s => <ScopeRow key={s.id} label={`${s.id === 'social_insurance' ? '以后自己交社保（旧计划）' : s.label} ${s.cents ? money(s.cents) : ''}/月`} value={d.retScopes[s.id] ?? { treatment: '', ref: '' }} placeholderRef={s.cents ?? ''} disabled={frozen} onChange={v => patch({ retScopes: { ...d.retScopes, [s.id]: v } })}/>)}</fieldset>}
    <details><summary>更多假设：规划终点、收益、通胀与应急金</summary>
      <p className="muted small">这些是可以修改的假设。规划终点默认 90 岁，实际收益默认 0%，请按自己的判断确认。</p>
      <FormRow label="规划到几岁"><input aria-label="规划到几岁" inputMode="numeric" value={d.horizon} disabled={frozen} onChange={e => patch({ horizon: e.target.value })}/></FormRow>
      <FormRow label="退休前实际年收益（%）" hint="扣除通胀与费用后"><input aria-label="退休前实际年收益" inputMode="decimal" value={d.before} disabled={frozen} onChange={e => patch({ before: e.target.value })}/></FormRow>
      <FormRow label="退休后实际年收益（%）"><input aria-label="退休后实际年收益" inputMode="decimal" value={d.after} disabled={frozen} onChange={e => patch({ after: e.target.value })}/></FormRow>
      <FormRow label="通胀（%）" hint="用于把未来金额换算回今天的购买力"><input aria-label="通胀" inputMode="decimal" value={d.infl} disabled={frozen} onChange={e => patch({ infl: e.target.value })}/></FormRow>
      <FormRow label="应急金月数"><input aria-label="应急金月数" inputMode="numeric" value={d.emergency} disabled={frozen} onChange={e => patch({ emergency: e.target.value })}/></FormRow>
    </details>
  </section>;
}

function ScopeRow({ label, value, placeholderRef, disabled, onChange }: { label: string; value: ScopeDraft; placeholderRef: string; disabled: boolean; onChange: (v: ScopeDraft) => void }) {
  return <FormRow label={label}><span className="plan-scope-row"><select aria-label={`${label}包含关系`} value={value.treatment} disabled={disabled} onChange={e => { const treatment = e.target.value as ScopeDraft['treatment']; onChange({ treatment, ref: treatment === 'included' && value.ref === '' ? placeholderRef : treatment === 'included' ? value.ref : '' }); }}><option value="">请选择</option><option value="included">已包含，不再重复算</option><option value="extra">另外加上这笔费用</option><option value="excluded">这次先不算</option></select>{value.treatment === 'included' && <details className="plan-scope-amount"><summary>核对已包含的金额：{value.ref === '' ? '待填写' : money(value.ref)}</summary><CentInput label={`${label}已含金额`} value={value.ref} disabled={disabled} onChange={v => onChange({ ...value, ref: v })}/></details>}</span></FormRow>;
}

const incomeModes: { value: IncomeMode; label: string; hint: string }[] = [
  { value: '', label: '暂不选择', hint: '可以稍后选择，选好后才能计算需要准备多少钱' },
  { value: 'excluded', label: '先不算养老金等收入', hint: '先看看只靠自己准备需要多少钱，已有资料会保留' },
  { value: 'manual', label: '手填的收入', hint: '只计入你勾选的这些收入' },
  { value: 'beijing', label: '北京养老金估算', hint: '按政策估算国家养老金，可再加你勾选的其他收入' },
];

function ConditionStep({ d, setD, patch, frozen, snapshot, accounts, wealthOn, wealthModule, today }: { d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>; patch: (v: Partial<Draft>) => void; frozen: boolean; snapshot: Snapshot | null; accounts: Account[]; wealthOn: boolean; wealthModule: boolean; today: string }) {
  const [adding, setAdding] = useState(false);
  return <>
    <section className="form-block" aria-label="资金起点">
      <h3>这次用哪些资金？</h3>
      <FormRow label="资金起点" hint={wealthOn ? '用最近一次完整盘点，或手填一个模拟起点' : wealthModule ? '还没有完整盘点，可以先手填一个模拟起点' : '资产与盘点已关闭，请手填一个模拟起点；不会读取旧账户'}><Segments label="资金起点" value={d.start} disabled={frozen} options={[{ value: 'live', label: '实际盘点' }, { value: 'simulation', label: '模拟起点' }]} onChange={v => patch({ start: v })}/></FormRow>
      {d.start === 'live' ? (wealthOn ? <FundsEditor d={d} patch={patch} frozen={frozen} snapshot={snapshot} accounts={accounts} live/> : <p className="notice">{wealthModule ? '没有可用的完整盘点。请选择「模拟起点」，或先去账户与盘点完成一次盘点。' : '「账户与盘点」已关闭，不会读取任何账户。请选择「模拟起点」。'}</p>)
        : <>
          <FormRow label="可用资金" hint="截至下面日期的可动用金额；不会创建盘点，也不会叠加其他账户余额"><CentInput label="模拟起点可用资金" value={d.simAmount} disabled={frozen} placeholder="0.00" onChange={v => patch({ simAmount: v })}/></FormRow>
          <FormRow label="截至日期" hint="这笔金额的计算日"><DateInput id="setup-sim-date" label="模拟起点截至日期" value={d.simDate} max={today} disabled={frozen} allowClear onChange={v => patch({ simDate: v })}/></FormRow>
          <FormRow label="备注"><textarea aria-label="模拟起点备注" maxLength={2000} value={d.simNotes} disabled={frozen} onChange={e => patch({ simNotes: e.target.value })}/></FormRow>
          <FundsEditor d={d} patch={patch} frozen={frozen} snapshot={null} accounts={accounts} live={false}/>
        </>}
    </section>
    <section className="form-block" aria-label="退休收入">
      <h3>这次要不要算养老金等收入？</h3>
      <div className="plan-income-modes" role="radiogroup" aria-label="退休收入计入方式">{incomeModes.map(m => <label key={m.value || 'none'} className="plan-choice"><input type="radio" name="income-mode" checked={d.incomeMode === m.value} disabled={frozen} onChange={() => patch({ incomeMode: m.value })}/><span><strong>{m.label}</strong><small>{m.hint}</small></span></label>)}</div>
      {(d.incomeMode === 'manual' || d.incomeMode === 'beijing') && <>
        {d.incomeItems.length === 0 && <p className="muted small">{d.incomeMode === 'manual' ? '还没有手填的收入。添加一笔，例如企业年金、租金或返聘。' : '没有其他收入也可以，国家养老金按政策估算。'}</p>}
        {d.incomeItems.map(i => { const pick = d.picks[i.id] ?? { on: false, role: 'other' as const }; return <div key={i.id} className="plan-income-pick"><label><input type="checkbox" aria-label={`计入${i.label}`} checked={pick.on} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, on: e.target.checked } } })}/> {i.label} {money(i.monthly_cents)}/月 · {i.start_age} 岁起</label>
          {d.incomeMode === 'manual' && pick.on && <select aria-label={`${i.label}的角色`} value={pick.role} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, role: e.target.value as 'state_pension' | 'other' } } })}><option value="other">其他收入</option><option value="state_pension">国家养老金</option></select>}</div>; })}
        <button type="button" className="ui-btn" disabled={frozen} onClick={() => setAdding(true)}>+ 添加一笔退休收入</button>
        {adding && <NewIncome onCancel={() => setAdding(false)} onAdd={item => { setD(x => ({ ...x, incomeItems: [...x.incomeItems, item], picks: { ...x.picks, [item.id]: { on: true, role: 'other' } } })); setAdding(false); }}/>}
      </>}
      {d.incomeMode === 'beijing' && <>
        <h4>政策估算所需的养老金事实</h4>
        <p className="muted small">只在选北京估算时需要。留空的项目保持未知，不会按 0 计算；也可以改选「手填」或「本次不计」。</p>
        <PlanningProfileFields hideBirth f={d.pension} setF={fn => setD(x => ({ ...x, pension: typeof fn === 'function' ? fn(x.pension) : fn }))} today={today} frozen={frozen}/>
        <h4>未来缴费</h4>
        <FormRow label="开始缴费月份" hint="留空表示未知"><input type="month" aria-label="开始缴费月份" value={d.pcStart} disabled={frozen} onChange={e => patch({ pcStart: e.target.value })}/></FormRow>
        <FormRow label="停止缴费月份" hint="与开始相同表示今后不再缴费；留空表示未知。与每月投入的正负无关"><input type="month" aria-label="停止缴费月份" value={d.pcStop} disabled={frozen} onChange={e => patch({ pcStop: e.target.value })}/></FormRow>
        <FormRow label="未来缴费基数"><CentInput label="未来缴费基数" value={d.pcBase} disabled={frozen} placeholder="0.00" onChange={v => patch({ pcBase: v })}/></FormRow>
      </>}
    </section>
  </>;
}

function NewIncome({ onAdd, onCancel }: { onAdd: (i: Draft['incomeItems'][number]) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(''), [cents, setCents] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [indexed, setIndexed] = useState(true), [err, setErr] = useState('');
  function add() {
    const s = Number(start), e = end.trim() === '' ? null : Number(end);
    if (!label.trim()) return setErr('请填写名称。');
    if (!cents || cents === '0') return setErr('每月金额须大于 0。');
    if (!Number.isInteger(s) || s < 0 || s > 120 || start.trim() === '') return setErr('请填写起始年龄（0–120 的整数）。');
    if (e !== null && (!Number.isInteger(e) || e <= s || e > 120)) return setErr('结束年龄须晚于起始，留空表示终身。');
    onAdd({ id: crypto.randomUUID(), label: label.trim(), monthly_cents: cents, start_age: s, end_age: e, indexed });
  }
  return <div className="plan-new-income" role="group" aria-label="添加退休收入">
    <FormRow label="名称"><input aria-label="收入名称" value={label} onChange={e => setLabel(e.target.value)}/></FormRow>
    <FormRow label="税后每月收入" hint="今天的钱"><CentInput label="税后每月收入" value={cents} onChange={setCents}/></FormRow>
    <FormRow label="起始年龄"><input aria-label="收入起始年龄" inputMode="numeric" value={start} onChange={e => setStart(e.target.value)}/></FormRow>
    <FormRow label="结束年龄" hint="留空：终身"><input aria-label="收入结束年龄" inputMode="numeric" value={end} placeholder="终身" onChange={e => setEnd(e.target.value)}/></FormRow>
    <FormRow label="随通胀上涨"><Switch label="随通胀上涨" value={indexed} onChange={setIndexed}/></FormRow>
    {err && <p className="notice" role="alert">{err}</p>}
    <div className="rs-actions"><button type="button" className="ui-btn" onClick={onCancel}>取消</button><button type="button" className="primary" onClick={add}>加入列表</button></div>
  </div>;
}

function ConfirmStep({ d, patch, frozen, legacy, previewMissing, sources, hasBeijing }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; legacy: boolean; previewMissing: PlanningMissing[]; sources: CostSource[]; hasBeijing: boolean }) {
  const [expanded, setExpanded] = useState(d.contribution !== '');
  const state = amountState(d.contribution === '' ? null : d.contribution);
  const incomeText = { '': '还没选择（选好后才能算需求）', excluded: '本次不计', manual: `手填的 ${d.incomeItems.filter(i => d.picks[i.id]?.on).length} 笔收入`, beijing: '北京养老金估算' }[d.incomeMode];
  return <>
    <details className="form-block plan-optional" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary>每月能存多少钱？（选填，没想好可以跳过）</summary>
      <FormRow label="每月大约能存下多少钱？" hint="例如到账 10000 元、全部开销 6000 元，就填 4000 元。买基金等投入也算存下的钱，投资涨跌不算；每月取用存款则填负数"><span className="plan-contribution"><CentInput label="每月大约能存下多少钱" signed value={d.contribution} disabled={frozen} placeholder="暂不填写" onChange={v => patch({ contribution: v })}/><button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ contribution: '0' })}>按每月存 0 元试算</button></span></FormRow>
      <p className="muted small" role="status">{state === 'unknown' ? '没填写也可以：先看目标需要存多少钱，以后再补自己的估计。' : state === 'zero' ? '这次按每月存 0 元计算，以后可以修改。' : state === 'positive' ? '按你估计每月能存下的钱计算，不包含投资涨跌。' : '负数：按每月动用存款试算。'}</p>
    </details>
    {sources.length > 0 && <fieldset className="form-block plan-scope"><legend>核对退休前已保存的费用</legend><p className="muted small">这些费用也会影响目标需要准备的钱，因此单独核对。若填写了每月能存的钱，请确认这笔费用是否已扣除；没填时也不要把已知费用当作不存在。</p>
      {sources.map(s => <ScopeRow key={s.id} label={s.label} value={d.conScopes[s.id] ?? { treatment: '', ref: '' }} placeholderRef="0" disabled={frozen} onChange={v => patch({ conScopes: { ...d.conScopes, [s.id]: v } })}/>)}</fieldset>}
    <section className="form-block"><h3>你的计划</h3><dl className="plan-facts">
      <div><dt>目标</dt><dd>{d.mode === 'fire' ? '财务自由' : '按年龄退休'} · {d.target ? `${d.target} 岁` : '年龄未定'}</dd></div>
      <div><dt>退休后每月预算</dt><dd>{d.budget ? money(d.budget) : '未填写'}</dd></div>
      <div><dt>资金起点</dt><dd>{d.start === 'live' ? '实际盘点' : `模拟起点 ${d.simAmount ? money(d.simAmount) : '金额未填'}${d.simDate ? ` · 截至 ${d.simDate}` : ''}`}</dd></div>
      <div><dt>退休收入</dt><dd>{incomeText}</dd></div>
      <div><dt>每月能存的钱（选填）</dt><dd>{d.contribution === '' ? '以后再估计' : money(d.contribution)}</dd></div>
      <div><dt>假设</dt><dd>覆盖到 {d.horizon} 岁 · 收益 {d.before}% / {d.after}% · 通胀 {d.infl}%</dd></div>
    </dl>
    {previewMissing.length > 0 && <div className="plan-missing" role="status"><strong>之后还可以补充：</strong><ul>{previewMissing.map(m => <li key={m.code + m.field}>{missingText(m)}</li>)}</ul></div>}
    {hasBeijing && <p className="muted small">养老金事实与未来缴费作为独立资料保存，之后可在「养老金」页修改。</p>}
    <p className="muted small">只保存规划设置。账户、盘点、实际收入、已记录的付款与余债不会改变。</p></section>
    {legacy && <section className="form-block plan-legacy-confirm" aria-label="与原规划的差异"><h3>与原规划的差异</h3>
      <ul><li>原规划使用储蓄阶段与路线；通用方式不使用，也不会把旧阶段平均成一个投入。</li><li>预计投入重新留空，由你明确填写后才用于预测。</li><li>原规划的假设与结果会保留为只读，可随时查看；你的事实资料不变。</li></ul>
      <label><input type="checkbox" aria-label="确认改用通用方式" checked={d.confirmLegacy} disabled={frozen} onChange={e => patch({ confirmLegacy: e.target.checked })}/> 我已了解差异，保存后改用通用方式</label></section>}
  </>;
}
