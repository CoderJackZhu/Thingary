// planning-followup-ui 组件交互测试：typescript 转译 + vm 桩化 React hooks 执行生产 TSX 处理器，
// 端口用 tests/helpers/planning-followup-ui-fixtures.ts 的虚构脚本驱动（与 investment-review 测试同一思路）。
// 不验证真实 DOM／原生保存；焦点、输入法与系统面板另行验收。UI 不重算损益：所有合计与结果均来自端口夹具。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { scriptedFollowupPort, uiAccounts, uiAssumptionReads, uiGeneration, uiManualDraft, uiMovements, uiPair, uiPreviewOf } from './helpers/planning-followup-ui-fixtures.ts';
import { reviewDraftFixtures } from './helpers/planning-followup-fixtures.ts';

const ts = createRequire(import.meta.url)('typescript');
const FRAGMENT = Symbol('fragment');
const reactStub = {};

function loadDirectory() {
  const cache = new Map();
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports;
    const m = { exports: {} };
    cache.set(rel, m);
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    const jsx = rel.endsWith('.tsx');
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) } }).outputText;
    vm.runInNewContext(js, { module: m, exports: m.exports, require: id => resolve(id, posix.dirname(rel)), structuredClone, crypto: globalThis.crypto, console });
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
const jsxStub = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: FRAGMENT };

/** 单组件挂载：状态槽跨渲染保留，effects 每轮渲染后执行；settle 等待端口 Promise。 */
class Harness {
  constructor(rel, exportName, props) {
    this.component = loadDirectory().load(rel)[exportName];
    this.slots = new Map();
    this.cleanups = new Map();
    this.instances = new Map();
    this.props = props;
    this.tree = null;
    let path = 'root', cursor = 0;
    const slots = this.slots, cleanups = this.cleanups, instances = this.instances;
    let effects = [], dirty = false;
    const discard = instance => {
      for (const key of slots.keys()) if (key.slice(0, key.lastIndexOf(':')) === instance) { cleanups.get(key)?.(); cleanups.delete(key); slots.delete(key); }
      instances.delete(instance);
    };
    const enter = (instance, component) => { if (instances.has(instance) && instances.get(instance) !== component) discard(instance); instances.set(instance, component); path = instance; cursor = 0; };
    reactStub.useId = () => `${path}:${cursor++}`;
    reactStub.useState = initial => {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => { slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next); dirty = true; }];
    };
    reactStub.useRef = initial => { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); };
    reactStub.useEffect = (fn, deps) => {
      const key = `${path}:${cursor++}`, prev = slots.get(key);
      if (!prev || deps === undefined || deps.some((v, i) => !Object.is(v, prev[i]))) { slots.set(key, deps); effects.push(() => { cleanups.get(key)?.(); cleanups.set(key, fn()); }); }
    };
    reactStub.useMemo = fn => fn();
    this.rerender = () => {
      for (let round = 0; round < 8; round++) {
        dirty = false; effects = [];
        const mounted = new Set();
        const expand = (node, key) => {
          if (node === null || node === undefined || typeof node !== 'object') return node;
          if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
          if (node.key !== undefined) key += ':key=' + node.key;
          if (typeof node.type === 'function' || typeof node.type === 'symbol') {
            if (typeof node.type === 'function') {
              if (instances.has(key) && instances.get(key) !== node.type) discard(key);
              instances.set(key, node.type); mounted.add(key);
              const prevPath = path, prevCursor = cursor;
              path = key; cursor = 0;
              const out = expand(node.type(node.props), `${key}:child`);
              path = prevPath; cursor = prevCursor;
              return out;
            }
            return expand(node.props.children, `${key}:children`);
          }
          return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
        };
        path = 'root'; cursor = 0;
        this.tree = expand(this.component(this.props), 'tree');
        for (const instance of [...instances.keys()]) if (!mounted.has(instance) && instance !== 'tree') discard(instance);
        for (const fn of effects) fn();
        if (!dirty) break;
      }
    };
    this.rerender();
  }
  set(props) { this.props = props; this.rerender(); }
  nodes() { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(this.tree); return out; }
  text(n = this.tree) { const walk = x => Array.isArray(x) ? x.map(walk).join('') : x && typeof x === 'object' ? walk(x.props?.children) : x == null || x === false ? '' : String(x); return walk(n).replace(/\s+/g, ' '); }
  find(type, predicate = () => true) { return this.nodes().find(n => n.type === type && predicate(n.props, n)); }
  button(part) {
    const node = this.nodes().find(n => n.type === 'button' && (n.props['aria-label'] === part || this.text(n) === part || this.text(n).includes(part)));
    if (!node) return undefined;
    const form = this.nodes().find(n => n.type === 'form' && contains(n, node));
    function contains(parent, target) { if (parent === target) return true; if (Array.isArray(parent)) return parent.some(n => contains(n, target)); return !!parent && typeof parent === 'object' && contains(parent.props?.children, target); }
    return { ...node, props: { ...node.props, onClick: () => { if (node.props.disabled) return; if (node.props.onClick) return node.props.onClick(); if (node.props.type === 'submit') return form?.props.onSubmit({ preventDefault() {} }); } } };
  }
  input(label) { return this.find('input', p => p['aria-label'] === label); }
  select(label) { return this.find('select', p => p['aria-label'] === label); }
  async settle() { for (let i = 0; i < 4; i++) { await new Promise(r => setImmediate(r)); this.rerender(); } }
}
const mount = (rel, name, props) => new Harness(`src/planning-followup-ui/${rel}`, name, props);
const type = (h, label, value) => { h.input(label).props.onChange({ target: { value } }); h.rerender(); };
const choose = (h, label, value) => { h.select(label).props.onChange({ target: { value } }); h.rerender(); };
const click = h => { h.props.onClick?.(); h.rerender(); };
const saveCalls = (port, method) => port.filter(c => c.method === method);

