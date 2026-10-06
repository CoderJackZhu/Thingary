import { SortHeader } from './SortHeader';
import { sortRecords, moneySortValue, type ListSort } from './list-sort';
import { HeaderSlot } from './HeaderSlot';
import { changeLine } from './Sparkline';
import { CloseButton } from './CloseButton';
import { useSource } from './useSource';
import type { SourceProps } from './source';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info, Switch } from './FormControls';
import { Icon } from './AssetViews';
import { assetKinds, liabilityKinds, kindLabel, signedMoney, changeText, rateText, noteSummary, snapshotEntryInput, storedPending, resolvePending, submit, Unresolved, previewTotals } from './wealth';
import type { Account, AccountFields, AccountSave, Draft, EntryState, Pending, Point, Snapshot, SnapshotSave, Summary, TrashKind } from './wealth';
import { WealthChanges } from './WealthChanges';
import { offerUndo, useRestored } from './undo';
import './wealth.css';

type Tab = 'overview' | 'accounts' | 'changes' | 'history';

/** Shared by wealth and expense pages: one stored receipt, checked by request id. */
export function usePendingReceipt(reload: () => void) {
  const [pending, setPending] = useState<Pending | null>(storedPending), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  async function verify() {
    if (!pending) return;
    setBusy(true);
    try {
      const outcome = await resolvePending(pending);
      setPending(null); reload();
      setNotice(outcome === 'saved' ? `已确认「${pending.label}」保存成功。` : outcome === 'stale' ? '资料库已切换，上次请求不属于当前资料，已放弃。' : `「${pending.label}」没有保存，请重新录入。`);
    } catch (e) { setPending(storedPending()); setNotice(errorMessage(e) + ' 原请求已保留，请稍后再核对。'); }
    finally { setBusy(false); }
  }
  return { pending, setPending, notice, setNotice, busy, verify };
}
const series = (i: number) => `var(--series-${i % 7 + 1})`;

