import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { errorMessage } from '../src/asset.ts';
import { resolvePending, pendingKey } from '../src/wealth.ts';

function runtime(props) {
  const slots = []; let cursor = 0;
  const state = initial => { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = value; }]; };
  const hooks = { useState: state, useRef: initial => state(() => ({ current: initial }))[0] };
  const exports = {};
  const source = readFileSync(new URL('../src/PendingReceiptRecovery.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(js, {exports, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === './wealth' ? {resolvePending} : {errorMessage}});
  return () => { cursor = 0; return exports.PendingReceiptRecovery(props); };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree); }
const settle = () => new Promise(resolve => setImmediate(resolve));
async function fixture(run, command = 'wealth_account_save') {
  const priorWindow = globalThis.window, priorStorage = globalThis.localStorage;
  const pending = {command, input:{request_id:'original-request',generation:'fictional-library'},label:'虚构保存'};
  const raw = JSON.stringify(pending), data = new Map([[pendingKey,raw]]), calls = [], resolved = [];
  const props = {pending,disabled:false,onResolved:r=>resolved.push(r),onImport() {}};
  let answer = async () => 'committed-object';
  globalThis.localStorage = {getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k)};
  globalThis.window = {__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push({command,args});return answer(command,args);}}};
  try { await run({props,data,calls,resolved,raw,render:runtime(props),answer:fn=>{answer=fn;}}); }
  finally { if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow; if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage; }
}

test('startup recovery checks the original receipt without invoking a write or needing an enabled module', async () => {
  await fixture(async r => {
    nodes(r.render()).find(n=>n.type==='button').props.onClick(); await settle();
    assert.deepEqual(r.resolved,['saved']); assert.equal(r.data.has(pendingKey),false);
    assert.deepEqual(r.calls,[{command:'wealth_request_result',args:{request:'original-request',generation:'fictional-library'}}]);
  });
});
test('failure keeps the exact receipt, gives retry, and blocks concurrent checking', async () => {
  await fixture(async r => {
    let reject; r.answer(()=>new Promise((_,no)=>{reject=no;}));
    const button=nodes(r.render()).find(n=>n.type==='button');button.props.onClick();button.props.onClick();
    assert.equal(r.calls.length,1);assert.equal(nodes(r.render()).find(n=>n.type==='button').props.disabled,true);
    reject(Error('fictional read failure'));await settle();
    assert.equal(r.data.get(pendingKey),r.raw);assert.deepEqual(r.resolved,[]);assert.match(text(r.render()),/原请求已保留/);
    r.answer(async()=>null);nodes(r.render()).find(n=>n.type==='button').props.onClick();await settle();
    assert.deepEqual(r.resolved,['unsaved']);assert.equal(r.calls[1].args.request,'original-request');
  });
});
test('editing prevents global checks; import recovery goes to its dedicated receipt reader', async () => {
  await fixture(async r => {r.props.disabled=true;nodes(r.render()).find(n=>n.type==='button').props.onClick();await settle();assert.equal(r.calls.length,0);assert.equal(r.data.get(pendingKey),r.raw);});
  await fixture(async r => {let opened=0;r.props.onImport=()=>opened++;nodes(r.render()).find(n=>n.type==='button').props.onClick();await settle();assert.equal(opened,1);assert.equal(r.calls.length,0);assert.equal(r.data.get(pendingKey),r.raw);},'financial_import_commit');
});
test('a different-library income receipt remains unresolved and is never replayed', async () => {
  await fixture(async r => {r.answer(async()=>{throw {code:'STALE_DATASET',message:'changed'};});nodes(r.render()).find(n=>n.type==='button').props.onClick();await settle();assert.equal(r.data.get(pendingKey),r.raw);assert.deepEqual(r.resolved,[]);assert.equal(r.calls.length,1);},'plan_income_save');
});
