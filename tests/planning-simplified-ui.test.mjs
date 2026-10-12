// 简化规划界面组件测试：运行生产 TSX 处理器，叶子控件与端口按测试替身注入。
// 组件通过领域 D0 契约（plan-simplified-contract / plan-simplified）消费唯一类型与校验，
// 不引入第二份模型；浏览器与原生验收另行登记。
import { posix } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as planSimplified from '../src/plan-simplified.ts';
import { createSimplifiedPlanningPortV1 } from '../src/planning-simplified-port.ts';
import * as incomeView from '../src/planning-simplified-ui/income-view.ts';
import { fictionalPort, normalFields, unknownFields } from '../src/planning-simplified-ui/fixtures.ts';

const ts = createRequire(import.meta.url)('typescript');
const COMPONENTS = ['planning-simplified-ui/OfficialToolLink', 'planning-simplified-ui/TimeFields', 'planning-simplified-ui/FutureIncomeFields', 'planning-simplified-ui/FutureIncomeSection', 'planning-simplified-ui/SimplifiedPlanningDialog'];
const EXPORTS = { 'planning-simplified-ui/OfficialToolLink': 'OfficialToolLink', 'planning-simplified-ui/TimeFields': 'TimeFields', 'planning-simplified-ui/FutureIncomeFields': 'FutureIncomeFields', 'planning-simplified-ui/FutureIncomeSection': 'FutureIncomeSection', 'planning-simplified-ui/SimplifiedPlanningDialog': 'SimplifiedPlanningDialog' };

// 受控 hook 状态在渲染间持久；卸载丢弃。只替换叶子控件与端口，不实现第二套界面。
export function runtime(file, props) {
  const slots = new Map(), cleanups = new Map(), instances = new Map();
  let mounted = new Set(), path = 'root', cursor = 0, effects = [], dirty = false;
  const focuses = [], closes = [], clipboardWrites = [];
  const window = { open: () => null };
  function discard(instance) {
    for (const key of slots.keys()) if (key.slice(0, key.lastIndexOf(':')) === instance) { cleanups.get(key)?.(); cleanups.delete(key); slots.delete(key); }
    instances.delete(instance);
  }
  function enter(instance, component) { if (instances.has(instance) && instances.get(instance) !== component) discard(instance); instances.set(instance, component); mounted.add(instance); path = instance; cursor = 0; }
  const hooks = {
    useId() { return `${path}:${cursor++}`; },
    useState(initial) { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial); return [slots.get(key), next => { slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next); dirty = true; }]; },
    useRef(initial) { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); },
    useEffect(fn, deps) { const key = `${path}:${cursor++}`, prev = slots.get(key); if (!prev || deps.some((v, i) => !Object.is(v, prev[i]))) { slots.set(key, deps); effects.push(() => { cleanups.get(key)?.(); cleanups.set(key, fn()); }); } },
    useMemo: fn => fn(),
  };
  const leaf = new Proxy({}, { get: (_, key) => String(key) });
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './plan-simplified.ts': planSimplified, './planning-simplified-port.ts': { createSimplifiedPlanningPortV1 },
    './planning-simplified-ui/income-view': incomeView,
  };
  function load(f) {
    const m = { exports: {} };
    const js = ts.transpileModule(readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(js, { module: m, exports: m.exports, require: id => modules[id.startsWith('.') ? './' + posix.normalize(posix.join(posix.dirname(f), id)) : id] ?? leaf, structuredClone, crypto: globalThis.crypto, console, navigator: { clipboard: { writeText: async v => { clipboardWrites.push(v); } } }, window, HTMLDetailsElement: class {}, requestAnimationFrame: fn => fn(), cancelAnimationFrame() {} });
    modules[`./${f}`] = m.exports;
  }
  for (const f of COMPONENTS) load(f);
  const component = modules[`./${file}`][EXPORTS[file]];
  const finalProps = { today: '2026-10-12', onClose: v => closes.push(v), ...props };
  let tree;
  function expand(node, key) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
    if (typeof node.type === 'function') { enter(key, node.type); return expand(node.type(node.props), `${key}:child`); }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
  }
  function render() {
    for (let round = 0; round < 6; round++) {
      dirty = false; effects = []; mounted = new Set();
      enter('root', component); tree = expand(component(finalProps), 'tree');
      for (const instance of instances.keys()) if (!mounted.has(instance)) discard(instance);
      for (const n of nodes()) if (n.props?.ref) n.props.ref.current = { showModal() {}, close() {}, focus: () => focuses.push(n.props['aria-label'] ?? n.props.id ?? 'focus'), scrollTo() {}, querySelector: () => ({ scrollTo() {} }), querySelectorAll: () => [] };
      effects.forEach(fn => fn());
      if (!dirty) break;
    }
    return tree;
  }
  const nodes = () => { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(tree); return out; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
  const find = (type, predicate = () => true) => nodes().find(n => n.type === type && predicate(n.props, n));
  const button = label => nodes().find(n => (n.type === 'button' || n.type === 'a' || n.type === 'CloseButton') && (n.props['aria-label'] === label || text(n) === label));
  const settle = async () => { await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); render(); };
  const unmount = () => { for (const instance of instances.keys()) discard(instance); tree = null; };
  render();
  return { unmount, render, nodes, text, find, button, settle, closes, focuses, clipboardWrites, window, props: finalProps };
}

