import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as annotations from '../src/plan-annotations.ts';
import * as actions from '../src/plan-occurrence-actions.ts';
import * as flow from '../src/planning-first-run.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
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
  let effects = [], dirty = false;
  const focuses = [];
  const hooks = {
    useState(initial) {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => { slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next); dirty = true; }];
    },
    useRef(initial) { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); },
    useEffect(fn, deps) { const key = `${path}:${cursor++}`, prev = slots.get(key); if (!prev || deps.some((v, i) => !Object.is(v, prev[i]))) { slots.set(key, deps); effects.push(fn); } }, useMemo: fn => fn(),
  };
  const saver = { busy: false, stuck: false, notice: '', async save(input) {
    calls.push(structuredClone(input));
    try { return await save(input); } catch (e) { saver.notice = e.message; return null; }
  } };
  const leaf = new Proxy({}, { get: (_, key) => String(key) });
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './plan-annotations': annotations, './plan-occurrence-actions': actions, './wealth': { kindLabel: v => v }, './asset': { money: c => `¥${c}` }, './review': { ready: r => r?.status === 'ready' ? r.value : null },
    './planning-first-run': flow, './planning-basic-defaults': defaults,
    './planning-basic-data': { useSectionSaver: () => saver, useCapabilities: () => ({ status: 'ready', caps: typeof caps === 'function' ? caps() : caps }) },
    './planning-basic-view': { needsContribution: () => true, requirementLine: () => ({ text: '每月 ¥4700', tone: '' }), SAVE_CONTRIBUTION_HINT: '待估计' },
    './plan-retire-calc': { buildRetireCalc: () => null },
  };
  for (const file of ['PlanningRetirementIncome']) {
    const m = { exports: {} };
    const js = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(js, { module: m, exports: m.exports, require: id => modules[id] ?? leaf, crypto: globalThis.crypto, structuredClone });
    modules[`./${file}`] = m.exports;
  }
  const module = { exports: {} };
  const script = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, { module, exports: module.exports, require: id => modules[id] ?? leaf, crypto: globalThis.crypto, structuredClone, Error, console });
  const component = module.exports[file === 'PlanningSetup' ? 'PlanningSetupDialog' : file === 'PlanningOccurrenceDialog' ? 'PlanningOccurrenceDialog' : 'PlanningBasicGoals'];
  const finalProps = { today, snapshot: null, accounts: [], reload() {}, onPending() {}, onPension() {}, onEditingChange() {}, onFocusDone() {}, onClose: v => closes.push(v), ...props };
  let tree;
  function expand(node, key) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
    if (typeof node.type === 'function') { path = key; cursor = 0; return expand(node.type(node.props), `${key}:child`); }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
  }
  function render() {
    for (let round = 0; round < 5; round++) {
      dirty = false; effects = []; path = 'root'; cursor = 0; tree = expand(component(finalProps), 'tree');
      for (const n of nodes()) if (n.props?.ref) n.props.ref.current = {
        showModal() {}, close() {}, focus: () => focuses.push(n.props['aria-label'] ?? n.props.id),
        querySelector(selector) {
          if (selector === '.planning-setup-body') return { scrollTo() {} };
          const label = selector.match(/aria-label="(.*)"/)?.[1];
          return nodes().some(x => x.props?.['aria-label'] === label || x.props?.label === label) ? { focus: () => focuses.push(label) } : null;
        },
      };
      effects.forEach(fn => fn()); if (!dirty) break;
    }
    return tree;
  }
  const nodes = () => { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(tree); return out; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
  const find = (type, predicate = () => true) => nodes().find(n => n.type === type && predicate(n.props, n));
  const button = label => nodes().find(n => (n.type === 'button' || n.type === 'CloseButton') && (n.props['aria-label'] === label || text(n) === label));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render();
  return { render, nodes, text, find, button, calls, closes, saver, settle, focuses, props: finalProps };
}
const event = () => ({ preventDefault() {} });

