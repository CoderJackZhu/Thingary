import test from 'node:test';
import assert from 'node:assert/strict';
import {savingsOf,nominalFactor} from '../src/plan-ledger.ts';
import {readFileSync} from 'node:fs';
import {runtime} from './pension-runtime.mjs';
import {pensionFixture} from '../src/planning-pension-fixture.ts';
import {setupDraft,setupFields,refinementCards} from '../src/planning-first-run.ts';
import {pensionRefinementFields,comparePensionRefinement,withPensionRefinement} from '../src/planning-pension-refinement.ts';
import {overlayPlanningDrafts} from '../src/planning-draft.ts';
import {buildBasicCapabilities,prepareBasicPlan} from '../src/plan-basic.ts';
const raw=JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json',import.meta.url),'utf8'));
const fixture=(s='normal')=>pensionFixture(raw,s), saved=s=>s.profile.value.saved;
const caps=s=>buildBasicCapabilities(s), cards=s=>refinementCards(saved(s),caps(s),s.today);
const event=()=>({preventDefault(){}}), next=r=>{r.button('下一步').props.onClick?.();if(!r.button('下一步').props.onClick) r.nodes().filter(n=>n.type==='form').at(-1).props.onSubmit(event());r.render();};
const select=(r,label,value)=>{const n=r.find('select',p=>p['aria-label']===label);assert.ok(n,label);n.props.onChange({target:{value}});r.render();};
const choose=(r,label)=>{const n=r.find('input',p=>p['aria-label']===label);assert.ok(n,label);n.props.onChange();r.render();};
const value=(r,type,label,v)=>{const n=r.find(type,p=>p.label===label||p['aria-label']===label);assert.ok(n,label);n.props.onChange(type==='input'?{target:{value:v}}:v);r.render();};
const submit=async r=>{r.nodes().filter(n=>n.type==='form').at(-1).props.onSubmit(event());await r.settle();};
const contrib=r=>{select(r,'以后还继续交社保吗','continue');value(r,'MonthInput','未来缴费开始月份','2026-10');value(r,'MonthInput','未来缴费停止月份','2050-06');value(r,'CentInput','未来月缴费基数','2000000');value(r,'CentInput','未来公积金每月缴存','0');};
function editor(initial,props={}){let s=initial,comparison;const r=runtime('PlanningPensionRefinement',{sources:s,onSaved:c=>comparison=c,...props},async input=>{s=overlayPlanningDrafts(s,[input]);return saved(s);});return {r,get source(){return s;},get comparison(){return comparison;}};}
function route(s,id){const r=runtime('PlanningBasicGoals',{sources:s,onGoto(){throw Error('must open shared dialog, never navigate');}},undefined,()=>caps(s));const card=r.find('article',p=>p['data-refinement']===id);assert.ok(card,id);
 const cardNodes=[];const collect=n=>{if(Array.isArray(n))n.forEach(collect);else if(n&&typeof n==='object'){cardNodes.push(n);collect(n.props?.children);}};collect(card);cardNodes.find(n=>n.type==='button').props.onClick({currentTarget:{isConnected:true,focus(){}}});r.render();assert.ok(r.find('dialog',p=>p['aria-labelledby']==='pension-refinement-heading'));return r;}

test('算上国家养老金 closes after real dialog save, skips complete facts and recalculates summary with comparison',async()=>{
 const s=fixture(),e=editor(s),r=e.r;route(s,'pension');choose(r,'北京养老金估算');next(r);contrib(r);next(r);assert.match(r.text(r.find('h2')),/确认/);assert.equal(r.find('input',p=>p['aria-label']==='累计缴费月数'),undefined);await submit(r);
 assert.equal(r.calls.length,1);assert.deepEqual(r.closes,[undefined]);assert.equal(cards(e.source).some(c=>c.id==='pension'),false);assert.notEqual(caps(s).requirement.value.set.monthly_cents,caps(e.source).requirement.value.set.monthly_cents);assert.deepEqual(e.comparison.after,caps(e.source).requirement.value.set);assert.equal(r.calls[0].fields.pension,null);assert.deepEqual(saved(e.source).profile.overrides,saved(s).profile.overrides);
 const goal=runtime('PlanningBasicGoals',{sources:e.source,comparison:e.comparison},undefined,caps(e.source));assert.match(goal.text(goal.find('aside')),/纳入北京估算及本次缴费安排.*→/);
});

