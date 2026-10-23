import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLang, t } from '../src/i18n.ts';

test('system language: Chinese variants stay Chinese, everything else is English', () => {
  for (const l of ['zh-CN', 'zh-Hans-CN', 'zh-TW', 'zh']) assert.equal(resolveLang('system', l), 'zh-CN', l);
  for (const l of ['en-US', 'ja-JP', 'de']) assert.equal(resolveLang('system', l), 'en', l);
  assert.equal(resolveLang('en', 'zh-CN'), 'en');
});

test('t() falls back to the Chinese source and fills placeholders', () => {
  assert.equal(t('尚未翻译的句子'), '尚未翻译的句子');
  assert.equal(t('已选 {n} 项', { n: 3 }), '已选 3 项');
  assert.equal(t('已选 {n} 项', {}), '已选 {n} 项');
});

import { en } from '../src/locales/en.ts';
import { collectKeys } from '../scripts/i18n-keys.mjs';
const holes = s => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort().join();

test('every English entry keeps the placeholders, has no Chinese left, and belongs to a live key', () => {
  const live = new Set(collectKeys());
  for (const [key, value] of Object.entries(en)) {
    assert.equal(holes(value), holes(key), key);
    assert.doesNotMatch(value, /[一-鿿]/, key);
    assert.ok(live.has(key), `stale translation: ${key}`);
  }
});

test('the English table covers the interface (a new Chinese string without a translation shows as Chinese)', () => {
  const keys = collectKeys();
  const missing = keys.filter(k => !(k in en));
  assert.ok(missing.length / keys.length < 0.02, `${missing.length} untranslated, e.g. ${missing.slice(0, 5).join(' / ')}`);
});
