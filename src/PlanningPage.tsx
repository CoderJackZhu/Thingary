import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info } from './FormControls';
import { HeaderSlot } from './HeaderSlot';
import { PlanningPension } from './PlanningPension';
import { changeSentence, rateText, reasonIsInflow, reasonSourceLabel, statusText } from './plan';
import type { Income, IncomeFields, IncomeList, IncomeSave, Interval, Mark, PlanReview, Reasons } from './plan';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useRestored } from './undo';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import './wealth.css';
import './planning.css';

const dateRange = (i: Interval) => `${i.from} → ${i.to}`;

export function PlanningPage({ today, onEditingChange }: { today: string; onEditingChange: (value: boolean) => void }) {
  const [review, setReview] = useState<PlanReview | null>(null), [incomes, setIncomes] = useState<IncomeList | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Income | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'savings' | 'pension'>('savings');
  const [marking, setMarking] = useState(false), [markError, setMarkError] = useState('');
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!pending || busy || marking); return () => onEditingChange(false); }, [editing, pending, busy, marking, onEditingChange]);
  useEffect(() => {
    let live = true; setError('');
    Promise.all([invoke<PlanReview>('plan_review'), invoke<IncomeList>('plan_income_list')])
      .then(([r, l]) => { if (live) { setReview(r); setIncomes(l); } })
      .catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);

  const newest = review ? [...review.intervals].reverse() : [];
  const shown = newest.find(i => i.snapshot_id === selected) ?? newest.find(i => i.status === 'ok') ?? newest[0] ?? null;

  const openNew = { label: '记一笔收入', plus: true, disabled: !!pending || !incomes, run: () => { setTab('savings'); setEditing('new'); } };
  usePageBar('planning', { primary: openNew, newRecord: openNew });

  async function mark(interval: Interval) {
    if (!review) return;
    const input: Mark = { request_id: crypto.randomUUID(), generation: review.generation, snapshot_id: interval.snapshot_id, excluded: !interval.excluded };
    setMarking(true); setMarkError('');
    try { await submit({ command: 'plan_baseline_mark', input, label: '一次性变动标记' }); reload(); }
    catch (e) { setMarkError(e instanceof Error ? e.message : errorMessage(e)); setPending(storedPending()); }
    finally { setMarking(false); }
  }

  return <section className="stats-section wealth-section planning-section" aria-label="规划">
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <HeaderSlot><div className="wealth-toolbar">
      <div className="segmented" role="group" aria-label="规划内容"><button aria-pressed={tab === 'savings'} onClick={() => setTab('savings')}>储蓄与收入</button><button aria-pressed={tab === 'pension'} onClick={() => setTab('pension')}>养老金</button></div>
      <Info text="储蓄 = 两次完整盘点之间的净资产变化 − 同期公积金缴存；支出 = 税后到账 + 公积金缴存 − 净资产变化。公积金提取是账户间转移，不需要记录。这些是用盘点与收入推出的估算，不是逐笔账。"/>
    </div></HeaderSlot>
    {error ? <article className="ui-card ui-content" role="alert"><p>规划读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !review || !incomes ? <p role="status" className="muted">正在读取规划…</p>
      : tab === 'pension' ? <PlanningPension today={today} incomes={incomes.rows} onEditingChange={onEditingChange} onPending={() => setPending(storedPending())}/>
      : <>
        <Usual review={review}/>
        {shown ? <Steps interval={shown} review={review} busy={marking || !!pending} markError={markError} onMark={() => void mark(shown)} generation={review.generation}/>
          : <div className="empty"><span className="empty-mark">¥</span><h2>还没有可比较的盘点区间</h2><p>需要至少两次完整盘点，并在这段时间内记录月度收入。{review.incomplete_count > 0 && `有 ${review.incomplete_count} 次不完整盘点，补齐后才能参与。`}</p></div>}
        {newest.length > 0 && <Intervals intervals={newest} selected={shown?.snapshot_id ?? null} onSelect={setSelected}/>}
        <IncomeTable incomes={incomes} onOpen={setEditing} onNew={() => setEditing('new')} disabled={!!pending}/>
      </>}
    {editing && incomes && <IncomeDialog income={editing === 'new' ? null : editing} generation={incomes.generation} today={today} onClose={saved => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(null); setPending(storedPending()); if (saved) reload(); refocusHeading(); }}/>}
  </section>;
}