test('核对北京养老金资料 opens shared dialog, asks only missing fields, closes hard blocker and recomputes',async()=>{
 const s=fixture('unknown');route(s,'pension');const e=editor(s),r=e.r;next(r);contrib(r);next(r);assert.match(r.text(r.find('h2')),/社保资料/);assert.equal(r.find('CentInput',p=>p.label==='个人账户余额'),undefined);assert.equal(r.find('input',p=>p['aria-label']==='工资增长率'),undefined);
 select(r,'性别与职工类型','male');value(r,'input','累计缴费月数','48');next(r);await submit(r);assert.equal(caps(e.source).requirement.status,'ready');assert.ok(!cards(e.source).some(c=>['pension','income-switch'].includes(c.id)));assert.match(e.comparison.reason,/原结果暂不可计算/);assert.equal(e.comparison.after.status,'found');assert.equal(saved(e.source).profile.account_balance_cents,saved(s).profile.account_balance_cents);
});

test('核对未来缴存安排 reduces real pending count, adds cash transfer only once and shows comparison',async()=>{
 const s=fixture('transfer');assert.ok(cards(s).some(c=>c.id==='transfer'));route(s,'transfer');const e=editor(s),r=e.r;next(r);contrib(r);next(r);await submit(r);assert.ok(!cards(e.source).some(c=>c.id==='transfer'));assert.equal(caps(e.source).annotations.some(a=>a.reason_code==='TRANSFER_PENDING'),false);assert.equal(caps(e.source).requirement.status,'ready');assert.ok(e.comparison.after);
 const prep=prepareBasicPlan(e.source);assert.equal(prep.plan.status,'ready');const p=prep.plan.value.compile(100000,prep.plan.value.before,prep.plan.value.after);assert.ok(p); const without=structuredClone(e.source); saved(without).profile.personal_pension_annual_cents='0'; saved(without).profile.retire.basic.contribution_costs=[]; saved(without).profile.retire.basic.retirement_costs=[]; const noTransfer=prepareBasicPlan(without); assert.equal(noTransfer.plan.status,'ready'); const q=noTransfer.plan.value.compile(100000,noTransfer.plan.value.before,noTransfer.plan.value.after); assert.equal(p.saving_flows.filter(f=>f.source_id==='personal_pension').length,1); const a=savingsOf(p),b=savingsOf(q); for(let month=1;month<=12;month++)assert.ok(Math.abs(b[month]-a[month]-100000/nominalFactor(p,p.now_months+month))<1e-7);
 assert.equal(saved(e.source).profile.retire.income_items.length,0);assert.equal(saved(e.source).profile.personal_pension_annual_cents,'1200000');
});

test('Q4 国家养老金 uses same dialog; nested cancel discards changes, completion stays memory, final setup saves once',async()=>{
 let s=fixture(),comparison;const r=runtime('PlanningSetup',{sources:s,snapshot:s.snapshot.value,accounts:s.accounts.value,initialStep:3,onComparison:c=>comparison=c},async input=>{s=overlayPlanningDrafts(s,[input]);return saved(s);});r.button('现在添加').props.onClick();r.render();assert.ok(r.find('dialog',p=>p['aria-labelledby']==='pension-refinement-heading'));choose(r,'北京养老金估算');r.button('关闭国家养老金精修').props.onClick();r.render();assert.equal(r.calls.length,0);assert.equal(r.find('input',p=>p['aria-label']==='先不算（推荐先这样）').props.checked,true);
 r.button('现在添加').props.onClick();r.render();choose(r,'北京养老金估算');next(r);contrib(r);next(r);await submit(r);assert.equal(r.calls.length,0);assert.equal(saved(s).profile.retire.basic.retirement_income.mode,'excluded');assert.ok(r.button('核对国家养老金'));await submit(r);assert.equal(r.calls.length,1);assert.equal(r.calls[0].section,'setup');assert.equal(saved(s).profile.retire.basic.retirement_income.mode,'beijing');assert.ok(!cards(s).some(c=>c.id==='pension'));assert.ok(comparison.before&&comparison.after);
});

