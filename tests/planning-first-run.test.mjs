import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { setupDraft, setupFields, questionProgress, goalState, refinementCards } from '../src/planning-first-run.ts';
import { unknownCapabilityFixture } from '../src/plan-basic-fixtures.ts';
const savedOf = s => s.profile.value.saved;
test('first-run unanswered time and income remain unknown; fresh income defaults excluded without modifying storage',()=>{
 const s=fixture(), saved=savedOf(s); const before=structuredClone(saved);
 const d=setupDraft(null,null,false); assert.equal(d.simplified.income_mode,'excluded'); assert.equal(d.simplified.time.target_month,null); assert.equal(d.budget,'');
 assert.equal(goalState(null,null),'0'); assert.equal(questionProgress(null,null).remaining,4); assert.deepEqual(saved,before);
});
test('saved manual and unconfirmed income choices survive setup',()=>{
 for(const mode of ['manual','unconfirmed','excluded']){const s=fixture(),saved=savedOf(s);saved.profile.retire.simplified.income_mode=mode;assert.equal(setupDraft(saved,null,false).simplified.income_mode,mode);}
});
test('setup writes simplified with budget and funds in one transaction and preserves release facts',()=>{
 const s=fixture(),saved=savedOf(s),d=setupDraft(saved,s.snapshot.value,true);d.simplified.time.target_month='2055-03';d.budget='432100';
 const f=setupFields(d,saved,s.today,true);assert.equal(f.simplified.time.target_month,'2055-03');assert.equal(f.basic.spend_cents,'432100');assert.deepEqual(f.funds.releases,saved.profile.retire.core.releases);assert.equal('pension' in f,false);assert.equal('birth_month' in f.basic,false);
});
test('progress distinguishes completed choices from unknown time and income',()=>{
 const s=fixture(),saved=savedOf(s); const r=saved.profile.retire;r.simplified.time.target_month=null;r.simplified.income_mode='unconfirmed';
 const p=questionProgress(saved,unknownCapabilityFixture);assert.equal(p.answered[0],false);assert.equal(p.answered[3],false);assert.equal(p.first,0);
});
test('incomplete future income routes to the fourth question without policy refinements',()=>{
 const s=fixture(),saved=savedOf(s),caps=structuredClone(unknownCapabilityFixture);caps.requirement={status:'blocked',missing:[{code:'INCOME_UNCONFIRMED',field:'simplified.income_mode',message:'收入待确认',owner:'basic'}]};
 const cards=refinementCards(saved,caps,s.today);assert.ok(cards.some(c=>c.id==='income'&&c.step===3));assert.ok(!cards.some(c=>['pension','medical','contribution-cost'].includes(c.id)));
});
