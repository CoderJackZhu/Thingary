import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as privacy from '../src/privacy-lock.ts';
import { en } from '../src/locales/en.ts';
const enabled = { enabled: true, idleMinutes: 5 };
const storage = value => ({ getItem: key => value[key] ?? null, setItem: (key, v) => { value[key] = v; } });

test('Android device-unlock name uses the English translation; other native names stay unchanged', async () => {
  // Read the real t() calls without the source-reading test hook's Chinese unwrap.
  const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const i18nModule = { exports: {} };
  vm.runInNewContext(compile(await readFile(new URL('../src/i18n.ts', import.meta.url), 'utf8')), {
    module: i18nModule, exports: i18nModule.exports, require: () => ({ en }), navigator: { language: 'en-US' },
  });
  const code = compile(await readFile(new URL('../src/mobile/me/privacy-runtime.ts', import.meta.url), 'utf8'));
  for (const [platform, auth_name, expected] of [
    ['android', '设备解锁', 'Device unlock'],
    ['ios', '设备解锁', '设备解锁'], ['macos', '设备解锁', '设备解锁'], ['windows', '设备解锁', '设备解锁'],
    ['ios', '面容 ID', '面容 ID'], ['android', '身份验证', '身份验证'],
    [undefined, '设备解锁', '设备解锁'], ['android', undefined, 'Authentication'],
  ]) {
    const runtime = { exports: {} };
    const modules = {
      '@tauri-apps/api/core': { isTauri: () => true, invoke: async command => command === 'platform_capabilities' ? { platform, auth_name } : command === 'privacy_auth_available' ? true : null },
      '../../asset': { errorMessage: error => error.message }, '../../privacy-lock': privacy,
      '../../wealth': { storedPending: () => null }, '../../i18n.ts': i18nModule.exports,
    };
    vm.runInNewContext(code, { module: runtime, exports: runtime.exports, require: name => { assert.ok(name in modules, name); return modules[name]; } });
    assert.equal(await runtime.exports.probePrivacy(), true);
    assert.equal(runtime.exports.authName(), expected, `${platform}: ${auth_name}`);
  }
});

