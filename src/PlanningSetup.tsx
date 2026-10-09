import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput, MonthInput } from './DateInput';
import { CentInput, FormRow, Segments, Switch } from './FormControls';
import { FundsEditor } from './PlanningFunds';
import { ready } from './review';
import { ContributionHelper } from './PlanningContributionHelper';
import { SPEND_CAVEAT, historyHints } from './planning-basic-defaults';
import type { Account, Snapshot } from './wealth';
import type { PlanningSources } from './plan';
import type { Draft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { questions, retirementMonth, setupDraft, setupFields, setupErrorLocation } from './planning-first-run';

const stepLabels = ['退休年龄', '每月生活费', '可用资金', '退休收入'];
const hints = ['这个年龄是你的设想，不是系统替你决定的。', '按今天的物价，吃饭、住房、日常开销合计。', '默认只动用现金类账户，其他资产不动用，不改变实际余额。', '先看只靠自己准备需要多少，之后可以随时加上。', '这是你自己的估计；没想好可以留空。', '这些是假设，随时可以修改。'];

/** Four questions and one existing setup transaction. Close, Esc and skip discard unsaved input. */
export function PlanningSetupDialog({ sources, snapshot, accounts, today, reload, onPending, onClose, onPension, initialStep = 0, editMode = false }: { sources: PlanningSources; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: (saved: boolean) => void; onPension: () => void; initialStep?: number; editMode?: boolean }) {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const steps = editMode ? [...questions, '每月能存多少（选填）', '更多假设'] : [...questions];
  const [step, setStep] = useState(Math.min(initialStep, steps.length - 1));
  const [d, setD] = useState(() => setupDraft(saved, snapshot, today, sources.modules.wealth));
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
    try { const fields = setupFields(d, saved, today, wealthOn); setNotice(''); if (await saver.save({ section: 'setup', fields })) onClose(true); }
    catch (e) { showError(e); }
  }
  function next() {
    try { setupFields(d, saved, today, wealthOn); setNotice(''); setStep(n => n + 1); }
    catch (e) { showError(e); }
  }
  const month = retirementMonth(d.birth, d.target);
  const live = d.start === 'live' && wealthOn;
  const available = live ? snapshot!.entries.filter(e => e.counted && e.side === 'asset').reduce((sum, e) => { const f = d.funds.find(f => f.account_id === e.account_id); return e.amount_cents !== null && f?.availability === 'available' ? sum + (BigInt(e.amount_cents) * BigInt(f.share_hundredths) ) / 10000n : sum; }, 0n) : null;
  return <dialog ref={dialog} className="editor wealth-account-editor planning-setup-dialog" aria-labelledby="setup-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); if (step === 3 || step === 5) void save(); else next(); }}>
    <header><div><p className="eyebrow">{editMode ? '修改规划' : '开始规划'} · {step < 4 ? `问题 ${step + 1} / 4` : '选填'}</p><h2 id="setup-heading" ref={heading} tabIndex={-1}>{steps[step]}</h2><p className="muted">{hints[step]}</p></div><CloseButton type="button" aria-label="关闭规划设置" disabled={saver.busy} onClick={() => onClose(false)}/></header>
    <nav className="planning-question-progress" aria-label="四个问题">{questions.map((q, i) => <button type="button" key={q} aria-label={`${i + 1}. ${q}`} aria-current={i === step ? 'step' : undefined} disabled={frozen} onClick={() => setStep(i)}>{i + 1}. {stepLabels[i]}</button>)}</nav>
    {editMode && <nav className="planning-edit-extras" aria-label="选填设置"><button type="button" className="ui-link" disabled={frozen} onClick={() => setStep(4)}>每月能存多少（选填）</button><button type="button" className="ui-link" disabled={frozen} onClick={() => setStep(5)}>更多假设</button></nav>}
    <div className="planning-setup-body">
      {step === 0 && <section className="form-block">
        <FormRow label="出生年月" hint="只使用年份和月份"><MonthInput label="出生年月" value={d.birth.slice(0, 7)} max={today.slice(0, 7)} disabled={frozen} allowClear onChange={v => patch({ birth: v })}/></FormRow>
        <FormRow label="退休年龄" hint="还没想好可以先留空"><input aria-label="想在几岁退休？" inputMode="numeric" value={d.target} disabled={frozen} placeholder="例如 60" onChange={e => patch({ target: e.target.value })}/></FormRow>
        <p className="planning-date-echo" role="status">{month ? `约 ${month}退休` : '填好出生年月与年龄，就能看到预计退休月份。'}</p>
      </section>}
      {step === 1 && <section className="form-block"><FormRow label="每月生活费总额" hint="没想好可以留空；留空不会当作 0"><CentInput label="退休后每月生活预算" value={d.budget} disabled={frozen} placeholder="例如 4000.00" onChange={v => patch({ budget: v })}/></FormRow>
        {history.spend !== null && d.budget === '' && <p className="muted small plan-suggest" role="status">按过去 {history.spend_count} 个盘点区间，你每月花销的中位数约 {money(history.spend)}（{SPEND_CAVEAT}）。<button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ budget: history.spend! })}>采用</button></p>}
      </section>}
      {step === 2 && <section className="form-block">
        {live && <p className="planning-selected-funds"><strong>用最近一次盘点（截至 {snapshot!.date}）：可动用 {money(String(available))}</strong><span className="ui-tag">已选择</span></p>}
        {d.start === 'simulation' && <><FormRow label="可用资金" hint="不会创建盘点或叠加账户余额"><CentInput label="模拟起点可用资金" value={d.simAmount} disabled={frozen} placeholder="例如 100000.00" onChange={v => patch({ simAmount: v })}/></FormRow><FormRow label="截至日期"><DateInput id="setup-sim-date" label="模拟起点截至日期" value={d.simDate} max={today} disabled={frozen} allowClear onChange={v => patch({ simDate: v })}/></FormRow></>}
        {!live && d.start === 'live' && <p className="notice">当前没有可用的完整盘点，请改为手填金额和日期。</p>}
        <details><summary>{live ? '调整哪些账户可动用' : '选择其他准备方式'}</summary>
          {wealthOn && <FormRow label="准备方式"><Segments label="资金起点" value={d.start} disabled={frozen} options={[{ value: 'live', label: '最近一次盘点' }, { value: 'simulation', label: '手填金额' }]} onChange={v => patch({ start: v })}/></FormRow>}
          {live && <FundsEditor accountsOnly d={d} patch={patch} frozen={frozen} snapshot={snapshot} accounts={accounts} live hideHpf/>}
          {!wealthOn && <button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ start: 'simulation' })}>改为手填金额</button>}
        </details>
      </section>}
      {step === 3 && <IncomeQuestion d={d} setD={setD} patch={patch} frozen={frozen} onPension={onPension} savedBeijing={saved?.profile.retire.basic?.retirement_income.mode === 'beijing'}/>}
      {editMode && step === 4 && <section className="form-block"><FormRow label="每月大约能存下多少钱？" hint="每月到账减去全部开销后剩下的钱；买基金等投入也算，每月取用存款则填负数。没想好可以不填"><span className="plan-contribution"><CentInput label="每月大约能存下多少钱" signed value={d.contribution} disabled={frozen} placeholder="暂不填写" onChange={v => patch({ contribution: v })}/><button type="button" className="ui-btn" disabled={frozen} onClick={() => patch({ contribution: '0' })}>按每月存 0 元试算</button></span></FormRow><ContributionHelper history={history} disabled={frozen} onPick={v => patch({ contribution: v })}/></section>}
      {editMode && step === 5 && <section className="form-block">
        <FormRow label="生活目标"><select aria-label="生活目标" value={d.mode} disabled={frozen} onChange={e => patch({ mode: e.target.value as Draft['mode'] })}><option value="fire">财务自由：资金够用后退休</option><option value="traditional">按计划年龄退休：检查是否够用</option></select></FormRow>
      <p className="muted small">这些是可以修改的假设。规划终点默认 90 岁，实际收益默认 0%，请按自己的判断确认。</p>
      <FormRow label="规划到几岁"><input aria-label="规划到几岁" inputMode="numeric" value={d.horizon} disabled={frozen} onChange={e => patch({ horizon: e.target.value })}/></FormRow>
      <FormRow label="退休前实际年收益（%）" hint="扣除通胀与费用后"><input aria-label="退休前实际年收益" inputMode="decimal" value={d.before} disabled={frozen} onChange={e => patch({ before: e.target.value })}/></FormRow>
      <FormRow label="退休后实际年收益（%）"><input aria-label="退休后实际年收益" inputMode="decimal" value={d.after} disabled={frozen} onChange={e => patch({ after: e.target.value })}/></FormRow>
      <FormRow label="通胀（%）" hint="用于把未来金额换算回今天的购买力"><input aria-label="通胀" inputMode="decimal" value={d.infl} disabled={frozen} onChange={e => patch({ infl: e.target.value })}/></FormRow>
      <FormRow label="应急金月数"><input aria-label="应急金月数" inputMode="numeric" value={d.emergency} disabled={frozen} onChange={e => patch({ emergency: e.target.value })}/></FormRow>

      </section>}
      <p className="muted small setup-draft-note">没想好的可以先留空，随时退出，不保存草稿。</p>
    </div>
    {(notice || saver.notice) && <p className="notice setup-notice" role="alert">{[notice, saver.notice].filter(Boolean).join(' ')}</p>}
    <footer className="planning-setup-footer"><div className="planning-setup-exit"><button type="button" disabled={saver.busy} onClick={() => onClose(false)}>{saver.stuck ? '关闭，稍后核对保存结果' : editMode ? '取消本次修改' : '暂时跳过'}</button>{!editMode && !saver.stuck && <small className="muted">不保存本次填写。</small>}</div><span>{step > 0 && <button type="button" disabled={frozen} onClick={() => { setNotice(''); setStep(n => n - 1); }}>上一步</button>}{(!editMode || (step !== 3 && step !== 5)) && <button type="button" disabled={frozen} onClick={() => void save()}>{editMode ? '保存并返回' : '先保存，稍后继续'}</button>}<button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : step === 3 || step === 5 ? editMode ? '保存并返回' : '保存，查看结果' : '下一步'}</button></span></footer>
  </form></dialog>;
}

