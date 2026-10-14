import test from 'node:test';
import assert from 'node:assert/strict';
import { engineRequest, engineRequestAsync } from '../src/planning-engine.ts';

test('WASM transport rejects non-finite data and preserves valid errors', () => {
  assert.throws(() => engineRequest({ op: 'retirement_step', balance: NaN }), /非有限/);
  assert.throws(() => engineRequest({ op: 'retirement_step', growth: -1 }), RangeError);
  assert.deepEqual(engineRequest({ op: 'retirement_step', balance: 100, growth: 1, lump: 0, spend: 40, income: 10 }), { a: 70, gap: 0, withdrawal: 30 });
});

test('monthly calculation requires every explicit input and keeps zero gross return valid', () => {
  const complete = { op: 'retirement_step', balance: 100, growth: 1, lump: 0, spend: 0, income: 0 };
  for (const field of ['balance', 'growth', 'lump', 'spend', 'income']) {
    const missing = { ...complete };
    delete missing[field];
    assert.throws(() => engineRequest(missing), RangeError, field);
  }
  assert.deepEqual(engineRequest({ ...complete, growth: 0 }), { a: 0, gap: 0, withdrawal: 0 });
});

test('native transport sends the same data and drops a cancelled late result', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  let finish, started;
  const began = new Promise(resolve => { started = resolve; });
  globalThis.window = { __TAURI_INTERNALS__: { invoke: (command, args) => {
    calls.push({ command, args }); started();
    return new Promise(resolve => { finish = resolve; });
  } } };
  try {
    const controller = new AbortController();
    const request = { op: 'retirement_step', balance: 100, growth: 1, lump: 0, spend: 40, income: 10 };
    const pending = engineRequestAsync(request, controller.signal);
    await began;
    controller.abort();
    finish({ a: 70, gap: 0, withdrawal: 30 });
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(calls, [{ command: 'planning_engine_evaluate', args: { request } }]);
    await assert.rejects(engineRequestAsync(request, controller.signal), { name: 'AbortError' });
    assert.equal(calls.length, 1);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
