import { DateInput } from './DateInput';
import { CentInput, FormRow, Segments, Switch } from './FormControls';
import { intervals, intervalText } from './recurring';
import type { PlanFields } from './recurring';
import { firstSubscriptionPeriod, periodLabel, previousDay, shiftMonth, suggestCoverage } from './recurring-model';

export function PlanFieldsForm({ fields: f, onChange, disabled, today, editing = false }: { fields: PlanFields; onChange: (f: PlanFields) => void; disabled: boolean; today: string; editing?: boolean }) {
  const fixed = f.end_date !== null, past = f.category === 'subscription' && !!f.end_date && f.end_date < today;
  const set = <K extends keyof PlanFields>(k: K, v: PlanFields[K]) => onChange({ ...f, [k]: v });
  const modern = f.service_start !== null && f.service_start !== undefined;
  const firstPeriod = firstSubscriptionPeriod(f);
  const updateSchedule = (next: PlanFields) => onChange({ ...next, coverage_start: modern ? suggestCoverage(next.service_start!, next.first_due, next.interval_months) : null });
  return <>
    <FormRow label="付款周期"><Segments label="付款周期" value={String(f.interval_months) as '1' | '3' | '6' | '12'} disabled={disabled} options={intervals.map(([k, l]) => ({ value: String(k) as '1' | '3' | '6' | '12', label: l }))} onChange={v => updateSchedule({ ...f, interval_months: Number(v) })}/></FormRow>
    <FormRow label={`${intervalText(f.interval_months)}${f.interval_months === 1 ? '金额' : '总额'}`} hint="填一次付款的总金额；不自动记为已付"><CentInput label="每期金额" value={f.amount_cents} disabled={disabled} placeholder="0.00" onChange={v => set('amount_cents', v)}/></FormRow>
    {modern && <FormRow label={f.category === 'rent' ? '租住开始日期' : '开始使用日期'} hint="可填历史日期，不会自动补记历史付款"><DateInput id="plan-service-start" label={f.category === 'rent' ? '租住开始日期' : '开始使用日期'} value={f.service_start!} disabled={disabled} onChange={v => updateSchedule({ ...f, service_start: v })}/></FormRow>}
    <FormRow label={past ? '付款日' : modern ? '下一期付款日' : '首次付款日'} hint={past ? '用于推算过去各期；不安排结束后的付款' : modern ? '付款排期起点，不是订阅结束日期；允许提前付款' : '旧计划保留原有排期起点'}><DateInput id="plan-first-due" label={past ? '付款日' : modern ? '下一期付款日' : '首次付款日'} value={f.first_due} disabled={disabled} onChange={v => updateSchedule({ ...f, first_due: v })}/></FormRow>
    {firstPeriod && <p className="muted small">首期服务：{periodLabel(...firstPeriod)}。{past ? '历史费用按服务起止日期估算，不安排后续续费。' : fixed ? '续费截止于指定结束日期。' : `${shiftMonth(firstPeriod[0], f.interval_months)} 开始下一期，按此周期持续续费。`}不自动记为已付。</p>}
    <FormRow label="结束方式"><Segments label="结束方式" value={fixed ? 'fixed' : 'ongoing'} disabled={disabled} options={[{ value: 'ongoing', label: f.category === 'subscription' ? '持续续费' : '持续进行' }, { value: 'fixed', label: '有结束日期' }]} onChange={v => set('end_date', v === 'ongoing' ? null : f.end_date ?? previousDay(shiftMonth(f.service_start ?? f.first_due, f.category === 'subscription' ? f.interval_months : 12)))}/></FormRow>
    {fixed && <FormRow label={f.category === 'rent' ? '租期结束日期' : '结束日期'} hint="最后使用日期，含当天；之后不再续费"><DateInput id="plan-end" label={f.category === 'rent' ? '租期结束日期' : '结束日期'} value={f.end_date ?? ''} disabled={disabled} min={f.service_start ?? f.first_due} onChange={v => set('end_date', v)}/></FormRow>}
    {modern && f.category === 'subscription' && !fixed && f.first_due < today && <p className="muted small">过去的付款日仍会按周期顺延。若这项服务已经停止，请填写实际结束日期，日期已过会自动显示已结束。</p>}
    {modern && <details className="plan-advanced"><summary>付款覆盖期与更多设置</summary><FormRow label="本期服务开始日" hint="例如 10 月 25 日付 11 月租金，这里填 11 月 1 日"><DateInput id="plan-coverage-start" label="本期服务开始日" value={f.coverage_start ?? ''} min={f.service_start!} disabled={disabled} onChange={v => set('coverage_start', v)}/></FormRow><p className="muted small">付款对应从该日开始的一整个周期。历史补记在保存后的计划里操作。</p></details>}
    {editing && <FormRow label="暂停续费" hint="不改变已付记录；恢复从当天起管理，不补暂停期间"><Switch label="暂停续费" value={f.paused} disabled={disabled} onChange={v => set('paused', v)}/></FormRow>}
    {modern && f.service_start! > today && <p className="muted small">这项安排尚未开始。</p>}
  </>;
}
