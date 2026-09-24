import test from 'node:test';
import assert from 'node:assert/strict';
import { blankMaintenance, maintenanceChange, maintenanceDraft, maintenanceKey, refreshCostsForNewDay, recoverMaintenance, storedMaintenance, validateMaintenance } from '../src/maintenance.ts';
import { saleError, settlement, incompleteCostReason } from '../src/sales.ts';

function record() {
  return {
    asset:{id:'asset-1',name:'虚构相机',price_cents:'100000',purchase_date:'2026-09-01',revision:3},
    details:{brand:'',model:'',serial_number:'',notes:''},classification:{category_id:null,channel_id:null},created_at:null,updated_at:null,deleted:false,deleted_at:null,photos:[],cover_id:null,
    lifecycle:{state:'active',events:[]},sale:null,
    maintenances:[{id:'m-1',fields:{date:'2026-09-03',kind:'repair',title:'维修',description:'',cost_cents:'20000',provider:''},created_at:'',updated_at:'',photos:[]}],
    costs:{known_maintenance_cents:'20000',unknown_maintenance_count:0,total_investment_cents:'120000',sale_proceeds_cents:null,net_cost_cents:null,held_days:10,daily_cents:'12000'},
  };
}

test('maintenance draft preserves unknown versus free and builds corrective payload',()=>{
  const r=record();
  assert.equal(maintenanceDraft(r,'m-1').cost,'200.00');
  const free={...blankMaintenance(),date:'2026-09-04',title:'免费清洁',cost:'0'};
  const payload=maintenanceChange(r,'generation-1',free,'m-1','request-1');
  assert.equal(payload.generation,'generation-1');
  assert.equal(payload.action.type,'correct');
  assert.equal(payload.action.fields.cost_cents,'0');
  assert.equal(validateMaintenance({...free,cost:''},r,'2026-09-10'),null);
});

test('maintenance recovery preserves generation, input and original request across restart',()=>{
  const r=record();
  const fields={...blankMaintenance(),title:'持久草稿',photo_ids:['photo-1']};
  const pending=maintenanceChange(r,'generation-1',fields,undefined,'request-stable');
  const saved={record:r,generation:'generation-1',fields,original:blankMaintenance(),photos:[{id:'photo-1',name:'receipt.jpg'}],pending};
  const values=new Map([[maintenanceKey,JSON.stringify(saved)]]);
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>values.get(key)??null};
  try {
    const recovered=storedMaintenance();
    assert.equal(recovered.generation,'generation-1');
    assert.equal(recovered.fields.title,'持久草稿');
    assert.equal(recovered.photos[0].id,'photo-1');
    assert.equal(recovered.pending.request_id,'request-stable');
  } finally {
    if(previous===undefined) delete globalThis.localStorage; else globalThis.localStorage=previous;
  }
});

test('maintenance and sale dates validate in both directions',()=>{
  const r=record();
  assert.match(validateMaintenance({...blankMaintenance(),title:'维护',date:'2026-08-31'},r,'2026-09-10')??'',/购买日期/);
  assert.match(validateMaintenance({...blankMaintenance(),title:'维护',date:'2026-09-11'},r,'2026-09-10')??'',/今天/);
  const draft={record:r,generation:'g',mode:'sell',fields:{date:'2026-09-02',price:'300.00',platform:'',buyer:'',notes:''},original:{date:'2026-09-02',price:'300.00',platform:'',buyer:'',notes:''},pending:null};
  assert.match(saleError(draft,'2026-09-10'),/维护记录/);
});

test('settlement includes maintenance and hides precision for unknown costs',()=>{
  const r=record();
  assert.deepEqual(settlement(r,{date:'2026-09-10',price_cents:'30000',platform:'',buyer:'',notes:''}),{days:10,net:'90000',daily:'9000'});
  r.costs.unknown_maintenance_count=1;
  assert.deepEqual(settlement(r,{date:'2026-09-10',price_cents:'30000',platform:'',buyer:'',notes:''}),{days:10,net:null,daily:null});
});

test('day refresh skips unchanged days and refreshes selected summary or full detail once',async()=>{
  for (const [before,after,detail,selected,expected] of [
    ['2026-09-10','2026-09-10',null,'a',[]],
    ['2026-09-10','2026-09-11',null,'a',['list','a']],
    ['2026-09-10','2026-09-11','a','a',['list','a']],
    ['2026-09-10','2026-09-11',null,null,['list']],
  ]) {
    const calls=[];
    await refreshCostsForNewDay(before,after,async()=>calls.push('list'),detail,selected,async id=>calls.push(id));
    assert.deepEqual(calls,expected);
  }
});

