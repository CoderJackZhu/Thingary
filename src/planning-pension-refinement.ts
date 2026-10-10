import type { Draft, PensionForm } from './planning-basic-forms.ts';
import { budgetInput, incomeItemsChanged, pensionFormOf, pensionInput, retirementIncomeOf } from './planning-basic-forms.ts';
import { pcValues } from './planning-basic-defaults.ts';
import type { PlanningSources, ProfileState, SetupFields, RequirementResult, BasicFields } from './plan.ts';
import { overlayPlanningDrafts } from './planning-draft.ts';
import { buildBasicCapabilities } from './plan-basic.ts';

type Saved = ProfileState['saved'];
const savedOf = (s: PlanningSources) => s.profile.status === 'ready' ? s.profile.value.saved : null;
export const pensionFactKeys = ['birth', 'worker', 'paid', 'balance', 'base', 'flex', 'pp', 'tax'] as const;
export const missingPensionFields = (d: Draft): (keyof PensionForm)[] => pensionFactKeys.filter(k => (k === 'birth' ? d.birth : d.pension[k]) === '');
export function needsPensionFacts(d: Draft, saved: Saved): boolean {
  return missingPensionFields(d).length > 0 || saved?.profile.region !== 'beijing';
}

/** Existing setup DTO only. In the standalone editor, all unrelated fields are copied exactly. */
export function pensionRefinementFields(d: Draft, saved: NonNullable<Saved>, today: string): SetupFields {
  const p = saved.profile, r = p.retire;
  if (!r.basic || !r.core) throw new Error('请先回答目标页的四个问题。');
  const basic: BasicFields = { birth_month: p.birth_month, spend_cents: r.spend_cents, target_age: r.target_age, horizon_age: r.horizon_age,
    mode: r.mode, real_return_before_hundredths: r.real_return_before_hundredths, real_return_after_hundredths: r.real_return_after_hundredths, volatility_hundredths: r.volatility_hundredths,
    emergency_months: r.emergency_months, inflation_hundredths: p.assumptions.inflation_hundredths, monetary_basis_date: r.core.monetary_basis_date, basic: structuredClone(r.basic) };
  return withPensionRefinement({ basic, budget: null, funds: null, pension: null }, d, saved, today);
}
export function withPensionRefinement(fields: SetupFields, d: Draft, saved: Saved, today: string): SetupFields {
  const out = structuredClone(fields), p = saved?.profile, r = p?.retire;
  out.basic.birth_month = d.birth ? d.birth.slice(0, 7) : null;
  out.basic.basic.retirement_income = retirementIncomeOf(d);
  const pc = pcValues(d, today);
  out.basic.basic.pension_contributions = { start_month: pc.start, stop_month: pc.stop, base_cents: pc.base };
  if (r && incomeItemsChanged(d, r)) out.budget = (budgetInput(d, r) as { fields: NonNullable<SetupFields['budget']> }).fields;
  const hpf = d.hpf === '' ? null : d.hpf;
  if (out.funds) out.funds.hpf_monthly_cents = hpf;
  else if (hpf !== (r?.core?.hpf_monthly_cents ?? null)) out.funds = { monetary_basis_date: out.basic.monetary_basis_date, fund_rules: structuredClone(r?.core?.fund_rules ?? []), hpf_monthly_cents: hpf,
    personal_pension_account_id: r?.core?.personal_pension_account_id ?? null, personal_pension_balance_confirmed: r?.core?.personal_pension_balance_confirmed ?? false };
  const original = pensionFormOf(saved);
  if (p?.flex_months == null) original.flex = '';
  if (p?.marginal_tax_hundredths == null) original.tax = '';
  // Birth belongs to Q1 as well: both existing sections must agree when that answer changes.
  const f = { ...d.pension, birth: d.birth ? d.birth.slice(0, 7) + '-01' : '' };
  if (JSON.stringify(f) !== JSON.stringify(original) || d.incomeMode === 'beijing' && p?.region !== 'beijing') out.pension = (pensionInput(f) as { fields: NonNullable<SetupFields['pension']> }).fields;
  return out;
}

export type PensionComparison = { before: RequirementResult | null; after: RequirementResult | null; reason: string; snapshotDate: string | null; today: string; mode: Draft['incomeMode']; statePensionMonthlyCents: string | null; };
const requirement = (s: PlanningSources) => { const c = buildBasicCapabilities(s).requirement; return c.status === 'ready' ? c.value.set : null; };
/** No live reload argument: this comparison can only use the captured batch and final submitted fields. */
export function comparePensionRefinement(captured: PlanningSources, fields: SetupFields): PensionComparison {
  const frozen = structuredClone(captured), old = savedOf(frozen);
  const afterSources = overlayPlanningDrafts(frozen, [{ section: 'setup', fields }]);
  const after = savedOf(afterSources)!;
  const beforeSources = structuredClone(afterSources), before = savedOf(beforeSources)!;
  if (old?.profile.retire.basic) {
    before.profile.retire.basic!.retirement_income = structuredClone(old.profile.retire.basic.retirement_income);
    before.profile.retire.basic!.pension_contributions = structuredClone(old.profile.retire.basic.pension_contributions);
    if (before.profile.retire.core) before.profile.retire.core.hpf_monthly_cents = old.profile.retire.core?.hpf_monthly_cents ?? null;
    const sharedBirth = before.profile.birth_month;
    for (const key of ['worker', 'region', 'paid_months', 'account_balance_cents', 'base_cents', 'past_index_hundredths', 'flex_months', 'personal_pension_annual_cents', 'marginal_tax_hundredths', 'overrides'] as const) Object.assign(before.profile, { [key]: structuredClone(old.profile[key]) });
    before.profile.birth_month = sharedBirth;
    before.profile.assumptions.wage_growth_hundredths = old.profile.assumptions.wage_growth_hundredths;
    before.profile.assumptions.pp_return_hundredths = old.profile.assumptions.pp_return_hundredths;
  }
  const hadResult = old?.profile.retire.basic && requirement(frozen) !== null;
  const a = hadResult ? requirement(beforeSources) : null, afterCaps = buildBasicCapabilities(afterSources);
  const b = afterCaps.requirement.status === 'ready' ? afterCaps.requirement.value.set : null;
  const statePensionMonthlyCents = afterCaps.pension.status === 'ready' && afterCaps.pension.value.included ? afterCaps.pension.value.monthly_cents : null;
  return { before: a, after: b, statePensionMonthlyCents, reason: !old?.profile.retire.basic ? '尚无原结果' : a === null ? '原结果暂不可计算' : '',
    snapshotDate: frozen.snapshot.status === 'ready' ? frozen.snapshot.value?.date ?? null : null, today: frozen.today, mode: after.profile.retire.basic?.retirement_income.mode ?? '' };
}
