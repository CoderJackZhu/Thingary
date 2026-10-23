import { t, numberLocale } from './i18n.ts';
import { t as tr } from './i18n.ts';
/** Offline input units. CNY cents remain the only input to downstream calculations. */
export const currencies = [['CNY',tr('人民币'),2],['USD',tr('美元'),2],['JPY',tr('日元'),0],['EUR',tr('欧元'),2],['GBP',tr('英镑'),2],['KRW',tr('韩元'),0],['HKD',tr('港币'),2],['TWD',tr('新台币'),2],['MOP',tr('澳门元'),2],['SGD',tr('新加坡元'),2],['AUD',tr('澳元'),2],['CAD',tr('加元'),2],['CHF',tr('瑞士法郎'),2],['NZD',tr('新西兰元'),2],['THB',tr('泰铢'),2],['MYR',tr('马来西亚林吉特'),2],['IDR',tr('印尼盾'),2],['PHP',tr('菲律宾比索'),2],['VND',tr('越南盾'),0],['INR',tr('印度卢比'),2],['AED',tr('阿联酋迪拉姆'),2],['SAR',tr('沙特里亚尔'),2],['TRY',tr('土耳其里拉'),2],['RUB',tr('俄罗斯卢布'),2],['BRL',tr('巴西雷亚尔'),2],['MXN',tr('墨西哥比索'),2],['ZAR',tr('南非兰特'),2],['SEK',tr('瑞典克朗'),2],['NOK',tr('挪威克朗'),2],['DKK',tr('丹麦克朗'),2],['PLN',tr('波兰兹罗提'),2],['CZK',tr('捷克克朗'),2],['HUF',tr('匈牙利福林'),2],['ILS',tr('以色列新谢克尔'),2]] as const;
/** 国家／地区代码，用来生成国旗；EU 用欧盟旗。 */
export const currencyRegion: Record<string,string> = {CNY:'CN',USD:'US',JPY:'JP',EUR:'EU',GBP:'GB',KRW:'KR',HKD:'HK',TWD:'TW',MOP:'MO',SGD:'SG',AUD:'AU',CAD:'CA',CHF:'CH',NZD:'NZ',THB:'TH',MYR:'MY',IDR:'ID',PHP:'PH',VND:'VN',INR:'IN',AED:'AE',SAR:'SA',TRY:'TR',RUB:'RU',BRL:'BR',MXN:'MX',ZAR:'ZA',SEK:'SE',NOK:'NO',DKK:'DK',PLN:'PL',CZK:'CZ',HUF:'HU',ILS:'IL'};
export const currencyCode = (code?: string) => code ?? 'CNY';
export const currencyDecimals = (code: string) => currencies.find(c=>c[0]===code)?.[2] ?? 2;
export const validCurrency = (code: string) => /^[A-Z]{3}$/.test(code);
export type CurrencyFact = { quantity_e8?: string | null; unit_price_e6?: string | null; amount_cents: string | null; original_minor?: string | null; fx_rate_micro?: string | null };
export function parseDecimal(text: string, places: number, signed=false): string {
  if (!(signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(text)) throw new Error(t('请填写数字。'));
  const [whole,fraction='']=text.replace(/^-/,'').split('.');
  if(fraction.length>places) throw new Error(t('最多填写{places}位小数。', { places }));
  const n=(BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0')||'0'))*(text.startsWith('-')?-1n:1n);
  if(n < -9223372036854775807n || n > 9223372036854775807n)throw new Error(t('数值超出范围。'));
  return n.toString();
}
export function convertCurrency(code: string, original: string, rate: string): string {
  if(!validCurrency(code)||! /^-?\d+$/.test(original)||!/^\d+$/.test(rate)||BigInt(rate)<=0n)throw new Error(t('请填写合法原币金额与大于0的汇率。'));
  if(BigInt(original)<-9223372036854775808n||BigInt(original)>9223372036854775807n||BigInt(rate)>9223372036854775807n)throw new Error(t('数值超出范围。'));
  const n=BigInt(original)*10n**BigInt(2-currencyDecimals(code))*BigInt(rate);
  const result=((n<0n?-n:n)+500000n)/1000000n*(n<0n?-1n:1n);
  if(result < -99999999999n || result > 99999999999n)throw new Error(t('折算金额超出可记录范围。'));
  return result.toString();
}
export function decimalUnits(value: string, places: number): string {
  const n=BigInt(value),abs=n<0n?-n:n,scale=10n**BigInt(places);
  return `${n<0n?'-':''}${abs/scale}${places?'.'+(abs%scale).toString().padStart(places,'0'):''}`;
}
export const rateLabel = (micro: string) => decimalUnits(micro,6).replace(/\.?0+$/,'');
export function currencyAmount(code: string, minor: string): string {
  const raw=decimalUnits(minor,currencyDecimals(code)),[whole,frac]=raw.split('.');
  return `${BigInt(whole).toLocaleString(numberLocale())}${frac===undefined?'':'.'+frac} ${code}`;
}
export function validateCurrencyFact(code: string, fact: CurrencyFact): void {
  if(code==='CNY'||fact.amount_cents===null){if(fact.original_minor!=null||fact.fx_rate_micro!=null)throw new Error(t('人民币或未知金额不能填写原币和汇率。'));return;}
  if(fact.original_minor==null||fact.fx_rate_micro==null||!/^\d+$/.test(fact.original_minor)||convertCurrency(code,fact.original_minor,fact.fx_rate_micro)!==fact.amount_cents)throw new Error(t('原币金额与汇率折算的人民币金额不一致。'));
}
/** Observation date describes the record, never claims when the rate was typed. */
export function rateSuggestions(draft: { rate_suggestions?:Record<string,{rate:string;date:string}>; date:string; existing:{date?:string;entries:({account_id:string}&CurrencyFact)[]}|null;rows:{account:{id:string;fields:{currency?:string}};previous:({date:string}&CurrencyFact)|null}[] }): Record<string,{rate:string;date:string}> {
 const result:Record<string,{rate:string;date:string}>=Object.fromEntries(Object.entries(draft.rate_suggestions??{}).filter(([,v])=>v.date<=draft.date));
 for(const row of draft.rows){const code=currencyCode(row.account.fields.currency);if(code==='CNY')continue;
  const saved=draft.existing?.entries.find(e=>e.account_id===row.account.id);
  const source=saved?.fx_rate_micro?{...saved,date:draft.existing?.date??draft.date}:row.previous;
  if(source?.fx_rate_micro&&source.date<=draft.date&&(!result[code]||source.date>result[code].date))result[code]={rate:source.fx_rate_micro,date:source.date};
 }
 return result;
}

/** Toggle a leading minus in the text being typed (the ± button of a signed field on a keyboard without a minus key). */
export function flipSign(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : `-${trimmed}`;
}

/** "上次 1 USD = 7.12（2026-08-23）"; after a month it also says the rate may have moved, so an old rate is not reused unnoticed. */
export function rateHint(code: string, suggestion: { rate: string; date: string } | undefined, on: string): string {
  if (!suggestion) return t('没有历史汇率，请手动填写。');
  const days = Math.round((Date.parse(on + 'T00:00:00Z') - Date.parse(suggestion.date + 'T00:00:00Z')) / 86400000);
  const base = t('上次 1 {code} = {rate}（{date}）', { code, rate: rateLabel(suggestion.rate), date: suggestion.date });
  return days > 30 ? base + t('，已是 {days} 天前，汇率可能已变化，请核对。', { days }) : base + t('，可修改。');
}