const today = '2026-10-12';
const change = v => ({ target: { value: v } });
const issue = (path, code, message) => ({ path, code, message });

// ---------- 纯展示逻辑（income-view） ----------

test('basisSentence keeps the default basis readable in the main layer', () => {
  const base = incomeView.newIncome('pension');
  assert.equal(incomeView.basisSentence(base), '按开始领取时的金额；此后金额不自动增长。');
  assert.equal(incomeView.basisSentence({ ...base, growth: 'constant_purchasing_power' }), '按开始领取时的金额；此后保持同样购买力。');
  assert.equal(incomeView.basisSentence({ ...base, basis: 'reference_month', basis_month: '2026-10' }), '按 2026-10 的购买力填写；此后金额不自动增长。');
  assert.equal(incomeView.basisSentence({ ...base, basis: 'reference_month', basis_month: null }), '按所选月份的购买力；此后金额不自动增长。');
});

test('incomeState separates unknown, unselected and counted; zero stays explicit', () => {
  const base = incomeView.newIncome('other', 'fi-1');
  assert.equal(incomeView.incomeState({ ...base, monthly_cents: null, start_month: '2049-10' }), 'missing_amount');
  assert.equal(incomeView.incomeState({ ...base, monthly_cents: '0', start_month: null }), 'missing_start');
  assert.equal(incomeView.incomeState({ ...base, monthly_cents: '0', start_month: '2049-10' }), 'counted');
  assert.equal(incomeView.incomeState({ ...base, included: false, monthly_cents: '400000', start_month: '2049-10' }), 'excluded');
  assert.equal(incomeView.yuanText('400000'), '4,000 元');
  assert.equal(incomeView.yuanText(null), '未填金额');
});

test('excludedIncomeNote lists what a result does not include, never as zero', () => {
  const fields = { ...unknownFields() };
  const note = incomeView.excludedIncomeNote(fields);
  assert.match(note, /未计入：/);
  assert.match(note, /金额未填/);
  assert.match(note, /本次不计入/);
  assert.equal(incomeView.excludedIncomeNote({ ...fields, income_mode: 'excluded' }), null);
  assert.equal(incomeView.excludedIncomeNote(normalFields()), null);
});

