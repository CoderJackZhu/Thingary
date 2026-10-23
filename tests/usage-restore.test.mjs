import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as choice from '../src/start-choice.ts';
import { allModules } from '../src/modules.ts';
const base={...allModules,incomes:true,movements:true,finance_status:'ready',finance_revision:7};
const selected={physical:true,money:true,planning:true};
const runtime=payload=>({...payload.modules,incomes:payload.incomes,movements:payload.movements});
const apply=(current,selection)=>{const payload=choice.usageModules(current,true,selection);assert.ok(payload);return runtime(payload);};
test('a purpose that stays selected keeps its item switches',()=>{
 const current={...base,expenses:false,incomes:false,wishlist:false};
 const next=apply(current,{...selected,planning:false});
 assert.equal(next.expenses,false);assert.equal(next.incomes,false);assert.equal(next.wishlist,false);assert.equal(next.recurring,true);assert.equal(next.planning,false);
});
test('closing a purpose turns off every item of it and leaves the timeline alone',()=>{
 const closed=apply({...base,timeline:false},{...selected,money:false,physical:false});
 for(const key of ['wealth','expenses','recurring','virtual','incomes','movements','physical','wishlist','stats'])assert.equal(closed[key],false,key);
 assert.equal(closed.timeline,false);assert.equal(closed.planning,true);
});
test('reopening a closed purpose starts fully on, whatever it looked like before',()=>{
 const current={...base,wishlist:false,expenses:false,incomes:false};
 for(const group of ['money','physical']){
  const reopened=apply(apply(current,{...selected,[group]:false}),selected);
  const items=group==='money'?['wealth','expenses','recurring','virtual','incomes','movements']:['physical','wishlist','stats'];
  for(const key of items)assert.equal(reopened[key],true,key);
 }
});
test('the old per-item memory is gone: nothing is written to local storage',()=>{
 for(const file of ['start-choice.ts','ModuleSettings.tsx'])assert.doesNotMatch(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),/usage-details|usageDetailsKey|prepareUsage|finishUsageChange/);
});
