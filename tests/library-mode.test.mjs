import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSection,pendingGenerations,sectionKey,resetKey} from '../src/library-mode.ts';
const storage=(entries)=>{const m=new Map(entries);return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,removeItem:k=>m.delete(k)}};
test('switch destination is consumed once and rejects unknown sections',()=>{
 const s=storage([[sectionKey,'recurring']]);assert.equal(initialSection(s),'recurring');assert.equal(initialSection(s),'assets');
 assert.equal(initialSection(storage([[sectionKey,'untrusted']])),'assets');
});
test('receipts recover their originating library across business modules without treating preferences as writes',()=>{
 const s=storage([
 ['possio.asset-draft.v1',JSON.stringify({generation:'demo',pending:{generation:'demo'}})],
 ['possio.wealth-pending.v1',JSON.stringify({input:{generation:'personal'}})],
 ['possio.wishlist-abandon.v1',JSON.stringify({generation:'demo'})],
 ['possio.material-upload.v1',JSON.stringify({generation:'demo'})],
 ['possio.preferences',JSON.stringify({generation:'irrelevant'})],
 [resetKey,'reset-receipt'],
 ['possio.invalid-pending.v1','{'],
 ]);
 assert.deepEqual(pendingGenerations(s),['demo','personal']);assert.equal(s.getItem(resetKey),'reset-receipt');
});
