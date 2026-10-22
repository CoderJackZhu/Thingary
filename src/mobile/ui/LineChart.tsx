// Pixel-true line chart for the phone UI: measures its own width (ResizeObserver) and draws in real pixels, so strokes
// and text keep their size on every screen. Smooth monotone curves, area fill, last-point label, press-and-drag scrub.
// Values are integer cents; null is a gap (never zero, never bridged). `hidden` masks every amount.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { areaPath, axisLabel, lineAxis, monotonePath, nearestIndex, runsOf, xTicks } from './chart-model';

type Num = number | null;
export type LineSeries = { name: string; values: Num[]; color?: string; dashed?: boolean; area?: boolean };
export type ScrubTip = { title: string; rows: { name: string; value: string; color?: string }[]; note?: string };
export type LineChartProps = {
  series: LineSeries[];
  /** x labels per index (e.g. dates). Axis shows the first, a middle and the last one. */
  labels: string[];
  /** Numeric x per index (e.g. timestamps) for uneven spacing; default evenly spaced. */
  xs?: number[];
  summary: string;
  height?: number;
  /** Sparkline: no axes, grid, labels or scrub. */
  compact?: boolean;
  hidden?: boolean;
  /** Vertical dashed marker at index `at` with a short label (plan: 预计停工). */
  marker?: { at: number; label: string };
  /** Light red range between two x positions (same unit as `xs`, or indices) (plan: funds depleted). */
  shade?: { from: number; to: number; label?: string };
  /** Floating label while scrubbing; default lists every series value. */
  tip?: (index: number) => ScrubTip;
  className?: string;
  children?: ReactNode;
};

const PAD_X = 8, TOP = 14, BOTTOM_AXIS = 22;
const money = (cents: number, hidden: boolean) => hidden ? '******' : axisLabel(cents);

