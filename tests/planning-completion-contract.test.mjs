import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtime } from './pension-runtime.mjs';
import { completionFixture } from '../src/planning-completion-fixture.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
import { refinementCards, goalState } from '../src/planning-first-run.ts';
const batch = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url)));
const saved = s => s.profile.value.saved;
const caps = s => buildBasicCapabilities(s);
const cards = s => refinementCards(saved(s), caps(s), s.today);
const children = node => { const out=[];const visit=n=>{if(Array.isArray(n))n.forEach(visit);else if(n&&typeof n==='object'){out.push(n);visit(n.props?.children);}};visit(node);return out; };
const submit = async r => { r.find('form').props.onSubmit({preventDefault(){}}); await r.settle(); };
const select = (r,label,value) => { const n=r.find('select',p=>p['aria-label']===label);assert.ok(n,label);n.props.onChange({target:{value}});r.render(); };
const fill = (r,type,label,value) => { const n=r.find(type,p=>p.label===label||p['aria-label']===label);assert.ok(n,label);n.props.onChange(type==='input'?{target:{value}}:value);r.render(); };
const radio = (r,label) => {const n=r.find('input',p=>p['aria-label']===label);assert.ok(n,label);n.props.onChange();r.render();};
function open(s,id) {
 let current=s, r;
 r=runtime('PlanningBasicGoals',{sources:current,realSummary:true},async input=>{current=overlayPlanningDrafts(current,[input]);r.props.sources=current;return saved(current);},()=>caps(current));
 const card=r.find('article',p=>p['data-refinement']===id);assert.ok(card,id);
 children(card).find(n=>n.type==='button').props.onClick({currentTarget:{isConnected:true,focus(){}}});r.render();assert.ok(r.find('dialog'));
 return {r,get source(){return current;}};
}
async function reachSave(r){for(let i=0;i<4&&r.button('下一步');i++){r.button('跳过这一步').props.onClick();r.render();}}
const cases = [
 ['event-actual','event:fictional-overdue','付款1金额',r=>fill(r,'CentInput','付款1金额','1000000')],
 ['debt-balance','debt-balance','虚构信用卡：每月还一笔固定金额，单独算上',r=>radio(r,'虚构信用卡：这笔还款已经含在我的每月开销里')],
 ['funds','funds','我没有已有的个人养老金余额',r=>radio(r,'我没有已有的个人养老金余额')],
 ['pension','pension','性别与职工类型',r=>{select(r,'性别与职工类型','male');fill(r,'input','累计缴费月数','48');}],
 ['transfer','transfer','未来缴费停止月份',r=>fill(r,'MonthInput','未来缴费停止月份','2050-06')],
 ['debts','debt-review','虚构信用卡：每月还一笔固定金额，单独算上',r=>{for(const name of ['虚构信用卡','虚构房贷']){radio(r,name+'：每月还一笔固定金额，单独算上');fill(r,'CentInput',name+'每月还款','10000');fill(r,'MonthInput',name+'最后一期','2027-10');}}],
 ['costs','costs','房租是否已含在生活费里',r=>select(r,'房租是否已含在生活费里','included')],
 ['event','event:fictional-overdue','是否已经发生',r=>select(r,'是否已经发生','cancelled')],
];
for(const [scenario,id,focus,minimum] of cases){
 test(`${scenario}: empty save remains open, names missing confirmation and focuses it`,async()=>{
  const initial=completionFixture(batch,scenario),e=open(initial,id),r=e.r;
  await reachSave(r); await submit(r);
  assert.equal(r.calls.length,0);assert.ok(r.find('dialog'));assert.ok(cards(e.source).some(c=>c.id===id));assert.match(r.text(r.find('dialog')),/这一项还没确认，确认后才能算出结果/);
  assert.equal(r.focuses.at(-1),focus);const cue=r.find('div',p=>p['data-confirmation']&&children(p.children).some(n=>n.type==='p'&&n.props.role==='alert'));assert.ok(cue,'error sits beside the control, not only at dialog end');
  assert.deepEqual(e.source,initial);
 });
 test(`${scenario}: minimum confirmation saves once, removes card and recomputes actual summary`,async()=>{
  const initial=completionFixture(batch,scenario),e=open(initial,id),r=e.r;
  minimum(r); await reachSave(r); await submit(r);
  assert.equal(r.calls.length,1);assert.equal(r.find('dialog'),undefined);assert.ok(!cards(e.source).some(c=>c.id===id));assert.equal(caps(e.source).requirement.status,'ready');
  const amount=caps(e.source).requirement.value.set.monthly_cents;assert.match(r.text(r.find('article',p=>p['aria-label']==='退休目标')),new RegExp('¥'+amount));assert.ok(r.button('查看计算详情与图表'));
  if(['transfer','debts','costs'].includes(scenario))assert.notEqual(amount,caps(initial).requirement.value.set.monthly_cents);
 });
}

