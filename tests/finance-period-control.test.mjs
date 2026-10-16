// 财务期间选择组件测试：纯 helper 直接由 node 执行，组件用 typescript 转译 + vm React 桩运行生产处理器。
// DateInput／MonthInput／FormRow 用最小桩替换（记录传入的 min／max／disabled 并渲染原生 input），
// 真实日历浮层、表单布局与原生焦点由 tests/date-input-interactions.test.mjs 等覆盖，不在此重复。
// 本测试不代表真实 DOM、原生保存或无障碍验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import {
  FINANCE_PERIOD_KINDS,
  describeFinancePeriod,
  draftFromFinancePeriod,
  financePeriodFromDraft,
  initialFinancePeriodDraft,
  switchFinancePeriodKind,
} from '../src/finance-period-control.ts';

const today = '2026-10-12';

function draft(overrides) {
  return { ...initialFinancePeriodDraft(today), ...overrides };
}

// ---------------------------------------------------------------- 草稿校验（纯逻辑）

test('initial all draft derives year, month and range defaults from today without a synthetic range', () => {
  assert.deepEqual(initialFinancePeriodDraft(today), { kind: 'all', year: '2026', month: '2026-10', from: '2026-10-12', to: '2026-10-12', includeFrom: true });
  const result = financePeriodFromDraft(draft({ kind: 'all' }));
  assert.deepEqual(result, { ok: true, value: { kind: 'all' } });
  assert.deepEqual(Object.keys(result.value), ['kind']);
  assert.equal(describeFinancePeriod({ kind: 'all' }), '全部期间（不限定开始与结束）');
});

test('malformed today produces no fabricated defaults', () => {
  const empty = initialFinancePeriodDraft('');
  assert.deepEqual({ year: empty.year, month: empty.month, from: empty.from, to: empty.to }, { year: '', month: '', from: '', to: '' });
  assert.equal(financePeriodFromDraft({ ...empty, kind: 'year' }).ok, false);
});

test('year drafts accept 0001-9999 and reject partial, zero and overlong input', () => {
  assert.deepEqual(financePeriodFromDraft(draft({ kind: 'year', year: '0001' })), { ok: true, value: { kind: 'year', year: 1 } });
  assert.deepEqual(financePeriodFromDraft(draft({ kind: 'year', year: '9999' })), { ok: true, value: { kind: 'year', year: 9999 } });
  for (const invalid of ['', '26', '20266', '0000', 'abcd']) {
    const result = financePeriodFromDraft(draft({ kind: 'year', year: invalid }));
    assert.equal(result.ok, false, `${invalid} should fail`);
    assert.match(result.error, /[年份]/);
    assert.ok(!/RangeError|Invalid/.test(result.error));
  }
});

test('month drafts require YYYY-MM and a real 01-12 month', () => {
  assert.deepEqual(financePeriodFromDraft(draft({ kind: 'month', month: '2024-02' })), { ok: true, value: { kind: 'month', month: '2024-02' } });
  for (const invalid of ['', '2026-2', '2026-13', '2026-00', '0000-05', '2026/05']) {
    const result = financePeriodFromDraft(draft({ kind: 'month', month: invalid }));
    assert.equal(result.ok, false, `${invalid} should fail`);
    assert.ok(!/RangeError|Invalid/.test(result.error));
  }
});

test('range drafts reject partial input, invalid days, reversed order and an exclusive empty span', () => {
  const partial = financePeriodFromDraft(draft({ kind: 'range', from: '2026-1', to: '2026-10-31' }));
  assert.equal(partial.ok, false);
  assert.match(partial.error, /YYYY-MM-DD/);

  const empty = financePeriodFromDraft(draft({ kind: 'range', from: '', to: '2026-10-31' }));
  assert.equal(empty.ok, false);
  assert.match(empty.error, /请填写/);

  const reversed = financePeriodFromDraft(draft({ kind: 'range', from: '2026-10-20', to: '2026-10-10' }));
  assert.equal(reversed.ok, false);
  assert.match(reversed.error, /不能晚于/);

  const sameExclusive = financePeriodFromDraft(draft({ kind: 'range', from: '2026-10-10', to: '2026-10-10', includeFrom: false }));
  assert.equal(sameExclusive.ok, false);
  assert.match(sameExclusive.error, /不含起始日/);

  const sameInclusive = financePeriodFromDraft(draft({ kind: 'range', from: '2026-10-10', to: '2026-10-10', includeFrom: true }));
  assert.deepEqual(sameInclusive, { ok: true, value: { kind: 'range', from: '2026-10-10', to: '2026-10-10', includeFrom: true } });
});

