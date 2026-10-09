// Preview-only external-income path. Policy-check results never feed a career search.
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { compareCareerScenario } from '../plan-career-compare.ts';
import type { CareerChange } from '../plan-career-compare.ts';
import { maxGap, minWindow } from '../plan-career-map.ts';
import type { BeijingBenefitInput } from '../plan-pension-policy.ts';
import { evaluateCareerScenario } from '../plan-career.ts';
import { incomeDraft, prepareIncomeScope } from './income-scope.ts';
import type { IncomeDraft } from './income-scope.ts';

export function previewAnswers(sources: PlanningSources, draft: CareerDraft, question: 'rest' | 'lower' | 'switch', change: CareerChange, income: IncomeDraft = incomeDraft(sources)) {
  const scope = prepareIncomeScope(sources, draft, income);
  const cash = scope.cashSources ? evaluateCareerScenario(scope.cashSources, scope.draft).cash : null;
  if (scope.status !== 'ready' || !scope.sources) return { status: scope.status, cash, issues: scope.issues } as const;
  return { status: 'ready',
    cash,
    rest: question === 'rest' ? maxGap(scope.sources, scope.draft) : null,
    lower: question === 'lower' ? minWindow(scope.sources, scope.draft) : null,
    comparison: question === 'switch' ? compareCareerScenario(scope.sources, scope.draft, change) : null,
  } as const;
}

export function pensionCheckInput(sources: PlanningSources): BeijingBenefitInput {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  return { scope: null, birth_month: p?.birth_month ?? null, worker: p?.worker ?? null, flex_months: p?.flex_months ?? null,
    paid_months_at_retirement: null, average_index: null, benefit_base: null, account_at_retirement: null, disbursement: null };
}

export const checkAssumption = { basis: 'assumption', source: '本次手动输入的退休时假设，仅用于金额核对' } as const;
/** Explicit opt-in fictional example; not derived from the source profile. */
export function fictionalPensionCheck(): BeijingBenefitInput {
  return { scope: 'beijing-enterprise-post-1998', birth_month: '1994-10', worker: 'male', flex_months: 0,
    paid_months_at_retirement: 276, average_index: { ten_thousandths: 9200, ...checkAssumption },
    benefit_base: { cents: '1204900', year: 2057, ...checkAssumption },
    account_at_retirement: { cents: '11700000', ...checkAssumption }, disbursement: { months: 117, ...checkAssumption } };
}

export function decimalIndex(value: string): number {
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return NaN;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
  return Number.isSafeInteger(result) ? result : NaN;
}
