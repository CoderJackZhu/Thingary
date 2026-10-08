import type { CostScope, PlanningContext, RequirementResult } from './plan-basic-contract.ts';
import type { Outcome, Plan, Projection } from './plan-ledger.ts';

export type CareerPension = 'unchanged' | 'pause' | { base_cents: string; hpf_monthly_cents: string };
export type CareerStage = {
  costs: CostScope[] | null;
  pension: CareerPension | null;
  /** Confirmed cash insurance expense, independent of pension account credits. */
  insurance: { monthly_cents: string | null; included: boolean };
};
/** User-entered after-tax inflows during the gap. A lump sum (severance, unused leave) lands at the end of the change month;
 *  a limited benefit is paid at month end for min(N, actual gap months); returning to work stops it. Empty means none; nothing here is a default or a policy lookup. */
export type CareerExtraIncome = { lump_cents: string | null; benefit_monthly_cents: string | null; benefit_months: number | null };
/** A one-off after-tax inflow outside the monthly savings figure (share vesting, a large bonus, a side job), landing at the end of its month.
 *  Only money that has been or will be received counts; nothing here is estimated for the user. */
export type CareerLump = { month: string; cents: string };
export type CareerDraft = {
  transition_month: string | null;
  gap_months: number | null;
  check_until_month: string | null;
  gap: CareerStage & { income_cents: string | null; spend_cents: string | null; budget_scope: 'complete' | 'essential_only'; extra_income?: CareerExtraIncome };
  recovery: CareerStage & { monthly_cents: string | null };
  liquid_funds_confirmed: boolean;
  /** Optional one-off inflows anywhere between the funds start and the target (at most 24). */
  lumps?: CareerLump[];
  floor_cents: string | null;
};
export type CareerIssue = { field: string; message: string };
export type CareerCapability<T> = { status: 'ready'; value: T } | { status: 'blocked'; issues: CareerIssue[] };
export type CareerCash = {
  from_month: string; until_month: string; budget_scope: 'complete' | 'essential_only';
  minimum_cents: string; first_shortfall_month: string | null; floor_month: string | null;
  /** Net-only working intervals are never certified as cash-safe. */
  timing: 'expenses_first_income_last';
};
export type CareerRequirement = RequirementResult | { status: 'prefix_payment_gap' | 'prefix_floor_breach' | 'no_recovery_interval'; message: string };
export type CareerEvaluation = {
  context: PlanningContext;
  model_version: 'career-prototype-1';
  notes: string[];
  cash: CareerCapability<CareerCash>;
  requirement: CareerCapability<CareerRequirement>;
  prediction: CareerCapability<{ plan: Plan; projection: Projection; outcome: Outcome }>;
};
export function careerBlocked<T>(issues: CareerIssue[]): CareerCapability<T> {
  const unique = new Map(issues.map(i => [JSON.stringify([i.field, i.message]), i]));
  return { status: 'blocked', issues: [...unique.values()] };
}
export const careerIssue = (field: string, message: string): CareerIssue => ({ field, message });
export const validCareerMonth = (s: string | null): s is string => s !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const validCareerAmount = (s: string | null, signed = false): s is string => s !== null && (signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(s) && Number.isSafeInteger(Number(s)) && Math.abs(Number(s)) <= 100_000_000 && String(Number(s)) === s;
export const careerMonth = (i: number) => `${String(Math.floor(i / 12)).padStart(4, '0')}-${String(i % 12 + 1).padStart(2, '0')}`;
