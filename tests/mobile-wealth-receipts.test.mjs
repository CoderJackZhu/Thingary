import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as wealth from '../src/wealth.ts';
import * as asset from '../src/asset.ts';
import * as currency from '../src/currency.ts';
import * as holdings from '../src/holdings.ts';
import * as format from '../src/mobile/format.ts';
function harness() {
 let cursor=0,slots=[],effects=[],reloads=0;
 const cleanups=new Map();
 const session={loading:false,busy:false,pending:null,settled:null,get navBlocked(){return this.busy||!!this.pending;},setBusy(value){this.busy=value;},refreshPending(){this.pending=wealth.storedPending();},reload(){reloads++;}};
 const react={useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){slots[i]=deps;effects.push(()=>{cleanups.get(i)?.();cleanups.set(i,fn());});}}};
 const exports={},jsx=(type,props)=>({type,props});
 const modules={react,'react/jsx-runtime':{jsx,jsxs:jsx},'@tauri-apps/api/core':{invoke:(...args)=>window.__TAURI_INTERNALS__.invoke(...args)},'../../asset':asset,'../format':format,'../../currency':currency,'../../holdings':holdings,'../../wealth':wealth,'../session':{useSession:()=>session},'../nav-context':{useReveal:()=>0},'../ui':{},'./wealth.css':{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/mobile/wealth/shared.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:id=>{if(!(id in modules))throw Error(id);return modules[id];}});
 return {session,get reloads(){return reloads;},render(name,...args){cursor=0;const value=exports[name](...args);effects.splice(0).forEach(fn=>fn());return value;}};
}
const pending=()=>({command:'wealth_snapshot_save',label:'虚构完整盘点',input:{request_id:'fictional-one',generation:'fictional',id:null,expected_revision:null,date:'2026-10-21',notes:'',entries:[]}});
function environment(invoke) {const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.window={__TAURI_INTERNALS__:{invoke}};return()=>{delete globalThis.window;delete globalThis.localStorage;};}
test('真实保存 hook：重复触发只有一个请求，未知回执阻断后续保存，匹配核对只完成一次',async()=>{
 const calls=[],cleanup=environment(async(command,args)=>{calls.push({command,args});throw Error('虚构断连');});
 try {
  const h=harness();let completed=0;const onSaved=()=>completed++;
  const writer=h.render('useWrite',onSaved),request=pending();
  await Promise.all([writer.write(request),writer.write(request)]);
  assert.equal(calls.filter(c=>c.command==='wealth_snapshot_save').length,1);
  assert.equal(wealth.storedPending().input.request_id,request.input.request_id);
  assert.equal(h.render('useWrite',onSaved).frozen,true);assert.equal(completed,0);
  await h.render('useWrite',onSaved).write({...request,input:{...request.input,request_id:'second'}});
  assert.equal(calls.filter(c=>c.command==='wealth_snapshot_save').length,1);
  window.__TAURI_INTERNALS__.invoke=async()=> 'saved-snapshot';
  const receipt=wealth.storedPending();assert.equal(await wealth.resolvePending(receipt),'saved');
  h.session.pending=null;h.session.settled=receipt;
  h.render('useWrite',onSaved);h.render('useWrite',onSaved);
  assert.equal(completed,1);assert.equal(h.reloads,1);assert.equal(wealth.storedPending(),null);
 } finally {cleanup();}
});
test('真实保存 hook：明确失败保留可编辑状态，不调用成功或伪造核对',async()=>{
 const cleanup=environment(async command=>{if(command==='wealth_request_result')return null;throw {code:'QUICK_STALE',message:'虚构金额已变化'};});
 try {const h=harness();let completed=0,failed;const onSaved=()=>completed++;const onFailure=e=>failed=e;
  await h.render('useWrite',onSaved,onFailure).write(pending());
  assert.equal(h.render('useWrite',onSaved,onFailure).frozen,false);assert.equal(completed,0);assert.equal(failed.code,'QUICK_STALE');assert.equal(wealth.storedPending(),null);
 }finally{cleanup();}
});
test('真实保存 hook：其他页面的旧核对结果不能关闭当前表单',()=>{
 const cleanup=environment(async()=>null);
 try {const h=harness();h.session.settled=pending();let completed=0;h.render('useWrite',()=>completed++);assert.equal(completed,0);}finally{cleanup();}
});
test('真实读取 hook：切换账户或 generation 后迟到结果不能覆盖新来源',async()=>{
 const h=harness();let resolveA,resolveB;
 const a=()=>new Promise(resolve=>resolveA=resolve),b=()=>new Promise(resolve=>resolveB=resolve);
 h.render('useRead','generation-a:account-a',a);
 assert.equal(h.render('useRead','generation-b:account-b',b).value,undefined);
 resolveB({id:'account-b'});await new Promise(setImmediate);
 assert.equal(h.render('useRead','generation-b:account-b',b).value.id,'account-b');
 resolveA({id:'account-a'});await new Promise(setImmediate);
 assert.equal(h.render('useRead','generation-b:account-b',b).value.id,'account-b');
});
