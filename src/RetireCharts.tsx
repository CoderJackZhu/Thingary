import { spacedLabels } from './chart-labels';
import { useChartScale } from './chart-width';
import { useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { calloutBaselines, compactYuan, refLabelLayout } from './plan-view';
import type { CoverageSeries, SnapshotRow, TrajectoryPoint } from './plan-view';
import './retire.css';
import { t } from './i18n.ts';
const W = 720, H = 300, L = 66, R = 18, T = 48, B = 42;

/** 取整刻度：不超过 count 档、步长为 1/2/5×10^n（分）。 */
export function niceTicks(max: number, count = 5): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(n => n * mag).find(n => n >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}
const ageTicks = (a0: number, a1: number) => {
  const span = a1 - a0, step = span > 40 ? 10 : span > 20 ? 5 : span > 10 ? 2 : 1, out: number[] = [];
  for (let a = Math.ceil(a0 / step) * step; a <= a1 + 1e-9; a += step) out.push(a);
  return out;
};

type Scale = { x: (age: number) => number; y: (v: number) => number; inv: (px: number) => number };
function scales(a0: number, a1: number, top: number): Scale {
  const x = (a: number) => L + ((a - a0) / Math.max(1e-9, a1 - a0)) * (W - L - R), y = (v: number) => T + (1 - v / top) * (H - T - B);
  return { x, y, inv: px => a0 + ((px - L) / (W - L - R)) * (a1 - a0) };
}

function Axes({ s, a0, a1, ticks, mark, positions, label = a => String(a) }: { s: Scale; a0: number; a1: number; ticks: number[]; mark?: { age: number; label: string } | null; label?: (month: number) => string; positions?: number[] }) {
  const ref = useRef<SVGGElement>(null), scale = useChartScale(ref, W, H);
  const labels = spacedLabels(positions ?? ageTicks(a0, a1), a => s.x(a) * scale, a => label(a).length * 10 * scale);
  return <g ref={ref} className="rc-axes">
    {ticks.map(v => <g key={v}><line x1={L} x2={W - R} y1={s.y(v)} y2={s.y(v)} className="rc-grid"/><text x={L - 8} y={s.y(v) + 3.5} textAnchor="end">{v === 0 ? '0' : compactYuan(v)}</text></g>)}
    {labels.map(a => <text key={a} x={s.x(a)} y={H - B + 18} textAnchor="middle">{label(a)}</text>)}
    {mark && <text x={s.x(mark.age)} y={H - B + 33} textAnchor="middle" className="rc-strong">{mark.label}</text>}
    <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="rc-axis"/>
  </g>;
}

/** 指针移动：落在最近的取样点。 */
function useNearest(count: number, months: number[], s: Scale) {
  const [i, setI] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect(), px = ((e.clientX - box.left) / box.width) * W, a = s.inv(px);
    let best = 0;
    for (let k = 1; k < count; k++) if (Math.abs(months[k] - a) < Math.abs(months[best] - a)) best = k;
    setI(px < L - 4 || px > W - R + 4 ? null : best);
  };
  return { i, ref, handlers: { onPointerMove: move, onPointerLeave: () => setI(null) } };
}

function Tip({ s, age, children, lines }: { s: Scale; age: number; children?: ReactNode; lines: [string, string][] }) {
  const left = (s.x(age) / W) * 100;
  return <div className="rc-tip" style={{ left: `${Math.min(78, Math.max(2, left > 60 ? left - 30 : left + 2))}%` }} role="status"><strong>{children}</strong>{lines.map(([k, v]) => <p key={k}><span>{k}</span><b>{v}</b></p>)}</div>;
}

export type TrajectoryProps = {
  points: TrajectoryPoint[]; rows: SnapshotRow[]; goalMonth: number; timeLabel: (month: number) => string; fiMonth: number | null; retireMonth: number | null;
  tone: 'good' | 'watch' | 'bad'; fmt: (cents: number) => string; valueLabel: string;
};

