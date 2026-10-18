// Production component handlers with fictional IPC; DOM navigation is checked in the browser preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as savings from '../src/savings-goals.ts';
const source = readFileSync(new URL('../src/SavingsGoals.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SavingsGoals.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['financialAmountsHidden', 'SavingsGoals', 'GoalCard'].includes(n.name?.text)).map(n => n.getText()).join('\n');
const script = ts.transpileModule(functions + '\nmodule.exports={SavingsGoals,GoalCard};', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const fixture = () => ({ generation: 'fictional', today: '2026-10-19', year: 2026, years: [2026], basis: { snapshot_id: 's', date: '2026-10-15', revision: 1 }, newer_incomplete: false, accounts: [], goals: [{
  goal: { id: 'g', fields: { name: '虚构应急金', target_cents: '5000000', target_date: '2027-10-15' }, created_on: '2026-10-01' }, observations: [{ account_id: 'a', name: '虚构现金', kind: 'cash', status: 'known', amount_cents: '3000000' }], shared_account_ids: [], planning_overlap: false, history: [],
}] });
function nodes(root) { if (root == null || typeof root === 'boolean') return []; if (Array.isArray(root)) return root.flatMap(nodes); if (typeof root !== 'object') return [root]; return [root, ...nodes(root.props?.children)]; }
const text = tree => nodes(tree).filter(n => typeof n === 'string' || typeof n === 'number').join('');
const find = (tree, predicate) => nodes(tree).find(n => n?.props && predicate(n));
function runtime({ data = fixture(), failure = false, compact = true, hidden = false, focusRequested = false } = {}) {
  const states = [], refs = [], deps = [], calls = [], focused = [], managed = [], effects = [];
  let si = 0, ri = 0, ei = 0;
  const props = { generation: 'fictional', today: '2026-10-19', compact, hideAmounts: hidden, focusRequested, onManage: () => managed.push(true), onFocusDone: () => { props.focusRequested = false; } };
  const context = { ...savings, module: { exports: {} }, exports: {}, require: () => jsx, crypto,
    localStorage: { getItem: () => null }, storedPending: () => null, useRestored: () => {}, errorMessage: e => e.message,
    money: cents => `金额${cents}`, GoalEditor: 'goal-editor', YearSelect: 'year-select',
    invoke: async (command, args) => { calls.push({ command, args }); if (failure) throw new Error('虚构读取失败'); return structuredClone(data); },
    useState: initial => { const i = si++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef: initial => refs[ri++] ??= { current: initial },
    useEffect: (callback, next) => { const i = ei++, old = deps[i]; if (!old || next.some((v, j) => !Object.is(v, old[j]))) { deps[i] = next; effects.push(callback); } },
  };
  vm.runInNewContext(script, context);
  return { calls, focused, managed, props, setFailure(v) { failure = v; }, setData(v) { data = v; }, render() {
    si = ri = ei = 0;
    let tree = context.module.exports.SavingsGoals(props);
    const heading = find(tree, n => n.type === 'h3');
    if (heading) heading.props.ref.current = { scrollIntoView: () => focused.push('scroll'), focus: () => focused.push('focus') };
    // Expand only the pure card so assertions include the actual progress and missing-data content.
    const expand = node => {
      if (Array.isArray(node)) return node.map(expand);
      if (node && typeof node === 'object' && node.props) {
        if (node.type === context.module.exports.GoalCard) return expand(node.type(node.props));
        return { ...node, props: { ...node.props, children: expand(node.props.children) } };
      }
      return node;
    };
    tree = expand(tree); effects.splice(0).forEach(effect => effect()); return tree;
  } };
}
const ready = async r => { r.render(); await new Promise(setImmediate); return r.render(); };
test('homepage has no loading/empty target card; manager retains a clear creation path', async () => {
  const empty = { ...fixture(), goals: [] }, home = runtime({ data: empty });
  assert.equal(home.render(), null); assert.equal(await ready(home), null);
  const manager = runtime({ data: empty, compact: false }); const tree = await ready(manager);
  assert.match(text(tree), /为应急金、旅行等/);
  const create = find(tree, n => n.type === 'button' && n.props.children === '新增存钱目标');
  assert.equal(create.props.disabled, false); create.props.onClick();
  assert.ok(find(manager.render(), n => n.type === 'goal-editor'));
});
test('homepage retains read failures and retry instead of silently treating them as empty', async () => {
  const r = runtime({ failure: true }); let tree = await ready(r);
  assert.match(text(tree), /存钱目标读取失败.*虚构读取失败/);
  r.setFailure(false); r.setData({ ...fixture(), goals: [] });
  find(tree, n => n.type === 'button' && n.props.children === '重新读取').props.onClick();
  tree = await ready(r); assert.equal(tree, null); assert.equal(r.calls.length, 2);
});
test('homepage shows progress/gap and direct management without monthly details; hidden values remain masked', async () => {
  for (const hidden of [false, true]) {
    const r = runtime({ hidden }); const tree = await ready(r);
    assert.match(text(tree), /虚构应急金/); assert.match(text(tree), /不预留或扣减资金/);
    assert.doesNotMatch(text(tree), /每月平均还需|目标日期/);
    if (hidden) { assert.doesNotMatch(text(tree), /3000000|5000000|2000000/); assert.equal(find(tree, n => n.type === 'progress'), undefined); }
    else { assert.match(text(tree), /还差 金额2000000/); assert.ok(find(tree, n => n.type === 'progress')); }
    find(tree, n => n.type === 'button' && n.props.children === '管理目标 →').props.onClick(); assert.equal(r.managed.length, 1);
  }
});
test('missing balances and failed generation validation remain visible, never interpreted as zero', async () => {
  const data = fixture(); data.goals[0].observations[0] = { ...data.goals[0].observations[0], status: 'missing', amount_cents: null };
  const tree = await ready(runtime({ data })); assert.match(text(tree), /账户余额未知/); assert.doesNotMatch(text(tree), /还差|金额0/); assert.equal(find(tree, n => n.type === 'progress'), undefined);
  const stale = await ready(runtime({ data: { ...fixture(), generation: 'other-fictional' } })); assert.match(text(stale), /资料已切换/);
});
test('management focus waits for the data and is consumed once, including empty/error states', async () => {
  for (const failure of [false, true]) {
    const r = runtime({ compact: false, focusRequested: true, data: { ...fixture(), goals: [] }, failure });
    r.render(); assert.deepEqual(r.focused, []); await new Promise(setImmediate); r.render(); r.render();
    assert.deepEqual(r.focused, ['scroll', 'focus']);
  }
});
test('home management navigation clears a stale account search and uses same-library focus; editing blocks it', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.tsx', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn; const visit = n => { if (ts.isFunctionDeclaration(n) && n.name?.text === 'navigateFromReview') fn = n; ts.forEachChild(n, visit); }; visit(ast);
  const code = ts.transpileModule(fn.getText() + '\nmodule.exports=navigateFromReview;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [], context = { module: { exports: {} }, modeBlocked: false, libraryGeneration: 'fictional',
    setReturnContext: () => {}, setSearches: update => calls.push(update({ wealth: '旧搜索', assets: '保留' })), setWealthReviewFocus: f => calls.push(f), setSection: page => calls.push(page), setDetailId: () => {} };
  vm.runInNewContext(code, context); context.module.exports('wealth', 'savings-goals');
  assert.equal(calls[0].wealth, ''); assert.equal(calls[0].assets, '保留'); assert.equal(calls[1].generation, 'fictional'); assert.equal(calls[1].kind, 'savings-goals'); assert.equal(calls[2], 'wealth');
  context.modeBlocked = true; context.module.exports('wealth', 'savings-goals'); assert.equal(calls.length, 3);
});
