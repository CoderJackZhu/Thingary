import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as model from '../src/update-discovery.ts';

const ts = createRequire(import.meta.url)('typescript');

// A tiny mount loop for the discovery components: they need a context
// provider, which the shared planning runtime does not supply. Key handling
// follows that runtime: one key space per component instance, reset per pass.
function mountWrapper(_props, { invoke = async () => null, child, document: doc } = {}) {
  const slots = new Map(), cleanups = new Map(), instances = new Map();
  const timers = new Map(), listeners = new Map();
  let timerId = 0;
  const listen = (target, type, fn) => { const k = `${target}:${type}`; listeners.set(k, [...(listeners.get(k) ?? []), fn]); };
  const unlisten = (target, type, fn) => { const k = `${target}:${type}`; listeners.set(k, (listeners.get(k) ?? []).filter(f => f !== fn)); };
  let mounted = new Set(), path = 'root', cursor = 0, effects = [], dirty = false;
  const key = () => `${path}:${cursor++}`;
  const hooks = {
    useId() { return key(); },
    useState(initial) {
      const k = key();
      if (!slots.has(k)) slots.set(k, typeof initial === 'function' ? initial() : initial);
      return [slots.get(k), next => { slots.set(k, typeof next === 'function' ? next(slots.get(k)) : next); dirty = true; }];
    },
    useRef(initial) { const k = key(); if (!slots.has(k)) slots.set(k, { current: initial }); return slots.get(k); },
    useCallback(fn, deps) {
      const k = key(), prev = slots.get(k);
      if (!prev || deps.some((v, i) => !Object.is(v, prev.deps[i]))) slots.set(k, { fn, deps });
      return slots.get(k).fn;
    },
    useEffect(fn, deps) {
      const k = key(), prev = slots.get(k);
      if (!prev || !Array.isArray(deps) || deps.some((v, i) => !Object.is(v, prev[i]))) { slots.set(k, deps ?? []); effects.push(() => { cleanups.get(k)?.(); cleanups.set(k, fn() ?? null); }); }
    },
    useMemo(fn) { return fn(); },
    createContext() { return { _box: { current: null }, Provider({ value, children }) { return { __provider: true, value, children }; } }; },
    useContext(context) { return context._box.current; },
  };
  const leaf = new Proxy({}, { get: (_, k) => String(k) });
  const modules = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, k) => ({ type, props, key: k }), jsxs: (type, props, k) => ({ type, props, key: k }) },
    '@tauri-apps/api/core': { invoke },
    './asset': { errorMessage: e => e?.message ?? String(e) },
    './FormControls': { Switch: props => ({ type: 'label', props: { children: [props.label ?? '', { type: 'input', props: { type: 'checkbox', ...props, 'data-stub': 'Switch' } }] } }) },
    './SupportLink': { SupportLink: props => ({ type: 'a', props }) },
    './AssetViews': { Icon: props => ({ type: 'span', props }) },
    './privacy-lock': { privacyMenuAllowed: () => !doc?.locked },
    './start-choice': { choiceStorage: () => doc?.storage ?? null },
    './update-check': { sourceLabel: { gitee: 'Gitee', github: 'GitHub' } },
    './update-discovery': model,
  };
  const loaded = {};
  function run(file) {
    if (loaded[file]) return loaded[file];
    const js = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const m = { exports: {} };
    vm.runInNewContext(js, {
      module: m, exports: m.exports,
      require: id => modules[(id.startsWith('.') ? './' + posix.normalize(posix.join(posix.dirname(file), id)) : id).replace(/\.ts$/, '')] ?? leaf,
      structuredClone, crypto: globalThis.crypto, console,
      document: { hidden: false, visibilityState: 'visible', hasFocus: () => doc?.focused !== false,
        addEventListener: (type, fn) => listen('document', type, fn), removeEventListener: (type, fn) => unlisten('document', type, fn), ...doc },
      IntersectionObserver: doc?.observer === false ? undefined : class {
        constructor(callback) { this.callback = callback; }
        observe() { this.callback([{ isIntersecting: true }], this); }
        disconnect() {}
      },
      window: {
        setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
        addEventListener: (type, fn) => listen('window', type, fn), removeEventListener: (type, fn) => unlisten('window', type, fn),
        dispatchEvent(event) { for (const fn of listeners.get(`window:${event.type}`) ?? []) fn(event); return true; },
        CustomEvent: class { constructor(type, init) { Object.assign(this, init); this.type = type; } },
      },
    });
    loaded[file] = m.exports;
    return m.exports;
  }
  const discovery = run('UpdateDiscovery');
  let tree;
  function discard(instance) {
    for (const k of slots.keys()) if (k.slice(0, k.lastIndexOf(':')) === instance) { cleanups.get(k)?.(); cleanups.delete(k); slots.delete(k); }
    instances.delete(instance);
  }
  function expand(node, nodeKey) {
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${nodeKey}:${i}`));
    if (!node || typeof node !== 'object') return node;
    if (node.__provider) {
      // Context providers record their value for useContext below.
      const previous = path;
      providerValues.push(node.value);
      const out = expand(node.children, `${nodeKey}:provider`);
      providerValues.pop();
      path = previous;
      return out;
    }
    if (typeof node.type === 'function') {
      const previous = path, previousCursor = cursor;
      if (instances.has(nodeKey) && instances.get(nodeKey) !== node.type) discard(nodeKey);
      instances.set(nodeKey, node.type);
      mounted.add(nodeKey);
      path = nodeKey; cursor = 0;
      const out = expand(node.type(node.props), `${nodeKey}:child`);
      path = previous; cursor = previousCursor;
      return out;
    }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${nodeKey}:children`) } };
  }
  const providerValues = [];
  hooks.useContext = context => (providerValues.length ? providerValues[providerValues.length - 1] : context._box.current);
  const render = () => {
    for (let round = 0; round < 6; round++) {
      dirty = false; effects = []; mounted = new Set(); providerValues.length = 0;
      tree = expand(child(discovery), 'tree');
      for (const instance of instances.keys()) if (!mounted.has(instance)) discard(instance);
      for (const n of nodes()) if (n.props?.ref && typeof n.props.ref === 'object' && n.props.ref.current === null) n.props.ref.current = {};
      effects.forEach(fn => fn());
      if (!dirty) break;
    }
    return tree;
  };
  const nodes = () => { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(tree); return out; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
  const button = label => nodes().find(n => n.type === 'button' && (n.props['aria-label'] === label || text(n) === label));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render();
  return { nodes, text, button, settle, render, module: discovery,
    fireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    event(type, detail, target = 'window') { for (const fn of listeners.get(`${target}:${type}`) ?? []) fn({ type, detail }); render(); },
  };
}

