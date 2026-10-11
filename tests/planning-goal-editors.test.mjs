import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtime } from './planning-component-runtime.mjs';
import { completionFixture } from '../src/planning-completion-fixture.ts';
import { basicFields, medicalFields, goalInput } from '../src/planning-goal/inputs.ts';
import { contributionCostInput, contributionScheduleInput } from '../src/planning-contribution-cost.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
const batch = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url)));
const fixture = () => completionFixture(batch, 'contribution');
const stored = s => s.profile.value.saved;
const submit = async r => { r.find('form').props.onSubmit({preventDefault(){}}); await r.settle(); };

test('scoped goal edits retain unrelated unknowns, identifiers, FIRE mode and policy provenance', () => {
  const saved=stored(fixture());
  saved.profile.flex_months=null; saved.profile.overrides.avg_wage_source='虚构核对来源'; saved.profile.retire.mode='fire';
  const original=structuredClone(saved), base=basicFields(saved), med=medicalFields(saved);
  const edits={time:['birth_month','target_age','horizon_age','mode'],spend:['spend_cents'],saving:['basic'],start:['basic'],assumptions:['real_return_before_hundredths','real_return_after_hundredths','inflation_hundredths']};
  for(const [kind,keys] of Object.entries(edits)){
    const draft=structuredClone(base); draft.spend_cents='765432'; draft.target_age=65; draft.mode='traditional'; draft.basic.contribution.monthly_cents='123456'; draft.real_return_before_hundredths=200; draft.basic.start={kind:'simulation',id:'fictional-start',available_cents:'456789',date:'2026-10-12',notes:'虚构'};
    const input=goalInput(kind,saved,draft,med), untouched=structuredClone(input.fields), expected=structuredClone(base);
    for(const key of keys){delete untouched[key];delete expected[key];}
    assert.deepEqual(untouched,expected);
    if(kind==='saving')assert.deepEqual(input.fields.basic,{...base.basic,contribution:{...base.basic.contribution,monthly_cents:'123456'}});
    if(kind==='start')assert.deepEqual(input.fields.basic,{...base.basic,start:draft.basic.start});
    const applied=stored(overlayPlanningDrafts(fixtureWith(saved),[input]));
    assert.deepEqual(applied.profile.overrides,saved.profile.overrides); assert.equal(applied.profile.flex_months,null);
  }
  const changed={...med,paid_months:999,flex_months:12,medical_paid_months:15,medical_local_paid_months:15,medical_local_required_months:60};
  const input=goalInput('medical',saved,base,changed);
  assert.deepEqual(input.fields,{...med,medical_paid_months:15,medical_local_paid_months:15,medical_local_required_months:60});
  assert.deepEqual(saved,original);
});
function fixtureWith(saved){const s=fixture();s.profile.value.saved=structuredClone(saved);return s;}

test('medical editor refuses impossible local totals and fractional months without saving', async()=>{
  const s=fixture(),r=runtime('planning-goal/Editor',{kind:'medical',sources:s,saved:stored(s)});
  for(const [label,value] of [['职工医保累计缴费月数','15'],['其中在北京实际缴费月数','16']]){r.find('input',p=>p['aria-label']===label).props.onChange({target:{value}});r.render();}
  await submit(r);assert.equal(r.calls.length,0);assert.match(r.text(r.find('dialog')),/本地实际缴费不能多于累计/);
  r.find('input',p=>p['aria-label']==='其中在北京实际缴费月数').props.onChange({target:{value:'1.5'}});r.render();await submit(r);assert.equal(r.calls.length,0);assert.match(r.text(r.find('dialog')),/整数/);
});

for(const outcome of ['saved','failed','unknown'])test(`single saving editor: ${outcome} uses one request and preserves null / edited draft`,async()=>{
  const s=fixture(); let r;
  r=runtime('planning-goal/Editor',{kind:'saving',sources:s,saved:stored(s)},async input=>{
    if(outcome==='failed')throw Error('虚构保存失败');
    if(outcome==='unknown'){r.saver.stuck=true;return null;}
    return stored(overlayPlanningDrafts(s,[input]));
  });
  const money=r.find('GoalMoneyInput'); assert.equal(money.props.value,'');
  if(outcome!=='saved'){money.props.onChange('520025');r.render();}
  await submit(r);assert.equal(r.calls.length,1);assert.equal(r.calls[0].fields.basic.contribution.monthly_cents,outcome==='saved'?null:'520025');
  assert.equal(r.closes.length,outcome==='saved'?1:0);
  if(outcome==='failed'){assert.match(r.text(r.find('dialog')),/虚构保存失败/);assert.equal(r.find('GoalMoneyInput').props.value,'520025');}
  if(outcome==='unknown'){assert.equal(r.button('保存并更新结果').props.disabled,true);assert.equal(r.button('取消').props.disabled,false);await submit(r);assert.equal(r.calls.length,1);}
});

