import test from 'node:test';
import assert from 'node:assert/strict';
import { project, required, requiredAt, coverageAt, glide, nominalFactor } from '../src/plan-ledger.ts';
import { prepareBeijingIndex } from '../src/plan-pension-index.ts';
import { beijingBenefitForLedger } from '../src/plan-pension-policy-ledger.ts';
import { coverage } from '../src/plan-view.ts';
import { monteCarlo } from '../src/plan-risk.ts';

const pension=(over={})=>({monthly_cents:1000,lump_cents:500,unlock_age_months:720,income_start_age_months:721,...over});
const plan=(pen,over={})=>({input_mode:'basic',now_months:720,horizon_months:723,search_cap_months:723,target_months:720,mode:'traditional',assets_cents:0,saving_cents:0,saving_growth_hundredths:0,r_before_hundredths:0,r_after_hundredths:0,inflation_hundredths:0,volatility_hundredths:0,items:[{id:'living',label:'虚构',monthly_cents:1000,start_age:null,end_age:null,inflation_hundredths:null,essential:true}],incomes:[],pension_at:()=>pen,spends:[],...over});

test('retirement month needs its own budget although pool unlocks then and pension starts next month',()=>{
  const p=plan(pension());assert.equal(required(p,720),500);assert.deepEqual([...requiredAt(p)],[500,0,0]);
  const q={...p,assets_cents:500},r=project(q,2025);
  assert.deepEqual([...r.assets],[500,0,0,0]);assert.equal(r.rows[0].unlock,500);assert.equal(r.rows[0].income,2000);
  assert.equal(coverageAt(q,r,720).pension,0);assert.equal(coverageAt(q,r,721).pension,1000);
  assert.equal(glide(q,r)[0],500);
});
test('delayed pool cannot pull pension forward; independent income/pool months preserve bridge need',()=>{
  const p=plan(pension({unlock_age_months:722}),{assets_cents:1000});
  assert.equal(required(p,720),1000);const r=project(p,2025);
  assert.deepEqual([...r.assets],[1000,0,0,500]);assert.equal(coverageAt(p,r,721).pension,1000);
});
test('absent field retains old behavior and null explicitly means no payable income',()=>{
  const old=pension();delete old.income_start_age_months;
  assert.equal(required(plan(old),720),0);
  assert.equal(required(plan(pension({income_start_age_months:null})),720),2500);
});
test('partial first month scales income only when its separate start date is reached',()=>{
  const p=plan(pension({income_start_age_months:720,lump_cents:0}),{first_month_fraction:.5});
  assert.equal(required(p,720),0);assert.equal(project(p,2025).rows[0].income,2500);
  const waiting=plan(pension({lump_cents:0}),{first_month_fraction:.5});assert.equal(required(waiting,720),500);
});
test('coverage presentation follows pension income date rather than the pool date',()=>{
  const p=plan(pension({unlock_age_months:720,income_start_age_months:732}),{horizon_months:735});
  const r=project(p,2025),v=coverage(p,r,720,'today');
  assert.equal(v.next_income_age,61);assert.equal(v.income_items[0].start,'61 岁');assert.equal(v.income_items[0].active,false);
  const waiting=plan(pension());assert.equal(coverage(waiting,project(waiting,2025),720,'today').income_items[0].start,'60 岁 1 个月');
  const none=plan(pension({income_start_age_months:null}));assert.equal(coverage(none,project(none,2025),720,'today').income_items.length,0);
});
test('zero-volatility market paths also require the unpaid retirement-month bridge',async()=>{
  for(const assets of [499,500]) {
    const p=plan(pension(),{assets_cents:assets});
    const r=await monteCarlo(p,4,{seed:1});assert.equal(r.success_rate,assets===500?1:0);
    assert.equal(r.final.p50,0);
  }
});