test('newIncome pension defaults match the design; reset and duplicate helpers', () => {
  const p = incomeView.newIncome('pension', 'fi-p');
  assert.equal(p.name, '养老金'); assert.equal(p.basis, 'start_month'); assert.equal(p.growth, 'fixed_nominal'); assert.equal(p.included, true); assert.equal(p.monthly_cents, null);
  assert.equal(incomeView.newIncome('other', 'fi-o').name, '');
  assert.match(incomeView.resetReasonText(['time_unconfirmed', 'income_unconfirmed']), /规划条件已简化，请重新确认开始时间和未来收入/);
  const dup = { ...normalFields(), future_incomes: [...normalFields().future_incomes, { ...normalFields().future_incomes[0], id: 'fi-dup' }] };
  assert.deepEqual(incomeView.duplicateNameIds(dup).sort(), ['fictional-pension-1', 'fi-dup'].sort());
  assert.equal(incomeView.ageMonthsOf('36', '4'), 436);
  assert.equal(incomeView.ageMonthsOf('121', ''), null);
  assert.equal(incomeView.ageMonthsOf('36', '12'), null);
  assert.equal(incomeView.ageMonthsOf('', ''), null);
});

// ---------- 官方链接 ----------

test('official link verifies the target before opening and falls back to a copyable address', async () => {
  const ok = runtime('planning-simplified-ui/OfficialToolLink', { onOpen: () => true });
  ok.button('到国家社会保险公共服务平台测算 ↗').props.onClick();
  ok.render();
  assert.equal(ok.find('p', p => p.role === 'alert'), undefined);

  const failed = runtime('planning-simplified-ui/OfficialToolLink', { onOpen: () => false });
  failed.button('到国家社会保险公共服务平台测算 ↗').props.onClick();
  failed.render();
  const fallback = failed.find('p', p => p.role === 'alert');
  assert.match(failed.text(fallback), /si\.12333\.gov\.cn/);
  failed.button('复制地址').props.onClick();
  await failed.settle();
  assert.deepEqual(failed.clipboardWrites, ['https://si.12333.gov.cn/']);
  assert.ok(failed.button('已复制'));
});

// ---------- 时间输入与年龄换算 ----------

test('direct month input stores an explicit month and blank stays null', () => {
  const seen = [];
  const r = runtime('planning-simplified-ui/TimeFields', { value: { reference: null, target_month: null, horizon_month: null }, issues: [], busy: false, today, onChange: v => seen.push(v) });
  r.find('MonthInput', p => p.label === '退休开始月份').props.onChange('2050-01');
  assert.deepEqual(seen.at(-1).target_month, '2050-01');
  r.find('MonthInput', p => p.label === '退休开始月份').props.onChange('');
  assert.equal(seen.at(-1).target_month, null);
});

test('birth month converts both retirement and horizon ages immediately into explicit months', () => {
  const value = { reference: null, target_month: null, horizon_month: null }, seen = [];
  const r = runtime('planning-simplified-ui/TimeFields', { value, issues: [], busy: false, today, onChange: v => { seen.push(structuredClone(v)); Object.assign(value, v); } });
  assert.equal(r.find('MonthInput', p => p.label === '出生年月').props.value, '');
  r.find('MonthInput', p => p.label === '出生年月').props.onChange('1990-06'); r.render();
  r.find('input', p => p['aria-label'] === '退休年龄（岁）').props.onChange(change('60')); r.render();
  r.find('input', p => p['aria-label'] === '规划终点年龄（岁）').props.onChange(change('90')); r.render();
  assert.deepEqual(structuredClone(value.reference), { month: '1990-06', age_months: 0 });
  assert.equal(value.target_month, '2050-06'); assert.equal(value.horizon_month, '2080-06');
  assert.match(r.text(r.find('section')), /60 岁（2050-06）/);
  assert.match(r.text(r.find('section')), /90 岁（2080-06）/);
  r.find('input', p => p['aria-label'] === '退休年龄（岁）').props.onChange(change('')); r.render();
  assert.equal(value.target_month, null); assert.equal(value.horizon_month, '2080-06');
});

