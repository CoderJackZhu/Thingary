import test from 'node:test';
import assert from 'node:assert/strict';
import {savingPercent} from '../src/preferences.ts';
test('savings ring agrees with cent precision at the completion boundary',()=>{
 assert.equal(savingPercent('9999','10000'),99);
 assert.equal(savingPercent('10000','10000'),100);
 assert.equal(savingPercent('10001','10000'),100);
 assert.equal(savingPercent('0',null),null);
 assert.equal(savingPercent('0','0'),100);
 assert.equal(savingPercent('99999999998','99999999999'),99);
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
