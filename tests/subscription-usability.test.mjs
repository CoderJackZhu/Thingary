import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as recurring from '../src/recurring.ts';
import * as model from '../src/recurring-model.ts';
const plan = { id:'one', revision:3, active_from:'2026-01-31', next_due:'2026-10-31', paid_cents:'14000', fields:{...model.blankPlan('2026-01-31'),name:'虚构订阅',amount_cents:'14000'}, resumptions:[] };
const payment = {id:'fact',plan_id:'one',plan_name:'虚构订阅',revision:2,due_date:'2026-01-31',paid_date:'2026-01-30',amount_cents:'13900',state:'paid',coverage_start:'2026-01-31',coverage_end:'2026-02-27',off_schedule:false,notes:''};
const link = {generation:'fictional',relation:'unlinked',asset:null,paid_count:1,paid_cents:'13900'};
const Unresolved=class extends Error {};
function detail(overrides={}, result={generation:'fictional',plan,payments:[payment]}, read=async()=>result) {
  const selected=[];
  const r=runtime('SubscriptionDetail',{plan,today:'2026-10-17',modules:{virtual:true},onEdit(){},onPay:p=>selected.push(p),onResume:p=>selected.push(p),onEnd(){},onBackfill(){},onGroupDelete(){},onCorrectPayment:p=>selected.push(p),...overrides},undefined,undefined,{components:[],modules:{'./asset':{money:v=>v===null?'未知':`¥${v}`,errorMessage:e=>e.message},'./link':{linkView:async()=>link},'./LinkDialogs':{relationNotice:()=>null},'./recurring':recurring,'./recurring-model':model,'@tauri-apps/api/core':{invoke:read}}});
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
