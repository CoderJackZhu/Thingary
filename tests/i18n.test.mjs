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
