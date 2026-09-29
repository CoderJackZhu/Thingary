import type { ComponentProps } from 'react';
import { Icon } from './AssetViews';
import { Info } from './FormControls';
import { allModules, hiddenKinds, type Modules } from './modules';
import type { SourceTarget, TimelineSelection } from './source';
import { signedMoney } from './wealth';
import { recurringCategories } from './recurring';
import { virtualKindText } from './virtual.ts';
import { expenseCategories } from './expenses';
import { usePageBar } from './topbar';
import type { BarMenu } from './topbar';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { warrantyKinds } from './warranty';

export type TimelineFilter = 'all' | 'purchase' | 'maintenance' | 'warranty' | 'lifecycle' | 'wishlist' | 'expense' | 'snapshot';
export type TimelineEvent = { id: string; kind: string; date: string | null; asset_id: string | null; wishlist_id: string | null; title: string; note: string; amount_cents: string | null; target?: SourceTarget; domain?: string; missing?: number | null };
type TimelinePage = { generation: string; today: string; years?: number[]; dated: TimelineEvent[]; undated: TimelineEvent[] };

export const timelineFilters: [TimelineFilter, string][] = [['all', '全部'], ['purchase', '购买'], ['maintenance', '维护'], ['warranty', '保障'], ['lifecycle', '退役／售出'], ['wishlist', '心愿'], ['expense', '支出'], ['snapshot', '盘点']];

export function eventLabel(e: TimelineEvent) {
  return ({ snapshot: '财富盘点', purchase: e.wishlist_id ? '购入 · 实现心愿' : '购入', retire: '退役', activate: '重新启用', sale: '售出', maintenance: '维护', warranty_start: '保障生效', warranty_end: '保障到期', wish_achieved:'实现心愿', expense: '支出', refund: '退款', payment: '周期付款', virtual: '虚拟资产', wish_added: '加入心愿', wish_abandoned: '放弃心愿' } as Record<string, string>)[e.kind] ?? e.kind;
}

export function eventDetail(e: TimelineEvent) {
  if (e.kind === 'snapshot') return e.amount_cents === null ? `缺 ${e.missing ?? 0} 个账户` : '金融净资产 ' + signedMoney(e.amount_cents);
  if (e.kind === 'warranty_start' || e.kind === 'warranty_end') {
    const [kind, provider] = e.note.split('|');
    return [warrantyKinds.find(([k]) => k === kind)?.[1] ?? '保障', provider].filter(Boolean).join(' · ');
  }
  const amount = e.kind === 'purchase' ? (e.amount_cents === null ? '金额待补充' : '实付 ' + money(e.amount_cents))
    : e.kind === 'sale' ? '售价 ' + money(e.amount_cents)
    : e.kind === 'maintenance' ? (e.amount_cents === null ? '费用未知' : '费用 ' + money(e.amount_cents))
    : e.kind === 'expense' ? '金额 ' + money(e.amount_cents)
    : e.kind === 'refund' ? '退回 ' + money(e.amount_cents)
    : e.kind === 'payment' ? '实付 ' + money(e.amount_cents)
    : e.kind === 'virtual' ? (e.amount_cents === null ? '' : '价格 ' + money(e.amount_cents))
    : e.kind.startsWith('wish_') ? (e.amount_cents === null ? '预计价格未知' : '预计 ' + money(e.amount_cents)) : '';
  // Expense notes carry the fixed category key; show its label.
  const note = e.kind === 'purchase' && e.wishlist_id ? `来自心愿「${e.note}」` : e.kind.startsWith('wish_') ? '' : e.kind === 'expense' || e.kind === 'refund' ? expenseCategories.find(([k]) => k === e.note)?.[1] ?? '' : e.kind === 'payment' ? recurringCategories.find(([k]) => k === e.note)?.[1] ?? '' : e.kind === 'virtual' ? virtualKindText(e.note) : e.note;
  return [note, amount].filter(Boolean).join(' · ');
}

function month(date: string) { return `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月`; }

