import test from 'node:test';
import assert from 'node:assert/strict';
import { readStyle, styles } from '../src/appearance.ts';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };

test('first run defaults to the bento theme and saved choices are kept', () => {
  store.clear();
  assert.equal(readStyle(), 'bento');
  for (const saved of ['native', 'paper', 'bento']) { store.set('thingary.style', saved); assert.equal(readStyle(), saved); }
  store.set('thingary.style', 'garbage'); assert.equal(readStyle(), 'bento');
});

test('only the bento card is labelled as the default', () => {
  assert.deepEqual(styles.filter(s => s.note.includes('默认')).map(s => s.value), ['bento']);
});
