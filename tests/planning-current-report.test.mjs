import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { basicFixtureSources, basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { currentReportInput } from '../src/planning-report/current-adapter.ts';
import * as model from '../src/planning-report/model.ts';

const noop = () => {};
function harness(file, name, props, deps = {}, globals = {}) {
  const slots = [], effects = [], cleanup = []; let cursor = 0, dirty = false, tree;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn,
    useEffect(fn, values) { const i = cursor++; const before = slots[i]; if (!before || !values || values.some((value, index) => !Object.is(value, before[index]))) { slots[i] = values; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
  };
  const exports = {};
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) } : deps[id] ?? new Proxy({}, { get: (_, key) => String(key) }), requestAnimationFrame: fn => fn(), document: { activeElement: null }, ...globals });
  const render = () => { for (let round = 0; round < 8; round++) { dirty = false; cursor = 0; effects.length = 0; tree = exports[name](props); effects.splice(0).forEach(fn => fn()); if (!dirty) return tree; } throw Error('render did not settle'); };
  const nodes = () => { const out = []; const visit = value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { out.push(value); visit(value.props?.children); } }; visit(tree); return out; };
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
  const button = label => nodes().find(row => row.type === 'button' && text(row) === label);
  render(); return { render, nodes, text, button, unmount: () => cleanup.forEach(fn => fn?.()) };
}

function page() {
  let load = { status: 'ready', sources: basicFixtureSources(basicInputFixtures.prediction) }, restored, bar, pending = null, focuses = 0, reloads = 0;
  const props = { today: load.sources.today, onEditingChange: noop, onTab: noop, onFocusDone: noop };
  const r = harness('PlanningPage.tsx', 'PlanningPage', props, {
    './planning-basic-data': { usePlanningSources: () => ({ load, reload: () => reloads++ }) },
    './planning-basic-view': { modeOf: () => 'basic' }, './review': { ready: r => r.status === 'ready' ? r.value : null },
    './planning-followup-port': { nativePlanningFollowupPortV1: () => null },
    './plan-basic': { buildBasicCapabilities }, './planning-report/current-adapter': { currentReportInput },
    './WealthPage': { usePendingReceipt: () => ({ pending, busy: false }) },
    './undo': { useRestored: cb => { restored = cb; } },
    './topbar': { usePageBar: (_, value) => { bar = value; } }, './topbar-model': { refocusHeading: () => focuses++ },
    './PlanningCurrentReportDialog': { PlanningCurrentReportDialog: 'ReportDialog' },
    './PlanningBasicGoals': { PlanningBasicGoals: 'Goals' }, './PlanningGoalOccurrences': { PlanningGoalOccurrences: 'Occurrences' },
  });
  return { ...r, setLoad(value) { load = value; r.render(); }, get load() { return load; }, restore() { restored(); r.render(); }, setPending(value) { pending = value; r.render(); }, get bar() { return bar; }, get focuses() { return focuses; }, get reloads() { return reloads; } };
}

test('current report generation freezes one saved result through normal reload and source edits', () => {
  const r = page(); const trigger = { isConnected: true, matches: () => false, focus: noop };
  r.button('查看当前报告').props.onClick({ currentTarget: trigger }); r.render();
  const first = r.nodes().find(row => row.type === 'ReportDialog').props.report, original = JSON.stringify(first);
  assert.equal(r.bar.primary.disabled, true); assert.equal(r.nodes().find(row => row.type === 'Occurrences').props.blocked, true);
  r.setLoad({ status: 'loading' }); assert.equal(r.nodes().find(row => row.type === 'ReportDialog').props.report, first);
  const s = basicFixtureSources(basicInputFixtures.zero); s.write_version = 2; s.profile.value.saved.revision = 2;
  r.setLoad({ status: 'ready', sources: s }); assert.equal(JSON.stringify(r.nodes().find(row => row.type === 'ReportDialog').props.report), original);
});

test('trusted library/module/restore changes discard the report; close handles disabled opener', () => {
  for (const mode of ['generation', 'module', 'restore']) {
    const r = page(); r.button('查看当前报告').props.onClick({ currentTarget: { isConnected: true, matches: () => true, focus() { throw Error('disabled focus'); } } }); r.render();
    if (mode === 'restore') { r.restore(); assert.equal(r.reloads, 1); }
    else { const s = structuredClone(r.load.sources); if (mode === 'generation') s.generation = 'new-library'; else s.modules.planning = false; r.setLoad({ status: 'ready', sources: s }); }
    assert.equal(r.nodes().some(row => row.type === 'ReportDialog'), false);
  }
  const r = page(); r.button('查看当前报告').props.onClick({ currentTarget: { isConnected: true, matches: () => true, focus() { throw Error('disabled focus'); } } }); r.render();
  r.nodes().find(row => row.type === 'ReportDialog').props.onClose(); r.render(); assert.equal(r.focuses, 1);
});

