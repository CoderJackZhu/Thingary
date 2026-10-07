import { SortHeader } from './SortHeader';
import { sortRecords, moneySortValue, type ListSort } from './list-sort';
import { HeaderSlot } from './HeaderSlot';
import { CloseButton } from './CloseButton';
import { useSource } from './useSource';
import type { SourceProps, SourceTarget } from './source';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import type { Page } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info, Switch } from './FormControls';
import { Icon } from './AssetViews';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import { categoryText, countsAsSpending, expenseCategories, expenseSourceTarget, sourceLabel, spendDisplay } from './expenses';
import type { AnnualTotal, Expense, ExpenseFields, ExpenseSave, ExpenseView, Line, Month } from './expenses';
import './wealth.css';
import { useRestored } from './undo';

export type ScrollRestore = { top: number; done: () => void } | null;

export function ExpensesPage({ today, onOpenAsset, onOpenSource, onEditingChange, source, onSourceDone, initialYear, search, onSearch, autoNew, onAutoNewDone, restoreScroll, generation, onYearRemember }: SourceProps & { initialYear?: number | null; onEditingChange: (value: boolean) => void; today: string; onOpenAsset: (id: string) => void; onOpenSource: (target: SourceTarget) => void; search: string; onSearch: (value: string) => void; autoNew?: boolean; onAutoNewDone?: () => void; restoreScroll?: ScrollRestore; generation?: string | null; onYearRemember?: (year: number | null) => void }) {
  const thisYear = Number(today.slice(0, 4));
  // 普通进入默认「全部」；总览指定年份与来源跳转传入明确期间（设计 §2.1）。
  const [year, setYear] = useState<number | null>(initialYear === undefined ? null : initialYear);
  const [view, setView] = useState<ExpenseView | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  // 从钻取的年份返回「全部」时，恢复那一根年度柱的焦点与图表滚动（§2.3）。
  const [drilledFrom, setDrilledFrom] = useState<number | null>(null);
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!pending || busy); return () => onEditingChange(false); }, [editing, pending, busy, onEditingChange]);
  useEffect(() => { onYearRemember?.(year); }, [year, onYearRemember]);
  // 请求序号守卫：切换年份／资料库后，旧期间的迟到响应与错误不再落地（§3.1）。
  const ticket = useRef(0);
  // restoreScroll 在挂载时还是 null（返回上下文在副作用里才就位），
  // 数据就绪后再读最新值消费一次。
  const restoreRef = useRef(restoreScroll);
  restoreRef.current = restoreScroll;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = ++ticket.current;
    setError(''); setLoaded(false);
    invoke<ExpenseView>('expense_view', { year }).then(v => {
      if (t !== ticket.current) return;
      setView(v); setLoaded(true);
      requestAnimationFrame(() => restoreRef.current?.done());
    }).catch(e => { if (t === ticket.current) setError(errorMessage(e)); });
    return () => { ++ticket.current; };
  }, [year, retry]);
  // 资料库切换后，旧 generation 的整页读取不再展示。
  useEffect(() => { if (view && generation && view.generation !== generation) reload(); }, [view, generation]);
  async function open(line: Line) {
    if (line.source === 'expense' || line.source === 'linked' || line.source === 'refund') {
      try { const e = await invoke<Expense | null>('expense', { id: line.id }); if (e) setEditing(e); else reload(); }
      catch (e) { setError(errorMessage(e)); }
    } else {
      const target = expenseSourceTarget(line);
      if (target?.kind === 'asset') onOpenAsset(target.id);
      else if (target) onOpenSource(target);
    }
  }
  const sourceError = useSource({source,onSourceDone}, view?.generation, async (target, alive) => {
    if (target.kind !== 'expense') return false;
    if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源支出。');
    const item = await invoke<Expense | null>('expense',{id:target.id});
    if (!alive()) return false;
    if (!item || item.asset_deleted) return false;
    // The list behind the editor shows the expense's own year, not the caller's.
    setYear(item.fields.date ? Number(item.fields.date.slice(0, 4)) : null);
    setEditing(item); return true;
  });
  useEffect(() => { if (sourceError) reload(); }, [sourceError]);
  const years = [...new Set([thisYear, ...(view?.years ?? [])])].sort((a, b) => b - a);
  const period = year === null ? '全部' : `${year} 年`;
  // The keyword filters the result list only; every KPI keeps the period's own
  // figures (search never turns into a subtotal; 3.5.2).
  const keyword = search.trim().toLowerCase();
  const lineMatches = (l: Line) => !keyword || [l.title, categoryText(l), l.notes ?? '', sourceLabel[l.source]].some(t => t.toLowerCase().includes(keyword));
  const shownLines = view?.lines.filter(lineMatches) ?? [];
  const shownUndated = view?.undated.filter(lineMatches) ?? [];
  const foundCount = shownLines.length + shownUndated.length;
  // 期间摘要的已知／未知口径：只数进入期间支出投影的带日期记录（§3.1）。
  const periodCount = view?.lines.filter(countsAsSpending).length ?? 0;
  const periodKnown = view?.lines.filter(l => countsAsSpending(l) && l.amount_cents !== null).length ?? 0;
  const spentDisplay = spendDisplay({ count: periodCount, known_count: periodKnown, unknown_count: periodCount - periodKnown, spent_cents: view?.spent_cents });
  const netUnknown = periodCount > periodKnown;
  const openNew = { label: '记一笔支出', plus: true, disabled: !!pending || !view, run: () => setEditing('new') };
  usePageBar('expenses', { primary: openNew, newRecord: openNew, search: { key: 'expenses', placeholder: '搜索支出' } });
  // The menu hand-off opens the same editor as this page's own buttons.
  const consumedAutoNew = useRef(false);
  useEffect(() => {
    if (!autoNew || consumedAutoNew.current) return;
    consumedAutoNew.current = true;
    onAutoNewDone?.();
    setEditing('new');
  }, [autoNew]);
  return <section className="stats-section wealth-section" aria-label="重要支出">
    {sourceError && <p role="alert" className="notice">{sourceError}</p>}
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <HeaderSlot><div className="wealth-toolbar">
      <div className="segmented" role="group" aria-label="支出期间"><button aria-pressed={year === null} onClick={() => { if (year !== null) setDrilledFrom(year); setYear(null); }}>全部</button>{years.map(y => <button key={y} aria-pressed={year === y} onClick={() => { if (year === null) setDrilledFrom(null); setYear(y); }}>{y}</button>)}</div>
      <Info text="仅已记录支出；退款按发生日期；售出回收单列；搜索只筛选明细。"/>
    </div></HeaderSlot>
    {error ? <article className="ui-card ui-content" role="alert"><p>重要支出读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !loaded || !view ? <p role="status" className="muted">正在读取重要支出…</p>
      : <>
        <div className="ui-metrics ui-card">
          <article><span>{period}支出</span><strong>{spentDisplay.value != null ? money(view.spent_cents) : <span className="muted">{spentDisplay.note}</span>}</strong>{spentDisplay.note && spentDisplay.value != null && <em>{spentDisplay.note}</em>}{year === thisYear && <em>截至今天已记录</em>}</article>
          <article><span>退款</span><strong>{money(view.refund_cents)}</strong></article>
          <article><span>净支出</span><strong>{netUnknown ? <><span className="muted">仅已知部分</span> {money(view.net_cents)}</> : money(view.net_cents)}</strong><em>支出 − 退款；可为负</em></article>
          <article><span>售出回收</span><strong>{money(view.sale_cents)}</strong></article>
        </div>
        {(view.undated.length > 0 || view.unknown_amount_count > 0) && <p className="muted small">{view.undated.length > 0 && `日期待补 ${view.undated.length} 条（已知 ${money(view.undated_cents)}），不归入任何期间。`}{view.unknown_amount_count > 0 && `${view.unknown_amount_count} 条购入或维护金额未知，未计入。`}</p>}
        {view.annual_totals.length > 0 && <article className="ui-card ui-content"><div className="ui-section-head"><h3>各年支出</h3><span>仅列有记录的年份 · 柱高为已知支出<Info text="点击年度柱或按 Enter 进入该年；悬浮或聚焦查看精确支出、退款、净支出、售出回收与金额待补笔数。所有年份都不保证记录完整。"/></span></div><YearBars totals={view.annual_totals} thisYear={thisYear} focusYear={year === null ? drilledFrom : null} onOpen={y => setYear(y)}/></article>}
        {view.months.length > 0 && <article className="ui-card ui-content"><div className="ui-section-head"><h3>各月支出</h3><span>{year} 年 · 不含日期待补{periodCount > periodKnown ? ` · 仅已知部分 · ${periodCount - periodKnown} 笔金额待补` : ''}</span></div><MonthBars months={view.months}/></article>}
        {!view.lines.length && !view.undated.length ? <div className="empty"><span className="empty-mark">¥</span><h2>{year === null ? '还没有重要支出' : `${year} 年没有记录`}</h2><p>物品的购入和维护会自动出现在这里；旅行、培训等没有对应物品的大额花费，可以单独记一笔。</p><button className="primary" disabled={!!pending} onClick={() => setEditing('new')}>记一笔支出</button></div>
          : keyword && !foundCount ? <div className="empty"><span className="empty-mark">¥</span><h2>当前条件下没有找到记录</h2><p>试试其他关键词。</p><button onClick={() => onSearch('')}>清除搜索</button></div>
          : <LineTable lines={shownLines} undated={shownUndated} found={keyword ? foundCount : null} onOpen={line => void open(line)}/>}
      </>}
    {editing && view && <ExpenseDialog expense={editing === 'new' ? null : editing} generation={view.generation} today={today} onClose={saved => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(null); setPending(storedPending()); if (saved) reload(); refocusHeading(); }}/>}
  </section>;
}