test('sample + Beijing + annual personal pension: unknown stays hard-blocked until explicit zero; summary matches engine',async()=>{
 const s=completionFixture(batch,'funds'),e=open(s,'funds'),r=e.r;
 const card = cards(s).find(c=>c.id==='funds');assert.equal(card.title,'确认个人养老金余额');assert.equal(card.benefit,'确认个人养老金账户里已有多少钱（没有也请确认一下）。');assert.equal(r.text(r.find('article',p=>p['data-refinement']==='funds').props.children[0]),'确认个人养老金余额');
 assert.equal(goalState(saved(s),caps(s)),'2b');assert.ok(caps(s).requirement.missing.some(m=>m.code==='POOL_UNCONFIRMED'&&m.field==='core.personal_pension_balance_confirmed'));
 assert.equal(r.find('details',p=>children(p.children).some(n=>n.type==='summary'&&r.text(n)==='已有个人养老金余额')).props.open,true);
 assert.equal(r.find('input',p=>p['aria-label']==='我没有已有的个人养老金余额').props.checked,false);assert.equal(r.find('input',p=>p['aria-label']==='关联到下面的账户').props.checked,false);
 await submit(r);assert.equal(r.calls.length,0);radio(r,'我没有已有的个人养老金余额');await submit(r);
 assert.equal(saved(e.source).profile.retire.core.personal_pension_account_id,null);assert.equal(saved(e.source).profile.retire.core.personal_pension_balance_confirmed,true);assert.equal(saved(e.source).profile.personal_pension_annual_cents,'1200000');assert.equal(goalState(saved(e.source),caps(e.source)),'2');assert.match(r.text(r.find('article',p=>p['aria-label']==='退休目标')),new RegExp('¥'+caps(e.source).requirement.value.set.monthly_cents));
});

test('funds card retains its general title and copy for other necessary confirmations',()=>{
 const s=completionFixture(batch,'funds'),c=caps(s);
 c.requirement={status:'blocked',missing:[{code:'FUNDS_UNCONFIRMED',capability:'requirement',owner:'funds',field:'core.fund_rules',message:'资金用途待确认',kind:'fact'}]};
 const card=refinementCards(saved(s),c,s.today).find(c=>c.id==='funds');
 assert.equal(card.title,'确认哪些钱可以动用');assert.equal(card.benefit,'确认这次盘点里哪些账户可以动用、哪些暂不能动用，以及各账户计入多少比例。');
});

test('link choice requires a real eligible account; existing unknown account never defaults to zero',async()=>{
 const s=completionFixture(batch,'funds'),e=open(s,'funds'),r=e.r;radio(r,'关联到下面的账户');await submit(r);assert.equal(r.calls.length,0);
 const account=s.snapshot.value.entries.find(v=>v.kind==='mixed');select(r,'关联个人养老金账户',account.account_id);await submit(r);assert.equal(r.calls.length,1);assert.equal(saved(e.source).profile.retire.core.personal_pension_account_id,account.account_id);assert.ok(!cards(e.source).some(c=>c.id==='funds'));
});

test('detail action is a keyboard-native primary button before chips, with any ready result in 2 or 2b',()=>{
 const s=completionFixture(batch,'costs');for(const state of ['2','2b']){const c=caps(s);if(state==='2b')c.pension={status:'blocked',missing:[]};const r=runtime('PlanningBasicGoals',{sources:s,realSummary:true,goalStateOverride:state},undefined,c);assert.equal(r.find('div',p=>p['data-goal-state']).props['data-goal-state'],state);const button=r.button('查看计算详情与图表');assert.equal(button.props.type,'button');assert.equal(button.props.className,'primary');assert.equal(button.props.tabIndex,undefined);const nodes=r.nodes();assert.ok(nodes.indexOf(button)<nodes.indexOf(r.find('div',p=>p['aria-label']==='计算条件')));}
});

for(const action of ['blank','exclude'])test(`income-switch: ${action} completion`,async()=>{
 const e=open(completionFixture(batch,'funds'),'income-switch'),r=e.r;
 if(action==='exclude')radio(r,'先不算（推荐先这样）');await reachSave(r);await submit(r);
 if(action==='blank'){assert.equal(r.calls.length,0);assert.ok(r.find('dialog'));assert.match(r.text(r.find('dialog')),/这一项还没确认/);assert.equal(r.focuses.at(-1),'先不算（推荐先这样）');}
 else{assert.equal(r.find('dialog'),undefined);assert.ok(!cards(e.source).some(c=>c.id==='income-switch'));assert.equal(caps(e.source).requirement.status,'ready');assert.equal(saved(e.source).profile.personal_pension_annual_cents,'1200000');}
});
for(const [scenario,step,label,minimum] of [
 ['contribution',4,'每月大约能存下多少钱',r=>fill(r,'CentInput','每月大约能存下多少钱','500000')],
 ['income',3,'退休收入计入方式',r=>radio(r,'先不算（推荐先这样）')],
 ['assumptions',5,'规划到几岁',r=>fill(r,'input','规划到几岁','90')],
])for(const action of ['blank','minimum'])test(`${scenario} setup card: ${action} save`,async()=>{
 const id=scenario;
 let source=completionFixture(batch,scenario),r;const original=structuredClone(source);let routed;
 const goal=runtime('PlanningBasicGoals',{sources:source,openSetup:(...args)=>routed=args},undefined,caps(source));
 const card=goal.find('article',p=>p['data-refinement']===id);assert.ok(card);children(card).find(n=>n.type==='button').props.onClick({currentTarget:{focus(){}}});assert.equal(routed[3],id);
 r=runtime('PlanningSetup',{sources:source,snapshot:source.snapshot.value,accounts:source.accounts.value,completionId:routed[3],initialStep:step,editMode:true},async input=>{source=overlayPlanningDrafts(source,[input]);return saved(source);});
 if(action==='minimum')minimum(r);
 if(step===4){r.button('保存，查看结果').props.onClick();await r.settle();}else await submit(r);
 if(action==='blank'){assert.equal(r.calls.length,0);assert.ok(r.find('dialog'));assert.match(r.text(r.find('dialog')),/这一项还没确认/);assert.equal(r.focuses.at(-1),label==='退休收入计入方式'?'先不算（推荐先这样）':label);assert.deepEqual(source,original);}
 else{assert.equal(r.calls.length,1);assert.ok(r.closes.includes(true));assert.ok(!cards(source).some(c=>c.id===id));assert.equal(caps(source).requirement.status,'ready');}
});
