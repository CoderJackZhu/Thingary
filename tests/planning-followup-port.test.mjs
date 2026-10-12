import test from 'node:test';
import assert from 'node:assert/strict';
import { nativePlanningFollowupPortV1 } from '../src/planning-followup-port.ts';
import { pendingKey, storedPending } from '../src/wealth.ts';
import { assumptionFixtures } from './helpers/planning-followup-fixtures.ts';
function harness(invoke) {
  const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  globalThis.window={__TAURI_INTERNALS__:{invoke}};return nativePlanningFollowupPortV1();
}
const context={generation:'fixture-generation',request_id:'fixture-request',expected_revision:2};
test('C1 native assumptions use real command arguments and clear the existing pending entry only after save',async()=>{
  const calls=[];const port=harness(async(command,args)=>{calls.push([command,args]);return {revision:3};});
  assert.deepEqual(await port.saveAssumptions(assumptionFixtures.reviewed.values,true,context),{status:'saved',id:'profile',revision:3});
  assert.equal(calls[0][0],'plan_assumptions_save');assert.deepEqual(calls[0][1].input,{...context,values:assumptionFixtures.reviewed.values,confirm:true});assert.equal(storedPending(),null);
});
test('C1 conflicting pending and backend invalid/revision errors are rejected without losing the draft or prior request',async()=>{
  let called=false;let port=harness(async()=>{called=true;throw {code:'REVISION_CONFLICT',message:'虚构修订冲突'};});
  const original={command:'plan_income_save',input:{generation:'fixture-generation',request_id:'prior'},label:'虚构'};
  localStorage.setItem(pendingKey,JSON.stringify(original));assert.equal((await port.saveAssumptions(assumptionFixtures.fresh.values,false,context)).issues[0].code,'pending_request');assert.equal(called,false);assert.deepEqual(storedPending(),original);
  port=harness(async(command)=>{if(command==='wealth_request_result')return null;throw {code:'REVISION_CONFLICT',message:'虚构修订冲突'};});
  assert.equal((await port.saveAssumptions(assumptionFixtures.fresh.values,false,context)).issues[0].code,'revision_conflict');assert.equal(storedPending(),null);
});
test('C1 lost commit reply retains exact request and resolves by metadata without replaying values',async()=>{
  let resolved=false;const calls=[];const port=harness(async(command,args)=>{calls.push([command,args]);if(command==='plan_assumptions_save')throw {code:'WORKER',message:'虚构失联'};if(command==='wealth_request_result') {if(!resolved)throw {code:'WORKER',message:'虚构读取失联'};return 'profile';}if(command==='plan_assumptions_read')return {...assumptionFixtures.reviewed,revision:3};});
  assert.deepEqual(await port.saveAssumptions(assumptionFixtures.reviewed.values,true,context),{status:'unresolved',request_id:context.request_id});const pending=storedPending();assert.equal(pending.input.confirm,true);
  resolved=true;const before=calls.filter(([c])=>c==='plan_assumptions_save').length;assert.equal((await port.resolve(context)).status,'saved');assert.equal(calls.filter(([c])=>c==='plan_assumptions_save').length,before);assert.equal(storedPending(),null);
});
test('C1 cross-generation or missing/unreadable committed profile stays unresolved; disabled and read errors differ',async()=>{
  const port=harness(async(command)=>{if(command==='wealth_request_result')throw {code:'STALE_DATASET',message:'虚构切库'};throw {code:'MODULE_DISABLED',message:'虚构关闭'};});
  localStorage.setItem(pendingKey,JSON.stringify({command:'plan_assumptions_save',input:context,label:'虚构'}));assert.equal((await port.resolve(context)).status,'unresolved');assert.ok(storedPending());assert.equal((await port.readAssumptions(context.generation)).status,'disabled');
});
