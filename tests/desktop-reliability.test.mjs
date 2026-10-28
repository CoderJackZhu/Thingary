import test from 'node:test';
import assert from 'node:assert/strict';
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