test('leap days follow the contract rule without Date arithmetic', () => {
  assert.equal(financePeriodFromDraft(draft({ kind: 'range', from: '2024-02-29', to: '2024-03-31' })).ok, true);
  assert.equal(financePeriodFromDraft(draft({ kind: 'range', from: '2000-02-29', to: '2000-03-01' })).ok, true);
  for (const invalid of ['2023-02-29', '2100-02-29', '2026-04-31']) {
    const result = financePeriodFromDraft(draft({ kind: 'range', from: invalid, to: '2026-12-31' }));
    assert.equal(result.ok, false, `${invalid} should fail`);
    assert.match(result.error, /不存在/);
  }
});

test('exclusive range keeps includeFrom:false through the draft while inclusive stays the default', () => {
  const applied = { kind: 'range', from: '2026-09-30', to: '2026-10-31', includeFrom: false };
  const fromApplied = draftFromFinancePeriod(applied, today);
  assert.equal(fromApplied.includeFrom, false);
  assert.deepEqual(financePeriodFromDraft(fromApplied), { ok: true, value: applied });
  assert.match(describeFinancePeriod(applied), /不含起始日/);

  const backFromYear = switchFinancePeriodKind(switchFinancePeriodKind(fromApplied, 'year'), 'range');
  assert.equal(backFromYear.includeFrom, true);
  assert.equal(switchFinancePeriodKind(fromApplied, 'range'), fromApplied);
});

test('applied values populate the draft, including zero-padded years and the inclusive default for other kinds', () => {
  assert.deepEqual(draftFromFinancePeriod({ kind: 'year', year: 1 }, today), draft({ kind: 'year', year: '0001' }));
  assert.deepEqual(draftFromFinancePeriod({ kind: 'month', month: '2026-05' }, today), draft({ kind: 'month', month: '2026-05' }));
  assert.equal(draftFromFinancePeriod({ kind: 'all' }, today).includeFrom, true);
  assert.deepEqual(FINANCE_PERIOD_KINDS.map(kind => kind.label), ['全部', '年度', '月度', '自选日期']);
});

// ---------------------------------------------------------------- 组件交互

const ts = createRequire(import.meta.url)('typescript');
const FRAGMENT = Symbol('fragment');
const jsxStub = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: FRAGMENT };
const dateProps = [];
const reactStub = {};

function calendarNode(props) {
  return { type: 'input', props: { type: 'text', 'aria-label': props.label, value: props.value, disabled: props.disabled, min: props.min, max: props.max, onChange: event => props.onChange(event.target.value) } };
}
const dateInputStub = {
  DateInput: props => { dateProps.push({ kind: 'DateInput', ...props }); return calendarNode(props); },
  MonthInput: props => { dateProps.push({ kind: 'MonthInput', ...props }); return calendarNode(props); },
};
const formStub = { FormRow: props => ({ type: 'div', props: { className: 'form-row', children: [{ type: 'span', props: { children: props.label } }, props.children] } }) };

