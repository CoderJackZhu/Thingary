import test from 'node:test';
import assert from 'node:assert/strict';
import { blankWarranty, deriveStatus, recoverWarranty, statusLabel, storedWarranty, summarizeWarranties, warrantyChange, warrantyDraft, warrantyKey, warrantySummaryText, validateWarranty } from '../src/warranty.ts';

function record(warranties = []) {
  return {
    asset:{id:'asset-1',name:'虚构相机',price_cents:'100000',purchase_date:'2026-09-01',revision:3},
    details:{brand:'',model:'',serial_number:'',notes:''},classification:{category_id:null,channel_id:null},created_at:null,updated_at:null,deleted:false,deleted_at:null,photos:[],cover_id:null,
    lifecycle:{state:'active',events:[]},sale:null,
    maintenances:[],warranties,warranty_summary:summarizeWarranties(warranties,'2026-09-10'),
    costs:{known_maintenance_cents:'0',unknown_maintenance_count:0,total_investment_cents:'100000',sale_proceeds_cents:null,net_cost_cents:null,held_days:10,daily_cents:'10000'},
  };
}
const warranty = (id, start, end) => ({id, fields:{kind:'manufacturer',provider:'Apple',start_date:start,end_date:end,notes:''},status:'pending',remaining_days:null,photos:[],created_at:'',updated_at:''});

test('E04 fixed-day boundaries match the Rust rules with no timezone drift',()=>{
  assert.deepEqual(deriveStatus('2026-09-01','2026-09-10','2026-09-10'),{status:'expiring',remaining_days:0});
  assert.deepEqual(deriveStatus('2026-09-01','2026-10-10','2026-09-10'),{status:'expiring',remaining_days:30});
  assert.deepEqual(deriveStatus('2026-09-01','2026-10-11','2026-09-10'),{status:'active',remaining_days:31});
  // Same-day start and end is effective; the day after, it is expired.
  assert.deepEqual(deriveStatus('2026-09-10','2026-09-10','2026-09-10'),{status:'expiring',remaining_days:0});
  assert.deepEqual(deriveStatus('2026-09-01','2026-09-10','2026-09-11'),{status:'expired',remaining_days:null});
  // Unknown dates never confirm coverage; future starts wait.
  assert.deepEqual(deriveStatus(null,'2026-12-31','2026-09-10'),{status:'pending',remaining_days:null});
  assert.deepEqual(deriveStatus('2026-09-11',null,'2026-09-10'),{status:'pending',remaining_days:null});
  assert.deepEqual(deriveStatus('2026-09-11','2027-01-01','2026-09-10'),{status:'upcoming',remaining_days:null});
});

test('E05 mixed summaries keep every fact separate and never claim coverage',()=>{
  const today='2026-09-10';
  const mixed=summarizeWarranties([warranty('a','2026-10-01','2027-01-01'),warranty('b','2025-01-01','2026-01-01'),warranty('c',null,null)],today);
  assert.equal(mixed.status,'not_covered');
  assert.deepEqual([mixed.upcoming_count,mixed.expired_count,mixed.pending_count],[1,1,1]);
  assert.match(warrantySummaryText(mixed),/当前无有效保障/);
  assert.match(warrantySummaryText(mixed),/尚未生效/);
  assert.match(warrantySummaryText(mixed),/已到期/);
  assert.match(warrantySummaryText(mixed),/日期待补全/);
  // Long-valid + near-expiry + future: covered with the near-expiry hint kept.
  const covered=summarizeWarranties([warranty('a','2026-01-01','2026-12-31'),warranty('b','2026-09-01','2026-09-12'),warranty('c','2026-10-01','2027-06-30')],today);
  assert.equal(covered.status,'covered');
  assert.equal(covered.expiring_count,1);
  assert.match(warrantySummaryText(covered),/保障中，1 份即将到期/);
  // Only near-expiry coverage warns about expiry; no records stays distinct.
  assert.equal(summarizeWarranties([warranty('a','2026-08-01','2026-09-12')],today).status,'expiring_soon');
  const none=summarizeWarranties([],today);
  assert.equal(none.status,'none');
  assert.equal(warrantySummaryText(none),'还没有保障记录');
  assert.equal(warrantySummaryText(summarizeWarranties([warranty('a',null,null)],today)),'当前无有效保障（1 份日期待补全）');
});

test('validation allows future dates and rejects only reversed pairs and bad input',()=>{
  assert.equal(validateWarranty({...blankWarranty(),start:'2027-01-01',end:'2028-01-01'}),null);
  assert.equal(validateWarranty({...blankWarranty(),start:'2026-09-10',end:'2026-09-10'}),null);
  assert.equal(validateWarranty({...blankWarranty(),start:'',end:''}),null);
  assert.match(validateWarranty({...blankWarranty(),start:'2026-10-01',end:'2026-09-30'})??'',/结束日期不能早于开始日期/);
  assert.match(validateWarranty({...blankWarranty(),start:'2026-9-1'})??'',/YYYY-MM-DD/);
  assert.match(validateWarranty({...blankWarranty(),notes:'x'.repeat(10001)})??'',/10000/);
  assert.match(validateWarranty({...blankWarranty(),provider:'p'.repeat(201)})??'',/200/);
});

