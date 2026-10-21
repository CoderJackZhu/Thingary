import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync(new URL('../src/wealth.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function runtime(invoke){
  const values=new Map(),exports={};
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  vm.runInNewContext(source,{exports,require:id=>id==='@tauri-apps/api/core'?{invoke}:id.includes('asset')?{errorMessage:e=>e.message,money:String}:{},localStorage:storage,console});
  return exports;
}
const save={command:'save_asset',label:'物品',input:{base:{request_id:'r1',generation:'g1',asset_id:null,expected_revision:null,name:'虚构物品',price_cents:null,purchase_date:null},details:{brand:'',model:'',serial_number:'',notes:''}}};
test('catalog unknown persists identity across reload, resolves through saved_request only',async()=>{
  const calls=[];let available=false;
  const w=runtime(async(command,args)=>{calls.push([command,args]);if(command==='save_asset')throw Error('lost');if(command==='saved_request'){if(!available)throw Error('offline');return {asset:{id:'a'}};}throw Error('wrong receipt');});
  await assert.rejects(w.submit(save),/暂时无法确认/);
  const p=w.storedPending();assert.equal(p.input.request_id,'r1');assert.equal(p.input.generation,'g1');assert.equal(p.input.base.price_cents,null);
  available=true;assert.equal(await w.resolvePending(p),'saved');assert.equal(w.storedPending(),null);
  assert.equal(calls.some(([c])=>c==='wealth_request_result'),false);
});
test('committed save replays the exact backend payload without synthetic root metadata',async()=>{
  let writes=0;const payloads=[];
  const w=runtime(async(c,args)=>{if(c==='saved_request')return {asset:{id:'a'}};payloads.push(JSON.stringify(args.input));if(++writes===1)throw Error('lost');return {asset:{id:'a'}};});
  const r=await w.submit(save);assert.equal(r.asset.id,'a');assert.equal(writes,2);assert.equal(payloads[0],payloads[1]);assert.deepEqual(JSON.parse(payloads[0]),save.input);assert.equal(w.storedPending(),null);
});
test('record deletion checks its fingerprint-aware receipt and keeps an unresolved conflict',async()=>{
  const calls=[];const w=runtime(async(c,args)=>{calls.push([c,args]);if(c==='saved_record_trash_request')throw {code:'REQUEST_CONFLICT',message:'conflict'};throw Error('lost');});
  const pending={command:'change_record_trash',label:'删除保障',input:{request_id:'r2',generation:'g1',asset_id:'a',expected_revision:2,kind:'warranty',record_id:'w',deleted:true}};
  await assert.rejects(w.submit(pending),/暂时无法确认/);assert.equal(w.storedPending().input.record_id,'w');
  assert.equal(calls[1][0],'saved_record_trash_request');assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1].input)),pending.input);
});
test('batch receipt uses feature store and replay is idempotent',async()=>{
  let writes=0;const w=runtime(async(c)=>{if(c==='wealth_request_result')return 'batch-receipt';if(c==='batch_change'&&++writes===1)throw Error('lost');return {changed:2};});
  const result=await w.submit({command:'batch_change',label:'批量',input:{request_id:'r3',generation:'g1',action:'delete',items:[]}});
  assert.equal(result.changed,2);assert.equal(writes,2);assert.equal(w.storedPending(),null);
});
test('catalog library switch retains original receipt and prevents another write',async()=>{
  let writes=0;const w=runtime(async(c)=>{if(c==='saved_request')throw {code:'STALE_DATASET',message:'switched'};writes++;throw Error('lost');});
  await assert.rejects(w.submit(save));const original=JSON.stringify(w.storedPending());
  await assert.rejects(w.resolvePending(w.storedPending()),/资料库已切换/);assert.equal(JSON.stringify(w.storedPending()),original);
  await assert.rejects(w.submit({...save,input:{...save.input,base:{...save.input.base,request_id:'other'}}}),/还有一个提交结果待核对/);assert.equal(writes,1);
});
test('confirmed unsaved catalog request clears durable guard',async()=>{
  const w=runtime(async(c)=>{if(c==='saved_request')return null;throw Error('rejected');});
  await assert.rejects(w.submit(save),/rejected/);assert.equal(w.storedPending(),null);
});
