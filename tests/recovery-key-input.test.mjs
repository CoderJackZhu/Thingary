import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/BackupSecurity.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('BackupSecurity.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'KeyInput');
const code = ts.transpileModule(fn.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function inputRuntime() {
  const refs = [], effects = [], changed = [];
  let refAt = 0, effectAt = 0, tree;
  const props = { busy: false, value: '', onChange(value) { props.value = value; changed.push(value); } };
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, require: () => ({ jsx, jsxs: jsx }),
    useRef(value) { return refs[refAt++] ??= { current: value }; },
    useEffect(callback, deps) {
      const at = effectAt++, previous = effects[at];
      if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
      previous?.cleanup?.(); effects[at] = { deps, cleanup: callback() };
    },
  };
  vm.runInNewContext(code, context);
  function render() { refAt = effectAt = 0; tree = context.exports.KeyInput(props); return tree; }
  function nodes(node) { return node?.props ? [node, ...[node.props.children].flat(Infinity).flatMap(nodes)] : []; }
  function find(type) { return nodes(render()).find(node => node.type === type); }
  return { props, changed, render, find,
    async pick(file) { const target = { files: file ? [file] : [], value: 'selected' }; find('input').props.onChange({ target }); for (let i = 0; i < 8; i++) await Promise.resolve(); assert.equal(target.value, ''); },
    type(value) { find('textarea').props.onChange({ target: { value } }); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}
const fictionalKey = '# fictional recovery file\nAGE-SECRET-KEY-1FICTIONAL';

test('the selected recovery file fills the shared text input; cancelling keeps the current value', async () => {
  const ui = inputRuntime();
  await ui.pick({ size: fictionalKey.length, text: async () => fictionalKey });
  assert.equal(ui.props.value, fictionalKey);
  assert.equal(ui.find('textarea').props.value, fictionalKey);
  await ui.pick(null);
  assert.equal(ui.props.value, fictionalKey);
  assert.equal(ui.find('input').props.type, 'file');
});

test('oversized and unreadable files show an error and can be replaced by a valid file', async () => {
  const ui = inputRuntime();
  await ui.pick({ size: 65537, text() { throw new Error('oversized file must not be read'); } });
  assert.equal(ui.props.value, '__TOO_LARGE__');
  assert.equal(ui.find('textarea').props.value, '');
  assert.match(JSON.stringify(ui.render()), /文件过大/);
  await ui.pick({ size: 1, text: async () => { throw new Error('fictional read failure'); } });
  assert.equal(ui.props.value, '__UNREADABLE__');
  assert.match(JSON.stringify(ui.render()), /文件无法读取/);
  await ui.pick({ size: fictionalKey.length, text: async () => fictionalKey });
  assert.equal(ui.props.value, fictionalKey);
});

test('a later selection, manual edit or cancelled picker invalidates an earlier file read', async () => {
  for (const action of ['selection', 'manual', 'cancel']) {
    const ui = inputRuntime(); let finish;
    const previous = ui.pick({ size: 10, text: () => new Promise(resolve => { finish = resolve; }) });
    if (action === 'selection') await ui.pick({ size: 10, text: async () => fictionalKey });
    if (action === 'manual') ui.type('AGE-SECRET-KEY-1TYPED');
    if (action === 'cancel') await ui.pick(null);
    const before = ui.props.value;
    finish('AGE-SECRET-KEY-1STALE'); await previous;
    assert.equal(ui.props.value, before, action);
  }
});

test('submitting or unmounting prevents delayed recovery file reads from restoring secret text', async () => {
  for (const action of ['busy', 'unmount']) {
    const ui = inputRuntime(); let finish;
    const reading = ui.pick({ size: 10, text: () => new Promise(resolve => { finish = resolve; }) });
    if (action === 'busy') {
      ui.props.busy = true; ui.render();
      assert.equal(ui.find('input').props.disabled, true);
      assert.equal(ui.find('textarea').props.disabled, true);
    } else ui.unmount();
    finish(fictionalKey); await reading;
    assert.deepEqual(ui.changed, [], action);
  }
});
