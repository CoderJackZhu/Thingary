import * as forecast from '../src/plan-format.ts';
// 详情概览的展示收敛：Coast 与 FI 相等时合并里程碑卡；逐年快照默认收起。
// 渲染方式与 planning-component-runtime.mjs 相同（真实纯计算模块 + 内存 React 替身），数据全部虚构。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { defaultRetire } from '../src/plan.ts';
import { basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { emptyCore } from '../src/plan-core.ts';
import * as ledger from '../src/plan-ledger.ts';
import { buildRetireCalc } from '../src/plan-retire-calc.ts';
import * as view from '../src/plan-view.ts';
import * as planExports from '../src/plan.ts';
import * as planEvents from '../src/plan-events.ts';
import * as basicView from '../src/planning-basic-view.ts';
import { money } from '../src/asset.ts';
const ts = createRequire(import.meta.url)('typescript');

const today = '2026-10-06';
const savedFixture = (retire) => ({ revision: 1, updated_at: today, profile: {
  assumptions: { inflation_hundredths: 0 },
  retire: { ...structuredClone(defaultRetire), mode: 'fire', core: { ...emptyCore(today), fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }] },
    basic: { ...structuredClone(basicInputFixtures.prediction.basic), start: { kind: 'live' }, contribution: { id: 'contribution', monthly_cents: retire.contribution_cents === undefined ? '1000000' : retire.contribution_cents } },
    simplified: { contract_version: 1, time: { reference: null, target_month: '2040-06', horizon_month: '2080-05' }, income_mode: 'excluded', future_incomes: [] }, ...retire },
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
    './plan-format': forecast,
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './plan-ledger': ledger, './plan': planExports, './plan-events': planEvents, './planning-basic-view': basicView, './plan-view': view, './asset': { money },
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
  assert.ok(!r.nodes().some(n => n.type === 'span' && r.text(n) === '现在停止追加存钱'), '不应再渲染 Coast 卡');
  assert.ok(r.nodes().some(n => n.type === 'span' && r.text(n) === '按完整预算生活'), 'FI 卡仍在');
  assert.ok(r.nodes().some(n => n.type === 'span' && r.text(n) === '生活预算少一些') && r.nodes().some(n => n.type === 'span' && r.text(n) === '生活预算更宽裕'));
  assert.ok(r.nodes().some(n => n.type === 'small' && r.text(n) === '按当前显示精度，停止追加存钱与完整生活预算所需的资金相同，已合并展示。'), 'FI 卡下的小字说明');
});

test('different coast and FI amounts keep all four milestone cards without the merge note', () => {
  const calc = calcOf({ real_return_before_hundredths: 200, real_return_after_hundredths: 100 });
  const ms = view.milestones(calc.plan, calc.assets, 'today');
  assert.notEqual(Math.round(ms.find(m => m.id === 'coast').amount / 100), Math.round(ms.find(m => m.id === 'fi').amount / 100), '夹具应不相等');
  const r = overview(calc);
  assert.equal(r.find('div', p => String(p.className).startsWith('rd-milestones'))?.props.className, 'rd-milestones', '不合并时保持四列网格');
  for (const label of ['现在停止追加存钱', '生活预算少一些', '按完整预算生活', '生活预算更宽裕']) assert.ok(r.nodes().some(n => n.type === 'span' && r.text(n) === label), label);
  assert.ok(!r.nodes().some(n => n.type === 'small' && /已合并展示/.test(r.text(n))));
});

test('yearly snapshot expands by default with a row count in its summary', () => {
  const calc = calcOf({});
  const r = overview(calc);
  const rows = view.snapshotRows(calc.plan, calc.proj, 'today');
  const details = r.find('details', p => p['aria-label'] === '逐年快照');
  assert.ok(details, '逐年快照容器');
  assert.equal(details.props.open, true, '默认展开');
  assert.match(r.text(details.props.children[0]), new RegExp(`逐年快照（${rows.length} 行）`));
  assert.ok(r.find('div', p => p['aria-label'] === '逐年快照表'), '表格区域与读屏标签保留');
});