const cache = new Map();
function resolveFile(rel) {
  for (const candidate of [rel, `${rel}.ts`, `${rel}.tsx`]) {
    try { readFileSync(new URL(`../${candidate}`, import.meta.url)); return candidate; } catch { /* try the next candidate */ }
  }
  throw new Error(`cannot resolve ${rel}`);
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const m = { exports: {} };
  cache.set(rel, m.exports);
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const jsx = rel.endsWith('.tsx');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText;
  vm.runInNewContext(js, { module: m, exports: m.exports, require: id => resolve(id, posix.dirname(rel)), structuredClone, console, crypto: globalThis.crypto });
  return m.exports;
}
function resolve(id, fromDir) {
  if (id === 'react') return reactStub;
  if (id === 'react/jsx-runtime') return jsxStub;
  if (id.startsWith('.')) {
    const rel = posix.normalize(posix.join(fromDir, id));
    if (rel === 'src/DateInput') return dateInputStub;
    if (rel === 'src/YearSelect') return { YearSelect: props => ({type:'select',props:{'aria-label':'年份',value:props.value === null ? '' : String(props.value).padStart(4,'0'),disabled:props.disabled,onChange:e=>props.onChange(Number(e.target.value)),recorded:props.recorded}}) };
    if (rel === 'src/FormControls') return formStub;
    return load(resolveFile(rel));
  }
  throw new Error(`unexpected import ${id}`);
}

/** 单组件挂载：状态槽跨渲染保留，effects 在每次渲染后执行（与投资复盘组件测试同一思路）。 */
class Harness {
  constructor(props) {
    this.component = load('src/FinancePeriodControl.tsx').FinancePeriodControl;
    this.slots = new Map();
    this.cleanups = new Map();
    this.instances = new Map();
    this.props = props;
    this.tree = null;
    let path = 'root', cursor = 0;
    const slots = this.slots, cleanups = this.cleanups, instances = this.instances;
    let effects = [], dirty = false;
    const discard = instance => {
      for (const key of slots.keys())
        if (key.slice(0, key.lastIndexOf(':')) === instance) {
          cleanups.get(key)?.();
          cleanups.delete(key);
          slots.delete(key);
        }
      instances.delete(instance);
    };
    reactStub.useId = () => `${path}:${cursor++}`;
    reactStub.useState = initial => {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => { slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next); dirty = true; }];
    };
    reactStub.useRef = initial => { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); };
    reactStub.useEffect = (fn, deps) => {
      const key = `${path}:${cursor++}`, prev = slots.get(key);
      if (!prev || !deps || deps.some((v, i) => !Object.is(v, prev[i]))) {
        slots.set(key, deps);
        effects.push(() => { cleanups.get(key)?.(); cleanups.set(key, fn()); });
      }
    };
    reactStub.useMemo = fn => fn();
    reactStub.useLayoutEffect = reactStub.useEffect;
    this.rerender = () => {
      for (let round = 0; round < 8; round++) {
        dirty = false;
        effects = [];
        const mounted = new Set();
        const expand = (node, key) => {
          if (node === null || node === undefined || typeof node !== 'object') return node;
          if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
          if (typeof node.type === 'function') {
            if (instances.has(key) && instances.get(key) !== node.type) discard(key);
            instances.set(key, node.type);
            mounted.add(key);
            const prevPath = path, prevCursor = cursor;
            path = key;
            cursor = 0;
            const out = expand(node.type(node.props), `${key}:child`);
            path = prevPath;
            cursor = prevCursor;
            return out;
          }
          return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
        };
        const prevPath = path;
        path = 'root';
        cursor = 0;
        this.tree = expand(this.component(this.props), 'tree');
        path = prevPath;
        for (const instance of [...instances.keys()]) if (!mounted.has(instance) && instance !== 'tree') discard(instance);
        for (const fn of effects) fn();
        if (!dirty) break;
      }
    };
    this.rerender();
  }
  set(props) { this.props = props; this.rerender(); }
  text() {
    const parts = [];
    const walk = node => {
      if (node === null || node === undefined) return;
      if (typeof node === 'string' || typeof node === 'number') { parts.push(String(node)); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'object' && node.props) walk(node.props.children);
    };
    walk(this.tree);
    return parts.join(' ');
  }
  find(pred) {
    const out = [];
    const walk = node => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node.type === 'string' && pred(node)) out.push(node);
      if (node.props) walk(node.props.children);
    };
    walk(this.tree);
    return out;
  }
  button(text) { return this.find(n => n.type === 'button' && collects(n) === text)[0]; }
}
function collects(node) {
  const parts = [];
  const walk = n => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string' || typeof n === 'number') parts.push(String(n));
    else if (Array.isArray(n)) n.forEach(walk);
    else if (typeof n === 'object' && n.props) walk(n.props.children);
  };
  walk(node);
  return parts.join(' ');
}
function dateProp(kind, label) {
  return [...dateProps].reverse().find(entry => entry.kind === kind && entry.label === label);
}

