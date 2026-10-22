import { useEffect, useId, useRef, useState } from 'react';
import type { Point } from './wealth';
import { noteSummary, signedMoney } from './wealth';
import { changeLine } from './chart-change';
import { spacedLabels } from './chart-labels';
import { dualLineAxis, toggleTrendLine, trendPaths } from './dual-line-chart';
import { defaultTrendLegend, recallTrendLegend, rememberTrendLegend } from './review';
import './dual-line-chart.css';
import { t } from './i18n.ts';
const H = 300, L = 70, B = 38, T = 28;
const axis = (cents: number) => {
  const v = Math.abs(cents), text = v >= 1_000_000 ? `¥${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}万` : `¥${Math.round(v / 100)}`;
  return cents < 0 ? '−' + text : text;
};
export function DualLineChart({ points, kind = 'net', generation, hideAmounts = false, label, single = false }: { points: Point[]; kind?: 'net' | 'balances'; generation?: string; hideAmounts?: boolean; label?: string; single?: boolean }) {
  const gradientId = useId();
  const [current, setCurrent] = useState<number | null>(null);
  const context = `${generation ?? ''}:${kind}`;
  const initial = () => generation ? recallTrendLegend(generation, kind) : defaultTrendLegend(kind);
  const [legend, setLegend] = useState<{ context: string; visible: boolean[] }>(() => ({ context, visible: initial() }));
  const visible = legend.context === context ? legend.visible : initial();
  if (legend.context !== context) setLegend({ context, visible });
  const full = points.filter(p => p.complete);
  const drawable = full.length >= (single ? 1 : 2);
  const svgRef = useRef<SVGSVGElement>(null), [plotWidth, setPlotWidth] = useState(640);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPlotWidth(svg.getBoundingClientRect().width);
    measure(); const observer = new ResizeObserver(measure); observer.observe(svg);
    return () => observer.disconnect();
  }, [drawable]);
  const W = Math.max(plotWidth, 260);
  const display = single ? [true, false, false] : visible;
  if (!drawable) return <p className="muted">{t('完成两次完整盘点后显示走势。')}</p>;
  const names = kind === 'net' ? single ? ['账户金额'] : ['金融净资产', '金融资产', '负债'] : ['流动资金', '投资'];
  const value = (p: Point, i: number): string | null => (kind === 'net' ? [p.net_cents, p.assets_cents, p.liabilities_cents][i] : i === 0 ? p.liquid_cents : p.invested_cents) ?? null;
  const known = full.some(p => display.some((on, i) => on && value(p, i) !== null));
  const { bottom, top, grid } = dualLineAxis(names.map((_, i) => full.map(p => value(p, i))), display);
  const start = Date.parse(points[0].date), span = Date.parse(points.at(-1)!.date) - start || 1;
  const x = (date: string) => L + 12 + (W - L - 68) * (Date.parse(date) - start) / span;
  const y = (v: string | number) => T + (H - T - B) * (1 - (Number(v) - bottom) / (top - bottom));
  const labels = spacedLabels(points, p => x(p.date), () => 86);
  const shown = current === null ? null : full[Math.min(current, full.length - 1)];
  const amount = (p: Point, i: number) => hideAmounts ? '******' : value(p, i) === null ? '未知' : signedMoney(value(p, i)!);
  const change = (p: Point) => kind === 'balances' ? '账户余额变化含存取与估值，不等于收益' : !display[0] ? '资产与负债为各次盘点的账户金额，净资产 = 资产 − 负债' : hideAmounts ? '较上次 ******' : changeLine(p);
  const shownNames = names.flatMap((name, i) => display[i] ? [{ name, i }] : []);
  const colors = ['var(--chart)', 'var(--series-2)'];
  const paths = names.map((_, i) => trendPaths(full.map(p => { const v = value(p, i); return v === null ? null : { x: x(p.date), y: y(v) }; }), y(bottom < 0 ? 0 : bottom)));
  const spoken = shown ? `${shown.date}，${shownNames.map(({name, i}) => `${name} ${amount(shown, i)}`).join('，')}，${change(shown)}` : '';
  return <div className={`dual-line-chart history-chart chart-${kind}`}>
    <div className="net-chart dual-plot" tabIndex={0} role="img" aria-label={`${label ? label + '。' : ''}${shownNames.map(s => s.name).join('与')}同轴趋势，共 ${full.length} 次完整盘点；左右方向键浏览，虚线表示不完整盘点${hideAmounts ? '，金额已隐藏' : ''}`}
      onFocus={() => setCurrent(full.length - 1)} onBlur={() => setCurrent(null)} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); setCurrent(null); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setCurrent(n => Math.max(0, Math.min(full.length - 1, (n ?? full.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1)))); }
      }}>
      <svg ref={svgRef} className="trend-chart history-trend" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" onMouseMove={e => {
        const svg = e.currentTarget, matrix = svg.getScreenCTM(); if (!matrix) return;
        const point = svg.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
        const vx = point.matrixTransform(matrix.inverse()).x;
        let best = 0; full.forEach((p, i) => { if (Math.abs(x(p.date) - vx) < Math.abs(x(full[best].date) - vx)) best = i; }); setCurrent(best);
      }} onMouseLeave={() => setCurrent(null)}>
        <defs>{colors.map((color, i) => <linearGradient key={i} id={`${gradientId}-${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".24"/><stop offset="1" stopColor={color} stopOpacity=".02"/></linearGradient>)}</defs>
        {!known && <text x={W / 2} y={H / 2} textAnchor="middle">{t('所选范围暂无已知金额')}</text>}
        {known && grid.map(v => <g key={v}><line x1={L} x2={W - 24} y1={y(v)} y2={y(v)} className={v === 0 ? 'history-axis' : 'history-grid'}/><text x={L - 6} y={y(v) + 3} textAnchor="end">{hideAmounts ? '******' : axis(v)}</text></g>)}
        {labels.map(p => <text key={p.date} x={x(p.date)} y={H - 8} textAnchor="middle">{p.date}</text>)}
        {points.filter(p => !p.complete).map(p => <line key={p.snapshot_id} x1={x(p.date)} x2={x(p.date)} y1={T} y2={H - B} className="partial-mark"><title>{t('{date}：缺 {missing} 个账户，总额未知，不画在曲线上', { date: p.date, missing: p.missing })}</title></line>)}
        {names.map((_, i) => display[i] && <g key={i} className={`series-${i}`}>
          {colors[i] && (kind === 'balances' || i === 0) && <path className="history-area" d={paths[i].area} fill={`url(#${gradientId}-${i})`}/>}
          <path className="dual-line" d={paths[i].line}/>
          {full.map((p, n) => value(p, i) !== null && <circle key={p.snapshot_id} cx={x(p.date)} cy={y(value(p, i)!)} r={n === current ? 4.5 : 3.5} className={`dual-dot${(!full[n - 1] || value(full[n - 1], i) === null) && (!full[n + 1] || value(full[n + 1], i) === null) ? ' isolated' : ''}${n === full.length - 1 ? ' last' : ''}${n === current ? ' current' : ''}`}/>)}
        </g>)}
        {shown && <line x1={x(shown.date)} x2={x(shown.date)} y1={T} y2={H - B} className="history-cursor"/>}
      </svg>
      {shown && <div className="history-chart-tip" style={{ left: `${Math.max(8, Math.min(W - 254, x(shown.date) + 14))}px` }}><strong>{shown.date}</strong>{shownNames.map(({name, i}) => <p key={name}><span><i className={`tip-swatch series-${i}`}/>{name}</span><b>{amount(shown, i)}</b></p>)}<small>{change(shown)}</small>{shown.has_unchanged && <small>{t('含沿用金额，并非全部当日核对')}</small>}{noteSummary(shown.notes) && !hideAmounts && <small>{t('备注：{v1}', { v1: noteSummary(shown.notes) })}</small>}</div>}
    </div>
    {!single && <div className="trend-legend" role="group" aria-label={t('图例，至少保留一条线')}>{names.map((name, i) => <button key={name} type="button" aria-pressed={visible[i]} disabled={visible[i] && visible.filter(Boolean).length === 1} onClick={() => {
      const next = toggleTrendLine(visible, i); setLegend({ context, visible: next }); if (generation) rememberTrendLegend(generation, kind, next);
    }}><i className={`trend-swatch series-${i}`}/>{name}</button>)}</div>}
    <span className="visually-hidden" aria-live="polite" aria-atomic="true">{spoken}</span>
  </div>;
}
