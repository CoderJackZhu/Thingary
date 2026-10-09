import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as flow from '../src/planning-first-run.ts';
import * as defaults from '../src/planning-basic-defaults.ts';
import { defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';
import { unknownBasicUpdate, unknownCapabilityFixture } from '../src/plan-basic-fixtures.ts';

const ts = createRequire(import.meta.url)('typescript');
const today = '2026-10-09';
const savedPlan = () => ({ revision: 4, updated_at: today, profile: {
  birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 120,
  account_balance_cents: '1234567', base_cents: '900000', past_index_hundredths: 120,
  flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000,
  assumptions: { ...defaultAssumptions }, overrides: { ...noOverrides },
  retire: { ...structuredClone(defaultRetire), ...structuredClone(unknownBasicUpdate.fields) },
} });
const sourcesOf = saved => ({ generation: 'fictional-fourq', write_version: 1, today,
  modules: { planning: true, wealth: false }, profile: { status: 'ready', value: { saved } },
  snapshot: { status: 'ready', value: null }, accounts: { status: 'ready', value: [] },
  incomes: { status: 'ready', value: [] }, review: { status: 'ready', value: null },
});

// Run the production TSX component and handlers. Controlled hook state persists between
// renders; only leaf controls and IPC are substituted, without implementing a second wizard.
function runtime(file, props, save = async () => ({ revision: 5 }), caps = unknownCapabilityFixture) {
  const slots = new Map(), calls = [], closes = [];
  let path = 'root', cursor = 0;
  const hooks = {
    useState(initial) {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next)];
    },
    useRef: () => ({ current: null }), useEffect() {}, useMemo: fn => fn(),
  };
  const saver = { busy: false, stuck: false, notice: '', async save(input) {
    calls.push(structuredClone(input));
    try { return await save(input); } catch (e) { saver.notice = e.message; return null; }
  } };
  const leaf = new Proxy({}, { get: (_, key) => String(key) });
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './asset': { money: c => `¥${c}` }, './review': { ready: r => r?.status === 'ready' ? r.value : null },
    './planning-first-run': flow, './planning-basic-defaults': defaults,
    './planning-basic-data': { useSectionSaver: () => saver, useCapabilities: () => ({ status: 'ready', caps }) },
    './planning-basic-view': { needsContribution: () => true, requirementLine: () => ({ text: '每月 ¥4700', tone: '' }), SAVE_CONTRIBUTION_HINT: '待估计' },
    './plan-retire-calc': { buildRetireCalc: () => null },
  };
  const module = { exports: {} };
  const script = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, { module, exports: module.exports, require: id => modules[id] ?? leaf, crypto: globalThis.crypto, console });
  const component = module.exports[file === 'PlanningSetup' ? 'PlanningSetupDialog' : 'PlanningBasicGoals'];
  const finalProps = { today, snapshot: null, accounts: [], reload() {}, onPending() {}, onPension() {}, onEditingChange() {}, onFocusDone() {}, onClose: v => closes.push(v), ...props };
  let tree;
  function expand(node, key) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
    if (typeof node.type === 'function') { path = key; cursor = 0; return expand(node.type(node.props), `${key}:child`); }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
  }
  function render() { path = 'root'; cursor = 0; tree = expand(component(finalProps), 'tree'); return tree; }
  const nodes = () => { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(tree); return out; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
  const find = (type, predicate = () => true) => nodes().find(n => n.type === type && predicate(n.props, n));
  const button = label => nodes().find(n => (n.type === 'button' || n.type === 'CloseButton') && (n.props['aria-label'] === label || text(n) === label));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render();
  return { render, nodes, text, find, button, calls, closes, saver, settle, props: finalProps };
}
const event = () => ({ preventDefault() {} });

test('close, Esc cancellation and skip discard edits without sending any setup transaction', async () => {
  for (const exit of ['close', 'escape', 'skip']) {
    const r = runtime('PlanningSetup', { sources: sourcesOf(null) });
    r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '61' } }); r.render();
    if (exit === 'escape') r.find('dialog').props.onCancel(event());
    else r.button(exit === 'close' ? '关闭规划设置' : '暂时跳过').props.onClick();
    await r.settle(); assert.equal(r.calls.length, 0); assert.deepEqual(r.closes, [false]);
    const reopened = runtime('PlanningSetup', { sources: sourcesOf(null) });
    assert.equal(reopened.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '');
  }
});

