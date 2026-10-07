import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow } from './FormControls';
import { PlanningProfileFields } from './PlanningProfileFields';
import { profileFromForm, toForm } from './planning-profile';
import { defaultRetire, latestHpf, hundredthsToPct, pctToHundredths } from './plan';
import type { Income, ProfileState, ProfileSave, RetireInputs } from './plan';
import { ageMonthsAt } from './plan-pension';
import { costSources } from './plan-core';
import { finishSetup, setupCore, validateSetupGoal } from './planning-setup';
import type { SetupPhase } from './planning-setup';
import { kindLabel, submit, Unresolved } from './wealth';
import type { Account, Snapshot, Summary } from './wealth';

const steps = ['个人资料', '生活目标', '资金范围', '未来投入', '确认计划'];
/** One shared entry for all three planning tabs. Dismissal and drafts never write to the library. */
export function PlanningSetup({ today, incomes, refresh, onSaved, onRecords, recordView, onPending, onEditingChange, children }: { today: string; incomes: Income[]; refresh: number; onSaved: () => void; onRecords: () => void; recordView: boolean; onPending: () => void; onEditingChange: (v: boolean) => void; children: React.ReactNode }) {
  const [data, setData] = useState<{ state: ProfileState; snapshot: Snapshot | null; accounts: Account[] } | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [editing, setEditing] = useState(false), [dismissed, setDismissed] = useState(false);
  const offered = useRef(false), entry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true; setError(''); setData(null);
    (async () => {
      const [state, summary, accounts] = await Promise.all([invoke<ProfileState>('plan_profile'), invoke<Summary>('wealth_summary'), invoke<Account[]>('wealth_accounts')]);
      const point = [...summary.points].reverse().find(p => p.complete);
      const snapshot = point ? await invoke<Snapshot>('wealth_snapshot', { id: point.snapshot_id }) : null;
      if (live) { setData({ state, snapshot, accounts }); if (!state.saved?.profile.retire.setup_completed && !offered.current) { offered.current = true; setEditing(true); } }
    })().catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [refresh, attempt]);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  const close = (saved: boolean) => { setEditing(false); setDismissed(true); onPending(); if (saved) onSaved(); else if (!data?.state.saved?.profile.retire.setup_completed) onRecords(); requestAnimationFrame(() => entry.current?.focus()); };
  if (error) return <><article className="ui-card ui-content" role="alert"><p>规划设置读取失败：{error}</p><button onClick={() => setAttempt(n => n + 1)}>重新读取设置</button></article>{recordView && children}</>;
  if (!data) return <p role="status">正在读取规划设置…</p>;
  const completed = !!data.state.saved?.profile.retire.setup_completed;
  return <>
    <article className="ui-card ui-content planning-setup-entry" aria-label="规划设置">
      <div className="ui-section-head"><div><h3>{completed ? '我的规划' : '先设置自己的生活计划'}</h3><p className="muted small">{completed ? '未来假设可以随时调整；已记录的资产变化独立保留。' : '个人资料 → 生活目标 → 资金范围 → 未来投入。最后确认才保存；也可以先查看实际记录。'}</p></div><button ref={entry} className={completed ? 'ui-btn' : 'primary'} onClick={() => setEditing(true)}>{completed ? '重新设置计划' : '开始引导设置'}</button></div>
    </article>
    {(completed || (dismissed && recordView)) && children}
    {editing && <SetupDialog key={data.state.saved?.revision ?? 'new'} {...data} today={today} incomes={incomes} onClose={close}/>}
  </>;
}

