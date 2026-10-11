import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unknownBasicUpdate, basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { planningMode } from '../src/plan.ts';
test('P1: strict TS fixture and native JSON DTO are identical; unknown is not explicit zero',()=>{
 assert.deepEqual(unknownBasicUpdate,JSON.parse(fs.readFileSync(new URL('./fixtures/planning-basic/update.json',import.meta.url))));
 assert.equal(basicInputFixtures.unknown.basic.contribution.monthly_cents,null);
 assert.equal(basicInputFixtures.zero.basic.contribution.monthly_cents,'0');
});
test('P1: current basic input has no policy facts and does not manufacture a configured plan',()=>{
 const p={retire:{basic:unknownBasicUpdate.fields.basic}};
 assert.equal('pension_contributions' in p.retire.basic,false); assert.equal(planningMode(p),'basic');
 assert.equal(planningMode({...p,retire:{}}),'none');
});
