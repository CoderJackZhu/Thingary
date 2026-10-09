import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBeijingPensionPath } from '../src/plan-pension-candidate.ts';
import { project,required } from '../src/plan-ledger.ts';

const source={basis:'assumption',source:'虚构职业候选，同一输入逐月改变'};
const input=(kind='paid')=>({
  index:{scope:'beijing-enterprise-post-1998',required_start_month:'2032-01',required_start_source:source,retirement_month:'2053-12',
    months:Array.from({length:264},(_,i)=>{const year=2032+Math.floor(i/12),state=year===2052?kind:'paid';return {month:`${year}-${String(i%12+1).padStart(2,'0')}`,kind:state,base_cents:state==='paid'?'1000000':null,...source};}),
    wages:Array.from({length:22},(_,i)=>({year:2031+i,cents:'12000000',...source}))},
  account:{scope:'beijing-enterprise-post-1998',method:'annual-simple-month-product-assumption',
    opening:{month:'2051-12',cents:'10000000',interest_settled:true,...source},rates:[2052,2053].map(year=>({year,ten_thousandths:0,...source}))},
  benefit:{scope:'beijing-enterprise-post-1998',birth_month:'1990-12',worker:'male',flex_months:0,
    benefit_base:{cents:'1204900',year:2053,...source},disbursement:{months:117,...source}},
  ledger:{nominal_factor_at_income_start:1,inflation_indexed_after_start:true,pool:{lump_cents:0,unlock_age_months:756}},
});
const ready=p=>{const r=prepareBeijingPensionPath(p);assert.equal(r.status,'ready',JSON.stringify(r));return r.value;};
test('candidate changes recompute index, paid months, account and payable amount together',()=>{
  // Independent closed forms, not another call to the production projector:
  // full: 22 paid years; 100000 + 24*800 =119200 yuan account.
  // gap: 21 paid years /22=.9545; account adds only12*800 yuan.
  const full=ready(input()),gap=ready(input('unpaid'));
  assert.deepEqual([full.index.average_index.ten_thousandths,full.index.paid_months,full.account.account_at_end.cents,full.benefit.total_monthly_cents],[10000,264,'11920000',366958]);
  assert.deepEqual([gap.index.average_index.ten_thousandths,gap.index.paid_months,gap.account.account_at_end.cents,gap.benefit.total_monthly_cents],[9545,252,'10960000',340948]);
  assert.equal(full.pension.income_start_age_months,757);assert.equal(gap.pension.lump_cents,0);
});
test('confirmed benefit gap changes index exclusion but not account entry or paid months',()=>{
  const r=ready(input('unemployment_benefit'));
  assert.deepEqual([r.index.average_index.ten_thousandths,r.index.paid_months,r.index.required_months,r.account.account_at_end.cents,r.benefit.total_monthly_cents],[10000,252,252,'10960000',346704]);
});
test('candidate account and benefit reach ledger without inventing a retirement-month payment',()=>{
  const r=ready(input('unpaid')),p={input_mode:'basic',now_months:756,target_months:756,horizon_months:759,search_cap_months:759,mode:'traditional',
    assets_cents:340948,saving_cents:0,saving_growth_hundredths:0,r_before_hundredths:0,r_after_hundredths:0,inflation_hundredths:0,volatility_hundredths:0,
    items:[{id:'living',label:'虚构',monthly_cents:340948,start_age:null,end_age:null,inflation_hundredths:null,essential:true}],incomes:[],spends:[],pension_at:()=>r.pension};
  assert.equal(required(p,756),340948);assert.deepEqual([...project(p,2053).assets],[340948,0,0,0]);
});
test('qualification shortfall cannot refund the social-security account into the pool',()=>{
  const p=input();p.index.months.filter(m=>m.month<'2035-01').forEach(m=>{m.kind='unpaid';m.base_cents=null;});
  const r=ready(p);assert.equal(r.index.paid_months,228);assert.equal(r.benefit.short_months,12);
  assert.deepEqual([r.pension.monthly_cents,r.pension.income_start_age_months,r.pension.lump_cents],[0,null,0]);
});
test('partial year, mismatched retirement, missing rate and missing path stay blocked and immutable',()=>{
  const p=input(),before=structuredClone(p);ready(p);assert.deepEqual(p,before);
  const edits=[p=>p.index.retirement_month='2053-10',p=>p.benefit.birth_month='1990-11',p=>p.account.rates=[],p=>p.index=null,p=>p.account=null,p=>p.ledger=null,
    p=>p.account.opening.interest_settled=false,p=>p.index.months[0].base_cents=null,p=>p.benefit.scope='other',p=>p.benefit=1,p=>p.account=false,p=>p.index=[]];
  for(const edit of edits){const bad=input();edit(bad);const r=prepareBeijingPensionPath(bad);assert.equal(r.status,'blocked');assert.equal('value' in r,false);}
});
test('separate fixed derived values or account paths are explicitly rejected',()=>{
  for(const field of ['average_index','paid_months_at_retirement','account_at_retirement']){
    const p=input();p.benefit[field]=0;assert.equal(prepareBeijingPensionPath(p).status,'blocked');
  }
  for(const field of ['months','end_month']){const p=input();p.account[field]=null;assert.equal(prepareBeijingPensionPath(p).status,'blocked');}
});