const release = (version, extra = {}) => ({
  version, published_at: '2026-10-20T08:00:00Z', notes: '虚构发布说明',
  sources: ['gitee', 'github'],
  downloads: [{ source: 'gitee', name: `Thingary-${version}-universal.dmg`, label: 'Mac 通用安装包（Apple Silicon 与 Intel）', size: 30000000 }],
  confirmed_at: '2026-10-21T08:00:00Z', ...extra,
});
const state = (extra = {}) => ({
  current_version: '0.0.6', platform_label: 'Mac · Apple Silicon', consent: 'unset',
  preferences_status: 'ok', preferences_problem: null, preference_revision: 3,
  highest_seen_version: null, ignored_version: null,
  last_attempt_at: '2026-10-21T08:00:00Z', last_success_at: '2026-10-21T08:00:00Z',
  candidate: null, newer_unavailable: null, last_unreachable: [],
  cache_applicable: true, cache_unsaved: false, update_available: false, candidate_fresh: true, unread: false,
  ...extra,
});

// --- pure derivations --------------------------------------------------------

test('outcome lines say what a manual round found, naming unreachable mirrors', () => {
  const update = state({ update_available: true, candidate: release('0.0.7') });
  assert.equal(model.outcomeLine(model.manualOutcome(update, null, null)), '发现新版本 0.0.7（2026-10-20 发布），当前版本 0.0.6。');
  const partial = state({ update_available: true, candidate: release('0.0.7'), last_unreachable: ['github'] });
  assert.match(model.outcomeLine(model.manualOutcome(partial, null, null)), /（未能连接 GitHub，结果只来自其余来源，可能不是最新。）/);
  const latest = state({ update_available: false });
  assert.equal(model.outcomeLine(model.manualOutcome(latest, null, null)), '本次未发现适合当前设备的新版本（当前 0.0.6）。');
  const offline = state({ update_available: false, last_unreachable: ['gitee', 'github'] });
  assert.equal(model.manualOutcome(offline, null, null).kind, 'failed');
  assert.match(model.outcomeLine(model.manualOutcome(offline, null, null)), /未能连接 Gitee 和 GitHub/);
  assert.doesNotMatch(model.outcomeLine(model.manualOutcome(offline, null, null)), /本次未发现/);
  const unavailable = state({ newer_unavailable: release('0.0.7', { downloads: [] }) });
  assert.match(model.outcomeLine(model.manualOutcome(unavailable, null, null)), /暂未提供适合当前设备的安装包/);
  assert.equal(model.outcomeLine(model.manualOutcome(state(), { origin: 'manual', applied: false, cancelled: false, error: null }, '网络错误')), '网络错误');
  const cancelled = { origin: 'automatic', applied: false, cancelled: true, error: null };
  assert.match(model.outcomeLine(model.manualOutcome(state(), cancelled, null)), /自动检查已取消，可点击手动检查/);
  const unsaved = { origin: 'manual', applied: false, cancelled: false, error: '本次检查完成，但结果暂时无法保存' };
  assert.match(model.outcomeLine(model.manualOutcome(state(), unsaved, null)), /暂时无法保存/);
});