// ---------------------------------------------------------------- AssumptionsEditor

const assumptionsProps = over => ({ generation: uiGeneration, onClose() {}, onPending() {}, ...over });

test('assumptions editor shows the four values, defaults note and confirmation state', async () => {
  const { port } = scriptedFollowupPort();
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port }));
  await h.settle();
  assert.equal(h.input('退休前实际年收益（%）').props.value, '0');
  assert.equal(h.input('通胀（%）').props.value, '2');
  assert.equal(h.input('市场模拟年波动率（%）').props.value, '5');
  assert.match(h.text(), /未核对/);
  assert.match(h.text(), /确认并保存/);
  assert.match(h.text(), /程序试算值/);
});

test('plain save and confirm-and-save are distinct intents with a fresh request id and read revision', async () => {
  for (const [button, confirm] of [['保存（不改核对状态）', false], ['确认并保存', true]]) {
    const { port, calls } = scriptedFollowupPort({ assumptionRead: { status: 'ready', value: uiAssumptionReads.confirmed } });
    const closed = [];
    const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port, onClose: saved => closed.push(saved) }));
    await h.settle();
    h.button(button).props.onClick(); h.rerender(); await h.settle();
    const call = saveCalls(calls, 'saveAssumptions')[0];
    assert.equal(call.args[1], confirm);
    assert.equal(call.args[0].volatility_hundredths, 500);
    assert.equal((call.args[2]).expected_revision, 2);
    assert.ok(typeof (call.args[2]).request_id === 'string' && (call.args[2]).request_id.length > 10);
    assert.deepEqual(closed, [true]);
  }
});

test('invalid rate text is a local issue and never silently zero; restore-defaults only edits the draft', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port }));
  await h.settle();
  type(h, '退休前实际年收益（%）', '2.abc');
  h.button('保存（不改核对状态）').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'saveAssumptions').length, 0);
  assert.match(h.text(), /请填百分数/);
  h.button('恢复默认假设').props.onClick(); h.rerender();
  assert.equal(h.input('退休前实际年收益（%）').props.value, '0');
  assert.equal(h.input('市场模拟年波动率（%）').props.value, '5');
  assert.equal(saveCalls(calls, 'saveAssumptions').length, 0);
  // 恢复默认后普通保存仍是普通保存，不会顺带确认（P01）。
  h.button('保存（不改核对状态）').props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'saveAssumptions')[0].args[1], false);
});