/** 投资组合轨迹：实线＋面积是预计，虚线是所需资金下滑曲线；竖线标出目标月份、财务独立与退休。 */
export function TrajectoryChart({ points, rows, goalMonth, fiMonth, retireMonth, tone, fmt, valueLabel, timeLabel }: TrajectoryProps) {
  const a0 = points[0].month, a1 = points[points.length - 1].month;
  const { top, ticks } = niceTicks(Math.max(...points.map(p => Math.max(p.projected, p.required))) * 1.08);
  const s = scales(a0, a1, top), near = useNearest(points.length, points.map(p => p.month), s);
  const split = retireMonth === null ? points.length : Math.max(1, points.findIndex(p => p.month >= retireMonth));
  const line = (pts: TrajectoryPoint[], k: 'projected' | 'required') => pts.map((p, i) => `${i ? 'L' : 'M'}${s.x(p.month).toFixed(1)} ${s.y(p[k]).toFixed(1)}`).join('');
  const acc = points.slice(0, split + 1), ret = points.slice(split);
  const area = (pts: TrajectoryPoint[]) => pts.length < 2 ? '' : `${line(pts, 'projected')}L${s.x(pts[pts.length - 1].month).toFixed(1)} ${s.y(0)}L${s.x(pts[0].month).toFixed(1)} ${s.y(0)}Z`;
  const goal = points.reduce((b, p) => (Math.abs(p.month - goalMonth) < Math.abs(b.month - goalMonth) ? p : b), points[0]);
  const hover = near.i === null ? null : points[near.i], row = near.i === null ? undefined : rows[near.i];
  const showFi = fiMonth !== null && Math.abs(fiMonth - goalMonth) > 0.01;
  const refs = [{ x: s.x(goalMonth), text: t('目标 · {v1}', { v1: timeLabel(goalMonth) }), fi: false }, ...(showFi ? [{ x: s.x(fiMonth!), text: t('预计不靠工资 · {v1}', { v1: timeLabel(fiMonth!) }), fi: true }] : [])];
  const lay = refLabelLayout(refs.map(r => ({ x: r.x, w: r.text.length * 7.5 })), W - R);
  const gy = calloutBaselines(s.y(goal.projected), s.y(goal.required), H - B - 4), gEnd = s.x(goal.month) > W - R - 60, gx = s.x(goal.month) + (gEnd ? -9 : 9);
  const statusVar = tone === 'good' ? 'var(--positive)' : tone === 'watch' ? 'var(--warn)' : 'var(--error)';
  return <div className="rc-wrap">
    <svg ref={near.ref} className="rc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('预计资金变化，{v1} 至 {v2}，{valueLabel}。目标 {v4} 时预计 {v5}，所需 {v6}', { v1: timeLabel(a0), v2: timeLabel(a1), valueLabel, v4: timeLabel(goalMonth), v5: fmt(goal.projected), v6: fmt(goal.required) })} {...near.handlers}>
      <defs><linearGradient id="rc-acc" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart)" stopOpacity=".28"/><stop offset="1" stopColor="var(--chart)" stopOpacity=".02"/></linearGradient>
        <linearGradient id="rc-ret" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--warn)" stopOpacity=".3"/><stop offset="1" stopColor="var(--warn)" stopOpacity=".02"/></linearGradient></defs>
      <Axes positions={points.map(p => p.month)} label={timeLabel} s={s} a0={a0} a1={a1} ticks={ticks} mark={retireMonth !== null ? { age: retireMonth, label: t('退休') } : null}/>
      <path d={line(points, 'required')} className="rc-required"/>
      <path d={area(acc)} fill="url(#rc-acc)"/><path d={area(ret)} fill="url(#rc-ret)"/>
      <path d={line(acc, 'projected')} className="rc-line" style={{ stroke: 'var(--chart)' }}/><path d={line(ret, 'projected')} className="rc-line" style={{ stroke: 'var(--warn)' }}/>
      <g className="rc-refs">
        <line x1={s.x(goalMonth)} x2={s.x(goalMonth)} y1={T} y2={H - B} className="rc-ref"/>
        {fiMonth !== null && showFi && <line x1={s.x(fiMonth)} x2={s.x(fiMonth)} y1={T} y2={H - B} className="rc-ref rc-fi"/>}
        {refs.map((r, i) => <text key={r.text} x={r.x + (lay[i].end ? -5 : 5)} textAnchor={lay[i].end ? 'end' : 'start'} y={T - 8 - lay[i].row * 18} className={`rc-label${r.fi ? ' rc-fi-text' : ''}`}>{r.text}</text>)}
        {retireMonth !== null && retireMonth !== fiMonth && retireMonth !== goalMonth && <line x1={s.x(retireMonth)} x2={s.x(retireMonth)} y1={T} y2={H - B} className="rc-ref"/>}
        <circle cx={s.x(goal.month)} cy={s.y(goal.projected)} r="4" style={{ fill: statusVar }}/><text x={gx} textAnchor={gEnd ? 'end' : 'start'} y={gy.projected} className="rc-callout" style={{ fill: statusVar }}>{compactYuan(goal.projected)}</text>
        {goal.required > 0 && <><circle cx={s.x(goal.month)} cy={s.y(goal.required)} r="3.5" className="rc-dot-ref"/><text x={gx} textAnchor={gEnd ? 'end' : 'start'} y={gy.required} className="rc-callout rc-muted">{compactYuan(goal.required)}</text></>}
      </g>
      {hover && <g><line x1={s.x(hover.month)} x2={s.x(hover.month)} y1={T} y2={H - B} className="rc-cursor"/><circle cx={s.x(hover.month)} cy={s.y(hover.projected)} r="4" style={{ fill: hover.phase === 'retired' ? 'var(--warn)' : 'var(--chart)' }}/></g>}
    </svg>
    {hover && <Tip s={s} age={hover.month} lines={[
      ['期初资金', fmt(hover.projected)], ...(hover.required > 0 ? [['所需金额', fmt(hover.required)] as [string, string]] : []),
      ...(row && row.phase === 'accumulation' ? [['每年投入', fmt(row.contribution)] as [string, string]] : []),
      ...(row && row.phase === 'retired' ? [['收入/年', fmt(row.income)], ['每年从已有资金中取用', fmt(row.withdrawal)]] as [string, string][] : []),
      ...(row ? [['期末资金', fmt(row.end)] as [string, string]] : []),
    ]}>{hover.label} · {hover.phase === 'retired' ? t('退休阶段') : t('存钱阶段')} · {valueLabel}</Tip>}
    <ul className="rc-legend"><li><i style={{ background: 'var(--chart)' }}/>{t('预计 · 存钱阶段')}</li><li><i style={{ background: 'var(--warn)' }}/>{t('预计 · 退休阶段')}</li><li><i className="rc-dash"/>{t('所需')}</li></ul>
  </div>;
}

