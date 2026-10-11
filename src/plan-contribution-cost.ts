import type { BasicInputs, RetirementContributionCost } from './plan-basic-contract.ts';

/** Explicit personal cash cost, separate from the pension contribution base. */
export function contributionCostIssue(c: RetirementContributionCost): string | null {
  if (!['unknown', 'included', 'extra', 'external', 'excluded'].includes(c.treatment)) return '请选择续缴费用的处理方式。';
  if (c.monthly_cents !== null && (!/^(0|[1-9]\d*)$/.test(c.monthly_cents) || Number(c.monthly_cents) > 100000000)) return '续缴费用须是0到100万元的整数分。';
  if (c.stop_month !== null && !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(c.stop_month)) return '续缴费用停止月份无效。';
  if (['external', 'excluded'].includes(c.treatment) && c.monthly_cents !== null) return '无需本人支付或本次不计时，不保存个人支付金额。';
  return null;
}

export function contributionCostState(b: BasicInputs) {
  const c = b.retirement_contribution_cost;
  const pc = b.pension_contributions;
  if (!c || !['included', 'extra', 'external'].includes(c.treatment) || c.stop_month === null ||
    (c.treatment !== 'external' && c.monthly_cents === null) || pc.start_month === null || pc.stop_month === null || c.stop_month < pc.start_month) {
    return { cost: c, ready: false, stop: null, amount: 0, covers: false };
  }
  return { cost: c, ready: true, stop: c.stop_month < pc.stop_month ? c.stop_month : pc.stop_month,
    amount: c.treatment === 'external' ? 0 : Number(c.monthly_cents), covers: c.stop_month >= pc.stop_month };
}
