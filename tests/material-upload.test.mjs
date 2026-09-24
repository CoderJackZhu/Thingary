import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingUpload, uploadAndResolve, uploadKey } from '../src/material-upload.ts';
const operation = {request:'stable-upload',generation:'dataset-a'};
test('lost upload response resolves original operation without a second upload', async () => {
  let sends=0; const entry={id:operation.request,name:'example.png',builtin:false};
  const result=await uploadAndResolve(operation, async p=>{sends++;assert.deepEqual(p,operation);throw Error('lost');}, async p=>{assert.deepEqual(p,operation);return entry;});
  assert.equal(result,entry); assert.equal(sends,1);
});
test('failed lookup leaves persisted original operation available after reload', async () => {
  const store=new Map([[uploadKey,JSON.stringify(operation)]]);
  const storage={getItem:k=>store.get(k)??null};
  await assert.rejects(uploadAndResolve(pendingUpload(storage),async()=>{throw Error('lost');},async()=>{throw Error('offline');}),/offline/);
  assert.deepEqual(pendingUpload(storage),operation);
});
test('confirmed absence is distinct from unknown upload result', async () => {
  assert.equal(await uploadAndResolve(operation,async()=>{throw Error('cancelled');},async()=>null),null);
});
test('unreadable recovery record must not silently start another upload', () => {
  assert.throws(()=>pendingUpload({getItem:()=>'{invalid'}));
  assert.throws(()=>pendingUpload({getItem:()=>'{"generation":42}'}));
});
