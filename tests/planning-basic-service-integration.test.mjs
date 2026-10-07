import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { draftOf, basicInput, budgetInput, fundsInput, retirementSources } from '../src/planning-basic-forms.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
import { readCapabilities } from '../src/planning-basic-port.ts';
import { submit, storedPending, pendingKey, Unresolved } from '../src/wealth.ts';
const today='2026-10-07';
const ready=value=>({status:'ready',value});
const unavailable={status:'error',value:{code:'DISABLED',message:'虚构来源关闭'}};
const blank=()=>({generation:'fictional',today,write_version:0,modules:{planning:true,wealth:false},profile:ready({generation:'fictional',saved:null}),snapshot:unavailable,accounts:unavailable,review:unavailable,incomes:unavailable});
const fill=()=>({...draftOf(null,null,today),birth:'1990-06-01',infl:'0',target:'60',budget:'400000',start:'simulation',simAmount:'10000000',simDate:'2026-09-30',incomeMode:'manual',incomeItems:[{id:'annuity',label:'虚构年金',monthly_cents:'100000',start_age:60,end_age:null,indexed:true}],picks:{annuity:{on:true,role:'other'}}});
test('production provider computes a fresh unsaved manual-income draft without writing sources or contribution',()=>{
 const source=blank(), d=fill(), base=basicInput(d,null,today);
 const budget=budgetInput(d,overlayPlanningDrafts(source,[base]).profile.value.saved.profile.retire);
 const before=structuredClone(source);
 const result=readCapabilities(source,{drafts:[budget,base]});
 assert.equal(result.status,'ready');assert.equal(result.caps.requirement.status,'ready');
 assert.equal(result.caps.requirement.value.set.monthly_cents,String(Math.ceil((300000*360-10000000)/284)));
 assert.equal(result.caps.prediction.status,'blocked');assert.deepEqual(source,before);
 const trial=readCapabilities(source,{drafts:[budget,base],contribution:'0'});
 assert.equal(trial.caps.prediction.value.source,'temporary');assert.deepEqual(source,before);
});
test('editing contribution or simulated funds retains unavailable-account rules and event cost scopes',()=>{
 const source=overlayPlanningDrafts(blank(),[basicInput(fill(),null,today)]);
 const saved=source.profile.value.saved,r=saved.profile.retire;
 r.core.fund_rules=[{account_id:'hidden-account',availability:'available',share_hundredths:5000}];
 r.life_events=[{id:'car',label:'虚构车',kind:'car',date:'2027-01',included:true,price_cents:'100000',down_cents:'100000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'10000',rent_saved_cents:'0',cycle_years:null,until_age:null,resale_cents:'0'}];
 r.basic.contribution_costs=[{source_id:'event:car:holding',treatment:'extra',reference_cents:null}];
 r.basic.retirement_costs=[{source_id:'event:car:holding',treatment:'included',reference_cents:'10000'}];
 const d=draftOf(saved,null,today);d.contribution='100';
 assert.deepEqual(fundsInput(d,saved,today).fields.fund_rules,r.core.fund_rules);
 assert.deepEqual(basicInput(d,saved,today).fields.basic.retirement_costs,r.basic.retirement_costs);
 assert.ok(retirementSources(r).some(s=>s.id==='event:car:holding'));
});
test('a new planning save cannot overwrite an unresolved receipt from a closed editor',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const existing={command:'plan_profile_update',input:{request_id:'first',generation:'fictional'},label:'虚构待核对'};
 localStorage.setItem(pendingKey,JSON.stringify(existing));
 await assert.rejects(submit({...existing,input:{...existing.input,request_id:'second'}}),Unresolved);
 assert.deepEqual(storedPending(),existing);delete globalThis.localStorage;
});

test('basic FIRE searches the selected horizon instead of silently keeping the legacy age-70 cap',()=>{
 const d={...fill(),mode:'fire',target:'80',budget:'600000',simAmount:'0',incomeMode:'excluded',incomeItems:[],picks:{},contribution:'200000'};
 const result=readCapabilities(overlayPlanningDrafts(blank(),[basicInput(d,null,today)]));
 assert.equal(result.status,'ready');
 const p=result.caps.prediction.value;
 assert.equal(p.plan.search_cap_months,p.plan.horizon_months);
 assert.ok(p.projection.fi_month>70*12);
 assert.equal(p.outcome.funded_at_goal,true);
 assert.equal(p.outcome.success,true);
});