test('correcting birth month preserves saved dates and recomputes the displayed ages including extra months', () => {
  const value = { reference: { month: '1990-06', age_months: 0 }, target_month: '2053-10', horizon_month: '2086-10' };
  const r = runtime('planning-simplified-ui/TimeFields', { value, issues: [], busy: false, today, onChange: v => Object.assign(value, v) });
  assert.equal(r.find('input', p => p['aria-label'] === '退休年龄（岁）').props.value, '63');
  assert.equal(r.find('input', p => p['aria-label'] === '退休年龄：额外月份').props.value, '4');
  r.find('MonthInput', p => p.label === '出生年月').props.onChange('1991-07'); r.render();
  assert.equal(value.target_month, '2053-10'); assert.equal(value.horizon_month, '2086-10');
  assert.equal(r.find('input', p => p['aria-label'] === '退休年龄（岁）').props.value, '62');
  assert.equal(r.find('input', p => p['aria-label'] === '退休年龄：额外月份').props.value, '3');
  r.find('input', p => p['aria-label'] === '退休年龄（岁）').props.onChange(change('60')); r.render();
  assert.equal(value.target_month, '2051-07');
  assert.equal(r.find('input', p => p['aria-label'] === '退休年龄：额外月份').props.value, '');
});

test('an existing nonzero age reference remains usable without inventing a birth month', () => {
  const value = { reference: { month: '2026-10', age_months: 432 }, target_month: '2053-10', horizon_month: '2086-10' };
  const r = runtime('planning-simplified-ui/TimeFields', { value, issues: [], busy: false, today, onChange: v => Object.assign(value, v) });
  assert.equal(r.find('MonthInput', p => p.label === '出生年月').props.value, '');
  assert.equal(r.find('input', p => p['aria-label'] === '退休年龄（岁）').props.value, '63');
  r.find('input', p => p['aria-label'] === '规划终点年龄（岁）').props.onChange(change('90')); r.render();
  assert.equal(value.horizon_month, '2080-10');
  assert.deepEqual(value.reference, { month: '2026-10', age_months: 432 });
});

test('time issues from the domain surface next to the fields', () => {
  const r = runtime('planning-simplified-ui/TimeFields', { value: { reference: null, target_month: '2050-01', horizon_month: '2049-01' }, issues: [issue('time.horizon_month', 'invalid_order', '终点须晚于目标月')], busy: false, today, onChange: () => {} });
  assert.match(r.text(r.find('section')), /终点须晚于目标月/);
});

// ---------- 单笔未来收入编辑 ----------

const incomeEditor = (overrides = {}) => runtime('planning-simplified-ui/FutureIncomeFields', {
  value: incomeView.newIncome('pension', 'fi-1'), reference: { month: '2026-10', age_months: 432 }, issues: [], busy: false, today,
  onMerge: () => {}, onCancel: () => {}, ...overrides,
});
const unnamedIncome = () => ({ ...incomeView.newIncome('pension', 'fi-1'), name: '' });

test('pension editor keeps the basis sentence visible and links the official tool only for pension', () => {
  const r = incomeEditor();
  assert.match(r.text(r.find('div', p => p['aria-label'] === '编辑未来收入')), /按开始领取时的金额；此后金额不自动增长。/);
  assert.ok(r.button('到国家社会保险公共服务平台测算 ↗'));
  r.find('select', p => p['aria-label'] === '收入类型').props.onChange({ target: { value: 'other' } }); r.render();
  assert.equal(r.button('到国家社会保险公共服务平台测算 ↗'), undefined);
});

test('blank amount and start stay null and merge only after a name exists', () => {
  const merged = [];
  const r = incomeEditor({ value: unnamedIncome(), onMerge: v => merged.push(v) });
  r.find('CentInput', p => p.label === '每月预计净到账金额').props.onChange('400000');
  r.render();
  r.button('完成').props.onClick(); r.render();
  assert.match(r.text(r.find('div', p => p['aria-label'] === '编辑未来收入')), /请填写名称。/);
  assert.equal(merged.length, 0);
  r.find('input', p => p['aria-label'] === '收入名称').props.onChange(change(' 养老金 ')); r.render();
  r.button('完成').props.onClick();
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '养老金');
  assert.equal(merged[0].monthly_cents, '400000');
  assert.equal(merged[0].start_month, null);
});