const palette = (kind: string, n: number) => kind === 'portfolio' ? 'color-mix(in srgb, var(--chart) 78%, transparent)' : kind === 'unfunded' ? 'color-mix(in srgb, var(--error) 70%, transparent)' : kind === 'pension' ? 'color-mix(in srgb, var(--positive) 45%, var(--chart))' : `color-mix(in srgb, var(--positive) ${Math.max(35, 85 - n * 18)}%, transparent)`;

/** 覆盖随时间：堆叠面积是支出的资金来源，虚线是计划退休支出。 */
export function CoverageChart({ series, fmt, valueLabel }: { series: CoverageSeries; fmt: (cents: number) => string; valueLabel: string }) {
  const pts = series.points;
  if (pts.length < 2) return <p className="muted">{t('资料不足，暂时看不到每年支出由哪些钱承担。')}</p>;
  const a0 = pts[0].month, a1 = pts[pts.length - 1].month + 12;
  const { top, ticks } = niceTicks(Math.max(...pts.map(p => Math.max(p.spend, Object.values(p.values).reduce((a, b) => a + b, 0)))) * 1.08);
  const s = scales(a0, a1, top), near = useNearest(pts.length, pts.map(p => p.month), s);
  let incomeN = 0;
  const layers = series.keys.map(k => ({ k, fill: palette(k.kind, k.kind === 'income' ? incomeN++ : 0) }));
  const stacks = pts.map(p => { let acc = 0; return layers.map(l => { const lo = acc; acc += p.values[l.k.key] ?? 0; return [lo, acc] as const; }); });
  const step = (i: number) => s.x(pts[i].month), end = (i: number) => (i + 1 < pts.length ? s.x(pts[i + 1].month) : s.x(a1));
  const hover = near.i === null ? null : pts[near.i];
  return <div className="rc-wrap">
    <svg ref={near.ref} className="rc-chart rc-short" viewBox={`0 0 ${W} ${H - 40}`} role="img" aria-label={t('覆盖情况随时间变化，{label} 至 {v2}，{valueLabel}', { label: pts[0].label, v2: pts[pts.length - 1].label, valueLabel })} {...near.handlers}>
      <Axes positions={pts.map(p => p.month)} label={m => pts.find(p => p.month === m)?.label ?? ""} s={{ ...s, y: v => T + (1 - v / top) * (H - 40 - T - B) }} a0={a0} a1={a1} ticks={ticks}/>
      {layers.map((l, j) => <g key={l.k.key} fill={l.fill}>{pts.map((_, i) => { const [lo, hi] = stacks[i][j], y = (v: number) => T + (1 - v / top) * (H - 40 - T - B); return hi > lo ? <rect key={i} x={step(i)} width={end(i) - step(i) + .5} y={y(hi)} height={y(lo) - y(hi)}/> : null; })}</g>)}
      <path className="rc-spend" d={pts.map((p, i) => `${i ? 'L' : 'M'}${step(i).toFixed(1)} ${(T + (1 - p.spend / top) * (H - 40 - T - B)).toFixed(1)}L${end(i).toFixed(1)} ${(T + (1 - p.spend / top) * (H - 40 - T - B)).toFixed(1)}`).join('')}/>
      {hover && <line x1={s.x(hover.month)} x2={s.x(hover.month)} y1={T} y2={H - 40 - B} className="rc-cursor"/>}
    </svg>
    {hover && <Tip s={s} age={hover.month} lines={[['计划支出/年', fmt(hover.spend)], ...layers.filter(l => (hover.values[l.k.key] ?? 0) > 0).map(l => [(l.k.kind === 'portfolio' ? '从已有资金中取用' : l.k.label) + '/年', fmt(hover.values[l.k.key])] as [string, string])]}>{hover.label} · {valueLabel}</Tip>}
    <ul className="rc-legend">{layers.map(l => <li key={l.k.key}><i style={{ background: l.fill }}/>{l.k.kind === 'portfolio' ? t('从已有资金中取用') : l.k.kind === 'unfunded' ? t('无资金支持') : l.k.label}</li>)}<li><i className="rc-dash"/>{t('计划支出')}</li></ul>
  </div>;
}