function Usual({ review }: { review: PlanReview }) {
  const s = review.stats, m = (v: string | null) => (v === null ? '—' : money(v));
  return <>
    <div className="ui-metrics ui-card" aria-label="常态储蓄">
      <article><span>常态月储蓄（中位数）</span><strong>{m(s.median_monthly_saving_cents)}</strong></article>
      <article><span>月储蓄平均（按时长加权）</span><strong>{m(s.mean_monthly_saving_cents)}</strong></article>
      <article><span>常态月支出（中位数）</span><strong>{m(s.median_monthly_spend_cents)}</strong></article>
      <article><span>参与统计的区间</span><strong>{s.count} 个</strong>{s.low_sample && <small className="muted">样本少，仅供参考</small>}</article>
    </div>
    <p className="muted small">{s.latest_date ? `统计近 12 个月内（${s.window_from} 之后）结束的区间，最新完整盘点 ${s.latest_date}。` : '还没有完整盘点。'}标为一次性变动、账户范围变化或未记录收入的区间不参与。{review.incomplete_count > 0 && `另有 ${review.incomplete_count} 次不完整盘点未使用。`}</p>
  </>;
}

/** 复盘三段式：现状 → 变化 → 原因（PLANNING_DESIGN §4.4）。 */
function Steps({ interval: i, review, busy, markError, onMark, generation }: { interval: Interval; review: PlanReview; busy: boolean; markError: string; onMark: () => void; generation: string }) {
  const [reasons, setReasons] = useState<Reasons | null>(null), [reasonError, setReasonError] = useState('');
  useEffect(() => {
    let live = true; setReasons(null); setReasonError('');
    invoke<Reasons>('plan_interval_reasons', { snapshotId: i.snapshot_id })
      .then(r => { if (live) setReasons(r); }).catch(e => { if (live) setReasonError(errorMessage(e)); });
    return () => { live = false; };
  }, [i.snapshot_id, generation]);
  const ok = i.status === 'ok';
  const sentence = changeSentence(i, review.stats);
  return <article className="ui-card ui-content plan-steps" aria-label="这一期的复盘">
    <div className="ui-section-head"><h3>{dateRange(i)}</h3><span>{i.days} 天 · 两次完整盘点之间</span></div>
    <section aria-labelledby="plan-step-1"><h4 id="plan-step-1">现状</h4>
      {ok ? <dl className="plan-facts">
        <div><dt>净资产变化</dt><dd>{money(i.delta_nw_cents)}</dd></div>
        <div><dt>税后到账</dt><dd>{money(i.income_cents)}</dd></div>
        <div><dt>公积金缴存</dt><dd>{money(i.hpf_cents)}</dd></div>
        <div><dt>储蓄</dt><dd>{money(i.saving_cents)}</dd></div>
        <div><dt>支出</dt><dd>{money(i.spend_cents)}</dd></div>
        <div><dt>储蓄率</dt><dd>{rateText(i.rate_hundredths)}</dd></div>
      </dl> : <p className="muted">{statusText[i.status]}，这一期没有储蓄数字。{i.status === 'no_income' && '在这段时间内记录月度收入后即可计算。'}</p>}
      {i.income_possibly_missing && ok && <p className="muted small">这一期的收入记录少于整月数，可能漏记；数字仍按已记录的计算。</p>}
    </section>
    <section aria-labelledby="plan-step-2"><h4 id="plan-step-2">变化</h4>
      {ok ? <>
        <p>{sentence || '还没有足够的常态数据可比较。'}{i.monthly_saving_cents !== null && ` 折合每月储蓄 ${money(i.monthly_saving_cents)}。`}</p>
        {i.anomaly && <p className="notice" role="status">这一期与常态相差较大，建议在这次盘点补一条备注，或标记为一次性变动。</p>}
        <button type="button" className="ui-btn" disabled={busy} onClick={onMark}>{i.excluded ? '取消「一次性变动」标记' : '标记为一次性变动（不计入常态）'}</button>
        {markError && <p className="error" role="alert">{markError}</p>}
      </> : <p className="muted">—</p>}
    </section>
    <section aria-labelledby="plan-step-3"><h4 id="plan-step-3">原因</h4>
      {reasonError ? <p className="error" role="alert">读取失败：{reasonError}</p> : !reasons ? <p className="muted" role="status">正在读取…</p> : <>
        <p>{reasons.notes.trim() ? <><span className="muted">这次盘点备注：</span>{reasons.notes}</> : <span className="muted">这次盘点没有备注。</span>}</p>
        {reasons.lines.length ? <table className="ui-table plan-reasons"><thead><tr><th>日期</th><th>来源</th><th>名称</th><th className="amount">金额</th></tr></thead>
          <tbody>{reasons.lines.map(l => <tr key={l.source + l.id}><td>{l.date}</td><td><span className="ui-tag">{reasonSourceLabel[l.source] ?? l.source}</span></td><td>{l.title}</td><td className="amount">{money(reasonIsInflow(l) && l.amount_cents ? '-' + l.amount_cents : l.amount_cents)}</td></tr>)}</tbody></table>
          : <p className="muted">这段时间没有已记录的物品购入、重要支出或周期付款。</p>}
        <p className="muted small">这些记录只用于解释，不会调整上面的数字。</p>
      </>}
    </section>
  </article>;
}

