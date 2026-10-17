export const recurringCategories = [['rent', '房租'], ['subscription', '订阅'], ['utilities', '水电网'], ['insurance', '保险'], ['membership', '会员服务'], ['other', '其他']] as const;

export type PlanFields = { auto_renew?: boolean; service_start?: string | null; coverage_start?: string | null; interval_days?: number | null; trial_days?: number | null; name: string; category: string; amount_cents: string; interval_months: number; first_due: string; end_date: string | null; paused: boolean; notes: string };
export type ScheduleRule = { effective_date: string; anchor: string; first_due: string; service_start: string | null; interval_months: number; interval_days: number | null; trial_days: number | null };
export type Resumption = { resumed_on: string; previous_end: string };
export type SubscriptionDetailData = { payment_candidate?: Due | null; pending_has_payments?: boolean; generation: string; plan: Plan; payments: Payment[] };
export type CancelResumptionSave = { request_id: string; generation: string; plan_id: string; expected_revision: number; asset_id: string | null; asset_expected_revision: number | null };
export type ResumeSave = CancelResumptionSave & { start_date: string; first_due?: string; replace_pending?: boolean; amount_cents: string; interval_months: number; interval_days: number | null };
export type Plan = { resumptions?: Resumption[]; rules?: ScheduleRule[]; period_ends?: Record<string,string>; monthly_cents?: string | null; contract_cents?: string | null; estimated_cents?: string | null; paid_cents?: string | null; next_coverage?: [string,string] | null; current_coverage?: [string,string] | null; id: string; fields: PlanFields; revision: number; active_from: string; next_due: string | null; renewal_cents?: string | null; renewal_from?: string | null; special_start?: string | null; special_end?: string | null };
export type PlanSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: PlanFields };
export type Payment = { coverage_start?: string | null; coverage_end?: string | null; id: string; plan_id: string; plan_name: string; due_date: string; state: 'paid' | 'skipped'; paid_date: string | null; amount_cents: string | null; notes: string; revision: number; off_schedule: boolean };
export type PaymentSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; plan_id: string; due_date: string; state: 'paid' | 'skipped'; paid_date: string | null; amount_cents: string | null; notes: string };
export type Due = { coverage_start?: string | null; coverage_end?: string | null; plan_id: string; plan_name: string; category: string; due_date: string; amount_cents: string };
export type Overview = { generation: string; today: string; due: Due[]; upcoming: Due[]; annual_cents: string; monthly_cents: string; next12_cents: string; plans: Plan[]; payments: Payment[] };

export const intervals = [[1, '每月'], [3, '每季'], [6, '每半年'], [12, '每年']] as const;
export const intervalUnit = (f: { interval_days?: number | null; interval_months: number }) => f.interval_days ? `${f.interval_days}天` : ({ 1: '月', 3: '季', 6: '半年', 12: '年' } as Record<number, string>)[f.interval_months] ?? '期';
export const intervalText = (n: number) => intervals.find(([k]) => k === n)?.[1] ?? `每 ${n} 个月`;
/** 固定天数周期：显示“固定 N 天”，与自然月明确区分（设计 §4.2）。 */
export const intervalDaysText = (n: number) => `固定 ${n} 天`;
export const planIntervalText = (f: Pick<PlanFields, 'interval_days' | 'interval_months'>) => f.interval_days ? intervalDaysText(f.interval_days) : intervalText(f.interval_months);
export const recurringCategoryText = (k: string) => recurringCategories.find(([c]) => c === k)?.[1] ?? '其他';
/** Continuing subscriptions need no monthly attention badge; payment facts stay available. */
export function isContinuousSubscription(f: Pick<PlanFields, 'category' | 'end_date'>) {
  return f.category === 'subscription' && f.end_date === null;
}
export function paymentReminders(o: Pick<Overview, 'due' | 'upcoming'> & { plans?: Plan[] }) {
  const quiet = new Set((o.plans ?? []).filter(p => p.fields.category === 'subscription').map(p => p.id));
  return { due: o.due.filter(d => !quiet.has(d.plan_id)), upcoming: o.upcoming.filter(d => !quiet.has(d.plan_id)) };
}
/** Plan status for the list: ended plans no longer have future periods. */
export function pendingSubscriptionStart(p: Pick<Plan, 'fields' | 'resumptions'>, today: string): string | null {
  if (p.fields.category !== 'subscription') return null;
  let start = p.fields.service_start ?? null;
  for (const period of p.resumptions ?? []) {
    if (today < period.resumed_on) return today > period.previous_end ? period.resumed_on : start && start > today ? start : null;
    start = period.resumed_on;
  }
  return start && start > today ? start : null;
}

export function planStatus(p: Plan, today: string) {
  if (p.fields.end_date && p.fields.end_date < today) return `已于 ${p.fields.end_date} 结束`;
  const pending = pendingSubscriptionStart(p, today);
  if (pending) return `待生效 · ${pending}`;
  if (p.fields.paused) return '已暂停';
  return p.fields.end_date ? `进行中，至 ${p.fields.end_date}` : isContinuousSubscription(p.fields) ? '持续续费' : '进行中';
}

export type PaymentRangeSave = { request_id: string; generation: string; plan_id: string; expected_revision: number; from_due: string; to_due: string; amount_cents: string; confirmed: boolean };
