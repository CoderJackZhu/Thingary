import { allModules, financeOff, type Modules } from './modules';
import { useEffect } from 'react';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { eventDetail, eventLabel } from './Timeline';
import type { TimelineEvent, ScrollRestore } from './Timeline';
import type { SourceTarget } from './source';
import { useRestored } from './undo';
import { ReviewView } from './ReviewView';
import { overviewView } from './review';
import { usePageBar } from './topbar';
import type { BarMenu } from './topbar';
import type { ReviewPage } from './review';

type CategoryShare = { id: string | null; name: string; slot: number | null; count: number; known_cents: string; unknown_price_count: number };
export type OverviewData = { generation: string; today: string; held_count: number; active_count: number; retired_count: number; sold_count: number; held_known_cents: string; held_unknown_price_count: number; history_known_cents: string; history_unknown_price_count: number; average_holding_days: number | null; held_unknown_date_count: number; ongoing_wishes: number; scope: 'held' | 'history'; categories: CategoryShare[]; recent: TimelineEvent[] };

// Color follows the category (backend slot in category order, same in both
// scopes); later categories and 未分类 share the neutral, named by the list.
const color = (c: CategoryShare) => c.slot === null ? 'var(--series-rest)' : `var(--series-${c.slot + 1})`;
const percent = (part: number, whole: number) => whole > 0 ? `${(part / whole * 100).toFixed(1)}%` : '—';

function Donut({ rows, value, total, label }: { rows: CategoryShare[]; value: (c: CategoryShare) => number; total: number; label: string }) {
  const r = 52, length = 2 * Math.PI * r, gap = rows.filter(c => value(c) > 0).length > 1 ? 2 : 0;
  let offset = 0;
  return <svg className="donut" viewBox="0 0 140 140" role="img" aria-label={label}>
    <circle cx="70" cy="70" r={r} className="donut-track"/>
    {total > 0 && rows.map(c => {
      const size = value(c) / total * length; const start = offset; offset += size;
      return size > 0 && <circle key={c.id ?? 'none'} cx="70" cy="70" r={r} stroke={color(c)} strokeDasharray={`${Math.max(size - gap, 0.5)} ${length}`} strokeDashoffset={-start} transform="rotate(-90 70 70)"><title>{c.name}：{percent(value(c), total)}</title></circle>;
    })}
  </svg>;
}

