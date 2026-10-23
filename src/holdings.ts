import { convertCurrency, currencyCode, currencyDecimals, decimalUnits } from './currency.ts';
import type { CurrencyFact } from './currency.ts';
import { t } from './i18n.ts';
export const holdingKinds = ['investment','mixed','fund','bond','precious_metal'];
export const holdingSupported = (kind: string) => holdingKinds.includes(kind);
export function parseHolding(text: string, places: number, signed = false): string {
  const clean = text.trim();
  if (!(signed ? /^-?\d[\d, \u00a0\u202f]*(\.\d+)?$/ : /^\d[\d, \u00a0\u202f]*(\.\d+)?$/).test(clean)) throw new Error(t('请填写数字，可使用千分位逗号或空格。'));
  const [whole, fraction = ''] = clean.replace(/^-/, '').split('.');
  if (whole.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(whole)) throw new Error(t('千分位逗号格式不正确。'));
  if (/[ \u00a0\u202f]/.test(whole) && !/^\d{1,3}([ \u00a0\u202f]\d{3})+$/.test(whole)) throw new Error(t('千分位空格须按三位分组，不能混用逗号。'));
  if (fraction.length > places) throw new Error(t('最多填写 {places} 位小数，请修改原文。', { places }));
  const n = (BigInt(whole.replace(/[, \u00a0\u202f]/g, '')) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places,'0') || '0')) * (clean.startsWith('-') ? -1n : 1n);
  if (n < -9223372036854775807n || n > 9223372036854775807n) throw new Error(t('数值超出可记录范围。'));
  return n.toString();
}
export function holdingMinor(quantity: string, price: string, decimals: number): string {
  if (!/^\d+$/.test(quantity) || !/^\d+$/.test(price) || ![0,2].includes(decimals)) throw new Error(t('请同时填写非负份额和单价。'));
  const q=BigInt(quantity),p=BigInt(price),max=9223372036854775807n;
  if(q>max||p>max)throw new Error(t('数值超出可记录范围。'));
  const d=10n**BigInt(14-decimals),product=q*p,result=product/d+(product%d>=d/2n?1n:0n);
  if(result>max)throw new Error(t('持仓金额超出范围。'));
  return result.toString();
}
export function holdingFact(code: string, quantity: string, price: string, rate = ''): CurrencyFact {
  const original=holdingMinor(quantity,price,currencyDecimals(code));
  const amount=code==='CNY'?original:convertCurrency(code,original,rate);
  if(BigInt(amount)>99999999999n)throw new Error(t('持仓金额超出可记录范围。'));
  return {amount_cents:amount,quantity_e8:quantity,unit_price_e6:price,...(code==='CNY'?{}:{original_minor:original,fx_rate_micro:rate})};
}
export function holdingText(fact: CurrencyFact, unit: string | null = null, code = 'CNY'): string | null {
  return fact.quantity_e8 != null && fact.unit_price_e6 != null ? `${unit==null?t('份额 '):''}${decimalUnits(fact.quantity_e8,8).replace(/\.?0+$/,'')}${unit==null?'':' '+(unit||t('份'))} × ${unit==null?t('单价 '):''}${decimalUnits(fact.unit_price_e6,6).replace(/\.?0+$/,'')} ${currencyCode(code)}` : null;
}

export function validateHoldingFact(code: string, fact: CurrencyFact): void {
  if(fact.quantity_e8==null&&fact.unit_price_e6==null)return;
  if(fact.amount_cents==null||fact.quantity_e8==null||fact.unit_price_e6==null)throw new Error(t('请同时填写份额和单价。'));
  const minor=holdingMinor(fact.quantity_e8,fact.unit_price_e6,currencyDecimals(code));
  if(minor!==(code==='CNY'?fact.amount_cents:fact.original_minor))throw new Error(t('份额和单价与金额不一致。'));
}
export function sameHoldingFact(a: CurrencyFact | undefined, b: CurrencyFact): boolean {
  return !!a && ['amount_cents','original_minor','fx_rate_micro','quantity_e8','unit_price_e6'].every(k=>(a[k as keyof CurrencyFact]??null)===(b[k as keyof CurrencyFact]??null));
}
