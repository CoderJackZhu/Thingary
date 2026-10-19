import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {allModules} from '../src/modules.ts';
import {ready,latestComplete,requestGate} from '../src/review.ts';
const source=ts.createSourceFile('ReviewView.tsx',readFileSync(new URL('../src/ReviewView.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReviewView');
const script=ts.transpileModule(fn.getText(source)+'\nmodule.exports=ReviewView;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
const unavailable={status:'error',value:{code:'MODULE_DISABLED',message:''}};
const review=(availability,generation='fictional')=>({generation,today:'2026-10-19',year:null,account_availability:availability,wealth:{status:'ready',value:{points:[],structure:[],liabilities:[]}},physical:unavailable,expenses:unavailable,recurring:unavailable,virtual_assets:unavailable,recent:{status:'ready',value:[]},planning:null});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function host(){
 const states=[],refs=[],effects=[],pending=[],requests=[],calls=[],listeners=new Map();let i=0,j=0,k=0;
 const props={generation:'fictional',today:'2026-10-19',year:null,version:1,modules:{...allModules,physical:false,planning:false,expenses:false,recurring:false,virtual:false,wishlist:false},onUpdateBalances:date=>calls.push('update:'+date),onNewAccount:()=>calls.push('new'),onManageAccounts:()=>calls.push('accounts'),onNavigate:page=>calls.push(page)};
 const context={module:{exports:{}},exports:{},require:()=>jsx,ready,latestComplete,requestGate,allModules,labels:{assets:'全部物品',wealth:'账户与盘点'},
 useState:init=>{const n=i++;if(!(n in states))states[n]=typeof init==='function'?init():init;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v];},
 useRef:value=>refs[j++]??(refs[j-1]={current:value}),
 useEffect(effect,deps){const n=k++,prior=effects[n];if(!prior||deps.some((v,x)=>v!==prior.deps[x])){effects[n]={deps,cleanup:prior?.cleanup};pending.push(()=>{effects[n].cleanup?.();effects[n].cleanup=effect();});}},
 invoke:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
 window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},localStorage:{getItem:()=>null,setItem(){}},
 useRestored(){},useTrendSelection:()=>({points:[]}),hiddenKinds:()=>new Set(),attention:()=>[],attentionSourcesReady:()=>true,errorMessage:e=>e.message,
 money:String,Info:()=>null,ReviewPlanSummary:()=>null,SavingsGoals:()=>null,StructureCard:()=>null,Sparkline:()=>null,TrendRangeControl:()=>null,DailyCostMetric:()=>null,Icon:()=>null};
 vm.runInNewContext(script,context);
 const render=()=>{i=j=k=0;const tree=context.module.exports(props);while(pending.length)pending.shift()();return tree;};
 const action=()=>nodes(render()).find(n=>n.type==='div'&&n.props.className==='wealth-return-action')?.props.children[0];
 return{props,requests,calls,render,action,focus:()=>listeners.get('focus')?.(),unmount:()=>effects.forEach(e=>e.cleanup?.())};
}
test('home uses the account source, not the existence of a check-in, to choose a useful action',async()=>{
 for(const [counts,label,call] of [[{total:0,due_today:0},'添加第一个账户','new'],[{total:2,due_today:2},'更新今天的余额','update:2026-10-19'],[{total:2,due_today:0},'查看已有账户','accounts']]){
  const h=host();h.render();h.requests[0].resolve(review({status:'ready',value:counts}));await settle();
  const button=h.action();assert.equal(text(button),label);assert.equal(button.props.disabled,false);button.props.onClick();assert.deepEqual(h.calls,[call]);h.unmount();
 }
});
test('unknown, unavailable and invalid counts retry without opening an empty check-in or new account',async()=>{
 for(const availability of [undefined,unavailable,{status:'ready',value:{total:-1,due_today:0}},{status:'ready',value:{total:0,due_today:1}},{status:'ready',value:{total:1,due_today:NaN}}]){
  const h=host();h.render();h.requests[0].resolve(review(availability));await settle();const button=h.action();assert.equal(text(button),'重新读取账户');button.props.onClick();h.render();assert.equal(h.requests.length,2);assert.deepEqual(h.calls,[]);h.unmount();
 }
});
test('refresh disables the stale action; failure offers retry and a later success chooses from fresh facts',async()=>{
 const h=host();h.render();h.requests[0].resolve(review({status:'ready',value:{total:0,due_today:0}}));await settle();assert.equal(text(h.action()),'添加第一个账户');
 h.focus();h.render();const waiting=h.action();assert.equal(waiting.props.disabled,true);assert.equal(text(waiting),'正在确认账户…');waiting.props.onClick();assert.deepEqual(h.calls,[]);
 h.requests[1].reject(Error('fictional read failure'));await settle();const retry=h.action();assert.equal(text(retry),'重新读取账户');retry.props.onClick();h.render();
 h.requests[2].resolve(review({status:'ready',value:{total:1,due_today:1}}));await settle();assert.equal(text(h.action()),'更新今天的余额');h.action().props.onClick();assert.deepEqual(h.calls,['update:2026-10-19']);h.unmount();
});
test('late old-library availability cannot choose an action in the new library',async()=>{
 const h=host();h.render();h.props.generation='other-fictional';h.render();h.requests[0].resolve(review({status:'ready',value:{total:0,due_today:0}}));await settle();assert.equal(h.action(),undefined);
 h.requests[1].resolve(review({status:'ready',value:{total:1,due_today:0}},'other-fictional'));await settle();assert.equal(text(h.action()),'查看已有账户');h.unmount();
});
test('a disabled account module exposes no balance action',async()=>{
 const h=host();h.props.modules.wealth=false;h.render();h.requests[0].resolve(review(unavailable));await settle();assert.equal(h.action(),undefined);h.unmount();
});

test('a different result day cannot enable a balance action and offers a reload',async()=>{
 const h=host();h.render();const result=review({status:'ready',value:{total:1,due_today:1}});result.today='2026-10-20';h.requests[0].resolve(result);await settle();
 assert.equal(h.action(),undefined);const tree=h.render();assert.match(text(tree),/日期已变化/);nodes(tree).find(n=>n.type==='button'&&text(n)==='重新读取').props.onClick();h.render();assert.equal(h.requests.length,2);assert.deepEqual(h.calls,[]);h.unmount();
});

test('an account with no snapshots has one consistent balance action and an independent physical empty-state link',async()=>{
 const h=host();h.props.modules.physical=true;h.render();const data=review({status:'ready',value:{total:1,due_today:1}});data.physical={status:'ready',value:{held_count:0,held_known_cents:'0',held_unknown_price_count:0,active_count:0,retired_count:0,categories:[],average_holding_days:null}};h.requests[0].resolve(data);await settle();
 const tree=h.render();assert.doesNotMatch(text(tree),/建立账户并盘点|从这里开始/);assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n)==='更新今天的余额').length,1);
 const physical=nodes(tree).find(n=>n.type==='button'&&text(n)==='去记录物品 →');assert.ok(physical);physical.props.onClick();assert.deepEqual(h.calls,['assets']);h.unmount();
});
