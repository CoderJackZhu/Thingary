import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
test('funds editor preserves unknown release amount and exposes only generic controls',async()=>{
 const sources=fixture(),saved=sources.profile.value.saved;const r=runtime('PlanningFunds',{sources,saved,snapshot:sources.snapshot.value,accounts:sources.accounts.value});r.button('添加释放安排').props.onClick();r.render();assert.equal(r.find('CentInput',p=>p.label==='预计可用净额').props.value,'');assert.equal(r.find('input',p=>p.type==='checkbox'&&p.checked===false).props.checked,false);r.find('form').props.onSubmit({preventDefault(){}});await r.settle();assert.equal(r.calls.length,1);assert.equal(r.calls[0].fields.releases.at(-1).net_cents,null);assert.equal(r.calls[0].fields.releases.at(-1).excludes_future_deposits,false);
});
test('release arrange can be removed without changing factual account balance',()=>{const sources=fixture(),saved=sources.profile.value.saved,original=structuredClone(sources.snapshot);const r=runtime('PlanningFunds',{sources,saved,snapshot:sources.snapshot.value,accounts:sources.accounts.value});r.button('添加释放安排').props.onClick();r.render();r.button('删除释放安排').props.onClick();r.render();assert.ok(!r.find('CentInput',p=>p.label==='预计可用净额'));assert.deepEqual(sources.snapshot,original);});
test('goal result shows month timeline and generic income instead of policy estimates',()=>{const sources=fixture();const r=runtime('planning-goal/Overview',{saved:sources.profile.value.saved,caps:buildBasicCapabilities(sources),today:sources.today,cards:[],onEdit(){},onRefine(){},onDetail(){}});const text=r.text(r.find('div'));assert.match(text,/未来固定收入/);assert.doesNotMatch(text,/退休医保|自己缴社保/);});