test('money controls use meaningful yuan steps while retaining cents and signed withdrawals',()=>{
  for(const [value,signed,step,expected] of [['520025',false,10000,'530025'],['-20000',true,10000,'-10000'],['',false,1000000,'1000000']]){
    let result;const r=runtime('planning-goal/MoneyInput',{value,signed,step,label:'虚构金额',onChange:v=>result=v});
    r.button(`虚构金额增加${step/100}元`).props.onClick();assert.equal(result,expected);
  }
});

test('cost-only save preserves pension stop; explicit schedule choice changes cost and stop atomically',()=>{
  const saved=stored(fixture()); saved.profile.retire.basic.pension_contributions.start_month='2026-10'; const before=structuredClone(saved);
  const d={treatment:'extra',monthly:'200000',stop:'2053-07'};
  const cost=contributionScheduleInput(d,saved,false);assert.deepEqual(cost,contributionCostInput(d,saved));
  assert.deepEqual(cost.fields.basic.pension_contributions,saved.profile.retire.basic.pension_contributions);
  const both=contributionScheduleInput(d,saved,true);assert.equal(both.section,'basic');assert.equal(both.fields.basic.pension_contributions.stop_month,d.stop);assert.equal(both.fields.basic.retirement_contribution_cost.stop_month,d.stop);
  assert.deepEqual({...both.fields.basic.pension_contributions,stop_month:saved.profile.retire.basic.pension_contributions.stop_month},saved.profile.retire.basic.pension_contributions);
  assert.throws(()=>contributionScheduleInput({...d,stop:''},saved,true),/最后缴费月份/);
  assert.deepEqual(saved,before);
});

test('completed medical facts with only future dates missing route to contribution schedule',()=>{
  const s=fixture(),p=stored(s).profile;
  Object.assign(p,{worker:'male',region:'beijing',birth_month:'1990-06',flex_months:0,medical_paid_months:15,medical_local_paid_months:15,medical_local_required_months:60});
  p.retire.target_age=60; p.retire.basic.pension_contributions.start_month=null; p.retire.basic.pension_contributions.stop_month=null;
  let destination;
  const r=runtime('planning-goal/Overview',{saved:stored(s),caps:{funds:{status:'ready',value:{available_cents:'0',restricted_cents:'0',date:s.today}},pension:{status:'blocked'},requirement:{status:'blocked',missing:[]},annotations:[]},today:s.today,cards:[],onEdit:v=>destination=v});
  r.button('补充未来缴费安排').props.onClick({currentTarget:{}});assert.equal(destination,'contributions');
  assert.match(r.text(r.render()),/已缴累计 15 个月，本地 15 个月/);
});

test('ready goal amount remains adjacent to all affecting annotation messages',()=>{
  const s=fixture(), messages=['尚未安排的费用可能低估需求','重复费用可能高估需求','虚构未知条件'];
  const annotations=messages.map((message,i)=>({id:`fictional-${i}`,message,effect:['requirement_lower','requirement_higher','uncertain'][i]}));
  annotations.push({id:'unrelated',effect:'none',message:'无金额影响'});
  const r=runtime('planning-goal/Overview',{saved:stored(s),caps:{funds:{status:'ready',value:{available_cents:'0',restricted_cents:'0',date:s.today}},pension:{status:'blocked'},requirement:{status:'ready',value:{set:{status:'found',monthly_cents:'500000'}}},annotations},today:s.today,cards:[]});
  const result=r.text(r.find('article',p=>p['aria-label']==='退休目标'));
  for(const message of messages)assert.ok(result.includes(message));
  assert.match(result,/当前暂算结果/);assert.ok(!result.includes('无金额影响'));
});