const source={basis:'assumption',source:'独立虚构链路假设'};
const benefit=()=>({scope:'beijing-enterprise-post-1998',birth_month:'1990-12',worker:'male',flex_months:0,paid_months_at_retirement:240,
  average_index:{ten_thousandths:9091,...source},benefit_base:{cents:'1204900',year:2053,...source},account_at_retirement:{cents:'11700000',...source},disbursement:{months:117,...source}});
const bridge=(over={})=>({benefit:benefit(),nominal_factor_at_income_start:1,inflation_indexed_after_start:true,pool:{lump_cents:0,unlock_age_months:756},...over});
test('first-payment conversion preserves nominal amount across the unpaid retirement month',()=>{
  const inflation=1200,factor=1.12**(1/12);
  const r=beijingBenefitForLedger(bridge({nominal_factor_at_income_start:factor}));assert.equal(r.status,'ready');
  const p=plan(r.value.pension,{now_months:756,target_months:756,horizon_months:759,inflation_hundredths:inflation});
  assert.ok(Math.abs(r.value.pension.monthly_cents*nominalFactor(p,757)-330027)<1e-8);
});
test('annual records to amount kernel to monthly ledger preserve the December-January bridge',()=>{
  const records={scope:'beijing-enterprise-post-1998',required_start_month:'2032-01',required_start_source:source,retirement_month:'2053-12',
    months:Array.from({length:264},(_,i)=>{const year=2032+Math.floor(i/12);return {month:`${year}-${String(i%12+1).padStart(2,'0')}`,kind:year===2034||year===2035?'unpaid':'paid',base_cents:year===2034||year===2035?'0':'1000000',...source};}),
    wages:Array.from({length:22},(_,i)=>({year:2031+i,cents:'12000000',...source}))};
  const index=prepareBeijingIndex(records);assert.equal(index.status,'ready');
  assert.equal(index.value.average_index.ten_thousandths,9091);assert.equal(index.value.paid_months,240);
  const b=benefit();b.average_index=index.value.average_index;b.paid_months_at_retirement=index.value.paid_months;
  const r=beijingBenefitForLedger(bridge({benefit:b}));assert.equal(r.status,'ready');
  assert.equal(r.value.benefit.total_monthly_cents,330027);assert.equal(r.value.benefit.scheduled_payment_month,'2054-01');
  assert.equal(r.value.pension.income_start_age_months,757);assert.equal(r.value.pension.lump_cents,0);
  const p=plan(r.value.pension,{now_months:756,target_months:756,horizon_months:759,search_cap_months:759,
    items:[{id:'living',label:'虚构',monthly_cents:330027,start_age:null,end_age:null,inflation_hundredths:null,essential:true}],assets_cents:330027});
  assert.equal(required(p,756),330027);assert.deepEqual([...project(p,2053).assets],[330027,0,0,0]);
});
test('adapter propagates blocked policy, explicit conversion, qualification and separate pool without refund',()=>{
  const p=bridge();const before=structuredClone(p);
  const converted=beijingBenefitForLedger({...p,nominal_factor_at_income_start:2});assert.equal(converted.status,'ready');
  assert.equal(converted.value.pension.monthly_cents,330027/2);
  const b=benefit();b.paid_months_at_retirement=239;
  const short=beijingBenefitForLedger(bridge({benefit:b,pool:{lump_cents:500,unlock_age_months:800}}));assert.equal(short.status,'ready');
  assert.deepEqual([short.value.pension.monthly_cents,short.value.pension.income_start_age_months,short.value.pension.lump_cents,short.value.pension.unlock_age_months],[0,null,500,800]);
  for(const over of [{nominal_factor_at_income_start:null},{nominal_factor_at_income_start:0},{inflation_indexed_after_start:null},{inflation_indexed_after_start:false},{pool:null},{pool:{lump_cents:-1,unlock_age_months:756}}])
    assert.equal(beijingBenefitForLedger({...p,...over}).status,'blocked');
  b.average_index=null;assert.equal(beijingBenefitForLedger(bridge({benefit:b})).status,'blocked');
  assert.deepEqual(p,before);
});
