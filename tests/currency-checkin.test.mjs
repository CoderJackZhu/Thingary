import * as holdings from '../src/holdings.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { checkInRates } from '../src/currency-picker.ts';
import * as currency from '../src/currency.ts';
import * as wealth from '../src/wealth.ts';
const source=readFileSync(new URL('../src/WealthPage.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WealthPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CheckIn');
const script=ts.transpileModule(fn.getText()+'\nmodule.exports=CheckIn;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const account=id=>({id,fields:{name:`虚构${id}`,currency:'USD',side:'asset',kind:'cash',counted:true}});
function runtime(modify,onClose=()=>{}){
 const accounts=[account('a'),account('b')],entries=accounts.map((a,i)=>({account_id:a.id,state:'entered',amount_cents:i?'800':'700',original_minor:'100',fx_rate_micro:i?'8000000':'7000000',side:'asset',kind:'cash',counted:true}));
 const draft={generation:'虚构',date:'2026-10-17',existing:{id:'虚构盘点',revision:1,date:'2026-10-17',notes:'虚构原备注',entries,missing:[]},rows:accounts.map(a=>({account:a,previous:null}))};
 modify?.(draft);
 const states=[],refs=[],deps=[],effects=[],requests=[],dirty=[];let si=0,ri=0,ei=0;const onDirtyChange=value=>dirty.push(value);
 const context={...currency, ...holdings, checkInRates, HoldingInput: 'holding-input',...wealth,module:{exports:{}},exports:{},require:()=>jsx,crypto,Icon:'icon',DateInput:'date',CurrencyInput:'fx-input',CurrencyBalance:'fx-balance',CentInput:'cents',FormRow:'row',DeleteButton:'delete',localStorage:{getItem:()=>null},
  errorMessage:e=>e.message,money:v=>`CNY${v}`,signedMoney:v=>`CNY${v}`,invoke:async()=>structuredClone(draft),submit:async req=>{requests.push(req);return draft.existing;},
  useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef:init=>{const i=ri++;return refs[i]??={current:init};},
  useEffect:(fn,next)=>{const i=ei++,old=deps[i];if(!old||next.some((v,j)=>v!==old[j])){deps[i]=next;effects.push(fn);}}
 };
 vm.runInNewContext(script,context);
 return {requests,dirty,render(){si=ri=ei=0;const tree=context.module.exports({date:'2026-10-17',today:'2026-10-17',onClose,onDirtyChange});effects.splice(0).forEach(f=>f());return tree;}};
}
function nodes(root){if(!root||typeof root!=='object')return[];if(Array.isArray(root))return root.flatMap(nodes);return[root,...nodes(root.props?.children)];}
const node=(tree,predicate)=>nodes(tree).find(n=>n.props&&predicate(n));
async function ready(r){r.render();await new Promise(setImmediate);return r.render();}
async function save(r){node(r.render(),n=>n.type==='button'&&n.props.children==='保存今天的余额').props.onClick();await new Promise(setImmediate);return r.requests.at(-1).input;}
test('虚构实际盘点处理器：混合历史汇率只改备注逐字段保留',async()=>{
 const r=runtime();let tree=await ready(r);node(tree,n=>n.type==='textarea').props.onChange({target:{value:'虚构只改备注'}});
 const input=await save(r);assert.equal(input.notes,'虚构只改备注');assert.deepEqual(input.entries.map(e=>[e.amount_cents,e.original_minor,e.fx_rate_micro]),[['700','100','7000000'],['800','100','8000000']]);
});
test('虚构实际盘点处理器：共用新率只应用明确改原币账户，不覆盖另一行旧率',async()=>{
 const r=runtime();let tree=await ready(r);node(tree,n=>n.type==='fx-input'&&n.props.label==='USD 汇率').props.onChange('9000000');
 tree=r.render();assert.equal(node(tree,n=>n.type==='fx-input'&&n.props.label==='虚构a 原币金额').props.value,'100');
 node(tree,n=>n.type==='fx-input'&&n.props.label==='虚构a 原币金额').props.onChange('200');
 const input=await save(r);assert.deepEqual(input.entries.map(e=>[e.amount_cents,e.original_minor,e.fx_rate_micro]),[['1800','200','9000000'],['800','100','8000000']]);
});

test('虚构持仓盘点实际处理器：新盘点份额价格为空且仅参考，历史两方向备注保留',async()=>{
 for(const current of [true,false]){const r=runtime(d=>{d.rows.forEach(v=>{v.account.fields.kind='fund';v.account.fields.holding_mode=current;});if(!current){d.existing.entries.forEach(v=>{v.quantity_e8='100000000';v.unit_price_e6='1000000';});}});let tree=await ready(r);node(tree,n=>n.type==='textarea').props.onChange({target:{value:'虚构保留旧输入方式'}});const input=await save(r);assert.equal(input.entries[0].quantity_e8,current?undefined:'100000000');assert.equal(input.entries[0].fx_rate_micro,'7000000');}
 const r=runtime(d=>{d.existing=null;d.rows.forEach(v=>{v.account.fields.holding_mode=true;v.account.fields.kind='fund';v.previous={amount_cents:'700',original_minor:'100',fx_rate_micro:'7000000',quantity_e8:'100000000',unit_price_e6:'1000000',date:'2026-10-01'};});});const tree=await ready(r);const inputs=nodes(tree).filter(n=>n.type==='holding-input');assert.equal(inputs.length,4);assert.ok(inputs.every(n=>n.props.value===''));assert.ok(nodes(tree).some(n=>n.props?.children?.includes?.('上次单价')));
});

test('there is no per-row same-as-last button: a new check-in prefills carried rows instead',async()=>{
 const r=runtime(d=>{d.existing=null;d.rows.forEach(v=>{v.account.fields.currency='CNY';v.previous={amount_cents:'0',date:'2026-10-01'};});});
 const tree=await ready(r);assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props.children==='与上次相同').length,0);
});
test('previousCheckInRow keeps each complete currency fact and does not copy unknown or incompatible holding inputs',async()=>{
 const r=runtime(d=>{d.existing=null;d.rows.forEach((v,i)=>v.previous={amount_cents:i?'800':'700',original_minor:'100',fx_rate_micro:i?'8000000':'7000000',date:'2026-10-01'});});
 let tree=await ready(r);
 const input=await save(r);assert.deepEqual(input.entries.map(e=>[e.state,e.amount_cents,e.original_minor,e.fx_rate_micro]),[['unchanged',null,'100','7000000'],['unchanged',null,'100','8000000']]);
 for(const previous of [null,{amount_cents:null},{amount_cents:'700'}, {amount_cents:'700',original_minor:'100',fx_rate_micro:'7000000',quantity_e8:'100000000',unit_price_e6:'1000000'}])assert.equal(wealth.previousCheckInRow(account('fictional'),previous),null);
 const q={amount_cents:'700',original_minor:'100',fx_rate_micro:'7000000',quantity_e8:'100000000',unit_price_e6:'1000000'};
 const holdingAccount=account('holding');holdingAccount.fields.holding_mode=true;assert.equal(wealth.previousCheckInRow(holdingAccount,q).quantity_e8,'100000000');
 const empty=runtime(d=>{d.existing=null;d.rows.forEach(v=>v.previous=null);});tree=await ready(empty);assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props.children==='与上次相同').length,0);
});

