import { DateInput } from './DateInput';
import { CentInput, FormRow, Segments, Switch } from './FormControls';
import { intervals, intervalText, intervalDaysText } from './recurring';
import type { PlanFields } from './recurring';
import { firstSubscriptionPeriod, periodLabel, shiftDays, shiftPeriod, suggestCoverage, suggestedFinalDay, syncSuggestedFinalDay } from './recurring-model';
import { useRef, useState, type ReactNode } from 'react';

const dayPresets = [7, 30, 90, 365] as const;
/** 固定天数周期合法范围 1–3650（设计 §4.2）。 */
const parseDays = (v: string): number | null => {
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 3650 ? n : null;
};

/**
 * 订阅计划字段（基础区＋单层高级区，review R10/R12/R14）。基础区：周期、
 * 每期金额、开始使用日期、自动续费与可空最后使用日期、即时摘要；试用、
 * 固定天数、付款锚点与覆盖期、暂停都在唯一的“高级订阅设置”里。
 */
export function PlanFieldsForm({ fields: f, onChange, disabled, today, editing = false, firstDueTouched = false, onFirstDueTouched, advanced }: { advanced?: ReactNode; fields: PlanFields; onChange: (f: PlanFields) => void; disabled: boolean; today: string; editing?: boolean; firstDueTouched?: boolean; onFirstDueTouched?: () => void }) {
  const fixed = f.end_date !== null;
  // Existing dates and dates entered by hand are explicit facts, never suggestions.
  const finalDayLinked = useRef(false);
  const change = (next: PlanFields) => onChange(syncSuggestedFinalDay(next, today, finalDayLinked.current));
  const set = <K extends keyof PlanFields>(k: K, v: PlanFields[K]) => {
    if (k === 'end_date') finalDayLinked.current = false;
    change({ ...f, [k]: v });
  };
  const modern = f.service_start !== null && f.service_start !== undefined;
  const isSubscription = f.category === 'subscription';
  // 尚未手工修改的付款锚点随开始日期／试用联动（review R10）：下次付款
  // 本身是推算值，锚点不滚动。
  const updateSchedule = (next: PlanFields) => {
    const billing = next.trial_days && next.service_start ? shiftDays(next.service_start, next.trial_days) : next.service_start;
    const linkedDue = !firstDueTouched && billing ? billing : next.first_due;
    change({
      ...next,
      first_due: linkedDue,
      coverage_start: billing && linkedDue ? suggestCoverage(billing, linkedDue, next.interval_days ?? next.interval_months, !!next.interval_days) : null,
    });
  };
  const mode = f.interval_days ? 'days' : String(f.interval_months);
  // 选择状态与有效数值分开（review R12）：进入“自定义…”后可编辑任意
  // 1–3650 天，空／超限输入有明确定位错误，不再跳回 30。
  const [customDays, setCustomDays] = useState(!!f.interval_days && !dayPresets.includes(f.interval_days as 7 | 30 | 90 | 365));
  const [daysDraft, setDaysDraft] = useState(String(f.interval_days ?? ''));
  const daysInvalid = mode === 'days' && customDays && parseDays(daysDraft) == null;
  const applyDays = (raw: string) => {
    setDaysDraft(raw);
    const n = parseDays(raw);
    if (n) updateSchedule({ ...f, interval_days: n, interval_months: 1 });
  };
  const setMode = (v: string) => {
    if (v === 'days') {
      const first = parseDays(daysDraft) ?? 30;
      updateSchedule({ ...f, interval_days: first, interval_months: 1 });
    } else {
      setCustomDays(false);
      updateSchedule({ ...f, interval_days: null, interval_months: Number(v) });
    }
  };
  const setTrial = (on: boolean) => {
    if (!modern || !f.service_start) return;
    if (!on) { updateSchedule({ ...f, trial_days: null }); return; }
    // 试用从开始日计入第一天；计费起点默认推到试用结束的次日（设计 §4.4）。
    const billing = shiftDays(f.service_start, 7);
    change({ ...f, trial_days: 7, first_due: firstDueTouched ? f.first_due : billing, coverage_start: billing });
  };
  const setTrialDays = (raw: string) => {
    const n = parseDays(raw);
    if (!n || !modern || !f.service_start) return;
    const billing = shiftDays(f.service_start, n);
    change({ ...f, trial_days: n, first_due: firstDueTouched ? f.first_due : billing, coverage_start: billing });
  };
  // 自动续费与最后使用日是两个独立控件（review R14）：开启续费仍可指定
  // 最终使用日；关闭续费必须确认“使用至”某天。
  const suggestEnd = () => suggestedFinalDay(f, today);
  const setSuggestedEnd = () => {
    finalDayLinked.current = true;
    change({ ...f, end_date: suggestEnd() });
  };
  const firstPeriod = firstSubscriptionPeriod(f);
  const ended = fixed && (f.end_date ?? '') < today;
  // 草稿摘要的下次付款按草稿规则即时推算，不读保存前的 next_due（R14）。
  const draftNextDue = (() => {
    if (!f.first_due || ended) return null;
    const from = f.first_due >= today ? f.first_due : today;
    for (let k = 0; k < 2400; k++) {
      const due = shiftPeriod(f.first_due, f, k);
      if (due > '2100-01-01') return null;
      if (due >= from && (!f.end_date || due <= f.end_date)) return due;
    }
    return null;
  })();
  const endError = fixed && f.end_date && f.service_start && f.end_date < f.service_start;
  return <>
    <FormRow label="付款周期" hint="自然月／季／半年／年；固定天数在高级订阅设置中">{mode === 'days'
      ? <p className="muted small" style={{ margin: 0 }}>{intervalDaysText(f.interval_days ?? 30)} · <button type="button" className="ui-link" disabled={disabled} onClick={() => { const details = document.getElementById('plan-advanced-details') as HTMLDetailsElement | null; if (details) details.open = true; }}>调整</button></p>
      : <Segments label="付款周期" value={mode} disabled={disabled} options={intervals.map(([k, l]) => ({ value: String(k), label: l }))} onChange={setMode}/>}</FormRow>
    <FormRow label={`${f.interval_days ? intervalDaysText(f.interval_days) : intervalText(f.interval_months)}${(f.interval_days ? 1 : f.interval_months) === 1 ? '金额' : '总额'}`} hint="填一次付款的总金额；不自动记为已付"><CentInput label="每期金额" value={f.amount_cents} disabled={disabled} placeholder="0.00" onChange={v => set('amount_cents', v)}/></FormRow>
    {modern && <FormRow label={f.category === 'rent' ? '租住开始日期' : '开始使用日期'} hint="可填历史日期；未手改的付款锚点随之联动"><DateInput id="plan-service-start" label={f.category === 'rent' ? '租住开始日期' : '开始使用日期'} value={f.service_start!} disabled={disabled} onChange={v => updateSchedule({ ...f, service_start: v })}/></FormRow>}
    <FormRow label="自动续费" hint={fixed ? '按周期续费至最后使用日期' : '开启则按周期持续续费；关闭需确认最后使用日期'}><div className="form-inline"><Switch label="自动续费" value={f.auto_renew !== false} disabled={disabled} onChange={on => {
      if (!on && f.end_date === null) finalDayLinked.current = true;
      const end = on && finalDayLinked.current ? null : on ? f.end_date : (f.end_date ?? suggestEnd());
      if (on && finalDayLinked.current) finalDayLinked.current = false;
      change({ ...f, auto_renew: on, end_date: end });
    }}/>{!fixed && <button type="button" className="ui-link" disabled={disabled} onClick={setSuggestedEnd}>设定最后使用日期…</button>}</div></FormRow>
    {fixed && <FormRow label="最后使用日期" hint="含当天；之后不再续费，按日期自动结束"><DateInput id="plan-end" label="最后使用日期" value={f.end_date ?? ''} disabled={disabled} min={f.service_start ?? f.first_due} allowClear={f.auto_renew !== false} onChange={v => set('end_date', v || null)}/>{endError && <small className="error" role="alert">结束日期不能早于开始使用日期</small>}</FormRow>}
    {(firstPeriod || draftNextDue || ended) && <p className="muted small" aria-live="polite">{[
      f.trial_days && f.service_start ? `试用至 ${shiftDays(f.service_start, f.trial_days - 1)}，计费开始 ${shiftDays(f.service_start, f.trial_days)}` : null,
      firstPeriod ? `首期 ${periodLabel(...firstPeriod)}` : null,
      ended ? '已结束，无后续付款' : draftNextDue ? `下次付款 ${draftNextDue}（按草稿推算）` : null,
      fixed ? `使用至 ${f.end_date}` : '持续续费',
    ].filter(Boolean).join('；')}。</p>}
    <details className="plan-advanced" id="plan-advanced-details"><summary>高级订阅设置</summary>
      {isSubscription && modern && <><FormRow label="免费试用" hint="默认关闭；打开后默认 7 天，从开始日计入第一天"><Switch label="免费试用" value={!!f.trial_days} disabled={disabled} onChange={setTrial}/></FormRow>
      {!!f.trial_days && <FormRow label="试用天数" hint="1–3650 天；计费起点＝开始日＋试用天数"><input aria-label="试用天数" inputMode="numeric" value={f.trial_days ?? ''} disabled={disabled} onChange={e => setTrialDays(e.target.value)}/><small className="muted">计费开始 {f.coverage_start ?? '待填写'}</small></FormRow>}</>}
      <FormRow label="周期类型" hint="自然月按原始锚点顺延；固定天数按自然日计数"><Segments label="周期类型" value={mode === 'days' ? 'days' : 'months'} disabled={disabled} options={[{ value: 'months', label: '自然历' }, { value: 'days', label: '固定天数' }]} onChange={v => setMode(v === 'days' ? 'days' : String(f.interval_months && !f.interval_days ? f.interval_months : 1))}/></FormRow>
      {mode === 'days' && <FormRow label="固定天数" hint="7／30／90／365 或自定义 1–3650 天，按自然日计数"><div className="form-inline"><select aria-label="固定天数预设" value={customDays || !dayPresets.includes(f.interval_days as 7 | 30 | 90 | 365) ? 'custom' : String(f.interval_days)} disabled={disabled} onChange={e => { const v = e.target.value; if (v === 'custom') { setCustomDays(true); setDaysDraft(String(f.interval_days ?? '')); } else { setCustomDays(false); updateSchedule({ ...f, interval_days: Number(v), interval_months: 1 }); } }}>{dayPresets.map(d => <option key={d} value={d}>{intervalDaysText(d)}</option>)}<option value="custom">自定义…</option></select>{(customDays || !dayPresets.includes(f.interval_days as 7 | 30 | 90 | 365)) && <input aria-label="自定义天数" aria-invalid={daysInvalid} required pattern="[0-9]+" type="number" min={1} max={3650} inputMode="numeric" placeholder="1–3650" value={customDays ? daysDraft : String(f.interval_days ?? '')} disabled={disabled} onChange={e => applyDays(e.target.value)}/>}</div>{daysInvalid && <small className="error" role="alert">天数须为 1–3650 的整数</small>}</FormRow>}
      <FormRow label={firstDueTouched ? '付款日锚点' : '付款日（随开始日期联动）'} hint="付款排期锚点，不是结束日期；手工修改后停止联动"><div className="form-inline"><DateInput id="plan-first-due" label="付款日" value={f.first_due} disabled={disabled} onChange={v => { onFirstDueTouched?.(); onChange({ ...f, first_due: v }); }}/></div></FormRow>
      {modern && <FormRow label="本期服务开始日" hint="例如 10 月 25 日付 11 月租金，这里填 11 月 1 日"><DateInput id="plan-coverage-start" label="本期服务开始日" value={f.coverage_start ?? ''} min={f.service_start!} disabled={disabled} onChange={v => set('coverage_start', v)}/></FormRow>}
      {editing && <FormRow label="暂停续费" hint="旧计划的暂停排期，独立于自动续费开关；恢复从当天起管理，不补暂停期间"><Switch label="暂停续费" value={f.paused} disabled={disabled} onChange={v => set('paused', v)}/></FormRow>}
      {modern && f.service_start! > today && <p className="muted small">这项安排尚未开始。</p>}
      {advanced}
    </details>
  </>;
}
