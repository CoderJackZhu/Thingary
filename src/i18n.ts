// 界面语言。简体中文原文就是 key（gettext 方式）：没有译文就显示原文，所以漏译不会出现空白或 key。
// 切换语言会重新载入窗口，t() 因此可以是同步的普通函数，不需要订阅。
import { en } from './locales/en.ts';

export type Lang = 'zh-CN' | 'en';
export type LangPreference = Lang | 'system';
export const langKey = 'thingary.lang';
export const langPreferences: readonly { value: LangPreference; label: string }[] = [
  { value: 'system', label: '自动 / Auto' }, { value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' },
];
const tables: Record<Lang, Record<string, string>> = { 'zh-CN': {}, en };

export function readLangPreference(): LangPreference {
  try { const v = globalThis.localStorage?.getItem(langKey); return v === 'zh-CN' || v === 'en' ? v : 'system'; } catch { return 'system'; }
}
export function resolveLang(preference: LangPreference, systemLanguage = globalThis.navigator?.language ?? 'zh-CN'): Lang {
  return preference !== 'system' ? preference : /^zh\b/i.test(systemLanguage) ? 'zh-CN' : 'en';
}
let current: Lang = resolveLang(readLangPreference());
export const currentLang = (): Lang => current;
/** 保存并重新载入，让所有已渲染的文字换成新语言。 */
export function setLangPreference(value: LangPreference, returnTo?: string): boolean {
  try { globalThis.localStorage.setItem(langKey, value); if (returnTo) globalThis.sessionStorage?.setItem(returnKey, returnTo); } catch { return false; }
  current = resolveLang(value);
  globalThis.location?.reload();
  return true;
}
const returnKey = 'thingary.lang-return';
/** 切换语言重新载入后，回到切换时所在的位置（如 'settings:general'）；读取后即清除。 */
export function takeLangReturn(): string | null {
  try { const v = globalThis.sessionStorage?.getItem(returnKey) ?? null; globalThis.sessionStorage?.removeItem(returnKey); return v; } catch { return null; }
}
/** 日期、数字格式用的 locale。 */
export const numberLocale = (): string => current === 'en' ? 'en-US' : 'zh-CN';

/** `t('已选 {n} 项', { n: 3 })`。占位符 `{name}` 在原文和译文里都可用；缺参数时保留占位符。 */
export function t(text: string, params?: Record<string, string | number | null | undefined>): string {
  const out = tables[current][text] ?? text;
  return params ? out.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name] ?? '') : whole) : out;
}