test('rejected keeps the draft and field issues; retry is possible', async () => {
  const { port, calls } = scriptedFollowupPort({ assumptionWrite: { status: 'rejected', issues: [{ path: 'inflation_hundredths', code: 'invalid_input', message: '虚构：通胀超出边界' }] } });
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port }));
  await h.settle();
  type(h, '通胀（%）', '30');
  h.button('确认并保存').props.onClick(); h.rerender(); await h.settle();
  assert.match(h.text(), /虚构：通胀超出边界/);
  assert.equal(h.input('通胀（%）').props.value, '30');
  h.button('确认并保存').props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'saveAssumptions').length, 2);
});

test('unresolved freezes replay, keeps the request and offers close for later verification', async () => {
  const pending = [];
  const { port, calls } = scriptedFollowupPort({ assumptionWrite: { status: 'unresolved', request_id: 'ui-original-request' } });
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port, onPending: () => pending.push('x') }));
  await h.settle();
  h.button('确认并保存').props.onClick(); h.rerender(); await h.settle();
  h.button('确认并保存')?.props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'saveAssumptions').length, 1);
  assert.equal(pending.length, 1);
  assert.match(h.text(), /提交结果未知/);
  assert.ok(h.button('关闭，稍后核对'));
  h.button('关闭，稍后核对').props.onClick(); h.rerender();
});

test('saved with failed refresh only reports and blocks resubmission; close still marks saved', async () => {
  let reads = 0;
  const { port, calls } = scriptedFollowupPort({
    assumptionRead: { status: 'ready', value: uiAssumptionReads.unconfirmed },
  });
  // 第二次读取（保存后的重读）失败：动态脚本。
  const original = port.readAssumptions;
  port.readAssumptions = async generation => { reads++; if (reads === 1) return original(generation); return { status: 'error', code: 'READ_ERROR', message: '虚构：刷新失败' }; };
  const closed = [];
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port, onClose: saved => closed.push(saved) }));
  await h.settle();
  h.button('保存（不改核对状态）').props.onClick(); h.rerender(); await h.settle();
  assert.match(h.text(), /已保存，刷新失败/);
  h.button('保存（不改核对状态）')?.props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'saveAssumptions').length, 1);
  h.button('关闭（已保存）').props.onClick(); h.rerender();
  assert.deepEqual(closed, [true]);
});

test('disabled module read shows a message without editable fields', async () => {
  const { port } = scriptedFollowupPort({ assumptionRead: { status: 'disabled', message: '虚构：规划模块已关闭' } });
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port }));
  await h.settle();
  assert.match(h.text(), /规划模块已关闭/);
  assert.equal(h.input('退休前实际年收益（%）'), undefined);
});

test('needs_review shows confirmed values beside current ones', async () => {
  const { port } = scriptedFollowupPort({ assumptionRead: { status: 'ready', value: uiAssumptionReads.needsReview } });
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port }));
  await h.settle();
  assert.match(h.text(), /待核对/);
  assert.match(h.text(), /已核对过的值/);
  assert.equal(h.input('退休前实际年收益（%）').props.value, '1.5');
});

// ---------------------------------------------------------------- MovementsList / MovementForm

const listProps = over => ({ generation: uiGeneration, writeVersion: 1, today: '2026-10-31', onPending() {}, onEditingChange() {}, ...over });

test('movements list renders port rows with purpose and source status; filters reach the port query', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  assert.match(h.text(), /¥8,000/);
  assert.match(h.text(), /本人账户转账/);
  assert.match(h.text(), /生活支付/);
  assert.match(h.text(), /已关联来源/);
  assert.ok(h.button('记一笔资金流动'));
  choose(h, '筛选账户', 'ui-inv');
  const query = saveCalls(calls, 'listMovements').at(-1).args[0];
  assert.equal(query.account_id, 'ui-inv');
  assert.equal(query.deleted, 'active');
  choose(h, '显示范围', 'all');
  assert.equal(saveCalls(calls, 'listMovements').at(-1).args[0].deleted, 'all');
});

test('empty account list guides to create an account and offers no record entry', async () => {
  const { port } = scriptedFollowupPort({ accountsRead: { status: 'ready', value: { generation: uiGeneration, accounts: [] } } });
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  assert.match(h.text(), /还没有账户/);
  assert.equal(h.button('记一笔资金流动'), undefined);
});

