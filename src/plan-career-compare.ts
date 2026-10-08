import type { PlanningSources } from './plan-basic-contract.ts';
import type { CareerDraft, CareerEvaluation } from './plan-career-contract.ts';
import { validCareerAmount } from './plan-career-contract.ts';
import { evaluateCareerScenario } from './plan-career.ts';

export type CareerChange = { kind: 'gap'; months: number | null } | { kind: 'recovery'; monthly_cents: string | null } | { kind: 'budget'; monthly_cents: string | null };
export type CareerComparison = { change: CareerChange; baseline: CareerEvaluation; alternative: CareerEvaluation; requirement_delta_cents: string | null; goal_assets_delta_cents: string | null };
const need = (x: CareerEvaluation) => x.requirement.status === 'ready' && 'monthly_cents' in x.requirement.value ? Number(x.requirement.value.monthly_cents) : null;

/** One explicit change only. Recompute from the same facts; never mutate/adopt a result. */
export function compareCareerScenario(sources: PlanningSources, draft: CareerDraft, change: CareerChange): CareerComparison {
  const candidate = structuredClone(draft), copy = structuredClone(sources);
  if (change.kind === 'gap') candidate.gap_months = change.months;
  if (change.kind === 'recovery') candidate.recovery.monthly_cents = change.monthly_cents;
  if (change.kind === 'budget' && copy.profile.status === 'ready' && copy.profile.value.saved) copy.profile.value.saved.profile.retire.spend_cents = validCareerAmount(change.monthly_cents) ? change.monthly_cents : null;
  const baseline = evaluateCareerScenario(sources, draft), alternative = evaluateCareerScenario(copy, candidate);
  const a = need(baseline), b = need(alternative);
  return { change: structuredClone(change), baseline, alternative, requirement_delta_cents: a === null || b === null ? null : String(b-a),
    goal_assets_delta_cents: baseline.prediction.status === 'ready' && alternative.prediction.status === 'ready' ? String(Math.round(alternative.prediction.value.outcome.assets_at_goal - baseline.prediction.value.outcome.assets_at_goal)) : null };
}
