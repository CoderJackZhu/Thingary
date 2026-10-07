import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info } from './FormControls';
import { HeaderSlot } from './HeaderSlot';
import { PlanningPension } from './PlanningPension';
import { PlanningGoals } from './PlanningGoals';
import { PlanningSetup } from './PlanningSetup';
import { latestHpf, reasonIsInflow, reasonSourceLabel, statusText } from './plan';
import type { Income, IncomeFields, IncomeList, IncomeSave, Interval, Mark, PlanReview, Reasons } from './plan';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useRestored } from './undo';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import './wealth.css';
import './planning.css';

const dateRange = (i: Interval) => `${i.from} → ${i.to}`;

export type PlanningTab = 'goals' | 'savings' | 'pension';
export const planningTabs: [PlanningTab, string][] = [['goals', '目标'], ['savings', '收入与复盘'], ['pension', '养老金']];

export function PlanningPage({ today, tab, onTab, onEditingChange, focus = null, onFocusDone }: { focus?: 'budget' | 'profile' | null; onFocusDone: () => void; today: string; tab: PlanningTab; onTab: (tab: PlanningTab) => void; onEditingChange: (value: boolean) => void }) {
  const [review, setReview] = useState<PlanReview | null>(null), [incomes, setIncomes] = useState<IncomeList | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Income | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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

  const openNew = { label: '记一笔收入', plus: true, disabled: !!pending || !incomes, run: () => { onTab('savings'); setEditing('new'); } };
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
      <Info text="金融净资产变化含估值、利息与外部变动，不能证明真实储蓄或消费。收入只展示已记录金额；未来净投入需要独立确认。"/>
    </div></HeaderSlot>
    {error ? <article className="ui-card ui-content" role="alert"><p>规划读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !review || !incomes ? <p role="status" className="muted">正在读取规划…</p>
      : <PlanningSetup today={today} incomes={incomes.rows} refresh={retry} onSaved={reload} recordView={tab === 'savings'} onRecords={() => onTab('savings')} onPending={() => setPending(storedPending())} onEditingChange={onEditingChange}>{tab === 'goals' ? <PlanningGoals key={retry} focus={focus === 'budget'} onFocusDone={onFocusDone} today={today} review={review} incomes={incomes.rows} onEditingChange={onEditingChange} onPending={() => setPending(storedPending())} onGoto={onTab}/>
      : tab === 'pension' ? <PlanningPension key={retry} focus={focus === 'profile'} onFocusDone={onFocusDone} today={today} incomes={incomes.rows} onEditingChange={onEditingChange} onPending={() => setPending(storedPending())}/>
      : <>
        <Usual review={review}/>
        {shown ? <Steps interval={shown} review={review} busy={marking || !!pending} markError={markError} onMark={() => void mark(shown)} generation={review.generation}/>
          : <div className="empty"><span className="empty-mark">¥</span><h2>还没有可比较的盘点区间</h2><p>需要至少两次完整且范围可比的盘点；收入缺项不抹去资产事实。{review.incomplete_count > 0 && `有 ${review.incomplete_count} 次不完整盘点，补齐后才能参与。`}</p></div>}
        {newest.length > 0 && <Intervals intervals={newest} selected={shown?.snapshot_id ?? null} onSelect={setSelected}/>}
        <IncomeTable incomes={incomes} onOpen={setEditing} onNew={() => setEditing('new')} disabled={!!pending}/>
      </>}</PlanningSetup>}
    {editing && incomes && <IncomeDialog income={editing === 'new' ? null : editing} generation={incomes.generation} today={today} hpfDefault={latestHpf(incomes.rows)} onClose={saved => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(null); setPending(storedPending()); if (saved) reload(); refocusHeading(); }}/>}
  </section>;
}

function Usual({ review }: { review: PlanReview }) {
  const s = review.stats, m = (v: string | null | undefined) => v == null ? '—' : money(v);
  return <><div className="ui-metrics ui-card" aria-label="历史资产参考">
    <article><span>月均净资产变化（含估值变化）</span><strong>{m(s.mean_monthly_change_cents)}</strong></article>
    <article><span>历史中位数（含估值变化）</span><strong>{m(s.median_monthly_change_cents)}</strong></article>
    <article><span>最近完整盘点</span><strong>{s.latest_date ?? '待补充'}</strong></article>
  </div><p className="muted small">近12个月的可比盘点区间；均值按天数加权，中位数每区间一票。历史参考不自动成为未来净投入。收入覆盖尚未确认。</p></>;
}

