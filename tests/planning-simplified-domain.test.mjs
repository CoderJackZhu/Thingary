import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBasicCapabilities} from '../src/plan-basic.ts';
import {simplifiedReadFromSourcesV1,resolveSimplifiedReceiptV1} from '../src/planning-simplified-port.ts';
import {required, requiredAt, table, project, outcome} from '../src/plan-ledger.ts';
import {monteCarlo, stressTests} from '../src/plan-risk.ts';
import {simplifiedSources,fictionalFutureIncome} from './helpers/simplified-planning-fixtures.mjs';
const r=s=>s.profile.value.saved.profile.retire;
const pred=s=>{const c=buildBasicCapabilities(s);assert.equal(c.prediction.status,'ready',JSON.stringify(c));return c.prediction.value;};
test('calendar-only demand remains independent of unknown contribution and history',()=>{
 const s=simplifiedSources(); const c=buildBasicCapabilities(s);assert.equal(c.requirement.status,'ready');assert.equal(c.requirement.value.set.monthly_cents,'1500');assert.equal(c.prediction.status,'blocked');assert.equal(c.prediction.missing.at(-1).code,'CONTRIBUTION_UNKNOWN');assert.equal(s.profile.value.saved.profile.birth_month,undefined);
});
test('unconfirmed vs excluded vs incomplete manual income; failed read never looks empty',()=>{
 const s=simplifiedSources('0');r(s).simplified.income_mode='unconfirmed';assert.equal(buildBasicCapabilities(s).requirement.status,'blocked');assert.ok(simplifiedReadFromSourcesV1(s).reset_reasons.includes('income_unconfirmed'));
 r(s).simplified.income_mode='manual';r(s).simplified.future_incomes=[fictionalFutureIncome({monthly_cents:null})];let c=buildBasicCapabilities(s);assert.equal(c.requirement.status,'ready');assert.equal(c.annotations.find(a=>a.reason_code==='INCOME_INCOMPLETE').source_ids[0],'fictional-income');
 s.profile={status:'error',value:{code:'READ',message:'fictional read failure'}};assert.throws(()=>simplifiedReadFromSourcesV1(s),/fictional read failure/);
});
test('ordinary income before/after work target and inclusive end uses one ledger',()=>{
 const s=simplifiedSources('0');r(s).simplified.income_mode='manual';r(s).simplified.future_incomes=[fictionalFutureIncome({start_month:'2026-11',end_month:'2027-01'})];const p=pred(s).plan;const t=table(p);assert.deepEqual(Array.from(t.income).slice(0,5),[0,100,100,100,0]);assert.equal(project(p,2026).rows[0].income,300);
});
test('same explicit flow keeps backwards requirement, yearly analysis and fixed-seed market paths equivalent',async()=>{
 const s=simplifiedSources('2000');r(s).simplified.income_mode='manual';r(s).simplified.future_incomes=[fictionalFutureIncome({})];const p=pred(s).plan;
 const equivalent={...p,future_incomes:[],incomes:[{id:'fictional-income',label:'虚构租金',monthly_cents:100,start_age:3/12,end_age:null,indexed:true}]};
 assert.deepEqual(table(p),table(equivalent));assert.deepEqual(project(p,2026),project(equivalent,2026));
 for(let m=0;m<p.horizon_months;m++)assert.ok(Math.abs(required(p,m)-requiredAt(p)[m])<1e-7);
 assert.deepEqual(await monteCarlo(p,50,{seed:1234}),await monteCarlo(equivalent,50,{seed:1234}));
 assert.ok(stressTests(p,2026).length>0);assert.equal(outcome(p,project(p,2026)).success,true);
});
test('explicit restricted transfer once, no default tax, no future-deposit creation',()=>{
 const s=simplifiedSources('0');s.modules.wealth=true;r(s).basic.start={kind:'live'};
 s.snapshot.value={id:'fictional-snapshot',revision:1,date:'2026-10-31',missing:[],entries:[{account_id:'fictional-cash',kind:'cash',side:'asset',counted:true,amount_cents:'10000'},{account_id:'fictional-pension-account',kind:'investment',side:'asset',counted:true,amount_cents:'5000'}]};
 r(s).core.fund_rules=[{account_id:'fictional-cash',availability:'available',share_hundredths:10000},{account_id:'fictional-pension-account',availability:'restricted',share_hundredths:10000}];
 r(s).core.releases=[{id:'fictional-release',account_id:'fictional-pension-account',month:'2027-02',net_cents:'5000',estimated:false,excludes_future_deposits:true}];
 const before=structuredClone(s),p=pred(s).plan,projection=project(p,2026);assert.equal(projection.rows.reduce((n,x)=>n+x.unlock,0),5000);assert.equal(p.assets_cents,10000);assert.deepEqual(s,before);
 r(s).core.releases[0].excludes_future_deposits=false;assert.equal(pred(s).plan.transfers.length,0);assert.ok(buildBasicCapabilities(s).annotations.some(a=>a.reason_code==='TRANSFER_PENDING'));
});

test('saved-but-unreadable sources retain the original request until receipt and generation are verified',async()=>{
 const context={request_id:'fictional-original-request',generation:'fictional-simplified',expected_revision:1};let cleared=0;
 const driver={lookup:async()=> 'profile',read:async()=>{throw new Error('虚构读取失败')},clear:()=>cleared++};
 assert.deepEqual(await resolveSimplifiedReceiptV1(context,driver),{status:'unresolved',request_id:context.request_id});assert.equal(cleared,0);
 driver.read=async()=>({...simplifiedReadFromSourcesV1(simplifiedSources()),revision:2});assert.deepEqual(await resolveSimplifiedReceiptV1(context,driver),{status:'saved',revision:2});assert.equal(cleared,1);
 driver.read=async()=>({...simplifiedReadFromSourcesV1(simplifiedSources()),generation:'another'});assert.equal((await resolveSimplifiedReceiptV1(context,driver)).status,'unresolved');assert.equal(cleared,1);
});
test('restricted nominal release is repriced in inflation stress and invalid double-release is blocked',()=>{
 const s=simplifiedSources('0');s.modules.wealth=true;r(s).basic.start={kind:'live'};s.snapshot.value={id:'fictional',revision:1,date:'2026-10-31',missing:[],entries:[{account_id:'cash',kind:'cash',side:'asset',counted:true,amount_cents:'10000'},{account_id:'restricted',kind:'housing_fund',side:'asset',counted:true,amount_cents:'5000'}]};r(s).core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000},{account_id:'restricted',availability:'restricted',share_hundredths:10000}];r(s).core.releases=[{id:'release',account_id:'restricted',month:'2027-10',net_cents:'5000',estimated:false,excludes_future_deposits:true}];
 const p=pred(s).plan;assert.equal(project(p,2026).rows[1].unlock,5000);assert.ok(project({...p,inflation_hundredths:1000},2026).rows[1].unlock<5000);
 r(s).core.releases.push({...r(s).core.releases[0],id:'twice'});assert.equal(buildBasicCapabilities(s).prediction.status,'blocked');
});

test('failed live-funds read remains a read error, not a reset or empty balance',()=>{
 const s=simplifiedSources('0');s.modules.wealth=true;r(s).basic.start={kind:'live'};
 s.snapshot={status:'error',value:{code:'FICTIONAL_READ',message:'虚构盘点读取失败'}};
 const read=simplifiedReadFromSourcesV1(s);assert.equal(read.capabilities.funds.status,'blocked');
 assert.equal(read.capabilities.funds.missing[0].kind,'read_error');assert.ok(!read.reset_reasons.includes('funds_unconfirmed'));
});
