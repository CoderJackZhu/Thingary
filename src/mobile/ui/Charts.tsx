// Small SVG charts. Every chart is role="img" and needs `summary`, a text conclusion that screen readers
// get instead of the picture. Colors come from theme tokens; unknown values (null) are gaps, never zero.
type Num = number | null;
const series = (index: number) => `var(--series-${(index % 7) + 1})`;

/** Line with a soft area under it. `values` oldest first; null breaks the line (not recorded). The last point is marked. */
export function LineAreaChart({ values, summary, height = 56, color = 'var(--accent)', area = true }: { values: Num[]; summary: string; height?: number; color?: string; area?: boolean }) {
  const width = 280, pad = 4, known = values.filter((v): v is number => v != null);
  if (known.length < 2) return <svg role="img" aria-label={summary} className="m-chart" viewBox={`0 0 ${width} ${height}`} height={height}><line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--line)" strokeDasharray="3 4"/></svg>;
  const min = Math.min(...known), max = Math.max(...known), span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2), y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2 - 2);
  const runs: [number, number][][] = []; let run: [number, number][] = [];
  values.forEach((v, i) => { if (v == null) { if (run.length) runs.push(run); run = []; } else run.push([x(i), y(v)]); });
  if (run.length) runs.push(run);
  const last = [...values].reverse().findIndex(v => v != null), lastIndex = values.length - 1 - last;
  return <svg role="img" aria-label={summary} className="m-chart" viewBox={`0 0 ${width} ${height}`} height={height}>
    {runs.map((points, i) => <g key={i}>{area && points.length > 1 && <path d={`M${points[0][0]} ${height}L${points.map(p => p.join(' ')).join('L')}L${points.at(-1)![0]} ${height}Z`} fill={color} opacity=".12"/>}<path d={`M${points.map(p => p.join(' ')).join('L')}`} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></g>)}
    <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r="3.5" fill="var(--card)" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
  </svg>;
}

/** Vertical bars with labels underneath. A null value shows a dashed stub (unknown), 0 shows no bar. */
export function BarChart({ bars, summary, height = 120, color = 'var(--accent)' }: { bars: { label: string; value: Num }[]; summary: string; height?: number; color?: string }) {
  const width = 280, top = 8, base = height - 20, max = Math.max(1, ...bars.map(b => b.value ?? 0)), slot = width / Math.max(1, bars.length), bar = Math.min(28, slot * 0.6);
  return <svg role="img" aria-label={summary} className="m-chart" viewBox={`0 0 ${width} ${height}`} height={height}>
    <line x1="0" x2={width} y1={base} y2={base} stroke="var(--line)"/>
    {bars.map((b, i) => { const cx = slot * i + slot / 2, h = b.value == null ? 0 : (b.value / max) * (base - top); return <g key={i}>
      {b.value == null ? <line x1={cx} x2={cx} y1={base - 10} y2={base} stroke="var(--muted)" strokeDasharray="2 3" strokeWidth="2"/> : <rect x={cx - bar / 2} y={base - h} width={bar} height={h} rx="4" fill={color}/>}
      <text x={cx} y={height - 5} textAnchor="middle" fontSize="10" fill="var(--muted)">{b.label}</text></g>; })}
  </svg>;
}

/** Horizontal bars for rankings. Each row has a label, a bar and the display text of its value. */
export function HBarChart({ rows, summary }: { rows: { label: string; value: Num; display?: string }[]; summary: string }) {
  const max = Math.max(1, ...rows.map(r => r.value ?? 0));
  return <div role="img" aria-label={summary} className="m-hbars">{rows.map((row, i) => <div className="m-hbar" key={i} aria-hidden="true">
    <span className="m-hbar-label">{row.label}</span>
    <span className="m-hbar-track">{row.value != null && <span style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: series(i) }}/>}</span>
    <span className={`m-hbar-value${row.value == null ? ' m-unknown' : ''}`}>{row.display ?? (row.value == null ? '未知' : String(row.value))}</span></div>)}</div>;
}

/** Ring chart for shares of a total, with a centre label. Slices with null or 0 values are skipped. */
export function DonutChart({ slices, summary, center, size = 132 }: { slices: { label: string; value: Num; color?: string }[]; summary: string; center?: { top: string; bottom?: string }; size?: number }) {
  const parts = slices.map((s, i) => ({ ...s, i })).filter(s => (s.value ?? 0) > 0), total = parts.reduce((n, s) => n + s.value!, 0), r = 46, c = 2 * Math.PI * r;
  let offset = 0;
  return <svg role="img" aria-label={summary} className="m-donut" width={size} height={size} viewBox="0 0 120 120">
    <circle cx="60" cy="60" r={r} fill="none" stroke="var(--soft)" strokeWidth="14"/>
    {parts.map(s => { const len = (s.value! / total) * c, dash = `${Math.max(0, len - (parts.length > 1 ? 1.5 : 0))} ${c}`, node = <circle key={s.i} cx="60" cy="60" r={r} fill="none" stroke={s.color ?? series(s.i)} strokeWidth="14" strokeDasharray={dash} strokeDashoffset={-offset} transform="rotate(-90 60 60)"/>; offset += len; return node; })}
    {center && <><text x="60" y={center.bottom ? 58 : 65} textAnchor="middle" fontSize="15" fontWeight="650" fill="var(--text)">{center.top}</text>{center.bottom && <text x="60" y="74" textAnchor="middle" fontSize="9" fill="var(--muted)">{center.bottom}</text>}</>}
  </svg>;
}
