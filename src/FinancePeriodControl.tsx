import { useEffect, useState } from 'react';
import { DateInput, MonthInput } from './DateInput';
import { YearSelect } from './YearSelect';
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
import { t } from './i18n.ts';
/** Valid selections refresh immediately; partial or invalid edits keep the last valid period. */
export function FinancePeriodControl({value,onChange,today,disabled,recordedYears,options=FINANCE_PERIOD_KINDS,presets=[],activePreset=null,onPresetChange,yearQuickPick=false}: {
  value: FinancePeriod; onChange:(value:FinancePeriod)=>void; today:string; disabled?:boolean; recordedYears?:readonly number[];
  options?:readonly {value:FinancePeriodKind;label:string}[];
  presets?:readonly {id:string;label:string;period:FinancePeriod}[]; activePreset?:string|null; onPresetChange?:(id:string|null)=>void;
  /** 在自定义面板里额外提供按自然年的快捷选择（区间回顾使用）。 */
  yearQuickPick?:boolean;
}) {
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
  const choose = (kind: FinancePeriodKind) => { if (off) return; onPresetChange?.(null); update(switchFinancePeriodKind(draft, kind)); };
  const todayText = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : '';
  const todayYear = Number(today.slice(0, 4));
  // 选自然年只是把起止日期填成该年 1 月 1 日至年末（今年到当天），之后仍可改日期。
  const chooseYear = (year: number) => {
    const text = String(year).padStart(4, '0');
    patch({ from: `${text}-01-01`, to: todayText && todayText.slice(0, 4) === text ? todayText : `${text}-12-31` });
  };
  const draftYear = draft.from === '0001-01-01' ? null : /^\d{4}/.test(draft.from) ? Number(draft.from.slice(0, 4)) : null;
  const choosePreset = (preset: typeof presets[number]) => {
    if (off) return;
    setDraft(draftFromFinancePeriod(preset.period, today)); setError(''); onPresetChange?.(preset.id);
    if (JSON.stringify(preset.period) !== applied) onChange({ ...preset.period });
  };
  return (
    <div className="finance-period ui-card ui-content wealth-toolbar" role="group" aria-label={t('财务期间')}>
      <div className="segmented" role="group" aria-label={t('期间类型')}>
        {presets.map(preset => <button type="button" key={preset.id} aria-pressed={activePreset === preset.id} disabled={off} onClick={() => choosePreset(preset)}>{preset.label}</button>)}
        {options.map(kind => <button type="button" key={kind.value} aria-pressed={!activePreset && draft.kind === kind.value} disabled={off} onClick={() => choose(kind.value)}>{kind.label}</button>)}
      </div>
      {draft.kind === 'year' && <FormRow label={t('年份')}><YearSelect value={draft.year ? Number(draft.year) : null} todayYear={todayYear} intent="records" recorded={recordedYears} disabled={off} onChange={year => patch({ year: String(year).padStart(4, '0') })}/></FormRow>}
      {draft.kind === 'month' && <FormRow label={t('月份')}><MonthInput yearIntent="past" label={t('月份')} min="0001-01" value={draft.month} disabled={off} onChange={month => patch({ month })}/></FormRow>}
      {draft.kind === 'range' && !activePreset && <>{yearQuickPick && <FormRow label={t('自然年')}><YearSelect label={t('自然年')} value={draftYear} todayYear={todayYear} intent="records" recorded={recordedYears} disabled={off} onChange={chooseYear}/></FormRow>}<FormRow label={t('开始日期')}><DateInput yearIntent="past" label={t('开始日期')} min="0001-01-01" max={yearQuickPick && todayText ? todayText : undefined} value={draft.from} disabled={off} onChange={from => patch({ from })}/></FormRow><FormRow label={t('结束日期')}><DateInput yearIntent="past" label={t('结束日期')} min="0001-01-01" max={yearQuickPick && todayText ? todayText : undefined} value={draft.to} disabled={off} onChange={to => patch({ to })}/></FormRow><p className="muted small">{draft.includeFrom ? t('含起始日，含结束日') : t('不含起始日，含结束日')}</p></>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted finance-period-applied" role="status">{error ? t('仍显示：') : t('当前期间：')}{describeFinancePeriod(value)}</p>
    </div>
  );
}