test('movement read error and disabled module are separate states with retry', async () => {
  const { port } = scriptedFollowupPort({ movementsRead: { status: 'error', code: 'READ_ERROR', message: '虚构：明细读取失败' } });
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  assert.match(h.text(), /明细读取失败/);
  assert.ok(h.button('重试'));
  const off = scriptedFollowupPort({ movementsRead: { status: 'disabled', message: '虚构：模块已关闭' } });
  const h2 = mount('MovementsList.tsx', 'MovementsList', listProps({ port: off.port }));
  await h2.settle();
  assert.match(h2.text(), /模块已关闭/);
});

test('cursor pagination appends rows and stale cursors restart from the first page', async () => {
  let page = 0;
  const { port, calls } = scriptedFollowupPort({
    movementsRead: { status: 'ready', value: { generation: uiGeneration, records: uiMovements.slice(0, 2), next_cursor: 'page-2' } },
  });
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  assert.ok(h.button('加载更多'));
  h.button('加载更多').props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'listMovements').at(-1).args[0].cursor, 'page-2');
  assert.match(h.text(), /区间核对会包含所有相关明细/);
  void page;
});

function openForm(h) { h.button('记一笔资金流动').props.onClick(); h.rerender(); return h.find('dialog'); }

test('new movement submits fields with null revision; edit passes the record revision', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  openForm(h);
  type(h, '发生日期', '2026-10-18');
  h.input('金额（元）').props.onChange({ target: { value: '1200.50' } }); h.rerender();
  choose(h, '转出端账户', 'ui-inv');
  // 转入端先切到范围外再切回账户会保留选择；这里直接选择现金账户。
  const toSelect = h.select('转入端账户');
  assert.ok(toSelect);
  choose(h, '转入端账户', 'ui-cash');
  choose(h, '用途', 'income_distribution');
  h.button('保存资金流动').props.onClick(); h.rerender(); await h.settle();
  const call = saveCalls(calls, 'saveMovement')[0];
  assert.equal(call.args[0], null);
  assert.deepEqual(call.args[1], { date: '2026-10-18', amount_cents: '120050', from: { kind: 'account', account_id: 'ui-inv' }, to: { kind: 'account', account_id: 'ui-cash' }, purpose: 'income_distribution', source: null, notes: '' });
  assert.equal((call.args[2]).expected_revision, null);
  // 修改既有记录携带 revision。
  h.button('修改').props.onClick(); h.rerender(); await h.settle();
  h.button('保存修改').props.onClick(); h.rerender(); await h.settle();
  const edit = saveCalls(calls, 'saveMovement')[1];
  assert.equal(edit.args[0], 'ui-transfer');
  assert.equal((edit.args[2]).expected_revision, 3);
});

test('same-account endpoints and missing amount stay local issues without a port save', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  openForm(h);
  type(h, '发生日期', '2026-10-18');
  choose(h, '转出端账户', 'ui-inv');
  choose(h, '转入端账户', 'ui-inv');
  h.button('保存资金流动').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'saveMovement').length, 0);
  assert.match(h.text(), /两端不能是同一个账户/);
  h.input('金额（元）').props.onChange({ target: { value: '100' } }); h.rerender();
  h.button('保存资金流动').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'saveMovement').length, 0);
  assert.match(h.text(), /两端不能是同一个账户/);
  assert.doesNotMatch(h.text(), /金额无法确定/);
});

test('unlinked account ends are rejected locally: no external-to-external record', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  openForm(h);
  type(h, '发生日期', '2026-10-18');
  h.input('金额（元）').props.onChange({ target: { value: '100' } }); h.rerender();
  // 两端默认都是外部说明时不能保存。
  const externals = h.nodes().filter(n => n.type === 'button' && h.text(n) === '范围外对象');
  externals[0].props.onClick(); h.rerender();
  h.nodes().filter(n => n.type === 'button' && h.text(n) === '范围外对象')[1].props.onClick(); h.rerender();
  h.button('保存资金流动').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'saveMovement').length, 0);
  assert.match(h.text(), /至少一端必须是本应用的账户/);
});

