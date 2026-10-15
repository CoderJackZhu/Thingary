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
 const r=runtime('InvestmentReviewHost',{generation:'g',fromSnapshotId:'from',toSnapshotId:'to',writeVersion:1,incomes:[],blocked:false,reload(){},onPending(){},...props},undefined,undefined,{components:['investment-review/InvestmentReviewDisclosure','investment-review/InvestmentReviewCard','investment-review/InvestmentFlowDialog'],modules:{'./income-classification':classification,'./wealth':port,'./investment-review/model':model,'./asset':{money:v=>v===null?'未知':String(v),errorMessage:e=>e.message??String(e)}}});
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


import { scriptedFollowupPort, uiGeneration, uiManualDraft, uiPair, uiPreviewOf } from './helpers/planning-followup-ui-fixtures.ts';
import * as followupModel from '../src/planning-followup-ui/model.ts';
function modeHost(overrides = {}, props = {}) {
 const preview = uiPreviewOf(uiManualDraft, { confirmation: 'confirmed' });
 const { port, calls } = scriptedFollowupPort({ reviewRead: { status:'ready', value:{ draft:uiManualDraft, preview } } });
 Object.assign(port, overrides);
 const r=runtime('InvestmentReviewHost', {generation:uiGeneration,fromSnapshotId:uiPair.from_snapshot_id,toSnapshotId:uiPair.to_snapshot_id,writeVersion:1,incomes:[],blocked:false,reload(){},onPending(){},followupPort:port,movementPresentation:'review',movementsEnabled:false,...props},undefined,undefined,{
  components:['investment-review/InvestmentReviewDisclosure','investment-review/InvestmentReviewCard','planning-followup-ui/FollowupSection','planning-followup-ui/FollowupInvestmentHost'],
  modules:{'./income-classification':classification,'./investment-review/model':model,'./planning-followup-ui/model':followupModel,'./finance-contract':{reviewRecordsPeriod:(from,to)=>({kind:'range',from,to,includeFrom:false})},'./asset':{money:v=>v===null?'未知':String(v)}}
 });
 return Object.assign(r,{port,portCalls:calls});
}
const fold = r => r.find('details',p=>p.className==='ivr-advanced');
function toggleFold(r, open) { const currentTarget={open};fold(r).props.onToggle({currentTarget,target:currentTarget});r.render();return currentTarget; }
const outsideWarning = r => r.find('div',p=>p.className==='ivr-disclosure-notice');

test('both review hosts default to a native collapsed disclosure while keeping readers and results mounted',async()=>{
 for(const factory of [host, modeHost]) {
  const previews=[];const r=factory({}, {onPreviewChange:p=>previews.push(p)});await r.settle();
  assert.equal(fold(r).props.open,false);
  assert.match(r.text(r.find('summary',(_p,n)=>r.text(n).includes('投资区间核对（高级）'))),/投资区间核对（高级）/);
  assert.ok(previews.some(p=>p?.result.status==='ready'));
  assert.ok(r.find('section',p=>p['aria-label']==='投资账户区间核对'));
  toggleFold(r,true);toggleFold(r,false);await r.settle();
  assert.equal(fold(r).props.open,false);
  assert.equal(previews.filter(p=>p?.result.status==='ready').length,1);
 }
});

test('review errors and stale confirmations auto-expand; manually folding retains actionable outside warnings',async()=>{
 const stale=read();stale.result={status:'needs_review',reasons:['stale_endpoints'],change_cents:'1200000'};
 const preview=uiPreviewOf(uiManualDraft,{confirmation:'needs_review',result:stale.result});
 for(const r of [host({readInvestmentReview:async()=>stale}),modeHost({readReview:async()=>({status:'ready',value:{draft:uiManualDraft,preview}})}),host({readInvestmentReview:async()=>{throw Error('虚构读取失败');}}),modeHost({readReview:async()=>({status:'error',code:'READ_ERROR',message:'虚构读取失败'})})]) {
  await r.settle();assert.equal(fold(r).props.open,true);assert.ok(outsideWarning(r));
  toggleFold(r,false);assert.equal(fold(r).props.open,false);assert.match(r.text(outsideWarning(r)),/读取失败|待复核|重新确认/);
 }
});

test('saved-history errors and unconfirmed records remain visible outside both host disclosures',async()=>{
 const flow=read().input.flow;
 for(const r of [host({listInvestmentReviews:async()=>{throw Error('虚构列表失败');}}),host({listInvestmentReviews:async()=>({generation:'g',records:[{flow:{...flow,confirmed_complete:false},deleted:false}]})}),modeHost({listReviews:async()=>({status:'error',code:'READ_ERROR',message:'虚构列表失败'})}),modeHost({listReviews:async()=>({status:'ready',value:{generation:uiGeneration,records:[{id:'fictional',revision:1,deleted:false,pair:uiPair,from_date:'2026-10-01',to_date:'2026-10-31',mode:'manual',confirmation:'needs_review'}]}})})]) {
  await r.settle();assert.equal(fold(r).props.open,true);toggleFold(r,false);assert.match(r.text(outsideWarning(r)),/列表失败|已保存投资核对区间.*确认/);
 }
});

test('legacy dialog and port-backed followup stay mounted and cannot be folded away while editing',async()=>{
 const legacy=host();await legacy.settle();toggleFold(legacy,true);legacy.button('修改资金流动核对').props.onClick();legacy.render();
 assert.ok(legacy.find('dialog'));assert.equal(toggleFold(legacy,false).open,true);assert.equal(fold(legacy).props.open,true);assert.ok(legacy.find('dialog'));
 const current=modeHost();await current.settle();toggleFold(current,true);current.button('核对方式与完整性（手填／明细）').props.onClick();current.render();
 assert.ok(current.find('ReviewModeDialog'));assert.equal(toggleFold(current,false).open,true);assert.equal(fold(current).props.open,true);assert.ok(current.find('ReviewModeDialog'));
});