test('Beijing skips keep null and block calculation; 改选先不算 resolves gate without erasing saved facts',async()=>{
 const s=fixture('unknown');const e=editor(s),r=e.r;for(let i=0;i<3;i++){r.button('跳过这一步').props.onClick();r.render();}await submit(r);assert.equal(saved(e.source).profile.retire.basic.retirement_income.mode,'beijing');assert.equal(saved(e.source).profile.worker,null);assert.equal(saved(e.source).profile.paid_months,null);assert.deepEqual(saved(e.source).profile.retire.basic.pension_contributions,{start_month:null,stop_month:null,base_cents:null});assert.equal(saved(e.source).profile.retire.core.hpf_monthly_cents,null);assert.equal(caps(e.source).requirement.status,'blocked');assert.equal(e.comparison.after,null);route(e.source,'income-switch');
 const exit=editor(e.source); for(let i=0;i<3;i++){exit.r.button('跳过这一步').props.onClick();exit.r.render();}exit.r.button('改选先不算').props.onClick();exit.r.render();next(exit.r);await submit(exit.r);assert.equal(caps(exit.source).requirement.status,'ready');assert.equal(cards(exit.source).find(c=>c.id==='pension').condition,true);assert.equal(cards(exit.source).find(c=>c.id==='pension').required,false);assert.ok(!cards(exit.source).some(c=>c.id==='income-switch'));assert.equal(saved(exit.source).profile.worker,null);assert.ok(exit.comparison.after);
});

test('manual/excluded downgrade to condition; Beijing never double counts a selected manual state pension',()=>{
 const s=fixture(),p=saved(s),d=setupDraft(p,s.snapshot.value,s.today,true);p.profile.retire.income_items=[{id:'fictional-pension',label:'虚构手填养老金',monthly_cents:'200000',start_age:60,end_age:null,indexed:true}];d.incomeItems=structuredClone(p.profile.retire.income_items);d.picks={'fictional-pension':{on:true,role:'state_pension'}};
 for(const mode of ['manual','excluded','beijing']){Object.assign(d,{incomeMode:mode,pcPlan:'custom',pcStart:'2026-10',pcStop:'2050-06',pcBase:'2000000',hpf:'0'});const f=pensionRefinementFields(d,p,s.today),next=overlayPlanningDrafts(s,[{section:'setup',fields:f}]);assert.equal(f.basic.basic.retirement_income.selected.length,mode==='manual'?1:0);assert.equal(saved(next).profile.retire.income_items.length,1);if(mode!=='beijing')assert.equal(cards(next).find(c=>c.id==='pension').condition,true);else assert.ok(!cards(next).some(c=>c.id==='pension'));assert.equal(caps(next).requirement.status,'ready');}
});

