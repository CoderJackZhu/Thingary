import { spacedLabels } from './chart-labels';
import { useChartScale } from './chart-width';
import { HeaderSlot } from './HeaderSlot';
import { useEffect, useId, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Info } from './FormControls';
import { errorMessage, money, unitMoney } from './asset';
import { changeText } from './wealth';
import { percentText, type ResaleRate } from './resale';
import { t as tt } from './i18n.ts';
type Bucket = { key: string; start: string; end: string; count: number; known_cents: string; unknown_price_count: number; cumulative_cents: string };
type Trend = { generation: string; today: string; granularity: Granularity; buckets: Bucket[]; known_cents: string; unknown_price_count: number; unknown_date_count: number; unknown_date_known_cents: string };
type Granularity = 'month' | 'quarter' | 'year';
type StatsPeriod = 'all' | 'week' | 'month' | 'quarter' | 'year';
type StatsCategory = {id:string|null;name:string;count:number;known_cents:string;unknown_price_count:number};
type StatsSnapshot = {period:StatsPeriod;start:string|null;end:string;total:number;active:number;retired:number;sold:number;known_cents:string;unknown_price_count:number;sale_proceeds_cents:string;sold_purchase_cents:string;sold_unknown_price_count:number;sold_zero_price_count:number;categories:StatsCategory[]};
const share=(part:number,total:number)=>total>0?`${(part/total*100).toFixed(1)}%`:'—';
const series=(i:number)=>`var(--series-${i%7+1})`;

function StatsDashboard(){
 const [period,setPeriod]=useState<StatsPeriod>('all'),[data,setData]=useState<StatsSnapshot|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;setError('');invoke<StatsSnapshot>('stats_snapshot',{period}).then(result=>{if(live)setData(result)}).catch(e=>{if(live)setError(errorMessage(e))});return()=>{live=false}},[period,retry]);
 const rows=data?.categories??[],total=data?.total??0;
 const purchased=Number(data?.sold_purchase_cents??0),returned=Number(data?.sale_proceeds_cents??0);
 return <div className="stats-dashboard">
  <HeaderSlot><div className="stats-filter-row"><div className="segmented stats-period" role="group" aria-label={tt('统计时间范围')}>{([['all',tt('全部')],['week',tt('周')],['month',tt('月')],['quarter',tt('季')],['year',tt('年')]] as const).map(([key,label])=><button type="button" key={key} aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}</div><Info text={(data?.start?tt('{start} 至 {end} 购入的物品，按当前状态统计', { start: data.start, end: data.end }):tt('所有未删除物品，按当前状态统计'))+tt('；已设置不计入统计的物品不参与。')}/></div></HeaderSlot>
  {error?<article className="ui-card ui-content" role="alert"><p>{tt('统计读取失败：{error}', { error })}</p><button onClick={()=>setRetry(n=>n+1)}>{tt('重新读取')}</button></article>:!data?<p role="status" className="muted">{tt('正在读取统计…')}</p>:<>
   <div className="ui-metrics ui-card">{([[tt('全部物品'),data.total],[tt('使用中'),data.active],[tt('已退役'),data.retired],[tt('已售出'),data.sold]] as const).map(([label,value])=><article key={label}><span>{label}</span><strong>{value}<small> {tt('件')}</small></strong><em>{share(value,data.total)}</em></article>)}</div>
   <div className="stats-pair">
    <article className="ui-card ui-content"><div className="ui-section-head"><h3>{tt('分类占比')}</h3><span>{tt('按物品数量')}</span></div>{!rows.length?<p className="muted">{tt('这个时间范围里没有物品。')}</p>:<ul className="stats-category-bars">{rows.map((row,i)=><li key={row.id??'none'}><span><i style={{background:series(i)}}/>{row.id===null?tt('未分类'):row.name}</span><div className="stats-bar"><span style={{width:share(row.count,total),background:series(i)}}/></div><strong>{share(row.count,total)}</strong><small>{tt('{count} 件', { count: row.count })}</small></li>)}</ul>}</article>

    <article className="ui-card ui-content"><div className="ui-section-head"><h3>{tt('回收分析')}</h3><span>{tt('已售出物品')}</span></div><div className="stats-recovery"><div><span>{tt('售出回收')}</span><strong>{money(data.sale_proceeds_cents)}</strong></div><div><span>{tt('已知购入成本')}</span><strong>{money(data.sold_purchase_cents)}</strong></div><div><span>{tt('购入成本回收率')}</span><strong>{purchased>0?share(returned,purchased):'—'}</strong></div></div><p className="muted small">{tt('仅比较购入价与售出价，不含维护费用。')}{data.sold_unknown_price_count+data.sold_zero_price_count>0?tt('{v1} 件售出物品的购入价未知或为 ¥0，未纳入回收率。', { v1: data.sold_unknown_price_count+data.sold_zero_price_count }):''}</p></article></div>
  </>}
 </div>
}

