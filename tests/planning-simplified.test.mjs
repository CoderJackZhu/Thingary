import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifiedEmpty, ageToMonthV1, validateSimplifiedPlanningV1, incomeAtMonthV1 } from '../src/plan-simplified.ts';
import { createSimplifiedPlanningPortV1 } from '../src/planning-simplified-port.ts';
const income = () => ({ id: 'fictional-income', name: '虚构外部养老金', role: 'pension', included: true, monthly_cents: '10000', start_month: '2030-01', end_month: null, basis: 'start_month', basis_month: null, growth: 'fixed_nominal', source: null, source_checked_on: null, notes: '' });
test('months stay fixed across reference edits, direct calendar entry needs no age', () => {
  assert.equal(ageToMonthV1({ month: '2026-12', age_months: 400 }, 402), '2027-02');
  assert.equal(ageToMonthV1({ month: '2027-01', age_months: 401 }, 402), '2027-02');
  assert.throws(() => ageToMonthV1(null, 402));
  assert.deepEqual(validateSimplifiedPlanningV1(simplifiedEmpty()), []);
});
test('unknown, explicit zero, excluded and unconfirmed remain different values', () => {
  const i = income(); assert.equal(incomeAtMonthV1({ ...i, monthly_cents: null }, '2030-01', '2030-01', 0), null);
  assert.equal(incomeAtMonthV1({ ...i, monthly_cents: '0' }, '2030-01', '2030-01', 0), 0);
  assert.equal(incomeAtMonthV1({ ...i, included: false }, '2030-01', '2030-01', 0), null);
  for (const mode of ['manual','excluded','unconfirmed']) assert.deepEqual(validateSimplifiedPlanningV1({ ...simplifiedEmpty(), income_mode: mode, future_incomes: [i] }), []);
});
test('fixed nominal vs purchasing power use explicit integer months, both endpoints inclusive', () => {
  const i = { ...income(), start_month: '2027-01', end_month: '2028-01', basis: 'reference_month', basis_month: '2026-01' };
  assert.equal(incomeAtMonthV1(i, '2026-12', '2026-01', 1000), 0);
  assert.ok(Math.abs(incomeAtMonthV1(i, '2027-01', '2026-01', 1000)-10000) < 1e-8);
  assert.ok(Math.abs(incomeAtMonthV1(i, '2028-01', '2026-01', 1000)-10000/1.1) < 1e-8);
  assert.equal(incomeAtMonthV1(i, '2028-02', '2026-01', 1000), 0);
  assert.equal(incomeAtMonthV1({ ...i, growth:'constant_purchasing_power' }, '2028-01', '2026-01', 1000), 10000);
  assert.equal(incomeAtMonthV1(i, '2028-01', '2026-01', null), null);
});
test('validation retains existing amount limit and rejects noncanonical/over-limit amounts', () => {
  assert.deepEqual(validateSimplifiedPlanningV1({...simplifiedEmpty(),future_incomes:[{...income(),monthly_cents:'99999999999'}]}),[]);
  for (const n of ['-1','01','100000000000']) assert.ok(validateSimplifiedPlanningV1({ ...simplifiedEmpty(), future_incomes:[{...income(),monthly_cents:n}] }).some(x=>x.path==='future_incomes.fictional-income.monthly_cents'));
});
test('partition/setup adapters delegate once, retain unresolved and propagate read failures', async () => {
  const calls=[]; const f=simplifiedEmpty(), c={request_id:'fictional-request',generation:'fictional-library',expected_revision:null};
  const port=createSimplifiedPlanningPortV1({ read:async()=>{throw Error('read failure')}, save:async(...x)=>{calls.push(x);return {status:'unresolved',request_id:c.request_id}}, saveSetup:async(...x)=>{calls.push(x);return {status:'saved',revision:1}}, resolve:async()=>({status:'rejected',issues:[]}) });
  await assert.rejects(port.read(), /read failure/);
  assert.deepEqual(await port.save(f,c),{status:'unresolved',request_id:c.request_id});
  assert.equal(calls.length,1);
  assert.equal((await port.saveSetup({fields:f,setup:{}},c)).status,'saved'); assert.equal(calls.length,2);
});

test('malformed collections and missing/legacy DTO fields cannot pass validation',()=>{
 const f=simplifiedEmpty();
 for(const future_incomes of [null,{},''])assert.ok(validateSimplifiedPlanningV1({...f,future_incomes}).length);
 const absent=structuredClone(f);delete absent.time.reference;assert.ok(validateSimplifiedPlanningV1(absent).length);
 assert.ok(validateSimplifiedPlanningV1({...f,birth_month:'1990-01'}).length);
});


test('native port rejects a new request while preserving an unrelated unknown receipt', async () => {
 const {nativeSimplifiedPlanningPortV1}=await import('../src/planning-simplified-port.ts');
 const {pendingKey}=await import('../src/wealth.ts');
 const old=globalThis.localStorage;
 const pending=JSON.stringify({command:'plan_profile_update',input:{request_id:'original',generation:'library',section:'simplified',fields:simplifiedEmpty(),expected_revision:1},label:'规划分区'});
 const stored=new Map([[pendingKey,pending]]);
 globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 try {
  const port=nativeSimplifiedPlanningPortV1(()=>({planning:true}));
  const result=await port.save(simplifiedEmpty(),{request_id:'new',generation:'library',expected_revision:1});
  assert.equal(result.status,'rejected');assert.equal(result.issues[0].code,'pending_request');
  assert.equal(stored.get(pendingKey),pending);
 } finally {if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;}
});

test('legacy mixed planning receipt verifies only original metadata, retains payload on read failure, and never replays', async()=>{
 const {nativeSimplifiedPlanningPortV1}=await import('../src/planning-simplified-port.ts');
 const {pendingKey}=await import('../src/wealth.ts');
 const {simplifiedSources}=await import('./helpers/simplified-planning-fixtures.mjs');
 const oldWindow=globalThis.window,oldStorage=globalThis.localStorage;
 try {
  for(const command of ['plan_profile_save','plan_profile_update']){
   const sources=simplifiedSources('0');sources.profile.value.saved.revision=8;
   const context={request_id:'original',generation:sources.generation,expected_revision:7};
   const pending=JSON.stringify({command,input:{...context,profile:{birth_month:'1990-06',retire:{core:{occurrences:[{id:'factual-source'}]}}},section:'pension',fields:{region:'beijing'}},label:'旧混合提交'});
   const stored=new Map([[pendingKey,pending]]),calls=[];let readFailed=true;
   globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
   globalThis.window={__TAURI_INTERNALS__:{invoke:async(cmd,args)=>{
    calls.push({cmd,args});
    if(cmd==='wealth_request_result')return 'profile';
    if(cmd==='planning_sources'){if(readFailed)throw Error('read failed');return sources;}
    throw Error('obsolete payload must never be replayed');
   }}};
   const port=nativeSimplifiedPlanningPortV1(()=>({planning:true,wealth:false}));
   assert.deepEqual(await port.resolve(context),{status:'unresolved',request_id:'original'});assert.equal(stored.get(pendingKey),pending);
   readFailed=false;assert.deepEqual(await port.resolve(context),{status:'saved',revision:8});assert.equal(stored.has(pendingKey),false);
   assert.deepEqual(calls.filter(x=>x.cmd==='wealth_request_result'),Array(2).fill({cmd:'wealth_request_result',args:{request:'original',generation:context.generation}}));
   assert.ok(calls.every(x=>['wealth_request_result','planning_sources'].includes(x.cmd)));
  }
 } finally {if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});
