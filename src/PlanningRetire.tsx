import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info } from './FormControls';
import { ageText, hundredthsToPct, pctToHundredths, rateText } from './plan';
import type { Income, PlanReview, ProfileSave, ProfileState, RetireInputs } from './plan';
import { SEARCH_CAP_YEARS, buildRetireCalc } from './plan-retire-calc';
import { submit, Unresolved } from './wealth';
import type { Snapshot, Summary } from './wealth';
import './planning.css';

const yuan = (c: number) => money(String(Math.round(c)));
const monthText = (today: string, offset: number) => { const i = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

/** 退休与 FIRE 的数据与计算：目标卡片和详情页共用，结果不存库。 */
export function useRetirePlan(today: string, review: PlanReview, incomes: Income[]) {
  const [state, setState] = useState<ProfileState | null>(null), [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    (async () => {
      const profile = await invoke<ProfileState>('plan_profile');
      const summary = await invoke<Summary>('wealth_summary');
      const latest = [...summary.points].reverse().find(p => p.complete);
      const snap = latest ? await invoke<Snapshot | null>('wealth_snapshot', { id: latest.snapshot_id }) : null;
      if (live) { setState(profile); setSnapshot(snap); }
    })().catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);

  const saved = state?.saved ?? null;
  const calc = useMemo(() => (saved && snapshot !== undefined ? buildRetireCalc(saved, snapshot, review, incomes, today) : null), [saved, snapshot, incomes, review, today]);
  return { state, snapshot, error, calc, reload: () => setRetry(n => n + 1) };
}
export type RetirePlan = ReturnType<typeof useRetirePlan>;

/** 退休与 FIRE 详情：所需资产、达成年限、敏感性表。全部用「今天的钱」。 */
export function RetireDetail({ plan, today, onEditingChange, onPending, initialEditing = false }: { initialEditing?: boolean; plan: RetirePlan; today: string; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const { state, snapshot, error, calc, reload } = plan;
  const saved = state?.saved ?? null;
  const [editing, setEditing] = useState(initialEditing);
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);

  if (error) return <article className="ui-card ui-content" role="alert"><p>退休估算读取失败：{error}</p><button onClick={reload}>重新读取</button></article>;
  if (!state || snapshot === undefined) return <p role="status" className="muted">正在读取…</p>;
  if (!saved || !calc) return <div className="empty"><span className="empty-mark">¥</span><h2>先填写个人资料</h2><p>退休与财务自由的估算需要出生年月和养老金资料。请先到「养老金」页签填写个人资料。</p></div>;
  const { r } = calc;
  return <>
    <article className="ui-card ui-content plan-steps" aria-label="退休与财务自由估算">
      <div className="ui-section-head"><h3>退休与财务自由</h3><span><button ref={editButton} type="button" className="ui-btn" onClick={() => setEditing(true)}>编辑月预算与假设</button></span></div>
      <section aria-labelledby="fire-start"><h4 id="fire-start">现状（今天的钱）</h4>
        <dl className="plan-facts">
          <div><dt>可支配资产</dt><dd>{calc.assets === null ? '—' : yuan(calc.assets)}</dd><small className="muted">最近完整盘点，不含公积金账户</small></div>
          <div><dt>常态月储蓄</dt><dd>{calc.saving === null ? '—' : yuan(calc.saving)}</dd><small className="muted">近 12 个月中位数</small></div>
          <div><dt>退休后月支出</dt><dd>{calc.spend === null ? '—' : yuan(calc.spend)}</dd><small className="muted">{r.spend_cents !== null ? '你填写的月预算' : '尚未填写月预算'}</small></div>
          <div><dt>应急金</dt><dd>{calc.emergency ? (calc.emergency.covered_months === null ? '—' : `${calc.emergency.covered_months.toFixed(1)} 个月`) : '—'}</dd><small className="muted">线：{r.emergency_months} 个月支出</small></div>
        </dl>
        {calc.emergency?.below && <p className="notice" role="status">当前可支配资产不足 {r.emergency_months} 个月支出，低于应急金线。</p>}
        <p className="muted small">这是假设：退休前实际收益率 {rateText(r.real_return_before_hundredths)}、退休后 {rateText(r.real_return_after_hundredths)}（扣除通胀后），规划到 {r.horizon_age} 岁。货币基金为主的配置扣除通胀后通常接近 0，那时达成时间主要取决于储蓄多少。</p>
        {calc.missing.map(m => <p key={m} className="notice" role="status">{m}</p>)}
      </section>
      {calc.trad && calc.fire !== undefined && <>
        <section aria-labelledby="fire-mode"><h4 id="fire-mode">FIRE 模式（钱够就退）</h4>
          {calc.fire ? <>
            <p><strong>{calc.fire.offset_months === 0 ? '按现在的资产已经够了' : `约 ${ageText(calc.fire.age_months)}（${monthText(today, calc.fire.offset_months)}）`}</strong></p>
            <p className="muted small">那时所需资产约 {yuan(calc.fire.required_cents)}，预计资产 {yuan(calc.fire.assets_cents)}。辞职前先靠存款，到 {ageText(calc.start)} 才有养老金，公积金与个人养老金也在那时才能取；辞职越早这些越少，已按各自的辞职年龄重算。</p>
          </> : <p><strong>{SEARCH_CAP_YEARS} 岁前达不到</strong><span className="muted">，按现在的储蓄与收益假设不可达；可在下表看多存钱或提高收益的效果。</span></p>}
        </section>
        <section aria-labelledby="fire-trad"><h4 id="fire-trad">传统模式（到法定年龄才退）</h4>
          <p><strong>{ageText(calc.trad.age_months)}时{calc.trad.surplus_cents >= 0 ? '资产够用' : '资产不够'}</strong>：预计资产 {yuan(calc.trad.assets_cents)}，所需 {yuan(calc.trad.required_cents)}，{calc.trad.surplus_cents >= 0 ? '多出' : '缺口'} {yuan(Math.abs(calc.trad.surplus_cents))}。</p>
        </section></>}
    </article>
    {calc.sens && <article className="ui-card ui-content"><div className="ui-section-head"><h3>不同储蓄与收益下的退休年龄</h3><span>行：月储蓄；列：实际收益率（退休前后相同）</span></div>
      <div className="plan-table-scroll" tabIndex={0} role="region" aria-label="退休年龄比较表"><table className="ui-table plan-sens"><thead><tr><th>月储蓄</th>{calc.sens.rates.map(x => <th key={x} className="amount">{rateText(x)}</th>)}</tr></thead>
        <tbody>{calc.sens.cells.map((row, i) => <tr key={calc.sens!.factors[i]} className={calc.sens!.factors[i] === 1 ? 'selected' : undefined}>
          <th scope="row">{calc.saving !== null ? yuan(calc.saving * calc.sens!.factors[i]) : ''}<small className="muted"> {Math.round(calc.sens!.factors[i] * 100)}%</small></th>
          {row.map((age, k) => <td key={k} className="amount">{age === null ? <span className="muted">—</span> : ageText(age)}</td>)}</tr>)}</tbody></table></div>
      <p className="muted small">一眼看出多存钱和提高收益哪个对你更有用；「—」表示 {SEARCH_CAP_YEARS} 岁前达不到。这是估算，不是承诺；它不预测裁员、跳槽或涨薪，只按最近的真实储蓄往后推。</p></article>}
    {editing && <RetireDialog state={state} derivedSpend={calc.derivedSpend} onClose={ok => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); editButton.current?.focus(); setEditing(false); onPending(); if (ok) reload(); }}/>}
  </>;
}