export function WealthPage({ today, onEditingChange, source, onSourceDone, search, onSearch, autoNew, onAutoNewDone }: SourceProps & { today: string; onEditingChange: (value: boolean) => void; search: string; onSearch: (value: string) => void; autoNew?: boolean; onAutoNewDone?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  // 概览链接带来的比较区间：只在点「变化」分段时清空，进入时消费一次（U20 §2.1）。
  const [changesSeed, setChangesSeed] = useState<{ from: string; to: string } | null>(null);
  // Typing a search on 概览/盘点记录 moves to the account list it filters (3.5.1).
  const lastSearch = useRef(search);
  useEffect(() => { if (search !== lastSearch.current && search.trim()) setTab('accounts'); lastSearch.current = search; }, [search]);
  const [summary, setSummary] = useState<Summary | null>(null), [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [sourceSnapshot, setSourceSnapshot] = useState<string | undefined>();
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkInPin, setCheckInPin] = useState<string | undefined>();
  const [snapshotDetail, setSnapshotDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  useEffect(() => {
    let live = true; setError('');
    Promise.all([invoke<Summary>('wealth_summary'), invoke<Account[]>('wealth_accounts')])
      .then(([s, a]) => { if (live) { setSummary(s); setAccounts(a); } })
      .catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!pending || busy || !!checkIn || !!snapshotDetail); return () => onEditingChange(false); }, [editing, pending, busy, checkIn, snapshotDetail, onEditingChange]);
  const sourceError = useSource({source,onSourceDone}, summary?.generation, async (target, alive) => {
    // 账户来源：按稳定 ID 打开账户资料表单；未保存的输入不写入（§6.2）。
    if (target.kind === 'account') {
      if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源账户。');
      const fresh = await invoke<Account[]>('wealth_accounts');
      if (!alive()) return false;
      const found = fresh.find(a => a.id === target.id);
      if (!found) return false;
      setAccounts(fresh);
      setEditing(found); return true;
    }
    if (target.kind !== 'snapshot') return false;
    if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源盘点。');
    // A same-generation correction must be visible: read points again instead
    // of trusting the previously rendered summary.
    const fresh = await invoke<Summary>('wealth_summary');
    if (!alive()) return false;
    if (fresh.generation !== summary?.generation) return false;
    setSummary(fresh);
    const point = fresh.points.find(p => p.snapshot_id === target.id);
    if (!point) return false;
    setSourceSnapshot(target.id); setSnapshotDetail(point.snapshot_id); return true;
  });
  useEffect(() => { if (sourceError) reload(); }, [sourceError]);
  // Hooks must run on every render: the check-in view is an early return below.
  const open = accounts?.filter(a => !a.fields.closed_on) ?? [];
  const newAccount = { label: '新增账户', plus: true, disabled: !!pending || !accounts, run: () => setEditing('new') };
  usePageBar('wealth', checkIn ? {} : open.length
    ? { primary: { label: '开始盘点', disabled: !!pending || !open.length, run: () => setCheckIn(today) }, secondary: newAccount, newRecord: newAccount, search: { key: 'wealth', placeholder: '搜索账户' } }
    : { primary: newAccount, newRecord: newAccount, search: { key: 'wealth', placeholder: '搜索账户' } });
  // The menu hand-off opens the same editor the page's own buttons use.
  const consumedAutoNew = useRef(false);
  useEffect(() => {
    if (!autoNew || consumedAutoNew.current) return;
    consumedAutoNew.current = true;
    onAutoNewDone?.();
    setEditing('new');
  }, [autoNew]);
  if (snapshotDetail) return <SnapshotDetail id={snapshotDetail} today={today} onCorrect={id => { const date = summary?.points.find(p => p.snapshot_id === id)?.date; setSnapshotDetail(null); if (date) { setCheckInPin(id); setCheckIn(date); } }} onClose={() => { setSnapshotDetail(null); reload(); refocusHeading(); }}/>;
  if (checkIn) return <CheckIn expectedId={checkInPin ?? sourceSnapshot} date={checkIn} today={today} onClose={saved => { setCheckIn(null); setCheckInPin(undefined); setSourceSnapshot(undefined); setPending(storedPending()); if (saved) { setTab('history'); reload(); } refocusHeading(); }}/>;
  const points = summary?.points ?? [], latest = points.at(-1), lastComplete = [...points].reverse().find(p => p.complete);
  const closeAccount = (saved: boolean) => {
    (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close();
    setEditing(null); setPending(storedPending());
    if (saved) reload();
    refocusHeading();
  };
  // Search filters the account list only: the check-in set is every effective
  // account and never depends on the keyword (3.5.1/3.5.2).
  const keyword = search.trim().toLowerCase();
  const shownAccounts = accounts?.filter(a => !keyword || [a.fields.name, kindLabel(a.fields.kind), a.fields.institution, a.fields.notes].some(t => t.toLowerCase().includes(keyword))) ?? [];
  return <section className="stats-section wealth-section" aria-label="财富">
    {sourceError && <p role="alert" className="notice">{sourceError}</p>}
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <HeaderSlot><div className="wealth-toolbar">
      <div className="segmented" role="group" aria-label="财富页面">{([['overview', '概览'], ['accounts', '账户'], ['changes', '变化'], ['history', '盘点记录']] as const).map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => { setChangesSeed(null); setTab(k); }}>{l}</button>)}</div>
    </div></HeaderSlot>
    {error ? <article className="ui-card ui-content" role="alert"><p>财富资料读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !summary || !accounts ? <p role="status" className="muted">正在读取财富资料…</p>
      : tab === 'overview' ? <Overview summary={summary} accounts={accounts} latest={latest} lastComplete={lastComplete} onNewAccount={() => setEditing('new')} onCheckIn={setCheckIn} today={today} onOpenChanges={seed => { setChangesSeed(seed); setTab('changes'); }}/>
      : tab === 'accounts' ? (keyword && !shownAccounts.length
        ? <div className="empty"><span className="empty-mark">¥</span><h2>当前条件下没有找到记录</h2><p>试试其他关键词。</p><button onClick={() => onSearch('')}>清除搜索</button></div>
        : <Accounts accounts={shownAccounts} onEdit={setEditing} onNew={() => setEditing('new')} found={keyword ? shownAccounts.length : null}/>)
      : tab === 'changes' ? <WealthChanges summary={summary} accounts={accounts} today={today} initial={changesSeed} onNewAccount={() => setEditing('new')} onCheckIn={setCheckIn}/>
      : <History points={points} onOpen={setSnapshotDetail} onNew={() => setCheckIn(today)} canStart={!!open.length && !pending}/>}
    {editing && summary && <AccountDialog account={editing === 'new' ? null : editing} generation={summary.generation} today={today} onClose={closeAccount}/>}
  </section>;
}