test('虚构偏好：缺失、损坏、不合法与不可读存储均关闭，合法值往返', () => {
  for (const value of [null, '', '{', 'null', 'true', '{}', '{"enabled":"true","idleMinutes":5}', '{"enabled":true,"idleMinutes":-1}', '{"enabled":true,"idleMinutes":10}']) assert.deepEqual(privacy.parseLockPreference(value), { enabled: false, idleMinutes: 0 });
  for (const idleMinutes of [0, 5, 15, 60]) {
    const saved = {}, s = storage(saved), value = { enabled: true, idleMinutes };
    assert.equal(privacy.writePrivacyPreference(s, privacy.lockKey, value), true);
    assert.deepEqual(privacy.readLockPreference(s), value);
  }
  const broken = { getItem() { throw Error('虚构读取失败'); }, setItem() { throw Error('虚构写入失败'); } };
  assert.deepEqual(privacy.readLockPreference(broken), { enabled: false, idleMinutes: 0 });
  assert.equal(privacy.readCoverPreference(broken), false);
  assert.equal(privacy.writePrivacyPreference(broken, privacy.coverKey, true), false);
  assert.equal(privacy.writePrivacyPreference(null, privacy.coverKey, true), false);
});
test('虚构启动：锁定期间主应用不挂载、不允许读取，解锁后才允许', () => {
  const locked = privacy.initialPrivacyState(enabled, 0);
  assert.equal(locked.locked, true); assert.equal(locked.mounted, false); assert.equal(privacy.mayReadLibrary(locked), false);
  assert.equal(privacy.mayReadLibrary(privacy.initialPrivacyState({ enabled: false, idleMinutes: 0 }, 0)), true);
  const opened = privacy.privacyTransition(locked, { type: 'unlock', now: 100 }, enabled);
  assert.equal(opened.mounted, true); assert.equal(opened.locked, false); assert.equal(privacy.mayReadLibrary(opened), true);
});
test('虚构闲置：仅超时且离开再返回才锁；活动刷新计时，从不不重锁', () => {
  const open = privacy.privacyTransition(privacy.initialPrivacyState(enabled, 0), { type: 'unlock', now: 0 }, enabled);
  const returned = (state, now, pref = enabled) => privacy.privacyTransition(state, { type: 'return', now, busy: false }, pref);
  assert.equal(returned(open, 999999).locked, false);
  const away = privacy.privacyTransition(open, { type: 'away', now: 1 }, enabled);
  assert.equal(returned(away, 299999).locked, false); assert.equal(returned(away, 300000).locked, true);
  assert.equal(returned(away, 999999, { enabled: true, idleMinutes: 0 }).locked, false);
  const active = privacy.privacyTransition(open, { type: 'activity', now: 280000 }, enabled);
  assert.equal(returned(privacy.privacyTransition(active, { type: 'away', now: 280001 }, enabled), 300000).locked, false);
  assert.equal(privacy.privacyTransition(away, { type: 'activity', now: 500000 }, enabled).lastActivity, 0);
});
test('虚构编辑和保存：超时后延迟，活动不取消待锁，关闭或核对后锁而不卸载', () => {
  const open = privacy.privacyTransition(privacy.initialPrivacyState(enabled, 0), { type: 'unlock', now: 0 }, enabled);
  let state = privacy.privacyTransition(open, { type: 'away', now: 1 }, enabled);
  state = privacy.privacyTransition(state, { type: 'return', now: 300000, busy: true }, enabled);
  assert.equal(state.deferred, true); assert.equal(state.locked, false); assert.equal(state.mounted, true);
  state = privacy.privacyTransition(state, { type: 'activity', now: 300001 }, enabled);
  state = privacy.privacyTransition(state, { type: 'settled', now: 300002, busy: true }, enabled);
  assert.equal(state.locked, false);
  state = privacy.privacyTransition(state, { type: 'settled', now: 300003, busy: false }, enabled);
  assert.equal(state.locked, true); assert.equal(state.mounted, true); assert.equal(privacy.mayReadLibrary(state), false);
});
test('虚构遮罩：默认关闭，只有开启并离开时遮住，返回立即移除', () => {
  const saved = {}, s = storage(saved), open = privacy.initialPrivacyState({ enabled: false, idleMinutes: 0 }, 0);
  assert.equal(privacy.readCoverPreference(s), false);
  assert.equal(privacy.writePrivacyPreference(s, privacy.coverKey, true), true);
  assert.equal(privacy.readCoverPreference(s), true);
  const away = privacy.privacyTransition(open, { type: 'away', now: 1 }, enabled);
  assert.equal(privacy.shouldCover(false, away), false); assert.equal(privacy.shouldCover(true, away), true); assert.equal(privacy.shouldCover(true, open), false);
  assert.equal(privacy.shouldCover(true, privacy.privacyTransition(away, { type: 'return', now: 2, busy: false }, enabled)), false);
});
test('虚构原生菜单：锁定期间到达的事件丢弃，解锁不重放', () => {
  const executed = [], dispatch = action => { if (privacy.privacyMenuAllowed()) executed.push(action); };
  privacy.setPrivacyScreenBlocked(true);
  for (const action of ['open-about', 'open-backup', 'open-updates', 'select-all', 'undo']) dispatch(action);
  privacy.setPrivacyScreenBlocked(false); assert.deepEqual(executed, []);
  dispatch('open-about'); assert.deepEqual(executed, ['open-about']);
});