function RetireDialog({ state, derivedSpend, onClose }: { state: ProfileState; derivedSpend: number | null; onClose: (saved: boolean) => void }) {
  const saved = state.saved!, r0 = saved.profile.retire;
  const dialog = useRef<HTMLDialogElement>(null);
  const [spend, setSpend] = useState(r0.spend_cents ?? ''), [before, setBefore] = useState(hundredthsToPct(r0.real_return_before_hundredths)), [after, setAfter] = useState(hundredthsToPct(r0.real_return_after_hundredths));
  const [horizon, setHorizon] = useState(String(r0.horizon_age)), [months, setMonths] = useState(String(r0.emergency_months));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLElement>('[aria-label="退休后月支出"]')?.focus(); return () => dialog.current?.close(); }, []);
  const frozen = busy || stuck;
  async function save() {
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    const b = pctToHundredths(before), a = pctToHundredths(after);
    if (b === null) return stop('退休前实际收益率', '退休前实际收益率请填百分数，例如 0 或 1.5。');
    if (a === null) return stop('退休后实际收益率', '退休后实际收益率请填百分数，例如 0 或 1.5。');
    const h = Number(horizon), m = Number(months);
    if (!Number.isInteger(h) || h < 70 || h > 110) return stop('规划到的年龄', '规划终点须是 70 到 110 之间的整数岁。');
    if (!Number.isInteger(m) || m < 0 || m > 36) return stop('应急金线', '应急金线须是 0 到 36 个月。');
    if (spend === '0') return stop('退休后月支出', '退休后月预算须大于 0；留空则暂不估算退休时间。');
    const retire: RetireInputs = { spend_cents: spend === '' ? null : spend, real_return_before_hundredths: b, real_return_after_hundredths: a, horizon_age: h, emergency_months: m };
    const input: ProfileSave = { request_id: crypto.randomUUID(), generation: state.generation, expected_revision: saved.revision, profile: { ...saved.profile, retire } };
    setBusy(true); setNotice('');
    try { await submit({ command: 'plan_profile_save', input, label: '退休假设' }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="retire-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 退休与 FIRE</p><h2 id="retire-heading">退休假设</h2><p className="muted">全部按「今天的钱」计算；这些是假设，不是事实。</p></div><CloseButton type="button" aria-label="关闭退休假设表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存假设'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="退休后月支出" hint="按今天的物价填写日常生活预算；留空则暂不估算"><CentInput label="退休后月支出" value={spend} disabled={frozen} placeholder="填写自己的月预算" onChange={setSpend}/></FormRow>
      <p className="muted small plan-budget-reference">{derivedSpend === null ? '还没有可参考的历史支出。' : `历史推算月支出为 ${yuan(derivedSpend)}，仅供核对。`}大额医疗、一次性购买等不代表每个月都会发生，请按预期的日常生活填写预算。</p>
      <FormRow label="退休前实际收益率（年，%）" hint="扣除通胀；货币基金为主时接近 0，这是假设"><input aria-label="退休前实际收益率" inputMode="decimal" value={before} disabled={frozen} onChange={e => setBefore(e.target.value)}/></FormRow>
      <FormRow label="退休后实际收益率（年，%）" hint="扣除通胀，这是假设"><input aria-label="退休后实际收益率" inputMode="decimal" value={after} disabled={frozen} onChange={e => setAfter(e.target.value)}/></FormRow>
      <FormRow label="规划到的年龄" hint="70 到 110 岁，默认 90"><input aria-label="规划到的年龄" inputMode="numeric" value={horizon} disabled={frozen} onChange={e => setHorizon(e.target.value)}/></FormRow>
      <FormRow label="应急金线（个月支出）" hint="可支配资产低于它时提示，不作为目标存储"><input aria-label="应急金线" inputMode="numeric" value={months} disabled={frozen} onChange={e => setMonths(e.target.value)}/></FormRow>
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
    <Info text="退休前后收益率可以不同；敏感性表里的收益率列同时用于退休前后。"/>
  </form></dialog>;
}
