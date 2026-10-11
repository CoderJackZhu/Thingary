import test from 'node:test';
import assert from 'node:assert/strict';
import { beijing, noOverrides, paramsFor, benefitBaseFor, pensionReferenceIssue } from '../src/plan-params.ts';
import { project } from '../src/plan-pension.ts';
import { pensionFormOf, pensionInput } from '../src/planning-basic-forms.ts';
import { fictionalSources as basicFixture } from './helpers/planning-fixtures.mjs';
const p = {birth_month:'1990-01',worker:'male',flex_months:0,paid_months:240,account_balance_cents:'1000000',base_cents:'1000000',past_index_hundredths:100,personal_pension_annual_cents:'0',marginal_tax_hundredths:0,assumptions:{inflation_hundredths:0,wage_growth_hundredths:0,pp_return_hundredths:0}};
const funds={hpf_balance_cents:'0',hpf_monthly_cents:'0'};
const calc=r=>project(p,r,'2052-01-01',756,funds);
const base={cents:'1204900',year:2025,source:'Fictional dated condition'};

test('separate benefit base changes only the base benefit, not contributions, account, pools or wage limits',()=>{
 const a=paramsFor({region:'beijing',overrides:noOverrides},'2052-01-01');
 const b=paramsFor({region:'beijing',overrides:{...noOverrides,benefit_base:base}},'2052-01-01');
 assert.equal(b.avg_wage_cents,a.avg_wage_cents);assert.equal(b.base_lower_cents,a.base_lower_cents);assert.equal(b.base_upper_cents,a.base_upper_cents);
 const x=calc(a),y=calc(b);assert.notEqual(x.base_pension_nominal_cents,y.base_pension_nominal_cents);
 for(const k of ['total_paid_months','account_at_start_cents','account_pension_nominal_cents','hpf_at_start_cents','personal_pension_at_start_cents','eligible'])assert.equal(x[k],y[k],k);
 const {base_pension_nominal_cents: bx}=calc({...b,benefit_base:{...base,cents:'2409800'}});assert.ok(Math.abs(bx-2*y.base_pension_nominal_cents)<=1);
});
test('benefit applicable year is not wage statistical year; legacy output and inference stay compatible',()=>{
 const old=calc(beijing),compat=calc(paramsFor({region:'beijing',overrides:noOverrides},'2052-01-01'));assert.deepEqual(compat,old);
 assert.equal(benefitBaseFor(beijing).separate,false);assert.equal(benefitBaseFor(beijing).year,2026);
 const profile={...p,assumptions:{...p.assumptions,wage_growth_hundredths:200}};
 const r={...beijing,benefit_base:{...base,year:2052},avg_wage_year:1900};
 const x=project(profile,r,'2053-01-01',756,funds),y=project(profile,{...r,benefit_base:{...base,year:2053}},'2053-01-01',756,funds);
 assert.ok(Math.abs(x.base_pension_nominal_cents-y.base_pension_nominal_cents*1.02)<=1);
 const z=project(profile,{...r,benefit_base:{...base,year:2054}},'2053-01-01',756,funds);assert.ok(Math.abs(z.base_pension_nominal_cents*1.02-y.base_pension_nominal_cents)<=1);
});
test('custom wage year/source and benefit reference stay independent through form save/reopen/clear',()=>{
 const s=basicFixture(); const saved=s.profile.value.saved;
 saved.profile.region='custom'; saved.profile.overrides={...noOverrides,avg_wage_cents:'1000000',avg_wage_year:2023,avg_wage_source:'Fictional wage',benefit_base:base};
 const f=pensionFormOf(saved),fields=pensionInput(f).fields;assert.deepEqual(fields.overrides,saved.profile.overrides);
 const r=paramsFor({region:'custom',overrides:fields.overrides},'2026-10-12');assert.equal(r.avg_wage_year,2023);assert.equal(r.base_lower_cents,'600000');assert.equal(r.benefit_base.cents,'1204900');
 const clear=pensionInput({...f,benefitCents:'',benefitYear:'',benefitSource:''}).fields.overrides;assert.equal(clear.benefit_base,undefined);assert.equal(clear.avg_wage_year,2023);
 const legacy={...saved,profile:{...saved.profile,overrides:noOverrides}};assert.deepEqual(pensionInput(pensionFormOf(legacy)).fields.overrides,noOverrides);
});
test('partial or invalid references fail rather than infer missing years/sources or accept zero',()=>{
 for(const b of [{...base,cents:'0'},{...base,cents:'01'},{...base,cents:1204900},{...base,cents:'100000000000'},{...base,year:0},{...base,year:2025.5},{...base,source:' '},{...base,source:'x'.repeat(501)}]) assert.ok(pensionReferenceIssue({...noOverrides,benefit_base:b}));
 assert.ok(pensionReferenceIssue({...noOverrides,avg_wage_year:2025}));assert.ok(pensionReferenceIssue({...noOverrides,avg_wage_source:'source'}));
 const f=pensionFormOf(basicFixture().profile.value.saved);assert.throws(()=>pensionInput({...f,benefitCents:'1204900',benefitYear:'',benefitSource:'test'}));assert.throws(()=>pensionInput({...f,benefitCents:'1204900',benefitYear:'2025',benefitSource:''}));
});