function LineTable({ lines, undated, found, onOpen }: { lines: Line[]; undated: Line[]; found: number | null; onOpen: (l: Line) => void }) {
  const [sort, setSort] = useState<ListSort>({ key: 'date', descending: true });
  const sorted = sortRecords([...lines, ...undated], sort, (l, key) => key === 'date' ? l.date : key === 'name' ? l.title : key === 'source' ? sourceLabel[l.source] : key === 'category' ? categoryText(l) : l.amount_cents === null ? null : moneySortValue(l.source === 'refund' || l.source === 'sale' ? '-' + l.amount_cents : l.amount_cents), l => l.source + l.id);
  const row = (l: Line) => <tr key={l.source + l.id} className={countsAsSpending(l) ? undefined : 'closed'}>
    <td>{l.date ?? <span className="muted">日期待补</span>}</td>
    <td>{expenseSourceTarget(l) ? <button className="link-cell" aria-label={`查看 ${l.title} 来源`} onClick={() => onOpen(l)}>{l.title}</button> : l.title}</td>
    <td><span className="ui-tag">{sourceLabel[l.source]}</span></td><td>{categoryText(l)}</td>
    <td className="amount">{l.amount_cents === null ? <span className="muted">金额未知</span> : money(l.source === 'refund' || l.source === 'sale' ? '-' + l.amount_cents : l.amount_cents)}</td>
  </tr>;
  return <>{found !== null && <p className="muted small" role="status">找到 {found} 条</p>}<table className="ui-table expense-lines"><thead><tr><SortHeader field="date" label="日期" sort={sort} onSort={setSort}/><SortHeader field="name" label="名称" sort={sort} onSort={setSort}/><SortHeader field="source" label="来源" sort={sort} onSort={setSort}/><SortHeader field="category" label="分类" sort={sort} onSort={setSort}/><SortHeader field="amount" label="金额" sort={sort} onSort={setSort}/></tr></thead>
    <tbody>{sorted.map(row)}</tbody></table></>;
}

