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
function host(attentionGroups=[]){
 const states=[],refs=[],effects=[],pending=[],requests=[],calls=[],listeners=new Map();let i=0,j=0,k=0;
 const props={generation:'fictional',today:'2026-10-19',year:null,version:1,modules:{...allModules,physical:false,planning:false,expenses:false,recurring:false,virtual:false,wishlist:false},onUpdateBalances:date=>calls.push('update:'+date),onNewAccount:()=>calls.push('new'),onManageAccounts:()=>calls.push('accounts'),onNavigate:page=>calls.push(page)};
 const context={module:{exports:{}},exports:{},require:()=>jsx,ready,latestComplete,requestGate,allModules,labels:{assets:'全部物品',wealth:'账户与盘点'},
 useState:init=>{const n=i++;if(!(n in states))states[n]=typeof init==='function'?init():init;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v];},
 useRef:value=>refs[j++]??(refs[j-1]={current:value}),
 useEffect(effect,deps){const n=k++,prior=effects[n];if(!prior||deps.some((v,x)=>v!==prior.deps[x])){effects[n]={deps,cleanup:prior?.cleanup};pending.push(()=>{effects[n].cleanup?.();effects[n].cleanup=effect();});}},
 invoke:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
 window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},localStorage:{getItem:()=>null,setItem(){}},
 useRestored(){},useTrendSelection:()=>({points:[]}),hiddenKinds:()=>new Set(),attention:()=>attentionGroups,attentionSourcesReady:()=>true,errorMessage:e=>e.message,
 money:String,Info:()=>null,ReviewPlanSummary:()=>null,SavingsGoals:'savings-goals-stub',StructureCard:'structure-card-stub',Sparkline:()=>null,TrendRangeControl:()=>null,DailyCostMetric:()=>null,Icon:()=>null};
 vm.runInNewContext(script,context);
 const render=()=>{i=j=k=0;const tree=context.module.exports(props);while(pending.length)pending.shift()();return tree;};
 const action=()=>nodes(render()).find(n=>n.type==='div'&&n.props.className==='wealth-return-action')?.props.children[0];
 return{props,requests,calls,render,action,focus:()=>listeners.get('focus')?.(),unmount:()=>effects.forEach(e=>e.cleanup?.())};
}
test('home offers an action only when there is no account yet; existing accounts add no urgency at the top',async()=>{
 {const h=host();h.render();h.requests[0].resolve(review({status:'ready',value:{total:0,due_today:0}}));await settle();
  const button=h.action();assert.equal(text(button),'添加第一个账户');assert.equal(button.props.disabled,false);button.props.onClick();assert.deepEqual(h.calls,['new']);h.unmount();}
 for(const counts of [{total:2,due_today:2},{total:2,due_today:0}]){
  const h=host();h.render();h.requests[0].resolve(review({status:'ready',value:counts}));await settle();
  assert.equal(h.action(),undefined);assert.deepEqual(h.calls,[]);h.unmount();
 }
});
test('unknown, unavailable and invalid counts retry without opening an empty check-in or new account',async()=>{
 for(const availability of [undefined,unavailable,{status:'ready',value:{total:-1,due_today:0}},{status:'ready',value:{total:0,due_today:1}},{status:'ready',value:{total:1,due_today:NaN}}]){
  const h=host();h.render();h.requests[0].resolve(review(availability));await settle();const button=h.action();assert.equal(text(button),'重新读取账户');button.props.onClick();h.render();assert.equal(h.requests.length,2);assert.deepEqual(h.calls,[]);h.unmount();
 }
});
test('refresh withdraws the stale action; failure offers retry and a later success chooses from fresh facts',async()=>{
 const h=host();h.render();h.requests[0].resolve(review({status:'ready',value:{total:0,due_today:0}}));await settle();assert.equal(text(h.action()),'添加第一个账户');
 h.focus();h.render();assert.equal(h.action(),undefined);assert.deepEqual(h.calls,[]);
 h.requests[1].reject(Error('fictional read failure'));await settle();const retry=h.action();assert.equal(text(retry),'重新读取账户');retry.props.onClick();h.render();
 h.requests[2].resolve(review({status:'ready',value:{total:1,due_today:1}}));await settle();assert.equal(h.action(),undefined);assert.deepEqual(h.calls,[]);h.unmount();
});
test('late old-library availability cannot choose an action in the new library',async()=>{
 const h=host();h.render();h.props.generation='other-fictional';h.render();h.requests[0].resolve(review({status:'ready',value:{total:0,due_today:0}}));await settle();assert.equal(h.action(),undefined);
 h.requests[1].resolve(review({status:'ready',value:{total:1,due_today:0}},'other-fictional'));await settle();assert.equal(h.action(),undefined);h.unmount();
});
test('a disabled account module exposes no balance action',async()=>{
 const h=host();h.props.modules.wealth=false;h.render();h.requests[0].resolve(review(unavailable));await settle();assert.equal(h.action(),undefined);h.unmount();
});

