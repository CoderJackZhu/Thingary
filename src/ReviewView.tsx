import { allModules, hiddenKinds, type Modules } from './modules';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { changeText, rateText, signedMoney } from './wealth';
import { NetChart } from './WealthPage';
import { eventDetail, eventLabel } from './Timeline';
import type { ScrollRestore } from './Timeline';
import type { SourceTarget } from './source';
import { useRestored } from './undo';
import { attention, latestComplete, ready, requestGate } from './review';
import type { Read, Review, ReviewPage } from './review';
import { Info } from './FormControls';
import './review.css';
const labels: Record<ReviewPage, string> = { wealth: '账户与盘点', assets: '全部资产', expenses: '重要支出', recurring: '周期费用', virtual: '虚拟资产', timeline: '时间轴' };

export function ReviewView({ generation, today, version, year, onYear, onNavigate, onOpenSource, restoreScroll, modules = allModules }: { modules?: Modules; generation: string; today: string; version: unknown; year: number | null; onYear: (year: number | null) => void; onNavigate: (page: ReviewPage) => void; onOpenSource: (target: SourceTarget) => void; restoreScroll?: ScrollRestore }) {
  const [data, setData] = useState<Review | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const gate = useRef(requestGate());
  const context = useRef<{ generation: string; today: string; version: unknown; year: number | null } | null>(null);
  const [updating, setUpdating] = useState(false);
  useRestored(() => setRetry(n => n + 1));
  useEffect(() => {
    const refresh = () => setRetry(n => n + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    const ticket = gate.current.next();
    const prior = context.current;
    if (!prior || prior.generation !== generation || prior.today !== today || prior.version !== version || prior.year !== year) setData(null);
    context.current = { generation, today, version, year };
    setUpdating(true); setError('');
    invoke<Review>('review_overview', { year }).then(result => {
      if (gate.current.accepts(ticket, generation, result.generation)) { setData(result); setUpdating(false); }
      else if (gate.current.accepts(ticket, generation, generation)) setError('资料库已变化，请重新读取。');
    }).catch(e => { if (gate.current.accepts(ticket, generation, generation)) setError(errorMessage(e)); });
    return () => gate.current.invalidate();
  }, [generation, today, version, year, retry]);
  // Restore only once the whole review has rendered, never against the loading stub.
  useEffect(() => { if (data) restoreScroll?.done(); }, [data, restoreScroll]);
  const reload = () => setRetry(n => n + 1);
  if (error) return <div className="empty error" role="alert"><h2>综合回顾读取失败</h2><p>{error}</p><button onClick={reload}>重新读取</button></div>;
  if (!data || data.year !== year || data.generation !== generation) return <p className="loading" role="status">正在读取综合回顾…</p>;
  const w = ready(data.wealth), p = ready(data.physical), e = ready(data.expenses), r = ready(data.recurring);
  const latest = w && latestComplete(w.points), lastPoint = w?.points.at(-1);
  const groups = attention(data, modules), currentYear = Number(data.today.slice(0, 4));
  const years = [...new Set([currentYear, ...(year === null ? [] : [year]), ...(e?.years ?? []), ...(w?.points.map(p => Number(p.date.slice(0, 4))) ?? [])])].sort((a, b) => b - a);
  const link = (page: ReviewPage) => <button className="review-action" onClick={() => onNavigate(page)}>查看{labels[page]} →</button>;
  const failure = (source: Read<unknown>) => source.status === 'error' && <div className="review-error" role="alert"><p>{source.value.message}</p><button onClick={reload}>重新读取</button></div>;
  const card = (title: string, date: ReactNode, source: Read<unknown>, content: ReactNode, page: ReviewPage) => <article className="review-primary"><div className="review-top"><h3>{title}</h3><span className="muted">{date}</span></div>{failure(source)}{source.status === 'ready' && content}<div className="review-footer">{link(page)}</div></article>;
  // One backend projection already blends snapshot facts with every other
  // event; merging wealth points here again would duplicate 盘点 rows.
  const hidden = hiddenKinds(modules);
  const recent = (ready(data.recent) ?? []).filter(ev => !hidden.has(ev.kind)).map(ev => ({ id: 'event:' + ev.id, date: ev.date!, title: ev.kind === 'snapshot' ? eventLabel(ev) : eventLabel(ev) + ' · ' + ev.title, detail: eventDetail(ev), target: ev.target ?? null }));
  return <section className="review-section" aria-label="综合回顾" aria-busy={updating}>
    {updating && <p className="review-sub" role="status">正在更新，暂时显示上次读取的结果…</p>}
    {modules.wealth && lastPoint && !lastPoint.complete && <div className="review-notice">{lastPoint.date} 盘点尚缺 {lastPoint.missing} 个账户 · {latest ? `当前显示 ${latest.date} 的完整盘点` : '尚无完整盘点'} {link('wealth')}</div>}
    <div className="review-headline">
      {modules.wealth && card('金融净资产', latest ? <Info text={`最近一次完整盘点 ${latest.date}，距今 ${Math.max(0, Math.round((Date.parse(data.today) - Date.parse(latest.date)) / 86400000))} 天。只统计计入范围的账户，不含实物。`}/> : <span className="muted">尚无完整盘点</span>, data.wealth, <><div className="review-value">{latest ? signedMoney(latest.net_cents) : '—'}</div>{!latest && <p className="review-sub">添加账户并完成盘点后，这里会显示金融净资产。</p>}{latest && <p className={'review-sub review-change' + (latest.change_cents && latest.change_cents.startsWith('-') ? ' neg' : latest.change_cents && latest.change_cents !== '0' ? ' pos' : '')}>{latest.compared_to ? latest.change_cents !== null ? `较 ${latest.compared_to} ${changeText(latest.change_cents)}${latest.change_rate_hundredths === null ? ' · 基期非正，不显示变化率' : `（${rateText(latest.change_rate_hundredths)}）`}` : `较 ${latest.compared_to}：账户范围变化，暂不可比` : '第一份完整盘点，暂无可比变化'}</p>}{latest && <p className="review-sub">金融资产 {money(latest.assets_cents)} · 负债 {money(latest.liabilities_cents)}</p>}</>, 'wealth')}
      {card('持有物品', <Info text={`截至 ${data.today} 的持有物购入金额，包含使用中与已退役物品；不是当前估值，不与金融净资产相加。`}/>, data.physical, p && <><div className="held-split"><div><div className="review-value">{money(p.held_known_cents)}</div><p className="review-sub">{p.held_unknown_price_count ? `${p.held_unknown_price_count} 件金额未知，未计入` : p.held_count ? '购入金额均已记录' : '还没有记录物品'}</p></div><div><div className="review-value">{p.held_count}<small>件</small></div><p className="review-sub">使用中 {p.active_count} · 已退役 {p.retired_count}</p></div></div></>, 'assets')}
    </div>
    {(modules.expenses || modules.recurring) && <div className="review-secondary" aria-label="辅助指标">
      {modules.expenses && <article><div className="review-top"><h3>已记录重要支出</h3><select aria-label="支出年份" value={year ?? 'all'} onChange={ev => onYear(ev.target.value === 'all' ? null : Number(ev.target.value))}><option value="all">全部期间</option>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select><Info text="净支出＝支出－退款，售出回收单列。期间仅影响支出和近期记录，不改变金融净资产与持有物品。"/></div>{failure(data.expenses)}{e && <><strong className="review-secondary-value">{signedMoney(e.net_cents)}</strong><span className="review-sub">支出 {money(e.spent_cents)} − 退款 {money(e.refund_cents)}</span><span className="review-sub">售出回收 {money(e.sale_cents)} · 日期待补 {money(e.undated_cents)}{e.unknown_amount_count > 0 && ` · ${e.unknown_amount_count} 笔金额未知`}</span></>}{link('expenses')}</article>}
      {modules.recurring && <article><div className="review-top"><h3>固定负担</h3><Info text={`截至 ${data.today} 的有效计划折算月均与年化金额；计划不等于实际支付。`}/></div>{failure(data.recurring)}{r && <><strong className="review-secondary-value">{money(r.monthly_cents)}<small> / 月均</small></strong><span className="review-sub">当前年化 {money(r.annual_cents)}</span></>}{link('recurring')}</article>}
    </div>}

    {modules.wealth && <article className="review-card review-chart"><div className="review-top"><h3>金融净资产趋势</h3><Info text="按真实盘点日期展示，变化包含存取、消费与估值，不代表投资收益。不完整盘点不作为零值绘制。"/></div>{failure(data.wealth)}{w && (latest ? <NetChart points={w.points}/> : <p className="review-empty">{w.points.length ? '现有盘点均不完整，补全后可查看金额点位。' : '完成首次盘点后，在这里留下第一个点位。'}</p>)}{w?.points.some(p => !p.complete) && <p className="review-sub">{w.points.filter(p => !p.complete).map(p => `${p.date} 缺 ${p.missing} 项`).join('；')} · 不作为零值绘制</p>}</article>}
    <div className="review-grid review-lower">
      <article className="review-card"><div className="review-top"><h3>待关注</h3><span className="muted">{groups.length} 组事项 · 不自动付款</span></div>{[data.wealth, data.recurring, data.virtual_assets].some(s => s.status === 'error') && <div className="review-error" role="alert">部分来源读取失败，事项可能不完整。<button onClick={reload}>重新读取</button></div>}{!groups.length ? <p className="review-empty">{[data.wealth, data.recurring, data.virtual_assets].every(s => s.status === 'ready') ? '暂时没有需要关注的事项。' : '可用来源中暂无事项。'}</p> : <ul className="review-list">{groups.slice(0, 5).map(g => <li key={g.id}><div><strong>{g.title}</strong>{g.details.map(d => <p key={d} className="review-sub">{d}</p>)}</div><div className="review-links">{g.entries.map((entry, i) => <span key={i}><button className="review-action" onClick={() => onOpenSource(entry.target)}>{entry.action} →</button></span>)}</div></li>)}</ul>}{groups.length > 5 && <p className="review-sub">还有 {groups.length - 5} 组，请在对应模块查看。</p>}</article>
      <article className="review-card"><div className="review-top"><h3>近期记录</h3><span className="muted">{year ?? '全部'}{year !== null && ' 年'}</span></div>{failure(data.recent)}{!recent.length ? <p className="review-empty">{data.recent.status === 'ready' ? '所选期间暂无记录。' : '可用来源中暂无记录。'}</p> : <ul className="review-list">{recent.map(ev => <li key={ev.id}><div><strong>{ev.title}</strong><p className="review-sub">{ev.date} · {ev.detail}</p></div>{ev.target && <div className="review-links"><span><button className="review-action" onClick={() => onOpenSource(ev.target!)}>查看来源 →</button></span></div>}</li>)}</ul>}{link('timeline')}</article>
    </div>
  </section>;
}
