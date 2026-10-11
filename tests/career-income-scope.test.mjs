import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { incomeDraft, prepareIncomeScope } from '../src/career-preview/income-scope.ts';
import { previewAnswers } from '../src/career-preview/answers.ts';
import { referenceCareer } from './helpers/career-reference.mjs';
import { fictionalFutureIncome } from './helpers/simplified-planning-fixtures.mjs';
const change={kind:'gap',months:18};
const manual=()=>({mode:'manual',items:[fictionalFutureIncome({role:'pension',monthly_cents:'100000',start_month:'2057-10',basis:'reference_month',basis_month:'2026-09',growth:'constant_purchasing_power'})]});
test('unconfirmed saved income requires an explicit temporary choice; no source is changed',()=>{
 const s=careerSources(),d=careerDraft();s.profile.value.saved.profile.retire.simplified.income_mode='unconfirmed';const before=structuredClone({s,d});
 assert.equal(previewAnswers(s,d,'switch',change).status,'income_blocked');
 assert.equal(previewAnswers(s,d,'switch',change,{...incomeDraft(s),mode:'excluded'}).status,'ready');
 assert.deepEqual({s,d},before);
});
test('manual future income and excluded mode match the independent monthly oracle',()=>{
 const s=careerSources(),d=careerDraft();d.recovery.monthly_cents='600000';
 for(const [scope,amount] of [[manual(),100000],[{mode:'excluded',items:manual().items},0]]){
  const r=previewAnswers(s,d,'switch',change,scope).comparison.baseline,ref=referenceCareer({pension:amount});
  assert.equal(Math.round(r.prediction.value.outcome.required_at_goal),Math.round(ref.required));
  assert.equal(Math.round(r.prediction.value.outcome.assets_at_goal),Math.round(ref.assets));
  for(const row of ref.retirementRows)assert.ok(Math.abs(r.prediction.value.projection.assets[218+row.k]-row.end)<.02);
 }
});
test('selection belongs to stable income IDs and included flags; excluded records survive',()=>{
 const s=careerSources(),scope=manual(),original=structuredClone(s);
 scope.items.push({...scope.items[0],id:'annuity',name:'虚构年金',included:false,monthly_cents:'50000'});
 const r=prepareIncomeScope(s,careerDraft(),scope);assert.equal(r.status,'ready');
 assert.equal(r.sources.profile.value.saved.profile.retire.simplified.future_incomes.length,2);
 const excluded=prepareIncomeScope(s,careerDraft(),{...scope,mode:'excluded'});
 assert.equal(excluded.sources.profile.value.saved.profile.retire.simplified.future_incomes.length,2);
 assert.deepEqual(s,original);
});
test('invalid income fields block long-term scope while confirmed local cash remains available',()=>{
 const s=careerSources(),d=careerDraft();
 for(const changeIncome of [x=>x.monthly_cents='-1',x=>x.end_month='2020-01',x=>x.basis_month=null]){
  const scope=manual();changeIncome(scope.items[0]);const r=previewAnswers(s,d,'switch',change,scope);
  assert.equal(r.status,'income_blocked');assert.equal(r.cash.status,'ready');assert.equal('comparison' in r,false);
 }
 const scope=manual();scope.items[0].monthly_cents=null;
 const r=previewAnswers(s,d,'switch',change,scope);assert.equal(r.status,'ready');
 assert.ok(r.comparison.baseline.annotations.some(x=>x.reason_code==='INCOME_INCOMPLETE'));
});
test('unknown recovery cash expenses are never assumed to be zero; the local gap can still be checked',()=>{
 const s=careerSources(),d=careerDraft();d.recovery.insurance.monthly_cents=null;
 const r=previewAnswers(s,d,'switch',change);assert.equal(r.comparison.baseline.cash.status,'ready');assert.equal(r.comparison.baseline.requirement.status,'blocked');
 d.recovery.insurance.monthly_cents='0';assert.equal(previewAnswers(s,d,'switch',change).comparison.baseline.requirement.status,'ready');
});
test('a stale library identity cannot be unlocked by a temporary income choice',()=>{
 const s=careerSources();s.profile.value.generation='old-source';
 const r=previewAnswers(s,careerDraft(),'switch',change,manual());assert.equal(r.status,'source_blocked');assert.equal(r.cash,null);
});
test('temporary pool exclusion removes only release arrangements and retains real balances',()=>{
 const s=careerSources(),r=s.profile.value.saved.profile.retire;s.modules.wealth=true;r.basic.start={kind:'live'};
 s.snapshot={status:'ready',value:{id:'s',revision:1,date:'2026-09-30',missing:[],entries:[{account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:'60000000'},{account_id:'hpf',counted:true,side:'asset',kind:'housing_fund',amount_cents:'6000000'}]}};
 r.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000},{account_id:'hpf',availability:'restricted',share_hundredths:10000}];
 r.core.releases=[{id:'release',account_id:'hpf',month:'2030-01',net_cents:'6000000',estimated:false,excludes_future_deposits:true}];const before=structuredClone(s);
 const scoped=prepareIncomeScope(s,careerDraft(),{mode:'excluded',items:[],excludePools:true});
 assert.equal(scoped.status,'ready');assert.equal(scoped.sources.profile.value.saved.profile.retire.core.releases.length,0);
 assert.deepEqual(scoped.sources.snapshot,s.snapshot);assert.deepEqual(scoped.sources.profile.value.saved.profile.retire.core.fund_rules,r.core.fund_rules);assert.deepEqual(s,before);
});
