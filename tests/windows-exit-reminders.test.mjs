import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const component = main.slice(main.indexOf('type WindowsExitStatus'), main.indexOf('function App('));
const compiled = ts.transpileModule(component, {compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
function render(status, onChoice) {
  let refs = 0;
  const errors = [];
  const modal = {showModal(){this.shown=true}, close(){this.closed=true}};
  const sandbox = {
    React:{createElement(type, props, ...children){return {type,props:{...props,children}}}},
    useRef(value){return {current:refs++===0?modal:value}},
    useEffect(effect){effect()}, useState(value){return [value, v=>errors.push(v)]},
    errorMessage:error=>error.message,
  };
  vm.runInNewContext(compiled+';globalThis.renderExit=WindowsExitNotice;',sandbox);
  const tree = sandbox.renderExit({status,onChoice});
  const all = [];
  function walk(node){if(!node||typeof node!=='object')return;all.push(node);for(const child of node.props?.children?.flat(Infinity)??[])walk(child)}
  walk(tree);
  return {tree,modal,errors,buttons:all.filter(node=>node.type==='button')};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
test('pending exit is a modal with return only; Escape cancels rather than authorizing exit', async()=>{
  const choices=[];const ui=render({pending:true,message:''},async choice=>choices.push(choice));
  assert.equal(ui.modal.shown,true);
  assert.equal(ui.buttons.length,1);
  let prevented=false;ui.tree.props.onCancel({preventDefault(){prevented=true}});
  await tick();assert.equal(prevented,true);assert.deepEqual(choices,[false]);
});
test('failed exit offers explicit exit and deduplicates repeated choices until command finishes',async()=>{
  const choices=[];let done;const ui=render({pending:false,message:'timeout'},choice=>{choices.push(choice);return new Promise(resolve=>{done=resolve})});
  assert.equal(ui.buttons.length,2);
  ui.buttons[1].props.onClick();ui.buttons[1].props.onClick();
  assert.deepEqual(choices,[true]);done();await tick();
  ui.buttons[0].props.onClick();assert.deepEqual(choices,[true,false]);done();await tick();
});
test('a rejected exit choice stays visible and can be retried without changing saved data',async()=>{
  let calls=0;const ui=render({pending:false,message:'disabled'},async()=>{calls++;throw new Error('IPC failed')});
  ui.buttons[0].props.onClick();await tick();assert.deepEqual(ui.errors,['IPC failed']);
  ui.buttons[0].props.onClick();await tick();assert.equal(calls,2);assert.equal(ui.modal.closed,undefined);
});
test('native exit gates before flush permit and never clears the modal before requesting actual exit',()=>{
  const lib=readFileSync(new URL('../src-tauri/src/lib.rs',import.meta.url),'utf8');
  const native=readFileSync(new URL('../src-tauri/src/windows_exit.rs',import.meta.url),'utf8');
  const handler=lib.slice(lib.indexOf('RunEvent::ExitRequested'),lib.indexOf('RunEvent::Reopen'));
  assert.match(handler,/windows_close_event[\s\S]*windows_exit::cancel\(app\)[\s\S]*else if !windows_exit::take_permit\(app\)/);
  assert.match(native,/if ready \{\s*handle.exit\(0\);[^}]*\} else \{\s*let _ = handle.emit/);
});