// vm 里产生的对象带有另一 realm 的原型，比较前复制成宿主普通对象。
function committed(changes) { return changes.map(value => ({ ...value })); }

test('review presets reuse Range while custom dates and year clear the preset without changing other consumers', () => {
  const recent = {kind:'range',from:'2025-10-12',to:today,includeFrom:true};
  const changes = [], selections = [];
  const props = {value:recent,today,onChange:value=>changes.push(value),
    options:[{value:'year',label:'自然年'},{value:'range',label:'自选日期'}],
    presets:[{id:'recent12',label:'近 12 个月',period:recent}],activePreset:'recent12',onPresetChange:id=>selections.push(id)};
  const h = new Harness(props);
  assert.equal(h.button('全部'),undefined);assert.equal(h.button('月度'),undefined);
  assert.equal(h.button('近 12 个月').props['aria-pressed'],true);
  assert.equal(h.find(n=>n.type==='input').length,0);
  h.button('自选日期').props.onClick();h.set({...props,activePreset:null});
  assert.equal(selections.at(-1),null);assert.equal(h.find(n=>n.type==='input').length,2);
  h.button('自然年').props.onClick();h.rerender();
  assert.deepEqual(committed(changes).at(-1),{kind:'year',year:2026});
  h.set({...props,value:{kind:'year',year:2024},activePreset:null});
  h.button('近 12 个月').props.onClick();h.rerender();
  assert.equal(selections.at(-1),'recent12');assert.deepEqual(committed(changes).at(-1),recent);
  const before=changes.length;h.set({...props,disabled:true});h.button('近 12 个月').props.onClick();h.button('自然年').props.onClick();assert.equal(changes.length,before);
});

test('year dropdown and all selections refresh immediately', () => {
  const changes = [];
  const h = new Harness({ value: { kind: 'all' }, onChange: value => changes.push(value), today });
  assert.equal(h.button('全部').props['aria-pressed'], true);
  assert.equal(h.button('应用期间'), undefined);
  h.button('年度').props.onClick(); h.rerender();
  assert.deepEqual(committed(changes), [{ kind: 'year', year: 2026 }]);
  const year = h.find(n => n.type === 'select' && n.props['aria-label'] === '年份')[0];
  assert.equal(year.props.value, '2026');
  assert.equal(h.find(n => n.type === 'input' && n.props['aria-label'] === '年份').length, 0);
  h.find(n => n.type === 'select' && n.props['aria-label'] === '年份')[0].props.onChange({ target: { value: '1999' } }); h.rerender();
  assert.deepEqual(committed(changes).at(-1), { kind: 'year', year: 1999 });
  h.set({ value: { kind: 'year', year: 1999 }, onChange: value => changes.push(value), today });
  h.button('全部').props.onClick(); h.rerender();
  assert.deepEqual(committed(changes).at(-1), { kind: 'all' });
});

test('disabled controls cannot change the period, including date bounds forwarding', () => {
  const changes = [];
  const h = new Harness({ value: { kind: 'range', from: '2026-01-01', to: '2026-12-31', includeFrom: true }, onChange: value => changes.push(value), today, disabled: true });
  for (const label of ['全部', '年度', '月度', '自选日期']) {
    assert.equal(h.button(label).props.disabled, true);
    h.button(label).props.onClick();
  }
  assert.equal(dateProp('DateInput', '开始日期').disabled, true);
  assert.equal(dateProp('DateInput', '开始日期').min, '0001-01-01');
  assert.equal(dateProp('DateInput', '结束日期').min, '0001-01-01');
  assert.deepEqual(changes, []);
});