function Overview({ summary, accounts, latest, lastComplete, onNewAccount, onCheckIn, today, onOpenChanges }: { summary: Summary; accounts: Account[]; latest?: Point; lastComplete?: Point; onNewAccount: () => void; onCheckIn: (date: string) => void; today: string; onOpenChanges: (range: { from: string; to: string }) => void }) {
  if (!accounts.length) return <div className="empty"><span className="empty-mark">¥</span><h2>先建立要定期核对的账户</h2><p>银行卡、证券、基金、公积金，以及信用卡和贷款。只需名称和类型，不需要卡号或登录信息。</p><button className="primary" onClick={onNewAccount}>新增账户</button></div>;
  if (!latest) return <div className="empty"><span className="empty-mark">¥</span><h2>开始第一次盘点</h2><p>对照各平台，把今天的余额和欠款逐行填进来。之后每次盘点都会成为趋势上的一个点。</p><button className="primary" onClick={() => onCheckIn(today)}>开始盘点</button></div>;
  const shown = lastComplete ?? latest;
  const comparedPoint = lastComplete?.compared_to ? summary.points.find(p => p.date === lastComplete.compared_to) : undefined;
  return <>
    {!latest.complete && <div className="notice">{latest.date} 的盘点还有 {latest.missing} 个账户没有金额，未计入完整净资产和变化比较。<button onClick={() => onCheckIn(latest.date)}>补录</button></div>}
    <div className="ui-metrics ui-card">
      <article><span>金融净资产</span><strong>{lastComplete ? signedMoney(lastComplete.net_cents) : '—'}</strong><em>{lastComplete ? `截至 ${lastComplete.date} 完整盘点 · 距今 ${Math.max(0, Math.round((Date.parse(today) - Date.parse(lastComplete.date)) / 86400000))} 天` : '—／尚无完整盘点'}</em></article>
      <article><span>金融资产</span><strong>{money(shown.assets_cents)}</strong><em>{shown.complete ? '计入范围内' : '仅已知部分'}</em></article>
      <article><span>负债</span><strong>{money(shown.liabilities_cents)}</strong><em>{shown.complete ? '计入范围内的尚欠金额' : '计入范围内，仅已知部分'}</em></article>
      <article><span>与上次比较</span><strong>{lastComplete?.change_cents ? changeText(lastComplete.change_cents) : '—'}</strong><em>{!lastComplete?.compared_to ? '至少两次完整盘点后显示' : lastComplete.scope_changed ? '有账户改变了计入设置，不直接比较' : `对比 ${lastComplete.compared_to}${lastComplete.change_rate_hundredths !== null ? ' · ' + rateText(lastComplete.change_rate_hundredths) : ''}`}</em>{comparedPoint && lastComplete && <button className="link-cell changes-link" onClick={() => onOpenChanges({ from: comparedPoint.snapshot_id, to: lastComplete.snapshot_id })}>看哪些账户带来变化 →</button>}</article>
    </div>
    <article className="ui-card ui-content">
      <div className="ui-section-head"><h3>净资产变化</h3><Info text="只连接完整盘点；虚线为不完整盘点。变化含存取、消费与估值，不等于投资收益。"/></div>
      {summary.points.filter(p => p.complete).length < 2 ? <p className="muted">完整盘点少于两次，暂不显示趋势。</p> : <NetChart points={summary.points}/>}
      <details className="trend-table"><summary>查看表格</summary><PointTable points={summary.points}/></details>
    </article>
    <div className="stats-pair">
      <article className="ui-card ui-content"><div className="ui-section-head"><h3>资产结构</h3><span>{summary.structure_date ? `${summary.structure_date} 完整盘点 · 计入范围` : '尚无完整盘点'}</span></div><ShareBars rows={summary.structure} empty="没有计入的资产。"/></article>
      <article className="ui-card ui-content"><div className="ui-section-head"><h3>计入范围内负债</h3><Info text="按类型统计尚欠金额，不含标为不计入的负债。"/></div><ShareBars rows={summary.liabilities} empty="没有计入的负债。"/></article>
    </div>
    <article className="ui-card"><div className="ui-section-head"><h3>账户清单</h3></div><ul className="ui-rows">{accounts.map((a,i)=><li key={a.id} className="ui-row"><span className="ui-avatar" style={{background:series(i)}}>{a.fields.name.slice(0,1)}</span><div className="ui-main"><div>{a.fields.name}</div><small>{kindLabel(a.fields.kind)}{!a.fields.counted?' · 不计入净资产':''}{a.fields.closed_on?' · 已停用':''}</small></div><span className="ui-amount" style={a.fields.side==='liability'?{color:'var(--error)'}:undefined}>{a.latest?(a.fields.side==='liability'&&a.latest.amount_cents!=='0'?'−':'')+money(a.latest.amount_cents):'尚未盘点'}</span></li>)}</ul></article>
  </>;
}

