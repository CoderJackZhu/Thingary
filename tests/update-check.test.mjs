import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as model from '../src/update-check.ts';

const release = (version, extra = {}) => ({ version, published_at: '2026-10-20T08:00:00Z', notes: '虚构发布说明', ...extra });

test('summary says what was found in plain words', () => {
  assert.equal(model.updateSummary({ current: '0.0.5', latest: release('0.0.6'), update_available: true }), '发现新版本 0.0.6（2026-10-20 发布），当前版本 0.0.5。');
  assert.equal(model.updateSummary({ current: '0.0.5', latest: release('0.0.5'), update_available: false }), '已是最新版本（0.0.5）。');
  assert.match(model.updateSummary({ current: '0.0.7', latest: release('0.0.5'), update_available: false }), /高于已发布的最新版本 0.0.5，可能是开发版本/);
  assert.match(model.updateSummary({ current: '0.0.5', latest: null, update_available: false }), /没有找到已发布的版本/);
  assert.equal(model.updateSummary({ current: '0.0.5', latest: release('0.0.6', { published_at: '' }), update_available: true }), '发现新版本 0.0.6，当前版本 0.0.5。');
});

function mount(invoke) {
  return runtime('UpdateCheck', {}, undefined, undefined, { components: [], modules: { './update-check': model, './asset': { errorMessage: e => e.message }, '@tauri-apps/api/core': { invoke } } });
}

test('nothing is requested until the button is pressed; only the version is read on open', async () => {
  const calls = [];
  const r = mount(async name => { calls.push(name); return '0.0.5'; });
  await r.settle();
  assert.deepEqual(calls, ['app_version']);
  assert.match(r.text(r.nodes()[0]), /物谱平时不联网.*不发送你的资料或设备信息.*不会自动下载或替换应用/);
  assert.match(r.text(r.nodes()[0]), /当前版本 0.0.5/);
});

test('a newer release shows its notes, the backup warning and opens only the validated version', async () => {
  const calls = [];
  const r = mount(async (name, args) => { calls.push([name, args]); return name === 'app_version' ? '0.0.5' : name === 'update_check' ? { current: '0.0.5', latest: release('0.0.6'), update_available: true } : null; });
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  const text = r.text(r.nodes()[0]);
  assert.match(text, /发现新版本 0.0.6（2026-10-20 发布）/);
  assert.match(text, /虚构发布说明/);
  assert.match(text, /完整备份并异地保存.*旧版将不能打开升级后的资料/);
  r.button('在浏览器中打开下载页').props.onClick();
  await r.settle();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['update_open_release', { version: '0.0.6' }]));
});

test('up to date offers no download; a failed check reports and can be retried', async () => {
  let fail = true;
  const r = mount(async name => {
    if (name === 'app_version') return '0.0.5';
    if (fail) throw Error('无法连接到 GitHub，请检查网络后重试');
    return { current: '0.0.5', latest: release('0.0.5'), update_available: false };
  });
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /无法连接到 GitHub/);
  assert.equal(r.button('在浏览器中打开下载页'), undefined);
  fail = false;
  r.button('检查更新').props.onClick();
  await r.settle();
  const text = r.text(r.nodes()[0]);
  assert.match(text, /已是最新版本（0.0.5）/);
  assert.doesNotMatch(text, /无法连接到 GitHub/);
  assert.equal(r.button('在浏览器中打开下载页'), undefined);
});
