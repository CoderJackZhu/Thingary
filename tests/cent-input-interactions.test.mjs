import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/FormControls.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function input(signed = false) {
  const changes = [];
  const context = { exports: {}, require(name) {
    if (name === 'react') return { useState: v => [v, () => {}], useEffect() {}, createContext: () => ({}) };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === './form-hint') return { useFormHint: () => 'amount-hint' };
    return {};
  }};
  vm.runInNewContext(compiled, context);
  const node = context.exports.CentInput({ label: '每月能存的钱', value: '', signed, onChange: v => changes.push(v) });
  return { changes, node, type: value => node.props.onChange({ target: { value } }) };
}

test('signed contribution input keeps negative integer cents, explicit zero and unknown distinct after merging shared controls', () => {
  const ui = input(true);
  for (const value of ['-12.34', '0', '', '-']) ui.type(value);
  assert.deepEqual(ui.changes, ['-1234', '0', '', '']);
  assert.equal(ui.node.props['aria-describedby'], 'amount-hint');
  assert.equal(ui.node.props['aria-label'], '每月能存的钱');
});

test('ordinary amount fields still reject negative values and excess precision', () => {
  const ui = input();
  for (const value of ['-1', '1.234', '12.34']) ui.type(value);
  assert.deepEqual(ui.changes, ['1234']);
});