test('close, Esc cancellation and skip discard edits without sending any setup transaction', async () => {
  for (const exit of ['close', 'escape', 'skip']) {
    const r = runtime('PlanningSetup', { sources: sourcesOf(null) });
    r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '61' } }); r.render();
    stepButtons(r)[1].props.onClick(); r.render();
    r.find('CentInput').props.onChange('400000'); r.render();
    if (exit === 'escape') r.find('dialog').props.onCancel(event());
    else r.button(exit === 'close' ? '关闭规划设置' : '暂时跳过').props.onClick();
    await r.settle(); assert.equal(r.calls.length, 0); assert.deepEqual(r.closes, [false]);
    const reopened = runtime('PlanningSetup', { sources: sourcesOf(null) });
    assert.equal(reopened.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '');
  }
});

test('editing prefills every question/extra screen and always offers save-and-return', () => {
  const p = savedPlan(); p.profile.retire.basic.retirement_income.mode = 'employee';
  for (let step = 0; step < 6; step++) {
    const r = runtime('PlanningSetup', { sources: sourcesOf(p), editMode: true, initialStep: step });
    assert.ok(r.button('保存，查看结果'), `screen ${step}`);
    if (step === 0) { assert.equal(r.find('MonthInput').props.value, '1990-06'); assert.equal(r.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '60'); }
    if (step === 1) assert.equal(r.find('CentInput').props.value, '400000');
    if (step === 2) assert.equal(r.find('CentInput').props.value, '10000000');
    if (step === 3) { assert.match(r.text(r.find('section')), /已选职工养老金估算/); assert.ok(r.button('核对国家养老金')); }
    if (step === 4) assert.equal(r.find('CentInput').props.value, '');
    if (step === 5) assert.equal(r.find('input', p => p['aria-label'] === '规划到几岁').props.value, '90');
  }
});

test('Q4 defaults to excluded, offers a working add entry, and saves directly', async () => {
  const r = runtime('PlanningSetup', { sources: sourcesOf(null), initialStep: 3 });
  assert.equal(r.find('input', p => p.type === 'radio').props.checked, true);
  assert.ok(r.button('现在添加'));
  r.find('form').props.onSubmit(event()); await r.settle();
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].section, 'setup');
  assert.equal(r.calls[0].fields.basic.basic.retirement_income.mode, 'excluded');
  assert.equal(r.calls[0].fields.pension, null); assert.deepEqual(r.closes, [true]);
});

test('failed save keeps edits and dialog open, a retry submits the same values and returns only on success', async () => {
  let fail = true;
  const r = runtime('PlanningSetup', { sources: sourcesOf(savedPlan()), editMode: true }, async () => { if (fail) throw new Error('虚构保存失败'); return { revision: 5 }; });
  r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '61' } }); r.render();
  r.button('保存，查看结果').props.onClick(); await r.settle();
  assert.equal(r.find('input', p => p['aria-label'] === '想在几岁退休？').props.value, '61');
  assert.deepEqual(r.closes, []); assert.match(r.text(r.find('dialog')), /虚构保存失败/);
  fail = false; r.button('保存，查看结果').props.onClick(); await r.settle();
  assert.equal(r.calls.length, 2); assert.deepEqual(r.calls[0], r.calls[1]); assert.deepEqual(r.closes, [true]);
});

test('an unresolved receipt locks both retry and step navigation without discarding edits', async () => {
  const r = runtime('PlanningSetup', { sources: sourcesOf(savedPlan()), editMode: true });
  r.saver.stuck = true; r.saver.notice = '原请求结果待核对'; r.render();
  assert.equal(r.button('保存，查看结果').props.disabled, true);
  assert.equal(r.button('下一步').props.disabled, true);
  r.button('保存，查看结果').props.onClick(); await r.settle(); assert.equal(r.calls.length, 0);
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


const stepButtons = r => r.nodes().filter(n => n.type === 'button' && /^\d\. /.test(n.props['aria-label'] ?? ''));

test('question buttons jump directly without validation/saving; current step excludes edit extras', () => {
  const r = runtime('PlanningSetup', { sources: sourcesOf(null) });
  r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '19' } }); r.render();
  for (const step of [3, 1, 2, 0]) {
    const button = stepButtons(r)[step]; assert.equal(button.props.type, 'button'); button.props.onClick(); r.render();
    assert.equal(stepButtons(r).filter(n => n.props['aria-current'] === 'step').length, 1);
    assert.equal(stepButtons(r)[step].props['aria-current'], 'step');
  }
  assert.equal(r.calls.length, 0); assert.equal(r.find('p', p => p.role === 'alert'), undefined);
  for (const step of [4, 5]) {
    const edited = runtime('PlanningSetup', { sources: sourcesOf(savedPlan()), editMode: true, initialStep: step });
    assert.equal(stepButtons(edited).length, 4); assert.ok(stepButtons(edited).every(n => n.props['aria-current'] === undefined));
  }
});

