/** Fit only visible, known series; include a zero axis for negative values. */
export function dualLineAxis(series: (string | null)[][], visible: [boolean, boolean]) {
  const values = series.flatMap((line, i) => visible[i] ? line.filter((v): v is string => v !== null).map(Number) : []);
  if (!values.length) return { bottom: 0, top: 1, grid: [0, 1] };
  const min = Math.min(...values), max = Math.max(...values);
  const pad = (max - min) * .15 || Math.max(Math.abs(max) * .05, 10000);
  const lower = min >= 0 ? Math.max(0, min - pad) : min - pad, upper = min < 0 ? Math.max(0, max + pad) : max + pad;
  const span = upper - lower, step = 10 ** Math.floor(Math.log10(span));
  const unit = [1, 2, 5, 10].map(n => n * step).find(n => span / n <= 4) ?? step * 10;
  const bottom = Math.floor(lower / unit) * unit, top = Math.ceil(upper / unit) * unit;
  return { bottom, top, grid: Array.from({ length: Math.round((top - bottom) / unit) + 1 }, (_, i) => bottom + i * unit) };
}
export function toggleTrendLine(visible: [boolean, boolean], index: number): [boolean, boolean] {
  if (visible[index] && visible.filter(Boolean).length === 1) return visible;
  return visible.map((v, i) => i === index ? !v : v) as [boolean, boolean];
}

/** Separate known runs so missing observations never acquire a filled value. */
export function trendPaths(points: ({ x: number; y: number } | null)[], baseline: number) {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const p of points) {
    if (p) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const line = (part: { x: number; y: number }[]) => part.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  return {
    line: runs.map(line).join(' '),
    area: runs.filter(part => part.length > 1).map(part => `${line(part)} L${part.at(-1)!.x},${baseline} L${part[0].x},${baseline} Z`).join(' '),
  };
}
