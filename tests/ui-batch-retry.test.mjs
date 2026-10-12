import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
const source = ts.createSourceFile('Batch.tsx', readFileSync(new URL('../src/Batch.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const useRowsNode = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'useRows');
const script = ts.transpileModule(`${useRowsNode.getText(source)}\nmodule.exports = useRows;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const requests = [], slots = [], effects = [];
  let cursor = 0;
  const context = { module: { exports: null },
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useEffect(callback, deps) { const slot = cursor++; const previous = effects[slot]; if (!previous || deps.some((v, index) => v !== previous.deps[index])) { previous?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; } },
    invoke() { const request = deferred(); requests.push(request); return request.promise; }, errorMessage: error => error.message,
  };
  vm.runInNewContext(script, context);
  const render = () => { cursor = 0; return context.module.exports(['fictional-asset'], 1); };
  return { requests, render, settle: () => new Promise(resolve => setImmediate(resolve)) };
}

test('batch rows retry after read error and ignore an older response', async () => {
  const view = fixture();
  let state = view.render();
  assert.equal(state.rows, null);
  view.requests[0].reject(new Error('temporary failure')); await view.settle();
  state = view.render(); assert.equal(state.error, 'temporary failure');
  state.reload(); view.render(); state = view.render(); assert.equal(state.rows, null); assert.equal(state.error, '');
  assert.equal(view.requests.length, 2);
  state.reload(); view.render(); assert.equal(view.requests.length, 3);
  view.requests[2].resolve([{ id: 'fictional-asset', revision: 2 }]); await view.settle();
  view.requests[1].resolve([{ id: 'fictional-asset', revision: 1 }]); await view.settle();
  state = view.render(); assert.equal(state.rows[0].revision, 2);
});
