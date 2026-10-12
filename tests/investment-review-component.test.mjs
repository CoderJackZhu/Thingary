// 投资区间复盘组件交互测试：用 typescript 转译 + vm 桩化的 React hooks 执行生产 TSX 处理器，
// 验证卡片各状态与核对窗草稿端口可操作。与 planning-component-runtime 同一思路，仅限本目录。
// 不验证真实 DOM／原生保存；原生焦点、VoiceOver 与系统输入法另行验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { draftFromFlow, emptyFlowDraft } from '../src/investment-review/model.ts';
import { confirmedFlowFixture, reviewFixtures } from '../src/investment-review/fixtures.ts';

const ts = createRequire(import.meta.url)('typescript');
const FRAGMENT = Symbol('fragment');

function loadDirectory() {
  const cache = new Map();
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const m = { exports: {} };
    cache.set(rel, m);
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    const jsx = rel.endsWith('.tsx');
    const js = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
      },
    }).outputText;
    vm.runInNewContext(js, {
      module: m,
      exports: m.exports,
      require: id => resolve(id, posix.dirname(rel)),
      structuredClone,
      console,
    });
    return m.exports;
  }
  function resolve(id, fromDir) {
    if (id === 'react') return reactStub;
    if (id === 'react/jsx-runtime') return jsxStub;
    if (id.startsWith('.')) {
      let rel = posix.normalize(posix.join(fromDir, id));
      if (!/\.(ts|tsx)$/.test(rel)) rel += '.ts';
      return load(rel);
    }
    throw new Error(`unexpected import ${id}`);
  }
  return { load };
}

const reactStub = {}; // hooks 注入点，由每个 Harness 实例覆盖
const jsxStub = {
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key }),
  Fragment: FRAGMENT,
};

