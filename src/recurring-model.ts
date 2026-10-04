import type { PlanFields } from './recurring';

export function shiftMonth(day: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T12:00:00Z'))) return day;
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
export function previousDay(day: string) { if (!Number.isFinite(Date.parse(day + 'T12:00:00Z'))) return day; return new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10); }
export function suggestCoverage(start: string, due: string, interval: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(due))) return due;
  const a = start.split('-').map(Number), b = due.split('-').map(Number);
  const k = Math.max(0, Math.floor(((b[0] - a[0]) * 12 + b[1] - a[1]) / interval));
  const before = shiftMonth(start, k * interval), after = shiftMonth(start, (k + 1) * interval);
  return Math.abs(Date.parse(due) - Date.parse(before)) <= Math.abs(Date.parse(after) - Date.parse(due)) ? before : after;
}
export function blankPlan(today: string): PlanFields {
  return { name: '', category: 'subscription', amount_cents: '', interval_months: 1, first_due: today, service_start: today, coverage_start: today, end_date: null, paused: false, notes: '' };
}
export function periodLabel(from?: string | null, to?: string | null) { return from && to ? `${from} 至 ${to}` : '覆盖期未记录'; }
export function scheduleDates(f: PlanFields, from: string, to: string): string[] {
  const a = f.first_due.split('-').map(Number), b = from.split('-').map(Number);
  let k = Math.min(0, Math.floor(((b[0] - a[0]) * 12 + b[1] - a[1]) / f.interval_months) - 1);
  if (!f.service_start) k = Math.max(0, k);
  const out: string[] = [];
  for (; k < 120000; k++) {
    const due = shiftMonth(f.first_due, k * f.interval_months);
    if (due > to) break;
    const start = f.coverage_start ? shiftMonth(f.coverage_start, k * f.interval_months) : due;
    if (due >= from && (!f.service_start || start >= f.service_start) && (!f.end_date || start <= f.end_date)) out.push(due);
  }
  return out;
}
export function coverageFor(f: PlanFields, due: string): [string, string] | null {
  if (!f.coverage_start) return null;
  const a = f.first_due.split('-').map(Number), b = due.split('-').map(Number);
  const months = (b[0] - a[0]) * 12 + b[1] - a[1];
  const start = shiftMonth(f.coverage_start, months), end = previousDay(shiftMonth(f.coverage_start, months + f.interval_months));
  return [start, f.end_date && f.end_date < end ? f.end_date : end];
}