export type FanProps = { months: number[]; timeLabel: (month: number) => string; bands: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] }; goalMonth: number; retireMonth: number | null; fiMonth: number | null; fmt: (cents: number) => string; count: number };

/** 市场路径扇形图：浅色是第 10–90 百分位，深色是第 25–75，线是中位数（不是某一条路径）。 */
export function FanChart({ months, bands, goalMonth, retireMonth, fiMonth, fmt, count, timeLabel }: FanProps) {
  const a0 = months[0], a1 = months[months.length - 1];
  const { top, ticks } = niceTicks(Math.max(...bands.p90) * 1.05);
  const s = scales(a0, a1, top), near = useNearest(months.length, months, s);
  const poly = (hi: number[], lo: number[]) => hi.map((v, i) => `${i ? 'L' : 'M'}${s.x(months[i]).toFixed(1)} ${s.y(v).toFixed(1)}`).join('') + lo.map((_, k) => { const i = lo.length - 1 - k; return `L${s.x(months[i]).toFixed(1)} ${s.y(lo[i]).toFixed(1)}`; }).join('') + 'Z';
  const med = bands.p50.map((v, i) => `${i ? 'L' : 'M'}${s.x(months[i]).toFixed(1)} ${s.y(v).toFixed(1)}`).join('');
  const i = near.i;
  return <div className="rc-wrap">
    <svg ref={near.ref} className="rc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('{count} 条市场路径的第 10 至第 90 百分位区间与中位数', { count })} {...near.handlers}>
      <Axes positions={months} label={timeLabel} s={s} a0={a0} a1={a1} ticks={ticks}/>
      <path d={poly(bands.p90, bands.p10)} className="rc-band-wide"/><path d={poly(bands.p75, bands.p25)} className="rc-band-mid"/>
      <path d={med} className="rc-line" style={{ stroke: 'var(--text)' }}/>
      <line x1={s.x(goalMonth)} x2={s.x(goalMonth)} y1={T} y2={H - B} className="rc-ref"/><text x={s.x(goalMonth) + 5} y={T - 8} className="rc-label">{t('目标 · {v1}', { v1: timeLabel(goalMonth) })}</text>
      {retireMonth !== null && retireMonth !== goalMonth && <><line x1={s.x(retireMonth)} x2={s.x(retireMonth)} y1={T} y2={H - B} className="rc-ref"/><text x={s.x(retireMonth) + 5} y={T - 26} className="rc-label">{t('退休 · {v1}', { v1: timeLabel(retireMonth) })}</text></>}
      {fiMonth !== null && <><line x1={s.x(fiMonth)} x2={s.x(fiMonth)} y1={T} y2={H - B} className="rc-ref rc-fi"/><text x={s.x(fiMonth) + 5} y={T + 12} className="rc-label rc-fi-text">{t('预计不靠工资（中位数） · {v1}', { v1: timeLabel(fiMonth) })}</text></>}
      {i !== null && <line x1={s.x(months[i])} x2={s.x(months[i])} y1={T} y2={H - B} className="rc-cursor"/>}
    </svg>
    {i !== null && <Tip s={s} age={months[i]} lines={[['第 90 百分位', fmt(bands.p90[i])], ['第 75 百分位', fmt(bands.p75[i])], ['中位数', fmt(bands.p50[i])], ['第 25 百分位', fmt(bands.p25[i])], ['第 10 百分位', fmt(bands.p10[i])]]}>{timeLabel(months[i])}</Tip>}
    <ul className="rc-legend"><li><i className="rc-swatch-wide"/>{t('第 10 至第 90 百分位区间')}</li><li><i className="rc-swatch-mid"/>{t('第 25 至第 75')}</li><li><i style={{ background: 'var(--text)' }}/>{t('中位数')}</li></ul>
  </div>;
}

