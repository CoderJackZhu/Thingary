import { HeaderSlot } from './HeaderSlot';
import { DailyCostMetric, type DailyCostSummary } from './DailyCostMetric';
import { allModules, financeOff, type Modules, type RuntimeModules } from './modules';
import { useEffect } from 'react';
import { useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { sortByShare } from './distribution';
import { Info } from './FormControls';
import { eventDetail, eventLabel } from './Timeline';
import type { TimelineEvent, ScrollRestore } from './Timeline';
import type { SourceTarget } from './source';
import type { FinanceRoute } from './finance-navigation';
import type { PlanningTab } from './PlanningPage';
import { useRestored } from './undo';
import { ReviewView } from './ReviewView';
import { overviewView } from './review';
import type { OverviewViewChoice } from './start-choice';
import { usePageBar } from './topbar';
import type { BarMenu } from './topbar';
import type { ReviewPage } from './review';
import { t } from './i18n.ts';
type CategoryShare = { id: string | null; name: string; slot: number | null; count: number; known_cents: string; unknown_price_count: number };
export type OverviewData = { generation: string; today: string; held_count: number; active_count: number; retired_count: number; sold_count: number; held_known_cents: string; held_unknown_price_count: number; history_known_cents: string; history_unknown_price_count: number; average_holding_days: number | null; held_unknown_date_count: number; held_daily: DailyCostSummary; considering_wishes: number; legacy_wishes: number; scope: 'held' | 'history'; categories: CategoryShare[]; recent: TimelineEvent[] };

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

function PhysicalOverview({ onOpenSource, onBrowse, today, version, restoreScroll, modules = allModules }: { modules?: Modules; today: string; version: unknown; onOpenSource: (target: SourceTarget) => void; onBrowse: () => void; restoreScroll?: ScrollRestore }) {
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
  if (error) return <div className="empty error" role="alert"><h2>{t('总览读取失败')}</h2><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>{t('重新读取')}</button></div>;
  if (!data) return <p role="status" className="loading">{t('正在读取总览…')}</p>;
  const rows = sortByShare(data.categories, metric), count = rows.reduce((n, c) => n + c.count, 0), amount = rows.reduce((n, c) => n + Number(c.known_cents), 0), unknown = rows.reduce((n, c) => n + c.unknown_price_count, 0);
  const value = (c: CategoryShare) => metric === 'count' ? c.count : Number(c.known_cents);
  const total = metric === 'count' ? count : amount;
  return <section className="overview-section" aria-label={t('总览')}>
    <div className="ui-card ui-metrics" style={{ '--n': modules.wishlist ? 5 : 4 } as CSSProperties}>
      <div><span className="ui-label">{t('当前持有物购入金额')}</span><span className="ui-value">{money(data.held_known_cents)}<small>{t('· {held_count} 件', { held_count: data.held_count })}</small></span><span className="ui-note">{t('使用中 {active_count} · 已退役 {retired_count}', { active_count: data.active_count, retired_count: data.retired_count })}{data.held_unknown_price_count ? t(' · {held_unknown_price_count} 件金额未知，未计入', { held_unknown_price_count: data.held_unknown_price_count }) : ''}</span></div>
      <DailyCostMetric summary={data.held_daily}/>
      <div><span className="ui-label">{t('历史购入金额')}</span><span className="ui-value">{money(data.history_known_cents)}</span><span className="ui-note">{t('含已售出 {sold_count} 件', { sold_count: data.sold_count })}{data.history_unknown_price_count ? t(' · {history_unknown_price_count} 件金额未知，未计入', { history_unknown_price_count: data.history_unknown_price_count }) : ''}</span></div>
      <div><span className="ui-label">{t('平均持有')}<Info text={t('按购入日至今天，含当天；购入日期未知的物品不计入。')}/></span><span className="ui-value">{data.average_holding_days === null ? '—' : <>{data.average_holding_days.toLocaleString('zh-CN')}<small>{t('天')}</small></>}</span>{data.held_unknown_date_count > 0 && <span className="ui-note">{t('{held_unknown_date_count} 件购入日期未知，未计入', { held_unknown_date_count: data.held_unknown_date_count })}</span>}</div>
      {modules.wishlist && <div><span className="ui-label">{t('考虑中心愿')}<Info text={t('心愿的预计金额不计入持有物品；历史待核实单列。')}/></span><span className="ui-value">{data.considering_wishes}<small>{t('条')}</small></span>{data.legacy_wishes>0&&<span className="ui-note">{t('另有 {legacy_wishes} 条历史待核实', { legacy_wishes: data.legacy_wishes })}</span>}</div>}
    </div>
    <div className="overview-grid" style={!modules.timeline ? { gridTemplateColumns: 'minmax(0,1fr)' } : undefined}>
      <article className="ui-card">
        <div className="ui-section-head"><h3>{t('分类分布')}</h3><span className="ui-aside">{scope === 'held' ? t('当前持有：使用中＋已退役') : t('历史全部：含已售出，不含已删除')}</span></div>
        <div className="overview-controls ui-pad"><div className="ui-seg" role="group" aria-label={t('统计范围')}>{([['held', '当前持有'], ['history', '历史全部']] as const).map(([k, l]) => <button key={k} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}</div><div className="ui-seg" role="group" aria-label={t('占比口径')}>{([['count', '按数量'], ['amount', '按购入金额']] as const).map(([k, l]) => <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}</div></div>
        {!rows.length ? <p className="ui-empty">{t('这个范围里还没有物品。')}</p> : <div className="distribution">
          <div className="donut-wrap"><Donut rows={rows} value={value} total={total} label={t('分类分布，{v1}', { v1: metric === 'count' ? '按数量' : '按购入金额' })}/><div className="donut-center"><strong>{metric === 'count' ? count : money(String(amount))}</strong><span>{metric === 'count' ? t('件') : t('已知金额')}</span></div></div>
          <table className="ui-table distribution-table"><thead><tr><th>{t('分类')}</th><th aria-sort={metric === 'count' ? 'descending' : 'none'}>{t('数量')}{metric === 'count' && <span className="sort-mark" aria-hidden="true">↓</span>}</th><th aria-sort={metric === 'amount' ? 'descending' : 'none'}>{t('购入金额')}{metric === 'amount' && <span className="sort-mark" aria-hidden="true">↓</span>}</th><th>{metric === 'count' ? t('数量占比') : t('金额占比')}</th></tr></thead><tbody>{rows.map(c => <tr key={c.id ?? 'none'}><td><span className="swatch" style={{ background: color(c) }}/>{c.name}</td><td>{c.count}</td><td>{money(c.known_cents)}{c.unknown_price_count > 0 && <small> {t('· {unknown_price_count} 件未知', { unknown_price_count: c.unknown_price_count })}</small>}</td><td>{percent(value(c), total)}</td></tr>)}</tbody></table>
        </div>}
        {metric === 'amount' && unknown > 0 && <p className="muted small ui-pad">{t('{unknown} 件金额未知，不计入金额占比。', { unknown })}</p>}
        <div className="ui-card-foot"><button className="ui-link" onClick={onBrowse}>{t('在物品列表中核对 →')}</button></div>
      </article>
      {modules.timeline && <article className="ui-card">
        <div className="ui-section-head"><h3>{t('最近事件')}</h3><span className="ui-aside">{t('来自时间轴')}</span></div>
        {!data.recent.length ? <p className="ui-empty">{t('还没有带日期的事件。')}</p> : <ul className="ui-rows">{data.recent.map(e => <li key={e.id} className="ui-row">{e.target ? <button className="overview-event-button" onClick={() => onOpenSource(e.target!)}><span className="ui-main"><span>{eventLabel(e)} · {e.title}</span><small>{e.date}{eventDetail(e) && ' · ' + eventDetail(e)}</small></span><span className="ui-link" aria-hidden="true">›</span></button> : <span className="overview-event-button"><span className="ui-main"><span>{eventLabel(e)} · {e.title}</span><small>{e.date}{eventDetail(e) && ' · ' + eventDetail(e)}</small></span></span>}</li>)}</ul>}
      </article>}
    </div>
  </section>;
}

export function OverviewPage({ generation, today, version, year, onYear, onNavigate, onOpenSource, onBrowse, onGotoPlanning, onOpenSettings, onUpdateBalances, onNewAccount, onManageAccounts, onFinance, restoreScroll, modules = allModules, newMenu, onOpenNewMenu, viewChoice, onViewChoiceDone }: { onNewAccount?: () => void; onManageAccounts?: () => void; onUpdateBalances?: (date: string) => void; modules?: Modules & Partial<RuntimeModules>; onFinance?: (route: FinanceRoute) => void; generation: string; today: string; version: unknown; year: number | null; onYear: (year: number | null) => void; onNavigate: (page: ReviewPage, focus?: 'savings-goals') => void; onOpenSource: (target: SourceTarget) => void; onBrowse: () => void; onGotoPlanning: (tab: PlanningTab, focus?: 'budget' | 'profile') => void; onOpenSettings: () => void; restoreScroll?: ScrollRestore; newMenu?: BarMenu; onOpenNewMenu?: () => void; viewChoice?: OverviewViewChoice | null; onViewChoiceDone?: () => void }) {
  const [storedView, setView] = useState(() => { if (viewChoice?.generation === generation) return viewChoice.view; try { return overviewView(localStorage.getItem('thingary.overview-view.v1')); } catch { return 'combined'; } });
  const view = modules.physical === false ? 'combined' : storedView;
  const changeView = (value: 'combined' | 'physical') => { setView(value); try { localStorage.setItem('thingary.overview-view.v1', value); } catch { /* The current choice remains usable without persistence. */ } };
  useEffect(() => { if (viewChoice?.generation === generation) { changeView(viewChoice.view); onViewChoiceDone?.(); } }, [viewChoice, generation, onViewChoiceDone]);
  const shared = { generation, today, version, onOpenSource, onBrowse, restoreScroll, modules };
  // 综合回顾's main action is the 新增记录 menu; the physical view falls back
  // to the App default (新增物品) by publishing null.
  usePageBar('overview', !financeOff(modules) && view === 'combined' && newMenu
    ? { menu: newMenu, newRecord: { label: t('新增记录'), run: () => onOpenNewMenu?.() } }
    : null);
  // With every finance module off the combined review would only repeat the
  // physical one — except that planning still owns a summary there.
  if (modules.physical !== false && financeOff(modules) && !modules.planning) return <PhysicalOverview {...shared}/>;
  return <>{modules.physical !== false && <HeaderSlot><div className="ui-seg" role="group" aria-label={t('总览视图')}><button aria-pressed={view === 'combined'} onClick={() => changeView('combined')}>{t('综合')}</button><button aria-pressed={view === 'physical'} onClick={() => changeView('physical')}>{t('只看物品')}</button></div></HeaderSlot>}{view === 'combined' ? <ReviewView {...shared} modules={modules} year={year} onYear={onYear} onNavigate={onNavigate} onGotoPlanning={onGotoPlanning} onUpdateBalances={onUpdateBalances} onNewAccount={onNewAccount} onManageAccounts={onManageAccounts} onOpenSettings={onOpenSettings} onFinance={onFinance}/> : <PhysicalOverview {...shared}/>}</>;
}
