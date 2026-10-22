import { t, numberLocale } from './i18n.ts';
/** Offline input units. CNY cents remain the only input to downstream calculations. */
export const currencies = [['CNY','人民币',2],['USD','美元',2],['JPY','日元',0],['EUR','欧元',2],['GBP','英镑',2],['KRW','韩元',0],['HKD','港币',2],['TWD','新台币',2],['MOP','澳门元',2],['SGD','新加坡元',2],['AUD','澳元',2],['CAD','加元',2],['CHF','瑞士法郎',2],['NZD','新西兰元',2],['THB','泰铢',2],['MYR','马来西亚林吉特',2],['IDR','印尼盾',2],['PHP','菲律宾比索',2],['VND','越南盾',0],['INR','印度卢比',2],['AED','阿联酋迪拉姆',2],['SAR','沙特里亚尔',2],['TRY','土耳其里拉',2],['RUB','俄罗斯卢布',2],['BRL','巴西雷亚尔',2],['MXN','墨西哥比索',2],['ZAR','南非兰特',2],['SEK','瑞典克朗',2],['NOK','挪威克朗',2],['DKK','丹麦克朗',2],['PLN','波兰兹罗提',2],['CZK','捷克克朗',2],['HUF','匈牙利福林',2],['ILS','以色列新谢克尔',2]] as const;
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
