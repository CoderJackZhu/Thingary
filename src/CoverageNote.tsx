import { useMemo } from 'react';
import type { PlanningAnnotation, PlanningSources } from './plan';
import { annotationSummary, annotationDirection } from './plan-annotations';
import { prepareBasicPlan } from './plan-basic';

/** Read-only coverage for every shared calculation consumer. No assumption is saved here. */
export function CoverageNote({ annotations, sources, compact = false, onRefine }: { annotations?: readonly PlanningAnnotation[]; sources?: PlanningSources; compact?: boolean; onRefine?: (item: PlanningAnnotation) => void }) {
  const rows = useMemo(() => annotations ?? (sources ? prepareBasicPlan(sources).annotations : []) ?? [], [annotations, sources]);
  const lines = annotationSummary(rows);
  if (compact) return lines.length ? <p className="coverage-note muted small" role="note">带待核对假设，详见目标页</p> : null;
  if (!rows.length) return null;
  return <div className="coverage-note" role="note" aria-label="计算覆盖与待核对依据">
    {lines.map(line => <p className="coverage-summary" key={line}>{line}</p>)}
    <details><summary>展开计算依据与待核对清单</summary><ul>{rows.map(a => <li key={a.id}>
      <span>{a.reason_code === 'POOL_NOT_USED' ? '本次未采用：' : ''}{a.message}</span>
      {a.reason_code !== 'POOL_NOT_USED' && <small>{annotationDirection(a)}</small>}
      {a.missing_fields.length > 0 && <small>还差：{a.missing_fields.join('、')}</small>}
      {onRefine && a.reason_code !== 'POOL_NOT_USED' && <button type="button" className="ui-link" onClick={() => onRefine(a)}>去核对</button>}
    </li>)}</ul></details>
  </div>;
}