function ShareBars({ rows, empty }: { rows: Summary['structure']; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <ul className="stats-category-bars">{rows.map((r, i) => <li key={r.kind}><span><i style={{ background: series(i) }}/>{kindLabel(r.kind)}</span><div className="stats-bar"><span style={{ width: r.share_hundredths === null ? 0 : `${r.share_hundredths / 100}%`, background: series(i) }}/></div><strong>{r.share_hundredths === null ? '—' : `${(r.share_hundredths / 100).toFixed(1)}%`}</strong><small>{money(r.amount_cents)}</small></li>)}</ul>;
}

function PointTable({ points, onOpen }: { points: Point[]; onOpen?: (id: string) => void }) {
  const [sort, setSort] = useState<ListSort>({ key: 'date', descending: true });
  const sorted = sortRecords(points, sort, (p, key) => key === 'date' ? p.date : key === 'net' ? p.complete ? moneySortValue(p.net_cents) : null : key === 'assets' ? moneySortValue(p.assets_cents) : moneySortValue(p.liabilities_cents), p => p.snapshot_id);
  return <table className="ui-table"><thead><tr><SortHeader field="date" label="盘点日期" sort={sort} onSort={setSort}/><SortHeader field="net" label="金融净资产" sort={sort} onSort={setSort}/><SortHeader field="assets" label="资产" sort={sort} onSort={setSort}/><SortHeader field="liabilities" label="负债" sort={sort} onSort={setSort}/><th>状态</th><th>备注</th><th>与上次比较</th></tr></thead><tbody>{sorted.map(p => <tr key={p.snapshot_id}>
    <td>{onOpen ? <button className="link-cell" onClick={() => onOpen(p.snapshot_id)}>{p.date}</button> : p.date}</td>
    <td>{p.complete ? signedMoney(p.net_cents) : <span className="muted" title="有账户金额未知，净资产无法确定">—</span>}</td><td>{money(p.assets_cents)}{!p.complete && <small className="muted"> 已知</small>}</td><td>{money(p.liabilities_cents)}{!p.complete && <small className="muted"> 已知</small>}</td>
    <td>{p.complete ? '完整' : `缺 ${p.missing} 个账户`}</td>
    <td>{onOpen ? (noteSummary(p.notes) ? <button className="link-cell" title="查看完整备注" onClick={() => onOpen(p.snapshot_id)}>{noteSummary(p.notes)}</button> : <span className="muted">—</span>) : noteSummary(p.notes) ?? ''}</td>
    <td>{p.change_cents ? `${changeText(p.change_cents)}${p.change_rate_hundredths !== null ? ' · ' + rateText(p.change_rate_hundredths) : ''}` : p.scope_changed ? '计入范围有变化' : '—'}{p.compared_to && <small className="muted"> 对比 {p.compared_to}</small>}</td>
  </tr>)}</tbody></table>;
}

const W = 640, H = 170, L = 64, B = 22, T = 12;
const axis = (cents: number) => { const v = Math.abs(cents); const t = v >= 1_000_000 ? `¥${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}万` : `¥${Math.round(v / 100)}`; return cents < 0 ? '−' + t : t; };
/**
 * Complete check-ins form the line on an axis fitted to them (not pinned to
 * zero, which would flatten real changes). An incomplete check-in has no
 * trustworthy total, so it is a dashed marker on its date, never a value.
 */
export function NetChart({ points, label }: { points: Point[]; label?: string }) {
  const [current,setCurrent]=useState<number|null>(null);
  const svgRef=useRef<SVGSVGElement>(null), [plotWidth,setPlotWidth]=useState(0);
  useEffect(()=>{const svg=svgRef.current;if(!svg)return;const observer=new ResizeObserver(()=>setPlotWidth(svg.getBoundingClientRect().width));observer.observe(svg);return()=>observer.disconnect()},[]);
  const full = points.filter(p => p.complete), values = full.map(p => Number(p.net_cents));
  const min = Math.min(...values), max = Math.max(...values), pad = (max - min) * 0.15 || Math.max(Math.abs(max) * 0.05, 10_000);
  const span = max - min + 2 * pad, step = 10 ** Math.floor(Math.log10(span)), unit = [1, 2, 5, 10].map(n => n * step).find(n => span / n <= 4) ?? step * 10;
  const bottom = Math.floor((min - pad) / unit) * unit, top = Math.ceil((max + pad) / unit) * unit;
  const grid = Array.from({ length: Math.round((top - bottom) / unit) + 1 }, (_, i) => bottom + i * unit);
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points.at(-1)!.date), wide = t1 - t0 || 1;
  const x = (d: string) => L + 12 + (W - L - 36) * (Date.parse(d) - t0) / wide, y = (v: number) => T + (H - T - B) * (1 - (v - bottom) / (top - bottom));
  const every = Math.ceil(points.length / 6);
  const shown = current===null?null:full[current];
  // The SVG uses xMidYMid meet; account for its horizontal letterbox.
  const plotScale=Math.min(plotWidth/W,170/H), plotLeft=(plotWidth-W*plotScale)/2, plotTop=(170-H*plotScale)/2;
  return <><div className="net-chart" tabIndex={0} role="img" aria-label={label ?? `金融净资产趋势，共 ${full.length} 次完整盘点`} onFocus={()=>setCurrent(full.length-1)} onBlur={()=>setCurrent(null)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setCurrent(null)}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setCurrent(n=>Math.max(0,Math.min(full.length-1,(n??full.length-1)+(e.key==='ArrowLeft'?-1:1))))}}}><svg ref={svgRef} className="trend-chart" onMouseMove={e=>{const svg=e.currentTarget,matrix=svg.getScreenCTM();if(!matrix)return;const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const vx=point.matrixTransform(matrix.inverse()).x;let best=0;full.forEach((p,i)=>{if(Math.abs(x(p.date)-vx)<Math.abs(x(full[best].date)-vx))best=i});setCurrent(best)}} onMouseLeave={()=>setCurrent(null)} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'净资产变化：' + points.map(p => p.complete ? `${p.date} ${signedMoney(p.net_cents)}` : `${p.date} 盘点不完整`).join('，')}>
    {grid.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis' : 'grid'}/><text x={L - 6} y={y(v) + 3} textAnchor="end">{axis(v)}</text></g>)}
    {points.map((p, i) => i % every === 0 && <text key={p.date} x={x(p.date)} y={H - 6} textAnchor="middle">{p.date.slice(0, 7)}</text>)}
    {points.filter(p => !p.complete).map(p => <line key={p.snapshot_id} x1={x(p.date)} x2={x(p.date)} y1={T} y2={H - B} className="partial-mark"><title>{p.date}：缺 {p.missing} 个账户，总额未知，不画在曲线上</title></line>)}
    {full.length > 1 && <polyline points={full.map(p => `${x(p.date)},${y(Number(p.net_cents))}`).join(' ')} className="trend-line"/>}
    {shown&&<line x1={x(shown.date)} x2={x(shown.date)} y1={T} y2={H-B} className="partial-mark"/>}
    {full.map((p,i) => <circle key={p.snapshot_id} cx={x(p.date)} cy={y(Number(p.net_cents))} r={i===current?5:3} className="trend-dot"/>)}
  </svg>{shown&&<div className="ui-tip" style={{left:`clamp(100px, ${plotLeft+x(shown.date)*plotScale}px, calc(100% - 100px))`,top:`${plotTop+y(Number(shown.net_cents))*plotScale}px`}}>{shown.date}<b>{signedMoney(shown.net_cents)}</b><span>{changeLine(shown)}</span>{noteSummary(shown.notes)&&<span>备注：{noteSummary(shown.notes)}</span>}</div>}</div><span className="visually-hidden" aria-live="polite" aria-atomic="true">{shown?`${shown.date}，${signedMoney(shown.net_cents)}，${changeLine(shown)}`:''}</span></>;
}