function IncomeQuestion({ d, setD, patch, frozen, onPension, savedBeijing }: { d: Draft; setD: React.Dispatch<React.SetStateAction<Draft>>; patch: (v: Partial<Draft>) => void; frozen: boolean; onPension: () => void; savedBeijing: boolean }) {
  const [adding, setAdding] = useState(false);
  return <section className="form-block">
    <div className="plan-income-modes" role="radiogroup" aria-label="退休收入计入方式">
      {[{ value: 'excluded' as const, label: '先不算（推荐先这样）', hint: '暂不计退休收入，先看只靠自己准备的结果。' }, { value: 'manual' as const, label: '我自己填一笔', hint: '只计入你选中的退休收入。' }].map(m => <label key={m.value} className="plan-choice"><input type="radio" name="income-mode" checked={d.incomeMode === m.value} disabled={frozen} onChange={() => patch({ incomeMode: m.value })}/><span><strong>{m.label}</strong><small>{m.hint}</small></span></label>)}
      {savedBeijing ? <div className="plan-choice planning-pension-saved"><input type="radio" name="income-mode" aria-label="沿用已保存的北京养老金估算" checked={d.incomeMode === 'beijing'} disabled={frozen} onChange={() => patch({ incomeMode: 'beijing' })}/><span><strong>{d.incomeMode === 'beijing' ? '已选北京养老金估算' : '沿用已保存的北京养老金估算'}</strong><small>资料在「养老金」页修改。已有养老资料和缴费安排会保留。</small><button type="button" className="ui-link" disabled={frozen} onClick={onPension}>进入养老金页（退出本次未保存修改）</button></span></div> : <div className="plan-choice planning-pension-later" aria-disabled="true"><span><strong>国家养老金 · 之后添加</strong><small>看到结果后，在结果页点「算上国家养老金」添加。</small></span></div>}
    </div>
    {(d.incomeMode === 'manual' || d.incomeMode === 'beijing') && <>
        {d.incomeItems.length === 0 && d.incomeMode === 'manual' && <p className="muted small">还没有手填的收入。添加一笔，例如企业年金、租金或返聘。</p>}
        {d.incomeItems.map(i => { const pick = d.picks[i.id] ?? { on: false, role: 'other' as const }; return <div key={i.id} className="plan-income-pick"><label><input type="checkbox" aria-label={`计入${i.label}`} checked={pick.on} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, on: e.target.checked } } })}/> {i.label} {money(i.monthly_cents)}/月 · {i.start_age} 岁起</label>
          {d.incomeMode === 'manual' && pick.on && <select aria-label={`${i.label}的角色`} value={pick.role} disabled={frozen} onChange={e => patch({ picks: { ...d.picks, [i.id]: { ...pick, role: e.target.value as 'state_pension' | 'other' } } })}><option value="other">其他收入</option><option value="state_pension">国家养老金</option></select>}</div>; })}
        <button type="button" className="ui-btn" disabled={frozen} onClick={() => setAdding(true)}>+ 添加一笔退休收入</button>
        {adding && <NewIncome onCancel={() => setAdding(false)} onAdd={item => { setD(x => ({ ...x, incomeItems: [...x.incomeItems, item], picks: { ...x.picks, [item.id]: { on: true, role: 'other' } } })); setAdding(false); }}/>}
      </>}

  </section>;
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
