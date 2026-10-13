import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validReturn, sourcePage } from '../src/source.ts';

const text = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const main = ts.createSourceFile('main.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), sidebarCallbacks = [];
function discover(node) {
  if (ts.isFunctionDeclaration(node) && ['beginReturn', 'openSource', 'gotoPlanning', 'gotoFinance'].includes(node.name?.text)) functions.set(node.name.text, node.getText(main));
  if (ts.isJsxAttribute(node) && node.name.getText(main) === 'onClick' && node.initializer?.expression?.getText(main) === "() => gotoPlanning('goals', undefined, false)") sidebarCallbacks.push(node.initializer.expression.getText(main));
  ts.forEachChild(node, discover);
}
discover(main);
assert.equal(functions.size, 4);
assert.equal(sidebarCallbacks.length, 1);
const compiled = ts.transpileModule([...functions.values()].join('\n') + '\nmodule.exports={beginReturn,openSource,gotoPlanning,gotoFinance};\nsidebarGoal=' + sidebarCallbacks[0], { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function runtime(section = 'stats') {
  const calls = [], old = { section: 'stats', generation: 'fictional-generation', scroll: 40 };
  const context = { module: { exports: {} }, exports: {}, section, returnContext: old, libraryGeneration: 'fictional-generation', modeBlocked: false,
    modules: { planning: true, wishlist: true, wealth: true }, capabilities: {}, reviewYear: 2025,
    timelineSelection: { filter: 'all', domain: 'all', year: null }, mainRef: { current: { scrollTop: 125 } },
    recordsRoute: { page: 'records', tab: 'income' }, financeReviewRoute: { page: 'review', view: 'period' }, recordSearches: { income: '虚构' }, reviewBrowse: {}, sourceToken: { current: 1 },
    sourcePage, financeSourceRoute: () => null, financeRouteAvailable: () => true, blockedNotice: () => 'blocked',
    setReturnContext: value => { context.returnContext = value; calls.push(['return', value]); },
    setSection: value => { context.section = value; calls.push(['section', value]); }, setDetailId: value => calls.push(['detail', value]), setNotice: value => calls.push(['notice', value]),
    setPlanFocus: value => calls.push(['focus', value]), setPlanningView: value => calls.push(['view', value]), setPlanningTab: value => calls.push(['tab', value]),
    select: (...args) => calls.push(['asset', ...args]), setWishFocus() {}, setSourceFocus: value => calls.push(['source', value]),
    otherEditing: false, featureEditing: false, storedPending: () => null, pendingGenerations: () => [], localStorage: {}, setRecordsRoute() {}, setFinanceReviewRoute() {}, setSettingsGroup() {}, setFinanceImportRequested() {},
  };
  vm.runInNewContext(compiled, context);
  return { context, calls, ...context.module.exports, sidebarGoal: context.sidebarGoal };
}
test('the actual sidebar target action clears an obsolete statistics origin and opens goals', () => {
  const r = runtime(); r.sidebarGoal();
  assert.equal(r.context.returnContext, null); assert.equal(r.context.section, 'planning');
  assert.ok(r.calls.find(([kind, value]) => kind === 'view' && value === 'goals'));
});
test('a legitimate statistics search source keeps its origin, but an explicit sidebar goal visit clears it', () => {
  const r = runtime(); r.openSource({ kind: 'asset', id: 'fictional-asset' });
  assert.equal(r.context.section, 'assets'); assert.equal(r.context.returnContext.section, 'stats'); assert.equal(r.context.returnContext.scroll, 125);
  assert.equal(validReturn(r.context.returnContext, 'fictional-generation'), r.context.returnContext);
  assert.deepEqual(r.calls.find(([kind]) => kind === 'asset'), ['asset', 'fictional-asset', true]);
  // A manual sidebar hop through another page must not leak that origin into goals.
  r.context.setSection('overview'); r.sidebarGoal();
  assert.equal(r.context.returnContext, null); assert.equal(r.context.section, 'planning');
});
test('contextual goal links preserve their real overview or financial review origin', () => {
  for (const origin of ['overview', 'finance-review']) {
    const r = runtime(origin); r.gotoPlanning('goals', 'budget');
    assert.equal(r.context.section, 'planning'); assert.equal(r.context.returnContext.section, origin); assert.equal(r.context.returnContext.reviewYear, 2025);
    if (origin === 'finance-review') assert.equal(r.context.returnContext.finance.route.view, 'period');
    assert.equal(r.calls.find(([kind]) => kind === 'focus')[1].focus, 'budget');
  }
});
test('an explicit finance route to goals clears stale origin while guarded navigation preserves current state', () => {
  const r = runtime('assets'); r.gotoFinance({ page: 'goals' }, false, false);
  assert.equal(r.context.returnContext, null); assert.equal(r.context.section, 'planning');
  const blocked = runtime(); const original = blocked.context.returnContext; blocked.context.modeBlocked = true; blocked.sidebarGoal();
  assert.equal(blocked.context.section, 'stats'); assert.equal(blocked.context.returnContext, original);
});
