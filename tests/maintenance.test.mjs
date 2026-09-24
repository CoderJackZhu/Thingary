import test from 'node:test';
import assert from 'node:assert/strict';
import { blankMaintenance, maintenanceChange, maintenanceDraft, validateMaintenance } from '../src/maintenance.ts';
import { saleError, settlement } from '../src/sales.ts';

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
