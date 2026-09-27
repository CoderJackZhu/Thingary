import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import type { Page } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Switch } from './FormControls';
import { Icon } from './AssetViews';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import { categoryText, countsAsSpending, expenseCategories, sourceLabel } from './expenses';
import type { Expense, ExpenseFields, ExpenseSave, ExpenseView, Line } from './expenses';
import './wealth.css';

export function ExpensesPage({ today, onOpenAsset }: { today: string; onOpenAsset: (id: string) => void }) {
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState<number | null>(thisYear);
  const [view, setView] = useState<ExpenseView | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const reload = () => setRetry(n => n + 1);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => {
    let live = true; setError('');
    invoke<ExpenseView>('expense_view', { year }).then(v => { if (live) setView(v); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [year, retry]);
  async function open(line: Line) {
    if (line.source === 'expense' || line.source === 'linked' || line.source === 'refund') {
      try { const e = await invoke<Expense | null>('expense', { id: line.id }); if (e) setEditing(e); else reload(); }
      catch (e) { setError(errorMessage(e)); }
    } else if (line.asset_id) onOpenAsset(line.asset_id);
  }
  const years = [...new Set([thisYear, ...(view?.years ?? [])])].sort((a, b) => b - a);
  const period = year === null ? '全部' : `${year} 年`;
  return <section className="stats-section wealth-section" aria-label="重要支出">
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="wealth-toolbar">
      <div className="segmented" role="group" aria-label="支出期间"><button aria-pressed={year === null} onClick={() => setYear(null)}>全部</button>{years.map(y => <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}</div>
      <div className="wealth-actions"><button className="primary" disabled={!!pending || !view} onClick={() => setEditing('new')}><Icon name="plus"/><span>记一笔支出</span></button></div>
    </div>
    {error ? <article className="detail-section" role="alert"><p>重要支出读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !view ? <p role="status" className="muted">正在读取重要支出…</p>
      : <>
        <div className="stats-kpis wealth-kpis">
          <article><span>{period}支出</span><strong>{money(view.spent_cents)}</strong><em>物品购入、维护、周期付款与独立支出</em></article>
          <article><span>退款</span><strong>{money(view.refund_cents)}</strong><em>按退款日期计入</em></article>
          <article><span>净支出</span><strong>{money(view.net_cents)}</strong><em>支出 − 退款</em></article>
          <article><span>售出回收</span><strong>{money(view.sale_cents)}</strong><em>单独列出，不抵扣支出</em></article>
        </div>
        {(view.undated.length > 0 || view.unknown_amount_count > 0) && <p className="muted small">{view.undated.length > 0 && `日期待补 ${view.undated.length} 条（已知 ${money(view.undated_cents)}），不归入任何期间。`}{view.unknown_amount_count > 0 && `${view.unknown_amount_count} 条购入或维护金额未知，未计入。`}</p>}
        {view.months.length > 0 && <article className="detail-section overview-card"><div className="section-heading"><h3>各月支出</h3><span>{year} 年 · 不含日期待补</span></div><MonthBars months={view.months}/></article>}
        {!view.lines.length && !view.undated.length ? <div className="empty"><span className="empty-mark">¥</span><h2>{year === null ? '还没有重要支出' : `${year} 年没有记录`}</h2><p>物品的购入和维护会自动出现在这里；旅行、培训等没有对应物品的大额花费，可以单独记一笔。</p><button className="primary" disabled={!!pending} onClick={() => setEditing('new')}>记一笔支出</button></div>
          : <LineTable lines={view.lines} undated={view.undated} onOpen={line => void open(line)}/>}
      </>}
    {editing && view && <ExpenseDialog expense={editing === 'new' ? null : editing} generation={view.generation} today={today} onClose={saved => { setEditing(null); setPending(storedPending()); if (saved) reload(); }}/>}
  </section>;
}

function LineTable({ lines, undated, onOpen }: { lines: Line[]; undated: Line[]; onOpen: (l: Line) => void }) {
  const row = (l: Line) => <tr key={l.source + l.id} className={countsAsSpending(l) ? undefined : 'closed'}>
    <td>{l.date ?? <span className="muted">日期待补</span>}</td>
    <td><button className="link-cell" onClick={() => onOpen(l)}>{l.title}</button></td>
    <td>{sourceLabel[l.source]}</td><td>{categoryText(l)}</td>
    <td className="amount">{l.amount_cents === null ? <span className="muted">金额未知</span> : l.source === 'refund' || l.source === 'sale' ? '−' + money(l.amount_cents) : money(l.amount_cents)}</td>
  </tr>;
  return <table className="distribution-table expense-lines"><thead><tr><th>日期</th><th>名称</th><th>来源</th><th>分类</th><th>金额</th></tr></thead>
    <tbody>{lines.map(row)}{undated.map(row)}</tbody></table>;
}

function MonthBars({ months }: { months: ExpenseView['months'] }) {
  const W = 640, H = 150, L = 56, B = 22, T = 10, max = Math.max(1, ...months.map(m => Number(m.spent_cents)));
  const step = 10 ** Math.floor(Math.log10(max)), unit = [1, 2, 5, 10].map(n => n * step).find(n => max / n <= 4) ?? step * 10, top = Math.ceil(max / unit) * unit;
  const grid = Array.from({ length: top / unit + 1 }, (_, i) => i * unit), w = (W - L) / 12, y = (v: number) => T + (H - T - B) * (1 - v / top);
  const label = (c: number) => c >= 1_000_000 ? `¥${(c / 1_000_000).toFixed(c % 1_000_000 ? 1 : 0)}万` : `¥${Math.round(c / 100)}`;
  return <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'各月支出：' + months.map(m => `${m.month.slice(5)}月 ${money(m.spent_cents)}`).join('，')}>
    {grid.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid"/><text x={L - 6} y={y(v) + 3} textAnchor="end">{label(v)}</text></g>)}
    {months.map((m, i) => { const v = Number(m.spent_cents), x = L + w * i; return <g key={m.month} className="trend-hit"><rect x={x} y={T} width={w} height={H - T - B} className="hit"/>
      {v > 0 && <rect x={x + w * 0.2} y={y(v)} width={w * 0.6} height={Math.max(H - B - y(v), 1)} rx={3} className="trend-bar"/>}
      <text x={x + w / 2} y={H - 6} textAnchor="middle">{Number(m.month.slice(5))}月</text>
      <title>{m.month}：支出 {money(m.spent_cents)}{m.refund_cents !== '0' ? `，退款 ${money(m.refund_cents)}` : ''}</title></g>; })}
    <line x1={L} x2={W} y1={H - B} y2={H - B} className="axis"/>
  </svg>;
}

const blank = (today: string): ExpenseFields => ({ title: '', date: today, amount_cents: '', category: 'travel', notes: '', refund_cents: null, refund_date: null, asset_id: null });

function ExpenseDialog({ expense, generation, today, onClose }: { expense: Expense | null; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<ExpenseFields>(expense?.fields ?? blank(today));
  const [assetName, setAssetName] = useState(expense?.asset_name ?? null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  const [search, setSearch] = useState(''), [found, setFound] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('expense-title')?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    if (!search.trim()) { setFound([]); return; }
    let live = true;
    invoke<Page>('list_assets', { query: { search: search.trim(), filter: 'all', category: { mode: 'all' }, sort: 'created', descending: true, offset: 0, warranty: 'all' } })
      .then(p => { if (live) setFound(p.items.slice(0, 8).map(r => ({ id: r.asset.id, name: r.asset.name }))); }).catch(() => { if (live) setFound([]); });
    return () => { live = false; };
  }, [search]);
  const set = <K extends keyof ExpenseFields>(k: K, v: ExpenseFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  async function save() {
    // Point at the field itself: the message sits below a long form.
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    if (!f.title.trim()) return stop('支出名称', '请填写名称。');
    if (!f.amount_cents || f.amount_cents === '0') return stop('支出金额', '请填写金额。');
    if (f.refund_date !== null && !f.refund_cents) return stop('退款金额', '请填写退款金额，或关闭退款。');
    const input: ExpenseSave = { request_id: crypto.randomUUID(), generation, id: expense?.id ?? null, expected_revision: expense?.revision ?? null, fields: { ...f, title: f.title.trim() } };
    setBusy(true); setNotice('');
    try { await submit({ command: 'expense_save', input, label: `支出 ${input.fields.title}` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="expense-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 重要支出</p><h2 id="expense-heading">{expense ? '编辑支出' : '记一笔支出'}</h2><p className="muted">记录没有对应物品的大额花费。买了物品请直接新增资产，购入会自动计入。</p></div><button type="button" aria-label="关闭支出表单" disabled={busy} onClick={() => onClose(false)}>×</button><div className="editor-header-actions">{expense && !stuck && <DeleteButton label="删除" disabled={busy} kind="expense" id={expense.id} revision={expense.revision} generation={generation} name={`支出 ${expense.fields.title}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存支出'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="名称"><input id="expense-title" aria-label="支出名称" maxLength={80} value={f.title} disabled={frozen} onChange={e => set('title', e.target.value)} placeholder="例如 日本旅行"/></FormRow>
      <FormRow label="日期"><DateInput id="expense-date" value={f.date} max={today} disabled={frozen} onChange={v => set('date', v)}/></FormRow>
      <FormRow label="金额"><CentInput label="支出金额" value={f.amount_cents} disabled={frozen} placeholder="0.00" onChange={v => set('amount_cents', v)}/></FormRow>
      <FormRow label="分类"><select aria-label="分类" value={f.category} disabled={frozen} onChange={e => set('category', e.target.value)}>{expenseCategories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormRow>
      <FormRow label="记录退款" hint="原期仍计全额，退款计入退款日期"><Switch label="记录退款" value={f.refund_date !== null} disabled={frozen} onChange={v => setF(x => ({ ...x, refund_cents: v ? x.refund_cents : null, refund_date: v ? today : null }))}/></FormRow>
      {f.refund_date !== null && <><FormRow label="退款金额"><CentInput label="退款金额" value={f.refund_cents ?? ''} disabled={frozen} placeholder="0.00" onChange={v => set('refund_cents', v || null)}/></FormRow>
        <FormRow label="退款日期"><DateInput id="expense-refund-date" value={f.refund_date} min={f.date} max={today} disabled={frozen} onChange={v => set('refund_date', v)}/></FormRow></>}
      <FormRow label="关联到物品" hint="关联后不再单独计入，避免与物品购入重复">
        {f.asset_id ? <span className="expense-link">{assetName ?? '已关联物品'}{expense?.asset_deleted && f.asset_id === expense.fields.asset_id ? '（已删除）' : ''}<button type="button" disabled={frozen} onClick={() => { set('asset_id', null); setAssetName(null); }}>解除关联</button></span>
          : <span className="expense-link-search"><input aria-label="搜索要关联的物品" value={search} disabled={frozen} onChange={e => setSearch(e.target.value)} placeholder="搜索物品名称"/>{found.length > 0 && <span className="expense-link-results">{found.map(a => <button type="button" key={a.id} disabled={frozen} onClick={() => { set('asset_id', a.id); setAssetName(a.name); setSearch(''); }}>{a.name}</button>)}</span>}</span>}
      </FormRow>
    </section>
    <section className="form-block form-notes"><label htmlFor="expense-notes">备注</label><textarea id="expense-notes" maxLength={10000} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