/** 柱状图共用的纵轴刻度与金额标签。 */
function chartScale(max: number) {
  const step = 10 ** Math.floor(Math.log10(max)), unit = [1, 2, 5, 10].map(n => n * step).find(n => max / n <= 4) ?? step * 10;
  return { unit, top: Math.ceil(max / unit) * unit };
}
const axisLabel = (c: number) => c >= 1_000_000 ? `¥${(c / 1_000_000).toFixed(c % 1_000_000 ? 1 : 0)}万` : `¥${Math.round(c / 100)}`;

/** 年度柱（设计 §2.2/§2.3）：只有有记录的年份，键盘可进入，悬浮／聚焦显示精确金额。 */
function YearBars({ totals, thisYear, focusYear, onOpen }: { totals: AnnualTotal[]; thisYear: number; focusYear: number | null; onOpen: (y: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const refs = useRef(new Map<number, SVGRectElement>());
  useEffect(() => {
    if (focusYear == null) return;
    const el = refs.current.get(focusYear);
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }, [focusYear]);
  const L = 56, B = 22, T = 10, H = 150, barW = 52, gap = 22;
  const W = Math.max(640, L + totals.length * (barW + gap) + 16);
  const max = Math.max(1, ...totals.map(t => Number(t.spent_cents)));
  const { unit, top } = chartScale(max);
  const grid = Array.from({ length: top / unit + 1 }, (_, i) => i * unit);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const shown = focused ?? hover;
  const tip = totals.find(t => t.year === shown);
  const tipIndex = totals.findIndex(t => t.year === shown);
  const tipLeft = tipIndex >= 0 ? L + tipIndex * (barW + gap) + barW / 2 : 0;
  const barAria = (t: AnnualTotal) => {
    const spend = spendDisplay(t);
    return `${t.year} 年：${spend.value != null ? `支出 ${money(t.spent_cents)}` : spend.note}，退款 ${money(t.refund_cents)}，净支出 ${money(t.net_cents)}，售出回收 ${money(t.sale_cents)}${t.unknown_count ? `，${t.unknown_count} 笔金额待补` : ''}${t.year === thisYear ? '，截至今天已记录' : ''}。进入 ${t.year} 年`;
  };
  return <div className="expense-chart" style={{ position: 'relative' }}>
    <div className="expense-chart-scroll" style={{ overflowX: 'auto' }}>
      <svg className="trend-chart" style={{ minWidth: W }} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={'各年支出：' + totals.map(t => barAria(t)).join('；')}>
        {grid.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid"/><text x={L - 6} y={y(v) + 3} textAnchor="end">{axisLabel(v)}</text></g>)}
        {totals.map((t, i) => {
          const spend = spendDisplay(t);
          const v = Number(t.spent_cents), x = L + i * (barW + gap);
          const active = shown === t.year;
          return <g key={t.year} className="trend-hit">
            <rect x={x} y={T} width={barW} height={H - T - B} className="hit"/>
            <rect ref={el => { if (el) refs.current.set(t.year, el); else refs.current.delete(t.year); }} x={x + barW * 0.15} y={v ? y(v) : H - B - 3} width={barW * 0.7} height={v ? Math.max(H - B - y(v), 1) : 3} rx={3} className={v ? (active ? 'trend-bar focused' : 'trend-bar') : 'empty-bar'} tabIndex={0} role="button" aria-label={barAria(t)}
              onClick={() => onOpen(t.year)}
              onMouseEnter={() => setHover(t.year)} onMouseLeave={() => setHover(h => h === t.year ? null : h)}
              onFocus={() => setFocused(t.year)} onBlur={() => setFocused(f => f === t.year ? null : f)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.year); return; }
                const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
                if (e.key in moves) { e.preventDefault(); const next = totals[i + moves[e.key]]; if (next) refs.current.get(next.year)?.focus(); }
                else if (e.key === 'Home') { e.preventDefault(); refs.current.get(totals[0].year)?.focus(); }
                else if (e.key === 'End') { e.preventDefault(); refs.current.get(totals[totals.length - 1].year)?.focus(); }
                else if (e.key === 'Escape') { e.preventDefault(); setHover(null); setFocused(null); }
              }}/>
            {v > 0 && <text x={x + barW / 2} y={y(v) - 4} textAnchor="middle" pointerEvents="none">{Math.round(v / 100).toLocaleString('zh-CN')}</text>}
            {v === 0 && spend.note && <text x={x + barW / 2} y={H - B - 8} textAnchor="middle" className="muted" pointerEvents="none">{spend.note}</text>}
            <text x={x + barW / 2} y={H - 6} textAnchor="middle">{t.year}</text>
          </g>;
        })}
        <line x1={L} x2={W} y1={H - B} y2={H - B} className="axis"/>
      </svg>
    </div>
    {tip && <div className="ui-tip expense-tip" role="status" style={{ left: tipLeft }}>
      <strong>{tip.year} 年{tip.year === thisYear ? ' · 截至今天已记录' : ''}</strong>
      <span>支出 {tip.known_count ? money(tip.spent_cents) : spendDisplay(tip).note}</span>
      {tip.unknown_count > 0 && tip.known_count > 0 && <span className="muted">仅已知部分 · {tip.unknown_count} 笔金额待补</span>}
      <span>退款 {money(tip.refund_cents)}</span>
      <span>净支出 {money(tip.net_cents)}</span>
      <span>售出回收 {money(tip.sale_cents)}</span>
      <span className="muted">不保证记录完整；按 Enter 进入该年</span>
    </div>}
  </div>;
}

