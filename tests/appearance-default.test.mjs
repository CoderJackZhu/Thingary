import test from 'node:test';
import assert from 'node:assert/strict';
import { readStyle, styles } from '../src/appearance.ts';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };

test('first run defaults to the bento theme and saved choices are kept', () => {
  store.clear();
  assert.equal(readStyle(), 'bento');
  for (const saved of ['native', 'olive', 'bento']) { store.set('thingary.style', saved); assert.equal(readStyle(), saved); }
  store.set('thingary.style', 'paper'); assert.equal(readStyle(), 'olive', 'the retired paper style reads as its replacement');
  store.set('thingary.style', 'garbage'); assert.equal(readStyle(), 'bento');
});

test('only the bento card is labelled as the default', () => {
  assert.deepEqual(styles.filter(s => s.note.includes('默认')).map(s => s.value), ['bento']);
});

import { readFileSync } from 'node:fs';
test('mobile start leaves a saved appearance to the runtime instead of overwriting it', () => {
  const start = readFileSync(new URL('../src/mobile/start.tsx', import.meta.url), 'utf8');
  assert.match(start, /function appearance\(\) \{\s*if \(hasSavedAppearance\(\)\) return;/);
});

test('mobile app mounts nothing until the privacy gate allows reading, and a payment record can be deleted', () => {
  const app = readFileSync(new URL('../src/mobile/MobileApp.tsx', import.meta.url), 'utf8');
  assert.match(app, /privacySnapshot\(\)\.mounted[\s\S]*if \(!mounted\) return null;/);
  const pay = readFileSync(new URL('../src/mobile/spending/PaymentEdit.tsx', import.meta.url), 'utf8');
  assert.match(pay, /trash\('payment', record\.id/);
});
