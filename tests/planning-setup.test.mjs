import test from 'node:test';
import assert from 'node:assert/strict';
import { finishSetup, setupCore } from '../src/planning-setup.ts';
import { profileFromForm, toForm } from '../src/planning-profile.ts';
import { defaultRetire, computeReview } from '../src/plan.ts';
import { normalizeFunds } from '../src/plan-core.ts';
const date = '2026-10-07';
const snapshot = { id:'s',revision:2,date,missing:[],entries:[{account_id:'fake-cash',kind:'cash',side:'asset',counted:true,amount_cents:'70000000'}, {account_id:'fake-hpf',kind:'housing_fund',side:'asset',counted:true,amount_cents:'12345'}] };
const occurrence = { id:'o',event_id:'e',status:'occurred',actual_date:'2026-09-01',payments_complete:true,payments:[{id:'p',date:'2026-09-01',amount_cents:'30000000',account_id:'fake-cash',absorbed_snapshot_id:'s',absorbed_revision:2,source_kind:'expense',source_id:'fake-expense'}],loan:null };
const r = { ...defaultRetire, route_id:'soe', target_age:60,spend_cents:'100000', life_events:[{id:'e',label:'虚构已购',included:false,price_cents:'30000000',down_cents:'30000000',holding_cents:'0'}],core:{contract_version:1,monetary_basis_date:'2026-09-01',fund_rules:[],hpf_monthly_cents:'0',occurrences:[occurrence],costs:[]} };
const phases = [{id:'phase',label:'明确假设',from_age_months:0,monthly:'200000'}];
test('guided setup is a draft: preserves original profile, accounts and paid-event facts', () => {
 const original=structuredClone({r,snapshot});
 const core=setupCore(r,snapshot,date);
 const finished=finishSetup(r,core,phases,'0',430);
 assert.deepEqual({r,snapshot},original);
 assert.equal(finished.route_id,null);
 assert.equal(finished.setup_completed,true);
 assert.deepEqual(finished.core.occurrences,original.r.core.occurrences);
 assert.deepEqual(finished.life_events,original.r.life_events);
 assert.equal(finished.core.monetary_basis_date,'2026-09-01');
 assert.equal(normalizeFunds(snapshot,finished.core).net,70012345);
 assert.equal(normalizeFunds(snapshot,finished.core).available,70000000);
});
test('unknown future contributions never become zero; explicit zero and negative phases are retained', () => {
 const c=setupCore(r,snapshot,date);
 assert.throws(()=>finishSetup(r,c,[{...phases[0],monthly:''}],'0',430),/未知/);
 assert.throws(()=>finishSetup(r,{...c,hpf_monthly_cents:null},phases,'0',430),/公积金/);
 const zero=finishSetup(r,c,[{...phases[0],monthly:'0'}],'0',430);
 assert.equal(zero.saving_phases[0].monthly_cents,0);
 const negative=finishSetup(r,c,[{...phases[0],monthly:'-12345'}],'0',430);
 assert.equal(negative.saving_phases[0].monthly_cents,-12345);
});
test('guided goal validation matches persisted age and positive living-budget constraints', () => {
 const c=setupCore(r,snapshot,date);
 assert.throws(()=>finishSetup({...r,target_age:18},c,phases,'0',180),/20 岁/);
 assert.throws(()=>finishSetup({...r,spend_cents:'0'},c,phases,'0',430),/大于 0/);
});
test('cost inclusion stays explicit and existing reference amounts survive editing stages', () => {
 const event={...r.life_events[0],holding_cents:'10000'};
 const withCosts={...r,life_events:[event]}; const c=setupCore(withCosts,snapshot,date);
 assert.throws(()=>finishSetup(withCosts,c,phases,'0',430),/是否已含/);
 const costs=[{phase_id:'phase',source_id:'event:e:holding',included:true,reference_cents:'10000'},{phase_id:'removed',source_id:'event:e:holding',included:false,reference_cents:'0'}];
 const result=finishSetup(withCosts,{...c,costs},phases,'0',430);
 assert.deepEqual(result.core.costs,[costs[0]]);
 assert.deepEqual(result.core.occurrences,[occurrence]);
});
test('human-readable missing funds aggregate account count without identifiers', () => {
 const s={...snapshot,entries:Array.from({length:10},(_,i)=>({...snapshot.entries[0],account_id:`private-uuid-${i}`}))};
 const result=normalizeFunds(s);
 assert.equal(result.missing.length,1);assert.match(result.missing[0],/10 个账户/);assert.doesNotMatch(result.missing[0],/private-uuid/);
});
test('new personal profile refuses unknown pension facts, while existing factual fields round-trip', () => {
 const empty=toForm(null); assert.equal(empty.balance,''); assert.equal(empty.paid,'');
 assert.throws(()=>profileFromForm({...empty,birth:'1990-06-01'},null,date),/累计缴费月数/);
 const p={birth_month:'1990-06',worker:'male',region:'beijing',paid_months:48,account_balance_cents:'123456',base_cents:'2000000',past_index_hundredths:123,flex_months:0,personal_pension_annual_cents:'0',marginal_tax_hundredths:1000,assumptions:{inflation_hundredths:200,wage_growth_hundredths:300,pp_return_hundredths:200},overrides:{avg_wage_cents:null,base_lower_cents:null,base_upper_cents:null,notional_rate_hundredths:null,hpf_rate_hundredths:null},retire:r};
 assert.deepEqual(profileFromForm(toForm(p),p,date),p);
});
test('planning changes never change historical asset delta or recorded income totals', () => {
 const points=[{snapshot_id:'a',date:'2026-09-01',complete:true,compared_to:null,net_cents:'70000000',scope_changed:false,change_cents:null,hpf_change_cents:null},{snapshot_id:'b',date,complete:true,compared_to:'2026-09-01',net_cents:'80000000',scope_changed:false,change_cents:'10000000',hpf_change_cents:'0'}];
 const incomes=[{id:'fake-income',fields:{date:'2026-09-20',net_cents:'200000',hpf_cents:'0'}}];
 const before=computeReview(points,incomes,new Set(),'fake');
 finishSetup(r,setupCore(r,snapshot,date),phases,'0',430);
 assert.deepEqual(computeReview(points,incomes,new Set(),'fake'),before);
 assert.equal(before.intervals[0].delta_nw_cents,'10000000'); assert.equal(before.intervals[0].income_cents,'200000');
});
