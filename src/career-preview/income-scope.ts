// Read-only scenario assumptions; source facts and saved arrangements are never changed.
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { FutureIncomeV1 } from '../plan-simplified-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { validateSimplifiedPlanningV1 } from '../plan-simplified.ts';
export type IncomeDraft = { mode: 'saved' | 'manual' | 'excluded'; items: FutureIncomeV1[]; excludePools?: boolean };
export type ScopeStatus = 'ready' | 'source_blocked' | 'income_blocked';
export function incomeDraft(sources: PlanningSources): IncomeDraft {
  const f = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile.retire.simplified : null;
  return { mode: 'saved', items: structuredClone(f?.future_incomes ?? []) };
}
export function prepareIncomeScope(sources: PlanningSources, draft: CareerDraft, input: IncomeDraft) {
  const copy = structuredClone(sources), saved = copy.profile.status === 'ready' ? copy.profile.value.saved : null;
  const financialDraft = structuredClone(draft);
  if (!saved?.profile.retire.basic || copy.profile.status !== 'ready' || copy.profile.value.generation !== copy.generation)
    return { status: 'source_blocked' as const, issues: ['通用资料未就绪或来源已变化，请重新读取。'], sources: null, cashSources: null, draft: financialDraft };
  const r = saved.profile.retire;
  if (input.mode !== 'saved') r.simplified = { ...r.simplified, income_mode: input.mode, future_incomes: structuredClone(input.items) };
  if (input.excludePools && r.core) r.core.releases = [];
  const issues = validateSimplifiedPlanningV1(r.simplified).map(i => i.message);
  const cashSources = structuredClone(copy);
  if (r.simplified.income_mode === 'unconfirmed' || issues.length) {
    if (cashSources.profile.status === 'ready' && cashSources.profile.value.saved) cashSources.profile.value.saved.profile.retire.simplified = {...r.simplified,income_mode:'excluded',future_incomes:[]};
    return { status: 'income_blocked' as const, issues: issues.length ? issues : ['请确认本次未来收入计入方式。'], sources: null, cashSources, draft: financialDraft };
  }
  return { status: 'ready' as const, issues: [], sources: copy, cashSources, draft: financialDraft };
}