function savedDraft(pending=false) {
  const r=record(), fields={...blankMaintenance(),title:'原草稿',cost:'150'};
  return {record:r,generation:'g1',fields,original:blankMaintenance(),photos:[],pending:pending?maintenanceChange(r,'g1',fields,undefined,'request-stable'):null};
}

test('recovery blocks another dataset without querying or rewriting the original request',async()=>{
  const saved=savedDraft(true), before=structuredClone(saved);
  const fail=()=>{throw new Error('must not query another dataset')};
  const result=await recoverMaintenance(saved,'g2',fail,fail);
  assert.equal(result.issue.kind,'blocked');
  assert.deepEqual(result.state,before);
});

test('committed recovery checks original receipt before stale revision and never replays',async()=>{
  const saved=savedDraft(true), current=record();current.asset.revision++;
  const calls=[];
  const result=await recoverMaintenance(saved,'g1',async()=>{throw new Error('must use receipt first')},async(request,generation)=>{calls.push([request,generation]);return current});
  assert.deepEqual(calls,[['request-stable','g1']]);
  assert.equal(result.kind,'saved');assert.equal(result.record,current);
});

test('unresolved receipt stays pending, while switched dataset has a safe blocked exit',async()=>{
  const saved=savedDraft(true);
  for(const [error,kind] of [[new Error('offline'),'pending'],[{code:'STALE_DATASET',message:'switched'},'blocked']]) {
    const result=await recoverMaintenance(saved,'g1',async()=>{throw new Error('must not read before receipt')},async()=>{throw error});
    assert.equal(result.issue.kind,kind);
    assert.equal(result.state.pending.request_id,'request-stable');
  }
});

test('missing receipt clears pending only, newer revision needs explicit confirmation',async()=>{
  const saved=savedDraft(true), current=record();current.asset.revision++;
  const calls=[];
  const result=await recoverMaintenance(saved,'g1',async id=>{calls.push(id);return current},async()=>null);
  assert.deepEqual(calls,['asset-1']);assert.equal(result.issue.kind,'conflict');
  assert.equal(result.state.record.asset.revision,3);assert.equal(result.issue.latest.asset.revision,4);
  assert.equal(result.state.pending,null);assert.deepEqual(result.state.fields,saved.fields);
  assert.equal(saved.pending.request_id,'request-stable');
});

test('recovery rejects missing, deleted, mismatched assets and missing maintenance identity',async()=>{
  for(const current of [null,{...record(),deleted:true},{...record(),asset:{...record().asset,id:'another'}}]) {
    const result=await recoverMaintenance(savedDraft(),'g1',async()=>current,async()=>null);
    assert.equal(result.issue.kind,'blocked');
  }
  const saved={...savedDraft(),maintenance_id:'missing'};
  const result=await recoverMaintenance(saved,'g1',async()=>record(),async()=>null);
  assert.equal(result.issue.kind,'blocked');assert.equal(result.state.maintenance_id,'missing');
});

test('unchanged recovery refreshes current data while preserving draft fields and photos',async()=>{
  const saved=savedDraft(), current=record();current.costs.held_days=11;
  const result=await recoverMaintenance(saved,'g1',async()=>current,async()=>null);
  assert.equal(result.issue,null);assert.equal(result.state.record.costs.held_days,11);
  assert.deepEqual(result.state.fields,saved.fields);
});

test('receipt mismatches and damaged pending payload cannot silently clear a draft',async()=>{
  const saved=savedDraft(true);
  const wrong={...record(),asset:{...record().asset,id:'wrong'}};
  assert.equal((await recoverMaintenance(saved,'g1',async()=>null,async()=>wrong)).issue.kind,'blocked');
  saved.pending.asset_id='wrong';
  assert.equal((await recoverMaintenance(saved,'g1',async()=>null,async()=>{throw new Error('must not query malformed request')})).issue.kind,'blocked');
});

test('cost completeness explains purchase, maintenance, both, and known zero separately',()=>{
  const r=record();
  assert.equal(incompleteCostReason(r),'');
  r.costs.unknown_maintenance_count=2;
  assert.equal(incompleteCostReason(r),'2 条维护费用未知，成本不完整。');
  r.asset.price_cents=null;
  assert.equal(incompleteCostReason(r),'购入金额未知，2 条维护费用未知，成本不完整。');
  r.costs.unknown_maintenance_count=0;
  assert.equal(incompleteCostReason(r),'购入金额未知，成本不完整。');
  r.asset.price_cents='0';assert.equal(incompleteCostReason(r),'');
});
