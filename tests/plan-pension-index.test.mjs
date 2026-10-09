import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBeijingIndex } from '../src/plan-pension-index.ts';

const fact = { basis: 'verified', source: '虚构已核对记录' };
const input = (start=2020, end=2022) => ({ scope: 'beijing-enterprise-post-1998', required_start_month: `${start}-01`, required_start_source:fact, retirement_month: `${end}-12`,
  months: Array.from({length:(end-start+1)*12},(_,i)=>({month:`${start+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`,kind:'paid',base_cents:'1000000',...fact})),
  wages: Array.from({length:end-start+1},(_,i)=>({year:start+i-1,cents:'12000000',...fact})) });
const ready=p=>{const r=prepareBeijingIndex(p);assert.equal(r.status,'ready',JSON.stringify(r));return r.value;};

test('complete annual ratios independently reproduce continuous and ordinary-gap indices',()=>{
  const p=input(); assert.equal(ready(p).average_index.ten_thousandths,10000);
  for(let i=12;i<24;i++) p.months[i]={month:p.months[i].month,kind:'unpaid',...fact};
  const r=ready(p);assert.equal(r.average_index.ten_thousandths,6667);
  assert.deepEqual([r.paid_months,r.required_months,r.unpaid_months],[24,36,12]);
  assert.equal(r.rows[1].annual_base_cents,'0');assert.equal(r.rows[1].included,true);
});
test('confirmed whole-year unemployment excludes denominator but never counts as paid',()=>{
  const p=input();for(let i=12;i<24;i++) p.months[i]={month:p.months[i].month,kind:'unemployment_benefit',...fact};
  p.wages.splice(1,1); const r=ready(p);
  assert.equal(r.average_index.ten_thousandths,10000);
  assert.deepEqual([r.paid_months,r.required_months,r.excluded_months],[24,24,12]);
  assert.equal(r.rows[1].included,false);
});
test('year-specific denominators, low bases, exact rounding and assumptions stay visible',()=>{
  const p=input(2020,2021);p.wages[1].cents='24000000';
  assert.equal(ready(p).average_index.ten_thousandths,7500);
  p.months.forEach(m=>m.base_cents='400000');assert.equal(ready(p).average_index.ten_thousandths,3000);
  const half=input(2020,2020);half.wages[0].cents='320000000';
  assert.equal(ready(half).average_index.ten_thousandths,375); // 12m / 320m = .0375
  half.months[0].basis='assumption'; assert.equal(ready(half).average_index.basis,'assumption');
});
test('partial start, partial retirement and partial benefit exclusions block rather than approximate',()=>{
  for(const field of ['required_start_month','retirement_month']){
    const p=input();p[field]=field==='required_start_month'?'2020-07':'2022-10';
    assert.ok(prepareBeijingIndex(p).issues.some(i=>i.kind==='unsupported'));
  }
  const p=input();p.months[12]={month:'2021-01',kind:'unemployment_benefit',...fact};
  assert.ok(prepareBeijingIndex(p).issues.some(i=>i.kind==='unsupported'));
});
test('missing month/wage/source, duplicate rows, zero paid base and illegal dates cannot become answers',()=>{
  const edits=[p=>p.months.splice(3,1),p=>p.months.push(p.months[0]),p=>p.wages.pop(),p=>p.wages.push(p.wages[0]),
    p=>p.months[0].base_cents=null,p=>p.months[0].base_cents='0',p=>p.months[0].kind='unknown',p=>p.months[0].source='',
    p=>p.required_start_month='2020-13',p=>p.scope='other',p=>p.wages[0].cents='0'];
  for(const edit of edits){const p=input();edit(p);const r=prepareBeijingIndex(p);assert.equal(r.status,'blocked');assert.equal('value' in r,false);}
});
test('explicit unpaid zero is valid; all excluded index has no denominator',()=>{
  const p=input();p.months=p.months.map(m=>({month:m.month,kind:'unpaid',...fact}));
  const r=ready(p);assert.equal(r.average_index.ten_thousandths,0);assert.equal(r.paid_months,0);
  p.months=p.months.map(m=>({...m,kind:'unemployment_benefit'}));assert.equal(prepareBeijingIndex(p).status,'blocked');
});
test('audit output preserves provenance without mutating or sharing the input',()=>{
  const p=input(),before=structuredClone(p),r=ready(p);assert.deepEqual(p,before);
  r.rows[0].sources[0].source='changed';assert.deepEqual(p,before);
});
test('exact half rounds up only after summing annual fractions; malformed records block',()=>{
  const p=input(2020,2020);p.months.forEach(m=>m.base_cents='1');p.wages[0].cents='240000';
  assert.equal(ready(p).average_index.ten_thousandths,1); // .00005 rounds up
  const two=input(2020,2021);two.months.forEach(m=>m.base_cents='1');two.wages.forEach(w=>w.cents='300000');
  assert.equal(ready(two).average_index.ten_thousandths,0); // .00004: no rounding annual terms first
  for(const field of ['months','wages']) {const bad=input();bad[field][0]=null;assert.equal(prepareBeijingIndex(bad).status,'blocked');}
});