/** One projection for the global page and the asset detail; nothing here computes facts. */
export function Timeline({ assetId, version, filter = 'all', onOpenAsset, onOpenWish, onCorrect, selection, onOpenSource, onLoaded, onReady, hidden, search, onSearchClear }: { hidden?: ReadonlySet<string>; selection?: TimelineSelection; onOpenSource?: (target: SourceTarget) => void; onLoaded?: (years: number[]) => void; onReady?: () => void; assetId?: string; version?: unknown; filter?: TimelineFilter; onOpenAsset?: (id: string) => void; onOpenWish?: (name: string, status: string) => void; onCorrect?: (event: TimelineEvent) => void; search?: string; onSearchClear?: () => void }) {
  const [page, setPage] = useState<TimelinePage | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const loaded = useRef(onLoaded); loaded.current = onLoaded;
  const ready = useRef(onReady); ready.current = onReady;
  useEffect(() => {
    let live = true; setError('');
    (selection ? invoke<TimelinePage>('timeline_view', { query: { filter: selection.filter, asset_id: null }, domain: selection.domain, year: selection.year }) : invoke<TimelinePage>('list_timeline', { query: { filter, asset_id: assetId ?? null } }))
      .then(p => { if (live) { setPage(p); loaded.current?.(p.years ?? []); } }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [assetId, filter, selection?.filter, selection?.domain, selection?.year, version, retry]);
  // Fires after the data has committed to the DOM, so a saved scroll position
  // is restored against real content instead of a truncated loading state.
  useEffect(() => { if (page) ready.current?.(); }, [page]);
  if (error) return <div role="alert" className="timeline-empty"><p>时间轴读取失败：{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></div>;
  if (!page) return <p role="status" className="muted">正在读取时间轴…</p>;
  // The keyword intersects the domain/year/type selection and matches the shown
  // text only (title, type label, source name, displayed notes).
  const keyword = search?.trim().toLowerCase() ?? '';
  const shown = (list: TimelineEvent[]) => {
    let out = hidden?.size ? list.filter(e => !hidden.has(e.kind)) : list;
    if (keyword) out = out.filter(e => [e.title, eventLabel(e), eventDetail(e)].some(t => t.toLowerCase().includes(keyword)));
    return out;
  };
  const dated = shown(page.dated), undated = shown(page.undated);
  if (!dated.length && !undated.length) return keyword
    ? <div className="timeline-empty"><p>当前条件下没有找到记录。</p><button onClick={() => onSearchClear?.()}>清除搜索</button></div>
    : <p className="muted timeline-empty">{selection ? '当前领域、年份与事件类型的组合下没有事件；可放宽筛选再试。' : filter === 'all' ? '还没有可显示的事件。' : '没有这一类事件。'}</p>;
  const found = dated.length + undated.length;
  const item = (e: TimelineEvent) => {
    const open = !assetId && (e.target && onOpenSource ? () => onOpenSource(e.target!) : e.asset_id && onOpenAsset ? () => onOpenAsset(e.asset_id!) : e.wishlist_id && onOpenWish ? () => onOpenWish(e.title, e.note) : null);
    const correctable = onCorrect && (e.kind === 'retire' || e.kind === 'activate');
    if (!assetId) {
      const icon = e.kind.startsWith('wish_') ? 'heart' : e.kind.startsWith('warranty_') ? 'shield' : ({purchase:'items',maintenance:'settings',retire:'archive',activate:'circle',sale:'arrow',expense:'receipt',refund:'receipt',payment:'repeat',snapshot:'wallet',virtual:'cloud'} as Record<string,ComponentProps<typeof Icon>['name']>)[e.kind] ?? 'clock';
      const body = <><span className="timeline-day">{e.date ? Number(e.date.slice(8)) : '—'}<small>日</small></span><span className="timeline-kind"><Icon name={icon}/></span><span className="timeline-copy"><strong>{eventLabel(e)}{e.kind!=='snapshot'&&` · ${e.title}`}</strong><small>{eventDetail(e)}</small></span>{e.amount_cents!==null&&<span className="timeline-amount">{money(e.amount_cents)}</span>}{open&&<span aria-hidden="true">›</span>}</>;
      return <li key={e.id} data-kind={e.kind} className="timeline-entry">{open?<button type="button" className="timeline-row" onClick={open} aria-label={`打开${e.kind==='snapshot'?`${e.date} 盘点`:e.title}`}>{body}</button>:<div className="timeline-row">{body}</div>}</li>;
    }
    return <li key={e.id} data-kind={e.kind}><div><strong>{eventLabel(e)}{!assetId && e.kind !== 'snapshot' && <> · {e.title}</>}</strong><span className="muted">{e.date ?? '日期待补充'}</span>{eventDetail(e) && <p className="notes">{eventDetail(e)}</p>}</div>{open && <button onClick={open} aria-label={`打开${e.kind === 'snapshot' ? `${e.date} 盘点` : e.title}`}>{e.target && onOpenSource ? '查看来源' : e.asset_id ? '查看物品' : '查看心愿'}</button>}{correctable && <button onClick={() => onCorrect!(e)} aria-label={`更正${eventLabel(e)}日期 ${e.date}`}>更正日期</button>}</li>;
  };
  const groups: [string, TimelineEvent[]][] = [];
  for (const e of dated) { const key = assetId ? '' : month(e.date!); if (groups.at(-1)?.[0] !== key) groups.push([key, []]); groups.at(-1)![1].push(e); }
  return <div className="timeline">
    {keyword && <p className="muted small" role="status">找到 {found} 条记录</p>}
    {groups.map(([key, list]) => <section key={key || 'events'} className={assetId?"lifecycle-history":"ui-card timeline-month-card"}>{key && <h3 className="timeline-month">{key}</h3>}<ol>{list.map(item)}</ol></section>)}
    {undated.length > 0 && <section className={assetId?"lifecycle-history timeline-undated":"ui-card timeline-month-card timeline-undated"}><h3 className="timeline-month">日期待补充</h3><p className="muted small">这些事实没有已知日期，不放入任何月份；补填日期后会自动归位。</p><ol>{undated.map(item)}</ol></section>}
  </div>;
}

export type ScrollRestore = { top: number; done: () => void } | null;
export function SourceTimelinePage({ selection, onSelection, onOpenSource, version, restoreScroll, modules = allModules, newMenu, onOpenNewMenu, search, onSearch }: { modules?: Modules; selection: TimelineSelection; onSelection: (value: TimelineSelection) => void; onOpenSource: (target: SourceTarget) => void; version?: unknown; restoreScroll?: ScrollRestore; newMenu?: BarMenu; onOpenNewMenu?: () => void; search: string; onSearch: (value: string) => void }) {
  const [years, setYears] = useState<number[]>([]);
  const hidden = hiddenKinds(modules), spend = modules.expenses || modules.recurring || modules.virtual;
  const domains = ([['all','全部领域'],['physical','实物'],['wish','心愿'],['wealth','财富盘点'],['expense','支出']] as const).filter(([k]) => (k !== 'wish' || modules.wishlist) && (k !== 'wealth' || modules.wealth) && (k !== 'expense' || spend));
  const filters = timelineFilters.filter(([k]) => (k !== 'wishlist' || modules.wishlist) && (k !== 'snapshot' || modules.wealth) && (k !== 'expense' || spend));
  // 时间轴's main action is the same 新增记录 menu as the combined overview.
  usePageBar('timeline', { menu: newMenu, newRecord: newMenu ? { label: '新增记录', run: () => onOpenNewMenu?.() } : undefined, search: { key: 'timeline', placeholder: '搜索记录' } });
  return <section className="timeline-section" aria-label="全局时间轴">
    <div className="overview-controls timeline-controls"><div className="segmented" role="group" aria-label="时间轴领域">{domains.map(([key,label]) => <button key={key} aria-pressed={selection.domain === key} onClick={() => onSelection({...selection,domain:key})}>{label}</button>)}</div><label>年份 <select aria-label="时间轴年份" value={selection.year ?? 'all'} onChange={e => onSelection({...selection,year:e.target.value==='all'?null:Number(e.target.value)})}><option value="all">全部年份</option>{[...new Set([...years,...(selection.year===null?[]:[selection.year])])].sort((a,b)=>b-a).map(y=><option key={y} value={y}>{y} 年</option>)}</select></label><label>事件 <select aria-label="事件类型" value={selection.filter} onChange={e => onSelection({...selection,filter:e.target.value as typeof selection.filter})}>{filters.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><Info text="按真实业务日期排列；领域、年份与事件类型共同筛选。日期待补的记录单列，不归入所选年份。"/></div>
    <Timeline hidden={hidden} selection={selection} version={version} search={search} onSearchClear={() => onSearch('')} onOpenSource={onOpenSource} onLoaded={setYears} onReady={() => restoreScroll?.done()}/>
  </section>;
}
