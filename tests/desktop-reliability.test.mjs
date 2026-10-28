import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { pausableTimer } from '../src/pausable-timer.ts';
import { moveAssetFocus } from '../src/asset-list-keyboard.ts';
import { keepTabInDialog } from '../src/search-focus.ts';

function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { tasks.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    get pending() { return tasks.size; },
    advance(ms) {
      now += ms;
      for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.fn(); }
    },
  };
}

test('notification expiry keeps remaining time across overlapping hover and keyboard focus', () => {
  const time = clock(); let expired = 0;
  const timer = pausableTimer(() => expired++, time);
  timer.start(10000); time.advance(3000);
  timer.pause('hover'); timer.pause('focus');
  time.advance(20000); timer.resume('hover'); time.advance(20000);
  assert.equal(expired, 0, 'leaving the bar with the mouse must not remove a focused undo action');
  timer.resume('focus'); time.advance(6999); assert.equal(expired, 0);
  time.advance(1); assert.equal(expired, 1);
  timer.resume('focus'); time.advance(10000); assert.equal(expired, 1);
});

test('a replacement notification receives its full lifetime and cleanup cancels expiry', () => {
  const time = clock(); let expired = 0;
  const timer = pausableTimer(() => expired++, time);
  timer.start(5000); time.advance(4000); timer.start(5000);
  time.advance(1000); assert.equal(expired, 0);
  time.advance(4000); assert.equal(expired, 1);
  timer.start(5000); timer.cancel(); time.advance(10000); assert.equal(expired, 1);
});

test('new undo offers stay paused when the pointer remains over the bar', () => {
  const time = clock(); let expired = 0;
  const timer = pausableTimer(() => expired++, time);
  timer.start(10000); timer.pause('hover'); timer.start(10000);
  time.advance(60000); assert.equal(expired, 0);
  timer.resume('hover'); time.advance(10000); assert.equal(expired, 1);
});

test('reset clears every pause reason and stops the timer until a fresh start', () => {
  const time = clock(); let expired = 0;
  const timer = pausableTimer(() => expired++, time);
  timer.start(5000); time.advance(1000);
  timer.pause('hover'); timer.pause('focus'); timer.reset();
  timer.resume('hover'); timer.resume('focus'); time.advance(10000);
  assert.equal(expired, 0);
  timer.pause('hover'); timer.pause('focus'); timer.reset(); timer.start(5000);
  time.advance(4999); assert.equal(expired, 0);
  time.advance(1); assert.equal(expired, 1);
  timer.start(5000); timer.reset(); time.advance(10000);
  assert.equal(expired, 1, 'reset also cancels an actively scheduled expiry');
});

test('cancel deliberately preserves hover across a later start', () => {
  const time = clock(); let expired = 0;
  const timer = pausableTimer(() => expired++, time);
  timer.start(5000); timer.pause('hover'); timer.cancel(); timer.start(5000);
  time.advance(60000); assert.equal(expired, 0);
  timer.resume('hover'); time.advance(4999); assert.equal(expired, 0);
  time.advance(1); assert.equal(expired, 1);
});