function Intervals({ intervals, selected, onSelect }: { intervals: Interval[]; selected: string | null; onSelect: (id: string) => void }) {
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>各区间</h3><span>点一行查看复盘</span></div>
    <table className="ui-table plan-intervals"><thead><tr><th>期间</th><th className="amount">税后到账</th><th className="amount">储蓄</th><th className="amount">月储蓄</th><th className="amount">储蓄率</th><th>说明</th></tr></thead>
      <tbody>{intervals.map(i => <tr key={i.snapshot_id} className={i.snapshot_id === selected ? 'selected' : i.excluded || i.status !== 'ok' ? 'closed' : undefined}>
        <td><button className="link-cell" aria-pressed={i.snapshot_id === selected} onClick={() => onSelect(i.snapshot_id)}>{dateRange(i)}</button><small className="muted"> {i.days} 天</small></td>
        <td className="amount">{i.status === 'ok' || i.status === 'scope_changed' ? money(i.income_cents) : <span className="muted">—</span>}</td>
        <td className="amount">{i.saving_cents === null ? <span className="muted">—</span> : money(i.saving_cents)}</td>
        <td className="amount">{i.monthly_saving_cents === null ? <span className="muted">—</span> : money(i.monthly_saving_cents)}</td>
        <td className="amount">{rateText(i.rate_hundredths)}</td>
        <td>{i.status !== 'ok' && <span className="ui-tag">{statusText[i.status]}</span>}{i.excluded && <span className="ui-tag">一次性变动</span>}{i.anomaly && <span className="ui-tag warn">偏离常态</span>}{i.income_possibly_missing && i.status === 'ok' && <span className="ui-tag">可能漏记收入</span>}</td>
      </tr>)}</tbody></table></article>;
}

function IncomeTable({ incomes, onOpen, onNew, disabled }: { incomes: IncomeList; onOpen: (i: Income) => void; onNew: () => void; disabled: boolean }) {
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>月度收入</h3><span>{incomes.rows.length} 条 · 每月到账一行</span></div>
    {incomes.rows.length ? <table className="ui-table plan-income"><thead><tr><th>到账日期</th><th className="amount">税后到账</th><th className="amount">公积金缴存</th><th>备注</th></tr></thead>
      <tbody>{incomes.rows.map(r => <tr key={r.id}><td><button className="link-cell" onClick={() => onOpen(r)}>{r.fields.date}</button></td><td className="amount">{money(r.fields.net_cents)}</td><td className="amount">{money(r.fields.hpf_cents)}</td><td className="muted">{r.fields.notes}</td></tr>)}</tbody></table>
      : <div className="empty"><span className="empty-mark">¥</span><h2>还没有收入记录</h2><p>每月记一行实际到账的税后收入和公积金缴存，才能算出支出与储蓄率。公积金提取是账户间转移，不用记。</p><button className="primary" disabled={disabled} onClick={onNew}>记一笔收入</button></div>}
  </article>;
}

const blank = (today: string): IncomeFields => ({ date: today, net_cents: '', hpf_cents: '', notes: '' });

function IncomeDialog({ income, generation, today, onClose }: { income: Income | null; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<IncomeFields>(income?.fields ?? blank(today));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('income-date')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof IncomeFields>(k: K, v: IncomeFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  async function save() {
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    if (!f.date) return stop('到账日期', '请填写到账日期。');
    if (f.net_cents === '') return stop('税后到账', '请填写税后到账金额；没有到账就填 0。');
    if (f.hpf_cents === '') return stop('公积金缴存', '请填写公积金缴存；没有就填 0。');
    const input: IncomeSave = { request_id: crypto.randomUUID(), generation, id: income?.id ?? null, expected_revision: income?.revision ?? null, fields: f };
    setBusy(true); setNotice('');
    try { await submit({ command: 'plan_income_save', input, label: `收入 ${f.date}` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="income-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 月度收入</p><h2 id="income-heading">{income ? '编辑收入' : '记一笔收入'}</h2><p className="muted">记录实际到账的税后收入和公积金缴存，每月一行。</p></div><CloseButton type="button" aria-label="关闭收入表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{income && !stuck && <DeleteButton label="删除" disabled={busy} kind="income" id={income.id} revision={income.revision} generation={generation} name={`收入 ${income.fields.date}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存收入'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="到账日期" hint="同一天可以有多行，例如工资与奖金分开发放"><DateInput id="income-date" value={f.date} max={today} disabled={frozen} onChange={v => set('date', v)}/></FormRow>
      <FormRow label="税后到账" hint="工资、奖金等实际到卡金额；年终奖记在到账当月"><CentInput label="税后到账" value={f.net_cents} disabled={frozen} placeholder="0.00" onChange={v => set('net_cents', v)}/></FormRow>
      <FormRow label="公积金缴存" hint="个人与单位合计；没有就填 0"><CentInput label="公积金缴存" value={f.hpf_cents} disabled={frozen} placeholder="0.00" onChange={v => set('hpf_cents', v)}/></FormRow>
    </section>
    <section className="form-block form-notes"><label htmlFor="income-notes">备注</label><textarea id="income-notes" maxLength={500} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