test('reference-month basis requires an explicit basis month before merging', () => {
  const merged = [];
  const r = incomeEditor({ value: { ...incomeView.newIncome('pension', 'fi-1'), name: '养老金', basis: 'reference_month', basis_month: null }, onMerge: v => merged.push(v) });
  r.button('完成').props.onClick(); r.render();
  assert.match(r.text(r.find('div', p => p['aria-label'] === '编辑未来收入')), /请确认购买力基准月/);
  assert.equal(merged.length, 0);
  r.find('MonthInput', p => p.label === '购买力基准月').props.onChange('2026-06'); r.render();
  r.button('完成').props.onClick();
  assert.equal(merged.length, 1);
  assert.equal(merged[0].basis_month, '2026-06');
});

test('start month can be converted from an age against the shared reference', () => {
  const r = incomeEditor();
  r.find('input', p => p['aria-label'] === '开始领取年龄').props.onChange(change('63')); r.render();
  r.button('换算成开始月份').props.onClick(); r.render();
  assert.equal(r.find('MonthInput', p => p.label === '开始领取时间').props.value, '2053-10');
});

test('income-level issues surface with the domain path', () => {
  const r = incomeEditor({ issues: [issue('future_incomes.fi-1.monthly_cents', 'invalid_amount', '月金额须为 0—100000000 的规范整数分')] });
  assert.match(r.text(r.find('div', p => p['aria-label'] === '编辑未来收入')), /规范整数分/);
});

// ---------- 第四问分区 ----------

test('unconfirmed mode asks for an explicit choice; excluded and manual both save directly', () => {
  const drafts = [];
  const r = runtime('planning-simplified-ui/FutureIncomeSection', { fields: { contract_version: 1, time: { reference: null, target_month: null, horizon_month: null }, income_mode: 'unconfirmed', future_incomes: [] }, issues: [], busy: false, today, onDraftChange: f => drafts.push(f) });
  assert.equal(r.find('input', p => p['aria-label'] === '暂不计入').props.checked, false);
  assert.equal(r.find('input', p => p['aria-label'] === '填写预计收入').props.checked, false);
  assert.match(r.text(r.find('section', p => p['aria-label'] === '未来收入')), /先选择本次怎么处理未来收入/);
  r.find('input', p => p['aria-label'] === '暂不计入').props.onChange();
  assert.equal(drafts.at(-1).income_mode, 'excluded');
});

test('adding a pension income prefills the name and appends a complete draft', () => {
  const drafts = [];
  const fields = { ...unknownFields() };
  const r = runtime('planning-simplified-ui/FutureIncomeSection', { fields, issues: [], busy: false, today, onDraftChange: f => { drafts.push(f); Object.assign(fields, f); } });
  assert.match(r.text(r.find('section', p => p['aria-label'] === '未来收入')), /未计入：/);
  r.button('+ 养老金').props.onClick(); r.render();
  assert.equal(r.find('input', p => p['aria-label'] === '收入名称').props.value, '养老金');
  r.find('MonthInput', p => p.label === '开始领取时间').props.onChange('2049-11'); r.render();
  r.button('完成').props.onClick(); r.render();
  const added = drafts.at(-1).future_incomes.find(i => i.id !== 'fictional-pension-1' && i.id !== 'fictional-rent-1');
  assert.equal(added.name, '养老金');
  assert.equal(added.start_month, '2049-11');
  assert.equal(added.monthly_cents, null);
  assert.match(r.text(r.find('section', p => p['aria-label'] === '未来收入')), /未计入：养老金（未计入：金额未填）/);
});

