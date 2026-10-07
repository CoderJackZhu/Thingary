// Fixed current cash flow only. No pension, job-return date, investment return or automatic plan expenses.
// Reuse the month ledger twice: pay at the start, receive reliable income at the end.
import { retiredMonth } from './plan-ledger.ts';

export const RUNWAY_MAX_MONTHS = 1200;
export type RunwayInput = {
  start_cents: number;
  income_cents: number;
  /** Total necessary outgoings, including current rent, loan payments and social insurance. */
  spend_cents: number;
  floor_cents: number | null;
  months?: number;
};
type Checked = {
  checked_months: number;
  floor_month: number | null;
  floor_gap_cents: number | null;
  remaining_cents: number;
};
export type RunwayResult =
  | { status: 'invalid'; message: string }
  | ({ status: 'not_reached' } & Checked)
  | ({ status: 'payment_gap'; covered_months: number } & Checked);

/** A floor is checked at the start and immediately after each payable start-of-month expense.
 * Stop at the first unpayable month. Never invent a later zero balance or floor crossing. */
export function runway(i: RunwayInput): RunwayResult {
  const { start_cents: b, income_cents: inc, spend_cents: s, floor_cents: f } = i;
  const months = i.months ?? RUNWAY_MAX_MONTHS;
  if (![b, inc, s].every(Number.isSafeInteger) || (f !== null && !Number.isSafeInteger(f))) return { status: 'invalid', message: '金额必须是整数分。' };
  if (s <= 0) return { status: 'invalid', message: '必要开销必须大于 0。' };
  if (inc < 0) return { status: 'invalid', message: '可靠到账不能为负；明确没有请填 0。' };
  if (f !== null && f < 0) return { status: 'invalid', message: '资金底线不能为负。' };
  if (b < 0) return { status: 'invalid', message: '起点资金为负，请先核对资金范围。' };
  if (!Number.isInteger(months) || months < 1 || months > RUNWAY_MAX_MONTHS) return { status: 'invalid', message: '检查期间必须为 1 至 1200 个整月。' };
  let a = b, floor_month = f !== null && b <= f ? 0 : null;
  const floor_gap_cents = floor_month === 0 ? f! - b : null;
  for (let m = 1; m <= months; m++) {
    const paid = retiredMonth(a, 1, 0, s, 0);
    if (paid.gap > 0) return { status: 'payment_gap', covered_months: m - 1, checked_months: months, remaining_cents: a, floor_month, floor_gap_cents };
    if (f !== null && floor_month === null && paid.a <= f) floor_month = m;
    a = retiredMonth(paid.a, 1, 0, 0, inc).a;
    if (!Number.isSafeInteger(a)) return { status: 'invalid', message: '推演金额超出可计算范围，请缩短期间或核对金额。' };
  }
  return { status: 'not_reached', checked_months: months, remaining_cents: a, floor_month, floor_gap_cents };
}