test('version order is numeric, so 0.0.10 outranks 0.0.9', () => {
  assert.ok(model.versionNewer('0.0.10', '0.0.9'));
  assert.ok(!model.versionNewer('0.0.9', '0.0.10'));
  assert.ok(!model.versionNewer('1.2.3', '1.2.3'));
  assert.ok(!model.versionNewer('dev', '0.0.1'));
});

test('the last-check line distinguishes a success from a bare attempt', () => {
  assert.match(model.lastCheckLine(state()), /上次成功检查：2026-10-21 \d{2}:\d{2}/);
  const failed = state({ last_success_at: null, last_attempt_at: '2026-10-21T08:00:00Z' });
  assert.match(model.lastCheckLine(failed), /上次尝试检查：2026-10-21 \d{2}:\d{2}（未成功）/);
  assert.equal(model.lastCheckLine(state({ last_success_at: null, last_attempt_at: null })), '');
});

// --- one-time ask ------------------------------------------------------------

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
}

test('the invite only appears for an unset, readable choice on a started personal library', () => {
  const base = { asked: false, hasRecords: true, demoActive: false, busy: false };
  assert.ok(model.updateInviteVisible(state(), base));
  assert.ok(!model.updateInviteVisible(state({ consent: 'enabled' }), base), 'a choice already made never re-asks');
  assert.ok(!model.updateInviteVisible(state({ consent: 'disabled' }), base));
  assert.ok(!model.updateInviteVisible(state({ preferences_status: 'damaged' }), base), 'an unreadable preference does not invite');
  assert.ok(!model.updateInviteVisible(state(), { ...base, asked: true }));
  assert.ok(!model.updateInviteVisible(state(), { ...base, hasRecords: false }));
  assert.ok(!model.updateInviteVisible(state(), { ...base, demoActive: true }));
  assert.ok(!model.updateInviteVisible(state(), { ...base, busy: true }));
  assert.ok(!model.updateInviteVisible(null, base));
});

