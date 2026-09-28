import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleError,revokeError,stateBeforeLatest,stateLabel} from '../src/lifecycle.ts';
const record={asset:{id:'fictional',name:'虚构',price_cents:null,purchase_date:'2026-09-01',revision:3},deleted:false,lifecycle:{state:'active',events:[{id:'r',sequence:1,kind:'retire',date:'2026-09-10',notes:''},{id:'a',sequence:2,kind:'activate',date:'2026-09-10',notes:''}]}};
test('date correction preserves same-day order and checks both neighbors',()=>{
 assert.equal(lifecycleError(record,{type:'correct_date',event_id:'r',date:'2026-09-10'},'2026-09-25'),'');
 assert.match(lifecycleError(record,{type:'correct_date',event_id:'r',date:'2026-09-11'},'2026-09-25'),/不能晚于/);
 assert.match(lifecycleError(record,{type:'correct_date',event_id:'a',date:'2026-09-09'},'2026-09-25'),/不能早于/);
 for(const date of ['2026-09-26','2026-08-31','2026-02-30','']) assert.ok(lifecycleError(record,{type:'correct_date',event_id:'r',date},'2026-09-25'));
});
test('state source, deletion and unknown dates stay explicit',()=>{
 const action={type:'append',kind:'retire',date:'2026-09-10',notes:''};
 assert.equal(lifecycleError(record,action,'2026-09-25'),'');
 assert.ok(lifecycleError({...record,lifecycle:{state:'sold',events:[]}},action,'2026-09-25'));
 assert.ok(lifecycleError({...record,deleted:true},action,'2026-09-25'));
 assert.ok(lifecycleError(record,{...action,kind:'activate'},'2026-09-25'));
 assert.equal(lifecycleError({...record,asset:{...record.asset,purchase_date:null}},action,'2026-09-25'),'');
 assert.equal(stateLabel({...record,lifecycle:{state:'retired',events:[]}}),'已退役');
});
test('D18: only the latest event is revocable and never under a sale',()=>{
 assert.match(revokeError(record,'r'),/最近一条/);
 assert.equal(revokeError(record,'a'),'');
 assert.equal(stateBeforeLatest(record),'已退役');
 assert.equal(stateBeforeLatest({...record,lifecycle:{state:'retired',events:[record.lifecycle.events[0]]}}),'使用中');
 assert.match(revokeError({...record,sale:{id:'s'}},'a'),/撤销误记售出/);
});
