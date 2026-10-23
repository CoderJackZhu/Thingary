// 选币种：默认币种、最近使用、常用、全部（按代码字母序）。名称与符号来自 Intl，随界面语言变化；不联网。
import { currencies, currencyRegion, decimalUnits } from './currency.ts';
import { referenceRates, referenceRatesDate } from './reference-rates.ts';
import { numberLocale, t } from './i18n.ts';

export const commonCurrencies = ['CNY', 'USD', 'JPY', 'EUR', 'GBP', 'KRW', 'HKD', 'TWD'] as const;
const recentKey = 'thingary.currency.recent', defaultKey = 'thingary.currency.default';
const store = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const known = (code: string | null): code is string => !!code && currencies.some(c => c[0] === code);

export function readDefaultCurrency(): string {
  const v = store()?.getItem(defaultKey) ?? null;
  return known(v) ? v : 'CNY';
}
export function writeDefaultCurrency(code: string): boolean {
  if (!known(code)) return false;
  try { store()?.setItem(defaultKey, code); return true; } catch { return false; }
}
export function readRecentCurrencies(): string[] {
  try { const v = JSON.parse(store()?.getItem(recentKey) ?? '[]'); return Array.isArray(v) ? v.filter(known).slice(0, 3) : []; } catch { return []; }
}
/** 选定一个币种后调用：放到“最近使用”最前，最多 3 个。 */
export function rememberCurrency(code: string): void {
  if (!known(code)) return;
  try { store()?.setItem(recentKey, JSON.stringify([code, ...readRecentCurrencies().filter(c => c !== code)].slice(0, 3))); } catch { /* storage unavailable: nothing to remember */ }
}

export const flagOf = (code: string): string => {
  const region = currencyRegion[code];
  return region ? String.fromCodePoint(...[...region].map(ch => 0x1f1a5 + ch.charCodeAt(0))) : '';
};
/** Windows 的系统字体不显示国旗 emoji，只显示两个字母；那里不放国旗。 */
export const flagsSupported = (userAgent = globalThis.navigator?.userAgent ?? ''): boolean => !/Windows/i.test(userAgent);
const names = (locale: string) => { try { return new Intl.DisplayNames(locale, { type: 'currency' }); } catch { return null; } };
export function currencyName(code: string, locale = numberLocale()): string {
  return names(locale)?.of(code) ?? currencies.find(c => c[0] === code)?.[1] ?? code;
}
export function currencySymbol(code: string, locale = numberLocale()): string {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency')?.value ?? code; } catch { return code; }
}

export type PickerSection = { id: 'default' | 'recent' | 'common' | 'all'; title: string; codes: string[] };
const allCodes = (): string[] => currencies.map(c => c[0]).sort();
function matches(code: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [code, currencyName(code, 'zh-CN'), currencyName(code, 'en'), currencySymbol(code, 'en'), currencyRegion[code] ?? ''].join('\n').toLowerCase();
  return hay.includes(q);
}
/** 有搜索词时只给一个平铺的结果段；否则依次是默认、最近、常用、全部，同一币种在前面的段出现过就不在后面重复。 */
export function pickerSections(query: string, defaultCode = readDefaultCurrency(), recent = readRecentCurrencies()): PickerSection[] {
  if (query.trim()) return [{ id: 'all', title: t('搜索结果'), codes: allCodes().filter(c => matches(c, query)) }];
  const seen = new Set<string>(), take = (codes: readonly string[]) => codes.filter(c => known(c) && !seen.has(c) && !!seen.add(c));
  const sections: PickerSection[] = [
    { id: 'default', title: t('默认币种'), codes: take([defaultCode]) },
    { id: 'recent', title: t('最近使用'), codes: take(recent) },
    { id: 'common', title: t('常用'), codes: take(commonCurrencies) },
  ];
  sections.push({ id: 'all', title: t('全部币种'), codes: allCodes().filter(c => !seen.has(c)) });
  return sections.filter(s => s.codes.length);
}

const rateKey = 'thingary.currency.rates';
const readRates = (): Record<string, string> => { try { const v = JSON.parse(store()?.getItem(rateKey) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const rateText = (micro: string): string => decimalUnits(micro, 6).replace(/\.?0+$/, '');
/** The rate the user saved last (or set on the 汇率 page) for a currency; empty if none. Stays on this device, outside the backup. */
export const savedRate = (code: string): string => (typeof readRates()[code] === 'string' ? readRates()[code] : '');
/** The rate offered as a default: the saved one, else the built-in reference (an ECB snapshot that ships with the release), else empty. */
export const readRate = (code: string): string => savedRate(code) || (referenceRates[code] ? rateText(referenceRates[code]) : '');
/** True while `text` is just the unchanged built-in reference, so the UI can say so. */
export const isReferenceRate = (code: string, text: string): boolean => !savedRate(code) && !!referenceRates[code] && text.trim() === rateText(referenceRates[code]);
export const referenceRateOf = (code: string): string => (referenceRates[code] ? rateText(referenceRates[code]) : '');
export { referenceRatesDate };
export function rememberRate(code: string, rate: string): void {
  if (!known(code) || !rate) return;
  try { store()?.setItem(rateKey, JSON.stringify({ ...readRates(), [code]: rate })); } catch { /* storage unavailable: nothing to remember */ }
}
/** Back to the built-in reference for this currency. */
export function clearRate(code: string): void {
  const { [code]: _gone, ...rest } = readRates();
  try { store()?.setItem(rateKey, JSON.stringify(rest)); } catch { /* storage unavailable */ }
}