test('delete uses a two-step confirm with the record revision; restore toggles back', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  h.button('删除').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'setMovementDeleted').length, 0);
  h.button('确认删除').props.onClick(); h.rerender(); await h.settle();
  const call = saveCalls(calls, 'setMovementDeleted')[0];
  assert.equal(call.args[0], 'ui-transfer');
  assert.equal(call.args[1], true);
  assert.equal((call.args[2]).expected_revision, 3);
});

test('unresolved movement write freezes and keeps the original request for verification', async () => {
  const pending = [];
  const { port, calls } = scriptedFollowupPort({ movementWrite: { status: 'unresolved', request_id: 'ui-original-request' } });
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port, onPending: () => pending.push('x') }));
  await h.settle();
  openForm(h);
  type(h, '发生日期', '2026-10-18');
  h.input('金额（元）').props.onChange({ target: { value: '100' } }); h.rerender();
  choose(h, '转出端账户', 'ui-inv');
  choose(h, '转入端账户', 'ui-cash');
  h.button('保存资金流动').props.onClick(); h.rerender(); await h.settle();
  h.button('保存资金流动')?.props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'saveMovement').length, 1);
  assert.equal(pending.length, 1);
  assert.match(h.text(), /提交结果未知/);
  assert.ok(h.button('关闭，稍后核对'));
});

test('source picker lists domain candidates, disables unavailable ones and links by opaque key', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  openForm(h);
  const block = h.find('details', p => h.text(p.children?.[0] ?? p.children).includes('关联来源记录'));
  assert.ok(block);
  // 展开来源块：点击“收入记录”触发候选读取。
  h.button('收入记录').props.onClick(); h.rerender(); await h.settle();
  const unavailable = h.button('虚构利息入账');
  assert.equal(unavailable.props.disabled, true);
  h.button('虚构现金分红入账').props.onClick(); h.rerender();
  type(h, '发生日期', '2026-10-25');
  h.input('金额（元）').props.onChange({ target: { value: '300' } }); h.rerender();
  choose(h, '转出端账户', 'ui-inv');
  choose(h, '转入端账户', 'ui-cash');
  choose(h, '用途', 'income_distribution');
  h.button('保存资金流动').props.onClick(); h.rerender(); await h.settle();
  const call = saveCalls(calls, 'saveMovement')[0];
  assert.deepEqual((call.args[1]).source, { kind: 'income', key: 'ui-income-key-1' });
  assert.equal(h.button('保存资金流动'), undefined); // 成功后关闭表单并刷新列表
});

// ---------------------------------------------------------------- ReviewModeDialog

const reviewProps = over => ({ generation: uiGeneration, pair: uiPair, onClose() {}, onPending() {}, ...over });

test('manual draft edits save through a fresh preview whose basis key is passed through untouched', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  h.input('期间从范围外转入的资金合计（元）').props.onChange({ target: { value: '12000' } }); h.rerender();
  const confirmBox = h.find('input', p => p.type === 'checkbox' && /已核对/.test(h.text(h.nodes().find(n => n.props?.children === p) ?? h.tree) || ''));
  // 勾选完整性确认（第二个复选框）。
  const boxes = h.nodes().filter(n => n.type === 'input' && n.props.type === 'checkbox');
  boxes[1].props.onChange({ target: { checked: true } }); h.rerender(); await h.settle();
  h.button('保存核对方式').props.onClick(); h.rerender(); await h.settle();
  const preview = saveCalls(calls, 'previewReview').find(c => c.args[1].confirmed_complete === true);
  const save = saveCalls(calls, 'saveReview')[0];
  assert.deepEqual(preview.args[1], { selection: { mode: 'manual', inflow_cents: '1200000', outflow_cents: '800000' }, confirmed_complete: true, unsupported_movements: false, notes: '虚构：手填合计' });
  assert.equal(save.args[2], 'ui-fixture-basis-key'); // 界面原样提交端口键，不自行拼接
  assert.equal((save.args[3]).expected_revision, 4);
  void confirmBox;
});