test('comparison freezes snapshot/date/all other conditions even if sources change while the dialog is open',async()=>{
 const original=fixture(),baseline=structuredClone(original),e=editor(original),r=e.r;choose(r,'北京养老金估算');next(r);contrib(r);next(r);
 original.today='2026-12-31';original.snapshot.value.date='2026-12-31';original.snapshot.value.entries[0].amount_cents='990000000';saved(original).profile.retire.spend_cents='990000';original.review.value=null;await submit(r);
 assert.deepEqual(e.comparison,comparePensionRefinement(baseline,r.calls[0].fields));assert.equal(e.comparison.today,'2026-10-10');assert.equal(e.comparison.snapshotDate,'2026-10-10');assert.notDeepEqual(e.comparison,comparePensionRefinement(original,r.calls[0].fields));
 const d=setupDraft(saved(baseline),baseline.snapshot.value,baseline.today,true);Object.assign(d,{budget:'900000',target:'62',incomeMode:'beijing',pcPlan:'custom',pcStart:'2026-10',pcStop:'2052-06',pcBase:'2000000',hpf:'0'});const f=withPensionRefinement(setupFields(d,saved(baseline),baseline.today,true),d,saved(baseline),baseline.today),c=comparePensionRefinement(baseline,f);const other=structuredClone(f);other.basic.basic.retirement_income=structuredClone(saved(baseline).profile.retire.basic.retirement_income);other.basic.basic.pension_contributions=structuredClone(saved(baseline).profile.retire.basic.pension_contributions);if(other.funds)other.funds.hpf_monthly_cents=saved(baseline).profile.retire.core.hpf_monthly_cents;assert.deepEqual(c.before,caps(overlayPlanningDrafts(baseline,[{section:'setup',fields:other}])).requirement.value.set);
});

test('no original, unchanged and uncomputable comparisons remain honest; closing/Esc sends no write',()=>{
 const s=fixture(),d=setupDraft(saved(s),s.snapshot.value,s.today,true),same=comparePensionRefinement(s,pensionRefinementFields(d,saved(s),s.today));assert.deepEqual(same.before,same.after);
 const blank=fixture('empty'),newD=setupDraft(null,blank.snapshot.value,blank.today,true),fields=setupFields(newD,null,blank.today,true);assert.equal(comparePensionRefinement(blank,fields).before,null);assert.match(comparePensionRefinement(blank,fields).reason,/尚无原结果/);
 for(const exit of ['取消','escape']){const r=editor(s).r;choose(r,'北京养老金估算');if(exit==='escape')r.find('dialog').props.onCancel(event());else r.button(exit).props.onClick();assert.equal(r.calls.length,0);}
});

test('failed/unresolved saves preserve edits and lock replay; illegal future schedule is not saved',async()=>{
 const s=fixture(),r=runtime('PlanningPensionRefinement',{sources:s},async()=>{throw Error('虚构保存失败');});choose(r,'北京养老金估算');next(r);contrib(r);next(r);await submit(r);assert.match(r.text(r.find('dialog')),/虚构保存失败/);assert.deepEqual(r.closes,[]);r.saver.stuck=true;r.render();assert.equal(r.button('保存，查看结果').props.disabled,true);assert.equal(r.button('上一步').props.disabled,true);
 const e=editor(s);choose(e.r,'北京养老金估算');next(e.r);contrib(e.r);value(e.r,'MonthInput','未来缴费停止月份','2020-01');next(e.r);await submit(e.r);assert.equal(e.r.calls.length,0);assert.match(e.r.text(e.r.find('dialog')),/排期.*非法/);
});

test('explicit no-future choice never manufactures base or HPF zero; saved hidden pension fields remain exact',()=>{
 const s=fixture(),r=runtime('PlanningPensionRefinement',{sources:s});choose(r,'北京养老金估算');next(r);select(r,'以后还继续交社保吗','stop');assert.equal(r.find('CentInput',p=>p.label==='未来月缴费基数').props.value,'');assert.equal(r.find('CentInput',p=>p.label==='未来公积金每月缴存').props.value,'');assert.equal(r.find('MonthInput',p=>p.label==='未来缴费开始月份').props.value,'2026-10');assert.equal(r.find('MonthInput',p=>p.label==='未来缴费停止月份').props.value,'2026-10');
 const d=setupDraft(saved(s),s.snapshot.value,s.today,true);saved(s).profile.overrides.notional_rate_hundredths=345;d.pension.oNotional='3.45'; const f=pensionRefinementFields(d,saved(s),s.today);assert.equal(f.pension,null);assert.deepEqual(f.basic.basic.pension_contributions,saved(s).profile.retire.basic.pension_contributions);
});

