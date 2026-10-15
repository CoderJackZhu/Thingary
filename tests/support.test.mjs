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
    components: ['SupportLink', 'LogoMark', 'UpdateCheck'], modules: { ...modules, '@tauri-apps/api/core': { invoke: async name => { calls.push(name); throw Error('Unavailable'); } } },
  });
  await r.settle();
  assert.deepEqual(calls, ['app_version']);
  assert.match(r.text(r.nodes()[0]), /开发与维护：CoderJackZhu.*版本暂不可用/);
  assert.match(r.text(r.nodes()[0]), /可用恢复密钥加密备份.*应用只保存公钥.*主资料库、图片与恢复保护副本未加密/);
  assert.ok(r.button('检查更新'));
  assert.equal(r.button('关于物谱'), undefined);
  r.button('备份与恢复').props.onClick();
  assert.deepEqual(destinations, ['backup']);
  assert.deepEqual(calls, ['app_version']);
});

test('about and help expose the real update action directly without navigation or an automatic network request', async () => {
  const calls = [];
  const r = runtime('SupportPanel', { blocked: false, onData() { throw Error('Unexpected navigation'); } }, undefined, undefined, {
    components: ['LogoMark', 'SupportLink', 'UpdateCheck'],
    modules: { ...modules, './update-check': { updateSummary: () => '已是最新版本（0.0.6）。', sourceLabel: {} }, '@tauri-apps/api/core': { invoke: async name => { calls.push(name); return name === 'app_version' ? '0.0.6' : { update_available: false }; } } },
  });
  await r.settle();
  assert.deepEqual(calls, ['app_version']);
  assert.equal(r.button('关于物谱'), undefined);
  assert.equal(r.button('版本与更新'), undefined);
  assert.ok(r.button('检查更新'));
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.deepEqual(calls, ['app_version', 'update_check']);
  assert.match(r.text(r.nodes()[0]), /已是最新版本/);
});

test('about and update menu commands share one destination while backup stays in data management', () => {
  assert.equal(support.supportMenuDestination('open-about'), 'support');
  assert.equal(support.supportMenuDestination('open-updates'), 'support');
  assert.equal(support.supportMenuDestination('open-backup'), 'backup');
  assert.equal(support.supportMenuDestination('open-help'), 'support');
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
