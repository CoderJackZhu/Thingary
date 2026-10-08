import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unknownBasicUpdate, basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { hasPensionProfile, planningMode } from '../src/plan.ts';
test('P1: strict TS fixture and native JSON DTO are identical; unknown is not explicit zero',()=>{
 assert.deepEqual(unknownBasicUpdate,JSON.parse(fs.readFileSync(new URL('./fixtures/planning-basic/update.json',import.meta.url))));
 assert.equal(basicInputFixtures.unknown.basic.contribution.monthly_cents,null);
 assert.equal(basicInputFixtures.zero.basic.contribution.monthly_cents,'0');
});
test('P1: persisted basic inputs do not manufacture a complete pension profile or convert legacy on read',()=>{
 const p={birth_month:'1990-06',worker:null,region:null,paid_months:null,account_balance_cents:null,base_cents:null,flex_months:null,personal_pension_annual_cents:null,marginal_tax_hundredths:null,retire:{basic:unknownBasicUpdate.fields.basic}};
 assert.equal(hasPensionProfile(p),false); assert.equal(planningMode(p),'basic');
 assert.equal(planningMode({...p,retire:{}}),'none');
});