test('confirming completeness with an unknown total is blocked before any port call', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  h.input('期间从范围外转入的资金合计（元）').props.onChange({ target: { value: '' } }); h.rerender();
  const boxes = h.nodes().filter(n => n.type === 'input' && n.props.type === 'checkbox');
  boxes[1].props.onChange({ target: { checked: true } }); h.rerender(); await h.settle();
  h.button('保存核对方式').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'saveReview').length, 0);
  assert.match(h.text(), /零必须显式填 0/);
});

test('movements mode shows read-only totals and allows an explicit 0/0 complete confirmation', async () => {
  const { port, calls } = scriptedFollowupPort({
    previewResult: draft => ({ status: 'ready', value: uiPreviewOf(draft, { selected_totals: { inflow_cents: '0', outflow_cents: '0' }, movement_count: 0 }) }),
    reviewRead: { status: 'ready', value: { draft: reviewDraftFixtures.movementsUnconfirmed, preview: uiPreviewOf(reviewDraftFixtures.movementsUnconfirmed, { selected_totals: { inflow_cents: '0', outflow_cents: '0' }, movement_count: 0 }) } },
  });
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  assert.equal(h.input('期间从范围外转入的资金合计（元）'), undefined);
  assert.match(h.text(), /只读/);
  assert.match(h.text(), /0 条/);
  const boxes = h.nodes().filter(n => n.type === 'input' && n.props.type === 'checkbox');
  boxes[1].props.onChange({ target: { checked: true } }); h.rerender(); await h.settle();
  h.button('保存核对方式').props.onClick(); h.rerender(); await h.settle();
  const save = saveCalls(calls, 'saveReview')[0];
  assert.equal((save.args[1]).confirmed_complete, true);
  assert.deepEqual((save.args[1]).selection, { mode: 'movements' });
});

test('switching mode previews the difference first; cancel writes nothing, confirm saves the new mode unconfirmed', async () => {
  const { port, calls } = scriptedFollowupPort({
    previewResult: draft => ({ status: 'ready', value: uiPreviewOf(draft, { previous_totals: { inflow_cents: '1000000', outflow_cents: '800000' }, selected_totals: { inflow_cents: '1000000', outflow_cents: '850000' }, difference: { inflow_cents: '0', outflow_cents: '50000' }, movement_count: 2 }) }),
  });
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  h.button('由资金流动明细汇总').props.onClick(); h.rerender(); await h.settle();
  const switchPreview = saveCalls(calls, 'previewReview').at(-1);
  assert.equal((switchPreview.args[1]).selection.mode, 'movements');
  assert.match(h.text(), /切换核对方式前请核对差额/);
  assert.match(h.text(), /原合计/);
  assert.match(h.text(), /新合计/);
  assert.match(h.text(), /切换后结果/);
  assert.match(h.text(), /\+¥500/);
  h.button('取消（不切换）').props.onClick(); h.rerender();
  assert.equal(saveCalls(calls, 'saveReview').length, 0);
  h.button('由资金流动明细汇总').props.onClick(); h.rerender(); await h.settle();
  h.button('确认切换（保存前需重新核对）').props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'saveReview').length, 0);
  h.button('保存核对方式').props.onClick(); h.rerender(); await h.settle();
  const save = saveCalls(calls, 'saveReview')[0];
  assert.deepEqual((save.args[1]).selection, { mode: 'movements' });
  assert.equal((save.args[1]).confirmed_complete, false); // 切换后需重新确认完整性
});

test('stale movement reasons render with the followup codes and no ready profit', async () => {
  const draft = reviewDraftFixtures.movementsUnconfirmed;
  const { port } = scriptedFollowupPort({
    previewResult: d => ({ status: 'ready', value: uiPreviewOf(d, { confirmation: 'needs_review', reasons: [{ path: 'movements', code: 'stale_movements', message: '虚构：流动已更正' }], result: { status: 'needs_review', reasons: ['stale_endpoints'], change_cents: '-300000' } }) }),
    reviewRead: { status: 'ready', value: { draft, preview: uiPreviewOf(draft, { confirmation: 'needs_review', reasons: [{ path: 'movements', code: 'stale_movements', message: '虚构：流动已更正' }], result: { status: 'needs_review', reasons: ['stale_endpoints'], change_cents: '-300000' } }) } },
  });
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  assert.match(h.text(), /待核对/);
  assert.match(h.text(), /相关资金流动已被更正/);
  assert.doesNotMatch(h.text(), /区间投资损益 \+/);
});

