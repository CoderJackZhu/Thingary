import type { BasicFields, RetirementContributionCost } from './plan-basic-contract.ts';
import type { ProfileState } from './plan.ts';
import type { SectionInput } from './planning-basic-data.ts';
import { contributionCostIssue } from './plan-contribution-cost.ts';

type Saved = NonNullable<ProfileState['saved']>;
export type ContributionCostDraft = { treatment: RetirementContributionCost['treatment']; monthly: string; stop: string };
export function contributionCostDraft(saved: Saved): ContributionCostDraft {
  const p = saved.profile, r = p.retire, c = r.basic?.retirement_contribution_cost;
  if (c) return { treatment: c.treatment, monthly: c.monthly_cents ?? '', stop: c.stop_month ?? '' };
  const scope = r.basic?.retirement_costs.find(x => x.source_id === 'social_insurance');
  const legacy = Number(r.keep_paying_monthly_cents) > 0 || r.keep_paying_until_age !== null;
  const end = p.birth_month && r.keep_paying_until_age !== null ? `${Number(p.birth_month.slice(0, 4)) + r.keep_paying_until_age}-${p.birth_month.slice(5, 7)}` : '';
  return { treatment: scope?.treatment ?? (legacy ? 'extra' : 'unknown'), monthly: legacy ? r.keep_paying_monthly_cents : '', stop: end };
}

/** Only the cost declaration changes; goal, pension facts and contribution schedule stay byte-for-byte in value. */
export function contributionCostInput(d: ContributionCostDraft, saved: Saved): SectionInput {
  const p = saved.profile, r = p.retire;
  if (!r.basic || !r.core) throw new Error('请先设置退休目标。');
  const c: RetirementContributionCost = { treatment: d.treatment, monthly_cents: ['external', 'excluded'].includes(d.treatment) ? null : d.monthly === '' ? null : d.monthly, stop_month: d.treatment === 'excluded' ? null : d.stop || null };
  const issue = contributionCostIssue(c);
  if (issue) throw new Error(issue);
  if (c.stop_month && r.basic.pension_contributions.start_month && c.stop_month < r.basic.pension_contributions.start_month) throw new Error('费用停止月份不能早于未来缴费开始月份。');
  const fields: BasicFields = {
    birth_month: p.birth_month, spend_cents: r.spend_cents, target_age: r.target_age, horizon_age: r.horizon_age,
    mode: r.mode, real_return_before_hundredths: r.real_return_before_hundredths, real_return_after_hundredths: r.real_return_after_hundredths,
    volatility_hundredths: r.volatility_hundredths, emergency_months: r.emergency_months, inflation_hundredths: p.assumptions.inflation_hundredths,
    monetary_basis_date: r.core.monetary_basis_date,
    basic: { ...r.basic, retirement_contribution_cost: c, retirement_costs: r.basic.retirement_costs.filter(x => x.source_id !== 'social_insurance') },
  };
  return { section: 'basic', fields };
}

/** Explicit schedule edit is atomic with its funding declaration; ordinary cost saves stay scoped. */
export function contributionScheduleInput(d: ContributionCostDraft, saved: Saved, changeSchedule: boolean): SectionInput {
  const input = contributionCostInput(d, saved);
  if (!changeSchedule || input.section !== 'basic') return input;
  if (!d.stop || !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.stop)) throw new Error('请选择最后缴费月份。');
  const start = input.fields.basic.pension_contributions.start_month;
  if (!start) throw new Error('请先在退休收入中确认未来缴费开始月份。');
  if (d.stop < start) throw new Error('停止缴费月份不能早于开始月份。');
  input.fields.basic.pension_contributions = { ...input.fields.basic.pension_contributions, stop_month: d.stop };
  return input;
}
