import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ready, requestGate } from '../src/review.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const wealthAst = ts.createSourceFile('wealth-preview.ts', read('../src/wealth-preview.ts'), ts.ScriptTarget.Latest, true);
const wealthCode = wealthAst.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && node.name?.text === 'wealthPreview') ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText() === 'due'))
).map(node => node.getText()).join('\n').replaceAll('export function ', 'function ');
const visualAst = ts.createSourceFile('visual-preview.ts', read('../src/visual-preview.ts'), ts.ScriptTarget.Latest, true);
let overviewBranch;
function visit(node) {
  if (ts.isIfStatement(node) && node.expression.getText() === "command === 'review_overview'") overviewBranch = node.getText();
  ts.forEachChild(node, visit);
}
visit(visualAst);
assert.ok(overviewBranch, 'exercise the real visual overview adapter');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const account = (opened_on, closed_on = null, counted = true) => ({ fields: { opened_on, closed_on, counted } });

function fixture(accounts, { enabled = true, incomes = true, query = '' } = {}) {
  let accountReads = 0;
  const context = { params: new URLSearchParams(query), previewModules: { wealth: enabled }, todayIso: '2026-09-28' };
  Object.defineProperty(context, 'accounts', { get() { accountReads++; return accounts; } });
  vm.runInNewContext(compile(wealthCode + '\nglobalThis.run=wealthPreview;'), context);
  const availability = args => context.run('wealth_account_availability', args).value;
  const calls = [];
  const visual = { params: context.params, generation: 'fictional-library', localDay: () => '2026-09-28', physicalPreview: () => ({ held_count: 1 }), timelinePreview: () => ({ dated: [] }),
    wealthPreview(command, args) {
      calls.push({ command, args });
      if (command === 'modules_get') return { value: { wealth: enabled, incomes } };
      if (command === 'plan_review' && query === 'history-error') throw { code: 'READ_FAILED', message: 'fictional history failure' };
      if (command === 'wealth_account_availability') return { value: availability(args) };
      if (command === 'wealth_summary') return { value: { generation: 'fictional-library', points: [] } };
      return { value: {} };
    },
  };
  vm.runInNewContext(compile(`function overview(args) { const command='review_overview'; ${overviewBranch} }\nglobalThis.overview=overview;`), visual);
  return { availability: args => plain(availability(args)), overview: (planning = false) => plain(visual.overview({ year: null, planning })), reads: () => accountReads, calls };
}

test('account availability uses live account dates, independently of snapshots and counted scope', () => {
  const accounts = [account('2026-09-28'), account('2026-01-01', '2026-09-29', false), account('2026-01-01', '2026-09-28'), account('2026-09-29')];
  const before = structuredClone(accounts), f = fixture(accounts);
  assert.deepEqual(f.availability({ today: '2026-09-28' }), { total: 4, due_today: 2 });
  assert.deepEqual(f.availability({ today: '2025-12-31' }), { total: 4, due_today: 0 });
  assert.deepEqual(f.availability({ today: '2026-09-30' }), { total: 4, due_today: 2 });
  assert.deepEqual(accounts, before, 'reading never opens an editor or writes account facts');
  const result = f.overview();
  assert.deepEqual(result.wealth.value.points, []);
  assert.deepEqual(result.account_availability, { status: 'ready', value: { total: 4, due_today: 2 } });
  assert.equal(result.today, '2026-09-28');
  assert.equal(result.generation, 'fictional-library');
});

test('zero live accounts, all closed and not-yet-open accounts remain distinct', () => {
  assert.deepEqual(fixture([]).overview().account_availability.value, { total: 0, due_today: 0 });
  for (const accounts of [[account('2026-01-01', '2026-09-28')], [account('2026-09-29')]]) {
    assert.deepEqual(fixture(accounts).overview().account_availability.value, { total: 1, due_today: 0 });
  }
});

test('account-source failure remains unknown and does not hide successful overview sources', () => {
  const result = fixture([account('2026-01-01')], { query: 'account-availability=error' }).overview();
  assert.equal(result.account_availability.status, 'error');
  assert.match(result.account_availability.value.message, /账户读取失败/);
  assert.equal(ready(result.account_availability), undefined);
  assert.equal(result.wealth.status, 'ready');
  assert.equal(result.physical.status, 'ready');
  assert.equal(ready(undefined), undefined, 'old fixtures or absent sources cannot become zero accounts');
});

test('disabled wealth does not read account data; stale account projections obey overview request identity', () => {
  const f = fixture([account('2026-01-01')], { enabled: false });
  assert.equal(f.overview().account_availability.status, 'error');
  assert.equal(f.reads(), 0);
  const gate = requestGate(), old = gate.next(), current = gate.next();
  assert.equal(gate.accepts(old, 'fictional-library', 'fictional-library'), false);
  assert.equal(gate.accepts(current, 'new-library', 'fictional-library'), false);
  assert.equal(gate.accepts(current, 'fictional-library', 'fictional-library'), true);
  gate.invalidate();
  assert.equal(gate.accepts(current, 'fictional-library', 'fictional-library'), false);
});

test('overview preview mirrors native disabled historical sources and preserves real failure codes',()=>{
 const disabled=fixture([],{incomes:false});const result=disabled.overview(true);
 assert.equal(result.planning.review.value.code,'MODULE_DISABLED');assert.equal(result.planning.incomes.value.code,'MODULE_DISABLED');assert.equal(disabled.calls.some(c=>c.command==='plan_review'||c.command==='plan_income_list'),false);
 const error=fixture([],{query:'history-error'}).overview(true);assert.equal(error.planning.review.value.code,'READ_FAILED');assert.equal(error.planning.profile.status,'ready');
});
