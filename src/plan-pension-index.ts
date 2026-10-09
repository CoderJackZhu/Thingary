// Audited complete-calendar-year subset only. No historical reconstruction,
// wage defaults, partial-year approximation, account projection or storage.
import type { PolicySource } from './plan-pension-policy.ts';

type Month = PolicySource & { month: string; kind: 'paid' | 'unpaid' | 'unemployment_benefit'; base_cents?: string | null };
type Wage = PolicySource & { year: number; cents: string };
export type BeijingIndexInput = {
  scope: 'beijing-enterprise-post-1998' | 'other' | null;
  required_start_month: string | null; required_start_source: PolicySource | null;
  retirement_month: string | null; months: readonly Month[] | null; wages: readonly Wage[] | null;
};
type Issue = { kind: 'missing' | 'invalid' | 'unsupported'; field: string; message: string };
export type BeijingIndexResult = { status: 'blocked'; issues: Issue[] } | { status: 'ready'; value: {
  average_index: PolicySource & { ten_thousandths: number };
  paid_months: number; required_months: number; unpaid_months: number; excluded_months: number;
  rows: { year: number; annual_base_cents: string; wage_year: number; wage_cents: string | null; included: boolean; paid_months: number; sources: PolicySource[] }[];
} };
const validMonth = (s: unknown): s is string => typeof s === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(s);
const monthNumber = (s: string) => Number(s.slice(0,4))*12+Number(s.slice(5))-1;
const money = (s: unknown): s is string => typeof s === 'string' && /^(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s));
const validSource = (s: PolicySource | null | undefined) => !!s && ['verified','assumption'].includes(s.basis) && typeof s.source === 'string' && !!s.source.trim();
const sourceCopy = (s: PolicySource): PolicySource => ({ basis:s.basis,source:s.source });
const gcd = (a: bigint,b: bigint): bigint => { while(b){const next=a%b;a=b;b=next;}return a; };

/** 北京2007年21号附件/29号§16–18, restricted to complete calendar years.
 * Partial-year exclusions and the official old calculator's differing algorithm
 * are deliberately not inferred. Verified provenance is not entitlement approval. */
