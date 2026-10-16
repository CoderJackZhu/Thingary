import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../src/annual-review.ts';
import * as periods from '../src/finance-period-control.ts';
import { financeReadSession } from '../src/finance-service.ts';
import { allModules } from '../src/modules.ts';

const ready = value => ({status:'ready',value});
const modules = {...allModules,incomes:true,movements:true,finance_status:'ready',finance_revision:1};
const p = (id,date,extra={}) => ({snapshot_id:id,date,net_cents:'10000',complete:true,scope_changed:false,change_cents:null,compared_to:null,...extra});
const range = {kind:'range',from:'2025-10-16',to:'2026-10-16',includeFrom:true};
function facts(period=range, points=[p('a','2025-10-01'),p('b','2026-02-01'),p('c','2026-10-01')]) {
  const r=period.kind==='year'?{from:`${period.year}-01-01`,to:`${period.year}-12-31`,includeFrom:true}:{from:period.from,to:period.to,includeFrom:period.includeFrom};
  return {generation:'g',write_version:1,today:'2026-10-16',period,modules,record_years:ready([2025,2026]),wealth:ready({points}),accounts:ready([]),
    incomes:ready([{fields:{date:r.from,net_cents:'0',hpf_cents:null}},{fields:{date:r.to,net_cents:'1200',hpf_cents:'0'}},{fields:{date:'2024-01-01',net_cents:'999',hpf_cents:null}}]),
    expenses:ready({period,lines:[],undated:[],spent_cents:'0',refund_cents:'0',sale_cents:'0',unknown_amount_count:0}),
    annual:{...(period.kind==='year'?{year:period.year}:{}),range:r,years:ready([2025,2026]),scope_changed:false,
      comparison:ready({from:{snapshot_id:points[0]?.snapshot_id},to:{snapshot_id:points.at(-1)?.snapshot_id},reconciled:true,net_change_cents:'2500'}),
      savings:ready({generation:'g',write_version:1,today:'2026-10-16',year:2026,basis:{snapshot_id:'current',date:'2026-10-16',revision:1},newer_incomplete:false,goals:[{goal:{id:'private-id',created_on:'2026-10-01',deleted_at:null,fields:{name:'绝密目标',target_cents:'20000',target_date:null,notes:'秘密'}},observations:[{status:'known',amount_cents:'10000',name:'绝密账户'}],history:[],shared_account_ids:[],planning_overlap:null}]}),planning:ready([])}};
}
test('recent12 maps to a valid inclusive calendar range, including leap and low years',()=>{
  assert.deepEqual(periods.recentTwelveMonths('2026-10-16'),range);
  assert.deepEqual(periods.recentTwelveMonths('2024-02-29'),{kind:'range',from:'2023-02-28',to:'2024-02-29',includeFrom:true});
  assert.equal(periods.recentTwelveMonths('0001-02-28').from,'0001-01-01');
});
test('sparse cross-year review uses actual endpoints and window records without negating the whole result',()=>{
  const m=review.buildAnnualReview(facts(),range,'2026-10-16',true);
  assert.ok(m);assert.equal(m.net.from.date,'2025-10-01');assert.equal(m.net.to.date,'2026-10-01');assert.equal(m.net.completeCount,2);
  assert.equal(m.net.label,'近 12 个月变化');assert.equal(m.net.delta_cents,'2500');assert.equal(m.income.cents,'1200');assert.equal(m.income.hpf_unknown_count,1);
  assert.doesNotMatch(m.net.note,/不能作为|未覆盖完整自然年/);
  const text=review.annualCopyText(m);assert.match(text,/区间记录摘要（隐私版）· 2025-10-16 至 2026-10-16/);assert.doesNotMatch(text,/绝密|秘密|private-id|¥|%/);
});
test('start day wins over an older snapshot; single endpoint and no complete point stay unknown',()=>{
  const s=facts(range,[p('old','2025-09-01'),p('start',range.from),p('end','2026-10-01')]);s.annual.comparison.value.from.snapshot_id='start';
  assert.equal(review.buildAnnualReview(s,range,s.today).net.from.snapshot_id,'start');
  s.wealth.value.points=[p('only','2026-08-01')];let m=review.buildAnnualReview(s,range,s.today);assert.equal(m.net.delta_cents,null);assert.match(m.net.note,/只有一个有效端点/);
  s.wealth.value.points=[p('partial','2026-08-01',{complete:false})];m=review.buildAnnualReview(s,range,s.today);assert.equal(m.net.status,'empty');assert.equal(m.net.to,null);assert.equal(m.net.incompleteCount,1);
});
test('whole-month labels use actual dates and distinguish short custom ranges from long periods',()=>{
  const custom={kind:'range',from:'2026-01-01',to:'2026-10-16',includeFrom:true};const s=facts(custom,[p('first','2026-01-31'),p('last','2026-10-01')]);
  assert.equal(review.buildAnnualReview(s,custom,s.today).net.label,'自本区间首次盘点以来 8 个月变化');
  assert.equal(review.wholeReviewMonths('2025-10-16','2026-09-15'),10);
  assert.equal(review.wholeReviewMonths('2025-10-16','2026-09-16'),11);
  assert.equal(review.buildAnnualReview(facts(),range,'2026-10-16').net.label,'区间变化');
});
test('current savings remain current across windows and missing balances never produce a full progress',()=>{
  const year={kind:'year',year:2024},s=facts(year,[]);let m=review.buildAnnualReview(s,year,s.today);
  assert.equal(m.savings.goals.length,1);assert.equal(m.savings.goals[0].basisDate,'2026-10-16');assert.equal(m.savings.goals[0].progress.percent_hundredths,5000);
  s.annual.savings.value.goals[0].observations[0]={status:'missing',amount_cents:null};m=review.buildAnnualReview(s,year,s.today);assert.equal(m.savings.goals[0].progress.percent_hundredths,null);
});
test('exact projection range, exclusive start, middle scope changes and stale metadata remain guarded',async()=>{
  const s=facts();assert.ok(await financeReadSession(async()=>s).load('g',range,modules,'annual'));
  const stale=structuredClone(s);stale.annual.range.to='2026-10-15';assert.equal(await financeReadSession(async()=>stale).load('g',range,modules,'annual'),null);assert.equal(review.buildAnnualReview(stale,range,s.today),null);
  const exclusive={...range,includeFrom:false},e=facts(exclusive);assert.equal(review.buildAnnualReview(e,exclusive,e.today).income.count,1);
  s.wealth.value.points[1].scope_changed=true;const m=review.buildAnnualReview(s,range,s.today);assert.equal(m.net.delta_cents,null);assert.equal(m.net.segments.length,0);
});