test('the startup gate needs consent, calm and an unlocked screen', () => {
  assert.ok(model.autoCheckScheduled(state({ consent: 'enabled' }), { idle: true, unlocked: true, checkedThisSession: false }));
  assert.ok(!model.autoCheckScheduled(state({ consent: 'enabled' }), { idle: false, unlocked: true, checkedThisSession: false }));
  assert.ok(!model.autoCheckScheduled(state({ consent: 'enabled' }), { idle: true, unlocked: false, checkedThisSession: false }));
  assert.ok(!model.autoCheckScheduled(state({ consent: 'enabled' }), { idle: true, unlocked: true, checkedThisSession: true }));
  assert.ok(!model.autoCheckScheduled(state(), { idle: true, unlocked: true, checkedThisSession: false }));
  assert.ok(!model.autoCheckScheduled(null, { idle: true, unlocked: true, checkedThisSession: false }));
  assert.equal(model.autoCheckDelayMs, 5000);
});

// --- real component handlers --------------------------------------------------

function mountDiscovery(invoke, options = {}) {
  let current = state(options.stateOverride ?? {});
  return mountWrapper({}, {
    invoke: async (name, args) => {
      options.calls?.push([name, args]);
      if (name === 'update_state_get') return current;
      const answer = await invoke(name, args, current);
      if (answer && typeof answer === 'object' && 'consent' in answer) current = answer;
      return answer;
    },
    child: d => ({ type: d.UpdateDiscoveryProvider, props: { visitKey: options.visitKey ?? '', idle: options.idle ?? true, hasRecords: true, demoActive: false, children: options.child?.(d) ?? null } }),
    document: options.document,
  });
}

test('opening about reads only the local state; the manual button carries the only network request', async () => {
  const calls = [];
  const r = mountDiscovery(async () => null, {
    calls,
    child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }),
  });
  await r.settle();
  assert.deepEqual(calls.map(c => c[0]), ['update_state_get'], 'no automatic request without consent');
  assert.match(r.text(r.nodes()[0]), /启动时检查更新/);
  assert.match(r.text(r.nodes()[0]), /每天最多查询一次公开版本列表/);
});

test('a discovered release shows notes, validated download targets and the ignore action', async () => {
  const calls = [];
  let ignored = null;
  const r = mountDiscovery(async (name, args) => {
    if (name === 'update_check_request') return { decision: 'started', task: { origin: 'manual', applied: true, cancelled: false, error: null }, state: state({ update_available: true, candidate: release('0.0.7'), unread: false }) };
    if (name === 'update_ignore_version') { ignored = args.version; return state({ update_available: true, candidate: release('0.0.7'), ignored_version: args.version, unread: false }); }
    if (name === 'update_open_download') return null;
    return state({ update_available: true, candidate: release('0.0.7'), unread: false });
  }, {
    calls,
    stateOverride: state({ update_available: true, candidate: release('0.0.7'), unread: false }),
    child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }),
    document: { storage: memoryStorage() },
  });
  await r.settle();
  // The state itself already carries the candidate; no request needed to see it.
  assert.match(r.text(r.nodes()[0]), /有新版本 0\.0\.7/);
  assert.match(r.text(r.nodes()[0]), /虚构发布说明/);
  assert.match(r.text(r.nodes()[0]), /完整备份并异地保存/);
  r.button('下载 Mac 安装包').props.onClick();
  await r.settle();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['update_open_download', { version: '0.0.7', source: 'gitee', name: 'Thingary-0.0.7-universal.dmg' }]));
  r.button('忽略此版本').props.onClick();
  await r.settle();
  assert.equal(ignored, '0.0.7');
  assert.match(r.text(r.nodes()[0]), /已忽略这个版本的提醒/);
});

