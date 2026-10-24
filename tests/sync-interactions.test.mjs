import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as model from '../src/sync/state.ts';
import { t } from '../src/i18n.ts';
import { createSyncPreview } from '../src/sync/preview.ts';

const source = readFileSync(new URL('../src/sync/SyncSettings.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const apiCode = ts.transpileModule(readFileSync(new URL('../src/sync/api.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function screen(mode, overrides = {}, seedPreview = false) {
  const preview = createSyncPreview(mode), calls = [], slots = [], effects = [], cleanup = [];
  let cursor = 0, tree;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((v, n) => !Object.is(v, slots[i][n]))) {
        slots[i] = deps;
        effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); });
      }
    },
  };
  const invoke = async (command, args) => {
    calls.push({ command, args });
    return command in overrides ? overrides[command](args) : preview.command(command, args);
  };
  const api = {};
  vm.runInNewContext(apiCode, { exports: api, require: id => {
    assert.equal(id, '@tauri-apps/api/core');
    return { invoke };
  } });
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const deps = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@tauri-apps/api/core': { invoke },
    '../asset': { errorMessage: e => e.message || String(e) },
    '../auto-backup-format.ts': { formatBytes: String }, '../FormControls': { FormRow: 'FormRow', Segments: function Segments() {} },
    './api': api, './state': model,
    './preview-state': { getSyncSettingsPreview: () => seedPreview ? preview.initialView() : null },
  };
  vm.runInNewContext(code, { exports, t, require: id => {
    assert.ok(id in deps, `unexpected import: ${id}`);
    return deps[id];
  } });
  const render = () => {
    cursor = 0;
    tree = exports.SyncSettings({ blocked: false, onPull: () => true });
    effects.splice(0).forEach(fn => fn());
  };
  const nodes = () => {
    const out = [];
    const visit = node => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === 'object') { out.push(node); visit(node.props?.children); }
    };
    visit(tree); return out;
  };
  const text = node => Array.isArray(node) ? node.map(text).join('')
    : node && typeof node === 'object' ? text(node.props?.children)
      : node == null || typeof node === 'boolean' ? '' : String(node);
  const button = label => nodes().find(node => node.type === 'button' && text(node) === label);
  const pickMethod = value => { nodes().find(n => n.type?.name === 'Segments').props.onChange(value); render(); };
  const dialog = name => nodes().find(node => node.type?.name === name);
  const settle = async () => { await new Promise(setImmediate); render(); };
  render();
  return { calls, nodes, button, dialog, pickMethod, settle, render, preview, text: () => text(tree), unmount: () => cleanup.forEach(fn => fn?.()) };
}

test('configured, unconfigured and pending mounts invoke only local config_get without a preview seed', async () => {
  for (const [mode, headline] of [['synced', '尚未检查云端'], ['unconfigured', '只连接你自己的 WebDAV'], ['unknown', '上次同步结果未知']]) {
    const r = screen(mode); await r.settle();
    assert.deepEqual(r.calls.map(c => c.command), ['sync_config_get'], mode);
    if (mode === 'unconfigured') {
      assert.equal(r.nodes().find(n => n.props?.['aria-label'] === 'WebDAV 地址'), undefined);
      assert.ok(r.text().includes('不会联网'));
      r.pickMethod('webdav');
    }
    assert.ok(r.text().includes(headline), mode);
    if (mode === 'synced') {
      assert.ok(r.button('只检查云端'));
      assert.ok(r.button('立即同步'));
      assert.match(r.text(), /云端版本：7；设备名：虚构 MacBook/);
    }
    r.unmount();
  }
});

test('saving settings reads only local config after config_set and discards cached cloud status', async () => {
  for (const mode of ['synced', 'unconfigured']) {
    const r = screen(mode, {}, true); await r.settle();
    if (mode === 'unconfigured') {
      r.pickMethod('webdav');
      for (const [label, value] of [['WebDAV 地址', 'https://dav.example.com/fictional'], ['WebDAV 用户名', 'fictional'], ['WebDAV 应用密码', 'fictional-password'], ['同步设备名', '虚构电脑']]) {
        r.nodes().find(n => n.props?.['aria-label'] === label).props.onChange({ target: { value } });
      }
      r.render();
    }
    r.calls.length = 0;
    r.button('保存').props.onClick(); await r.settle();
    assert.deepEqual(r.calls.map(c => c.command), ['sync_config_set', 'sync_config_get'], mode);
    assert.match(r.text(), /尚未检查云端/);
    assert.doesNotMatch(r.text(), /已是最新/);
    assert.ok(r.button('立即同步'));
    r.unmount();
  }
});

test('only a manual check invokes sync_status, while preview seeds do not invoke network commands', async () => {
  const r = screen('synced'); await r.settle();
  r.calls.length = 0;
  r.button('只检查云端').props.onClick(); await r.settle();
  assert.deepEqual(r.calls.map(c => c.command), ['sync_status', 'sync_config_get']);
  assert.match(r.text(), /已是最新/);
  r.unmount();
  const preview = screen('synced', {}, true); await preview.settle();
  assert.deepEqual(preview.calls.map(c => c.command), ['sync_config_get']);
  assert.match(preview.text(), /已是最新/);
  preview.unmount();
});

test('opening an unknown result reads local config only and blocks connection edits', async () => {
  const r = screen('unknown'); await r.settle();
  assert.deepEqual(r.calls.map(c => c.command), ['sync_config_get']);
  assert.match(r.text(), /上次同步结果未知/);
  assert.ok(r.button('核对云端状态'));
  assert.equal(r.button('立即同步'), undefined);
  assert.ok(r.button('保存').props.disabled);
  assert.ok(r.button('测试连接').props.disabled);
  assert.ok(r.button('停用同步').props.disabled);
  assert.ok(r.nodes().filter(n => n.type === 'input').every(n => n.props.disabled));
  r.unmount();
});

