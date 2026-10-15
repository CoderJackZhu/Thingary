import test from 'node:test';
import assert from 'node:assert/strict';
import { savingsProgress, savingsYearEndpoints } from '../src/savings-goals.ts';
const fields={name:'虚构应急金',target_cents:'100000',target_date:'2026-12-15',notes:''};
const basis={snapshot_id:'s',date:'2026-09-30',revision:1};
const row=(amount,status='known')=>({account_id:'a',name:'虚构账户',kind:'cash',status,amount_cents:amount,reason:''});
test('complete balances use integer cents and calendar months anchored to the check-in',()=>{
  const p=savingsProgress(fields,[row('69999')],basis,'2026-10-15');
  assert.equal(p.known_cents,'69999');assert.equal(p.gap_cents,'30001');assert.equal(p.months,3);assert.equal(p.monthly_cents,'10001');
  assert.equal(savingsProgress(fields,[row('69999')],basis,'2026-11-15').monthly_cents,'10001');
});
test('unknown, unavailable and no check-in never become zero or a monthly plan',()=>{
  for(const rows of [[row('0'),row(null,'missing')],[row('69999'),row(null,'unavailable')],[row(null,'missing')]]){
    const p=savingsProgress(fields,rows,basis,'2026-10-15');
    assert.equal(p.complete,false);assert.equal(p.reached,null);assert.equal(p.percent_hundredths,null);assert.equal(p.monthly_cents,null);assert.equal(p.gap_cents,null);
  }
  assert.equal(savingsProgress(fields,[row('0')],null,'2026-10-15').known_cents,null);
  assert.equal(savingsProgress(fields,[row('0')],basis,'2026-10-15').known_cents,'0');
});
test('reaching a target is reversible and never truncates the balance',()=>{
  const p=savingsProgress(fields,[row('120000')],basis,'2026-10-15');
  assert.equal(p.reached,true);assert.equal(p.known_cents,'120000');assert.equal(p.percent_hundredths,10000);assert.equal(p.monthly_cents,null);
  assert.equal(savingsProgress(fields,[row('80000')],basis,'2026-10-15').reached,false);
});
test('this month, today, overdue and undated deadlines never divide by zero',()=>{
  for(const [date,today,deadline] of [['2026-09-30','2026-09-15','this_month'],['2026-09-30','2026-09-30','today'],['2026-09-30','2026-10-01','past'],[null,'2026-10-01','none']]){
    const p=savingsProgress({...fields,target_date:date},[row('0')],basis,today);assert.equal(p.deadline,deadline);assert.equal(p.monthly_cents,null);
  }
});
test('large sums stay exact and invalid negative amounts are rejected',()=>{
  const p=savingsProgress(fields,[row('99999999999'),row('99999999999')],basis,'2026-10-15');assert.equal(p.known_cents,'199999999998');
  assert.throws(()=>savingsProgress(fields,[row('-1')],basis,'2026-10-15'),RangeError);
});
test('annual target endpoints reject dates before creation',()=>{
  const h=date=>({basis:{...basis,date},observations:[row('0')]});
  const view={goal:{created_on:'2025-06-01'},history:[h('2024-12-31'),h('2026-06-30')]};
  const p=savingsYearEndpoints(view,2026);assert.equal(p.from.basis.date,'2026-06-30');assert.equal(p.comparable,false);
});
