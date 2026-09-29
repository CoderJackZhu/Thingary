import { useState } from 'react';
import type { Point } from './wealth';
import { changeText, rateText, signedMoney } from './wealth';

// U16-D3/D4（规范 4.5）：总览净资产卡里的小折线。只连完整盘点，不完整盘点画虚线竖标；
// 不画纵轴。悬停或聚焦后方向键浏览，浮层即时显示日期、净资产与较上次变化。
const W = 600, H = 78, PAD = 8;
const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

export function changeLine(p: Point) {
  if (!p.compared_to) return '第一份完整盘点';
  if (p.change_cents === null) return '账户范围变化，暂不可比';
  return `较上次 ${changeText(p.change_cents)}${p.change_rate_hundredths === null ? '' : `（${rateText(p.change_rate_hundredths)}）`}`;
}

export function Sparkline({ points }: { points: Point[] }) {
  const full = points.filter(p => p.complete);
  const [cur, setCur] = useState<number | null>(null);
  if (full.length < 2) return <p className="ui-sub">完成两次完整盘点后显示走势。</p>;
  const x0 = day(points[0].date), x1 = Math.max(day(points.at(-1)!.date), x0 + 1);
  const values = full.map(p => Number(p.net_cents)), lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (d: string) => PAD + (day(d) - x0) / (x1 - x0) * (W - 2 * PAD);
  const y = (cents: string) => H - 10 - (Number(cents) - lo) / span * (H - 24);
  const line = full.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.net_cents).toFixed(1)}`).join(' ');
  const area = `${line} L${x(full.at(-1)!.date).toFixed(1)} ${H} L${x(full[0].date).toFixed(1)} ${H}Z`;
  const months = [...new Map(points.map(p => [p.date.slice(0, 7), p])).values()];
  const shown = cur === null ? null : full[cur];
  const move = (clientX: number, box: DOMRect) => {
    const vx = (clientX - box.left) / box.width * W;
    let best = 0; full.forEach((p, i) => { if (Math.abs(x(p.date) - vx) < Math.abs(x(full[best].date) - vx)) best = i; });
    setCur(best);
  };
  return <><div className="ui-spark" tabIndex={0} role="img" aria-label={`金融净资产趋势，共 ${full.length} 次完整盘点`}
    onFocus={() => setCur(full.length - 1)} onBlur={() => setCur(null)}
    onKeyDown={e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setCur(c => Math.min(full.length - 1, (c ?? -1) + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setCur(c => Math.max(0, (c ?? full.length) - 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); setCur(null); }
    }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={e => move(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setCur(null)}>
      <path className="area" d={area}/><path className="line" d={line}/>
      {points.filter(p => !p.complete).map(p => <line key={p.snapshot_id} className="partial" x1={x(p.date)} x2={x(p.date)} y1={4} y2={H - 4}/>)}
      {shown && <line className="guide" x1={x(shown.date)} x2={x(shown.date)} y1={4} y2={H - 4}/>}
    </svg>
    {full.map((p, i) => <i key={p.snapshot_id} className={'ui-spark-dot' + (i === cur ? ' on' : i === full.length - 1 ? ' last' : '')} style={{ left: `${x(p.date) / W * 100}%`, top: `${y(p.net_cents) / H * 78}px` }}/>)}
    <div className="ui-spark-labels" aria-hidden="true">{months.map(p => <span key={p.date} style={{ left: `${x(p.date) / W * 100}%` }}>{Number(p.date.slice(5, 7))}月{p.complete ? '' : '未盘'}</span>)}</div>
    {shown && <div className="ui-tip" style={{ left: `clamp(70px, ${x(shown.date) / W * 100}%, calc(100% - 70px))`, top: `${y(shown.net_cents) / H * 78}px` }}>{shown.date}<b>{signedMoney(shown.net_cents)}</b><span className={shown.change_cents?.startsWith('-') ? 'neg' : shown.change_cents && shown.change_cents !== '0' ? 'pos' : undefined}>{changeLine(shown)}</span></div>}
    </div><span className="visually-hidden" aria-live="polite" aria-atomic="true">{shown ? `${shown.date}，净资产 ${signedMoney(shown.net_cents)}，${changeLine(shown)}` : ''}</span>
  </>;
}
