import * as classification from '../src/income-classification.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as model from '../src/investment-review/model.ts';
import { reviewFixtures } from '../src/investment-review/fixtures.ts';
class Unresolved extends Error {}
const read = (key='ready-profit') => ({generation:'g',...structuredClone(reviewFixtures[key]),from_value_key:'opaque-from',to_value_key:'opaque-to',records:[]});
function host(overrides={},props={}){
 const calls=[],trash=[];let pending=null;
 const port={readInvestmentReview:async()=>read(),listInvestmentReviews:async()=>({generation:'g',records:[]}),saveInvestmentReview:async input=>{calls.push(input);return read().input.flow;},trashInvestmentReview:async input=>trash.push(input),storedPending:()=>pending,Unresolved,...overrides};
 const r=runtime('InvestmentReviewHost',{generation:'g',fromSnapshotId:'from',toSnapshotId:'to',writeVersion:1,incomes:[],blocked:false,reload(){},onPending(){},...props},undefined,undefined,{components:['investment-review/InvestmentReviewCard','investment-review/InvestmentFlowDialog'],modules:{'./income-classification':classification,'./wealth':port,'./investment-review/model':model,'./asset':{money:v=>v===null?'未知':String(v),errorMessage:e=>e.message??String(e)}}});
 return Object.assign(r,{saved:calls,trashed:trash,setPending:v=>pending=v});
}
test('host reads domain result and submits opaque endpoint keys once without recomputing',async()=>{
 const r=host();await r.settle();r.button('修改资金流动核对').props.onClick();r.render();const form=r.find('form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await r.settle();assert.equal(r.saved.length,1);assert.equal(r.saved[0].from_value_key,'opaque-from');assert.equal(r.saved[0].to_value_key,'opaque-to');assert.equal(r.saved[0].fields.inflow_cents,'1000000');assert.equal(r.saved[0].expected_revision,3);
});
test('save error leaves draft and explicit zero intact',async()=>{const r=host({saveInvestmentReview:async()=>{throw Error('虚构冲突');}});await r.settle();r.button('修改资金流动核对').props.onClick();r.render();r.find('form').props.onSubmit({preventDefault(){}});await r.settle();assert.ok(r.find('dialog'));assert.match(r.text(r.find('dialog')),/虚构冲突/);assert.ok(r.find('input',p=>p.value==='0'));});
test('unresolved saves freeze replay and offer close without discarding receipt',async()=>{let n=0,r;r=host({saveInvestmentReview:async()=>{n++;r.setPending({request_id:'original'});throw new Unresolved('结果未知');}});await r.settle();r.button('修改资金流动核对').props.onClick();r.render();r.find('form').props.onSubmit({preventDefault(){}});await r.settle();r.find('form').props.onSubmit({preventDefault(){}});await r.settle();assert.equal(n,1);r.button('关闭，稍后核对').props.onClick();r.render();assert.ok(!r.find('dialog'));});
test('read error stays separate from saved interval list and permits restore',async()=>{const flow=read().input.flow;const r=host({readInvestmentReview:async()=>{throw Error('端点已删除');},listInvestmentReviews:async()=>({generation:'g',records:[{flow,deleted:true}]})});await r.settle();assert.ok(r.button('恢复核对'));r.button('恢复核对').props.onClick();await r.settle();assert.equal(r.trashed[0].deleted,false);assert.equal(r.trashed[0].expected_revision,flow.revision);});
test('overlap restoration rejection retains record and explanation',async()=>{const flow=read().input.flow;const r=host({listInvestmentReviews:async()=>({generation:'g',records:[{flow,deleted:true}]}),trashInvestmentReview:async()=>{throw Error('区间重叠，请先解决冲突');}});await r.settle();r.button('恢复核对').props.onClick();await r.settle();assert.ok(r.button('恢复核对'));assert.ok(r.nodes().some(n=>n.props?.role==='alert'&&r.text(n).includes('区间重叠')));});
test('foreign-generation data never becomes editable',async()=>{const r=host({readInvestmentReview:async()=>({...read(),generation:'other'})});await r.settle();assert.ok(!r.button('修改资金流动核对'));assert.ok(r.button('重新读取投资区间'));});
test('investment review has no retirement profile dependency and unknown income associations stay unassigned',async()=>{
 const r=host({}, {incomes:[{id:'i1',revision:1,fields:{date:'2026-08-01',net_cents:'25000',hpf_cents:null,notes:'虚构分红',category:'cash_dividend',source_account_id:null,destination:'unknown',receiving_account_id:null}}]});await r.settle();assert.ok(r.button('修改资金流动核对'));assert.ok(r.nodes().some(n=>n.type==='li'&&r.text(n).includes('未归属明细')));
});
test('missing endpoints stay empty instead of inventing a zero balance or allowing save',async()=>{
 const r=host({}, {fromSnapshotId:null});await r.settle();assert.ok(!r.button('修改资金流动核对'));assert.equal(r.saved.length,0);
});
test('disabled wealth read remains error with no writable fabricated account',async()=>{
 const r=host({readInvestmentReview:async()=>{throw Error('资产与盘点模块已关闭');}});await r.settle();assert.ok(!r.button('修改资金流动核对'));assert.ok(r.nodes().some(n=>n.props?.role==='alert'&&r.text(n).includes('资产与盘点模块已关闭')));assert.equal(r.saved.length,0);
});
test('account display names come from factual account metadata without changing the calculation DTO',async()=>{
 const r=host({}, {accountNames:{'acc-inv-01':'虚构券商账户','acc-fund-02':'虚构基金账户'}});await r.settle();assert.ok(r.nodes().some(n=>n.type==='td'&&r.text(n)==='虚构券商账户'));assert.ok(r.nodes().some(n=>n.type==='td'&&r.text(n).startsWith('历史账户')));r.button('修改资金流动核对').props.onClick();r.render();assert.match(r.text(r.find('dialog')),/虚构基金账户/);assert.doesNotMatch(r.text(r.find('dialog')),/acc-inv-01/);
});
test('stale endpoint keys cannot silently inherit the old complete confirmation',async()=>{
 const v=read();v.result={status:'needs_review',reasons:['stale_endpoints'],change_cents:'1200000'};assert.equal(v.input.flow.confirmed_complete,true);
 const r=host({readInvestmentReview:async()=>v});await r.settle();const edit=r.nodes().find(n=>n.type==='button'&&r.text(n).includes('重新核对'));assert.ok(edit);edit.props.onClick();r.render();const confirmation=r.find('input',p=>p.type==='checkbox'&&p.checked===false);assert.ok(confirmation);r.find('form').props.onSubmit({preventDefault(){}});await r.settle();assert.equal(r.saved[0].fields.confirmed_complete,false);
});