test('a visible version card is marked seen exactly once; a folded or locked screen is not', async () => {
  const seen = [];
  let observerVisible = true;
  const seenState = () => state({ update_available: true, candidate: release('0.0.7'), unread: true });
  const mount = document => mountDiscovery(async (name, args) => {
    if (name === 'update_mark_seen') { seen.push(args.version); return state({ update_available: true, candidate: release('0.0.7'), highest_seen_version: args.version, unread: false }); }
    return seenState();
  }, { stateOverride: seenState(), child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }), document });
  const r = mount({ storage: memoryStorage() });
  await r.settle();
  assert.deepEqual(seen, ['0.0.7'], 'an intersecting, foreground card records the read');
  r.render();
  assert.deepEqual(seen, ['0.0.7'], 'recording happens once per version');
  const locked = mount({ storage: memoryStorage(), locked: true });
  await locked.settle();
  assert.deepEqual(seen, ['0.0.7'], 'a lock screen covering the card does not count');
});

test('the toggle saves the explicit choice with the expected revision and surfaces a conflict', async () => {
  const calls = [];
  let revision = 3;
  const r = mountDiscovery(async (name, args) => {
    if (name === 'update_consent_set') {
      if (args.expectedRevision !== 3) throw { message: '自动检查的选择已变化，请重新读取后再设置' };
      revision += 1;
      return state({ consent: args.enabled ? 'enabled' : 'disabled', preference_revision: revision });
    }
    return state({ preference_revision: revision });
  }, { calls, child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }) });
  await r.settle();
  const toggle = () => r.nodes().find(n => n.props?.['data-stub'] === 'Switch');
  toggle().props.onChange(true);
  await r.settle();
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['update_consent_set', { enabled: true, expectedRevision: 3 }]));
  assert.match(r.text(r.nodes()[0]), /开启后，打开物谱时每天最多查询一次公开版本列表/);
  // A stale write fails loudly and the state re-reads instead of faking success.
  toggle().props.onChange(false);
  toggle().props.onChange(true);
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /的选择已变化，请重新读取后再设置/);
});

test('a round that fails on the backend (not the command) still shows its reason', async () => {
  const r = mountDiscovery(async name => {
    if (name === 'update_check_request') return { decision: 'started', task: { origin: 'manual', applied: true, cancelled: false, error: '无法连接到 Gitee 和 GitHub，请检查网络后重试。' }, state: state({ candidate: null, update_available: false, last_success_at: null, last_unreachable: ['gitee', 'github'] }) };
    return state();
  }, { child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }) });
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /无法连接到 Gitee 和 GitHub/);
});

test('a manual failure keeps its readable reason and retry; damage to preferences is explained', async () => {
  let fail = true;
  const r = mountDiscovery(async name => {
    if (name === 'update_check_request') {
      if (fail) throw { message: '无法连接到 Gitee 和 GitHub，请检查网络后重试。' };
      return { decision: 'started', task: { origin: 'manual', applied: true, cancelled: false, error: null }, state: state() };
    }
    return state();
  }, { child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }) });
  await r.settle();
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /无法连接到 Gitee 和 GitHub/);
  fail = false;
  r.button('检查更新').props.onClick();
  await r.settle();
  assert.match(r.text(r.nodes()[0]), /本次未发现适合当前设备的新版本/);
  assert.doesNotMatch(r.text(r.nodes()[0]), /无法连接到 Gitee 和 GitHub/);
  const damaged = mountDiscovery(async () => state(), {
    stateOverride: state({ preferences_status: 'damaged', preferences_problem: '读取失败：内容无法识别' }),
    child: d => ({ type: d.UpdateCheck, props: { compact: true, showVersion: false, versionLabel: '版本 0.0.6' } }),
  });
  await damaged.settle();
  assert.match(damaged.text(damaged.nodes()[0]), /设置文件读取失败：读取失败：内容无法识别/);
});