test('unsaved sources, errors and pending receipts cannot generate a report', () => {
  const r = page(); r.setPending({ label: 'pending' }); assert.equal(r.button('查看当前报告').props.disabled, true);
  r.button('查看当前报告').props.onClick({ currentTarget: {} }); r.render(); assert.equal(r.nodes().some(row => row.type === 'ReportDialog'), false);
  r.setPending(null); const s = structuredClone(r.load.sources); s.profile.value.saved = null; r.setLoad({ status: 'ready', sources: s }); assert.equal(r.button('查看当前报告').props.disabled, true);
  r.setLoad({ status: 'error', message: '虚构读取失败' }); assert.equal(r.button('查看当前报告').props.disabled, true);
});

test('actual dialog starts private, disables unverified printing and closes without a write', () => {
  let closes = 0;
  const s = basicFixtureSources(), report = currentReportInput(s, buildBasicCapabilities(s), s.today);
  const r = harness('PlanningCurrentReportDialog.tsx', 'PlanningCurrentReportDialog', { report, onClose: () => closes++ }, { './planning-report/PlanningReport': { PlanningReport: 'Report' } });
  let child = r.nodes().find(row => row.type === 'Report'); assert.equal(child.props.privacy, true); assert.equal(child.props.allowPrint, false);
  child.props.onPrivacyChange(false); r.render(); child = r.nodes().find(row => row.type === 'Report'); assert.equal(child.props.privacy, false); assert.equal(child.props.outer.input, report);
  r.nodes().find(row => row.type === 'dialog').props.onCancel({ preventDefault: noop }); assert.equal(closes, 1);
});

test('real copy handler reports failure, retries identical private text and has no print action', async () => {
  const s = basicFixtureSources(basicInputFixtures.prediction), report = currentReportInput(s, buildBasicCapabilities(s), s.today);
  let reject = true; const copied = [];
  const props = { outer: { status: 'ready', input: report }, privacy: true, allowPrint: false, onPrivacyChange: noop };
  const r = harness('planning-report/PlanningReport.tsx', 'PlanningReport', props, { './model.ts': model }, { navigator: { clipboard: { async writeText(text) { copied.push(text); if (reject) throw Error('clipboard denied'); } } } });
  assert.equal(r.button('打印版'), undefined);
  await r.button('复制摘要').props.onClick(); r.render(); assert.ok(r.nodes().some(row => row.props?.role === 'alert' && r.text(row) === '复制失败，请重试。')); assert.equal(r.button('已复制'), undefined);
  reject = false; await r.button('复制摘要').props.onClick(); r.render(); assert.ok(r.button('已复制')); assert.equal(copied[0], copied[1]);
  assert.ok(!copied[1].includes('¥')); assert.ok(copied[1].includes('金额已隐藏'));
  props.privacy = false; r.render(); assert.ok(r.button('复制摘要')); await r.button('复制摘要').props.onClick(); r.render(); assert.ok(copied[2].includes('¥'));
});

test('structured current conclusion is not replaced by the generic limited-coverage label', async () => {
  const s = basicFixtureSources(), report = currentReportInput(s, buildBasicCapabilities(s), s.today);
  const label = '本报告保留部分结果，请结合缺项与未覆盖内容核对。'; let copied, selectedPrivacy;
  const r = harness('planning-report/PlanningReport.tsx', 'PlanningReport', { outer: { status: 'ready', input: report }, privacy: true, allowPrint: false, incompleteHeadlineLabel: label, onPrivacyChange: v => selectedPrivacy = v }, { './model.ts': model }, { navigator: { clipboard: { async writeText(text) { copied = text; } } } });
  assert.ok(r.nodes().some(row => row.props?.className === 'pr-headline' && r.text(row) === model.reportConclusion(report)));
  assert.ok(r.nodes().some(row => row.props?.['aria-label'] === '关键结果'));
  assert.ok(r.nodes().some(row => row.props?.['aria-label'] === '主要条件摘要'));
  assert.equal(r.nodes().some(row => row.props?.['aria-label'] === '资金趋势'), false);
  assert.equal(r.nodes().some(row => row.props?.['aria-label'] === '目标结果'), false);
  await r.button('复制摘要').props.onClick(); r.render(); assert.ok(copied.includes(model.reportConclusion(report))); assert.ok(!copied.includes(label));
  r.button('显示金额').props.onClick();
  assert.equal(selectedPrivacy,false);assert.ok(!r.text(r.nodes()).includes('¥'));
});
