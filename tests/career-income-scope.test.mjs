import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { careerPensionSources } from '../src/career-preview/pension-fixture.ts';
import { incomeDraft, prepareIncomeScope } from '../src/career-preview/income-scope.ts';
import { previewAnswers } from '../src/career-preview/pension-check.ts';
import { referenceCareer } from './helpers/career-reference.mjs';

const change = { kind: 'gap', months: 18 };
const source = () => {
  const s = careerPensionSources(); s.profile.value.saved.profile.retire.core.hpf_monthly_cents = '0';
  return s;
};
const manual = s => ({ ...incomeDraft(s), mode: 'manual', selected: ['manual'], items: [
  { id: 'manual', label: '虚构手填收入', monthly_cents: '100000', start_age: 63, end_age: null, indexed: true },
] });

test('Beijing stays blocked until an explicit temporary income choice; source is unchanged', () => {
  const s = source(), d = careerDraft(), before = structuredClone({s,d});
  assert.equal(previewAnswers(s,d,'switch',change).status,'policy_blocked');
  const r = previewAnswers(s,d,'switch',change,{...incomeDraft(s),mode:'excluded'});
  assert.equal(r.status,'ready'); assert.equal(r.comparison.baseline.requirement.status,'ready');
  assert.deepEqual({s,d},before);
  assert.equal(previewAnswers(s,d,'switch',change,incomeDraft(s)).status,'policy_blocked');
});

test('manual amount is external; base changes do not change it, cash payments still do', () => {
  const s=source(), d=careerDraft(); d.recovery.monthly_cents='600000';
  const scope=manual(s), before=structuredClone({s,d,scope});
  const a=previewAnswers(s,d,'switch',change,scope).comparison.baseline;
  d.gap.pension={base_cents:'727000',hpf_monthly_cents:'0'};
  const b=previewAnswers(s,d,'switch',change,scope).comparison.baseline;
  assert.deepEqual(a.requirement,b.requirement);
  assert.deepEqual(a.prediction.value.projection,b.prediction.value.projection);
  d.gap.insurance={monthly_cents:'210000',included:false};
  const c=previewAnswers(s,d,'switch',change,scope).comparison.baseline;
  assert.ok(Number(c.requirement.value.monthly_cents)>Number(a.requirement.value.monthly_cents));
  assert.equal(c.prediction.value.plan.incomes[0].monthly_cents,100000);
  assert.deepEqual(s,before.s); assert.deepEqual(scope,before.scope);
});

test('manual and excluded paths agree with independent monthly oracle and closed-form requirements', () => {
  const s=source(),d=careerDraft();d.recovery.monthly_cents='600000';
  for(const [scope, amount] of [[manual(s),100000],[{...incomeDraft(s),mode:'excluded'},0]]) {
    const r=previewAnswers(s,d,'switch',change,scope).comparison.baseline;
    const ref=referenceCareer({pension:amount});
    assert.equal(Math.round(r.prediction.value.outcome.required_at_goal),Math.round(ref.required));
    assert.equal(Math.round(r.prediction.value.outcome.assets_at_goal),Math.round(ref.assets));
    assert.equal(r.requirement.value.monthly_cents,String(Math.ceil((ref.required-102000000)/168)));
    for(const row of ref.retirementRows) {
      assert.ok(Math.abs(r.prediction.value.projection.assets[217+row.k]-row.start)<.02);
      assert.ok(Math.abs(r.prediction.value.projection.assets[218+row.k]-row.end)<.02);
    }
  }
});

test('income selection uses stable IDs, never counts unselected items or erases source records', () => {
  const s=source(),scope=manual(s);
  scope.items.push({...scope.items[0],id:'annuity',label:'年金',monthly_cents:'50000'});
  scope.selected=['annuity'];
  const r=prepareIncomeScope(s,careerDraft(),scope);
  assert.equal(r.status,'ready');
  assert.deepEqual(r.sources.profile.value.saved.profile.retire.basic.retirement_income.selected.map(x=>x.id),['annuity']);
  assert.equal(r.sources.profile.value.saved.profile.retire.income_items.length,2);
  const excluded=prepareIncomeScope(s,careerDraft(),{...scope,mode:'excluded'});
  assert.equal(excluded.sources.profile.value.saved.profile.retire.basic.retirement_income.selected.length,0);
});

