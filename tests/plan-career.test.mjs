import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { savingsOf, startPaymentsOf, project, outcome } from '../src/plan-ledger.ts';
const profile = s => s.profile.value.saved.profile;
const r = s => profile(s).retire;
const check = (s = careerSources(), d = careerDraft()) => evaluateCareerScenario(s, d);
function requirement(x) { assert.equal(x.requirement.status, 'ready', JSON.stringify(x.requirement)); return x.requirement.value; }
function predicted(s, d) { const x = check(s, d); assert.equal(x.prediction.status, 'ready', JSON.stringify(x)); return x.prediction.value; }

test('C01/C02 full source-to-scenario path matches hand calculation and preserves inputs/basic', () => {
  const s = careerSources(), d = careerDraft(), frozen = structuredClone({s,d});
  const before = buildBasicCapabilities(s), x = check(s,d);
  assert.equal(requirement(x).monthly_cents, '464286');
  assert.equal(x.cash.value.minimum_cents, '102000000');
  assert.equal(x.prediction.status, 'blocked');
  d.recovery.monthly_cents = '464286'; assert.equal(predicted(s,d).outcome.success, true);
  d.recovery.monthly_cents = '464285'; assert.equal(predicted(s,d).outcome.success, false);
  d.recovery.monthly_cents = null;
  assert.deepEqual({s,d}, frozen);
  const after = buildBasicCapabilities(s);
  for (const key of ['context','funds','requirement','pension']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.prediction.value.projection, before.prediction.value.projection);
  assert.deepEqual(after.prediction.value.outcome, before.prediction.value.outcome);
});

test('C01 zero gap at start with unchanged conditions reproduces basic month ledger', () => {
  const s=careerSources(),d=careerDraft();d.transition_month='2026-09';d.gap_months=0;d.recovery.monthly_cents='1500000';
  const old=buildBasicCapabilities(s).prediction.value, next=predicted(s,d);
  assert.deepEqual(next.projection,old.projection);
  assert.deepEqual(next.outcome,old.outcome);
  assert.deepEqual(requirement(check(s,d)),buildBasicCapabilities(s).requirement.value.set);
});

test('C02 budget sensitivity does not silently lower retirement spending', () => {
  const s=careerSources(),d=careerDraft();r(s).spend_cents='1000000';
  assert.equal(requirement(check(s,d)).monthly_cents,'2250000');
  assert.equal(r(s).spend_cents,'1000000');
});

test('C04/C05 zero net gap income cannot fund an earlier payment', () => {
  const s=careerSources(),d=careerDraft();r(s).basic.start.available_cents='500000';
  d.transition_month='2026-10';d.gap_months=1;d.gap.income_cents='1000000';
  const x=check(s,d);assert.equal(x.cash.value.first_shortfall_month,'2026-10');
  assert.equal(x.cash.value.minimum_cents,'-500000');
  assert.equal(requirement(x).status,'prefix_payment_gap');
  d.recovery.monthly_cents='100000000';assert.equal(predicted(s,d).outcome.success,false);
});

test('C04 a temporary floor breach is not erased by month-end income', () => {
  const s=careerSources(),d=careerDraft();r(s).basic.start.available_cents='1500000';
  d.transition_month='2026-10';d.gap_months=1;d.gap.income_cents='1000000';d.floor_cents='800000';
  const x=check(s,d);assert.equal(x.cash.value.minimum_cents,'500000');
  assert.equal(x.cash.value.floor_month,'2026-10');assert.equal(requirement(x).status,'prefix_floor_breach');
});

test('C07 unknown recovery preserves local check and does not invent return to work', () => {
  const d=careerDraft();d.gap_months=null;d.check_until_month='2030-04';
  const x=check(careerSources(),d);assert.equal(x.cash.status,'ready');assert.equal(x.cash.value.until_month,'2030-04');
  assert.equal(x.requirement.status,'blocked');assert.equal(x.prediction.status,'blocked');
  d.check_until_month=null;assert.equal(check(careerSources(),d).cash.status,'blocked');
});