/** 月度柱（设计 §2.2）：固定 1–12 月；无记录月份零高度标「无记录」。 */
function MonthBars({ months }: { months: Month[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 640, H = 150, L = 56, B = 22, T = 10, max = Math.max(1, ...months.map(m => Number(m.spent_cents)));
  const { unit, top } = chartScale(max);
  const grid = Array.from({ length: top / unit + 1 }, (_, i) => i * unit), w = (W - L) / 12, y = (v: number) => T + (H - T - B) * (1 - v / top);
  return <div className="expense-chart" style={{ position: 'relative' }}>
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'各月支出：' + months.map(m => `${m.month.slice(5)}月 ${m.count === 0 ? '无记录' : Number(m.spent_cents) ? money(m.spent_cents) : `${m.known_count ? money(m.spent_cents) + '，' : ''}${m.unknown_count ? `${m.unknown_count} 笔金额待补` : '金额待补'}`}`).join('，')}>
      {grid.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid"/><text x={L - 6} y={y(v) + 3} textAnchor="end">{axisLabel(v)}</text></g>)}
      {months.map((m, i) => { const v = Number(m.spent_cents), x = L + w * i;
        return <g key={m.month} className="trend-hit"><rect x={x} y={T} width={w} height={H - T - B} className="hit" onMouseEnter={() => setHover(m.month)} onMouseLeave={() => setHover(h => h === m.month ? null : h)}/>
        <rect x={x + w * 0.2} y={v?y(v):H-B-3} width={w * 0.6} height={v?Math.max(H - B - y(v), 1):3} rx={3} className={v?"trend-bar":m.count ? "empty-bar" : "empty-bar faint"}/>
        {v>0&&<text x={x+w/2} y={y(v)-4} textAnchor="middle">{Math.round(v/100).toLocaleString("zh-CN")}</text>}
        {v===0&&m.count>0&&<text x={x+w/2} y={H-B-8} textAnchor="middle" className="muted" pointerEvents="none">{m.known_count ? '' : '金额待补'}</text>}
        {m.count===0&&<text x={x+w/2} y={H-B-8} textAnchor="middle" className="muted" pointerEvents="none">无记录</text>}
        <text x={x + w / 2} y={H - 6} textAnchor="middle">{Number(m.month.slice(5))}月</text>
        </g>; })}
      <line x1={L} x2={W} y1={H - B} y2={H - B} className="axis"/>
    </svg>
    {hover && (() => { const m = months.find(x => x.month === hover); if (!m) return null; const i = months.indexOf(m); const spend = spendDisplay(m);
      return <div className="ui-tip expense-tip" role="status" style={{ left: L + i * w + w / 2 }}>
        <strong>{m.month}</strong>
        <span>支出 {spend.value != null ? money(m.spent_cents) : spend.note}</span>
        {m.unknown_count > 0 && m.known_count > 0 && <span className="muted">仅已知部分 · {m.unknown_count} 笔金额待补</span>}
        {m.refund_cents !== '0' && <span>退款 {money(m.refund_cents)}</span>}
      </div>; })()}
  </div>;
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
    <header><div><p className="eyebrow">财富 · 重要支出</p><h2 id="expense-heading">{expense ? '编辑支出' : '记一笔支出'}</h2><p className="muted">记录没有对应物品的大额花费。买了物品请直接新增物品，购入会自动计入。</p></div><CloseButton type="button" aria-label="关闭支出表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{expense && !stuck && <DeleteButton label="删除" disabled={busy} kind="expense" id={expense.id} revision={expense.revision} generation={generation} name={`支出 ${expense.fields.title}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存支出'}</button>}</div></header>
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
