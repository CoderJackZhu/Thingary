import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as model from '../src/update-check.ts';

const release = (version, extra = {}) => ({ version, published_at: '2026-10-20T08:00:00Z', notes: '虚构发布说明', sources: ['gitee', 'github'], ...extra });
const outcome = o => ({ unreachable: [], ...o });

test('summary says what was found in plain words', () => {
  assert.equal(model.updateSummary(outcome({ current: '0.0.5', latest: release('0.0.6'), update_available: true })), '发现新版本 0.0.6（2026-10-20 发布），当前版本 0.0.5。');
  assert.equal(model.updateSummary(outcome({ current: '0.0.5', latest: release('0.0.5'), update_available: false })), '已是最新版本（0.0.5）。');
  assert.match(model.updateSummary(outcome({ current: '0.0.7', latest: release('0.0.5'), update_available: false })), /高于已发布的最新版本 0.0.5，可能是开发版本/);
  assert.match(model.updateSummary(outcome({ current: '0.0.5', latest: null, update_available: false })), /没有找到已发布的版本/);
  assert.equal(model.updateSummary(outcome({ current: '0.0.5', latest: release('0.0.6', { published_at: '' }), update_available: true })), '发现新版本 0.0.6，当前版本 0.0.5。');
});

test('an unreachable mirror is named, because it may hold something newer', () => {
  const text = model.updateSummary(outcome({ current: '0.0.5', latest: release('0.0.5', { sources: ['gitee'] }), update_available: false, unreachable: ['github'] }));
  assert.match(text, /已是最新版本（0.0.5）。（未能连接 GitHub，结果只来自其余来源，可能不是最新。）/);
  assert.match(model.updateSummary(outcome({ current: '0.0.5', latest: null, update_available: false, unreachable: ['gitee', 'github'] })), /未能连接 Gitee、GitHub/);
});

function mount(invoke) {
  return runtime('UpdateCheck', {}, undefined, undefined, { components: [], modules: { './update-check': model, './asset': { errorMessage: e => e.message }, '@tauri-apps/api/core': { invoke } } });
}

test('nothing is requested until the button is pressed; only the version is read on open', async () => {
  const calls = [];
  const r = mount(async name => { calls.push(name); return '0.0.5'; });
  await r.settle();
  assert.deepEqual(calls, ['app_version']);
  const text = r.text(r.nodes()[0]);
  assert.match(text, /物谱平时不联网.*Gitee 和 GitHub 各查询一次.*不发送你的资料或设备信息.*不会自动下载或替换应用/);
  assert.match(text, /当前版本 0.0.5/);
});

test('a newer release shows notes and the backup warning, and each page opens with its own mirror', async () => {
  const calls = [];
  const r = mount(async (name, args) => { calls.push([name, args]); return name === 'app_version' ? '0.0.5' : name === 'update_check' ? outcome({ current: '0.0.5', latest: release('0.0.6'), update_available: true }) : null; });
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  const text = r.text(r.nodes()[0]);
  assert.match(text, /发现新版本 0.0.6（2026-10-20 发布）/);
  assert.match(text, /虚构发布说明/);
  assert.match(text, /完整备份并异地保存.*旧版将不能打开升级后的资料/);
  r.button('在浏览器中打开 Gitee 下载页').props.onClick();
  await r.settle();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['update_open_release', { version: '0.0.6', source: 'gitee' }]));
  r.button('在浏览器中打开 GitHub 下载页').props.onClick();
  await r.settle();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['update_open_release', { version: '0.0.6', source: 'github' }]));
});

test('only the mirrors that list the version get a download button', async () => {
  const r = mount(async name => name === 'app_version' ? '0.0.5' : outcome({ current: '0.0.5', latest: release('0.0.6', { sources: ['github'] }), update_available: true, unreachable: ['gitee'] }));
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.equal(r.button('在浏览器中打开 Gitee 下载页'), undefined);
  assert.ok(r.button('在浏览器中打开 GitHub 下载页'));
  assert.match(r.text(r.nodes()[0]), /未能连接 Gitee/);
});

test('up to date offers no download; a failed check reports and can be retried', async () => {
  let fail = true;
  const r = mount(async name => {
    if (name === 'app_version') return '0.0.5';
    if (fail) throw Error('无法连接到 Gitee 和 GitHub，请检查网络后重试');
    return outcome({ current: '0.0.5', latest: release('0.0.5'), update_available: false });
  });
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /无法连接到 Gitee 和 GitHub/);
  assert.equal(r.button('在浏览器中打开 Gitee 下载页'), undefined);
  fail = false;
  r.button('检查更新').props.onClick();
  await r.settle();
  const text = r.text(r.nodes()[0]);
  assert.match(text, /已是最新版本（0.0.5）/);
  assert.doesNotMatch(text, /无法连接到 Gitee 和 GitHub/);
  assert.equal(r.button('在浏览器中打开 GitHub 下载页'), undefined);
});

test('compact version row preserves busy and new-release details without a nested card', async () => {
  let resolveCheck, calls = [];
  const r = runtime('UpdateCheck', { compact: true, showVersion: false, versionLabel: '版本暂不可用' }, undefined, undefined, {
    components: [], modules: { './update-check': model, './asset': { errorMessage: e => e.message }, '@tauri-apps/api/core': { invoke: async name => { calls.push(name); return new Promise(resolve => { resolveCheck = resolve; }); } } },
  });
  await r.settle();
  assert.deepEqual(calls, []);
  assert.equal(r.nodes()[0].props.className, 'update-check update-check-inline');
  assert.match(r.text(r.nodes()[0]), /版本暂不可用检查更新手动检查/);
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.equal(r.button('正在检查…').props.disabled, true);
  resolveCheck(outcome({ current: '0.0.5', latest: release('0.0.6'), update_available: true }));
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /发现新版本.*完整备份并异地保存/);
  assert.ok(r.button('在浏览器中打开 GitHub 下载页'));
  assert.deepEqual(calls, ['update_check']);
});