test('the invite enables only after the choice is saved; a save failure stays visible', async () => {
  const calls = [];
  let saved = null;
  const mount = consentAnswer => mountDiscovery(async (name, args) => {
    if (name === 'update_consent_set') return consentAnswer(args);
    return state(saved ?? state());
  }, {
    calls,
    child: d => ({ type: d.UpdateInvite, props: {} }),
    document: { storage: memoryStorage() },
  });
  const ok = mount(args => { saved = state({ consent: args.enabled ? 'enabled' : 'disabled' }); return saved; });
  await ok.settle();
  assert.match(ok.text(ok.nodes()[0]), /自动发现新版本？/);
  ok.button('开启自动检查').props.onClick();
  await ok.settle();
  assert.equal(JSON.stringify(calls.filter(c => c[0] === 'update_consent_set').map(c => c[1])), JSON.stringify([{ enabled: true, expectedRevision: 3 }]));
  assert.equal(ok.nodes().length === 0 || !ok.button('保持手动检查'), true, 'the ask never repeats after a saved answer');

  const failing = mount(() => { throw { message: '磁盘写入失败' }; });
  await failing.settle();
  failing.button('保持手动检查').props.onClick();
  await failing.settle();
  assert.match(failing.text(failing.nodes()[0]), /磁盘写入失败/);
  assert.match(failing.text(failing.nodes()[0]), /本次没有更改自动检查/);
  assert.ok(failing.button('开启自动检查'), 'a failed save keeps both choices available');
});

test('the invite stays away while an edit or save is in progress', async () => {
  const mount = idle => mountDiscovery(async () => state(), {
    idle,
    child: d => ({ type: d.UpdateInvite, props: {} }),
    document: { storage: memoryStorage() },
  });
  const calm = mount(true);
  await calm.settle();
  assert.match(calm.text(calm.nodes()[0]), /自动发现新版本/);
  const editing = mount(false);
  await editing.settle();
  assert.equal(editing.nodes().length, 0, 'an edit in progress keeps the ask for a calmer page');
});

test('the business invitation yields for this entire visit, then a later page may invite', async () => {
  const options = { visitKey: 'wealth', child: d => ({ type: d.UpdateInvite, props: {} }) };
  const r = mountDiscovery(async () => state(), options);
  await r.settle();
  r.event('thingary-ask-card-shown', { kind: 'checkin' });
  assert.equal(r.nodes().length, 0);
  r.render();
  assert.equal(r.nodes().length, 0, 'no timeout reintroduces an invitation on this visit');
  options.visitKey = 'overview';
  r.render();
  assert.ok(r.button('保持手动检查'), 'a real later page visit may invite');
});

test('closing the invitation saves a disabled choice without querying', async () => {
  const calls = [];
  const r = mountDiscovery(async (name, args) => state({ consent: args.enabled ? 'enabled' : 'disabled', preference_revision: 4 }), {
    calls, child: d => ({ type: d.UpdateInvite, props: {} }),
  });
  await r.settle();
  r.button('关闭自动检查询问').props.onClick();
  await r.settle();
  assert.equal(calls.filter(([name]) => name === 'update_check_request').length, 0);
  assert.equal(calls.find(([name]) => name === 'update_consent_set')[1].enabled, false);
  assert.equal(r.nodes().length, 0);
});

test('damaged preferences have explicit repair choices; future formats keep only manual lookup', async () => {
  const options = { stateOverride: state({ preferences_status: 'damaged', preferences_repairable: true }), child: d => ({ type: d.UpdateCheck, props: { showVersion: false } }) };
  const calls = [];
  const r = mountDiscovery(async (name, args) => { calls.push([name, args]); return state({ consent: 'disabled', preference_revision: 4 }); }, options);
  await r.settle();
  assert.ok(r.button('保持手动并修复设置'));
  r.button('保持手动并修复设置').props.onClick();
  await r.settle();
  assert.equal(calls.at(-1)[1].enabled, false);
  assert.equal(r.button('保持手动并修复设置'), undefined);
  const future = mountDiscovery(async () => null, { ...options, stateOverride: state({ preferences_status: 'damaged', preferences_repairable: false }) });
  await future.settle();
  assert.equal(future.button('保持手动并修复设置'), undefined);
  assert.ok(future.button('检查更新'));
  assert.match(future.text(future.nodes()[0]), /设置来自较新版本/);
});

