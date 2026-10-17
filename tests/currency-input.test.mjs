import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as currency from '../src/currency.ts';
import { quickChanges } from '../src/wealth.ts';

const code = ts.transpileModule(readFileSync(new URL('../src/CurrencyInput.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function input({ places = 2, signed = false, value = '12345', disabled = false } = {}) {
  const slots = [], deps = [], effects = [], changes = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(fn, next) { const i = cursor++; if (!deps[i] || next.some((v, j) => !Object.is(v, deps[i][j]))) { deps[i] = next; effects.push(fn); } },
  };
  const exports = {}, props = { label: '虚构原币金额', places, signed, value, disabled, onChange(next) { props.value = next; changes.push(next); } };
  vm.runInNewContext(code, { exports, Error, require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : currency });
  const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
  const render = () => { let tree; for (let i = 0; i < 2; i++) { cursor = 0; tree = exports.CurrencyInput(props); effects.splice(0).forEach(fn => fn()); } return tree; };
  const field = () => nodes(render()).find(n => n.type === 'input');
  return { props, changes, render, nodes, field, change(text) { field().props.onChange({ target: { value: text } }); render(); }, alerts() { return nodes(render()).filter(n => n.props?.role === 'alert'); } };
}
test('虚构实际CurrencyInput：非法粘贴保留原文、清空已知父值，阻止沿用旧原币金额或汇率保存', () => {
  const draft = { date: '2026-10-17', existing: null, rows: [{ account: { id: 'a', fields: { name: '虚构美元', currency: 'USD', side: 'asset', kind: 'cash', counted: true } }, previous: null }] };
  const amount = input(), rate = input({ places: 6, value: '7000000' });
  assert.equal(quickChanges(draft, 'a', 'balance', amount.props.value, '', '', rate.props.value)[0].amount_cents, '86415');
  for (const invalid of ['$999.00', '1,23.45', 'abc', '1e3', '12\n34', '999999999999999999999999']) {
    amount.change(invalid); assert.equal(amount.field().props.value, invalid); assert.equal(amount.props.value, ''); assert.equal(amount.field().props['aria-invalid'], true); assert.equal(amount.alerts().length, 1);
    assert.throws(() => quickChanges(draft, 'a', 'balance', amount.props.value, '', '', rate.props.value));
  }
  amount.change('123.45'); rate.change('7.1234567'); assert.equal(rate.props.value, ''); assert.equal(rate.field().props.value, '7.1234567'); assert.match(rate.alerts()[0].props.children, /最多填写6位/);
  assert.throws(() => quickChanges(draft, 'a', 'balance', amount.props.value, '', '', rate.props.value));
  rate.change('7.123456'); assert.equal(rate.props.value, '7123456'); assert.equal(rate.field().props['aria-invalid'], false); assert.equal(rate.alerts().length, 0);
  assert.equal(quickChanges(draft, 'a', 'balance', amount.props.value, '', '', rate.props.value)[0].amount_cents, '87939');
});
test('虚构合法千分位粘贴：逗号、普通/不换行/窄空格及有符号金额保留精确整数', () => {
  for (const text of ['1,234.56', ' 1 234.56 ', '1\u00a0234.56', '1\u202f234.56', '1\u2009234.56']) {
    const h = input(); h.change(text); assert.equal(h.props.value, '123456'); assert.equal(h.field().props.value, text); assert.equal(h.field().props['aria-invalid'], false);
  }
  const signed = input({ signed: true }); signed.change('-1 234.56'); assert.equal(signed.props.value, '-123456');
  for (const text of ['1,234,567.89', '1 234 567.89']) { signed.change(text); assert.equal(signed.props.value, '123456789'); }
  for (const text of ['12,34', '1 23', '1234,567', '1,234 567', '1.2 3', '--1']) { signed.change(text); assert.equal(signed.props.value, ''); assert.equal(signed.field().props.value, text); assert.equal(signed.alerts().length, 1); }
});
test('虚构正常编辑：负号、小数点、明确零与空白不同，不跳光标重写显示值', () => {
  const h = input({ value: '', signed: true });
  for (const [raw, value] of [['-', ''], ['-.', ''], ['-.5', '-50'], ['-0.50', '-50'], ['1.', '100'], ['1.20', '120'], ['0', '0'], ['', '']]) {
    h.change(raw); assert.equal(h.field().props.value, raw); assert.equal(h.props.value, value); assert.equal(h.alerts().length, 0);
  }
  const positive = input(); positive.change('-1'); assert.equal(positive.props.value, ''); assert.equal(positive.alerts().length, 1);
  positive.change('.5'); assert.equal(positive.props.value, '50'); positive.change('  '); assert.equal(positive.props.value, ''); assert.equal(positive.alerts().length, 0);
});
test('虚构精度与外部值刷新：JPY只收整数，六位汇率不截断，外部回填和disabled保留', () => {
  const yen = input({ places: 0, value: '1234' }); yen.change('1,234'); assert.equal(yen.props.value, '1234');
  for (const text of ['1.0', '1.']) { yen.change(text); assert.equal(yen.props.value, ''); assert.equal(yen.field().props.value, text); assert.match(yen.alerts()[0].props.children, /不支持小数/); }
  yen.change('0'); assert.equal(yen.props.value, '0');
  const h = input(); h.change('1.234'); assert.equal(h.props.value, ''); assert.match(h.alerts()[0].props.children, /最多填写2位/);
  h.props.value = '24680'; assert.equal(h.field().props.value, '246.80'); assert.equal(h.alerts().length, 0);
  h.props.places = 0; assert.equal(h.field().props.value, '24680'); h.props.disabled = true; assert.equal(h.field().props.disabled, true);
});
