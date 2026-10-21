import type { FieldIssueV1, HouseholdV1, SimplifiedPlanningFieldsV1, TimeInputV1 } from '../plan-simplified-contract.ts';
import { monthIndexV1, validMonthV1, validateSimplifiedPlanningV1 } from '../plan-simplified.ts';

/** Household view helpers: pure, shared by the setup fields and the result lines. */
export const SINGLE: HouseholdV1 = { mode: 'single', partner: null };
export const PARTNER_STOP_MIN_YEARS = 18, PARTNER_STOP_MAX_YEARS = 100;
/** Stored while the age box is empty or out of range; the contract validator rejects it, so it can never be saved. */
export const STOP_AGE_INCOMPLETE = -1;

export const householdOf = (f: { household?: HouseholdV1 | null }): HouseholdV1 => f.household ?? SINGLE;
export const isCouple = (h: HouseholdV1 | null | undefined): h is HouseholdV1 & { partner: NonNullable<HouseholdV1['partner']> } => h?.mode === 'couple' && h.partner !== null;
/** Partner share is only asked when the partner stops at an explicit age. */
export const hasPartnerAge = (h: HouseholdV1 | null | undefined): boolean => isCouple(h) && h.partner.stop_age_months !== null;

/** Switching back to one person drops every partner field; switching to two keeps what was typed. */
export function switchHousehold(current: HouseholdV1, mode: HouseholdV1['mode']): HouseholdV1 {
  if (mode === 'single') return { mode: 'single', partner: null };
  return current.mode === 'couple' && current.partner ? current : { mode: 'couple', partner: { birth_month: '', stop_age_months: null, monthly_cents: null } };
}
export function stopAgeFromText(text: string): number {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return STOP_AGE_INCOMPLETE;
  const years = Number(t);
  return years >= PARTNER_STOP_MIN_YEARS && years <= PARTNER_STOP_MAX_YEARS ? years * 12 : STOP_AGE_INCOMPLETE;
}
export const stopAgeText = (months: number | null): string => months === null || months < 0 ? '' : String(Math.floor(months / 12));

/** Household issues only, with a friendlier age message than the contract's month range. */
export function householdIssues(f: SimplifiedPlanningFieldsV1, today: string): FieldIssueV1[] {
  return validateSimplifiedPlanningV1(f, today).filter(i => i.path.startsWith('household')).map(i =>
    i.path === 'household.partner.stop_age_months' ? { ...i, message: `伴侣停工年龄请填 ${PARTNER_STOP_MIN_YEARS} 到 ${PARTNER_STOP_MAX_YEARS} 的整岁数。` }
      : i.path === 'household.partner.birth_month' ? { ...i, message: '请填写有效的伴侣出生年月，不能晚于当前月份。' } : i);
}

/** The partner's birth month as an age-zero reference, for converting an age into a month. */
export const partnerReference = (h: HouseholdV1 | null | undefined): TimeInputV1['reference'] =>
  isCouple(h) && validMonthV1(h.partner.birth_month) ? { month: h.partner.birth_month, age_months: 0 } : null;

export function partnerAgeMonthsAt(h: HouseholdV1 | null | undefined, month: string | null): number | null {
  const ref = partnerReference(h);
  if (!ref || !validMonthV1(month)) return null;
  const age = monthIndexV1(month) - monthIndexV1(ref.month);
  return age >= 0 ? age : null;
}

/** A known share and a partner stop month after this month: the requirement amount is the household total while the partner works. */
export function isSplitCouple(h: HouseholdV1 | null | undefined, today: string): boolean {
  if (!isCouple(h) || h.partner.stop_age_months === null || h.partner.monthly_cents === null || !validMonthV1(h.partner.birth_month)) return false;
  return monthIndexV1(h.partner.birth_month) + h.partner.stop_age_months > monthIndexV1(today.slice(0, 7));
}
export const SPLIT_REQUIREMENT_HINT = '这是两人合计每月要存的钱：伴侣还在工作时，包含伴侣那一份。';

export const monthLabel = (m: string): string => `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月`;

/** At most two short result lines for a couple; each is omitted when its facts are not known. */
export function householdLines(household: HouseholdV1 | null | undefined, summary: { both_stop_month: string | null; same_time_stop_month: string | null } | undefined, myStopMonth: string | null): string[] {
  if (!summary || !isCouple(household)) return [];
  const lines: string[] = [];
  const age = partnerAgeMonthsAt(household, summary.both_stop_month);
  if (summary.both_stop_month && age !== null) lines.push(`两人都不上班：${monthLabel(summary.both_stop_month)}，那时伴侣 ${Math.floor(age / 12)} 岁`);
  const stop = household.partner.stop_age_months;
  if (summary.same_time_stop_month && myStopMonth && stop !== null && stop >= 0) {
    const diff = monthIndexV1(summary.same_time_stop_month) - monthIndexV1(myStopMonth);
    if (diff !== 0) lines.push(`伴侣工作到 ${Math.floor(stop / 12)} 岁，你${diff > 0 ? '能比两人同时停工早' : '比两人同时停工晚'} ${Math.abs(diff)} 个月`);
  }
  return lines;
}
