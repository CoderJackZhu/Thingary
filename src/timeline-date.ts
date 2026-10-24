import { numberLocale, t } from './i18n.ts';

const dateValue = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const english = (locale: string) => locale.startsWith('en');

/** Group heading. Chinese output stays `2026 年 10 月`; English uses `October 2026`. */
export function timelineMonth(date: string, locale = numberLocale()): string {
  if (!english(locale)) return t('{v1} 年 {v2} 月', { v1: date.slice(0, 4), v2: Number(date.slice(5, 7)) });
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateValue(date));
}

/** Day label. Chinese stays `23` + `日`; English shows the bare day number. */
export function timelineDay(date: string, locale = numberLocale()): { number: string; suffix: string } {
  if (!english(locale)) return { number: String(Number(date.slice(8))), suffix: t('日') };
  return { number: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(dateValue(date)), suffix: '' };
}
