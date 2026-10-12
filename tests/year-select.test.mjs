import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as arithmetic from '../src/date-picker.ts';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/YearSelect.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function runtime(initial = null, extra = {}) {
  const state = [], changes = []; let at = 0, focus = 0;
  const props = {value: initial, todayYear:2026, label: '年份', onChange: v => changes.push(v), ...extra};
  const jsx = (type, props) => ({type, props});
  const hooks = {
    useState(value) { const i = at++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef() { return {current: {focus() { focus++; }, closest() { return null; }}}; },
    useId: () => 'test-panel', useEffect() {}, useLayoutEffect() {},
  };
  const context = {exports: {}, document: {body: {}}, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'fragment'};
    if (name === 'react-dom') return {createPortal: node => node};
    if (name === './asset') return {localDay: () => '2026-10-07'};
    if (name === './date-picker') return arithmetic;
    if (name === './YearSelect') return {YearSelect: props => jsx('select', {'aria-label':'年份', ...props})};
    if (name === './form-hint') return {useFormHint: help => help, useFormLabel: label => label};
    if (name === './date-input.css') return {};
    throw new Error(name);
  }};
  vm.runInNewContext(compiled, context);
  function nodes(node, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (node.props) { result.push(node); for (const child of [node.props.children].flat(Infinity)) nodes(child, result); }
    return result;
  }
  const render = () => { at = 0; return context.exports.YearSelect(props); };
  const find = predicate => nodes(render()).find(predicate);
  const toggle = () => find(n => n.type === 'select').props.onChange({target:{value:'other'}});
  return {render, find, toggle, state, changes, focus: () => focus};
}
function key(name, composing = false) { return {key: name, nativeEvent: {isComposing: composing}, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }}; }

test('other years open without changing a value; selecting a page year commits once', () => {
  const ui=runtime(1980,{intent:'past'});ui.toggle();assert.deepEqual(ui.changes,[]);
  assert.equal(ui.state[1],1980);
  ui.find(n=>n.props['data-year']===1978).props.onClick();
  assert.deepEqual(ui.changes,[1978]);assert.equal(ui.state[0],false);assert.equal(ui.focus(),1);
});
test('cancel and composing Escape keep unknown year untouched', () => {
  const ui=runtime();ui.toggle();ui.render().props.onKeyDown(key('Escape',true));assert.equal(ui.state[0],true);
  const escape=key('Escape');ui.render().props.onKeyDown(escape);assert.equal(escape.stopped,true);assert.deepEqual(ui.changes,[]);
  ui.toggle();ui.find(n=>n.type==='button'&&n.props.children==='取消').props.onClick();assert.deepEqual(ui.changes,[]);
});
test('long year trigger keeps focus on mouse down until the nested popup can receive it', () => {
  const ui=runtime(null,{intent:'long'});const trigger=ui.find(n=>n.props.className==='year-select-trigger');
  let prevented=false;trigger.props.onMouseDown({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  trigger.props.onClick();assert.equal(ui.state[0],true);assert.deepEqual(ui.changes,[]);
});
test('disabled years cannot open or commit; bound years are disabled in grid', () => {
  const blocked=runtime(2026,{disabled:true});blocked.toggle();assert.equal(blocked.state[0],false);
  const ui=runtime(2026,{max:2026});ui.toggle();assert.equal(ui.find(n=>n.props['data-year']===2027).props.disabled,true);
  ui.find(n=>n.props['data-year']===2027).props.onClick();assert.deepEqual(ui.changes,[]);
});