test('month selections forward the contract minimum and immediately refresh', () => {
  const changes = [];
  const h = new Harness({ value: { kind: 'all' }, onChange: value => changes.push(value), today });
  h.button('月度').props.onClick(); h.rerender();
  assert.equal(dateProp('MonthInput', '月份').min, '0001-01');
  h.find(n => n.type === 'input' && n.props['aria-label'] === '月份')[0].props.onChange({ target: { value: '2026-02' } }); h.rerender();
  assert.deepEqual(committed(changes), [{ kind: 'month', month: '2026-10' }, { kind: 'month', month: '2026-02' }]);
});

test('invalid ranges keep results; fixing the end immediately refreshes both dates', () => {
  const changes = [];
  const h = new Harness({ value: { kind: 'range', from: '2026-10-01', to: '2026-10-10', includeFrom: true }, onChange: value => changes.push(value), today });
  h.find(n => n.type === 'input' && n.props['aria-label'] === '开始日期')[0].props.onChange({ target: { value: '2026-10-20' } }); h.rerender();
  assert.deepEqual(changes, []);
  assert.match(h.text(), /开始日期不能晚于结束日期/);
  h.find(n => n.type === 'input' && n.props['aria-label'] === '结束日期')[0].props.onChange({ target: { value: '2026-10-25' } }); h.rerender();
  assert.deepEqual(committed(changes), [{ kind: 'range', from: '2026-10-20', to: '2026-10-25', includeFrom: true }]);
  assert.equal(h.find(n => n.props?.role === 'alert').length, 0);
});

test('an external value change discards partial input and clears the error', () => {
  const h = new Harness({ value: { kind: 'range', from: '2026-10-01', to: '2026-10-12', includeFrom: true }, onChange() {}, today });
  h.find(n => n.type === 'input' && n.props['aria-label'] === '开始日期')[0].props.onChange({ target: { value: '2026-10-20' } }); h.rerender();
  assert.equal(h.find(n => n.props?.role === 'alert').length, 1);
  h.set({ value: { kind: 'month', month: '2026-05' }, onChange() {}, today });
  assert.equal(h.button('月度').props['aria-pressed'], true);
  assert.equal(h.find(n => n.type === 'input' && n.props['aria-label'] === '月份')[0].props.value, '2026-05');
  assert.equal(h.find(n => n.props?.role === 'alert').length, 0);
});

test('a parent echo preserves range edits and switching kinds restores the inclusive default', () => {
  let props;
  const changes = [];
  const onChange = value => { changes.push(value); props = { ...props, value }; };
  props = { value: { kind: 'range', from: '2026-09-30', to: '2026-10-31', includeFrom: false }, onChange, today };
  const h = new Harness(props);
  h.find(n => n.type === 'input' && n.props['aria-label'] === '结束日期')[0].props.onChange({ target: { value: '2026-11-30' } }); h.set(props);
  assert.equal(changes[0].includeFrom, false);
  h.button('年度').props.onClick(); h.set(props);
  h.button('自选日期').props.onClick(); h.set(props);
  assert.deepEqual(committed(changes).at(-1), { kind: 'range', from: '2026-09-30', to: '2026-11-30', includeFrom: true });
  h.button('自选日期').props.onClick(); h.rerender();
  assert.equal(changes.length, 3, 'selecting the same valid period does not re-fetch');
});

test('year dropdown preserves low-year selection and its disabled guard', () => {
  const changes = [];
  const h = new Harness({ value: { kind: 'year', year: 1 }, onChange: v => changes.push(v), today, disabled: true });
  const year = h.find(n => n.type === 'select' && n.props['aria-label'] === '年份')[0];
  assert.equal(year.props.value, '0001');
  assert.equal(year.props.disabled, true);
  year.props.onChange({ target: { value: '2025' } }); h.rerender();
  assert.equal(changes.length, 0);
});
