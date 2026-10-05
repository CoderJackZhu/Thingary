import test from 'node:test';
import assert from 'node:assert/strict';
import {newAssetWarranty,changeNewAssetWarrantyPurchase} from '../src/preferences.ts';
test('new asset warranty runs one year from purchase rather than the added date',()=>{
 const today='2026-10-04';
 assert.deepEqual(newAssetWarranty('2025-04-03',today),{start_date:'2025-04-03',end_date:'2026-04-03',reminder:null});
 assert.equal(newAssetWarranty('2024-02-29',today).end_date,'2025-02-28');
 assert.equal(newAssetWarranty('2023-02-28',today).end_date,'2024-02-28');
 for (const unknown of [null,'','2025-0','2025-02-30']) assert.deepEqual(newAssetWarranty(unknown,today),{start_date:today,end_date:'2027-10-04',reminder:null});
});
test('new purchase date moves defaults but preserves custom warranty and reminder dates',()=>{
 const today='2026-10-04',original=newAssetWarranty(today,today);
 const reminder={date:original.end_date,notes:'default reminder'};
 assert.deepEqual(changeNewAssetWarrantyPurchase({...original,reminder},'2024-02-29',today),{start_date:'2024-02-29',end_date:'2025-02-28',reminder:{...reminder,date:'2025-02-28'}});
 const custom={...original,end_date:'2029-03-12',reminder:{date:'2029-03-01',notes:'custom'}};
 assert.deepEqual(changeNewAssetWarrantyPurchase(custom,'2025-04-03',today),{...custom,start_date:'2025-04-03'});
 assert.deepEqual(changeNewAssetWarrantyPurchase(newAssetWarranty('2025-04-03',today),null,today),original);
 assert.equal(original.start_date,today);
});
test('explicit warranty end stays fixed even when it coincides with the new default',()=>{
 const today='2026-10-04';
 const edited={...newAssetWarranty('2025-04-03',today),end_date:'2027-04-03'};
 const moved=changeNewAssetWarrantyPurchase(edited,'2026-04-03',today,true);
 assert.equal(moved.end_date,'2027-04-03');
 assert.equal(changeNewAssetWarrantyPurchase(moved,'2024-04-03',today,true).end_date,'2027-04-03');
});
import {goalProgress,defaultPreferences} from '../src/preferences.ts';
test('asset goal progress',()=>{
 const p=g=>({...defaultPreferences(),...g});
 assert.deepEqual(goalProgress(p({goal:{mode:'cost',cents:'1000'}}),'399903',137,'2026-05-15'),{hundredths:3425,remaining:263,unit:'天',reached_date:'2027-06-18',projected_cents:null});
 assert.equal(goalProgress(p({goal:{mode:'cost',cents:'1000'}}),'399903',500,'2026-05-15').hundredths,10000);
 assert.equal(goalProgress(p({goal:{mode:'cost',cents:'1000'}}),'-50',3,'2026-05-15').hundredths,10000);
 assert.equal(goalProgress(p({goal:{mode:'cost',cents:'1000'}}),null,3,'2026-05-15'),null);
 assert.deepEqual(goalProgress(p({cost_mode:'per_use',use_count:10,goal:{mode:'cost',cents:'500'}}),'10000',9,'2026-05-15'),{hundredths:5000,remaining:10,unit:'次',reached_date:null,projected_cents:null});
 assert.deepEqual(goalProgress(p({goal:{mode:'date',date:'2026-01-10'}}),'1000',5,'2026-01-01'),{hundredths:5000,remaining:5,unit:'天',reached_date:'2026-01-10',projected_cents:'100'});
 assert.equal(goalProgress(p({goal:{mode:'date',date:'2025-01-10'}}),'1000',5,'2026-01-01'),null);
});
import {retiredOn} from '../src/preferences.ts';
test('goal freezes at the latest retirement only while retired',()=>{
 const ev=(kind,date)=>({kind,date});
 assert.equal(retiredOn({state:'retired',events:[ev('retire','2026-01-01'),ev('activate','2026-02-01'),ev('retire','2026-03-01')]}),'2026-03-01');
 assert.equal(retiredOn({state:'active',events:[ev('retire','2026-01-01'),ev('activate','2026-02-01')]}),null);
 assert.equal(retiredOn(undefined),null);
});