const W = 640, H = 220, L = 64, B = 26, T = 12;
function ticks(max: number) {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max)), unit = [1, 2, 5, 10].map(n => n * step).find(n => max / n <= 4) ?? step * 10;
  // The top gridline must sit at or above the largest value so no mark overflows.
  return Array.from({ length: Math.ceil(max / unit) + 1 }, (_, i) => i * unit);
}
const yuan = (cents: number) => cents >= 1_000_000 ? tt('¥{v1}万', { v1: (cents / 1_000_000).toFixed(cents % 1_000_000 ? 1 : 0) }) : `¥${Math.round(cents / 100)}`;

/** One series, one axis: the chart title names it, the table below is the exact view. */
function Chart({ buckets, value, kind, label }: { buckets: Bucket[]; value: (b: Bucket) => number; kind: 'bar' | 'line'; label: string }) {
  const root = useRef<HTMLDivElement>(null), detailId = useId();
  const svg = useRef<SVGSVGElement>(null), scale = useChartScale(svg, W, H);
  const [current, setCurrent] = useState<number | null>(null), [fixed, setFixed] = useState(false);
  useEffect(() => { setCurrent(null); setFixed(false); }, [buckets]);
  const max = Math.max(...buckets.map(value), 0), grid = ticks(max), top = grid.at(-1) || 1;
  const step = (W - L) / buckets.length, y = (v: number) => T + (H - T - B) * (1 - v / top);
  const labels = spacedLabels(buckets.map((b,i) => ({ b,i })), v => (L + step * (v.i + 0.5)) * scale, v => v.b.key.length * 8 * scale);
  const points = buckets.map((b, i) => `${L + step * (i + 0.5)},${y(value(b))}`).join(' ');
  const shown = current === null ? null : buckets[current];
  const unknown = shown ? kind === 'bar' ? shown.unknown_price_count : buckets.slice(0, current! + 1).reduce((n, b) => n + b.unknown_price_count, 0) : 0;
  const pick = (e: { currentTarget: SVGSVGElement; clientX: number; clientY: number }) => {
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const point = e.currentTarget.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return local.x < L || local.x > W || local.y < T || local.y > H - B ? null : Math.min(buckets.length - 1, Math.floor((local.x - L) / step));
  };
  return <div ref={root} className="purchase-trend" tabIndex={0} role="group" aria-label={tt('{label}，左右方向键选择期间，回车固定，Escape 关闭详情', { label })} aria-describedby={shown ? detailId : undefined}
    onFocus={() => setCurrent(n => n ?? buckets.length - 1)} onBlur={() => { setCurrent(null); setFixed(false); }}
    onPointerLeave={() => { if (!fixed) setCurrent(null); }}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); setCurrent(null); setFixed(false); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCurrent(n => n ?? buckets.length - 1); setFixed(f => !f); }
      else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); setCurrent(n => e.key === 'Home' ? 0 : e.key === 'End' ? buckets.length - 1 : Math.max(0, Math.min(buckets.length - 1, (n ?? buckets.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
      }
    }}>
    <svg ref={svg} className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
      onPointerMove={e => { if (!fixed) setCurrent(pick(e)); }}
      onClick={e => { const selected = pick(e); if (selected !== null) { root.current?.focus({ preventScroll: true }); setCurrent(selected); setFixed(!(fixed && selected === current)); } }}>
    {grid.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid"/><text x={L - 6} y={y(v) + 3} textAnchor="end">{yuan(v)}</text></g>)}
    {labels.map(({b,i}) => <text key={b.key} x={L + step * (i + 0.5)} y={H - 6} textAnchor="middle">{b.key}</text>)}
    {kind === 'line' && <><polygon points={`${L + step * 0.5},${H - B} ${points} ${L + step * (buckets.length - 0.5)},${H - B}`} className="trend-area"/><polyline points={points} className="trend-line"/></>}
    {buckets.map((b, i) => { const x = L + step * i, v = value(b);
      return <g key={b.key} className="trend-hit" data-selected={i === current || undefined}><rect x={x} y={T} width={step} height={H - T - B} className="hit"/>
        {kind === 'bar' ? v > 0 && <rect x={x + Math.max(step * 0.2, 1)} y={y(v)} width={Math.max(step * 0.6, 1)} height={Math.max(H - B - y(v), 1)} rx={Math.min(3, step * 0.2)} className="trend-bar"/> : <circle cx={x + step / 2} cy={y(v)} r={i === current ? 5 : buckets.length > 40 ? 0 : 3} className="trend-dot"/>}
        </g>; })}
    <line x1={L} x2={W} y1={H - B} y2={H - B} className="axis"/>
    </svg>
    {shown && <div id={detailId} className="ui-tip purchase-trend-tip" role="status" aria-live="polite" aria-atomic="true" style={{ left: `clamp(min(130px, 50%), ${(L + step * (current! + 0.5)) / W * 100}%, max(calc(100% - 130px), 50%))` }}>
      <span>{tt('{start} 至 {end}', { start: shown.start, end: shown.end })}</span>
      <b>{kind === 'bar' ? tt('本期购入') : tt('累计购入')} {unitMoney(kind === 'bar' ? shown.known_cents : shown.cumulative_cents)}</b>
      <span>{tt('本期购入 {count} 件', { count: shown.count })}{unknown ? tt(' · {v1}{unknown} 件金额未知，未计入', { v1: kind === 'line' ? tt('累计 ') : '', unknown }) : ''}</span>
      {fixed && <small>{tt('已固定 · 再点取消，Esc 关闭')}</small>}
    </div>}
  </div>;
}

export function StatsPage({ onOpenAsset }: { onOpenAsset: (id: string) => void }) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [trend, setTrend] = useState<Trend | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    invoke<Trend>('purchase_trend', { granularity }).then(t => { if (live) setTrend(t); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [granularity, retry]);
  return <section className="stats-section" aria-label={tt('物品统计')}>
    <StatsDashboard/>
    <article className="ui-card ui-content">
      <div className="ui-section-head"><h3>{tt('购买趋势')}</h3><Info text={tt('历史全部：含已售出，不含已删除；按购入日期归入期间，期间首尾两天都包含。')}/></div>
      <div className="overview-controls"><div className="segmented" role="group" aria-label={tt('期间粒度')}>{([['month', tt('按月')], ['quarter', tt('按季')], ['year', tt('按年')]] as const).map(([k, l]) => <button key={k} aria-pressed={granularity === k} onClick={() => setGranularity(k)}>{l}</button>)}</div><span className="muted small">{tt('悬浮查看详情 · 点击固定 · 方向键切换期间')}</span></div>
      {error ? <div role="alert"><p>{tt('趋势读取失败：{error}', { error })}</p><button onClick={() => setRetry(n => n + 1)}>{tt('重新读取')}</button></div> : !trend ? <p role="status" className="muted">{tt('正在读取趋势…')}</p> : <>
        <p className="trend-summary">{tt('已知购入合计')} <strong>{money(trend.known_cents)}</strong>{trend.unknown_price_count > 0 && tt(' · {unknown_price_count} 件有日期但金额未知，未计入', { unknown_price_count: trend.unknown_price_count })}{trend.unknown_date_count > 0 && tt(' · {unknown_date_count} 件购入日期未知，不归入任何期间（其中已知金额 {v2}）', { unknown_date_count: trend.unknown_date_count, v2: money(trend.unknown_date_known_cents) })}</p>
        {!trend.buckets.length ? <p className="muted">{tt('还没有带购入日期的物品。')}</p> : <>
          <h4 className="chart-title">{tt('各期间购入金额')}</h4><Chart buckets={trend.buckets} value={b => Number(b.known_cents)} kind="bar" label={tt('各期间购入金额柱状图')}/>
          <h4 className="chart-title">{tt('累计购入金额')} <span className="muted">{tt('出售不回减，不是当前估值')}</span></h4><Chart buckets={trend.buckets} value={b => Number(b.cumulative_cents)} kind="line" label={tt('累计购入金额折线图')}/>
          <details className="trend-table"><summary>{tt('查看表格')}</summary><table className="ui-table"><thead><tr><th>{tt('期间')}</th><th>{tt('起止')}</th><th>{tt('件数')}</th><th>{tt('购入金额')}</th><th>{tt('累计')}</th></tr></thead><tbody>{trend.buckets.slice().reverse().map(b => <tr key={b.key}><td>{b.key}</td><td>{tt('{start} 至 {end}', { start: b.start, end: b.end })}</td><td>{b.count}</td><td>{money(b.known_cents)}{b.unknown_price_count > 0 && <small> {tt('· {unknown_price_count} 件未知', { unknown_price_count: b.unknown_price_count })}</small>}</td><td>{money(b.cumulative_cents)}</td></tr>)}</tbody></table></details>
        </>}
      </>}
    </article>
    <HoldingCards onOpenAsset={onOpenAsset}/>
    <ResaleCard onOpenAsset={onOpenAsset}/>
  </section>;
}

type Ranked = { id: string; name: string; state: string; held_days: number; cost_cents: string; daily_cents: string };
type Holding = { scope: 'held' | 'history'; groups: { key: string; label: string; count: number }[]; dated_count: number; unknown_date_count: number; average_days: number | null; median_days: number | null; longest: Ranked | null; held_ranking: Ranked[]; sold_ranking: Ranked[]; excluded: { id: string; name: string; reason: string }[] };
const days = (d: number | null) => d === null ? '—' : tt('{v1} 天', { v1: Number.isInteger(d) ? d : d.toFixed(1) });

function Ranking({ title, note, rows, costLabel, descending, onOpen }: { title: string; note: string; rows: Ranked[]; costLabel: string; descending: boolean; onOpen: (id: string) => void }) {
  const list = descending ? rows : rows.slice().reverse();
  return <><h4 className="chart-title">{title} <span className="muted">{note}</span></h4>
    {!list.length ? <p className="muted small">{tt('没有可完整计算的物品。')}</p> : <table className="ui-table"><thead><tr><th>#</th><th>{tt('物品')}</th><th>{costLabel}</th><th>{tt('持有天数')}</th><th>{tt('日均')}</th></tr></thead><tbody>{list.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td><button className="link-cell" onClick={() => onOpen(r.id)}>{r.name}</button></td><td>{money(r.cost_cents)}</td><td>{r.held_days}</td><td>{unitMoney(r.daily_cents)}</td></tr>)}</tbody></table>}</>;
}

export function HoldingCards({ onOpenAsset }: { onOpenAsset: (id: string) => void }) {
  const [scope, setScope] = useState<'held' | 'history'>('held'), [descending, setDescending] = useState(true);
  const [data, setData] = useState<Holding | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    invoke<Holding>('holding', { scope }).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [scope, retry]);
  if (error) return <article className="ui-card ui-content" role="alert"><p>{tt('持有分析读取失败：{error}', { error })}</p><button onClick={() => setRetry(n => n + 1)}>{tt('重新读取')}</button></article>;
  if (!data) return <p role="status" className="muted">{tt('正在读取持有分析…')}</p>;
  const most = Math.max(1, ...data.groups.map(g => g.count));
  return <>
    <article className="ui-card ui-content">
      <div className="ui-section-head"><h3>{tt('持有周期')}</h3><Info text={(scope === 'held' ? tt('当前持有：截至今天') : tt('历史全部：已售出截至售出日'))+tt('；按购入日起的自然月／年纪念日分组，左闭右开。')}/></div>
      <div className="overview-controls"><div className="segmented" role="group" aria-label={tt('持有范围')}>{([['held', tt('当前持有')], ['history', tt('历史全部')]] as const).map(([k, l]) => <button key={k} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}</div></div>
      <div className="holding-stats"><div><span>{tt('平均')}</span><strong>{days(data.average_days)}</strong></div><div><span>{tt('中位数')}</span><strong>{days(data.median_days)}</strong></div><div><span>{tt('最长')}</span><strong>{data.longest ? <button className="link-cell" onClick={() => onOpenAsset(data.longest!.id)}>{tt('{name} · {held_days} 天', { name: data.longest.name, held_days: data.longest.held_days })}</button> : '—'}</strong></div></div>
      <ul className="holding-groups">{data.groups.map(g => <li key={g.key}><span>{g.label}</span><span className="holding-bar"><span style={{ width: `${g.count / most * 100}%` }}/></span><span>{tt('{count} 件', { count: g.count })}</span></li>)}</ul>
      <p className="muted small">{tt('共 {dated_count} 件参与计算', { dated_count: data.dated_count })}{data.unknown_date_count > 0 && tt('；{unknown_date_count} 件购入日期未知，未计入分组与平均', { unknown_date_count: data.unknown_date_count })}。</p>
    </article>
    <article className="ui-card ui-content">
      <div className="ui-section-head"><h3>{tt('日均成本排行')}</h3><Info text={tt('按未舍入的精确值排序，显示值四舍五入到分。')}/></div>
      <div className="overview-controls"><div className="segmented" role="group" aria-label={tt('排序方向')}>{([[true, tt('从高到低')], [false, tt('从低到高')]] as const).map(([k, l]) => <button key={l} aria-pressed={descending === k} onClick={() => setDescending(k)}>{l}</button>)}</div></div>
      <Ranking title={tt('当前持有 · 毛日均')} note={tt('总投入（购入＋维护）÷ 持有天数')} rows={data.held_ranking} costLabel={tt('总投入')} descending={descending} onOpen={onOpenAsset}/>
      <Ranking title={tt('已售出 · 净日均')} note={tt('（总投入 − 售出回收）÷ 截至售出日天数，可为负')} rows={data.sold_ranking} costLabel={tt('净成本')} descending={descending} onOpen={onOpenAsset}/>
      {data.excluded.length > 0 && <details className="trend-table"><summary>{tt('{length} 件资料不完整，未参与排行', { length: data.excluded.length })}</summary><ul className="excluded-list">{data.excluded.map(x => <li key={x.id}><button className="link-cell" onClick={() => onOpenAsset(x.id)}>{x.name}</button><span className="muted">{x.reason}</span></li>)}</ul></details>}
    </article>
  </>;
}

/** U19 售出保值率：售出价 ÷ 购入价，只用购入价，不含维护费；全部历史，不随页面其他筛选变化。 */
export function ResaleCard({ onOpenAsset }: { onOpenAsset: (id: string) => void }) {
  const [descending, setDescending] = useState(true);
  const [data, setData] = useState<ResaleRate | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    invoke<ResaleRate>('resale_rate').then(d => { if (live) setData(d); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  if (error) return <article className="ui-card ui-content resale-card" role="alert"><p>{tt('售出保值率读取失败：{error}', { error })}</p><button onClick={() => setRetry(n => n + 1)}>{tt('重新读取')}</button></article>;
  if (!data) return <p role="status" className="muted">{tt('正在读取售出保值率…')}</p>;
  const list = descending ? data.rows : data.rows.slice().reverse();
  const rated = data.included_count > 0;
  return <article className="ui-card ui-content resale-card">
    <div className="ui-section-head"><h3>{tt('售出保值率')}</h3><Info text={tt('售出价 ÷ 购入价，不含维护费。平均保值率每件同权；总回收率按金额加权。购入价未知或为 ¥0 的物品不参与。全部历史，不随页面其他筛选变化。')}/></div>
    {!rated && data.excluded.length === 0 ? <p className="muted">{tt('还没有售出记录。')}</p> : <>
      <div className="holding-stats">
        <div><span>{tt('平均保值率')}</span><strong>{data.average_rate_hundredths === null ? '—' : percentText(data.average_rate_hundredths)}</strong></div>
        <div><span>{tt('总回收率')}</span><strong>{data.weighted_rate_hundredths === null ? '—' : percentText(data.weighted_rate_hundredths)}</strong></div>
        <div><span>{tt('总盈亏')}</span><strong>{rated ? changeText(data.total_gain_cents) : '—'}</strong></div>
      </div>
      <p className="muted small">{rated ? tt('{included_count} 件参与 · 总购入 {v2} · 总售出 {v3}', { included_count: data.included_count, v2: money(data.total_purchase_cents), v3: money(data.total_sale_cents) }) : tt('没有可计算保值率的售出物品。')}</p>
      {rated && <>
        <div className="overview-controls"><div className="segmented" role="group" aria-label={tt('保值率排序方向')}>{([[true, tt('从高到低')], [false, tt('从低到高')]] as const).map(([k, l]) => <button key={l} aria-pressed={descending === k} onClick={() => setDescending(k)}>{l}</button>)}</div></div>
        <table className="ui-table"><thead><tr><th>#</th><th>{tt('物品')}</th><th>{tt('购入价')}</th><th>{tt('售出价')}</th><th>{tt('差额')}</th><th>{tt('保值率')}</th></tr></thead><tbody>{list.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td><button className="link-cell" title={r.name} onClick={() => onOpenAsset(r.id)}>{r.name}</button></td><td>{money(r.purchase_cents)}</td><td>{money(r.sale_cents)}</td><td>{changeText(r.gain_cents)}</td><td>{percentText(r.rate_hundredths)}</td></tr>)}</tbody></table>
      </>}
      {data.excluded.length > 0 && <details className="trend-table"><summary>{tt('{length} 件未参与保值率', { length: data.excluded.length })}</summary><ul className="excluded-list">{data.excluded.map(x => <li key={x.id}><button className="link-cell" onClick={() => onOpenAsset(x.id)}>{x.name}</button><span className="muted">{x.reason}</span></li>)}</ul></details>}
    </>}
  </article>;
}
