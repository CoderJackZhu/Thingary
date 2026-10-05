import { allModules, hiddenKinds, type Modules } from './modules';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { changeText, rateText, signedMoney } from './wealth';
import { Sparkline } from './Sparkline';
import { eventDetail, eventLabel } from './Timeline';
import type { ScrollRestore } from './Timeline';
import type { SourceTarget } from './source';
import { useRestored } from './undo';
import { attention, latestComplete, ready, requestGate } from './review';
import type { Read, Review, ReviewPage } from './review';
import { Info } from './FormControls';
import { DailyCostMetric } from './DailyCostMetric';
import './review.css';
const labels: Record<ReviewPage, string> = { wealth: '账户与盘点', assets: '全部物品', expenses: '重要支出', recurring: '周期费用', virtual: '虚拟资产', timeline: '时间轴' };

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
  // One backend projection already blends snapshot facts with every other
  // event; merging wealth points here again would duplicate 盘点 rows.
  const hidden = hiddenKinds(modules);
  const recent = (ready(data.recent) ?? []).filter(ev => !hidden.has(ev.kind)).map(ev => ({ id: 'event:' + ev.id, date: ev.date!, title: ev.kind === 'snapshot' ? eventLabel(ev) : eventLabel(ev) + ' · ' + ev.title, detail: eventDetail(ev), target: ev.target ?? null }));
  const daysSince = latest ? Math.max(0, Math.round((Date.parse(data.today) - Date.parse(latest.date)) / 86400000)) : 0;
  const tone = (cents: string | null) => cents?.startsWith('-') ? ' neg' : cents && cents !== '0' ? ' pos' : '';
  // 分类色条：金额未知的类别不占宽度；图例最多 4 行，其余合并（规范 4.6）。
  const cats = (p?.categories ?? []).filter(c => c.count > 0);
  const known = cats.reduce((sum, c) => sum + Number(c.known_cents), 0);
  const color = (slot: number | null) => slot === null ? 'var(--series-rest)' : `var(--series-${slot + 1})`;
  const legend = cats.length > 4 ? [...cats.slice(0, 3), { id: 'rest', name: `其他 ${cats.length - 3} 类`, slot: null, count: 0, known_cents: String(cats.slice(3).reduce((s, c) => s + Number(c.known_cents), 0)), unknown_price_count: cats.slice(3).reduce((s, c) => s + c.unknown_price_count, 0) }] : cats;
  const metrics = [
    modules.expenses && e && { label: `${year ?? '全部期间'}${year === null ? '' : ' 年'}重要支出`, value: signedMoney(e.net_cents), note: e.unknown_amount_count > 0 ? `${e.unknown_amount_count} 笔金额未知` : '', page: 'expenses' as ReviewPage },
    modules.recurring && r && { label: '固定负担', value: <>{money(r.monthly_cents)}<small>/月</small></>, note: '当前计划', page: 'recurring' as ReviewPage },
    p && { label: '平均持有', value: p.average_holding_days === null ? '—' : <>{p.average_holding_days.toLocaleString('zh-CN')}<small>天</small></>, note: '', page: 'assets' as ReviewPage },
    modules.wishlist && p && { label: '考虑中心愿', value: <>{p.considering_wishes}<small>条</small></>, note: p.legacy_wishes > 0 ? `另有 ${p.legacy_wishes} 条历史待核实` : '', page: null },
  ].filter(Boolean) as { label: string; value: ReactNode; note: string; page: ReviewPage | null }[];
  return <section className="review-section u16" aria-label="综合回顾" aria-busy={updating}>
    {updating && <p className="review-sub" role="status">正在更新，暂时显示上次读取的结果…</p>}
    {modules.wealth && lastPoint && !lastPoint.complete && <div className="review-notice">{lastPoint.date} 盘点尚缺 {lastPoint.missing} 个账户 · {latest ? `当前显示 ${latest.date} 的完整盘点` : '尚无完整盘点'} {link('wealth')}</div>}
    {p && p.held_count === 0 && (!w || w.points.length === 0) && <article className="ui-card ui-content review-start">
      <div><h3>从这里开始</h3><p>物谱记两件事：你持有的物品，和账户里的钱。每样只填一点也行，之后慢慢补。</p></div>
      <div className="review-start-actions"><button className="primary" onClick={() => onNavigate('assets')}>记录第一件物品</button>{modules.wealth && <button onClick={() => onNavigate('wealth')}>建立账户并盘点</button>}</div>
    </article>}
    <div className={'review-heroes' + (modules.wealth ? '' : ' single')}>
      {modules.wealth && <article className="ui-card ui-hero tint-1">
        <div className="ui-label">金融净资产{latest && <Info text={`只统计计入范围的账户，不含实物。最近一次完整盘点 ${latest.date}，距今 ${daysSince} 天。`}/>}</div>
        {failure(data.wealth)}
        {w && <>
          <div className="ui-big">{latest ? signedMoney(latest.net_cents) : '—'}</div>
          {latest ? <>
            <p className="ui-sub">截至 {latest.date} 完整盘点 · 距今 {daysSince} 天</p>
            <p className={'ui-sub' + tone(latest.change_cents)}>{latest.compared_to ? latest.change_cents !== null ? `较 ${latest.compared_to} ${changeText(latest.change_cents)}${latest.change_rate_hundredths === null ? ' · 基期非正，不显示变化率' : `（${rateText(latest.change_rate_hundredths)}）`}` : `较 ${latest.compared_to}：账户范围变化，暂不可比` : '第一份完整盘点，暂无可比变化'}</p>
            <p className="ui-sub">资产 {money(latest.assets_cents)} · 负债 {money(latest.liabilities_cents)}</p>
            <Sparkline points={w.points}/>
          </> : <p className="ui-sub">{w.points.length ? '—／尚无完整盘点：现有盘点均不完整，补全后显示净资产。' : '添加账户并完成盘点后，这里会显示金融净资产。'}</p>}
        </>}
        <div className="ui-hero-foot">{link('wealth')}</div>
      </article>}
      <article className="ui-card ui-hero tint-2">
        <div className="ui-label">持有物品<Info text={`截至 ${data.today} 的持有物购入金额，包含使用中与已退役物品；不是当前估值，不与金融净资产相加。`}/></div>
        {failure(data.physical)}
        {p && <>
          <div className="ui-split">
            <div><div className="ui-big">{money(p.held_known_cents)}</div><p className="ui-sub">{p.held_unknown_price_count ? `购入金额 · ${p.held_unknown_price_count} 件未知` : p.held_count ? '购入金额' : '还没有记录物品'}</p></div>
            <div><div className="ui-big">{p.held_count}<small>件</small></div><p className="ui-sub">使用中 {p.active_count} · 已退役 {p.retired_count}</p></div>
          </div>
          <DailyCostMetric summary={p.held_daily}/>
          {cats.length > 0 && <>
            <div className="ui-share-bar" role="img" aria-label="持有物按分类的购入金额占比">{known > 0 && cats.filter(c => Number(c.known_cents) > 0).map(c => <span key={c.id ?? 'none'} style={{ width: `${Number(c.known_cents) / known * 100}%`, background: color(c.slot) }}/>)}</div>
            <div className="ui-legend">{legend.map(c => <div key={c.id ?? 'none'}><i style={{ background: Number(c.known_cents) > 0 ? color(c.slot) : 'var(--soft-strong, var(--line))' }}/><span>{c.name}</span>{Number(c.known_cents) > 0 ? <b>{money(c.known_cents)}</b> : <b className="muted">金额未知</b>}</div>)}</div>
          </>}
        </>}
        <div className="ui-hero-foot">{link('assets')}</div>
      </article>
    </div>
    {metrics.length > 0 && <div className="ui-card ui-metrics review-metrics" style={{ '--n': metrics.length } as CSSProperties} aria-label="辅助指标">
      {metrics.map(m => <div key={m.label}><span className="ui-label">{m.label}</span><span className="ui-value">{m.value}</span>{m.note && <span className="ui-note">{m.note}</span>}</div>)}
    </div>}
    <div className="review-lists">
      <article className="ui-card">
        <div className="ui-section-head"><h3>待关注</h3><span className="ui-aside">{groups.length ? `${groups.length} 项` : ''}<Info text="只列出需要你确认或即将到期的事项；不会自动付款。"/></span></div>
        {[data.wealth, data.recurring, data.virtual_assets].some(src => src.status === 'error') && <div className="ui-error" role="alert">部分来源读取失败，事项可能不完整。<button onClick={reload}>重试</button></div>}
        {!groups.length ? <p className="ui-empty">{[data.wealth, data.recurring, data.virtual_assets].every(src => src.status === 'ready') ? '暂时没有需要关注的事项。' : '可用来源中暂无事项。'}</p> : <ul className="ui-rows">{groups.slice(0, 5).map(g => <li key={g.id} className="ui-row"><span className={'ui-dot' + (g.priority <= 1 ? ' warn' : '')}/><div className="ui-main"><div>{g.title}</div>{g.details.map(d => <small key={d}>{d}</small>)}</div><span className="review-links">{g.entries.map((entry, i) => <button key={i} className="ui-link" onClick={() => onOpenSource(entry.target)}>{entry.action} →</button>)}</span></li>)}</ul>}
        {groups.length > 5 && <p className="ui-card-foot">还有 {groups.length - 5} 项，请在对应模块查看。</p>}
      </article>
      <article className="ui-card">
        <div className="ui-section-head"><h3>近期记录</h3><span className="ui-aside"><select aria-label="期间" value={year ?? 'all'} onChange={ev => onYear(ev.target.value === 'all' ? null : Number(ev.target.value))}><option value="all">全部期间</option>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select><button className="ui-link" onClick={() => onNavigate('timeline')}>时间轴 →</button></span></div>
        <p className="review-period-note muted">所选期间用于重要支出与近期记录；持有物品与固定负担为当前资料，净资产取最近完整盘点。</p>
        {failure(data.recent)}
        {!recent.length ? <p className="ui-empty">{data.recent.status === 'ready' ? '所选期间暂无记录。' : '可用来源中暂无记录。'}</p> : <ul className="ui-rows">{recent.slice(0, 5).map(ev => <li key={ev.id} className={'ui-row' + (ev.target ? ' clickable' : '')} onClick={ev.target ? () => onOpenSource(ev.target!) : undefined}><div className="ui-main"><div>{ev.title}</div><small>{ev.date}{ev.detail ? ` · ${ev.detail}` : ''}</small></div>{ev.target && <button className="ui-link" aria-label={`查看来源：${ev.title}`} onClick={e2 => { e2.stopPropagation(); onOpenSource(ev.target!); }}>›</button>}</li>)}</ul>}
      </article>
    </div>
  </section>;
}
