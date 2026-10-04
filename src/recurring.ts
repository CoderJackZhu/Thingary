export const recurringCategories = [['rent', '房租'], ['subscription', '订阅'], ['utilities', '水电网'], ['insurance', '保险'], ['membership', '会员服务'], ['other', '其他']] as const;

export type PlanFields = { service_start?: string | null; coverage_start?: string | null; name: string; category: string; amount_cents: string; interval_months: number; first_due: string; end_date: string | null; paused: boolean; notes: string };
export type Plan = { monthly_cents?: string | null; contract_cents?: string | null; estimated_cents?: string | null; paid_cents?: string | null; next_coverage?: [string,string] | null; id: string; fields: PlanFields; revision: number; active_from: string; next_due: string | null };
export type PlanSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: PlanFields };
export type Payment = { coverage_start?: string | null; coverage_end?: string | null; id: string; plan_id: string; plan_name: string; due_date: string; state: 'paid' | 'skipped'; paid_date: string | null; amount_cents: string | null; notes: string; revision: number; off_schedule: boolean };
export type PaymentSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; plan_id: string; due_date: string; state: 'paid' | 'skipped'; paid_date: string | null; amount_cents: string | null; notes: string };
export type Due = { coverage_start?: string | null; coverage_end?: string | null; plan_id: string; plan_name: string; category: string; due_date: string; amount_cents: string };
export type Overview = { generation: string; today: string; due: Due[]; upcoming: Due[]; annual_cents: string; monthly_cents: string; next12_cents: string; plans: Plan[]; payments: Payment[] };

export const intervals = [[1, '每月'], [3, '每季'], [6, '每半年'], [12, '每年']] as const;
export const intervalText = (n: number) => intervals.find(([k]) => k === n)?.[1] ?? `每 ${n} 个月`;
export const recurringCategoryText = (k: string) => recurringCategories.find(([c]) => c === k)?.[1] ?? '其他';
/** Plan status for the list: ended plans no longer have future periods. */
export function planStatus(p: Plan, today: string) {
  if (p.fields.end_date && p.fields.end_date < today) return `已于 ${p.fields.end_date} 结束`;
  if (p.fields.paused) return '已暂停';
  return p.fields.end_date ? `进行中，至 ${p.fields.end_date}` : '进行中';
}

export type PaymentRangeSave = { request_id: string; generation: string; plan_id: string; expected_revision: number; from_due: string; to_due: string; amount_cents: string; confirmed: boolean };
