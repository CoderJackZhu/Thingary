/** Offline input units. CNY cents remain the only input to downstream calculations. */
export const currencies = [['CNY','人民币',2],['HKD','港币',2],['USD','美元',2],['EUR','欧元',2],['JPY','日元',0],['GBP','英镑',2],['SGD','新加坡元',2],['AUD','澳元',2],['CAD','加元',2],['CHF','瑞士法郎',2],['TWD','新台币',2],['MOP','澳门元',2]] as const;
export const currencyCode = (code?: string) => code ?? 'CNY';
export const currencyDecimals = (code: string) => currencies.find(c=>c[0]===code)?.[2] ?? 2;
export const validCurrency = (code: string) => /^[A-Z]{3}$/.test(code);
export type CurrencyFact = { amount_cents: string | null; original_minor?: string | null; fx_rate_micro?: string | null };
export function parseDecimal(text: string, places: number, signed=false): string {
  if (!(signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(text)) throw new Error('请填写数字。');
  const [whole,fraction='']=text.replace(/^-/,'').split('.');
  if(fraction.length>places) throw new Error(`最多填写${places}位小数。`);
  const n=(BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0')||'0'))*(text.startsWith('-')?-1n:1n);
  if(n < -9223372036854775807n || n > 9223372036854775807n)throw new Error('数值超出范围。');
  return n.toString();
}
export function convertCurrency(code: string, original: string, rate: string): string {
  if(!validCurrency(code)||! /^-?\d+$/.test(original)||!/^\d+$/.test(rate)||BigInt(rate)<=0n)throw new Error('请填写合法原币金额与大于0的汇率。');
  if(BigInt(original)<-9223372036854775808n||BigInt(original)>9223372036854775807n||BigInt(rate)>9223372036854775807n)throw new Error('数值超出范围。');
  const n=BigInt(original)*10n**BigInt(2-currencyDecimals(code))*BigInt(rate);
  const result=((n<0n?-n:n)+500000n)/1000000n*(n<0n?-1n:1n);
  if(result < -99999999999n || result > 99999999999n)throw new Error('折算金额超出可记录范围。');
  return result.toString();
}
export function decimalUnits(value: string, places: number): string {
  const n=BigInt(value),abs=n<0n?-n:n,scale=10n**BigInt(places);
  return `${n<0n?'-':''}${abs/scale}${places?'.'+(abs%scale).toString().padStart(places,'0'):''}`;
}
export const rateLabel = (micro: string) => decimalUnits(micro,6).replace(/\.?0+$/,'');
export function currencyAmount(code: string, minor: string): string {
  const raw=decimalUnits(minor,currencyDecimals(code)),[whole,frac]=raw.split('.');
  return `${BigInt(whole).toLocaleString('zh-CN')}${frac===undefined?'':'.'+frac} ${code}`;
}
export function validateCurrencyFact(code: string, fact: CurrencyFact): void {
  if(code==='CNY'||fact.amount_cents===null){if(fact.original_minor!=null||fact.fx_rate_micro!=null)throw new Error('人民币或未知金额不能填写原币和汇率。');return;}
  if(fact.original_minor==null||fact.fx_rate_micro==null||!/^\d+$/.test(fact.original_minor)||convertCurrency(code,fact.original_minor,fact.fx_rate_micro)!==fact.amount_cents)throw new Error('原币金额与汇率折算的人民币金额不一致。');
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