test('manual income dates, end boundaries and nominal purchasing power agree with an independent schedule', () => {
  const s=source(),d=careerDraft(),p=s.profile.value.saved.profile;
  p.retire.real_return_before_hundredths=200;p.retire.real_return_after_hundredths=100;
  p.retire.spend_cents='500000';
  p.assumptions.inflation_hundredths=300;
  d.recovery.monthly_cents='600000';d.gap.insurance={monthly_cents:'210000',included:false};
  const scope={mode:'manual',selected:['bridge','nominal','late','outside'],items:[
    {id:'bridge',label:'退休前已开始的定期收入',monthly_cents:'150000',start_age:48,end_age:55,indexed:true},
    {id:'nominal',label:'固定名义年金',monthly_cents:'100000',start_age:63,end_age:70,indexed:false},
    {id:'late',label:'后期购买力收入',monthly_cents:'50000',start_age:80,end_age:null,indexed:true},
    {id:'outside',label:'终点之后收入',monthly_cents:'900000',start_age:91,end_age:null,indexed:true},
  ]};
  const before=structuredClone({s,d,scope});
  const options={beforeRate:.02,afterRate:.01,inflation:.03,gapInsurance:210000,retirementSpend:500000,retirementIncomes:[
    {monthly:150000,start:-24,end:60,indexed:true},
    {monthly:100000,start:156,end:240,indexed:false},
    {monthly:50000,start:360,end:null,indexed:true},
    {monthly:900000,start:492,end:null,indexed:true},
  ]};
  const r=previewAnswers(s,d,'switch',change,scope).comparison.baseline,ref=referenceCareer(options);
  assert.equal(r.requirement.status,'ready');assert.equal(r.prediction.status,'ready');
  assert.ok(Math.abs(r.prediction.value.outcome.assets_at_goal-ref.assets)<.02);
  assert.ok(Math.abs(r.prediction.value.outcome.required_at_goal-ref.required)<.02);
  for(const row of ref.retirementRows) {
    assert.ok(Math.abs(r.prediction.value.projection.assets[217+row.k]-row.start)<.02,`start month ${row.k}`);
    assert.ok(Math.abs(r.prediction.value.projection.assets[218+row.k]-row.end)<.02,`end month ${row.k}`);
  }
  const required=Number(r.requirement.value.monthly_cents);
  assert.ok(required>0);
  assert.equal(referenceCareer({...options,recovery:required}).meets,true);
  assert.equal(referenceCareer({...options,recovery:required-1}).meets,false);
  assert.deepEqual({s,d,scope},before);
});

test('missing or malformed manual inputs withdraw long-term answer, not known local cash', () => {
  const s=source(),d=careerDraft();
  for(const mutate of [x=>x.selected=[],x=>x.items[0].monthly_cents='',x=>x.items[0].start_age=null,x=>x.items[0].end_age=62,x=>x.selected=['missing'],x=>x.items[0].monthly_cents='-1']) {
    const scope=manual(s);mutate(scope);
    const r=previewAnswers(s,d,'switch',change,scope);
    assert.equal(r.status,'income_blocked');assert.equal('comparison' in r,false);
    assert.equal(r.cash.status,'ready');
  }
  s.profile.value.saved.profile.retire.spend_cents=null;
  const r=previewAnswers(s,d,'switch',change,{...incomeDraft(s),mode:'excluded'});
  assert.equal(r.comparison.baseline.cash.status,'ready');
  assert.equal(r.comparison.baseline.requirement.status,'blocked');
});

test('unknown recovery saving can be solved, but never assumed for searches; missing recovery insurance keeps local cash', () => {
  const s=careerSources(),d=careerDraft();d.recovery.pension=null;d.recovery.insurance.monthly_cents=null;
  const r=previewAnswers(s,d,'switch',change);
  assert.equal(r.comparison.baseline.cash.status,'ready');assert.equal(r.comparison.baseline.requirement.status,'blocked');
  d.recovery.insurance.monthly_cents='0';
  const a=previewAnswers(s,d,'switch',change);
  assert.equal(a.comparison.baseline.requirement.status,'ready');assert.equal(a.comparison.baseline.prediction.status,'blocked');
  assert.equal(previewAnswers(s,d,'rest',change).rest.status,'blocked');
});

test('all estimator-dependent pools remain blocked even after choosing excluded or manual income', () => {
  const s=source(),d=careerDraft();
  for(const mutate of [p=>p.retire.core.hpf_monthly_cents='100',p=>p.personal_pension_annual_cents='100',p=>p.retire.core.personal_pension_account_id='restricted',p=>{d.gap.pension={base_cents:'1000000',hpf_monthly_cents:'100'};}]) {
    const copy=structuredClone(s);mutate(copy.profile.value.saved.profile);
    for(const scope of [manual(copy),{...incomeDraft(copy),mode:'excluded'}]) {
      const r=previewAnswers(copy,d,'switch',change,scope);
      assert.equal(r.status,'pool_blocked');assert.equal('comparison' in r,false);assert.equal(r.cash,null);
    }
  }
  const live=source();live.profile.value.saved.profile.retire.basic.start={kind:'live'};
  live.modules.wealth=true;live.snapshot={status:'ready',value:{entries:[{kind:'housing_fund',counted:true,side:'asset',amount_cents:'100000'}]}};
  assert.equal(previewAnswers(live,careerDraft(),'switch',change,{...incomeDraft(live),mode:'excluded'}).status,'pool_blocked');
});