test('included switch and two-step delete only touch their own income', () => {
  const drafts = [];
  const fields = normalFields();
  const r = runtime('planning-simplified-ui/FutureIncomeSection', { fields, issues: [], busy: false, today, onDraftChange: f => { drafts.push(f); Object.assign(fields, f); } });
  r.find('Switch', p => p.label === '计入养老金').props.onChange(false);
  assert.equal(drafts.at(-1).future_incomes.find(i => i.id === 'fictional-pension-1').included, false);
  assert.equal(drafts.at(-1).future_incomes.find(i => i.id === 'fictional-rent-1').included, true);
  r.button('删除').props.onClick(); r.render();
  assert.equal(drafts.length, 1, '删除需两步确认');
  r.button('确认删除').props.onClick(); r.render();
  assert.equal(drafts.at(-1).future_incomes.length, 1);
  assert.equal(drafts.at(-1).future_incomes[0].id, 'fictional-rent-1');
});

// ---------- 端口驱动的编辑入口 ----------

test('dialog reads through the port, saves once with the draft and closes only on saved', async () => {
  const saved = [];
  const port = { ...fictionalPort('normal'), save: async (f, c) => { saved.push({ f: structuredClone(f), c }); return { status: 'saved', revision: 4 }; } };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r.settle();
  assert.match(r.text(r.find('dialog')), /养老金/);
  r.find('input', p => p['aria-label'] === '暂不计入').props.onChange();
  r.render();
  r.button('保存').props.onClick();
  await r.settle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].c.generation, 'fictional-preview-generation');
  assert.equal(saved[0].c.expected_revision, 3);
  assert.equal(saved[0].f.income_mode, 'excluded');
  assert.deepEqual(r.closes, [true]);
});

test('a rejected save keeps the draft and lists the issues; retry submits again', async () => {
  const port = fictionalPort('reject');
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r.settle();
  r.find('MonthInput', p => p.label === '退休开始月份').props.onChange('2049-10'); r.render();
  r.button('保存').props.onClick();
  await r.settle();
  assert.deepEqual(r.closes, []);
  assert.match(r.text(r.find('dialog')), /有 2 项内容需要修改/);
  assert.match(r.text(r.find('dialog')), /终点须晚于目标月|月份须为 YYYY-MM/);
  // 修正后重试：输入保留，可再次提交。
  r.button('保存').props.onClick();
  await r.settle();
  assert.equal(r.closes.length, 0, '拒绝场景始终重试同一虚构拒绝');
});

test('an unresolved receipt freezes repeated submits and resolves through the receipt path', async () => {
  const calls = [];
  const inner = fictionalPort('unresolved');
  const port = { ...inner, save: async (f, c) => { calls.push(['save', c.request_id]); return inner.save(f, c); }, resolve: async c => { calls.push(['resolve', c.request_id]); return inner.resolve(c); } };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r.settle();
  r.button('保存').props.onClick();
  await r.settle();
  assert.match(r.text(r.find('dialog')), /保存请求已发出，结果未知/);
  assert.equal(r.button('保存').props.disabled, true);
  r.button('保存').props.onClick(); await r.settle();
  assert.equal(calls.length, 1, '冻结重复提交');
  r.button('核对保存结果').props.onClick();
  await r.settle();
  assert.deepEqual(calls.map(c => c[0]), ['save', 'resolve']);
  assert.deepEqual(r.closes, [true]);
  // 父级若仍挂载本窗口，冻结状态必须随之解除，不能留在不可操作状态。
  assert.equal(r.button('核对保存结果'), undefined);
  assert.equal(r.button('保存').props.disabled, false);
});

test('close and Esc discard the draft without saving; busy blocks Esc', async () => {
  let resolveSave;
  const port = { ...fictionalPort('normal'), save: () => new Promise(resolve => { resolveSave = resolve; }) };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r.settle();
  r.button('取消').props.onClick();
  assert.deepEqual(r.closes, [false]);
  // 第二次打开：Esc 在保存进行中不关闭。
  const r2 = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r2.settle();
  r2.button('保存').props.onClick(); r2.render();
  assert.equal(r2.button('保存').props.disabled, true);
  r2.find('dialog').props.onCancel({ preventDefault() {} });
  assert.deepEqual(r2.closes, []);
  resolveSave({ status: 'saved', revision: 5 });
  await r2.settle();
  assert.deepEqual(r2.closes, [true]);
});

