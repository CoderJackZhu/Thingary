// Pure helpers for LineChart: axis ticks and labels, monotone cubic paths, scrub hit-testing. Money is integer cents.
import { dualLineAxis } from '../../dual-line-chart.ts';
import { t as tr } from '../../i18n.ts';
type Num = number | null;
export type Pt = { x: number; y: number };

/** 纵轴刻度：整万显示「12万」，不足一万的显示元，亿以上「1.2亿」；负数用「−」。 */
export function axisLabel(cents: number): string {
  const yuan = Math.abs(cents) / 100, sign = cents < 0 ? '−' : '';
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (yuan >= 1e8) return tr('{sign}{v2}亿', { sign, v2: trim(yuan / 1e8) });
  if (yuan >= 1e4) return tr('{sign}{v2}万', { sign, v2: trim(yuan / 1e4) });
  return `${sign}${Math.round(yuan)}`;
}

/** Fit all known values of the visible series; at most 4 grid lines (every other tick when the nice step gives 5). */
export function lineAxis(series: Num[][]): { bottom: number; top: number; grid: number[] } {
  const axis = dualLineAxis(series.map(line => line.map(v => v === null ? null : String(v))), series.map(() => true));
  const grid = axis.grid.length > 4 ? axis.grid.filter((_, i) => i % 2 === 0) : axis.grid;
  return { bottom: axis.bottom, top: axis.top, grid };
}

/** Split into runs of known points so a gap (null) never gets bridged. */
export function runsOf(points: (Pt | null)[]): Pt[][] {
  const runs: Pt[][] = []; let run: Pt[] = [];
  for (const p of points) { if (p) run.push(p); else { if (run.length) runs.push(run); run = []; } }
  if (run.length) runs.push(run);
  return runs;
}

/** Monotone cubic (Fritsch–Carlson) through one run: the curve never overshoots the data. x must be strictly increasing. */
export function monotonePath(run: Pt[]): string {
  const n = run.length;
  if (!n) return '';
  const f = (v: number) => Math.round(v * 100) / 100, head = `M${f(run[0].x)},${f(run[0].y)}`;
  if (n === 1) return head;
  if (n === 2) return `${head}L${f(run[1].x)},${f(run[1].y)}`;
  const dx = run.slice(1).map((p, i) => p.x - run[i].x), slope = run.slice(1).map((p, i) => (p.y - run[i].y) / (dx[i] || 1));
  const m = run.map((_, i) => i === 0 ? slope[0] : i === n - 1 ? slope[n - 2] : slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i]; }
  }
  let d = head;
  for (let i = 0; i < n - 1; i++) { const w = dx[i] / 3; d += `C${f(run[i].x + w)},${f(run[i].y + m[i] * w)} ${f(run[i + 1].x - w)},${f(run[i + 1].y - m[i + 1] * w)} ${f(run[i + 1].x)},${f(run[i + 1].y)}`; }
  return d;
}

/** Closed area under one smoothed run, down to `base`. */
export function areaPath(run: Pt[], base: number): string {
  if (run.length < 2) return '';
  return `${monotonePath(run)}L${run.at(-1)!.x},${base}L${run[0].x},${base}Z`;
}

/** Index of the nearest x. Returns -1 for an empty list. */
export function nearestIndex(xs: number[], px: number): number {
  let best = -1;
  xs.forEach((x, i) => { if (best < 0 || Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
  return best;
}

/** X-axis label positions: first, one in the middle, last (just first/last when fewer than 3 points). */
export function xTicks(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  return count < 3 ? [0, count - 1] : [0, Math.floor((count - 1) / 2), count - 1];
}
