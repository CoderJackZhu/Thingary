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
  let resolved=false;const calls=[];const port=harness(async(command,args)=>{calls.push([command,args]);if(command==='plan_assumptions_save')throw {code:'WORKER',message:'虚构失联'};if(command==='wealth_request_result') {if(!resolved)throw {code:'WORKER',message:'虚构读取失联'};return 'profile';}if(command==='followup_receipt')return {id:'profile',revision:3};if(command==='plan_assumptions_read')return {...assumptionFixtures.reviewed,revision:3};});
  assert.deepEqual(await port.saveAssumptions(assumptionFixtures.reviewed.values,true,context),{status:'unresolved',request_id:context.request_id});const pending=storedPending();assert.equal(pending.input.confirm,true);
  resolved=true;const before=calls.filter(([c])=>c==='plan_assumptions_save').length;assert.equal((await port.resolve(context)).status,'saved');assert.equal(calls.filter(([c])=>c==='plan_assumptions_save').length,before);assert.equal(storedPending(),null);
});
test('C1 cross-generation or missing/unreadable committed profile stays unresolved; disabled and read errors differ',async()=>{
  const port=harness(async(command)=>{if(command==='wealth_request_result')throw {code:'STALE_DATASET',message:'虚构切库'};throw {code:'MODULE_DISABLED',message:'虚构关闭'};});
  localStorage.setItem(pendingKey,JSON.stringify({command:'plan_assumptions_save',input:context,label:'虚构'}));assert.equal((await port.resolve(context)).status,'unresolved');assert.ok(storedPending());assert.equal((await port.readAssumptions(context.generation)).status,'disabled');
});
test('C2 every movement/review method delegates to a registered native command with the frozen DTO',async()=>{
  const calls=[];const port=harness(async(command,args)=>{calls.push([command,args]);return command.endsWith('_save')||command.endsWith('_trash') ? {id:'fictional-id',revision:4} : {generation:context.generation};});
  const fields={date:'2026-10-15',amount_cents:'100',from:{kind:'account',account_id:'fixture-cash'},to:{kind:'external',label:'虚构'},purpose:'external_funding',source:null,notes:''};
  const pair={from_snapshot_id:'fixture-start',to_snapshot_id:'fixture-end'};const draft={selection:{mode:'movements'},confirmed_complete:false,unsupported_movements:false,notes:''};
  const query={from_date:null,to_date:null,account_id:null,deleted:'all',cursor:null};const sq={kind:'expense',text:'虚构',cursor:null,movement_id:null};
  await port.listAccounts(context.generation);await port.listMovements(query,context.generation);await port.listSources(sq,context.generation);
  assert.equal((await port.saveMovement(null,fields,context)).status,'saved');await port.setMovementDeleted('fictional-id',true,context);await port.readReview(pair,context.generation);await port.listReviews(context.generation);await port.previewReview(pair,draft,context.generation);await port.saveReview(pair,draft,'domain-key',context);await port.setReviewDeleted('fictional-id',false,context);
  assert.deepEqual(calls.map(([c])=>c),['movement_accounts','movement_list','movement_sources','movement_save','movement_trash','followup_review_read','followup_review_list','followup_review_preview','followup_review_save','followup_review_trash']);
  assert.deepEqual(calls[3][1],{input:{...context,id:null,fields}});assert.deepEqual(calls[8][1],{input:{...context,pair,draft,basis_key:'domain-key'}});
});
test('C2 lost reply and switched dataset retain the exact review basis and never replay during resolve',async()=>{
  const calls=[];const port=harness(async(command,args)=>{calls.push([command,args]);throw {code:'STALE_DATASET',message:'虚构资料库已切换'};});
  const pair={from_snapshot_id:'a',to_snapshot_id:'b'},draft={selection:{mode:'manual',inflow_cents:null,outflow_cents:null},confirmed_complete:false,unsupported_movements:false,notes:''};
  const outcome=await port.saveReview(pair,draft,'original-key',context);assert.equal(outcome.status,'unresolved');assert.equal(storedPending().input.basis_key,'original-key');const writes=calls.filter(([c])=>c==='followup_review_save').length;
  assert.equal((await port.resolve(context)).status,'unresolved');assert.equal(calls.filter(([c])=>c==='followup_review_save').length,writes);assert.equal(storedPending().input.basis_key,'original-key');
});
test('C2 stale basis and expired cursor surface as errors; a missing same-generation receipt is explicitly not committed',async()=>{
  const port=harness(async(command)=>{if(command==='wealth_request_result'||command==='followup_receipt')return null;throw {code:command==='movement_list'?'STALE_CURSOR':'STALE_BASIS',message:'虚构依据过期'};});
  const pair={from_snapshot_id:'a',to_snapshot_id:'b'},draft={selection:{mode:'movements'},confirmed_complete:true,unsupported_movements:false,notes:''};
  assert.equal((await port.saveReview(pair,draft,'old',context)).issues[0].code,'stale_basis');assert.equal(storedPending(),null);
  const read=await port.listMovements({from_date:null,to_date:null,account_id:null,deleted:'active',cursor:'expired'},context.generation);assert.equal(read.status,'error');assert.equal(read.code,'STALE_CURSOR');
  localStorage.setItem(pendingKey,JSON.stringify({command:'movement_save',input:context,label:'虚构'}));assert.equal((await port.resolve(context)).issues[0].code,'not_committed');assert.equal(storedPending(),null);
});
