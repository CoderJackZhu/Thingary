import type { RetireInputs } from './plan.ts';
import { mustStayInLedger } from './plan-core.ts';
import { contributionSources, retirementSources } from './planning-basic-forms.ts';
import type { Draft, ScopeDraft } from './planning-basic-forms.ts';

/** Presentation only: the same pending rows shown by the existing costs editor. */
export function costReviewRows(d: Draft, retire: RetireInputs, annualPension: string | null) {
  const pre = contributionSources(retire, annualPension), post = retirementSources(retire, annualPension);
  const valid = (id: string, v: ScopeDraft | undefined, before: boolean) => !!v?.treatment && !(v.treatment === 'excluded' && mustStayInLedger(id)) && !(v.treatment === 'included' && (v.ref === '' || (before && id.startsWith('event:') && !retire.core?.occurrences.some(o => o.status === 'occurred' && id.startsWith(`event:${o.event_id}:`)))));
  const active = (id: string) => !id.startsWith('event:') || retire.life_events.some(e => id.startsWith(`event:${e.id}:`) && !retire.core?.occurrences.some(o => o.event_id === e.id && o.status === 'cancelled') && (e.included || retire.core?.occurrences.some(o => o.event_id === e.id && o.status === 'occurred')));
  const included = post.filter(s => active(s.id) && d.retScopes[s.id]?.treatment === 'included').reduce((sum, s) => sum + Number(d.retScopes[s.id].ref), 0);
  const overBudget = d.budget !== '' && included > Number(d.budget);
  const pendingRows = [
    ...pre.filter(s => active(s.id) && !valid(s.id, d.conScopes[s.id], true)).map(s => ({ ...s, key: 'conScopes:' + s.id })),
    ...post.filter(s => active(s.id) && (!valid(s.id, d.retScopes[s.id], false) || (overBudget && d.retScopes[s.id]?.treatment === 'included'))).map(s => ({ ...s, key: 'retScopes:' + s.id })),
  ];
  const missingCount = pre.filter(s => active(s.id) && !valid(s.id, d.conScopes[s.id], true)).length + post.filter(s => active(s.id) && !valid(s.id, d.retScopes[s.id], false)).length;
  return { pre, post, active, included, overBudget, pendingRows, missingCount };
}