// Execute the actual components with the same lightweight hook/JSX approach as
// the other component tests, including dependency cleanup and unmount cleanup.
function barRuntime(file, component) {
  const time = clock(), slots = [], effects = [], pending = [], listeners = new Map(), timers = [];
  let cursor = 0;
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useEffect(effect, deps) {
      const i = cursor++, prior = effects[i];
      if (!prior || deps.some((value, j) => !Object.is(value, prior.deps[j]))) {
        pending.push(() => { prior?.cleanup?.(); effects[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    './pausable-timer': { pausableTimer: expire => {
      const timer = pausableTimer(expire, time); timers.push(timer); return timer;
    } },
    './i18n.ts': { t: text => text },
    './undo-shortcut': { modKey: () => 'Ctrl+', undoTarget: () => 'none' },
    './privacy-lock': { privacyMenuAllowed: () => true },
    './asset': { errorMessage: error => error.message },
    '@tauri-apps/api/event': { listen: async () => () => {} },
  };
  const exports = {};
  const script = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, {
    exports, require: id => { assert.ok(id in dependencies, id); return dependencies[id]; },
    document: { activeElement: null, getElementById: () => null },
    window: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name),
      dispatchEvent() {},
    },
    Event,
  });
  return {
    time, timers,
    render(props = {}) {
      cursor = 0;
      const tree = exports[component](props);
      pending.splice(0).forEach(effect => effect());
      return tree;
    },
    offer(detail) { listeners.get('thingary-undo')({ detail }); },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

test('GlobalNotice hover-close then a new success expires without a mouseleave', () => {
  for (const reason of ['hover', 'focus']) {
    const h = barRuntime('GlobalNotice.tsx', 'GlobalNotice');
    const props = { notice: { kind: 'success', text: 'Fictional first success' }, onDismiss: () => { props.notice = null; } };
    const tree = h.render(props);
    tree.props[reason === 'hover' ? 'onMouseEnter' : 'onFocusCapture']();
    tree.props.children[1].props.children[1].props.onClick();
    assert.equal(h.render(props), null);
    props.notice = { kind: 'success', text: 'Fictional second success' }; h.render(props);
    h.time.advance(4999); assert.ok(props.notice);
    h.time.advance(1); assert.equal(props.notice, null, reason + ' must not leak from the dismissed bar');
    h.unmount();
  }
});

test('GlobalNotice replacement success stays paused until the pointer leaves', () => {
  const h = barRuntime('GlobalNotice.tsx', 'GlobalNotice'); let expired = 0;
  const props = { notice: { kind: 'success', text: 'Fictional first success' }, onDismiss: () => expired++ };
  const first = h.render(props); h.time.advance(4000);
  first.props.onMouseEnter(); h.time.advance(2000);
  props.notice = { kind: 'success', text: 'Fictional replacement success' };
  const tree = h.render(props); h.time.advance(60000);
  assert.equal(expired, 0);
  tree.props.onMouseLeave(); h.time.advance(4999); assert.equal(expired, 0);
  h.time.advance(1); assert.equal(expired, 1);
  h.unmount();
});

test('UndoBar clears hover and focus when an offer becomes null', () => {
  for (const reason of ['hover', 'focus']) {
    const h = barRuntime('undo.tsx', 'UndoBar'); h.render();
    h.offer({ label: 'Fictional deletion', run: async () => {} });
    h.render().props[reason === 'hover' ? 'onMouseEnter' : 'onFocusCapture']();
    h.offer(null); assert.equal(h.render(), null);
    h.offer({ label: 'Fictional later deletion', run: async () => {} }); h.render();
    h.time.advance(9999); assert.ok(h.render());
    h.time.advance(1); assert.equal(h.render(), null);
    h.unmount();
  }
});

test('UndoBar completion message expires and the next offer gets its full lifetime', async () => {
  const h = barRuntime('undo.tsx', 'UndoBar'); h.render();
  h.offer({ label: 'Fictional deletion', run: async () => {} });
  const tree = h.render(); tree.props.onMouseEnter();
  await tree.props.children[1].props.onClick(); await new Promise(resolve => setImmediate(resolve));
  const completed = h.render();
  assert.equal(completed.props.children[1], false);
  h.time.advance(60000); assert.ok(h.render(), 'hover still pauses the completion message');
  completed.props.onMouseLeave(); h.time.advance(4000); assert.equal(h.render(), null);
  h.offer({ label: 'Fictional later deletion', run: async () => {} }); h.render();
  h.time.advance(10000); assert.equal(h.render(), null);
  h.unmount();
});

test('both bars reset their timer on unmount even while paused', () => {
  for (const [file, component] of [['GlobalNotice.tsx', 'GlobalNotice'], ['undo.tsx', 'UndoBar']]) {
    const h = barRuntime(file, component); let expired = 0;
    const props = { notice: { kind: 'success', text: 'Fictional success' }, onDismiss: () => expired++ };
    let tree = h.render(props);
    if (component === 'UndoBar') {
      h.offer({ label: 'Fictional deletion', run: async () => { expired++; } }); tree = h.render();
    }
    tree.props.onMouseEnter(); tree.props.onFocusCapture(); h.unmount();
    h.time.advance(60000); assert.equal(expired, 0); assert.equal(h.time.pending, 0);
    h.timers[0].start(5000);
    assert.equal(h.time.pending, 1, component + ' unmount must clear its pause reasons');
    h.timers[0].cancel();
  }
});

test('item keyboard navigation reaches ends and preserves selection, composition and modifier shortcuts', () => {
  const focused = [];
  const rows = Array.from({ length: 100 }, (_, i) => ({ focus: () => focused.push(i) }));
  for (const row of rows) row.parentElement = { querySelectorAll: () => rows };
  const press = (index, key, extra = {}) => {
    const event = { key, currentTarget: rows[index], nativeEvent: {}, preventDefault() { this.defaultPrevented = true; }, ...extra };
    moveAssetFocus(event);
    return event;
  };
  assert.equal(press(0, 'ArrowDown').defaultPrevented, true); assert.equal(focused.at(-1), 1);
  press(1, 'End'); assert.equal(focused.at(-1), 99);
  press(99, 'ArrowDown'); assert.equal(focused.at(-1), 99);
  press(99, 'Home'); assert.equal(focused.at(-1), 0);
  press(0, 'ArrowUp'); assert.equal(focused.at(-1), 0);
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
    assert.equal(press(0, 'ArrowDown', extra).defaultPrevented, undefined);
  }
  assert.equal(press(0, 'Enter').defaultPrevented, undefined, 'opening a record is still owned by the row handler');
});

test('search dialog keeps Tab on its controls when the native modal wraps to the document body', () => {
  const first = { focus() { globalThis.document.activeElement = first; } };
  const last = { focus() { globalThis.document.activeElement = last; } };
  const dialog = {
    open: true,
    focus() {},
    querySelectorAll: () => [first, last],
  };
  const previous = globalThis.document;
  globalThis.document = { activeElement: last };
  try {
    const forward = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
    assert.equal(keepTabInDialog(dialog, forward), true);
    assert.equal(forward.prevented, true);
    assert.equal(globalThis.document.activeElement, first);

    globalThis.document.activeElement = first;
    const backward = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; } };
    assert.equal(keepTabInDialog(dialog, backward), true);
    assert.equal(backward.prevented, true);
    assert.equal(globalThis.document.activeElement, last);

    globalThis.document.activeElement = null;
    const outside = { key: 'Tab', shiftKey: false, preventDefault() { this.prevented = true; } };
    assert.equal(keepTabInDialog(dialog, outside), true);
    assert.equal(globalThis.document.activeElement, first);
  } finally {
    globalThis.document = previous;
  }
});
