import type { PlanningAnnotation } from './plan-basic-contract.ts';
import { t } from './i18n.ts';
/** Unused pools are basis, not unresolved coverage. Each direction gets one visible line. */
export const affectingAnnotations = (rows: readonly PlanningAnnotation[] = []) => rows.filter(a => a.reason_code !== 'POOL_NOT_USED' && a.treatment !== 'not_used' && a.treatment !== 'included');
export const actionableAnnotations = (rows: readonly PlanningAnnotation[] = []) => affectingAnnotations(rows).filter(a => a.actionable !== false);
export function annotationSummary(annotations: readonly PlanningAnnotation[] = []): string[] {
  const rows = affectingAnnotations(annotations), out: string[] = [];
  for (const effect of ['requirement_lower', 'requirement_higher', 'uncertain'] as const) {
    const group = rows.filter(a => a.effect === effect || effect === 'uncertain' && a.effect === 'none');
    if (!group.length) continue;
    const partner = group.some(a => a.reason_code.startsWith('HOUSEHOLD_'));
    const omitted = new Set(group.filter(a => a.treatment === 'omitted' && !a.reason_code.startsWith('HOUSEHOLD_')).flatMap(a => a.source_ids)).size;
    const extra = new Set(group.filter(a => a.treatment === 'assumed_extra').flatMap(a => a.source_ids)).size;
    const parts = [partner ? t('伴侣的存款没有单独计算') : '', omitted ? t('有 {omitted} 项安排未计入', { omitted }) : '', extra ? t('{extra} 项费用暂按额外费用计入，可能重复包含', { extra }) : ''].filter(Boolean);
    out.push(parts.join('；') + (effect === 'requirement_lower' ? t('，每月需要存的钱可能偏低') : effect === 'requirement_higher' ? t('，每月需要存的钱可能偏高') : t('，每月需要存的钱可能变化，方向尚不确定')));
  }
  return out;
}
export function uniqueAnnotations(rows: readonly PlanningAnnotation[]): PlanningAnnotation[] {
  return [...new Map(rows.map(a => [a.id, a])).values()];
}

export const annotationDirection = (a: PlanningAnnotation) => a.effect === 'requirement_lower' ? t('每月需要存的钱可能偏低') : a.effect === 'requirement_higher' ? t('每月需要存的钱可能偏高') : t('每月需要存的钱可能变化，方向尚不确定');
