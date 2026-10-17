import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as review from '../src/review.ts';
import * as chart from '../src/dual-line-chart.ts';
const today = '2026-10-17';
const point = (date, over = {}) => ({ snapshot_id: `虚构-${date}`, date, notes: '', complete: true, net_cents: '10000', liabilities_cents: '5000', liquid_cents: '12000', invested_cents: '3000', scope_changed: false, compared_to: null, change_cents: null, ...over });
const dates = points => points.map(p => p.date);
test('30 natural days includes both boundaries, excludes future and the preceding day', () => {
  assert.deepEqual(dates(review.rangePoints(['2026-09-16', '2026-09-17', today, '2026-10-18'].map(d => point(d)), '30d', today)), ['2026-09-17', today]);
});
test('YTD on New Year excludes the preceding year', () => {
  assert.deepEqual(dates(review.rangePoints(['2025-12-31', '2026-01-01'].map(d => point(d)), 'ytd', '2026-01-01')), ['2026-01-01']);
});
test('custom range includes both ends and checks real, ordered, nonfuture dates', () => {
  const custom = { from: '2026-09-01', to: '2026-10-01' };
  assert.deepEqual(dates(review.rangePoints(['2026-08-31', custom.from, custom.to, today].map(d => point(d)), 'custom', today, custom)), [custom.from, custom.to]);
  assert.match(review.customRangeError({ from: custom.to, to: custom.from }, today), /开始日期/);
  assert.match(review.customRangeError({ from: today, to: '2026-10-18' }, today), /今天/);
  for (const from of ['2025-02-29', '2026-00-01', '2026-04-31', '', '0000-01-01']) assert.ok(review.customRangeError({ from, to: today }, today));
  assert.equal(review.customRangeError({ from: '2024-02-29', to: today }, today), null);
});
test('range availability counts complete points only and all retains every historical point', () => {
  const points = [point('2020-01-01'), point(today), point('2026-10-16', { complete: false })];
  assert.equal(review.rangeUsable(points, '30d', today), false);
  assert.equal(review.rangeUsable(points, 'all', today), true);
  assert.equal(review.rangePoints(points, 'all', today), points);
});
test('period change uses first/last complete points with signed integer cents and rounded rate', () => {
  const result = review.periodChange([point('2026-01-01'), point('2026-05-01', { complete: false, net_cents: '0' }), point(today, { net_cents: '12000' })]);
  assert.deepEqual(result, { status: 'ready', from: '2026-01-01', to: today, cents: '2000', rate_hundredths: 2000 });
  assert.equal(review.periodChange([point('2026-01-01'), point(today, { net_cents: '9999' })]).rate_hundredths, -1);
});
test('nonpositive starting net has no percentage', () => {
  for (const net_cents of ['0', '-200']) {
    const result = review.periodChange([point('2026-01-01', { net_cents }), point(today)]);
    assert.equal(result.status, 'ready'); assert.equal(result.rate_hundredths, null);
  }
});
test('any intermediate scope change blocks comparison, but the first point refers outside the range', () => {
  const a = point('2026-01-01', { scope_changed: true }), b = point('2026-05-01'), c = point(today);
  assert.equal(review.periodChange([a, b, c]).status, 'ready');
  assert.equal(review.periodChange([a, { ...b, scope_changed: true }, c]).status, 'scope_changed');
  assert.equal(review.periodChange([a, { ...b, complete: false, scope_changed: true }, c]).status, 'scope_changed');
  assert.equal(review.periodChange([a]).status, 'insufficient');
});
test('shared axis includes zero for negative net and fits only visible series', () => {
  const both = chart.dualLineAxis([['-10000', '10000'], ['500000', '600000']], [true, true]);
  assert.ok(both.bottom < 0); assert.ok(both.top >= 600000); assert.ok(both.grid.includes(0));
  const onlyNet = chart.dualLineAxis([['-10000', '10000'], ['500000', '600000']], [true, false]);
  assert.ok(onlyNet.top < 500000); assert.ok(onlyNet.grid.includes(0));
  const onlyDebt = chart.dualLineAxis([['-10000'], ['500000', '600000']], [false, true]);
  assert.ok(onlyDebt.bottom > 0);
  assert.deepEqual(chart.dualLineAxis([[null], [null]], [true, true]), { bottom: 0, top: 1, grid: [0, 1] });
});
test('legend cannot disable the last line', () => {
  assert.deepEqual(chart.toggleTrendLine([true, true], 0), [false, true]);
  assert.deepEqual(chart.toggleTrendLine([false, true], 1), [false, true]);
  assert.deepEqual(chart.toggleTrendLine([false, true], 0), [true, true]);
});
test('range/custom dates and separate legends survive page remount only in the same library session', () => {
  review.clearTrendRange();
  const custom = { from: '2026-01-01', to: today };
  review.rememberTrendRange('虚构库', 'custom', custom); review.rememberTrendLegend('虚构库', 'net', [true, false, true]);
  custom.from = today;
  assert.deepEqual(review.recallTrendSelection('虚构库'), { range: 'custom', custom: { from: '2026-01-01', to: today } });
  assert.deepEqual(review.recallTrendLegend('虚构库', 'net'), [true, false, true]);
  assert.deepEqual(review.recallTrendLegend('虚构库', 'balances'), [true, true]);
  assert.equal(review.recallTrendRange('另一个虚构库'), 'all');
  assert.deepEqual(review.recallTrendLegend('另一个虚构库', 'net'), [true, false, false]);
  assert.equal(review.recallTrendRange('虚构库'), 'all');
});