// Exercise the actual startup boundary with a tiny hook runtime, including its
// async capability/auth handlers. The child callback is the only route into
// Bootstrap and hence into library IPC; no DOM or native credentials are used.
const source = readFileSync(new URL('../src/PrivacyLock.tsx', import.meta.url), 'utf8');
function boundaryRuntime(pref, auth = 'cancel', canAuth = true) {
  const states = [], refs = [], effects = [], pendingEffects = [], calls = [], events = new Map();
  let si = 0, ri = 0, ei = 0, children = 0, now = 0, openDialog = false, observe, reportBusy;
  const saved = { [privacy.lockKey]: JSON.stringify(pref) };
  const compare = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hookEffect = (fn, deps) => { const i = ei++; if (!compare(effects[i], deps)) { effects[i] = deps; pendingEffects.push(fn); } };
  const fn = ts.createSourceFile('PrivacyLock.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PrivacyBoundary');
  const code = ts.transpileModule(fn.getText() + '\nmodule.exports=PrivacyBoundary;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { ...privacy, module: { exports: {} }, exports: {}, require: () => jsx, PrivacyContext: { Provider: 'provider' }, LogoMark: 'logo', storage: () => storage(saved), errorMessage: e => e.message, Date: { now: () => now },
    document: { documentElement: { toggleAttribute() {} }, hidden: false, focused: true, hasFocus() { return this.focused; }, body: {}, querySelector: () => openDialog ? {} : null, addEventListener: (name, fn) => events.set(name, fn), removeEventListener() {} }, window: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener() {} }, MutationObserver: class { constructor(callback) { observe = callback; } observe() {} disconnect() {} },
    invoke: async command => { calls.push(command); if (command === 'privacy_auth_available') return canAuth; if (auth === 'cancel') throw { message: '虚构已取消' }; return null; },
    useState: initial => { const i = si++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: initial => { const i = ri++; return refs[i] ??= { current: initial }; }, useCallback: fn => fn, useEffect: hookEffect, useLayoutEffect: hookEffect,
  };
  vm.runInNewContext(code, context);
  return { calls, states, saved, busy(value) { reportBusy(value); }, setNow(value) { now = value; }, setDialog(value) { openDialog = value; observe?.(); }, fire(name, values = {}) { Object.assign(context.document, values); events.get(name)?.(); }, render() { si = ri = ei = 0; const tree = context.module.exports({ children: onBusy => { reportBusy = onBusy; children++; return '虚构主应用'; } }); const queue = pendingEffects.splice(0); queue.forEach(fn => fn()); return tree; }, get children() { return children; } };
}
test('虚构实际启动边界：能力检查和取消验证均不执行主应用回调', async () => {
  const runtime = boundaryRuntime(enabled);
  runtime.render(); assert.equal(runtime.children, 0);
  await new Promise(setImmediate); runtime.render();
  await new Promise(setImmediate); runtime.render();
  assert.equal(runtime.children, 0); assert.deepEqual(runtime.calls, ['privacy_auth_available', 'privacy_authenticate']);
});
test('虚构实际启动边界：成功或能力不可用才挂载主应用', async () => {
  for (const [auth, canAuth] of [['success', true], ['cancel', false]]) {
    const runtime = boundaryRuntime(enabled, auth, canAuth);
    for (let i = 0; i < 4; i++) { runtime.render(); await new Promise(setImmediate); }
    assert.ok(runtime.children > 0);
    assert.deepEqual(runtime.calls, canAuth ? ['privacy_auth_available', 'privacy_authenticate'] : ['privacy_auth_available']);
  }
});
test('虚构开启设置：验证成功才保存，取消或能力不可用不写偏好', async () => {
  for (const [auth, available] of [['success', true], ['cancel', true], ['success', false]]) {
    const runtime = boundaryRuntime({ enabled: false, idleMinutes: 0 }, auth, available);
    runtime.render(); await new Promise(setImmediate);
    const value = runtime.render().props.value;
    if (auth === 'cancel') await assert.rejects(value.setLock(enabled), error => error.message === '虚构已取消');
    else assert.equal(await value.setLock(enabled), available);
    assert.equal(JSON.parse(runtime.saved[privacy.lockKey]).enabled, auth === 'success' && available);
    assert.deepEqual(runtime.calls, available ? ['privacy_auth_available', 'privacy_authenticate'] : ['privacy_auth_available']);
  }
});
test('虚构窗口焦点：页面重新可见但窗口仍未聚焦时继续遮挡', () => {
  const runtime = boundaryRuntime({ enabled: false, idleMinutes: 0 });
  runtime.render();
  runtime.fire('blur', { focused: false }); assert.equal(runtime.states[2].away, true);
  runtime.fire('visibilitychange', { hidden: false }); assert.equal(runtime.states[2].away, true);
  runtime.fire('focus', { focused: true }); assert.equal(runtime.states[2].away, false);
  runtime.fire('visibilitychange', { hidden: true }); assert.equal(runtime.states[2].away, true);
});
test('锁屏使用不透明顶层dialog，实际菜单接收器逐个检查同步锁定标记', () => {
  assert.match(source, /state\.mounted && children\(onBusy\)/);
  assert.match(source, /\.showModal\(\)/);
  assert.match(source, /toggleAttribute\('data-privacy-screen', blocked\)/);
  assert.match(readFileSync(new URL('../src/privacy-lock.css', import.meta.url), 'utf8'), /\[data-privacy-screen\]::view-transition\{display:none\}/);
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /privacyMenuAllowed\(\)\) menuAction/); assert.match(main, /!privacyMenuAllowed\(\) \|\| event\.payload !== 'select-all'/);
  assert.match(readFileSync(new URL('../src/undo.tsx', import.meta.url), 'utf8'), /!privacyMenuAllowed\(\) \|\| event\.payload !== 'undo'/);
  assert.match(readFileSync(new URL('../src/privacy-lock.css', import.meta.url), 'utf8'), /background:var\(--bg\)/);
});