/** 崩盘路径：每条路径从退休当年开始的资产。 */
export function PathsChart({ paths, fmt }: { paths: { id: string; label: string; months: number[]; calendar_months: string[]; path: number[] }[]; fmt: (cents: number) => string }) {
  const a0 = paths[0].months[0], a1 = paths[0].months[paths[0].months.length - 1];
  const { top, ticks } = niceTicks(Math.max(...paths.flatMap(p => p.path)) * 1.05);
  const s = scales(a0, a1, top), near = useNearest(paths[0].months.length, paths[0].months, s);
  const color = ['var(--text)', 'var(--error)', 'var(--warn)', 'color-mix(in srgb, var(--error) 60%, var(--warn))', 'var(--muted)'];
  const i = near.i;
  return <div className="rc-wrap">
    <svg ref={near.ref} className="rc-chart rc-short" viewBox={`0 0 ${W} ${H - 40}`} role="img" aria-label={t('{length} 条崩盘路径的资产', { length: paths.length })} {...near.handlers}>
      <Axes positions={paths[0].months} label={m => paths[0].calendar_months[paths[0].months.indexOf(m)] ?? ""} s={{ ...s, y: v => T + (1 - v / top) * (H - 40 - T - B) }} a0={a0} a1={a1} ticks={ticks}/>
      {paths.map((p, k) => <path key={p.id} className="rc-line" style={{ stroke: color[k % color.length], strokeDasharray: p.id === 'base' ? undefined : '0' }} d={p.path.map((v, j) => `${j ? 'L' : 'M'}${s.x(p.months[j]).toFixed(1)} ${(T + (1 - v / top) * (H - 40 - T - B)).toFixed(1)}`).join('')}/>)}
      {i !== null && <line x1={s.x(paths[0].months[i])} x2={s.x(paths[0].months[i])} y1={T} y2={H - 40 - B} className="rc-cursor"/>}
    </svg>
    {i !== null && <Tip s={s} age={paths[0].months[i]} lines={paths.map(p => [p.label, fmt(p.path[i])] as [string, string])}>{paths[0].calendar_months[i]}</Tip>}
    <ul className="rc-legend">{paths.map((p, k) => <li key={p.id}><i style={{ background: color[k % color.length] }}/>{p.label}</li>)}</ul>
  </div>;
}
