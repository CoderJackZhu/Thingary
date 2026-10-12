import test from 'node:test';
import assert from 'node:assert/strict';
import {allModules, hiddenKinds, financeOff, financeModulesReady} from '../src/modules.ts';
test('switched-off modules hide only their own event kinds',()=>{
 assert.equal(hiddenKinds(allModules).size,0);
 assert.deepEqual([...hiddenKinds({...allModules,wishlist:false,recurring:false})].sort(),['payment','wish_abandoned','wish_achieved','wish_added']);
 assert.equal(hiddenKinds({...allModules,stats:false,timeline:false}).size,0);
 assert.equal(financeOff({...allModules,wealth:false,expenses:false,recurring:false}),false);
 assert.equal(financeOff({...allModules,wealth:false,expenses:false,recurring:false,virtual:false}),true);
});

test('runtime finance status must be ready with a positive safe revision', () => {
 const ready = {...allModules, incomes:false, movements:true, finance_status:'ready', finance_revision:1};
 assert.equal(financeModulesReady(ready),true);
 for (const finance_status of ['legacy_corrupt','finance_corrupt','unsupported_version','read_error','write_error']) {
  assert.equal(financeModulesReady({...ready,finance_status}),false);
 }
 for (const finance_revision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
  assert.equal(financeModulesReady({...ready,finance_revision}),false);
 }
 assert.equal(hiddenKinds(ready).size,0);
});
