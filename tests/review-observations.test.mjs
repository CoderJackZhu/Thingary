import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewObservations } from '../src/review-observations.ts';
import { emptyCore, occurrenceIssues, occurrenceMissing } from '../src/plan-core.ts';
import { computeReview } from '../src/plan.ts';
const interval = { snapshot_id:'end', from:'2026-09-01', to:'2026-10-01', status:'ok', delta_nw_cents:'6000000', income_cents:'2000000', saving_cents:'6000000', spend_cents:'-4000000', rate_hundredths:30000 };
const input = (over={}) => ({interval, reasons:null, pending:[], snapshots:{incomplete_count:0,points:[]}, ...over});
const line = (id, source, amount_cents) => ({id,source,amount_cents});
const build = over => buildReviewObservations(input(over));
const banned = /储蓄率|结余|花销|收益|应该|建议减少|成功|失败/;
const safe = result => assert.doesNotMatch(result.items.map(x=>x.text).join(' '),banned);
test('V1/V2: no income preserves asset facts; valuation growth never derives spending or a ratio',()=>{
 const points=[{snapshot_id:'start',date:'2026-09-01',complete:true,compared_to:null},{snapshot_id:'end',date:'2026-10-01',complete:true,compared_to:'2026-09-01',scope_changed:false,change_cents:'6000000',hpf_change_cents:null,market_change_cents:'5000000'}];
 for (const incomes of [[],[{id:'i',fields:{date:'2026-09-20',net_cents:'2000000',hpf_cents:'0'}}]]) {
  const r=computeReview(points,incomes,new Set(),'fictional');const o=build({interval:r.intervals[0]});
  assert.match(o.items.at(-1).text,/金融净资产增加了.*60,000.*含估值变化/);safe(o);
  assert.equal(o.items.some(x=>x.id==='no_income'),incomes.length===0);
  assert.doesNotMatch(JSON.stringify(o),/-40,000|300%/);
 }
});
test('V5/V6/V10: stable supplement action and fixed priorities, capped at three',()=>{
 const o=build({interval:{...interval,status:'scope_changed'},snapshots:{incomplete_count:2,points:[{snapshot_id:'missing-id',complete:false}]},pending:[{event_id:'e',kind:'overdue'}],reasons:{lines:[line('1','purchase','100')]}});
 assert.deepEqual(o.items.map(x=>x.id),['incomplete','scope_changed','pending_events']);
 assert.deepEqual(o.next,{label:'补录',action:{kind:'snapshot',id:'missing-id'}});safe(o);
 const changed=build({interval:{...interval,status:'scope_changed'}});assert.deepEqual(changed.items.map(x=>x.id),['scope_changed']);
});
test('V8: refunds/sales subtract in integer cents, unknown remains excluded, zero is known',()=>{
 const o=build({reasons:{lines:[line('a','purchase','10001'),line('b','refund','3000'),line('c','sale','2000'),line('d','maintenance',null),line('e','expense','0')]}});
 assert.match(o.items[0].text,/5 条.*50.01.*其中 1 条金额未知，合计不含这些/);safe(o);
 const unknown=build({reasons:{lines:[line('a','purchase',null)]}});assert.match(unknown.items[0].text,/—／未知/);assert.doesNotMatch(unknown.items[0].text,/¥0/);
});
test('fallback, decrease, zero, no action and missing sources do not fabricate facts',()=>{
 for (const delta of [null,'-125','0']) {const o=build({interval:{...interval,delta_nw_cents:delta},snapshots:null});safe(o);assert.equal(o.next,undefined);assert.match(o.items[0].text,delta===null?/暂无可比较/:delta==='0'?/增加了.*0/:/减少了.*1.25/);}
});
test('V3/V4: shared occurrence rules, unique events, no writes on ignore; old messages unchanged',()=>{
 const snapshot={id:'end',revision:1,date:'2026-10-01',entries:[{account_id:'cash',side:'asset',counted:true,amount_cents:'16000000'}],missing:[]};
 const event={id:'e',label:'虚构计划',date:'2026-08',included:true,price_cents:'10000',down_cents:'10000'};
 const c={...emptyCore(snapshot.date),fund_rules:[{account_id:'cash',availability:'available',share_hundredths:10000}]};
 const before=JSON.stringify({snapshot,c,event});
 const pending=occurrenceIssues(snapshot,c,[event],'2026-10-09');assert.deepEqual(pending,[{event_id:'e',kind:'overdue',message:'虚构计划：日期已过，待核对。'}]);
 assert.deepEqual(occurrenceMissing(snapshot,c,[event],'2026-10-09'),pending.map(x=>x.message));
 assert.equal(build({pending}).next.action.event_id,'e');assert.equal(JSON.stringify({snapshot,c,event}),before);
 c.occurrences=[{event_id:'e',status:'occurred',actual_date:'2026-09-01',payments_complete:true,payments:[{amount_cents:'10000',account_id:'cash',date:'2026-09-01',absorbed_snapshot_id:'end',absorbed_revision:1}],loan:null}];
 assert.deepEqual(occurrenceIssues(snapshot,c,[event],'2026-10-09'),[]);assert.equal(snapshot.entries[0].amount_cents,'16000000');
 c.occurrences[0].payments[0].amount_cents=null;c.occurrences[0].payments[0].absorbed_revision=0;
 const issues=occurrenceIssues(snapshot,c,[event],'2026-10-09');assert.deepEqual(issues.map(x=>x.kind),['payment_source','absorption']);assert.match(build({pending:issues}).items[0].text,/有 1 项/);
});
test('all six templates and every priority satisfy forbidden-word contract',()=>{
 const cases=[{snapshots:{incomplete_count:1,points:[]}},{interval:{...interval,status:'scope_changed'}},{interval:{...interval,status:'no_income'}},{pending:[{event_id:'e',kind:'loan'}]},{reasons:{lines:[line('a','expense','100')]}},{}];
 assert.deepEqual(cases.map(c=>{const o=build(c);safe(o);return o.items[0].id;}),['incomplete','scope_changed','no_income','pending_events','records','change']);
});
