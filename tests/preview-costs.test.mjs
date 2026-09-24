import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewRecord } from '../src/preview-costs.ts';
const record = () => ({asset:{id:'fixture',name:'虚构相机',revision:1,price_cents:'10000',purchase_date:'2026-09-01'},maintenances:[],costs:{},lifecycle:{state:'active',events:[]}});
test('preview costs use current date and maintenance without mutating the stored fixture', () => {
  const r=record(); r.maintenances=[{fields:{cost_cents:'5000'}}];
  const copy=previewRecord(r,'2026-09-25');
  assert.equal(copy.costs.held_days,25);assert.equal(copy.costs.daily_cents,'600');assert.equal(copy.costs.total_investment_cents,'15000');assert.deepEqual(r.costs,{});
});
test('preview unknown maintenance hides precision while known zero remains valid', () => {
  const r=record();r.maintenances=[{fields:{cost_cents:null}}];
  assert.equal(previewRecord(r,'2026-09-25').costs.daily_cents,null);
  assert.equal(previewRecord(r,'2026-09-25').costs.unknown_maintenance_count,1);
  r.maintenances[0].fields.cost_cents='0';r.asset.price_cents='0';
  assert.equal(previewRecord(r,'2026-09-25').costs.daily_cents,'0');
});
test('preview sale fixes the endpoint and preserves negative net costs', () => {
  const r=record();r.sale={fields:{date:'2026-09-10',price_cents:'12000'}};
  const c=previewRecord(r,'2026-09-25').costs;
  assert.equal(c.held_days,10);assert.equal(c.net_cost_cents,'-2000');assert.equal(c.daily_cents,'-200');
});
