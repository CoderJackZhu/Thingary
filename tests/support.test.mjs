import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as support from '../src/support.ts';
import { readFileSync } from 'node:fs';

const modules = {
  './support': support,
  './asset': { errorMessage: e => e.message },
  '../LICENSE?raw': { default: 'AGPL license fixture' },
  '../THIRD_PARTY_LICENSES.md?raw': { default: 'Third-party fixture' },
};

test('help opens without a network check and keeps the local information when version is unavailable', async () => {
  const calls = [], destinations = [];
  const r = runtime('SupportPanel', { blocked: false, onData: target => destinations.push(target) }, undefined, undefined, {
    components: ['SupportLink', 'LogoMark'], modules: { ...modules, '@tauri-apps/api/core': { invoke: async name => { calls.push(name); throw Error('Unavailable'); } } },
  });
  await r.settle();
  assert.deepEqual(calls, ['app_version']);
  assert.match(r.text(r.nodes()[0]), /版本暂不可用.*开发与维护：CoderJackZhu/);
  assert.match(r.text(r.nodes()[0]), /资料与备份没有应用级加密/);
  r.button('版本与更新').props.onClick();
  r.button('备份与恢复').props.onClick();
  assert.deepEqual(destinations, ['update', 'backup']);
  assert.deepEqual(calls, ['app_version']);
});

test('external help passes only an ID and leaves a copyable address after opening fails', async () => {
  const calls = [];
  let failed = true, prevented = 0;
  const r = runtime('SupportLink', { target: 'feedback', children: '问题反馈' }, undefined, undefined, {
    components: [], modules: { ...modules, '@tauri-apps/api/core': { invoke: async (name, args) => { calls.push([name, args]); if (failed) throw Error('无法打开浏览器。'); } } },
  });
  assert.equal(calls.length, 0);
  await r.find('a').props.onClick({ preventDefault: () => prevented++ });
  await r.settle();
  assert.equal(prevented, 1);
  assert.equal(JSON.stringify(calls), JSON.stringify([['support_open', { target: 'feedback' }]]));
  const alert = r.nodes().find(n => n.props?.role === 'alert');
  assert.match(r.text(alert), /无法打开浏览器.*复制地址/);
  assert.ok(r.text(alert).includes(support.supportUrls.feedback));
  failed = false;
  await r.find('a').props.onClick({ preventDefault() {} });
  await r.settle();
  assert.equal(r.nodes().find(n => n.props?.role === 'alert'), undefined);
});

test('every rendered help address matches the backend allowlist', () => {
  const backend = readFileSync(new URL('../src-tauri/src/support.rs', import.meta.url), 'utf8');
  const allowed = Object.fromEntries([...backend.matchAll(/"(\w+)"\s*=>\s*\{?\s*Ok\(\s*"([^"]+)"\s*,?\s*\)/g)].map(m => [m[1], m[2]]));
  assert.deepEqual(allowed, support.supportUrls);
});