export function LineChart({ series, labels, xs, summary, height = 180, compact = false, hidden = false, marker, shade, tip, className, children }: LineChartProps) {
  const id = useId().replace(/:/g, ''), box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0), [scrub, setScrub] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const count = labels.length, h = compact ? height : Math.max(height, 120);
  const top = compact ? 6 : TOP, bottom = h - (compact ? 6 : BOTTOM_AXIS), left = compact ? 6 : PAD_X, right = width - (compact ? 6 : PAD_X);
  const pos = xs && xs.length === count ? xs : labels.map((_, i) => i);
  const x0 = pos[0] ?? 0, span = (pos.at(-1) ?? 0) - x0 || 1;
  const px = (v: number) => left + (right - left) * (v - x0) / span;
  const axis = lineAxis(series.map(s => s.values));
  const py = (v: number) => top + (bottom - top) * (1 - (v - axis.bottom) / (axis.top - axis.bottom || 1));
  const known = series.some(s => s.values.some(v => v !== null));
  const cls = `m-linechart${compact ? ' m-linechart-compact' : ''}${className ? ' ' + className : ''}`;
  if (!known || count < 2) return <div ref={box} className={cls} style={{ height: h }}><svg role="img" aria-label={summary} width={width || '100%'} height={h}><line x1={left} x2={Math.max(left, right)} y1={bottom - 4} y2={bottom - 4} className="m-lc-grid" strokeDasharray="3 4"/></svg></div>;

  const drawn = series.map((s, si) => {
    const pts = s.values.map((v, i) => v === null ? null : { x: px(pos[i]), y: py(v) });
    const runs = runsOf(pts), color = s.color ?? (si === 0 ? 'var(--accent)' : 'var(--muted)');
    return { s, si, color, runs, last: pts.reduceRight<{ x: number; y: number; i: number } | null>((found, p, i) => found ?? (p ? { ...p, i } : null), null) };
  });
  const primary = drawn[0], lastValue = primary.last ? primary.s.values[primary.last.i]! : null;
  const place = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect(), at = nearestIndex(pos.map(px), e.clientX - rect.left);
    setScrub(at < 0 ? null : at);
  };
  const info: ScrubTip | null = scrub === null || compact ? null : tip ? tip(scrub) : { title: labels[scrub], rows: series.map((s, i) => ({ name: s.name, value: s.values[scrub] === null ? '未知' : hidden ? '******' : axisLabel(s.values[scrub]!), color: drawn[i].color })) };
  const sx = scrub === null ? 0 : px(pos[scrub]), flip = sx > width / 2;
  const shadeX = shade && [Math.max(left, px(shade.from)), Math.min(right, px(shade.to))] as const;
  const mx = marker && marker.at >= 0 && marker.at < count ? px(pos[marker.at]) : null;
  const ticks = compact ? [] : xTicks(count);
  const labelX = primary.last ? Math.min(Math.max(primary.last.x, left + 28), right - 0) : 0;

  return <div ref={box} className={cls} style={{ height: h }}>
    {width > 0 && <svg role="img" aria-label={summary} width={width} height={h} viewBox={`0 0 ${width} ${h}`}
      onPointerDown={compact ? undefined : e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ } place(e); }}
      onPointerMove={compact ? undefined : e => { if (e.buttons || e.pointerType === 'touch' || e.pointerType === 'pen') place(e); }}
      onPointerUp={() => setScrub(null)} onPointerCancel={() => setScrub(null)} onPointerLeave={e => { if (e.pointerType === 'mouse') setScrub(null); }}>
      <defs>{drawn.map(d => <linearGradient key={d.si} id={`${id}-${d.si}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={d.color} stopOpacity=".28"/><stop offset="1" stopColor={d.color} stopOpacity="0"/></linearGradient>)}</defs>
      {!compact && axis.grid.map(v => <g key={v}><line x1={left} x2={right} y1={py(v)} y2={py(v)} className={v === 0 ? 'm-lc-axis' : 'm-lc-grid'}/><text x={left} y={py(v) - 4} className="m-lc-text">{money(v, hidden)}</text></g>)}
      {shadeX && shadeX[1] > shadeX[0] && <g><rect x={shadeX[0]} y={top} width={shadeX[1] - shadeX[0]} height={bottom - top} className="m-lc-shade"/>{shade!.label && <text x={shadeX[1] - 4} y={top + 12} textAnchor="end" className="m-lc-text m-lc-bad">{shade!.label}</text>}</g>}
      {mx !== null && <g><line x1={mx} x2={mx} y1={top} y2={bottom} className="m-lc-marker"/><text x={Math.min(Math.max(mx, left + 24), right - 24)} y={top - 3} textAnchor="middle" className="m-lc-text m-lc-mark">{marker!.label}</text></g>}
      {drawn.map(d => <g key={d.si}>
        {(d.s.area ?? d.si === 0) && d.runs.map((run, i) => <path key={i} d={areaPath(run, bottom)} fill={`url(#${id}-${d.si})`}/>)}
        {d.runs.map((run, i) => run.length === 1 ? <circle key={i} cx={run[0].x} cy={run[0].y} r="2.5" fill={d.color}/> : <path key={i} d={monotonePath(run)} fill="none" stroke={d.color} strokeWidth={compact ? 2 : 2.25} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={d.s.dashed ? '5 4' : undefined}/>)}
      </g>)}
      {primary.last && <circle cx={primary.last.x} cy={primary.last.y} r={compact ? 3.5 : 4} className="m-lc-dot" stroke={primary.color}/>}
      {!compact && primary.last && lastValue !== null && <text x={labelX} y={Math.max(top + 10, primary.last.y - 10)} textAnchor="end" className="m-lc-text m-lc-last">{money(lastValue, hidden)}</text>}
      {ticks.map((t, k) => <text key={t} x={Math.min(Math.max(px(pos[t]), left + 24), right - 24)} y={h - 5} textAnchor={k === 0 && px(pos[t]) < left + 24 ? 'start' : k === ticks.length - 1 && px(pos[t]) > right - 24 ? 'end' : 'middle'} className="m-lc-text">{labels[t]}</text>)}
      {scrub !== null && !compact && <g><line x1={sx} x2={sx} y1={top} y2={bottom} className="m-lc-guide"/>{drawn.map(d => d.s.values[scrub] !== null && <circle key={d.si} cx={sx} cy={py(d.s.values[scrub]!)} r="4.5" className="m-lc-dot" stroke={d.color}/>)}</g>}
    </svg>}
    {info && <div className={`m-lc-tip${flip ? ' m-lc-tip-left' : ''}`} style={{ left: sx }} aria-hidden="true"><strong>{info.title}</strong>{info.rows.map(row => <span key={row.name}><i style={{ background: row.color }}/>{row.name}<b>{row.value}</b></span>)}{info.note && <small>{info.note}</small>}</div>}
    {children}
  </div>;
}
