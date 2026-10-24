import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLang, t, translate } from '../src/i18n.ts';

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

test('English plural values choose one/other, replace #, and keep other placeholders', () => {
  assert.equal(translate('en', '{count} 件', { count: 1 }), '1 item');
  assert.equal(translate('en', '{count} 件', { count: 0 }), '0 items');
  assert.equal(translate('en', '{count} 件', { count: 2 }), '2 items');
  assert.equal(translate('en', '{message}（共 {count} 项）', { message: 'Note', count: 1 }), 'Note (1 item)');
  assert.equal(translate('en', ' · 已售出 {sold} 件', { sold: 1 }), ' · 1 item sold');
});

test('Chinese keys and their placeholders stay unchanged', () => {
  assert.equal(translate('zh-CN', '{count} 件', { count: 1 }), '1 件');
  assert.equal(translate('zh-CN', '{message}（共 {count} 项）', { message: '注', count: 2 }), '注（共 2 项）');
});

import { en } from '../src/locales/en.ts';
import { collectKeys } from '../scripts/i18n-keys.mjs';
// Compare parameter names, including the count of a `{count, plural, ...}` value.
const holes = s => [...s.matchAll(/\{\s*(\w+)\s*(?=[,}])/g)].map(m => `{${m[1]}}`).sort().join();

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

test('an English entry keeps the leading and trailing spaces of its Chinese key (they join it to neighbouring text)', () => {
  for (const [key, value] of Object.entries(en)) {
    if (/^\s/.test(key)) assert.match(value, /^\s/, `leading space: ${JSON.stringify(key)}`);
    if (/\s$/.test(key)) assert.match(value, /\s$/, `trailing space: ${JSON.stringify(key)}`);
  }
});