test('C07 unknown gap inputs/scopes never become zero; necessary expenses only stay partial', () => {
  for(const field of ['income_cents','spend_cents','costs','pension']) {
    const d=careerDraft();d.gap[field]=null;assert.equal(check(careerSources(),d).requirement.status,'blocked',field);
  }
  const d=careerDraft();d.gap.budget_scope='essential_only';const x=check(careerSources(),d);
  assert.equal(x.cash.status,'ready');assert.equal(x.requirement.status,'blocked');
  d.gap.budget_scope='complete';d.recovery.costs=null;
  assert.equal(check(careerSources(),d).cash.status,'ready');assert.equal(check(careerSources(),d).requirement.status,'blocked');
});

test('C07 current contribution is needed only for a nonempty earlier saving interval', () => {
  const s=careerSources(),d=careerDraft();r(s).basic.contribution.monthly_cents=null;
  assert.equal(check(s,d).requirement.status,'blocked');
  d.transition_month='2026-10';assert.equal(check(s,d).requirement.status,'ready');
});

test('C08 invalid dates/durations/amounts and recovery beyond goal remain explicit', () => {
  for (const value of ['2029-13','2029-00','wrong','2025-01','2044-10']) {const d=careerDraft();d.transition_month=value;assert.equal(check(careerSources(),d).requirement.status,'blocked',value);}
  for (const value of [-1,1.5,Infinity,1201]) {const d=careerDraft();d.gap_months=value;assert.equal(check(careerSources(),d).requirement.status,'blocked');}
  for(const value of ['','01','1.5','-0','-1','100000001']) {const d=careerDraft();d.gap.spend_cents=value;assert.equal(check(careerSources(),d).requirement.status,'blocked',value);}
  const d=careerDraft();d.gap_months=240;const x=check(careerSources(),d);
  assert.equal(requirement(x).status,'no_recovery_interval');assert.equal(x.cash.value.until_month,'2044-10');
});

test('C09 unavailable liquid funds only block cash checks; stale source cannot be reused', () => {
  const s=careerSources(),d=careerDraft();d.liquid_funds_confirmed=false;
  assert.equal(check(s,d).cash.status,'blocked');assert.equal(check(s,d).requirement.status,'ready');
  s.generation='other';assert.equal(check(s,d).requirement.status,'blocked');
  assert.equal(check(s,d).cash.status,'blocked');
});

