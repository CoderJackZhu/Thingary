import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as arithmetic from '../src/date-picker.ts';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/DateInput.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function runtime(kind = 'DateInput', initial = '', extra = {}) {
  const state = [], changes = []; let at = 0, focus = 0;
  const props = {value: initial, label: '测试日期', onChange: v => changes.push(v), ...extra};
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
  const render = () => { at = 0; const wrapper = context.exports[kind](props); return wrapper.type(wrapper.props); };
  const find = predicate => nodes(render()).find(predicate);
  const toggle = () => find(n => n.props.className === 'date-picker-toggle').props.onClick();
  return {render, find, toggle, state, changes, focus: () => focus};
}
function key(name, composing = false) { return {key: name, nativeEvent: {isComposing: composing}, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }}; }

test('Escape dismisses only the picker, restores focus and leaves the value untouched', () => {
  const ui = runtime(); ui.toggle();
  const composing = key('Escape', true); ui.render().props.onKeyDown(composing);
  assert.equal(ui.state[0], true); assert.equal(composing.prevented, false);
  const escape = key('Escape'); ui.render().props.onKeyDown(escape);
  assert.equal(ui.state[0], false); assert.equal(escape.prevented, true); assert.equal(escape.stopped, true);
  assert.equal(ui.focus(), 1); assert.deepEqual(ui.changes, []);
});
test('empty input stays empty when opened, raw typing and explicit clearing remain distinct', () => {
  const ui = runtime('DateInput', '', {allowClear: true}); ui.toggle();
  assert.deepEqual(ui.changes, []);
  ui.find(n => n.type === 'input').props.onChange({target: {value: '2026-1'}});
  assert.deepEqual(ui.changes, ['2026-1']);
  ui.find(n => n.type === 'button' && n.props.children === '清空日期').props.onClick();
  assert.deepEqual(ui.changes, ['2026-1', '']); assert.equal(ui.state[0], false);
});
test('grid keyboard clamps at field bounds, and out-of-range day cannot be selected', () => {
  const ui = runtime('DateInput', '2026-10-07', {min: '2026-10-06', max: '2026-10-07'}); ui.toggle();
  const grid = () => ui.find(n => n.props.className === 'date-calendar-grid');
  grid().props.onKeyDown(key('ArrowRight')); assert.equal(ui.state[1], '2026-10-07');
  grid().props.onKeyDown(key('ArrowLeft')); assert.equal(ui.state[1], '2026-10-06');
  assert.equal(ui.find(n => n.props['data-value'] === '2026-10-08').props.disabled, true);
  ui.find(n => n.props['data-value'] === '2026-10-06').props.onClick();
  assert.deepEqual(ui.changes, ['2026-10-06']);
});
test('month selection returns only YYYY-MM, while navigation does not commit a value', () => {
  const ui = runtime('MonthInput', '2026-10'); ui.toggle();
  ui.find(n => n.props.className === 'date-calendar-grid').props.onKeyDown(key('ArrowDown'));
  assert.equal(ui.state[1], '2027-01'); assert.deepEqual(ui.changes, []);
  ui.find(n => n.props['data-value'] === '2027-02').props.onClick();
  assert.deepEqual(ui.changes, ['2027-02']); assert.equal(ui.state[0], false);
});

test('an incomplete related date does not disable every calendar day', () => {
  const ui = runtime('DateInput', '', {min: '2026-1', max: 'invalid'}); ui.toggle();
  assert.equal(ui.state[1], '2026-10-07');
  assert.equal(ui.find(n => n.props['data-value'] === '2026-10-07').props.disabled, false);
});