test('manual cash inclusion is deducted once and zero gap does not require gap cash', () => {
  const s=source(), d=careerDraft(), scope=manual(s);
  d.recovery.monthly_cents='600000';
  const baseline=previewAnswers(s,d,'switch',change,scope).comparison.baseline;
  d.gap.insurance={monthly_cents:'210000',included:true};
  const included=previewAnswers(s,d,'switch',change,scope).comparison.baseline;
  assert.deepEqual(included.requirement,baseline.requirement);
  assert.equal(included.prediction.value.outcome.assets_at_goal,baseline.prediction.value.outcome.assets_at_goal);
  d.gap_months=0;d.gap.insurance.monthly_cents=null;
  assert.equal(previewAnswers(s,d,'switch',change,scope).comparison.baseline.requirement.status,'ready');
});

test('stale source identity cannot be unlocked by an explicit manual choice', () => {
  const s=source(),before=structuredClone(s);s.profile.value.generation='old-source';
  const r=previewAnswers(s,careerDraft(),'switch',change,manual(before));
  assert.equal(r.status,'source_blocked');assert.equal(r.cash,null);assert.equal('comparison' in r,false);
});

test('an already explicitly excluded housing account stays recorded without triggering a pool projection', () => {
  const s=source(),p=s.profile.value.saved.profile;
  s.modules.wealth=true;p.retire.basic.start={kind:'live'};
  p.retire.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000},{account_id:'hpf',availability:'excluded',share_hundredths:10000}];
  s.snapshot={status:'ready',value:{id:'scope-snapshot',revision:1,date:'2026-09-30',missing:[],entries:[
    {account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:'60000000'},
    {account_id:'hpf',counted:true,side:'asset',kind:'housing_fund',amount_cents:'100000'},
  ]}};
  const before=structuredClone(s);
  const r=previewAnswers(s,careerDraft(),'switch',change,{...incomeDraft(s),mode:'excluded'});
  assert.equal(r.status,'ready');assert.equal(r.comparison.baseline.requirement.status,'ready');assert.deepEqual(s,before);
});

test('restricted pools: blocked by default, ignored only on an explicit temporary choice, nothing in the source changes', () => {
  const s = careerPensionSources(), d = careerDraft(); d.recovery.monthly_cents = '600000';
  s.profile.value.saved.profile.personal_pension_annual_cents = '1200000';
  const before = structuredClone({ s, d });
  assert.equal(previewAnswers(s, d, 'switch', change, { ...incomeDraft(s), mode: 'excluded' }).status, 'pool_blocked');
  const scope = { ...incomeDraft(s), mode: 'excluded', excludePools: true };
  const r = previewAnswers(s, d, 'switch', change, scope);
  assert.equal(r.status, 'ready'); assert.equal(r.comparison.baseline.requirement.status, 'ready');
  const prepared = prepareIncomeScope(s, d, scope);
  const core = prepared.sources.profile.value.saved.profile.retire.core;
  assert.equal(core.hpf_monthly_cents, '0'); assert.equal(prepared.sources.profile.value.saved.profile.personal_pension_annual_cents, '0');
  assert.deepEqual({ s, d }, before, 'the saved facts are untouched');
  // it is the same answer as the no-pool sample with the same income choice: pools are simply left out
  const plain = careerSources(); const q = previewAnswers(plain, d, 'switch', change, { ...incomeDraft(plain), mode: 'excluded' });
  assert.equal(r.comparison.baseline.requirement.value.monthly_cents, q.comparison.baseline.requirement.value.monthly_cents);
});

test('a counted housing fund in a live snapshot is blocked by default and excluded (not deleted, not spendable) on the explicit choice', () => {
  const s = careerSources(), p = s.profile.value.saved.profile, b = p.retire.basic;
  s.modules.wealth = true;
  s.snapshot = { status: 'ready', value: { id: 'snap', revision: 1, date: '2026-09-30', missing: [], entries: [
    { account_id: 'cash1', kind: 'cash', side: 'asset', counted: true, amount_cents: '60000000' },
    { account_id: 'hf1', kind: 'housing_fund', side: 'asset', counted: true, amount_cents: '6000000' }] } };
  b.start = { kind: 'live' }; p.retire.core.fund_rules = [{ account_id: 'cash1', availability: 'available', share_hundredths: 10000 }];
  const d = careerDraft(), before = structuredClone(s);
  assert.equal(prepareIncomeScope(s, d, { ...incomeDraft(s), mode: 'excluded' }).status, 'pool_blocked');
  const ok = prepareIncomeScope(s, d, { ...incomeDraft(s), mode: 'excluded', excludePools: true });
  assert.equal(ok.status, 'ready');
  assert.deepEqual(ok.sources.profile.value.saved.profile.retire.core.fund_rules.find(x => x.account_id === 'hf1'), { account_id: 'hf1', availability: 'excluded', share_hundredths: 0 });
  assert.deepEqual(s, before);
  assert.equal(ok.sources.snapshot.value.entries.length, 2, 'the account entry is still there');
});