test('read errors surface separately and never impersonate excluded income', async () => {
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port: fictionalPort('read-error') });
  await r.settle();
  assert.match(r.text(r.find('dialog')), /暂时读不到规划资料/);
  assert.ok(r.button('重新读取'));
  assert.equal(r.button('保存').props.disabled, true);
});

test('legacy plans show the reset notice without listing deleted policy fields', async () => {
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port: fictionalPort('legacy') });
  await r.settle();
  assert.match(r.text(r.find('dialog')), /规划条件已简化，请重新确认开始时间和未来收入/);
  assert.match(r.text(r.find('dialog')), /旧政策资料已移除/);
  assert.equal(r.find('input', p => p['aria-label'] === '暂不计入').props.checked, false);
});

test('domain validation from the D0 contract drives rejection end to end', async () => {
  const fields = normalFields();
  fields.time = { reference: { month: '2026-10', age_months: 436 }, target_month: '2086-10', horizon_month: '2049-10' };
  const driver = {
    read: async () => ({ generation: 'fictional-validation', revision: 1, fields, reset_reasons: [], capabilities: null }),
    save: async () => { throw new Error('不应到达驱动：校验应先拒绝'); },
    saveSetup: async () => { throw new Error('未使用'); },
    resolve: async () => ({ status: 'saved', revision: 2 }),
  };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port: createSimplifiedPlanningPortV1(driver) });
  await r.settle();
  r.button('保存').props.onClick();
  await r.settle();
  assert.deepEqual(r.closes, []);
  assert.match(r.text(r.find('dialog')), /终点须晚于目标月/);
});


test('same-tick duplicate submission dispatches only once', async () => {
  let calls = 0, finish;
  const port = { ...fictionalPort('normal'), save: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r.settle();
  const submit = r.button('保存').props.onClick;
  submit(); submit();
  assert.equal(calls, 1);
  r.find('dialog').props.onCancel({ preventDefault() {} });
  assert.deepEqual(r.closes, []);
  finish({ status: 'saved', revision: 4 }); await r.settle();
  assert.deepEqual(r.closes, [true]);
});

test('unfinished nested income cannot be silently omitted by parent save', async () => {
  const saved = [];
  const port = { ...fictionalPort('normal'), save: async fields => { saved.push(fields); return { status: 'saved', revision: 4 }; } };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  await r.settle();
  r.button('+ 养老金').props.onClick(); r.render();
  assert.equal(r.button('保存').props.disabled, true);
  assert.equal(r.find('input', p => p['aria-label'] === '暂不计入').props.disabled, true);
  assert.equal(r.button('+ 其他收入').props.disabled, true);
  r.button('保存').props.onClick(); await r.settle();
  assert.equal(saved.length, 0);
  r.find('CentInput', p => p.label === '每月预计净到账金额').props.onChange('123400'); r.render();
  r.button('完成').props.onClick(); r.render();
  assert.equal(r.button('保存').props.disabled, false);
  r.button('保存').props.onClick(); await r.settle();
  assert.equal(saved[0].future_incomes.at(-1).monthly_cents, '123400');
});

test('throwing save retains the original request, and throwing resolve stays retryable', async () => {
  let retained, seen, attempts = 0;
  const port = { ...fictionalPort('normal'), save: async (_fields, ctx) => { seen = ctx; throw new Error('lost reply'); }, resolve: async ctx => {
    assert.equal(ctx.request_id, seen.request_id);
    if (++attempts === 1) throw new Error('offline');
    return { status: 'saved', revision: 5 };
  } };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port, onPendingChange: ctx => { retained = ctx; } });
  await r.settle(); r.button('保存').props.onClick(); await r.settle();
  assert.equal(retained.request_id, seen.request_id);
  assert.equal(r.button('保存').props.disabled, true);
  r.button('核对保存结果').props.onClick(); await r.settle();
  assert.equal(r.button('核对保存结果').props.disabled, false);
  assert.equal(retained.request_id, seen.request_id);
  r.button('关闭，稍后核对保存结果').props.onClick(); r.unmount();
  const reopened = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port, pendingContext: retained, onPendingChange: ctx => { retained = ctx; } });
  await reopened.settle();
  assert.equal(reopened.button('保存').props.disabled, true);
  reopened.button('核对保存结果').props.onClick(); await reopened.settle();
  assert.equal(retained, null); assert.deepEqual(reopened.closes, [true]);
});

