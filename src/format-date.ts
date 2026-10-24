import { currentLang, numberLocale, t } from './i18n.ts';

/** Calendar heading, never a duration. Dates are interpreted without a timezone shift. */
export function calendarMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return month;
  if (currentLang() === 'en') {
    const date = new Date(`${match[1]}-${match[2]}-01T00:00:00Z`);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(numberLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }) : month;
  }
  return t('{v1} 年 {v2} 月', { v1: match[1], v2: Number(match[2]) });
}