test('a different result day cannot enable a balance action and offers a reload',async()=>{
 const h=host();h.render();const result=review({status:'ready',value:{total:1,due_today:1}});result.today='2026-10-20';h.requests[0].resolve(result);await settle();
 assert.equal(h.action(),undefined);const tree=h.render();assert.match(text(tree),/日期已变化/);nodes(tree).find(n=>n.type==='button'&&text(n)==='重新读取').props.onClick();h.render();assert.equal(h.requests.length,2);assert.deepEqual(h.calls,[]);h.unmount();
});

test('an account with no snapshots shows no top balance prompt and keeps an independent physical empty-state link',async()=>{
 const h=host();h.props.modules.physical=true;h.render();const data=review({status:'ready',value:{total:1,due_today:1}});data.physical={status:'ready',value:{held_count:0,held_known_cents:'0',held_unknown_price_count:0,active_count:0,retired_count:0,categories:[],average_holding_days:null}};h.requests[0].resolve(data);await settle();
 const tree=h.render();assert.doesNotMatch(text(tree),/建立账户并盘点|从这里开始/);assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n)==='更新今天的余额').length,0);
 const physical=nodes(tree).find(n=>n.type==='button'&&text(n)==='去记录物品 →');assert.ok(physical);physical.props.onClick();assert.deepEqual(h.calls,['assets']);h.unmount();
});

test('attention appears as a compact top brief only when needed, while the full lists stay below the holdings',async()=>{
 const empty=host();empty.render();empty.requests[0].resolve(review({status:'ready',value:{total:1,due_today:0}}));await settle();
 assert.equal(nodes(empty.render()).find(n=>n.type==='aside'&&n.props['aria-label']==='待关注提醒'),undefined);empty.unmount();

 const groups=[{id:'due',priority:1,date:'2026-10-19',title:'虚构到期待付款',details:['付款待确认 · 2026-10-19'],entries:[{action:'进入计划',target:{kind:'plan',id:'p'}}]},{id:'right',priority:2,date:'2026-10-20',title:'虚构即将到期权益',details:[],entries:[]}];
 const h=host(groups);h.props.modules={...h.props.modules,physical:true,recurring:true};h.render();
 const data=review({status:'ready',value:{total:1,due_today:0}});data.wealth.value.structure_date='2026-10-15';data.wealth.value.structure=[{kind:'cash',amount_cents:'100',share_hundredths:10000}];data.wealth.value.liabilities=[];data.physical={status:'ready',value:{held_count:1,held_known_cents:'100',held_unknown_price_count:0,active_count:1,retired_count:0,categories:[],average_holding_days:1,held_daily:{}}};data.recurring={status:'ready',value:{monthly_cents:'0'}};
 h.requests[0].resolve(data);await settle();
 const tree=h.render(),all=nodes(tree),brief=all.find(n=>n.type==='aside'&&n.props['aria-label']==='待关注提醒');
 assert.match(text(brief),/2 项需要关注/);assert.match(text(brief),/虚构到期待付款/);
 const order=['structure-card-stub','持有物品','固定负担','待关注','近期记录','savings-goals-stub'].map(label=>all.findIndex(n=>n.type===label||text(n)===label));
 assert.ok(order.every(index=>index>=0)&&order.every((index,i)=>i===0||order[i-1]<index));
 const heading=all.find(n=>n.type==='h3'&&text(n)==='待关注'),moves=[];heading.props.ref.current={scrollIntoView:value=>moves.push(['scroll',value.block]),focus:value=>moves.push(['focus',value.preventScroll])};
 all.find(n=>n.type==='button'&&text(n)==='查看待关注 →').props.onClick();
 assert.deepEqual(moves,[['scroll','start'],['focus',true]]);h.unmount();
});
