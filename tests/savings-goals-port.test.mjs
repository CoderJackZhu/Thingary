import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSavingsGoal } from '../src/savings-goals-port.ts';
import { resolvePending, storedPending, pendingKey, Unresolved } from '../src/wealth.ts';
const input={request_id:'fictional-request',generation:'fictional-library',id:null,expected_revision:null,fields:{name:'不要持久化此名称',notes:'不要持久化此备注',target_cents:'100000',target_date:null},account_ids:['fictional-account']};
function storage(){const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};return values;}
test('lost goal response checks the original receipt without replay or private form persistence',async()=>{
  const values=storage(),calls=[];
  await writeSavingsGoal('savings_goals_save',input,'存钱目标',async(command,args)=>{
    calls.push([command,args]);
    if(command==='savings_goals_save'){
      const stored=JSON.parse(values.get(pendingKey));
      assert.deepEqual(stored.input,{request_id:input.request_id,generation:input.generation});
      assert.doesNotMatch(values.get(pendingKey),/不要持久化/);
      throw new Error('reply lost');
    }
    return 'saved-goal';
  });
  assert.deepEqual(calls.map(c=>c[0]),['savings_goals_save','wealth_request_result']);assert.equal(storedPending(),null);
});
test('unknown or changed-library receipt stays preserved and blocks a second write',async()=>{
  const values=storage();let writes=0;
  await assert.rejects(writeSavingsGoal('savings_goals_save',input,'存钱目标',async(command)=>{if(command==='savings_goals_save')writes++;throw {code:'STALE_DATASET',message:'changed'};}),Unresolved);
  assert.deepEqual(JSON.parse(values.get(pendingKey)).input,{request_id:input.request_id,generation:input.generation});
  await assert.rejects(writeSavingsGoal('savings_goals_save',input,'存钱目标',async()=>{writes++;}),Unresolved);assert.equal(writes,1);
  globalThis.window={__TAURI_INTERNALS__:{invoke:async()=>{throw {code:'STALE_DATASET',message:'changed'};}}};
  await assert.rejects(resolvePending(storedPending()),Unresolved);assert.notEqual(storedPending(),null);
});
test('confirmed no-commit clears receipt and preserves the original validation error',async()=>{
  storage();const failure=new Error('invalid target');
  await assert.rejects(writeSavingsGoal('savings_goals_save',input,'存钱目标',async command=>{if(command==='savings_goals_save')throw failure;return null;}),e=>e===failure);
  assert.equal(storedPending(),null);
});