test('unresolved close is blocked unless a host retains its receipt', async () => {
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port: fictionalPort('unresolved') });
  await r.settle(); r.button('保存').props.onClick(); await r.settle();
  assert.equal(r.button('关闭时间与未来收入').props.disabled, true);
  r.find('dialog').props.onCancel({ preventDefault() {} });
  assert.deepEqual(r.closes, []);
});

test('late read completion after unmount has no effect', async () => {
  let finish;
  const port = { ...fictionalPort('normal'), read: () => new Promise(resolve => { finish = resolve; }) };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port });
  r.unmount();
  finish(await fictionalPort('normal').read());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(r.closes, []);
});

test('fictional receipt resolution persists exactly the submitted draft', async () => {
  const port = fictionalPort('unresolved');
  const read = await port.read();
  const fields = { ...read.fields, income_mode: 'excluded' };
  const context = { request_id: 'fictional-request', generation: read.generation, expected_revision: read.revision };
  assert.equal((await port.save(fields, context)).status, 'unresolved');
  assert.equal((await port.resolve(context)).status, 'saved');
  assert.equal((await port.read()).fields.income_mode, 'excluded');
});

test('default official entry uses an external anchor, and an opener exception is recoverable', () => {
  const r = runtime('planning-simplified-ui/OfficialToolLink', {});
  const link = r.find('a');
  assert.equal(link.props.href, 'https://si.12333.gov.cn/');
  assert.match(link.props.rel, /noopener/);
  const failed = runtime('planning-simplified-ui/OfficialToolLink', { onOpen: () => { throw new Error('unavailable'); } });
  failed.button('到国家社会保险公共服务平台测算 ↗').props.onClick(); failed.render();
  assert.match(failed.text(failed.find('p', p => p.role === 'alert')), /没有打开官方页面/);
});


test('late save completion after unmount cannot clear a host receipt from another session', async () => {
  let finish, retained;
  const port = { ...fictionalPort('normal'), save: () => new Promise(resolve => { finish = resolve; }) };
  const r = runtime('planning-simplified-ui/SimplifiedPlanningDialog', { port, onPendingChange: ctx => { retained = ctx; } });
  await r.settle(); r.button('保存').props.onClick();
  const original = retained;
  r.unmount();
  finish({ status: 'saved', revision: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(retained, original);
  assert.deepEqual(r.closes, []);
});


test('negative future income cannot silently become an unknown amount', () => {
  const merged = [];
  const r = incomeEditor({ onMerge: v => merged.push(v) });
  assert.equal(r.find('CentInput', p => p.label === '每月预计净到账金额').props.signed, true);
  r.find('CentInput', p => p.label === '每月预计净到账金额').props.onChange('-100'); r.render();
  r.button('完成').props.onClick(); r.render();
  assert.equal(merged.length, 0);
  assert.match(r.text(r.find('div', p => p['aria-label'] === '编辑未来收入')), /须为非负金额/);
  assert.equal(r.find('CentInput', p => p.label === '每月预计净到账金额').props.value, '-100');
  r.find('CentInput', p => p.label === '每月预计净到账金额').props.onChange('0'); r.render();
  r.button('完成').props.onClick();
  assert.equal(merged[0].monthly_cents, '0');
});
