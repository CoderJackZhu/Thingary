import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import { basicFields, goalInput } from '../src/planning-goal/inputs.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
const stored=s=>s.profile.value.saved;
const submit=async r=>{r.find('form').props.onSubmit({preventDefault(){}});await r.settle();};
test('birth and age edits save the existing time contract and reopen without changing other partitions', async () => {
 const s=fixture(),saved=stored(s),original=structuredClone(saved);
 const r=runtime('planning-goal/Editor',{kind:'time',sources:s,saved});
 r.find('MonthInput',p=>p.label==='出生年月').props.onChange('1990-06');r.render();
 r.find('input',p=>p['aria-label']==='退休年龄（岁）').props.onChange({target:{value:'60'}});r.render();
 r.find('input',p=>p['aria-label']==='规划终点年龄（岁）').props.onChange({target:{value:'90'}});r.render();
 await submit(r);assert.equal(r.calls.length,1);assert.equal(r.calls[0].section,'simplified');
 assert.deepEqual(r.calls[0].fields.time,{reference:{month:'1990-06',age_months:0},target_month:'2050-06',horizon_month:'2080-06'});
 const after=stored(overlayPlanningDrafts(s,r.calls));
 assert.deepEqual(after.profile.retire.basic,original.profile.retire.basic);assert.deepEqual(saved,original);
 const reopened=runtime('planning-goal/Editor',{kind:'time',sources:overlayPlanningDrafts(s,r.calls),saved:after});
 assert.equal(reopened.find('MonthInput',p=>p.label==='出生年月').props.value,'1990-06');
 assert.equal(reopened.find('input',p=>p['aria-label']==='退休年龄（岁）').props.value,'60');
 assert.equal(reopened.find('input',p=>p['aria-label']==='规划终点年龄（岁）').props.value,'90');
});
test('time-only edit preserves basic settings and every future income field',()=>{
 const s=fixture(),saved=stored(s),original=structuredClone(saved),simple=structuredClone(saved.profile.retire.simplified);simple.time.target_month='2055-12';const input=goalInput('time',saved,basicFields(saved),simple);assert.equal(input.section,'simplified');const after=stored(overlayPlanningDrafts(s,[input]));assert.deepEqual(after.profile.retire.basic,saved.profile.retire.basic);assert.deepEqual(after.profile.retire.simplified.future_incomes,simple.future_incomes);assert.deepEqual(saved,original);
});
test('spend, saving, start and assumption edits preserve unrelated fields',()=>{
 const saved=stored(fixture()),base=basicFields(saved);for(const kind of ['spend','saving','start','assumptions']){const draft=structuredClone(base);draft.spend_cents='765432';draft.basic.contribution.monthly_cents='123456';const input=goalInput(kind,saved,draft);assert.equal(input.section,'basic');assert.equal(input.fields.spend_cents,kind==='spend'?'765432':base.spend_cents);assert.equal(input.fields.basic.contribution.monthly_cents,kind==='saving'?'123456':base.basic.contribution.monthly_cents);}
});
for(const outcome of ['saved','failed','unknown'])test(`single saving editor: ${outcome} preserves draft and freezes uncertain replay`,async()=>{
 const s=fixture();stored(s).profile.retire.basic.contribution.monthly_cents=null;let r;r=runtime('planning-goal/Editor',{kind:'saving',sources:s,saved:stored(s)},async()=>{if(outcome==='failed')throw Error('虚构保存失败');if(outcome==='unknown'){r.saver.stuck=true;return null;}return {revision:9};});
 r.find('GoalMoneyInput').props.onChange('520025');r.render();await submit(r);assert.equal(r.calls.length,1);assert.equal(r.calls[0].fields.basic.contribution.monthly_cents,'520025');assert.equal(r.closes.length,outcome==='saved'?1:0);if(outcome==='unknown'){await submit(r);assert.equal(r.calls.length,1);assert.equal(r.button('保存并更新结果').props.disabled,true);}if(outcome==='failed')assert.equal(r.find('GoalMoneyInput').props.value,'520025');
});
test('money controls retain integer cents and signed withdrawals',()=>{for(const [value,signed,step,expected] of [['520025',false,10000,'530025'],['-20000',true,10000,'-10000'],['',false,1000000,'1000000']]){let result;const r=runtime('planning-goal/MoneyInput',{value,signed,step,label:'虚构金额',onChange:v=>result=v});r.button(`虚构金额增加${step/100}元`).props.onClick();assert.equal(result,expected);}});