test('the timer rechecks lock state, and unlock can schedule the unused automatic round', async () => {
  const doc = { locked: false };
  const calls = [];
  const r = mountDiscovery(async () => ({ decision: 'started', task: null, state: state({ consent: 'enabled' }) }), {
    calls, document: doc, stateOverride: state({ consent: 'enabled' }),
  });
  await r.settle();
  doc.locked = true;
  r.fireTimers();
  await r.settle();
  assert.equal(calls.filter(([name]) => name === 'update_check_request').length, 0);
  r.event('thingary-privacy-screen-changed');
  doc.locked = false;
  r.event('thingary-privacy-screen-changed');
  r.fireTimers();
  await r.settle();
  assert.equal(calls.filter(([name]) => name === 'update_check_request').length, 1);
});

test('a response captured before a newer consent revision cannot re-enable the UI', async () => {
  let resolveLookup;
  let context;
  const r = mountDiscovery(async (name, args) => {
    if (name === 'update_check_request') return new Promise(resolve => { resolveLookup = resolve; });
    if (name === 'update_consent_set') return state({ consent: 'disabled', preference_revision: 4 });
    return state();
  }, { stateOverride: state({ consent: 'enabled' }), child: d => ({ type: () => { context = d.useUpdateDiscovery(); return null; }, props: {} }) });
  await r.settle();
  const query = context.manualCheck();
  await context.setConsent(false);
  await r.settle();
  resolveLookup({ decision: 'started', task: null, state: state({ consent: 'enabled', preference_revision: 3 }) });
  await query;
  await r.settle();
  assert.equal(context.state.consent, 'disabled');
});

test('a card mounted while locked is only marked seen after an actual unlock', async () => {
  const doc = { locked: true };
  const calls = [];
  const found = state({ candidate: release('0.0.7'), update_available: true, unread: true });
  const r = mountDiscovery(async () => ({ ...found, highest_seen_version: '0.0.7', unread: false, preference_revision: 4 }), {
    calls, document: doc, stateOverride: found, child: d => ({ type: d.UpdateCheck, props: { showVersion: false } }),
  });
  await r.settle();
  assert.equal(calls.filter(([name]) => name === 'update_mark_seen').length, 0);
  doc.locked = false;
  r.event('thingary-privacy-screen-changed');
  await r.settle();
  assert.equal(calls.filter(([name]) => name === 'update_mark_seen').length, 1);
});

test('repairing damaged preferences retries a visible card read and clears its old failure notice', async () => {
  let damaged = true, seen = 0;
  const current = () => state({ candidate: release('0.0.7'), update_available: true, unread: true,
    preferences_status: damaged ? 'damaged' : 'ok', preferences_repairable: true });
  const r = mountDiscovery(async (name) => {
    if (name === 'update_mark_seen') {
      seen++;
      if (damaged) throw { message: '损坏' };
      return { ...current(), highest_seen_version: '0.0.7', unread: false };
    }
    if (name === 'update_consent_set') damaged = false;
    return current();
  }, { stateOverride: current(), child: d => ({ type: d.UpdateCheck, props: { showVersion: false } }) });
  await r.settle();
  await r.settle();
  assert.equal(seen, 1);
  assert.match(r.text(r.nodes()[0]), /已读状态暂时无法保存/);
  r.button('保持手动并修复设置').props.onClick();
  await r.settle();
  await r.settle();
  assert.equal(seen, 2);
  assert.doesNotMatch(r.text(r.nodes()[0]), /已读状态暂时无法保存/);
});
