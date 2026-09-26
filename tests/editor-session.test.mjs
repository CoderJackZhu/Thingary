import test from 'node:test';
import assert from 'node:assert/strict';
import {persistSubmission,clearUnsubmittedEditors} from '../src/editor-session.ts';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
test('ordinary incomplete input is never retained, uncertain submissions survive restart cleanup',()=>{
 const s=memory(),key='possio.asset-draft.v1';
 s.setItem(key,JSON.stringify({fields:{name:'old unsaved'}}));
 s.setItem('possio.wishlist-draft.v1',JSON.stringify({planPending:{request_id:'exact-once',cents:'500'}}));
 s.setItem('possio.sale-draft.v1',JSON.stringify({pending:{request_id:'sale-receipt'}}));
 clearUnsubmittedEditors(s);
 assert.equal(s.getItem(key),null);
 assert.equal(JSON.parse(s.getItem('possio.wishlist-draft.v1')).planPending.request_id,'exact-once');
 assert.equal(JSON.parse(s.getItem('possio.sale-draft.v1')).pending.request_id,'sale-receipt');
 persistSubmission(key,{pending:{request_id:'asset-receipt'}},s);
 assert.equal(JSON.parse(s.getItem(key)).pending.request_id,'asset-receipt');
 persistSubmission(key,{pending:null},s);assert.equal(s.getItem(key),null);
});
