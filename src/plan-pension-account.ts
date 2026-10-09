// Explicit scenario arithmetic, not an official account settlement or forecast.
import type { PolicySource } from './plan-pension-policy.ts';

export type PensionAccountMonth = PolicySource & {
  month: string; kind: 'paid' | 'unpaid' | 'unemployment_benefit'; base_cents?: string | null;
};
export type PensionAccountInput = {
  scope: 'beijing-enterprise-post-1998' | 'other' | null;
  method: 'annual-simple-month-product-assumption' | null;
  opening: (PolicySource & { month: string; cents: string; interest_settled: boolean | null }) | null;
  end_month: string | null;
  months: readonly PensionAccountMonth[] | null;
  rates: readonly (PolicySource & { year: number; ten_thousandths: number })[] | null;
};
type Issue = { kind: 'missing' | 'invalid' | 'unsupported'; field: keyof PensionAccountInput; message: string };
export type PensionAccountResult = { status: 'blocked'; issues: Issue[] } | { status: 'ready'; value: {
  account_at_end: PolicySource & { cents: string }; end_month: string; paid_months: number;
  rows: { year: number; from_month: string; to_month: string; opening_cents: number;
    deposits_cents: number; interest_cents: number; closing_cents: number; rate_ten_thousandths: number;
    months: { month: string; deposit_cents: number }[]; sources: PolicySource[] }[];
} };
const validMonth = (v: unknown): v is string => typeof v === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(v);
const monthIndex = (v: string) => Number(v.slice(0,4))*12+Number(v.slice(5))-1;
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v));
const validSource = (v: PolicySource | null | undefined) => !!v && ['verified','assumption'].includes(v.basis) && typeof v.source === 'string' && !!v.source.trim();
const sourceCopy = (v: PolicySource): PolicySource => ({ basis:v.basis,source:v.source });
const round = (n: bigint,d: bigint) => (n*2n+d)/(d*2n);

/** Requires a settled December balance and explicit rates. Monthly deposits
 * earn simple interest including entry month; total interest rounds once yearly.
 * Partial terminal years are a named assumption, never verified settlement. */
export function projectPensionAccount(input: PensionAccountInput): PensionAccountResult {
  const issues: Issue[]=[];
  const issue=(kind:Issue['kind'],field:Issue['field'],message:string)=>issues.push({kind,field,message});
  for(const field of ['scope','method','opening','end_month','months','rates'] as const)
    if(input[field]==null)issue('missing',field,'请明确给出，未知不能按0或默认利率补齐。');
  if(issues.length)return {status:'blocked',issues};
  if(input.scope!=='beijing-enterprise-post-1998')issue('unsupported','scope','不适用跨地区、补缴、视同或账户补贴等特殊情形。');
  if(input.method!=='annual-simple-month-product-assumption')issue('unsupported','method','须明确采用年度单利月积数情景假设，不代替官方结算。');
  const opening=input.opening!,end=input.end_month!;
  if(!validMonth(opening.month)||!validMonth(end)||!money(opening.cents)||!validSource(opening))issue('invalid','opening','余额须为带截至月份和来源的非负整数分。');
  if(opening.interest_settled==null)issue('missing','opening','请核对该余额是否已结清截至年末的利息。');
  else if(opening.interest_settled!==true)issue('unsupported','opening','未结清利息不能由余额反推或重复追加。');
  if(!Array.isArray(input.months)||!Array.isArray(input.rates))issue('invalid','months','逐月路径与逐年利率须为数组。');
  if(issues.length)return {status:'blocked',issues};
  const from=monthIndex(opening.month)+1,to=monthIndex(end);
  if(!opening.month.endsWith('-12')||opening.month<'2005-12'||to<from||to-from+1>1200)
    return {status:'blocked',issues:[{kind:'unsupported',field:'opening',message:'仅支持2005年及以后已结息12月末起点，后续1至1200个月；月中余额不适用。'}]};
  const months=new Map<string,PensionAccountMonth>(),rates=new Map<number,NonNullable<PensionAccountInput['rates']>[number]>();
  for(const m of input.months!){
    if(!m||typeof m!=='object'){issue('invalid','months','月记录须为完整对象。');continue;}
    if(!validMonth(m.month)||monthIndex(m.month)<from||monthIndex(m.month)>to||months.has(m.month))issue('invalid','months','月记录不能重复、越界或使用非法月份。');
    if(!['paid','unpaid','unemployment_benefit'].includes(m.kind)||!validSource(m))issue('invalid','months','每月须有明确状态和来源。');
    if(m.kind==='paid'&&(!money(m.base_cents)||Number(m.base_cents)<=0))issue('invalid','months','实缴月份须有正整数分基数。');
    if(m.kind!=='paid'&&m.base_cents!=null&&m.base_cents!=='0')issue('invalid','months','停缴月份不能同时声明实缴基数。');
    months.set(m.month,m);
  }
  const firstYear=Math.floor(from/12),lastYear=Math.floor(to/12);
  for(const r of input.rates!){
    if(!r||typeof r!=='object'){issue('invalid','rates','年度利率须为完整对象。');continue;}
    if(!Number.isInteger(r.year)||r.year<firstYear||r.year>lastYear||rates.has(r.year))issue('invalid','rates','利率年份不能重复、越界或使用非法年份。');
    if(!Number.isInteger(r.ten_thousandths)||r.ten_thousandths<0||r.ten_thousandths>10000||!validSource(r))issue('invalid','rates','利率须为0至100%的万分位整数且附来源，0也须明确。');
    rates.set(r.year,r);
  }
  if(months.size!==to-from+1)issue('missing','months','起点次月至截至月须完整覆盖，缺月不能按停缴处理。');
  if(rates.size!==lastYear-firstYear+1)issue('missing','rates','每个覆盖年度须明确利率，不沿用上一年利率。');
  if(issues.length)return {status:'blocked',issues};
  const rows: Extract<PensionAccountResult,{status:'ready'}>['value']['rows']=[];
  let balance=BigInt(opening.cents),paid=0;
  for(let year=firstYear;year<=lastYear;year++){
    const count=year===lastYear?Number(end.slice(5)):12,r=rates.get(year)!;
    const records=Array.from({length:count},(_,i)=>months.get(`${year}-${String(i+1).padStart(2,'0')}`)!);
    let deposits=0n,weighted=0n;
    const entries=records.map((m,i)=>{
      const amount=m.kind==='paid'?round(BigInt(m.base_cents!)*8n,100n):0n;
      if(m.kind==='paid')paid++;
      deposits+=amount;weighted+=amount*BigInt(count-i);
      return {month:m.month,deposit_cents:Number(amount)};
    });
    const interest=round((balance*BigInt(count)+weighted)*BigInt(r.ten_thousandths),120000n);
    const next=balance+deposits+interest;
    if(next>BigInt(Number.MAX_SAFE_INTEGER))return {status:'blocked',issues:[{kind:'invalid',field:'opening',message:'累计账户金额超出安全整数分范围。'}]};
    rows.push({year,from_month:`${year}-01`,to_month:records.at(-1)!.month,opening_cents:Number(balance),deposits_cents:Number(deposits),interest_cents:Number(interest),closing_cents:Number(next),rate_ten_thousandths:r.ten_thousandths,months:entries,sources:[sourceCopy(opening),sourceCopy(r),...records.map(sourceCopy)]});
    balance=next;
  }
  return {status:'ready',value:{account_at_end:{cents:String(balance),basis:'assumption',source:'年度单利月积数情景外推，逐年条件与收支见审计行；不是官方个人账户结算'},end_month:end,paid_months:paid,rows}};
}