/** 复盘三段式：现状 → 变化 → 原因（PLANNING_DESIGN §4.4）。 */
function Steps({ interval: i, busy, markError, onMark, generation }: { interval: Interval; review: PlanReview; busy: boolean; markError: string; onMark: () => void; generation: string }) {
  const [reasons, setReasons] = useState<Reasons | null>(null), [reasonError, setReasonError] = useState('');
  useEffect(() => {
    let live = true; setReasons(null); setReasonError('');
    invoke<Reasons>('plan_interval_reasons', { snapshotId: i.snapshot_id })
      .then(r => { if (live) setReasons(r); }).catch(e => { if (live) setReasonError(errorMessage(e)); });
    return () => { live = false; };
  }, [i.snapshot_id, generation]);
  const ok = i.delta_nw_cents !== null;
  return <article className="ui-card ui-content plan-steps" aria-label="这一期的复盘">
    <div className="ui-section-head"><h3>{dateRange(i)}</h3><span>{i.days} 天 · 两次完整盘点之间</span></div>
    <section aria-labelledby="plan-step-1"><h4 id="plan-step-1">现状</h4>
      {ok ? <dl className="plan-facts">
        <div><dt>净资产变化</dt><dd>{money(i.delta_nw_cents)}</dd></div>
        <div><dt>已记录到账收入</dt><dd>{money(i.income_cents)}</dd></div>
        <div><dt>已记录公积金缴存</dt><dd>{money(i.hpf_cents)}</dd></div>
        <div><dt>公积金账户变化</dt><dd>{money(i.hpf_change_cents)}</dd></div>
      </dl> : <p className="muted">{statusText[i.status]}；已记录收入 {money(i.income_cents)}，公积金缴存 {money(i.hpf_cents)}。</p>}
      <p className="muted small">收入覆盖待核对。净资产变化含估值变化，不能反推消费、真实储蓄或储蓄率。</p>
    </section>
    <section aria-labelledby="plan-step-2"><h4 id="plan-step-2">变化</h4>
      {ok ? <>
        <p>本期金融净资产变化 {money(i.delta_nw_cents)}（含估值变化）。</p>
        <button type="button" className="ui-btn" disabled={busy} onClick={onMark}>{i.excluded ? '取消「一次性变动」标记' : '标记为一次性变动（不计入历史参考）'}</button>
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
    <table className="ui-table plan-intervals"><thead><tr><th>期间</th><th className="amount">税后到账</th><th className="amount">金融净资产变化</th><th>覆盖</th><th>说明</th></tr></thead>
      <tbody>{intervals.map(i => <tr key={i.snapshot_id} className={i.snapshot_id === selected ? 'selected' : i.excluded || i.status !== 'ok' ? 'closed' : undefined}>
        <td><button className="link-cell" aria-pressed={i.snapshot_id === selected} onClick={() => onSelect(i.snapshot_id)}>{dateRange(i)}</button><small className="muted"> {i.days} 天</small></td>
        <td className="amount">{i.status === 'ok' || i.status === 'scope_changed' ? money(i.income_cents) : <span className="muted">—</span>}</td>
        <td className="amount">{money(i.delta_nw_cents)}</td><td>收入覆盖待核对</td>
        <td>{i.status !== 'ok' && <span className="ui-tag">{statusText[i.status]}</span>}{i.excluded && <span className="ui-tag">一次性变动</span>}{i.income_possibly_missing && i.status === 'ok' && <span className="ui-tag">可能漏记收入</span>}</td>
      </tr>)}</tbody></table></article>;
}

function IncomeTable({ incomes, onOpen, onNew, disabled }: { incomes: IncomeList; onOpen: (i: Income) => void; onNew: () => void; disabled: boolean }) {
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>月度收入</h3><span>{incomes.rows.length} 条 · 每月到账一行</span></div>
    {incomes.rows.length ? <table className="ui-table plan-income"><thead><tr><th>到账日期</th><th className="amount">税后到账</th><th className="amount">公积金缴存</th><th>备注</th></tr></thead>
      <tbody>{incomes.rows.map(r => <tr key={r.id}><td><button className="link-cell" onClick={() => onOpen(r)}>{r.fields.date}</button></td><td className="amount">{money(r.fields.net_cents)}</td><td className="amount">{money(r.fields.hpf_cents)}</td><td className="muted">{r.fields.notes}</td></tr>)}</tbody></table>
      : <div className="empty"><span className="empty-mark">¥</span><h2>还没有收入记录</h2><p>可记录实际到账的税后收入和公积金缴存；无收入记录仍能查看资产变化。公积金提取是账户间转移，不用记。</p><button className="primary" disabled={disabled} onClick={onNew}>记一笔收入</button></div>}
  </article>;
}

const blank = (today: string): IncomeFields => ({ date: today, net_cents: '', hpf_cents: '', notes: '' });

function IncomeDialog({ income, generation, today, hpfDefault, onClose }: { income: Income | null; generation: string; today: string; hpfDefault: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 公积金缴存一段时间内固定：新增时带入上一条的金额（可改），每月只需要填税后到账。
  const [f, setF] = useState<IncomeFields>(income?.fields ?? { ...blank(today), hpf_cents: hpfDefault });
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
      <FormRow label="公积金缴存" hint={!income && hpfDefault ? '已带入上一条的金额，变了请改；个人与单位合计，没有就填 0' : '个人与单位合计；没有就填 0'}><CentInput label="公积金缴存" value={f.hpf_cents} disabled={frozen} placeholder="0.00" onChange={v => set('hpf_cents', v)}/></FormRow>
    </section>
    <section className="form-block form-notes"><label htmlFor="income-notes">备注</label><textarea id="income-notes" maxLength={500} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