function SetupDialog({ state, snapshot, accounts, today, incomes, onClose }: { state: ProfileState; snapshot: Snapshot | null; accounts: Account[]; today: string; incomes: Income[]; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0), [f, setF] = useState(() => toForm(state.saved?.profile ?? null));
  const [r, setR] = useState<RetireInputs>(() => structuredClone(state.saved?.profile.retire ?? defaultRetire));
  const [target, setTarget] = useState(state.saved ? String(r.target_age) : '');
  const [core, setCore] = useState(() => setupCore(r, snapshot, today));
  const [phases, setPhases] = useState<SetupPhase[]>(() => r.saving_phases.length ? r.saving_phases.map(p => ({ ...p, monthly: String(p.monthly_cents) })) : [{ id: crypto.randomUUID(), label: '当前阶段', from_age_months: 0, monthly: '' }]);
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), [notice, setNotice] = useState('');
  const [before, setBefore] = useState(hundredthsToPct(r.real_return_before_hundredths)), [after, setAfter] = useState(hundredthsToPct(r.real_return_after_hundredths));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.planning-setup-body')?.scrollTo(0, 0); }, [step]);
  const frozen = busy || stuck;
  const patch = (v: Partial<RetireInputs>) => setR(x => ({ ...x, ...v }));
  const name = (id: string, kind: string) => accounts.find(a => a.id === id)?.fields.name ?? `${kindLabel(kind)}（历史账户）`;
  const assets = snapshot?.entries.filter(e => e.counted && e.side === 'asset') ?? [];
  const sources = costSources(r.life_events.filter(e => e.included || core.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')), f.pp);
  const now = /^\d{4}-\d{2}-\d{2}$/.test(f.birth) ? ageMonthsAt(f.birth.slice(0, 7), today) : 0;
  const profile = () => profileFromForm(f, state.saved?.profile ?? null, today);
  const plan = () => {
    const rb = pctToHundredths(before), ra = pctToHundredths(after);
    if (rb === null || ra === null || rb < -1000 || rb > 2000 || ra < -1000 || ra > 2000) throw new Error('实际年收益假设须为 −10% 到 20%。');
    return finishSetup({ ...r, target_age: target.trim() === '' ? NaN : Number(target), real_return_before_hundredths: rb, real_return_after_hundredths: ra }, core, phases, f.pp, now);
  };
  function next() {
    try {
      if (step === 0) profile();
      if (step === 1) validateSetupGoal({ ...r, target_age: target.trim() === '' ? NaN : Number(target) }, now);
      if (step === 3) { profile(); plan(); }
      setNotice(''); setStep(n => n + 1);
    } catch (e) { setNotice(e instanceof Error ? e.message : errorMessage(e)); }
  }
  async function save() {
    if (frozen) return;
    let input: ProfileSave;
    try { input = { request_id: crypto.randomUUID(), generation: state.generation, expected_revision: state.saved?.revision ?? null, profile: { ...profile(), retire: plan() } }; }
    catch (e) { setNotice(e instanceof Error ? e.message : errorMessage(e)); return; }
    setBusy(true); setNotice('');
    try { await submit({ command: 'plan_profile_save', input, label: '引导设置计划' }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor planning-setup-dialog" aria-labelledby="setup-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); if (step === 4) void save(); else next(); }}>
    <header><div><p className="eyebrow">规划设置 · {step + 1} / {steps.length}</p><h2 id="setup-heading" ref={heading} tabIndex={-1}>{steps[step]}</h2><p className="muted">{step === 0 ? '已有资料会保留。未知不要填零，可以先跳过设置，查看真实记录。' : '这里设置的是未来假设，随时可以修改。'}</p></div><CloseButton type="button" aria-label="关闭规划设置" disabled={busy} onClick={() => onClose(false)}/></header>
    <nav className="planning-setup-steps" aria-label="设置步骤">{steps.map((s, i) => <span key={s} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</span>)}</nav>
    <div className="planning-setup-body">
    {step === 0 && <><p className="notice">养老金目前使用北京参数。地区范围与参数来源可在养老金页查看。</p><PlanningProfileFields guided f={f} setF={setF} today={today} frozen={frozen}/></>}
    {step === 1 && <section className="form-block">
      <FormRow label="生活目标"><select aria-label="生活目标" value={r.mode} disabled={frozen} onChange={e => patch({ mode: e.target.value as RetireInputs['mode'] })}><option value="fire">财务自由：资金够用后退休</option><option value="traditional">按计划年龄退休：检查是否够用</option></select></FormRow>
      <FormRow label="目标年龄" hint={`当前约 ${Math.floor(now / 12)} 岁。你的期望，不是系统替你决定的退休日期。`}><input aria-label="目标年龄" type="number" value={target} disabled={frozen} onChange={e => setTarget(e.target.value)}/></FormRow>
      <FormRow label="退休后每月生活预算" hint="按今天的物价填写，房租在下一项单列；大额支出、额外收入可完成后补充。"><CentInput label="退休后每月生活预算" value={r.spend_cents ?? ''} disabled={frozen} onChange={v => patch({ spend_cents: v || null })}/></FormRow>
      <FormRow label="退休后每月房租"><CentInput label="退休后每月房租" value={r.rent_cents} disabled={frozen} onChange={v => patch({ rent_cents: v })}/></FormRow>
      <details><summary>更多假设：规划年限、收益、应急金与续缴</summary>
        <p className="muted small">默认覆盖到 90 岁、保留 6 个月应急金、实际年收益 0%。这些是假设，请在最后一步确认。</p>
        <FormRow label="规划到几岁"><input aria-label="规划到几岁" type="number" value={r.horizon_age} disabled={frozen} onChange={e => patch({ horizon_age: Number(e.target.value) })}/></FormRow>
        <FormRow label="应急金月数"><input aria-label="应急金月数" type="number" value={r.emergency_months} disabled={frozen} onChange={e => patch({ emergency_months: Number(e.target.value) })}/></FormRow>
        <FormRow label="退休前实际年收益（%）"><input aria-label="退休前实际年收益" value={before} disabled={frozen} onChange={e => setBefore(e.target.value)}/></FormRow>
        <FormRow label="退休后实际年收益（%）"><input aria-label="退休后实际年收益" value={after} disabled={frozen} onChange={e => setAfter(e.target.value)}/></FormRow>
        <FormRow label="停工后自行续缴到几岁" hint="留空表示停工即停缴；领取养老金仍按法定规则计算。"><input aria-label="停工后自行续缴到几岁" type="number" value={r.keep_paying_until_age ?? ''} disabled={frozen} onChange={e => patch({ keep_paying_until_age: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
        <FormRow label="自行续缴每月费用"><CentInput label="自行续缴每月费用" value={r.keep_paying_monthly_cents} disabled={frozen} onChange={v => patch({ keep_paying_monthly_cents: v })}/></FormRow>
      </details>
    </section>}
    {step === 2 && <section className="form-block">
      <p>{snapshot ? `资金起点：${snapshot.date} 的完整盘点。这里只设资金是否参与规划，不改变实际余额。` : '还没有完整盘点。可以先保存计划，补齐金融盘点后才会出现完整测算。'}</p>
      {assets.map(e => { const rule = core.fund_rules.find(x => x.account_id === e.account_id)!; const label = name(e.account_id, e.kind); const update = (v: Partial<typeof rule>) => setCore(c => ({ ...c, fund_rules: c.fund_rules.map(x => x.account_id === e.account_id ? { ...x, ...v } : x) })); return <FormRow key={e.account_id} label={label} hint={`${kindLabel(e.kind)} · 已记录 ${money(e.amount_cents)}`}><select aria-label={`${label}规划用途`} value={rule.availability} disabled={frozen} onChange={v => update({ availability: v.target.value as typeof rule.availability })}><option value="available" disabled={e.kind === 'housing_fund'}>可动用</option><option value="restricted">受限：暂不能动用</option><option value="excluded">本计划不参与</option></select><input type="number" aria-label={`${label}参与比例`} min="0" max="100" value={rule.share_hundredths / 100} disabled={frozen} onChange={v => update({ share_hundredths: Math.round(Number(v.target.value) * 100) })}/> %</FormRow>; })}
      <p className="muted small">建议现金可动用，其他资产暂按受限；请按自己的情况确认。负债仍保留在净资产中，还款接续需单独核对。</p>
      <details open={Number(f.pp) > 0 || !!core.personal_pension_account_id}><summary>已有个人养老金余额</summary>
        <FormRow label="关联个人养老金账户"><select aria-label="关联个人养老金账户" value={core.personal_pension_account_id ?? ''} disabled={frozen} onChange={e => setCore(c => ({ ...c, personal_pension_account_id: e.target.value || null, personal_pension_balance_confirmed: false }))}><option value="">明确没有已有余额</option>{assets.filter(e => e.kind !== 'housing_fund' && core.fund_rules.some(x => x.account_id === e.account_id && x.availability === 'restricted' && x.share_hundredths === 10000)).map(e => <option key={e.account_id} value={e.account_id}>{name(e.account_id, e.kind)} · {money(e.amount_cents)}</option>)}</select></FormRow>
        <label><input type="checkbox" aria-label="确认已有个人养老金余额" checked={core.personal_pension_balance_confirmed ?? false} disabled={frozen} onChange={e => setCore(c => ({ ...c, personal_pension_balance_confirmed: e.target.checked }))}/> 我已核对余额；未关联账户表示没有已有余额</label>
      </details>
    </section>}
    {step === 3 && <section className="form-block">
      <p>每月净投入是你未来计划留下的钱，不能用资产涨跌反推。先设一个阶段即可；职业变化用后续阶段表达，不固定在 35 岁。</p>
      {r.route_id && <p className="notice">确认后将停用旧职业路线，改用下面的显式阶段。已记录的付款与还款信息会保留。</p>}
      {phases.map((p, i) => <div className="planning-setup-phase" key={p.id}><FormRow label={`阶段 ${i + 1} 名称`}><input aria-label={`阶段 ${i + 1} 名称`} value={p.label} disabled={frozen} onChange={e => setPhases(xs => xs.map(x => x.id === p.id ? { ...x, label: e.target.value } : x))}/></FormRow>{i > 0 && <FormRow label="从几岁开始"><input aria-label={`阶段 ${i + 1} 起始年龄`} type="number" step="0.0833333333" value={p.from_age_months / 12} disabled={frozen} onChange={e => setPhases(xs => xs.map(x => x.id === p.id ? { ...x, from_age_months: Math.round(Number(e.target.value) * 12) } : x))}/></FormRow>}
        <FormRow label={i === 0 ? '从现在起每月净投入' : `${p.label}每月净投入`} hint="负数表示动用存款；0 表示不投入。"><CentInput label={`阶段 ${i + 1} 每月净投入`} signed value={p.monthly} disabled={frozen} onChange={v => setPhases(xs => xs.map(x => x.id === p.id ? { ...x, monthly: v } : x))}/></FormRow>
        {sources.map(source => { const rule = core.costs.find(c => c.phase_id === p.id && c.source_id === source.id); return <FormRow key={source.id} label={`${source.label}是否已含`} hint="额外计入：测算再扣一次；已含：先还原参考额，再按实际费用扣，避免重复。"><select aria-label={`${p.label} ${source.label}包含关系`} value={rule ? rule.included ? 'included' : 'extra' : ''} disabled={frozen} onChange={e => setCore(c => ({ ...c, costs: [...c.costs.filter(x => !(x.phase_id === p.id && x.source_id === source.id)), ...(e.target.value ? [{ phase_id: p.id, source_id: source.id, included: e.target.value === 'included', reference_cents: '0' }] : [])] }))}><option value="">请选择</option><option value="extra">额外计入</option><option value="included" disabled={source.id !== 'personal_pension' && !core.occurrences.some(o => o.status === 'occurred' && source.id.startsWith(`event:${o.event_id}:`))}>净投入已包含（已发生）</option></select>{rule?.included && <CentInput label={`${p.label} ${source.label}已含参考额`} value={rule.reference_cents} disabled={frozen} onChange={v => setCore(c => ({ ...c, costs: c.costs.map(x => x === rule ? { ...x, reference_cents: v } : x) }))}/>}</FormRow>; })}
        {i > 0 && <button type="button" disabled={frozen} onClick={() => setPhases(xs => xs.filter(x => x.id !== p.id))}>移除阶段 {i + 1}</button>}
      </div>)}
      <button type="button" disabled={frozen} onClick={() => setPhases(xs => [...xs, { id: crypto.randomUUID(), label: '后续阶段', from_age_months: Math.max(now, xs.at(-1)!.from_age_months) + 12, monthly: '' }])}>添加未来阶段</button>
      <FormRow label="未来公积金月缴存" hint={`最近已记录值：${latestHpf(incomes) === '' ? '未记录' : money(latestHpf(incomes))}。历史值只供参考，未来值请主动确认。`}><CentInput label="未来公积金月缴存" value={core.hpf_monthly_cents ?? ''} disabled={frozen} onChange={v => setCore(c => ({ ...c, hpf_monthly_cents: v === '' ? null : v }))}/></FormRow>
      <button type="button" disabled={frozen} onClick={() => setCore(c => ({ ...c, hpf_monthly_cents: '0' }))}>暂不计未来公积金缴存</button>
    </section>}
    {step === 4 && <section className="form-block"><h3>确认后才生成测算</h3><dl className="plan-facts">
      <div><dt>目标</dt><dd>{r.mode === 'fire' ? '财务自由' : '按年龄退休'} · {target} 岁，覆盖到 {r.horizon_age} 岁</dd></div>
      <div><dt>退休生活预算 / 房租</dt><dd>{money(r.spend_cents)} / {money(r.rent_cents)} 每月</dd></div>
      <div><dt>未来净投入</dt><dd>{phases.map(p => `${p.label}：${money(p.monthly)}/月`).join('；')}</dd></div>
      <div><dt>资金范围</dt><dd>{assets.length} 个已盘点资产账户；公积金月缴存 {money(core.hpf_monthly_cents)}</dd></div>
      <div><dt>实际年收益假设</dt><dd>退休前 {before}% / 后 {after}% · 应急金 {r.emergency_months} 个月</dd></div>
    </dl><p>只保存个人资料和未来假设。账户、盘点、历史资产变化、实际收入及已记录的付款与余债会保留。</p><p className="muted small">已有额外支出 {r.spend_items.length} 项、退休收入 {r.income_items.length} 项、大额计划 {r.life_events.length} 项均保留，完成后可在详情中细调。缺少完整盘点或还款接续时，仍会提示待补齐，不会假造确定结论。</p></section>}
    </div>
    {notice && <p className="notice setup-notice" role="alert">{notice}</p>}
    <footer className="planning-setup-footer"><button type="button" disabled={busy} onClick={() => onClose(false)}>{stuck ? '关闭，稍后核对保存结果' : state.saved?.profile.retire.setup_completed ? '取消本次修改' : '暂时跳过，先看记录'}</button><span>{step > 0 && <button type="button" disabled={frozen} onClick={() => { setNotice(''); setStep(n => n - 1); }}>上一步</button>}<button className="primary" disabled={frozen}>{busy ? '保存中…' : step === 4 ? '确认并保存计划' : '下一步'}</button></span></footer>
  </form></dialog>;
}
