/** Fit only visible, known series; include a zero axis for negative values. */
export function dualLineAxis(series: (string | null)[][], visible: [boolean, boolean]) {
  const values = series.flatMap((line, i) => visible[i] ? line.filter((v): v is string => v !== null).map(Number) : []);
  if (!values.length) return { bottom: 0, top: 1, grid: [0, 1] };
  const min = Math.min(...values), max = Math.max(...values);
  const pad = (max - min) * .15 || Math.max(Math.abs(max) * .05, 10000);
  const lower = min - pad, upper = min < 0 ? Math.max(0, max + pad) : max + pad;
  const span = upper - lower, step = 10 ** Math.floor(Math.log10(span));
  const unit = [1, 2, 5, 10].map(n => n * step).find(n => span / n <= 4) ?? step * 10;
  const bottom = Math.floor(lower / unit) * unit, top = Math.ceil(upper / unit) * unit;
  return { bottom, top, grid: Array.from({ length: Math.round((top - bottom) / unit) + 1 }, (_, i) => bottom + i * unit) };
}
export function toggleTrendLine(visible: [boolean, boolean], index: number): [boolean, boolean] {
  if (visible[index] && visible.filter(Boolean).length === 1) return visible;
  return visible.map((v, i) => i === index ? !v : v) as [boolean, boolean];
}
