// Read-only generic income scenarios; no policy calculation.
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { compareCareerScenario } from '../plan-career-compare.ts';
import type { CareerChange } from '../plan-career-compare.ts';
import { maxGap, minWindow } from '../plan-career-map.ts';
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
