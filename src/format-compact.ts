import { currentLang, numberLocale, t } from './i18n.ts';

/** Display only: input remains cents. English cards use grouped yuan; Chinese keeps 万／亿. */
export function compactYuan(cents: number): string {
  const value = cents / 100, absolute = Math.abs(value), sign = value < 0 ? '−' : '';
  if (currentLang() === 'en') return `${sign}¥${Math.round(absolute).toLocaleString(numberLocale())}`;
  const trim = (n: number) => n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
  if (absolute >= 1e8) return t('{sign}¥{v2}亿', { sign, v2: trim(absolute / 1e8) });
  if (absolute >= 1e4) return t('{sign}¥{v2}万', { sign, v2: trim(absolute / 1e4) });
  return `${sign}¥${Math.round(absolute).toLocaleString(numberLocale())}`;
}

/** Chart ticks omit the currency symbol. English uses K/M/B for narrow axes. */
export function compactAxisYuan(cents: number): string {
  const value = Math.abs(cents) / 100, sign = cents < 0 ? '−' : '';
  if (currentLang() === 'en') return sign + new Intl.NumberFormat(numberLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(Math.round(value));
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (value >= 1e8) return t('{sign}{v2}亿', { sign, v2: trim(value / 1e8) });
  if (value >= 1e4) return t('{sign}{v2}万', { sign, v2: trim(value / 1e4) });
  return `${sign}${Math.round(value)}`;
}