test('foreign generation data never becomes editable state', async () => {
  const { port } = scriptedFollowupPort({ reviewRead: { status: 'ready', value: { draft: uiManualDraft, preview: { ...uiPreviewOf(uiManualDraft), generation: 'other-generation' } } } });
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  assert.equal(h.input('期间从范围外转入的资金合计（元）'), undefined);
  assert.match(h.text(), /资料库已变化/);
});

test('unresolved review save freezes and rejected shows structured issues', async () => {
  const pending = [];
  const unresolved = scriptedFollowupPort({ reviewWrite: { status: 'unresolved', request_id: 'ui-original-request' } });
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port: unresolved.port, onPending: () => pending.push('x') }));
  await h.settle();
  h.button('保存核对方式').props.onClick(); h.rerender(); await h.settle();
  h.button('保存核对方式')?.props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(unresolved.calls, 'saveReview').length, 1);
  assert.equal(pending.length, 1);
  const rejected = scriptedFollowupPort({ reviewWrite: { status: 'rejected', issues: [{ path: 'basis', code: 'stale_basis', message: '虚构：依据已变化，请重新预览' }] } });
  const h2 = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port: rejected.port }));
  await h2.settle();
  h2.button('保存核对方式').props.onClick(); h2.rerender(); await h2.settle();
  assert.match(h2.text(), /虚构：依据已变化/);
  assert.equal(h2.input('期间从范围外转入的资金合计（元）').props.value, '10000');
});

// ---------------------------------------------------------------- FollowupSection

const sectionProps = over => ({ generation: uiGeneration, writeVersion: 1, today: '2026-10-31', onPending() {}, onEditingChange() {}, ...over });

test('without a review pair the section still records movements but offers no mode dialog', async () => {
  const { port } = scriptedFollowupPort();
  const h = mount('FollowupSection.tsx', 'FollowupSection', sectionProps({ port, pair: null }));
  await h.settle();
  assert.ok(h.button('记一笔资金流动'));
  assert.equal(h.button('核对方式与完整性（手填／明细）'), undefined);
  assert.match(h.text(), /还没有两次完整盘点/);
});

test('with a pair the mode dialog opens and loads the saved draft', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('FollowupSection.tsx', 'FollowupSection', sectionProps({ port, pair: uiPair }));
  await h.settle();
  h.button('核对方式与完整性（手填／明细）').props.onClick(); h.rerender(); await h.settle();
  assert.equal(saveCalls(calls, 'readReview').length, 1);
  assert.equal(h.input('期间从范围外转入的资金合计（元）').props.value, '10000');
  assert.match(h.text(), /手填合计/);
});