export function prepareBeijingIndex(input: BeijingIndexInput): BeijingIndexResult {
  const issues: Issue[]=[];
  const issue=(kind:Issue['kind'],field:string,message:string)=>issues.push({kind,field,message});
  for(const field of ['scope','required_start_month','required_start_source','retirement_month','months','wages'] as const)
    if(input[field]==null) issue('missing',field,'须明确给出；未知不能按零补齐。');
  if(issues.length)return {status:'blocked',issues};
  if(input.scope!=='beijing-enterprise-post-1998')issue('unsupported','scope','仅支持北京企业职工1998年7月及以后参保、无特殊缴费情形。');
  if(!validMonth(input.required_start_month)||!validMonth(input.retirement_month))issue('invalid','dates','起止月份格式不合法。');
  if(!validSource(input.required_start_source))issue('invalid','required_start_source','应缴起点须有核对来源或明确假设，不能按首次实缴月推定。');
  if(!Array.isArray(input.months)||!Array.isArray(input.wages))issue('invalid','records','月记录和年度工资须为数组。');
  if(issues.length)return {status:'blocked',issues};
  const start=input.required_start_month!,end=input.retirement_month!,from=monthNumber(start),to=monthNumber(end);
  if(start<'1998-07'||to<from||to-from+1>1200)issue('unsupported','dates','参保范围、起止顺序或最长100年范围不适用。');
  if(!start.endsWith('-01')||!end.endsWith('-12'))issue('unsupported','dates','首批仅支持完整日历年；部分参保首年或退休当年尚未核清。');
  if(issues.length)return {status:'blocked',issues};
  const months=new Map<string,Month>(),wages=new Map<number,Wage>();
  for(const m of input.months!){
    if(!m||typeof m!=='object'){issue('invalid','months','月记录须为完整对象。');continue;}
    if(!validMonth(m.month)||monthNumber(m.month)<from||monthNumber(m.month)>to||months.has(m.month))issue('invalid','months','月记录不能越界、重复或使用非法月份。');
    if(!['paid','unpaid','unemployment_benefit'].includes(m.kind)||!validSource(m))issue('invalid','months','每月须明确缴费状态与来源；补助金额不能证明失业待遇期。');
    if(m.kind==='paid'&&(!money(m.base_cents)||Number(m.base_cents)<=0))issue('invalid','months','实缴月份须有正整数分基数；停缴须另行明确。');
    if(m.kind!=='paid'&&m.base_cents!=null&&m.base_cents!=='0')issue('invalid','months','停缴或失业待遇月份不能同时声明实缴基数。');
    months.set(m.month,m);
  }
  for(const w of input.wages!){
    if(!w||typeof w!=='object'){issue('invalid','wages','年度工资须为完整对象。');continue;}
    if(!Number.isInteger(w.year)||w.year<Number(start.slice(0,4))-1||w.year>Number(end.slice(0,4))-1||wages.has(w.year))issue('invalid','wages','工资年度不能越界、重复，须对应缴费年度的上一年。');
    if(!money(w.cents)||Number(w.cents)<=0||!validSource(w))issue('invalid','wages','对应年工资须为正整数分并附来源。');
    wages.set(w.year,w);
  }
  if(months.size!==to-from+1)issue('missing','months','应缴起点至退休月须逐月覆盖，缺月不补零。');
  if(issues.length)return {status:'blocked',issues};
  const rows: Extract<BeijingIndexResult,{status:'ready'}>['value']['rows']=[];
  let paid=0,unpaid=0,excluded=0,numerator=0n,denominator=1n;
  const sources: PolicySource[]=[input.required_start_source!];
  for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){
    const records=Array.from({length:12},(_,i)=>months.get(`${year}-${String(i+1).padStart(2,'0')}`)!);
    const deduct=records.filter(m=>m.kind==='unemployment_benefit').length;
    if(deduct!==0&&deduct!==12){issue('unsupported','months',`${year}年只有部分月份享受失业待遇，指数扣除口径尚未核清。`);continue;}
    const base=records.reduce((sum,m)=>sum+(m.kind==='paid'?BigInt(m.base_cents!):0n),0n);
    const actual=records.filter(m=>m.kind==='paid').length,w=wages.get(year-1);
    if(!deduct&&!w){issue('missing','wages',`${year}年缺少适用的${year-1}年工资分母。`);continue;}
    const rowSources=records.map(sourceCopy);if(!deduct)rowSources.push(sourceCopy(w!));sources.push(...rowSources);
    rows.push({year,annual_base_cents:String(base),wage_year:year-1,wage_cents:deduct?null:w!.cents,included:deduct===0,paid_months:actual,sources:rowSources});
    paid+=actual;excluded+=deduct;unpaid+=12-actual-deduct;
    if(!deduct){
      const d=BigInt(w!.cents),n=numerator*d+base*denominator,q=denominator*d,g=gcd(n,q);
      numerator=n/g;denominator=q/g;
    }
  }
  if(issues.length)return {status:'blocked',issues};
  const required=to-from+1-excluded;
  if(!required)return {status:'blocked',issues:[{kind:'unsupported',field:'months',message:'全部月份均被扣除，没有可定义的指数分母。'}]};
  const d=denominator*BigInt(required/12),scaled=numerator*10000n;
  const index=Number((scaled*2n+d)/(2n*d));
  if(!Number.isSafeInteger(index))return {status:'blocked',issues:[{kind:'invalid',field:'months',message:'指数超出安全整数范围。'}]};
  return {status:'ready',value:{average_index:{ten_thousandths:index,basis:sources.some(s=>s.basis==='assumption')?'assumption':'verified',source:'完整日历年逐月记录与对应年度工资；北京2007年21号附件/29号§16–18，详见年度审计行'},paid_months:paid,required_months:required,unpaid_months:unpaid,excluded_months:excluded,rows}};
}
