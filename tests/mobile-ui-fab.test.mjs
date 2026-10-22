import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
function loadFab(covered) {
  const js = ts.transpileModule(readFileSync(new URL('../src/mobile/ui/Fab.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const m = { exports: {} };
  const mods = { 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, '../nav-context': { useCovered: () => covered }, './Icon': { Icon: 'Icon' } };
  vm.runInNewContext(js, { module: m, exports: m.exports, require: id => mods[id] });
  return m.exports.Fab;
}
test('Fab renders an accessible round button with the plus icon by default', () => {
  let clicks = 0;
  const node = loadFab(false)({ label: '新增物品', onClick: () => clicks++ });
  assert.equal(node.type, 'button'); assert.equal(node.props.className, 'm-fab'); assert.equal(node.props['aria-label'], '新增物品');
  assert.equal(node.props.children.props.name, 'plus');
  node.props.onClick(); assert.equal(clicks, 1);
});
test('Fab is absent while hidden is set or a sheet or modal covers the page', () => {
  assert.equal(loadFab(false)({ label: 'x', onClick() {}, hidden: true }), null);
  assert.equal(loadFab(true)({ label: 'x', onClick() {} }), null);
});
test('Fab stays above the tab bar and the safe area, below sheets', () => {
  const css = readFileSync(new URL('../src/mobile/ui/ui.css', import.meta.url), 'utf8');
  const rule = css.match(/\.m-fab\{[^}]*\}/)[0];
  assert.match(rule, /bottom:calc\(var\(--m-tabbar-h\)/); assert.match(rule, /env\(safe-area-inset-right/);
  const z = Number(rule.match(/z-index:(\d+)/)[1]); assert.ok(z < 10 && z > 5, 'between content and tab bar level');
});
