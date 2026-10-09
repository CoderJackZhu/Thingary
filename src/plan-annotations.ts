import type { PlanningAnnotation } from './plan-basic-contract.ts';

/** Unused pools are basis, not unresolved coverage. Each direction gets one visible line. */
export const affectingAnnotations = (rows: readonly PlanningAnnotation[] = []) => rows.filter(a => a.reason_code !== 'POOL_NOT_USED' && a.treatment !== 'not_used');
export function annotationSummary(annotations: readonly PlanningAnnotation[] = []): string[] {
  const rows = affectingAnnotations(annotations), out: string[] = [];
  for (const effect of ['requirement_lower', 'requirement_higher', 'uncertain'] as const) {
    const group = rows.filter(a => a.effect === effect || effect === 'uncertain' && a.effect === 'none');
    if (!group.length) continue;
    const omitted = new Set(group.filter(a => a.treatment === 'omitted').flatMap(a => a.source_ids)).size;
    const extra = new Set(group.filter(a => a.treatment === 'assumed_extra').flatMap(a => a.source_ids)).size;
    const parts = [omitted ? `有 ${omitted} 项安排未计入` : '', extra ? `${extra} 项费用暂按额外费用计入，可能重复包含` : ''].filter(Boolean);
    out.push(parts.join('；') + (effect === 'requirement_lower' ? '，所需月投入可能偏低' : effect === 'requirement_higher' ? '，所需月投入可能偏高' : '，影响方向待核对'));
  }
  return out;
}
export function uniqueAnnotations(rows: readonly PlanningAnnotation[]): PlanningAnnotation[] {
  return [...new Map(rows.map(a => [a.id, a])).values()];
}

export const annotationDirection = (a: PlanningAnnotation) => a.effect === 'requirement_lower' ? '所需月投入可能偏低' : a.effect === 'requirement_higher' ? '所需月投入可能偏高' : '影响方向待核对';
