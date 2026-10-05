import type { Plan, PlanFields, ScheduleRule } from './recurring';

/** 固定天数周期按自然日计数：闰年与时区不改变天数（设计 §4.2）。 */
export function shiftDays(day: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T12:00:00Z'))) return day;
  return new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
/** 周期步进：天数周期走 shiftDays，月周期走 shiftMonth（不漂移）。 */
export function shiftPeriod(day: string, f: Pick<PlanFields, 'interval_days' | 'interval_months'>, k: number): string {
  return f.interval_days ? shiftDays(day, f.interval_days * k) : shiftMonth(day, (f.interval_days ?? f.interval_months) * k);
}
export function shiftMonth(day: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T12:00:00Z'))) return day;
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
export function previousDay(day: string) { if (!Number.isFinite(Date.parse(day + 'T12:00:00Z'))) return day; return new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10); }
export function suggestCoverage(start: string, due: string, interval: number, days = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(due))) return due;
  const a = start.split('-').map(Number), b = due.split('-').map(Number);
  const k = days
    ? Math.floor((Date.parse(due) - Date.parse(start)) / 86400000 / interval)
    : Math.max(0, Math.floor(((b[0] - a[0]) * 12 + b[1] - a[1]) / interval));
  const before = days ? shiftDays(start, k * interval) : shiftMonth(start, k * interval);
  const after = days ? shiftDays(start, (k + 1) * interval) : shiftMonth(start, (k + 1) * interval);
  return Math.abs(Date.parse(due) - Date.parse(before)) <= Math.abs(Date.parse(after) - Date.parse(due)) ? before : after;
}
export function blankPlan(today: string): PlanFields {
  // 新建订阅默认：自然月、自动续费（无结束日期）、无试用、无提醒（设计 §3）。
  return { auto_renew: true, interval_days: null, trial_days: null, name: '', category: 'subscription', amount_cents: '', interval_months: 1, first_due: today, service_start: today, coverage_start: today, end_date: null, paused: false, notes: '' };
}
export function firstSubscriptionPeriod(f: PlanFields): [string, string] | null {
  const start = f.service_start;
  if (f.category !== 'subscription' || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start + 'T12:00:00Z'))) return null;
  if (!f.interval_days && ![1, 3, 6, 12].includes(f.interval_months)) return null;
  if (shiftMonth(start, 0) !== start) return null;
  // 免费试用把首个付费期起点推到计费开始日（设计 §4.4）。
  const billing = f.trial_days ? shiftDays(start, f.trial_days) : start;
  const end = previousDay(shiftPeriod(billing, f, 1));
  return [billing, f.end_date && f.end_date >= billing && f.end_date < end ? f.end_date : end];
}
export function periodLabel(from?: string | null, to?: string | null) { return from && to ? `${from} 至 ${to}` : '覆盖期未记录'; }
export function scheduleDates(f: PlanFields, from: string, to: string): string[] {
  const a = f.first_due.split('-').map(Number), b = from.split('-').map(Number);
  const step = f.interval_days ?? f.interval_months;
  const raw = f.interval_days
    ? Math.floor((Date.parse(from) - Date.parse(f.first_due)) / 86400000 / step) - 1
    : Math.floor(((b[0] - a[0]) * 12 + b[1] - a[1]) / step) - 1;
  let k = Math.min(0, raw);
  if (!f.service_start) k = Math.max(0, k);
  if (f.interval_days || f.trial_days) k = Math.max(0, k);
  const out: string[] = [];
  for (; k < 120000; k++) {
    const due = shiftPeriod(f.first_due, f, k);
    if (due > to) break;
    const start = f.coverage_start ? shiftPeriod(f.coverage_start, f, k) : due;
    if (due >= from && (!f.service_start || start >= f.service_start) && (!f.end_date || start <= f.end_date)) out.push(due);
  }
  return out;
}
export function coverageFor(f: PlanFields, due: string): [string, string] | null {
  if (!f.coverage_start) return null;
  // 付款锚点与覆盖锚点分开：月份偏移按原始月差（不除以周期）；
  // 天数周期按自然日差除以 N（设计 §4.1/§4.2）。
  const offset = (Number(due.slice(0, 4)) - Number(f.first_due.slice(0, 4))) * 12 + Number(due.slice(5, 7)) - Number(f.first_due.slice(5, 7));
  const days = Math.round((Date.parse(due) - Date.parse(f.first_due)) / 86400000);
  const start = f.interval_days ? shiftDays(f.coverage_start, days) : shiftMonth(f.coverage_start, offset);
  const end = previousDay(f.interval_days ? shiftDays(f.coverage_start, days + f.interval_days) : shiftMonth(f.coverage_start, offset + f.interval_months));
  return [start, f.end_date && f.end_date < end ? f.end_date : end];
}


/** Billing candidates use the same effective rule chain as saved coverage. */
export function planScheduleDates(plan: Pick<Plan, 'fields' | 'rules' | 'period_ends'>, from: string, to: string): string[] {
  const rules = plan.rules;
  if (!rules?.length || !plan.fields.coverage_start) return scheduleDates(plan.fields, from, to);
  const out: string[] = [];
  let rule = 0, local = 0, previous: string | null = null;
  const first = rules[0];
  if (first.service_start && !first.trial_days && !first.interval_days) {
    const diff = (Number(first.service_start.slice(0,4))-Number(first.anchor.slice(0,4)))*12 + Number(first.service_start.slice(5,7))-Number(first.anchor.slice(5,7));
    for (let k = Math.min(0, Math.floor(diff / first.interval_months)-1); k < 0; k++) {
      const start = shiftPeriod(first.anchor, first, k), due = shiftPeriod(first.first_due,first,k);
      if (due >= from && due <= to && start >= first.service_start && (!plan.fields.end_date || start <= plan.fields.end_date)) out.push(due);
    }
  }
  for (let k = 0; k < 120000; k++) {
    const candidate: string = previous ? shiftDays(previous,1) : first.anchor;
    while (rule + 1 < rules.length && rules[rule+1].effective_date <= candidate) { rule++; local=0; }
    const seg: ScheduleRule = rules[rule];
    const original = shiftPeriod(seg.anchor,seg,local);
    const start = candidate > original ? candidate : original;
    const due = shiftPeriod(seg.first_due,seg,local);
    if (due > to) break;
    const end = plan.period_ends?.[original] ?? previousDay(shiftPeriod(start > original ? start : seg.anchor,seg,start > original ? 1 : local+1));
    if (due >= from && (!seg.service_start || start >= seg.service_start) && (!plan.fields.end_date || start <= plan.fields.end_date) && !(seg.trial_days && start < seg.anchor)) out.push(due);
    previous = end; local++;
  }
  return out;
}

export function suggestedFinalDay(f: PlanFields, today: string): string {
  const anchor = f.coverage_start ?? f.first_due;
  for (let k=0; k<120000; k++) {
    const next = shiftPeriod(anchor,f,k+1);
    if (next > today) return previousDay(next);
  }
  return today;
}

/** Only an unsaved, automatically suggested final day follows schedule edits. */
export function syncSuggestedFinalDay(f: PlanFields, today: string, linked: boolean): PlanFields {
  const anchor = f.coverage_start ?? f.first_due;
  if (!linked || f.end_date === null || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)
    || !Number.isFinite(Date.parse(anchor + 'T12:00:00Z')) || shiftMonth(anchor, 0) !== anchor) return f;
  return { ...f, end_date: suggestedFinalDay(f, today) };
}