function loanSources() {
  const s=careerSources(),ret=r(s);s.modules.wealth=true;ret.basic.start={kind:'live'};
  s.snapshot={status:'ready',value:{id:'snapshot',revision:2,date:'2026-09-30',missing:[],entries:[
    {account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:'60000000'},
    {account_id:'loan',counted:true,side:'liability',kind:'loan',amount_cents:'1200000'}]}};
  ret.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000}];
  ret.life_events=[{id:'e',label:'虚构已付款',kind:'other',date:'2026-01',included:false,price_cents:'1000000',down_cents:'1000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'0',rent_saved_cents:'0',cycle_years:null,until_age:null,resale_cents:'0'}];
  ret.core.occurrences=[{id:'o',event_id:'e',status:'occurred',actual_date:'2026-01-01',payments_complete:true,payments:[{id:'payment',date:'2026-01-01',amount_cents:'1000000',account_id:'cash',absorbed_snapshot_id:'snapshot',absorbed_revision:2,source_kind:null,source_id:null}],loan:{account_id:'loan',as_of:'2026-09-30',principal_cents:'1200000',remaining_months:12}}];
  ret.basic.contribution_costs=[{source_id:'event:e:loan',treatment:'included',reference_cents:'100000'}];
  ret.basic.retirement_costs=[{source_id:'event:e:loan',treatment:'extra',reference_cents:null}];
  return s;
}

test('C03 real-shaped paid facts, included monthly loan, end of loan and stage scope all flow through normalization', () => {
  const s=loanSources(),d=careerDraft();d.transition_month='2026-10';d.gap_months=6;
  d.gap.costs=structuredClone(r(s).basic.contribution_costs);d.recovery.costs=structuredClone(d.gap.costs);d.recovery.monthly_cents='500000';
  const x=check(s,d),v=predicted(s,d),saving=savingsOf(v.plan),due=startPaymentsOf(v.plan);
  assert.equal(v.plan.assets_cents,60000000);assert.equal(v.projection.assets[1],60000000);
  assert.equal(x.cash.value.minimum_cents,'54000000');
  assert.equal(saving[1],-1000000);assert.equal(due[1],1000000);
  assert.equal(saving[7],500000);assert.equal(saving[13],600000);
  assert.equal(v.plan.loans.length,1);
  d.gap.costs=[];const extra=check(s,d);assert.equal(extra.cash.status,'ready');assert.ok(extra.notes.some(s=>s.includes('暂按额外费用计入')));
});

test('C03 excessive/invalid/unknown included costs are rejected instead of creating income', () => {
  const s=loanSources(),d=careerDraft();d.gap.costs=[{source_id:'event:e:loan',treatment:'included',reference_cents:'2000000'}];
  d.recovery.costs=structuredClone(r(s).basic.contribution_costs);
  assert.equal(check(s,d).cash.status,'blocked');
  d.gap.costs[0].reference_cents='-100';assert.equal(check(s,d).cash.status,'blocked');
  d.gap.costs[0]={source_id:'event:e:loan',treatment:'excluded',reference_cents:null};assert.equal(check(s,d).cash.status,'blocked');
});

test('C03 dormant fee confirmations cannot create reference income in any stage', () => {
  const s=careerSources(),d=careerDraft(),before=check(s,d),basicBefore=buildBasicCapabilities(s);
  r(s).life_events=[{id:'dormant',label:'虚构停用费用',kind:'other',date:'2028-10',included:false,price_cents:'0',down_cents:'0',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'100000',rent_saved_cents:'0',cycle_years:null,until_age:null,resale_cents:'0'}];
  const scopes=[{source_id:'event:dormant:holding',treatment:'included',reference_cents:'100000'}];
  r(s).basic.contribution_costs=structuredClone(scopes);d.gap.costs=structuredClone(scopes);d.recovery.costs=structuredClone(scopes);
  const after=check(s,d);assert.deepEqual(after.cash,before.cash);assert.deepEqual(after.requirement,before.requirement);
  assert.deepEqual(buildBasicCapabilities(s).requirement,basicBefore.requirement);
});

function pensionSources() {
  const s=careerSources(),p=profile(s),ret=r(s);
  Object.assign(p,{worker:'male',region:'beijing',paid_months:200,account_balance_cents:'5000000',base_cents:'1000000',past_index_hundredths:100,flex_months:0,personal_pension_annual_cents:'0',marginal_tax_hundredths:0});
  p.assumptions.wage_growth_hundredths=0;ret.core.hpf_monthly_cents='100000';
  ret.basic.retirement_income={mode:'employee',selected:[]};
  ret.basic.pension_contributions={start_month:'2026-10',stop_month:'2030-10',base_cents:'1000000'};
  return s;
}

test('C06 pension pause recompiles eligibility/pools alongside explicit cash insurance, without altering historical facts', () => {
  const s=pensionSources(),d=careerDraft();d.recovery.monthly_cents='500000';
  d.gap.insurance={monthly_cents:'200000',included:false};
  const a=predicted(s,d),penA=a.plan.pension_at(a.plan.target_months);
  assert.equal(penA.eligible,true);assert.equal(savingsOf(a.plan)[37],-1200000);
  const snapshot=structuredClone(s);d.gap.pension='pause';d.gap.insurance.monthly_cents='0';
  const b=predicted(s,d),penB=b.plan.pension_at(b.plan.target_months);
  assert.equal(penB.eligible,false);assert.equal(penB.short_months,4);assert.equal(penB.monthly_cents,0);
  assert.ok(penB.lump_cents<penA.lump_cents);assert.equal(savingsOf(b.plan)[37],-1000000);
  assert.deepEqual(s,snapshot);
  d.recovery.monthly_cents='-100000';assert.deepEqual(predicted(s,d).plan.pension_at(600),penB);
});

test('C06 insurance included versus extra is counted once, not inferred from pension credits', () => {
  const s=careerSources(),d=careerDraft();d.recovery.monthly_cents='500000';d.gap.insurance={monthly_cents:'200000',included:true};
  const a=predicted(s,d);assert.equal(savingsOf(a.plan)[37],-1000000);assert.equal(startPaymentsOf(a.plan)[37],1000000);
  d.gap.insurance.included=false;const b=predicted(s,d);
  assert.equal(savingsOf(b.plan)[37],-1200000);assert.equal(startPaymentsOf(b.plan)[37],1200000);
  d.recovery.insurance={monthly_cents:'200000',included:true};assert.equal(savingsOf(predicted(s,d).plan)[49],500000);
  d.recovery.insurance.included=false;assert.equal(savingsOf(predicted(s,d).plan)[49],300000);
});

test('C06 invalid benefit base is not silently clamped to policy floor', () => {
  const d=careerDraft();d.gap.pension={base_cents:'1',hpf_monthly_cents:'0'};
  assert.equal(check(pensionSources(),d).requirement.status,'blocked');
  d.gap.pension={base_cents:'0',hpf_monthly_cents:'100000'};
  assert.equal(check(pensionSources(),d).requirement.status,'blocked');
});

test('C06 changed bases affect benefits, while an invalid recovery base only blocks later results', () => {
  const s=pensionSources(),d=careerDraft();d.recovery.monthly_cents='500000';
  const before=predicted(s,d).plan.pension_at(600);
  d.gap.pension={base_cents:'800000',hpf_monthly_cents:'50000'};
  const after=predicted(s,d).plan.pension_at(600);
  assert.equal(after.eligible,before.eligible);assert.ok(after.monthly_cents<before.monthly_cents);assert.ok(after.lump_cents<before.lump_cents);
  d.recovery.pension={base_cents:'1',hpf_monthly_cents:'0'};
  const x=check(s,d);assert.equal(x.cash.status,'ready');assert.equal(x.requirement.status,'blocked');assert.equal(x.prediction.status,'blocked');
});

test('C06 restricted accumulated benefits cannot cover an earlier gap payment', () => {
  const s=pensionSources(),d=careerDraft();r(s).basic.start.available_cents='500000';
  d.transition_month='2026-10';d.gap_months=1;d.gap.income_cents='1000000';d.recovery.monthly_cents='500000';
  const v=predicted(s,d);assert.ok(v.plan.pension_at(600).lump_cents>0);
  const x=check(s,d);assert.equal(x.cash.value.first_shortfall_month,'2026-10');assert.equal(requirement(x).status,'prefix_payment_gap');
});

test('C08 half first month uses the common basis and cash ordering', () => {
  const s=careerSources(),d=careerDraft();r(s).basic.start.date='2026-09-15';
  d.transition_month='2026-09';d.gap_months=1;d.recovery.monthly_cents='500000';
  const v=predicted(s,d);assert.equal(savingsOf(v.plan)[0],-500000);assert.equal(startPaymentsOf(v.plan)[0],500000);
  assert.equal(check(s,d).cash.value.minimum_cents,'59500000');
});

test('C08 nonzero inflation and real returns preserve candidate boundary and fixed retirement', () => {
  const s=careerSources(),d=careerDraft();profile(s).assumptions.inflation_hundredths=250;
  r(s).core.monetary_basis_date='2025-09-30';r(s).real_return_before_hundredths=100;r(s).real_return_after_hundredths=50;r(s).mode='fire';
  const req=requirement(check(s,d));assert.equal(req.status,'found');
  d.recovery.monthly_cents=req.monthly_cents;const v=predicted(s,d);
  assert.equal(v.outcome.success,true);assert.equal(v.projection.retire_month,600);
  d.recovery.monthly_cents=String(Number(req.monthly_cents)-1);assert.equal(predicted(s,d).outcome.success,false);
});

test('C05 first recovery-month known upfront obligation cannot use its candidate deposit', () => {
  const s=careerSources(),d=careerDraft();r(s).basic.start.available_cents='1000000';d.transition_month='2026-10';d.gap_months=1;d.gap.spend_cents='0';
  r(s).life_events=[{id:'bill',label:'虚构付款',kind:'other',date:'2026-11',included:true,price_cents:'2000000',down_cents:'2000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'0',rent_saved_cents:'0',cycle_years:null,until_age:null,resale_cents:'0'}];
  assert.equal(requirement(check(s,d)).status,'prefix_payment_gap');
});

import { compareCareerScenario } from '../src/plan-career-compare.ts';
test('C10 one-change comparison recomputes demand without changing facts or adopting candidates', () => {
  const s=careerSources(),d=careerDraft(),before=structuredClone({s,d});
  const x=compareCareerScenario(s,d,{kind:'gap',months:18});
  assert.equal(x.baseline.cash.value.until_month,'2030-10');assert.equal(x.alternative.cash.value.until_month,'2031-04');
  assert.ok(Number(x.requirement_delta_cents)>0);assert.deepEqual({s,d},before);
  const budget=compareCareerScenario(s,d,{kind:'budget',monthly_cents:'1000000'});
  assert.equal(budget.alternative.requirement.value.monthly_cents,'2250000');
  d.recovery.monthly_cents='600000';const income=compareCareerScenario(s,d,{kind:'recovery',monthly_cents:'300000'});
  assert.equal(income.requirement_delta_cents,'0');assert.ok(Number(income.goal_assets_delta_cents)<0);
  assert.equal(income.baseline.prediction.value.outcome.success,true);assert.equal(income.alternative.prediction.value.outcome.success,false);
});

test('C08 observer sees shared month-start payment and does not change results', () => {
  const s=careerSources(),d=careerDraft();d.recovery.monthly_cents='500000';
  const plan=predicted(s,d).plan,plain=project(plan,2026),points=[];
  const observed=project(plan,2026,{onMonth:p=>points.push(p)});
  assert.deepEqual(plain,observed);assert.equal(points.length,plan.horizon_months-plan.now_months);
  const firstGap=points.find(p=>p.month===420);assert.equal(firstGap.start_cents-firstGap.after_payments_cents,1000000);
});

test('C07 missing retirement-only budget/target/income does not block known gap cash', () => {
  for (const field of ['spend_cents','target_age','retirement_income']) {
    const s=careerSources(),d=careerDraft();
    if(field==='retirement_income')r(s).basic.retirement_income.mode=null;else r(s)[field]=null;
    const x=check(s,d);assert.equal(x.cash.status,'ready',field);assert.equal(x.cash.value.minimum_cents,'102000000');
    assert.equal(x.requirement.status,'blocked',field);
    if(field==='spend_cents')assert.equal(x.requirement.issues.filter(i=>i.field==='spend_cents').length,1);
  }
  const s=careerSources();r(s).basic.retirement_income.mode='employee';
  assert.equal(check(s).cash.status,'ready');assert.equal(check(s).requirement.status,'blocked');
});

import { resultText, comparisonText } from '../src/career-preview/result-text.ts';
test('C11 output wording keeps missing inputs, payment scope and zero positive contribution distinct', () => {
  const s=careerSources(),d=careerDraft();d.liquid_funds_confirmed=false;
  assert.match(resultText(check(s,d)).cash,/未确认/);assert.doesNotMatch(resultText(check(s,d)).cash,/未出现资金不足/);
  r(s).basic.start.available_cents='900000000';assert.equal(resultText(check(s,d)).requirement,'无需新增正投入');
  d.gap_months=null;d.check_until_month='2030-10';assert.match(resultText(check(s,d)).requirement,/恢复时间未知/);
});

test('C11 recovery comparison explains unchanged demand without suggesting unchanged assets', () => {
  const s=careerSources(),d=careerDraft();
  const unknown=comparisonText(compareCareerScenario(s,d,{kind:'recovery',monthly_cents:'300000'}));
  assert.match(unknown.headline,/先填两组“每月能攒多少”/);assert.doesNotMatch(unknown.headline,/不变|¥0/);
  d.recovery.monthly_cents='600000';
  const known=comparisonText(compareCareerScenario(s,d,{kind:'recovery',monthly_cents:'300000'}));
  assert.equal(known.headline,'目标时点资产减少 ¥504,000');assert.match(known.detail,/每月至少要攒多少”不变/);
  assert.equal(comparisonText(compareCareerScenario(s,d,{kind:'gap',months:18})).headline,'每月至少要攒的钱增加 ¥542.33');
});
