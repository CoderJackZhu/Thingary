import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info } from './FormControls';
import { ageText, fundsFrom, hundredthsToPct, pctToHundredths, rateText } from './plan';
import type { Income, PlanReview, ProfileSave, ProfileState, RetireInputs } from './plan';
import { beijing, effectiveParams } from './plan-params';
import { emergency, findFire, pensionTable, sensitivity, traditional } from './plan-fire';
import type { Ledger } from './plan-fire';
import { ageMonthsAt, startAgeMonths } from './plan-pension';
import { submit, Unresolved } from './wealth';
import type { Snapshot, Summary } from './wealth';
import './planning.css';

const SEARCH_CAP_YEARS = 70;
const yuan = (c: number) => money(String(Math.round(c)));
const monthText = (today: string, offset: number) => { const i = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + offset; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

/** 可支配资产 = 最近完整盘点里计入的资产 − 负债 − 公积金类账户（锁定到领取年龄）。 */
function disposable(snapshot: Snapshot | null): number | null {
  if (!snapshot) return null;
  let total = 0n;
  for (const e of snapshot.entries) {
    if (!e.counted || e.amount_cents === null) continue;
    if (e.kind === 'housing_fund') continue;
    total += (e.side === 'liability' ? -1n : 1n) * BigInt(e.amount_cents);
  }
  return Number(total);
}

/** 退休与 FIRE：所需资产、达成年限、敏感性表。全部用「今天的钱」；结果不存库。 */
export function PlanningRetire({ today, review, incomes, onEditingChange, onPending }: { today: string; review: PlanReview; incomes: Income[]; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const [state, setState] = useState<ProfileState | null>(null), [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [editing, setEditing] = useState(false);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
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
  const calc = useMemo(() => {
    if (!saved || snapshot === undefined) return null;
    const p = saved.profile, r = p.retire, region = effectiveParams(beijing, p.overrides);
    const stats = review.stats;
    const { funds } = fundsFrom(snapshot?.entries ?? null, incomes);
    const now = ageMonthsAt(p.birth_month, today), start = startAgeMonths(p);
    const assets = disposable(snapshot);
    const saving = stats.median_monthly_saving_cents === null ? null : Number(stats.median_monthly_saving_cents);
    const derivedSpend = stats.median_monthly_spend_cents === null ? null : Number(stats.median_monthly_spend_cents);
    const spend = r.spend_cents !== null ? Number(r.spend_cents) : derivedSpend;
    const missing: string[] = [];
    if (assets === null) missing.push('还没有完整盘点，算不出当前可支配资产。');
    if (saving === null) missing.push('还没有常态月储蓄：需要至少两次完整盘点，并在这段时间内记录月度收入。');
    if (spend === null) missing.push('没有可用的退休后月支出：请在假设里填写，或先积累有收入记录的盘点区间。');
    if (missing.length || assets === null || saving === null || spend === null) return { p, r, now, start, missing, assets, saving, spend, derivedSpend, fire: undefined, trad: undefined, sens: undefined, emergency: undefined };
    const horizon = r.horizon_age * 12;
    const L: Ledger = { now_months: now, horizon_months: horizon, search_cap_months: Math.min(SEARCH_CAP_YEARS * 12, horizon), spend_cents: spend, assets_cents: assets, pension_at: pensionTable(p, region, today, funds, now, Math.max(now, start)) };
    return {
      p, r, now, start, missing, assets, saving, spend, derivedSpend,
      fire: findFire(L, saving, r.real_return_before_hundredths, r.real_return_after_hundredths),
      trad: traditional(L, start, saving, r.real_return_before_hundredths, r.real_return_after_hundredths),
      sens: sensitivity(L, saving),
      emergency: emergency(assets, spend, r.emergency_months),
    };
  }, [saved, snapshot, incomes, review, today]);

  if (error) return <article className="ui-card ui-content" role="alert"><p>退休估算读取失败：{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></article>;
  if (!state || snapshot === undefined) return <p role="status" className="muted">正在读取…</p>;
  if (!saved || !calc) return <div className="empty"><span className="empty-mark">¥</span><h2>先填写个人资料</h2><p>退休与财务自由的估算需要出生年月和养老金资料。请先到「养老金」页签填写个人资料。</p></div>;
  const { r } = calc;
  return <>
    <article className="ui-card ui-content plan-steps" aria-label="退休与财务自由估算">
      <div className="ui-section-head"><h3>你的起点</h3><span><button type="button" className="ui-btn" onClick={() => setEditing(true)}>编辑退休假设</button></span></div>
      <section aria-labelledby="fire-start"><h4 id="fire-start">现状（今天的钱）</h4>
        <dl className="plan-facts">
          <div><dt>可支配资产</dt><dd>{calc.assets === null ? '—' : yuan(calc.assets)}</dd><small className="muted">最近完整盘点，不含公积金账户</small></div>
          <div><dt>常态月储蓄</dt><dd>{calc.saving === null ? '—' : yuan(calc.saving)}</dd><small className="muted">近 12 个月中位数</small></div>
          <div><dt>退休后月支出</dt><dd>{calc.spend === null ? '—' : yuan(calc.spend)}</dd><small className="muted">{r.spend_cents !== null ? '你填写的目标' : '近 12 个月推出的支出中位数'}</small></div>
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
    {calc.sens && <article className="ui-card ui-content"><div className="ui-section-head"><h3>敏感性：FIRE 年龄</h3><span>行：月储蓄；列：实际收益率（退休前后相同）</span></div>
      <table className="ui-table plan-sens"><thead><tr><th>月储蓄</th>{calc.sens.rates.map(x => <th key={x} className="amount">{rateText(x)}</th>)}</tr></thead>
        <tbody>{calc.sens.cells.map((row, i) => <tr key={calc.sens!.factors[i]} className={calc.sens!.factors[i] === 1 ? 'selected' : undefined}>
          <th scope="row">{calc.saving !== null ? yuan(calc.saving * calc.sens!.factors[i]) : ''}<small className="muted"> {Math.round(calc.sens!.factors[i] * 100)}%</small></th>
          {row.map((age, k) => <td key={k} className="amount">{age === null ? <span className="muted">—</span> : ageText(age)}</td>)}</tr>)}</tbody></table>
      <p className="muted small">一眼看出多存钱和提高收益哪个对你更有用；「—」表示 {SEARCH_CAP_YEARS} 岁前达不到。这是估算，不是承诺；它不预测裁员、跳槽或涨薪，只按最近的真实储蓄往后推。</p></article>}
    {editing && <RetireDialog state={state} today={today} onClose={ok => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(false); onPending(); if (ok) setRetry(n => n + 1); }}/>}
  </>;
}

function RetireDialog({ state, today, onClose }: { state: ProfileState; today: string; onClose: (saved: boolean) => void }) {
  const saved = state.saved!, r0 = saved.profile.retire;
  const dialog = useRef<HTMLDialogElement>(null);
  const [spend, setSpend] = useState(r0.spend_cents ?? ''), [before, setBefore] = useState(hundredthsToPct(r0.real_return_before_hundredths)), [after, setAfter] = useState(hundredthsToPct(r0.real_return_after_hundredths));
  const [horizon, setHorizon] = useState(String(r0.horizon_age)), [months, setMonths] = useState(String(r0.emergency_months));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('retire-spend')?.focus(); return () => dialog.current?.close(); }, []);
  const frozen = busy || stuck;
  async function save() {
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    const b = pctToHundredths(before), a = pctToHundredths(after);
    if (b === null) return stop('退休前实际收益率', '退休前实际收益率请填百分数，例如 0 或 1.5。');
    if (a === null) return stop('退休后实际收益率', '退休后实际收益率请填百分数，例如 0 或 1.5。');
    const h = Number(horizon), m = Number(months);
    if (!Number.isInteger(h) || h < 70 || h > 110) return stop('规划到的年龄', '规划终点须是 70 到 110 之间的整数岁。');
    if (!Number.isInteger(m) || m < 0 || m > 36) return stop('应急金线', '应急金线须是 0 到 36 个月。');
    if (spend === '0') return stop('退休后月支出', '退休后月支出须大于 0，或留空使用推算值。');
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
      <FormRow label="退休后月支出" hint="今天的钱；留空则用近 12 个月推出的支出中位数"><span id="retire-spend"><CentInput label="退休后月支出" value={spend} disabled={frozen} placeholder="留空使用推算值" onChange={setSpend}/></span></FormRow>
      <FormRow label="退休前实际收益率（年，%）" hint="扣除通胀；货币基金为主时接近 0，这是假设"><input aria-label="退休前实际收益率" inputMode="decimal" value={before} disabled={frozen} onChange={e => setBefore(e.target.value)}/></FormRow>
      <FormRow label="退休后实际收益率（年，%）" hint="扣除通胀，这是假设"><input aria-label="退休后实际收益率" inputMode="decimal" value={after} disabled={frozen} onChange={e => setAfter(e.target.value)}/></FormRow>
      <FormRow label="规划到的年龄" hint="70 到 110 岁，默认 90"><input aria-label="规划到的年龄" inputMode="numeric" value={horizon} disabled={frozen} onChange={e => setHorizon(e.target.value)}/></FormRow>
      <FormRow label="应急金线（个月支出）" hint="可支配资产低于它时提示，不作为目标存储"><input aria-label="应急金线" inputMode="numeric" value={months} disabled={frozen} onChange={e => setMonths(e.target.value)}/></FormRow>
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
    <Info text="退休前后收益率可以不同；敏感性表里的收益率列同时用于退休前后。"/>
  </form></dialog>;
}