test('an empty day draft explains the next step and exits without submitting an empty check-in',async()=>{
 const closes=[],r=runtime(d=>{d.existing=null;d.rows=[];},saved=>closes.push(saved));
 const tree=await ready(r);
 assert.ok(nodes(tree).some(n=>n.type==='p'&&n.props.children==='这一天没有需要填写余额的账户。可以添加账户，或检查已有账户的启用、停用日期。'));
 assert.ok(!nodes(tree).some(n=>n.type==='button'&&n.props.children==='保存今天的余额'));
 const back=nodes(tree).find(n=>n.type==='button'&&n.props.children==='返回财富');assert.ok(back);back.props.onClick();
 assert.deepEqual(closes,[false]);assert.equal(r.requests.length,0);
});

test('an untouched check-in is not dirty; typing an amount makes leaving ask for confirmation',async()=>{
 const r=runtime();let tree=await ready(r);
 assert.deepEqual(r.dirty,[false],'opening the form without typing must not mark the page as editing');
 node(tree,n=>n.type==='fx-input'&&n.props.label==='虚构a 原币金额').props.onChange('200');
 tree=r.render();
 assert.equal(r.dirty.at(-1),true,'a typed amount is unsaved input');
 // The page's discard prompt uses this same dirty flag rather than form presence.
 assert.match(source,/\(!!checkIn && checkInDirty\)/);
 assert.match(source,/onDirtyChange=\{setCheckInDirty\}/);
 assert.match(source,/const \[checkInDirty, setCheckInDirty\] = useState\(false\)/);
});
