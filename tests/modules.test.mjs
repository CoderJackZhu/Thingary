import test from 'node:test';
import assert from 'node:assert/strict';
import {allModules, hiddenKinds, financeOff} from '../src/modules.ts';
test('switched-off modules hide only their own event kinds',()=>{
 assert.equal(hiddenKinds(allModules).size,0);
 assert.deepEqual([...hiddenKinds({...allModules,wishlist:false,recurring:false})].sort(),['payment','wish_abandoned','wish_achieved','wish_added']);
 assert.equal(hiddenKinds({...allModules,stats:false,timeline:false}).size,0);
 assert.equal(financeOff({...allModules,wealth:false,expenses:false,recurring:false}),false);
 assert.equal(financeOff({...allModules,wealth:false,expenses:false,recurring:false,virtual:false}),true);
});
