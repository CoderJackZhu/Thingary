import { useMemo } from 'react';
import type { PlanningAnnotation, PlanningSources } from './plan';
import { actionableAnnotations, annotationSummary, annotationDirection } from './plan-annotations';
import { prepareBasicPlan } from './plan-basic';
import { t } from './i18n.ts';
/** Read-only coverage for every shared calculation consumer. No assumption is saved here. */
export function CoverageNote({ annotations, sources, compact = false, onRefine }: { annotations?: readonly PlanningAnnotation[]; sources?: PlanningSources; compact?: boolean; onRefine?: (item: PlanningAnnotation) => void }) {
  const rows = useMemo(() => annotations ?? (sources ? prepareBasicPlan(sources).annotations : []) ?? [], [annotations, sources]);
  const lines = annotationSummary(rows);
  if (compact) {
    const count = actionableAnnotations(rows).length;
    return rows.length ? <div className="coverage-note muted small" role="note">
      <p>{count ? t('有 {count} 项条件待确认，详见目标页', { count }) : t('有安排未计入，详见目标页')}</p>
      {lines.map(line => <p className="coverage-summary" key={line}>{line}</p>)}
    </div> : null;
  }
  if (!rows.length) return null;
  return <div className="coverage-note" role="note" aria-label={t('计算条件与确认依据')}>
    {lines.map(line => <p className="coverage-summary" key={line}>{line}</p>)}
    <details><summary>{t('条件与核对')}</summary><ul>{rows.map(a => <li key={a.id}>
      <span>{a.reason_code === 'POOL_NOT_USED' ? t('本次未采用：') : ''}{a.message}</span>
      {a.reason_code !== 'POOL_NOT_USED' && a.effect !== 'none' && <small>{annotationDirection(a)}</small>}
      {a.missing_fields.length > 0 && <small>{t('还差：{v1}', { v1: a.missing_fields.join('、') })}</small>}
      {onRefine && a.reason_code !== 'POOL_NOT_USED' && a.actionable !== false && <button type="button" className="ui-link" onClick={() => onRefine(a)}>{t('去核对')}</button>}
    </li>)}</ul></details>
  </div>;
}