test('saving and unresolved receipts disable all four question buttons', () => {
  for (const flag of ['busy', 'stuck']) {
    const r = runtime('PlanningSetup', { sources: sourcesOf(null) }); r.saver[flag] = true; r.render();
    assert.equal(stepButtons(r).length, 4); assert.ok(stepButtons(r).every(n => n.props.disabled));
    assert.equal(r.button('先保存，稍后继续').props.disabled, true);
  }
});

test('every first-run question offers early save; Q2 save yields persisted state 1 with the correct remaining count', async () => {
  for (let step = 0; step < 4; step++) {
    const r = runtime('PlanningSetup', { sources: sourcesOf(null), initialStep: step });
    assert.ok(r.button('先保存，稍后继续')); assert.match(r.text(r.find('footer')), /不保存本次填写/);
  }
  let stored;
  const r = runtime('PlanningSetup', { sources: sourcesOf(null) }, async input => {
    const { birth_month, ...retire } = input.fields.basic;
    stored = savedPlan(); stored.profile.birth_month = birth_month;
    stored.profile.retire = { ...structuredClone(defaultRetire), ...retire }; return { revision: 5 };
  });
  r.find('MonthInput').props.onChange('1990-06'); r.render();
  r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '60' } }); r.render();
  stepButtons(r)[1].props.onClick(); r.render(); r.find('CentInput').props.onChange('400000'); r.render();
  r.button('先保存，稍后继续').props.onClick(); await r.settle();
  assert.equal(r.calls.length, 1); assert.deepEqual(r.closes, [true]);
  const sources = sourcesOf(stored), caps = buildBasicCapabilities(sources);
  assert.equal(flow.goalState(stored, caps), '1');
  assert.deepEqual(flow.questionProgress(stored, caps), { answered: [true, true, false, true], remaining: 1, first: 2 });
  const goal = runtime('PlanningBasicGoals', { sources }, undefined, caps);
  assert.equal(goal.find('div', p => p['data-goal-state']).props['data-goal-state'], '1');
  assert.match(goal.text(goal.render()), /还差 1 个问题/);
});

test('save validation from an earlier question returns to its screen and focuses the affected field', async () => {
  const r = runtime('PlanningSetup', { sources: sourcesOf(null) });
  r.find('input', p => p['aria-label'] === '想在几岁退休？').props.onChange({ target: { value: '19' } }); r.render();
  stepButtons(r)[3].props.onClick(); r.render(); r.button('先保存，稍后继续').props.onClick(); await r.settle();
  assert.equal(stepButtons(r)[0].props['aria-current'], 'step'); assert.equal(r.focuses.at(-1), '想在几岁退休？'); assert.equal(r.calls.length, 0);
  // Native messages are delivered through the unchanged save hook, including Q2 validation.
  const native = runtime('PlanningSetup', { sources: sourcesOf(savedPlan()), editMode: true, initialStep: 3 }, async () => { throw new Error('退休后月支出须为大于 0 的金额'); });
  native.find('form').props.onSubmit(event()); await native.settle();
  assert.equal(stepButtons(native)[1].props['aria-current'], 'step'); assert.equal(native.focuses.at(-1), '退休后每月生活预算');
  assert.deepEqual(native.closes, []);
  native.saver.notice = '金额须为整数分'; native.render(); assert.equal(stepButtons(native)[1].props['aria-current'], 'step');
});


