import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as plan from '../src/plan.ts';
import * as defaults from '../src/planning-basic-defaults.ts';
import { pensionFixture } from '../src/planning-pension-fixture.ts';
import { runtime } from './pension-runtime.mjs';

const ts = createRequire(import.meta.url)('typescript');
const money = cents => `¥${cents}`;
const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
// Render the real JSX components, including private review/detail sections, without a DOM or native services.
function components(file, names) {
  const leaf = new Proxy({}, { get: (_, k) => String(k) });
  const module = { exports: {} };
  const modules = { react: { useState: init => [typeof init === 'function' ? init() : init, () => {}] }, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, './asset': { money }, './plan': plan, './planning-basic-defaults': defaults };
  const helper = () => components('PlanningContributionHelper', ['ContributionHelper', 'MarketNote']);
  if (file === 'PlanningBasicDetail') modules['./PlanningContributionHelper'] = helper();
  const source = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(`${js}\nObject.assign(module.exports, {${names.join(',')}});`, { module, exports: module.exports, require: id => modules[id] ?? leaf, Error });
  return module.exports;
}
const { Usual, Steps } = components('PlanningPage', ['Usual', 'Steps']);
const { ContributionHelper } = components('PlanningContributionHelper', ['ContributionHelper']);
const { Trial } = components('PlanningBasicDetail', ['Trial']);
function expand(n) {
  if (Array.isArray(n)) return n.map(expand);
  if (!n || typeof n !== 'object') return n;
  if (typeof n.type === 'function') return expand(n.type(n.props));
  return { ...n, props: { ...n.props, children: expand(n.props?.children) } };
}
const render = (component, props) => text(expand(component(props)));
const stepProps = interval => ({ interval, busy: false, markError: '', onMark() {}, reasons: { notes: '', lines: [] }, reasonError: '' });
const point = (id, from, to, over = {}) => ({ snapshot_id: id, date: to, notes: '', assets_cents: '0', liabilities_cents: '0', net_cents: '0', complete: true, missing: 0, compared_to: from, scope_changed: false, change_cents: '1000000', hpf_change_cents: '100000', market_change_cents: '600000', change_rate_hundredths: null, ...over });
const income = date => ({ id: `fictional-${date}`, revision: 1, fields: { date, net_cents: '1500000', hpf_cents: '100000', notes: '' } });
function review(count = 3, over = {}, payOver = {}) {
  const dates = ['2026-01-01', '2026-02-01', '2026-03-04', '2026-04-04'];
  const points = dates.slice(1, count + 1).map((to, i) => point(`fictional-${i}`, dates[i], to, over));
  const incomes = points.map(p => { const i = income(p.date); i.fields = { ...i.fields, ...payOver }; return i; });
  return plan.computeReview(points, incomes, new Set(), 'fictional');
}
function setup(r) {
  const sources = pensionFixture(JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8')));
  sources.profile.value.saved.profile.retire.spend_cents = null;
  sources.review = { status: 'ready', value: r };
  return runtime('PlanningSetup', { sources, initialStep: 1 });
}

test('preview rejects unknown net-asset change exactly as Rust; first/incomparable/no-income points retain their rules', () => {
  for (const change_cents of [null, undefined]) {
    const p = point('fictional-invalid', '2026-01-01', '2026-02-01', { change_cents });
    assert.throws(() => plan.computeReview([p], [income(p.date)], new Set(), 'fictional'), { message: '资料格式不兼容或损坏' });
    assert.doesNotThrow(() => plan.computeReview([{ ...p, compared_to: null }], [], new Set(), 'fictional'));
    assert.doesNotThrow(() => plan.computeReview([{ ...p, scope_changed: true }], [income(p.date)], new Set(), 'fictional'));
    if (change_cents === null) assert.doesNotThrow(() => plan.computeReview([p], [], new Set(), 'fictional'));
  }
});

test('review, setup, contribution helper and detail share cash-field values and the exact caveat', () => {
  const r = review(), i = r.intervals[0], h = defaults.historyHints(r);
  assert.equal(h.saving, i.monthly_cash_saving_cents);
  assert.equal(h.spend, i.monthly_cash_spend_cents);
  const usual = render(Usual, { review: r }), steps = render(Steps, stepProps(i));
  const helper = render(ContributionHelper, { history: h, onPick() {} });
  const detail = render(Trial, { auto: h, trial: null, notice: '' });
  const wizard = setup(r), suggestion = wizard.find('p', p => p.className?.includes('plan-suggest'));
  for (const s of [usual, steps, helper, detail]) assert.ok(s.includes(money(i.monthly_cash_saving_cents)), s);
  for (const s of [usual, steps, wizard.text(suggestion)]) assert.ok(s.includes(money(i.monthly_cash_spend_cents)), s);
  for (const s of [usual, steps, helper, detail, wizard.text(suggestion)]) assert.ok(s.includes(defaults.SAVING_BASIS_CAVEAT), s);
  assert.equal(wizard.find('CentInput', p => p.label === '退休后每月生活预算').props.value, '');
  wizard.button('采用').props.onClick(); wizard.render();
  assert.equal(wizard.find('CentInput', p => p.label === '退休后每月生活预算').props.value, h.spend);
  assert.equal(wizard.calls.length, 0);
});

test('fewer than three intervals hide the two cash medians and all history suggestions', () => {
  for (const count of [0, 1, 2]) {
    const r = review(count), h = defaults.historyHints(r), s = render(Usual, { review: r });
    assert.equal(h.saving, null); assert.equal(h.spend, null);
    assert.equal(s.split('区间太少，暂不给出').length - 1, 2);
    assert.equal(setup(r).find('p', p => p.className?.includes('plan-suggest')), undefined);
    assert.ok(!render(ContributionHelper, { history: h }).includes('估计存下的中位数'));
    assert.ok(!render(Trial, { auto: null, trial: null, notice: '' }).includes('估计存下的中位数'));
  }
});

test('spend sample count gates spend independently; net-asset history and cash saving survive', () => {
  const r = review(); r.stats.spend_count = 2;
  const s = render(Usual, { review: r });
  assert.equal(s.split('区间太少，暂不给出').length - 1, 1);
  assert.ok(s.includes(money(r.stats.median_monthly_cash_saving_cents)));
  assert.equal(defaults.historyHints(r).spend, null);
  assert.equal(setup(r).find('p', p => p.className?.includes('plan-suggest')), undefined);
});

test('scope changes and no income withhold all three interval estimates with the specific reason', () => {
  for (const [status, reason] of [['scope_changed', '账户范围变化'], ['no_income', '这一期没有收入记录']]) {
    const r = review(), i = { ...r.intervals[0], status };
    const s = render(Steps, stepProps(i));
    assert.equal(s.split(`暂时算不出：${reason}`).length - 1, 3);
    assert.ok(!s.includes('约每月'));
    assert.ok(s.includes(defaults.SAVING_BASIS_CAVEAT));
  }
});

test('unknown deposits withdraw only spending; no investment account is explicit', () => {
  const r = review(3, {}, { hpf_cents: null }), i = r.intervals[0];
  const s = render(Steps, stepProps(i));
  assert.equal(s.split('暂时算不出').length - 1, 1);
  assert.ok(s.includes('暂时算不出：有缴存金额未知'));
  assert.ok(s.includes(money(i.monthly_cash_saving_cents)));
  assert.ok(s.includes(money(i.market_change_cents)));
  const without = render(Steps, stepProps(review(3, { market_change_cents: null }).intervals[0]));
  assert.ok(without.includes('没有投资账户'));
  assert.ok(!without.includes('暂时算不出'));
});

test('nonzero investment change stays separate, never added to estimated saving', () => {
  const r = review(), i = r.intervals[0], h = defaults.historyHints(r);
  assert.notEqual(i.market_change_cents, '0');
  assert.equal(h.saving, i.monthly_cash_saving_cents);
  assert.notEqual(h.saving, i.monthly_saving_cents);
  const s = render(Steps, stepProps(i));
  assert.ok(s.replace(/\s/g, '').includes('估计存下¥300000·约每月' + money(i.monthly_cash_saving_cents)), s);
  assert.ok(s.includes('投资账户变化 含转入和涨跌¥600000'));
  let adopted;
  const n = expand(ContributionHelper({ history: h, onPick: v => { adopted = v; } }));
  function click(node) { if (Array.isArray(node)) return node.forEach(click); if (node && typeof node === 'object') { if (node.type === 'button' && text(node) === '采用') node.props.onClick(); else click(node.props?.children); } }
  click(n); assert.equal(adopted, i.monthly_cash_saving_cents);
});

test('zero and negative saving remain numbers; missing cash amounts never become zero in review', () => {
  for (const change of ['700000', '600000']) {
    const r = review(3, { change_cents: change }), i = r.intervals[0];
    assert.ok(render(Usual, { review: r }).includes(money(i.monthly_cash_saving_cents)));
    assert.ok(render(Steps, stepProps(i)).includes(money(i.monthly_cash_saving_cents)));
  }
  const r = review(); r.stats.median_monthly_cash_saving_cents = null;
  assert.ok(render(Usual, { review: r }).includes('暂时算不出：缺少可用的区间金额'));
  const i = { ...r.intervals[0], monthly_cash_saving_cents: null };
  assert.ok(render(Steps, stepProps(i)).includes('暂时算不出：缺少可用的区间金额'));
});
