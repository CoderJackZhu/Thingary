import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPensionAccount } from '../src/plan-pension-account.ts';

const source={basis:'assumption',source:'虚构账户条件，不是官方结算'};
const input=(end='2026-12')=>({scope:'beijing-enterprise-post-1998',method:'annual-simple-month-product-assumption',
  opening:{month:'2025-12',cents:'10000000',interest_settled:true,...source},end_month:end,
  months:Array.from({length:(Number(end.slice(0,4))-2026)*12+Number(end.slice(5))},(_,i)=>({month:`${2026+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`,kind:'paid',base_cents:'1000000',...source})),
  rates:Array.from({length:Number(end.slice(0,4))-2025},(_,i)=>({year:2026+i,ten_thousandths:600,...source}))});
const ready=p=>{const r=projectPensionAccount(p);assert.equal(r.status,'ready',JSON.stringify(r));return r.value;};

test('zero rate is explicit and 8% account entry is not the whole self-pay cash',()=>{
  const p=input();p.rates[0].ten_thousandths=0;const r=ready(p);
  assert.equal(r.account_at_end.cents,'10960000');assert.equal(r.rows[0].deposits_cents,960000);assert.equal(r.rows[0].interest_cents,0);
  assert.equal(r.rows[0].months[0].deposit_cents,80000);assert.equal(r.account_at_end.basis,'assumption');
});
test('annual month-product interest has no within-year compounding',()=>{
  const r=ready(input());assert.equal(r.account_at_end.cents,'11591200');
  assert.deepEqual([r.rows[0].opening_cents,r.rows[0].deposits_cents,r.rows[0].interest_cents,r.rows[0].closing_cents],[10000000,960000,631200,11591200]);
});
test('ordinary and confirmed benefit gaps preserve account and next year interest',()=>{
  for(const kind of ['unpaid','unemployment_benefit']){
    const p=input('2027-12');p.months.slice(12).forEach(m=>{m.kind=kind;m.base_cents=null;});
    const r=ready(p);assert.equal(r.account_at_end.cents,'12286672');
    assert.equal(r.rows[1].deposits_cents,0);assert.equal(r.rows[1].interest_cents,695472);assert.equal(r.paid_months,12);
  }
});
test('partial terminal year is a named scenario assumption with truncated month weights',()=>{
  const p=input('2026-03');assert.equal(ready(p).account_at_end.cents,'10392400');
  p.months.slice(0,2).forEach(m=>{m.kind='unpaid';m.base_cents='0';});
  const r=ready(p);assert.equal(r.account_at_end.cents,'10230400');assert.equal(r.rows[0].interest_cents,150400);
});
test('monthly entry and total year interest each round to cents at the declared boundaries',()=>{
  const p=input('2026-01');p.opening.cents='1';p.months[0].base_cents='19';p.rates[0].ten_thousandths=0;
  assert.equal(ready(p).account_at_end.cents,'3'); // 19*.08=1.52 cents -> 2
  p.months[0]={month:'2026-01',kind:'unpaid',...source};p.opening.cents='100';p.rates[0].ten_thousandths=600;
  assert.equal(ready(p).rows[0].interest_cents,1); // 100*.06/12=.5 cents -> 1
});
test('unknown and unsupported premises never become projected balances',()=>{
  const edits=[p=>p.method=null,p=>p.method='monthly-compound',p=>p.scope='other',p=>p.opening.cents=null,
    p=>p.opening.interest_settled=null,p=>p.opening.interest_settled=false,p=>p.opening.month='2025-11',
    p=>p.end_month='2025-12',p=>p.end_month='2026-13',p=>p.months.splice(1,1),p=>p.months.push(p.months[0]),
    p=>p.months[0].base_cents='0',p=>p.months[0].kind='unknown',p=>p.months[0].source='',p=>p.months[0]=null,
    p=>p.rates=[],p=>p.rates.push(p.rates[0]),p=>p.rates[0].ten_thousandths=null,p=>p.rates[0].ten_thousandths=-1,
    p=>p.rates[0].basis='unknown',p=>p.rates[0]=null,p=>p.months[0].base_cents='9007199254740992'];
  for(const edit of edits){const p=input();edit(p);const r=projectPensionAccount(p);assert.equal(r.status,'blocked');assert.equal('value' in r,false);}
});
test('overflow and contradictory unpaid base block, records stay immutable',()=>{
  const p=input(),before=structuredClone(p),r=ready(p);r.rows[0].sources[0].source='changed';assert.deepEqual(p,before);
  p.opening.cents=String(Number.MAX_SAFE_INTEGER);assert.equal(projectPensionAccount(p).status,'blocked');
  p.opening.cents='0';p.months[0].kind='unpaid';assert.equal(projectPensionAccount(p).status,'blocked');
});
