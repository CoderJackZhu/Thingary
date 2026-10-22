import { useState } from 'react';
import { MonthInput } from '../DateInput';
import { FormRow } from '../FormControls';
import type { FieldIssueV1, HouseholdV1, TimeInputV1 } from '../plan-simplified-contract.ts';
import { ageToMonthV1, validMonthV1 } from '../plan-simplified.ts';
import { ageAtMonth, ageMonthsOf, ageText } from './income-view';
import { HouseholdFields } from './HouseholdFields';

/** Birth month is a newly confirmed age-zero reference. Explicit months remain the calculation source. */
export function TimeFields({ value, issues, busy, today, onChange, household, onHouseholdChange }: { value: TimeInputV1; issues: FieldIssueV1[]; busy: boolean; today: string; onChange: (t: TimeInputV1) => void; household?: HouseholdV1; onHouseholdChange?: (h: HouseholdV1) => void }) {
  const [birth, setBirth] = useState(value.reference?.age_months === 0 ? value.reference.month : '');
  const parts = (month: string | null, reference = value.reference) => {
    const age = ageAtMonth(reference, month);
    return { years: age === null ? '' : String(Math.floor(age / 12)), months: age === null || age % 12 === 0 ? '' : String(age % 12) };
  };
  const [target, setTarget] = useState(() => parts(value.target_month));
  const [horizon, setHorizon] = useState(() => parts(value.horizon_month));
  const [error, setError] = useState('');
  const reference = value.reference;
  const targetAge = ageAtMonth(reference, value.target_month), horizonAge = ageAtMonth(reference, value.horizon_month);
  const currentAge = ageAtMonth(reference, today.slice(0, 7));
  function changeBirth(month: string) {
    setBirth(month);
    const nextReference = validMonthV1(month) && month <= today.slice(0, 7) ? { month, age_months: 0 } : null;
    // A corrected reference updates the age display, never silently shifts existing dates.
    setTarget(parts(value.target_month, nextReference)); setHorizon(parts(value.horizon_month, nextReference));
    setError(month && !nextReference ? '请填写有效的出生年月，不能晚于当前月份。' : '');
    onChange({ ...value, reference: nextReference });
  }
  function changeAge(field: 'target_month' | 'horizon_month', next: typeof target) {
    (field === 'target_month' ? setTarget : setHorizon)(next);
    const age = ageMonthsOf(next.years, next.months);
    let month: string | null = null;
    try { if (age !== null && reference) month = ageToMonthV1(reference, age); } catch { /* Remains unknown. */ }
    setError(next.years !== '' && month === null ? '年龄须为 0 到 120 岁，月份为 0 到 11；请先确认出生年月。' : '');
    onChange({ ...value, [field]: month });
  }
  function changeMonth(field: 'target_month' | 'horizon_month', month: string) {
    (field === 'target_month' ? setTarget : setHorizon)(parts(month || null));
    setError(''); onChange({ ...value, [field]: month || null });
  }
  const ageInput = (label: string, field: 'target_month' | 'horizon_month', age: typeof target) => <input type="number" aria-label={label} min="0" max="120" step="1" inputMode="numeric" placeholder={field === 'target_month' ? '例如 60' : '例如 90'} value={age.years} disabled={busy || !reference} onChange={e => changeAge(field, { years: e.target.value, months: '' })}/>;
  const timeIssues = issues.filter(i => i.path.startsWith('time.'));
  return <section className="form-block" aria-label="时间安排">
    {household && onHouseholdChange && <HouseholdFields value={household} issues={issues} busy={busy} today={today} onChange={onHouseholdChange}/>}
    <FormRow label="出生年月" hint="用于显示退休年龄及自动换算月份；修改后会保留已有月份，请核对年龄">
      <MonthInput yearIntent="long" label="出生年月" value={birth} max={today.slice(0, 7)} disabled={busy} allowClear onChange={changeBirth}/>
    </FormRow>
    {reference && reference.age_months !== 0 && <p className="muted small">已有年龄参考：{reference.month} 时 {ageText(reference.age_months)}，仍可用于换算；出生年月尚未填写。</p>}
    {!reference && <p className="muted small">填好出生年月后，直接填写退休年龄和规划终点年龄；也可以在下方按月份填写。{(value.target_month || value.horizon_month) && `已有月份保留：退休 ${value.target_month ?? '未填'}，规划到 ${value.horizon_month ?? '未填'}。`}</p>}
    <FormRow label="希望多少岁退休" hint="你希望停止工作的年龄，不等于养老金领取年龄">
      {ageInput('退休年龄（岁）', 'target_month', target)}
    </FormRow>
    <FormRow label="规划到多少岁" hint="预算准备到这个年龄，不是对寿命的预测">
      {ageInput('规划终点年龄（岁）', 'horizon_month', horizon)}
    </FormRow>
    {reference && <p className="muted small" role="status">{currentAge !== null && `目前约 ${ageText(currentAge)}。`}退休：{targetAge === null ? value.target_month ?? '未填写' : `${ageText(targetAge)}（${value.target_month}）`}；规划到：{horizonAge === null ? value.horizon_month ?? '未填写' : `${ageText(horizonAge)}（${value.horizon_month}）`}。软件自动换算月份。</p>}
    <details open={Number(target.months) > 0 || Number(horizon.months) > 0 ? true : undefined}><summary>精确到几岁几个月（选填）</summary>
      {([{ field: 'target_month', age: target, label: '退休年龄：额外月份' }, { field: 'horizon_month', age: horizon, label: '规划终点年龄：额外月份' }] as const).map(({ field, age, label }) => <FormRow key={field} label={label}><input type="number" aria-label={label} min="0" max="11" step="1" placeholder="0" value={age.months} disabled={busy || !reference} onChange={e => changeAge(field, { ...age, months: e.target.value })}/></FormRow>)}
    </details>
    <details><summary>直接按月份填写</summary>
      <FormRow label="退休开始月份"><MonthInput yearIntent="long" label="退休开始月份" value={value.target_month ?? ''} disabled={busy} allowClear onChange={month => changeMonth('target_month', month)}/></FormRow>
      <FormRow label="规划终点月份" hint="留空表示还没定；结束月份须晚于退休开始月份"><MonthInput yearIntent="long" label="规划终点月份" value={value.horizon_month ?? ''} disabled={busy} allowClear onChange={month => changeMonth('horizon_month', month)}/></FormRow>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    {timeIssues.map(i => <p key={i.path} className="error" role="alert">{i.message}</p>)}
  </section>;
}