test('editing prefills every question/extra screen and always offers save-and-return', () => {
  const p = savedPlan(); p.profile.retire.basic.retirement_income.mode = 'beijing';
  for (let step = 0; step < 6; step++) {
    const r = runtime('PlanningSetup', { sources: sourcesOf(p), editMode: true, initialStep: step });
    assert.ok(r.button('保存并返回'), `screen ${step}`);
    if (step === 0) { assert.equal(r.find('MonthInput').props.value, '1990-06'); assert.equal(r.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '60'); }
    if (step === 1) assert.equal(r.find('CentInput').props.value, '400000');
    if (step === 2) assert.equal(r.find('CentInput').props.value, '10000000');
    if (step === 3) { assert.equal(r.find('input', p => p['aria-label'] === '沿用已保存的北京养老金估算').props.checked, true); assert.ok(r.button('进入养老金页（退出本次未保存修改）')); }
    if (step === 4) assert.equal(r.find('CentInput').props.value, '');
    if (step === 5) assert.equal(r.find('input', p => p['aria-label'] === '规划到几岁').props.value, '90');
  }
});

test('Q4 defaults to excluded, offers no selectable pension for a new plan, and saves directly', async () => {
  const r = runtime('PlanningSetup', { sources: sourcesOf(null), initialStep: 3 });
  assert.equal(r.find('input', p => p.type === 'radio').props.checked, true);
  assert.equal(r.find('input', p => p['aria-label'] === '沿用已保存的北京养老金估算'), undefined);
  r.find('form').props.onSubmit(event()); await r.settle();
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].section, 'setup');
  assert.equal(r.calls[0].fields.basic.basic.retirement_income.mode, 'excluded');
  assert.equal(r.calls[0].fields.pension, null); assert.deepEqual(r.closes, [true]);
});

test('failed save keeps edits and dialog open, a retry submits the same values and returns only on success', async () => {
  let fail = true;
  const r = runtime('PlanningSetup', { sources: sourcesOf(savedPlan()), editMode: true }, async () => { if (fail) throw new Error('虚构保存失败'); return { revision: 5 }; });
  r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '61' } }); r.render();
  r.button('保存并返回').props.onClick(); await r.settle();
  assert.equal(r.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '61');
  assert.deepEqual(r.closes, []); assert.match(r.text(r.find('dialog')), /虚构保存失败/);
  fail = false; r.button('保存并返回').props.onClick(); await r.settle();
  assert.equal(r.calls.length, 2); assert.deepEqual(r.calls[0], r.calls[1]); assert.deepEqual(r.closes, [true]);
});

test('an unresolved receipt locks both retry and step navigation without discarding edits', async () => {
  const r = runtime('PlanningSetup', { sources: sourcesOf(savedPlan()), editMode: true });
  r.saver.stuck = true; r.saver.notice = '原请求结果待核对'; r.render();
  assert.equal(r.button('保存并返回').props.disabled, true);
  assert.equal(r.button('下一步').props.disabled, true);
  r.button('保存并返回').props.onClick(); await r.settle(); assert.equal(r.calls.length, 0);
  assert.equal(r.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '60');
});

test('goal tools are absent in 0/1, default closed in 2/2b, and badges count persisted content', () => {
  const p = savedPlan();
  for (const [saved, state] of [[null, '0'], [(() => { const p = savedPlan(); p.profile.retire.spend_cents = null; return p; })(), '1'], [p, '2']]) {
    const r = runtime('PlanningBasicGoals', { sources: sourcesOf(saved) });
    assert.equal(r.find('div', p => p['data-goal-state']).props['data-goal-state'], state);
    if (state !== '2') assert.equal(r.find('details'), undefined);
    else { assert.equal(r.find('details').props.open, false); r.find('details').props.onToggle({ currentTarget: { open: true } }); r.render(); assert.equal(r.find('details').props.open, true); }
  }
  p.profile.retire.life_events = [{ id: 'a', included: true }, { id: 'b', included: false }];
  const blocked = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code: 'COST_SCOPE_UNKNOWN' }] } };
  const r = runtime('PlanningBasicGoals', { sources: sourcesOf(p) }, undefined, blocked);
  assert.equal(r.find('div', p => p['data-goal-state']).props['data-goal-state'], '2b');
  assert.equal(r.find('details').props.open, false);
  assert.match(r.text(r.find('summary')), /大额计划 2 项/);
  assert.doesNotMatch(r.text(r.find('summary')), /职业试算 \d/);
});