test('Q3 hard blocker card opens third question; saving default selection rerenders goals from 2b to 2', async () => {
  const batch = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/nonblocking-demo.json', import.meta.url)));
  const saved = batch.profile.value.saved;
  saved.profile.retire.core.fund_rules = [];
  const caps = () => buildBasicCapabilities(batch);
  assert.equal(caps().requirement.status, 'blocked');
  let opened;
  const goals = runtime('PlanningBasicGoals', { sources: batch, openSetup: step => opened = step }, undefined, caps);
  assert.equal(goals.find('div', p => p['data-goal-state']).props['data-goal-state'], '2b');
  const card = flow.refinementCards(saved, caps(), batch.today).find(c => c.id === 'funds');
  assert.equal(card.action, 'setup'); assert.equal(card.step, 2);
  goals.find('PlanningRefinements', p => p.cards.some(c => c.id === 'funds')).props.onAction(card, {});
  assert.equal(opened, 2);
  const original = structuredClone(saved.profile);
  const setup = runtime('PlanningSetup', { sources: batch, snapshot: batch.snapshot.value, accounts: batch.accounts.value, today: batch.today, initialStep: opened, editMode: true }, async input => {
    assert.equal(input.section, 'setup');
    saved.profile.retire.core.fund_rules = input.fields.funds.fund_rules;
    saved.revision += 1; batch.write_version += 1;
    return { revision: saved.revision };
  });
  assert.match(setup.text(setup.find('dialog')), /默认只动用现金类账户，确认后保存即可/);
  setup.button('保存，查看结果').props.onClick(); await setup.settle();
  assert.equal(setup.calls.length, 1); assert.deepEqual(setup.closes, [true]);
  assert.equal(caps().requirement.status, 'ready');
  goals.render(); assert.equal(goals.find('div', p => p['data-goal-state']).props['data-goal-state'], '2');
  const expected = structuredClone(original); expected.retire.core.fund_rules = saved.profile.retire.core.fund_rules;
  assert.deepEqual(saved.profile, expected);
});


test('future occurrence defaults pending; empty withdrawal is enabled but saved facts forbid it even if draft is cleared', () => {
  const batch = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/nonblocking-demo.json', import.meta.url)));
  const ev = batch.profile.value.saved.profile.retire.life_events[0];
  const saves = [];
  const props = { event: ev, snapshot: batch.snapshot.value, accounts: batch.accounts.value, today: batch.today, busy: false, stuck: false, notice: '', onSave: value => saves.push(value) };
  const fresh = runtime('PlanningOccurrenceDialog', props);
  assert.equal(fresh.find('select', p => p['aria-label'] === '现实状态').props.value, 'pending');
  assert.equal(fresh.find('DateInput'), undefined);
  fresh.find('form').props.onSubmit(event()); assert.deepEqual(saves, [null]);
  const blank = { id: 'empty', event_id: ev.id, status: 'occurred', actual_date: batch.today, payments_complete: false, payments: [], loan: null };
  const pending = runtime('PlanningOccurrenceDialog', { ...props, existing: blank });
  assert.equal(pending.button('撤回为尚未发生').props.disabled, false);
  pending.button('撤回为尚未发生').props.onClick(); assert.deepEqual(saves, [null, null]);
  for (const fact of [{ amount_cents: '0' }, { account_id: 'cash' }, { absorbed_snapshot_id: 'B' }]) {
    const existing = { ...blank, payments: [{ id: 'p', date: batch.today, amount_cents: null, account_id: null, absorbed_snapshot_id: null, absorbed_revision: null, source_kind: null, source_id: null, ...fact }] };
    const factual = runtime('PlanningOccurrenceDialog', { ...props, existing });
    assert.equal(factual.button('撤回为尚未发生').props.disabled, true);
    factual.button('移除此核对分项').props.onClick(); factual.render();
    assert.equal(factual.button('撤回为尚未发生').props.disabled, true);
  }
});
