import { useEffect, useState } from 'react';
import { DateInput, MonthInput } from './DateInput';
import { FormRow } from './FormControls';
import type { FinancePeriod } from './finance-contract';
import {
  FINANCE_PERIOD_KINDS,
  describeFinancePeriod,
  draftFromFinancePeriod,
  financePeriodFromDraft,
  switchFinancePeriodKind,
  type FinancePeriodDraft,
  type FinancePeriodKind,
} from './finance-period-control';

/** Valid selections refresh immediately; partial or invalid edits keep the last valid period. */
export function FinancePeriodControl({value,onChange,today,disabled}: {value: FinancePeriod; onChange:(value:FinancePeriod)=>void; today:string; disabled?:boolean}) {
  const [draft, setDraft] = useState<FinancePeriodDraft>(() => draftFromFinancePeriod(value, today));
  const [error, setError] = useState('');
  // Applied identity: an external value change discards the unapplied edit instead of keeping a stale draft.
  const applied = JSON.stringify(value);
  useEffect(() => {
    setDraft(current => {
      const result = financePeriodFromDraft(current);
      return result.ok && JSON.stringify(result.value) === applied ? current : draftFromFinancePeriod(value, today);
    });
    setError('');
  }, [applied]);
  const off = disabled === true;
  const update = (next: FinancePeriodDraft) => {
    if (off) return;
    setDraft(next);
    const result = financePeriodFromDraft(next);
    if (!result.ok) { setError(result.error); return; }
    setError('');
    if (JSON.stringify(result.value) !== applied) onChange(result.value);
  };
  const patch = (part: Partial<FinancePeriodDraft>) => update({ ...draft, ...part });
  const choose = (kind: FinancePeriodKind) => update(switchFinancePeriodKind(draft, kind));
  return (
    <div className="finance-period ui-card ui-content wealth-toolbar" role="group" aria-label="财务期间">
      <div className="segmented" role="group" aria-label="期间类型">
        {FINANCE_PERIOD_KINDS.map(kind => <button type="button" key={kind.value} aria-pressed={draft.kind === kind.value} disabled={off} onClick={() => choose(kind.value)}>{kind.label}</button>)}
      </div>
      {draft.kind === 'year' && <FormRow label="年份"><input type="number" min="1" max="9999" step="1" aria-label="年份" value={draft.year} disabled={off} onChange={event => patch({ year: event.target.value })}/></FormRow>}
      {draft.kind === 'month' && <FormRow label="月份"><MonthInput label="月份" min="0001-01" value={draft.month} disabled={off} onChange={month => patch({ month })}/></FormRow>}
      {draft.kind === 'range' && <><FormRow label="开始日期"><DateInput label="开始日期" min="0001-01-01" value={draft.from} disabled={off} onChange={from => patch({ from })}/></FormRow><FormRow label="结束日期"><DateInput label="结束日期" min="0001-01-01" value={draft.to} disabled={off} onChange={to => patch({ to })}/></FormRow><p className="muted small">{draft.includeFrom ? '含起始日，含结束日' : '不含起始日，含结束日'}</p></>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted finance-period-applied" role="status">{error ? '仍显示：' : '当前期间：'}{describeFinancePeriod(value)}</p>
    </div>
  );
}
