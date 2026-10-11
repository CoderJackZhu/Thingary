// Complete years use the existing rule. Partial years require explicit annual
// divisor premises; no historical reconstruction, wage defaults or storage.
import { validMonth, money, validSource, sourceCopy, monthIndex as monthNumber } from './plan-pension-input.ts';
import type { PolicySource } from './plan-pension-input.ts';

type Month = PolicySource & { month: string; kind: 'paid' | 'unpaid' | 'unemployment_benefit'; base_cents?: string | null };
type Wage = PolicySource & { year: number; cents: string };
export type BeijingIndexInput = {
  scope: 'beijing-enterprise-post-1998' | 'other' | null;
  required_start_month: string | null; required_start_source: PolicySource | null;
  /** Optional explicit divisor premises for partial years/exclusions. This is a
   * conditional calculation, not a claim that the policy ambiguity is resolved. */
  partial_year_basis?: (PolicySource & { wage_months: readonly { year: number; months: number }[] }) | null;
  retirement_month: string | null; months: readonly Month[] | null; wages: readonly Wage[] | null;
};
type Issue = { kind: 'missing' | 'invalid' | 'unsupported'; field: string; message: string };
export type BeijingIndexResult = { status: 'blocked'; issues: Issue[] } | { status: 'ready'; value: {
  average_index: PolicySource & { ten_thousandths: number };
  required_years_hundredths: number;
  paid_months: number; required_months: number; unpaid_months: number; excluded_months: number;
  rows: { year: number; annual_base_cents: string; wage_year: number; wage_cents: string | null; included: boolean; paid_months: number; required_months: number; excluded_months: number; unpaid_months: number; wage_divisor_months: number | null; sources: PolicySource[] }[];
} };
const gcd = (a: bigint,b: bigint): bigint => { while(b){const next=a%b;a=b;b=next;}return a; };

/** 北京2007年21号附件/29号§16–18: automatic rules cover complete years.
 * Partial-year divisors are explicit conditional premises, never inferred from
 * the old calculator or paid months. Provenance is not entitlement approval. */
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
  if((!start.endsWith('-01')||!end.endsWith('-12'))&&!input.partial_year_basis)issue('unsupported','dates','部分年份须明确年度工资分母口径；不能按实缴月数或年度行数推定。');
  if(issues.length)return {status:'blocked',issues};
  const divisors=new Map<number,number>();
  const premise=input.partial_year_basis;
  if(premise!=null){
    if(!validSource(premise)||!Array.isArray(premise.wage_months))issue('invalid','partial_year_basis','部分年份口径须有来源和明确的年度分母月数。');
    else for(const row of premise.wage_months){
      if(!row||!Number.isInteger(row.year)||row.year<Number(start.slice(0,4))||row.year>Number(end.slice(0,4))||divisors.has(row.year)||!Number.isInteger(row.months)||row.months<1||row.months>12)
        issue('invalid','partial_year_basis','分母年度须在路径内且不重复，月数须为1至12的整数。');
      else divisors.set(row.year,row.months);
    }
  }
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
    const records=Array.from({length:12},(_,i)=>months.get(`${year}-${String(i+1).padStart(2,'0')}`)).filter((m): m is Month=>m!==undefined);
    const deduct=records.filter(m=>m.kind==='unemployment_benefit').length;
    const requiredInYear=records.length-deduct;
    const partial=records.length!==12||(deduct!==0&&deduct!==12);
    if(partial&&!premise){issue('unsupported','months',`${year}年存在部分年份或待遇扣除，须明确年度分母口径。`);continue;}
    const divisor=requiredInYear===0?null:partial?divisors.get(year):12;
    if(requiredInYear>0&&divisor===undefined){issue('missing','partial_year_basis',`${year}年缺少明确的工资分母月数。`);continue;}
    if(divisors.has(year)&&(!partial||requiredInYear===0)){issue('invalid','partial_year_basis',`${year}年无需覆盖年度分母；完整年度固定12个月，全部扣除年度不参与。`);continue;}
    const base=records.reduce((sum,m)=>sum+(m.kind==='paid'?BigInt(m.base_cents!):0n),0n);
    const actual=records.filter(m=>m.kind==='paid').length,w=wages.get(year-1);
    if(requiredInYear>0&&!w){issue('missing','wages',`${year}年缺少适用的${year-1}年工资分母。`);continue;}
    const rowSources=records.map(sourceCopy);if(requiredInYear>0)rowSources.push(sourceCopy(w!));if(partial&&premise)rowSources.push(sourceCopy(premise));sources.push(...rowSources);
    rows.push({year,annual_base_cents:String(base),wage_year:year-1,wage_cents:requiredInYear===0?null:w!.cents,included:requiredInYear>0,paid_months:actual,required_months:requiredInYear,excluded_months:deduct,unpaid_months:requiredInYear-actual,wage_divisor_months:divisor!,sources:rowSources});
    paid+=actual;excluded+=deduct;unpaid+=requiredInYear-actual;
    if(requiredInYear>0){
      // Annual ratio = sum of paid bases / (annual wage * divisor months / 12).
      // Keep the fraction exact; do not round individual annual ratios.
      const d=BigInt(w!.cents)*BigInt(divisor!),n=numerator*d+base*12n*denominator,q=denominator*d,g=gcd(n,q);
      numerator=n/g;denominator=q/g;
    }
  }
  if(issues.length)return {status:'blocked',issues};
  const required=to-from+1-excluded;
  if(!required)return {status:'blocked',issues:[{kind:'unsupported',field:'months',message:'全部月份均被扣除，没有可定义的指数分母。'}]};
  // Required service is distinct from paid service; retain the two-decimal
  // years actually used in this conditional formula for audit/reproduction.
  const requiredYears=Math.round(required*100/12);
  const d=denominator*BigInt(requiredYears),scaled=numerator*10000n*100n;
  const index=Number((scaled*2n+d)/(2n*d));
  if(!Number.isSafeInteger(index))return {status:'blocked',issues:[{kind:'invalid',field:'months',message:'指数超出安全整数范围。'}]};
  return {status:'ready',value:{average_index:{ten_thousandths:index,basis:premise||sources.some(s=>s.basis==='assumption')?'assumption':'verified',source:premise?'显式年度分母的条件计算；部分年份政策口径未自动核定，详见年度审计行':'完整日历年逐月记录与对应年度工资；北京2007年21号附件/29号§16–18，详见年度审计行'},required_years_hundredths:requiredYears,paid_months:paid,required_months:required,unpaid_months:unpaid,excluded_months:excluded,rows}};
}