test('虚构实际闲置边界：编辑与未知保存延后重锁，删除对话框后保留主应用并锁定', async () => {
  const runtime = boundaryRuntime(enabled, 'success');
  for (let i = 0; i < 4; i++) { runtime.render(); await new Promise(setImmediate); }
  runtime.busy(true);
  runtime.setDialog(true);
  runtime.fire('blur', { focused: false });
  runtime.setNow(300001);
  runtime.fire('focus', { focused: true });
  assert.equal(runtime.states[2].locked, false);
  assert.equal(runtime.states[2].deferred, true);
  runtime.busy(false);
  assert.equal(runtime.states[2].locked, false);
  runtime.setDialog(false);
  assert.equal(runtime.states[2].locked, true);
  assert.equal(runtime.states[2].mounted, true);
  assert.match(source, /childList: true/);
});

// Render the real settings section with a stub hook runtime: the authentication
// switch owns the idle option, while the cover switch stays independent.
function settingsText(lock, available = true) {
  const privacy = { cover: true, lock, available, checking: false, setCover: () => true, setLock: async () => true };
  const fn = ts.createSourceFile('PrivacyLock.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'PrivacySettings');
  const code = ts.transpileModule(fn.getText() + '\nmodule.exports=PrivacySettings;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { module: { exports: {} }, exports: {}, require: () => jsx, PrivacyContext: {}, useContext: () => privacy, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' } };
  vm.runInNewContext(code, context);
  const walk = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(walk).join('') : node && typeof node === 'object' && node.props ? walk(node.props.children) : '';
  return walk(context.module.exports());
}
test('虚构设置：总开关启用后才展开闲置验证，遮挡保持独立', () => {
  const off = settingsText({ enabled: false, idleMinutes: 5 }), on = settingsText({ enabled: true, idleMinutes: 5 });
  for (const text of [off, on]) {
    assert.match(text, /窗口不在前台时遮住内容/);
    assert.match(text, /启用身份验证每次打开物谱需要验证身份/);
    assert.doesNotMatch(text, /打开物谱时需要验证身份/);
  }
  assert.doesNotMatch(off, /闲置后重新验证/);
  assert.match(on, /闲置后重新验证/);
  assert.match(on, /5 分钟/);
  // The cover switch is rendered regardless of the authentication switch.
  assert.equal(settingsText({ enabled: false, idleMinutes: 0 }, false).includes('窗口不在前台时遮住内容'), true);
});