/** 单组件挂载：状态槽跨渲染保留，effects 在每次渲染后执行。 */
class Harness {
  constructor(exportName, props) {
    this.component = loadDirectory().load(`src/investment-review/${exportName}.tsx`)[exportName];
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
    const enter = (instance, component) => {
      if (instances.has(instance) && instances.get(instance) !== component) discard(instance);
      instances.set(instance, component);
      path = instance;
      cursor = 0;
    };
    reactStub.useId = () => `${path}:${cursor++}`;
    reactStub.useState = initial => {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [
        slots.get(key),
        next => {
          slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next);
          dirty = true;
        },
      ];
    };
    reactStub.useRef = initial => {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, { current: initial });
      return slots.get(key);
    };
    reactStub.useEffect = (fn, deps) => {
      const key = `${path}:${cursor++}`, prev = slots.get(key);
      if (!prev || !deps || deps.some((v, i) => !Object.is(v, prev[i]))) {
        slots.set(key, deps);
        effects.push(() => {
          cleanups.get(key)?.();
          cleanups.set(key, fn());
        });
      }
    };
    reactStub.useMemo = fn => fn();
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
  set(props) {
    this.props = props;
    this.rerender();
  }
  text() {
    const parts = [];
    const walk = node => {
      if (node === null || node === undefined) return;
      if (typeof node === 'string' || typeof node === 'number') {
        parts.push(String(node));
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === 'object' && node.props) walk(node.props.children);
    };
    walk(this.tree);
    return parts.join(' ');
  }
  find(pred) {
    const out = [];
    const walk = node => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node.type === 'string' && pred(node)) out.push(node);
      if (node.props) walk(node.props.children);
    };
    walk(this.tree);
    return out;
  }
  buttonByText(part) {
    return this.find(n => n.type === 'button' && collectText(n).includes(part));
  }
}
function collectText(node) {
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

const readyOuter = key => ({ status: 'ready', input: structuredClone(reviewFixtures[key].input), result: structuredClone(reviewFixtures[key].result) });

// ---------------------------------------------------------------- 卡片

test('card ready: shows domain profit, not a rate; facts come from input', () => {
  const h = new Harness('InvestmentReviewCard', { outer: readyOuter('ready-profit') });
  const text = h.text();
  assert.ok(text.includes('区间投资损益'));
  assert.ok(text.includes('+¥2,000'));
  assert.ok(text.includes('不是收益率'));
  assert.ok(text.includes('含估值变化、已反映的利息分红与费用'));
  // 逐账户事实来自输入：期初/期末与未知。
  assert.ok(text.includes('¥60,000'));
  assert.ok(text.includes('¥67,200'));
  assert.ok(text.includes('acc-bond-03'));
  assert.ok(text.includes('不计入'));
  assert.ok(text.includes('未知'));
  // ready 状态不出现核对按钮。
  assert.equal(h.buttonByText('核对资金流动').length, 0);
  // 依据明细展示端口 value，不出现收益率／年化。
  assert.ok(text.includes('期末 − 期初 − 转入 + 转出'));
});

test('card ready with negative profit keeps the minus sign and no fake split', () => {
  const h = new Harness('InvestmentReviewCard', { outer: readyOuter('ready-negative') });
  const text = h.text();
  assert.ok(text.includes('−¥100'));
  assert.ok(!text.includes('浮盈'));
  assert.ok(!text.includes('已实现收益'));
});

test('card not_recorded: honest degradation with change and CTA', () => {
  let opened = 0;
  const h = new Harness('InvestmentReviewCard', { outer: readyOuter('not-recorded'), onCheckFlow: () => opened++ });
  const text = h.text();
  assert.ok(text.includes('未填写这一期间的投入与转出，暂不能区分投资损益'));
  assert.ok(text.includes('+¥12,000'));
  assert.ok(text.includes('含资金流动和估值，不等于投资损益'));
  const btn = h.buttonByText('核对资金流动');
  assert.equal(btn.length, 1);
  btn[0].props.onClick();
  assert.equal(opened, 1);
});

test('card needs_review: reasons as stable-code labels and re-check CTA', () => {
  let opened = 0;
  const h = new Harness('InvestmentReviewCard', {
    outer: readyOuter('incomplete-flow'),
    onEditFlow: () => opened++,
  });
  const text = h.text();
  assert.ok(text.includes('待复核'));
  assert.ok(text.includes('流动金额或完整性待核对'));
  assert.ok(text.includes('+¥12,000'));
  h.buttonByText('重新核对资金流动')[0].props.onClick();
  assert.equal(opened, 1);
  // 没有损益金额被编造出来。
  assert.ok(!text.includes('区间投资损益 +'));
});

test('card needs_review with stale endpoints shows the correction reason', () => {
  const h = new Harness('InvestmentReviewCard', { outer: readyOuter('stale-endpoints') });
  assert.ok(h.text().includes('起止盘点被更正，原有确认失效，需要重新核对'));
});

test('card not_comparable: no CTA, no zero profit', () => {
  const h = new Harness('InvestmentReviewCard', { outer: readyOuter('scope-changed'), onCheckFlow: () => {} });
  const text = h.text();
  assert.ok(text.includes('不可比较'));
  assert.ok(text.includes('两次盘点的投资范围（账户、类型或计入状态）不一致'));
  assert.ok(text.includes('不计算区间损益，也不默认零收益'));
  assert.equal(h.buttonByText('核对资金流动').length, 0);
  assert.ok(!text.includes('区间投资损益 +¥0'));
});

test('card invalid result: field issues surfaced verbatim', () => {
  // 输入本身必须合法（not-recorded 的输入），结果端口返回 invalid 才走这一分支。
  const h = new Harness('InvestmentReviewCard', {
    outer: { status: 'ready', input: structuredClone(reviewFixtures['not-recorded'].input), result: structuredClone(reviewFixtures['invalid-input'].result) },
  });
  const text = h.text();
  assert.ok(text.includes('输入无效'));
  assert.ok(text.includes('flow.inflow_cents'));
  assert.ok(text.includes('零必须显式填 0'));
});

test('card outer states: loading / error / empty / unparsable input / unparsable result', () => {
  const loading = new Harness('InvestmentReviewCard', { outer: { status: 'loading' } });
  assert.ok(loading.text().includes('读取中'));
  const error = new Harness('InvestmentReviewCard', {
    outer: { status: 'error', code: 'plan_income_unavailable', message: '来源读取失败（虚构）' },
  });
  const errorText = error.text();
  assert.ok(errorText.includes('读取失败'));
  assert.ok(errorText.includes('plan_income_unavailable'));
  assert.ok(errorText.includes('读取失败与未记录、不可比较是不同状态'));
  const empty = new Harness('InvestmentReviewCard', { outer: { status: 'empty' } });
  assert.ok(empty.text().includes('还没有可比较的投资盘点'));
  const badVersion = new Harness('InvestmentReviewCard', {
    outer: { status: 'ready', input: { ...structuredClone(reviewFixtures['ready-profit'].input), contract_version: 2 }, result: readyOuter('ready-profit').result },
  });
  assert.ok(badVersion.text().includes('输入无法识别'));
  const badResult = new Harness('InvestmentReviewCard', {
    outer: { status: 'ready', input: structuredClone(reviewFixtures['ready-profit'].input), result: { status: 'ready', value: { opening_cents: 100 } } },
  });
  assert.ok(badResult.text().includes('结果无法识别'));
});

test('card disables CTA through the disabled port', () => {
  const h = new Harness('InvestmentReviewCard', { outer: readyOuter('not-recorded'), onCheckFlow: () => {}, disabled: true });
  assert.equal(h.buttonByText('核对资金流动')[0].props.disabled, true);
});

// ---------------------------------------------------------------- 核对窗

function mountDialog(overrides = {}) {
  const state = {
    draft: overrides.draft ?? emptyFlowDraft(),
    issues: overrides.issues ?? [],
    busy: overrides.busy ?? false,
    submitted: [],
    cancelled: 0,
    drafts: [],
  };
  const input = overrides.input ?? structuredClone(reviewFixtures['ready-profit'].input);
  const h = new Harness('InvestmentFlowDialog', {
    input,
    initial: state.draft,
    issues: state.issues,
    busy: state.busy,
    onDraftChange: d => {
      state.draft = d;
      state.drafts.push(structuredClone(d));
    },
    onSubmit: d => state.submitted.push(structuredClone(d)),
    onCancel: () => state.cancelled++,
  });
  const sync = () => h.set({ ...h.props, initial: state.draft, issues: state.issues, busy: state.busy });
  return { h, state, sync };
}

function amountInput(h, labelPart) {
  return h.find(n => n.type === 'input' && (n.props['aria-label'] ?? '').includes(labelPart))[0];
}
function checkboxInLabel(h, labelPart) {
  const label = h.find(n => n.type === 'label' && collectText(n).includes(labelPart))[0];
  return label.props.children.find(c => c && c.type === 'input');
}
function submitForm(h) {
  const form = h.find(n => n.type === 'form')[0];
  form.props.onSubmit({ preventDefault() {} });
  h.rerender(); // 本地拦截会更新提示状态，需要重渲染后再断言
}

test('dialog renders locked interval, scope accounts and both amount fields', () => {
  const { h } = mountDialog();
  const text = h.text();
  assert.ok(text.includes('（2026-06-30, 2026-09-30]'));
  assert.ok(text.includes('含期末、不含期初'));
  assert.ok(text.includes('acc-inv-01'));
  assert.ok(text.includes('¥60,000'));
  assert.ok(text.includes('¥67,200'));
  assert.ok(text.includes('期间从范围外转入的资金合计'));
  assert.ok(text.includes('期间转到范围外的资金合计'));
  assert.ok(text.includes('转到范围外的分红已包含在内，不再另加'));
  assert.ok(text.includes('本人投资账户之间互转在组合内抵消'));
  assert.ok(text.includes('已核对这一期间全部转入转出'));
});

test('dialog amount typing: yuan text in, canonical cents out; invalid text keeps the draft', () => {
  const { h, state, sync } = mountDialog();
  const inflow = amountInput(h, '转入');
  inflow.props.onChange({ target: { value: '10000' } });
  sync();
  assert.equal(state.draft.inflow, '1000000');
  const outflow = amountInput(h, '转到');
  outflow.props.onChange({ target: { value: '0.05' } });
  sync();
  assert.equal(state.draft.outflow, '5');
  const again = amountInput(h, '转入');
  again.props.onChange({ target: { value: '10000.999' } });
  sync();
  assert.equal(state.draft.inflow, '1000000'); // 非法输入不更新
  const zero = amountInput(h, '转入');
  zero.props.onChange({ target: { value: '0' } });
  sync();
  assert.equal(state.draft.inflow, '0'); // 显式零
  assert.ok(state.drafts.length >= 3);
});

test('dialog submit guard: confirmed with unknown amount is blocked locally and by the port', () => {
  const { h, state, sync } = mountDialog();
  const inflow = amountInput(h, '转入');
  inflow.props.onChange({ target: { value: '0' } });
  sync();
  const confirmed = checkboxInLabel(h, '已核对');
  confirmed.props.onChange({ target: { checked: true } });
  sync();
  submitForm(h);
  assert.equal(state.submitted.length, 0); // 转出仍未知：本地拦截
  assert.ok(h.text().includes('确认完整前需要两个金额'));
  // 补上转出后提交成功，意图端口收到完整草稿。
  const outflow = amountInput(h, '转到');
  outflow.props.onChange({ target: { value: '0' } });
  sync();
  submitForm(h);
  assert.equal(state.submitted.length, 1);
  assert.deepEqual(state.submitted[0], { inflow: '0', outflow: '0', confirmed: true, unsupported: false, notes: '' });
});

test('dialog can save an incomplete draft without confirming completeness', () => {
  const { h, state, sync } = mountDialog();
  const inflow = amountInput(h, '转入');
  inflow.props.onChange({ target: { value: '1200' } });
  sync();
  submitForm(h); // 转出未知、未确认完整：允许保存为待复核记录
  assert.deepEqual(state.submitted[0], { inflow: '120000', outflow: '', confirmed: false, unsupported: false, notes: '' });
});

test('dialog unsupported movements: checkbox works and blocks the completeness claim', () => {
  const { h, state, sync } = mountDialog();
  const unsupported = checkboxInLabel(h, '证券实物');
  unsupported.props.onChange({ target: { checked: true } });
  sync();
  assert.equal(state.draft.unsupported, true);
  const confirmed = checkboxInLabel(h, '已核对');
  assert.equal(confirmed.props.disabled, true); // 有未支持情形时不能确认完整
  // 即便草稿被外部置为 confirmed=true（绕过 UI），提交仍被表单级检查拒绝。
  state.draft = { ...state.draft, inflow: '0', outflow: '0', confirmed: true };
  sync();
  submitForm(h);
  assert.equal(state.submitted.length, 0);
  assert.ok(h.text().includes('不能确认简单损益完整'));
});

test('dialog port issues render and busy freezes every control', () => {
  const { h, state, sync } = mountDialog({
    issues: [{ path: 'flow.inflow_cents', code: 'confirmed_without_amount', message: '已确认完整时金额必须明确：未知请先留空并取消确认，零必须显式填 0' }],
  });
  assert.ok(h.text().includes('flow.inflow_cents'));
  assert.ok(h.text().includes('零必须显式填 0'));
  state.busy = true;
  sync();
  assert.equal(amountInput(h, '转入').props.disabled, true);
  assert.equal(checkboxInLabel(h, '已核对').props.disabled, true);
  assert.equal(h.buttonByText('取消')[0].props.disabled, true);
  assert.ok(h.buttonByText('保存中…').length === 1);
  // busy 时 Esc（onCancel 事件）不关闭。
  h.find(n => n.type === 'dialog')[0].props.onCancel({ preventDefault() {} });
  assert.equal(state.cancelled, 0);
  state.busy = false;
  sync();
  h.find(n => n.type === 'dialog')[0].props.onCancel({ preventDefault() {} });
  assert.equal(state.cancelled, 1);
});

test('dialog cancel button discards the draft via onCancel only', () => {
  const { h, state, sync } = mountDialog();
  amountInput(h, '转入').props.onChange({ target: { value: '500' } });
  sync();
  h.buttonByText('×')[0].props.onClick();
  assert.equal(state.cancelled, 1);
  // 取消只调用 onCancel；没有伪保存。
  assert.equal(state.submitted.length, 0);
});

test('dialog opens with the recorded draft when re-checking an existing flow', () => {
  const flow = confirmedFlowFixture();
  const { h, state } = mountDialog({ draft: draftFromFlow(flow) });
  const text = h.text();
  assert.ok(text.includes('已核对这一期间全部转入转出'));
  const confirmed = checkboxInLabel(h, '已核对');
  assert.equal(confirmed.props.checked, true);
  // 备注带值回填（textarea 的值在 value 属性，不在文本里）。
  const notes = h.find(n => n.type === 'textarea')[0];
  assert.equal(notes.props.value, '转入含一笔季度结余');
  assert.equal(state.draft.inflow, '1000000');
  // 金额输入框以元显示当前草稿。
  assert.equal(amountInput(h, '转入').props.value, '10000');
});


test('confirmed record remains editable', () => {
  let called = 0;
  const h = new Harness('InvestmentReviewCard', {outer:readyOuter('ready-profit'),onEditFlow:()=>called++});
  h.buttonByText('修改资金流动核对')[0].props.onClick(); assert.equal(called,1);
});

test('closing-only accounts remain visible when scopes differ', () => {
  const outer = readyOuter('scope-changed');
  outer.input.to.members.push({account_id:'closing-only',kind:'fund',counted:true,amount_cents:'12345'});
  const h = new Harness('InvestmentReviewCard',{outer});
  assert.match(h.text(), /closing-only/); assert.match(h.text(), /¥123.45/);
});

test('missing interval cannot dispatch a save', () => {
  const {h,state} = mountDialog(); h.set({...h.props,input:null});
  assert.equal(h.buttonByText('保存核对结果')[0].props.disabled,true);
  submitForm(h); assert.equal(state.submitted.length,0);
});

test('unsupported movement clears confirmation, permits notes, and never resurrects confirmation', () => {
  const {h,state,sync}=mountDialog({draft:{inflow:'0',outflow:'0',confirmed:true,unsupported:false,notes:''}});
  checkboxInLabel(h,'证券实物').props.onChange({target:{checked:true}});sync();
  assert.equal(state.draft.confirmed,false);submitForm(h);assert.equal(state.submitted.length,1);
  checkboxInLabel(h,'证券实物').props.onChange({target:{checked:false}});sync();
  assert.equal(state.draft.confirmed,false);
});

test('unavailable movement result renders a disabled reason without balance change or fake profit', () => {
  const outer = { ...readyOuter('ready-profit'), result: { status: 'unavailable', reasons: ['movements_disabled'] } };
  const h = new Harness('InvestmentReviewCard', { outer });
  assert.match(h.text(), /资金流动记录已关闭/);
  assert.doesNotMatch(h.text(), /结果无法识别|本期余额变化|¥0|已核对/);
});
