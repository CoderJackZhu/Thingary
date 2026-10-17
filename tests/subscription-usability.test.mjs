import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as recurring from '../src/recurring.ts';
import * as model from '../src/recurring-model.ts';
const plan = { id:'one', revision:3, active_from:'2026-01-31', next_due:'2026-10-31', paid_cents:'14000', fields:{...model.blankPlan('2026-01-31'),name:'虚构订阅',amount_cents:'14000'}, resumptions:[] };
const payment = {id:'fact',plan_id:'one',plan_name:'虚构订阅',revision:2,due_date:'2026-01-31',paid_date:'2026-01-30',amount_cents:'13900',state:'paid',coverage_start:'2026-01-31',coverage_end:'2026-02-27',off_schedule:false,notes:''};
const link = {generation:'fictional',relation:'unlinked',asset:null,paid_count:1,paid_cents:'13900'};
const Unresolved=class extends Error {};
function detail(overrides={}, result={generation:'fictional',plan,payments:[payment]}, read=async()=>result, submit=async()=>{}) {
  const selected=[];
  const r=runtime('SubscriptionDetail',{plan,today:'2026-10-17',modules:{virtual:true},onEdit(){},onPay:p=>selected.push(p),onResume:p=>selected.push(p),onEnd(){},onBackfill(){},onGroupDelete(){},onCorrectPayment:p=>selected.push(p),...overrides},undefined,undefined,{components:[],modules:{'./asset':{money:v=>v===null?'未知':`¥${v}`,errorMessage:e=>e.message},'./link':{linkView:async()=>link},'./LinkDialogs':{relationNotice:()=>null},'./recurring':recurring,'./recurring-model':model,'./wealth':{submit,Unresolved},'@tauri-apps/api/core':{invoke:read}}});
  return {r,selected};
}
test('payment correction is available in the same detail and keeps the exact fact ID',async()=>{
  const {r,selected}=detail();await r.settle();assert.match(r.text(r.render()),/实际已付/);
  r.button('更正 2026-01-31 付款').props.onClick();assert.equal(selected[0].id,'fact');assert.equal(selected[0].revision,2);
});
test('failed history read offers retry and never claims there are no payments',async()=>{
  const {r}=detail({},undefined,async()=>{throw new Error('fictional read error')});await r.settle();
  assert.match(r.text(r.render()),/付款记录读取失败/);assert.doesNotMatch(r.text(r.render()),/还没有记录付款/);assert.equal(r.button('记录实际扣款').props.disabled,true);
});
test('ended subscription offers restart under its original stable identity',async()=>{
  const ended={...plan,fields:{...plan.fields,end_date:'2026-07-30',auto_renew:false}};
  const {r,selected}=detail({plan:ended},{generation:'fictional',plan:ended,payments:[payment]});await r.settle();
  assert.equal(r.button('记录实际扣款').props.disabled,true);r.button('重新订阅…').props.onClick();assert.equal(selected[0].plan.id,'one');
});
test('detail pages long histories without truncating the recorded total',async()=>{
  const records=Array.from({length:51},(_,i)=>({...payment,id:`p${i}`,due_date:`period${i}`}));
  const {r}=detail({}, {generation:'fictional',plan,payments:records});await r.settle();
  assert.equal(r.nodes().filter(n=>n.type==='article').length,50);r.button('下一页').props.onClick();r.render();assert.equal(r.nodes().filter(n=>n.type==='article').length,1);
});
test('restart form submits only the new period and preserves errors and unknown receipt state',async()=>{
  let saved;const ended={...plan,fields:{...plan.fields,end_date:'2026-07-30'}};
  const r=runtime('ResumeSubscriptionDialog',{plan:ended,link,today:'2026-10-17'},undefined,undefined,{components:[],modules:{'./asset':{money:v=>String(v),errorMessage:e=>e.message},'./recurring':recurring,'./recurring-model':model,'./wealth':{Unresolved,submit:async p=>{saved=p;throw new Unresolved('需核对')}}}});
  r.find('form').props.onSubmit({preventDefault(){}});await r.settle();assert.equal(saved.command,'recurring_resume');assert.equal(saved.input.plan_id,'one');assert.equal(saved.input.start_date,'2026-10-17');assert.equal(saved.input.expected_revision,3);
  assert.match(r.text(r.render()),/需核对/);assert.equal(r.button('确认重新订阅').props.disabled,true);assert.equal(r.closes.length,0);
});
test('frontend history schedule skips stopped months and restarts on the new date',()=>{
  const p={...plan,fields:{...plan.fields,first_due:'2026-10-17',coverage_start:'2026-10-17'},rules:[{effective_date:'2026-01-31',anchor:'2026-01-31',first_due:'2026-01-31',service_start:'2026-01-31',interval_months:1,interval_days:null,trial_days:null},{effective_date:'2026-10-17',anchor:'2026-10-17',first_due:'2026-10-17',service_start:'2026-01-31',interval_months:1,interval_days:null,trial_days:null}],resumptions:[{previous_end:'2026-07-30',resumed_on:'2026-10-17'}]};
  assert.deepEqual(model.planScheduleDates(p,'2026-01-01','2026-11-17'),['2026-01-31','2026-02-28','2026-03-31','2026-04-30','2026-05-31','2026-06-30','2026-10-17','2026-11-17']);
});
test('payment action uses the selected period price and edit uses the freshly read plan',async()=>{
  let paid,edited;
  const fresh={...plan,revision:7};
  const {r}=detail({onPay:(p,amount)=>{paid={p,amount}},onEdit:p=>{edited=p}}, {generation:'fictional',plan:fresh,payments:[payment],payment_candidate:{amount_cents:'18000'}});
  await r.settle();r.button('记录实际扣款').props.onClick();assert.equal(paid.amount,'18000');assert.equal(paid.p.revision,7);
  r.button('修改价格与设置').props.onClick();assert.equal(edited.revision,7);
});

