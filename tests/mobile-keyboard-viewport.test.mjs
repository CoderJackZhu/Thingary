import test from 'node:test';
import assert from 'node:assert/strict';
import { installKeyboardViewport } from '../src/mobile/ui/keyboard-viewport.ts';

function fixture(t, { height = 667, visible = 667, offset = 0, scale = 1, nativePan = false } = {}) {
  const viewport = Object.assign(new EventTarget(), { height: visible, offsetTop: offset, scale });
  const styles = new Map(), dataset = {}, frames = new Map(); let next = 0;
  const root = { clientHeight: height, dataset, style: { setProperty: (k, v) => styles.set(k, v), removeProperty: k => styles.delete(k) }, hasAttribute: () => 'keyboard' in dataset, toggleAttribute(k, v) { if (v) dataset.keyboard = ''; else delete dataset.keyboard; } };
  const doc = Object.assign(new EventTarget(), { documentElement: root, activeElement: null, body: { append() {} }, createElement: () => ({style:{},setAttribute(){},getBoundingClientRect:()=>({top:nativePan ? -viewport.offsetTop : 0}),remove(){}}) });
  const original = new Map(); const FakeElement = class {};
  for (const [k, v] of Object.entries({ window: { visualViewport: viewport, innerHeight: height }, document: doc, HTMLElement: FakeElement, Element: FakeElement, requestAnimationFrame: f => { frames.set(++next, f); return next; }, cancelAnimationFrame: n => frames.delete(n) })) {
    original.set(k, Object.getOwnPropertyDescriptor(globalThis, k)); Object.defineProperty(globalThis, k, { configurable: true, value: v });
  }
  t.after(() => { for (const [k, d] of original) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } });
  const flush = () => { const work = [...frames.values()]; frames.clear(); work.forEach(f => f()); };
  return { viewport, styles, dataset, root, doc, frames, flush };
}

test('keyboard pan and resize follow the visible viewport; dismissal restores normal chrome', t => {
  const f = fixture(t); const stop = installKeyboardViewport(); f.flush();
  assert.equal(f.dataset.keyboard, undefined);
  Object.assign(f.viewport, { offsetTop: 184, height: 341 });
  f.viewport.dispatchEvent(new Event('resize')); f.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(f.frames.size, 1); f.flush();
  assert.equal(f.styles.get('--m-viewport-top'), '184px');
  assert.equal(f.styles.get('--m-viewport-height'), '341px');
  assert.equal(f.dataset.keyboard, '');
  Object.assign(f.viewport, { offsetTop: 0, height: 667 }); f.viewport.dispatchEvent(new Event('resize')); f.flush();
  assert.equal(f.dataset.keyboard, undefined); assert.equal(f.styles.get('--m-viewport-top'), '0px'); stop();
});

test('focused input scrolls inside its modal, clear of sticky navigation and the action bar', t => {
  const f = fixture(t, { visible: 341, offset: 180 }); const scrolls = [];
  const page = { getBoundingClientRect: () => ({ top: 180, bottom: 521 }), closest: () => null, querySelector: s => ({ getBoundingClientRect: () => s === '.m-navbar' ? { bottom: 232 } : { top: 445 } }), scrollBy: v => scrolls.push(v) };
  f.doc.activeElement = Object.assign(new HTMLElement(), { matches: () => true, closest: () => page, getBoundingClientRect: () => ({ top: 420, bottom: 464 }) });
  const stop = installKeyboardViewport(); f.flush(); assert.equal(scrolls[0].top, 27);
  f.doc.activeElement.getBoundingClientRect = () => ({ top: 220, bottom: 264 });
  f.doc.dispatchEvent(new Event('focusin')); f.flush(); assert.equal(scrolls[1].top, -20); stop();
});

test('an already visible input is left in place', t => {
  const f = fixture(t, { visible: 341 });
  const page = { getBoundingClientRect: () => ({ top: 0, bottom: 341 }), closest: () => null, querySelector: () => null, scrollBy: () => assert.fail('unnecessary scroll') };
  f.doc.activeElement = Object.assign(new HTMLElement(), { matches: () => true, closest: () => page, getBoundingClientRect: () => ({ top: 100, bottom: 144 }) });
  const stop = installKeyboardViewport(); f.flush(); stop();
});

test('pinch zoom and missing API retain the browser fallback; cleanup removes listeners and pending work', t => {
  const f = fixture(t, { visible: 300 }); const stop = installKeyboardViewport(); f.flush();
  f.viewport.scale = 2; f.viewport.dispatchEvent(new Event('resize')); f.flush(); assert.equal(f.styles.size, 0); assert.equal(f.dataset.keyboard, undefined);
  f.viewport.scale = 1; f.viewport.dispatchEvent(new Event('scroll')); stop(); f.flush(); assert.equal(f.styles.size, 0);
  f.viewport.dispatchEvent(new Event('resize')); f.doc.dispatchEvent(new Event('focusin')); assert.equal(f.frames.size, 0);
  window.visualViewport = null; assert.doesNotThrow(() => installKeyboardViewport()());
});


test('WKWebView client rects after native panning share the fixed origin, without applying the pan twice', t => {
  const f = fixture(t, { visible: 341, offset: 200, nativePan: true }); const scrolls = [];
  const page = { getBoundingClientRect: () => ({ top: 0, bottom: 341 }), closest: () => null, querySelector: s => ({ getBoundingClientRect: () => s === '.m-navbar' ? { bottom: 52 } : { top: 230 } }), scrollBy: v => scrolls.push(v) };
  f.doc.activeElement = Object.assign(new HTMLElement(), { matches: () => true, closest: () => page, getBoundingClientRect: () => ({ top: 230, bottom: 318 }) });
  const stop = installKeyboardViewport(); f.flush(); assert.equal(scrolls[0].top, 96); stop();
});
