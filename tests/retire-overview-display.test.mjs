// 详情概览的展示收敛：Coast 与 FI 相等时合并里程碑卡；逐年快照默认收起。
// 渲染方式与 pension-runtime.mjs 相同（真实纯计算模块 + 内存 React 替身），数据全部虚构。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { defaultRetire } from '../src/plan.ts';
import { basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import * as view from '../src/plan-view.ts';
import * as planExports from '../src/plan.ts';
import * as planEvents from '../src/plan-events.ts';
import * as basicView from '../src/planning-basic-view.ts';
import { money } from '../src/asset.ts';
const ts = createRequire(import.meta.url)('typescript');

const today = '2026-10-06';
const savedFixture = (retire) => ({ revision: 1, updated_at: today, profile: {
  birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
  personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: defaultAssumptions, overrides: noOverrides,
  retire: { ...defaultRetire, target_age: 50, core: { contract_version: 1, monetary_basis_date: today, fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }], hpf_monthly_cents: '0', costs: [], occurrences: [] },
    basic: { ...structuredClone(basicInputFixtures.prediction.basic), start: { kind: 'live' }, contribution: { id: 'contribution', monthly_cents: '1000000' } }, ...retire },
} });
const snap = cents => ({ id: 's1', date: today, revision: 1, entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: String(cents) }] });
const reviewOf = median => ({ intervals: [], stats: { mean_monthly_change_cents: median, count: 4, low_sample: false, median_monthly_saving_cents: median, mean_monthly_saving_cents: median, median_monthly_spend_cents: null, window_from: '2025-10-06', latest_date: today }, incomplete_count: 0 });

const calcOf = retire => {
  const calc = buildRetireCalc(savedFixture({ spend_cents: '500000', ...retire }), snap(20_000_000), reviewOf('1000000'), [], today);
  assert.equal(calc.capabilities.prediction.status, 'ready');
  return { plan: calc.plan, proj: calc.proj, out: calc.out, assets: calc.assets, plan0: calc.plan0, events: calc.events, r: calc.r };
};

function overview(calc) {
  const slots = new Map();
  let path = 'root', cursor = 0;
  const hooks = {
    useState(initial) {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => { slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next); }];
    },
    useRef(initial) { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); },
    useEffect() {}, useMemo: fn => fn(),
  };
  const leaf = new Proxy({}, { get: (_, key) => String(key) });
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './plan': planExports, './plan-events': planEvents, './planning-basic-view': basicView, './plan-view': view, './asset': { money },
  };
  const module = { exports: {} };
  const script = ts.transpileModule(readFileSync(new URL('../src/RetireOverview.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, { module, exports: module.exports, require: id => modules[id] ?? leaf, crypto: globalThis.crypto, structuredClone, Error, console, localStorage: { getItem: () => null, setItem() {} } });
  let tree;
  function expand(node, key) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
    if (typeof node.type === 'function') { path = key; cursor = 0; return expand(node.type(node.props), `${key}:child`); }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
  }
  tree = expand(module.exports.RetireOverview({ calc, mode: 'today', onMode() {} }), 'tree');
  const nodes = () => { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(tree); return out; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
  const find = (type, predicate = () => true) => nodes().find(n => n.type === type && predicate(n.props, n));
  return { nodes, text, find };
}

test('equal coast and FI amounts drop the Coast card and note the merge under FI', () => {
  const calc = calcOf({}); // 默认收益 0%：不追加投入时 Coast 与 FI 相同
  const ms = view.milestones(calc.plan, calc.assets, 'today');
  assert.equal(Math.round(ms.find(m => m.id === 'coast').amount / 100), Math.round(ms.find(m => m.id === 'fi').amount / 100), '夹具应在 0% 收益下相等');
  const r = overview(calc);
  assert.equal(r.find('div', p => String(p.className).startsWith('rd-milestones'))?.props.className, 'rd-milestones merged', '合并态三列网格');
  assert.ok(!r.nodes().some(n => n.type === 'span' && r.text(n) === 'Coast FIRE'), '不应再渲染 Coast 卡');
  assert.ok(r.nodes().some(n => n.type === 'span' && r.text(n) === 'FI'), 'FI 卡仍在');
  assert.ok(r.nodes().some(n => n.type === 'span' && r.text(n) === 'Lean FIRE') && r.nodes().some(n => n.type === 'span' && r.text(n) === 'Fat FIRE'));
  assert.ok(r.nodes().some(n => n.type === 'small' && r.text(n) === '收益假设为 0% 时，Coast FIRE 与 FI 相同'), 'FI 卡下的小字说明');
});

test('different coast and FI amounts keep all four milestone cards without the merge note', () => {
  const calc = calcOf({ real_return_before_hundredths: 200, real_return_after_hundredths: 100 });
  const ms = view.milestones(calc.plan, calc.assets, 'today');
  assert.notEqual(Math.round(ms.find(m => m.id === 'coast').amount / 100), Math.round(ms.find(m => m.id === 'fi').amount / 100), '夹具应不相等');
  const r = overview(calc);
  assert.equal(r.find('div', p => String(p.className).startsWith('rd-milestones'))?.props.className, 'rd-milestones', '不合并时保持四列网格');
  for (const label of ['Coast FIRE', 'Lean FIRE', 'FI', 'Fat FIRE']) assert.ok(r.nodes().some(n => n.type === 'span' && r.text(n) === label), label);
  assert.ok(!r.nodes().some(n => n.type === 'small' && /Coast FIRE 与 FI 相同/.test(r.text(n))));
});

test('yearly snapshot collapses by default with a row count in its summary', () => {
  const calc = calcOf({});
  const r = overview(calc);
  const rows = view.snapshotRows(calc.plan, calc.proj, 'today');
  const details = r.find('details', p => p['aria-label'] === '逐年快照');
  assert.ok(details, '逐年快照容器');
  assert.equal(details.props.open, undefined, '默认收起');
  assert.match(r.text(r.find('summary')), new RegExp(`逐年快照（${rows.length} 行）`));
  assert.ok(r.find('div', p => p['aria-label'] === '逐年快照表'), '表格区域与读屏标签保留');
});