test('draft and payload round-trip preserves unknown dates and correct identity',()=>{
  const w=[warranty('w-1','2026-03-10','2026-10-20')];
  const r=record(w);
  const draft=warrantyDraft(r,'w-1');
  assert.deepEqual(draft,{kind:'manufacturer',provider:'Apple',start:'2026-03-10',end:'2026-10-20',notes:'',photo_ids:[]});
  const payload=warrantyChange(r,'generation-1',{...draft,start:'',end:''},'w-1','request-1');
  assert.equal(payload.action.type,'correct');
  assert.equal(payload.action.fields.start_date,null);
  assert.equal(payload.action.fields.end_date,null);
  const add=warrantyChange(r,'generation-1',blankWarranty(),undefined,'request-2');
  assert.equal(add.action.type,'add');
  assert.equal(add.action.fields.kind,'manufacturer');
  assert.equal(add.action.photos.cover_id,null);
});

test('draft persistence keeps generation, photos and pending request across restart',()=>{
  const r=record();
  const fields={...blankWarranty(),provider:'虚构保障',photo_ids:['photo-1']};
  const pending=warrantyChange(r,'generation-1',fields,undefined,'request-stable');
  const saved={record:r,generation:'generation-1',fields,original:blankWarranty(),photos:[{id:'photo-1',name:'receipt.png'}],pending};
  const values=new Map([[warrantyKey,JSON.stringify(saved)]]);
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>values.get(key)??null};
  try {
    const recovered=storedWarranty();
    assert.equal(recovered.generation,'generation-1');
    assert.equal(recovered.fields.provider,'虚构保障');
    assert.equal(recovered.photos[0].id,'photo-1');
    assert.equal(recovered.pending.request_id,'request-stable');
  } finally {
    if(previous===undefined) delete globalThis.localStorage; else globalThis.localStorage=previous;
  }
});

function savedDraft(pending=false) {
  const r=record(), fields={...blankWarranty(),provider:'原草稿'};
  return {record:r,generation:'g1',fields,original:blankWarranty(),photos:[],pending:pending?warrantyChange(r,'g1',fields,undefined,'request-stable'):null};
}

test('recovery blocks another dataset without querying or rewriting the original request',async()=>{
  const saved=savedDraft(true), before=structuredClone(saved);
  const fail=()=>{throw new Error('must not query another dataset')};
  const result=await recoverWarranty(saved,'g2',fail,fail);
  assert.equal(result.issue.kind,'blocked');
  assert.deepEqual(result.state,before);
});

test('committed recovery checks the original receipt before reading the asset',async()=>{
  const saved=savedDraft(true), current=record();current.asset.revision++;
  const calls=[];
  const result=await recoverWarranty(saved,'g1',async()=>{throw new Error('must use receipt first')},async(request,generation)=>{calls.push([request,generation]);return current});
  assert.deepEqual(calls,[['request-stable','g1']]);
  assert.equal(result.kind,'saved');assert.equal(result.record,current);
});

test('unresolved receipt stays pending; switched dataset exits blocked',async()=>{
  const saved=savedDraft(true);
  for(const [error,kind] of [[new Error('offline'),'pending'],[{code:'STALE_DATASET',message:'switched'},'blocked']]) {
    const result=await recoverWarranty(saved,'g1',async()=>{throw new Error('must not read before receipt')},async()=>{throw error});
    assert.equal(result.issue.kind,kind);
    assert.equal(result.state.pending.request_id,'request-stable');
  }
});

test('missing receipt clears pending only; a newer revision needs explicit confirmation',async()=>{
  const saved=savedDraft(true), current=record();current.asset.revision++;
  const calls=[];
  const result=await recoverWarranty(saved,'g1',async id=>{calls.push(id);return current},async()=>null);
  assert.deepEqual(calls,['asset-1']);assert.equal(result.issue.kind,'conflict');
  assert.equal(result.state.record.asset.revision,3);assert.equal(result.issue.latest.asset.revision,4);
  assert.equal(result.state.pending,null);assert.deepEqual(result.state.fields,saved.fields);
});

test('recovery rejects missing, deleted or mismatched assets and lost warranty identity',async()=>{
  for(const current of [null,{...record(),deleted:true},{...record(),asset:{...record().asset,id:'another'}}]) {
    const result=await recoverWarranty(savedDraft(),'g1',async()=>current,async()=>null);
    assert.equal(result.issue.kind,'blocked');
  }
  const saved={...savedDraft(),warranty_id:'missing'};
  const result=await recoverWarranty(saved,'g1',async()=>record(),async()=>null);
  assert.equal(result.issue.kind,'blocked');assert.equal(result.state.warranty_id,'missing');
});

test('damaged pending payload cannot silently clear a draft',async()=>{
  const saved=savedDraft(true);
  saved.pending.asset_id='wrong';
  assert.equal((await recoverWarranty(saved,'g1',async()=>null,async()=>{throw new Error('must not query malformed request')})).issue.kind,'blocked');
});

test('status labels exist for every derived state',()=>{
  for(const status of ['pending','upcoming','active','expiring','expired']) assert.ok(statusLabel[status]);
});
