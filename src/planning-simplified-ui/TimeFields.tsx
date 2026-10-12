import { useState } from 'react';
import { MonthInput } from '../DateInput';
import { FormRow } from '../FormControls';
import type { FieldIssueV1, TimeInputV1 } from '../plan-simplified-contract.ts';
import { ageToMonthV1, monthIndexV1, validMonthV1 } from '../plan-simplified.ts';
import { ageMonthsOf, ageText } from './income-view';

/**
 * 通用时间输入：明确年月为主，年龄换算为可选辅助（设计 §12.1）。
 * 换算结果保存为明确月份；改年龄参考不悄悄改已保存时间，须看到将改变的月份再保存。
 */
export function TimeFields({ value, issues, busy, today, onChange }: { value: TimeInputV1; issues: FieldIssueV1[]; busy: boolean; today: string; onChange: (t: TimeInputV1) => void }) {
  const [ageOpen, setAgeOpen] = useState(false);
  const [refMonth, setRefMonth] = useState(value.reference?.month ?? today.slice(0, 7));
  const [refY, setRefY] = useState(value.reference ? String(Math.floor(value.reference.age_months / 12)) : '');
  const [refM, setRefM] = useState(value.reference && value.reference.age_months % 12 ? String(value.reference.age_months % 12) : '');
  const [ageY, setAgeY] = useState('');
  const [ageM, setAgeM] = useState('');
  const [err, setErr] = useState('');
  const parsedRef = ageMonthsOf(refY, refM);
  const refValid = validMonthV1(refMonth) && parsedRef !== null;
  const reference = refValid ? { month: refMonth, age_months: parsedRef } : null;
  const parsedAge = ageMonthsOf(ageY, ageM);
  const converted = reference && parsedAge !== null
    ? (() => { try { return ageToMonthV1(reference, parsedAge); } catch { return null; } })()
    : null;
  const ageEcho = value.reference && validMonthV1(value.reference.month) && validMonthV1(value.target_month ?? '')
    ? ageText(value.reference.age_months + monthIndexV1(value.target_month!) - monthIndexV1(value.reference.month))
    : null;
  function applyReference() {
    // 只更新参考本身；已保存月份不随之改写，需要用户看到换算结果后自行确认。
    if (reference) onChange({ ...value, reference });
  }
  function changeTargetAge() {
    if (parsedAge === null) return;
    if (!reference) { setErr('先确认年龄参考（参考月和当时的年龄），或直接填写年月。'); return; }
    if (converted === null) { setErr('换算月份超出范围，请直接填写年月。'); return; }
    setErr('');
    onChange({ ...value, reference, target_month: converted });
  }
  const timeIssues = issues.filter(i => i.path === 'time.target_month' || i.path === 'time.horizon_month' || i.path === 'time.reference.month' || i.path === 'time.reference.age_months');
  return <section className="form-block" aria-label="时间安排">
    <FormRow label="希望什么时候开始用这笔钱" hint="直接填年月；目标时间是你自己的安排，不等于法定退休或养老金开始领取时间">
      <MonthInput label="希望什么时候开始用这笔钱" value={value.target_month ?? ''} disabled={busy} allowClear onChange={v => onChange({ ...value, target_month: v === '' ? null : v })}/>
    </FormRow>
    <button type="button" className="ui-link" aria-expanded={ageOpen} disabled={busy} onClick={() => setAgeOpen(o => !o)}>{ageOpen ? '收起年龄换算' : '习惯用年龄？用年龄换算'}</button>
    {ageOpen && <div className="simplified-age-panel">
      <FormRow label="年龄参考月" hint="截至这个月你多大；只用于换算，不是出生日期">
        <MonthInput label="年龄参考月" value={refMonth} max={today.slice(0, 7)} disabled={busy} onChange={v => { setRefMonth(v); if (validMonthV1(v) && parsedRef !== null) onChange({ ...value, reference: { month: v, age_months: parsedRef } }); }}/>
      </FormRow>
      <FormRow label="当时的年龄" hint="只填整岁时，按参考月达到该整岁换算">
        <span className="simplified-age-inputs">
          <input aria-label="参考年龄：岁" inputMode="numeric" placeholder="例如 36" value={refY} disabled={busy} onChange={e => setRefY(e.target.value)} onBlur={applyReference}/> 岁
          <input aria-label="参考年龄：月" inputMode="numeric" placeholder="0" value={refM} disabled={busy} onChange={e => setRefM(e.target.value)} onBlur={applyReference}/> 个月
        </span>
      </FormRow>
      <p className="muted small" role="status">{refValid ? `截至 ${refMonth}，你 ${ageText(parsedRef!)}。` : '填好参考月和年龄后，才能用年龄换算。'}</p>
      <FormRow label="想从几岁开始" hint="换算成月份后保存；下个月打开不会自动顺延">
        <span className="simplified-age-inputs">
          <input aria-label="目标年龄：岁" inputMode="numeric" placeholder="例如 63" value={ageY} disabled={busy} onChange={e => { setAgeY(e.target.value); }} onBlur={changeTargetAge}/> 岁
          <input aria-label="目标年龄：月" inputMode="numeric" placeholder="0" value={ageM} disabled={busy} onChange={e => setAgeM(e.target.value)} onBlur={changeTargetAge}/> 个月
        </span>
      </FormRow>
      {converted && <p className="muted small" role="status">换算为 <strong>{converted}</strong>；保存后按这个月份计算。</p>}
      {converted && value.target_month !== converted && <button type="button" className="ui-btn" disabled={busy} onClick={() => { setErr(''); onChange({ ...value, reference, target_month: converted }); }}>把开始月份改为 {converted}</button>}
      {ageEcho && <p className="muted small">按当前参考，{value.target_month} 时你约 {ageEcho}。</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>}
    <FormRow label="安排到什么时候" hint="规划的终点月份；留空表示还没定">
      <MonthInput label="安排到什么时候" value={value.horizon_month ?? ''} disabled={busy} allowClear onChange={v => onChange({ ...value, horizon_month: v === '' ? null : v })}/>
    </FormRow>
    {timeIssues.map(i => <p key={i.path} className="error" role="alert">{i.message}</p>)}
  </section>;
}