test('real reconcile handler uses sync_reconcile and presents each outcome before further transfers', async () => {
  for (const [mode, notice, state, alreadySettled] of [
    ['unknown', '已确认上次同步成功（版本 8）', '已是最新'],
    ['unknown_not_landed', '云端没有收到上次同步，本机更改仍在，可以重新同步', '本机有未上传的更改'],
    ['unknown_remote_changed', '云端在此期间被其他设备更新，请按冲突处理', '本机与云端都有改动'],
    ['unknown', '已核对云端状态，未写入任何资料。', '已是最新', true],
  ]) {
    const r = screen(mode); await r.settle();
    // Another reader may already have settled the receipt since this page loaded.
    if (alreadySettled) await r.preview.command('sync_reconcile');
    r.calls.length = 0;
    r.button('核对云端状态').props.onClick();
    await r.settle();
    assert.deepEqual(r.calls.map(c => c.command), ['sync_reconcile', 'sync_status', 'sync_config_get']);
    assert.ok(r.text().includes(notice), mode);
    assert.ok(r.text().includes(state), mode);
    r.unmount();
  }
});

test('failed reconciliation retains unknown protection and can retry only the read-only check', async () => {
  const r = screen('unknown_error'); await r.settle();
  r.button('核对云端状态').props.onClick(); await r.settle();
  assert.match(r.text(), /上次同步结果未知/);
  assert.match(r.text(), /虚构 WebDAV 连接失败/);
  assert.ok(r.button('核对云端状态'));
  assert.equal(r.button('重试'), undefined);
  assert.ok(r.button('保存').props.disabled);
  assert.deepEqual(r.calls.map(c => c.command), ['sync_config_get', 'sync_reconcile']);
  r.unmount();
});

test('unknown push errors immediately block a fresh transfer', async () => {
  const r = screen('local_ahead', { sync_push: async () => { throw { code: 'SYNC_RESULT_UNKNOWN', message: '虚构未知结果' }; } });
  await r.settle();
  r.button('立即同步').props.onClick(); await r.settle();
  assert.match(r.text(), /上次同步结果未知/);
  assert.equal(r.button('立即同步'), undefined);
  assert.ok(r.button('停用同步').props.disabled);
  r.unmount();
});

test('both disable handlers stop at the local command without checking the network', async () => {
  for (const forget of [false, true]) {
    const r = screen('synced'); await r.settle();
    r.button('停用同步').props.onClick(); await r.settle();
    r.calls.length = 0;
    r.dialog('DisableSyncDialog').props.onDisable(forget); await r.settle();
    assert.deepEqual(JSON.parse(JSON.stringify(r.calls)), [{ command: 'sync_disable', args: { input: { forgetCredentials: forget } } }]);
    assert.match(r.text(), /不会联网/);
    r.pickMethod('webdav');
    assert.match(r.text(), /只连接你自己的 WebDAV/);
    assert.equal(r.button('检查云端'), undefined);
    assert.ok(r.button('测试连接').props.disabled);
    assert.equal(r.nodes().find(n => n.props?.['aria-label'] === 'WebDAV 地址').props.value === '', forget);
    assert.equal(r.nodes().find(n => n.props?.['aria-label'] === 'WebDAV 应用密码').props.placeholder, forget ? '请输入应用密码' : '已保存');
    r.unmount();
  }
});

test('disable failure keeps the dialog and current settings available for correction', async () => {
  const r = screen('synced', { sync_disable: async () => { throw { message: '虚构保存失败' }; } });
  await r.settle(); r.button('停用同步').props.onClick(); await r.settle();
  r.dialog('DisableSyncDialog').props.onDisable(true); await r.settle();
  assert.equal(r.dialog('DisableSyncDialog').props.error, '虚构保存失败');
  assert.match(r.text(), /尚未检查云端/);
  r.dialog('DisableSyncDialog').props.onCancel(); await r.settle();
  assert.equal(r.dialog('DisableSyncDialog'), undefined);
  r.unmount();
});

test('schema incompatibility exposes only the upgrade action and last-sync info tolerates missing status', async () => {
  const r = screen('schema_newer'); await r.settle();
  r.button('立即同步').props.onClick(); await r.settle();
  assert.ok(r.button('查看更新'));
  for (const label of ['立即同步', '检查云端资料', '保留本机', '采用云端']) assert.equal(r.button(label), undefined);
  assert.match(r.text(), /上次同步：.*云端版本：7；设备名：虚构 MacBook/);
  r.unmount();
});

test('the locked scene keeps a wrong passphrase dialog open and syncs after a valid passphrase', async () => {
  const r = screen('locked'); await r.settle();
  r.button('立即同步').props.onClick(); await r.settle();
  assert.ok(r.dialog('PassphraseDialog'));
  r.dialog('PassphraseDialog').props.onSubmit('wrong', false); await r.settle();
  assert.equal(r.dialog('PassphraseDialog').props.error, '同步口令不正确');
  r.dialog('PassphraseDialog').props.onSubmit('preview-pass', false); await r.settle();
  assert.equal(r.dialog('PassphraseDialog'), undefined);
  assert.match(r.text(), /已是最新/);
  assert.match(r.text(), /云端版本：8/);
  r.unmount();
});

test('choosing 不同步 while sync is on asks to disable instead of silently hiding the settings', async () => {
  const r = screen('synced'); await r.settle();
  r.pickMethod('none');
  assert.ok(r.dialog('DisableSyncDialog'));
  assert.ok(r.nodes().find(n => n.props?.['aria-label'] === 'WebDAV 地址'));
  r.unmount();
});
