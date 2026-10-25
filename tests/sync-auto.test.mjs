import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

function load(config, states) {
  const calls = [];
  const api = {
    syncConfigGet: async () => config,
    syncStatus: async () => { calls.push('status'); return { state: states.shift() }; },
    syncPush: async () => { calls.push('push'); return { version: 2 }; },
  };
  const exports = {};
  vm.runInNewContext(compile('../src/sync/auto.ts'), { exports, Date, Set, require: id => id === './api' ? api : { useEffect() {}, useSyncExternalStore() {} } });
  return { exports, calls };
}

const base = { enabled: true, auto_check: true, has_pending_push: false, has_remembered_passphrase: true };

test('auto sync uploads a plain fast-forward only when the passphrase is remembered', async () => {
  const a = load(base, ['local_ahead', 'up_to_date']);
  await a.exports.runAutoSync(true);
  assert.deepEqual(a.calls, ['status', 'push', 'status']);
  const b = load({ ...base, has_remembered_passphrase: false }, ['local_ahead']);
  await b.exports.runAutoSync(true);
  assert.deepEqual(b.calls, ['status']);
});

test('auto sync never pulls and does nothing when off or when a push result is unknown', async () => {
  const a = load(base, ['remote_ahead']);
  await a.exports.runAutoSync(true);
  assert.deepEqual(a.calls, ['status']);
  for (const config of [{ ...base, enabled: false }, { ...base, auto_check: false }, { ...base, has_pending_push: true }]) {
    const r = load(config, ['up_to_date']);
    await r.exports.runAutoSync(true);
    assert.deepEqual(r.calls, []);
  }
});

test('auto sync re-reads the settings before uploading and skips when they changed meanwhile', async () => {
  const calls = [];
  let reads = 0;
  const api = {
    syncConfigGet: async () => (++reads === 1 ? base : { ...base, auto_check: false }),
    syncStatus: async () => { calls.push('status'); return { state: 'local_ahead' }; },
    syncPush: async () => { calls.push('push'); return { version: 2 }; },
  };
  const exports = {};
  vm.runInNewContext(compile('../src/sync/auto.ts'), { exports, Date, Set, require: id => id === './api' ? api : { useEffect() {}, useSyncExternalStore() {} } });
  await exports.runAutoSync(true);
  assert.deepEqual(calls, ['status']);
});