function Accounts({ accounts, onEdit, onNew, found }: { accounts: Account[]; onEdit: (a: Account) => void; onNew: () => void; found: number | null }) {
  const [sort, setSort] = useState<ListSort>({ key: 'name', descending: false });
  const sorted = sortRecords(accounts, sort, (a, key) => key === 'name' ? a.fields.name : key === 'kind' ? (a.fields.side === 'liability' ? '负债 · ' : '') + kindLabel(a.fields.kind) : key === 'counted' ? Number(a.fields.counted) : moneySortValue(a.latest?.amount_cents), a => a.id);
  if (!accounts.length) return <div className="empty"><h2>还没有账户</h2><p>先添加一个需要定期核对的账户或负债。</p><button className="primary" onClick={onNew}>新增账户</button></div>;
  return <>{found !== null && <p className="muted small" role="status">找到 {found} 条</p>}<table className="ui-table wealth-accounts"><thead><tr><SortHeader field="name" label="账户" sort={sort} onSort={setSort}/><SortHeader field="kind" label="类型" sort={sort} onSort={setSort}/><SortHeader field="counted" label="计入净资产" sort={sort} onSort={setSort}/><SortHeader field="amount" label="最近金额" sort={sort} onSort={setSort}/><th>状态</th></tr></thead><tbody>{sorted.map(a => <tr key={a.id} className={a.fields.closed_on ? 'closed' : undefined}>
    <td><button className="link-cell" onClick={() => onEdit(a)}>{a.fields.name}</button>{a.fields.institution && <small className="muted"> · {a.fields.institution}</small>}</td>
    <td>{a.fields.side === 'liability' ? '负债 · ' : ''}{kindLabel(a.fields.kind)}</td>
    <td>{a.fields.counted ? '计入' : '不计入'}</td>
    <td>{a.latest ? <>{money(a.latest.amount_cents)}<small className="muted"> · {a.latest.date}</small></> : <span className="muted">尚未盘点</span>}</td>
    <td>{a.fields.closed_on ? `${a.fields.closed_on} 停用` : `${a.fields.opened_on} 起`}</td>
  </tr>)}</tbody></table></>;
}

function History({ points, onOpen, onNew, canStart }: { points: Point[]; onOpen: (id: string) => void; onNew: () => void; canStart: boolean }) {
  if (!points.length) return <div className="empty"><h2>还没有盘点</h2><p>每次盘点记录一个日期上各账户的余额与欠款。</p><button className="primary" disabled={!canStart} onClick={onNew}>开始盘点</button></div>;
  return <div className="table-scroll"><PointTable points={points} onOpen={onOpen}/></div>;
}

const blankAccount = (today: string): AccountFields => ({ name: '', institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: today, closed_on: null, notes: '' });

