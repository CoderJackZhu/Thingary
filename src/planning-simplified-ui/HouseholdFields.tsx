import { useState } from 'react';
import { MonthInput } from '../DateInput';
import { CentInput, FormRow, Segments } from '../FormControls';
import type { FieldIssueV1, HouseholdV1 } from '../plan-simplified-contract.ts';
import { PARTNER_STOP_MAX_YEARS, PARTNER_STOP_MIN_YEARS, STOP_AGE_INCOMPLETE, hasPartnerAge, isCouple, stopAgeFromText, stopAgeText, switchHousehold } from './household-view';
import { t } from '../i18n.ts';
/** 「规划给谁」: one switch. Two people adds the partner's birth month and stop age; nothing else. */
export function HouseholdFields({ value, issues, busy, today, onChange }: { value: HouseholdV1; issues: FieldIssueV1[]; busy: boolean; today: string; onChange: (h: HouseholdV1) => void }) {
  const partner = isCouple(value) ? value.partner : null;
  const [age, setAge] = useState(() => stopAgeText(partner?.stop_age_months ?? null));
  const at = (path: string) => issues.filter(i => i.path === path).map(i => <p key={i.path} className="error" role="alert">{i.message}</p>);
  const setPartner = (v: Partial<NonNullable<HouseholdV1['partner']>>) => partner && onChange({ mode: 'couple', partner: { ...partner, ...v } });
  const changeAge = (text: string) => { setAge(text); const months = stopAgeFromText(text); setPartner({ stop_age_months: months, monthly_cents: months === STOP_AGE_INCOMPLETE ? null : partner!.monthly_cents }); };
  return <>
    <FormRow label={t('规划给谁')} hint={t('两个人时，生活费和每月存款都按两人合计填写。')}>
      <Segments label={t('规划给谁')} value={value.mode} disabled={busy} options={[{ value: 'single', label: t('一个人') }, { value: 'couple', label: t('两个人') }]}
        onChange={mode => { setAge(''); onChange(switchHousehold(value, mode)); }}/>
    </FormRow>
    {partner && <>
      <FormRow label={t('伴侣出生年月')}>
        <MonthInput yearIntent="long" label={t('伴侣出生年月')} value={partner.birth_month} max={today.slice(0, 7)} disabled={busy} allowClear onChange={v => setPartner({ birth_month: v })}/>
      </FormRow>
      {at('household.partner.birth_month')}
      <FormRow label={t('伴侣打算几岁停工')} hint={t('选「跟我同时」，伴侣和你一起停止工作。')}>
        <Segments label={t('伴侣停工时间')} value={partner.stop_age_months === null ? 'same' : 'age'} disabled={busy}
          options={[{ value: 'same', label: t('跟我同时') }, { value: 'age', label: t('指定年龄') }]}
          onChange={v => { if (v === 'same') { setAge(''); setPartner({ stop_age_months: null, monthly_cents: null }); } else setPartner({ stop_age_months: STOP_AGE_INCOMPLETE }); }}/>
      </FormRow>
      {partner.stop_age_months !== null && <FormRow label={t('伴侣停工年龄（岁）')}>
        <input type="number" aria-label={t('伴侣停工年龄（岁）')} min={PARTNER_STOP_MIN_YEARS} max={PARTNER_STOP_MAX_YEARS} step="1" inputMode="numeric" placeholder={t('例如 60')} value={age} disabled={busy} onChange={e => changeAge(e.target.value)}/>
      </FormRow>}
      {at('household.partner.stop_age_months')}
    </>}
    {at('household')}{at('household.mode')}{at('household.partner')}
  </>;
}

/** Shown next to the monthly saving, only when the partner stops at a given age. */
export function PartnerShareField({ value, issues = [], busy, onChange }: { value: HouseholdV1; issues?: FieldIssueV1[]; busy: boolean; onChange: (h: HouseholdV1) => void }) {
  if (!isCouple(value) || !hasPartnerAge(value)) return null;
  const own = issues.filter(i => i.path === 'household.partner.monthly_cents');
  return <>
    <FormRow label={t('其中伴侣每月存多少')} hint={t('已包含在两人每月一共能存的金额里，不是另外加的；不确定可以先空着。')}>
      <CentInput label={t('其中伴侣每月存多少')} value={value.partner.monthly_cents ?? ''} disabled={busy} placeholder={t('不确定可留空')} onChange={v => onChange({ mode: 'couple', partner: { ...value.partner, monthly_cents: v === '' ? null : v } })}/>
    </FormRow>
    {own.map(i => <p key={i.path} className="error" role="alert">{i.message}</p>)}
  </>;
}
