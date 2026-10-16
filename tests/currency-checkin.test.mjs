import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as currency from '../src/currency.ts';
import * as wealth from '../src/wealth.ts';
const source=readFileSync(new URL('../src/WealthPage.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('WealthPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CheckIn');
const script=ts.transpileModule(fn.getText()+'\nmodule.exports=CheckIn;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const account=id=>({id,fields:{name:`虚构${id}`,currency:'USD',side:'asset',kind:'cash',counted:true}});
function runtime(){
 const accounts=[account('a'),account('b')],entries=accounts.map((a,i)=>({account_id:a.id,state:'entered',amount_cents:i?'800':'700',original_minor:'100',fx_rate_micro:i?'8000000':'7000000',side:'asset',kind:'cash',counted:true}));
 const draft={generation:'虚构',date:'2026-10-17',existing:{id:'虚构盘点',revision:1,date:'2026-10-17',notes:'虚构原备注',entries,missing:[]},rows:accounts.map(a=>({account:a,previous:null}))};
 const states=[],refs=[],deps=[],effects=[],requests=[];let si=0,ri=0,ei=0;
 const context={...currency,...wealth,module:{exports:{}},exports:{},require:()=>jsx,crypto,Icon:'icon',DateInput:'date',CurrencyInput:'fx-input',CurrencyBalance:'fx-balance',CentInput:'cents',FormRow:'row',DeleteButton:'delete',localStorage:{getItem:()=>null},
  errorMessage:e=>e.message,money:v=>`CNY${v}`,signedMoney:v=>`CNY${v}`,invoke:async()=>structuredClone(draft),submit:async req=>{requests.push(req);return draft.existing;},
  useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef:init=>{const i=ri++;return refs[i]??={current:init};},
  useEffect:(fn,next)=>{const i=ei++,old=deps[i];if(!old||next.some((v,j)=>v!==old[j])){deps[i]=next;effects.push(fn);}}
 };
 vm.runInNewContext(script,context);
 return {requests,render(){si=ri=ei=0;const tree=context.module.exports({date:'2026-10-17',today:'2026-10-17',onClose(){}});effects.splice(0).forEach(f=>f());return tree;}};
}
function nodes(root){if(!root||typeof root!=='object')return[];if(Array.isArray(root))return root.flatMap(nodes);return[root,...nodes(root.props?.children)];}
const node=(tree,predicate)=>nodes(tree).find(n=>n.props&&predicate(n));
async function ready(r){r.render();await new Promise(setImmediate);return r.render();}
async function save(r){node(r.render(),n=>n.type==='button'&&n.props.children==='保存更正').props.onClick();await new Promise(setImmediate);return r.requests.at(-1).input;}
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