function AccountDialog({ account, generation, today, onClose }: { account: Account | null; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<AccountFields>(account?.fields ?? blankAccount(today));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('wealth-account-name')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof AccountFields>(k: K, v: AccountFields[K]) => setFields(f => ({ ...f, [k]: v }));
  async function save() {
    if (!fields.name.trim()) { setNotice('请填写账户名称。'); document.getElementById('wealth-account-name')?.focus(); return; }
    const input: AccountSave = { request_id: crypto.randomUUID(), generation, id: account?.id ?? null, expected_revision: account?.revision ?? null, fields: { ...fields, name: fields.name.trim(), institution: fields.institution.trim() } };
    setBusy(true); setNotice('');
    try { await submit({ command: 'wealth_account_save', input, label: `账户 ${input.fields.name}` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="wealth-account-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 账户</p><h2 id="wealth-account-heading">{account ? '编辑账户' : '新增账户'}</h2><p className="muted">只记名称与类型，不需要卡号、密码或登录信息。{account?.latest ? '已有盘点记录的账户不能删除，可填写停用日期。' : ''}</p></div><CloseButton type="button" aria-label="关闭账户表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{account && !account.latest && !stuck && <DeleteButton label="删除误建账户" disabled={busy} kind="account" id={account.id} revision={account.revision} generation={generation} name={`账户 ${account.fields.name}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存账户'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="名称"><input id="wealth-account-name" aria-label="账户名称" maxLength={80} value={fields.name} disabled={busy || stuck} onChange={e => set('name', e.target.value)} placeholder="例如 招行储蓄卡"/></FormRow>
      <FormRow label="平台" hint="只用于分组"><input aria-label="平台" maxLength={80} value={fields.institution} disabled={busy || stuck} onChange={e => set('institution', e.target.value)} placeholder="可留空"/></FormRow>
      <FormRow label="类型" hint={account ? '资产或负债建立后不能更改' : '选了类型就知道是资产还是负债：信用卡、贷款等是负债，盘点时填欠款金额'}><select aria-label="类型" value={fields.kind} disabled={busy || stuck} onChange={e => { const kind = e.target.value; setFields(f => ({ ...f, kind, side: liabilityKinds.some(([k]) => k === kind) ? 'liability' : 'asset' })); }}>
        {(!account || fields.side === 'asset') && <optgroup label="资产">{assetKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>}
        {(!account || fields.side === 'liability') && <optgroup label="负债">{liabilityKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>}
      </select></FormRow>
      <FormRow label="计入金融净资产" hint={fields.side === 'liability' ? '房贷、车贷等可关闭' : undefined}><Switch label="计入金融净资产" value={fields.counted} disabled={busy || stuck} onChange={v => set('counted', v)}/></FormRow>
      <FormRow label="启用日期" hint="此日之前的盘点不要求填写"><DateInput id="wealth-account-opened" value={fields.opened_on} max={today} disabled={busy || stuck} onChange={v => set('opened_on', v)}/></FormRow>
      {account && <FormRow label="停用日期" hint="停用前最后一次盘点须为 0"><DateInput id="wealth-account-closed" value={fields.closed_on ?? ''} max={today} allowClear disabled={busy || stuck} onChange={v => set('closed_on', v || null)}/></FormRow>}
    </section>
    <section className="form-block form-notes"><label htmlFor="wealth-account-notes">备注</label><textarea id="wealth-account-notes" maxLength={10000} value={fields.notes} disabled={busy || stuck} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}

/** Two-step soft delete into 最近删除; the second click confirms. */
export function DeleteButton({ label, disabled, kind, id, revision, generation, name, onDone, onError, onBusyChange }: { onBusyChange?: (busy: boolean) => void; label: string; disabled: boolean; kind: TrashKind; id: string; revision: number; generation: string; name: string; onDone: () => void; onError: (message: string, stuck: boolean) => void }) {
  const [armed, setArmed] = useState(false), [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true); onBusyChange?.(true);
    try {
      await submit({ command: 'wealth_trash', input: { request_id: crypto.randomUUID(), generation, kind, id, expected_revision: revision, deleted: true }, label: '删除' + name });
      onDone();
      // A delete bumps the revision once; the undo restores exactly that state.
      offerUndo(`已删除「${name}」，已移入最近删除。`, () => submit<void>({ command: 'wealth_trash', input: { request_id: crypto.randomUUID(), generation, kind, id, expected_revision: revision + 1, deleted: false }, label: '恢复' + name }));
    }
    catch (e) { onError(e instanceof Error ? e.message : errorMessage(e), e instanceof Unresolved); setArmed(false); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return armed ? <button type="button" className="primary danger" disabled={disabled || busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认移入最近删除'}</button>
    : <button type="button" disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
}

type Row = { state: EntryState | null; cents: string; edited?: boolean };
/** 只读盘点详情（§5.2）：按稳定 snapshot ID 读取，浏览不写任何资料。 */
function SnapshotDetail({ id, today, onCorrect, onClose }: { id: string; today: string; onClose: () => void; onCorrect: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  useEffect(() => {
    let live = true; setError(''); setSnapshot(null);
    Promise.all([invoke<Snapshot | null>('wealth_snapshot', { id }), invoke<Account[]>('wealth_accounts')])
      .then(([s, a]) => { if (live) { setAccounts(a); setSnapshot(s); } })
      .catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [id]);
  usePageBar('wealth', {});
  if (error) return <section className="stats-section wealth-section check-in" aria-labelledby="snapshot-detail-heading"><header className="check-in-header"><button className="back" onClick={onClose}><Icon name="back"/> 返回财富</button><div><h2 id="snapshot-detail-heading">盘点详情</h2></div></header><div role="alert"><p>盘点读取失败：{error}</p><button onClick={() => onClose()}>返回</button></div></section>;
  if (!snapshot || !accounts) return <section className="stats-section wealth-section check-in" aria-labelledby="snapshot-detail-heading"><header className="check-in-header"><button className="back" onClick={onClose}><Icon name="back"/> 返回财富</button><div><h2 id="snapshot-detail-heading">盘点详情</h2></div></header><p role="status" className="muted">正在读取盘点…</p></section>;
  const stateText = (state: string, amount: string | null) => amount === null ? '未知' : state === 'unchanged' ? '未变' : '录入';
  return <section className="stats-section wealth-section check-in" aria-labelledby="snapshot-detail-heading">
    <header className="check-in-header"><button className="back" disabled={busy} onClick={onClose}><Icon name="back"/> 返回财富</button><div><h2 id="snapshot-detail-heading">盘点详情</h2><p className="muted">只读查看，不改动任何资料。</p></div><div className="field check-in-date"><label>盘点日期</label><output>{snapshot.date}</output></div></header>
    <table className="ui-table check-in-table"><thead><tr><th>账户</th><th>记录金额</th><th>状态</th><th>计入</th></tr></thead><tbody>{snapshot.entries.map(e => { const a = accounts.find(x => x.id === e.account_id); return <tr key={e.account_id}><td><strong>{a?.fields.name ?? e.account_id}</strong><small className="muted">{e.side === 'liability' ? '负债' : kindLabel(e.kind)}</small></td><td>{e.amount_cents === null ? <span className="muted">未知</span> : money(e.amount_cents)}</td><td>{stateText(e.state, e.amount_cents)}</td><td>{e.counted ? '计入' : '不计入'}</td></tr>; })}</tbody></table>
    <footer className="check-in-footer"><div><span>完整性</span><strong>{snapshot.missing.length === 0 ? '完整' : `缺 ${snapshot.missing.length} 个账户`}</strong></div>
      <div className="check-in-submit"><button className="primary" disabled={busy} onClick={() => onCorrect(snapshot.id)}>更正这次盘点</button></div></footer>
    <section className="form-block form-notes snapshot-notes"><h3>备注</h3>{snapshot.notes.trim() ? <p className="notes" style={{whiteSpace:'pre-wrap'}}>{snapshot.notes}</p> : <p className="muted">未填写备注</p>}</section>
  </section>;
}
function CheckIn({ date: initial, today, onClose, expectedId }: { expectedId?: string; date: string; today: string; onClose: (saved: boolean) => void }) {
  const [date, setDate] = useState(initial);
  // The source's stable-ID guard holds only while its own date is being viewed:
  // once the user deliberately switches dates, this is a normal check-in again.
  const [pin, setPin] = useState(expectedId);
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState('');
  const [notes, setNotes] = useState(''), [notesDirty, setNotesDirty] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const fromSaved = useRef(false);
  useEffect(() => {
    let live = true; setError(''); setDraft(null);
    invoke<Draft>('wealth_snapshot_draft', { date }).then(d => {
      if (!live) return;
      // A deleted source snapshot must not reopen as the same-day replacement
      // or as a brand-new check-in; the user returns and re-reads instead.
      if (pin && d.existing?.id !== pin) { setError('这条盘点已删除或变化，请返回后重新读取。'); return; }
      setDraft(d);
      // Notes belong to the snapshot of the viewed date; a new date starts empty.
      setNotes(d.existing?.notes ?? '');
      setNotesDirty(false);
      // Only values typed for a new check-in follow a date change. Amounts loaded
      // from a saved check-in never carry to another date unreviewed (17.4 #2).
      setRows(old => {
        const carry = fromSaved.current ? {} : old;
        fromSaved.current = !!d.existing;
        return Object.fromEntries(d.rows.map(r => {
          const saved = d.existing?.entries.find(e => e.account_id === r.account.id);
          return [r.account.id, saved ? { state: saved.state, cents: saved.amount_cents ?? '' } : carry[r.account.id] ?? { state: null, cents: '' }];
        }));
      });
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [date, pin]);
  const set = (id: string, row: Row) => {
    setRows(r => ({ ...r, [id]: { ...row, edited: true } }));
    setNotice('');
  };
  const open = draft?.rows ?? [], existing = draft?.existing ?? null;
  const unfilled = open.filter(r => !rows[r.account.id]?.state || rows[r.account.id].state === 'missing' || rows[r.account.id].cents === '');
  const totals = previewTotals(open.map(r => ({ side: r.account.fields.side, counted: existing?.entries.find(e => e.account_id === r.account.id)?.counted ?? r.account.fields.counted, cents: rows[r.account.id]?.state && rows[r.account.id].state !== 'missing' && rows[r.account.id].cents !== '' ? rows[r.account.id].cents : null })));
  const before = existing ? previewTotals(existing.entries.map(e => ({ side: e.side, counted: e.counted, cents: e.amount_cents }))) : null;
  function focusNext(from: HTMLElement) {
    const inputs = [...(table.current?.querySelectorAll<HTMLInputElement>('[data-amount-wrap] input') ?? [])];
    inputs[inputs.indexOf(from as HTMLInputElement) + 1]?.focus();
  }
  async function save() {
    if (!draft) return;
    if (unfilled.length) { setNotice(`还有 ${unfilled.length} 个账户未填写：填写本次金额，零余额请填 0。`); return; }
    if ([...notes].length > 10000 || notes.includes('\0')) { setNotice('备注最多 10000 字，且不能含空字符。'); return; }
    const input: SnapshotSave = { request_id: crypto.randomUUID(), generation: draft.generation, id: existing?.id ?? null, expected_revision: existing?.revision ?? null, date, notes, entries: open.map(r => snapshotEntryInput(r.account.id, rows[r.account.id])) };
    setBusy(true); setNotice('');
    try { await submit<Snapshot>({ command: 'wealth_snapshot_save', input, label: `${date} 盘点` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  const frozen = busy || stuck;
  return <section className="stats-section wealth-section check-in" aria-labelledby="check-in-heading">
    <header className="check-in-header">
      <button className="back" disabled={busy} onClick={() => onClose(false)}><Icon name="back"/> 返回财富</button>
      <div><h2 id="check-in-heading">{existing ? '更正盘点' : '盘点'}</h2><p className="muted">对照各平台填写每个账户的当前金额，零余额填 0，差额自动计算。回车跳到下一行；填齐后保存，关闭即放弃未保存的输入。</p></div>
      <div className="field check-in-date"><label htmlFor="check-in-date">盘点日期</label>{switchTo ? <div className="check-in-date-switch" role="alert"><p>切换日期将丢弃当前备注修改。</p><button type="button" onClick={() => setSwitchTo(null)}>取消</button><button type="button" className="primary" onClick={() => { const target = switchTo; setSwitchTo(null); setNotesDirty(false); setPin(undefined); if (target) setDate(target); }}>确认切换</button></div> : null}<DateInput id="check-in-date" value={date} max={today} disabled={frozen || !!switchTo} onChange={v => { if (!v) return; if (notesDirty) { setSwitchTo(v); return; } setPin(undefined); setDate(v); }}/></div>
    </header>
    {existing && draft && <div className="notice">这一天已有盘点，保存会更正原记录，并影响它与前后两次盘点的比较。<DeleteButton label="删除这次盘点" disabled={frozen} kind="snapshot" id={existing.id} revision={existing.revision} generation={draft.generation} name={`${date} 盘点`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/></div>}
    {error ? <div role="alert"><p>盘点读取失败：{error}</p></div> : !draft ? <p role="status" className="muted">正在准备盘点…</p> : !open.length ? <p className="muted">这一天没有需要盘点的账户（账户启用日期都晚于此日或已停用）。</p> : <>
      <table ref={table} className="ui-table check-in-table"><thead><tr><th>账户</th><th>上次金额</th><th>本次金额</th><th>差额</th></tr></thead><tbody>{open.map(({ account: a, previous }) => {
        const row = rows[a.id] ?? { state: null, cents: '' };
        const diff = row.state && row.state !== 'missing' && row.cents !== '' && previous ? (BigInt(row.cents) - BigInt(previous.amount_cents)).toString() : null;
        return <tr key={a.id} data-state={row.state ?? 'empty'}>
          <td><strong>{a.fields.name}</strong><small className="muted">{a.fields.side === 'liability' ? '负债 · 尚欠' : kindLabel(a.fields.kind)}{a.fields.counted ? '' : ' · 不计入'}</small></td>
          <td>{previous ? <>{money(previous.amount_cents)}<small className="muted">{previous.date}</small></> : <span className="muted">无</span>}</td>
          <td onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); focusNext(e.target); } }}>
            <span data-amount-wrap><CentInput label={`${a.fields.name} 本次金额`} value={row.cents} disabled={frozen} placeholder="0.00" onChange={v => set(a.id, { state: v === '' ? null : 'entered', cents: v })}/></span>
          </td>
          <td>{diff === null ? <span className="muted">—</span> : diff === '0' ? '持平' : changeText(diff)}</td>
        </tr>; })}</tbody></table>
      <section className="form-block form-notes check-in-notes"><label htmlFor="check-in-notes">本次盘点备注（可选）</label><textarea id="check-in-notes" rows={3} maxLength={10000} placeholder="记录这次盘点的背景，例如大额购买、账户调整；备注不参与金额计算" value={notes} disabled={frozen} onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}/></section>
      <footer className="check-in-footer">
        <div><span>金融资产</span><strong>{money(totals.assets)}</strong></div><div><span>负债</span><strong>{money(totals.liabilities)}</strong></div>
        <div><span>金融净资产{totals.missing || unfilled.length ? '（待填写）' : ''}</span><strong>{signedMoney(totals.net)}</strong>{before && <small className="muted">原记录 {signedMoney(before.net)}</small>}</div>
        <div className="check-in-submit">{unfilled.length > 0 && <span className="muted">还有 {unfilled.length} 个账户未填写</span>}{stuck ? <button type="button" onClick={() => onClose(false)}>返回，稍后核对</button> : <button className="primary" disabled={frozen} onClick={() => void save()}>{busy ? '保存中…' : existing ? '保存更正' : '保存盘点'}</button>}</div>
      </footer>
    </>}
    {notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