test('Q4 with no previous calculable result does not invent an original number from newly filled other answers',()=>{
 const s=fixture();saved(s).profile.retire.spend_cents=null;const d=setupDraft(saved(s),s.snapshot.value,s.today,true);d.budget='750000'; const f=withPensionRefinement(setupFields(d,saved(s),s.today,true),d,saved(s),s.today),c=comparePensionRefinement(s,f);assert.equal(c.before,null);assert.match(c.reason,/原结果暂不可计算/);assert.ok(c.after);
});

test('Beijing with complete social facts but skipped future conditions also has a real 改选先不算 entry and a named reason',()=>{
 const s=fixture();saved(s).profile.retire.basic.retirement_income.mode='beijing';assert.equal(caps(s).requirement.status,'blocked');assert.match(cards(s).find(c=>c.id==='pension').benefit,/未来缴费/);assert.ok(cards(s).some(c=>c.id==='income-switch'));route(s,'income-switch');
});

test('future-transfer card exception closes in excluded/manual without changing mode, with real cash and comparison',async()=>{
 for(const mode of ['excluded','manual']){const s=fixture('transfer-'+mode),goal=route(s,'transfer');assert.ok(goal.find('CentInput',p=>p.label==='未来月缴费基数'));const e=editor(s,{reviewContributions:true});next(e.r);contrib(e.r);next(e.r);await submit(e.r);assert.equal(saved(e.source).profile.retire.basic.retirement_income.mode,mode);assert.ok(!cards(e.source).some(c=>c.id==='transfer'));assert.equal(caps(e.source).annotations.some(a=>a.reason_code==='TRANSFER_PENDING'),false);assert.equal(caps(e.source).requirement.status,'ready');assert.notEqual(e.comparison.before.monthly_cents,e.comparison.after.monthly_cents);assert.equal(e.comparison.mode,mode);assert.equal(e.r.calls[0].fields.pension,null);assert.equal(cards(e.source).find(c=>c.id==='pension').condition,true);}
});


test('comparison shows the state pension from the same captured calculation, omits unknowns and labels income choices accurately',async()=>{
 const initial=fixture(),e=editor(initial),r=e.r;assert.equal(cards(initial).find(c=>c.id==='pension').duration,'你选择了先不算');choose(r,'北京养老金估算');next(r);contrib(r);next(r);await submit(r);
 const expected=caps(e.source).pension;assert.equal(expected.status,'ready');assert.equal(e.comparison.statePensionMonthlyCents,expected.value.monthly_cents);assert.ok(Number(e.comparison.statePensionMonthlyCents)>0);
 const note=runtime('PlanningBasicGoals',{sources:e.source,comparison:e.comparison},undefined,caps(e.source));assert.match(note.text(note.find('aside')),new RegExp('估算的国家养老金每月约 ¥'+expected.value.monthly_cents));assert.match(note.text(note.find('aside')),/不代表待遇核定结果/);
 for(const state of [fixture(),fixture('unknown')]){const d=setupDraft(saved(state),state.snapshot.value,state.today,true),c=comparePensionRefinement(state,pensionRefinementFields(d,saved(state),state.today));assert.equal(c.statePensionMonthlyCents,null);const view=runtime('PlanningBasicGoals',{sources:state,comparison:c},undefined,caps(state));assert.doesNotMatch(view.text(view.find('aside')),/估算的国家养老金每月约/);}
 const manual=fixture('transfer-manual');assert.equal(cards(manual).find(c=>c.id==='pension').duration,'你选择了手填收入');assert.equal(cards(fixture('unknown')).find(c=>c.id==='pension').duration,'北京估算待补齐');
});
