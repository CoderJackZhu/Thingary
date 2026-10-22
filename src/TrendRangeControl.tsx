import { useEffect, useId, useRef, useState } from 'react';
import type { Point } from './wealth';
import { changeText, rateText } from './wealth';
import { DateInput } from './DateInput';
import { customRangeError, periodChange, rangePoints, rangeUsable, recallTrendSelection, rememberTrendRange, trendRanges } from './review';
import type { CustomTrendRange, TrendRange, TrendSelection } from './review';
import './dual-line-chart.css';
import { t } from './i18n.ts';
/** Draft custom dates never replace the last valid, usable range. */
export function useTrendSelection(generation: string, points: Point[], today: string) {
  const [selection, setSelection] = useState<TrendSelection>(() => recallTrendSelection(generation));
  const [editing, setEditing] = useState(selection.range === 'custom');
  const [draft, setDraft] = useState<CustomTrendRange>(() => selection.custom ?? { from: points[0]?.date ?? today, to: today });
  const [error, setError] = useState('');
  const initialized = useRef(!!points.length);
  useEffect(() => {
    if (!initialized.current && points.length) {
      initialized.current = true;
      if (!selection.custom) setDraft({ from: points[0].date, to: today });
    }
  }, [points, today, selection.custom]);
  const applied = rangeUsable(points, selection.range, today, selection.custom) ? selection : { range: 'all' as const };
  const apply = (next: TrendSelection) => { setSelection(next); rememberTrendRange(generation, next.range, next.custom); };
  const select = (range: TrendRange) => {
    setEditing(range === 'custom'); setError('');
    if (range === 'custom') {
      const problem = customRangeError(draft, today) ?? (!rangeUsable(points, 'custom', today, draft) ? t('这段时间完整盘点不足两次') : '');
      setError(problem); if (!problem) apply({ range, custom: draft });
    } else if (rangeUsable(points, range, today)) apply({ range, custom: selection.custom });
  };
  const edit = (next: CustomTrendRange) => {
    setDraft(next);
    const problem = customRangeError(next, today) ?? (!rangeUsable(points, 'custom', today, next) ? t('这段时间完整盘点不足两次') : '');
    setError(problem); if (!problem) apply({ range: 'custom', custom: next });
  };
  return { points: rangePoints(points, applied.range, today, applied.custom), applied, editing, draft, error, select, edit };
}
export function TrendChange({ points, hidden = false }: { points: Point[]; hidden?: boolean }) {
  const result = periodChange(points);
  return <span className="trend-period-change">{result.status === 'scope_changed' ? t('账户计入范围有变化，不直接比较') : result.status === 'insufficient' ? t('完整盘点不足两次，暂无较期初变化') : <>{t('较期初')} {hidden ? '******' : changeText(result.cents)}{result.rate_hundredths === null ? '' : hidden ? '（******）' : `（${rateText(result.rate_hundredths)}）`}</>}</span>;
}
export function TrendRangeControl({ selection, points, today, hidden = false }: { selection: ReturnType<typeof useTrendSelection>; points: Point[]; today: string; hidden?: boolean }) {
  const errorId = useId();
  return <div className="trend-range-control">
    <div className="trend-range-row"><div className="ui-seg" role="group" aria-label={t('曲线时间范围')}>{trendRanges.map(([key, label]) => {
      const usable = key === 'custom' || rangeUsable(points, key, today);
      return <button type="button" key={key} disabled={!usable} title={usable ? undefined : t('这个范围内完整盘点不足两次')} aria-pressed={key === 'custom' ? selection.editing : !selection.editing && selection.applied.range === key} onClick={() => selection.select(key)}>{label}</button>;
    })}</div><TrendChange points={selection.points} hidden={hidden}/></div>
    {selection.editing && <><div className="trend-custom-dates"><label>{t('开始日期')}<DateInput label={t('曲线开始日期')} min="0001-01-01" max={today} value={selection.draft.from} onChange={from => selection.edit({ ...selection.draft, from })} invalid={!!selection.error} describedBy={selection.error ? errorId : undefined}/></label><label>{t('结束日期')}<DateInput label={t('曲线结束日期')} min="0001-01-01" max={today} value={selection.draft.to} onChange={to => selection.edit({ ...selection.draft, to })} invalid={!!selection.error} describedBy={selection.error ? errorId : undefined}/></label></div>{selection.error && <p className="error-text" role="alert" id={errorId}>{t('{v1}。当前曲线保留上一次合法范围。', { v1: selection.error.replace(/。$/, '') })}</p>}</>}
  </div>;
}