test('milestones are optional while the conclusion and trajectory remain available', () => {
  const calc = calcOf({}), r = overview(calc);
  const details = r.find('details', p => p['aria-label'] === '不同生活预算需要多少钱');
  assert.ok(details); assert.equal(details.props.open, undefined);
  assert.ok(r.find('article', p => p['aria-label'] === '退休结论'));
  assert.ok(r.find('TrajectoryChart'));
  const toggle = r.find('Segments', p => p.label === '金额显示方式');
  assert.deepEqual(Array.from(toggle.props.options, o => [o.value, o.label]), [['today','按今天物价'],['nominal','未来账面金额']]);
});

test('cash-only zero-return retirement describes withdrawals from available funds', () => {
  const calc = calcOf({ real_return_before_hundredths: 0, real_return_after_hundredths: 0 });
  const month = calc.proj.retire_month ?? calc.plan.target_months;
  const c = view.coverage(calc.plan, calc.proj, month, 'today');
  assert.equal(c.pct.portfolio, 100);
  const r = overview(calc), shown = r.text(r.nodes());
  assert.match(shown, /从已有资金中取用 100%/);
  assert.doesNotMatch(shown, /从投资中取用/);
});

test('overview with no age reference uses calendar months and a month-based coverage slider', () => {
  const calc = calcOf({}), r = overview(calc);
  assert.equal(calc.plan.age_reference, null);
  const chart = r.find('TrajectoryChart');
  assert.equal(chart.props.goalMonth, calc.plan.target_months);
  assert.equal(chart.props.timeLabel(chart.props.goalMonth), '2040-06');
  assert.ok(chart.props.points.every(p => p.age === null && Number.isFinite(p.month)));
  const slider = r.find('input', p => p['aria-label'] === '覆盖快照月份');
  assert.ok(Number.isFinite(slider.props.value));
  assert.ok(slider.props.max > slider.props.min);
  const headers = r.nodes().filter(n => n.type === 'th').map(n => r.text(n));
  assert.ok(!headers.includes('年龄'), '没有年龄参考时不保留空年龄列');
  for (const title of ['期间', '期末资产', '投入', '固定收入', '计划支出', '资产提取']) assert.ok(headers.includes(title));
  assert.ok(!r.nodes().some(n => /null 岁|NaN|0 岁时/.test(r.text(n))));
});

test('trajectory geometry uses months even when every optional age is unknown', async () => {
  const { spacedLabels } = await import('../src/chart-labels.ts');
  const hooks = { useState: value => [value, () => {}], useRef: () => ({ current: null }) };
  const modules = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './plan-view': view, './chart-labels': { spacedLabels }, './chart-width': { useChartScale: () => 1 }, './retire.css': {},
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/RetireCharts.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => { assert.ok(id in modules, id); return modules[id]; } });
  const calc = calcOf({}), points = view.trajectory(calc.plan, calc.proj, 'today');
  const tree = module.exports.TrajectoryChart({ points, rows: view.snapshotRows(calc.plan, calc.proj, 'today'), goalMonth: calc.plan.target_months, fiMonth: calc.proj.fi_month, retireMonth: calc.proj.retire_month, timeLabel: m => ledger.timeLabel(calc.plan, m), tone: 'good', fmt: String, valueLabel: '今天的钱' });
  const nodes = [];
  const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (typeof n.type === 'function') walk(n.type(n.props)); else { nodes.push(n); walk(n.props?.children); } } };
  walk(tree);
  const svg = nodes.find(n => n.type === 'svg');
  assert.match(svg.props['aria-label'], /2026-10.*2040-06/);
  const path = nodes.find(n => n.type === 'path' && n.props.className === 'rc-line').props.d;
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.ok(new Set([...path.matchAll(/[ML]([\d.]+)/g)].map(m => m[1])).size > 2, 'unknown ages must not collapse the month axis');
  assert.ok(nodes.some(n => n.type === 'text' && typeof n.props.children === 'string' && /^20\d{2}-\d{2}$/.test(n.props.children)));
});

test('annual stage markers name the projected month without exposing FI shorthand',()=>{
 const calc=calcOf({});assert.notEqual(calc.proj.fi_month,null);
 const rows=view.snapshotRows(calc.plan,calc.proj,'today');
 assert.equal(rows.filter(r=>r.marks.includes('预计不靠工资')).length,1);
 assert.ok(rows.every(r=>!r.marks.includes('FI')));
 const r=overview(calc);assert.doesNotMatch(r.nodes().map(n=>r.text(n)).join(' '),/\bFI\b/);
});