test('host passes fictional account names through the domain endpoint ids only', async () => {
  const { port, calls } = scriptedFollowupPort();
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle();
  assert.match(h.text(), /虚构券商投资账户 → 虚构现金账户/);
  assert.match(h.text(), /外部：虚构房租/);
  assert.equal(saveCalls(calls, 'listAccounts').length, 1);
  assert.ok(uiAccounts.every(a => a.selectable !== undefined));
  assert.ok(uiMovements.length >= 4);
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('save binds displayed preview key and original revision, never a newer preview revision', async () => {
  const { port, calls } = scriptedFollowupPort({ previewResult: d => ({ status: 'ready', value: uiPreviewOf(d, { revision: 99, basis_key: 'displayed-key' }) }) });
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port }));
  await h.settle();
  const before = saveCalls(calls, 'previewReview').length;
  h.button('保存核对方式').props.onClick();
  const save = saveCalls(calls, 'saveReview')[0];
  assert.equal(save.args[2], 'displayed-key');
  assert.equal(save.args[3].expected_revision, 4);
  assert.equal(saveCalls(calls, 'previewReview').length, before);
  await h.settle();
});
test('older movement query cannot replace newer filter results', async () => {
  const { port } = scriptedFollowupPort();
  const old = deferred(), fresh = deferred(); let reads = 0;
  port.listMovements = () => ++reads === 1 ? old.promise : fresh.promise;
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port }));
  await h.settle(); type(h, '明细开始日期', '2026-10-15');
  fresh.resolve({ status: 'ready', value: { generation: uiGeneration, records: [], next_cursor: null } }); await h.settle();
  old.resolve({ status: 'ready', value: { generation: uiGeneration, records: uiMovements, next_cursor: null } }); await h.settle();
  assert.match(h.text(), /还没有资金流动记录/);
  assert.doesNotMatch(h.text(), /虚构：取回资金/);
});
test('pending preview disables saving and older draft response cannot re-enable it', async () => {
  const { port, calls } = scriptedFollowupPort();
  const requests = [];
  port.previewReview = () => { const d = deferred(); requests.push(d); return d.promise; };
  const h = mount('ReviewModePanel.tsx', 'ReviewModeDialog', reviewProps({ port })); await h.settle();
  type(h, '期间从范围外转入的资金合计（元）', '200'); await h.settle();
  requests[0].resolve({ status: 'ready', value: uiPreviewOf(uiManualDraft) }); await h.settle();
  assert.equal(h.button('保存核对方式').props.disabled, true);
  assert.equal(saveCalls(calls, 'saveReview').length, 0);
});
test('movement dialog contributes to section navigation lock and saved callback', async () => {
  const { port } = scriptedFollowupPort(); const edits = [], saves = [];
  const h = mount('FollowupSection.tsx', 'FollowupSection', { ...listProps({ port }), pair: uiPair, onEditingChange: v => edits.push(v), onSaved: () => saves.push(true) });
  await h.settle(); h.button('记一笔资金流动').props.onClick(); h.rerender(); await h.settle();
  assert.equal(edits.at(-1), true);
  assert.equal(h.button('核对方式与完整性').props.disabled, true);
  type(h, '发生日期', '2026-10-12'); type(h, '金额（元）', '10');
  choose(h, '转出端账户', 'ui-inv'); choose(h, '转入端账户', 'ui-cash');
  h.button('保存资金流动').props.onClick(); h.rerender(); await h.settle();
  assert.deepEqual(saves, [true]); assert.equal(edits.at(-1), false);
});
test('unresolved delete blocks further writes even after its notice is shown', async () => {
  const { port, calls } = scriptedFollowupPort({ movementWrite: { status: 'unresolved', request_id: 'pending' } });
  const h = mount('MovementsList.tsx', 'MovementsList', listProps({ port })); await h.settle();
  h.button('删除').props.onClick(); h.rerender(); h.button('确认删除').props.onClick(); h.rerender(); await h.settle();
  h.button('确认删除').props.onClick();
  assert.equal(saveCalls(calls, 'setMovementDeleted').length, 1);
  assert.equal(h.button('记一笔资金流动').props.disabled, true);
});

test('no profile keeps default assumptions read-only until a plan is saved', async () => {
  const { port, calls } = scriptedFollowupPort({ assumptionRead: { status: 'ready', value: { ...uiAssumptionReads.unconfirmed, revision: null } } });
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', assumptionsProps({ port })); await h.settle();
  assert.match(h.text(), /请先保存规划/);
  assert.equal(h.button('确认并保存').props.disabled, true);
  h.button('确认并保存').props.onClick();
  assert.equal(saveCalls(calls, 'saveAssumptions').length, 0);
});

test('switching library unmounts an in-flight editor and ignores its late save response', async () => {
  const { port } = scriptedFollowupPort(); const pending = deferred(), closed = [];
  port.readAssumptions = async generation => ({ status: 'ready', value: { ...uiAssumptionReads.confirmed, generation } });
  port.saveAssumptions = () => pending.promise;
  const props = assumptionsProps({ port, onClose: saved => closed.push(saved) });
  const h = mount('AssumptionsEditor.tsx', 'AssumptionsEditor', props); await h.settle();
  h.button('确认并保存').props.onClick(); h.rerender();
  h.set({ ...props, generation: 'new-library' }); await h.settle();
  pending.resolve({ status: 'saved', id: 'old-profile', revision: 5 }); await h.settle();
  assert.deepEqual(closed, []);
  assert.equal(h.button('确认并保存').props.disabled, false);
});
