import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { defaultHomeOrder, homeOrderKey, moveHomeBlock, normalizeHomeOrder, orderHomeBlocks, readHomeOrder, writeHomeOrder } from '../src/mobile/home/order.ts';
import { holdDelay, holdSlop, installOrderGesture } from '../src/mobile/home/order-gesture.ts';

const ts = createRequire(import.meta.url)('typescript');
const day = '2026-10-23';

function memoryStorage(initial = null) {
  return {
    value: initial, fail: false, writes: 0,
    getItem(key) { assert.equal(key, homeOrderKey); return this.value; },
    setItem(key, value) {
      assert.equal(key, homeOrderKey); this.writes++;
      if (this.fail) throw new Error('虚构存储写入失败');
      this.value = value;
    },
  };
}

test('首页顺序：坏值、重复、未知 ID 都归一化，模块缺失不丢已保存偏好', () => {
  assert.deepEqual(normalizeHomeOrder(null), [...defaultHomeOrder]);
  assert.deepEqual(normalizeHomeOrder('net'), [...defaultHomeOrder]);
  assert.deepEqual(normalizeHomeOrder(['recent', 'net', 'recent', 'missing', 3]), ['recent', 'net', 'plan', 'daily', 'pending']);
  assert.deepEqual(normalizeHomeOrder(['recent', 'plan', 'net']), ['recent', 'plan', 'net', 'daily', 'pending']);
  const blocks = [{ id: 'net' }, { id: 'daily' }, { id: 'recent' }];
  assert.deepEqual(orderHomeBlocks(blocks, normalizeHomeOrder(['recent', 'plan', 'net'])).map(block => block.id), ['recent', 'net', 'daily']);
});
test('首页顺序：读取失败、写入失败与无存储都不猜值，成功写入可按原顺序读回', () => {
  assert.deepEqual(readHomeOrder(null), [...defaultHomeOrder]);
  const broken = { getItem() { throw new Error('虚构读取失败'); }, setItem() {} };
  assert.deepEqual(readHomeOrder(broken), [...defaultHomeOrder]);
  const malformed = memoryStorage('{bad json');
  assert.deepEqual(readHomeOrder(malformed), [...defaultHomeOrder]);
  const store = memoryStorage();
  assert.equal(writeHomeOrder(store, ['pending', 'net']), true);
  assert.deepEqual(readHomeOrder(store), ['pending', 'net', 'plan', 'daily', 'recent']);
  store.fail = true;
  assert.equal(writeHomeOrder(store, ['recent', 'net']), false);
  assert.equal(writeHomeOrder(null, ['recent', 'net']), false);
});
test('首页顺序：移动保留全部区块，原地移动不变', () => {
  const start = [...defaultHomeOrder];
  assert.deepEqual(moveHomeBlock(start, 'net', 'daily'), ['plan', 'daily', 'net', 'pending', 'recent']);
  assert.deepEqual(moveHomeBlock(start, 'recent', 'plan'), ['net', 'recent', 'plan', 'daily', 'pending']);
  assert.deepEqual(moveHomeBlock(start, 'net', 'net'), start);
  assert.deepEqual(moveHomeBlock(start, 'net', 'missing'), start);
  assert.deepEqual(start, [...defaultHomeOrder]);
});

function fakeEmitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event) { for (const fn of [...(listeners.get(type) ?? [])]) fn(event); },
    count(type) { return listeners.get(type)?.size ?? 0; },
  };
}
function fakeElement(selectors = '') {
  const emitter = fakeEmitter();
  const element = Object.assign(Object.create(globalThis.Element?.prototype ?? Object.prototype), {
    ...emitter, isConnected: true, selector: selectors,
    closest(selector) { return this.selector === selector ? this : null; },
    contains(node) { return node === this || node === this.block; },
    addEventListener: emitter.addEventListener, removeEventListener: emitter.removeEventListener,
  });
  return element;
}
function touchEvent(target, touches, extra = {}) {
  const event = { target, touches, cancelable: true, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, stopImmediatePropagation() { this.propagationStopped = true; }, ...extra };
  return event;
}
function pointerEvent(target, overrides = {}) {
  return { target, pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 10, clientY: 20, cancelable: true, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, ...overrides };
}
function gestureHarness(overrides = {}) {
  const host = fakeElement(), block = fakeElement('[data-home-block]');
  host.block = block;
  const calls = { start: [], move: [], end: 0 };
  const options = {
    enabled: () => true, editing: () => false,
    start: (target, point) => calls.start.push([target, point]),
    move: point => calls.move.push(point),
    end: () => { calls.end++; },
    ...overrides,
  };
  const cleanup = installOrderGesture(host, options);
  return { host, block, calls, cleanup };
}
function withDom(run) {
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  const window = fakeEmitter(), document = { ...fakeEmitter(), hidden: false };
  class Element {}
  globalThis.window = window; globalThis.document = document; globalThis.Element = Element;
  const restore = () => { globalThis.window = previous.window; globalThis.document = previous.document; globalThis.Element = previous.Element; };
  try {
    const result = run({ window, document });
    return result && typeof result.then === 'function' ? result.finally(restore) : (restore(), result);
  } catch (error) { restore(); throw error; }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('长按排序手势：短按不算长按，普通点击仍然可用', () => withDom(() => {
  const { host, block, calls, cleanup } = gestureHarness();
  const start = touchEvent(block, [{ clientX: 12, clientY: 20, identifier: 1 }]);
  host.emit('touchstart', start);
  host.emit('touchend', touchEvent(block, []));
  const click = touchEvent(block, []);
  host.emit('click', click);
  assert.equal(calls.start.length, 0); assert.equal(calls.end, 0); assert.equal(click.defaultPrevented, false);
  cleanup();
}));
test('长按排序手势：长按后浮起，松手只结束拖动并拦住随后的点击', () => withDom(async () => {
  const { host, block, calls, cleanup } = gestureHarness();
  host.emit('touchstart', touchEvent(block, [{ clientX: 12, clientY: 20, identifier: 1 }]));
  await wait(holdDelay + 40);
  assert.equal(calls.start.length, 1); assert.equal(calls.start[0][0], block);
  const click = touchEvent(block, []);
  host.emit('touchend', touchEvent(block, []));
  host.emit('click', click);
  assert.equal(calls.end, 1); assert.equal(click.defaultPrevented, true); assert.equal(click.propagationStopped, true);
  cleanup();
}));
test('长按排序手势：按住前移动超过阈值、滚动、多指或失焦都取消', () => withDom(async () => {
  for (const cancel of [
    ({ host, block }) => { host.emit('touchmove', touchEvent(block, [{ clientX: 12 + holdSlop + 1, clientY: 20, identifier: 1 }])); },
    ({ window }) => window.emit('scroll', {}),
    ({ host, block }) => host.emit('touchstart', touchEvent(block, [{ clientX: 1, clientY: 1, identifier: 1 }, { clientX: 2, clientY: 2, identifier: 2 }])),
  ]) {
    const harness = gestureHarness();
    harness.host.emit('touchstart', touchEvent(harness.block, [{ clientX: 12, clientY: 20, identifier: 1 }]));
    cancel({ host: harness.host, block: harness.block, window: globalThis.window });
    await wait(holdDelay + 40);
    assert.equal(harness.calls.start.length, 0); harness.cleanup();
  }
}));
test('长按排序手势：排序中可直接拖动，移动阻止原生滚动，取消/卸载都结束', () => withDom(async () => {
  let editing = true;
  const { host, block, calls, cleanup } = gestureHarness({ editing: () => editing });
  host.emit('touchstart', touchEvent(block, [{ clientX: 12, clientY: 20, identifier: 1 }]));
  assert.equal(calls.start.length, 1);
  const move = touchEvent(block, [{ clientX: 12, clientY: 60, identifier: 1 }]);
  host.emit('touchmove', move);
  assert.deepEqual(calls.move.at(-1), { x: 12, y: 60 }); assert.equal(move.defaultPrevented, true);
  host.emit('touchcancel', touchEvent(block, []));
  assert.equal(calls.end, 1);
  editing = false;
  const second = gestureHarness({ enabled: () => false });
  second.host.emit('touchstart', touchEvent(second.block, [{ clientX: 1, clientY: 1, identifier: 1 }]));
  await wait(holdDelay + 40);
  assert.equal(second.calls.start.length, 0);
  second.cleanup();
  cleanup();
}));
test('长按排序手势：鼠标长按也生效，且松手后不误触链接', () => withDom(async () => {
  const { host, block, calls, cleanup } = gestureHarness();
  host.emit('pointerdown', pointerEvent(block));
  await wait(holdDelay + 40);
  assert.equal(calls.start.length, 1);
  host.emit('pointerup', pointerEvent(block));
  const click = touchEvent(block, []);
  host.emit('click', click);
  assert.equal(click.defaultPrevented, true);
  cleanup();
}));

function loadOverviewOrder(storage, options = {}) {
  const source = readFileSync(new URL('../src/mobile/home/OverviewOrder.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const state = new Map(), refs = new Map(), effects = new Map();
  let cursor = 0, pending = [], dirty = false, tree;
  const depsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const id = cursor++;
      if (!state.has(id)) state.set(id, typeof initial === 'function' ? initial() : initial);
      return [state.get(id), value => { state.set(id, typeof value === 'function' ? value(state.get(id)) : value); dirty = true; }];
    },
    useRef(initial) { const id = cursor++; if (!refs.has(id)) refs.set(id, { current: initial }); return refs.get(id); },
    useEffect(fn, deps) { pending.push({ id: cursor++, fn, deps, layout: false }); },
    useLayoutEffect(fn, deps) { pending.push({ id: cursor++, fn, deps, layout: true }); },
  };
  const modules = {
    react: hooks,
    'react/jsx-runtime': {
      Fragment: Symbol('Fragment'),
      jsx: (type, props, key) => ({ type, props, key }),
      jsxs: (type, props, key) => ({ type, props, key }),
    },
    '../nav-context': { useCovered: () => !!options.covered },
    '../me/shared': { browserStorage: () => storage },
    '../ui': { Notice: 'Notice' },
    './order-gesture': { installOrderGesture: () => () => {} },
    './order': { moveHomeBlock, orderHomeBlocks, readHomeOrder, writeHomeOrder },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: id => { if (!(id in modules)) throw new Error(id); return modules[id]; }, console, setTimeout, clearTimeout, navigator: {}, performance: { now: () => 0 }, window: {}, document: { hidden: false }, requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  const component = module.exports.OverviewOrder;
  const nodes = () => { const out = []; const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { out.push(node); visit(node.props?.children); } }; visit(tree); return out; };
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || node === false ? '' : String(node);
  const render = () => {
    for (let round = 0; round < 5; round++) {
      cursor = 0; pending = []; dirty = false;
      tree = component({ blocks: options.blocks, pinned: options.pinned, disabled: !!options.disabled, onSortingChange: options.onSortingChange });
      for (const item of [...pending.filter(item => item.layout), ...pending.filter(item => !item.layout)]) {
        const slot = effects.get(item.id);
        if (slot && depsEqual(slot.deps, item.deps)) continue;
        slot?.cleanup?.();
        effects.set(item.id, { deps: item.deps, cleanup: item.fn() });
      }
      if (!dirty) break;
    }
    return tree;
  };
  render();
  return {
    render, nodes, text,
    slots: () => nodes().filter(node => node.props?.['data-home-block']).map(node => node.props['data-home-block']),
    button: label => nodes().find(node => node.type === 'button' && text(node) === label),
    key: (id, key) => { const node = nodes().find(node => node.props?.['data-home-block'] === id); const token = {}; node.props.onKeyDown({ key, target: token, currentTarget: token, preventDefault() {} }); render(); },
    unpin: () => { const node = nodes().find(node => node.type === 'div' && node.props?.className === 'h-order-pinned'); return node ? text(node) : ''; },
    unmount: () => { for (const slot of effects.values()) slot.cleanup?.(); effects.clear(); },
  };
}
const blocks = [
  { id: 'net', title: '金融净资产', content: 'NET' },
  { id: 'plan', title: '规划', content: 'PLAN' },
  { id: 'daily', title: '物品日均成本', content: 'DAILY' },
  { id: 'pending', title: '待处理', content: 'PENDING' },
  { id: 'recent', title: '近期记录', content: 'RECENT' },
];

test('总览排序：长按/键盘进入后取消恢复原顺序，不写本机偏好', () => {
  const storage = memoryStorage(), changes = [];
  const r = loadOverviewOrder(storage, { blocks, onSortingChange: value => changes.push(value) });
  assert.deepEqual(r.slots(), ['net', 'plan', 'daily', 'pending', 'recent']);
  r.key('net', 'Enter');
  assert.equal(r.button('完成') !== undefined, true); assert.equal(r.button('取消') !== undefined, true);
  r.key('net', 'ArrowDown');
  assert.deepEqual(r.slots(), ['plan', 'net', 'daily', 'pending', 'recent']);
  r.button('取消').props.onClick(); r.render();
  assert.deepEqual(r.slots(), ['net', 'plan', 'daily', 'pending', 'recent']);
  assert.equal(r.button('完成'), undefined); assert.equal(storage.writes, 0); assert.deepEqual(changes, [true, false]);
  r.unmount();
});
test('总览排序：完成才写入本机偏好，重新打开按新顺序显示', () => {
  const storage = memoryStorage(), changes = [];
  const r = loadOverviewOrder(storage, { blocks, onSortingChange: value => changes.push(value) });
  r.key('net', 'Enter'); r.key('net', 'ArrowDown'); r.button('完成').props.onClick(); r.render();
  assert.deepEqual(JSON.parse(storage.value), ['plan', 'net', 'daily', 'pending', 'recent']);
  assert.equal(r.button('完成'), undefined); assert.deepEqual(changes, [true, false]);
  r.unmount();
  const reopened = loadOverviewOrder(storage, { blocks, onSortingChange() {} });
  assert.deepEqual(reopened.slots(), ['plan', 'net', 'daily', 'pending', 'recent']);
  reopened.unmount();
});
test('总览排序：保存失败明确提示并留在排序中，可重试成功', () => {
  const storage = memoryStorage(), changes = [];
  const r = loadOverviewOrder(storage, { blocks, onSortingChange: value => changes.push(value) });
  r.key('recent', 'Enter'); r.key('recent', 'ArrowUp');
  storage.fail = true;
  r.button('完成').props.onClick(); r.render();
  assert.equal(r.text(r.nodes().find(node => node.type === 'Notice')), '顺序未能保存，请重试。');
  assert.equal(r.button('完成') !== undefined, true); assert.deepEqual(changes, [true]);
  storage.fail = false;
  r.button('完成').props.onClick(); r.render();
  assert.equal(r.nodes().find(node => node.type === 'Notice'), undefined);
  assert.deepEqual(JSON.parse(storage.value), ['net', 'plan', 'daily', 'recent', 'pending']);
  assert.deepEqual(changes, [true, false]);
  r.unmount();
});
test('总览排序：坏偏好回默认，关闭的模块不显示但保留其位置', () => {
  const storage = memoryStorage('{bad'), r = loadOverviewOrder(storage, { blocks: blocks.filter(block => block.id !== 'plan'), onSortingChange() {} });
  assert.deepEqual(r.slots(), ['net', 'daily', 'pending', 'recent']);
  r.unmount();
  const kept = memoryStorage(JSON.stringify(['recent', 'plan', 'net']));
  const reopened = loadOverviewOrder(kept, { blocks: blocks.filter(block => block.id !== 'plan'), onSortingChange() {} });
  assert.deepEqual(reopened.slots(), ['recent', 'net', 'daily', 'pending']);
  reopened.unmount();
});
test('总览排序：空库起步卡固定在规划之后、日均成本之前，进入排序后不参与', () => {
  const storage = memoryStorage(), r = loadOverviewOrder(storage, { blocks, pinned: { after: 'plan', content: 'START' }, onSortingChange() {} });
  const collected = () => r.nodes().flatMap(node => node.props?.['data-home-block'] ? [node.props['data-home-block']] : node.props?.className === 'h-order-pinned' ? ['START'] : []);
  assert.deepEqual(collected(), ['net', 'plan', 'START', 'daily', 'pending', 'recent']);
  r.key('net', 'Enter');
  assert.equal(r.unpin(), '');
  r.unmount();
});
test('总览排序：资料库重挂载或进入保存核对都会复位父页排序状态', () => {
  const changes = [], r = loadOverviewOrder(memoryStorage(), { blocks, onSortingChange: value => changes.push(value) });
  r.key('net', 'Enter');
  assert.equal(r.button('完成') !== undefined, true);
  r.unmount();
  assert.deepEqual(changes, [true, false]);
  const disabled = loadOverviewOrder(memoryStorage(), { blocks, disabled: true, onSortingChange: value => changes.push(value) });
  disabled.key('net', 'Enter');
  assert.equal(disabled.button('完成'), undefined); assert.deepEqual(changes, [true, false]);
  disabled.unmount();
});