const pendingPlan = {...plan, fields:{...plan.fields,service_start:'2026-01-31',coverage_start:'2026-10-21',first_due:'2026-10-21'},resumptions:[{previous_end:'2026-07-30',resumed_on:'2026-10-21'}],next_due:'2026-10-21'};
function resumeForm(p,submit=async()=>{}) {
  return runtime('ResumeSubscriptionDialog',{plan:p,link,today:'2026-10-17'},undefined,undefined,{components:[],modules:{'./asset':{money:v=>String(v),errorMessage:e=>e.message},'./recurring':recurring,'./recurring-model':model,'./wealth':{submit,Unresolved}}});
}
test('future restart previews a new 21st service cycle without carrying the old 31st billing day',async()=>{
  let saved; const r=resumeForm({...plan,fields:{...plan.fields,end_date:'2026-07-30'}},async p=>{saved=p});
  const date=r.find('DateInput',p=>p.label==='本次服务生效日期');
  assert.equal(date.props.max,undefined);
  date.props.onChange('2026-10-21');r.render();
  assert.match(r.text(r.render()),/2026-10-21 至 2026-11-20/);
  assert.match(r.text(r.render()),/下一期计划付款：2026-11-21/);
  r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
  assert.equal(saved.input.start_date,'2026-10-21');assert.equal(saved.input.first_due,undefined);
  assert.equal(saved.input.replace_pending,undefined);
});
test('fixed advance payment gets its own anchor while service still starts on the 21st',async()=>{
  let saved;const r=resumeForm({...plan,fields:{...plan.fields,end_date:'2026-07-30'}},async p=>{saved=p});
  r.find('DateInput',p=>p.label==='本次服务生效日期').props.onChange('2026-10-21');r.render();
  r.find('Switch',p=>p.label==='每期付款日与生效日不同').props.onChange(true);r.render();
  r.find('DateInput',p=>p.label==='本段首期计划付款日').props.onChange('2026-10-17');r.render();
  assert.match(r.text(r.render()),/下一期计划付款：2026-11-17/);
  assert.match(r.text(r.render()),/下一期服务从 2026-11-21/);
  r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
  assert.equal(saved.input.first_due,'2026-10-17');assert.equal(saved.input.start_date,'2026-10-21');
});
test('invalid and overlapping dates stay in the restart form without submitting',async()=>{
  let calls=0;const r=resumeForm({...plan,fields:{...plan.fields,end_date:'2026-07-30'}},async()=>{calls++});
  for(const day of ['2026-02-30','2026-07-30','']) {
    r.find('DateInput',p=>p.label==='本次服务生效日期').props.onChange(day);r.render();
    r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
    assert.equal(calls,0);assert.match(r.text(r.render()),/有效的服务生效日期/);
  }
});
test('pending restart is an explicit replacement with the previous end retained',async()=>{
  let saved;const r=resumeForm(pendingPlan,async p=>{saved=p});
  assert.ok(r.button('保存调整'));
  assert.equal(r.find('DateInput',p=>p.label==='本次服务生效日期').props.value,'2026-10-21');
  assert.match(r.text(r.render()),/上段使用至 2026-07-30/);
  r.find('DateInput',p=>p.label==='本次服务生效日期').props.onChange('2026-10-25');r.render();
  r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
  assert.equal(saved.input.replace_pending,true);assert.equal(saved.input.start_date,'2026-10-25');
});
test('one early actual payment does not rewrite the scheduled day or future service coverage',async()=>{
  let saved;const r=runtime('RecurringPage',{target:{plan_id:'one',plan_name:'虚构 Plus',due_date:'2026-10-21',plan_amount:'15000',record:null,coverage_start:'2026-10-21',coverage_end:'2026-11-20'},generation:'fictional',today:'2026-10-17'},undefined,undefined,{exportName:'PaymentDialog',components:[],modules:{'./asset':{money:String,errorMessage:e=>e.message},'./recurring':recurring,'./recurring-model':model,'./wealth':{submit:async p=>{saved=p},Unresolved}}});
  assert.equal(r.find('DateInput').props.value,'2026-10-17');
  assert.match(r.text(r.render()),/2026-10-21 至 2026-11-20/);
  r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
  assert.equal(saved.command,'recurring_payment_save');assert.equal(saved.input.paid_date,'2026-10-17');assert.equal(saved.input.due_date,'2026-10-21');
  assert.equal(saved.input.fields,undefined);
});
test('future detail separates pending service from prepayment and routes edit to the pending form',async()=>{
  const {r,selected}=detail({plan:pendingPlan},{generation:'fictional',plan:pendingPlan,payments:[payment],payment_candidate:{due_date:'2026-10-21',amount_cents:'15000',coverage_start:'2026-10-21',coverage_end:'2026-11-20'}});
  await r.settle();assert.match(r.text(r.render()),/待生效 · 2026-10-21/);
  r.button('调整订阅安排').props.onClick();assert.equal(selected[0].plan.id,'one');
  r.button('记录实际扣款').props.onClick();assert.deepEqual(Array.from(selected[1].next_coverage),['2026-10-21','2026-11-20']);
});
test('cancel pending requires explicit confirmation, preserves history and reloads the parent',async()=>{
  let saved,reloads=0;const {r}=detail({plan:pendingPlan,onSaved:()=>{reloads++}},{generation:'fictional',plan:pendingPlan,payments:[payment]},undefined,async p=>{saved=p});
  await r.settle();r.button('撤销待生效安排…').props.onClick();r.render();assert.equal(saved,undefined);
  r.button('保留安排').props.onClick();r.render();assert.equal(saved,undefined);
  r.button('撤销待生效安排…').props.onClick();r.render();r.button('确认撤销安排').props.onClick();await r.settle();
  assert.equal(saved.command,'recurring_cancel_resumption');assert.equal(saved.input.plan_id,'one');assert.equal(saved.input.expected_revision,3);assert.equal(reloads,1);
});
test('a pending segment with real payment cannot be silently moved or withdrawn',async()=>{
  const prepaid={...payment,due_date:'2026-10-21',paid_date:'2026-10-17',coverage_start:'2026-10-21',coverage_end:'2026-11-20'};
  const {r}=detail({plan:pendingPlan},{generation:'fictional',plan:pendingPlan,payments:[payment,prepaid]});await r.settle();
  assert.equal(r.button('调整订阅安排').props.disabled,true);assert.equal(r.button('撤销待生效安排…'),undefined);
  assert.ok(r.button('取消后续续费…'));assert.match(r.text(r.render()),/本段已有付款记录/);
});
test('service state remains independent per subscription and starts only on its own new date',()=>{
  assert.equal(recurring.planStatus(pendingPlan,'2026-10-17'),'待生效 · 2026-10-21');
  assert.equal(recurring.planStatus(pendingPlan,'2026-10-21'),'持续续费');
  const pro={...plan,id:'pro',fields:{...plan.fields,service_start:'2026-08-17',end_date:'2026-10-20'}};
  assert.equal(recurring.planStatus(pro,'2026-10-17'),'进行中，至 2026-10-20');
  assert.equal(recurring.planStatus(pro,'2026-10-21'),'已于 2026-10-20 结束');
  assert.equal(recurring.pendingSubscriptionStart(pendingPlan,'2026-06-01'),null);
});

test('hidden or skipped payment facts still protect the pending arrangement before a user clicks',async()=>{
  const {r}=detail({plan:pendingPlan},{generation:'fictional',plan:pendingPlan,payments:[payment],pending_has_payments:true});await r.settle();
  assert.equal(r.button('调整订阅安排').props.disabled,true);assert.equal(r.button('撤销待生效安排…'),undefined);
  assert.ok(r.button('取消后续续费…'));
});