function PhysicalOverview({ onOpenSource, onBrowse, today, version, restoreScroll }: { today: string; version: unknown; onOpenSource: (target: SourceTarget) => void; onBrowse: () => void; restoreScroll?: ScrollRestore }) {
  const [scope, setScope] = useState<'held' | 'history'>('held'), [metric, setMetric] = useState<'count' | 'amount'>('amount');
  const [data, setData] = useState<OverviewData | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useRestored(() => setRetry(n => n + 1));
  useEffect(() => {
    let live = true; setError('');
    invoke<OverviewData>('overview', { scope }).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [scope, retry, today, version]);
  // Restore the saved scroll only after the physical view has real content.
  useEffect(() => { if (data) restoreScroll?.done(); }, [data, restoreScroll]);
  if (error) return <div className="empty error" role="alert"><h2>总览读取失败</h2><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></div>;
  if (!data) return <p role="status" className="loading">正在读取总览…</p>;
  const rows = data.categories, count = rows.reduce((n, c) => n + c.count, 0), amount = rows.reduce((n, c) => n + Number(c.known_cents), 0), unknown = rows.reduce((n, c) => n + c.unknown_price_count, 0);
  const value = (c: CategoryShare) => metric === 'count' ? c.count : Number(c.known_cents);
  const total = metric === 'count' ? count : amount;
  return <section className="overview-section" aria-label="总览">
    <div className="asset-overview overview-kpis">
      <div><span>当前持有物购入金额</span><div className="held-split"><div><strong>{money(data.held_known_cents)}</strong><p>{data.held_unknown_price_count ? `${data.held_unknown_price_count} 件金额未知，未计入` : '金额均已记录'}</p></div><div><strong>{data.held_count}<small>件</small></strong><p><span>使用中 {data.active_count} ·</span> <span>已退役 {data.retired_count}</span></p></div></div></div>
      <div><span>历史购入金额</span><strong>{money(data.history_known_cents)}</strong><p>含已售出 {data.sold_count} 件 · {data.history_unknown_price_count ? `${data.history_unknown_price_count} 件金额未知，未计入` : '金额均已记录'}</p></div>
      <div><span>平均持有时间</span><strong>{data.average_holding_days === null ? '—' : data.average_holding_days}<small>{data.average_holding_days === null ? '' : '天'}</small></strong><p>{data.held_unknown_date_count ? `${data.held_unknown_date_count} 件购入日期未知，未计入` : '按购入日至今天，含当天'}</p></div>
      <div><span>进行中心愿</span><strong>{data.ongoing_wishes}<small>条</small></strong><p>预计金额不计入资产</p></div>
    </div>
    <div className="overview-grid">
      <article className="detail-section overview-card">
        <div className="section-heading"><h3>分类分布</h3><span>{scope === 'held' ? '当前持有：使用中＋已退役' : '历史全部：含已售出，不含已删除'}</span></div>
        <div className="overview-controls"><div className="segmented" role="group" aria-label="统计范围">{([['held', '当前持有'], ['history', '历史全部']] as const).map(([k, l]) => <button key={k} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}</div><div className="segmented" role="group" aria-label="占比口径">{([['count', '按数量'], ['amount', '按购入金额']] as const).map(([k, l]) => <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}</div></div>
        {!rows.length ? <p className="muted">这个范围里还没有物品。</p> : <div className="distribution">
          <div className="donut-wrap"><Donut rows={rows} value={value} total={total} label={`分类分布，${metric === 'count' ? '按数量' : '按购入金额'}`}/><div className="donut-center"><strong>{metric === 'count' ? count : money(String(amount))}</strong><span>{metric === 'count' ? '件' : '已知金额'}</span></div></div>
          <table className="distribution-table"><thead><tr><th>分类</th><th>数量</th><th>购入金额</th><th>{metric === 'count' ? '数量占比' : '金额占比'}</th></tr></thead><tbody>{rows.map(c => <tr key={c.id ?? 'none'}><td><span className="swatch" style={{ background: color(c) }}/>{c.name}</td><td>{c.count}</td><td>{money(c.known_cents)}{c.unknown_price_count > 0 && <small> · {c.unknown_price_count} 件未知</small>}</td><td>{percent(value(c), total)}</td></tr>)}</tbody></table>
        </div>}
        {metric === 'amount' && unknown > 0 && <p className="muted small">{unknown} 件金额未知，不计入金额占比。</p>}
        <button className="overview-link" onClick={onBrowse}>在资产列表中核对</button>
      </article>
      <article className="detail-section overview-card">
        <div className="section-heading"><h3>最近事件</h3><span>来自时间轴</span></div>
        {!data.recent.length ? <p className="muted">还没有带日期的事件。</p> : <ol className="recent-events">{data.recent.map(e => <li key={e.id}><button onClick={() => e.target && onOpenSource(e.target)}><strong>{eventLabel(e)} · {e.title}</strong><span className="muted">{e.date}{eventDetail(e) && ' · ' + eventDetail(e)}</span></button></li>)}</ol>}
      </article>
    </div>
  </section>;
}

export function OverviewPage({ generation, today, version, year, onYear, onNavigate, onOpenSource, onBrowse, restoreScroll, modules = allModules, newMenu, onOpenNewMenu }: { modules?: Modules; generation: string; today: string; version: unknown; year: number | null; onYear: (year: number | null) => void; onNavigate: (page: ReviewPage) => void; onOpenSource: (target: SourceTarget) => void; onBrowse: () => void; restoreScroll?: ScrollRestore; newMenu?: BarMenu; onOpenNewMenu?: () => void }) {
  const [view, setView] = useState(() => { try { return overviewView(localStorage.getItem('possio.overview-view.v1')); } catch { return 'combined'; } });
  const changeView = (value: 'combined' | 'physical') => { setView(value); try { localStorage.setItem('possio.overview-view.v1', value); } catch { /* The current choice remains usable without persistence. */ } };
  const shared = { generation, today, version, onOpenSource, onBrowse, restoreScroll };
  // 综合回顾's main action is the 新增记录 menu; the physical view falls back
  // to the App default (新增物品) by publishing null.
  usePageBar('overview', !financeOff(modules) && view === 'combined' && newMenu
    ? { menu: newMenu, newRecord: { label: '新增记录', run: () => onOpenNewMenu?.() } }
    : null);
  // With every finance module off the combined review would only repeat the physical one.
  if (financeOff(modules)) return <PhysicalOverview {...shared}/>;
  return <><div className="overview-switch"><div className="segmented" role="group" aria-label="总览视图"><button aria-pressed={view === 'combined'} onClick={() => changeView('combined')}>综合回顾</button><button aria-pressed={view === 'physical'} onClick={() => changeView('physical')}>实物概览</button></div></div>{view === 'combined' ? <ReviewView {...shared} modules={modules} year={year} onYear={onYear} onNavigate={onNavigate}/> : <PhysicalOverview {...shared}/>}</>;
}
