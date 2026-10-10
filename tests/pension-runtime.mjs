import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as annotations from '../src/plan-annotations.ts';
import * as actions from '../src/plan-occurrence-actions.ts';
import * as flow from '../src/planning-first-run.ts';
import * as defaults from '../src/planning-basic-defaults.ts';
import * as debt from '../src/plan-debt.ts';
import * as overlay from '../src/planning-draft.ts';
import * as validation from '../src/plan-basic-validation.ts';
import * as pension from '../src/planning-pension-refinement.ts';
import * as forms from '../src/planning-basic-forms.ts';
import * as basic from '../src/plan-basic.ts';
import * as core from '../src/plan-core.ts';
import * as coverage from '../src/plan-coverage.ts';
import * as costReview from '../src/planning-cost-review.ts';
import * as view from '../src/planning-basic-view.ts';
import * as planExports from '../src/plan.ts';
import * as params from '../src/plan-params.ts';
import { unknownCapabilityFixture } from '../src/plan-basic-fixtures.ts';
const ts = createRequire(import.meta.url)('typescript');
export function runtime(file, props, save = async () => ({ revision: 5 }), caps = unknownCapabilityFixture) {
  const slots = new Map(), calls = [], closes = [];
  let path = 'root', cursor = 0;
  let effects = [], dirty = false;
  const focuses = [];
  const hooks = {
    useId() { return `${path}:${cursor++}`; },
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
    './planning-basic-forms': forms, './plan-basic': basic, './plan-core': core, './plan-coverage': coverage, './planning-cost-review': costReview, './plan-debt': debt, './plan-annotations': annotations, './plan-occurrence-actions': actions, './wealth': { kindLabel: v => v }, './asset': { money: c => `¥${c}` }, './review': { ready: r => r?.status === 'ready' ? r.value : null },
    './planning-draft': overlay, './plan-basic-validation': validation, './planning-pension-refinement': pension, './plan': planExports, './plan-params': params,
    './planning-first-run': props.goalStateOverride ? { ...flow, goalState: () => props.goalStateOverride } : flow, './planning-basic-defaults': defaults,
    './planning-basic-data': { useSectionSaver: () => saver, useCapabilities: () => ({ status: 'ready', caps: typeof caps === 'function' ? caps() : caps }) },
    './planning-basic-view': { needsContribution: () => true, requirementLine: props.realSummary ? view.requirementLine : () => ({ text: '每月 ¥4700', tone: '' }), SAVE_CONTRIBUTION_HINT: '待估计' },
    './plan-retire-calc': { buildRetireCalc: () => null },
  };
  function load(file) {
    const m = { exports: {} };
    const js = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(js, { module: m, exports: m.exports, require: id => modules[id] ?? leaf, structuredClone, crypto: globalThis.crypto, console, HTMLDetailsElement: class {}, cancelAnimationFrame() {}, requestAnimationFrame: fn=>fn() });
    modules[`./${file}`] = m.exports;
  }
  for (const file of ['PlanningConfirmation', 'PlanningFunds', 'PlanningCosts', 'PlanningDebtDialog', 'PlanningOccurrenceDialog', 'PlanningRetirementIncome', 'PlanningSpendItems', 'PlanningPensionContributions', 'PlanningProfileFields', 'PlanningPensionRefinement', 'PlanningRefinements']) load(file);
  const module = { exports: {} };
  const script = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, { module, exports: module.exports, require: id => modules[id] ?? leaf, crypto: globalThis.crypto, structuredClone, Error, console, document: {getElementById:()=>({isConnected:true,focus(){}})}, HTMLDetailsElement: class {}, cancelAnimationFrame() {}, requestAnimationFrame: fn=>fn() });
  const component = module.exports[file === 'PlanningPensionRefinement' ? 'PlanningPensionRefinementDialog' : file === 'PlanningFunds' ? 'FundsDialog' : file === 'PlanningCosts' ? 'CostsDialog' : file === 'CoverageNote' ? 'CoverageNote' : file === 'PlanningDebtDialog' ? 'PlanningDebtDialog' : file === 'PlanningSetup' ? 'PlanningSetupDialog' : file === 'PlanningOccurrenceDialog' ? 'PlanningOccurrenceDialog' : 'PlanningBasicGoals'];
  const finalProps = { today: props.sources.today, snapshot: null, accounts: [], reload() {}, onPending() {}, onPension() {}, onEditingChange() {}, onFocusDone() {}, onClose: v => closes.push(v), ...props };
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
        querySelectorAll() { const descendants=[];const collect=v=>{if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){descendants.push(v);collect(v.props?.children);}};collect(n.props?.children);return descendants.filter(v=>['input','select','button','CentInput','MonthInput','DateInput'].includes(v.type)&&!v.props.disabled).map(v=>({getAttribute:key=>key==='aria-label'?(v.props['aria-label']??v.props.label):null,setAttribute(){},removeAttribute(){},focus:()=>focuses.push(v.props['aria-label']??v.props.label)})); },
        querySelector(selector) {
          if (selector === '.planning-setup-body' || selector === '.planning-pension-body') return { scrollTo() {} };
          if (selector.startsWith('input:not')) { const descendants = []; const collect = v => { if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object'){descendants.push(v);collect(v.props?.children);} }; collect(n.props?.children); const child = descendants.find(v=>['input','select','button','CentInput','MonthInput','DateInput'].includes(v.type)&&!v.props.disabled); return child ? {focus:()=>focuses.push(child.props['aria-label']??child.props.label)} : null; }
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