// Run production hooks/handlers with minimal React/DOM stubs. No native UI claims.
function runtime(file, name, args, deps) {
  const slots = []; let cursor = 0, result;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect() { cursor++; }, useId() { return `id-${cursor++}`; },
  };
  const exports = {}, source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: id => id === 'react' ? react : id === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : deps[id] ?? {} });
  const render = () => { cursor = 0; result = exports[name](...args); return result; };
  const nodes = () => { const rows = []; const visit = v => { if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') { rows.push(v); visit(v.props?.children); } }; visit(result); return rows; };
  render(); return { render, nodes, get value() { return result; } };
}
const fakeWealth = { signedMoney: v => `¥${v}`, noteSummary: v => v || null, changeText: v => `¥${v}`, rateText: v => `${v / 100}%` };
test('invalid/reversed/sparse custom edits retain the previously applied curve and remembered selection', () => {
  review.clearTrendRange(); const points = [point('2026-01-01'), point('2026-09-01'), point(today)];
  const h = runtime('TrendRangeControl.tsx', 'useTrendSelection', ['虚构库', points, today], { './review': review });
  h.value.select('custom'); h.render();
  h.value.edit({ from: '2026-01-01', to: '2026-09-01' }); h.render();
  assert.deepEqual(dates(h.value.points), ['2026-01-01', '2026-09-01']);
  h.value.edit({ from: today, to: '2026-09-01' }); h.render(); assert.match(h.value.error, /不能晚于/);
  assert.deepEqual(dates(h.value.points), ['2026-01-01', '2026-09-01']);
  h.value.edit({ from: today, to: today }); h.render(); assert.match(h.value.error, /不足两次/);
  assert.deepEqual(dates(h.value.points), ['2026-01-01', '2026-09-01']);
  assert.deepEqual(review.recallTrendSelection('虚构库').custom, { from: '2026-01-01', to: '2026-09-01' });
});
test('keyboard tooltip/live text includes both lines and masking suppresses all financial values', () => {
  const points = [point('2026-01-01'), point(today, { net_cents: '987654321', liabilities_cents: '123456789', notes: '虚构备注987654321' })];
  review.rememberTrendLegend('双线隐私', 'net', [true, false, true]);
  const props = { points, hideAmounts: true, generation: '双线隐私' };
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [props], { './wealth': fakeWealth, './chart-change': { changeLine: () => '变化987654321' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  h.nodes().find(n => n.props?.tabIndex === 0).props.onFocus(); h.render();
  const text = JSON.stringify(h.nodes().map(n => n.props?.children));
  assert.match(text, /金融净资产/); assert.match(text, /负债/); assert.match(text, /\*{6}/);
  assert.ok(!text.includes('987654321')); assert.ok(!text.includes('123456789'));
  props.hideAmounts = false; h.render();
  let live = h.nodes().find(n => n.props?.['aria-live']); assert.match(live.props.children, /987654321/); assert.match(live.props.children, /123456789/);
  h.nodes().find(n => n.props?.tabIndex === 0).props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} }); h.render();
  live = h.nodes().find(n => n.props?.['aria-live']); assert.match(live.props.children, /2026-01-01/);
});
test('chart renders unknown markers, omits null balances and keeps at least one legend enabled', () => {
  const points = [point('2026-01-01'), point('2026-05-01', { complete: false, missing: 1 }), point(today, { liquid_cents: null })];
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [{ points, kind: 'balances', generation: '虚构图库' }], { './wealth': fakeWealth, './chart-change': { changeLine: () => '' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  assert.equal(h.nodes().filter(n => n.type === 'line' && n.props.className === 'partial-mark').length, 1);
  assert.equal(h.nodes().filter(n => n.type === 'circle').length, 3);
  h.nodes().filter(n => n.type === 'button')[0].props.onClick(); h.render();
  const buttons = h.nodes().filter(n => n.type === 'button'); assert.equal(buttons[1].props.disabled, true);
  assert.deepEqual(review.recallTrendLegend('虚构图库', 'balances'), [false, true]);
});
test('legend context refreshes immediately on library or chart kind changes', () => {
  review.clearTrendRange();
  const props = { points: [point('2026-01-01'), point(today)], generation: '虚构甲', kind: 'net' };
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [props], { './wealth': fakeWealth, './chart-change': { changeLine: () => '' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  // Enable debt before hiding net: the final visible line remains protected.
  h.nodes().filter(n => n.type === 'button')[1].props.onClick(); h.render();
  h.nodes().filter(n => n.type === 'button')[0].props.onClick(); h.render();
  assert.equal(h.nodes().filter(n => n.type === 'button')[0].props['aria-pressed'], false);
  props.generation = '虚构乙'; h.render();
  assert.equal(h.nodes().filter(n => n.type === 'button')[0].props['aria-pressed'], true);
  props.kind = 'balances'; h.render();
  assert.equal(h.nodes().filter(n => n.type === 'button')[0].props['aria-pressed'], true);
  props.generation = '虚构甲'; props.kind = 'net'; h.render();
  assert.equal(h.nodes().filter(n => n.type === 'button')[0].props['aria-pressed'], true);
});
test('single account history with one known point keeps its dot/date and has no debt legend', () => {
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [{ points: [point(today)], single: true, label: '虚构账户金额' }], { './wealth': fakeWealth, './chart-change': { changeLine: () => '' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  assert.equal(h.nodes().filter(n => n.type === 'circle').length, 1);
  assert.equal(h.nodes().filter(n => n.type === 'button').length, 0);
  assert.ok(h.nodes().some(n => n.type === 'text' && n.props.children === today));
  const path = h.nodes().find(n => n.type === 'path');
  assert.ok(!/NaN|Infinity/.test(path.props.d));
});

test('net defaults to one line and hidden series never leak into tooltip or live text', () => {
  review.clearTrendRange();
  const props = { points: [point('2026-01-01'), point(today, { liabilities_cents: '123456789' })], generation: '默认单线' };
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [props], { './wealth': fakeWealth, './chart-change': { changeLine: () => '净资产较上次' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  assert.equal(h.nodes().filter(n => n.type === 'circle').length, 2);
  h.nodes().find(n => n.props?.tabIndex === 0).props.onFocus(); h.render();
  assert.doesNotMatch(h.nodes().find(n => n.props?.['aria-live']).props.children, /负债|123456789/);
  h.nodes().filter(n => n.type === 'button')[1].props.onClick(); h.render();
  h.nodes().filter(n => n.type === 'button')[0].props.onClick(); h.render();
  const live = h.nodes().find(n => n.props?.['aria-live']).props.children;
  assert.match(live, /负债/); assert.doesNotMatch(live, /金融净资产|净资产较上次/);
});
test('balance tooltip describes balances without reporting unrelated net change', () => {
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [{ points: [point('2026-01-01'), point(today)], kind: 'balances' }], { './wealth': fakeWealth, './chart-change': { changeLine: () => '错误的净资产变化' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  h.nodes().find(n => n.props?.tabIndex === 0).props.onFocus(); h.render();
  assert.doesNotMatch(h.nodes().find(n => n.props?.['aria-live']).props.children, /错误的净资产变化/);
});

test('overview keeps its large single area chart, unknown markers and masked keyboard amounts', () => {
  const props = { hero: true, hideAmounts: true, points: [point('2026-01-01'), point('2026-05-01', { complete: false }), point(today, { net_cents: '987654321' })] };
  const h = runtime('Sparkline.tsx', 'Sparkline', [props], { './wealth': fakeWealth, './chart-change': { changeLine: () => '变化987654321' }, './chart-labels': { spacedLabels: p => p } });
  assert.ok(h.nodes().some(n => n.props?.className === 'ui-spark hero'));
  assert.equal(h.nodes().filter(n => n.type === 'button').length, 0);
  assert.equal(h.nodes().filter(n => n.type === 'path' && n.props.className === 'area').length, 1);
  assert.equal(h.nodes().filter(n => n.type === 'line' && n.props.className === 'partial').length, 1);
  h.nodes().find(n => n.props?.tabIndex === 0).props.onFocus(); h.render();
  assert.doesNotMatch(JSON.stringify(h.nodes().map(n => n.props?.children)), /987654321/);
  props.hideAmounts = false; h.render();
  assert.match(h.nodes().find(n => n.props?.['aria-live']).props.children, /987654321/);
  props.points = [point('2026-01-01'), point(today)]; h.render();
  assert.ok(h.nodes().filter(n => n.type === 'path').every(n => !/NaN|Infinity/.test(n.props.d)));
});

test('gradient areas preserve unknown gaps and do not fill isolated observations', () => {
  const result = chart.trendPaths([{ x: 1, y: -2 }, null, { x: 4, y: 6 }, { x: 8, y: 2 }], 10);
  assert.equal(result.line, 'M1,-2 M4,6 L8,2');
  assert.equal(result.area, 'M4,6 L8,2 L8,10 L4,10 Z');
  assert.deepEqual(chart.trendPaths([null, { x: 5, y: 1 }, null], 0), { line: 'M5,1', area: '' });
  assert.deepEqual(chart.trendPaths([], 0), { line: '', area: '' });
});

test('isolated known balance observations remain visible without hovering or filling unknown gaps', () => {
  const renderBalances = values => runtime('DualLineChart.tsx', 'DualLineChart', [{
    points: values.map((liquid_cents, i) => point(`2026-01-0${i + 1}`, { liquid_cents, invested_cents: null })), kind: 'balances',
  }], { './wealth': fakeWealth, './chart-change': { changeLine: () => '' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  for (const values of [['10000', null, null], [null, '0', null], [null, null, '-10000']]) {
    const h = renderBalances(values), dots = h.nodes().filter(n => n.type === 'circle');
    assert.equal(dots.length, 1);
    assert.match(dots[0].props.className, /\bisolated\b/);
    assert.ok(h.nodes().filter(n => n.props?.className === 'history-area').every(n => n.props.d === ''));
  }
  const h = renderBalances(['10000', null, '0', null, '-10000', '-20000', null]);
  const dots = h.nodes().filter(n => n.type === 'circle');
  assert.deepEqual(dots.map(n => /\bisolated\b/.test(n.props.className)), [true, true, false, false]);
  assert.equal((h.nodes().find(n => n.props?.className === 'history-area').props.d.match(/Z/g) ?? []).length, 1);
  assert.equal(renderBalances([null, null]).nodes().filter(n => n.type === 'circle').length, 0);
  const css = readFileSync(new URL('../src/dual-line-chart.css', import.meta.url), 'utf8');
  assert.match(css, /\.dual-dot\.isolated[^{}]*\{[^}]*opacity:\s*1\b/);
});

test('unknown visible balances show an explicit empty state and preserve legend recovery', () => {
  review.clearTrendRange();
  const props = { kind: 'balances', generation: '未知余额', points: [point('2026-01-01', { liquid_cents: null }), point(today, { liquid_cents: null })] };
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [props], { './wealth': fakeWealth, './chart-change': { changeLine: () => '' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  h.nodes().filter(n => n.type === 'button')[1].props.onClick(); h.render();
  assert.ok(h.nodes().some(n => n.type === 'text' && n.props.children === '所选范围暂无已知金额'));
  assert.equal(h.nodes().filter(n => n.type === 'line' && /history-(axis|grid)/.test(n.props.className)).length, 0);
  assert.equal(h.nodes().filter(n => n.type === 'button')[1].props.disabled, false);
  h.nodes().filter(n => n.type === 'button')[1].props.onClick(); h.render();
  assert.ok(!h.nodes().some(n => n.type === 'text' && n.props.children === '所选范围暂无已知金额'));
  assert.equal(h.nodes().filter(n => n.type === 'circle').length, 2);
});
test('net chart offers net, assets and liabilities; only the net line gets an area', () => {
  review.clearTrendRange();
  review.rememberTrendLegend('三线', 'net', [true, true, true]);
  const points = [point('2026-01-01'), point(today, { assets_cents: '2000', liabilities_cents: '500' })];
  const h = runtime('DualLineChart.tsx', 'DualLineChart', [{ points, generation: '三线' }], { './wealth': fakeWealth, './chart-change': { changeLine: () => '' }, './chart-labels': { spacedLabels: p => p }, './dual-line-chart': chart, './review': review });
  assert.equal(h.nodes().filter(n => n.type === 'button').length, 3);
  assert.equal(h.nodes().filter(n => n.type === 'path' && n.props.className === 'dual-line').length, 3);
  assert.equal(h.nodes().filter(n => n.type === 'path' && n.props.className === 'history-area').length, 1);
});