test('pending receipts auto-expand both disclosures and remain visible after a manual fold',async()=>{
 for(const factory of [host,modeHost]) {
  const r=factory({}, {pendingReceipt:true,blocked:true});await r.settle();assert.equal(fold(r).props.open,true);
  toggleFold(r,false);assert.match(r.text(outsideWarning(r)),/未确认的保存结果.*核对结果/);
  assert.equal(r.button('修改资金流动核对')?.props.disabled ?? r.button('核对方式与完整性（手填／明细）').props.disabled,true);
 }
});

test('newly arriving attention reopens a manually folded host without changing its result or receipt lock',async()=>{
 const r=modeHost();await r.settle();toggleFold(r,true);toggleFold(r,false);
 r.props.pendingReceipt=true;r.props.blocked=true;r.render();assert.equal(fold(r).props.open,true);
 toggleFold(r,false);r.render();assert.equal(fold(r).props.open,false);
 assert.match(r.text(outsideWarning(r)),/未确认的保存结果/);
});

test('empty and unrecorded reviews stay collapsed; unavailable, incomparable and invalid results remain actionable',async()=>{
 for(const [fixture, expanded] of [['not-recorded',false],['scope-changed',true],['invalid-input',true]]) {
  const r=host({readInvestmentReview:async()=>read(fixture)});await r.settle();assert.equal(fold(r).props.open,expanded);
 }
 for(const factory of [host,modeHost]) {
  const r=factory({}, {fromSnapshotId:null});await r.settle();assert.equal(fold(r).props.open,false);assert.match(r.text(fold(r)),/暂无可比较盘点/);
 }
 const preview=uiPreviewOf(uiManualDraft,{confirmation:'unavailable',saved_mode:'movements',result:{status:'unavailable',reasons:['movements_disabled']}});
 const r=modeHost({readReview:async()=>({status:'ready',value:{draft:uiManualDraft,preview}})});await r.settle();assert.equal(fold(r).props.open,true);toggleFold(r,false);assert.match(r.text(outsideWarning(r)),/暂不可用.*原核对方式保留/);
});

test('a port-backed deletion with an unknown result preserves its lock until original receipt verification',async()=>{
 const record={id:'fictional',revision:1,deleted:false,pair:uiPair,from_date:'2026-10-01',to_date:'2026-10-31',mode:'manual',confirmation:'confirmed'};
 let writes=0;
 const r=modeHost({listReviews:async()=>({status:'ready',value:{generation:uiGeneration,records:[record]}}),setReviewDeleted:async()=>{writes++;return {status:'unresolved',request_id:'original'};}});
 await r.settle();toggleFold(r,true);r.button('删除核对').props.onClick();r.render();r.button('确认删除核对').props.onClick();await r.settle();
 assert.equal(writes,1);assert.match(r.text(outsideWarning(r)),/提交结果未知|未确认的保存结果/);
 r.button('取消').props.onClick();r.render();toggleFold(r,false);assert.match(r.text(outsideWarning(r)),/未确认的保存结果/);
 assert.equal(r.button('核对方式与完整性（手填／明细）').props.disabled,true);
 r.props.writeVersion=2;r.render();await r.settle();assert.equal(r.button('核对方式与完整性（手填／明细）').props.disabled,true);
 r.props.receiptResolutionVersion=1;r.render();await r.settle();assert.equal(r.button('核对方式与完整性（手填／明细）').props.disabled,false);assert.equal(outsideWarning(r),undefined);
});


test('port-backed summary respects independent confirmation even when the result is ready',async()=>{
 for(const [confirmation,label] of [['confirmed','已核对'],['needs_review','待重新确认'],['unavailable','暂不可用'],['unconfirmed','尚未确认']]) {
  const preview=uiPreviewOf(uiManualDraft,{confirmation});
  assert.equal(preview.result.status,'ready');
  const r=modeHost({readReview:async()=>({status:'ready',value:{draft:uiManualDraft,preview}})});await r.settle();
  const summary=()=>r.find('summary',(_p,n)=>r.text(n).includes('投资区间核对（高级）'));
  assert.match(r.text(summary()),new RegExp(label));
  assert.equal(fold(r).props.open,confirmation!=='confirmed');
  if(confirmation!=='confirmed') {
   assert.doesNotMatch(r.text(summary()),/已核对/);toggleFold(r,false);assert.equal(fold(r).props.open,false);
   assert.match(r.text(outsideWarning(r)),/重新确认|暂不可用|尚未确认完整/);
  }
 }
});

test('ready confirmed review keeps excluded external investment costs visible when manually folded',async()=>{
 const message='所选投资范围损益未包含范围外账户支付的投资费用';
 const preview=uiPreviewOf(uiManualDraft,{confirmation:'confirmed',reasons:[{path:'movements',code:'external_cost_excluded',message}]});
 assert.equal(preview.result.status,'ready');
 const r=modeHost({readReview:async()=>({status:'ready',value:{draft:uiManualDraft,preview}})});await r.settle();
 assert.equal(fold(r).props.open,true);assert.match(r.text(outsideWarning(r)),new RegExp(message));
 toggleFold(r,false);assert.equal(fold(r).props.open,false);assert.match(r.text(outsideWarning(r)),new RegExp(message));
 assert.match(r.text(r.find('summary',(_p,n)=>r.text(n).includes('投资区间核对（高级）'))),/已核对/);
});
