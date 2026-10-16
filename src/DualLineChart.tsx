import { useEffect, useRef, useState } from 'react';
import type { Point } from './wealth';
import { noteSummary, signedMoney } from './wealth';
import { changeLine } from './chart-change';
import { spacedLabels } from './chart-labels';
import { dualLineAxis, toggleTrendLine } from './dual-line-chart';
import { recallTrendLegend, rememberTrendLegend } from './review';
import './dual-line-chart.css';

const W = 640, H = 190, L = 70, B = 24, T = 14;
const axis = (cents: number) => {
  const v = Math.abs(cents), text = v >= 1_000_000 ? `¥${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}万` : `¥${Math.round(v / 100)}`;
  return cents < 0 ? '−' + text : text;
};
export function DualLineChart({ points, kind = 'net', generation, hideAmounts = false, label, single = false }: { points: Point[]; kind?: 'net' | 'balances'; generation?: string; hideAmounts?: boolean; label?: string; single?: boolean }) {
  const [current, setCurrent] = useState<number | null>(null);
  const context = `${generation ?? ''}:${kind}`;
  const [legend, setLegend] = useState<{ context: string; visible: [boolean, boolean] }>(() => ({ context, visible: generation ? recallTrendLegend(generation, kind) : [true, true] }));
  const visible = legend.context === context ? legend.visible : generation ? recallTrendLegend(generation, kind) : [true, true] as [boolean, boolean];
  if (legend.context !== context) setLegend({ context, visible });
  const svgRef = useRef<SVGSVGElement>(null), [plotWidth, setPlotWidth] = useState(W);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPlotWidth(svg.getBoundingClientRect().width);
    measure(); const observer = new ResizeObserver(measure); observer.observe(svg);
    return () => observer.disconnect();
  }, [points.length >= 2]);
  const display = single ? [true, false] as [boolean, boolean] : visible;
  const full = points.filter(p => p.complete);
  if (full.length < (single ? 1 : 2)) return <p className="muted">完成两次完整盘点后显示走势。</p>;
  const names = kind === 'net' ? single ? ['账户金额'] : ['金融净资产', '负债'] : ['流动资金', '投资'];
  const value = (p: Point, i: number): string | null => (kind === 'net' ? i === 0 ? p.net_cents : p.liabilities_cents : i === 0 ? p.liquid_cents : p.invested_cents) ?? null;
  const { bottom, top, grid } = dualLineAxis([full.map(p => value(p, 0)), full.map(p => value(p, 1))], display);
  const start = Date.parse(points[0].date), span = Date.parse(points.at(-1)!.date) - start || 1;
  const x = (date: string) => L + 12 + (W - L - 36) * (Date.parse(date) - start) / span;
  const y = (v: string | number) => T + (H - T - B) * (1 - (Number(v) - bottom) / (top - bottom));
  const scale = Math.min(plotWidth / W, 1), left = (plotWidth - W * scale) / 2, offsetTop = (H - H * scale) / 2;
  const labels = spacedLabels(points, p => x(p.date) * scale, () => Math.max(62 * scale, 60));
  const shown = current === null ? null : full[Math.min(current, full.length - 1)];
  const amount = (p: Point, i: number) => hideAmounts ? '******' : value(p, i) === null ? '未知' : signedMoney(value(p, i)!);
  const change = (p: Point) => hideAmounts ? '较上次 ******' : changeLine(p);
  const spoken = shown ? `${shown.date}，${names.map((name, i) => `${name} ${amount(shown, i)}`).join('，')}，${change(shown)}` : '';
  return <div className="dual-line-chart">
    {!single && <div className="trend-legend" role="group" aria-label="图例，至少保留一条线">{names.map((name, i) => <button key={name} type="button" aria-pressed={visible[i]} disabled={visible[i] && visible.filter(Boolean).length === 1} onClick={() => {
      const next = toggleTrendLine(visible, i); setLegend({ context, visible: next }); if (generation) rememberTrendLegend(generation, kind, next);
    }}><i className={`trend-swatch series-${i}`}/>{name}</button>)}</div>}
    <div className="net-chart dual-plot" tabIndex={0} role="img" aria-label={`${label ? label + '。' : ''}${names.join('与')}同轴趋势，共 ${full.length} 次完整盘点；左右方向键浏览，虚线表示不完整盘点${hideAmounts ? '，金额已隐藏' : ''}`}
      onFocus={() => setCurrent(full.length - 1)} onBlur={() => setCurrent(null)} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); setCurrent(null); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setCurrent(n => Math.max(0, Math.min(full.length - 1, (n ?? full.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1)))); }
      }}>
      <svg ref={svgRef} className="trend-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" onMouseMove={e => {
        const svg = e.currentTarget, matrix = svg.getScreenCTM(); if (!matrix) return;
        const point = svg.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
        const vx = point.matrixTransform(matrix.inverse()).x;
        let best = 0; full.forEach((p, i) => { if (Math.abs(x(p.date) - vx) < Math.abs(x(full[best].date) - vx)) best = i; }); setCurrent(best);
      }} onMouseLeave={() => setCurrent(null)}>
        {grid.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis' : 'grid'}/><text x={L - 6} y={y(v) + 3} textAnchor="end">{hideAmounts ? '******' : axis(v)}</text></g>)}
        {labels.map(p => <text key={p.date} x={x(p.date)} y={H - 6} textAnchor="middle">{p.date}</text>)}
        {points.filter(p => !p.complete).map(p => <line key={p.snapshot_id} x1={x(p.date)} x2={x(p.date)} y1={T} y2={H - B} className="partial-mark"><title>{p.date}：缺 {p.missing} 个账户，总额未知，不画在曲线上</title></line>)}
        {[0, 1].map(i => display[i] && <g key={i} className={`series-${i}`}>
          <path className="dual-line" d={full.reduce((acc, p) => {
            const v = value(p, i); if (v === null) return { d: acc.d, drawing: false };
            return { d: `${acc.d} ${acc.drawing ? 'L' : 'M'}${x(p.date)},${y(v)}`, drawing: true };
          }, { d: '', drawing: false }).d}/>
          {full.map((p, n) => value(p, i) !== null && <circle key={p.snapshot_id} cx={x(p.date)} cy={y(value(p, i)!)} r={n === current ? 5 : 3} className="dual-dot"/>)}
        </g>)}
        {shown && <line x1={x(shown.date)} x2={x(shown.date)} y1={T} y2={H - B} className="partial-mark"/>}
      </svg>
      {shown && <div className="ui-tip" style={{ left: `clamp(100px, ${left + x(shown.date) * scale}px, calc(100% - 100px))`, top: `${offsetTop + T * scale}px` }}>{shown.date}{names.map((name, i) => <b key={name}>{name} {amount(shown, i)}</b>)}<span>{change(shown)}</span>{noteSummary(shown.notes) && !hideAmounts && <span>备注：{noteSummary(shown.notes)}</span>}</div>}
    </div><span className="visually-hidden" aria-live="polite" aria-atomic="true">{spoken}</span>
  </div>;
}
