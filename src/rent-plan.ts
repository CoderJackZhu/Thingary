// 周期费用的简易填写（房租、订阅、水电网、保险等）：把「开始日期、付款周期、提前几天付、到期日」换算成现有计划字段，反过来也能读回。
// 不新增数据字段；复杂的计划（固定天数、试用、分段价格、特殊期）不进简易表单，仍用完整表单。
import { previousDay, scheduleDates, shiftDays, shiftMonth } from './recurring-model.ts';
import type { Plan, PlanFields } from './recurring.ts';

export type RentForm = {
  /** 每期总额（分）：季付填整季。 */
  amount_cents: string;
  /** 付款周期（月）：1、3、6 或 12。 */
  interval_months: 1 | 3 | 6 | 12;
  /** 租住开始日期。 */
  start: string;
  /** 每期提前几天付款，0 为当天。 */
  advance_days: number;
  /** 租期到期日，不含当天：到期日就是下一期的第一天，不再付款。空表示一直租、持续续费。 */
  end: string;
};

export const rentIntervals: [RentForm['interval_months'], string][] = [[1, '每月'], [3, '每季'], [6, '每半年'], [12, '每年']];

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T12:00:00Z'));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

export const blankRent = (today: string): RentForm => ({ amount_cents: '', interval_months: 1, start: today, advance_days: 0, end: '' });

/** 「提前一个月」对应的天数：从开始日往前推一个自然月。 */
export const oneMonthBefore = (start: string): number => (isDay(start) ? daysBetween(shiftMonth(start, -1), start) : 30);

/** 换算成计划字段（不含名称、备注）。到期日不含当天，存成「最后使用日期」要往前一天。 */
export function rentToFields(r: RentForm, category = 'rent'): Pick<PlanFields, 'category' | 'amount_cents' | 'interval_months' | 'interval_days' | 'trial_days' | 'first_due' | 'service_start' | 'coverage_start' | 'end_date' | 'paused' | 'auto_renew'> {
  return {
    category, amount_cents: r.amount_cents, interval_months: r.interval_months, interval_days: null, trial_days: null,
    first_due: shiftDays(r.start, -Math.max(0, Math.trunc(r.advance_days))), service_start: r.start, coverage_start: r.start,
    end_date: r.end ? previousDay(r.end) : null, paused: false, auto_renew: true,
  };
}

/** 读回简易表单；计划超出简易能表达的范围时返回 null（改用完整表单）。 */
export function fieldsToRent(plan: Pick<Plan, 'fields' | 'rules' | 'period_ends' | 'special_start' | 'special_end' | 'renewal_cents'>): RentForm | null {
  const f = plan.fields;
  if (f.interval_days || f.trial_days || f.paused || f.auto_renew === false) return null;
  if (![1, 3, 6, 12].includes(f.interval_months)) return null;
  if ((plan.rules?.length ?? 0) > 1 || Object.keys(plan.period_ends ?? {}).length || plan.special_start || plan.special_end || plan.renewal_cents) return null;
  const start = f.service_start;
  if (!start || !isDay(start) || f.coverage_start !== start || !isDay(f.first_due)) return null;
  const advance = daysBetween(f.first_due, start);
  if (advance < 0 || advance > 366) return null;
  return { amount_cents: f.amount_cents, interval_months: f.interval_months as RentForm['interval_months'], start, advance_days: advance, end: f.end_date ? shiftDays(f.end_date, 1) : '' };
}

export type RentRow = { due: string; from: string; to: string };
export type RentPreview = { rows: RentRow[]; total_cents: bigint; monthly_cents: bigint | null; open_ended: boolean; truncated: boolean };

/** 预览将生成的期次：有到期日则列到到期为止；持续租则列到今天之后再多一期。 */
export function rentPreview(r: RentForm, today: string, limit = 24): RentPreview | null {
  if (!isDay(r.start) || !/^\d+$/.test(r.amount_cents || '') || (r.end && (!isDay(r.end) || r.end <= r.start))) return null;
  const f = { name: '', notes: '', ...rentToFields(r) } as PlanFields;
  const horizon = r.end ? r.end : shiftMonth(today > r.start ? today : r.start, r.interval_months * 2);
  const dues = scheduleDates(f, '1900-01-01', shiftDays(horizon, r.advance_days + 1));
  const all: RentRow[] = dues.map(due => {
    const k = dues.indexOf(due);
    const from = shiftMonth(r.start, k * r.interval_months);
    const next = shiftMonth(r.start, (k + 1) * r.interval_months);
    const last = previousDay(next);
    return { due, from, to: r.end && r.end <= last ? previousDay(r.end) : last };
  });
  const rows = all.slice(0, limit);
  const amount = BigInt(r.amount_cents || '0');
  return { rows, total_cents: amount * BigInt(all.length), monthly_cents: amount / BigInt(r.interval_months), open_ended: !r.end, truncated: all.length > rows.length };
}
